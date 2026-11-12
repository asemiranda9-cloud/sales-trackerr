'use strict';
// Business rules ported from the PHP pages (sheet.php, edit.php, products.php, stores.php, users.php, auth.php).
const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const db = require('./db'); const pw = require('./passwords');
const STATUSES = ['Shipping', 'Delivered', 'Failed Delivery', 'Return', 'Completed'];
const REMARKS = ['Return Received', 'Paid'];
const PLATFORMS = ['Lazada', 'Shopee', 'TikTok'];
class AppError extends Error { constructor(s, m) { super(m); this.status = s; } }
const bad = (m) => new AppError(400, m), forbid = (m) => new AppError(403, m);
const r2 = (n) => Math.round(n * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');
const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const invNo = (seq) => 'SI-' + String(seq).padStart(8, '0');
function numOrNull(v) { if (v === null || v === undefined) return null; const s = String(v).trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; }

class App {
  constructor(file) { this.file = file; this.db = db.open(file); this.sessions = new Map(); this.fails = new Map(); }
  tx(fn) { if (this.inTx) return fn(); this.inTx = true; this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { try { this.db.exec('ROLLBACK'); } catch {} throw e; } finally { this.inTx = false; } }
  audit(uid, action, detail = '') { this.db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?,?,?)').run(uid, action, detail); }
  needsSetup() { return this.db.prepare('SELECT COUNT(*) c FROM users').get().c === 0; }
  setup({ name, email, password }) {
    if (!this.needsSetup()) throw forbid('Setup is already done.');
    this.checkUserFields(name, email, password);
    const id = Number(this.db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')").run(name.trim(), email.trim(), pw.hash(password)).lastInsertRowid);
    this.audit(id, 'user_created', `${email} (admin)`); return id;
  }
  checkUserFields(name, email, password) {
    if (!name || !String(name).trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim())) throw bad('Enter a name and a valid email.');
    if (String(password || '').length < 8) throw bad('The password needs at least 8 characters.');
  }
  login(email, password) {
    const key = String(email || '').toLowerCase(), f = this.fails.get(key);
    if (f && f.n >= 5 && Date.now() - f.t < 60000) throw new AppError(429, 'Too many attempts. Wait a minute.');
    const row = this.db.prepare('SELECT id,name,email,role,password_hash FROM users WHERE email = ? AND active = 1').get(String(email || '').trim());
    const ok = pw.verify(String(password || ''), row ? row.password_hash : pw.hash('placeholder'));
    if (!row || !ok) { this.fails.set(key, { n: (f ? f.n : 0) + 1, t: Date.now() }); throw new AppError(401, 'Email or password is incorrect.'); }
    this.fails.delete(key);
    const token = crypto.randomBytes(32).toString('hex'); this.sessions.set(token, row.id);
    return { token, user: { id: row.id, name: row.name, email: row.email, role: row.role } };
  }
  logout(token) { this.sessions.delete(token); }
  // re-checks the DB on every call so a disabled account is locked out immediately
  userFor(token) {
    const id = this.sessions.get(token); if (!id) return null;
    const u = this.db.prepare('SELECT id,name,email,role FROM users WHERE id = ? AND active = 1').get(id);
    if (!u) this.sessions.delete(token); return u || null;
  }
  admin(u) { if (u.role !== 'admin') throw forbid('This is for the admin only.'); }

  // ---- stores / products / users (admin)
  stores(u, all) { return this.db.prepare(`SELECT id,platform,name,active,business_name,tin,address,vat_status FROM stores ${all && u.role === 'admin' ? '' : 'WHERE active = 1'} ORDER BY platform,name`).all(); }
  addStore(u, { platform, name }) {
    this.admin(u); name = String(name || '').trim();
    if (!PLATFORMS.includes(platform) || !name) throw bad('Choose a platform and enter a store name.');
    try { const id = Number(this.db.prepare('INSERT INTO stores (platform,name) VALUES (?,?)').run(platform, name).lastInsertRowid); this.audit(u.id, 'store_added', `${platform}: ${name}`); return id; }
    catch (e) { if (/UNIQUE/.test(e.message)) throw bad('That store already exists on this platform.'); throw e; }
  }
  // BIR details of the registered business behind a store
  saveStoreDetails(u, { id, business_name, tin, address, vat_status }) {
    this.admin(u); if (!this.db.prepare('SELECT 1 FROM stores WHERE id = ?').get(id)) throw new AppError(404, 'Store not found.');
    if (!['VAT', 'non-VAT'].includes(vat_status)) throw bad('Choose VAT or non-VAT.');
    let t = String(tin || '').replace(/[\s-]/g, ''); if (t) { if (!/^\d{9}(\d{3,5})?$/.test(t)) throw bad('TIN must be 9 digits, plus the 3-5 digit branch code if any.'); t = t.slice(0, 3) + '-' + t.slice(3, 6) + '-' + t.slice(6, 9) + (t.length > 9 ? '-' + t.slice(9) : ''); }
    this.db.prepare('UPDATE stores SET business_name=?, tin=?, address=?, vat_status=? WHERE id=?').run(String(business_name || '').trim() || null, t || null, String(address || '').trim() || null, vat_status, id);
    this.audit(u.id, 'store_details_saved', `store ${id}: ${String(business_name || '').trim()} TIN ${t || '-'} ${vat_status}`);
  }
  // ---- marketplace payouts (Lazada / Shopee / TikTok settlements). Never deleted, only voided, so the books keep a trace.
  addPayout(u, b) {
    this.admin(u); const store = this.db.prepare('SELECT id FROM stores WHERE id = ?').get(+b.store); if (!store) throw bad('Choose a store.');
    const date = String(b.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw bad('Enter the payout date.');
    const num = (v, label) => { const n = numOrNull(v); if (n !== null && (Number.isNaN(n) || n < 0)) throw bad(`${label} must be a number of 0 or more.`); return n === null ? 0 : r2(n); };
    const gross = num(b.gross_sales, 'Gross sales'), fees = num(b.platform_fees, 'Platform fees'), vou = num(b.vouchers, 'Vouchers'), ship = num(b.shipping_adj, 'Shipping adjustments'), tax = num(b.tax_withheld, 'Tax withheld');
    const given = numOrNull(b.net_received); if (given !== null && Number.isNaN(given)) throw bad('Net received must be a number.');
    if (gross === 0 && given === null) throw bad('Enter the gross sales or the net amount received.');
    const net = given === null ? r2(gross - fees - vou - ship - tax) : r2(given);
    const id = Number(this.db.prepare('INSERT INTO payouts (store_id,payout_date,reference,gross_sales,platform_fees,vouchers,shipping_adj,tax_withheld,net_received,note,entered_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(store.id, date, String(b.reference || '').trim() || null, gross, fees, vou, ship, tax, net, String(b.note || '').trim() || null, u.id).lastInsertRowid);
    this.audit(u.id, 'payout_added', `store ${store.id} ${date} gross ${gross} withheld ${tax} net ${net}`); return id;
  }
  voidPayout(u, id) {
    this.admin(u); const p = this.db.prepare('SELECT voided FROM payouts WHERE id = ?').get(id); if (!p) throw new AppError(404, 'Payout not found.'); if (p.voided) throw bad('Already voided.');
    this.db.prepare('UPDATE payouts SET voided = 1 WHERE id = ?').run(id); this.audit(u.id, 'payout_voided', `payout ${id}`);
  }
  payouts(u, year) {
    this.admin(u); const rows = this.db.prepare(`SELECT p.*,s.platform,s.name store,s.tin FROM payouts p JOIN stores s ON s.id=p.store_id WHERE substr(p.payout_date,1,4)=? ORDER BY p.payout_date DESC,p.id DESC`).all(String(year));
    const totals = { gross_sales: 0, platform_fees: 0, vouchers: 0, shipping_adj: 0, tax_withheld: 0, net_received: 0 }, quarters = [0, 0, 0, 0];
    for (const r of rows) { if (r.voided) continue; for (const k of Object.keys(totals)) totals[k] = r2(totals[k] + r[k]); const q = Math.floor((+r.payout_date.slice(5, 7) - 1) / 3); quarters[q] = r2(quarters[q] + r.tax_withheld); }
    return { rows, totals, quarters };
  }
  toggle(u, table, id) { this.admin(u); this.db.prepare(`UPDATE ${table} SET active = 1 - active WHERE id = ?`).run(id); }
  toggleStore(u, id) { this.toggle(u, 'stores', id); }
  toggleProduct(u, id) { this.toggle(u, 'products', id); }
  products(u) { return this.db.prepare('SELECT id,code,name,distributor_price,active FROM products ORDER BY code').all(); }
  addProduct(u, { code, name, price }) {
    this.admin(u); code = String(code || '').trim(); name = String(name || '').trim(); const p = numOrNull(price);
    if (!code || !name) throw bad('Enter a code and a name.'); if (p === null || Number.isNaN(p) || p < 0) throw bad('Enter a valid distributor price.');
    try { const id = Number(this.db.prepare('INSERT INTO products (code,name,distributor_price) VALUES (?,?,?)').run(code, name, p).lastInsertRowid); this.audit(u.id, 'product_added', code); return id; }
    catch (e) { if (/UNIQUE/.test(e.message)) throw bad('That product code already exists.'); throw e; }
  }
  saveProduct(u, { id, name, price }) {
    this.admin(u); const p = numOrNull(price);
    if (!String(name || '').trim() || p === null || Number.isNaN(p) || p < 0) throw bad('Enter a name and a valid price.');
    this.db.prepare('UPDATE products SET name = ?, distributor_price = ? WHERE id = ?').run(String(name).trim(), p, id); // does not touch existing lines
    this.audit(u.id, 'product_updated', `product #${id}, price ${p}`);
  }
  users(u) { this.admin(u); return this.db.prepare('SELECT id,name,email,role,active FROM users ORDER BY role,name').all(); }
  createUser(u, { name, email, password, role }) {
    this.admin(u); this.checkUserFields(name, email, password); role = role === 'admin' ? 'admin' : 'employee';
    try { const id = Number(this.db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name.trim(), email.trim(), pw.hash(password), role).lastInsertRowid); this.audit(u.id, 'user_created', `${email} (${role})`); return id; }
    catch (e) { if (/UNIQUE/.test(e.message)) throw bad('That email already has an account.'); throw e; }
  }
  toggleUser(u, id) { this.admin(u); if (id === u.id) throw bad('You cannot disable your own account.'); this.db.prepare('UPDATE users SET active = 1 - active WHERE id = ?').run(id); this.audit(u.id, 'user_toggled', `user #${id}`); }

  // ---- sheet
  period(storeId, year, month) {
    const s = this.db.prepare('SELECT id,platform,name FROM stores WHERE id = ? AND active = 1').get(storeId); if (!s) throw new AppError(404, 'Store not found.');
    if (!(year >= 2020 && year <= 2100 && month >= 1 && month <= 12)) throw bad('Invalid month.'); return s;
  }
  sheet(u, storeId, year, month) {
    const store = this.period(storeId, year, month), isAdmin = u.role === 'admin';
    const rows = this.db.prepare(`SELECT o.id order_id,o.order_no,o.tracking_no,o.status,o.remarks,o.approved,o.order_date,o.date_assumed,(SELECT i.id FROM invoices i WHERE i.order_id=o.id AND i.voided=0 LIMIT 1) invoice_id,l.id line_id,l.quantity,l.distributor_price,l.retail_price,l.paid_amount_customer,l.received_amount,l.price_adjustment,l.voided,l.void_reason,p.code,p.name
      FROM orders o JOIN order_lines l ON l.order_id=o.id JOIN products p ON p.id=l.product_id WHERE o.store_id=? AND o.year=? AND o.month=? ORDER BY o.id,l.id`).all(storeId, year, month);
    for (const r of rows) r.total = r2(r.distributor_price * r.quantity);
    const fixes = this.db.prepare(`SELECT c.id,c.order_id,c.note,u.name who,o.order_no FROM correction_requests c JOIN users u ON u.id=c.requested_by JOIN orders o ON o.id=c.order_id
      WHERE o.store_id=? AND o.year=? AND o.month=? AND c.resolved=0 ORDER BY c.id`).all(storeId, year, month);
    const out = { store, year, month, rows, fixes: isAdmin ? fixes : [] };
    if (!isAdmin) { for (const r of rows) { r.fix_open = fixes.some(f => f.order_id === r.order_id); } }
    if (isAdmin) { // totals only for admin, only approved orders count
      let cents = 0, units = 0; const waiting = new Set();
      for (const r of rows) { if (r.voided) continue; if (r.approved) { cents += Math.round(r.distributor_price * 100) * r.quantity; units += r.quantity; } else waiting.add(r.order_id); }
      out.totals = { approved_sales: cents / 100, units_sold: units, waiting_orders: waiting.size };
    }
    return out;
  }
  addRow(u, storeId, year, month, f) {
    const store = this.period(storeId, year, month), isAdmin = u.role === 'admin';
    const orderNo = String(f.order_no || '').trim(), tracking = String(f.tracking_no || '').trim(), qty = parseInt(f.quantity, 10) || 0;
    const status = STATUSES.includes(f.status) ? f.status : 'Shipping', remarks = REMARKS.includes(f.remarks) ? f.remarks : null;
    const retail = numOrNull(f.retail_price), paid = numOrNull(f.paid_amount), recv = numOrNull(f.received_amount), adj = isAdmin ? numOrNull(f.price_adjustment) : null;
    const pcode = String(f.product_code || '').trim(), pname = String(f.product_name || '').trim(), pprice = numOrNull(f.product_price);
    let product = this.db.prepare('SELECT id,distributor_price FROM products WHERE code = ?').get(pcode);
    if (!orderNo) throw bad('Enter an order number.');
    if (!pcode) throw bad('Enter a product code.');
    if (!product && !pname) throw bad('This is a new product code. Enter the product name too.');
    if (!product && (pprice === null || Number.isNaN(pprice) || pprice < 0)) throw bad('This is a new product code. Enter its distributor price too.');
    if (qty < 1) throw bad('Quantity must be 1 or more.');
    if ([retail, paid, recv, adj].some(Number.isNaN)) throw bad('Amounts must be numbers.');
    const od = String(f.order_date || '').trim(); if (od && !isoDate(od)) throw bad('Order date must look like 2026-11-05.');
    const now = new Date(), fallback = year === now.getFullYear() && month === now.getMonth() + 1 ? `${year}-${pad2(month)}-${pad2(now.getDate())}` : `${year}-${pad2(month)}-01`;
    return this.tx(() => {
      const order = this.db.prepare('SELECT id,approved FROM orders WHERE store_id=? AND year=? AND month=? AND order_no=? ORDER BY id LIMIT 1').get(store.id, year, month, orderNo);
      if (order && order.approved && !isAdmin) throw bad('That order is already approved. Ask the admin to add lines to it.');
      if (!product) {
        const id = Number(this.db.prepare('INSERT INTO products (code,name,distributor_price) VALUES (?,?,?)').run(pcode, pname, pprice).lastInsertRowid);
        product = { id, distributor_price: pprice }; this.audit(u.id, 'product_added', pcode);
      }
      const orderId = order ? order.id : Number(this.db.prepare('INSERT INTO orders (store_id,year,month,order_no,tracking_no,status,remarks,entered_by,order_date,date_assumed) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(store.id, year, month, orderNo, tracking || null, status, remarks, u.id, od || fallback, od ? 0 : 1).lastInsertRowid);
      const lid = Number(this.db.prepare('INSERT INTO order_lines (order_id,product_id,quantity,distributor_price,retail_price,paid_amount_customer,received_amount,price_adjustment) VALUES (?,?,?,?,?,?,?,?)')
        .run(orderId, product.id, qty, product.distributor_price, retail, paid, recv, adj).lastInsertRowid);
      this.audit(u.id, 'row_added', `order ${orderNo}, store #${store.id}`); return { orderId, lineId: lid };
    });
  }
  approve(u, orderId, on) {
    this.admin(u); const o = this.db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId); if (!o) throw new AppError(404, 'Order not found.');
    if (on) this.db.prepare("UPDATE orders SET approved=1, approved_by=?, approved_at=datetime('now','localtime') WHERE id=?").run(u.id, orderId);
    else this.db.prepare('UPDATE orders SET approved=0, approved_by=NULL, approved_at=NULL WHERE id=?').run(orderId);
    this.audit(u.id, on ? 'order_approved' : 'order_unapproved', `order #${orderId}`);
  }
  requestFix(u, orderId, note) {
    note = String(note || '').trim(); if (!note) throw bad('Write what needs to change.');
    if (!this.db.prepare('SELECT id FROM orders WHERE id=?').get(orderId)) throw new AppError(404, 'Order not found.');
    this.db.prepare('INSERT INTO correction_requests (order_id,requested_by,note) VALUES (?,?,?)').run(orderId, u.id, note);
  }
  resolveFix(u, id) { this.admin(u); this.db.prepare('UPDATE correction_requests SET resolved=1 WHERE id=?').run(id); }
  // Same as PHP: edit and delete do not check the approved flag (existing behaviour, kept on purpose).
  editLine(u, lineId, f) {
    this.admin(u);
    const row = this.db.prepare('SELECT l.id,l.order_id,l.voided,o.order_no,o.status FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.id=?').get(lineId); if (!row) throw new AppError(404, 'Row not found.'); if (row.voided) throw bad('This row is voided and cannot be edited.');
    const orderNo = String(f.order_no || '').trim(), qty = parseInt(f.quantity, 10) || 0, dp = numOrNull(f.distributor_price);
    const [retail, paid, recv, adj] = [f.retail_price, f.paid_amount, f.received_amount, f.price_adjustment].map(numOrNull);
    if (!orderNo) throw bad('Enter an order number.'); if (qty < 1) throw bad('Quantity must be 1 or more.');
    if (dp === null || Number.isNaN(dp) || dp < 0) throw bad('Enter a valid distributor price.'); if ([retail, paid, recv, adj].some(Number.isNaN)) throw bad('Amounts must be numbers.');
    const status = STATUSES.includes(f.status) ? f.status : row.status, remarks = REMARKS.includes(f.remarks) ? f.remarks : null, tracking = String(f.tracking_no || '').trim();
    const od = String(f.order_date || '').trim(); if (od && !isoDate(od)) throw bad('Order date must look like 2026-11-05.');
    this.tx(() => {
      this.db.prepare('UPDATE orders SET order_no=?,tracking_no=?,status=?,remarks=? WHERE id=?').run(orderNo, tracking || null, status, remarks, row.order_id);
      if (od) this.db.prepare('UPDATE orders SET order_date=?, date_assumed=0 WHERE id=?').run(od, row.order_id);
      this.db.prepare('UPDATE order_lines SET product_id=?,quantity=?,distributor_price=?,retail_price=?,paid_amount_customer=?,received_amount=?,price_adjustment=? WHERE id=?')
        .run(Number(f.product_id), qty, dp, retail, paid, recv, adj, lineId);
      this.audit(u.id, 'line_edited', `line #${lineId}, order ${row.order_no}`);
    });
  }
  // Sales are never erased (BIR): a row is voided with a reason, stays on the sheet marked VOID, and leaves every total.
  voidLine(u, lineId, reason) {
    this.admin(u); reason = String(reason || '').trim(); if (reason.length < 3) throw bad('Enter the reason for voiding this row.');
    const l = this.db.prepare('SELECT order_id,voided FROM order_lines WHERE id=?').get(lineId); if (!l) throw new AppError(404, 'Row not found.'); if (l.voided) throw bad('This row is already voided.');
    this.db.prepare("UPDATE order_lines SET voided=1, void_reason=?, voided_at=datetime('now','localtime'), voided_by=? WHERE id=?").run(reason, u.id, lineId);
    this.audit(u.id, 'line_voided', `line #${lineId}, order #${l.order_id}: ${reason}`);
  }
  voidedLines(u, year) {
    this.admin(u); return this.db.prepare(`SELECT l.id,l.void_reason,l.voided_at,l.quantity,l.distributor_price,o.order_no,o.month,s.platform,s.name store,p.code,u.name voided_by FROM order_lines l JOIN orders o ON o.id=l.order_id JOIN stores s ON s.id=o.store_id JOIN products p ON p.id=l.product_id LEFT JOIN users u ON u.id=l.voided_by WHERE l.voided=1 AND o.year=? ORDER BY l.voided_at DESC,l.id DESC`).all(year)
      .map((r) => ({ ...r, amount: r2(r.quantity * r.distributor_price) }));
  }
  // ---- backup / restore (admin). Backups live in <data folder>/backups and are never deleted except the oldest beyond 14 per kind.
  get backupDir() { if (this.file === ':memory:') return null; const d = path.join(path.dirname(this.file), 'backups'); fs.mkdirSync(d, { recursive: true }); return d; }
  stamp() { return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})$/, '$1-$2'); }
  backupNow(u, label = 'manual') {
    const dir = this.backupDir; if (!dir) throw bad('Backups need a real database file.');
    let name = `${label}-${this.stamp()}.sqlite`; for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${label}-${this.stamp()}-${n}.sqlite`;
    this.db.exec(`VACUUM INTO '${path.join(dir, name).replace(/'/g, "''")}'`);
    const all = fs.readdirSync(dir).filter((f) => f.startsWith(label + '-')).sort(); for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.unlinkSync(path.join(dir, old));
    if (u) this.audit(u.id, 'backup_created', name); return name;
  }
  listBackups(u) { this.admin(u); const dir = this.backupDir; if (!dir) return []; return fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort().reverse().map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size })); }
  restore(u, name) {
    this.admin(u); const dir = this.backupDir; if (!dir || !/^[\w.-]+\.sqlite$/.test(String(name))) throw bad('Choose a backup from the list.');
    const src = path.join(dir, name); if (!fs.existsSync(src)) throw new AppError(404, 'Backup not found.');
    let chk; try { chk = db.open(src); const need = ['users', 'stores', 'products', 'orders', 'order_lines', 'audit_log', 'correction_requests'];
      const have = chk.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name); if (need.some((t) => !have.includes(t))) throw bad('That file is not a Sales Tracker backup.');
      if (chk.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw bad('That backup is damaged.');
      if (!chk.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1").get().c) throw bad('That backup has no active admin, so nobody could log in. Restore cancelled.'); }
    catch (e) { if (e instanceof AppError) throw e; throw bad('That file is not a valid backup.'); } finally { try { chk && chk.close(); } catch {} }
    const safety = this.backupNow(null, 'pre-restore'); // always keep a copy of the current data first
    const tmp = this.file + '.restoring'; fs.copyFileSync(src, tmp); this.db.close();
    for (const ext of ['-wal', '-shm']) try { fs.unlinkSync(this.file + ext); } catch {}
    fs.renameSync(tmp, this.file); this.db = db.open(this.file); this.sessions.clear();
    return { restored: name, safety_backup: safety };
  }
  report(u, year) {
    this.admin(u); const rows = this.db.prepare(`SELECT s.id sid,s.platform,s.name,s.business_name,s.tin,s.vat_status,o.month,o.id oid,o.approved,l.quantity,l.distributor_price FROM order_lines l JOIN orders o ON o.id=l.order_id JOIN stores s ON s.id=o.store_id WHERE o.year=? AND l.voided=0`).all(year);
    const g = {}; for (const r of rows) { const k = r.sid + '|' + r.month; const x = g[k] || (g[k] = { store_id: r.sid, business_name: r.business_name, tin: r.tin, vat_status: r.vat_status, platform: r.platform, store: r.name, month: r.month, cents: 0, units: 0, orders: new Set(), waiting: new Set() }); x.orders.add(r.oid); if (r.approved) { x.cents += Math.round(r.distributor_price * 100) * r.quantity; x.units += r.quantity; } else x.waiting.add(r.oid); }
    return Object.values(g).map((x) => { const sales = x.cents / 100, vatable = x.vat_status === 'VAT' ? r2(sales / 1.12) : 0; return ({ store_id: x.store_id, business_name: x.business_name, tin: x.tin, vat_status: x.vat_status, platform: x.platform, store: x.store, month: x.month, approved_sales: sales, vatable_sales: vatable, vat_amount: x.vat_status === 'VAT' ? r2(sales - vatable) : 0, non_vat_sales: x.vat_status === 'VAT' ? 0 : sales, units_sold: x.units, orders: x.orders.size, waiting_orders: x.waiting.size }); }).sort((a, b) => a.platform.localeCompare(b.platform) || a.store.localeCompare(b.store) || a.month - b.month);
  }
  // ---- invoices. Numbered per store in one running series; never deleted, only voided (the number stays used).
  vatSplit(total, vatStatus) { total = r2(total); if (vatStatus !== 'VAT') return { vatable_sales: 0, vat_amount: 0, non_vat_sales: total }; const v = r2(total / 1.12); return { vatable_sales: v, vat_amount: r2(total - v), non_vat_sales: 0 }; }
  issueInvoice(u, { order_id, invoice_date, buyer_name, buyer_tin, buyer_address }) {
    this.admin(u);
    const o = this.db.prepare('SELECT o.id,o.order_no,o.approved,o.store_id,s.business_name,s.tin,s.address,s.vat_status FROM orders o JOIN stores s ON s.id=o.store_id WHERE o.id=?').get(+order_id); if (!o) throw new AppError(404, 'Order not found.');
    if (!o.approved) throw bad('Approve the order before issuing an invoice for it.');
    if (!o.business_name || !o.tin) throw bad('Set the registered business name and TIN for this store (Store list > BIR details) before issuing invoices.');
    const date = String(invoice_date || '').trim() || new Date().toISOString().slice(0, 10); if (!isoDate(date)) throw bad('Enter the invoice date.');
    let bt = String(buyer_tin || '').replace(/[\s-]/g, ''); if (bt) { if (!/^\d{9}(\d{3,5})?$/.test(bt)) throw bad('Buyer TIN must be 9 digits, plus the branch code if any.'); bt = bt.slice(0, 3) + '-' + bt.slice(3, 6) + '-' + bt.slice(6, 9) + (bt.length > 9 ? '-' + bt.slice(9) : ''); }
    return this.tx(() => {
      if (this.db.prepare('SELECT 1 FROM invoices WHERE order_id=? AND voided=0').get(o.id)) throw bad('This order already has an invoice. Void it first to issue a new one.');
      const lines = this.db.prepare('SELECT p.code,p.name,l.quantity,l.distributor_price FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=? AND l.voided=0 ORDER BY l.id').all(o.id); if (!lines.length) throw bad('This order has no active rows to invoice.');
      let cents = 0; for (const l of lines) cents += Math.round(l.distributor_price * 100) * l.quantity; const total = cents / 100, sp = this.vatSplit(total, o.vat_status);
      const seq = (this.db.prepare('SELECT COALESCE(MAX(seq),0) m FROM invoices WHERE store_id=?').get(o.store_id).m) + 1;
      const id = Number(this.db.prepare('INSERT INTO invoices (store_id,seq,order_id,invoice_date,seller_name,seller_tin,seller_address,vat_status,buyer_name,buyer_tin,buyer_address,vatable_sales,vat_amount,non_vat_sales,total,issued_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(o.store_id, seq, o.id, date, o.business_name, o.tin, o.address, o.vat_status, String(buyer_name || '').trim() || null, bt || null, String(buyer_address || '').trim() || null, sp.vatable_sales, sp.vat_amount, sp.non_vat_sales, total, u.id).lastInsertRowid);
      for (const l of lines) this.db.prepare('INSERT INTO invoice_lines (invoice_id,description,quantity,unit_price,amount) VALUES (?,?,?,?,?)').run(id, `${l.code} ${l.name}`, l.quantity, l.distributor_price, r2(l.quantity * l.distributor_price));
      this.audit(u.id, 'invoice_issued', `${invNo(seq)} store #${o.store_id} order ${o.order_no} total ${total}`); return { id, invoice_no: invNo(seq) };
    });
  }
  voidInvoice(u, id, reason) {
    this.admin(u); reason = String(reason || '').trim(); if (reason.length < 3) throw bad('Enter the reason for voiding this invoice.');
    const i = this.db.prepare('SELECT seq,voided FROM invoices WHERE id=?').get(+id); if (!i) throw new AppError(404, 'Invoice not found.'); if (i.voided) throw bad('This invoice is already voided.');
    this.db.prepare("UPDATE invoices SET voided=1, void_reason=?, voided_at=datetime('now','localtime'), voided_by=? WHERE id=?").run(reason, u.id, +id); this.audit(u.id, 'invoice_voided', `${invNo(i.seq)}: ${reason}`);
  }
  invoices(u, year) {
    this.admin(u); return this.db.prepare(`SELECT i.*,s.platform,s.name store,o.order_no,vu.name voided_by_name FROM invoices i JOIN stores s ON s.id=i.store_id JOIN orders o ON o.id=i.order_id LEFT JOIN users vu ON vu.id=i.voided_by WHERE substr(i.invoice_date,1,4)=? ORDER BY i.invoice_date DESC,i.store_id,i.seq DESC`).all(String(year)).map((r) => ({ ...r, invoice_no: invNo(r.seq) }));
  }
  invoice(u, id) {
    this.admin(u); const i = this.db.prepare('SELECT i.*,s.platform,s.name store,o.order_no FROM invoices i JOIN stores s ON s.id=i.store_id JOIN orders o ON o.id=i.order_id WHERE i.id=?').get(+id); if (!i) throw new AppError(404, 'Invoice not found.');
    return { ...i, invoice_no: invNo(i.seq), lines: this.db.prepare('SELECT description,quantity,unit_price,amount FROM invoice_lines WHERE invoice_id=? ORDER BY id').all(i.id) };
  }
  // used by the settlement import: rows are already validated there. Negative amounts are allowed (refund-heavy statements).
  insertImportedPayout(u, storeId, p) {
    return Number(this.db.prepare('INSERT INTO payouts (store_id,payout_date,reference,gross_sales,platform_fees,vouchers,shipping_adj,tax_withheld,net_received,note,source,entered_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(storeId, p.date, p.reference || null, p.gross_sales, p.platform_fees, p.vouchers, p.shipping_adj, p.tax_withheld, p.net_received, p.note || null, 'import', u.id).lastInsertRowid);
  }
  auditLog(u) { this.admin(u); return this.db.prepare('SELECT a.id,a.created_at,u.name,a.action,a.detail FROM audit_log a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').all(); }
}
module.exports = { App, AppError, STATUSES, REMARKS, PLATFORMS, r2, isoDate, invNo };
