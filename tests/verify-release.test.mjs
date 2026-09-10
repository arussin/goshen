import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEntries, createZip } from '../scripts/package.mjs';
import { parseArguments, sha256, verifyRelease } from '../scripts/verify-release.mjs';

async function fixture(context) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'goshen-verify-'));
  context.after(async () => {
    const resolved = path.resolve(base);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('goshen-verify-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const source = path.join(base, 'source');
  await mkdir(path.join(source, 'extension', 'icons'), { recursive: true });
  // Deliberately historical and not a currently valid package: no validation or execution.
  await writeFile(path.join(source, 'extension', 'manifest.json'), '{"version":"0.3.5","permissions":[]}\n');
  await writeFile(path.join(source, 'extension', 'content.js'), 'throw new Error("must never execute source");\n');
  await writeFile(path.join(source, 'extension', 'icons', 'icon.png'), Buffer.from([0, 1, 2, 255]));
  await writeFile(path.join(source, 'LICENSE'), 'MIT\n');
  await writeFile(path.join(source, 'NOTICE'), 'Notice\n');
  const archive = path.join(base, 'release.zip');
  await writeFile(archive, createZip(await collectEntries(source)));
  const directory = path.join(base, 'unpacked');
  await cp(path.join(source, 'extension'), directory, { recursive: true });
  await cp(path.join(source, 'LICENSE'), path.join(directory, 'LICENSE'));
  await cp(path.join(source, 'NOTICE'), path.join(directory, 'NOTICE'));
  return { base, source, archive, directory };
}

test('archive comparison checks exact deterministic bytes and emits SHA-256 inventory without writing', async context => {
  const { source, archive } = await fixture(context);
  const before = await readFile(archive);
  const result = await verifyRelease({ source, archive, inventory: true });
  assert.equal(result.verified, true);
  assert.equal(result.expectedArchiveSha256, sha256(before));
  assert.equal(result.actualArchiveSha256, result.expectedArchiveSha256);
  assert.deepEqual(result.differences, []);
  assert.equal(result.expectedFiles.length, 5);
  assert.equal(result.expectedFiles.find(file => file.path === 'content.js').sha256, sha256(await readFile(path.join(source, 'extension', 'content.js'))));
  assert.deepEqual(await readFile(archive), before);
  await writeFile(archive, Buffer.concat([before, Buffer.from('extra archive bytes')]));
  const modified = await verifyRelease({ source, archive });
  assert.equal(modified.verified, false);
  assert.equal(modified.differences[0].status, 'changed');
  assert.equal(modified.expectedFiles, undefined);
});

test('directory comparison reports every changed executable, manifest, missing file and extra file', async context => {
  const { source, directory } = await fixture(context);
  assert.equal((await verifyRelease({ source, directory })).verified, true);
  await writeFile(path.join(directory, 'content.js'), 'malicious replacement');
  await writeFile(path.join(directory, 'manifest.json'), '{"version":"0.3.5","permissions":["cookies"]}');
  await unlink(path.join(directory, 'LICENSE'));
  await writeFile(path.join(directory, 'hidden.js'), 'extra executable');
  const result = await verifyRelease({ source, directory });
  assert.equal(result.verified, false);
  assert.deepEqual(result.differences.map(({ path, status }) => [path, status]), [
    ['LICENSE', 'missing'], ['content.js', 'changed'], ['hidden.js', 'extra'], ['manifest.json', 'changed'],
  ]);
});

test('Chrome metadata, rewritten JSON formatting and changed PNG bytes are never silently exempted', async context => {
  const { source, directory } = await fixture(context);
  await mkdir(path.join(directory, '_metadata'));
  await writeFile(path.join(directory, '_metadata', 'verified_contents.json'), '{}');
  await writeFile(path.join(directory, 'manifest.json'), '{ "version": "0.3.5", "permissions": [] }\n');
  await writeFile(path.join(directory, 'icons', 'icon.png'), Buffer.from([0, 1, 2, 254]));
  const result = await verifyRelease({ source, directory });
  assert.equal(result.verified, false);
  assert.deepEqual(result.differences.map(({ path, status }) => [path, status]), [
    ['_metadata/verified_contents.json', 'extra'], ['icons/icon.png', 'changed'], ['manifest.json', 'changed'],
  ]);
});

test('explicit source may be any version and no current-checkout package validation is applied', async context => {
  const { source, archive } = await fixture(context);
  await writeFile(path.join(source, 'extension', 'manifest.json'), '{"version":"0.3.6"}');
  assert.equal((await verifyRelease({ source, archive })).verified, false);
  await writeFile(archive, createZip(await collectEntries(source)));
  assert.equal((await verifyRelease({ source, archive })).verified, true);
});

test('directory symlinks or junctions are rejected without following their target', async context => {
  const { base, source, archive, directory } = await fixture(context);
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'never-read.txt'), 'outside selected tree');
  const targetLink = path.join(directory, 'linked');
  try { await symlink(outside, targetLink, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { context.skip('Filesystem disallows symbolic links'); return; }
    throw error;
  }
  const result = await verifyRelease({ source, directory });
  assert.equal(result.verified, false);
  assert.deepEqual(result.differences.map(({ path, status }) => [path, status]), [['linked', 'symlink']]);
  await assert.rejects(verifyRelease({ source, directory: targetLink }), /symbolic link/);
  await symlink(outside, path.join(source, 'extension', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyRelease({ source, archive }), /Unsafe source entries/);
});

test('source notices must be regular files and selected source roots cannot be symlinks', async context => {
  const { base, source, archive } = await fixture(context);
  await unlink(path.join(source, 'NOTICE'));
  await mkdir(path.join(source, 'NOTICE'));
  await assert.rejects(verifyRelease({ source, archive }), /regular source file: NOTICE/);
  await rmdir(path.join(source, 'NOTICE'));
  const alias = path.join(base, 'source-alias');
  try { await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { context.skip('Filesystem disallows symbolic links'); return; }
    throw error;
  }
  await assert.rejects(verifyRelease({ source: alias, archive }), /symbolic link/);
});

test('unsafe cross-platform archive names are rejected before packaging', async context => {
  if (process.platform === 'win32') { context.skip('Windows itself forbids these filenames'); return; }
  const { source, archive } = await fixture(context);
  await writeFile(path.join(source, 'extension', '..\\escape.js'), 'outside-like name');
  await assert.rejects(verifyRelease({ source, archive }), /Unsafe relative path/);
});

test('CLI requires explicit unambiguous paths and returns meaningful exit status', async context => {
  const { source, archive } = await fixture(context);
  for (const args of [[], ['--source', source], ['--source', source, '--archive', archive, '--directory', source], ['--source', source, '--archive'], ['--guess'], ['--source', source, '--source', source, '--archive', archive]]) {
    assert.throws(() => parseArguments(args));
  }
  const script = fileURLToPath(new URL('../scripts/verify-release.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const ok = run('--source', source, '--archive', archive, '--inventory');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verified, true);
  await writeFile(archive, 'tampered');
  const mismatch = run('--source', source, '--archive', archive);
  assert.equal(mismatch.status, 1, mismatch.stderr);
  assert.equal(JSON.parse(mismatch.stdout).verified, false);
  const invalid = run('--archive', archive);
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stderr).verified, false);
});
