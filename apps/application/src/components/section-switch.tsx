import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export function SectionSwitch<T extends string>({ options, value, onChange, label }: {
  options: ReadonlyArray<{ key: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return <View style={styles.row} accessibilityRole="tablist" accessibilityLabel={label}>
    {options.map(option => <TouchableOpacity key={option.key}
      accessibilityRole="tab" accessibilityState={{ selected: value === option.key }}
      style={[styles.button, value === option.key && styles.active]} onPress={() => onChange(option.key)}>
      <Text style={[styles.text, value === option.key && styles.textActive]}>{option.label}</Text>
    </TouchableOpacity>)}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', backgroundColor: '#EEEEEE', padding: 4, borderRadius: 26, marginBottom: 20 },
  button: { flex: 1, minHeight: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  active: { backgroundColor: '#FF4D4D' },
  text: { fontSize: 14, fontWeight: '700', color: '#666666' },
  textActive: { color: '#FFFFFF' },
});
