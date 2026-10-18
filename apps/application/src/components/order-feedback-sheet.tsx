import React, { useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

export function OrderFeedbackSheet({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode;
}) {
  const heading = useRef<React.ComponentRef<typeof Text>>(null);
  return <Modal visible transparent animationType="slide" onRequestClose={onClose} onShow={() => {
    const node = findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }}>
    <SafeAreaView style={feedbackStyles.overlay}>
      <KeyboardAvoidingView style={feedbackStyles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={feedbackStyles.sheet} accessibilityViewIsModal importantForAccessibility="yes">
          <View style={feedbackStyles.header}>
            <Text ref={heading} accessible accessibilityRole="header" style={feedbackStyles.title}>{title}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close modal" onPress={onClose} style={feedbackStyles.close}>
              <X size={22} color="#1A1A1A" />
            </TouchableOpacity>
          </View>
          <ScrollView style={feedbackStyles.scroll} contentContainerStyle={feedbackStyles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
            {subtitle ? <Text style={feedbackStyles.muted}>{subtitle}</Text> : null}
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

export function FeedbackButton({ label, onPress, disabled = false, busy = false, secondary = false }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean;
}) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }}
    disabled={disabled || busy} onPress={onPress} style={[feedbackStyles.button, secondary && feedbackStyles.secondary, (disabled || busy) && feedbackStyles.disabled]}>
    {busy ? <ActivityIndicator color={secondary ? '#FF4D4D' : '#FFF'} accessibilityLabel="Submitting" /> : null}
    <Text style={[feedbackStyles.buttonText, secondary && feedbackStyles.secondaryText]}>{busy ? 'Submitting...' : label}</Text>
  </TouchableOpacity>;
}

export function FeedbackError({ message }: { message: string | null }) {
  return message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={feedbackStyles.error}>{message}</Text> : null;
}

export const feedbackStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '94%', backgroundColor: '#FFF', borderRadius: 24, paddingTop: 12, paddingHorizontal: 18, paddingBottom: 8,
    shadowColor: '#1A1A1A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { flex: 1, color: '#1A1A1A', fontWeight: '900', fontSize: 21 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexShrink: 1 }, content: { gap: 14, paddingBottom: 24 },
  muted: { color: '#777777', fontSize: 14, lineHeight: 21 },
  text: { color: '#1A1A1A', fontSize: 15, lineHeight: 22 },
  label: { color: '#1A1A1A', fontSize: 15, fontWeight: '800' },
  card: { borderWidth: 1, borderColor: '#EFEFEF', backgroundColor: '#FFF', borderRadius: 16, padding: 14, gap: 8 },
  selected: { borderColor: '#FF4D4D', backgroundColor: '#FFF0ED' },
  input: { minHeight: 105, borderRadius: 14, borderWidth: 1, borderColor: '#EBDDD5', padding: 12, color: '#1A1A1A', backgroundColor: '#FFF', fontSize: 15, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { flexGrow: 1, flexBasis: 90, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: '#FF4D4D', backgroundColor: '#FF4D4D', padding: 12, alignItems: 'center', justifyContent: 'center', gap: 5 },
  buttonText: { color: '#FFF', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  secondary: { backgroundColor: '#FFF' }, secondaryText: { color: '#E53C3C' },
  disabled: { opacity: 0.5 }, error: { color: '#B91C1C', fontSize: 14, lineHeight: 21 },
});
