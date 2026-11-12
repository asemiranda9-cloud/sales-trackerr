'use strict';
const { DatabaseSync } = require('node:sqlite');
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','employee')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL CHECK (platform IN ('Lazada','Shopee','TikTok')), name TEXT NOT NULL COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1, UNIQUE (platform, name));
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, distributor_price REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL REFERENCES stores(id), year INTEGER NOT NULL, month INTEGER NOT NULL,
  order_no TEXT NOT NULL COLLATE NOCASE, tracking_no TEXT,
  status TEXT NOT NULL DEFAULT 'Shipping' CHECK (status IN ('Shipping','Delivered','Failed Delivery','Return','Completed')),
  remarks TEXT CHECK (remarks IS NULL OR remarks IN ('Return Received','Paid')),
  approved INTEGER NOT NULL DEFAULT 0, approved_by INTEGER REFERENCES users(id), approved_at TEXT, entered_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS idx_period ON orders (store_id, year, month, order_no);
CREATE TABLE IF NOT EXISTS order_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1), distributor_price REAL NOT NULL, retail_price REAL, paid_amount_customer REAL, received_amount REAL, price_adjustment REAL);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL REFERENCES stores(id), payout_date TEXT NOT NULL, reference TEXT,
  gross_sales REAL NOT NULL DEFAULT 0, platform_fees REAL NOT NULL DEFAULT 0, vouchers REAL NOT NULL DEFAULT 0, shipping_adj REAL NOT NULL DEFAULT 0, tax_withheld REAL NOT NULL DEFAULT 0, net_received REAL NOT NULL DEFAULT 0,
  note TEXT, voided INTEGER NOT NULL DEFAULT 0, entered_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS idx_payout_date ON payouts (store_id, payout_date);
CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL REFERENCES stores(id), seq INTEGER NOT NULL, order_id INTEGER NOT NULL REFERENCES orders(id), invoice_date TEXT NOT NULL,
  seller_name TEXT NOT NULL, seller_tin TEXT NOT NULL, seller_address TEXT, vat_status TEXT NOT NULL, buyer_name TEXT, buyer_tin TEXT, buyer_address TEXT,
  vatable_sales REAL NOT NULL DEFAULT 0, vat_amount REAL NOT NULL DEFAULT 0, non_vat_sales REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT, voided_at TEXT, voided_by INTEGER REFERENCES users(id), issued_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), UNIQUE (store_id, seq));
CREATE TABLE IF NOT EXISTS invoice_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoices(id), description TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, amount REAL NOT NULL);
CREATE TABLE IF NOT EXISTS correction_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, requested_by INTEGER NOT NULL REFERENCES users(id), note TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
`;
exports.open = (file) => {
  const d = new DatabaseSync(file);
  if (file !== ':memory:') d.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  d.exec('PRAGMA foreign_keys = ON;'); d.exec(SCHEMA);
  // upgrade older databases: add the BIR store-detail columns when missing (existing data is kept)
  const addCols = (table, cols) => { const have = d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); for (const [c, def] of cols) if (!have.includes(c)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${c} ${def}`); };
  addCols('stores', [['business_name', 'TEXT'], ['tin', 'TEXT'], ['address', 'TEXT'], ['vat_status', "TEXT NOT NULL DEFAULT 'non-VAT'"]]);
  addCols('order_lines', [['voided', 'INTEGER NOT NULL DEFAULT 0'], ['void_reason', 'TEXT'], ['voided_at', 'TEXT'], ['voided_by', 'INTEGER']]);
  addCols('orders', [['order_date', 'TEXT'], ['date_assumed', 'INTEGER NOT NULL DEFAULT 0']]);
  addCols('payouts', [['source', 'TEXT']]);
  // orders made before step 3 have no real sale date: use the day they were entered and mark it as assumed
  d.exec("UPDATE orders SET order_date = substr(created_at,1,10), date_assumed = 1 WHERE order_date IS NULL");
  d.exec('CREATE INDEX IF NOT EXISTS idx_invoice_order ON invoices (order_id)');
  return d;
};
