const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockBalance = 0;
jest.mock('next/link', () => ({ __esModule: true, default: 'a' }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'offline-store' }));
jest.mock('@/lib/session', () => ({ useSession: () => ({ loaded: true, authenticated: true, user: { displayName: 'Wing Fan' } }) }));
jest.mock('@/lib/use-modal-dialog', () => ({ useModalDialog: jest.fn() }));
jest.mock('../src/app/account/account-surface-links', () => ({ AccountSurfaceLinks: () => null }));
jest.mock('../src/app/account/account-deletion-button', () => ({ AccountDeletionButton: () => null }));
jest.mock('../src/app/account/profile/profile.module.css', () => ({ __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn(), apiJson: jest.fn(async path => ({ data:
  path === '/api/v1/rewards/me' ? { available_stamps: mockBalance, stamps_per_reward: 8, max_available_stamps: 16,
    lifetime_stamps: 32, lifetime_redemptions: 2 } : path.includes('/ledger') ? { entries: [] } : [],
})) }));
const Profile = require('../src/app/account/profile/page').default;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.children ? text(node.children) : '';
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test.each([0, 7, 8, 9, 15, 16])('website renders balance %i without threshold clamping', async balance => {
  mockBalance = balance;
  await act(async () => { renderer = create(React.createElement(Profile)); });
  const root = renderer.root;
  expect(root.findByProps({ className: 'ringText' }).findByType('span').children.join('')).toBe(`${balance}/16`);
  const slots = root.findByProps({ className: 'stampRow', 'aria-hidden': true }).children;
  expect(slots).toHaveLength(16);
  expect(slots.filter(slot => slot.props.className.includes('stampSlotFilled'))).toHaveLength(balance);
  expect(slots.filter(slot => slot.props.className.includes('stampSlotMilestone')).map(slot => slots.indexOf(slot) + 1)).toEqual([8, 16]);
  const ring = root.findByProps({ className: 'progressRing' });
  expect(ring.props['aria-label']).toContain(`${balance} of 16`);
  const dash = ring.findAllByType('circle')[1].props.strokeDasharray.split(' ').map(Number);
  expect(dash[0] / dash[1]).toBeCloseTo(balance / 16);
  const notices = root.findAllByProps({ role: 'status' });
  if (balance >= 8) {
    expect(notices.map(text).join('')).toContain(balance === 16 ? '2 free pounds available' : '1 free pound available');
    expect(notices.map(text).join('')).toContain('Ready to redeem');
    expect(text(root)).toContain('Add a qualifying individual 1 lb wings item and apply the wings reward at checkout.');
    expect(text(root)).toContain('One reward per order.');
  } else expect(notices).toHaveLength(0);
  // Optional static review pages use the actual rendered tree/CSS and make no API calls.
  if (process.env.LOYALTY_RENDER_DIR) {
    const fs = require('node:fs'), path = require('node:path');
    const toElement = node => node == null || typeof node === 'string' ? node :
      React.createElement(node.type, node.props, ...(node.children ?? []).map(toElement));
    const markup = require('react-dom/server').renderToStaticMarkup(toElement(renderer.toJSON()));
    const css = fs.readFileSync(path.join(__dirname, '../src/app/account/profile/profile.module.css'), 'utf8');
    fs.mkdirSync(process.env.LOYALTY_RENDER_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.LOYALTY_RENDER_DIR, `web-${balance}.html`),
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loyalty ${balance}/16 offline fixture</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}${css}</style>${markup}</html>`);
  }
  await act(async () => root.findAllByType('button').find(button => text(button).includes('View history')).props.onClick());
  expect(text(root.findByProps({ className: 'stampModalSummary' }))).toContain(`${balance}/16`);
});
