/**
 * Unit tests (node --test) for outbound downloads and PDF text extraction.
 * Local test servers only; nothing here touches the internet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { safeFetch, isPrivateAddress } = require('../lib/safe-fetch');
const { extractPdfText } = require('../lib/pdf-index');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.hits = 0;
    server.on('request', () => { server.hits++; });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function urlOf(server, pathname = '/') {
  return `http://127.0.0.1:${server.address().port}${pathname}`;
}

// Loopback stands in for "the internet" in these tests.
const allowLoopbackOnly = { isAllowed: (address) => address === '127.0.0.1' };

test('private and local addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.0.0.8', '172.16.4.4', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '::1', 'fe80::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '224.0.0.251']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('downloads from this computer or the LAN are refused before connecting', async () => {
  const server = await startServer((_req, res) => res.end('secret'));
  const port = server.address().port;
  await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`), /local network/);
  await assert.rejects(safeFetch(`http://localhost:${port}/`), /local network/);
  await assert.rejects(safeFetch('http://169.254.169.254/latest/meta-data/'), /local network/);
  await assert.rejects(safeFetch(`http://[::1]:${port}/`), /local network/);
  assert.equal(server.hits, 0, 'the local server must never be contacted');
  server.close();
});

test('a redirect to a private address is refused', async () => {
  const inner = await startServer((_req, res) => res.end('router admin page'));
  const outer = await startServer((_req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.2:${inner.address().port}/admin` });
    res.end();
  });
  await assert.rejects(safeFetch(urlOf(outer), allowLoopbackOnly), /local network/);
  assert.equal(outer.hits, 1);
  assert.equal(inner.hits, 0);
  inner.close();
  outer.close();
});

test('redirect loops, other schemes and embedded passwords are refused', async () => {
  const loop = await startServer((_req, res) => { res.writeHead(302, { Location: '/again' }); res.end(); });
  await assert.rejects(safeFetch(urlOf(loop), allowLoopbackOnly), /redirected too many times/);
  loop.close();
  await assert.rejects(safeFetch('file:///etc/passwd'), /Only http/);
  await assert.rejects(safeFetch('ftp://example.com/manual.pdf'), /Only http/);
  await assert.rejects(safeFetch('https://user:pass@example.com/manual.pdf'), /user name or password/);
});

test('bodies are capped while streaming, including compressed ones', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/declared') {
      res.writeHead(200, { 'Content-Length': String(50 * 1024 * 1024) });
      return res.end();
    }
    if (req.url === '/gzip-bomb') {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      return res.end(zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024)));
    }
    res.writeHead(200);
    let sent = 0;
    const chunk = Buffer.alloc(64 * 1024, 65);
    const pump = () => {
      while (sent < 8 * 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) return res.once('drain', pump);
      }
      res.end();
    };
    pump();
  });
  const opts = { ...allowLoopbackOnly, maxBytes: 1024 * 1024 };

  await assert.rejects((await safeFetch(urlOf(server, '/declared'), opts)).text(), /larger than/);
  await assert.rejects((await safeFetch(urlOf(server, '/gzip-bomb'), opts)).text(), /larger than/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fetch-test-'));
  const target = path.join(dir, 'download.bin');
  await assert.rejects((await safeFetch(urlOf(server, '/stream'), opts)).toFile(target), /larger than/);
  assert.ok(!fs.existsSync(target), 'a partial download must not be left behind');
  fs.rmSync(dir, { recursive: true, force: true });
  server.close();
});

test('a site that never answers times out', async () => {
  const server = await startServer(() => { /* never respond */ });
  const started = Date.now();
  await assert.rejects(safeFetch(urlOf(server), { ...allowLoopbackOnly, timeoutMs: 500 }), /too long/);
  assert.ok(Date.now() - started < 5000);
  server.closeAllConnections();
  server.close();
});

test('normal downloads still work and report the final URL', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/moved') { res.writeHead(301, { Location: '/manual.pdf' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Encoding': 'gzip' });
    res.end(zlib.gzipSync(Buffer.from('%PDF-1.4 fine')));
  });
  const response = await safeFetch(urlOf(server, '/moved'), allowLoopbackOnly);
  assert.equal(response.ok, true);
  assert.equal(response.url, urlOf(server, '/manual.pdf'));
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(await response.text(), '%PDF-1.4 fine');
  server.close();
});

// --- PDF text extraction ---------------------------------------------------

function pdfWithContent(contentStream, { compressed = false } = {}) {
  const data = compressed ? zlib.deflateSync(contentStream) : Buffer.from(contentStream);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([
      Buffer.from(`<< /Length ${data.length}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`),
      data,
      Buffer.from('\nendstream')
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

test('PDF text is extracted off the main thread', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pdf-test-'));
  const file = path.join(dir, 'manual.pdf');
  fs.writeFileSync(file, pdfWithContent('BT /F1 12 Tf 72 720 Td (Phantom power calibration) Tj ET', { compressed: true }));
  assert.equal(await extractPdfText(file), 'Phantom power calibration');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a PDF decompression bomb is skipped quickly without blocking the server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pdf-test-'));
  const file = path.join(dir, 'bomb.pdf');
  // About 1 MB on disk that would inflate to 200 MB of page content.
  const line = 'BT /F1 12 Tf 72 720 Td (AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA) Tj ET\n';
  fs.writeFileSync(file, pdfWithContent(line.repeat(Math.ceil(200 * 1024 * 1024 / line.length)), { compressed: true }));
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 20);
  const started = Date.now();
  const text = await extractPdfText(file);
  const elapsed = Date.now() - started;
  clearInterval(timer);
  assert.equal(text, '');
  assert.ok(elapsed < 10000, `bomb check took ${elapsed} ms`);
  assert.ok(ticks >= Math.floor(elapsed / 20) * 0.5, 'the main thread kept running while the PDF was checked');
  fs.rmSync(dir, { recursive: true, force: true });
});
