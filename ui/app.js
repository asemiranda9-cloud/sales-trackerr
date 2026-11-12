'use strict';
const $ = (s) => document.querySelector(s); const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const STATUSES = ['Shipping','Delivered','Failed Delivery','Return','Completed']; const REMARKS = ['Return Received','Paid'];
const fm = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
function h(tag, attrs, ...kids) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v); } for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; }
let ME = null;
async function api(method, url, body) { const r = await fetch(url, { method, headers: { 'X-ST': '1', 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; if (r.status === 401 && ME) { ME = null; route(); } throw e; } return j; }
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500); }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
function modal(content, small) { const m = $('#modal'); m.innerHTML = ''; m.append(h('div', { class: 'box' + (small ? ' s' : '') }, content)); m.classList.remove('hidden'); }
const closeModal = () => { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; };
const download = (url) => { const a = h('a', { href: url }); document.body.append(a); a.click(); a.remove(); };
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();

function shell(active, ...content) {
  const nav = (id, label, icon, hash) => h('a', { class: active === id ? 'on' : '', onclick: () => { location.hash = hash; } }, icon, h('span', {}, label));
  const adm = ME.role === 'admin';
  $('#app').replaceChildren(h('div', { class: 'layout' }, h('aside', { class: 'side' }, h('h1', {}, '📊 Sales Tracker'),
    nav('stores', 'Stores', '🏬', '#/'), adm && nav('reports', 'Reports', '📈', '#/reports'), adm && nav('products', 'Products', '📦', '#/products'), adm && nav('payouts', 'Payouts', '💰', '#/payouts'), adm && nav('invoices', 'Invoices', '📄', '#/invoices'), adm && nav('storeadmin', 'Store list', '⚙️', '#/storelist'),
    adm && nav('users', 'Users', '👥', '#/users'), adm && nav('audit', 'Audit log', '🧾', '#/audit'), adm && nav('backups', 'Backups', '💾', '#/backups'), h('div', { class: 'sp' }),
    h('div', { class: 'who' }, `${ME.name} (${ME.role})`), h('a', { onclick: guard(async () => { await api('POST', '/api/logout'); ME = null; route(); }) }, '🚪', h('span', {}, 'Log out'))),
    h('main', { class: 'main' }, ...content)));
}
// ---------- auth
function authView(setup) {
  const f = {}; const err = h('p', { class: 'err' });
  const inp = (k, label, type = 'text') => h('label', {}, label, f[k] = h('input', { type, required: true }));
  const go = guard(async () => { err.textContent = ''; try {
      if (setup) { await api('POST', '/api/setup', { name: f.name.value, email: f.email.value, password: f.password.value }); }
      const r = await api('POST', '/api/login', { email: f.email.value, password: f.password.value }); ME = r.user; location.hash = '#/'; route(); } catch (e) { err.textContent = e.message; } });
  $('#app').replaceChildren(h('div', { class: 'login' }, h('h2', {}, 'Sales Tracker'), h('p', { class: 'muted' }, setup ? 'First run: create the admin account.' : 'Log in with the account the admin created for you.'),
    err, setup && inp('name', 'Name'), inp('email', 'Email', 'email'), inp('password', setup ? 'Password (8+ characters)' : 'Password', 'password'), h('button', { onclick: go }, setup ? 'Create admin and log in' : 'Log in')));
  $('#app').querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
}
// ---------- stores / months
async function storesView() {
  const list = await api('GET', '/api/stores'); const by = { Lazada: [], Shopee: [], TikTok: [] }; list.forEach((s) => by[s.platform].push(s));
  shell('stores', h('h2', {}, 'Choose a store'), h('p', { class: 'sub' }, 'Pick a store, then a month.'),
    Object.entries(by).map(([p, ss]) => h('section', {}, h('h3', {}, p), ss.length ? h('div', { class: 'grid' }, ss.map((s) => h('div', { class: 'tile', onclick: () => { location.hash = `#/store/${s.id}`; } }, s.name))) : h('p', { class: 'muted' }, 'No stores yet.'))));
}
async function monthsView(id, year) {
  const stores = await api('GET', '/api/stores'); const s = stores.find((x) => x.id === id); if (!s) return (location.hash = '#/');
  year = year || new Date().getFullYear(); const nav = (d) => () => { location.hash = `#/store/${id}/${year + d}`; };
  shell('stores', h('p', { class: 'muted' }, h('a', { href: '#/' }, 'Stores'), ' / ', `${s.platform}: ${s.name}`), h('h2', {}, s.name),
    h('div', { class: 'bar' }, h('button', { class: 'sec', onclick: nav(-1) }, '‹ ' + (year - 1)), h('b', {}, year), h('button', { class: 'sec', onclick: nav(1) }, (year + 1) + ' ›')),
    h('div', { class: 'grid' }, MONTHS.map((m, i) => h('div', { class: 'tile', onclick: () => { location.hash = `#/sheet/${id}/${year}/${i + 1}`; } }, m))));
}
// ---------- sheet
async function sheetView(id, year, month) {
  const d = await api('GET', `/api/sheet?store=${id}&year=${year}&month=${month}`); const adm = ME.role === 'admin'; const products = await api('GET', '/api/products'); const known = Object.fromEntries(products.map((p) => [p.code.toLowerCase(), p]));
  const refresh = () => sheetView(id, year, month); const act = (fn, ok) => guard(async () => { await fn(); if (ok) toast(ok); refresh(); });
  const f = {}; const inp = (k, attrs = {}) => (f[k] = h('input', attrs)); const sel = (k, opts, blank) => (f[k] = h('select', {}, blank && h('option', { value: '' }), opts.map((o) => h('option', {}, o))));
  const total = h('td', { class: 'n' }); const upd = () => { const p = known[f.product_code.value.trim().toLowerCase()]; if (p) { f.product_name.value = p.name; f.product_price.value = p.distributor_price; f.product_name.readOnly = f.product_price.readOnly = true; } else { if (f.product_name.readOnly) { f.product_name.value = ''; f.product_price.value = ''; } f.product_name.readOnly = f.product_price.readOnly = false; } total.textContent = fm((parseFloat(f.product_price.value) || 0) * (parseInt(f.quantity.value, 10) || 0)); };
  const add = act(async () => { const b = { store: id, year, month }; for (const k of Object.keys(f)) b[k] = f[k].value; await api('POST', '/api/sheet/add', b); }, 'Row added. It shows as waiting until the admin approves it.');
  let n = 0, last = null; const sel_ids = new Set();
  const rows = d.rows.map((r) => { n++; const first = last !== r.order_id; last = r.order_id; const canInv = adm && first && !!r.approved;
    return h('tr', { class: r.voided ? 'err' : r.approved ? '' : 'wait' }, h('td', {}, h('input', { type: 'checkbox', style: 'width:auto;min-width:0', onchange: (e) => (e.target.checked ? sel_ids.add(r.line_id) : sel_ids.delete(r.line_id)) })),
      h('td', {}, n), h('td', { title: r.date_assumed ? 'No date was entered, so the app assumed this one. Edit the row to set the real sale date.' : '' }, (r.order_date || '') + (r.date_assumed ? ' *' : '')), h('td', {}, r.order_no), h('td', {}, r.tracking_no || ''), h('td', {}, r.code), h('td', {}, r.name), h('td', { class: 'n' }, fm(r.distributor_price)), h('td', { class: 'n' }, r.quantity), h('td', { class: 'n' }, fm(r.total)),
      h('td', { class: 'n' }, fm(r.retail_price)), h('td', { class: 'n' }, fm(r.paid_amount_customer)), h('td', { class: 'n' }, fm(r.received_amount)), h('td', { class: 'n' }, fm(r.price_adjustment)),
      h('td', {}, r.voided ? h('span', { class: 'pill s-return', title: r.void_reason || '' }, 'VOID') : h('span', { class: 'pill s-' + r.status.toLowerCase().replace(/ /g, '-') }, r.status)), h('td', {}, r.voided ? (r.void_reason || '') : r.remarks || ''),
      h('td', {}, r.voided ? 'Voided' : adm && first ? h('button', { class: 'sec', onclick: act(() => api('POST', '/api/sheet/approve', { order_id: r.order_id, value: !r.approved })) }, r.approved ? 'Approved' : 'Approve') : r.approved ? 'Approved' : 'Waiting'),
      h('td', {}, r.voided ? '' : adm ? [h('button', { class: 'sec', onclick: () => editModal(r, products, refresh) }, 'Edit'), ' ', h('button', { class: 'danger', onclick: () => { const reason = prompt('Why is this row being voided? (kept in the records)'); if (reason) act(() => api('POST', '/api/sheet/void', { line_id: r.line_id, reason }), 'Row voided.')(); } }, 'Void'), canInv && ' ', canInv && h('button', { class: 'sec', onclick: () => (r.invoice_id ? invoiceModal(r.invoice_id, refresh) : issueInvoiceModal(r, d.store, refresh)) }, r.invoice_id ? 'Invoice' : 'Issue invoice')]
        : first ? (r.fix_open ? 'Requested' : h('button', { class: 'sec', onclick: () => { const note = prompt('What needs to change?'); if (note) act(() => api('POST', '/api/sheet/fix', { order_id: r.order_id, note }), 'Fix requested.')(); } }, 'Request fix')) : ''));
  });
  const newRow = h('tr', { class: 'new' }, h('td'), h('td', {}, 'New'), h('td', {}, inp('order_date', { type: 'date' })), h('td', {}, inp('order_no', { placeholder: 'Order no.' })), h('td', {}, inp('tracking_no', { placeholder: 'Tracking no.' })), h('td', {}, inp('product_code', { placeholder: 'Code', list: 'plist', autocomplete: 'off' })),
    h('td', {}, inp('product_name', { placeholder: 'Product name' })), h('td', {}, inp('product_price', { type: 'number', step: '0.01', min: '0' })), h('td', {}, inp('quantity', { type: 'number', min: '1', value: '1' })), total,
    h('td', {}, inp('retail_price', { type: 'number', step: '0.01' })), h('td', {}, inp('paid_amount', { type: 'number', step: '0.01' })), h('td', {}, inp('received_amount', { type: 'number', step: '0.01' })),
    h('td', {}, adm ? inp('price_adjustment', { type: 'number', step: '0.01' }) : ''), h('td', {}, sel('status', STATUSES)), h('td', {}, sel('remarks', REMARKS, true)), h('td', {}, 'Waiting'), h('td', {}, h('button', { onclick: add }, 'Add row')));
  ['product_code', 'quantity', 'product_price'].forEach((k) => f[k].addEventListener('input', upd)); f.product_code.addEventListener('change', upd);
  const heads = ['', 'No.', 'Date of sale', 'Order number', 'Tracking no.', 'Product code', 'Product name', 'Distributor price', 'Qty', 'Total', 'Retail price', 'Paid by customer', 'Received', 'Price adjustment', 'Status', 'Remarks', 'Approved', adm ? 'Actions' : 'Fix'];
  shell('stores', h('p', { class: 'muted' }, h('a', { href: '#/' }, 'Stores'), ' / ', h('a', { href: `#/store/${id}/${year}` }, `${d.store.platform}: ${d.store.name}`), ' / ', MONTHS[month - 1], ' ', year), h('h2', {}, `${d.store.name}: ${MONTHS[month - 1]} ${year}`),
    d.totals && h('div', { class: 'cards' }, h('div', { class: 'card' }, h('p', {}, 'Approved sales'), h('b', {}, '₱' + fm(d.totals.approved_sales))), h('div', { class: 'card' }, h('p', {}, 'Orders waiting for approval'), h('b', {}, d.totals.waiting_orders)), h('div', { class: 'card' }, h('p', {}, 'Units sold (approved)'), h('b', {}, d.totals.units_sold))),
    h('div', { class: 'bar' }, h('button', { onclick: () => f.order_no.focus() }, '＋ Add New Record'), h('button', { class: 'sec', onclick: () => importWizard({ store_id: id, year, month }, refresh) }, '⬆ Import Excel'),
      h('button', { class: 'sec', onclick: () => exportModal({ store_id: id, year, month }, [...sel_ids]) }, '⬇ Export Excel'), h('button', { class: 'sec', onclick: () => download('/api/template') }, '📄 Download Template'),
      adm && h('button', { class: 'sec', onclick: () => { location.hash = `#/reports/${year}`; } }, '📈 View Reports')),
    h('datalist', { id: 'plist' }, products.map((p) => h('option', { value: p.code }, p.name))),
    h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x === false ? null : x)))), h('tbody', {}, !d.rows.length && h('tr', {}, h('td', { colspan: 18, class: 'muted' }, 'No rows yet. Add the first one in the blue row, or import an Excel file.')), rows, newRow))),
    adm && d.fixes.length > 0 && [h('h3', {}, 'Fix requests'), d.fixes.map((x) => h('p', {}, `Order ${x.order_no} · ${x.who}: ${x.note} `, h('button', { class: 'sec', onclick: act(() => api('POST', '/api/sheet/resolve', { id: x.id }), 'Marked as done.') }, 'Mark done')))],
    h('p', { class: 'muted' }, adm ? 'Tick rows to export only those. To add another product to the same order, use the same order number. A date marked * was not entered; edit the row to set the real sale date.' : 'Tick rows to export only those. Once a row is added, only the admin can change it. Use Request fix if something is wrong. To add another product to the same order, use the same order number. A date marked * was not entered.'));
}
function editModal(r, products, done) {
  const f = {}; const field = (k, label, v, attrs = {}) => h('label', {}, label, f[k] = h('input', { value: v ?? '', ...attrs }));
  f.product_id = h('select', {}, products.map((p) => h('option', { value: p.id, selected: p.code === r.code }, `${p.code} · ${p.name}`)));
  f.status = h('select', {}, STATUSES.map((s) => h('option', { selected: s === r.status }, s))); f.remarks = h('select', {}, h('option', { value: '' }), REMARKS.map((s) => h('option', { selected: s === r.remarks }, s)));
  modal([h('h3', {}, 'Edit row'), h('div', { class: 'row2' }, field('order_no', 'Order number', r.order_no), field('tracking_no', 'Tracking no.', r.tracking_no), h('label', {}, 'Product', f.product_id), field('distributor_price', 'Distributor price', r.distributor_price, { type: 'number', step: '0.01' }),
    field('quantity', 'Quantity', r.quantity, { type: 'number', min: '1' }), field('retail_price', 'Retail price', r.retail_price, { type: 'number', step: '0.01' }), field('paid_amount', 'Paid by customer', r.paid_amount_customer, { type: 'number', step: '0.01' }), field('received_amount', 'Received amount', r.received_amount, { type: 'number', step: '0.01' }),
    field('price_adjustment', 'Price adjustment', r.price_adjustment, { type: 'number', step: '0.01' }), field('order_date', 'Date of sale', r.order_date, { type: 'date' }), h('label', {}, 'Status', f.status), h('label', {}, 'Remarks', f.remarks)),
    h('div', { class: 'bar' }, h('button', { onclick: guard(async () => { const b = { line_id: r.line_id }; for (const k of Object.keys(f)) b[k] = f[k].value; await api('POST', '/api/sheet/edit', b); closeModal(); toast('Row updated.'); done(); }) }, 'Save changes'), h('button', { class: 'sec', onclick: closeModal }, 'Cancel'))]);
}
// ---------- export
async function exportModal(ctx, selected) {
  const adm = ME.role === 'admin'; const stores = await api('GET', '/api/stores'); const f = {};
  const s = (k, label, opts, v = '') => h('label', {}, label, f[k] = h('select', {}, h('option', { value: '' }, 'All'), opts.map(([val, t]) => h('option', { value: val, selected: String(val) === String(v) }, t))));
  const go = (extra) => { const o = { type: 'sales' }; for (const k of Object.keys(f)) o[k] = f[k].value; Object.assign(o, extra); closeModal(); download('/api/export?' + qs(o)); toast('Export started. Choose where to save the file.'); };
  modal([h('h3', {}, 'Export Excel'), h('div', { class: 'row2' }, s('store_id', 'Store', stores.map((x) => [x.id, `${x.platform}: ${x.name}`]), ctx.store_id), s('platform', 'Platform', ['Lazada', 'Shopee', 'TikTok'].map((x) => [x, x])),
    s('year', 'Year', [2024, 2025, 2026, 2027, 2028].map((x) => [x, x]), ctx.year), s('month', 'Month', MONTHS.map((m, i) => [i + 1, m]), ctx.month), s('status', 'Order status', STATUSES.map((x) => [x, x])), s('approved', 'Approval', [[1, 'Approved only'], [0, 'Waiting only']])),
    h('p', { class: 'muted' }, adm ? 'Admin exports also include a Summary sheet with approved totals.' : 'Employee exports contain the sales rows only.'),
    h('div', { class: 'bar' }, h('button', { onclick: () => go({}) }, 'Export sales'), selected.length > 0 && h('button', { class: 'sec', onclick: () => go({ line_ids: selected.join(',') }) }, `Export ${selected.length} selected row(s)`),
      adm && h('button', { class: 'sec', onclick: () => { closeModal(); download('/api/export?type=products'); } }, 'Export product list'), h('button', { class: 'sec', onclick: closeModal }, 'Close'))]);
}
// ---------- import wizard
function importWizard(ctx, done) {
  const st = { file: null, data: null, mapping: null, header: [], step: 1, mode: 'valid', defaults: { store_id: ctx.store_id, year: ctx.year, month: ctx.month } };
  const FIELDS = [['order_no', 'Order Number *'], ['tracking_no', 'Tracking Number'], ['product_code', 'Product Code *'], ['product_name', 'Product Name'], ['quantity', 'Quantity *'], ['distributor_price', 'Distributor Price'], ['retail_price', 'Retail Price'], ['paid_amount', 'Paid Amount'], ['received_amount', 'Received Amount'], ['price_adjustment', 'Price Adjustment (admin)'], ['status', 'Order Status'], ['remarks', 'Remarks'], ['store', 'Store'], ['platform', 'Platform'], ['year', 'Year'], ['month', 'Month / Date'], ['order_date', 'Order Date (day of sale)']];
  const stepsBar = () => h('div', { class: 'steps' }, ['1 Choose file', '2 Map columns', '3 Preview & fix', '4 Done'].map((t, i) => h('span', { class: st.step === i + 1 ? 'on' : '' }, t)));
  const body = () => ({ filename: st.file.name, data: st.data, mapping: st.mapping, defaults: st.defaults });
  const pickFile = () => { modal([h('h3', {}, 'Import Excel'), stepsBar(), h('p', {}, 'Choose an .xlsx or .csv file. Not sure about the layout? Download the template first.'),
    h('div', { class: 'bar' }, h('input', { type: 'file', accept: '.xlsx,.csv,.xls', onchange: guard(async (e) => { const file = e.target.files[0]; if (!file) return; if (file.size > 25e6) throw new Error('That file is too large (max 25 MB).');
      st.file = file; const buf = new Uint8Array(await file.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); st.data = btoa(bin); st.mapping = null;
      const p = await api('POST', '/api/import/preview', body()); st.p = p; st.mapping = p.mapping; st.header = p.header; mapStep(); }) }), h('button', { class: 'sec', onclick: () => download('/api/template') }, 'Download Template'), h('button', { class: 'sec', onclick: closeModal }, 'Cancel'))]); };
  const mapStep = () => { st.step = 2; const sels = {};
    const stores = []; api('GET', '/api/stores').then((x) => stores.push(...x)).finally(() => {});
    modal([h('h3', {}, 'Import Excel'), stepsBar(), h('p', { class: 'muted' }, `${st.file.name}: columns were matched automatically where possible. Check them and fix any that are wrong.`),
      h('div', { class: 'row2' }, FIELDS.filter(([k]) => k !== 'price_adjustment' || ME.role === 'admin').map(([k, label]) => h('label', {}, label, sels[k] = h('select', {}, h('option', { value: '' }, '(not in file)'), st.header.map((c, i) => h('option', { value: i, selected: st.mapping[k] === i }, c || `Column ${i + 1}`)))))),
      h('p', { class: 'muted' }, `Rows without their own store/month use: ${ctx.store_id ? 'the store and month you are viewing' : 'nothing (they will be flagged)'}.`),
      h('div', { class: 'bar' }, h('button', { onclick: guard(async () => { const m = {}; for (const [k, s] of Object.entries(sels)) if (s.value !== '') m[k] = +s.value; st.mapping = m; const p = await api('POST', '/api/import/preview', body()); st.p = p; previewStep(); }) }, 'Next: preview'), h('button', { class: 'sec', onclick: pickFile }, 'Back'))]); };
  const previewStep = () => { st.step = 3; const p = st.p, sm = p.summary;
    const mode = h('select', {}, h('option', { value: 'valid' }, 'Import valid rows only (skip duplicates and errors)'), ME.role === 'admin' && h('option', { value: 'update' }, 'Import valid rows and update existing duplicates'), h('option', { value: 'strict' }, 'Import only if every row is valid'));
    modal([h('h3', {}, 'Import Excel'), stepsBar(), h('div', { class: 'cards' }, [['Rows', sm.total], ['Ready', sm.ok], ['Duplicates', sm.duplicates], ['Errors', sm.errors]].map(([a, b]) => h('div', { class: 'card' }, h('p', {}, a), h('b', {}, b)))),
      p.truncated && h('p', { class: 'muted' }, 'Showing the first 500 rows. All rows are still checked and imported.'),
      h('div', { class: 'tw', style: 'max-height:38vh' }, h('table', {}, h('thead', {}, h('tr', {}, ['Row', 'Result', 'Order', 'Store', 'Month', 'Code', 'Qty', 'Details'].map((x) => h('th', {}, x)))), h('tbody', {}, p.rows.map((r) => h('tr', { class: r.state === 'error' ? 'err' : r.state === 'duplicate' ? 'dup' : '' }, h('td', {}, r.line), h('td', {}, r.state === 'ok' ? '✔ Ready' : r.state === 'duplicate' ? '⚠ Duplicate' : '✖ Error'), h('td', {}, r.order_no), h('td', {}, r.store), h('td', {}, r.month ? `${MONTHS[r.month - 1]} ${r.year || ''}` : ''), h('td', {}, r.product_code), h('td', { class: 'n' }, r.quantity ?? ''),
        h('td', {}, [...r.errors, ...(r.duplicate ? [r.duplicate === 'file' ? 'Repeated in this file' : 'Already in the database'] : []), ...r.warnings].join('; '))))))),
      sm.errors > 0 && h('p', { class: 'err' }, 'To fix errors: correct them in your Excel file and choose the file again, or import only the valid rows.'),
      h('label', {}, 'Import option', mode), h('div', { class: 'bar' }, h('button', { disabled: sm.ok + sm.duplicates === 0, onclick: guard(async () => { const r = await api('POST', '/api/import/commit', { ...body(), mode: mode.value }); st.res = r; doneStep(); }) }, 'Import now'),
        h('button', { class: 'sec', onclick: mapStep }, 'Back'), h('button', { class: 'sec', onclick: () => { closeModal(); toast('Import cancelled. Nothing was changed.'); } }, 'Cancel import'))]); };
  const doneStep = () => { st.step = 4; const r = st.res; modal([h('h3', {}, 'Import finished'), stepsBar(), h('div', { class: 'cards' }, [['Imported', r.imported], ['Updated', r.updated], ['Duplicates skipped', r.skipped_duplicates], ['Invalid skipped', r.skipped_errors]].map(([a, b]) => h('div', { class: 'card' }, h('p', {}, a), h('b', {}, b)))),
    h('p', { class: 'muted' }, 'Imported rows show as Waiting until an admin approves them. The import was saved in the audit log.'), h('button', { onclick: () => { closeModal(); done && done(); } }, 'Close')]); };
  pickFile();
}
// ---------- admin pages
async function productsView() {
  const list = await api('GET', '/api/products'); const f = {}; const re = () => productsView(); const act = (fn, ok) => guard(async () => { await fn(); toast(ok); re(); });
  shell('products', h('h2', {}, 'Products'), h('p', { class: 'sub' }, 'Employees pick a product by code. Changing a price here does not change rows already entered.'),
    h('div', { class: 'bar' }, h('button', { class: 'sec', onclick: () => download('/api/export?type=products') }, '⬇ Export product list')),
    h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, ['Code', 'Name', 'Distributor price', 'Status', ''].map((x) => h('th', {}, x)))), h('tbody', {}, list.map((p) => { const n = h('input', { value: p.name }), pr = h('input', { type: 'number', step: '0.01', min: '0', value: p.distributor_price });
      return h('tr', {}, h('td', {}, p.code), h('td', {}, n), h('td', {}, pr), h('td', {}, p.active ? 'Active' : 'Hidden'), h('td', {}, h('button', { class: 'sec', onclick: act(() => api('POST', '/api/products/save', { id: p.id, name: n.value, price: pr.value }), 'Product saved.') }, 'Save'), ' ', h('button', { class: 'sec', onclick: act(() => api('POST', '/api/products/toggle', { id: p.id }), 'Updated.') }, p.active ? 'Hide' : 'Show'))); })))),
    h('h3', {}, 'Add a product'), h('div', { class: 'row2' }, h('label', {}, 'Code', f.code = h('input')), h('label', {}, 'Name', f.name = h('input')), h('label', {}, 'Distributor price', f.price = h('input', { type: 'number', step: '0.01', min: '0' }))),
    h('button', { onclick: act(() => api('POST', '/api/products', { code: f.code.value, name: f.name.value, price: f.price.value }), 'Product added.') }, 'Add product'));
}
async function storeAdminView() {
  const list = await api('GET', '/api/stores?all=1'); const f = {}; const act = (fn, ok) => guard(async () => { await fn(); toast(ok); storeAdminView(); });
  const edit = (s) => { const d = {}; modal([h('h3', {}, `BIR details: ${s.platform} – ${s.name}`), h('p', { class: 'sub' }, 'Details of the registered business that owns this store. Shown on tax reports.'),
    h('label', {}, 'Registered business name', d.business_name = h('input', { value: s.business_name || '' })), h('label', {}, 'TIN (9 digits + branch code)', d.tin = h('input', { value: s.tin || '', placeholder: '123-456-789-00000' })),
    h('label', {}, 'Registered address', d.address = h('input', { value: s.address || '' })), h('label', {}, 'Tax type', d.vat_status = h('select', {}, ['VAT', 'non-VAT'].map((x) => h('option', { selected: x === s.vat_status }, x)))),
    h('div', { class: 'bar' }, h('button', { onclick: guard(async () => { await api('POST', '/api/stores/details', { id: s.id, business_name: d.business_name.value, tin: d.tin.value, address: d.address.value, vat_status: d.vat_status.value }); closeModal(); toast('Saved.'); storeAdminView(); }) }, 'Save'), h('button', { class: 'sec', onclick: closeModal }, 'Cancel'))], true); };
  shell('storeadmin', h('h2', {}, 'Store list'), h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, ['Platform', 'Store', 'Business name', 'TIN', 'Tax type', 'Status', ''].map((x) => h('th', {}, x)))), h('tbody', {}, list.map((s) => h('tr', {}, h('td', {}, s.platform), h('td', {}, s.name), h('td', {}, s.business_name || h('span', { class: 'muted' }, 'not set')), h('td', {}, s.tin || h('span', { class: 'muted' }, 'not set')), h('td', {}, s.vat_status), h('td', {}, s.active ? 'Active' : 'Hidden'), h('td', {}, h('button', { class: 'sec', onclick: () => edit(s) }, 'BIR details'), ' ', h('button', { class: 'sec', onclick: act(() => api('POST', '/api/stores/toggle', { id: s.id }), 'Updated.') }, s.active ? 'Hide' : 'Show'))))))),
    h('h3', {}, 'Add a store'), h('div', { class: 'row2' }, h('label', {}, 'Platform', f.platform = h('select', {}, ['Lazada', 'Shopee', 'TikTok'].map((x) => h('option', {}, x)))), h('label', {}, 'Store name', f.name = h('input'))),
    h('button', { onclick: act(() => api('POST', '/api/stores', { platform: f.platform.value, name: f.name.value }), 'Store added.') }, 'Add store'));
}
// ---------- payouts: what each platform actually paid out, and the tax it withheld
async function payoutsView(year) {
  year = year || new Date().getFullYear(); const [data, stores] = await Promise.all([api('GET', `/api/payouts?year=${year}`), api('GET', '/api/stores')]); const t = data.totals; const f = {};
  const FIELDS = [['gross_sales', 'Gross sales'], ['platform_fees', 'Platform fees'], ['vouchers', 'Vouchers'], ['shipping_adj', 'Shipping adj.'], ['tax_withheld', 'Tax withheld'], ['net_received', 'Net received (blank = auto)']];
  const add = guard(async () => { const b = { store: f.store.value, date: f.date.value, reference: f.reference.value, note: f.note.value }; for (const [k] of FIELDS) b[k] = f[k].value; await api('POST', '/api/payouts', b); toast('Payout recorded.'); payoutsView(year); });
  shell('payouts', h('h2', {}, 'Payouts'), h('p', { class: 'sub' }, 'What Lazada, Shopee and TikTok paid out, and the tax they withheld. Give the withheld total to the accountant as a tax credit.'),
    h('div', { class: 'bar' }, h('button', { class: 'sec', onclick: () => { location.hash = `#/payouts/${year - 1}`; } }, '‹ ' + (year - 1)), h('b', {}, year), h('button', { class: 'sec', onclick: () => { location.hash = `#/payouts/${year + 1}`; } }, (year + 1) + ' ›'), h('button', { onclick: () => settlementWizard(stores, () => payoutsView(year)) }, '⬆ Import settlement file'), h('button', { class: 'sec', onclick: () => download('/api/export?' + qs({ type: 'payouts', year })) }, '⬇ Export payouts to Excel')),
    h('div', { class: 'cards' }, [['Gross sales', t.gross_sales], ['Platform fees', t.platform_fees], ['Tax withheld', t.tax_withheld], ['Net received', t.net_received]].map(([l, v]) => h('div', { class: 'card' }, h('p', {}, l), h('b', {}, '₱' + fm(v)))),
      h('div', { class: 'card' }, h('p', {}, 'Tax withheld per quarter'), h('b', { style: 'font-size:14px' }, data.quarters.map((q, i) => `Q${i + 1}: ₱${fm(q)}`).join('  ')))),
    h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Platform', 'Store', 'Reference', 'Gross', 'Fees', 'Vouchers', 'Shipping', 'Tax withheld', 'Net received', ''].map((x) => h('th', {}, x)))), h('tbody', {}, !data.rows.length && h('tr', {}, h('td', { colspan: 11, class: 'muted' }, 'No payouts recorded for this year.')),
      data.rows.map((r) => h('tr', { class: r.voided ? 'err' : '' }, h('td', {}, r.payout_date), h('td', {}, r.platform), h('td', {}, r.store), h('td', {}, r.reference || ''), ...['gross_sales', 'platform_fees', 'vouchers', 'shipping_adj', 'tax_withheld', 'net_received'].map((k) => h('td', { class: 'n' }, fm(r[k]))),
        h('td', {}, r.voided ? 'VOID' : h('button', { class: 'danger', onclick: guard(async () => { if (!confirm('Void this payout? It stays in the records marked VOID.')) return; await api('POST', '/api/payouts/void', { id: r.id }); toast('Voided.'); payoutsView(year); }) }, 'Void'))))))),
    h('h3', {}, 'Record a payout'),
    h('div', { class: 'row2' }, h('label', {}, 'Store', f.store = h('select', {}, stores.map((s) => h('option', { value: s.id }, `${s.platform} – ${s.name}`)))), h('label', {}, 'Payout date', f.date = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) }))),
    h('div', { class: 'row2' }, h('label', {}, 'Platform reference / statement no.', f.reference = h('input')), h('label', {}, 'Note', f.note = h('input'))),
    h('div', { class: 'row2' }, FIELDS.map(([k, l]) => h('label', {}, l, f[k] = h('input', { type: 'number', step: '0.01', min: '0' })))),
    h('button', { onclick: add }, 'Save payout'));
}
async function reportsView(year) {
  year = year || new Date().getFullYear(); const [rows, voided] = await Promise.all([api('GET', `/api/report?year=${year}`), api('GET', `/api/voided?year=${year}`)]);
  const tot = rows.reduce((a, r) => ({ s: a.s + Math.round(r.approved_sales * 100), u: a.u + r.units_sold, w: a.w + r.waiting_orders, v: a.v + Math.round(r.vat_amount * 100) }), { s: 0, u: 0, w: 0, v: 0 });
  const th = (arr) => h('thead', {}, h('tr', {}, arr.map((x) => h('th', {}, x))));
  shell('reports', h('h2', {}, 'Reports'), h('div', { class: 'bar' }, h('button', { class: 'sec', onclick: () => { location.hash = `#/reports/${year - 1}`; } }, '‹ ' + (year - 1)), h('b', {}, year), h('button', { class: 'sec', onclick: () => { location.hash = `#/reports/${year + 1}`; } }, (year + 1) + ' ›'),
    h('button', { onclick: () => download('/api/export?' + qs({ year })) }, '⬇ Export year to Excel'), h('button', { class: 'sec', onclick: () => exportModal({ year }, []) }, 'More export options'), h('button', { class: 'sec', onclick: () => download('/api/export?' + qs({ type: 'journal', year })) }, '⬇ Sales journal (Excel)')),
    h('div', { class: 'cards' }, h('div', { class: 'card' }, h('p', {}, 'Approved sales'), h('b', {}, '₱' + fm(tot.s / 100))), h('div', { class: 'card' }, h('p', {}, 'VAT included in sales (VAT stores)'), h('b', {}, '₱' + fm(tot.v / 100))), h('div', { class: 'card' }, h('p', {}, 'Units sold'), h('b', {}, tot.u)), h('div', { class: 'card' }, h('p', {}, 'Orders waiting'), h('b', {}, tot.w))),
    h('div', { class: 'tw' }, h('table', {}, th(['Platform', 'Store', 'Business name', 'TIN', 'Month', 'Orders', 'Waiting', 'Units sold', 'Approved sales', 'VATable sales', 'VAT (12%)', 'Non-VAT sales']), h('tbody', {}, !rows.length && h('tr', {}, h('td', { colspan: 12, class: 'muted' }, 'No records for this year.')),
      rows.map((r) => h('tr', {}, h('td', {}, r.platform), h('td', {}, r.store), h('td', {}, r.business_name || h('span', { class: 'muted' }, 'not set')), h('td', {}, r.tin || h('span', { class: 'muted' }, 'not set')), h('td', {}, MONTHS[r.month - 1]), h('td', { class: 'n' }, r.orders), h('td', { class: 'n' }, r.waiting_orders), h('td', { class: 'n' }, r.units_sold), h('td', { class: 'n' }, fm(r.approved_sales)), h('td', { class: 'n' }, fm(r.vatable_sales)), h('td', { class: 'n' }, fm(r.vat_amount)), h('td', { class: 'n' }, fm(r.non_vat_sales))))))),
    h('p', { class: 'sub' }, 'VAT is worked out only for stores marked VAT, assuming the sales prices already include 12% VAT. Confirm this with the accountant. Set the store tax type under Store list.'),
    h('h3', {}, `Voided rows (${voided.length})`), h('div', { class: 'tw' }, h('table', {}, th(['Voided on', 'Platform', 'Store', 'Month', 'Order number', 'Product', 'Amount', 'Reason', 'By']), h('tbody', {}, !voided.length && h('tr', {}, h('td', { colspan: 9, class: 'muted' }, 'No voided rows this year.')),
      voided.map((v) => h('tr', { class: 'err' }, h('td', {}, v.voided_at), h('td', {}, v.platform), h('td', {}, v.store), h('td', {}, MONTHS[v.month - 1]), h('td', {}, v.order_no), h('td', {}, v.code), h('td', { class: 'n' }, fm(v.amount)), h('td', {}, v.void_reason), h('td', {}, v.voided_by || '')))))));
}
// ---------- users, audit log, backups (admin)
async function usersView() {
  const list = await api('GET', '/api/users'); const f = {}; const act = (fn, ok) => guard(async () => { await fn(); toast(ok); usersView(); });
  shell('users', h('h2', {}, 'Users'), h('p', { class: 'sub' }, 'Employees can add rows and request fixes. Only admins approve, edit, void and see totals. A disabled user is locked out immediately.'),
    h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Email', 'Role', 'Status', ''].map((x) => h('th', {}, x)))), h('tbody', {}, list.map((u) => h('tr', {}, h('td', {}, u.name), h('td', {}, u.email), h('td', {}, u.role), h('td', {}, u.active ? 'Active' : 'Disabled'),
      h('td', {}, u.id === ME.id ? h('span', { class: 'muted' }, 'you') : h('button', { class: 'sec', onclick: act(() => api('POST', '/api/users/toggle', { id: u.id }), 'Updated.') }, u.active ? 'Disable' : 'Enable'))))))),
    h('h3', {}, 'Add a user'), h('div', { class: 'row2' }, h('label', {}, 'Name', f.name = h('input')), h('label', {}, 'Email', f.email = h('input', { type: 'email' })), h('label', {}, 'Password (8+ characters)', f.password = h('input', { type: 'password' })),
      h('label', {}, 'Role', f.role = h('select', {}, h('option', { value: 'employee' }, 'Employee'), h('option', { value: 'admin' }, 'Admin')))),
    h('button', { onclick: act(() => api('POST', '/api/users', { name: f.name.value, email: f.email.value, password: f.password.value, role: f.role.value }), 'User added.') }, 'Add user'));
}
async function auditView() {
  const rows = await api('GET', '/api/audit');
  shell('audit', h('h2', {}, 'Audit log'), h('p', { class: 'sub' }, 'The latest 500 actions: who did what and when. Voids, approvals, invoices, imports and exports are all recorded.'),
    h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Who', 'Action', 'Details'].map((x) => h('th', {}, x)))), h('tbody', {}, !rows.length && h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'Nothing recorded yet.')), rows.map((r) => h('tr', {}, h('td', {}, r.created_at), h('td', {}, r.name), h('td', {}, r.action), h('td', {}, r.detail || '')))))));
}
async function backupsView() {
  const list = await api('GET', '/api/backups'); const kb = (n) => (n / 1024 < 1024 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  shell('backups', h('h2', {}, 'Backups'), h('p', { class: 'sub' }, 'A backup is made automatically at every start and daily (the newest 14 are kept). Also copy the backups folder to a USB drive or cloud storage now and then.'),
    h('div', { class: 'bar' }, h('button', { onclick: guard(async () => { const r = await api('POST', '/api/backups'); toast('Backup created: ' + r.name); backupsView(); }) }, '💾 Back up now')),
    h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, ['Backup', 'Size', ''].map((x) => h('th', {}, x)))), h('tbody', {}, !list.length && h('tr', {}, h('td', { colspan: 3, class: 'muted' }, 'No backups yet.')),
      list.map((b) => h('tr', {}, h('td', {}, b.name), h('td', { class: 'n' }, kb(b.size)), h('td', {}, h('button', { class: 'danger', onclick: guard(async () => { if (!confirm(`Restore ${b.name}?\n\nEverything entered after this backup will be replaced. A safety copy of the current data is made first, and everyone is logged out.`)) return; const r = await api('POST', '/api/restore', { name: b.name }); ME = null; toast('Restored. Safety copy: ' + r.safety_backup); route(); }) }, 'Restore'))))))));
}
// ---------- settlement import: a Lazada / Shopee / TikTok income or statement file becomes payout records
function settlementWizard(stores, done) {
  const st = { file: null, data: null, store_id: stores[0] && stores[0].id, p: null, mapping: null, headerRow: null, sheet: null, date: '', mode: 'valid' };
  const STEPS = ['1 Choose file', '2 Check columns', '3 Preview', '4 Done']; const steps = (n) => h('div', { class: 'steps' }, STEPS.map((t, i) => h('span', { class: n === i + 1 ? 'on' : '' }, t)));
  const body = () => ({ filename: st.file.name, data: st.data, store_id: st.store_id, mapping: st.mapping || undefined, headerRow: st.headerRow === null ? undefined : st.headerRow, sheet: st.sheet || undefined, defaults: { date: st.date } });
  const pick = () => { const sel = h('select', {}, stores.map((s) => h('option', { value: s.id, selected: s.id === st.store_id }, `${s.platform} – ${s.name}`)));
    modal([h('h3', {}, 'Import settlement file'), steps(1), h('p', {}, 'Download the income / settlement / statement report from Lazada, Shopee or TikTok Seller Center (.xlsx or .csv) and choose it here. The columns are matched by their names; you check them in the next step, so nothing is guessed silently.'),
      h('label', {}, 'Store this file belongs to', sel), h('div', { class: 'bar' }, h('input', { type: 'file', accept: '.xlsx,.csv', onchange: guard(async (e) => { const file = e.target.files[0]; if (!file) return; if (file.size > 25e6) throw new Error('That file is too large (max 25 MB).');
        st.store_id = +sel.value; st.file = file; const buf = new Uint8Array(await file.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); st.data = btoa(bin); st.mapping = null; st.headerRow = null; st.sheet = null;
        st.p = await api('POST', '/api/payouts/import/preview', body()); st.mapping = st.p.mapping; mapStep(); }) }), h('button', { class: 'sec', onclick: closeModal }, 'Cancel'))]); };
  const reread = guard(async () => { st.p = await api('POST', '/api/payouts/import/preview', { ...body(), mapping: undefined }); st.mapping = st.p.mapping; mapStep(); });
  const mapStep = () => { const p = st.p, sels = {}, m = st.mapping || {}; const one = [['date', 'Payout / release date'], ['reference', 'Statement or payout number'], ['order', 'Order number (information only)'], ['gross', 'Gross sales / item price'], ['net', 'Net amount released to you']];
    const many = [['fees', 'Platform fees (commission, transaction, service)'], ['vouchers', 'Vouchers / discounts you paid'], ['shipping', 'Shipping adjustments'], ['tax', 'Tax withheld by the platform']];
    const opts = (k, multi) => p.header.map((c, i) => h('option', { value: i, selected: multi ? (m[k] || []).includes(i) : m[k] === i }, c || `Column ${i + 1}`));
    const hdrIn = h('input', { type: 'number', min: '1', value: p.headerRow + 1, style: 'width:90px' }), shIn = p.sheets.length > 1 && h('select', {}, p.sheets.map((n) => h('option', { selected: n === p.sheet }, n))), dIn = h('input', { type: 'date', value: st.date });
    modal([h('h3', {}, 'Import settlement file'), steps(2), h('p', { class: 'muted' }, `${st.file.name}: choose which column holds what. Fee, voucher, shipping and tax columns can have several columns selected (hold Ctrl); they are added together. Whether the file writes deductions as negative or positive numbers is detected automatically.`),
      h('div', { class: 'bar' }, shIn && h('label', {}, 'Worksheet', shIn), h('label', {}, 'Header row number', hdrIn), h('button', { class: 'sec', onclick: () => { st.sheet = shIn ? shIn.value : null; st.headerRow = Math.max(0, (parseInt(hdrIn.value, 10) || 1) - 1); st.date = dIn.value; reread(); } }, 'Re-read with these')),
      h('div', { class: 'row2' }, one.map(([k, l]) => h('label', {}, l, sels[k] = h('select', {}, h('option', { value: '' }, '(not in file)'), opts(k, false)))), many.map(([k, l]) => h('label', {}, l, sels[k] = h('select', { multiple: true, size: 4 }, opts(k, true)))),
        h('label', {}, 'Payout date for the whole file (only used when the file has no date column or a row has none)', dIn)),
      p.needsMapping && h('p', { class: 'err' }, p.needsMapping),
      h('div', { class: 'bar' }, h('button', { onclick: guard(async () => { const mm = {}; for (const [k] of one) if (sels[k].value !== '') mm[k] = +sels[k].value; for (const [k] of many) { const v = [...sels[k].selectedOptions].map((o) => +o.value); if (v.length) mm[k] = v; } st.mapping = mm; st.date = dIn.value;
        st.p = await api('POST', '/api/payouts/import/preview', body()); if (st.p.needsMapping) { mapStep(); return; } previewStep(); }) }, 'Next: preview'), h('button', { class: 'sec', onclick: pick }, 'Back'))]); };
  const previewStep = () => { const p = st.p, sm = p.summary, t = p.totals; const modeSel = h('select', {}, h('option', { value: 'valid' }, 'Import the valid statements (skip duplicates and problem rows)'), h('option', { value: 'strict' }, 'Import only if every row is valid'));
    modal([h('h3', {}, `Import settlement file: ${p.store.platform} – ${p.store.name}`), steps(3),
      h('div', { class: 'cards' }, [['Rows read', sm.rows], ['Payouts to create', sm.ok], ['Already recorded', sm.duplicates], ['Rows with problems', sm.row_errors]].map(([a, b]) => h('div', { class: 'card' }, h('p', {}, a), h('b', {}, b)))),
      h('div', { class: 'cards' }, [['Gross sales', t.gross_sales], ['Platform fees', t.platform_fees], ['Tax withheld', t.tax_withheld], ['Net received', t.net_received]].map(([a, b]) => h('div', { class: 'card' }, h('p', {}, a + ' (new payouts)'), h('b', {}, '₱' + fm(b))))),
      sm.summary_rows_skipped > 0 && h('p', { class: 'muted' }, `${sm.summary_rows_skipped} total/summary row(s) in the file were ignored.`),
      h('p', { class: 'muted' }, 'Each statement (date + statement number) becomes one payout. If the file has no statement number, each date becomes one payout. Compare these totals with the platform’s own summary before importing.'),
      h('div', { class: 'tw', style: 'max-height:32vh' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Statement', 'Rows', 'Orders', 'Gross', 'Fees', 'Vouchers', 'Shipping', 'Tax withheld', 'Net', 'Result'].map((x) => h('th', {}, x)))),
        h('tbody', {}, !p.groups.length && h('tr', {}, h('td', { colspan: 11, class: 'muted' }, 'Nothing to import.')), p.groups.map((g) => h('tr', { class: g.warnings.length ? 'dup' : g.state === 'duplicate' ? 'dup' : '' }, h('td', {}, g.date), h('td', {}, g.reference || ''), h('td', { class: 'n' }, g.rows), h('td', { class: 'n' }, g.orders), ...['gross_sales', 'platform_fees', 'vouchers', 'shipping_adj', 'tax_withheld', 'net_received'].map((k) => h('td', { class: 'n' }, fm(g[k]))),
          h('td', {}, g.state === 'duplicate' ? '⚠ Already recorded' : g.warnings.length ? '⚠ ' + g.warnings.join(' ') : '✔ Ready')))))),
      p.issues.length > 0 && [h('p', { class: 'err' }, `${sm.row_errors} row(s) have problems and will be skipped:`), h('div', { class: 'tw', style: 'max-height:16vh' }, h('table', {}, h('tbody', {}, p.issues.slice(0, 50).map((x) => h('tr', { class: 'err' }, h('td', {}, 'Line ' + x.line), h('td', {}, x.message))))))],
      h('label', {}, 'Import option', modeSel), h('div', { class: 'bar' }, h('button', { disabled: sm.ok === 0, onclick: guard(async () => { st.res = await api('POST', '/api/payouts/import/commit', { ...body(), mode: modeSel.value }); doneStep(); }) }, 'Import now'), h('button', { class: 'sec', onclick: mapStep }, 'Back'), h('button', { class: 'sec', onclick: () => { closeModal(); toast('Import cancelled. Nothing was changed.'); } }, 'Cancel import'))]); };
  const doneStep = () => { const r = st.res; modal([h('h3', {}, 'Import finished'), steps(4), h('div', { class: 'cards' }, [['Payouts added', r.imported], ['Already recorded (skipped)', r.skipped_duplicates], ['Problem rows skipped', r.skipped_rows]].map(([a, b]) => h('div', { class: 'card' }, h('p', {}, a), h('b', {}, b)))),
    h('p', { class: 'muted' }, 'The payouts are on the Payouts page and the import is in the audit log. A wrong payout can be voided there, and the same file can then be imported again.'), h('button', { onclick: () => { closeModal(); done && done(); } }, 'Close')]); };
  pick();
}
// ---------- invoices
async function invoicesView(year) {
  year = year || new Date().getFullYear(); const list = await api('GET', `/api/invoices?year=${year}`); const refresh = () => invoicesView(year); const live = list.filter((i) => !i.voided);
  const sum = (k) => live.reduce((a, i) => a + Math.round(i[k] * 100), 0) / 100; const th = (arr) => h('thead', {}, h('tr', {}, arr.map((x) => h('th', {}, x))));
  shell('invoices', h('h2', {}, 'Invoices'), h('p', { class: 'sub' }, 'Issue an invoice from the store sheet: open the month, approve the order, then use “Issue invoice” on its first row. Invoices are numbered per store and are voided, never deleted.'),
    h('div', { class: 'bar' }, h('button', { class: 'sec', onclick: () => { location.hash = `#/invoices/${year - 1}`; } }, '‹ ' + (year - 1)), h('b', {}, year), h('button', { class: 'sec', onclick: () => { location.hash = `#/invoices/${year + 1}`; } }, (year + 1) + ' ›'),
      h('button', { onclick: () => download('/api/export?' + qs({ type: 'invoices', year })) }, '⬇ Invoice register (Excel)'), h('button', { class: 'sec', onclick: () => download('/api/export?' + qs({ type: 'einvoice', year })) }, '⬇ E-invoice data (JSON)')),
    h('div', { class: 'cards' }, [['Invoices issued', live.length], ['VATable sales', '₱' + fm(sum('vatable_sales'))], ['VAT (12%)', '₱' + fm(sum('vat_amount'))], ['Total invoiced', '₱' + fm(sum('total'))]].map(([a, b]) => h('div', { class: 'card' }, h('p', {}, a), h('b', {}, b)))),
    h('div', { class: 'tw' }, h('table', {}, th(['Invoice no.', 'Date', 'Platform', 'Store', 'Order', 'Buyer', 'VATable', 'VAT (12%)', 'Non-VAT', 'Total', 'Status', '']), h('tbody', {}, !list.length && h('tr', {}, h('td', { colspan: 12, class: 'muted' }, 'No invoices for this year.')),
      list.map((i) => h('tr', { class: i.voided ? 'err' : '' }, h('td', {}, i.invoice_no), h('td', {}, i.invoice_date), h('td', {}, i.platform), h('td', {}, i.store), h('td', {}, i.order_no), h('td', {}, i.buyer_name || ''), h('td', { class: 'n' }, fm(i.vatable_sales)), h('td', { class: 'n' }, fm(i.vat_amount)), h('td', { class: 'n' }, fm(i.non_vat_sales)), h('td', { class: 'n' }, fm(i.total)), h('td', {}, i.voided ? 'VOID' : 'Active'), h('td', {}, h('button', { class: 'sec', onclick: () => invoiceModal(i.id, refresh) }, 'Open'))))))),
    h('p', { class: 'sub' }, 'These invoices are the business’s own records. To hand one to a customer or claim it for BIR, it must be printed on BIR-registered stationery or issued through a BIR-registered system; ask the accountant. The e-invoice file is generic data, not the official BIR EIS layout.'));
}
function issueInvoiceModal(r, store, done) {
  const f = {}; const today = new Date(); const d0 = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  modal([h('h3', {}, `Issue invoice: order ${r.order_no}`), h('p', { class: 'sub' }, `${store.platform}: ${store.name}. Amounts come from the approved rows of this order. The buyer details are optional (marketplace buyers are usually anonymous).`),
    h('label', {}, 'Invoice date', f.invoice_date = h('input', { type: 'date', value: r.order_date || d0 })), h('label', {}, 'Buyer name', f.buyer_name = h('input')), h('label', {}, 'Buyer TIN (optional)', f.buyer_tin = h('input')), h('label', {}, 'Buyer address (optional)', f.buyer_address = h('input')),
    h('div', { class: 'bar' }, h('button', { onclick: guard(async () => { const b = { order_id: r.order_id }; for (const k of Object.keys(f)) b[k] = f[k].value; const x = await api('POST', '/api/invoices', b); toast(`Invoice ${x.invoice_no} issued.`); done && done(); invoiceModal(x.id, done); }) }, 'Issue invoice'), h('button', { class: 'sec', onclick: closeModal }, 'Cancel'))], true);
}
async function invoiceModal(id, done) {
  const i = await api('GET', `/api/invoices/get?id=${id}`); const vat = i.vat_status === 'VAT';
  modal([h('div', { class: 'printable' }, h('h3', { style: 'margin:0' }, i.seller_name), h('p', { style: 'margin:2px 0' }, `TIN ${i.seller_tin} · ${vat ? 'VAT-registered' : 'Non-VAT'}`), i.seller_address && h('p', { style: 'margin:2px 0' }, i.seller_address),
    h('h2', { style: 'margin:14px 0 2px' }, vat ? 'SALES INVOICE' : 'SALES INVOICE (non-VAT)'), h('p', { style: 'margin:2px 0' }, h('b', {}, i.invoice_no), `   Date: ${i.invoice_date}   Order: ${i.order_no}   (${i.platform}: ${i.store})`),
    i.voided && h('p', { class: 'err', style: 'font-weight:700;font-size:18px' }, `VOID: ${i.void_reason || ''}`), h('p', { style: 'margin:8px 0' }, `Sold to: ${i.buyer_name || 'Walk-in / marketplace buyer'}${i.buyer_tin ? ' · TIN ' + i.buyer_tin : ''}${i.buyer_address ? ' · ' + i.buyer_address : ''}`),
    h('table', {}, h('thead', {}, h('tr', {}, ['Description', 'Qty', 'Unit price', 'Amount'].map((x) => h('th', {}, x)))), h('tbody', {}, i.lines.map((l) => h('tr', {}, h('td', {}, l.description), h('td', { class: 'n' }, l.quantity), h('td', { class: 'n' }, fm(l.unit_price)), h('td', { class: 'n' }, fm(l.amount)))),
      vat && h('tr', {}, h('td', { colspan: 3, class: 'n' }, 'VATable sales'), h('td', { class: 'n' }, fm(i.vatable_sales))), vat && h('tr', {}, h('td', { colspan: 3, class: 'n' }, 'VAT (12%)'), h('td', { class: 'n' }, fm(i.vat_amount))), !vat && h('tr', {}, h('td', { colspan: 3, class: 'n' }, 'Non-VAT sales'), h('td', { class: 'n' }, fm(i.non_vat_sales))),
      h('tr', {}, h('td', { colspan: 3, class: 'n' }, h('b', {}, 'TOTAL')), h('td', { class: 'n' }, h('b', {}, '₱' + fm(i.total)))))),
    h('p', { class: 'muted', style: 'font-size:11px' }, vat ? 'Prices include 12% VAT.' : 'Not subject to VAT.')),
    h('p', { class: 'muted noprint' }, 'Print this only on BIR-registered invoice stationery, or use it as a record. Ask the accountant if unsure.'),
    h('div', { class: 'bar noprint' }, h('button', { onclick: () => window.print() }, '🖨 Print'), !i.voided && h('button', { class: 'danger', onclick: guard(async () => { const reason = prompt('Why is this invoice being voided? (kept in the records; the number is not reused)'); if (!reason) return; await api('POST', '/api/invoices/void', { id: i.id, reason }); toast('Invoice voided.'); closeModal(); done && done(); }) }, 'Void invoice'), h('button', { class: 'sec', onclick: () => { closeModal(); done && done(); } }, 'Close'))]);
}
// ---------- router
async function route() {
  closeModal();
  try {
    const s = await api('GET', '/api/state'); ME = s.user; if (!ME) return authView(s.needsSetup);
    const p = (location.hash || '#/').slice(1).split('/').filter(Boolean); const a = p.map((x) => (/^\d+$/.test(x) ? +x : x));
    if (!a.length) return storesView(); if (a[0] === 'store') return monthsView(a[1], a[2]); if (a[0] === 'sheet') return sheetView(a[1], a[2], a[3]);
    const adminOnly = { products: productsView, storelist: storeAdminView, users: usersView, audit: auditView, backups: backupsView, reports: () => reportsView(a[1]), payouts: () => payoutsView(a[1]), invoices: () => invoicesView(a[1]) };
    if (adminOnly[a[0]]) { if (ME.role !== 'admin') { location.hash = '#/'; return; } return adminOnly[a[0]](); } location.hash = '#/';
  } catch (e) { toast(e.message, true); }
}
window.addEventListener('hashchange', route); route();
