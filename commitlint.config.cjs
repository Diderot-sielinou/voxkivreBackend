/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scope obligatoire (ex: feat(conversion): ..., fix(identity): ...).
    // Le scope = nom du module hexagonal touché, ou `shared`, `deps`, `ci`, `docs`.
    'scope-empty': [2, 'never'],

    // Subject conventions
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],

    // Header length : tolère 100 cars (les scopes hexagonaux peuvent être verbeux)
    'header-max-length': [2, 'always', 100],

    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'revert',
      ],
    ],
  },
};
