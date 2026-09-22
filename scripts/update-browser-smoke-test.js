const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { mkdtempSync, mkdirSync } = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');
const http = require('http');
const root = path.join(__dirname, '..');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'studio-update-test-'));
const port = 3897;
const base = `http://127.0.0.1:${port}`;

(async () => {
 const child = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true,
  env: { ...process.env, PORT: String(port), STUDIO_DATA_DIR: path.join(temporary, 'data'), STUDIO_KEY_DIR: path.join(temporary, 'keys'), STUDIO_SKIP_UPDATE_CHECK: '1', STUDIO_SKIP_AUTO_BACKUP: '1' }, stdio: 'ignore' });
 let browser;
 try {
  let ready = false;
  for(let n=0;n<60;n++) { try { if((await fetch(base+'/api/health')).ok) { ready=true; break; } } catch {} await new Promise(r=>setTimeout(r,250)); }
  assert(ready, 'isolated server did not start');
  const result = await fetch(base+'/api/update-check?force=1');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).local, true);
  const remoteStatus = await new Promise((resolve,reject)=>{
   http.get(base+'/api/update-check?force=1',{localAddress:'127.0.0.2'},res=>{res.resume();resolve(res.statusCode)}).on('error',reject);
  });
  assert.equal(remoteStatus,401,'remote unauthenticated check must be denied');
  browser = await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.open=(url)=>{window.lastOpenedUpdate=url;return null;};});
  let info={currentVersion:'2.8.0',latestVersion:'2.9.0',updateAvailable:true,local:true,platform:'win32',arch:'x64',releaseUrl:'https://www.terkwerx.com/project-studio-inventory.html#download',installer:{filename:'Studio-Inventory-v2.9.0-Windows-Setup.exe',url:'https://www.terkwerx.com/downloads/studio-inventory/Studio-Inventory-v2.9.0-Windows-Setup.exe',size:100000000},releaseNotes:'Test update notes'};
  let forced=false;
  await page.route('**/api/update-check*',route=>{forced=route.request().url().includes('force=1');return route.fulfill({json:info});});
  await page.goto(base);
  await page.locator('#update-banner:not(.hidden)').waitFor();
  await page.click('#update-banner-download');
  await page.locator('#modal-overlay:not(.hidden)').waitFor();
  assert.match(await page.locator('#modal-message').innerText(),/Full Backup ZIP/);
  await page.click('[data-choice="download"]');
  assert.equal(await page.evaluate(()=>window.lastOpenedUpdate),info.installer.url);
  await page.click('#update-banner-dismiss');
  await page.click('[data-view="about"]');
  await page.click('#app-check-updates');
  await page.waitForFunction(()=>!document.getElementById('app-check-updates').disabled);
  assert(forced,'manual button must bypass cached results');
  assert.match(await page.locator('#app-update-status').innerText(),/2.9.0/);
  assert.equal(await page.locator('#about-app-version').innerText(),`v${require('../package.json').version}`);
  await page.click('#app-download-update');
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  await page.screenshot({path:path.join(root,'dist','website-update-guide.png')});
  await page.click('[data-choice="backup"]');
  await page.locator('#backup-export-full').waitFor();
  await page.click('[data-view="about"]');
  for(const scenario of [
   {patch:{updateAvailable:false,latestVersion:'2.8.0'},pattern:/up to date/},
   {patch:{error:'Offline',updateAvailable:false},pattern:/Could not check/},
   {patch:{error:null,updateAvailable:true,installer:null,local:false},pattern:/No compatible installer/}
  ]) {
   info={...info,...scenario.patch};
   await page.click('#app-check-updates');
   await page.waitForFunction(()=>!document.getElementById('app-check-updates').disabled);
   assert.match(await page.locator('#app-update-status').innerText(),scenario.pattern);
  }
  assert.match(await page.locator('#app-update-status').innerText(),/studio computer/);
  await page.click('#app-download-update');
  assert.equal(await page.evaluate(()=>window.lastOpenedUpdate),info.releaseUrl);
  assert.deepEqual(errors,[]);
  console.log('Update browser checks passed: startup, forced refresh, correct download, backup navigation, offline, current version, unsupported platform, remote guidance, endpoint authorization.');
 } finally {
  if(browser)await browser.close();
  child.kill();await once(child,'exit');
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
