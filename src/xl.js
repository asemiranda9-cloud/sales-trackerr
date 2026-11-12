'use strict';
// Excel/CSV engine. Writes real .xlsx (formatting, formulas, filters, frozen header, dropdowns); reads .xlsx and .csv.
const JSZip = require('jszip');
const uerr = (m) => Object.assign(new Error(m), { userMessage: true });
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const esc = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
// style ids
const S = { normal: 0, header: 1, money: 2, int: 3, moneyBold: 4, bold: 5, title: 6, note: 7, input: 8, moneyInput: 9, cell: 10 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="166" formatCode="&quot;₱&quot;#,##0.00"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF1F4E79"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF8DC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="166" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="166" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
function sheetXml(sh, first) {
  const rows = sh.rows, hr = sh.headerRow || 1; let maxCol = 0; rows.forEach((r) => { maxCol = Math.max(maxCol, r.length); });
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  x += `<dimension ref="A1:${colName(Math.max(0, maxCol - 1))}${Math.max(1, rows.length)}"/><sheetViews><sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ''}>`;
  if (sh.freeze !== false && rows.length >= hr) x += `<pane ySplit="${hr}" topLeftCell="A${hr + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${hr + 1}" sqref="A${hr + 1}"/>`;
  x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
  if (sh.widths) x += '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  x += '<sheetData>';
  const grid = sh.grid !== false;
  rows.forEach((r, ri) => {
    const inGrid = grid && ri + 1 >= hr && r.length > 0, last = r.length;
    x += `<row r="${ri + 1}"${ri + 1 === hr && sh.freeze !== false ? ' ht="30" customHeight="1"' : ''}>`;
    for (let ci = 0; ci < last; ci++) {
      const c = r[ci];
      if (c === null || c === undefined || c === '') { if (inGrid) x += `<c r="${colName(ci) + (ri + 1)}" s="${S.cell}"/>`; continue; }
      const ref = colName(ci) + (ri + 1), o = typeof c === 'object' ? c : { v: c }, s = o.s ? ` s="${o.s}"` : (inGrid ? ` s="${S.cell}"` : '');
      if (typeof o.v === 'string' && o.v === '' && o.f === undefined) { x += `<c r="${ref}"${s}/>`; continue; }
      if (o.f !== undefined) x += `<c r="${ref}"${s}><f>${esc(o.f)}</f>${typeof o.v === 'number' ? `<v>${o.v}</v>` : ''}</c>`;
      else if (typeof o.v === 'number') x += `<c r="${ref}"${s}><v>${Number.isFinite(o.v) ? o.v : 0}</v></c>`;
      else x += `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
    }
    x += '</row>';
  });
  x += '</sheetData>';
  if (sh.filter && rows.length > hr) x += `<autoFilter ref="A${hr}:${colName(maxCol - 1)}${sh.filterEnd || rows.length}"/>`;
  if (sh.validations && sh.validations.length) x += `<dataValidations count="${sh.validations.length}">` + sh.validations.map((v) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Invalid value" error="Choose a value from the list." sqref="${v.sqref}"><formula1>${esc(v.list)}</formula1></dataValidation>`).join('') + '</dataValidations>';
  return x + '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
}
async function writeXlsx(sheets) {
  const z = new JSZip(); const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  z.file('[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
  z.file('_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  const names = []; sheets.forEach((s, i) => { const hr = s.headerRow || 1; if (s.filter && s.rows.length > hr) names.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!$A$${hr}:$${colName(Math.max(...s.rows.map((r) => r.length)) - 1)}$${s.filterEnd || s.rows.length}</definedName>`); });
  z.file('xl/workbook.xml', X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' + (names.length ? `<definedNames>${names.join('')}</definedNames>` : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  z.file('xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file('xl/styles.xml', STYLES); sheets.forEach((s, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, i === 0)));
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
// ---------- readers
const colIndex = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const tText = (xml) => { let s = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) s += unesc(m[1]); return s; };
const isDateFmt = (id, code) => ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) || (code && /[ymd]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')));
async function readXlsx(buf, wanted) {
  let z; try { z = await JSZip.loadAsync(buf); } catch { throw uerr('This file is not a valid .xlsx workbook.'); }
  let total = 0; z.forEach((p, f) => { total += (f._data && f._data.uncompressedSize) || 0; }); if (total > 300 * 1024 * 1024) throw uerr('The workbook is too large to read safely.');
  const get = async (p) => { const f = z.file(p); return f ? f.async('string') : null; };
  const wb = await get('xl/workbook.xml'); if (!wb) throw uerr('This file is not a valid .xlsx workbook.');
  const rels = (await get('xl/_rels/workbook.xml.rels')) || '';
  const sheets = [...wb.matchAll(/<sheet\b[^>]*?>/g)].map((m) => ({ name: unesc((/name="([^"]*)"/.exec(m[0]) || [])[1] || ''), rid: (/r:id="([^"]*)"/.exec(m[0]) || [])[1] }));
  const pick = (wanted && sheets.find((s) => s.name === wanted)) || sheets.find((s) => /^(sales|import|data)$/i.test(s.name)) || sheets[0]; if (!pick) throw uerr('The workbook has no worksheets.');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*?>/g)].map((m) => m[0]).find((r) => (/Id="([^"]*)"/.exec(r) || [])[1] === pick.rid);
  let target = rel && (/Target="([^"]*)"/.exec(rel) || [])[1]; if (!target) throw uerr('Could not locate the worksheet.');
  target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  const sx = await get(target); if (!sx) throw uerr('Could not read the worksheet.');
  const shared = []; const ss = await get('xl/sharedStrings.xml'); if (ss) for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(tText(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));
  const dateXf = []; const st = await get('xl/styles.xml');
  if (st) { const custom = {}; for (const m of st.matchAll(/<numFmt\b[^>]*?>/g)) { const id = /numFmtId="(\d+)"/.exec(m[0]), c = /formatCode="([^"]*)"/.exec(m[0]); if (id && c) custom[id[1]] = unesc(c[1]); }
    const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st); if (cx) for (const m of cx[1].matchAll(/<xf\b[^>]*?>/g)) { const id = +((/numFmtId="(\d+)"/.exec(m[0]) || [])[1] || 0); dateXf.push(!!isDateFmt(id, custom[id])); } }
  const out = [];
  for (const rm of sx.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rn = +((/\br="(\d+)"/.exec(rm[1]) || [])[1] || out.length + 1), arr = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1], inner = cm[2] || '', ref = (/\br="([A-Z]+\d+)"/.exec(a) || [])[1]; if (!ref) continue;
      const t = (/\bt="(\w+)"/.exec(a) || [])[1], si = +((/\bs="(\d+)"/.exec(a) || [])[1] || 0), v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1]; let val = null;
      if (t === 's') val = shared[+v] ?? ''; else if (t === 'inlineStr') val = tText(inner); else if (t === 'str') val = v === undefined ? '' : unesc(v);
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE'; else if (t === 'e') val = '#ERROR';
      else if (v !== undefined && v !== '') { val = Number(v); if (dateXf[si] && Number.isFinite(val)) val = new Date(Math.round((val - 25569) * 86400000)).toISOString().slice(0, 10); }
      arr[colIndex(ref)] = val;
    }
    while (out.length < rn - 1) out.push([]); out.push(Array.from(arr, (x) => (x === undefined ? null : x)));
  }
  return out;
}
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const first = text.split(/\r?\n/, 1)[0], delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch; }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map((c) => (c === '' ? null : c)));
}
async function readTable(buf, filename = '', sheet) {
  if (!buf || !buf.length) throw uerr('The file is empty.');
  if (buf[0] === 0x50 && buf[1] === 0x4B) return readXlsx(buf, sheet);
  if (buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0) throw uerr('Old .xls files are not supported yet. In Excel use File > Save As > .xlsx (or .csv) and import that.');
  const ext = (filename.split('.').pop() || '').toLowerCase(); if (!['csv', 'txt', 'tsv'].includes(ext)) throw uerr('Unsupported file type. Use .xlsx or .csv.');
  if (buf.includes(0)) throw uerr('This does not look like a valid Excel or CSV file.'); return parseCsv(buf.toString('utf8'));
}
// names of the worksheets in an .xlsx (empty list for csv); the chosen one is read by readTable(buf, name, sheet)
async function sheetNames(buf) {
  if (!buf || buf[0] !== 0x50 || buf[1] !== 0x4B) return [];
  try { const z = await JSZip.loadAsync(buf); const wb = await z.file('xl/workbook.xml').async('string'); return [...wb.matchAll(/<sheet\b[^>]*?>/g)].map((m) => unesc((/name="([^"]*)"/.exec(m[0]) || [])[1] || '')); } catch { return []; }
}
module.exports = { writeXlsx, readTable, sheetNames, parseCsv, S, colName };
