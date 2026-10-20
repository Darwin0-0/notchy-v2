const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const windows = process.platform === 'win32';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notchy-native-trial-'));
  t.after(() => {
    assert(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, {recursive:true, force:true});
  });
  for (const folder of ['scripts', 'src-tauri', 'native/bin', '.development', 'target/debug']) fs.mkdirSync(path.join(root, folder), {recursive:true});
  fs.copyFileSync(path.join(__dirname, '../scripts/lancer-dev.ps1'), path.join(root, 'scripts/lancer-dev.ps1'));
  fs.writeFileSync(path.join(root, 'scripts/build-frontend.cjs'), "require('node:fs').writeFileSync('frontend-built.txt','fresh frontend');");
  fs.writeFileSync(path.join(root, 'native/bin/MediaBridge.exe'), 'declared helper fixture');
  const executable = path.join(root, 'target/debug/notchy-v2.exe'); fs.writeFileSync(executable, 'host fixture: must never execute');
  fs.writeFileSync(path.join(root, '.development/target-dir.txt'), path.join(root, 'target'));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  fs.writeFileSync(path.join(root, '.development/host-sha256.txt'), hash);
  const manifest = {bundle:{resources:{'../native/bin/MediaBridge.exe':'native/MediaBridge.exe'}}};
  const writeManifest = () => fs.writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify(manifest)); writeManifest();
  const harness = path.join(root, 'harness.ps1');
  fs.writeFileSync(harness, `
function Start-Process {
  param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory)
  @{file=$FilePath; arguments=$ArgumentList; working=$WorkingDirectory} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'started.json')
}
try { & (Join-Path $PSScriptRoot 'scripts/lancer-dev.ps1'); exit 0 }
catch { Write-Output $_.Exception.Message; exit 1 }
`);
  const run = () => spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness], {
    cwd:root, encoding:'utf8', timeout:20000,
    // No cargo or browser executable is reachable: this path only updates frontend files.
    env:{...process.env, PATH:'', CARGO_TARGET_DIR:'', NOTCHY_NODE:process.execPath}
  });
  return {root, executable, manifest, writeManifest, run};
}

test('the native trial launcher refreshes only UI, copies declared helpers and requests a real host reload', {skip:!windows}, t => {
  const f = fixture(t), result = f.run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(f.root, 'frontend-built.txt'), 'utf8'), 'fresh frontend');
  assert.equal(fs.readFileSync(path.join(f.root, 'target/debug/native/MediaBridge.exe'), 'utf8'), 'declared helper fixture');
  const started = JSON.parse(fs.readFileSync(path.join(f.root, 'started.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(started.file, f.executable); assert.deepEqual(started.arguments, ['--reload-ui']); assert.equal(started.working, f.root);
  assert.equal(fs.existsSync(path.join(f.root, '.development/profile')), false, 'only the actual native host creates and owns its isolated data');
});

test('the trial refuses an unknown or replaced executable rather than launching an old host', {skip:!windows}, t => {
  const f = fixture(t); fs.appendFileSync(f.executable, 'replaced');
  const result = f.run(); assert.equal(result.status, 1); assert.match(result.stdout, /noyau natif a change/);
  assert.equal(fs.existsSync(path.join(f.root, 'started.json')), false);
  fs.unlinkSync(path.join(f.root, '.development/host-sha256.txt'));
  const absent = f.run(); assert.equal(absent.status, 1); assert.match(absent.stdout, /prepare une premiere fois/);
  assert.equal(fs.existsSync(path.join(f.root, 'started.json')), false);
});

test('native helper staging cannot escape the debug directory', {skip:!windows}, t => {
  const f = fixture(t); f.manifest.bundle.resources['../native/bin/MediaBridge.exe'] = '../../outside.exe'; f.writeManifest();
  const result = f.run(); assert.equal(result.status, 1); assert.match(result.stdout, /ressource native sort/);
  assert.equal(fs.existsSync(path.join(f.root, 'outside.exe')), false); assert.equal(fs.existsSync(path.join(f.root, 'started.json')), false);
});
