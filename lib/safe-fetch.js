/**
 * Outbound HTTP for "archive this manual from a URL", document search, and
 * brand-logo lookups. The URLs come from users and from web pages, so:
 *
 * - Only http:// and https:// URLs, without user:password@.
 * - Addresses on this computer or the local network (router admin pages, NAS
 *   shares, cloud metadata at 169.254.169.254, …) are refused. The check runs
 *   on the address actually connected to, so DNS tricks cannot slip past it.
 *   Set STUDIO_ALLOW_PRIVATE_DOWNLOADS=1 to allow them (for a NAS, say).
 * - Redirects are followed by hand, at most 5, and every hop is re-checked.
 * - Bodies are size-capped while streaming (never buffered first), are
 *   decompressed with the cap applied to the output, and time out.
 */
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const zlib = require('zlib');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const USER_AGENT = 'Mozilla/5.0 (compatible; StudioInventory; +https://www.terkwerx.com)';
const MAX_REDIRECTS = 5;

class DownloadError extends Error {
  constructor(message, code = 'EDOWNLOAD') {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

// ---------------------------------------------------------------------------
// Address policy
// ---------------------------------------------------------------------------
const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
]) blocked.addSubnet(address, prefix, 'ipv6');

/** The IPv4 address hidden inside an IPv4-mapped (::ffff:a.b.c.d) or NAT64 IPv6 address. */
function embeddedIpv4(address) {
  const match = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (match) return match[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex) return '';
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function isPrivateAddress(address) {
  const ip = String(address || '').replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(ip);
  if (!family) return true;
  if (family === 4) return blocked.check(ip, 'ipv4');
  const inner = embeddedIpv4(ip);
  if (inner) return blocked.check(inner, 'ipv4');
  return blocked.check(ip, 'ipv6');
}

function privateAllowed() {
  return process.env.STUDIO_ALLOW_PRIVATE_DOWNLOADS === '1';
}

function refusePrivate(host) {
  return new DownloadError(
    `Studio Inventory will not download from ${host}: it is on this computer or your local network. `
    + 'Save the file to the Manual Inbox instead, or set STUDIO_ALLOW_PRIVATE_DOWNLOADS=1 to allow local addresses.',
    'EPRIVATE'
  );
}

/** dns.lookup replacement that only ever hands the socket an allowed address. */
function makeCheckedLookup(isAllowed, resolve = dns.lookup) {
  return function checkedLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const allowed = (addresses || []).filter(entry => isAllowed(entry.address));
      if (!allowed.length) return callback(refusePrivate(hostname));
      if (options?.all) return callback(null, allowed);
      return callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
function checkUrl(input) {
  let url;
  try { url = new URL(String(input)); } catch { throw new DownloadError('That is not a valid web address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new DownloadError('Only http:// and https:// links can be downloaded.');
  if (url.username || url.password) throw new DownloadError('Links with a user name or password are not allowed.');
  return url;
}

function requestOnce(url, { headers, timeoutMs, isAllowed, resolve }) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname) && !isAllowed(hostname)) return Promise.reject(refusePrivate(hostname));
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolvePromise, reject) => {
    const req = transport.request(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate, br', ...headers },
      lookup: makeCheckedLookup(isAllowed, resolve),
      agent: false,
      timeout: timeoutMs
    }, resolvePromise);
    req.on('timeout', () => req.destroy(new DownloadError('The site took too long to respond.', 'ETIMEDOUT')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Open a URL and return a fetch-like response once headers arrive. The body is
 * a stream; read it with .text(), .toFile() or discard it with .cancel().
 */
async function safeFetch(input, {
  headers = {},
  timeoutMs = 20000,
  maxBytes = 5 * 1024 * 1024,
  allowPrivate = privateAllowed(),
  isAllowed = allowPrivate ? () => true : (address) => !isPrivateAddress(address),
  resolve = dns.lookup
} = {}) {
  let url = checkUrl(input);
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; ; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DownloadError('The site took too long to respond.', 'ETIMEDOUT');
    const res = await requestOnce(url, { headers, timeoutMs: remaining, isAllowed, resolve });
    const status = res.statusCode || 0;
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
      res.resume();
      if (hop >= MAX_REDIRECTS) throw new DownloadError('The link redirected too many times.');
      url = checkUrl(new URL(res.headers.location, url).href);
      continue;
    }
    return wrapResponse(res, url.href, { maxBytes, deadline });
  }
}

function decoderFor(encoding) {
  switch (String(encoding || '').toLowerCase().trim()) {
    case 'gzip': case 'x-gzip': return zlib.createGunzip();
    case 'deflate': return zlib.createInflate();
    case 'br': return zlib.createBrotliDecompress();
    default: return null;
  }
}

function sizeLimiter(maxBytes) {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        return callback(new DownloadError(`The download is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`, 'ETOOLARGE'));
      }
      callback(null, chunk);
    }
  });
}

function wrapResponse(res, finalUrl, { maxBytes, deadline }) {
  const status = res.statusCode || 0;
  const header = (name) => {
    const value = res.headers[String(name).toLowerCase()];
    return value === undefined ? null : Array.isArray(value) ? value.join(', ') : String(value);
  };
  const declared = Number(header('content-length'));
  const decoder = decoderFor(header('content-encoding'));

  function body() {
    if (!decoder && Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      throw new DownloadError(`The download is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`, 'ETOOLARGE');
    }
    const timer = setTimeout(() => res.destroy(new DownloadError('The download took too long.', 'ETIMEDOUT')),
      Math.max(1, deadline - Date.now()));
    res.once('close', () => clearTimeout(timer));
    return [res, ...(decoder ? [decoder] : []), sizeLimiter(maxBytes)];
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    headers: { get: header },
    cancel() { res.destroy(); },
    async buffer() {
      const stages = body();
      const chunks = [];
      await pipeline(...stages, async (source) => {
        for await (const chunk of source) chunks.push(chunk);
      });
      return Buffer.concat(chunks);
    },
    async text() {
      return (await this.buffer()).toString('utf8');
    },
    /** Stream the body to filePath; a partial file is removed on any failure. */
    async toFile(filePath) {
      const stages = body();
      try {
        await pipeline(...stages, fs.createWriteStream(filePath, { flags: 'wx' }));
      } catch (err) {
        try { fs.unlinkSync(filePath); } catch { /* nothing written */ }
        throw err;
      }
      return fs.statSync(filePath).size;
    }
  };
}

module.exports = { safeFetch, isPrivateAddress, DownloadError, USER_AGENT };
