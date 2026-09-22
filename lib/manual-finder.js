const DOCUMENT_KINDS = [
  { id: 'user', label: 'User manual', terms: 'user manual owner manual pdf' },
  { id: 'service', label: 'Service manual', terms: 'service manual repair manual pdf' },
  { id: 'quickstart', label: 'Quick start', terms: 'quick start guide quickstart pdf' },
  { id: 'spec', label: 'Spec sheet', terms: 'spec sheet specifications datasheet pdf' },
  { id: 'schematic', label: 'Schematic', terms: 'schematic wiring diagram pdf' },
  { id: 'warranty', label: 'Warranty', terms: 'warranty policy warranty card pdf' },
  { id: 'other', label: 'Other document', terms: 'documentation brochure application note pdf' }
];

const PRIMARY_DOCUMENT_KINDS = ['user', 'service', 'quickstart'];

const SEARCH_ENDPOINTS = [
  'https://html.duckduckgo.com/html/?q=',
  'https://lite.duckduckgo.com/lite/?q='
];

function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(str = '') {
  return decodeHtmlEntities(String(str).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function unwrapSearchUrl(raw) {
  const decoded = decodeHtmlEntities(raw || '').trim();
  if (!decoded || decoded.startsWith('#') || /^javascript:/i.test(decoded) || /^mailto:/i.test(decoded)) return '';
  try {
    const url = decoded.startsWith('//') ? `https:${decoded}` : decoded;
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get('uddg');
    const href = uddg ? decodeURIComponent(uddg) : parsed.href;
    const host = new URL(href).hostname.toLowerCase();
    if (host.endsWith('duckduckgo.com') || host === 'duck.com') return '';
    return href;
  } catch {
    return '';
  }
}

function isDirectFile(url) {
  try {
    const ext = new URL(url).pathname.toLowerCase().split('.').pop();
    return ['pdf', 'doc', 'docx'].includes(ext);
  } catch {
    return false;
  }
}

function kindFromText(text, fallback = 'user') {
  const haystack = String(text || '');
  if (/service manual|repair manual|workshop manual/i.test(haystack)) return 'service';
  if (/quick\s*start|quickstart|getting started/i.test(haystack)) return 'quickstart';
  if (/spec(?:ification)? sheet|datasheet|data sheet/i.test(haystack)) return 'spec';
  if (/schematic|wiring diagram/i.test(haystack)) return 'schematic';
  if (/warrant/i.test(haystack)) return 'warranty';
  if (/brochure|application note|release note/i.test(haystack)) return 'other';
  if (/user manual|owner'?s manual|instruction manual/i.test(haystack)) return 'user';
  return fallback;
}

function kindLabel(id) {
  return DOCUMENT_KINDS.find((kind) => kind.id === id)?.label || 'Document';
}

function gearTerms(item) {
  const seen = new Set();
  const terms = [];
  for (const value of [item?.brand, item?.model, item?.name, item?.common_name]) {
    const text = String(value || '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    terms.push(text);
  }
  return terms.join(' ');
}

function buildDocumentQueries(item, { kind = 'all', query = '' } = {}) {
  const custom = String(query || '').trim();
  if (custom) {
    const chosen = kind === 'all' ? 'user' : kind;
    return [{ kind: chosen, label: kindLabel(chosen), query: custom.slice(0, 240) }];
  }
  const base = gearTerms(item);
  const kinds = kind === 'all'
    ? DOCUMENT_KINDS.filter((entry) => PRIMARY_DOCUMENT_KINDS.includes(entry.id))
    : DOCUMENT_KINDS.filter((entry) => entry.id === kind);
  return (kinds.length ? kinds : DOCUMENT_KINDS).map((entry) => ({
    kind: entry.id,
    label: entry.label,
    query: `${base} ${entry.terms}`.trim().slice(0, 240)
  }));
}

function parseSearchResults(html) {
  const results = [];
  const seen = new Set();
  const blockRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = blockRe.exec(html)) && results.length < 20) {
    const url = unwrapSearchUrl(match[1]);
    const title = stripHtml(match[2]);
    if (!url || seen.has(url) || title.length < 3) continue;
    seen.add(url);
    results.push({
      title,
      url,
      displayUrl: url.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
      isPdf: isDirectFile(url)
    });
  }
  return results;
}

function extractDocumentLinks(pageUrl, html) {
  const found = [];
  const seen = new Set();
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) && found.length < 8) {
    const raw = decodeHtmlEntities(match[1]).trim();
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) continue;
    let url;
    try { url = new URL(raw, pageUrl).href; } catch { continue; }
    if (!/^https?:/i.test(url) || seen.has(url) || !isDirectFile(url)) continue;
    seen.add(url);
    const title = stripHtml(match[2]) || new URL(url).pathname.split('/').pop();
    found.push({ title, url, displayUrl: url.replace(/^https?:\/\//i, ''), isPdf: true });
  }
  return found;
}

function dedupeResults(results) {
  const seen = new Set();
  const kept = [];
  for (const result of results) {
    const key = result.downloadUrl || result.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(result);
  }
  kept.sort((a, b) => Number(Boolean(b.downloadUrl)) - Number(Boolean(a.downloadUrl)));
  return kept.slice(0, 18);
}

async function findGearDocuments(item, { kind = 'all', query = '', fetchText } = {}) {
  if (typeof fetchText !== 'function') throw new Error('Document search is unavailable');
  const jobs = buildDocumentQueries(item, { kind, query });
  const hits = [];
  const errors = [];
  await Promise.all(jobs.flatMap((job) => SEARCH_ENDPOINTS.map(async (endpoint) => {
    try {
      const html = await fetchText(`${endpoint}${encodeURIComponent(job.query)}`);
      for (const row of parseSearchResults(html)) {
        const detected = kindFromText(`${row.title} ${row.url}`, job.kind);
        hits.push({
          ...row,
          kind: detected,
          kindLabel: kindLabel(detected),
          downloadUrl: row.isPdf ? row.url : ''
        });
      }
    } catch (err) {
      errors.push(err.message || 'search failed');
    }
  })));

  const pages = dedupeResults(hits).filter((hit) => !hit.downloadUrl).slice(0, 4);
  await Promise.all(pages.map(async (page) => {
    try {
      const html = await fetchText(page.url);
      page.files = extractDocumentLinks(page.url, html).map((file) => ({
        ...file,
        kind: kindFromText(`${file.title} ${file.url}`, page.kind),
        kindLabel: kindLabel(kindFromText(`${file.title} ${file.url}`, page.kind))
      }));
    } catch {
      page.files = [];
    }
  }));

  return {
    query: jobs.map((job) => job.query).join(' · '),
    kind,
    results: dedupeResults(hits),
    errors
  };
}

module.exports = {
  DOCUMENT_KINDS,
  PRIMARY_DOCUMENT_KINDS,
  buildDocumentQueries,
  parseSearchResults,
  extractDocumentLinks,
  findGearDocuments
};
