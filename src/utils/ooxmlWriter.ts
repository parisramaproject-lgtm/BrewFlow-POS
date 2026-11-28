/**
 * Zero-dependency OOXML (.xlsx) workbook generator using standard PKZIP (STORE method 0).
 * Replaces vulnerable `xlsx@0.18.5` with zero third-party attack surface, built-in XML
 * escaping, and spreadsheet formula-injection neutralization (=, +, -, @ prefixes).
 */

export interface SimpleWorksheetInput {
  name: string;
  rows: Array<Record<string, string | number>>;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * Neutralizes spreadsheet formula injection (CSV/Excel DDE) by prefixing untrusted
 * strings beginning with =, +, -, @, tab, or CR with a leading apostrophe.
 */
export function sanitizeSpreadsheetText(raw: string): string {
  if (/^[=+\-@\t\r]/.test(raw)) {
    return `'${raw}`;
  }
  return raw;
}

function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function sanitizeSheetName(name: string, index: number, used: Set<string>): string {
  const cleaned = (name || `Sheet${index + 1}`)
    .replace(/[\\/*?:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || `Sheet${index + 1}`;
  let candidate = cleaned;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${counter}`;
    candidate = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function buildWorksheetXml(rows: Array<Record<string, string | number>>): string {
  const safeRows = rows.length > 0 ? rows : [{ Info: 'Tidak ada data pada periode ini' }];
  const headers = Object.keys(safeRows[0]);

  // Compute column widths
  const colXml = headers
    .map((header, idx) => {
      let maxLen = header.length;
      for (const row of safeRows) {
        const val = row[header];
        const len = val === null || val === undefined ? 0 : String(val).length;
        if (len > maxLen) maxLen = len;
      }
      const width = Math.min(Math.max(maxLen + 3, 12), 46);
      return `<col min="${idx + 1}" max="${idx + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const xmlRows: string[] = [];

  // Header row (style 1 = bold header)
  const headerCells = headers
    .map((header, colIdx) => {
      const ref = `${columnIndexToLetter(colIdx)}1`;
      return `<c r="${ref}" t="inlineStr" s="1"><is><t>${escapeXml(header)}</t></is></c>`;
    })
    .join('');
  xmlRows.push(`<row r="1">${headerCells}</row>`);

  // Data rows
  safeRows.forEach((row, rowIdx) => {
    const excelRowNum = rowIdx + 2;
    const cells = headers
      .map((header, colIdx) => {
        const ref = `${columnIndexToLetter(colIdx)}${excelRowNum}`;
        const rawVal = row[header];
        if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
          return `<c r="${ref}"><v>${rawVal}</v></c>`;
        }
        const safeText = sanitizeSpreadsheetText(rawVal === null || rawVal === undefined ? '' : String(rawVal));
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(safeText)}</t></is></c>`;
      })
      .join('');
    xmlRows.push(`<row r="${excelRowNum}">${cells}</row>`);
  });

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<cols>${colXml}</cols>` +
    `<sheetData>${xmlRows.join('')}</sheetData>` +
    '</worksheet>'
  );
}

interface ZipEntryInput {
  name: string;
  content: Uint8Array;
}

function buildStoredZip(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.content;
    const crc = crc32(data);

    // Local File Header (30 bytes + name)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // local header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // method 0 = STORE
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    // Central Directory Header (46 bytes + name)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // method 0 = STORE
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true); // local header offset
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const output = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of localParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(eocd, cursor);
  return output;
}

export function buildXlsxBytes(sheets: SimpleWorksheetInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const usedNames = new Set<string>();
  const normalizedSheets = (sheets.length > 0 ? sheets : [{ name: 'Laporan', rows: [] }]).map(
    (sheet, idx) => ({
      id: idx + 1,
      name: sanitizeSheetName(sheet.name, idx, usedNames),
      rows: sheet.rows,
    })
  );

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    normalizedSheets
      .map(
        (s) =>
          `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('') +
    '</Types>';

  const rootRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    normalizedSheets
      .map((s) => `<sheet name="${escapeXml(s.name)}" sheetId="${s.id}" r:id="rId${s.id}"/>`)
      .join('') +
    '</sheets></workbook>';

  const workbookRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    normalizedSheets
      .map(
        (s) =>
          `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`
      )
      .join('') +
    `<Relationship Id="rId${normalizedSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '</styleSheet>';

  const entries: ZipEntryInput[] = [
    { name: '[Content_Types].xml', content: encoder.encode(contentTypesXml) },
    { name: '_rels/.rels', content: encoder.encode(rootRelsXml) },
    { name: 'xl/workbook.xml', content: encoder.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', content: encoder.encode(workbookRelsXml) },
    { name: 'xl/styles.xml', content: encoder.encode(stylesXml) },
    ...normalizedSheets.map((s) => ({
      name: `xl/worksheets/sheet${s.id}.xml`,
      content: encoder.encode(buildWorksheetXml(s.rows)),
    })),
  ];

  return buildStoredZip(entries);
}
