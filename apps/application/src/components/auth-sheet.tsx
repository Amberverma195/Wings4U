import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Lock, Phone, User, X } from "lucide-react-native";
import { useAuth } from "../hooks/use-auth";

type AuthStep = "login" | "profile";

export function AuthSheet({
  visible,
  onClose,
  onComplete,
  initialStep = "login",
}: {
  visible: boolean;
  onClose: () => void;
  onComplete?: () => void;
  initialStep?: AuthStep;
}) {
  const { login, updateProfile, loading, error, clearError } = useAuth();
  const [step, setStep] = useState<AuthStep>(initialStep);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const displayError = localError || error;

  useEffect(() => {
    if (!visible) return;
    setStep(initialStep);
  }, [initialStep, visible]);

  const resetState = useCallback(() => {
    setStep("login");
    setIdentifier("");
    setPassword("");
    setFullName("");
    setLocalError(null);
    clearError();
  }, [clearError]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleLogin = useCallback(async () => {
    Keyboard.dismiss();
    setLocalError(null);
    clearError();

    if (!identifier.trim()) {
      setLocalError("Please enter your phone or email");
      return;
    }
    if (!password) {
      setLocalError("Please enter your password");
      return;
    }

    try {
      const result = await login(identifier.trim(), password);
      if (result.needs_profile_completion) {
        setStep("profile");
      } else {
        onComplete?.();
        handleClose();
      }
    } catch {
      // error is set by the hook
    }
  }, [identifier, password, login, clearError, handleClose, onComplete]);

  const handleUpdateProfile = useCallback(async () => {
    Keyboard.dismiss();
    setLocalError(null);
    clearError();

    if (fullName.trim().length < 4) {
      setLocalError("Name must be at least 4 characters");
      return;
    }

    try {
      await updateProfile(fullName.trim());
      onComplete?.();
      handleClose();
    } catch {
      // error is set by the hook
    }
  }, [fullName, updateProfile, clearError, handleClose, onComplete]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={handleClose} />

        <View style={s.sheet}>
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>
              {step === "login" ? "Sign in" : "Complete Profile"}
            </Text>
            <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
              <X size={22} color="#666" />
            </TouchableOpacity>
          </View>

          {displayError ? (
            <View style={s.errorBanner}>
              <Text style={s.errorBannerText}>{displayError}</Text>
            </View>
          ) : null}

          {step === "login" && (
            <View style={s.formSection}>
              <View style={s.inputRow}>
                <Phone size={20} color="#FF4D4D" />
                <TextInput
                  style={s.input}
                  placeholder="Phone or email"
                  placeholderTextColor="#BBB"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={identifier}
                  onChangeText={(t) => {
                    setIdentifier(t);
                    setLocalError(null);
                    clearError();
                  }}
                  autoFocus
                  returnKeyType="next"
                />
              </View>
              <View style={[s.inputRow, { marginTop: 12 }]}>
                <Lock size={20} color="#FF4D4D" />
                <TextInput
                  style={s.input}
                  placeholder="Password"
                  placeholderTextColor="#BBB"
                  secureTextEntry
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setLocalError(null);
                    clearError();
                  }}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
              </View>
              <TouchableOpacity
                style={[s.primaryBtn, loading && s.primaryBtnDisabled]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>Sign In</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {step === "profile" && (
            <View style={s.formSection}>
              <View style={s.inputRow}>
                <User size={20} color="#FF4D4D" />
                <TextInput
                  style={s.input}
                  placeholder="Full Name"
                  placeholderTextColor="#BBB"
                  value={fullName}
                  onChangeText={(t) => {
                    setFullName(t);
                    setLocalError(null);
                    clearError();
                  }}
                  autoFocus
                  autoCapitalize="words"
                  returnKeyType="next"
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
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: "#1A1A1A" },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F5F5F5",
    justifyContent: "center",
    alignItems: "center",
  },
  errorBanner: {
    backgroundColor: "rgba(255,77,77,0.1)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorBannerText: { color: "#FF4D4D", fontSize: 13, fontWeight: "600", textAlign: "center" },
  formSection: { paddingBottom: 8 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F8F8",
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 52,
  },
  input: { flex: 1, fontSize: 16, color: "#1A1A1A", marginLeft: 12, fontWeight: "500" },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: "#FF4D4D",
    height: 52,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
});
