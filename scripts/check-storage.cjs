'use strict';
const fs = require('node:fs');
const path = require('node:path');
const policy = require('./storage-policy.json');
const cacheNames = ['incremental', 'deps', 'build', '.fingerprint', 'examples'];
const browserNames = new Set(['.tauri-webview', 'WebView2_Data']);

function inside(root, filename) {
  const resolved = path.resolve(filename), relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Chemin hors du dossier de travail.');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('Lien ou jonction refusé : ' + current); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}

function treeSize(filename) {
  let bytes = 0, skippedLinks = 0;
  const stack = [filename];
  while (stack.length) {
    const current = stack.pop(), stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) { skippedLinks++; continue; }
    if (stat.isDirectory()) for (const child of fs.readdirSync(current)) stack.push(path.join(current, child));
    else if (stat.isFile()) bytes += stat.size;
  }
  return {bytes, skippedLinks};
}

function auditStorage(options = {}) {
  const workspace = fs.realpathSync(options.workspace || path.join(__dirname, '../..'));
  const repo = inside(workspace, path.join(workspace, 'notchy-public'));
  const protectedPaths = (options.policy || policy).protected.map(name => inside(workspace, path.join(workspace, name)));
  const config = options.policy || policy, rows = [], seen = new Set();
  const protectedPath = filename => protectedPaths.some(keep => filename === keep || filename.startsWith(keep + path.sep));
  const add = (filename, category) => {
    if (!fs.existsSync(filename)) return;
    const resolved = inside(workspace, filename);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    rows.push({path:path.relative(workspace, resolved).split(path.sep).join('/'), category, ...treeSize(resolved), protected:protectedPath(resolved)});
  };
  const note = path.join(repo, '.development/target-dir.txt');
  let selected = options.targetDirectory;
  if (!selected && fs.existsSync(note)) { inside(workspace, note); selected = fs.readFileSync(note, 'utf8').trim(); }
  const targets = new Set([path.join(repo, 'src-tauri/target'), path.join(workspace, 'notchy-minimal/src-tauri/target')]);
  if (selected) targets.add(inside(workspace, path.resolve(repo, selected)));
  for (const target of targets) {
    inside(workspace, target);
    for (const prefix of ['', 'x86_64-pc-windows-msvc']) for (const mode of ['debug', 'release']) for (const name of cacheNames) add(path.join(target, prefix, mode, name), 'build');
  }
  for (const start of [path.join(workspace, 'outputs'), path.join(repo, '.development/qa')]) {
    if (!fs.existsSync(start)) continue;
    inside(workspace, start);
    const stack = [start];
    while (stack.length) {
      const current = stack.pop();
      inside(workspace, current);
      for (const entry of fs.readdirSync(current, {withFileTypes:true})) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
        const filename = path.join(current, entry.name);
        if (browserNames.has(entry.name)) add(filename, 'test-browser');
        else if (!['node_modules', '.git', '.codex', 'runtime'].includes(entry.name)) stack.push(filename);
      }
    }
  }
  const freeBytes = options.freeBytes ?? (() => { const stat = fs.statfsSync(workspace); return stat.bavail * stat.bsize; })();
  const buildBytes = rows.filter(row => row.category === 'build').reduce((n, row) => n + row.bytes, 0);
  const testBrowserBytes = rows.filter(row => row.category === 'test-browser').reduce((n, row) => n + row.bytes, 0);
  const exceeded = [];
  if (buildBytes > config.limits.buildCacheGB * 1e9) exceeded.push('Caches de compilation au-dessus de ' + config.limits.buildCacheGB + ' Go');
  if (testBrowserBytes > config.limits.testBrowserCacheGB * 1e9) exceeded.push('Caches navigateur des essais au-dessus de ' + config.limits.testBrowserCacheGB + ' Go');
  if (freeBytes < config.limits.minimumFreeGB * 1e9) exceeded.push('Moins de ' + config.limits.minimumFreeGB + ' Go libres');
  return {version:1, measuredAt:new Date().toISOString(), workspace, buildBytes, testBrowserBytes, freeBytes, exceeded, rows, deletionAllowed:false, limits:config.limits, retention:config.retention, note:'Tailles logiques ; les liens physiques peuvent être comptés plusieurs fois. Aucun fichier supprimé.'};
}

function writeReport(report) {
  const repo = inside(report.workspace, path.join(report.workspace, 'notchy-public'));
  const filename = inside(report.workspace, path.join(repo, '.development/storage-report.json'));
  if (fs.existsSync(filename) && fs.lstatSync(filename).nlink > 1) throw Error('Rapport lié physiquement à un autre fichier : écriture refusée.');
  fs.mkdirSync(path.dirname(filename), {recursive:true});
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
  return filename;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2); let targetDirectory, guard = false;
    while (args.length) { const value = args.shift(); if (value === '--guard') guard = true; else if (value === '--target' && args.length) targetDirectory = args.shift(); else throw Error('Usage : node scripts/check-storage.cjs [--guard] [--target <dossier>]'); }
    const report = auditStorage({targetDirectory}), filename = writeReport(report), gb = n => (n / 1e9).toFixed(2);
    console.log(`Stockage : compilation ${gb(report.buildBytes)} Go ; navigateurs d'essai ${gb(report.testBrowserBytes)} Go ; libres ${gb(report.freeBytes)} Go.`);
    console.log('Rapport unique : ' + filename);
    if (report.exceeded.length) console.log(report.exceeded.join('\n') + '\nPrésenter un plan précis et demander un nouvel accord avant toute suppression.');
    if (guard && report.exceeded.length) { console.error('Nouvelle compilation suspendue ; aucun nettoyage automatique.'); process.exitCode = 2; }
  } catch (error) { console.error('Contrôle stockage impossible : ' + error.message); process.exitCode = 1; }
}
module.exports = {auditStorage, inside, treeSize, writeReport};
