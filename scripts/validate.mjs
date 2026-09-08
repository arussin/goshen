import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedMatches = new Set(['https://chatgpt.com/*', 'https://chat.openai.com/*']);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(entries.map(async (entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(filename) : [filename];
  }));
  return results.flat();
}

/** Validate the distributable, independent of the developer's installed tools. */
export async function validatePackage(extensionRoot = path.join(projectRoot, 'extension')) {
  const root = path.resolve(extensionRoot);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3, 'Chrome requires a Manifest V3 package');
  assert.ok(manifest.name?.length, 'The extension must have a display name');
  assert.match(manifest.version, /^\d+(?:\.\d+){0,3}$/, 'Use a valid Chrome extension version');
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting'], 'Only preference storage and user-invoked tab styling are permitted');
  assert.ok(!manifest.host_permissions?.length, 'Universal mode must not require persistent host access');
  assert.ok(!manifest.optional_permissions?.length, 'No optional permissions are needed');
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*'], 'Optional website access is reserved for the explicit follow-this-tab control');
  assert.ok(!manifest.externally_connectable, 'No external messaging endpoint is needed');
  assert.deepEqual(manifest.background, { service_worker: 'background.js' }, 'Use the local classic service worker');

  const references = new Set(Object.values(manifest.icons ?? {}));
  ['background.js', 'sites.js', 'universal.js', 'universal.css'].forEach((file) => references.add(file));
  assert.ok(manifest.action?.default_popup, 'The toolbar button must open the settings popup');
  references.add(manifest.action.default_popup);
  Object.values(manifest.action.default_icon ?? {}).forEach((file) => references.add(file));
  assert.ok(manifest.content_scripts?.length, 'At least one content script registration is required');
  let includesCurrentHost = false;
  for (const registration of manifest.content_scripts) {
    assert.ok(registration.matches?.length, 'Content scripts must specify their host scope');
    for (const match of registration.matches) {
      assert.ok(allowedMatches.has(match), `Content script scope is too broad: ${match}`);
      if (match === 'https://chatgpt.com/*') includesCurrentHost = true;
    }
    assert.ok(!registration.all_frames, 'The skin must run only in the main browser frame');
    assert.ok(!registration.world || registration.world === 'ISOLATED', 'Use the isolated content-script world');
    const scripts = registration.js ?? [];
    assert.deepEqual(scripts, ['settings.js', 'companion.js', 'content.js'], 'Only the ChatGPT adapter should register automatically, after its shared dependencies');
    assert.ok(registration.css?.includes('content.css'), 'The native-page stylesheet is required');
    [...scripts, ...(registration.css ?? [])].forEach((file) => references.add(file));
  }
  assert.ok(includesCurrentHost, 'The extension must support chatgpt.com');

  const background = await readFile(path.join(root, 'background.js'), 'utf8');
  assert.match(background, /\bimportScripts\([^)]*['"]sites\.js['"][^)]*\)/, 'The background worker must load the local site policy');
  for (const match of background.matchAll(/\bimportScripts\(([^)]*)\)/g)) {
    for (const dependency of match[1].matchAll(/['"]([^'"]+)['"]/g)) references.add(dependency[1]);
  }
  // Resolve every literal file in scripting injection arrays, not just manifest assets.
  for (const match of background.matchAll(/\bfiles\s*:\s*\[([^\]]*)\]/g)) {
    for (const dependency of match[1].matchAll(/['"]([^'"]+)['"]/g)) references.add(dependency[1]);
  }
  assert.ok(!/\ballFrames\s*:\s*true|\bworld\s*:\s*['"]MAIN['"]/.test(background), 'Tab styling must stay in the isolated main frame');

  const registrySource = await readFile(path.join(root, 'sites.js'), 'utf8');
  const registryContext = vm.createContext({ URL });
  vm.runInContext(registrySource, registryContext, { filename: 'sites.js', timeout: 1000 });
  const adapters = registryContext.GoshenSites?.adapters;
  assert.ok(adapters, 'The site registry must expose its packaged adapters');
  assert.deepEqual(Object.keys(adapters).sort(), ['chatgpt', 'universal'], 'Only the supported adapters may be dynamically injected');
  for (const [mode, adapter] of Object.entries(adapters)) {
    const expectedScripts = mode === 'chatgpt' ? ['settings.js', 'companion.js', 'content.js'] : ['settings.js', 'companion.js', 'gmail.js', 'universal.js'];
    assert.deepEqual(Array.from(adapter.scripts ?? []), expectedScripts, `Unexpected ${mode} script injection`);
    assert.deepEqual(Array.from(adapter.styles ?? []), [mode === 'chatgpt' ? 'content.css' : 'universal.css'], `Unexpected ${mode} stylesheet injection`);
    [...adapter.scripts, ...adapter.styles].forEach(file => references.add(file));
  }

  const csp = manifest.content_security_policy?.extension_pages ?? "script-src 'self'; object-src 'self';";
  assert.ok(!/unsafe-eval|unsafe-inline|https?:|\*/.test(csp), 'Extension pages must not allow remote or inline script execution');

  for (const reference of references) {
    assert.equal(typeof reference, 'string', 'Manifest file references must be paths');
    const resolved = path.resolve(root, reference);
    assert.ok(resolved.startsWith(root + path.sep), `Package reference escapes the extension: ${reference}`);
    assert.ok((await stat(resolved)).isFile(), `Missing package file: ${reference}`);
  }

  for (const [size, reference] of Object.entries(manifest.icons ?? {})) {
    const data = await readFile(path.join(root, reference));
    assert.ok(data.length >= 24, `Icon is empty or truncated: ${reference}`);
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Icon must be a packaged PNG: ${reference}`);
    assert.equal(data.readUInt32BE(16), Number(size), `Icon width does not match its manifest size: ${reference}`);
    assert.equal(data.readUInt32BE(20), Number(size), `Icon height does not match its manifest size: ${reference}`);
  }

  const popup = await readFile(path.join(root, manifest.action.default_popup), 'utf8');
  const popupScripts = [...popup.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => match[1]);
  assert.ok(popupScripts.includes('settings.js') && popupScripts.includes('popup.js'), 'Popup must load its settings and control scripts');
  assert.ok(popupScripts.indexOf('settings.js') < popupScripts.indexOf('popup.js'), 'Popup settings must initialize before its controls');

  const files = await filesUnder(root);
  for (const filename of files) {
    const relative = path.relative(root, filename);
    if (!/\.(js|css|html)$/.test(filename)) continue;
    const source = await readFile(filename, 'utf8');
    if (filename.endsWith('.js')) {
      new vm.Script(source, { filename: relative });
      assert.ok(!/\b(?:eval|Function)\s*\(/.test(source), `${relative} must not execute strings as code`);
      assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(source), `${relative} must not send data over the network`);
    }
    if (filename.endsWith('.css')) {
      assert.ok(!/@import\b|url\(\s*['"]?(?:https?:)?\/\//i.test(source), `${relative} must not load external styles or assets`);
    }
    if (filename.endsWith('.html')) {
      assert.ok(!/\bon[a-z]+\s*=/i.test(source), `${relative} must not contain inline event handlers`);
      for (const script of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        assert.ok(!script[2].trim(), `${relative} must use external packaged JavaScript`);
        assert.ok(/\bsrc\s*=/.test(script[1]), `${relative} contains a script without a file source`);
      }
      for (const resource of source.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
        assert.ok(!/^(?:https?:)?\/\//i.test(resource[1]), `${relative} must not load a remote resource`);
        const resolved = path.resolve(path.dirname(filename), resource[1]);
        assert.ok(resolved.startsWith(root + path.sep), `${relative} references a file outside the package`);
        assert.ok((await stat(resolved)).isFile(), `${relative} references a missing file: ${resource[1]}`);
      }
    }
  }
  return { name: manifest.name, version: manifest.version, files: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validatePackage();
  console.log(`Validated ${result.name} ${result.version}: ${result.files} packaged files; JavaScript syntax, local assets, permissions, and content-script registration pass.`);
}
