/**
 * LAN security smoke test — remote auth, signed QR links, upload isolation,
 * session coexistence, CSRF rejection, and login throttling.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SECURITY_SMOKE_PORT || 3856);
const DATA_DIR = path.join(ROOT, 'data', '.security-smoke-test');
const PIN = 'Security-Smoke-3856';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(pathname, options = {}) {
  const body = options.body == null
    ? null
    : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body));
  const headers = { ...(options.headers || {}) };
  if (body) headers['Content-Length'] = body.length;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: pathname,
      method: options.method || 'GET',
      headers,
      localAddress: options.remote === false ? '127.0.0.1' : (options.localAddress || '127.0.0.2')
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buffer.toString('utf8')); } catch { /* non-JSON response */ }
        resolve({ status: res.statusCode, headers: res.headers, buffer, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForHealth(attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await request('/api/health', { remote: false });
      if (response.status === 200 && response.json?.ok) return;
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Security test server did not become healthy');
}

async function login(localAddress = '127.0.0.2') {
  const response = await request('/api/auth/login', {
    method: 'POST',
    localAddress,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN })
  });
  assert(response.status === 200, `owner login failed: ${response.status}`);
  const setCookie = response.headers['set-cookie']?.[0] || '';
  assert(setCookie.includes('HttpOnly'), 'owner cookie must be HttpOnly');
  assert(setCookie.includes('SameSite=Strict'), 'owner cookie must be SameSite=Strict');
  return setCookie.split(';')[0];
}

function multipartImage(filename = 'probe.html') {
  const boundary = `----StudioSecurity${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n`
    + 'Content-Type: image/png\r\n\r\n'
  );
  const content = Buffer.from('<script>throw new Error("must never execute")</script>', 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function main() {
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const env = {
    ...process.env,
    PORT: String(PORT),
    STUDIO_DATA_DIR: DATA_DIR,
    STUDIO_SKIP_UPDATE_CHECK: '1'
  };

  await new Promise((resolve, reject) => {
    const seed = spawn('node', ['seed.js', '--force'], { cwd: ROOT, env, stdio: 'ignore' });
    seed.on('close', code => code === 0 ? resolve() : reject(new Error(`seed failed: ${code}`)));
  });
  const server = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    await waitForHealth();
    const setup = await request('/api/auth/setup', {
      remote: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    assert(setup.status === 200, 'local owner PIN setup failed');

    const remoteHealth = await request('/api/health');
    assert(remoteHealth.status === 200, 'remote health should remain reachable');
    assert(Object.keys(remoteHealth.json || {}).sort().join(',') === 'ok,version', 'remote health leaked inventory or filesystem details');
    assert((await request('/api/items')).status === 401, 'remote inventory should require owner login');
    assert((await request('/api/public/items/1')).status === 403, 'unsigned item QR endpoint should be denied');
    assert((await request('/photo-upload.html?id=1')).status === 200, 'phone upload sign-in page should load remotely');
    console.log('✓ unauthenticated LAN access is limited');

    const cookieOne = await login('127.0.0.2');
    const cookieTwo = await login('127.0.0.3');
    assert((await request('/api/items', { headers: { Cookie: cookieOne } })).status === 200,
      'second device login invalidated the first device');
    assert((await request('/api/items', { localAddress: '127.0.0.3', headers: { Cookie: cookieTwo } })).status === 200,
      'second owner session is not valid');
    console.log('✓ independent phone and tablet sessions coexist');

    const scanLink = await request('/api/items/1/scan-link', { headers: { Cookie: cookieOne } });
    assert(scanLink.status === 200 && scanLink.json?.accessToken, 'signed scan link missing');
    const signedPublic = await request(`/api/public/items/1?access=${encodeURIComponent(scanLink.json.accessToken)}`);
    assert(signedPublic.status === 200 && signedPublic.json?.id === 1, 'signed item QR access failed');
    console.log('✓ item QR links require an unguessable signature');

    const multipart = multipartImage();
    const uploaded = await request('/api/items/1/photos', {
      method: 'POST',
      headers: { Cookie: cookieOne, 'Content-Type': multipart.contentType },
      body: multipart.body
    });
    assert(uploaded.status === 201 && uploaded.json?.[0]?.relative_path, 'authenticated photo upload failed');
    const storedPath = uploaded.json[0].relative_path;
    assert(storedPath.endsWith('.png'), `client-controlled HTML extension was retained: ${storedPath}`);
    assert((await request(`/uploads/${storedPath}`)).status === 401, 'uploaded file was public without authentication');
    const protectedFile = await request(`/uploads/${storedPath}`, { headers: { Cookie: cookieOne } });
    assert(protectedFile.status === 200, 'owner could not read uploaded photo');
    assert(protectedFile.headers['content-type']?.startsWith('image/png'), 'photo was not served as its validated image type');
    assert(protectedFile.headers['x-content-type-options'] === 'nosniff', 'upload response lacks nosniff');
    console.log('✓ forged image filenames cannot become same-origin HTML');

    const crossSite = await request('/api/items/1', {
      method: 'PUT',
      headers: {
        Cookie: cookieOne,
        Origin: 'https://attacker.invalid',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'Cross-site write' })
    });
    assert(crossSite.status === 403, 'cross-site authenticated write was not rejected');
    console.log('✓ cross-site writes are rejected');

    for (let i = 0; i < 4; i++) {
      const wrong = await request('/api/auth/login', {
        method: 'POST',
        localAddress: '127.0.0.4',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: 'wrong-pin' })
      });
      assert(wrong.status === 401, `wrong PIN attempt ${i + 1} returned ${wrong.status}`);
    }
    const limited = await request('/api/auth/login', {
      method: 'POST',
      localAddress: '127.0.0.4',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: 'wrong-pin' })
    });
    assert(limited.status === 429 && limited.headers['retry-after'], 'PIN attempts were not rate-limited');
    console.log('✓ repeated PIN guessing is rate-limited');

    console.log('\nSecurity smoke test passed.');
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 500));
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* Windows lock cleanup */ }
  }
}

main().catch(error => {
  console.error('\nSecurity smoke test FAILED:', error.message);
  process.exit(1);
});
