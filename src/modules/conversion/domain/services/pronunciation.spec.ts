import { pronounce } from './pronunciation';

/** Formes parlées d'une phrase découpée en mots, comme le segmenteur. */
const spoken = (text: string): readonly string[] => pronounce(text.split(' ')).spoken;

describe('pronounce', () => {
  it('keeps one entry per displayed word, whatever is said', () => {
    const words = 'Cela coûte 2 500 FCFA par mois.'.split(' ');
    const { spoken: said } = pronounce(words);
    expect(said).toHaveLength(words.length);
    expect(said).toEqual(['Cela', 'coûte', '2500', '', 'francs CFA', 'par', 'mois.']);
  });

  describe('grouped numbers', () => {
    it.each([
      ['2 500 FCFA', ['2500', '', 'francs CFA']],
      ['1 250 000 habitants', ['1250000', '', '', 'habitants']],
      ['1.000.000 de', ['1000000', 'de']],
      ['soit 2 500, puis', ['soit', '2500', ',', 'puis']],
      ['coûte 2 500.', ['coûte', '2500', '.']],
    ])('%s', (text, expected) => {
      expect(spoken(text)).toEqual(expected);
    });

    it.each([
      ['1 2 500', ['1', '2', '500']], // groupe de 1 chiffre au milieu : pas un nombre groupé
      ['les 12 1234 cas', ['les', '12', '1234', 'cas']], // groupe de 4 chiffres
      ['1.000 personnes', ['1.000', 'personnes']], // un seul point : ambigu avec une décimale
      ['3,5 %', ['3,5', '%']], // laissé à Polly
    ])('leaves %s alone', (text, expected) => {
      expect(spoken(text)).toEqual(expected);
    });
  });

  describe('dates', () => {
    it.each([
      ['12/10/2026', '12 octobre 2026'],
      ['1/1/2000', '1er janvier 2000'],
      ['29/02/2024', '29 février 2024'],
      ['1/1/2027.', '1er janvier 2027.'],
    ])('%s → %s', (date, expected) => {
      expect(spoken(date)).toEqual([expected]);
    });

    it.each(['31/02/2026', '29/02/2023', '12/13/2026', '00/10/2026'])(
      'leaves the invalid date %s alone',
      (date) => {
        expect(spoken(date)).toEqual([date]);
      },
    );
  });

  describe('amounts', () => {
    it.each([
      ['500 XAF', ['500', 'francs CFA']],
      ['500 F CFA.', ['500', 'francs CFA', '.']],
      ['10 €', ['10', 'euros']],
      ['10 $', ['10', 'dollars']],
      ['en XAF.', ['en', 'francs CFA.']],
    ])('%s', (text, expected) => {
      expect(spoken(text)).toEqual(expected);
    });
  });

  describe('abbreviations', () => {
    it.each([
      ['art. 1108', ['article', '1108']],
      ['(cf. supra)', ['(confer', 'supra)']],
      ['n° 12', ['numéro', '12']],
      ['Mme Ngono', ['Madame', 'Ngono']],
      ['Pr Owona', ['Professeur', 'Owona']],
      ['C. civ., art. 1382', ['Code civil', ',', 'article', '1382']],
      ['C. trav.', ['Code du travail', '']],
      ['C. pén.', ['Code pénal', '']],
      ['op. cit.', ['opere citato', '']],
      ['loc. cit.', ['loco citato', '']],
      ['Cass. civ.', ['Cassation', 'civile']],
      ['préc. obs.', ['précité', 'observations']],
    ])('%s', (text, expected) => {
      expect(spoken(text)).toEqual(expected);
    });

    it.each([
      ['p. 12', ['page', '12']],
      ['pp. 12-15', ['pages', '12-15']],
      ['al. 2', ['alinéa', '2']],
      ['M. Fouda', ['Monsieur', 'Fouda']],
      ['t. II', ['tome', '2']],
    ])('expands %s when the next word settles it', (text, expected) => {
      expect(spoken(text)).toEqual(expected);
    });

    it.each([
      ['p. suivante', ['p.', 'suivante']],
      ['al. premier', ['al.', 'premier']],
      ['M. et', ['M.', 'et']],
      ['et al.', ['et', 'al.']],
      ['t. ex', ['t.', 'ex']],
    ])('leaves %s alone when in doubt', (text, expected) => {
      expect(spoken(text)).toEqual(expected);
    });

    it('marks the abbreviations, so that their dot does not end a sentence', () => {
      const { abbreviation } = pronounce('voir art. 3 et C. civ. puis M. Fouda.'.split(' '));
      expect(abbreviation).toEqual([false, true, false, false, true, true, false, true, false]);
    });
  });

  describe('acronyms', () => {
    it.each([
      ['TVA', 'T V A'],
      ['AUSCGIE', 'A U S C G I E'],
      ['OHADA', 'Ohada'],
      ["l'OHADA", "l'Ohada"],
      ['(CEMAC)', '(Cemac)'],
      ['JO', 'Journal officiel'],
      ['TTC.', 'T T C.'],
      ['ONU', 'ONU'], // hors liste : laissé à Polly
    ])('%s → %s', (acronym, expected) => {
      expect(spoken(acronym)).toEqual([expected]);
    });
  });

  describe('Roman numerals', () => {
    it.each([
      ['Chapitre IV', ['Chapitre', '4']],
      ['titre XII :', ['titre', '12', ':']],
      ['XXe siècle', ['20e', 'siècle']],
      ['XXIème siècle', ['21e', 'siècle']],
      ['Ier siècle', ['1er', 'siècle']],
    ])('%s', (text, expected) => {
      expect(spoken(text)).toEqual(expected);
    });

    it.each([
      ['Louis XIV', ['Louis', 'XIV']], // pas de mot-clé
      ['chapitre VX', ['chapitre', 'VX']], // romain mal formé
      ['CIV', ['CIV']],
    ])('leaves %s alone', (text, expected) => {
      expect(spoken(text)).toEqual(expected);
    });
  });

  it('turns a table separator put back by the user into a pause', () => {
    expect(spoken('Paiement | 2 ans | 2272')).toEqual(['Paiement', ',', '2', 'ans', ',', '2272']);
  });
});
