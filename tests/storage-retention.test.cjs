const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {auditStorage, inside, writeReport} = require('../scripts/check-storage.cjs');
const {checkpointTrial} = require('../scripts/checkpoint-trial.cjs');

function fixture(t) {
  const base = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(base, 'notchy-retention-'));
  t.after(() => { assert(root.startsWith(base + path.sep)); fs.rmSync(root, {recursive:true, force:true}); });
  const put = (name, contents = 'fixture') => { const filename = path.join(root, name); fs.mkdirSync(path.dirname(filename), {recursive:true}); fs.writeFileSync(filename, contents); return filename; };
  put('notchy-public/app.js', 'source');
  put('notchy-public/.development/target-dir.txt', path.join(root, 'target'));
  put('target/debug/notchy-v2.exe', 'host-v1');
  put('target/debug/native/engine.dll', 'native resource');
  put('target/debug/licenses/NOTICE', 'license');
  put('notchy-public/dist/app.bundle.js', 'frontend-v1');
  const hostHash = crypto.createHash('sha256').update('host-v1').digest('hex');
  put('notchy-public/.development/host-sha256.txt', hostHash);
  const policy = {protected:['Notchy — Mémoire', 'target/debug/notchy-v2.exe', 'notchy-public/.development/profile'], limits:{buildCacheGB:8, testBrowserCacheGB:2, minimumFreeGB:12}, retention:{currentTrial:1}};
  return {root, put, repo:path.join(root, 'notchy-public'), policy, audit:extra => auditStorage({workspace:root, policy, freeBytes:20e9, ...extra})};
}

test('storage audit measures only generated caches and leaves source, maquettes and the current trial unchanged', t => {
  const f = fixture(t);
  f.put('target/debug/deps/generated.bin', Buffer.alloc(100));
  f.put('outputs/test-run/profile/.tauri-webview/Default/Cache/item', Buffer.alloc(200));
  f.put('outputs/maquette.html', '<h1>Maquette</h1>');
  f.put('notchy-public/.development/profile/.tauri-webview/Default/Cache/user', Buffer.alloc(300));
  const report = f.audit();
  assert.equal(report.buildBytes, 100); assert.equal(report.testBrowserBytes, 200); assert.equal(report.deletionAllowed, false);
  assert.deepEqual(report.exceeded, []); assert.equal(fs.readFileSync(path.join(f.root, 'outputs/maquette.html'), 'utf8'), '<h1>Maquette</h1>');
  assert.equal(fs.readFileSync(path.join(f.root, 'target/debug/notchy-v2.exe'), 'utf8'), 'host-v1');
  assert.equal(fs.existsSync(path.join(f.repo, '.development/storage-report.json')), false, 'audit itself writes nothing');
});

test('storage limits are reported without deleting anything, and reports reuse one fixed filename', t => {
  const f = fixture(t); f.put('target/debug/deps/a', '123');
  f.policy.limits.buildCacheGB = 1e-9;
  const report = f.audit({freeBytes:1e9}); assert.equal(report.exceeded.length, 2);
  const filename = writeReport(report); assert.equal(writeReport(f.audit()), filename);
  assert.equal(fs.readFileSync(path.join(f.root, 'target/debug/deps/a'), 'utf8'), '123');
  assert.equal(fs.readdirSync(path.dirname(filename)).filter(name => name.startsWith('storage-report')).length, 1);
});

test('external targets and directory links cannot redirect storage discovery or reports', t => {
  const f = fixture(t); assert.throws(() => f.audit({targetDirectory:path.join(f.root, '..', 'outside')}), /hors/);
  f.put('external/keep.bin', 'must not follow');
  fs.mkdirSync(path.join(f.root, 'target/debug/deps'), {recursive:true});
  fs.symlinkSync(path.join(f.root, 'external'), path.join(f.root, 'target/debug/deps/link'), process.platform === 'win32' ? 'junction' : 'dir');
  const report = f.audit(); assert.equal(report.buildBytes, 0); assert.equal(report.rows[0].skippedLinks, 1);
  assert.throws(() => inside(f.root, path.join(f.root, 'target/debug/deps/link/file')), /jonction/);
  assert.equal(fs.readFileSync(path.join(f.root, 'external/keep.bin'), 'utf8'), 'must not follow');
});

test('a report cannot overwrite a maquette through a hard link', t => {
  const f = fixture(t), original = f.put('outputs/maquette.html', '<h1>Protected</h1>');
  fs.linkSync(original, path.join(f.repo, '.development/storage-report.json'));
  assert.throws(() => writeReport(f.audit()), /physiquement/);
  assert.equal(fs.readFileSync(original, 'utf8'), '<h1>Protected</h1>');
});

test('one checkpoint preserves the original host, native resources and UI and is never rotated automatically', t => {
  const f = fixture(t), first = checkpointTrial(f.repo);
  assert.equal(first.status, 'created');
  for (const [name, value] of [['notchy-v2.exe','host-v1'],['native/engine.dll','native resource'],['dist/app.bundle.js','frontend-v1']]) assert.equal(fs.readFileSync(path.join(first.destination, name), 'utf8'), value);
  f.put('target/debug/notchy-v2.exe', 'host-v2'); f.put('notchy-public/dist/app.bundle.js', 'frontend-v2');
  assert.equal(checkpointTrial(f.repo).status, 'kept');
  assert.equal(fs.readFileSync(path.join(first.destination, 'notchy-v2.exe'), 'utf8'), 'host-v1');
  assert.equal(fs.readdirSync(path.dirname(first.destination)).filter(name => name.startsWith('previous-trial')).length, 1);
  assert.equal(fs.existsSync(path.join(first.destination, 'profile')), false, 'user data is not copied into tests/rollback archives');
});

test('an unknown host or unfinished checkpoint stops rather than replacing the only previous version', t => {
  const f = fixture(t); f.put('target/debug/notchy-v2.exe', 'changed');
  assert.throws(() => checkpointTrial(f.repo), /Empreinte/);
  f.put('target/debug/notchy-v2.exe', 'host-v1'); fs.mkdirSync(path.join(f.repo, '.development/previous-trial.preparing'));
  assert.throws(() => checkpointTrial(f.repo), /inachevée/);
  assert.equal(fs.existsSync(path.join(f.repo, '.development/previous-trial')), false);
});

test('the storage CLI has no deletion/yes option', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/check-storage.cjs'), '--yes'], {encoding:'utf8'});
  assert.equal(result.status, 1); assert.match(result.stderr, /Usage/);
});
