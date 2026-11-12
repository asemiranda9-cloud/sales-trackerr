'use strict';
// Host mode: owns the SQLite file and serves other PCs over HTTP (JSON API). All permissions are enforced in core.js.
const http = require('http'); const path = require('path'); const fs = require('fs');
const { App, AppError } = require('./core');
const ex = require('./excel'); const bir = require('./bir'); const settle = require('./settle');
const UI = path.join(__dirname, '..', 'ui'); const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const ck = (req) => { const m = /(?:^|;\s*)st=([a-f0-9]+)/.exec(req.headers.cookie || ''); return m && m[1]; };
function createServer(app) {
  const R = {}; const def = (m, p, fn, pub) => { R[m + ' ' + p] = { fn, pub }; };
  def('GET', '/api/state', (c) => ({ needsSetup: app.needsSetup(), user: c.user }), true);
  def('POST', '/api/setup', (c, b) => ({ id: app.setup(b) }), true);
  def('POST', '/api/login', (c, b, res) => { const r = app.login(b.email, b.password); res.setHeader('Set-Cookie', `st=${r.token}; HttpOnly; SameSite=Strict; Path=/`); return { user: r.user }; }, true);
  def('POST', '/api/logout', (c, b, res) => { app.logout(c.token); res.setHeader('Set-Cookie', 'st=; Max-Age=0; Path=/'); return {}; }, true);
  def('GET', '/api/stores', (c, b, r, q) => app.stores(c.user, q.get('all') === '1'));
  def('POST', '/api/stores', (c, b) => ({ id: app.addStore(c.user, b) }));
  def('POST', '/api/stores/toggle', (c, b) => app.toggleStore(c.user, +b.id) || {});
  def('POST', '/api/stores/details', (c, b) => app.saveStoreDetails(c.user, { ...b, id: +b.id }) || {});
  def('GET', '/api/payouts', (c, b, r, q) => app.payouts(c.user, +q.get('year') || new Date().getFullYear()));
  def('POST', '/api/payouts', (c, b) => ({ id: app.addPayout(c.user, b) }));
  def('POST', '/api/payouts/void', (c, b) => app.voidPayout(c.user, +b.id) || {});
  def('POST', '/api/payouts/import/preview', async (c, b) => { const p = await settle.parseSettlement(app, c.user, b); return { ...p, groups: p.groups.slice(0, 500), truncated: p.groups.length > 500 }; });
  def('POST', '/api/payouts/import/commit', async (c, b) => settle.commitSettlement(app, c.user, await settle.parseSettlement(app, c.user, b), b.mode, b.filename));
  def('GET', '/api/invoices', (c, b, r, q) => app.invoices(c.user, +q.get('year') || new Date().getFullYear()));
  def('GET', '/api/invoices/get', (c, b, r, q) => app.invoice(c.user, +q.get('id')));
  def('POST', '/api/invoices', (c, b) => app.issueInvoice(c.user, { ...b, order_id: +b.order_id }));
  def('POST', '/api/invoices/void', (c, b) => app.voidInvoice(c.user, +b.id, b.reason) || {});
  def('GET', '/api/products', (c) => app.products(c.user));
  def('POST', '/api/products', (c, b) => ({ id: app.addProduct(c.user, b) }));
  def('POST', '/api/products/save', (c, b) => app.saveProduct(c.user, b) || {});
  def('GET', '/api/users', (c) => app.users(c.user));
  def('POST', '/api/users', (c, b) => ({ id: app.createUser(c.user, b) }));
  def('POST', '/api/users/toggle', (c, b) => app.toggleUser(c.user, +b.id) || {});
  def('GET', '/api/sheet', (c, b, r, q) => app.sheet(c.user, +q.get('store'), +q.get('year'), +q.get('month')));
  def('POST', '/api/sheet/add', (c, b) => app.addRow(c.user, +b.store, +b.year, +b.month, b));
  def('POST', '/api/sheet/approve', (c, b) => app.approve(c.user, +b.order_id, !!b.value) || {});
  def('POST', '/api/sheet/fix', (c, b) => app.requestFix(c.user, +b.order_id, b.note) || {});
  def('POST', '/api/sheet/resolve', (c, b) => app.resolveFix(c.user, +b.id) || {});
  def('POST', '/api/sheet/edit', (c, b) => app.editLine(c.user, +b.line_id, b) || {});
  def('POST', '/api/sheet/void', (c, b) => app.voidLine(c.user, +b.line_id, b.reason) || {});
  def('GET', '/api/voided', (c, b, r, q) => app.voidedLines(c.user, +q.get('year') || new Date().getFullYear()));
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    def('GET', '/api/template', async (c, b, res) => ({ __file: await ex.template(), type: XLSX, name: 'sales-tracker-template.xlsx' }));
  def('GET', '/api/export', async (c, b, res, q) => {
    const o = Object.fromEntries(q.entries()); if (o.line_ids) o.line_ids = o.line_ids.split(',').filter(Boolean);
    if (o.type === 'products') { const r = await ex.exportProducts(app, c.user); app.audit(c.user.id, 'excel_export', `products (${r.count})`); return { __file: r.buffer, type: XLSX, name: 'products.xlsx' }; }
    const BIR = { payouts: [bir.exportPayouts, 'payouts', 'Payouts'], journal: [bir.exportJournal, 'sales-journal', 'Sales journal'], invoices: [bir.exportInvoices, 'invoice-register', 'Invoice register'] };
    if (BIR[o.type]) { app.admin(c.user); const [fn, base, label] = BIR[o.type]; const r = await fn(app, c.user, o); app.audit(c.user.id, 'excel_export', `${label} ${o.year}${o.month ? '-' + o.month : ''} (${r.count} rows)`); return { __file: r.buffer, type: XLSX, name: `${base}-${o.year}${o.month ? '-' + String(o.month).padStart(2, '0') : ''}.xlsx` }; }
    if (o.type === 'einvoice') { app.admin(c.user); const r = bir.exportEinvoiceJson(app, c.user, o); app.audit(c.user.id, 'excel_export', `E-invoice data ${o.year} (${r.count} invoices)`); return { __file: r.buffer, type: 'application/json', name: `einvoice-data-${o.year}.json` }; }
    const r = await ex.exportSales(app, c.user, o); app.audit(c.user.id, 'excel_export', `sales ${JSON.stringify({ ...o, line_ids: o.line_ids ? o.line_ids.length : undefined })} (${r.count} rows)`);
    return { __file: r.buffer, type: XLSX, name: `sales-${o.year || 'all'}${o.month ? '-' + String(o.month).padStart(2, '0') : ''}.xlsx` }; });
  def('POST', '/api/import/preview', async (c, b) => { const p = await ex.parseImport(app, c.user, b); return { header: p.header, headerRow: p.headerRow, mapping: p.mapping, summary: p.summary, preview: p.preview, rows: p.rows.slice(0, 500), truncated: p.rows.length > 500 }; });
  def('POST', '/api/import/commit', async (c, b) => { const p = await ex.parseImport(app, c.user, b); return ex.commitImport(app, c.user, p, b.mode); });
  def('GET', '/api/backups', (c) => app.listBackups(c.user));
  def('POST', '/api/backups', (c) => ({ name: app.backupNow(c.user, 'manual') }));
  def('POST', '/api/restore', (c, b, res) => { const r = app.restore(c.user, b.name); res.setHeader('Set-Cookie', 'st=; Max-Age=0; Path=/'); return r; });
  def('GET', '/api/report', (c, b, r, q) => app.report(c.user, +q.get('year')));
  def('GET', '/api/audit', (c) => app.auditLog(c.user));
  return http.createServer(async (req, res) => {
    const send = (s, o) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) { const f = path.join(UI, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([\\/]\.\.?)+/, '')); if (!f.startsWith(UI) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(404, { error: 'Not found.' }); res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); return res.end(fs.readFileSync(f)); }
      const rt = R[req.method + ' ' + url.pathname];
      if (!rt) return send(404, { error: 'Not found.' });
      if (req.method === 'POST' && req.headers['x-st'] !== '1') return send(400, { error: 'Bad request.' }); // CSRF guard: custom header
      let body = {}; if (req.method === 'POST') { const ch = []; let n = 0; for await (const c of req) { n += c.length; if (n > 40e6) throw new AppError(413, 'Too large.'); ch.push(c); } try { body = JSON.parse(Buffer.concat(ch).toString() || '{}'); } catch { throw new AppError(400, 'Bad JSON.'); } }
      const token = ck(req), user = app.userFor(token);
      if (!rt.pub && !user) return send(401, { error: 'Please log in.' });
      const out = await rt.fn({ user, token }, body, res, url.searchParams);
      if (out && out.__file) { res.statusCode = 200; res.setHeader('Content-Type', out.type); if (out.name) res.setHeader('Content-Disposition', `attachment; filename="${out.name}"`); return res.end(out.__file); }
      send(200, out);
    } catch (e) { send(e.status || (e.userMessage ? 400 : 500), { error: e.status || e.userMessage ? e.message : 'Something went wrong.' }); if (!e.status && !e.userMessage) console.error(e); }
  });
}
function startHost({ file, port = 3737, bind = '0.0.0.0' }) {
  const app = new App(file), srv = createServer(app);
  if (app.backupDir) { const auto = () => { try { app.backupNow(null, 'auto'); } catch (e) { console.error('auto backup failed', e.message); } }; auto(); const t = setInterval(auto, 24 * 3600 * 1000); t.unref(); }
  return new Promise((ok) => srv.listen(port, bind, () => ok({ app, srv, port: srv.address().port, close: () => new Promise(r => srv.close(r)) })));
}
module.exports = { startHost, createServer };
if (require.main === module) startHost({ file: path.join(process.argv[2] || '.', 'sales-tracker.sqlite') }).then(h => console.log('Host listening on port', h.port));
