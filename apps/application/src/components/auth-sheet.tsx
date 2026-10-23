import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
  type TextInputProps,
} from 'react-native';
import { Eye, EyeOff, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthRequestError, useAuth, type AuthSessionResult } from '../hooks/use-auth';
import { useSession } from '../context/session';
import {
  formatPhoneOrEmailInput, normalizeLoginIdentifier, normalizeEmail,
  normalizeFullName, validateLoginPassword, validateNewPassword, validateOtp,
} from '../lib/auth-validation';
import { formatPhoneForDisplay } from '../lib/phone';
import { LegalLinks } from './legal-links';

type AuthStep = 'login-id' | 'login-password' | 'signup' | 'verify-email' |
  'reset-request' | 'reset-verify' | 'profile';

function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#AAA" autoCorrect={false}
        accessibilityLabel={label} {...props} style={s.input} />
    </View>
  );
}

function PasswordField({ label = 'Password', ...props }: TextInputProps & { label?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.passwordRow}>
        <TextInput placeholderTextColor="#AAA" autoCorrect={false}
          autoCapitalize="none" maxLength={128} accessibilityLabel={label}
          {...props} secureTextEntry={!visible} style={s.passwordInput} />
        <TouchableOpacity style={s.eyeButton} onPress={() => setVisible(value => !value)}
          accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'}>
          {visible ? <EyeOff size={20} color="#666" /> : <Eye size={20} color="#666" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PasswordChecklist({ value }: { value: string }) {
  const checks = [
    ['At least 8 characters', value.length >= 8],
    ['Includes a letter', /[A-Za-z]/.test(value)],
    ['Includes a number', /\d/.test(value)],
    ['Includes a special character', /[^A-Za-z0-9]/.test(value)],
  ] as const;
  return <View style={s.checklist}>
    {checks.map(([label, met]) => <Text key={label} style={[s.check, met && s.checkMet]}>
      {met ? '✓' : '○'} {label}
    </Text>)}
  </View>;
}

export function AuthSheet({
  visible, onClose, onComplete, initialStep = 'login',
}: {
  visible: boolean;
  onClose: () => void;
  onComplete?: () => void;
  initialStep?: 'login' | 'profile';
}) {
  const auth = useAuth();
  const session = useSession();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<AuthStep>('login-id');
  const [identifier, setIdentifier] = useState('');
  const [normalizedIdentifier, setNormalizedIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [deliveryEmail, setDeliveryEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [submitCooldownUntil, setSubmitCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [resendLocked, setResendLocked] = useState(false);
  const [verificationResendRequested, setVerificationResendRequested] = useState(false);
  const actionInFlight = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const { clearError } = auth;

  const reset = useCallback(() => {
    setIdentifier(''); setNormalizedIdentifier(''); setPassword(''); setConfirmation('');
    setFullName(''); setEmail(''); setPhone(''); setCode(''); setDeliveryEmail('');
    setLocalError(null); setCooldownUntil(0); setSubmitCooldownUntil(0); setResendLocked(false); setVerificationResendRequested(false); clearError();
  }, [clearError]);

  useEffect(() => {
    reset();
    if (visible) setStep(initialStep === 'profile' ? 'profile' : 'login-id');
  }, [visible, initialStep, reset]);

  useEffect(() => {
    if (step !== 'profile' || !visible) return;
    setFullName(value => value || session.user?.displayName || '');
    setEmail(value => value || session.user?.email || '');
  }, [step, visible, session.user?.displayName, session.user?.email]);

  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const submitCooldown = Math.max(0, Math.ceil((submitCooldownUntil - now) / 1000));
  useEffect(() => {
    if (!visible || Math.max(cooldownUntil, submitCooldownUntil) <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, cooldownUntil, submitCooldownUntil]);

  const startCooldown = (seconds = 30) => {
    setNow(Date.now()); setCooldownUntil(Date.now() + seconds * 1000);
  };
  const clearMessages = () => { setLocalError(null); clearError(); };
  const changeStep = (next: AuthStep) => {
    clearMessages(); setPassword(''); setConfirmation(''); setCode(''); setStep(next);
  };
  const handleClose = () => {
    if (actionInFlight.current) return;
    reset(); onClose();
  };
  const complete = () => { reset(); onComplete?.(); onClose(); };
  const finishAuth = (result: AuthSessionResult) => {
    setPassword(''); setConfirmation(''); setCode('');
    if (result.needs_profile_completion) {
      setFullName(result.user?.displayName ?? ''); setStep('profile');
    } else complete();
  };

  const perform = async (operation: () => Promise<void>, resending = false) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    Keyboard.dismiss(); clearMessages();
    try { await operation(); }
    catch (cause) {
      if (!visibleRef.current) return;
      const message = cause instanceof Error ? cause.message : 'Unable to complete request';
      setLocalError(message);
      if (cause instanceof AuthRequestError && cause.status === 429) {
        if (resending) startCooldown(cause.retrySeconds ?? 30);
        else {
          setNow(Date.now());
          setSubmitCooldownUntil(Date.now() + (cause.retrySeconds ?? 30) * 1000);
        }
        if (/too many verification codes requested/i.test(message)) setResendLocked(true);
      }
    } finally { actionInFlight.current = false; }
  };

  const submit = () => perform(async () => {
    if (submitCooldown > 0) return;
    if (step === 'login-id') {
      // Advance locally: never probe whether a phone/email belongs to an account.
      setNormalizedIdentifier(normalizeLoginIdentifier(identifier));
      changeStep('login-password');
    } else if (step === 'login-password') {
      validateLoginPassword(password);
      const result = await auth.login(normalizedIdentifier, password);
      if (!visibleRef.current) return;
      if (result.needs_email_verification) {
        setVerificationResendRequested(false);
        setEmail(result.email); changeStep('verify-email'); startCooldown();
      } else finishAuth(result);
    } else if (step === 'signup') {
      const result = await auth.signup(fullName, phone, email, password, confirmation);
      if (!visibleRef.current) return;
      setEmail(result.email ?? normalizeEmail(email));
      setVerificationResendRequested(false);
      changeStep('verify-email');
      const retry = result.retry_after_seconds;
      const wait = typeof retry === 'number' && Number.isFinite(retry) && retry >= 0 ? Math.ceil(retry) : 30;
      startCooldown(result.otp_sent === false ? wait : Math.max(30, wait));
      if (result.otp_sent === false) setLocalError("We couldn't confirm your verification email. If a code arrives, you can still use it. You can request another code below when available.");
    } else if (step === 'verify-email') {
      validateOtp(code);
      const result = await auth.verifyEmail(email, code);
      if (visibleRef.current) finishAuth(result);
    } else if (step === 'reset-request') {
      const normalized = normalizeLoginIdentifier(identifier);
      const result = await auth.requestPasswordReset(normalized);
      if (!visibleRef.current) return;
      setNormalizedIdentifier(normalized);
      setDeliveryEmail(result.delivery_email?.trim() || (normalized.includes('@') ? normalized : 'the email on file'));
      setResendLocked(false); changeStep('reset-verify'); startCooldown();
    } else if (step === 'reset-verify') {
      validateOtp(code); validateNewPassword(password, confirmation);
      const result = await auth.confirmPasswordReset(normalizedIdentifier, code, password, confirmation);
      if (visibleRef.current) finishAuth(result);
    } else {
      normalizeFullName(fullName); normalizeEmail(email);
      const result = await auth.updateProfile(fullName, email);
      if (!visibleRef.current) return;
      if (!result.profile_complete) throw new Error('Please complete your name and email before continuing.');
      complete();
    }
  });

  const resend = () => perform(async () => {
    if (cooldown > 0 || resendLocked) return;
    if (step === 'verify-email') setVerificationResendRequested(true);
    startCooldown();
    if (step === 'verify-email') {
      const result = await auth.resendVerification(email);
      const retry = result?.retry_after_seconds;
      if (visibleRef.current && typeof retry === 'number' && Number.isFinite(retry) && retry > 30) startCooldown(Math.ceil(retry));
    }
    else {
      const result = await auth.requestPasswordReset(normalizedIdentifier);
      if (visibleRef.current && result.delivery_email) setDeliveryEmail(result.delivery_email);
    }
  }, true);

  const busy = auth.loading;
  const title = {
    'login-id': 'Sign in', 'login-password': 'Enter your password',
    signup: 'Create an account', 'verify-email': 'Verify your email',
    'reset-request': 'Reset your password', 'reset-verify': 'Set a new password',
    profile: 'Complete your profile',
  }[step];
  const label = {
    'login-id': 'Continue', 'login-password': 'Sign in', signup: 'Sign up',
    'verify-email': 'Verify', 'reset-request': 'Send reset code',
    'reset-verify': 'Reset password', profile: 'Continue',
  }[step];
  const isCodeStep = step === 'verify-email' || step === 'reset-verify';
  const blocked = busy || (isCodeStep && code.length < 4) ||
    submitCooldown > 0;
  const inputProps = { editable: !busy, autoCorrect: false };
  const changeValue = (setter: (value: string) => void) => (value: string) => {
    setter(value); clearMessages();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={handleClose}
          accessibilityLabel="Close sign in" disabled={busy} />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{title}</Text>
            <TouchableOpacity disabled={busy} onPress={handleClose} style={s.closeBtn}
              accessibilityRole="button" accessibilityLabel="Close sign in">
              <X size={22} color="#666" />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
            contentContainerStyle={s.form}>
            {(localError || auth.error) ? <View style={s.errorBanner}>
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.errorText}>
                {localError || auth.error}
              </Text>
            </View> : null}

            {(step === 'login-id' || step === 'reset-request') && <>
              {step === 'reset-request' && <Text style={s.subtitle}>We'll send a reset code to the email on file.</Text>}
              <Field key={step} label="Phone or email" placeholder="(123)-456-7890 or email"
                value={identifier} onChangeText={value => {
                  setIdentifier(formatPhoneOrEmailInput(value)); clearMessages();
                }}
                autoCapitalize="none" autoComplete="username" keyboardType="email-address"
                maxLength={254} autoFocus returnKeyType="done" onSubmitEditing={() => void submit()} {...inputProps} />
            </>}

            {step === 'login-password' && <>
              <Text style={s.subtitle}>Signing in as</Text>
              <Text style={s.identifier}>{normalizedIdentifier.includes('@')
                ? normalizedIdentifier : formatPhoneForDisplay(normalizedIdentifier)}</Text>
              <PasswordField key="login-password" value={password} onChangeText={changeValue(setPassword)}
                placeholder="Your password" autoFocus autoComplete="current-password"
                textContentType="password" returnKeyType="done" onSubmitEditing={() => void submit()} {...inputProps} />
            </>}

            {(step === 'signup' || step === 'profile') && <>
              <Field label="Full name" value={fullName} onChangeText={changeValue(setFullName)}
                placeholder="Full name" maxLength={80} autoCapitalize="words" autoComplete="name" {...inputProps} />
              {step === 'signup' && <Field label="Phone number" value={phone}
                onChangeText={value => { setPhone(formatPhoneOrEmailInput(value)); clearMessages(); }}
                placeholder="(123)-456-7890" keyboardType="phone-pad" maxLength={14}
                autoComplete="tel-national" {...inputProps} />}
              <Field label="Email address" value={email} onChangeText={changeValue(setEmail)}
                placeholder="Email address" maxLength={254} keyboardType="email-address"
                autoCapitalize="none" autoComplete="email" {...inputProps} />
            </>}

            {isCodeStep && <>
              <Text style={s.subtitle}>{step === 'verify-email' ? `Check ${email} for your verification code. If a code can be sent, check your inbox and spam folder.` : `We sent a code to ${deliveryEmail}.`}</Text>
              <Field key={step} label="Verification code" value={code}
                onChangeText={value => { setCode(value.replace(/\D/g, '').slice(0, 6)); clearMessages(); }}
                placeholder="Code" maxLength={6} keyboardType="number-pad"
                autoComplete="one-time-code" textContentType="oneTimeCode" autoFocus {...inputProps} />
            </>}

            {(step === 'signup' || step === 'reset-verify') && <>
              <PasswordField key={step + '-new'} label={step === 'signup' ? 'Password' : 'New password'}
                value={password} onChangeText={changeValue(setPassword)}
                placeholder="Create a password" autoComplete="new-password" textContentType="newPassword" {...inputProps} />
              <PasswordChecklist value={password} />
              <PasswordField key={step + '-confirm'} label="Confirm password"
                value={confirmation} onChangeText={changeValue(setConfirmation)}
                placeholder="Re-enter your password" autoComplete="new-password"
                returnKeyType="done" onSubmitEditing={() => void submit()} {...inputProps} />
            </>}

            <TouchableOpacity style={[s.primaryBtn, blocked && s.disabled]}
              disabled={blocked} onPress={() => void submit()} accessibilityRole="button"
              accessibilityState={{ disabled: blocked, busy }}>
              {busy ? <ActivityIndicator color="#FFF" /> :
                <Text style={s.primaryBtnText}>{submitCooldown > 0 ? 'Try again in ' + submitCooldown + 's' : label}</Text>}
            </TouchableOpacity>

            {step === 'login-password' && <>
              <TouchableOpacity disabled={busy} style={s.linkButton} onPress={() => {
                setIdentifier(normalizedIdentifier.includes('@') ? normalizedIdentifier :
                  formatPhoneOrEmailInput(normalizedIdentifier.slice(2)));
                changeStep('reset-request');
              }}><Text style={s.link}>Forgot password?</Text></TouchableOpacity>
              <TouchableOpacity disabled={busy} style={s.linkButton} onPress={() => changeStep('login-id')}>
                <Text style={s.link}>Use a different phone/email</Text>
              </TouchableOpacity>
            </>}
            {isCodeStep && <TouchableOpacity disabled={busy || cooldown > 0 || resendLocked}
              style={s.linkButton} onPress={() => void resend()}>
              <Text style={[s.link, (cooldown > 0 || resendLocked) && s.muted]}>
                {resendLocked ? 'Resend limit reached' : cooldown > 0 && (step !== 'verify-email' || verificationResendRequested) ? 'Resend in ' + cooldown + 's' : 'Resend code'}
              </Text>
            </TouchableOpacity>}
            {step === 'verify-email' && !verificationResendRequested && cooldown > 0 && (
              <Text style={s.subtitle}>You can request another code in {cooldown}s.</Text>
            )}
            {(step === 'login-id' || step === 'login-password') && <TouchableOpacity
              disabled={busy} style={s.linkButton} onPress={() => changeStep('signup')}>
              <Text style={s.link}>No account? Sign up</Text>
            </TouchableOpacity>}
            {['signup', 'reset-request', 'reset-verify', 'verify-email'].includes(step) && <TouchableOpacity
              disabled={busy} style={s.linkButton} onPress={() => changeStep('login-id')}>
              <Text style={s.link}>Back to sign in</Text>
            </TouchableOpacity>}
            <LegalLinks />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '92%', backgroundColor: '#FFF', borderTopLeftRadius: 28,
    borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1,
    shadowRadius: 16, elevation: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: '#1A1A1A' },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5',
    justifyContent: 'center', alignItems: 'center' },
  form: { paddingBottom: 8, gap: 12 },
  field: { gap: 6 },
  label: { color: '#555', fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: '#F8F8F8', borderRadius: 14, paddingHorizontal: 16,
    minHeight: 52, fontSize: 16, color: '#1A1A1A' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F8F8', borderRadius: 14 },
  passwordInput: { flex: 1, paddingHorizontal: 16, minHeight: 52, fontSize: 16, color: '#1A1A1A' },
  eyeButton: { minWidth: 48, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  errorBanner: { backgroundColor: 'rgba(255,77,77,0.1)', borderRadius: 12, padding: 12 },
  errorText: { color: '#D93434', fontSize: 13, fontWeight: '600' },
  subtitle: { color: '#666', fontSize: 14, lineHeight: 20 },
  identifier: { color: '#1A1A1A', fontSize: 17, fontWeight: '700' },
  primaryBtn: { backgroundColor: '#FF4D4D', minHeight: 52, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  linkButton: { minHeight: 40, justifyContent: 'center', alignItems: 'center' },
  link: { color: '#E83F3F', fontSize: 14, fontWeight: '600' },
  muted: { color: '#999' },
  checklist: { gap: 4 },
  check: { fontSize: 12, color: '#777' },
  checkMet: { color: '#21864D' },
});
