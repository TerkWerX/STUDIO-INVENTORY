const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, 'pdf-text-worker.js');
const EXTRACT_TIMEOUT_MS = 20 * 1000;
const INFLATE_BUDGET_BYTES = 128 * 1024 * 1024;
const EXTRACT_MEMORY_MB = 256;
const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_TEXT_CHARS = 200000;

// unpdf (a current pdf.js build) needs Node 22 or newer.
const pdfTextAvailable = (() => {
  if (Number(process.versions.node.split('.')[0]) < 22) return false;
  try { require.resolve('unpdf'); return true; } catch { return false; }
})();
if (!pdfTextAvailable) {
  console.warn('  Manual text search is off: it needs Node.js 22 or newer and the unpdf package.');
}

/**
 * Text of a PDF, extracted in a worker thread with a memory and time limit.
 * Resolves to '' when the file cannot be read; never rejects.
 */
function extractPdfText(filePath) {
  if (!pdfTextAvailable || !filePath || !fs.existsSync(filePath)) return Promise.resolve('');
  try {
    if (fs.statSync(filePath).size > MAX_PDF_BYTES) return Promise.resolve('');
  } catch {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, {
      workerData: { filePath, maxChars: MAX_TEXT_CHARS, inflateBudgetBytes: INFLATE_BUDGET_BYTES },
      resourceLimits: { maxOldGenerationSizeMb: EXTRACT_MEMORY_MB, maxYoungGenerationSizeMb: 64 }
    });
    const finish = (text, problem) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (problem) console.warn(`  PDF text skipped for ${path.basename(filePath)}: ${problem}`);
      worker.terminate().catch(() => {});
      resolve(text || '');
    };
    const timer = setTimeout(() => finish('', 'took longer than 20 seconds'), EXTRACT_TIMEOUT_MS);
    worker.once('message', (message) => finish(message?.text || '', message?.error));
    worker.once('error', (err) => finish('', err.message));
    worker.once('exit', (code) => finish('', code ? `worker stopped (${code})` : ''));
  });
}

/** Absolute path inside uploadsDir, or '' when the stored path would leave it. */
function containedPath(uploadsDir, rel) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some(part => part === '..')) return '';
  const root = path.resolve(uploadsDir);
  const full = path.resolve(root, clean);
  return full.startsWith(root + path.sep) ? full : '';
}

async function indexManualAttachment(db, attachment, itemName, uploadsDir) {
  const rel = String(attachment.relative_path || attachment.filename || '');
  const full = containedPath(uploadsDir, rel);
  const isPdf = attachment.mime_type === 'application/pdf' || rel.toLowerCase().endsWith('.pdf');
  const text = await extractPdfText(isPdf && full ? full : '');
  db.prepare('UPDATE attachments SET extracted_text = ? WHERE id = ?').run(text, attachment.id);
  db.prepare('DELETE FROM manual_fts WHERE attachment_id = ?').run(attachment.id);
  if (text) {
    db.prepare(`
      INSERT INTO manual_fts (attachment_id, item_name, file_name, body)
      VALUES (?, ?, ?, ?)
    `).run(attachment.id, itemName || '', attachment.original_name || '', text);
  }
  return text.length;
}

/**
 * Snippets are plain PDF text. Matches are wrapped in \u0002 … \u0003 so the
 * browser can escape the text first and only then add <mark> highlighting.
 */
function searchManuals(db, query, limit = 40) {
  const q = String(query || '').trim();
  if (!q || q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '')}"`).join(' ');
  try {
    return db.prepare(`
      SELECT f.attachment_id, f.item_name, f.file_name,
        snippet(manual_fts, 3, char(2), char(3), '…', 32) as snippet,
        a.item_id, a.relative_path, a.mime_type
      FROM manual_fts f
      JOIN attachments a ON a.id = f.attachment_id
      WHERE manual_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(terms, limit);
  } catch {
    return db.prepare(`
      SELECT a.id as attachment_id, i.name as item_name, a.original_name as file_name,
        substr(a.extracted_text, 1, 120) as snippet,
        a.item_id, a.relative_path, a.mime_type
      FROM attachments a
      JOIN items i ON i.id = a.item_id
      WHERE a.type IN ('manual','document') AND a.extracted_text LIKE ?
      LIMIT ?
    `).all(`%${q}%`, limit);
  }
}

module.exports = { extractPdfText, indexManualAttachment, searchManuals, pdfParseAvailable: pdfTextAvailable };
