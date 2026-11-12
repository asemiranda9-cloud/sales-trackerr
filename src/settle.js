'use strict';
// Import of a platform settlement / income / statement file (Lazada, Shopee, TikTok) into the Payouts records.
// IMPORTANT: written without real sample files from the three platforms. Columns are detected by fuzzy header
// matching and ALWAYS shown to the user for correction; the preview reconciles the breakdown against the net amount.
const xl = require('./xl');
const { AppError, r2, isoDate } = require('./core');
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SCALARS = ['date', 'reference', 'order', 'gross', 'net'], GROUPS = ['fees', 'vouchers', 'shipping', 'tax'];
const RX = {
  date: /(payout|release|released|settlement|statement|payment|paid) date|date (released|paid|settled|of release)|^payout$/,
  reference: /statement (no|number|id)|payout (id|no|number|reference)|settlement (id|no|number)|payment (reference|id)|^reference( no| number)?$|^statement$/,
  order: /^order (no|number|id|sn|#)|^order$|order number/,
  gross: /^(item|product)( original)? price$|gross (sales|amount)|^order amount$|^sales( amount)?$|total order amount|^subtotal$|original product price/,
  net: /net (payout|amount|settlement|proceeds)|amount released|released amount|settlement amount|payout amount|total (released|settlement|payout)( amount)?|amount settled/,
};
const SKIP = /date|status|\bid\b|number|\bno\b|reference|name|sku|tracking|quantity|qty|currency/;
function classify(n) {
  if (!n || SKIP.test(n)) return null;
  if (/withh|\bewt\b|income tax/.test(n)) return 'tax';
  if (/shipping|logistic|delivery|freight/.test(n)) return 'shipping';
  if (/voucher|coupon|discount|promo|rebate/.test(n)) return 'vouchers';
  if (/commission|\bfee\b|fees|charge|service|transaction/.test(n)) return 'fees';
  return null;
}
function autoMap(header) {
  const map = {}, used = new Set(), ns = header.map(norm);
  for (const k of SCALARS) { const i = ns.findIndex((n, j) => !used.has(j) && n && RX[k].test(n)); if (i >= 0) { map[k] = i; used.add(i); } }
  ns.forEach((n, i) => { if (used.has(i)) return; const g = classify(n); if (g) (map[g] || (map[g] = [])).push(i); });
  return map;
}
const score = (m) => SCALARS.filter((k) => m[k] !== undefined).length + GROUPS.filter((k) => m[k] && m[k].length).length;
function findHeader(rows) { let best = 0, bs = -1; rows.slice(0, 40).forEach((r, i) => { const s = score(autoMap(r.map(txt))); if (s > bs) { bs = s; best = i; } }); return { row: best, score: bs }; }
// a mapping that came from the screen: whole numbers for single columns, lists of whole numbers for the summed groups
function cleanMap(m) {
  const out = {}; for (const k of SCALARS) if (Number.isInteger(m[k]) && m[k] >= 0) out[k] = m[k];
  for (const k of GROUPS) { const a = (Array.isArray(m[k]) ? m[k] : m[k] === undefined || m[k] === '' ? [] : [m[k]]).filter((x) => Number.isInteger(x) && x >= 0); if (a.length) out[k] = [...new Set(a)]; } return out;
}
function amount(v) {
  if (v === null || v === undefined) return 0; if (typeof v === 'number') return v; let t = String(v).trim(); if (t === '' || t === '-') return 0;
  let neg = false; if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); } t = t.replace(/[₱,\s]|php/gi, ''); const n = Number(t); return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}
function parseDate(v) {
  const t = txt(v); if (!t) return { date: null }; const ok = (y, m, d) => { const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return isoDate(s) ? { date: s } : { error: `"${t}" is not a valid date` }; };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t); if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?,?[ -]*(\d{4})/.exec(t); if (m) { const i = MON.indexOf(m[2].slice(0, 3).toLowerCase()); if (i >= 0) return ok(+m[3], i + 1, +m[1]); }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})/.exec(t); if (m) { const i = MON.indexOf(m[1].slice(0, 3).toLowerCase()); if (i >= 0) return ok(+m[3], i + 1, +m[2]); }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t); if (m) { const a = +m[1], b = +m[2]; if (b > 12) return ok(+m[3], a, b); if (a > 12) return ok(+m[3], b, a); return { error: `"${t}" could be day/month or month/day; use the format 2026-11-05` }; }
  return { error: `"${t}" is not a date the importer understands (use 2026-11-05)` };
}
// which way are deductions written in this column? negative numbers (-12.00) or positive (12.00). Uses the majority sign.
function columnDirection(body, ci) { let neg = 0, pos = 0; for (const { r } of body) { const n = amount(r[ci]); if (n < 0) neg++; else if (n > 0) pos++; } return neg > pos ? -1 : 1; }

async function readSettlement(buf, filename, sheet, headerRow) {
  const names = await xl.sheetNames(buf); let chosen = sheet && names.includes(sheet) ? sheet : null, all;
  if (!chosen && names.length > 1) { // pick the worksheet that looks most like a settlement table
    let best = -1; for (const n of names.slice(0, 12)) { try { const t = await xl.readTable(buf, filename, n); const s = findHeader(t).score; if (s > best) { best = s; chosen = n; all = t; } } catch { /* ignore unreadable sheet */ } }
  }
  if (!chosen && names.length) chosen = names[0]; if (!all) all = await xl.readTable(buf, filename, chosen || undefined);
  const hr = Number.isInteger(headerRow) && headerRow >= 0 ? headerRow : findHeader(all).row; return { names, chosen, all, hr };
}

async function parseSettlement(app, u, { filename, data, store_id, mapping, headerRow, sheet, defaults = {} }) {
  app.admin(u); const store = app.db.prepare('SELECT id,platform,name FROM stores WHERE id=?').get(+store_id); if (!store) throw new AppError(400, 'Choose the store this settlement belongs to.');
  const buf = Buffer.from(String(data || ''), 'base64'); const { names, chosen, all, hr } = await readSettlement(buf, filename || '', sheet, headerRow);
  const header = (all[hr] || []).map(txt), map = mapping && Object.keys(mapping).length ? cleanMap(mapping) : autoMap(header);
  const body = all.slice(hr + 1).map((r, i) => ({ r, line: hr + 2 + i })).filter((x) => x.r.some((c) => c !== null && txt(c) !== ''));
  if (body.length > 50000) throw new AppError(400, 'Too many rows (max 50,000 per import). Split the file.');
  const res = { header, headerRow: hr, mapping: map, sheets: names, sheet: chosen, store, groups: [], issues: [], summary: { rows: body.length, used: 0, summary_rows_skipped: 0, row_errors: 0, groups: 0, ok: 0, duplicates: 0 }, totals: { gross_sales: 0, platform_fees: 0, vouchers: 0, shipping_adj: 0, tax_withheld: 0, net_received: 0 }, preview: all.slice(hr, hr + 6) };
  const dd = txt(defaults.date) ? parseDate(defaults.date) : { date: null }; if (dd.error) throw new AppError(400, 'The default payout date is not valid.');
  if (map.gross === undefined && map.net === undefined) { res.needsMapping = 'Choose the Gross sales column or the Net amount column.'; return res; }
  if (map.date === undefined && !dd.date) { res.needsMapping = 'There is no date column. Choose one, or enter the payout date for the whole file.'; return res; }
  const dir = {}; for (const k of GROUPS) for (const ci of map[k] || []) dir[ci] = columnDirection(body, ci);
  const groups = new Map(); const issue = (line, message) => { res.summary.row_errors++; if (res.issues.length < 300) res.issues.push({ line, message }); };
  for (const { r, line } of body) {
    const first = r.find((c) => c !== null && txt(c) !== ''); if (/^(grand\s+)?total\b/i.test(txt(first))) { res.summary.summary_rows_skipped++; continue; }
    let date = dd.date; if (map.date !== undefined) { const p = parseDate(r[map.date]); if (p.error) { issue(line, p.error); continue; } date = p.date || dd.date; } if (!date) { issue(line, 'No payout date on this row'); continue; }
    const v = {}; let bad = null; const get = (ci, label) => { const n = amount(r[ci]); if (Number.isNaN(n)) bad = `${label} "${txt(r[ci])}" is not a number`; return n; };
    v.gross = map.gross !== undefined ? get(map.gross, 'Gross sales') : 0; v.net = map.net !== undefined ? get(map.net, 'Net amount') : null;
    for (const k of GROUPS) { let t = 0; for (const ci of map[k] || []) t += get(ci, header[ci] || 'Column ' + (ci + 1)) * dir[ci]; v[k] = t; }
    if (bad) { issue(line, bad); continue; }
    const ref = map.reference !== undefined ? txt(r[map.reference]) : ''; const key = date + '|' + ref; let g = groups.get(key);
    if (!g) groups.set(key, (g = { date, reference: ref || null, rows: 0, orders: new Set(), gross: 0, fees: 0, vouchers: 0, shipping: 0, tax: 0, net: 0, hasNet: map.net !== undefined }));
    g.rows++; if (map.order !== undefined && txt(r[map.order])) g.orders.add(txt(r[map.order])); g.gross += v.gross; g.fees += v.fees; g.vouchers += v.vouchers; g.shipping += v.shipping; g.tax += v.tax; if (v.net !== null) g.net += v.net; res.summary.used++;
  }
  const dup = app.db.prepare('SELECT 1 FROM payouts WHERE store_id=? AND payout_date=? AND reference IS ? AND ABS(net_received-?)<0.005 AND voided=0 LIMIT 1');
  for (const g of [...groups.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const o = { date: g.date, reference: g.reference, rows: g.rows, orders: g.orders.size, gross_sales: r2(g.gross), platform_fees: r2(g.fees), vouchers: r2(g.vouchers), shipping_adj: r2(g.shipping), tax_withheld: r2(g.tax), warnings: [] };
    const computed = r2(o.gross_sales - o.platform_fees - o.vouchers - o.shipping_adj - o.tax_withheld); o.net_received = g.hasNet ? r2(g.net) : computed;
    if (g.hasNet && Math.abs(computed - o.net_received) > 1) o.warnings.push(`Gross minus the deductions is ${computed.toFixed(2)} but the file's net amount is ${o.net_received.toFixed(2)}. The net amount from the file is used; check the fee/voucher/shipping/tax columns.`);
    if (o.net_received < 0) o.warnings.push('Net amount is negative (refunds or adjustments exceed sales).');
    o.state = dup.get(store.id, o.date, o.reference, o.net_received) ? 'duplicate' : 'ok'; res.groups.push(o); res.summary.groups++; res.summary[o.state === 'ok' ? 'ok' : 'duplicates']++;
    if (o.state === 'ok') for (const k of Object.keys(res.totals)) res.totals[k] = r2(res.totals[k] + o[k]);
  }
  return res;
}
// mode 'valid': import what is valid | 'strict': refuse if any row had a problem. All-or-nothing in one transaction.
function commitSettlement(app, u, parsed, mode = 'valid', fileName = '') {
  app.admin(u); if (parsed.needsMapping) throw new AppError(400, parsed.needsMapping);
  if (mode === 'strict' && parsed.summary.row_errors) throw new AppError(400, `${parsed.summary.row_errors} row(s) have problems. Fix the file or choose "Import valid rows only".`);
  const res = { imported: 0, skipped_duplicates: 0, skipped_rows: parsed.summary.row_errors };
  app.tx(() => {
    for (const g of parsed.groups) {
      if (g.state === 'duplicate') { res.skipped_duplicates++; continue; }
      app.insertImportedPayout(u, parsed.store.id, { ...g, note: `Imported from ${String(fileName).slice(0, 80)} (${g.rows} rows)` }); res.imported++;
    }
    app.audit(u.id, 'settlement_import', `${fileName}: store #${parsed.store.id}, ${res.imported} payouts added, ${res.skipped_duplicates} duplicates skipped, ${res.skipped_rows} rows skipped`);
  });
  return res;
}
module.exports = { parseSettlement, commitSettlement, autoMap, parseDate, amount };
