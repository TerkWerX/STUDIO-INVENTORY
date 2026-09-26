/**
 * Request trust boundaries shared by the main server and the catalog-move page.
 *
 * - isLocalRequest: the TCP peer is this computer AND no proxy forwarded it.
 *   A reverse proxy on the studio computer (for HTTPS) connects from 127.0.0.1,
 *   so forwarded requests must never inherit "studio computer" trust.
 * - hostGuard: rejects Host headers that are public DNS names. Blocks DNS
 *   rebinding, where a web page re-points its own domain at 127.0.0.1.
 * - crossSiteGuard: rejects state-changing requests sent by another site,
 *   including requests made from a browser on the studio computer itself.
 */
const net = require('net');
const os = require('os');

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORWARDING_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'];
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.lan', '.home', '.internal', '.home.arpa'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isLocalRequest(req) {
  const addr = req.socket?.remoteAddress || '';
  if (!LOOPBACK_ADDRESSES.has(addr)) return false;
  return !FORWARDING_HEADERS.some(name => req.headers?.[name]);
}

function extraAllowedHosts() {
  return String(process.env.STUDIO_ALLOWED_HOSTS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

/** Hostname from a Host header value, without port or IPv6 brackets. */
function hostnameFromHeader(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end === -1 ? '' : raw.slice(1, end);
  }
  const colon = raw.lastIndexOf(':');
  if (colon !== -1 && raw.indexOf(':') === colon) return raw.slice(0, colon);
  return raw;
}

function isAllowedHostname(hostname) {
  const host = String(hostname || '').replace(/\.$/, '');
  if (!host) return false;
  // An IP literal cannot be re-pointed by DNS, so it is never a rebinding vector.
  if (net.isIP(host)) return true;
  if (host === 'localhost') return true;
  // Single-label names ("studio-pc") resolve only on the local network.
  if (!host.includes('.')) return true;
  if (PRIVATE_SUFFIXES.some(suffix => host.endsWith(suffix))) return true;
  const machine = os.hostname().toLowerCase();
  if (host === machine || host === `${machine}.local`) return true;
  return extraAllowedHosts().includes(host);
}

function hostGuard(req, res, next) {
  if (isAllowedHostname(hostnameFromHeader(req.headers.host))) return next();
  res.status(403).type('text/plain').send(
    'Studio Inventory does not answer to this host name. Open it with localhost, the computer name, or its LAN IP address. '
    + 'If you use a custom name (for example behind an HTTPS proxy), add it to the STUDIO_ALLOWED_HOSTS environment variable.'
  );
}

function originOf(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function crossSiteReason(req) {
  if (SAFE_METHODS.has(req.method)) return '';
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return 'Cross-site requests are not allowed.';
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const own = originOf(`${req.protocol || 'http'}://${req.headers.host || ''}`);
    if (!own || originOf(origin) !== own) {
      return 'Request origin does not match this Studio Inventory server.';
    }
  }
  return '';
}

/** Applies to everyone, including the studio computer. */
function crossSiteGuard(req, res, next) {
  const reason = crossSiteReason(req);
  if (!reason) return next();
  res.status(403).json({ error: reason });
}

module.exports = {
  isLocalRequest,
  isAllowedHostname,
  hostnameFromHeader,
  hostGuard,
  crossSiteGuard,
  crossSiteReason
};
