/**
 * @jest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Expo ships most modules as precompiled binaries, which ignore patch-package
// edits to their native code. Every patched module must build from source.
const root = join(__dirname, '..');
const patched = readdirSync(join(root, 'patches'))
  .filter((f) => f.endsWith('.patch'))
  .map((f) => f.replace(/\+[^+]+\.patch$/, '').replace('+', '/'));
const autolinking = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).expo?.autolinking;

describe.each(['android', 'ios'])('%s', (platform) => {
  test.each(patched)('%s builds from source', (pkg) => {
    expect(autolinking?.[platform]?.buildFromSource).toContain(pkg);
  });
});
