import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEntries, createZip } from './package.mjs';

export const help = `Read-only Goshen release verification (Node.js 20+)

  node scripts/verify-release.mjs --source SOURCE_ROOT --archive ZIP_PATH [--inventory]
  node scripts/verify-release.mjs --source SOURCE_ROOT --directory UNPACKED_PATH [--inventory]

SOURCE_ROOT must contain extension/ and the release's LICENSE/NOTICE, if present.
Exactly one explicit comparison target is required. No paths are discovered.
JSON is written to standard output; --inventory includes expected per-file hashes.
Exit 0: exact match. Exit 1: differences. Exit 2: invalid input or read error.
This compares local bytes, not signatures, installed identity, or safety.
`;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeRelativeName(name) {
  assert.ok(name && !name.startsWith('/') && !/[\\:\0]/.test(name), `Unsafe relative path: ${name}`);
  assert.ok(name.split('/').every(part => part && part !== '.' && part !== '..'), `Unsafe relative path: ${name}`);
}

async function regularDirectory(directory) {
  const info = await lstat(directory);
  assert.ok(!info.isSymbolicLink(), `Refusing symbolic link: ${directory}`);
  assert.ok(info.isDirectory(), `Expected directory: ${directory}`);
}

/** Inspect only the explicit tree. Never follow links or read special files. */
async function inspectTree(directory, readContents) {
  await regularDirectory(directory);
  const files = new Map();
  const issues = [];
  const paths = new Set();
  async function walk(current, prefix = '') {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      safeRelativeName(relative);
      const filename = path.join(current, entry.name);
      // lstat also detects a link if it replaced an entry since readdir.
      const info = await lstat(filename);
      if (info.isSymbolicLink()) {
        paths.add(relative);
        issues.push({ path: relative, status: 'symlink', message: 'Symbolic links are not compared or followed.' });
      } else if (info.isDirectory()) {
        await walk(filename, `${relative}/`);
      } else if (info.isFile()) {
        paths.add(relative);
        files.set(relative, readContents ? await readFile(filename) : null);
      } else {
        paths.add(relative);
        issues.push({ path: relative, status: 'unsupported', message: 'Only regular files are supported.' });
      }
    }
  }
  await walk(directory);
  return { files, issues, paths };
}

/** Use the selected source's bytes, without executing its code or validating its version. */
async function expectedEntries(source) {
  await regularDirectory(source);
  const inspection = await inspectTree(path.join(source, 'extension'), false);
  assert.equal(inspection.issues.length, 0, `Unsafe source entries: ${JSON.stringify(inspection.issues)}`);
  for (const notice of ['LICENSE', 'NOTICE']) {
    let info;
    try { info = await lstat(path.join(source, notice)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    assert.ok(info.isFile() && !info.isSymbolicLink(), `Expected a regular source file: ${notice}`);
  }
  const entries = await collectEntries(source);
  // Reuse the packager's path validation as well as its deterministic ZIP format.
  const archive = createZip(entries);
  return { entries: entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0), archive };
}

/** No filesystem mutations, network calls, package extraction, or profile discovery. */
export async function verifyRelease({ source, archive, directory, inventory = false }) {
  assert.equal(typeof source, 'string', 'An explicit source directory is required');
  assert.ok(source.length, 'An explicit source directory is required');
  assert.ok(Boolean(archive) !== Boolean(directory), 'Choose exactly one archive or directory');
  const sourceRoot = path.resolve(source);
  const expected = await expectedEntries(sourceRoot);
  const report = {
    verified: false,
    comparison: archive ? 'exact-archive-bytes' : 'exact-unpacked-file-bytes',
    source: sourceRoot,
    target: path.resolve(archive || directory),
    expectedArchiveSha256: sha256(expected.archive),
    expectedFileCount: expected.entries.length,
    differences: [],
    limitation: 'Byte equality is not proof of safety, signatures, source provenance, or installed extension identity.',
  };
  if (inventory) {
    report.expectedFiles = expected.entries.map(({ name, data }) => ({ path: name, bytes: data.length, sha256: sha256(data) }));
  }
  if (archive) {
    const info = await lstat(report.target);
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'The archive must be a regular file, not a symbolic link');
    const actual = await readFile(report.target);
    report.actualArchiveSha256 = sha256(actual);
    report.verified = actual.equals(expected.archive);
    if (!report.verified) report.differences.push({ path: path.basename(report.target), status: 'changed', message: 'Archive bytes differ. No extraction or per-file archive comparison was performed.' });
  } else {
    const actual = await inspectTree(report.target, true);
    report.differences.push(...actual.issues);
    const expectedNames = new Set(expected.entries.map(entry => entry.name));
    for (const entry of expected.entries) {
      if (!actual.paths.has(entry.name)) {
        report.differences.push({ path: entry.name, status: 'missing' });
      } else if (actual.files.has(entry.name) && !entry.data.equals(actual.files.get(entry.name))) {
        report.differences.push({ path: entry.name, status: 'changed', expectedSha256: sha256(entry.data), actualSha256: sha256(actual.files.get(entry.name)) });
      }
    }
    for (const name of actual.files.keys()) {
      if (!expectedNames.has(name)) report.differences.push({ path: name, status: 'extra', actualSha256: sha256(actual.files.get(name)) });
    }
    report.differences.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    report.verified = report.differences.length === 0;
    report.limitation += ' Chrome may rewrite the manifest or images and add metadata. Every such difference remains a verification failure requiring review; nothing is silently excluded. Empty directories are not package files.';
  }
  return report;
}

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const result = {};
  const options = new Map([['--source', 'source'], ['--archive', 'archive'], ['--directory', 'directory']]);
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--inventory') {
      assert.ok(!result.inventory, 'Duplicate --inventory');
      result.inventory = true;
    } else {
      const key = options.get(option);
      assert.ok(key, `Unknown option: ${option}`);
      assert.ok(!Object.hasOwn(result, key), `Duplicate ${option}`);
      const value = args[++i];
      assert.ok(value && !value.startsWith('--'), `${option} requires an explicit path`);
      result[key] = value;
    }
  }
  assert.ok(result.source, '--source is required');
  assert.ok(Boolean(result.archive) !== Boolean(result.directory), 'Exactly one --archive or --directory is required');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(help);
    else {
      const report = await verifyRelease(options);
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.verified ? 0 : 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ verified: false, error: error.message }));
    process.exitCode = 2;
  }
}
