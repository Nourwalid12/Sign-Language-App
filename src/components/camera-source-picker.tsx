import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CameraSource } from '@/services/camera-source';

type Props = {
  source: CameraSource;
  onSourceChange: (source: CameraSource) => void;
  streamUrl: string;
  onStreamUrlChange: (url: string) => void;
};

export function CameraSourcePicker({ source, onSourceChange, streamUrl, onStreamUrlChange }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Camera source</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: source === 'mobile' }}
          onPress={() => onSourceChange('mobile')}
          style={[styles.option, source === 'mobile' && styles.selected]}
        >
          <Text style={[styles.optionText, source === 'mobile' && styles.selectedText]}>Mobile camera</Text>
        </Pressable>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: source === 'pi' }}
          onPress={() => onSourceChange('pi')}
          style={[styles.option, source === 'pi' && styles.selected]}
        >
          <Text style={[styles.optionText, source === 'pi' && styles.selectedText]}>Raspberry Pi</Text>
        </Pressable>
      </View>
      {source === 'pi' ? (
        <>
          <TextInput
            accessibilityLabel="Secure Raspberry Pi camera stream URL"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={onStreamUrlChange}
            placeholder="https://…/stream.mjpg"
            placeholderTextColor="#89968D"
            value={streamUrl}
            style={styles.urlInput}
          />
          <Text style={styles.hint}>Paste the secure HTTPS stream address from the Raspberry Pi.</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  label: { color: '#29483B', fontSize: 13, fontWeight: '700', marginBottom: 7 },
  row: { flexDirection: 'row', gap: 8, backgroundColor: '#E9E6D9', borderRadius: 15, padding: 4 },
  option: { flex: 1, alignItems: 'center', borderRadius: 12, paddingVertical: 10 },
  selected: { backgroundColor: '#0B684F' },
  optionText: { color: '#526159', fontWeight: '700', fontSize: 13 },
  selectedText: { color: '#FFFFFF' },
  urlInput: { marginTop: 9, borderWidth: 1, borderColor: '#D8DDCF', borderRadius: 12, backgroundColor: '#FFFFFF', color: '#132922', paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  hint: { color: '#69776F', fontSize: 11, lineHeight: 16, marginTop: 5 },
});
