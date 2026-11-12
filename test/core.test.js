const test = require('node:test'); const assert = require('node:assert/strict'); const { App } = require('../src/core');
function fx() { const a = new App(':memory:'); a.setup({ name: 'Admin', email: 'a@x.com', password: 'longenough' });
  const A = a.login('A@X.COM', 'longenough').user; const sid = a.addStore(A, { platform: 'Lazada', name: 'Protech' });
  a.createUser(A, { name: 'Emp', email: 'e@x.com', password: 'longenough', role: 'employee' }); const E = a.login('e@x.com', 'longenough').user; return { a, A, E, sid }; }
const row = (o = {}) => ({ order_no: 'O1', product_code: 'P1', product_name: 'Oil', product_price: '10.10', quantity: 3, ...o });
test('setup once, login rules, lockout of disabled user', () => {
  const { a, A, E } = fx(); assert.throws(() => a.setup({ name: 'B', email: 'b@x.com', password: 'longenough' }), /already/);
  assert.throws(() => a.login('a@x.com', 'bad'), /incorrect/); const t = a.login('e@x.com', 'longenough').token; assert.ok(a.userFor(t));
  a.toggleUser(A, E.id); assert.equal(a.userFor(t), null); assert.throws(() => a.toggleUser(A, A.id), /own account/);
});
test('permissions: employee limits', () => {
  const { a, A, E, sid } = fx(); a.addRow(A, sid, 2026, 11, row());
  assert.throws(() => a.addStore(E, { platform: 'Lazada', name: 'X' }), /admin/); assert.throws(() => a.users(E), /admin/);
  assert.throws(() => a.approve(E, 1, true), /admin/); assert.throws(() => a.voidLine(E, 1, 'x'), /admin/); assert.throws(() => a.auditLog(E), /admin/);
  a.addRow(E, sid, 2026, 11, row({ order_no: 'O2', price_adjustment: '99' }));
  const s = a.sheet(E, sid, 2026, 11); assert.equal(s.totals, undefined); assert.equal(s.rows.find(r => r.order_no === 'O2').price_adjustment, null);
});
test('add row rules, approval, totals, approved lock', () => {
  const { a, A, E, sid } = fx();
  assert.throws(() => a.addRow(E, sid, 2026, 11, row({ product_name: '' })), /new product/); assert.throws(() => a.addRow(E, sid, 2026, 11, row({ quantity: 0 })), /Quantity/);
  a.addRow(E, sid, 2026, 11, row()); a.addRow(E, sid, 2026, 11, row({ product_code: 'P2', product_name: 'Gel', product_price: '5.55', quantity: 1 })); // same order, 2nd line
  let s = a.sheet(A, sid, 2026, 11); assert.equal(s.rows.length, 2); assert.deepEqual(s.totals, { approved_sales: 0, units_sold: 0, waiting_orders: 1 });
  a.approve(A, s.rows[0].order_id, true); s = a.sheet(A, sid, 2026, 11); assert.equal(s.totals.approved_sales, 35.85); assert.equal(s.totals.units_sold, 4);
  assert.throws(() => a.addRow(E, sid, 2026, 11, row({ product_code: 'P2', product_name: '' })), /already approved/); a.addRow(A, sid, 2026, 11, row({ product_code: 'P2' }));
  a.saveProduct(A, { id: 1, name: 'Oil', price: 99 }); assert.equal(a.sheet(A, sid, 2026, 11).rows[0].distributor_price, 10.1, 'price change must not alter old rows');
});
test('edit/delete, orphan order cleanup, fix requests, audit', () => {
  const { a, A, E, sid } = fx(); a.addRow(E, sid, 2026, 11, row()); let s = a.sheet(A, sid, 2026, 11); const r = s.rows[0];
  a.requestFix(E, r.order_id, 'wrong qty'); assert.equal(a.sheet(A, sid, 2026, 11).fixes.length, 1); assert.equal(a.sheet(E, sid, 2026, 11).rows[0].fix_open, true);
  a.resolveFix(A, a.sheet(A, sid, 2026, 11).fixes[0].id); assert.equal(a.sheet(A, sid, 2026, 11).fixes.length, 0);
  a.editLine(A, r.line_id, { order_no: 'O1', product_id: 1, quantity: 5, distributor_price: 10.1, status: 'Delivered' }); assert.equal(a.sheet(A, sid, 2026, 11).rows[0].quantity, 5);
  assert.throws(() => a.voidLine(A, r.line_id, ''), /reason/); a.voidLine(A, r.line_id, 'wrong order');
  const sv = a.sheet(A, sid, 2026, 11); assert.equal(sv.rows.length, 1, 'voided row stays on the sheet'); assert.equal(sv.rows[0].voided, 1); assert.deepEqual(sv.totals, { approved_sales: 0, units_sold: 0, waiting_orders: 0 });
  assert.equal(a.db.prepare('SELECT COUNT(*) c FROM orders').get().c, 1, 'nothing is erased');
  assert.throws(() => a.voidLine(A, r.line_id, 'again'), /already/); assert.throws(() => a.editLine(A, r.line_id, { order_no: 'O1', product_id: 1, quantity: 1, distributor_price: 1 }), /voided/);
  assert.ok(a.auditLog(A).some(x => x.action === 'line_voided'));
});
test('backup and restore (real file): data returns, safety copy kept, bad backups refused, survives reopen', () => {
  const fs = require('fs'), os = require('os'), path = require('path'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-')); const file = path.join(dir, 'd.sqlite');
  let a = new App(file); a.setup({ name: 'A', email: 'a@x.com', password: 'longenough' }); const A = a.login('a@x.com', 'longenough').user; const sid = a.addStore(A, { platform: 'Lazada', name: 'S' });
  a.addRow(A, sid, 2026, 11, row()); const b1 = a.backupNow(A); a.addRow(A, sid, 2026, 11, row({ order_no: 'O2' })); assert.equal(a.sheet(A, sid, 2026, 11).rows.length, 2);
  assert.throws(() => a.restore(A, '../x.sqlite'), /Choose/); fs.writeFileSync(path.join(a.backupDir, 'junk.sqlite'), 'not a database'); assert.throws(() => a.restore(A, 'junk.sqlite'), /valid backup|not a Sales/);
  assert.throws(() => a.restore({ id: 9, role: 'employee' }, b1), /admin/);
  const r = a.restore(A, b1); assert.equal(a.sheet(A, sid, 2026, 11).rows.length, 1, 'rolled back to the backup'); assert.ok(fs.existsSync(path.join(a.backupDir, r.safety_backup)));
  a.db.close(); a = new App(file); const A2 = a.login('a@x.com', 'longenough').user; assert.equal(a.sheet(A2, sid, 2026, 11).rows.length, 1, 'persisted after reopen'); a.db.close();
});
test('store BIR details: validation, TIN format, admin only, audit', () => {
  const { a, A, E, sid } = fx();
  assert.throws(() => a.saveStoreDetails(E, { id: sid, vat_status: 'VAT' }), /admin/);
  assert.throws(() => a.saveStoreDetails(A, { id: sid, vat_status: 'maybe' }), /VAT or non-VAT/);
  assert.throws(() => a.saveStoreDetails(A, { id: sid, tin: '12345', vat_status: 'VAT' }), /TIN/);
  a.saveStoreDetails(A, { id: sid, business_name: ' Protech Trading ', tin: '123456789 00000', address: 'Cainta', vat_status: 'VAT' });
  const s = a.stores(A, true).find((x) => x.id === sid);
  assert.equal(s.tin, '123-456-789-00000'); assert.equal(s.business_name, 'Protech Trading'); assert.equal(s.vat_status, 'VAT');
  assert.ok(a.auditLog(A).some((x) => x.action === 'store_details_saved'));
});
test('payouts: auto net, totals per quarter, void keeps the record, admin only', () => {
  const { a, A, E, sid } = fx();
  assert.throws(() => a.addPayout(E, { store: sid, date: '2026-02-01', gross_sales: 100 }), /admin/);
  assert.throws(() => a.addPayout(A, { store: sid, date: 'bad', gross_sales: 100 }), /date/);
  assert.throws(() => a.addPayout(A, { store: sid, date: '2026-02-01', gross_sales: -5 }), /0 or more/);
  a.addPayout(A, { store: sid, date: '2026-02-10', gross_sales: 1000, platform_fees: 100, vouchers: 50, shipping_adj: 20, tax_withheld: 4.5 });
  const id2 = a.addPayout(A, { store: sid, date: '2026-05-10', gross_sales: 2000, tax_withheld: 10, net_received: 1980 });
  let p = a.payouts(A, 2026); assert.equal(p.rows.length, 2);
  assert.equal(p.rows.find((r) => r.payout_date === '2026-02-10').net_received, 825.5);
  assert.equal(p.totals.tax_withheld, 14.5); assert.deepEqual(p.quarters, [4.5, 10, 0, 0]);
  a.voidPayout(A, id2); p = a.payouts(A, 2026); assert.equal(p.rows.length, 2, 'voided payout stays listed'); assert.equal(p.totals.tax_withheld, 4.5); assert.deepEqual(p.quarters, [4.5, 0, 0, 0]);
  assert.throws(() => a.voidPayout(A, id2), /Already/); assert.throws(() => a.payouts(E, 2026), /admin/);
  assert.equal(a.payouts(A, 2025).rows.length, 0);
});
test('old databases are upgraded in place without losing stores', () => {
  const os = require('os'), fs = require('fs'), path = require('path'), { DatabaseSync } = require('node:sqlite');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), 'old.sqlite'); const d = new DatabaseSync(f);
  d.exec("CREATE TABLE stores (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL CHECK (platform IN ('Lazada','Shopee','TikTok')), name TEXT NOT NULL COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1, UNIQUE (platform, name)); INSERT INTO stores (platform,name) VALUES ('Shopee','Old Shop');"); d.close();
  const a = new App(f); const row = a.db.prepare('SELECT name,tin,vat_status FROM stores').get(); assert.equal(row.name, 'Old Shop'); assert.equal(row.tin, null); assert.equal(row.vat_status, 'non-VAT'); a.db.close();
});

test('report: VAT split for VAT stores, voided rows excluded, voided list', () => {
  const { a, A, sid } = fx(); a.saveStoreDetails(A, { id: sid, business_name: 'Protech Trading', tin: '123456789', vat_status: 'VAT' });
  a.addRow(A, sid, 2026, 11, row({ product_price: '112', quantity: 1 })); a.addRow(A, sid, 2026, 11, row({ order_no: 'O2', product_code: 'P2', product_name: 'Gel', product_price: '56', quantity: 1 }));
  let s = a.sheet(A, sid, 2026, 11); for (const id of new Set(s.rows.map((r) => r.order_id))) a.approve(A, id, true);
  let rep = a.report(A, 2026); assert.equal(rep.length, 1); assert.equal(rep[0].approved_sales, 168); assert.equal(rep[0].vatable_sales, 150); assert.equal(rep[0].vat_amount, 18); assert.equal(rep[0].non_vat_sales, 0); assert.equal(rep[0].tin, '123-456-789'); assert.equal(rep[0].business_name, 'Protech Trading');
  a.voidLine(A, a.sheet(A, sid, 2026, 11).rows[1].line_id, 'duplicate'); rep = a.report(A, 2026); assert.equal(rep[0].approved_sales, 112); assert.equal(rep[0].vat_amount, 12);
  const v = a.voidedLines(A, 2026); assert.equal(v.length, 1); assert.equal(v[0].void_reason, 'duplicate'); assert.equal(v[0].amount, 56);
  a.saveStoreDetails(A, { id: sid, vat_status: 'non-VAT' }); rep = a.report(A, 2026); assert.equal(rep[0].non_vat_sales, 112); assert.equal(rep[0].vat_amount, 0);
});
