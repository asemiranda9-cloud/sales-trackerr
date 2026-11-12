const test = require('node:test'); const assert = require('node:assert/strict'); const { startHost } = require('../src/server');
test('two clients share one database over HTTP; roles enforced', async () => {
  const h = await startHost({ file: ':memory:', port: 0, bind: '127.0.0.1' }); const base = `http://127.0.0.1:${h.port}`;
  const mk = () => { let ck = ''; return async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'X-ST': '1', 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: m === 'POST' ? JSON.stringify(b || {}) : undefined });
    const s = r.headers.get('set-cookie'); if (s) ck = s.split(';')[0]; return { s: r.status, j: await r.json() }; }; };
  const A = mk(), E = mk();
  assert.equal((await A('POST', '/api/setup', { name: 'A', email: 'a@x.com', password: 'longenough' })).s, 200);
  assert.equal((await A('GET', '/api/stores')).s, 401);
  await A('POST', '/api/login', { email: 'a@x.com', password: 'longenough' });
  const sid = (await A('POST', '/api/stores', { platform: 'Shopee', name: 'S1' })).j.id;
  await A('POST', '/api/users', { name: 'E', email: 'e@x.com', password: 'longenough', role: 'employee' });
  await E('POST', '/api/login', { email: 'e@x.com', password: 'longenough' });
  assert.equal((await E('POST', '/api/stores', { platform: 'Lazada', name: 'Z' })).s, 403);
  assert.equal((await E('POST', '/api/sheet/add', { store: sid, year: 2026, month: 11, order_no: 'O1', product_code: 'P', product_name: 'N', product_price: 2, quantity: 2 })).s, 200);
  const s = (await A('GET', `/api/sheet?store=${sid}&year=2026&month=11`)).j; assert.equal(s.rows.length, 1, 'admin sees employee row');
  assert.equal((await fetch(base + '/api/login', { method: 'POST', body: '{}' })).status, 400, 'CSRF header required');
  await h.close();
});
