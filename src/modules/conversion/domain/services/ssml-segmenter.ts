import { type SegmentWord } from '../entities/conversion-segment.entity';

/**
 * Taille maximale d'un segment SSML, marques comprises. Sous les limites de
 * Polly (6 000 caractères au total, dont 3 000 facturés ; les balises ne sont
 * pas facturées, ADR-0013) et de la plupart des moteurs (Google : 5 000
 * octets), avec une marge contre les arrondis.
 */
export const MAX_SSML_BYTES = 4800;

/**
 * Taille à partir de laquelle un segment peut se fermer sur une phrase
 * « ancre ». Sous ce seuil, on continue de remplir : moins de requêtes.
 */
export const SOFT_MIN_SSML_BYTES = 2400;

/** Un « mot » plus long (chaîne sans espace) est coupé : il doit tenir dans un segment. */
export const MAX_WORD_LENGTH = 200;

export interface PageText {
  readonly pageNumber: number;
  readonly text: string;
}

export interface SsmlSegment {
  readonly index: number;
  readonly ssml: string;
  readonly words: readonly SegmentWord[];
  readonly charCount: number;
}

const SPEAK_OPEN = '<speak>';
const SPEAK_CLOSE = '</speak>';
const encoder = new TextEncoder();

// Fin de phrase : ponctuation finale, éventuellement suivie de guillemets ou parenthèses.
const SENTENCE_END = /[.!?…]["'»”’)\]]*$/u;

const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function escapeXml(text: string): string {
  return text.replaceAll(/[&<>"']/gu, (char) => XML_ESCAPES[char] ?? char);
}

function markTag(localIndex: number): string {
  return `<mark name="w${String(localIndex)}"/>`;
}

/** `<mark name="w` + `"/>` : la marque d'index `i` pèse ce socle + ses chiffres. */
const MARK_FRAME_BYTES = markTag(0).length - 1;

/** Octets ajoutés par l'échappement de chaque caractère réservé (`&` → `&amp;`…). */
const ESCAPE_EXTRA_BYTES: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(XML_ESCAPES).map(([char, entity]) => [char, entity.length - 1]),
);

/** Taille UTF-8 de `escapeXml(text)`, sans allouer de chaîne ni de tampon. */
function escapedByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1 + (ESCAPE_EXTRA_BYTES[char] ?? 0);
    else if (code < 0x8_00) bytes += 2;
    else if (code < 0x1_00_00) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** Mot + taille UTF-8 de sa forme échappée, calculée une seule fois. */
interface Token {
  readonly word: SegmentWord;
  readonly bytes: number;
}

/**
 * Octets ajoutés par `tokens` placés à partir de la position locale `start`
 * (espace séparateur + marque + mot). Pure arithmétique : appelée pour
 * chaque phrase d'un livre entier, dans le processus de l'API (ADR-0009).
 */
function bytesOf(tokens: readonly Token[], start: number): number {
  let bytes = 0;
  for (const [offset, token] of tokens.entries()) {
    const position = start + offset;
    const separator = position === 0 ? 0 : 1;
    bytes += separator + MARK_FRAME_BYTES + String(position).length + token.bytes;
  }
  return bytes;
}

const FRAME_BYTES = encoder.encode(SPEAK_OPEN + SPEAK_CLOSE).length;

/** Mots de toutes les pages, dans l'ordre ; les sauts de ligne de mise en page deviennent des espaces. */
function tokenize(pages: readonly PageText[]): Token[] {
  const tokens: Token[] = [];
  for (const page of pages) {
    for (const raw of page.text.split(/\s+/u)) {
      for (let i = 0; i < raw.length; i += MAX_WORD_LENGTH) {
        const t = raw.slice(i, i + MAX_WORD_LENGTH);
        tokens.push({ word: { t, p: page.pageNumber }, bytes: escapedByteLength(t) });
      }
    }
  }
  return tokens;
}

function splitSentences(tokens: readonly Token[]): Token[][] {
  const sentences: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    current.push(token);
    if (SENTENCE_END.test(token.word.t)) {
      sentences.push(current);
      current = [];
    }
  }
  if (current.length > 0) sentences.push(current);
  return sentences;
}

/** FNV-1a 32 bits : hachage rapide et déterministe (pas un usage de sécurité). */
function fnv1a(text: string): number {
  let hash = 0x81_1c_9d_c5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash;
}

/**
 * Phrase « ancre » : décidé par son **contenu** seul, jamais par sa position.
 * Après une correction, les frontières de segments se recalent sur les mêmes
 * ancres : seuls les segments voisins de la correction changent, et le cache
 * (RNF-26) sert tous les autres.
 */
function isAnchor(sentence: readonly Token[]): boolean {
  return fnv1a(sentence.map((token) => token.word.t).join(' ')) % 2 === 0;
}

function toSegment(index: number, words: readonly SegmentWord[]): SsmlSegment {
  const body = words.map((word, i) => markTag(i) + escapeXml(word.t)).join(' ');
  const charCount = words.reduce((sum, word) => sum + word.t.length, 0) + words.length - 1;
  return { index, ssml: SPEAK_OPEN + body + SPEAK_CLOSE, words, charCount };
}

/**
 * Découpe le texte d'un document en segments SSML synthétisables (ADR-0008,
 * ADR-0010) :
 * - une marque `<mark name="w<i>"/>` avant chaque mot, numérotée **dans le
 *   segment** (deux segments identiques ont le même SSML, donc la même
 *   empreinte de cache) ;
 * - chaque segment tient dans {@link MAX_SSML_BYTES} ;
 * - on coupe entre deux phrases, jamais au milieu, sauf phrase trop longue
 *   pour un segment (coupée entre deux mots) ;
 * - au-delà de {@link SOFT_MIN_SSML_BYTES}, on ferme sur une phrase ancre.
 *
 * Les phrases peuvent franchir une page : la voix ne s'interrompt pas au
 * milieu d'une phrase à chaque changement de page.
 */
export function buildSsmlSegments(pages: readonly PageText[]): readonly SsmlSegment[] {
  const segments: SsmlSegment[] = [];
  let current: SegmentWord[] = [];
  let bytes = FRAME_BYTES;

  const close = (): void => {
    if (current.length === 0) return;
    segments.push(toSegment(segments.length, current));
    current = [];
    bytes = FRAME_BYTES;
  };

  /** Ajoute des mots, en fermant d'abord le segment s'ils ne tiennent plus. */
  const fit = (tokens: readonly Token[]): void => {
    let added = bytesOf(tokens, current.length);
    if (current.length > 0 && bytes + added > MAX_SSML_BYTES) {
      close();
      added = bytesOf(tokens, 0);
    }
    bytes += added;
    for (const token of tokens) current.push(token.word);
  };

  for (const sentence of splitSentences(tokenize(pages))) {
    if (FRAME_BYTES + bytesOf(sentence, 0) <= MAX_SSML_BYTES) {
      fit(sentence);
    } else {
      // Phrase plus longue qu'un segment : coupée entre deux mots.
      for (const token of sentence) fit([token]);
    }
    if (bytes >= SOFT_MIN_SSML_BYTES && isAnchor(sentence)) close();
  }
  close();
  return segments;
}

/** Octets UTF-8 d'un SSML (contrôle de la limite fournisseur). */
export function ssmlByteLength(ssml: string): number {
  return encoder.encode(ssml).length;
}
