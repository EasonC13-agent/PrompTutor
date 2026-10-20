const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
test('build allowlist excludes old archives and unrelated private/dev files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptutor-build-fixture-'));
  try {
    for (const name of ['scripts', 'src', 'icons', 'backend', 'test']) fs.mkdirSync(path.join(dir, name));
    fs.copyFileSync(path.join(__dirname, '../scripts/build.sh'), path.join(dir, 'scripts/build.sh'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(dir, 'src/fixture.js'), '// fixture');
    fs.writeFileSync(path.join(dir, 'icons/fixture.txt'), 'fixture');
    for (const name of ['private-notes.txt', 'promptutor.zip', 'backend/private.txt', 'test/fixture.js']) fs.writeFileSync(path.join(dir, name), 'DO NOT PACKAGE');
    execFileSync('bash', ['scripts/build.sh'], { cwd: dir, stdio: 'pipe' });
    const names = execFileSync('unzip', ['-Z1', path.join(dir, 'promptutor.zip')], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(names.includes('src/fixture.js'));
    assert.ok(names.includes('manifest.json'));
    assert.ok(names.every(name => /^(manifest\.json|src\/|icons\/)/.test(name)), names.join('\n'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
