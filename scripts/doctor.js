const fs = require('fs');
const path = require('path');

const root = process.cwd();

const requiredFiles = [
  'package.json',
  'package-lock.json',
  'main.js',
  'index.html',
  'script.js',
  'styles.css',
  path.join('build', 'icon.ico')
];

const missing = requiredFiles.filter(file => !fs.existsSync(path.join(root, file)));

function fail(message) {
  console.error(`\n[doctor] ${message}`);
  process.exitCode = 1;
}

if (missing.length) {
  fail('Thieu file bat buoc de build Windows:');
  missing.forEach(file => console.error(`  - ${file}`));
  console.error('\nHay copy source day du, khong chi copy package-lock.json hoac thu muc dist.');
  process.exit();
}

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
} catch (error) {
  fail(`package.json khong doc duoc hoac sai JSON: ${error.message}`);
  process.exit();
}

const requiredScripts = ['start', 'build'];
const missingScripts = requiredScripts.filter(script => !pkg.scripts || !pkg.scripts[script]);
if (missingScripts.length) {
  fail(`package.json thieu script: ${missingScripts.join(', ')}`);
  process.exit();
}

if (pkg.main !== 'main.js') {
  fail('package.json main phai tro den main.js');
  process.exit();
}

console.log('[doctor] OK: Source build Windows day du.');
console.log(`[doctor] Thu muc hien tai: ${root}`);
