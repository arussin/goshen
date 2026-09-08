import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, validatePackage } from './validate.mjs';

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

export function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function validName(name) {
  assert.equal(typeof name, 'string', 'Archive paths must be strings');
  assert.ok(name && !name.startsWith('/') && !/[\\:\0]/.test(name), `Unsafe archive path: ${name}`);
  assert.ok(name.split('/').every(part => part && part !== '.' && part !== '..'), `Unsafe archive path: ${name}`);
  assert.ok(Buffer.byteLength(name) <= 0xffff, 'Archive path is too long');
}

/** Stored ZIP: stable order, UTF-8 names, 1980-01-01 timestamps, no machine metadata. */
export function createZip(entries) {
  assert.ok(entries.length < 0xffff, 'ZIP64 archives are not supported');
  const sorted = [...entries].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const seen = new Set();
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of sorted) {
    validName(entry.name);
    assert.ok(!seen.has(entry.name), `Duplicate archive path: ${entry.name}`);
    seen.add(entry.name);
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    assert.ok(data.length < 0xffffffff, 'ZIP64 files are not supported');
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0x0021, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0x0021, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
    assert.ok(offset < 0xffffffff, 'ZIP64 offsets are not supported');
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function collectEntries(root = projectRoot) {
  const extension = path.join(root, 'extension');
  const result = [];
  async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      assert.ok(!entry.isSymbolicLink(), `Do not package symbolic links: ${prefix}${entry.name}`);
      const filename = path.join(directory, entry.name);
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(filename, `${name}/`);
      else {
        assert.ok(entry.isFile(), `Unsupported package entry: ${name}`);
        result.push({ name, data: await readFile(filename) });
      }
    }
  }
  await walk(extension);
  for (const name of ['LICENSE', 'NOTICE']) {
    try { result.push({ name, data: await readFile(path.join(root, name)) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return result;
}

export async function packageExtension({ root = projectRoot, destination = path.join(root, 'dist') } = {}) {
  const result = await validatePackage(path.join(root, 'extension'));
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.version, result.version, 'package.json and manifest.json must use the same version');
  const entries = await collectEntries(root);
  const archive = createZip(entries);
  await mkdir(destination, { recursive: true });
  const filename = path.join(destination, `Goshen-Terminal-${result.version}.zip`);
  let existing;
  try { existing = await readFile(filename); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    assert.ok(existing.equals(archive), 'An archive with this version already contains different files. Bump the release version; existing archives are preserved.');
  } else {
    await writeFile(filename, archive, { flag: 'wx' });
  }
  return { ...result, files: entries.length, filename, bytes: archive.length, reused: Boolean(existing) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await packageExtension();
  console.log(`${result.reused ? 'Verified existing' : 'Packaged'} ${path.relative(projectRoot, result.filename)}: ${result.files} files, ${result.bytes} bytes.`);
}
