/**
 * Pré-traitement de la prononciation (RF-07, ADR-0026). Pour chaque mot
 * affiché, sa **forme parlée**, écrite en clair après la marque du mot dans
 * le SSML (jamais `<sub>` : chez Polly, les marques qui suivent dérivent).
 * Une forme parlée peut être vide : le mot est absorbé par le précédent
 * (`2 500` → « 2500 », « »), sa marque reste à sa place.
 *
 * Règles déterministes, dans l'ordre ; en cas de doute, on ne touche à rien
 * (faux négatif préféré).
 */

export interface Pronunciation {
  /** Forme parlée de chaque mot, même longueur que l'entrée. */
  readonly spoken: readonly string[];
  /** Le mot est une abréviation reconnue : son point ne termine pas une phrase. */
  readonly abbreviation: readonly boolean[];
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/** Mots après lesquels un chiffre romain est un numéro (`Chapitre IV`, `t. II`). */
const ROMAN_KEYWORDS = new Set(['chapitre', 'titre', 'livre', 'tome', 'partie', 'section', 't']);

/** Abréviations sans ambiguïté (règle 5). */
const SAFE_ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ['art.', 'article'],
  ['chap.', 'chapitre'],
  ['cf.', 'confer'],
  ['n°', 'numéro'],
  ['Mme', 'Madame'],
  ['Mlle', 'Mademoiselle'],
  ['Dr', 'Docteur'],
  ['Pr', 'Professeur'],
  ['éd.', 'édition'],
  ['vol.', 'volume'],
  ['ibid.', 'ibidem'],
  ['obs.', 'observations'],
  ['préc.', 'précité'],
  ['suiv.', 'suivants'],
  ['Cass.', 'Cassation'],
  ['civ.', 'civile'],
]);

/** Abréviations en deux mots (règle 5) : la forme parlée va sur le premier. */
const TWO_WORD_ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ['op. cit.', 'opere citato'],
  ['loc. cit.', 'loco citato'],
  ['C. civ.', 'Code civil'],
  ['C. trav.', 'Code du travail'],
  ['C. pén.', 'Code pénal'],
]);

/** Sigles épelés (règle 7). */
const SPELLED_ACRONYMS = new Set([
  'TVA',
  'PME',
  'PIB',
  'SARL',
  'SAS',
  'GIE',
  'DGI',
  'IRPP',
  'RCCM',
  'NIU',
  'HT',
  'TTC',
  'SNCF',
  'BTP',
  'CCJA',
  'AUDCG',
  'AUSCGIE',
]);

/** Sigles lus comme un mot : écrits en casse de mot (`Ohada`). */
const WORD_ACRONYMS = new Set(['OHADA', 'CEMAC', 'BEAC', 'UEMOA', 'OAPI', 'CNPS']);

const EXPANDED_ACRONYMS: ReadonlyMap<string, string> = new Map([['JO', 'Journal officiel']]);

const CURRENCIES: ReadonlyMap<string, string> = new Map([
  ['FCFA', 'francs CFA'],
  ['XAF', 'francs CFA'],
  ['€', 'euros'],
  ['$', 'dollars'],
]);

const LEADING_MARKS = new Set(['«', '“', '"', '(', '[']);
const TRAILING_MARKS = new Set(['»', '”', '"', ')', ']', ',', ';', ':', '!', '?', '…']);
/** Élision (`l'`, `d'`, `qu'`…) devant un sigle : `l'OHADA`. */
const ELISION = /^(?:[cdjlmnst]|qu)['’]/iu;
const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u;
const FIRST_GROUP = /^\d{1,3}$/u;
const NEXT_GROUP = /^\d{3}$/u;
const ROMAN = /^[IVXLCDM]+$/u;
const ROMAN_ORDINAL = /^([IVXLCDM]+)(er|re|e|ème|eme)$/u;
const STARTS_WITH_DIGIT = /^\d/u;
const STARTS_WITH_UPPERCASE = /^\p{Lu}/u;

const ROMAN_VALUES: ReadonlyMap<string, number> = new Map([
  ['I', 1],
  ['V', 5],
  ['X', 10],
  ['L', 50],
  ['C', 100],
  ['D', 500],
  ['M', 1000],
]);

/** Ponctuation autour du mot : `(art.` → `(` + `art.` ; `FCFA,` → `FCFA` + `,`. */
interface WordParts {
  readonly lead: string;
  readonly core: string;
  readonly trail: string;
}

function partsOf(word: string): WordParts {
  let start = 0;
  while (start < word.length && LEADING_MARKS.has(word[start])) start += 1;
  let end = word.length;
  while (end > start && TRAILING_MARKS.has(word[end - 1])) end -= 1;
  return { lead: word.slice(0, start), core: word.slice(start, end), trail: word.slice(end) };
}

/** `1.000.000` : au moins deux points, groupes de 3 chiffres (`1.000` seul est ambigu). */
function isDottedNumber(core: string): boolean {
  const groups = core.split('.');
  return (
    groups.length >= 3 &&
    FIRST_GROUP.test(groups[0]) &&
    groups.slice(1).every((group) => NEXT_GROUP.test(group))
  );
}

/** Le mot sans sa ponctuation ni son point final, en minuscules. */
function bare(word: string | undefined): string {
  if (word === undefined) return '';
  return partsOf(word).core.replace(/\.$/u, '').toLowerCase();
}

function romanValue(roman: string): number | null {
  let total = 0;
  for (let i = 0; i < roman.length; i += 1) {
    const value = ROMAN_VALUES.get(roman[i]) ?? 0;
    const next = ROMAN_VALUES.get(roman[i + 1] ?? '') ?? 0;
    total += value < next ? -value : value;
  }
  return total > 0 && toRoman(total) === roman ? total : null;
}

function toRoman(value: number): string {
  const symbols: readonly (readonly [string, number])[] = [
    ['M', 1000],
    ['CM', 900],
    ['D', 500],
    ['CD', 400],
    ['C', 100],
    ['XC', 90],
    ['L', 50],
    ['XL', 40],
    ['X', 10],
    ['IX', 9],
    ['V', 5],
    ['IV', 4],
    ['I', 1],
  ];
  let rest = value;
  let out = '';
  for (const [symbol, amount] of symbols) {
    while (rest >= amount) {
      out += symbol;
      rest -= amount;
    }
  }
  return out;
}

function frenchDate(core: string): string | null {
  const match = DATE.exec(core);
  if (match === null) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${day === 1 ? '1er' : String(day)} ${MONTHS[month - 1]} ${String(year)}`;
}

/** Le cœur du mot sans son point final (`500.` en fin de phrase). */
function withoutFinalDot(core: string): string {
  return core.endsWith('.') ? core.slice(0, -1) : core;
}

/**
 * Nombre groupé à partir de `index` (groupes de 3 chiffres exactement
 * après le premier) : nombre de mots pris, ou 0. Pas après un autre petit
 * nombre (`1 2 500` reste tel quel).
 */
function groupedNumberLength(parts: readonly WordParts[], index: number): number {
  const first = parts[index];
  if (first.trail !== '' || !FIRST_GROUP.test(first.core)) return 0;
  const previous = parts.at(index - 1);
  if (index > 0 && previous?.trail === '' && FIRST_GROUP.test(previous.core)) return 0;
  let length = 1;
  while (index + length < parts.length) {
    const next = parts[index + length];
    if (next.lead !== '' || !NEXT_GROUP.test(withoutFinalDot(next.core))) break;
    length += 1;
    // Ponctuation ou point final : le nombre s'arrête là.
    if (next.trail !== '' || next.core.endsWith('.')) break;
  }
  return length > 1 ? length : 0;
}

/** État partagé par les règles : chacune dit combien de mots elle a pris. */
interface Context {
  readonly words: readonly string[];
  readonly parts: readonly WordParts[];
  readonly spoken: string[];
  readonly abbreviation: boolean[];
}

type Rule = (context: Context, index: number) => number;

/** Forme parlée du mot, ponctuation d'origine gardée autour. */
function say(context: Context, index: number, text: string): void {
  const { lead, trail } = context.parts[index];
  context.spoken[index] = `${lead}${text}${trail}`;
}

/**
 * Forme parlée d'un mot reconnu **sans** son point final (`TTC.`,
 * `1/1/2027.` en fin de phrase) : le point est rendu à la fin.
 */
function sayStem(context: Context, index: number, text: string): void {
  const dot = context.parts[index].core.endsWith('.') ? '.' : '';
  say(context, index, `${text}${dot}`);
}

/** Le cœur du mot sans point final : ce que reconnaissent les règles hors abréviations. */
function stemAt(context: Context, index: number): string {
  return withoutFinalDot(context.parts[index]?.core ?? '');
}

/**
 * Mot absorbé par le précédent : il ne reste que sa ponctuation finale,
 * point de fin de phrase compris (`500 F CFA.`) ; le point d'une
 * abréviation absorbée (`op. cit.`) n'est pas gardé.
 */
function absorb(context: Context, index: number, keepFinalDot = true): void {
  const { core, trail } = context.parts[index];
  const dot = keepFinalDot && core.endsWith('.') ? '.' : '';
  context.spoken[index] = `${dot}${trail}`;
}

const tableSeparator: Rule = (context, i) => {
  if (context.parts[i].core !== '|') return 0;
  context.spoken[i] = ','; // une pause, jamais lu
  return 1;
};

const romanNumeral: Rule = (context, i) => {
  const roman = romanAfterKeyword(
    stemAt(context, i),
    bare(context.words[i - 1]),
    bare(context.words[i + 1]),
  );
  if (roman === null) return 0;
  sayStem(context, i, roman);
  return 1;
};

const date: Rule = (context, i) => {
  const spoken = frenchDate(stemAt(context, i));
  if (spoken === null) return 0;
  sayStem(context, i, spoken);
  return 1;
};

const groupedNumber: Rule = (context, i) => {
  const { core } = context.parts[i];
  if (isDottedNumber(core)) {
    say(context, i, core.replaceAll('.', ''));
    return 1;
  }
  const length = groupedNumberLength(context.parts, i);
  if (length === 0) return 0;
  const digits = context.parts.slice(i, i + length).map((part) => withoutFinalDot(part.core));
  say(context, i, digits.join(''));
  for (let j = i + 1; j < i + length; j += 1) absorb(context, j);
  return length;
};

const amount: Rule = (context, i) => {
  const { core } = context.parts[i];
  if (core === 'F' && bare(context.words[i + 1]) === 'cfa') {
    say(context, i, 'francs CFA');
    absorb(context, i + 1);
    return 2;
  }
  const currency = CURRENCIES.get(withoutFinalDot(core));
  if (currency === undefined) return 0;
  sayStem(context, i, currency);
  return 1;
};

const safeAbbreviation: Rule = (context, i) => {
  const { core } = context.parts[i];
  const pair = TWO_WORD_ABBREVIATIONS.get(`${core} ${context.parts[i + 1]?.core ?? ''}`);
  if (pair !== undefined) {
    say(context, i, pair);
    absorb(context, i + 1, false);
    context.abbreviation[i] = true;
    context.abbreviation[i + 1] = true;
    return 2;
  }
  const single = SAFE_ABBREVIATIONS.get(core);
  if (single === undefined) return 0;
  say(context, i, single);
  context.abbreviation[i] = core.endsWith('.');
  return 1;
};

const ambiguousAbbreviation: Rule = (context, i) => {
  const spoken = contextualAbbreviation(context.parts[i].core, context.parts[i + 1]?.core ?? '');
  if (spoken === null) return 0;
  say(context, i, spoken);
  context.abbreviation[i] = true;
  return 1;
};

const acronym: Rule = (context, i) => {
  const spoken = acronymSpoken(stemAt(context, i));
  if (spoken === null) return 0;
  sayStem(context, i, spoken);
  return 1;
};

/** ADR-0026 §3, dans l'ordre : la première règle qui s'applique prend le mot. */
const RULES: readonly Rule[] = [
  tableSeparator,
  romanNumeral,
  date,
  groupedNumber,
  amount,
  safeAbbreviation,
  ambiguousAbbreviation,
  acronym,
];

/**
 * Formes parlées d'une suite de mots affichés (tout un document : le
 * contexte d'un mot est son voisin).
 */
export function pronounce(words: readonly string[]): Pronunciation {
  const context: Context = {
    words,
    parts: words.map((word) => partsOf(word)),
    spoken: [...words],
    abbreviation: words.map(() => false),
  };
  let i = 0;
  while (i < words.length) {
    let taken = 0;
    for (const rule of RULES) {
      taken = rule(context, i);
      if (taken > 0) break;
    }
    i += Math.max(1, taken);
  }
  return { spoken: context.spoken, abbreviation: context.abbreviation };
}

function romanAfterKeyword(core: string, previous: string, following: string): string | null {
  if (ROMAN.test(core) && ROMAN_KEYWORDS.has(previous)) {
    const value = romanValue(core);
    return value === null ? null : String(value);
  }
  const ordinal = ROMAN_ORDINAL.exec(core);
  if (ordinal !== null && following.startsWith('siècle')) {
    const value = romanValue(ordinal[1]);
    if (value === null) return null;
    return value === 1 ? '1er' : `${String(value)}e`;
  }
  return null;
}

function contextualAbbreviation(core: string, next: string): string | null {
  const nextIsNumber = STARTS_WITH_DIGIT.test(next);
  if (core === 'p.' && nextIsNumber) return 'page';
  if (core === 'pp.' && nextIsNumber) return 'pages';
  if (core === 'al.' && nextIsNumber) return 'alinéa';
  if (core === 't.' && (nextIsNumber || (ROMAN.test(next) && romanValue(next) !== null))) {
    return 'tome';
  }
  if (core === 'M.' && STARTS_WITH_UPPERCASE.test(next) && next.length > 1) return 'Monsieur';
  return null;
}

function acronymSpoken(core: string): string | null {
  const elision = ELISION.exec(core)?.[0] ?? '';
  const acronym = core.slice(elision.length);
  // Lettres séparées par un espace : « T V A » (sigles ASCII de la liste).
  if (SPELLED_ACRONYMS.has(acronym)) return `${elision}${acronym.replaceAll(/(?<=.)(?=.)/gu, ' ')}`;
  if (WORD_ACRONYMS.has(acronym)) {
    return `${elision}${acronym[0]}${acronym.slice(1).toLowerCase()}`;
  }
  const expanded = EXPANDED_ACRONYMS.get(acronym);
  return expanded === undefined ? null : `${elision}${expanded}`;
}
