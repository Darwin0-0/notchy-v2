'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildFrontend, readManifest } = require('../scripts/build-frontend.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notchy-frontend-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'assets'));
  const manifest = { bundle: 'app.bundle.js', scripts: ['module.js', 'app.js'], assets: ['index.html', 'style.css'], copies: [{ source: 'assets/icon.ico', destination: 'icon.ico' }] };
  const writeManifest = () => fs.writeFileSync(path.join(root, 'scripts/frontend-manifest.json'), JSON.stringify(manifest));
  writeManifest();
  fs.writeFileSync(path.join(root, 'module.js'), '(function(root){const value=7; if(typeof module===\'object\'&&module.exports)module.exports={value};else root.ExampleModule={value};})(typeof globalThis!==\'undefined\'?globalThis:this);');
  fs.writeFileSync(path.join(root, 'app.js'), '(function(root){root.startedWith=root.ExampleModule.value;})(globalThis);');
  fs.writeFileSync(path.join(root, 'index.html'), '<link href="style.css" rel="stylesheet"><script src="app.bundle.js" defer></script>');
  fs.writeFileSync(path.join(root, 'style.css'), 'body{color:#fff}');
  fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.from([0, 1, 2, 3]));
  return { root, manifest, writeManifest };
}

function inventory(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? inventory(path.join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort();
}

test('the frontend build preserves classic UMD globals and starts after its modules in one deterministic bundle', t => {
  const { root } = fixture(t), first = buildFrontend({ root });
  assert.deepEqual(first.files, ['app.bundle.js', 'icon.ico', 'index.html', 'style.css']);
  assert.deepEqual(inventory(first.dist), first.files);
  assert.deepEqual(fs.readFileSync(path.join(first.dist, 'icon.ico')), Buffer.from([0, 1, 2, 3]));
  const bundle = fs.readFileSync(path.join(first.dist, 'app.bundle.js'), 'utf8'), browser = {};
  vm.runInNewContext(bundle, browser);
  assert.equal(browser.startedWith, 7);
  fs.writeFileSync(path.join(first.dist, 'stale.js'), 'must disappear');
  fs.mkdirSync(path.join(first.dist, 'old'));
  fs.writeFileSync(path.join(first.dist, 'old/asset.txt'), 'must disappear');
  const second = buildFrontend({ root });
  assert.equal(fs.readFileSync(path.join(second.dist, 'app.bundle.js'), 'utf8'), bundle);
  assert.deepEqual(inventory(second.dist), first.files);
});

test('source edits are reflected in the next bundle without copying source scripts', t => {
  const { root } = fixture(t);
  buildFrontend({ root });
  fs.appendFileSync(path.join(root, 'module.js'), '\n;globalThis.ExampleModule.value=9;');
  const built = buildFrontend({ root }), browser = {};
  vm.runInNewContext(fs.readFileSync(path.join(built.dist, 'app.bundle.js'), 'utf8'), browser);
  assert.equal(browser.startedWith, 9);
  assert.deepEqual(inventory(built.dist).filter(name => name.endsWith('.js')), ['app.bundle.js']);
});

test('missing or invalid input fails before replacing the previous frontend', t => {
  const { root } = fixture(t), built = buildFrontend({ root }), original = fs.readFileSync(path.join(built.dist, 'app.bundle.js'));
  const source = fs.readFileSync(path.join(root, 'module.js'));
  fs.unlinkSync(path.join(root, 'module.js'));
  assert.throws(() => buildFrontend({ root }), /ENOENT/);
  assert.deepEqual(fs.readFileSync(path.join(built.dist, 'app.bundle.js')), original);
  fs.writeFileSync(path.join(root, 'module.js'), 'function invalid(');
  assert.throws(() => buildFrontend({ root }), SyntaxError);
  assert.deepEqual(fs.readFileSync(path.join(built.dist, 'app.bundle.js')), original);
  fs.writeFileSync(path.join(root, 'module.js'), source);
  for (const html of [
    '<script src="module.js" defer></script><script src="app.bundle.js" defer></script>',
    '<script data-src="app.bundle.js" defer></script>',
    '<script data-src="app.bundle.js" src="module.js" defer></script>'
  ]) {
    fs.writeFileSync(path.join(root, 'index.html'), html);
    assert.throws(() => buildFrontend({ root }), /load only app.bundle.js/);
    assert.deepEqual(fs.readFileSync(path.join(built.dist, 'app.bundle.js')), original);
  }
});

test('manifest paths, duplicate outputs and startup order are checked before deleting generated assets', t => {
  const { root, manifest, writeManifest } = fixture(t), built = buildFrontend({ root });
  fs.writeFileSync(path.join(root, 'extra.JS'), 'globalThis.extra=true;');
  fs.writeFileSync(path.join(root, 'assets/extra.Js'), 'globalThis.extra=true;');
  const badCases = [
    () => { manifest.assets.push('../private.css'); },
    () => { manifest.assets.push('nested/../../private.css'); },
    () => { manifest.copies.push({ source: 'assets/icon.ico', destination: '/escape.ico' }); },
    () => { manifest.copies.push({ source: 'assets/icon.ico', destination: 'app.bundle.js' }); },
    () => { manifest.assets.push('extra.JS'); },
    () => { manifest.copies.push({ source: 'assets/icon.ico', destination: 'extra.JS' }); },
    () => { manifest.copies.push({ source: 'assets/extra.Js', destination: 'extra.txt' }); },
    () => { manifest.scripts.unshift('module.js'); },
    () => { manifest.scripts.reverse(); }
  ];
  const valid = JSON.stringify(manifest);
  for (const mutate of badCases) {
    Object.assign(manifest, JSON.parse(valid)); mutate(); writeManifest();
    assert.throws(() => buildFrontend({ root }));
    assert(fs.existsSync(path.join(built.dist, 'app.bundle.js')));
  }
});

test('the builder refuses links inside the previous generated directory', t => {
  const { root } = fixture(t), built = buildFrontend({ root });
  const outside = path.join(root, 'do-not-delete'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  try { fs.symlinkSync(outside, path.join(built.dist, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Creating links is not permitted in this environment'); throw error; }
  assert.throws(() => buildFrontend({ root }), /must not contain links/);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('the builder refuses input directory links even when they point inside the project', t => {
  const { root, manifest, writeManifest } = fixture(t);
  fs.mkdirSync(path.join(root, 'actual'));
  fs.writeFileSync(path.join(root, 'actual/extra.css'), 'body{}');
  try { fs.symlinkSync(path.join(root, 'actual'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Creating links is not permitted in this environment'); throw error; }
  manifest.assets.push('linked/extra.css'); writeManifest();
  assert.throws(() => buildFrontend({ root }), /inputs must not contain links/);
  assert.equal(fs.existsSync(path.join(root, 'dist')), false);
});

test('the app manifest declares the real source entry and exactly one runtime JavaScript output', () => {
  const root = fs.realpathSync(path.join(__dirname, '..')), manifest = readManifest(root);
  assert.equal(manifest.scripts.at(-1), 'app.js');
  assert.equal(manifest.bundle, 'app.bundle.js');
  assert(manifest.scripts.indexOf('mimo-renderer.js') >= 0 && manifest.scripts.indexOf('mimo-renderer.js') < manifest.scripts.indexOf('galet.js'),'the exact Mimo renderer must load before its application adapter');
  assert(manifest.scripts.indexOf('tokens.js') < manifest.scripts.indexOf('module-contracts.js'));
  for (const adapter of ['focus-duration.js', 'module-runtime.js', 'notch.js']) assert(manifest.scripts.indexOf('module-contracts.js') < manifest.scripts.indexOf(adapter));
  for (const name of [...manifest.scripts, ...manifest.assets, ...manifest.copies.map(copy => copy.source)]) assert(fs.statSync(path.join(root, name)).isFile(), name);
  assert(!manifest.assets.some(name => name.endsWith('.js')));
  for (const removed of ['mimo-agent.js','mimo-context.js','mimo-drag.js','mimo-agent.css','mimo-context.css']) {
    assert(!manifest.scripts.includes(removed)&&!manifest.assets.includes(removed),removed+' is not shipped');
    assert(!fs.existsSync(path.join(root,removed)),removed+' source is removed');
  }
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),notch=fs.readFileSync(path.join(root,'notch.js'),'utf8');
  assert(html.includes('<span id="galet-header" aria-hidden="true" hidden></span>'),'Mimo stays a decorative companion');
  assert(!html.includes('mimo-player'));
  assert(!/showMimo|getMimo|NotchyMimoContext|NotchyMimoDrag|mimoDesktop|mimoContext/.test(notch),'no drag, reading or response route remains');
});
