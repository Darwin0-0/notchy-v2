'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {inside} = require('./check-storage.cjs');
const sha = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function plainTree(workspace, filename) {
  inside(workspace, filename);
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink()) throw Error('La copie de retour ne suit aucun lien.');
  if (stat.isDirectory()) for (const name of fs.readdirSync(filename)) plainTree(workspace, path.join(filename, name));
}

// One fixed checkpoint, never a timestamped archive and never overwritten/deleted automatically.
function checkpointTrial(repo) {
  repo = fs.realpathSync(repo);
  const workspace = fs.realpathSync(path.join(repo, '..'));
  const development = inside(workspace, path.join(repo, '.development'));
  const targetNote = inside(workspace, path.join(development, 'target-dir.txt'));
  const hostNote = inside(workspace, path.join(development, 'host-sha256.txt'));
  if (!fs.existsSync(targetNote) || !fs.existsSync(hostNote)) return {status:'no-trial'};
  const target = inside(workspace, path.resolve(repo, fs.readFileSync(targetNote, 'utf8').trim()));
  const debug = inside(workspace, path.join(target, 'debug'));
  const host = inside(workspace, path.join(debug, 'notchy-v2.exe'));
  if (!fs.existsSync(host)) return {status:'no-trial'};
  const destination = inside(workspace, path.join(development, 'previous-trial'));
  if (fs.existsSync(destination)) {
    plainTree(workspace, destination);
    const saved = JSON.parse(fs.readFileSync(path.join(destination, 'checkpoint.json'), 'utf8'));
    if (sha(path.join(destination, 'notchy-v2.exe')) !== saved.hostSha256) throw Error('Copie de retour à vérifier ; aucun remplacement automatique.');
    return {status:'kept', destination};
  }
  const hostSha = sha(host);
  if (hostSha !== fs.readFileSync(hostNote, 'utf8').trim().toLowerCase()) throw Error('Empreinte de l’essai inconnue : conserver et vérifier avant de le remplacer.');
  const staging = inside(workspace, path.join(development, 'previous-trial.preparing'));
  if (fs.existsSync(staging)) throw Error('Copie de retour inachevée : la vérifier avant de continuer, sans suppression automatique.');
  const copies = [[host, 'notchy-v2.exe']];
  for (const name of ['native', 'licenses', 'THIRD_PARTY_NOTICES.md']) { const source = path.join(debug, name); if (fs.existsSync(source)) copies.push([source, name]); }
  const dist = path.join(repo, 'dist'); if (fs.existsSync(dist)) copies.push([dist, 'dist']);
  for (const [source] of copies) plainTree(workspace, source);
  fs.mkdirSync(staging);
  for (const [source, name] of copies) fs.cpSync(source, path.join(staging, name), {recursive:true, errorOnExist:true, force:false});
  if (sha(path.join(staging, 'notchy-v2.exe')) !== hostSha) throw Error('Copie de retour incomplète ; les fichiers préparés restent conservés.');
  const bundle = path.join(staging, 'dist/app.bundle.js');
  fs.writeFileSync(path.join(staging, 'checkpoint.json'), JSON.stringify({createdAt:new Date().toISOString(), hostSha256:hostSha, frontendSha256:fs.existsSync(bundle) ? sha(bundle) : null, sourceHost:host, sourceProfile:path.join(development, 'profile'), status:'kept-until-human-validation', note:'Snapshot local du binaire, ressources et frontend. Aucun profil utilisateur copié. Aucune restauration ou suppression automatique.'}, null, 2));
  inside(workspace, destination); inside(workspace, staging);
  fs.renameSync(staging, destination);
  return {status:'created', destination};
}
module.exports = {checkpointTrial};
