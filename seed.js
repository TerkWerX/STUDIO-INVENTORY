const fs = require('fs');
const path = require('path');
const { db, initSchema, setItemTags, itemUploadDir, UPLOADS_DIR, removeItemUploadDirs } = require('./db');

const force = process.argv.includes('--force');
initSchema();

const count = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
if (count > 0 && !force) {
  console.log(`Database already has ${count} items. Use --force to reseed.`);
  process.exit(0);
}

if (force && count > 0) {
  const ids = db.prepare('SELECT id FROM items').all();
  for (const { id } of ids) removeItemUploadDirs(id);
  db.exec('DELETE FROM attachments; DELETE FROM item_tags; DELETE FROM tags; DELETE FROM items;');
  console.log('Cleared existing data.');
}

function placeholderSvg(label, color = '#4da3ff') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <rect width="800" height="600" fill="#1a2332"/>
    <rect x="40" y="40" width="720" height="520" rx="16" fill="#243044" stroke="${color}" stroke-width="3"/>
    <text x="400" y="280" text-anchor="middle" fill="#f0f4f8" font-family="Segoe UI,sans-serif" font-size="36" font-weight="600">${label}</text>
    <text x="400" y="330" text-anchor="middle" fill="#a8b8cc" font-family="Segoe UI,sans-serif" font-size="20">Placeholder Photo</text>
  </svg>`;
}

function addPhoto(itemId, label, suffix = 'front') {
  const { dir } = itemUploadDir(itemId, 'photo');
  const filename = `placeholder-${suffix}.svg`;
  const relativePath = `photos/${itemId}/${filename}`;
  fs.writeFileSync(path.join(dir, filename), placeholderSvg(label));
  db.prepare(`
    INSERT INTO attachments (item_id, filename, original_name, relative_path, mime_type, type)
    VALUES (?, ?, ?, ?, 'image/svg+xml', 'photo')
  `).run(itemId, filename, `${label} - ${suffix}.svg`, relativePath);
}

function addManualPlaceholder(itemId, name) {
  const { dir } = itemUploadDir(itemId, 'manual');
  const filename = 'manual-placeholder.txt';
  const content = `${name} — Manual placeholder.\nReplace with actual PDF manual upload from the item detail page.`;
  fs.writeFileSync(path.join(dir, filename), content);
  db.prepare(`
    INSERT INTO attachments (item_id, filename, original_name, relative_path, mime_type, type, description)
    VALUES (?, ?, ?, ?, 'text/plain', 'manual', 'Placeholder — upload actual PDF')
  `).run(itemId, filename, `${name} Manual (placeholder)`, `manuals/${itemId}/${filename}`);
}

const insert = db.prepare(`
  INSERT INTO items (name, common_name, category, brand, model, serial_number, year,
    purchase_date, purchase_price, replacement_value, replacement_value_note,
    condition, condition_notes, location, description, quantity, update_checks_enabled)
  VALUES (@name, @common_name, @category, @brand, @model, @serial_number, @year,
    @purchase_date, @purchase_price, @replacement_value, @replacement_value_note,
    @condition, @condition_notes, @location, @description, @quantity, @update_checks_enabled)
`);

const sampleItems = [
  { name: 'Fender Stratocaster', common_name: 'Main Strat', category: 'Guitar', brand: 'Fender', model: 'American Professional II Stratocaster', serial_number: 'US21084567', year: '2021', purchase_date: '2021-06-15', purchase_price: 1699, replacement_value: 1850, replacement_value_note: 'Fender MSRP + Reverb listings (2026)', condition: 'Excellent', condition_notes: 'Minor pick scratches on pickguard', location: 'Desk', description: 'Sunburst finish, maple neck. Primary recording guitar.', quantity: 1, update_checks_enabled: 0, tags: ['Essential', 'Recording'], photos: ['front', 'back'] },
  { name: 'Gibson Les Paul Standard', common_name: 'Les Paul', category: 'Guitar', brand: 'Gibson', model: "Les Paul Standard '60s", serial_number: '213450178', year: '2019', purchase_date: '2019-11-22', purchase_price: 2499, replacement_value: 2800, replacement_value_note: 'Gibson USA current pricing', condition: 'Good', condition_notes: 'Light buckle rash on back', location: 'Main Rack', description: 'Bourbon Burst. Humbucker tones for rock and blues.', quantity: 1, update_checks_enabled: 0, tags: ['Vintage', 'Essential'], photos: ['front'] },
  { name: 'Fender Player Jazz Bass', common_name: 'Jazz Bass', category: 'Bass', brand: 'Fender', model: 'Player Jazz Bass', serial_number: 'MX21098765', year: '2022', purchase_date: '2022-03-10', purchase_price: 849, replacement_value: 949, replacement_value_note: 'Fender Player series MSRP', condition: 'Excellent', condition_notes: '', location: 'Main Rack', description: 'Recording and live bass.', quantity: 1, update_checks_enabled: 0, tags: ['Recording'], photos: ['front'] },
  { name: 'Yamaha FG830', common_name: "Daughter's Acoustic", category: 'Guitar', brand: 'Yamaha', model: 'FG830', serial_number: 'H7T0123456', year: '2020', purchase_date: '2020-08-10', purchase_price: 339, replacement_value: 399, replacement_value_note: 'Current Yamaha retail', condition: 'Good', condition_notes: '', location: "Daughter's Area", description: 'Acoustic for lessons and practice.', quantity: 1, update_checks_enabled: 0, tags: ["Daughter's Gear"], photos: ['front'] },
  { name: 'Shure SM57', common_name: 'SM57 Pair', category: 'Microphone', brand: 'Shure', model: 'SM57', serial_number: 'SM57-88421 / SM57-88422', year: '2018', purchase_date: '2018-03-05', purchase_price: 198, replacement_value: 218, replacement_value_note: 'Street price per unit', condition: 'Excellent', condition_notes: '', location: 'Main Rack', description: 'Industry-standard dynamic mics.', quantity: 2, update_checks_enabled: 0, tags: ['Essential', 'Recording'] },
  { name: 'Audio-Technica AT4040', common_name: 'AT4040', category: 'Microphone', brand: 'Audio-Technica', model: 'AT4040', serial_number: 'AT4040-55210', year: '2020', purchase_date: '2020-01-18', purchase_price: 299, replacement_value: 349, replacement_value_note: 'B&H current listing', condition: 'Excellent', condition_notes: '', location: 'Main Rack', description: 'LD condenser for vocals and acoustic instruments.', quantity: 1, update_checks_enabled: 0, tags: ['Recording'] },
  { name: 'Focusrite Scarlett 18i20', common_name: 'Scarlett Interface', category: 'Audio Interface', brand: 'Focusrite', model: 'Scarlett 18i20 3rd Gen', serial_number: 'S18I20-991234', year: '2022', purchase_date: '2022-04-12', purchase_price: 499, replacement_value: 549, replacement_value_note: 'Focusrite store price', condition: 'Excellent', condition_notes: '', location: 'Desk', description: 'Primary interface. 18 inputs.', quantity: 1, update_checks_enabled: 1, tags: ['Essential', 'Recording'], photos: ['front'], manual: true },
  { name: 'Universal Audio Apollo Twin X', common_name: 'Apollo', category: 'Audio Interface', brand: 'Universal Audio', model: 'Apollo Twin X Duo', serial_number: 'UATX-445566', year: '2023', purchase_date: '2023-09-01', purchase_price: 999, replacement_value: 1099, replacement_value_note: 'UA website MSRP', condition: 'Excellent', condition_notes: '', location: 'Desk', description: 'UAD DSP tracking interface.', quantity: 1, update_checks_enabled: 1, tags: ['Essential', 'Recording'], photos: ['front'], manual: true },
  { name: 'Behringer X-Touch', common_name: 'X-Touch', category: 'Control Surface', brand: 'Behringer', model: 'X-Touch', serial_number: 'XT-771234', year: '2021', purchase_date: '2021-02-15', purchase_price: 599, replacement_value: 649, replacement_value_note: 'Sweetwater current price', condition: 'Good', condition_notes: 'Minor wear on fader caps', location: 'Desk', description: 'DAW control surface with motorized faders.', quantity: 1, update_checks_enabled: 1, tags: ['Essential'], photos: ['front'], manual: true },
  { name: 'Yamaha HS8', common_name: 'HS8 Monitors', category: 'Speaker/Monitor', brand: 'Yamaha', model: 'HS8', serial_number: 'HS8-L8821 / HS8-R8822', year: '2019', purchase_date: '2019-05-20', purchase_price: 698, replacement_value: 798, replacement_value_note: 'Pair replacement cost', condition: 'Good', condition_notes: 'One cabinet scuff', location: 'Desk', description: 'Nearfield studio monitors (pair).', quantity: 2, update_checks_enabled: 0, tags: ['Essential', 'Recording'], photos: ['front'] },
  { name: 'Roland FP-30X', common_name: 'Digital Piano', category: 'Keyboard', brand: 'Roland', model: 'FP-30X', serial_number: 'Z5K77821', year: '2021', purchase_date: '2021-12-01', purchase_price: 799, replacement_value: 899, replacement_value_note: 'Roland current pricing', condition: 'Excellent', condition_notes: '', location: 'Desk', description: '88-key weighted digital piano.', quantity: 1, update_checks_enabled: 1, tags: ['Essential'], photos: ['front'] },
  { name: 'Boss DD-500', common_name: 'DD-500 Delay', category: 'Pedal', brand: 'Boss', model: 'DD-500', serial_number: 'DD500-334455', year: '2017', purchase_date: '2017-07-14', purchase_price: 349, replacement_value: 399, replacement_value_note: 'Used market average', condition: 'Good', condition_notes: 'Velcro on bottom', location: 'Main Rack', description: 'Multi-delay pedal.', quantity: 1, update_checks_enabled: 0, tags: ['Recording'] },
  { name: 'Pearl Export Series 5-Piece', common_name: 'Drum Kit', category: 'Drum Kit', brand: 'Pearl', model: 'Export EXX725', serial_number: 'PEX-882910', year: '2016', purchase_date: '2016-02-28', purchase_price: 899, replacement_value: 1100, replacement_value_note: 'Comparable new kit estimate', condition: 'Fair', condition_notes: 'Cymbals sold separately', location: 'Storage', description: '5-piece kit with hardware.', quantity: 1, update_checks_enabled: 0, tags: ['Recording'], photos: ['front'] },
  { name: 'Fender Blues Junior IV', common_name: 'Blues Junior', category: 'Amplifier', brand: 'Fender', model: 'Blues Junior IV', serial_number: 'BJIV-221098', year: '2019', purchase_date: '2019-08-15', purchase_price: 549, replacement_value: 599, replacement_value_note: 'Fender current pricing', condition: 'Good', condition_notes: 'JJ tubes installed 2024', location: 'Main Rack', description: '15W tube combo amp.', quantity: 1, update_checks_enabled: 0, tags: ['Recording', 'Vintage'] },
  { name: 'Behringer X32 Compact', common_name: 'X32 Mixer', category: 'Mixer', brand: 'Behringer', model: 'X32 Compact', serial_number: 'X32C-771234', year: '2020', purchase_date: '2020-10-05', purchase_price: 1799, replacement_value: 1999, replacement_value_note: 'Sweetwater current price', condition: 'Excellent', condition_notes: '', location: 'Desk', description: 'Digital mixer for live and studio routing.', quantity: 1, update_checks_enabled: 1, tags: ['Essential'], photos: ['front'], manual: true }
];

const tx = db.transaction((items) => {
  for (const item of items) {
    const { tags, photos, manual, ...fields } = item;
    const result = insert.run(fields);
    const id = result.lastInsertRowid;
    setItemTags(id, tags);
    if (photos) {
      for (const suffix of photos) addPhoto(id, item.name, suffix);
    }
    if (manual) addManualPlaceholder(id, item.name);
  }
});

tx(sampleItems);

const total = db.prepare('SELECT COALESCE(SUM(replacement_value*quantity),0) as v FROM items').get().v;
console.log(`Seeded ${sampleItems.length} physical gear items. Total replacement value: $${total.toLocaleString()}`);