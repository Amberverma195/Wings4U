const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const fs = require('node:fs');
const path = require('node:path');
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }));
jest.mock('../src/components/legal-page.module.css', () => Object.fromEntries(['page','container','header','eyebrow','summary','updated','related','layout','contents','article','tableScroll'].map(key => [key,key])));
jest.mock('../src/components/site-footer-legal.module.css', () => ({ links: 'footer-legal-links' }));
jest.mock('@/components/footer-menu-links', () => ({ FooterMenuLinks: () => null }));
jest.mock('@/components/footer-store-hours', () => ({ FooterStoreHours: () => null }));
jest.mock('@/components/wings-brand-lockup', () => ({ WingsBrandLockup: () => null }));
const Privacy = require('../src/app/privacy/page').default;
const Terms = require('../src/app/terms/page').default;
const { SiteFooter } = require('../src/components/site-footer');
const { CUSTOMER_COOKIES, STAFF_COOKIES, LOCAL_STORAGE } = require('../src/lib/legal-disclosures');
const render = Component => renderToStaticMarkup(React.createElement(Component));
const strip = html => html.replace(/<[^>]+>/g,' ').replace(/&#x27;/g,"'").replace(/&amp;/g,'&').replace(/\s+/g,' ');

test.each([
  [Privacy, ['Who we are','Information we collect','Google Maps and Delivery Pricing','Service providers','Cookies and Similar Technologies','Browser and mobile storage','How long information is kept','Keeping information secure','Service messages','Access, correction','Children','Policy updates']],
  [Terms, ['Our restaurant','Accounts','Placing and accepting','Menu prices','Pickup, delivery','Google Maps','Payment is collected in person','cancellations','refunds','Coupons','Wings stamps','Reviews','Allergies','Acceptable use','Our content','Your legal rights']],
])('policy renders its sections with a single main/h1 and working contents anchors', (Component, headings) => {
  const html = render(Component);
  expect((html.match(/<main\b/g)||[])).toHaveLength(1); expect((html.match(/<h1\b/g)||[])).toHaveLength(1);
  for(const heading of headings) expect(html).toContain(heading);
  for(const [,id] of html.matchAll(/href="#([^"]+)"/g)) expect(html).toContain(`id="${id}"`);
  expect(html).toContain('dateTime="2026-10-23"');
  expect(html).not.toContain('<script'); expect(html).toContain('href="/privacy"'); expect(html).toContain('href="/terms"');
});

test('cookie names and published durations match the actual backend setters', () => {
  const auth=fs.readFileSync(path.join(__dirname,'../../api/src/modules/auth/auth.controller.ts'),'utf8');
  for(const [name] of CUSTOMER_COOKIES) {
    const source=name==='w4u_guest_cart'?fs.readFileSync(path.join(__dirname,'../../api/src/modules/saved-cart/guest-cart-cookie.ts'),'utf8'):auth;
    expect(source).toContain(`"${name}"`);
  }
  expect(auth).toMatch(/maxAge: 15 \* 60 \* 1000/); expect(CUSTOMER_COOKIES[0][2]).toContain('15 minutes');
  expect(auth.match(/maxAge: 30 \* 24 \* 60 \* 60 \* 1000/g)).toHaveLength(2);
  expect(CUSTOMER_COOKIES[1][2]).toContain('30 days'); expect(CUSTOMER_COOKIES[2][2]).toContain('30 days');
  expect(auth).toMatch(/SIGNUP_DEVICE_COOKIE_MAX_AGE_MS = 180 \* 24 \* 60 \* 60 \* 1000/);
  expect(CUSTOMER_COOKIES[4][2]).toContain('180 days');
  const cart=fs.readFileSync(path.join(__dirname,'../../api/src/modules/saved-cart/saved-cart.types.ts'),'utf8');
  expect(cart).toContain('GUEST_CART_TTL_MS = 7 * 24 * 60 * 60 * 1000'); expect(CUSTOMER_COOKIES[3][2]).toContain('7 days');
  for(const [index,service,expression,display] of [[0,'kds','8 * 24 * 60 * 60 * 1_000','8 days'],[1,'pos','setHours(expiresAt.getHours() + 12)','12 hours']]) {
    const source=fs.readFileSync(path.join(__dirname,`../../api/src/modules/${service}/${service}-auth.service.ts`),'utf8');
    expect(source).toContain(STAFF_COOKIES[index][0]); expect(source).toContain(expression); expect(STAFF_COOKIES[index][2]).toContain(display);
  }
});

test('inventory distinguishes native indefinite device retention, web 180 days, and logical cart expiry', () => {
  expect(LOCAL_STORAGE[0][2]).toContain('180-day'); expect(LOCAL_STORAGE[7][2]).toContain('No application-level time expiry');
  const text=strip(render(Privacy));
  expect(text).toContain('7 days'); expect(text).toContain('30 days'); expect(text).toContain('not a scheduled database purge');
  expect(text).toContain('24 hours'); expect(text).toContain('15 minutes away');
});

test.each([Privacy,Terms])('Google privacy, terms and platform links remain publicly available', Component => {
  const html=render(Component);
  for(const url of ['https://policies.google.com/privacy','https://policies.google.com/terms','https://cloud.google.com/maps-platform/terms']) expect(html).toContain(`href="${url}"`);
});

test('terms accurately describe in-person collection and preserve consumer remedies', () => {
  const text=strip(render(Terms));
  for(const phrase of ['does not currently collect online customer payments','Pay at Store','Cash on Delivery','Card on Delivery','not proof of payment','does not automatically refund a card','no blanket no-refunds rule','cannot be combined with Wings reward','party packs can earn stamps']) expect(text).toContain(phrase);
  expect(text).not.toContain('You authorize the selected payment method');
});

test('deletion information provides a real entry and explains resolution and completion', () => {
  const html=render(Privacy), text=strip(html);
  expect(html).toContain('href="/account/delete"'); expect(text).toContain('verify your password');
  expect(text).toContain('nonzero wallet'); expect(text).toContain('does not mean deletion completed');
});

test('reward terms explain completion-based earning without implying verified collection', () => {
  const text=strip(render(Terms));
  expect(text).toContain('one stamp per whole qualifying pound');
  expect(text).toContain('Picked Up or Delivered');
  expect(text).toContain('including delivery completed without a PIN');
  expect(text).toContain('not a separate staff record of payment collection');
  expect(text).not.toContain('Qualifying paid wings portions');
});

test('footer provides exactly one visible link to each legal document', () => {
  const html=render(SiteFooter);
  expect(html).toContain('aria-label="Legal information"');
  for(const route of ['/privacy','/terms']) expect(html.match(new RegExp(`href="${route}"`,'g'))).toHaveLength(1);
});

test('policies make no unsupported tracking, consent-banner or compliance guarantee', () => {
  const text=strip(render(Privacy));
  expect(text).toContain('do not currently use advertising or behavioural analytics cookies on this website'); expect(text).not.toMatch(/fully compliant|never leaves Canada|guaranteed security|accept all cookies/i);
});

test('optionally renders standalone review artifacts without any API or database calls', () => {
  if(!process.env.LEGAL_RENDER_DIR) return;
  fs.mkdirSync(process.env.LEGAL_RENDER_DIR,{recursive:true});
  const css=fs.readFileSync(path.join(__dirname,'../src/components/legal-page.module.css'),'utf8');
  const globalCss=fs.readFileSync(path.join(__dirname,'../src/app/globals.css'),'utf8');
  const footerCss=fs.readFileSync(path.join(__dirname,'../src/components/site-footer-legal.module.css'),'utf8').replaceAll('.links','.footer-legal-links');
  const { WingKingsGlobalStyle }=require('../src/Wings4u/components/global-style');
  for(const [name,Component] of [['privacy',Privacy],['terms',Terms]]) fs.writeFileSync(path.join(process.env.LEGAL_RENDER_DIR,`${name}.html`),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><style>${globalCss}</style>${render(WingKingsGlobalStyle)}<style>${css}${footerCss}</style></head><body>${render(Component)}${render(SiteFooter)}</body></html>`);
});
