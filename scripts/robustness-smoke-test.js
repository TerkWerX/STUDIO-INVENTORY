/**
 * Robustness smoke test: a brand-new catalog on first start, bad input
 * answered with clear 4xx errors (never a crash or a half-saved record),
 * files cleaned up with their records, and clean start/stop behaviour.
 * Runs against its own empty data folder; nothing is seeded first.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ROBUSTNESS_SMOKE_PORT || 3861);
const DATA_DIR = path.join(ROOT, 'data', '.robustness-smoke-test');
const KEY_DIR = path.join(ROOT, 'data', '.robustness-smoke-keys');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(pathname, { method = 'GET', json, body, headers = {}, localAddress } = {}) {
  const payload = json !== undefined ? Buffer.from(JSON.stringify(json)) : body ? Buffer.from(body) : null;
  const allHeaders = { ...headers };
  if (json !== undefined) allHeaders['Content-Type'] = 'application/json';
  if (payload) allHeaders['Content-Length'] = payload.length;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method, headers: allHeaders, localAddress }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), text, json: data });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error(`${method} ${pathname} got no answer within 20 seconds`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function uploadPhoto(itemId) {
  const boundary = `----robustness${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="front.png"\r\nContent-Type: image/png\r\n\r\n`),
    PNG,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  return request(`/api/items/${itemId}/photos`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  });
}

function env(extra = {}) {
  return {
    ...process.env,
    PORT: String(PORT),
    STUDIO_DATA_DIR: DATA_DIR,
    STUDIO_KEY_DIR: KEY_DIR,
    STUDIO_SKIP_UPDATE_CHECK: '1',
    STUDIO_SKIP_AUTO_BACKUP: '1',
    ...extra
  };
}

function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', chunk => { child.output += chunk; });
  child.stderr.on('data', chunk => { child.output += chunk; });
  child.exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  return child;
}

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await request('/api/health');
      if (res.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('server did not start');
}

async function alive(server, step) {
  const res = await request('/api/health');
  assert(res.status === 200 && server.exitCode === null, `server stopped after: ${step}\n${server.output}`);
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(KEY_DIR, { recursive: true, force: true });
  fs.mkdirSync(KEY_DIR, { recursive: true });

  let server = startServer();
  try {
    await waitForHealth();

    // A brand-new catalog works on its very first start (no restart needed).
    const first = await request('/api/items', { method: 'POST', json: { name: 'First mic', brand: 'Neumann' } });
    assert(first.status === 201, `first item on a new catalog failed: ${first.status} ${first.text}`);
    assert((await request('/api/items')).status === 200, 'item list failed on a new catalog');
    const room = await request('/api/floorplans', { method: 'POST', json: { location: 'Control Room' } });
    assert(room.status === 201 || room.status === 200, `new room failed on a new catalog: ${room.status} ${room.text}`);
    console.log('✓ a brand-new catalog works on first start');

    // Unknown routes and files are JSON 404s, not the app page.
    for (const [method, url] of [['GET', '/api/does-not-exist'], ['POST', '/api/nope'], ['GET', '/uploads/photos/1/missing.png']]) {
      const res = await request(url, { method });
      assert(res.status === 404 && res.type.includes('json'), `${method} ${url} should be a JSON 404, got ${res.status} ${res.type}`);
    }
    const badJson = await request('/api/items', { method: 'POST', body: '{"name":', headers: { 'Content-Type': 'application/json' } });
    assert(badJson.status === 400 && badJson.json?.error, `malformed JSON should be a 400, got ${badJson.status}`);
    console.log('✓ unknown routes, missing files and malformed JSON get clear errors');

    // A brand name with "%" used to crash the whole server.
    await request('/api/brands/100%25%20Wood/fetch-logo', { method: 'POST', json: {} });
    await alive(server, 'logo lookup for a brand with %');
    console.log('✓ a brand name with % no longer stops the server');

    // Tags: bad input is refused before anything is saved; a comma list works.
    const before = (await request('/api/items')).json.length;
    const badTags = await request('/api/items', { method: 'POST', json: { name: 'Bad tags', tags: 5 } });
    assert(badTags.status === 400, `numeric tags should be a 400, got ${badTags.status}`);
    assert((await request('/api/items')).json.length === before, 'a refused item was saved anyway');
    const commaTags = await request('/api/items', { method: 'POST', json: { name: 'Comma tags', tags: 'vintage, tube' } });
    assert(JSON.stringify(commaTags.json.tags.map(t => t.name)) === '["tube","vintage"]', `comma tags: ${JSON.stringify(commaTags.json.tags)}`);
    const keepTags = await request(`/api/items/${commaTags.json.id}`, { method: 'PUT', json: { name: 'Comma tags', tags: { x: 1 } } });
    assert(keepTags.status === 400, 'object tags on update should be a 400');
    assert((await request(`/api/items/${commaTags.json.id}`)).json.tags.length === 2, 'a refused update wiped the tags');
    console.log('✓ tags are validated and updates are all-or-nothing');

    // Numbers: no Infinity, no huge values; query filters are validated.
    const inf = await request('/api/items', { method: 'POST', json: { name: 'Infinite', replacement_value: 'Infinity' } });
    assert(inf.json.replacement_value === 0, 'Infinity was stored as a value');
    const huge = await request('/api/items', { method: 'POST', json: { name: 'Huge', replacement_value: '1e30' } });
    assert(huge.json.replacement_value === 1e9, `huge values should be capped, got ${huge.json.replacement_value}`);
    const stats = await request('/api/stats');
    assert(Number.isFinite(stats.json.totals.total_replacement), 'dashboard total is not a number');
    assert((await request('/api/items?brand=a&brand=b')).status === 200, 'repeated query parameters broke the item list');
    assert((await request('/api/items?min_value=abc')).status === 400, 'a non-numeric filter should be a 400');
    console.log('✓ numbers and filters are validated');

    // Racks and chains: member lists are checked, deleting nothing is a 404.
    const rack = (await request('/api/racks', { method: 'POST', json: { name: 'Rack A' } })).json;
    assert((await request(`/api/racks/${rack.id}/items`, { method: 'PUT', json: { items: [null] } })).status === 400, 'null rack entry should be a 400');
    assert((await request(`/api/racks/${rack.id}/items`, { method: 'PUT', json: { items: [{ item_id: 99999 }] } })).status === 400, 'unknown rack item should be a 400');
    assert((await request(`/api/racks/${rack.id}/items`, { method: 'PUT', json: { items: [{ item_id: first.json.id }] } })).status === 200, 'valid rack items failed');
    assert((await request('/api/racks/99999', { method: 'DELETE' })).status === 404, 'deleting a missing rack should be a 404');
    assert((await request('/api/signal-chains/99999', { method: 'DELETE' })).status === 404, 'deleting a missing chain should be a 404');
    console.log('✓ racks and signal chains validate their gear lists');

    // Two devices editing the same rack, chain or room map keep each other's changes.
    const makeItem = async (name, location) => (await request('/api/items', { method: 'POST', json: { name, location } })).json;
    const amp = await makeItem('Shared amp', 'Control Room');
    const comp = await makeItem('Shared comp', 'Control Room');
    const liveEq = await makeItem('Live room EQ', 'Live Room');
    const shared = (await request('/api/racks', { method: 'POST', json: { name: 'Shared rack' } })).json;
    const addA = await request(`/api/racks/${shared.id}/items`, { method: 'POST', json: { item_id: amp.id, slot_label: 'U1' } });
    const addB = await request(`/api/racks/${shared.id}/items`, { method: 'POST', json: { item_id: comp.id, slot_label: 'U2' } });
    assert(addA.status === 201 && addB.status === 201, `adding to a rack failed: ${addA.status} ${addB.status} ${addB.text}`);
    assert(JSON.stringify(addB.json.items.map(i => [i.id, i.slot_label])) === JSON.stringify([[amp.id, 'U1'], [comp.id, 'U2']]),
      `a second device's rack change undid the first: ${addB.text}`);
    assert((await request(`/api/racks/${shared.id}/items`, { method: 'POST', json: { item_id: amp.id } })).status === 409, 'adding gear twice should be a 409');
    assert((await request(`/api/racks/${shared.id}/items`, { method: 'POST', json: { item_id: 99999 } })).status === 400, 'adding unknown gear should be a 400');
    assert((await request('/api/racks/99999/items', { method: 'POST', json: { item_id: amp.id } })).status === 404, 'adding to a missing rack should be a 404');
    const fromRack = await request(`/api/racks/${shared.id}/items/${amp.id}`, { method: 'DELETE' });
    assert(fromRack.status === 200 && JSON.stringify(fromRack.json.items.map(i => i.id)) === JSON.stringify([comp.id]), `removing from a rack: ${fromRack.text}`);
    assert((await request(`/api/racks/${shared.id}/items/${amp.id}`, { method: 'DELETE' })).status === 200, 'removing gear that is already gone should be fine');

    const chain = (await request('/api/signal-chains', { method: 'POST', json: { name: 'Vocal chain' } })).json;
    await request(`/api/signal-chains/${chain.id}/items`, { method: 'POST', json: { item_id: amp.id } });
    await request(`/api/signal-chains/${chain.id}/items`, { method: 'POST', json: { item_id: comp.id } });
    await request(`/api/signal-chains/${chain.id}/items/${amp.id}`, { method: 'DELETE' });
    const reAdded = await request(`/api/signal-chains/${chain.id}/items`, { method: 'POST', json: { item_id: amp.id } });
    assert(reAdded.status === 201 && JSON.stringify(reAdded.json.items.map(i => i.id)) === JSON.stringify([comp.id, amp.id]),
      `signal chain order after remove and re-add: ${reAdded.text}`);
    assert((await request(`/api/signal-chains/${chain.id}/items`, { method: 'POST', json: { item_id: comp.id } })).status === 409, 'a chain entry twice should be a 409');

    const pins = `/api/floorplans/${room.json.id}/items`;
    const hung = await request(pins, { method: 'PATCH', json: { upsert: [{
      item_id: amp.id, placement: 'wall', wall_edge: 1, wall_t: 0.25, height_ft: 4, photo_calibration: { corners: 4 }
    }] } });
    assert(hung.status === 200, `placing a pin failed: ${hung.status} ${hung.text}`);
    const placedB = await request(pins, { method: 'PATCH', json: { upsert: [{ item_id: comp.id, x_pct: 20, y_pct: 30 }] } });
    assert(placedB.json.items.length === 2, `a second device's pin removed the first: ${placedB.text}`);
    const slid = await request(pins, { method: 'PATCH', json: { upsert: [{ item_id: amp.id, wall_t: 0.5 }] } });
    const ampPin = slid.json.items.find(p => p.id === amp.id);
    assert(ampPin.placement === 'wall' && ampPin.wall_edge === 1 && ampPin.wall_t === 0.5 && ampPin.height_ft === 4
      && ampPin.photo_calibration?.corners === 4, `moving a pin lost its other settings: ${JSON.stringify(ampPin)}`);
    const wrongRoom = await request(pins, { method: 'PATCH', json: { upsert: [{ item_id: liveEq.id, x_pct: 5 }] } });
    assert(wrongRoom.status === 400 && /Live Room/.test(wrongRoom.json.error), `pinning gear from another room: ${wrongRoom.status} ${wrongRoom.text}`);
    assert((await request(pins, { method: 'PATCH', json: { upsert: 'x' } })).status === 400, 'a bad pin list should be a 400');
    assert((await request(pins, { method: 'PATCH', json: { remove: ['a'] } })).status === 400, 'a bad remove list should be a 400');
    assert((await request('/api/floorplans/99999/items', { method: 'PATCH', json: { upsert: [] } })).status === 404, 'a missing room should be a 404');
    const unpinned = await request(pins, { method: 'PATCH', json: { remove: [comp.id] } });
    assert(JSON.stringify(unpinned.json.items.map(p => p.id)) === JSON.stringify([amp.id]), `removing one pin: ${unpinned.text}`);
    // Saving a whole list without the wall-photo calibration keeps it (older clients left it out).
    const fullList = await request(pins, { method: 'PUT', json: { items: [{ item_id: amp.id, x_pct: 10, y_pct: 10, placement: 'wall', wall_edge: 1 }] } });
    assert(fullList.json.items[0].photo_calibration?.corners === 4, `a full pin list wiped the calibration: ${fullList.text}`);
    console.log('✓ two devices editing a rack, chain or room map keep each other\'s changes');

    // Loans: dates must be real dates; returning doesn't undo a later status change.
    const lent = first.json.id;
    const badDue = await request(`/api/items/${lent}/loans`, { method: 'POST', json: { borrower_name: 'Sam', due_date: '1/5/2027' } });
    assert(badDue.status === 400, `a US-style date should be refused, got ${badDue.status}`);
    const loan = await request(`/api/items/${lent}/loans`, { method: 'POST', json: { borrower_name: 'Sam', due_date: '2099-01-05' } });
    assert(loan.status === 201, `valid loan failed: ${loan.text}`);
    await request(`/api/items/${lent}`, { method: 'PUT', json: { studio_status: 'in_repair' } });
    await request(`/api/loans/${loan.json.loan.id}/return`, { method: 'PUT', json: {} });
    assert((await request(`/api/items/${lent}`)).json.studio_status === 'in_repair', 'returning a loan overwrote the in-repair status');
    console.log('✓ loan dates are validated and returns keep later status changes');

    // Files: a merged import gets its own copy, and deleting one never removes the other's photo.
    const photo = await uploadPhoto(lent);
    assert(photo.status === 201, `photo upload failed: ${photo.text}`);
    const exported = (await request('/api/export/json')).json;
    const source = exported.items.find(item => item.id === lent);
    const merged = await request('/api/import/json', { method: 'POST', json: { items: [source] } });
    assert(merged.status === 200 && merged.json.importedAttachments === 1, `merge import failed: ${merged.text}`);
    const copy = (await request('/api/items?include_former=1&include_accessories=1')).json
      .filter(item => item.name === source.name).find(item => item.id !== lent);
    assert(copy && copy.photos[0].relative_path !== source.photos[0].relative_path, 'merged item shares the original photo file');
    assert((await request(`/api/attachments/${copy.photos[0].id}`, { method: 'DELETE' })).status === 200, 'attachment delete failed');
    assert(fs.existsSync(path.join(DATA_DIR, 'uploads', source.photos[0].relative_path)), "deleting the copy's photo removed the original");
    console.log('✓ imported copies own their files');

    // Parent loops in an import are dropped instead of locking both items.
    const loop = await request('/api/import/json', {
      method: 'POST',
      json: { items: [{ id: 501, name: 'Loop A', parent_item_id: 502 }, { id: 502, name: 'Loop B', parent_item_id: 501 }] }
    });
    assert(loop.status === 200 && loop.json.skippedParents === 1, `parent loop not caught: ${loop.text}`);
    const loopItem = (await request('/api/items?q=Loop%20A&include_accessories=1')).json[0];
    assert((await request(`/api/items/${loopItem.id}`, { method: 'PUT', json: { name: 'Loop A2' } })).status === 200,
      'an imported item is locked by a parent loop');
    console.log('✓ imports cannot create parent loops');

    // Deleting an item removes its record, then its files.
    const erase = await request(`/api/items/${lent}`, { method: 'DELETE', json: { erase: true, confirmName: 'First mic' } });
    assert(erase.status === 200, `erase failed: ${erase.text}`);
    assert(!fs.existsSync(path.join(DATA_DIR, 'uploads', 'photos', String(lent))), 'erased item left its photo folder');
    console.log('✓ erasing gear removes its files');

    // A second copy on the same port explains itself and exits.
    const second = startServer();
    const secondExit = await Promise.race([second.exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 15000))]);
    assert(secondExit !== 'timeout' && secondExit.code === 1, `second server did not exit cleanly: ${JSON.stringify(secondExit)}`);
    assert(/already in use/.test(second.output), `no port-in-use explanation:\n${second.output}`);
    console.log('✓ starting a second copy explains the port conflict');

    // The server keeps a log file, readable from Help & About.
    const logResponse = await request('/api/logs');
    assert(logResponse.status === 200 && logResponse.json.lines.some(line => /running at http:\/\/localhost/.test(line)),
      `the log file is missing the startup line: ${logResponse.text.slice(0, 300)}`);
    assert(fs.existsSync(path.join(DATA_DIR, 'logs', 'studio-inventory.log')), 'no log file in data/logs');
    console.log('✓ the server writes a log file');

    // Stopping through the app (how Windows stops it) closes the catalog cleanly.
    // Only the studio computer may stop it.
    const remoteStop = await request('/api/shutdown', { method: 'POST', json: {}, localAddress: '127.0.0.2' });
    assert(remoteStop.status === 403, `another device could stop the app: ${remoteStop.status}`);
    const stopRequest = await request('/api/shutdown', { method: 'POST', json: { skipBackup: true } });
    assert(stopRequest.status === 202, `stop request failed: ${stopRequest.status} ${stopRequest.text}`);
    const stopped = await Promise.race([server.exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 15000))]);
    assert(stopped !== 'timeout' && stopped.code === 0, `server did not stop cleanly: ${JSON.stringify(stopped)}`);
    assert(!fs.existsSync(path.join(DATA_DIR, 'inventory.db-wal')), 'the catalog was not closed (write-ahead log left behind)');
    const stopLog = fs.readFileSync(path.join(DATA_DIR, 'logs', 'studio-inventory.log'), 'utf8');
    assert(/Stop requested \(no backup\)/.test(stopLog) && /Studio Inventory is stopping/.test(stopLog), 'the stop was not logged');
    console.log('✓ stopping from the app closes the catalog cleanly');

    // An async route that throws answers with an error instead of stopping the server.
    fs.writeFileSync(path.join(DATA_DIR, 'studio-settings.json'), '{ not json');
    fs.writeFileSync(path.join(DATA_DIR, 'studio-settings.json.bak'), '{ not json either');
    server = startServer();
    await waitForHealth();
    const qr = await request('/api/items/2/qr');
    assert(qr.status === 503 && /could not read/i.test(qr.json?.error || ''), `unreadable settings: ${qr.status} ${qr.text}`);
    await alive(server, 'an async route that throws');
    console.log('✓ an error inside an async route is answered, not fatal');

    // Ctrl+C / stop signals close the catalog too (macOS and Linux; Windows has no catchable signal).
    if (process.platform !== 'win32') {
      server.kill('SIGTERM');
      const signalled = await Promise.race([server.exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 15000))]);
      assert(signalled !== 'timeout' && signalled.code === 0, `stop signal did not stop cleanly: ${JSON.stringify(signalled)}`);
      assert(!fs.existsSync(path.join(DATA_DIR, 'inventory.db-wal')), 'the catalog was not closed after a stop signal');
      console.log('✓ a stop signal closes the catalog cleanly');
    }

    console.log('\nRobustness smoke test passed.');
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM');
    await server.exited;
    // Windows can hold files for a moment after a process exits.
    fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    fs.rmSync(KEY_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch((err) => {
  console.error('\nRobustness smoke test FAILED:', err.message);
  process.exit(1);
});
