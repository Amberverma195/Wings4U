import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AccountDeletionStatus, AccountDeletionVerification, AccountDeletionResult, ApiEnvelope } from '@wings4u/contracts';
import { apiFetch } from '../lib/api';
import { useSession, withSilentRefresh } from '../context/session';

async function read<T>(response: Response): Promise<T> {
  const body = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !body.data) throw new Error(body.errors?.[0]?.message ?? 'Unable to process account deletion. Please try again.');
  return body.data;
}

export function AccountDeletionModal({ visible, onClose, onCompleted }: {
  visible: boolean; onClose: () => void; onCompleted: () => Promise<void>;
}) {
  const session = useSession();
  const [step, setStep] = useState<'review' | 'password' | 'confirm'>('review');
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const authorization = useRef<AccountDeletionVerification | null>(null);
  const inFlight = useRef(false);
  const epoch = useRef(0);

  useEffect(() => {
    const version = ++epoch.current;
    inFlight.current = false; setBusy(false);
    authorization.current = null;
    setStep('review'); setPassword(''); setConfirmation(''); setConsent(false); setStatus(null); setError('');
    if (visible && session.authenticated && session.user?.role === 'CUSTOMER') {
      void withSilentRefresh(() => apiFetch('/api/v1/auth/account-deletion'), session.refresh, session.clear).then(read<AccountDeletionStatus>)
        .then(value => { if (version === epoch.current) setStatus(value); })
        .catch(cause => { if (version === epoch.current) setError(cause instanceof Error ? cause.message : 'Unable to load account status.'); });
    }
    return () => { epoch.current++; authorization.current = null; };
  }, [visible, session.authenticated, session.user?.id, session.user?.role, reload]);

  function close() {
    if (inFlight.current) return;
    epoch.current++; authorization.current = null; setPassword(''); setConfirmation(''); onClose();
  }
  function verifyAgain() {
    authorization.current = null; setConfirmation(''); setPassword(''); setError(''); setStep('password');
  }
  async function verify() {
    if (inFlight.current || !password || !status?.enabled) return;
    inFlight.current = true; setBusy(true); setError('');
    const version = epoch.current;
    const enteredPassword = password; setPassword('');
    try {
      const value = await read<AccountDeletionVerification>(await withSilentRefresh(() => apiFetch('/api/v1/auth/account-deletion/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: enteredPassword }),
      }), session.refresh, session.clear));
      if (version !== epoch.current) return;
      authorization.current = value; setStep('confirm');
    } catch (cause) { if (version === epoch.current) setError(cause instanceof Error ? cause.message : 'Password verification failed.'); }
    finally { if (version === epoch.current) { inFlight.current = false; setBusy(false); } }
  }
  async function remove() {
    if (inFlight.current || confirmation !== 'DELETE' || !consent || !authorization.current) return;
    if (Date.parse(authorization.current.expires_at) <= Date.now()) {
      verifyAgain(); setError('Verification expired. Re-enter your password.'); return;
    }
    inFlight.current = true; setBusy(true); setError('');
    const version = epoch.current;
    try {
      const value = await read<AccountDeletionResult>(await apiFetch('/api/v1/auth/account', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorization: authorization.current.authorization,
          request_id: authorization.current.request_id, confirmation, forfeit_rewards: consent }),
      }));
      if (version !== epoch.current) return;
      if (value.status === 'resolution_required') {
        authorization.current = null;
        setStatus(current => current && { ...current, status: 'resolution_required', blockers: value.blockers });
        setConfirmation(''); setConsent(false); setStep('review');
      } else if (value.status === 'completed') { authorization.current = null; await onCompleted(); }
      else throw new Error('Deletion has not been confirmed. Check your account status before trying again.');
    } catch (cause) {
      if (version !== epoch.current) return;
      const pendingProof = authorization.current;
      if (pendingProof) {
        try {
          const receipt = await read<{ status: string }>(await apiFetch('/api/v1/auth/account-deletion/receipt', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
              request_id: pendingProof.request_id, authorization: pendingProof.authorization }),
          }));
          if (version !== epoch.current) return;
          if (receipt.status === 'completed') { authorization.current = null; await onCompleted(); return; }
        } catch { /* No completion claim without a verified server receipt. */ }
      }
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : 'Deletion could not be confirmed. Please try again.');
    }
    finally { if (version === epoch.current) { inFlight.current = false; setBusy(false); } }
  }

  return <Modal visible={visible} animationType="slide" onRequestClose={close}>
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" accessibilityViewIsModal>
        <Text style={s.title} accessibilityRole="header">Delete your Wings4U account?</Text>
        <Text style={s.copy}>Deleting your account is permanent. Your profile, saved addresses, login credentials,
          saved carts, reviews, and other eligible personal data will be deleted. Personal details copied into
          completed orders and messages will be removed.</Text>
        <Text style={s.copy}>Certain transaction, payment, tax, refund, and security records may be retained for
          legal and financial obligations. You will lose access to saved information and rewards.</Text>
        <Text style={s.copy}>Deletion will not cancel active orders or automatically refund or transfer wallet
          balances. Pending payments, refunds, disputes, and nonzero wallet balances must be resolved first.
          Eligible deletion completes when confirmation succeeds. If something prevents completion, you will
          see the reason and can try again after it is resolved.</Text>
        {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
        {!status ? <Text style={s.copy}>{error ? 'Account status could not be loaded.' : 'Checking account status…'}</Text> :
          !status.enabled ? <Text style={s.copy}>Account deletion is not available yet. Your account and data have not been deleted.</Text> : <>
            {status.blockers.length ? <View>
              <Text style={s.heading} accessibilityRole="header">Resolve these items before deletion</Text>
              {status.blockers.map(blocker => <Text style={s.copy} key={blocker.code}>{blocker.message}</Text>)}
              <Text style={s.copy}>Your account remains available. Deletion has not completed.</Text>
              <Action label="Check again" onPress={() => setReload(value => value + 1)} />
            </View> : null}
            {step === 'review' ? <Action label="Continue to verification" disabled={status.blockers.length > 0} onPress={() => setStep('password')} /> : null}
            {step === 'password' ? <>
              <Text style={s.heading} accessibilityRole="header">Verify it is you</Text>
              <TextInput style={s.input} accessibilityLabel="Current password" placeholder="Current password"
                value={password} onChangeText={setPassword} secureTextEntry textContentType="password"
                autoComplete="current-password" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy} />
              <Text style={s.copy}>If you need to set or reset your password, use Forgot password on the sign-in form.</Text>
              <Action label={busy ? 'Verifying…' : 'Verify password'} disabled={busy || !password} onPress={() => { void verify(); }} />
            </> : null}
            {step === 'confirm' ? <>
              <Text style={s.heading} accessibilityRole="header">Final confirmation</Text>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: busy }}
                disabled={busy} style={s.consent} onPress={() => setConsent(value => !value)}>
                <Text style={s.copy}>{consent ? '☑' : '☐'} I understand my saved information and rewards will be lost.</Text>
              </TouchableOpacity>
              <TextInput style={s.input} accessibilityLabel="Type DELETE to confirm" placeholder="Type DELETE to confirm"
                value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" autoCorrect={false} editable={!busy} />
              <Action label={busy ? 'Deleting…' : 'Delete My Account'} destructive disabled={busy || !consent || confirmation !== 'DELETE'}
                onPress={() => { void remove(); }} />
              {error ? <Action label="Verify again" disabled={busy} onPress={verifyAgain} /> : null}
            </> : null}
          </>}
        {!status && error ? <Action label="Try again" onPress={() => setReload(value => value + 1)} /> : null}
        {busy ? <ActivityIndicator color="#B91C1C" accessibilityLabel="Processing account deletion" /> : null}
        <Action label="Keep My Account" disabled={busy} onPress={close} />
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

function Action({ label, disabled = false, destructive = false, onPress }: {
  label: string; disabled?: boolean; destructive?: boolean; onPress: () => void;
}) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[s.button, destructive && s.destructive, disabled && s.disabled]}>
    <Text style={[s.buttonText, destructive && s.destructiveText]}>{label}</Text>
  </TouchableOpacity>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFBF5' },
  content: { padding: 24, gap: 16 }, title: { fontSize: 26, fontWeight: '800', color: '#30241F' },
  heading: { fontSize: 19, fontWeight: '700', color: '#30241F' },
  copy: { fontSize: 15, lineHeight: 23, color: '#4A3B34' },
  error: { fontSize: 15, lineHeight: 23, color: '#B91C1C' },
  input: { borderWidth: 1, borderColor: '#A6948A', borderRadius: 12, minHeight: 48, padding: 12, color: '#30241F' },
  button: { minHeight: 48, borderWidth: 1, borderColor: '#A6948A', borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#30241F', fontSize: 16, fontWeight: '700' },
  destructive: { borderColor: '#B91C1C', backgroundColor: '#B91C1C' }, destructiveText: { color: '#FFFFFF' },
  disabled: { opacity: 0.5 }, consent: { minHeight: 48, justifyContent: 'center' },
});
