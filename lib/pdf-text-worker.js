/**
 * Runs inside a worker thread (see pdf-index.js). Manuals come from the
 * internet, so PDF parsing is kept away from the server's main thread: a
 * malformed or hostile PDF can only exhaust this worker's limits, and the
 * server keeps answering requests meanwhile.
 *
 * Worker memory limits cover the JavaScript heap but not raw byte buffers, so
 * a "decompression bomb" (a small PDF whose streams inflate to gigabytes)
 * would still balloon the process. Before pdf.js sees the file, every
 * compressed non-image stream is inflated here with a hard output cap, and
 * the PDF is skipped if the total would exceed the budget. Images are not
 * decoded for text extraction, so they do not count.
 */
const fs = require('fs');
const zlib = require('zlib');
const { parentPort, workerData } = require('worker_threads');

const STREAM = Buffer.from('stream');
const END_STREAM = Buffer.from('endstream');

function exceedsInflateBudget(buf, budgetBytes) {
  let total = 0;
  let index = 0;
  while ((index = buf.indexOf(STREAM, index)) !== -1) {
    if (index >= 3 && buf.toString('latin1', index - 3, index) === 'end') {
      index += STREAM.length;
      continue;
    }
    let start = index + STREAM.length;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf(END_STREAM, start);
    if (end === -1) break;
    const head = buf.toString('latin1', Math.max(0, index - 2048), index);
    const dict = head.slice(head.lastIndexOf('<<'));
    const flate = /\/FlateDecode\b|\/Fl\b/.test(dict);
    const image = /\/Subtype\s*\/Image\b/.test(dict);
    if (flate && !image) {
      try {
        total += zlib.inflateSync(buf.subarray(start, end), {
          maxOutputLength: Math.max(1, budgetBytes - total + 1),
          finishFlush: zlib.constants.Z_SYNC_FLUSH
        }).length;
      } catch (err) {
        if (err.code === 'ERR_BUFFER_TOO_LARGE') return true;
        // A damaged stream is pdf.js's problem, not a size problem.
      }
      if (total > budgetBytes) return true;
    }
    index = end + END_STREAM.length;
  }
  return false;
}

async function main() {
  const bytes = fs.readFileSync(workerData.filePath);
  if (exceedsInflateBudget(bytes, workerData.inflateBudgetBytes)) {
    throw new Error('its compressed text streams expand too far (possible decompression bomb)');
  }
  const { getDocumentProxy, extractText } = require('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes), {
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0
  });
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, workerData.maxChars);
  } finally {
    await pdf.destroy?.();
  }
}

main()
  .then(text => parentPort.postMessage({ text }))
  .catch(err => parentPort.postMessage({ text: '', error: err.message }));
