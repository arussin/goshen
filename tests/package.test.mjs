import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectRoot, validatePackage } from '../scripts/validate.mjs';
import { collectEntries, createZip, crc32, packageExtension } from '../scripts/package.mjs';

async function temporary(testContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'goshen-package-'));
  testContext.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('goshen-package-'));
    await rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

test('the distributable contains its resources and keeps execution and permissions local', async () => {
  await validatePackage();
});

test('ZIP bytes are deterministic, preserve UTF-8 paths, and use correct CRC32 records', () => {
  const entries = [
    { name: 'z.txt', data: Buffer.from('123456789') },
    { name: 'icons/é.txt', data: Buffer.from('phosphor') },
    { name: 'manifest.json', data: Buffer.from('{}') },
  ];
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
  const archive = createZip(entries);
  assert.deepEqual(archive, createZip([...entries].reverse()));
  const seen = [];
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(archive.readUInt16LE(offset + 6), 0x0800, 'Names must use the UTF-8 flag');
    assert.equal(archive.readUInt16LE(offset + 8), 0, 'The portable package uses stored entries');
    assert.equal(archive.readUInt16LE(offset + 10), 0);
    assert.equal(archive.readUInt16LE(offset + 12), 0x0021, 'The timestamp must not depend on the local clock');
    const length = archive.readUInt32LE(offset + 18);
    assert.equal(length, archive.readUInt32LE(offset + 22));
    const nameLength = archive.readUInt16LE(offset + 26);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const data = archive.subarray(offset + 30 + nameLength, offset + 30 + nameLength + length);
    assert.deepEqual(data, entries.find(entry => entry.name === name).data);
    assert.equal(archive.readUInt32LE(offset + 14), crc32(data));
    seen.push({ name, offset });
    offset += 30 + nameLength + length;
  }
  const directoryAt = offset;
  for (const expected of seen) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    assert.equal(archive.readUInt32LE(offset + 42), expected.offset);
    const length = archive.readUInt16LE(offset + 28);
    assert.equal(archive.subarray(offset + 46, offset + 46 + length).toString('utf8'), expected.name);
    offset += 46 + length;
  }
  assert.equal(archive.readUInt32LE(offset), 0x06054b50);
  assert.equal(archive.readUInt16LE(offset + 10), entries.length);
  assert.equal(archive.readUInt32LE(offset + 16), directoryAt);
  assert.equal(offset + 22, archive.length);
});

test('ZIP packaging rejects traversal paths and duplicate files', () => {
  for (const name of ['/absolute', '../outside', 'a/../outside', 'a//b', 'C:/private', 'a\\b', 'a\0b']) {
    assert.throws(() => createZip([{ name, data: '' }]), /Unsafe archive path/);
  }
  assert.throws(() => createZip([{ name: 'same', data: 'a' }, { name: 'same', data: 'b' }]), /Duplicate archive path/);
});

test('only extension assets and approved root notices enter the distributable', async (context) => {
  const root = await temporary(context);
  await mkdir(path.join(root, 'extension', 'icons'), { recursive: true });
  await writeFile(path.join(root, 'extension', 'manifest.json'), '{}');
  await writeFile(path.join(root, 'extension', 'icons', 'test.png'), 'local asset');
  await writeFile(path.join(root, 'LICENSE'), 'approved license');
  await writeFile(path.join(root, 'NOTICE'), 'approved notice');
  await writeFile(path.join(root, 'README.md'), 'source-only');
  await writeFile(path.join(root, '.env'), 'must stay outside');
  const entries = await collectEntries(root);
  assert.deepEqual(entries.map(entry => entry.name).sort(), ['LICENSE', 'NOTICE', 'icons/test.png', 'manifest.json']);
  assert.equal(entries.find(entry => entry.name === 'LICENSE').data.toString(), 'approved license');
});

test('package validation rejects broad host access and missing dynamic assets', async (context) => {
  const root = await temporary(context);
  const extension = path.join(root, 'extension');
  await cp(path.join(projectRoot, 'extension'), extension, { recursive: true });
  const manifestPath = path.join(extension, 'manifest.json');
  const source = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(source);
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(validatePackage(extension), /persistent host access/);
  await writeFile(manifestPath, source);
  await unlink(path.join(extension, 'universal.css'));
  await assert.rejects(validatePackage(extension), /ENOENT|Missing package file/);
});

test('packaging reuses identical archives and refuses to overwrite an issued version', async (context) => {
  const destination = await temporary(context);
  const first = await packageExtension({ destination });
  assert.equal(first.reused, false);
  const bytes = await readFile(first.filename);
  const second = await packageExtension({ destination });
  assert.equal(second.reused, true);
  assert.deepEqual(await readFile(first.filename), bytes);
  await writeFile(first.filename, 'previous release must remain intact');
  await assert.rejects(packageExtension({ destination }), /already contains different files/);
  assert.equal(await readFile(first.filename, 'utf8'), 'previous release must remain intact');
});
