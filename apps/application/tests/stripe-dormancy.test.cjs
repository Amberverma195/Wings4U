const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test.each(['_layout.tsx','checkout.tsx'])('%s does not load or initialize Stripe in executable code', file => {
  const source = fs.readFileSync(path.join(__dirname,'../app',file),'utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,removeComments:true}}).outputText;
  expect(compiled).not.toContain('@stripe/stripe-react-native');
  expect(compiled).not.toMatch(/\b(initStripe|useStripe|initPaymentSheet|presentPaymentSheet)\s*\(/);
  expect(compiled).not.toContain('/payments/stripe/');
  expect(source).toContain('@stripe/stripe-react-native'); // Retained as commented code.
});

test('Stripe Expo plugin is inactive while dependency and restore instructions are retained',()=>{
  const config=require('../app.json').expo;
  expect(config.plugins.map(plugin=>Array.isArray(plugin)?plugin[0]:plugin)).not.toContain('@stripe/stripe-react-native');
  expect(require('../package.json').dependencies['@stripe/stripe-react-native']).toBeDefined();
  expect(fs.readFileSync(path.join(__dirname,'../app.config.js'),'utf8')).toContain('// ["@stripe/stripe-react-native", {}]');
});
