// Executable Metro regression, deliberately outside Jest and its module mapper.
// Runs pure shared code in a JS VM, not the customer app or production services.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const Metro = require('@expo/metro/metro');
const { FileStore } = require('@expo/metro/metro-cache');
const { getDefaultConfig } = require('expo/metro-config');
const root = path.resolve(__dirname, '../../..');
const folder = path.join(root, 'tmp/metro-customization-runtime');

async function bundle(entry, dev) {
  const config = getDefaultConfig(path.join(root, 'apps/application'));
  config.watchFolders = [...config.watchFolders, folder];
  config.maxWorkers = 2;
  // Do not reset the running Expo app's shared system cache.
  config.cacheStores = [new FileStore({ root: path.join(folder, 'transform-cache') })];
  config.fileMapCacheDirectory = path.join(folder, 'file-map-cache');
  fs.mkdirSync(config.fileMapCacheDirectory, { recursive: true });
  config.resetCache = true;
  config.reporter = { update() {} };
  config.serializer.getModulesRunBeforeMainModule = () => [];
  config.serializer.getPolyfills = () => [];
  // Execute the real resolved/transformed module graph without React Native's
  // device bootstrap. Keep this serializer tiny; do not replace Metro resolution.
  config.serializer.customSerializer = (entryPath, _prelude, graph) => {
    const modules = [...graph.dependencies.values()];
    const definitions = modules.map(module => {
      const code = module.output.find(output => output.type.startsWith('js/')).data.code;
      const dependencies = [...module.dependencies.values()].map(dependency => dependency.absolutePath);
      return `currentPath=${JSON.stringify(module.path)};currentDeps=${JSON.stringify(dependencies)};\n${code}`;
    }).join('\n');
    return { code: `var registry={},currentPath,currentDeps;
      function __d(factory){registry[currentPath]={factory:factory,deps:currentDeps};}
      function __r(id){var row=registry[id];if(!row)throw Error('Missing module '+id);if(row.module)return row.module.exports;
        var module=row.module={exports:{}};row.factory(globalThis,__r,function(id){var value=__r(id);return value.__esModule?value.default:value},__r,module,module.exports,row.deps);return module.exports;}
      ${definitions}\n__r(${JSON.stringify(entryPath)});`,
      map: JSON.stringify({ version: 3, sources: modules.map(module => module.path), mappings: '' }) };
  };
  const result = await Metro.runBuild(config, { entry, platform: 'android', dev, minify: !dev, sourceMap: true });
  const context = { console, __DEV__: dev, setTimeout, clearTimeout };
  vm.runInNewContext(result.code, context, { timeout: 10000 });
  return { result: context.__customizationProbe, sources: JSON.parse(result.map).sources };
}

async function main() {
  fs.mkdirSync(folder, { recursive: true });
  // Reproduce the historical stale-build failure: source has the helper but
  // a main-only manifest points Metro at old generated JS without that export.
  const stale = path.join(folder, 'stale-package');
  fs.mkdirSync(path.join(stale, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(stale, 'package.json'), JSON.stringify({ name: 'stale-customization-probe', main: 'dist/index.js' }));
  fs.writeFileSync(path.join(stale, 'dist/index.js'), 'exports.customizationCatalog = function() {};');
  const legacyEntry = path.join(folder, 'legacy.ts');
  fs.writeFileSync(legacyEntry, `import { customerCustomizationInstructions } from './stale-package'; globalThis.__customizationProbe = typeof customerCustomizationInstructions;`);
  assert.equal((await bundle(legacyEntry, true)).result, 'undefined');
  console.log('PASS: historical main-only stale export reproduced');

  const entry = path.join(folder, 'entry.ts');
  fs.writeFileSync(entry, `import * as rules from '@wings4u/customization';
    const names = ['normalizeIngredientText','resolveIngredientMapping','customerCustomizationInstructions','customizationCatalog','embeddedSaladCatalog','saladSlugForSelectionName','normalizeSaladSelection','defaultSelections','validateSelections','modifierTotal','maximumSelections','inspectCustomizationDraft'];
    const missing = names.filter(name => typeof rules[name] !== 'function');
    if (missing.length) throw new Error('Missing runtime exports: ' + missing.join(','));
    if (rules.normalizeIngredientText('A & B') !== 'a and b' || rules.resolveIngredientMapping('a b', ['A & B']) !== 'a and b') throw new Error('Normalization differs in Metro');
    globalThis.__customizationProbe = { missing, notes: rules.customerCustomizationInstructions('Keep warm', 'Burger'),
      total: rules.modifierTotal([], {}), sides: rules.SIDE_POP_SIDES.length,
      bundle: rules.SIDE_POP_BUNDLE_PRICE_CENTS, eligible: rules.SIDE_POP_BUNDLE_SLUGS.has('veggie-burger') };`);
  for (const dev of [true, false]) {
    const result = await bundle(entry, dev);
    assert.deepEqual(JSON.parse(JSON.stringify(result.result)), { missing: [], notes: 'Keep warm', total: 0, sides: 4, bundle: 499, eligible: true });
    assert.ok(result.sources.some(source => /customization[\\/]src[\\/]index\.ts$/.test(source)));
    assert.ok(!result.sources.some(source => /customization[\\/]dist[\\/]index\.js$/.test(source)));
    console.log(`PASS: real ${dev ? 'development' : 'production'} Metro bundle resolves and executes source exports`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
