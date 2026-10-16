#!/usr/bin/env node
/* Idempotent migration of existing foundations. No network or package execution. */
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--check');
const foundationNames = new Set(['tokens.css', 'tokens.js']);
const exactDeadRules = [
  '.notch[data-state="open"] #module-feedback-actions { display: none; }',
  '.notch:not([data-state="open"]) #module-feedback-actions { display: none; }',
  '.live-activities { display: flex; align-items: center; gap: 10px; height: 100%; padding: 0 12px 2px; }',
  '.notch[data-live-count="2"] .focus-live { flex: 0 0 auto; padding-left: 10px; border-left: 1px solid #ffffff25; }',
];
const semanticColors = new Map(Object.entries({
  '6fe3c4':'activity-focus', '6fe3c5':'activity-focus', '5ac8fa':'activity-break',
  'bf8bff':'activity-long', '8ac8ff':'activity-transfer', 'f28b96':'activity-music',
  'a6e3b4':'activity-tasks', '56df86':'status-success', '30d158':'status-success',
  'f0b45c':'status-warning', 'ff6b75':'status-error', 'ff453a':'status-error',
  'b6b8c4':'status-idle',
}));
const tokensPath = path.join(root, 'tokens.css');
let tokensSource = await readFile(tokensPath, 'utf8');
const generated = new Map([...tokensSource.matchAll(/--((?:color|measure|time)-[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]]));
const declare = (name, value) => {generated.set(name, value); return `var(--${name})`;};
const measureName = (value, unit) => `measure-${value.replace('-', 'neg-').replace('.', 'd')}-${unit}`;
function cssValue(value, property) {
  if (property === 'font-family' && !/^(?:inherit|var\(--font-ui\))\s*$/.test(value)) value = 'var(--font-ui)';
  if (property === 'font') {
    const family = value.indexOf("'Manrope'");
    if (family >= 0 && !value.slice(0, family).endsWith('var(--ui-font,')) value = value.slice(0, family) + 'var(--font-ui)';
    value = value.replace(/var\(--ui-font,'Manrope',system-ui,var\(--font-ui\)\)/g, 'var(--font-ui)');
  }
  value = value.replace(/(?:'Manrope'\s*,\s*)?(?:'Segoe UI Variable'\s*,\s*)?(?:'Segoe UI'\s*,\s*)?sans-serif/g, 'var(--font-ui)');
  value = value.replace(/#[\da-f]{3,8}\b/gi, color => {
    const hex = color.slice(1).toLowerCase();
    return semanticColors.has(hex) ? `var(--${semanticColors.get(hex)})` : declare(`color-${hex}`, color.toLowerCase());
  });
  value = value.replace(/rgba?\([\d\s.,%]+\)/g, color => declare('color-' + color.toLowerCase().replaceAll('.', 'd').replace(/[^\da-z]+/g, '-').replace(/-$/, ''), color));
  value = value.replace(/linear\(0,\s*\.?0?702[\d\s.,]*\)/g, 'var(--ease-island)');
  value = value.replace(/cubic-bezier\(\s*\.2\s*,\s*\.8\s*,\s*\.2\s*,\s*1\s*\)/g, 'var(--ease-out)');
  value = value.replace(/\b180ms\s+ease(?![\w-])/g, 'var(--dur-fast) var(--ease-standard)').replace(/\b120ms\s+ease(?![\w-])/g, 'var(--dur-instant) var(--ease-standard)');
  value = value.replaceAll('var(--ease-standard)-out', 'var(--ease-out)').replaceAll('var(--ease-standard)-in-out', 'var(--ease-standard)');
  value = value.replace(/\b(width|transform|stroke-dashoffset)\s+(?:1s|1000ms|250ms|220ms)\s+linear\b/g, '$1 var(--dur-progress) var(--ease-progress)');
  value = value.replace(/\b(width|transform)\s+var\(--island-progress-duration(?:,[^)]+)?\)\s+linear\b/g, '$1 var(--dur-progress) var(--ease-progress)');
  value = value.replace(/(?<![\w-])(-?(?:\d*\.)?\d+)(px|ms|s)\b/g, (literal, value, unit) => {
    if (unit === 'ms' || unit === 's') {
      const ms = Number(value) * (unit === 's' ? 1000 : 1);
      const role = new Map([[120,'instant'],[200,'fast'],[240,'base'],[300,'base'],[500,'spring'],[150,'exit'],[250,'progress']]).get(ms);
      return role ? `var(--dur-${role})` : declare(`time-${String(ms).replace('.', 'd')}`, `${ms}ms`);
    }
    const number = Number(value);
    if (property === 'font-size') {
      const role = new Map([[10,'xs'],[12,'s'],[14,'m'],[18,'l'],[28,'xl']]).get(number);
      if (role) return `var(--text-${role})`;
    }
    if (/radius$/.test(property)) {
      const role = new Map([[6,'art'],[8,'control'],[12,'card'],[999,'pill']]).get(number);
      if (role) return `var(--radius-${role})`;
    }
    if (/^(?:gap|(?:row|column)-gap|padding(?:-.+)?|margin(?:-.+)?)$/.test(property) && number > 0 && number <= 32 && number % 4 === 0) return `var(--space-${number / 4})`;
    return declare(measureName(value, unit), literal);
  });
  return value;
}
function transformCss(source) {
  // Declaration values only: selectors, @media thresholds, SVG paths and comments stay intact.
  return source.replace(/(\/\*[\s\S]*?\*\/)|([\w-]+)(\s*:\s*)([^{};]+)(;|(?=\}))/g, (all, comment, property, separator, value, end) => {
    if (comment || !property) return all;
    return property + separator + cssValue(value, property) + end;
  });
}
function renameStateLiterals(source, extension) {
  source = source.replaceAll('[data-state="discreet"]', '[data-state="rest"]').replaceAll('[data-state="hover"]', '[data-state="compact"]');
  if (extension === '.css') return source;
  // "discreet" was exclusively a state literal; hover also names an event and delay.
  source = source.replace(/(['"])discreet\1/g, '$1rest$1');
  source = source.replace(/((?:\bstate|\bnext|\bpreviousState|\breturnState|\bclosingTo)\s*(?:===?|!==?)\s*)(['"])hover\2/g, '$1$2compact$2');
  source = source.replace(/((?:setState|closedBandSize|settle)\(\s*)(['"])hover\2/g, '$1$2compact$2');
  source = source.replace(/(\bstate\s*:\s*)(['"])hover\2/g, '$1$2compact$2');
  source = source.replace(/(\bstate\s*=\s*)(['"])hover\2/g, '$1$2compact$2');
  source = source.replace(/(\bsizes\.)discreet\b/g, '$1rest').replace(/(\bsizes\.)hover\b/g, '$1compact');
  source = source.replace(/^(\s*)discreet:(\s*closedBandSize)/gm, '$1rest:$2').replace(/^(\s*)hover:(\s*closedBandSize)/gm, '$1compact:$2');
  return source;
}
function transformJsMotion(source) {
  source = source.replace(/\bduration:\s*240\b/g, "duration: typeof NOTCH_TOKENS === 'object' ? NOTCH_TOKENS.dur.base : 300");
  source = source.replace(/\beasing:\s*'cubic-bezier\(\.2,\.8,\.2,1\)'/g, "easing: typeof NOTCH_TOKENS === 'object' ? NOTCH_TOKENS.ease.out : 'ease-out'");
  return source;
}
async function walk(directory, nested = false) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    if (entry.isDirectory()) {
      if (entry.name === 'tests') files.push(...await walk(path.join(directory, entry.name), true));
      continue;
    }
    if (/\.(?:js|css|cjs|html)$/.test(entry.name) && !foundationNames.has(entry.name) && (nested || entry.name !== 'index.html')) files.push(path.join(directory, entry.name));
  }
  return files;
}
const files = await walk(root);
files.push(path.join(root, 'src-tauri', 'src', 'window_bridge.js'));
const changed = [], jsHex = new Map();
for (const file of files) {
  let source = await readFile(file, 'utf8'); const original = source;
  const extension = path.extname(file), test = file.includes(`${path.sep}tests${path.sep}`);
  for (const rule of exactDeadRules) source = source.replaceAll(rule + '\r\n', '').replaceAll(rule + '\n', '').replaceAll(rule, '');
  source = source.replaceAll('#focus-player[data-focus-design="22.6"]', '#focus-player').replaceAll('#music-player[data-music-design="revision-2"]', '#music-player');
  // Test-source regex escapes the selector too; remove only these obsolete flags.
  source = source.replaceAll('[data-focus-design="22.6"]', '').replaceAll('[data-music-design="revision-2"]', '');
  source = source.replace(/^\s*(?:host|player)\.dataset\.(?:focusDesign|musicDesign)\s*=\s*[^;\n]+;\s*$/gm, '');
  source = renameStateLiterals(source, extension);
  if (test) source = source.replace(/(['"])hover\1/g, '$1compact$1');
  if (test) source = source.replace(/\bdiscreet:(?=\{)/g, 'rest:').replace(/\bhover:(?=\{)/g, 'compact:');
  if (extension === '.css') source = transformCss(source);
  if (!test && extension === '.js') source = transformJsMotion(source);
  if (!test && extension === '.js') jsHex.set(path.relative(root, file), [...new Set(source.match(/#[\da-f]{3,8}\b/gi) || [])]);
  if (source !== original) {changed.push(path.relative(root, file)); if (!dry) await writeFile(file, source);}
}
const marker = '/* Existing exact measurements retained to avoid changing approved module layouts. */';
tokensSource = tokensSource.split(marker)[0].trimEnd() + '\n\n' + marker + '\n:root {\n' + [...generated].sort(([a],[b]) => a.localeCompare(b)).map(([name,value]) => `  --${name}: ${value};`).join('\n') + '\n}\n';
if (tokensSource !== await readFile(tokensPath, 'utf8')) {changed.push('tokens.css'); if (!dry) await writeFile(tokensPath, tokensSource);}
console.log(JSON.stringify({check:dry, changed:changed.length, files:changed, jsHexReview:Object.fromEntries([...jsHex].filter(([,hex])=>hex.length))}, null, 2));
if (dry && changed.length) process.exitCode = 1;
