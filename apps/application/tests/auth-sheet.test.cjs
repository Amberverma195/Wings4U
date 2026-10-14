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
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(button('Resend code').props.disabled).toBe(false);
});
