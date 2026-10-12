import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Injectable } from '@nestjs/common';

import { type OcrPort } from '../../domain/ports/ocr.port';
import { type OcrPage } from '../../domain/services/ocr';

import { parseTesseractTsv } from './tesseract-tsv';

const run = promisify(execFile);

/** Résolution du rendu : celle du banc d'essai (ADR-0024). */
const RENDER_DPI = '200';
/** Délai maximal par page : au-delà, Tesseract est tué et le lot réessayé. */
const PAGE_TIMEOUT_MS = 60_000;
/** Sortie TSV d'une page dense : quelques centaines de Ko. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** `pdftoppm` nomme `page-7.pgm`, `page-07.pgm` ou `page-007.pgm` selon le nombre de pages. */
const RENDERED_PAGE = /^page-(\d+)\.pgm$/u;
/** Code de sortie de poppler quand le PDF ne s'ouvre pas (fichier, pas panne). */
const POPPLER_OPEN_ERROR = 1;

/**
 * OCR par Tesseract 5 (`fra`) et poppler, programmes du système (ADR-0024) :
 *
 * 1. `pdftoppm -r 200 -gray` rend les pages du lot en **PGM brut** (le PNG
 *    coûtait plus que l'OCR) — tout codage d'image passe (JPEG, JBIG2, CCITT) ;
 * 2. `tesseract … tsv`, une page à la fois, `OMP_THREAD_LIMIT=1` et `nice` :
 *    un seul cœur, l'API garde l'autre.
 *
 * Processus enfants lancés sans shell, arguments fixes (aucune donnée
 * utilisateur dans la ligne de commande). Dossier temporaire par lot,
 * supprimé en `finally`.
 */
@Injectable()
export class TesseractOcrAdapter implements OcrPort {
  async recognizePages(
    pdf: Uint8Array,
    firstPage: number,
    lastPage: number,
  ): Promise<readonly OcrPage[] | null> {
    const dir = await mkdtemp(join(tmpdir(), 'voxlivre-ocr-'));
    try {
      // Invariant : `dir` vient de `mkdtemp` (dossier temporaire à nous), nom fixe.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await writeFile(join(dir, 'source.pdf'), pdf);
      if (!(await renderPages(dir, firstPage, lastPage))) return null;

      const rendered = await renderedPages(dir);
      const pages: OcrPage[] = [];
      for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
        const file = rendered.get(pageNumber);
        if (file === undefined) throw new Error(`Page ${String(pageNumber)} was not rendered`);
        const { lines, confidence } = parseTesseractTsv(await recognize(join(dir, file)));
        pages.push({ pageNumber, lines, confidence });
      }
      return pages;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** `false` si poppler ne peut pas ouvrir le PDF (définitif). */
async function renderPages(dir: string, firstPage: number, lastPage: number): Promise<boolean> {
  try {
    await run(
      'pdftoppm',
      [
        '-r',
        RENDER_DPI,
        '-gray',
        '-f',
        String(firstPage),
        '-l',
        String(lastPage),
        'source.pdf',
        'page',
      ],
      {
        cwd: dir,
        timeout: PAGE_TIMEOUT_MS * (lastPage - firstPage + 1),
        maxBuffer: MAX_OUTPUT_BYTES,
      },
    );
    return true;
  } catch (error) {
    if (isExitCode(error, POPPLER_OPEN_ERROR)) return false;
    throw error;
  }
}

async function renderedPages(dir: string): Promise<ReadonlyMap<number, string>> {
  const pages = new Map<number, string>();
  // Invariant : `dir` vient de `mkdtemp`, jamais d'une donnée utilisateur.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const file of await readdir(dir)) {
    const match = RENDERED_PAGE.exec(file);
    if (match !== null) pages.set(Number(match[1]), file);
  }
  return pages;
}

async function recognize(image: string): Promise<string> {
  const { stdout } = await run(
    'nice',
    ['-n', '10', 'tesseract', image, '-', '-l', 'fra', '--psm', '3', 'tsv'],
    {
      // Un seul thread : le parallélisme d'OpenMP prendrait le cœur de l'API.
      env: { ...process.env, OMP_THREAD_LIMIT: '1' },
      timeout: PAGE_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: 'utf8',
    },
  );
  return stdout;
}

function isExitCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
