const test = require('node:test'); const assert = require('node:assert/strict'); const { App } = require('../src/core'); const ex = require('../src/excel'); const xl = require('../src/xl');
function fx() { const a = new App(':memory:'); a.setup({ name: 'Admin', email: 'a@x.com', password: 'longenough' }); const A = a.login('a@x.com', 'longenough').user;
  const sid = a.addStore(A, { platform: 'Lazada', name: 'Protech' }); a.createUser(A, { name: 'E', email: 'e@x.com', password: 'longenough', role: 'employee' }); const E = a.login('e@x.com', 'longenough').user; return { a, A, E, sid }; }
const H = ['Order Number', 'Product Code', 'Product Name', 'Quantity', 'Distributor Price', 'Retail Price', 'Price Adjustment', 'Order Status', 'Store', 'Platform', 'Year', 'Month'];
const csv = (rows) => Buffer.from(rows.map((r) => r.join(',')).join('\n')).toString('base64');
const imp = (a, u, rows, mode, name = 'f.csv', extra = {}) => ex.parseImport(a, u, { filename: name, data: csv([H, ...rows]), ...extra }).then((p) => (mode ? ex.commitImport(a, u, p, mode) : p));
test('template is a valid xlsx that the importer reads (headers auto-mapped)', async () => {
  const { a, E } = fx(); const b = await ex.template(); const rows = await xl.readTable(b, 't.xlsx'); assert.equal(rows[0].length, 17);
  const p = await ex.parseImport(a, E, { filename: 't.xlsx', data: b.toString('base64') }); assert.equal(Object.keys(p.mapping).length, 17); assert.equal(p.summary.total, 2);
});
test('preview: errors, duplicates, new-product rules, employee restrictions', async () => {
  const { a, A, E, sid } = fx();
  const rows = [['O1', 'P1', 'Oil', 2, 10.5, 20, 5, 'Shipping', 'Protech', 'Lazada', 2026, 'November'], ['O1', 'P1', 'Oil', 2, 10.5, 20, '', 'Shipping', 'Protech', 'Lazada', 2026, 'November'],
    ['', 'P2', 'X', 1, 1, '', '', '', 'Protech', 'Lazada', 2026, 11], ['O3', 'P3', 'Y', 0, 1, '', '', '', 'Protech', 'Lazada', 2026, 11], ['O4', 'P4', '', 1, '', '', '', '', 'Protech', 'Lazada', 2026, 11],
    ['O5', 'P5', 'Z', 1, 'abc', '', '', 'Bogus', 'Nope', 'Lazada', 2026, 11], ['O6', 'P6', 'Z', 1, 3, '', '', '', 'Protech', 'Lazada', 2026, 'Smarch']];
  const p = await imp(a, E, rows); assert.deepEqual(p.summary, { total: 7, ok: 1, duplicates: 1, errors: 5 }); assert.equal(p.rows[0].price_adjustment, null, 'employee adjustment ignored');
  const res = ex.commitImport(a, E, p, 'valid'); assert.deepEqual(res, { imported: 1, updated: 0, skipped_duplicates: 1, skipped_errors: 5 });
  const again = await imp(a, E, [rows[0]]); assert.equal(again.rows[0].state, 'duplicate', 'duplicate vs database');
  assert.throws(() => ex.commitImport(a, E, again, 'update'), /admin/); assert.throws(() => ex.commitImport(a, A, p, 'strict'), /error/);
  assert.equal(a.sheet(A, sid, 2026, 11).rows.length, 1); assert.ok(a.auditLog(A).some((x) => x.action === 'excel_import'));
});
test('admin update mode changes existing line only; approved order blocks employee import', async () => {
  const { a, A, E, sid } = fx(); await imp(a, A, [['O1', 'P1', 'Oil', 2, 10, 20, 7, '', 'Protech', 'Lazada', 2026, 11]], 'valid');
  const r = await imp(a, A, [['O1', 'P1', 'Oil', 9, 10, 25, 8, '', 'Protech', 'Lazada', 2026, 11]], 'update'); assert.equal(r.updated, 1);
  const s = a.sheet(A, sid, 2026, 11); assert.equal(s.rows.length, 1); assert.equal(s.rows[0].quantity, 9); assert.equal(s.rows[0].retail_price, 25); assert.equal(s.rows[0].price_adjustment, 8);
  a.approve(A, s.rows[0].order_id, true); const p = await imp(a, E, [['O1', 'P9', 'N', 1, 5, '', '', '', 'Protech', 'Lazada', 2026, 11]]); assert.match(p.rows[0].errors[0], /already approved/);
});
test('all-or-nothing: a failure mid-commit leaves the database unchanged', async () => {
  const { a, A, sid } = fx(); const p = await imp(a, A, [['O1', 'P1', 'Oil', 1, 10, '', '', '', 'Protech', 'Lazada', 2026, 11], ['O2', 'P2', 'Gel', 1, 5, '', '', '', 'Protech', 'Lazada', 2026, 11]]);
  const orig = a.addRow.bind(a); let n = 0; a.addRow = (...x) => { if (++n === 2) throw new Error('boom'); return orig(...x); };
  assert.throws(() => ex.commitImport(a, A, p, 'valid'), /boom/); a.addRow = orig;
  assert.equal(a.db.prepare('SELECT COUNT(*) c FROM orders').get().c, 0); assert.equal(a.db.prepare('SELECT COUNT(*) c FROM products').get().c, 0); assert.equal(a.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='excel_import'").get().c, 0);
});
test('large import (5000 rows) and invalid files', async () => {
  const { a, A, sid } = fx(); const rows = []; for (let i = 0; i < 5000; i++) rows.push([`O${i}`, `P${i % 50}`, `Prod ${i % 50}`, 1 + (i % 3), 10, 20, '', '', 'Protech', 'Lazada', 2026, 11]);
  const t = Date.now(); const r = await imp(a, A, rows, 'valid'); assert.equal(r.imported, 5000); assert.ok(Date.now() - t < 30000, 'took ' + (Date.now() - t));
  assert.equal(a.db.prepare('SELECT COUNT(*) c FROM order_lines').get().c, 5000);
  await assert.rejects(ex.parseImport(a, A, { filename: 'x.pdf', data: Buffer.from('%PDF-1.4 hello').toString('base64') }), /Unsupported/);
  await assert.rejects(ex.parseImport(a, A, { filename: 'x.xlsx', data: Buffer.from('PK\x03\x04garbage').toString('base64') }), /not a valid/);
  await assert.rejects(ex.parseImport(a, A, { filename: 'x.csv', data: '' }), /empty/); await assert.rejects(ex.parseImport(a, A, { filename: 'x.xls', data: Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 1, 2]).toString('base64') }), /xls/);
});
test('export: values match database, formulas, summary only for admin, filters, audit', async () => {
  const { a, A, E, sid } = fx(); await imp(a, A, [['O1', 'P1', 'Oil', 3, 10.1, 20, '', '', 'Protech', 'Lazada', 2026, 11], ['O2', 'P2', 'Gel', 1, 5.55, 9, '', 'Delivered', 'Protech', 'Lazada', 2026, 10]], 'valid');
  a.approve(A, a.sheet(A, sid, 2026, 11).rows[0].order_id, true);
  const ra = await ex.exportSales(a, A, { year: 2026 }); assert.equal(ra.count, 2); require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'st-export.xlsx'), ra.buffer);
  const rm = await ex.exportSales(a, A, { year: 2026, month: 10 }); assert.equal(rm.count, 1); assert.equal((await ex.exportSales(a, A, { status: 'Delivered' })).count, 1); assert.equal((await ex.exportSales(a, A, { platform: 'Shopee' })).count, 0);
  const re = await ex.exportSales(a, E, {}); require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'st-export-emp.xlsx'), re.buffer); await assert.rejects(ex.exportProducts(a, E), /admin/);
});
