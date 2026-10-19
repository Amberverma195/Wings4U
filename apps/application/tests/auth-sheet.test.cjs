const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Keyboard: { dismiss: jest.fn() },
  KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', Platform: { OS: 'android' },
  ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', View: 'View',
  StyleSheet: { create: value => value, absoluteFill: {} },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('lucide-react-native', () => ({ Eye: 'Eye', EyeOff: 'EyeOff', X: 'X' }));
jest.mock('../src/context/session', () => ({ useSession: () => ({ user: null }) }));
const auth = { loading: false, error: null, clearError: jest.fn(), login: jest.fn(),
  verifyEmail: jest.fn(), requestPasswordReset: jest.fn(), confirmPasswordReset: jest.fn(),
  resendVerification: jest.fn(), signup: jest.fn(), updateProfile: jest.fn() };
jest.mock('../src/hooks/use-auth', () => ({
  useAuth: () => auth,
  AuthRequestError: class extends Error {},
}));
const { AuthSheet } = require('../src/components/auth-sheet');
let renderer;
let onComplete;
const input = label => renderer.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label);
const button = text => renderer.root.findAllByType('TouchableOpacity').find(node =>
  node.findAllByType('Text').some(child => child.children.join('') === text));
const type = async (label, value) => act(async () => input(label).props.onChangeText(value));
const tap = async label => act(async () => { await button(label).props.onPress(); });
const screenText = () => renderer.root.findAllByType('Text').map(node => node.children.join('')).join(' ');

beforeEach(async () => {
  jest.useFakeTimers(); jest.clearAllMocks();
  onComplete = jest.fn();
  await act(async () => { renderer = create(React.createElement(AuthSheet,
    { visible: true, onClose: jest.fn(), onComplete })); });
});
afterEach(async () => { await act(async () => renderer.unmount()); jest.useRealTimers(); });

test('phone typing is capped and identifier step makes no login request', async () => {
  await type('Phone or email', '123456788765434567898765434567');
  expect(input('Phone or email').props.value).toBe('(123)-456-7887');
  await tap('Continue');
  expect(input('Password')).toBeDefined();
  expect(auth.login).not.toHaveBeenCalled();
});

test('malformed email cannot reach the password step', async () => {
  await type('Phone or email', 'bad@example');
  await tap('Continue');
  expect(input('Password')).toBeUndefined();
  expect(auth.login).not.toHaveBeenCalled();
});

test('unverified login requires OTP before completion', async () => {
  auth.login.mockResolvedValue({ needs_email_verification: true, email: 'user@example.com' });
  auth.verifyEmail.mockResolvedValue({ needs_profile_completion: false });
  await type('Phone or email', 'user@example.com'); await tap('Continue');
  await type('Password', 'password'); await tap('Sign in');
  expect(onComplete).not.toHaveBeenCalled();
  expect(button('Resend code').props.disabled).toBe(true);
  expect(screenText()).toContain('You can request another code in 30s.');
  expect(auth.resendVerification).not.toHaveBeenCalled();
  await type('Verification code', '12x345678');
  expect(input('Verification code').props.value).toBe('123456');
  await tap('Verify');
  expect(auth.verifyEmail).toHaveBeenCalledWith('user@example.com', '123456');
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test('password reset resends are disabled until cooldown ends', async () => {
  auth.requestPasswordReset.mockResolvedValue({ delivery_email: 'user@example.com' });
  await type('Phone or email', 'user@example.com'); await tap('Continue');
  await tap('Forgot password?'); await tap('Send reset code');
  expect(button('Resend in 30s').props.disabled).toBe(true);
  expect(screenText()).not.toContain('You can request another code in');
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(button('Resend code').props.disabled).toBe(false);
});

test('successful password login reports completion once for the Profile tab handoff', async () => {
  auth.login.mockResolvedValue({ needs_profile_completion: false });
  await type('Phone or email', 'user@example.com'); await tap('Continue');
  await type('Password', 'password'); await tap('Sign in');
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test('registration completes only after verification, preserving the Profile tab handoff', async () => {
  auth.signup.mockResolvedValue({ email: 'user@example.com', otp_sent: true, retry_after_seconds: 30 });
  auth.verifyEmail.mockResolvedValue({ needs_profile_completion: false });
  await tap('No account? Sign up');
  await type('Full name', 'Wing Fan'); await type('Phone number', '5195550123');
  await type('Email address', 'user@example.com');
  await type('Password', 'SafeWings1!'); await type('Confirm password', 'SafeWings1!'); await tap('Sign up');
  expect(onComplete).not.toHaveBeenCalled();
  expect(button('Resend code').props.disabled).toBe(true);
  expect(screenText()).toContain('You can request another code in 30s.');
  expect(auth.resendVerification).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType('Text').some(node => node.children.join('').includes('If a code can be sent'))).toBe(true);
  await type('Verification code', '123456'); await tap('Verify');
  expect(auth.verifyEmail).toHaveBeenCalledWith('user@example.com', '123456');
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test.each([0, 19, 30, 750])('failed initial email recovers using server retry %ss without repeating signup', async retry => {
  auth.signup.mockResolvedValue({ email: 'user@example.com', otp_sent: false, retry_after_seconds: retry });
  auth.resendVerification.mockResolvedValue({ request_accepted: true });
  await tap('No account? Sign up');
  await type('Full name', 'Wing Fan'); await type('Phone number', '5195550123'); await type('Email address', 'user@example.com');
  await type('Password', 'SafeWings1!'); await type('Confirm password', 'SafeWings1!'); await tap('Sign up');
  const label = 'Resend code';
  expect(button(label).props.disabled).toBe(retry > 0);
  if (retry) expect(screenText()).toContain(`You can request another code in ${retry}s.`);
  else expect(screenText()).not.toContain('You can request another code in');
  expect(auth.resendVerification).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType('Text').some(node => node.children.join('').includes("We couldn't confirm your verification email"))).toBe(true);
  expect(onComplete).not.toHaveBeenCalled();
  await type('Verification code', '123456'); expect(button('Verify').props.disabled).toBe(false);
  await act(async () => renderer.update(React.createElement(AuthSheet, { visible: true, onClose: jest.fn(), onComplete })));
  expect(button(label).props.disabled).toBe(retry > 0);
  if (retry) {
    await act(async () => jest.advanceTimersByTime(1000)); expect(button('Resend code').props.disabled).toBe(true);
    expect(screenText()).toContain(`You can request another code in ${retry - 1}s.`);
    await act(async () => jest.advanceTimersByTime((retry - 1) * 1000));
  }
  const click = button('Resend code').props.onPress;
  await act(async () => { await Promise.all([click(), click()]); });
  expect(auth.resendVerification).toHaveBeenCalledTimes(1); expect(auth.signup).toHaveBeenCalledTimes(1);
  expect(button('Resend in 30s').props.disabled).toBe(true); expect(onComplete).not.toHaveBeenCalled();
  expect(screenText()).not.toContain('You can request another code in');
});

test('login keeps the completion form open until the required profile fields are saved', async () => {
  auth.login.mockResolvedValue({ needs_profile_completion: true, user: { displayName: 'Wing Fan' } });
  auth.updateProfile.mockResolvedValue({ profile_complete: true });
  await type('Phone or email', 'user@example.com'); await tap('Continue');
  await type('Password', 'password'); await tap('Sign in');
  expect(onComplete).not.toHaveBeenCalled();
  expect(input('Full name')).toBeDefined();
  await type('Email address', 'user@example.com'); await tap('Continue');
  expect(auth.updateProfile).toHaveBeenCalledWith('Wing Fan', 'user@example.com');
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test('only an eligible click starts the resend countdown; a pending request stays guarded', async () => {
  auth.login.mockResolvedValue({ needs_email_verification: true, email: 'user@example.com' });
  await type('Phone or email', 'user@example.com'); await tap('Continue');
  await type('Password', 'password'); await tap('Sign in');
  await tap('Resend code'); expect(auth.resendVerification).not.toHaveBeenCalled();
  expect(button('Resend code').props.disabled).toBe(true);
  await act(async () => jest.advanceTimersByTime(30000)); expect(button('Resend code').props.disabled).toBe(false);
  expect(screenText()).not.toContain('You can request another code in');
  let release; auth.resendVerification.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const click = button('Resend code').props.onPress;
  await act(async () => { click(); click(); });
  expect(auth.resendVerification).toHaveBeenCalledTimes(1); expect(button('Resend in 30s').props.disabled).toBe(true);
  await act(async () => jest.advanceTimersByTime(31000));
  await act(async () => click()); expect(auth.resendVerification).toHaveBeenCalledTimes(1);
  await act(async () => release({ request_accepted: true, retry_after_seconds: 90 }));
  expect(button('Resend in 90s').props.disabled).toBe(true);
  expect(screenText()).not.toContain('You can request another code in');
  await act(async () => jest.advanceTimersByTime(90000)); expect(button('Resend code').props.disabled).toBe(false);
});
