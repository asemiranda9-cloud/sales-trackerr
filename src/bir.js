'use strict';
// Excel / JSON exports for the accountant: payouts, sales journal, invoice register, e-invoice data. Admin only.
const xl = require('./xl'); const { S, colName } = xl;
const { r2, invNo } = require('./core');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (n) => (n === null || n === undefined ? '' : { v: n, s: S.money });
const H = (arr) => arr.map((h) => ({ v: h, s: S.header }));
const yearOf = (o) => { const y = +o.year; if (!(y >= 2020 && y <= 2100)) { const e = new Error('Choose a year.'); e.userMessage = true; throw e; } return y; };

// One data sheet: title row, note row, header row, data rows, blank row, totals row with live SUM / SUMIFS formulas.
// cols: [{ h, w, num?:true (money, summed), int?:true, key:(row)=>value }]; statusCol = index of the Active/VOID column or -1
function dataSheet(name, title, note, cols, data, statusCol, extraTotals = []) {
  const first = 4, last = first + data.length - 1, rows = [[{ v: title, s: S.title }], [{ v: note, s: S.note }], H(cols.map((c) => c.h))];
  for (const d of data) rows.push(cols.map((c) => { const v = c.key(d); if (c.num) return money(v); if (c.int) return { v, s: S.int }; return v === null || v === undefined ? '' : v; }));
  if (data.length) {
    rows.push([]); const t = cols.map(() => ''); t[0] = { v: statusCol >= 0 ? 'Total (excluding VOID)' : 'Total', s: S.bold };
    cols.forEach((c, i) => { if (!c.num) return; const L = colName(i), sum = data.reduce((a, d) => a + Math.round((statusCol >= 0 && d.__void ? 0 : c.key(d) || 0) * 100), 0) / 100;
      t[i] = { f: statusCol >= 0 ? `SUMIFS(${L}${first}:${L}${last},${colName(statusCol)}${first}:${colName(statusCol)}${last},"Active")` : `SUM(${L}${first}:${L}${last})`, v: sum, s: S.moneyBold }; });
    rows.push(t); for (const x of extraTotals) rows.push(x);
  }
  return { name, widths: cols.map((c) => c.w), rows, filter: data.length > 0, filterEnd: data.length ? last : undefined, headerRow: 3 };
}

// ---------- payouts
async function exportPayouts(app, u, o) {
  const year = yearOf(o), p = app.payouts(u, year); const stores = new Map(app.stores(u, true).map((s) => [s.id, s]));
  const data = p.rows.map((r) => ({ ...r, __void: !!r.voided, biz: (stores.get(r.store_id) || {}).business_name || '' }));
  const cols = [{ h: 'Payout date', w: 13, key: (d) => d.payout_date }, { h: 'Platform', w: 10, key: (d) => d.platform }, { h: 'Store', w: 22, key: (d) => d.store }, { h: 'Registered business', w: 28, key: (d) => d.biz }, { h: 'TIN', w: 18, key: (d) => d.tin || '' },
    { h: 'Statement / reference', w: 22, key: (d) => d.reference || '' }, { h: 'Gross sales', w: 15, num: true, key: (d) => d.gross_sales }, { h: 'Platform fees', w: 15, num: true, key: (d) => d.platform_fees }, { h: 'Vouchers', w: 14, num: true, key: (d) => d.vouchers },
    { h: 'Shipping adj.', w: 14, num: true, key: (d) => d.shipping_adj }, { h: 'Tax withheld', w: 15, num: true, key: (d) => d.tax_withheld }, { h: 'Net received', w: 16, num: true, key: (d) => d.net_received },
    { h: 'Status', w: 9, key: (d) => (d.voided ? 'VOID' : 'Active') }, { h: 'Entered by', w: 11, key: (d) => (d.source === 'import' ? 'File import' : 'Manual') }, { h: 'Note', w: 36, key: (d) => d.note || '' }];
  const sheet1 = dataSheet('Payouts', `Marketplace payouts ${year}`, 'Voided payouts are listed but excluded from the totals.', cols, data, 12);
  // tax withheld per store and quarter (credit the accountant claims against income tax)
  const by = new Map(); for (const d of data) { if (d.voided) continue; const k = d.store_id; const g = by.get(k) || by.set(k, { d, q: [0, 0, 0, 0], gross: 0, net: 0 }).get(k); const q = Math.floor((+d.payout_date.slice(5, 7) - 1) / 3); g.q[q] = r2(g.q[q] + d.tax_withheld); g.gross = r2(g.gross + d.gross_sales); g.net = r2(g.net + d.net_received); }
  const qr = [[{ v: `Tax withheld by the platforms, per quarter, ${year}`, s: S.title }], [{ v: 'Active payouts only. Give this to the accountant together with the platform tax certificates (BIR Form 2307).', s: S.note }], H(['Platform', 'Store', 'Registered business', 'TIN', 'Q1 (Jan-Mar)', 'Q2 (Apr-Jun)', 'Q3 (Jul-Sep)', 'Q4 (Oct-Dec)', 'Year total', 'Gross sales', 'Net received'])];
  const list = [...by.values()].sort((a, b) => a.d.platform.localeCompare(b.d.platform) || a.d.store.localeCompare(b.d.store));
  list.forEach((g, i) => { const r = i + 4; qr.push([g.d.platform, g.d.store, g.d.biz, g.d.tin || '', ...g.q.map(money), { f: `SUM(E${r}:H${r})`, v: r2(g.q.reduce((a, b) => a + b, 0)), s: S.money }, money(g.gross), money(g.net)]); });
  if (list.length) { const e = list.length + 3, t = ['Total', '', '', '']; ['E', 'F', 'G', 'H', 'I', 'J', 'K'].forEach((L, i) => { const idx = [0, 1, 2, 3].includes(i) ? list.reduce((a, g) => a + g.q[i], 0) : i === 4 ? list.reduce((a, g) => a + g.q.reduce((x, y) => x + y, 0), 0) : i === 5 ? list.reduce((a, g) => a + g.gross, 0) : list.reduce((a, g) => a + g.net, 0); t.push({ f: `SUM(${L}4:${L}${e})`, v: r2(idx), s: S.moneyBold }); }); qr.push([]); qr.push(t); }
  return { buffer: await xl.writeXlsx([sheet1, { name: 'Tax withheld by quarter', widths: [10, 22, 28, 18, 15, 15, 15, 15, 15, 15, 15], rows: qr, headerRow: 3 }]), count: data.length };
}

// ---------- sales journal: one line per approved sale row, by date, with the monthly VAT split like the Reports page
async function exportJournal(app, u, o) {
  app.admin(u); const year = yearOf(o), w = ['l.voided = 0', 'o.approved = 1', 'o.year = ?'], a = [year];
  if (o.store_id) { w.push('o.store_id = ?'); a.push(+o.store_id); } if (o.month) { w.push('o.month = ?'); a.push(+o.month); }
  const data = app.db.prepare(`SELECT o.order_date,o.date_assumed,o.order_no,o.month,s.platform,s.name store,s.business_name,s.tin,s.vat_status,p.code,p.name pname,l.quantity,l.distributor_price,
      (SELECT i.seq FROM invoices i WHERE i.order_id=o.id AND i.voided=0 LIMIT 1) inv_seq
    FROM order_lines l JOIN orders o ON o.id=l.order_id JOIN stores s ON s.id=o.store_id JOIN products p ON p.id=l.product_id WHERE ${w.join(' AND ')} ORDER BY o.order_date,s.platform,s.name,o.id,l.id`).all(...a);
  const cols = [{ h: 'Date of sale', w: 13, key: (d) => d.order_date || '' }, { h: 'Date source', w: 12, key: (d) => (d.date_assumed ? 'Assumed' : 'Entered') }, { h: 'Platform', w: 10, key: (d) => d.platform }, { h: 'Store', w: 22, key: (d) => d.store },
    { h: 'Registered business', w: 28, key: (d) => d.business_name || '' }, { h: 'TIN', w: 18, key: (d) => d.tin || '' }, { h: 'Order number', w: 18, key: (d) => d.order_no }, { h: 'Invoice no.', w: 14, key: (d) => (d.inv_seq ? invNo(d.inv_seq) : '') },
    { h: 'Product code', w: 14, key: (d) => d.code }, { h: 'Description', w: 30, key: (d) => d.pname }, { h: 'Qty', w: 7, int: true, key: (d) => d.quantity }, { h: 'Unit price', w: 14, num: true, key: (d) => d.distributor_price },
    { h: 'Amount', w: 15, num: true, key: (d) => r2(d.distributor_price * d.quantity) }, { h: 'Tax type', w: 10, key: (d) => d.vat_status }];
  // Amount is a live formula (qty x price); the total sums it
  const sheet = dataSheet('Sales journal', `Sales journal ${year}${o.month ? ' - ' + MONTHS[+o.month - 1] : ''}`, 'Approved, non-voided sales only, by date of sale. Amounts are as recorded; for VAT stores they include 12% VAT. Rows with Date source = Assumed have no sale date entered: confirm them.', cols, data, -1);
  data.forEach((d, i) => { const r = i + 4; sheet.rows[3 + i][12] = { f: `K${r}*L${r}`, v: r2(d.distributor_price * d.quantity), s: S.money }; });
  const rep = app.report(u, year).filter((r) => (!o.store_id || r.store_id === +o.store_id) && (!o.month || r.month === +o.month));
  const sr = [[{ v: `Monthly summary ${year}`, s: S.title }], [{ v: 'Same figures as the Reports page. VAT (12%) assumes sales prices already include VAT; confirm with the accountant.', s: S.note }],
    H(['Platform', 'Store', 'Registered business', 'TIN', 'Tax type', 'Month', 'Approved sales', 'VATable sales', 'VAT (12%)', 'Non-VAT sales'])];
  for (const r of rep) sr.push([r.platform, r.store, r.business_name || '', r.tin || '', r.vat_status, MONTHS[r.month - 1], money(r.approved_sales), money(r.vatable_sales), money(r.vat_amount), money(r.non_vat_sales)]);
  if (rep.length) { const e = rep.length + 3, t = ['Total', '', '', '', '', '']; [['G', 'approved_sales'], ['H', 'vatable_sales'], ['I', 'vat_amount'], ['J', 'non_vat_sales']].forEach(([L, k]) => t.push({ f: `SUM(${L}4:${L}${e})`, v: r2(rep.reduce((x, r) => x + r[k], 0)), s: S.moneyBold })); sr.push([]); sr.push(t); }
  const vd = app.voidedLines(u, year).filter((v) => !o.month || v.month === +o.month);
  const vr = [[{ v: `Voided rows ${year}`, s: S.title }], [{ v: 'Rows that were voided instead of deleted. Not counted anywhere above.', s: S.note }], H(['Voided on', 'Platform', 'Store', 'Month', 'Order number', 'Product', 'Amount', 'Reason', 'Voided by'])];
  for (const v of vd) vr.push([v.voided_at, v.platform, v.store, MONTHS[v.month - 1], v.order_no, v.code, money(v.amount), v.void_reason, v.voided_by || '']);
  return { buffer: await xl.writeXlsx([sheet, { name: 'Monthly summary', widths: [10, 22, 28, 18, 10, 12, 16, 16, 14, 16], rows: sr, headerRow: 3 }, { name: 'Voided rows', widths: [19, 10, 22, 12, 18, 14, 14, 36, 14], rows: vr, headerRow: 3 }]), count: data.length };
}

// ---------- invoice register
async function exportInvoices(app, u, o) {
  const year = yearOf(o), list = app.invoices(u, year).slice().sort((a, b) => a.store_id - b.store_id || a.seq - b.seq);
  const cols = [{ h: 'Invoice no.', w: 14, key: (d) => d.invoice_no }, { h: 'Invoice date', w: 13, key: (d) => d.invoice_date }, { h: 'Platform', w: 10, key: (d) => d.platform }, { h: 'Store', w: 20, key: (d) => d.store }, { h: 'Seller (registered business)', w: 28, key: (d) => d.seller_name },
    { h: 'Seller TIN', w: 18, key: (d) => d.seller_tin }, { h: 'Order number', w: 18, key: (d) => d.order_no }, { h: 'Buyer', w: 24, key: (d) => d.buyer_name || '' }, { h: 'Buyer TIN', w: 18, key: (d) => d.buyer_tin || '' },
    { h: 'VATable sales', w: 15, num: true, key: (d) => d.vatable_sales }, { h: 'VAT (12%)', w: 14, num: true, key: (d) => d.vat_amount }, { h: 'Non-VAT sales', w: 15, num: true, key: (d) => d.non_vat_sales }, { h: 'Total', w: 15, num: true, key: (d) => d.total },
    { h: 'Status', w: 9, key: (d) => (d.voided ? 'VOID' : 'Active') }, { h: 'Void reason', w: 30, key: (d) => d.void_reason || '' }];
  const data = list.map((d) => ({ ...d, __void: !!d.voided }));
  const sheet = dataSheet('Invoices', `Invoice register ${year}`, 'Voided invoices keep their number and are listed, but excluded from the totals.', cols, data, 13);
  const lr = [[{ v: `Invoice lines ${year}`, s: S.title }], [{ v: 'One row per product line of each invoice.', s: S.note }], H(['Invoice no.', 'Status', 'Description', 'Qty', 'Unit price', 'Amount'])];
  for (const i of list) for (const l of app.invoice(u, i.id).lines) lr.push([i.invoice_no, i.voided ? 'VOID' : 'Active', l.description, { v: l.quantity, s: S.int }, money(l.unit_price), money(l.amount)]);
  return { buffer: await xl.writeXlsx([sheet, { name: 'Invoice lines', widths: [14, 9, 40, 8, 14, 15], rows: lr, headerRow: 3 }]), count: list.length };
}

// ---------- e-invoice data (JSON). Generic structure with everything an e-invoicing provider asks for; NOT the official BIR EIS schema.
function exportEinvoiceJson(app, u, o) {
  const year = yearOf(o), list = app.invoices(u, year).slice().sort((a, b) => a.store_id - b.store_id || a.seq - b.seq);
  const out = { format: 'sales-tracker-einvoice-v1', notice: 'Generic invoice data for an accountant or e-invoicing provider. This is not the official BIR EIS file format; ask the provider what layout they need.', year, generated_at: new Date().toISOString(), currency: 'PHP',
    invoices: list.map((i) => { const d = app.invoice(u, i.id); return { invoice_no: d.invoice_no, invoice_date: d.invoice_date, status: d.voided ? 'VOID' : 'ACTIVE', void_reason: d.void_reason || null, platform: d.platform, store: d.store, order_no: d.order_no,
      seller: { name: d.seller_name, tin: d.seller_tin, address: d.seller_address || null, vat_registered: d.vat_status === 'VAT' }, buyer: { name: d.buyer_name || null, tin: d.buyer_tin || null, address: d.buyer_address || null },
      lines: d.lines, totals: { vatable_sales: d.vatable_sales, vat_amount: d.vat_amount, non_vat_sales: d.non_vat_sales, total: d.total } }; }) };
  return { buffer: Buffer.from(JSON.stringify(out, null, 2), 'utf8'), count: list.length };
}
module.exports = { exportPayouts, exportJournal, exportInvoices, exportEinvoiceJson };
