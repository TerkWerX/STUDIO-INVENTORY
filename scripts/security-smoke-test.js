/**
 * LAN security smoke test — remote auth, signed QR links, upload isolation,
 * session coexistence, CSRF rejection, login throttling, and the local trust
 * boundary (other sites, DNS rebinding, proxies), upload paths, guest data,
 * CSP, manual snippets, and settings-file recovery.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SECURITY_SMOKE_PORT || 3856);
const DATA_DIR = path.join(ROOT, 'data', '.security-smoke-test');
const KEY_DIR = path.join(ROOT, 'data', '.security-smoke-keys');
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

function multipartFile({ field = 'files', filename = 'probe.bin', type = 'application/octet-stream', content = 'probe' } = {}) {
  const boundary = `----StudioSecurity${Date.now()}${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n`
    + `Content-Type: ${type}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, Buffer.isBuffer(content) ? content : Buffer.from(content), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

/** Smallest valid one-page PDF with a line of text (for the manual indexer). */
function minimalPdf(text) {
  const escaped = String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
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
  fs.rmSync(KEY_DIR, { recursive: true, force: true });
  fs.mkdirSync(KEY_DIR, { recursive: true });
  const env = {
    ...process.env,
    PORT: String(PORT),
    STUDIO_DATA_DIR: DATA_DIR,
    STUDIO_KEY_DIR: KEY_DIR,
    STUDIO_SKIP_UPDATE_CHECK: '1',
    STUDIO_SKIP_AUTO_BACKUP: '1'
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

    // --- The studio computer itself is not a blank cheque for other websites ---
    for (const headers of [
      { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'http://localhost:8080', 'Sec-Fetch-Site': 'same-site' },
      { Origin: 'null' }
    ]) {
      const planted = await request('/api/import/csv', {
        remote: false,
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'text/plain' },
        body: 'name\nPlanted by another website'
      });
      assert(planted.status === 403, `cross-site write from the studio computer returned ${planted.status}`);
    }
    const localItems = await request('/api/items?q=Planted', { remote: false });
    assert(localItems.status === 200 && localItems.json.length === 0, 'a cross-site CSV import reached the catalog');
    console.log('✓ other websites cannot write through a browser on the studio computer');

    const rebound = await request('/api/export/full', { remote: false, headers: { Host: `attacker.invalid:${PORT}` } });
    assert(rebound.status === 403, `public DNS name in Host was served (${rebound.status})`);
    for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `studio-pc:${PORT}`, `studio-pc.local:${PORT}`, `192.168.1.20:${PORT}`]) {
      const allowed = await request('/api/health', { remote: false, headers: { Host: host } });
      assert(allowed.status === 200, `LAN-style Host ${host} was refused`);
    }
    console.log('✓ DNS-rebinding host names are refused');

    const proxied = await request('/api/items', { remote: false, headers: { 'X-Forwarded-For': '203.0.113.9' } });
    assert(proxied.status === 401, `a proxied request inherited studio-computer trust (${proxied.status})`);
    console.log('✓ requests through a local reverse proxy still need the owner PIN');

    // --- Record ids cannot steer where uploads land ---
    const escapeName = `escape-probe-${Date.now()}`;
    const bat = multipartFile({ field: 'file', filename: 'payload.bat', content: '@echo off\r\n' });
    const traversal = await request(`/api/items/..%2F..%2F..%2F..%2F${escapeName}/software/upload`, {
      method: 'POST',
      headers: { Cookie: cookieOne, 'Content-Type': bat.contentType },
      body: bat.body
    });
    assert(traversal.status === 404, `traversal item id was accepted (${traversal.status})`);
    for (let up = 0; up <= 5; up++) {
      const candidate = path.resolve(DATA_DIR, 'uploads', 'software', ...Array(up).fill('..'), escapeName);
      assert(!fs.existsSync(candidate), `upload escaped the data folder: ${candidate}`);
    }
    const ghost = await request('/api/items/987654/photos', {
      method: 'POST',
      headers: { Cookie: cookieOne, 'Content-Type': multipartImage('ghost.png').contentType },
      body: multipartImage('ghost.png').body
    });
    assert(ghost.status === 404, `upload to a missing item returned ${ghost.status}`);
    assert(!fs.existsSync(path.join(DATA_DIR, 'uploads', 'photos', '987654')), 'upload to a missing item created a folder');
    console.log('✓ upload routes reject crafted and unknown item ids before writing');

    // --- A QR label unlocks only its own item's files ---
    const manualsRoot = path.join(DATA_DIR, 'uploads', 'manuals');
    const otherId = fs.readdirSync(manualsRoot).find(id => id !== '1' && fs.readdirSync(path.join(manualsRoot, id)).length);
    assert(otherId, 'seed data has no manual to probe');
    const otherFile = fs.readdirSync(path.join(manualsRoot, otherId))[0];
    const tokenOne = encodeURIComponent(scanLink.json.accessToken);
    const borrowed = await request(`/uploads/manuals/${otherId}/${encodeURIComponent(otherFile)}?item=1&access=${tokenOne}`);
    assert(borrowed.status === 401, `item 1's QR token opened item ${otherId}'s manual (${borrowed.status})`);
    const otherLink = await request(`/api/items/${otherId}/scan-link`, { headers: { Cookie: cookieOne } });
    const ownFile = await request(`/uploads/manuals/${otherId}/${encodeURIComponent(otherFile)}?access=${encodeURIComponent(otherLink.json.accessToken)}`);
    assert(ownFile.status === 200, `an item's own QR token could not open its manual (${ownFile.status})`);
    fs.mkdirSync(path.join(DATA_DIR, 'uploads', 'receipts', '1'), { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'uploads', 'receipts', '1', 'receipt-probe.pdf'), '%PDF-1.4 probe');
    const receiptByQr = await request(`/uploads/receipts/1/receipt-probe.pdf?access=${tokenOne}`);
    assert(receiptByQr.status === 401, `a QR token opened a receipt (${receiptByQr.status})`);
    console.log('✓ QR labels unlock only their own item\'s photos, manuals and software');

    // --- Guest links show gear, not money trails or people ---
    const guestOn = await request('/api/settings/guest', {
      method: 'PUT',
      headers: { Cookie: cookieOne, 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestEnabled: true })
    });
    assert(guestOn.status === 200 && guestOn.json?.guestToken, 'could not enable guest link');
    const guestToken = guestOn.json.guestToken;
    const loan = await request('/api/items/1/loans', {
      method: 'POST',
      headers: { Cookie: cookieOne, 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrower_name: 'Probe Borrower', borrower_contact: 'probe@example.invalid', due_date: '2030-01-01' })
    });
    assert(loan.status === 201, `loan checkout failed (${loan.status})`);
    const guestItem = await request(`/api/guest/${guestToken}/items/1`);
    assert(guestItem.status === 200, `guest item view failed (${guestItem.status})`);
    const guestText = JSON.stringify(guestItem.json);
    for (const hidden of ['purchase_price', 'receipts', 'loans', 'activeLoan', 'maintenance', 'insurance_policy_note', 'probe@example.invalid', 'Probe Borrower']) {
      assert(!guestText.includes(hidden), `guest link exposed ${hidden}`);
    }
    assert((await request(`/uploads/receipts/1/receipt-probe.pdf?guest_token=${guestToken}`)).status === 401, 'guest link opened a receipt');
    const photosRoot = path.join(DATA_DIR, 'uploads', 'photos');
    const photoId = fs.readdirSync(photosRoot).find(id => fs.readdirSync(path.join(photosRoot, id)).length);
    const photoFile = fs.readdirSync(path.join(photosRoot, photoId))[0];
    assert((await request(`/uploads/photos/${photoId}/${encodeURIComponent(photoFile)}?guest_token=${guestToken}`)).status === 200, 'guest link cannot show gear photos');
    console.log('✓ guest links hide prices, receipts, notes and borrower details');

    // --- Script injection backstops ---
    const page = await request('/', { remote: false });
    const csp = String(page.headers['content-security-policy'] || '');
    assert(/script-src 'self'/.test(csp) && !/unsafe-inline|unsafe-eval/.test(csp), `weak Content-Security-Policy: ${csp}`);
    const pdf = multipartFile({
      field: 'file',
      filename: 'hostile-manual.pdf',
      type: 'application/pdf',
      content: minimalPdf('Calibration probe <img src=x onerror=alert(1)> end')
    });
    const uploadedPdf = await request('/api/items/1/manuals', {
      method: 'POST',
      headers: { Cookie: cookieOne, 'Content-Type': pdf.contentType },
      body: pdf.body
    });
    assert(uploadedPdf.status === 201, `manual upload failed (${uploadedPdf.status})`);
    const hits = await request('/api/manuals/search?q=calibration', { headers: { Cookie: cookieOne } });
    assert(hits.status === 200 && hits.json.length > 0, 'test manual was not indexed');
    for (const hit of hits.json) {
      assert(!/<mark>|<\/mark>/.test(hit.snippet), 'manual snippets must not carry HTML tags');
      assert(hit.snippet.includes('\u0002'), 'manual snippets must mark matches with the \\u0002 sentinel');
    }
    console.log('✓ CSP forbids inline script and manual snippets are plain text');

    // --- A damaged settings file never mints new QR/guest secrets ---
    const settingsPath = path.join(DATA_DIR, 'studio-settings.json');
    assert(fs.existsSync(`${settingsPath}.bak`), 'settings backup copy was not written');
    const tokenBefore = (await request('/api/items/1/scan-link', { headers: { Cookie: cookieOne } })).json.accessToken;
    const intact = fs.readFileSync(settingsPath, 'utf8');
    fs.writeFileSync(settingsPath, intact.slice(0, 30));
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(settingsPath, later, later);
    const tokenAfter = (await request('/api/items/1/scan-link', { headers: { Cookie: cookieOne } })).json?.accessToken;
    assert(tokenAfter === tokenBefore, 'a truncated settings file changed the QR signing secret');
    assert(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).scanLinkSecret, 'settings file was not restored from the backup copy');
    assert((await request('/api/items', { headers: { Cookie: cookieOne } })).status === 200, 'owner session did not survive settings recovery');
    console.log('✓ a damaged settings file is restored instead of replaced');

    // --- Outbound downloads cannot be pointed at this computer or the LAN ---
    for (const [route, url] of [
      ['/api/items/1/manuals/archive', `http://127.0.0.1:${PORT}/icons/icon.svg`],
      ['/api/items/1/manuals/discover', `http://localhost:${PORT}/`],
      ['/api/items/1/software/archive', 'http://169.254.169.254/latest/meta-data/'],
      ['/api/items/1/software/archive', 'http://192.168.1.1/'],
      ['/api/items/1/manuals/archive', 'file:///etc/passwd']
    ]) {
      const refused = await request(route, {
        method: 'POST',
        headers: { Cookie: cookieOne, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      assert(refused.status === 400, `${route} fetched ${url} (${refused.status})`);
    }
    console.log('✓ URL downloads refuse local and private addresses');

    const logoSettings = await request('/api/settings/brand-logos', { headers: { Cookie: cookieOne } });
    assert(logoSettings.status === 200 && logoSettings.json?.lookups === false, 'online logo lookups should be off by default');
    console.log('✓ online brand-logo lookups are opt-in');

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
