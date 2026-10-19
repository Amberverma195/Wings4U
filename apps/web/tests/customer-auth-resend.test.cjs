const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockSession = { refresh: jest.fn(async () => true) };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('@/lib/api');
const { CustomerAuth } = require('../src/components/customer-auth');
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? node.children.map(text).join('') : '';
let renderer, intervals;
const button = label => renderer.root.findAllByType('button').find(node => text(node) === label);
const resend = () => renderer.root.findAllByType('button').find(node => node.props.className === 'wk-otp-resend');
const response = (data = {}, status = 200, message, retry) => ({ ok: status < 400, status,
  headers: new Headers(retry ? { 'Retry-After': String(retry) } : {}), json: async () => ({ data, errors: message ? [{ message }] : undefined }) });
const type = async (placeholder, value) => act(async () => renderer.root.findAllByType('input').find(node => node.props.placeholder === placeholder).props.onChange({ target: { value } }));
const submit = async () => act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
const tick = async ms => act(async () => jest.advanceTimersByTime(ms));
const mount = async (mode = 'signup') => act(async () => { renderer = create(React.createElement(CustomerAuth, { mode })); });
const signup = async () => {
  await mount(); await type('Jane Doe', 'Fictional Customer'); await type('(123)-456-7890', '5195550123');
  await type('jane@example.com', 'fictional@example.com'); await type('At least 8 characters', 'Example123!');
  await type('Re-enter your password', 'Example123!'); await submit();
};
const loginPassword = async () => { await mount('login'); await type('(123)-456-7890 or abc@gmail.com', 'fictional@example.com'); await submit(); };
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-19T12:00:00Z')); jest.clearAllMocks();
  intervals = new Set();
  global.window = { setInterval: (callback, delay) => { const id = setInterval(callback, delay); intervals.add(id); return id; },
    clearInterval: id => { intervals.delete(id); clearInterval(id); },
    sessionStorage: { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() } };
  apiFetch.mockImplementation(async url => url.endsWith('/login') ? response({ needs_email_verification: true, email: 'fictional@example.com' })
    : response({ email: 'fictional@example.com', delivery_email: 'fictional@example.com', request_accepted: true, retry_after_seconds: 30 }));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); delete global.window; });

test('signup starts a visible 30-second countdown and still allows code verification', async () => {
  await signup(); expect(text(resend())).toBe('Resend in 30s'); expect(resend().props.disabled).toBe(true);
  expect(resend().props['aria-label']).toBe('Resend in 30s');
  await type('Code', '123456'); expect(button('Verify').props.disabled).toBe(false);
  await tick(1000); expect(text(resend())).toBe('Resend in 29s');
  await tick(29000); expect(text(resend())).toBe('Resend code'); expect(resend().props.disabled).toBe(false);
});
test('unverified login starts the same cooldown and does not create a session', async () => {
  await loginPassword(); await type('Your password', 'Example123!'); await submit();
  expect(text(resend())).toBe('Resend in 30s'); expect(resend().props.disabled).toBe(true);
  expect(mockSession.refresh).not.toHaveBeenCalled();
});
test('double clicks and a pending request cannot overlap, even after the countdown ends', async () => {
  await signup(); await tick(30000);
  let release; apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const click = resend().props.onClick;
  let first;
  await act(async () => { first = click(); void click(); });
  expect(apiFetch.mock.calls.filter(call => call[0].endsWith('/resend'))).toHaveLength(1);
  expect(text(resend())).toBe('Resend in 30s'); await tick(31000);
  await act(async () => { void click(); });
  expect(apiFetch.mock.calls.filter(call => call[0].endsWith('/resend'))).toHaveLength(1);
  await act(async () => { release(response({ request_accepted: true, retry_after_seconds: 30 })); await first; });
  expect(text(renderer.toJSON())).toContain('If verification is needed'); expect(text(resend())).toBe('Resend in 30s');
});
test.each(['header', 'date header', 'body', 'message'])('respects a longer server retry from %s', async source => {
  await signup(); await tick(30000);
  apiFetch.mockResolvedValueOnce(response(source === 'body' ? { retry_after_seconds: 90 } : {}, source === 'body' ? 200 : 429,
    source === 'message' ? 'Please wait 90 seconds before requesting another code' : 'Too many requests',
    source === 'header' ? 90 : source === 'date header' ? new Date(Date.now() + 90000).toUTCString() : undefined));
  await act(async () => resend().props.onClick()); expect(text(resend())).toBe('Resend in 90s');
  await tick(30000); expect(text(resend())).toBe('Resend in 60s'); expect(resend().props.disabled).toBe(true);
});
test('rerenders retain one timer, and unmount cleans it up', async () => {
  await signup(); expect(intervals.size).toBe(1); await tick(5000);
  await act(async () => renderer.update(React.createElement(CustomerAuth, { mode: 'signup' })));
  expect(text(resend())).toBe('Resend in 25s'); expect(intervals.size).toBe(1);
  await act(async () => renderer.unmount()); renderer = null; expect(intervals.size).toBe(0);
});
test('password-reset countdown, longer retry and locked limit remain functional', async () => {
  await loginPassword(); await act(async () => button('Forgot password?').props.onClick()); await submit();
  expect(text(resend())).toBe('Resend in 30s'); await tick(1000); expect(text(resend())).toBe('Resend in 29s');
  await tick(29000); expect(resend().props.disabled).toBe(false);
  apiFetch.mockResolvedValueOnce(response({}, 401, 'Please wait 60 seconds before requesting another code'));
  await act(async () => resend().props.onClick()); expect(text(resend())).toBe('Resend in 60s');
  await tick(60000); apiFetch.mockResolvedValueOnce(response({}, 401, 'Too many verification codes requested. Please wait.'));
  await act(async () => resend().props.onClick()); expect(text(resend())).toBe('Resend limit reached'); expect(resend().props.disabled).toBe(true);
});
test('failed network attempts still prevent rapid repeated requests', async () => {
  await signup(); await tick(30000); apiFetch.mockRejectedValueOnce(new Error('Network unavailable'));
  await act(async () => resend().props.onClick()); expect(text(resend())).toBe('Resend in 30s');
  expect(text(renderer.toJSON())).toContain('Network unavailable');
});
