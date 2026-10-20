'use strict';
const fs = require('node:fs');
const runtime = require('../module-runtime.js');
const file = process.argv[2];
if (!file) { console.error('Usage: node sdk/validate.cjs path/to/module.manifest.json'); process.exitCode = 1; }
else {
  try {
    if (fs.statSync(file).size > runtime.limits.manifestBytes) throw new Error('Manifest exceeds the import size limit.');
    const manifest = runtime.parseManifest(fs.readFileSync(file, 'utf8'));
    const contract = runtime.getLayoutContract(manifest);
    console.log(manifest.id + ' ' + manifest.version + ': valid v2 manifest; supported host presentations: ' + Object.keys(contract.layout).join(', ') + '.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
