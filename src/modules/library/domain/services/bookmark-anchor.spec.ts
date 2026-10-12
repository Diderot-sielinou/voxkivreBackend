import { excerptAt, locateAnchor, pageWords } from './bookmark-anchor';

const PAGE =
  'Le contrat est un accord de volontés destiné à créer des obligations. Sa validité suppose le consentement.';

describe('excerptAt', () => {
  it('keeps up to 6 words from the anchor', () => {
    expect(excerptAt(pageWords(PAGE), 3)).toBe('un accord de volontés destiné à');
    expect(excerptAt(pageWords(PAGE), 15)).toBe('le consentement.');
  });

  it('never goes over 120 characters', () => {
    const long = pageWords(`${'x'.repeat(70)} ${'y'.repeat(70)}`);
    expect(excerptAt(long, 0)).toBe('x'.repeat(70));
  });
});

describe('locateAnchor', () => {
  const words = pageWords(PAGE);
  const anchor = { wordIndex: 12, excerpt: excerptAt(words, 12) }; // « Sa validité … »

  it('keeps the index when the text did not change', () => {
    expect(locateAnchor(words, anchor)).toEqual({ wordIndex: 12, needsReview: false });
  });

  it('finds the anchor again by its excerpt after text was inserted before it', () => {
    // Une ligne de tableau réintégrée en tête de page décale tous les index.
    const edited = pageWords(`Paiement , 2 ans , 2272 ${PAGE}`);
    expect(locateAnchor(edited, anchor)).toEqual({ wordIndex: 18, needsReview: false });
  });

  it('ignores case, accents and edge punctuation when comparing', () => {
    const edited = pageWords(PAGE.replace('Sa validité', '«SA VALIDITE'));
    expect(locateAnchor(edited, anchor)).toEqual({ wordIndex: 12, needsReview: false });
  });

  it('picks the occurrence nearest to the old index', () => {
    const repeated = pageWords(`Sa validité suppose le consentement. ${PAGE}`);
    // Deux occurrences : 0 et 17 ; l'ancien index (12) est plus près de 17.
    expect(locateAnchor(repeated, anchor)).toEqual({ wordIndex: 17, needsReview: false });
  });

  it('places it at the nearest word and asks for a review when the excerpt is gone, never fails', () => {
    const rewritten = pageWords('Texte entièrement réécrit par l’utilisateur.');
    expect(locateAnchor(rewritten, anchor)).toEqual({ wordIndex: 4, needsReview: true });
    expect(locateAnchor([], anchor)).toEqual({ wordIndex: 0, needsReview: true });
  });
});
