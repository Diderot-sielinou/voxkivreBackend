/**
 * Fabrique de PDF de test **valides** (xref exacte), sans dépendance :
 * chaque page reçoit des lignes de texte (police Helvetica, encodage
 * WinAnsi → accents français) ou rien du tout (`null`, simule un scan).
 */
export function buildPdf(pages: readonly (readonly string[] | null)[]): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);

  const catalog = add('');
  const pagesObj = add('');
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const kids: number[] = [];
  for (const lines of pages) {
    const operators = (lines ?? []).map((l) => '(' + escapePdfString(l) + ') Tj T*').join(' ');
    const content = operators === '' ? '' : `BT /F1 12 Tf 72 770 Td 16 TL ${operators} ET`;
    const stream = add(
      `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${String(pagesObj)} 0 R /MediaBox [0 0 595 842] ` +
          `/Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(stream)} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${String(pagesObj)} 0 R >>`;
  const kidRefs = kids.map((k) => String(k) + ' 0 R').join(' ');
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kidRefs}] /Count ${String(kids.length)} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root ${String(catalog)} 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function escapePdfString(s: string): string {
  return s
    .replaceAll('\\', '\\\\')
    .replaceAll('(', String.raw`\(`)
    .replaceAll(')', String.raw`\)`);
}
