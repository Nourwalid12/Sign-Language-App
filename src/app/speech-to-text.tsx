import Constants from 'expo-constants';
import { requestRecordingPermissionsAsync, useAudioStream } from 'expo-audio';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type SpeechServerMessage = {
  type: 'ready' | 'partial' | 'final' | 'finished' | 'error';
  text?: string;
  message?: string;
  language?: SpeechLanguage;
};

type SpeechLanguage = 'en' | 'ar';

const expoHost = Constants.expoConfig?.hostUri?.split(':')[0];
const SPEECH_SERVER_URL =
  process.env.EXPO_PUBLIC_SPEECH_WS_URL ??
  (expoHost ? `ws://${expoHost}:8765` : 'ws://localhost:8765');

export default function SpeechToTextScreen() {
  const router = useRouter();
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [language, setLanguage] = useState<SpeechLanguage>('en');
  const [status, setStatus] = useState('Tap the microphone to begin.');
  const socket = useRef<WebSocket | null>(null);
  const streaming = useRef(false);
  const stopRequested = useRef(false);
  const streamConfigured = useRef(false);
  const finalTranscript = useRef('');
  const finishWaiter = useRef<(() => void) | null>(null);
  const focused = useRef(false);
  const audioActive = useRef(false);

  const { stream } = useAudioStream({
    channels: 1,
    encoding: 'int16',
    sampleRate: 16000,
    onBuffer: (buffer) => {
      const connection = socket.current;
      if (!streaming.current || connection?.readyState !== WebSocket.OPEN) return;

      if (!streamConfigured.current) {
        connection.send(JSON.stringify({ type: 'start', sampleRate: buffer.sampleRate, language }));
        streamConfigured.current = true;
      }
      connection.send(buffer.data);
    },
  });

  const stopMicrophone = useCallback(() => {
    if (!audioActive.current) return;
    audioActive.current = false;
    try {
      stream.stop();
    } catch (error) {
      // Several teardown paths can run as the screen loses focus. Keep stop idempotent.
      console.warn('Microphone stream was already stopped:', error);
    }
  }, [stream]);

  const stopSpeechSession = useCallback(async (waitForFinalResult: boolean, updateUI = true) => {
    stopRequested.current = true;
    streaming.current = false;
    stopMicrophone();

    const connection = socket.current;
    if (connection?.readyState === WebSocket.OPEN) {
      if (waitForFinalResult) {
        const waitForResult = new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 800);
          finishWaiter.current = () => {
            clearTimeout(timeout);
            finishWaiter.current = null;
            resolve();
          };
        });
        connection.send(JSON.stringify({ type: 'stop' }));
        await waitForResult;
      } else {
        connection.send(JSON.stringify({ type: 'stop' }));
      }
    }

    connection?.close();
    if (socket.current === connection) socket.current = null;
    if (updateUI) {
      setIsListening(false);
      setIsStarting(false);
      setStatus('Tap the microphone to speak again.');
    }
  }, [stopMicrophone]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      void stopSpeechSession(false, false);
    };
  }, [stopSpeechSession]));

  const handleBack = async () => {
    await stopSpeechSession(true);
    router.back();
  };

  const handleServerMessage = (data: string) => {
    if (!focused.current) return;
    let message: SpeechServerMessage;
    try {
      message = JSON.parse(data) as SpeechServerMessage;
    } catch {
      setStatus('Received an unreadable response from the speech server.');
      return;
    }

    if (message.type === 'partial') {
      setTranscript([finalTranscript.current, message.text].filter(Boolean).join(' '));
    } else if (message.type === 'ready') {
      setStatus(message.language === 'ar' ? 'Listening in Arabic…' : 'Listening in English…');
    } else if (message.type === 'final') {
      finalTranscript.current = [finalTranscript.current, message.text].filter(Boolean).join(' ');
      setTranscript(finalTranscript.current);
    } else if (message.type === 'finished') {
      finalTranscript.current = [finalTranscript.current, message.text].filter(Boolean).join(' ');
      setTranscript(finalTranscript.current);
      streaming.current = false;
      setIsListening(false);
      setIsStarting(false);
      setStatus('Tap the microphone to speak again.');
      finishWaiter.current?.();
      socket.current?.close();
      socket.current = null;
    } else if (message.type === 'error') {
      stopRequested.current = true;
      streaming.current = false;
      stopMicrophone();
      setIsListening(false);
      setIsStarting(false);
      setStatus(message.message || 'Speech recognition stopped.');
      finishWaiter.current?.();
      socket.current?.close();
      socket.current = null;
    }
  };

  const handleMicrophonePress = async () => {
    if (isStarting) return;

    if (isListening) {
      setStatus('Finishing your words…');
      await stopSpeechSession(true);
      return;
    }

    if (socket.current) await stopSpeechSession(false);

    setIsStarting(true);
    setStatus('Requesting microphone access…');
    setTranscript('');
    finalTranscript.current = '';
    streamConfigured.current = false;
    stopRequested.current = false;

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!focused.current) return;
      if (!permission.granted) {
        setIsStarting(false);
        setStatus('Microphone permission is needed to transcribe speech.');
        Alert.alert('Microphone access needed', 'Allow SignBridge to use the microphone in your iPhone settings, then try again.');
        return;
      }

      const connection = new WebSocket(SPEECH_SERVER_URL);
      connection.binaryType = 'arraybuffer';
      socket.current = connection;
      connection.onopen = async () => {
        try {
          await stream.start();
          audioActive.current = true;
          if (!focused.current) {
            stopMicrophone();
            connection.close();
            return;
          }
          streaming.current = true;
          setIsListening(true);
          setIsStarting(false);
          setStatus(`Connecting to ${language === 'ar' ? 'Arabic' : 'English'} recognition…`);
        } catch (error) {
          stopRequested.current = true;
          setIsStarting(false);
          setStatus('Could not start the microphone stream.');
          connection.close();
          socket.current = null;
          Alert.alert('Microphone error', error instanceof Error ? error.message : 'Could not start the microphone.');
        }
      };
      connection.onmessage = (event) => handleServerMessage(String(event.data));
      connection.onerror = () => {
        stopRequested.current = true;
        streaming.current = false;
        stopMicrophone();
        if (focused.current) {
          setIsListening(false);
          setIsStarting(false);
          setStatus(`Cannot reach ${SPEECH_SERVER_URL}. Start the speech server on your computer and use the same Wi-Fi.`);
        }
      };
      connection.onclose = () => {
        streaming.current = false;
        stopMicrophone();
        finishWaiter.current?.();
        if (focused.current) {
          setIsListening(false);
          setIsStarting(false);
          if (!stopRequested.current && socket.current === connection) {
            setStatus('Connection to the speech server closed.');
          }
        }
        if (socket.current === connection) socket.current = null;
      };
      setStatus('Connecting to your computer…');
    } catch (error) {
      setIsStarting(false);
      setStatus(error instanceof Error ? error.message : 'Could not start speech recognition.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => void handleBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Speech to Text</Text>
      </View>

      <Text style={styles.description}>Help the other person follow along with spoken words.</Text>

      <View style={styles.languageRow} accessibilityRole="radiogroup" accessibilityLabel="Recognition language">
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: language === 'en', disabled: isListening || isStarting }}
          disabled={isListening || isStarting}
          onPress={() => setLanguage('en')}
          style={[styles.languageButton, language === 'en' && styles.languageButtonSelected]}
        >
          <Text style={[styles.languageText, language === 'en' && styles.languageTextSelected]}>English</Text>
        </Pressable>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: language === 'ar', disabled: isListening || isStarting }}
          disabled={isListening || isStarting}
          onPress={() => setLanguage('ar')}
          style={[styles.languageButton, language === 'ar' && styles.languageButtonSelected]}
        >
          <Text style={[styles.languageText, language === 'ar' && styles.languageTextSelected]}>العربية</Text>
        </Pressable>
      </View>

      <View style={styles.micStage}>
        <View style={styles.outerHalo} />
        <View style={styles.middleHalo} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isListening ? 'Stop speech recognition' : 'Start speech recognition'}
          accessibilityHint="Tap to stream your speech and show words as they are recognized."
          accessibilityState={{ disabled: isStarting }}
          style={[styles.micCircle, isListening && styles.micCircleActive, isStarting && styles.micCircleDisabled]}
          onPress={() => void handleMicrophonePress()}
        >
          <Text style={styles.micGlyph}>{isStarting ? '…' : '🎙'}</Text>
        </Pressable>
        <Text style={styles.micTitle}>{isListening ? 'Listening…' : isStarting ? 'Connecting…' : 'Tap to speak'}</Text>
        <Text style={styles.micDescription}>Speak clearly and your words will appear below as you speak.</Text>
      </View>

      <View style={styles.resultCard}>
        <View style={styles.resultContent}>
          <View style={[styles.waveform, isListening && styles.waveformActive]} accessibilityElementsHidden>
            {[16, 26, 38, 22, 32, 18, 28, 14].map((height, index) => (
              <View key={index} style={[styles.waveBar, { height }]} />
            ))}
          </View>
          <Text style={[styles.resultText, language === 'ar' && styles.resultTextArabic]}>
            {transcript || (language === 'ar' ? 'ستظهر الكلمات التي تنطق بها هنا.' : 'Your spoken words will appear here.')}
          </Text>
        </View>
        {transcript.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear transcript"
            onPress={() => {
              finalTranscript.current = '';
              setTranscript('');
            }}
            style={styles.clearButton}
          >
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.status}>{status}</Text>
      <Text style={styles.note}>
        Live {language === 'ar' ? 'Arabic' : 'English (US)'} recognition · Computer and iPhone must share Wi-Fi
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#FBF8EF', paddingHorizontal: 22, paddingTop: 58, paddingBottom: 36 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: '#064B3B', borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 16 },
  backButton: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center' },
  backIcon: { color: '#FFFFFF', fontSize: 32, lineHeight: 34, fontWeight: '300' },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginLeft: 5 },
  description: { color: '#56665D', fontSize: 14, lineHeight: 21, marginBottom: 12 },
  languageRow: { flexDirection: 'row', alignSelf: 'center', backgroundColor: '#E9E6DC', borderRadius: 18, padding: 4, marginTop: 4, marginBottom: 6 },
  languageButton: { minWidth: 110, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14 },
  languageButtonSelected: { backgroundColor: '#075342' },
  languageText: { color: '#53665A', fontSize: 14, fontWeight: '600' },
  languageTextSelected: { color: '#FFFFFF' },
  micStage: { flex: 1, minHeight: 430, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  outerHalo: { position: 'absolute', width: 250, height: 250, borderRadius: 125, backgroundColor: '#EEF4E7' },
  middleHalo: { position: 'absolute', width: 190, height: 190, borderRadius: 95, backgroundColor: '#DCECD7' },
  micCircle: { width: 144, height: 144, borderRadius: 72, backgroundColor: '#075342', alignItems: 'center', justifyContent: 'center', shadowColor: '#064B3B', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  micCircleActive: { backgroundColor: '#B94A3A' },
  micCircleDisabled: { opacity: 0.65 },
  micGlyph: { color: '#FFFFFF', fontSize: 49, fontWeight: '700' },
  micTitle: { color: '#193A2D', fontSize: 19, fontWeight: '700', marginTop: 26, marginBottom: 6 },
  micDescription: { color: '#69776F', fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 280 },
  resultCard: { minHeight: 98, flexDirection: 'row', alignItems: 'center', backgroundColor: '#E4F0E0', borderRadius: 22, padding: 18 },
  resultContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  waveform: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 15, opacity: 0.45 },
  waveformActive: { opacity: 1 },
  waveBar: { width: 4, borderRadius: 3, backgroundColor: '#0C8C63' },
  resultText: { flex: 1, color: '#274339', fontSize: 15, fontWeight: '600', lineHeight: 22 },
  resultTextArabic: { writingDirection: 'rtl', textAlign: 'right' },
  clearButton: { marginLeft: 10, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#FFFFFF', borderRadius: 12 },
  clearText: { color: '#0B684F', fontWeight: '700', fontSize: 12 },
  status: { color: '#53665A', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  note: { color: '#7A867D', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 },
});
