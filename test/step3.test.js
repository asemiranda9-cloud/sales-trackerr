const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { App } = require('../src/core'); const xl = require('../src/xl'); const settle = require('../src/settle'); const bir = require('../src/bir'); const db = require('../src/db'); const { startHost } = require('../src/server');

function fx(vat = 'VAT') {
  const a = new App(':memory:'); a.setup({ name: 'Admin', email: 'a@x.com', password: 'longenough' }); const A = a.login('a@x.com', 'longenough').user;
  const sid = a.addStore(A, { platform: 'Lazada', name: 'Protech' }); a.saveStoreDetails(A, { id: sid, business_name: 'Protech Trading', tin: '123456789000', address: 'Cainta, Rizal', vat_status: vat });
  a.createUser(A, { name: 'Emp', email: 'e@x.com', password: 'longenough', role: 'employee' }); const E = a.login('e@x.com', 'longenough').user; return { a, A, E, sid };
}
const row = (o = {}) => ({ order_no: 'O1', product_code: 'P1', product_name: 'Oil', product_price: '112', quantity: 2, order_date: '2026-11-05', ...o });
const approvedOrder = (a, A, sid, o = {}) => { const r = a.addRow(A, sid, 2026, 11, row(o)); a.approve(A, r.orderId, true); return r.orderId; };
const csv = (rows) => Buffer.from(rows.map((r) => r.join(',')).join('\n')).toString('base64');

// ---------- order date
test('order date: entered, assumed when blank, validated, editable', () => {
  const { a, A, sid } = fx(); a.addRow(A, sid, 2026, 11, row()); a.addRow(A, sid, 2026, 10, row({ order_no: 'O2', order_date: '' }));
  assert.throws(() => a.addRow(A, sid, 2026, 11, row({ order_no: 'O3', order_date: '2026-02-30' })), /Order date/); assert.throws(() => a.addRow(A, sid, 2026, 11, row({ order_no: 'O3', order_date: '5/11/2026' })), /Order date/);
  const s1 = a.sheet(A, sid, 2026, 11).rows[0], s2 = a.sheet(A, sid, 2026, 10).rows[0]; assert.equal(s1.order_date, '2026-11-05'); assert.equal(s1.date_assumed, 0); assert.equal(s2.order_date, '2026-10-01'); assert.equal(s2.date_assumed, 1, 'past month without a date = first of month, flagged');
  a.editLine(A, s2.line_id, { order_no: 'O2', quantity: 2, distributor_price: 112, product_id: 1, order_date: '2026-10-17' }); const e = a.sheet(A, sid, 2026, 10).rows[0]; assert.equal(e.order_date, '2026-10-17'); assert.equal(e.date_assumed, 0);
});
test('older database (before step 3) upgrades and its orders get an assumed date', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), 'old.sqlite'); const d = new DatabaseSync(f);
  d.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'employee', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE TABLE stores (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1, UNIQUE (platform, name));
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL, order_no TEXT NOT NULL COLLATE NOCASE, tracking_no TEXT, status TEXT NOT NULL DEFAULT 'Shipping', remarks TEXT, approved INTEGER NOT NULL DEFAULT 0, approved_by INTEGER, approved_at TEXT, entered_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    INSERT INTO users (name,email,password_hash) VALUES ('x','x@x.com','h'); INSERT INTO stores (platform,name) VALUES ('Lazada','S'); INSERT INTO orders (store_id,year,month,order_no,entered_by,created_at) VALUES (1,2025,3,'OLD1',1,'2025-03-09 10:00:00');`); d.close();
  const n = db.open(f); const o = n.prepare('SELECT order_date,date_assumed FROM orders').get(); assert.deepEqual({ ...o }, { order_date: '2025-03-09', date_assumed: 1 });
  assert.ok(n.prepare("SELECT name FROM sqlite_master WHERE name='invoices'").get()); assert.ok(n.prepare('PRAGMA table_info(payouts)').all().some((c) => c.name === 'source')); n.close();
});

// ---------- invoices
test('invoice: needs approval and BIR details, VAT split, numbering per store, void keeps the number', () => {
  const { a, A, E, sid } = fx(); const r = a.addRow(A, sid, 2026, 11, row());
  assert.throws(() => a.issueInvoice(A, { order_id: r.orderId }), /Approve/); a.approve(A, r.orderId, true); assert.throws(() => a.issueInvoice(E, { order_id: r.orderId }), /admin/);
  assert.throws(() => a.issueInvoice(A, { order_id: r.orderId, buyer_tin: '12' }), /Buyer TIN/); assert.throws(() => a.issueInvoice(A, { order_id: r.orderId, invoice_date: 'nope' }), /invoice date/);
  const i1 = a.issueInvoice(A, { order_id: r.orderId, invoice_date: '2026-11-06', buyer_name: 'Juan', buyer_tin: '987654321' }); assert.equal(i1.invoice_no, 'SI-00000001');
  const d = a.invoice(A, i1.id); assert.equal(d.total, 224); assert.equal(d.vatable_sales, 200); assert.equal(d.vat_amount, 24); assert.equal(d.non_vat_sales, 0); assert.equal(d.buyer_tin, '987-654-321'); assert.equal(d.seller_tin, '123-456-789-000'); assert.equal(d.lines.length, 1);
  assert.throws(() => a.issueInvoice(A, { order_id: r.orderId }), /already has an invoice/); assert.equal(a.sheet(A, sid, 2026, 11).rows[0].invoice_id, i1.id);
  assert.throws(() => a.voidInvoice(A, i1.id, 'x'), /reason/); a.voidInvoice(A, i1.id, 'Wrong buyer'); assert.throws(() => a.voidInvoice(A, i1.id, 'again'), /already/);
  const i2 = a.issueInvoice(A, { order_id: r.orderId, invoice_date: '2026-11-07' }); assert.equal(i2.invoice_no, 'SI-00000002', 'a voided number is never reused');
  const list = a.invoices(A, 2026); assert.equal(list.length, 2); assert.equal(list.filter((x) => x.voided).length, 1); assert.ok(a.auditLog(A).some((x) => x.action === 'invoice_voided' && /Wrong buyer/.test(x.detail)));
  const other = a.addStore(A, { platform: 'Shopee', name: 'Other' }); a.saveStoreDetails(A, { id: other, business_name: 'Other Co', tin: '111222333', address: '', vat_status: 'non-VAT' });
  const r2 = a.addRow(A, other, 2026, 11, row({ order_no: 'Z1', product_code: 'P1' })); a.approve(A, r2.orderId, true); const i3 = a.issueInvoice(A, { order_id: r2.orderId }); assert.equal(i3.invoice_no, 'SI-00000001', 'each store has its own series'); assert.equal(a.invoice(A, i3.id).non_vat_sales, 224);
});
test('invoice refused without store TIN / for voided-only orders', () => {
  const a = new App(':memory:'); a.setup({ name: 'A', email: 'a@x.com', password: 'longenough' }); const A = a.login('a@x.com', 'longenough').user; const sid = a.addStore(A, { platform: 'Lazada', name: 'S' });
  const r = a.addRow(A, sid, 2026, 11, row()); a.approve(A, r.orderId, true); assert.throws(() => a.issueInvoice(A, { order_id: r.orderId }), /TIN/);
  a.saveStoreDetails(A, { id: sid, business_name: 'B', tin: '123456789', address: '', vat_status: 'non-VAT' }); a.voidLine(A, a.sheet(A, sid, 2026, 11).rows[0].line_id, 'mistake'); assert.throws(() => a.issueInvoice(A, { order_id: r.orderId }), /no active rows/);
});

// ---------- settlement import (synthetic files: real Lazada/Shopee/TikTok files were not available)
const SH = ['Statement Number', 'Release Date', 'Order Number', 'Item Price', 'Commission Fee', 'Transaction Fee', 'Voucher Seller Discount', 'Shipping Fee Charged', 'Withholding Tax', 'Net Amount'];
const SROWS = [['S1', '2026-11-05', 'O1', 1000, -50, -20, -30, -40, -10, 850], ['S1', '2026-11-05', 'O2', 500, -25, -10, 0, -40, -5, 420], ['S2', '2026-11-12', 'O3', 200, -10, -4, 0, -20, -2, 164], ['Total', '', '', 1700, -85, -34, -30, -100, -17, 1434]];
const sfile = (rows, header = SH, pre = []) => csv([...pre, header, ...rows]);
test('settlement: columns detected, signs handled, groups per statement, total row skipped', async () => {
  const { a, A, sid } = fx(); const p = await settle.parseSettlement(a, A, { filename: 's.csv', data: sfile(SROWS), store_id: sid });
  assert.deepEqual(Object.keys(p.mapping).sort(), ['date', 'fees', 'gross', 'net', 'order', 'reference', 'shipping', 'tax', 'vouchers']); assert.equal(p.mapping.fees.length, 2);
  assert.equal(p.summary.summary_rows_skipped, 1); assert.equal(p.summary.groups, 2); const g = p.groups[0]; assert.equal(g.reference, 'S1'); assert.equal(g.orders, 2);
  assert.deepEqual([g.gross_sales, g.platform_fees, g.vouchers, g.shipping_adj, g.tax_withheld, g.net_received], [1500, 105, 30, 80, 15, 1270]); assert.deepEqual(g.warnings, []);
  const pos = SROWS.map((r) => r.map((v, i) => (i >= 4 && i <= 8 && typeof v === 'number' ? Math.abs(v) : v))); const q = await settle.parseSettlement(a, A, { filename: 's.csv', data: sfile(pos), store_id: sid });
  assert.deepEqual(q.groups.map((x) => [x.platform_fees, x.tax_withheld, x.net_received]), p.groups.map((x) => [x.platform_fees, x.tax_withheld, x.net_received]), 'positive-deduction files give the same result');
});
test('settlement: commit, duplicates, strict mode, rollback, admin only', async () => {
  const { a, A, E, sid } = fx(); const body = { filename: 's.csv', data: sfile(SROWS), store_id: sid };
  await assert.rejects(settle.parseSettlement(a, E, body), /admin/);
  const r = settle.commitSettlement(a, A, await settle.parseSettlement(a, A, body), 'valid', 's.csv'); assert.deepEqual(r, { imported: 2, skipped_duplicates: 0, skipped_rows: 0 });
  const pay = a.payouts(A, 2026); assert.equal(pay.rows.length, 2); assert.equal(pay.totals.tax_withheld, 17); assert.equal(pay.totals.net_received, 1434); assert.deepEqual(pay.quarters, [0, 0, 0, 17]); assert.equal(pay.rows[0].source, 'import');
  const again = await settle.parseSettlement(a, A, body); assert.equal(again.summary.duplicates, 2); assert.deepEqual(settle.commitSettlement(a, A, again, 'valid', 's.csv'), { imported: 0, skipped_duplicates: 2, skipped_rows: 0 }); assert.equal(a.payouts(A, 2026).rows.length, 2);
  a.voidPayout(A, pay.rows[0].id); const re = await settle.parseSettlement(a, A, body); assert.equal(re.summary.duplicates, 1, 'a voided payout can be imported again');
  const bad = await settle.parseSettlement(a, A, { ...body, data: sfile([...SROWS.slice(0, 3), ['S3', '2026-11-20', 'O9', 'abc', 0, 0, 0, 0, 0, 5]]), store_id: sid }); assert.equal(bad.summary.row_errors, 1); assert.throws(() => settle.commitSettlement(a, A, bad, 'strict'), /problems/);
  const before = a.db.prepare('SELECT COUNT(*) c FROM payouts').get().c, orig = a.insertImportedPayout.bind(a); let n = 0; a.insertImportedPayout = (...x) => { if (++n === 2) throw new Error('boom'); return orig(...x); };
  const fresh = await settle.parseSettlement(a, A, { ...body, data: sfile([['S8', '2026-12-01', 'O', 10, 0, 0, 0, 0, 0, 10], ['S9', '2026-12-02', 'O', 10, 0, 0, 0, 0, 0, 10]]), store_id: sid }); assert.throws(() => settle.commitSettlement(a, A, fresh, 'valid'), /boom/); a.insertImportedPayout = orig;
  assert.equal(a.db.prepare('SELECT COUNT(*) c FROM payouts').get().c, before, 'all-or-nothing'); assert.ok(a.auditLog(A).some((x) => x.action === 'settlement_import'));
});
test('settlement: reconciliation warning, ambiguous dates, junk lines above the header, default date, no usable columns', async () => {
  const { a, A, sid } = fx(); const mis = SROWS.slice(0, 1).map((r) => [...r.slice(0, 9), 999]); const w = await settle.parseSettlement(a, A, { filename: 's.csv', data: sfile(mis), store_id: sid }); assert.match(w.groups[0].warnings[0], /net amount/); assert.equal(w.groups[0].net_received, 999, 'file net wins');
  const amb = await settle.parseSettlement(a, A, { filename: 's.csv', data: sfile([['S1', '03/04/2026', 'O1', 10, 0, 0, 0, 0, 0, 10], ['S1', '28/10/2026', 'O1', 10, 0, 0, 0, 0, 0, 10], ['S1', '28 Oct 2026', 'O1', 10, 0, 0, 0, 0, 0, 10], ['S1', '"Oct 28, 2026"', 'O1', 10, 0, 0, 0, 0, 0, 10]]), store_id: sid });
  assert.equal(amb.summary.row_errors, 1); assert.match(amb.issues[0].message, /day\/month or month\/day/); assert.equal(amb.groups[0].date, '2026-10-28'); assert.equal(amb.groups[0].rows, 3);
  const junk = await settle.parseSettlement(a, A, { filename: 's.csv', data: sfile(SROWS.slice(0, 1), SH, [['Income Report', 'Shop: Protech'], ['Period', 'Nov 2026'], []]), store_id: sid }); assert.equal(junk.headerRow, 3); assert.equal(junk.groups.length, 1);
  const nodate = SH.filter((h) => h !== 'Release Date'), nd = SROWS.slice(0, 1).map((r) => r.filter((_, i) => i !== 1)); const x = await settle.parseSettlement(a, A, { filename: 's.csv', data: sfile(nd, nodate), store_id: sid }); assert.match(x.needsMapping, /no date/);
  const y = await settle.parseSettlement(a, A, { filename: 's.csv', data: sfile(nd, nodate), store_id: sid, defaults: { date: '2026-11-30' } }); assert.equal(y.groups[0].date, '2026-11-30');
  const z = await settle.parseSettlement(a, A, { filename: 's.csv', data: csv([['Foo', 'Bar'], [1, 2]]), store_id: sid }); assert.match(z.needsMapping, /Gross|Net/); assert.throws(() => settle.commitSettlement(a, A, z), /Gross|Net/);
  const m = await settle.parseSettlement(a, A, { filename: 's.csv', data: sfile(SROWS.slice(0, 1)), store_id: sid, mapping: { date: 1, reference: 0, gross: 3, fees: [4], net: 9 } }); assert.equal(m.groups[0].platform_fees, 50); assert.equal(m.groups[0].tax_withheld, 0, 'only the columns the user chose are used');
});
test('settlement: picks the worksheet that looks like a settlement table', async () => {
  const { a, A, sid } = fx(); const buf = await xl.writeXlsx([{ name: 'Summary', rows: [['Report'], ['Shop', 'Protech']], freeze: false }, { name: 'Income', rows: [SH, ...SROWS.slice(0, 3)], freeze: false }]);
  const p = await settle.parseSettlement(a, A, { filename: 'x.xlsx', data: buf.toString('base64'), store_id: sid }); assert.equal(p.sheet, 'Income'); assert.deepEqual(p.sheets, ['Summary', 'Income']); assert.equal(p.groups.length, 2);
  const q = await settle.parseSettlement(a, A, { filename: 'x.xlsx', data: buf.toString('base64'), store_id: sid, sheet: 'Summary' }); assert.ok(q.needsMapping);
});

// ---------- exports
const sheetOf = async (buf, name) => xl.readTable(buf, 'x.xlsx', name);
test('exports: payouts workbook (totals exclude VOID, quarterly withholding)', async () => {
  const { a, A, sid } = fx(); a.addPayout(A, { store: sid, date: '2026-02-10', gross_sales: 1000, tax_withheld: 10 }); a.addPayout(A, { store: sid, date: '2026-11-10', gross_sales: 2000, platform_fees: 100, tax_withheld: 20 }); const v = a.addPayout(A, { store: sid, date: '2026-11-11', gross_sales: 500, tax_withheld: 5 }); a.voidPayout(A, v);
  const r = await bir.exportPayouts(a, A, { year: 2026 }); assert.equal(r.count, 3); const t = await sheetOf(r.buffer, 'Payouts'); assert.equal(t[2][0], 'Payout date'); const tot = t.find((x) => x[0] && String(x[0]).startsWith('Total')); assert.equal(tot[6], 3000); assert.equal(tot[10], 30, 'voided payout excluded'); assert.ok(t.some((x) => x[12] === 'VOID'));
  const q = await sheetOf(r.buffer, 'Tax withheld by quarter'); assert.deepEqual(q[3].slice(4, 9), [10, 0, 0, 20, 30]); assert.equal(q[3][2], 'Protech Trading'); assert.equal(q[3][3], '123-456-789-000');
});
test('exports: sales journal lists approved sales by date; summary matches Reports; voids listed', async () => {
  const { a, A, sid } = fx(); approvedOrder(a, A, sid, { order_no: 'O1', order_date: '2026-11-09' }); approvedOrder(a, A, sid, { order_no: 'O2', order_date: '2026-11-02', product_code: 'P2', product_name: 'Gel', product_price: '56', quantity: 1 });
  a.addRow(A, sid, 2026, 11, row({ order_no: 'WAIT' })); const vo = a.addRow(A, sid, 2026, 11, row({ order_no: 'O4' })); a.approve(A, vo.orderId, true); a.voidLine(A, a.sheet(A, sid, 2026, 11).rows.find((x) => x.order_no === 'O4').line_id, 'duplicate entry');
  const i = a.issueInvoice(A, { order_id: a.sheet(A, sid, 2026, 11).rows.find((x) => x.order_no === 'O2').order_id });
  const r = await bir.exportJournal(a, A, { year: 2026 }); assert.equal(r.count, 2); const t = await sheetOf(r.buffer, 'Sales journal'); const data = t.slice(3, 5);
  assert.deepEqual(data.map((x) => x[0]), ['2026-11-02', '2026-11-09'], 'ordered by date'); assert.equal(data[0][7], i.invoice_no); assert.equal(data[0][12], 56); assert.equal(data[1][12], 224); const tot = t.find((x) => x[0] === 'Total'); assert.equal(tot[12], 280);
  const rep = a.report(A, 2026)[0], sm = (await sheetOf(r.buffer, 'Monthly summary'))[3]; assert.equal(sm[6], rep.approved_sales); assert.equal(sm[7], rep.vatable_sales); assert.equal(sm[8], rep.vat_amount); assert.equal(rep.approved_sales, 280);
  const vd = await sheetOf(r.buffer, 'Voided rows'); assert.equal(vd[3][7], 'duplicate entry'); const one = await bir.exportJournal(a, A, { year: 2026, month: 10 }); assert.equal(one.count, 0);
  await assert.rejects(bir.exportJournal(a, A, {}), /year/); await assert.rejects(bir.exportJournal(a, fx().E, { year: 2026 }), /admin/);
});
test('exports: invoice register and e-invoice json', async () => {
  const { a, A, sid } = fx(); const o1 = approvedOrder(a, A, sid), o2 = approvedOrder(a, A, sid, { order_no: 'O2' }); const i1 = a.issueInvoice(A, { order_id: o1, invoice_date: '2026-11-06', buyer_name: 'Juan' }); const i2 = a.issueInvoice(A, { order_id: o2, invoice_date: '2026-11-07' }); a.voidInvoice(A, i2.id, 'cancelled order');
  const r = await bir.exportInvoices(a, A, { year: 2026 }); const t = await sheetOf(r.buffer, 'Invoices'); assert.equal(t[3][0], 'SI-00000001'); assert.equal(t[4][13], 'VOID'); const tot = t.find((x) => x[0] && String(x[0]).startsWith('Total')); assert.equal(tot[12], 224, 'voided invoice excluded'); assert.equal(tot[10], 24);
  const l = await sheetOf(r.buffer, 'Invoice lines'); assert.equal(l.length, 5); const j = JSON.parse(bir.exportEinvoiceJson(a, A, { year: 2026 }).buffer.toString()); assert.equal(j.invoices.length, 2); assert.equal(j.invoices[0].seller.vat_registered, true); assert.equal(j.invoices[0].totals.vat_amount, 24); assert.equal(j.invoices[1].status, 'VOID'); assert.match(j.notice, /not the official/);
  assert.equal(i1.invoice_no, j.invoices[0].invoice_no);
});

// ---------- HTTP routes
test('routes: settlement import, invoices and BIR exports over HTTP; employees refused', async () => {
  const h = await startHost({ file: ':memory:', port: 0, bind: '127.0.0.1' }); const base = `http://127.0.0.1:${h.port}`;
  const mk = () => { let ck = ''; return async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'X-ST': '1', 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: m === 'POST' ? JSON.stringify(b || {}) : undefined }); const s = r.headers.get('set-cookie'); if (s) ck = s.split(';')[0];
    const ct = r.headers.get('content-type') || ''; return { s: r.status, j: ct.includes('json') && !r.headers.get('content-disposition') ? await r.json() : null, buf: Buffer.from(await r.arrayBuffer().catch(() => [])), ct }; }; };
  const A = mk(), E = mk(); await A('POST', '/api/setup', { name: 'A', email: 'a@x.com', password: 'longenough' }); await A('POST', '/api/login', { email: 'a@x.com', password: 'longenough' });
  const sid = (await A('POST', '/api/stores', { platform: 'Lazada', name: 'S' })).j.id; await A('POST', '/api/stores/details', { id: sid, business_name: 'Biz', tin: '123456789', address: 'x', vat_status: 'VAT' });
  await A('POST', '/api/users', { name: 'E', email: 'e@x.com', password: 'longenough', role: 'employee' }); await E('POST', '/api/login', { email: 'e@x.com', password: 'longenough' });
  const body = { filename: 's.csv', data: sfile(SROWS), store_id: sid }; assert.equal((await E('POST', '/api/payouts/import/preview', body)).s, 403);
  const pv = await A('POST', '/api/payouts/import/preview', body); assert.equal(pv.s, 200); assert.equal(pv.j.groups.length, 2); assert.equal((await A('POST', '/api/payouts/import/commit', { ...body, mode: 'valid' })).j.imported, 2);
  const add = await A('POST', '/api/sheet/add', { store: sid, year: 2026, month: 11, order_no: 'O1', product_code: 'P', product_name: 'N', product_price: 112, quantity: 1, order_date: '2026-11-03' }); await A('POST', '/api/sheet/approve', { order_id: add.j.orderId, value: true });
  const inv = await A('POST', '/api/invoices', { order_id: add.j.orderId, buyer_name: 'Juan' }); assert.equal(inv.j.invoice_no, 'SI-00000001'); assert.equal((await E('POST', '/api/invoices', { order_id: add.j.orderId })).s, 403); assert.equal((await E('GET', '/api/invoices?year=2026')).s, 403);
  assert.equal((await A('GET', `/api/invoices/get?id=${inv.j.id}`)).j.vat_amount, 12);
  for (const type of ['payouts', 'journal', 'invoices']) { const r = await A('GET', `/api/export?type=${type}&year=2026`); assert.equal(r.s, 200, type); assert.equal(r.buf[0], 0x50, type + ' is a real xlsx'); assert.equal((await E('GET', `/api/export?type=${type}&year=2026`)).s, 403, type + ' admin only'); }
  const ej = await A('GET', '/api/export?type=einvoice&year=2026'); assert.equal(JSON.parse(ej.buf.toString()).invoices.length, 1); assert.equal((await E('GET', '/api/export?type=einvoice&year=2026')).s, 403);
  assert.equal((await A('POST', '/api/invoices/void', { id: inv.j.id, reason: 'test' })).s, 200); await h.close();
});
