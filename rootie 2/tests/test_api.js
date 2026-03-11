/**
 * Rootie — API Test Script
 *
 * Run with: npm test
 * Requires the server to be running locally on PORT 3000.
 * Set ADMIN_API_KEY in your .env before running.
 */

require('dotenv').config();
const http = require('http');

const BASE_URL   = `http://localhost:${process.env.PORT || 3000}`;
const ADMIN_KEY  = process.env.ADMIN_API_KEY || 'test-key';
let passed = 0, failed = 0;

async function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;
    const opts    = {
      hostname: url.hostname,
      port:     url.port || 3000,
      path:     url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function test(name, fn) {
  return fn().then(() => {
    console.log(`  ✅ ${name}`);
    passed++;
  }).catch(err => {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  console.log('\n🌱 Rootie API Tests\n');

  // ── Health check ──────────────────────────────────────────────────────────
  console.log('Health');
  await test('GET /health returns 200', async () => {
    const res = await request('GET', '/health');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'ok', 'Expected status: ok');
  });

  // ── Webhook verification ──────────────────────────────────────────────────
  console.log('\nWebhook');
  await test('GET /webhook verifies with correct token', async () => {
    const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'kindroots2024';
    const res = await request('GET',
      `/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=TESTCHALLENGE`
    );
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body === 'TESTCHALLENGE', 'Expected challenge echo');
  });

  await test('GET /webhook rejects wrong token', async () => {
    const res = await request('GET',
      '/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=X'
    );
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // ── Admin auth ────────────────────────────────────────────────────────────
  console.log('\nAdmin Auth');
  await test('GET /admin/stats rejects without key', async () => {
    const res = await request('GET', '/admin/stats');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('GET /admin/stats returns stats with valid key', async () => {
    const res = await request('GET', '/admin/stats', null, { 'x-admin-key': ADMIN_KEY });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(typeof res.body.total_users === 'number', 'Expected total_users');
  });

  // ── Admin users ───────────────────────────────────────────────────────────
  console.log('\nAdmin Users');
  await test('GET /admin/users returns user list', async () => {
    const res = await request('GET', '/admin/users', null, { 'x-admin-key': ADMIN_KEY });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body.users), 'Expected users array');
  });

  await test('GET /admin/users/:phone returns 404 for unknown number', async () => {
    const res = await request('GET', '/admin/users/+999999999', null, { 'x-admin-key': ADMIN_KEY });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  console.log('\nReports');
  await test('GET /reports/growth/:userId/:childId returns 404 for unknown child', async () => {
    const res = await request('GET', '/reports/growth/999/999', null, { 'x-admin-key': ADMIN_KEY });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('⚠️  Some tests failed — check server logs for details');
    process.exit(1);
  } else {
    console.log('🌱 All tests passed!');
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
