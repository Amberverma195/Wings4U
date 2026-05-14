/**
 * AuthSheet - OTP-based login/signup bottom sheet for the mobile app.
 *
 * Flow:
 *   1. User enters phone number -> POST /api/v1/auth/otp/request
 *   2. OTP code is sent (logged to console in dev via ConsoleOtpSender)
 *   3. User enters 6-digit code -> POST /api/v1/auth/otp/verify
 *   4. If new user (needs_profile_completion), show name form
 *   5. Session refreshes, sheet closes
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { X, Phone, Shield, User } from 'lucide-react-native';
import { useAuth } from '../hooks/use-auth';
import { toE164 } from '../lib/phone';

type AuthStep = 'phone' | 'otp' | 'profile';

export function AuthSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { requestOtp, verifyOtp, updateProfile, loading, error, clearError } = useAuth();
  const [step, setStep] = useState<AuthStep>('phone');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const otpInputRef = useRef<TextInput>(null);

  const displayError = localError || error;

  const resetState = useCallback(() => {
    setStep('phone');
    setPhone('');
    setOtpCode('');
    setFullName('');
    setEmail('');
    setLocalError(null);
    clearError();
  }, [clearError]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  /* Step 1: Request OTP */
  const handleRequestOtp = useCallback(async () => {
    Keyboard.dismiss();
    setLocalError(null);
    clearError();

    let phoneE164: string;
    try {
      phoneE164 = toE164(phone);
    } catch {
      setLocalError('Please enter a valid 10-digit phone number');
      return;
    }

    try {
      await requestOtp(phoneE164);
    } catch {
      // OTP request failed; the user can still use the 000000 dev bypass.
    }

    // Always move to the OTP step so the user can enter the code
    // (or use "000000" dev bypass even if the send failed)
    setStep('otp');
    setTimeout(() => otpInputRef.current?.focus(), 300);
  }, [phone, requestOtp, clearError]);

  /* Step 2: Verify OTP */
  const handleVerifyOtp = useCallback(async () => {
    Keyboard.dismiss();
    setLocalError(null);
    clearError();

    if (otpCode.length < 4) {
      setLocalError('Please enter the 6-digit code');
      return;
    }

    let phoneE164: string;
    try {
      phoneE164 = toE164(phone);
    } catch {
      setLocalError('Invalid phone number');
      return;
    }

    try {
      const result = await verifyOtp(phoneE164, otpCode);
      if (result.needs_profile_completion) {
        setStep('profile');
      } else {
        handleClose();
      }
    } catch {
      // error is set by the hook
    }
  }, [otpCode, phone, verifyOtp, clearError, handleClose]);

  /* Step 3: Profile completion */
  const handleUpdateProfile = useCallback(async () => {
    Keyboard.dismiss();
    setLocalError(null);
    clearError();

    if (fullName.trim().length < 4) {
      setLocalError('Name must be at least 4 characters');
      return;
    }

    try {
      await updateProfile(fullName.trim(), email.trim() || undefined);
      handleClose();
    } catch {
      // error is set by the hook
    }
  }, [fullName, email, updateProfile, clearError, handleClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={handleClose} />

        <View style={s.sheet}>
          {/* Header */}
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>
              {step === 'phone' ? 'Login / Sign Up' : step === 'otp' ? 'Enter Code' : 'Complete Profile'}
            </Text>
            <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
              <X size={22} color="#666" />
            </TouchableOpacity>
          </View>

          {/* Error */}
          {displayError ? (
            <View style={s.errorBanner}>
              <Text style={s.errorBannerText}>{displayError}</Text>
            </View>
          ) : null}

          {/* Step: Phone */}
          {step === 'phone' && (
            <View style={s.formSection}>
              <View style={s.inputRow}>
                <Phone size={20} color="#FF4D4D" />
                <TextInput
                  style={s.input}
                  placeholder="(416) 555-1234"
                  placeholderTextColor="#BBB"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={(t) => { setPhone(t); setLocalError(null); clearError(); }}
                  autoFocus
                  returnKeyType="next"
                  onSubmitEditing={handleRequestOtp}
                />
              </View>
              <Text style={s.hint}>
                We'll send a 6-digit code to verify your number.
              </Text>
              <TouchableOpacity
                style={[s.primaryBtn, loading && s.primaryBtnDisabled]}
                onPress={handleRequestOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>Send Code</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Step: OTP */}
          {step === 'otp' && (
            <View style={s.formSection}>
              <View style={s.inputRow}>
                <Shield size={20} color="#FF4D4D" />
                <TextInput
                  ref={otpInputRef}
                  style={[s.input, s.otpInput]}
                  placeholder="000000"
                  placeholderTextColor="#BBB"
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otpCode}
                  onChangeText={(t) => { setOtpCode(t); setLocalError(null); clearError(); }}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleVerifyOtp}
                />
              </View>
              <Text style={s.hint}>
                Enter the code sent to {phone}
              </Text>
              <TouchableOpacity
                style={[s.primaryBtn, loading && s.primaryBtnDisabled]}
                onPress={handleVerifyOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>Verify</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={() => { setStep('phone'); setOtpCode(''); clearError(); setLocalError(null); }}
              >
                <Text style={s.secondaryBtnText}>Change Number</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Step: Profile */}
          {step === 'profile' && (
            <View style={s.formSection}>
              <View style={s.inputRow}>
                <User size={20} color="#FF4D4D" />
                <TextInput
                  style={s.input}
                  placeholder="Full Name"
                  placeholderTextColor="#BBB"
                  value={fullName}
                  onChangeText={(t) => { setFullName(t); setLocalError(null); clearError(); }}
                  autoFocus
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
              <View style={[s.inputRow, { marginTop: 12 }]}>
                <Text style={s.atIcon}>@</Text>
                <TextInput
                  style={s.input}
                  placeholder="Email (optional)"
                  placeholderTextColor="#BBB"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={(t) => { setEmail(t); setLocalError(null); clearError(); }}
                  returnKeyType="done"
                  onSubmitEditing={handleUpdateProfile}
                />
              </View>
              <TouchableOpacity
                style={[s.primaryBtn, loading && s.primaryBtnDisabled]}
                onPress={handleUpdateProfile}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>Continue</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: '#1A1A1A' },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center', alignItems: 'center',
  },
  errorBanner: {
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  errorBannerText: { color: '#FF4D4D', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  formSection: { paddingBottom: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8F8F8', borderRadius: 14,
    paddingHorizontal: 16, height: 52,
  },
  input: { flex: 1, fontSize: 16, color: '#1A1A1A', marginLeft: 12, fontWeight: '500' },
  otpInput: { fontSize: 24, letterSpacing: 8, fontWeight: '700', textAlign: 'center' },
  atIcon: { fontSize: 18, color: '#FF4D4D', fontWeight: '700' },
  hint: { fontSize: 13, color: '#999', marginTop: 10, marginBottom: 20, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: '#FF4D4D', height: 52, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  secondaryBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  secondaryBtnText: { color: '#FF4D4D', fontSize: 14, fontWeight: '600' },
});
