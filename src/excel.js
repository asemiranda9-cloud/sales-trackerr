'use strict';
// Export, template and import (preview + all-or-nothing commit). Permissions mirror the sheet rules.
const xl = require('./xl'); const { S } = xl;
const { AppError, STATUSES, REMARKS, PLATFORMS, isoDate } = require('./core');
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const FIELDS = [ // key, template header, aliases
  ['order_no', 'Order Number', ['order number','order no','order #','order','orderno','order id']],
  ['tracking_no', 'Tracking Number', ['tracking number','tracking no','tracking','awb']],
  ['product_code', 'Product Code', ['product code','code','sku','item code']],
  ['product_name', 'Product Name', ['product name','product','item name','name','description']],
  ['quantity', 'Quantity', ['quantity','qty','units']],
  ['distributor_price', 'Distributor Price', ['distributor price','distributor','dist price','cost']],
  ['retail_price', 'Retail Price', ['retail price','retail','srp','price']],
  ['paid_amount', 'Paid Amount', ['paid amount','paid by customer','paid','amount paid']],
  ['received_amount', 'Received Amount', ['received amount','received','payout']],
  ['price_adjustment', 'Price Adjustment', ['price adjustment','adjustment']],
  ['status', 'Order Status', ['order status','status']],
  ['remarks', 'Remarks', ['remarks','remark','notes']],
  ['store', 'Store', ['store','store name','shop']],
  ['platform', 'Platform', ['platform','marketplace']],
  ['year', 'Year', ['year']],
  ['month', 'Month', ['month','reporting month']],
  ['order_date', 'Order Date', ['order date','date','sales date','date of sale','transaction date']],
];
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
const money = (n) => (n === null || n === undefined ? '' : { v: n, s: S.money });
const r2 = (n) => Math.round(n * 100) / 100;

async function template() {
  const hdr = FIELDS.map((f) => ({ v: f[1], s: S.header }));
  const sample = [['SAMPLE-1001', 'TRK123456', 'P001', 'Engine Oil 1L', 2, 100, 150, 300, 280, '', 'Shipping', '', 'Protech', 'Lazada', 2026, 'November', '2026-11-05'],
    ['SAMPLE-1001', 'TRK123456', 'P002', 'Brake Cleaner', 1, 80, 120, 120, 110, '', 'Shipping', '', 'Protech', 'Lazada', 2026, 'November', '2026-11-05']];
  const rows = [hdr, ...sample.map((r) => r.map((v, i) => (typeof v === 'number' && [5, 6, 7, 8].includes(i) ? { v, s: S.input + 1 } : { v, s: S.input })))];
  for (let i = 0; i < 18; i++) rows.push(FIELDS.map(() => ({ v: '', s: S.input })));
  const guide = [[{ v: 'How to fill in the Sales sheet', s: S.title }], [''],
    ['• Delete the two SAMPLE rows (yellow) before importing, or the import will treat them as real orders.'],
    ['• Order Number, Product Code and Quantity are required. Quantity must be 1 or more.'],
    ['• A known Product Code uses the saved name and distributor price. A NEW code needs Product Name and Distributor Price.'],
    ['• Several products in one order: repeat the same Order Number on each line.'],
    ['• Order Status: ' + STATUSES.join(', ') + '. Blank = Shipping.'], ['• Remarks: ' + REMARKS.join(' or ') + ', or blank.'],
    ['• Store and Platform (' + PLATFORMS.join(', ') + ') must match a store already in the app. You can also leave them blank and pick the store in the import screen.'],
    ['• Year (e.g. 2026) and Month (name or 1-12). Blank = use the month chosen in the import screen.'],
    ['• Order Date (2026-11-05 format) is the day of the sale and is used in the sales journal and invoices. Blank = the app assumes a date and marks it as assumed.'],
    ['• Price Adjustment is only imported when an admin runs the import; for employees it is ignored.'],
    ['• Imported rows start as Waiting until an admin approves them. Amounts: numbers only, no currency symbols.']];
  return xl.writeXlsx([
    { name: 'Sales', widths: Array(17).fill(20), rows, filter: true, validations: [
      { sqref: 'K2:K500', list: '"' + STATUSES.join(',') + '"' }, { sqref: 'L2:L500', list: '"' + REMARKS.join(',') + '"' }, { sqref: 'N2:N500', list: '"' + PLATFORMS.join(',') + '"' }] },
    { name: 'Guide', widths: [120], rows: guide, freeze: false, grid: false }]);
}

// ---------- export
function exportData(app, u, o) {
  const isAdmin = u.role === 'admin'; const w = ['l.voided = 0'], a = [];
  if (o.store_id) { w.push('o.store_id = ?'); a.push(+o.store_id); }
  if (o.platform) { w.push('s.platform = ?'); a.push(o.platform); }
  if (o.year) { w.push('o.year = ?'); a.push(+o.year); }
  if (o.month) { w.push('o.month = ?'); a.push(+o.month); }
  if (o.status) { w.push('o.status = ?'); a.push(o.status); }
  if (o.approved === '1' || o.approved === '0') { w.push('o.approved = ?'); a.push(+o.approved); }
  if (o.line_ids && o.line_ids.length) { w.push(`l.id IN (${o.line_ids.map(() => '?').join(',')})`); a.push(...o.line_ids.map(Number)); }
  return app.db.prepare(`SELECT s.platform,s.name store,o.year,o.month,o.order_no,o.tracking_no,o.status,o.remarks,o.approved,p.code,p.name pname,l.quantity,l.distributor_price,l.retail_price,l.paid_amount_customer,l.received_amount,l.price_adjustment
    FROM order_lines l JOIN orders o ON o.id=l.order_id JOIN stores s ON s.id=o.store_id JOIN products p ON p.id=l.product_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY s.platform,s.name,o.year,o.month,o.id,l.id`).all(...a);
}
async function exportSales(app, u, o = {}) {
  const isAdmin = u.role === 'admin', data = exportData(app, u, o);
  const head = ['Platform', 'Store', 'Reporting Month', 'Order Number', 'Tracking Number', 'Product Code', 'Product Name', 'Quantity', 'Distributor Price', 'Total', 'Retail Price', 'Paid Amount', 'Received Amount', 'Price Adjustment', 'Order Status', 'Remarks', 'Approval'];
  const rows = [head.map((h) => ({ v: h, s: S.header }))]; let cents = 0, units = 0;
  data.forEach((d, i) => { const r = i + 2, tot = r2(d.distributor_price * d.quantity); if (d.approved) { cents += Math.round(d.distributor_price * 100) * d.quantity; units += d.quantity; }
    rows.push([d.platform, d.store, `${MONTHS[d.month - 1]} ${d.year}`, d.order_no, d.tracking_no || '', d.code, d.pname, { v: d.quantity, s: S.int }, money(d.distributor_price), { f: `I${r}*H${r}`, v: tot, s: S.money },
      money(d.retail_price), money(d.paid_amount_customer), money(d.received_amount), money(d.price_adjustment), d.status, d.remarks || '', d.approved ? 'Approved' : 'Waiting']); });
  const n = data.length, widths = Array(17).fill(20);
  const sheets = [{ name: 'Sales', widths, rows, filter: true }];
  if (isAdmin) { // approved-only totals, same rule as the sheet screen
    const L = n + 1; sheets[0].rows.push([]); sheets[0].filterEnd = L;
    sheets[0].rows.push(Array(6).fill('').concat([{ v: 'Total approved sales', s: S.bold }, { v: '', s: S.bold }, { v: '', s: S.bold }, { f: `SUMIFS(J2:J${L},Q2:Q${L},"Approved")`, v: cents / 100, s: S.moneyBold }]));
    sheets[0].rows.push(Array(6).fill('').concat([{ v: 'Approved units sold', s: S.bold }, { f: `SUMIFS(H2:H${L},Q2:Q${L},"Approved")`, v: units, s: S.bold }]));
    const by = {}; for (const d of data) { const k = `${d.platform}|${d.store}|${d.year}|${d.month}`; const g = by[k] || (by[k] = { d, c: 0, u: 0, w: new Set(), all: new Set() }); g.all.add(d.order_no); if (d.approved) { g.c += Math.round(d.distributor_price * 100) * d.quantity; g.u += d.quantity; } else g.w.add(d.order_no); }
    const sr = [[{ v: 'Financial summary (approved orders only)', s: S.title }], [], ['Platform', 'Store', 'Reporting Month', 'Orders', 'Waiting orders', 'Units sold', 'Approved sales'].map((h) => ({ v: h, s: S.header }))];
    let tc = 0; for (const g of Object.values(by)) { sr.push([g.d.platform, g.d.store, `${MONTHS[g.d.month - 1]} ${g.d.year}`, { v: g.all.size, s: S.int }, { v: g.w.size, s: S.int }, { v: g.u, s: S.int }, { v: g.c / 100, s: S.money }]); tc += g.c; }
    const e = sr.length; sr.push([{ v: 'Total', s: S.bold }, { v: '', s: S.bold }, { v: '', s: S.bold }, { v: '', s: S.bold }, { v: '', s: S.bold }, { f: `SUM(F4:F${e})`, v: units, s: S.bold }, { f: `SUM(G4:G${e})`, v: tc / 100, s: S.moneyBold }]);
    sheets.push({ name: 'Summary', widths: Array(7).fill(20), rows: sr, headerRow: 3 });
  }
  return { buffer: await xl.writeXlsx(sheets), count: n };
}
async function exportProducts(app, u) {
  app.admin(u); const list = app.products(u);
  const rows = [['Code', 'Name', 'Distributor Price', 'Status'].map((h) => ({ v: h, s: S.header })), ...list.map((p) => [p.code, p.name, { v: p.distributor_price, s: S.money }, p.active ? 'Active' : 'Hidden'])];
  return { buffer: await xl.writeXlsx([{ name: 'Products', widths: [14, 36, 18, 10], rows, filter: true }]), count: list.length };
}

// ---------- import
function autoMap(header) { const map = {}; header.forEach((h, i) => { const n = norm(h); if (!n) return; const f = FIELDS.find((x) => !(x[0] in map) && (norm(x[1]) === n || x[2].includes(n))); if (f) map[f[0]] = i; }); return map; }
function findHeaderRow(rows) { let best = 0, bn = -1; rows.slice(0, 15).forEach((r, i) => { const n = Object.keys(autoMap(r)).length; if (n > bn) { bn = n; best = i; } }); return best; }
const cell = (row, map, k) => (map[k] === undefined || map[k] === null || map[k] === '' ? null : row[map[k]] ?? null);
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const numv = (v) => { if (v === null || v === undefined || String(v).trim() === '') return null; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[₱,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
function parseMonth(v) { if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return { y: +v.slice(0, 4), m: +v.slice(5, 7) }; const s = txt(v).toLowerCase(); if (!s) return null; const i = MONTHS.findIndex((m) => m.toLowerCase() === s || m.toLowerCase().slice(0, 3) === s.slice(0, 3) && s.length <= 4); if (i >= 0) return { m: i + 1 }; const n = Number(s); return Number.isInteger(n) && n >= 1 && n <= 12 ? { m: n } : NaN; }

async function parseImport(app, u, { filename, data, mapping, defaults = {}, headerRow }) {
  const buf = Buffer.from(String(data || ''), 'base64'); const all = await xl.readTable(buf, filename || '');
  const hr = Number.isInteger(headerRow) ? headerRow : findHeaderRow(all); const header = (all[hr] || []).map((h) => txt(h));
  const map = mapping && Object.keys(mapping).length ? mapping : autoMap(header);
  const body = all.slice(hr + 1).map((r, i) => ({ r, line: hr + 2 + i })).filter((x) => x.r.some((c) => c !== null && txt(c) !== ''));
  if (body.length > 20000) throw new AppError(400, 'Too many rows (max 20,000 per import). Split the file.');
  const isAdmin = u.role === 'admin', stores = app.db.prepare('SELECT id,platform,name,active FROM stores').all();
  const prod = app.db.prepare('SELECT id,distributor_price FROM products WHERE code = ?'); const seen = new Set(), out = [];
  const exist = app.db.prepare(`SELECT l.id lid,o.id oid,o.approved FROM order_lines l JOIN orders o ON o.id=l.order_id JOIN products p ON p.id=l.product_id WHERE o.store_id=? AND o.year=? AND o.month=? AND o.order_no=? AND p.code=? AND l.voided=0 LIMIT 1`);
  const ordApproved = app.db.prepare('SELECT approved FROM orders WHERE store_id=? AND year=? AND month=? AND order_no=? ORDER BY id LIMIT 1');
  for (const { r, line } of body) {
    const e = [], w = []; const x = { line };
    x.order_no = txt(cell(r, map, 'order_no')); x.tracking_no = txt(cell(r, map, 'tracking_no')); x.product_code = txt(cell(r, map, 'product_code')); x.product_name = txt(cell(r, map, 'product_name'));
    const q = numv(cell(r, map, 'quantity')); x.quantity = q;
    for (const k of ['distributor_price', 'retail_price', 'paid_amount', 'received_amount', 'price_adjustment']) { x[k] = numv(cell(r, map, k)); if (Number.isNaN(x[k])) { e.push(`${k.replace(/_/g, ' ')} is not a number`); x[k] = null; } }
    if (!isAdmin && x.price_adjustment !== null) { x.price_adjustment = null; w.push('Price adjustment ignored (admin only)'); }
    const st = txt(cell(r, map, 'status')); x.status = st ? STATUSES.find((s) => s.toLowerCase() === st.toLowerCase()) : 'Shipping'; if (!x.status) { e.push(`Unknown status "${st}"`); x.status = 'Shipping'; }
    const rm = txt(cell(r, map, 'remarks')); x.remarks = rm ? REMARKS.find((s) => s.toLowerCase() === rm.toLowerCase()) || null : null; if (rm && !x.remarks) e.push(`Unknown remarks "${rm}"`);
    if (!x.order_no) e.push('Order number is missing'); if (!x.product_code) e.push('Product code is missing');
    if (q === null || Number.isNaN(q) || !Number.isInteger(q) || q < 1) e.push('Quantity must be a whole number, 1 or more');
    // store + period
    const sn = txt(cell(r, map, 'store')), pf = txt(cell(r, map, 'platform')); let store = null;
    if (sn) { const c = stores.filter((s) => s.name.toLowerCase() === sn.toLowerCase() && (!pf || s.platform.toLowerCase() === pf.toLowerCase())); if (c.length === 1) store = c[0]; else e.push(c.length ? `Store "${sn}" exists on several platforms; fill in Platform` : `Store "${sn}" is not in the app`); }
    else if (defaults.store_id) store = stores.find((s) => s.id === +defaults.store_id) || null; if (!store && !sn) e.push('No store: add a Store column or choose one in the import screen');
    if (store && !store.active) e.push('Store is hidden');
    const odRaw = txt(cell(r, map, 'order_date')); x.order_date = null; if (odRaw) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(odRaw); const d = m && m[0]; if (d && isoDate(d)) x.order_date = d; else e.push('Order date must look like 2026-11-05'); }
    const ym = parseMonth(cell(r, map, 'month')); let year = numv(cell(r, map, 'year')); let month = null;
    if (ym && typeof ym === 'object') { month = ym.m; if (ym.y && !year) year = ym.y; } else if (ym !== null) e.push('Month is not valid');
    if (!month && x.order_date && !cell(r, map, 'month')) { month = +x.order_date.slice(5, 7); if (!year) year = +x.order_date.slice(0, 4); }
    if (!month) month = defaults.month ? +defaults.month : null; if (!year) year = defaults.year ? +defaults.year : null;
    if (!(year >= 2020 && year <= 2100) || !(month >= 1 && month <= 12)) e.push('Year/month missing or invalid');
    x.store = store ? `${store.platform}: ${store.name}` : sn; x.store_id = store ? store.id : null; x.year = year; x.month = month;
    // product
    const p = x.product_code ? prod.get(x.product_code) : null;
    if (x.product_code && !p) { if (!x.product_name) e.push('New product code: product name is required'); if (x.distributor_price === null || x.distributor_price < 0) e.push('New product code: distributor price is required'); else x.new_product = true; }
    if (p && x.distributor_price !== null && Math.abs(p.distributor_price - x.distributor_price) > 0.005) w.push(`Distributor price in file differs from saved price ${p.distributor_price}; saved price is used`);
    // duplicates
    let dup = null;
    if (!e.length) { const key = [x.store_id, year, month, x.order_no.toLowerCase(), x.product_code.toLowerCase()].join('|');
      if (seen.has(key)) dup = 'file'; else { seen.add(key); const ex = exist.get(x.store_id, year, month, x.order_no, x.product_code); if (ex) { dup = 'db'; x.existing_line = ex.lid; x.existing_approved = !!ex.approved; } }
      if (!dup && !isAdmin) { const o = ordApproved.get(x.store_id, year, month, x.order_no); if (o && o.approved) e.push('Order is already approved; ask the admin to add lines'); } }
    x.errors = e; x.warnings = w; x.duplicate = dup; x.state = e.length ? 'error' : dup ? 'duplicate' : 'ok'; out.push(x);
  }
  return { header, headerRow: hr, mapping: map, rows: out, preview: all.slice(hr, hr + 6), summary: { total: out.length, ok: out.filter((x) => x.state === 'ok').length, duplicates: out.filter((x) => x.state === 'duplicate').length, errors: out.filter((x) => x.state === 'error').length } };
}
// mode: 'valid' = import valid rows, skip duplicates + errors | 'update' = also update existing lines (admin only) | 'strict' = refuse if any error
function commitImport(app, u, parsed, mode = 'valid') {
  const isAdmin = u.role === 'admin'; if (mode === 'update' && !isAdmin) throw new AppError(403, 'Only an admin can update existing records.');
  if (mode === 'strict' && parsed.summary.errors) throw new AppError(400, `${parsed.summary.errors} row(s) have errors. Fix the file or choose "Import valid rows only".`);
  const res = { imported: 0, updated: 0, skipped_duplicates: 0, skipped_errors: 0 };
  app.tx(() => {
    for (const x of parsed.rows) {
      if (x.state === 'error') { res.skipped_errors++; continue; }
      if (x.state === 'duplicate') {
        if (mode === 'update' && x.duplicate === 'db') { app.db.prepare('UPDATE order_lines SET quantity=?,retail_price=COALESCE(?,retail_price),paid_amount_customer=COALESCE(?,paid_amount_customer),received_amount=COALESCE(?,received_amount),price_adjustment=COALESCE(?,price_adjustment) WHERE id=?').run(x.quantity, x.retail_price, x.paid_amount, x.received_amount, x.price_adjustment, x.existing_line); res.updated++; } else res.skipped_duplicates++;
        continue;
      }
      app.addRow(u, x.store_id, x.year, x.month, { order_no: x.order_no, tracking_no: x.tracking_no, product_code: x.product_code, product_name: x.product_name, product_price: x.distributor_price, quantity: x.quantity, retail_price: x.retail_price, paid_amount: x.paid_amount, received_amount: x.received_amount, price_adjustment: x.price_adjustment, status: x.status, remarks: x.remarks, order_date: x.order_date });
      res.imported++;
    }
    app.audit(u.id, 'excel_import', `${res.imported} added, ${res.updated} updated, ${res.skipped_duplicates} duplicates skipped, ${res.skipped_errors} invalid skipped`);
  }); // any throw rolls the whole import back
  return res;
}
module.exports = { template, exportSales, exportProducts, parseImport, commitImport, FIELDS, autoMap };
