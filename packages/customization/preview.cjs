'use strict';
// Isolated visual QA of the actual mobile builder. No app providers, API, or DB.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'tmp/customization-preview');

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const fixture = require('./test/fixtures.cjs');
  const item = fixture.product('veggie-burger', { name: 'Veggie Burger', description: 'Sriracha mayo, lettuce, red onion, tomato, veggie patty tossed in signature sauce.' });
  const extras = item.modifier_groups[0];
  extras.name = 'Veggie Burger Additional Ingredients'; extras.addon_scope_menu_item_id = item.id;
  extras.options = [fixture.option('mayo', 'Extra Sriracha Mayo', { addon_match_normalized: '__always__' }),
    fixture.option('lettuce', 'Extra Lettuce', { addon_match_normalized: 'lettuce' }),
    fixture.option('tomato', 'Extra Tomato', { addon_match_normalized: 'tomato' })];
  fs.writeFileSync(path.join(out, 'entry.tsx'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { MenuItemBuilder } from '../../apps/application/src/components/menu-item-builder';
    const item = ${JSON.stringify(item)};
    createRoot(document.getElementById('root')!).render(<MenuItemBuilder item={item} visible={true} categories={[]} onClose={() => {}} />);
  `);
  await build({ entryPoints: [path.join(out, 'entry.tsx')], outfile: path.join(out, 'bundle.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true' },
    plugins: [{ name: 'offline-providers', setup(builder) {
      builder.onResolve({ filter: /^react-native$/ }, () => ({ path: require.resolve('react-native-web') }));
      builder.onResolve({ filter: /^lucide-react-native$/ }, () => ({ path: require.resolve('lucide-react') }));
      builder.onResolve({ filter: /^react-native-safe-area-context$/ }, () => ({ path: 'safe', namespace: 'offline' }));
      builder.onResolve({ filter: /\/context\/cart$/ }, () => ({ path: 'cart', namespace: 'offline' }));
      builder.onResolve({ filter: /\/lib\/(api|env)$/ }, () => ({ path: 'api', namespace: 'offline' }));
      builder.onLoad({ filter: /.*/, namespace: 'offline' }, args => ({ contents: args.path === 'safe'
        ? 'export const useSafeAreaInsets = () => ({ top: 12, bottom: 24, left: 0, right: 0 });'
        : args.path === 'cart' ? `export const useCart = () => ({ fulfillmentType: 'PICKUP', locationId: 'offline', addItem: item => { document.getElementById('receipt').textContent = JSON.stringify(item); document.getElementById('receipt').style.display = 'block'; }, replaceItem: () => { throw new Error('Offline preview has no saved cart'); } });`
        : `export const DEFAULT_LOCATION_ID = 'offline'; export const apiJson = () => { throw new Error('Network disabled in preview'); };` }));
    } }], logLevel: 'warning' });
  fs.writeFileSync(path.join(out, 'builder.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}body{font-family:system-ui}#receipt{display:none;position:fixed;inset:10%;z-index:100000;background:#fff;padding:20px;overflow:auto;white-space:pre-wrap}</style></head><body><div id="root"></div><pre id="receipt" aria-label="Offline cart result"></pre><script>window.fetch=()=>Promise.reject(new Error('Network disabled'));</script><script src="/bundle.js"></script></body></html>`);
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Wings4U offline builder QA</title><style>body{font:14px system-ui;background:#e5ddd6;color:#251e1b;padding:20px}iframe{border:6px solid #251e1b;border-radius:24px;background:#fff;display:block}button{margin:0 6px 16px 0;padding:8px 14px}</style></head><body><p>Offline fixture preview · Actual mobile builder · Cart stays in this page</p><button onclick="resize(320,690)">320 px</button><button onclick="resize(390,844)">390 px</button><button onclick="resize(430,932)">430 px</button><iframe title="Mobile customization preview" src="/builder.html" width="390" height="844"></iframe><script>function resize(w,h){const frame=document.querySelector('iframe');frame.width=w;frame.height=h}const width=Number(new URLSearchParams(location.search).get('width'));if(width)resize(width,844)</script></body></html>`);
  http.createServer((req, res) => {
    const filename = ({ '/': 'index.html', '/builder.html': 'builder.html', '/bundle.js': 'bundle.js' })[new URL(req.url, 'http://127.0.0.1').pathname];
    if (req.method !== 'GET' || !filename) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript' : 'text/html');
    res.end(fs.readFileSync(path.join(out, filename)));
  }).listen(4188, '127.0.0.1', () => console.log('Offline mobile preview: http://127.0.0.1:4188'));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
