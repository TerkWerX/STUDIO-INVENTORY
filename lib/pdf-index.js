const fs = require('fs');
const path = require('path');

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch {
  pdfParse = null;
}

function extractPdfText(filePath) {
  if (!pdfParse || !fs.existsSync(filePath)) return '';
  try {
    const buf = fs.readFileSync(filePath);
    return pdfParse(buf).then(data => String(data.text || '').replace(/\s+/g, ' ').trim().slice(0, 200000));
  } catch {
    return Promise.resolve('');
  }
}

function indexManualAttachment(db, attachment, itemName, uploadsDir) {
  const rel = attachment.relative_path || attachment.filename;
  const full = path.join(uploadsDir, rel);
  const isPdf = attachment.mime_type === 'application/pdf' || rel.toLowerCase().endsWith('.pdf');

  return extractPdfText(isPdf ? full : '').then((text) => {
    db.prepare('UPDATE attachments SET extracted_text = ? WHERE id = ?').run(text, attachment.id);
    db.prepare('DELETE FROM manual_fts WHERE attachment_id = ?').run(attachment.id);
    if (text) {
      db.prepare(`
        INSERT INTO manual_fts (attachment_id, item_name, file_name, body)
        VALUES (?, ?, ?, ?)
      `).run(attachment.id, itemName || '', attachment.original_name || '', text);
    }
    return text.length;
  });
}

function searchManuals(db, query, limit = 40) {
  const q = String(query || '').trim();
  if (!q || q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '')}"`).join(' ');
  try {
    return db.prepare(`
      SELECT f.attachment_id, f.item_name, f.file_name,
        snippet(manual_fts, 3, '<mark>', '</mark>', '…', 32) as snippet,
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

module.exports = { extractPdfText, indexManualAttachment, searchManuals, pdfParseAvailable: !!pdfParse };