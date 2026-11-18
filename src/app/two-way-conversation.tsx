import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { requestRecordingPermissionsAsync, useAudioStream } from 'expo-audio';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createSignRecognizer } from '@/services/sign-recognition';
import type { SignRecognizer } from '@/services/sign-recognition.types';
import { startBrowserSpeechRecognition } from '@/services/browser-speech-recognition';
import type { BrowserSpeechSession } from '@/services/browser-speech-recognition.types';

type RecognitionMode = 'words' | 'numbers';
type SpeechLanguage = 'en' | 'ar';
type SignResponse = { hand_count: number; sign: string; confidence: number; error?: string };
type SpeechMessage = { type: 'ready' | 'partial' | 'final' | 'finished' | 'error'; text?: string; message?: string; language?: SpeechLanguage };

const expoHost = Constants.expoConfig?.hostUri?.split(':')[0];
const CAMERA_SERVER = process.env.EXPO_PUBLIC_MEDIAPIPE_URL ?? (expoHost ? `http://${expoHost}:5001` : 'http://localhost:5001');
const SPEECH_SERVER = process.env.EXPO_PUBLIC_SPEECH_WS_URL ?? (expoHost ? `ws://${expoHost}:8765` : 'ws://localhost:8765');

export default function TwoWayConversationScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const cameraRef = useRef<CameraView>(null);
  const cameraFrameRef = useRef<HTMLElement | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const browserSpeechSession = useRef<BrowserSpeechSession | null>(null);
  const inFlight = useRef(false);
  const cameraPermissionRequestStarted = useRef(false);
  const streaming = useRef(false);
  const audioActive = useRef(false);
  const streamConfigured = useRef(false);
  const finalTranscript = useRef('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [signRecognitionReady, setSignRecognitionReady] = useState(false);
  const [mode, setMode] = useState<RecognitionMode>('words');
  const modeRef = useRef<RecognitionMode>('words');
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const [language, setLanguage] = useState<SpeechLanguage>('en');
  const [conversationActive, setConversationActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [listening, setListening] = useState(false);
  const [sign, setSign] = useState('Waiting for a sign…');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [transcript, setTranscript] = useState('');
  const [speechStatus, setSpeechStatus] = useState('Start a conversation to use the microphone.');
  const [signError, setSignError] = useState('');

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
    try { stream.stop(); } catch (error) { console.warn('Microphone already stopped:', error); }
  }, [stream]);

  const stopConversation = useCallback(async (waitForFinal = true, updateUI = true) => {
    streaming.current = false;
    setConversationActive(false);
    stopMicrophone();
    if (browserSpeechSession.current) {
      browserSpeechSession.current.stop();
      browserSpeechSession.current = null;
      if (updateUI) {
        setStarting(false);
        setListening(false);
        setSpeechStatus('Conversation ended. Start again when ready.');
      }
      return;
    }
    const connection = socket.current;
    if (connection?.readyState === WebSocket.OPEN) {
      if (waitForFinal) {
        const finish = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 900);
          connection.addEventListener('message', function onFinish(event) {
            try {
              if ((JSON.parse(String(event.data)) as SpeechMessage).type === 'finished') {
                clearTimeout(timer);
                connection.removeEventListener('message', onFinish);
                resolve();
              }
            } catch { /* Ignore non-JSON socket messages while stopping. */ }
          });
        });
        connection.send(JSON.stringify({ type: 'stop' }));
        await finish;
      } else {
        connection.send(JSON.stringify({ type: 'stop' }));
      }
    }
    connection?.close();
    if (socket.current === connection) socket.current = null;
    if (updateUI) {
      setStarting(false);
      setListening(false);
      setSpeechStatus('Conversation ended. Start again when ready.');
    }
  }, [stopMicrophone]);

  useFocusEffect(useCallback(() => () => { void stopConversation(false, false); }, [stopConversation]));

  useEffect(() => {
    if (!focused || !cameraPermission || cameraPermission.granted || cameraPermissionRequestStarted.current) return;
    cameraPermissionRequestStarted.current = true;
    void requestCameraPermission();
  }, [cameraPermission, focused, requestCameraPermission]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !focused || !cameraPermission?.granted || !cameraReady) return;
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let recognizer: SignRecognizer | null = null;
    const optimizedVideos = new WeakSet<HTMLVideoElement>();

    const detectLocally = () => {
      const activeRecognizer = recognizer;
      if (inFlight.current || !activeRecognizer) return;
      const cameraElement = cameraFrameRef.current;
      const video = cameraElement?.querySelector('video');
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (!optimizedVideos.has(video)) {
        optimizedVideos.add(video);
        const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
        void track?.applyConstraints({
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { max: 20 },
        }).catch(() => undefined);
      }

      inFlight.current = true;
      try {
        const result = activeRecognizer.predict(video, modeRef.current);
        if (mounted) {
          setSign(result.hand_count > 0 ? result.sign : 'Show a sign to the camera');
          setConfidence(result.confidence ?? null);
          setSignError('');
        }
      } catch (error) {
        if (mounted) setSignError(error instanceof Error ? error.message : 'On-device sign recognition failed.');
      } finally {
        inFlight.current = false;
      }
    };

    const loadRecognizer = async () => {
      try {
        recognizer = await createSignRecognizer();
        if (!mounted) {
          recognizer.close();
          recognizer = null;
          return;
        }
        setSignRecognitionReady(true);
        timer = setInterval(detectLocally, 300);
        detectLocally();
      } catch (error) {
        if (mounted) {
          setSignRecognitionReady(false);
          setSignError(error instanceof Error ? error.message : 'Could not load MediaPipe on this device.');
        }
      }
    };

    void loadRecognizer();
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
      recognizer?.close();
      inFlight.current = false;
    };
  }, [cameraPermission?.granted, cameraReady, focused]);

  useEffect(() => {
    if (Platform.OS === 'web' || !focused || !conversationActive || !cameraPermission?.granted || !cameraReady) return;
    let mounted = true;
    const detect = async () => {
      if (inFlight.current || !cameraRef.current) return;
      inFlight.current = true;
      try {
        const frame = await cameraRef.current.takePictureAsync({ quality: 0.4, base64: true, shutterSound: false });
        if (!frame?.base64) throw new Error('Could not read a camera frame.');
        const response = await fetch(`${CAMERA_SERVER.replace(/\/$/, '')}/predict`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: frame.base64, mode: modeRef.current }),
        });
        const result = await response.json() as SignResponse;
        if (!response.ok) throw new Error(result.error ?? 'Sign recognition request failed.');
        if (mounted) {
          setSign(result.hand_count > 0 ? result.sign : 'Show a sign to the camera');
          setConfidence(result.confidence ?? null);
          setSignError('');
        }
      } catch (error) {
        if (mounted) setSignError(error instanceof Error ? error.message : `Cannot reach ${CAMERA_SERVER}.`);
      } finally { inFlight.current = false; }
    };
    const timer = setInterval(() => { void detect(); }, 350);
    void detect();
    return () => { mounted = false; clearInterval(timer); };
  }, [cameraPermission?.granted, cameraReady, conversationActive, focused]);

  const startConversation = async () => {
    if (starting || conversationActive) return;
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) { Alert.alert('Camera access needed', 'Allow camera access to recognize signs.'); return; }
    }
    setStarting(true);
    setTranscript('');
    finalTranscript.current = '';
    streamConfigured.current = false;
    if (Platform.OS === 'web') {
      try {
        browserSpeechSession.current = startBrowserSpeechRecognition(language, {
          onStart: () => {
            if (!focused) return;
            setConversationActive(true);
            setListening(true);
            setStarting(false);
            setSpeechStatus(`Listening in ${language === 'ar' ? 'Arabic' : 'English'}…`);
          },
          onResult: (text, isFinal) => {
            if (!focused) return;
            if (isFinal) {
              finalTranscript.current = [finalTranscript.current, text].filter(Boolean).join(' ');
              setTranscript(finalTranscript.current);
            } else {
              setTranscript([finalTranscript.current, text].filter(Boolean).join(' '));
            }
          },
          onError: (message) => {
            browserSpeechSession.current = null;
            if (!focused) return;
            setConversationActive(false);
            setStarting(false);
            setListening(false);
            setSpeechStatus(message);
          },
          onEnd: () => {
            browserSpeechSession.current = null;
            if (!focused) return;
            setConversationActive(false);
            setStarting(false);
            setListening(false);
            setSpeechStatus('Conversation ended. Start again when ready.');
          },
        });
      } catch (error) {
        setStarting(false);
        setSpeechStatus(error instanceof Error ? error.message : 'Could not start browser speech recognition.');
      }
      return;
    }
    setSpeechStatus('Requesting microphone access…');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setStarting(false);
        setSpeechStatus('Microphone permission is needed to transcribe speech.');
        Alert.alert('Microphone access needed', 'Allow SignBridge to use the microphone in your phone settings.');
        return;
      }
      const connection = new WebSocket(SPEECH_SERVER);
      connection.binaryType = 'arraybuffer';
      socket.current = connection;
      connection.onmessage = (event) => {
        let message: SpeechMessage;
        try { message = JSON.parse(String(event.data)) as SpeechMessage; } catch { return; }
        if (message.type === 'ready') {
          setSpeechStatus(message.language === 'ar' ? 'Listening in Arabic…' : 'Listening in English…');
        } else if (message.type === 'partial') {
          setTranscript([finalTranscript.current, message.text].filter(Boolean).join(' '));
        } else if (message.type === 'final') {
          finalTranscript.current = [finalTranscript.current, message.text].filter(Boolean).join(' ');
          setTranscript(finalTranscript.current);
        } else if (message.type === 'finished') {
          finalTranscript.current = [finalTranscript.current, message.text].filter(Boolean).join(' ');
          setTranscript(finalTranscript.current);
        } else if (message.type === 'error') {
          streaming.current = false;
          stopMicrophone();
          setConversationActive(false);
          setStarting(false);
          setListening(false);
          setSpeechStatus(message.message || 'Speech recognition stopped.');
        }
      };
      connection.onerror = () => {
        streaming.current = false;
        stopMicrophone();
        setConversationActive(false);
        setStarting(false);
        setListening(false);
        setSpeechStatus(`Cannot reach ${SPEECH_SERVER}. Start speech_server.py on your computer.`);
      };
      connection.onclose = () => {
        streaming.current = false;
        stopMicrophone();
        if (socket.current === connection) socket.current = null;
        setStarting(false);
        setListening(false);
      };
      connection.onopen = async () => {
        try {
          await stream.start();
          audioActive.current = true;
          streaming.current = true;
          setConversationActive(true);
          setListening(true);
          setStarting(false);
          setSpeechStatus(`Connecting to ${language === 'ar' ? 'Arabic' : 'English'} recognition…`);
        } catch (error) {
          setStarting(false);
          setSpeechStatus(error instanceof Error ? error.message : 'Could not start the microphone.');
          connection.close();
          socket.current = null;
        }
      };
    } catch (error) {
      setStarting(false);
      setSpeechStatus(error instanceof Error ? error.message : 'Could not start the conversation.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => { void stopConversation(false); router.back(); }} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Two-Way Conversation</Text>
      </View>
      <Text style={styles.description}>Sign and speak naturally. Both results appear here as text.</Text>

      <View ref={(instance) => { cameraFrameRef.current = instance as unknown as HTMLElement | null; }} style={styles.cameraFrame}>
        {cameraPermission?.granted && focused ? (
          <CameraView
            ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" mirror
            onCameraReady={() => setCameraReady(true)}
            onMountError={({ message }) => { setCameraReady(false); setSignError(message); }}
          />
        ) : <View style={styles.cameraPlaceholder}><Text style={styles.cameraPlaceholderText}>Allow camera access to recognize signs</Text></View>}
        <View style={styles.cameraStatus}><Text style={styles.cameraStatusText}>{Platform.OS === 'web' || conversationActive ? 'Sign recognition is running' : 'Camera ready for the conversation'}</Text></View>
      </View>

      <View style={styles.resultCard}>
        <Text style={styles.sectionTitle}>Sign from the deaf person</Text>
        <Text style={styles.resultText}>
          {Platform.OS === 'web' && cameraReady && !signRecognitionReady ? 'Loading sign recognition…' : sign}
        </Text>
        {confidence !== null ? <Text style={styles.confidence}>Confidence: {confidence}%</Text> : null}
        {signError ? <Text style={styles.error}>{signError}</Text> : null}
      </View>

      <View style={styles.resultCard}>
        <Text style={styles.sectionTitle}>Speech from the hearing person</Text>
        <Text style={[styles.transcript, language === 'ar' && styles.arabic]}>{transcript || (language === 'ar' ? 'سيظهر الكلام هنا أثناء التحدث.' : 'Spoken words will appear here as they are recognized.')}</Text>
        <Text style={styles.status}>{speechStatus}</Text>
      </View>

      <Text style={styles.sectionTitle}>Speech language</Text>
      <View style={styles.languageRow}>
        <Pressable disabled={conversationActive || starting} onPress={() => setLanguage('en')} style={[styles.languageButton, language === 'en' && styles.languageSelected]}><Text style={[styles.languageText, language === 'en' && styles.languageTextSelected]}>English</Text></Pressable>
        <Pressable disabled={conversationActive || starting} onPress={() => setLanguage('ar')} style={[styles.languageButton, language === 'ar' && styles.languageSelected]}><Text style={[styles.languageText, language === 'ar' && styles.languageTextSelected]}>العربية</Text></Pressable>
      </View>

      <Text style={styles.sectionTitle}>Sign recognition</Text>
      <View style={styles.languageRow}>
        <Pressable onPress={() => setMode('words')} style={[styles.languageButton, mode === 'words' && styles.languageSelected]}><Text style={[styles.languageText, mode === 'words' && styles.languageTextSelected]}>Words</Text></Pressable>
        <Pressable onPress={() => setMode('numbers')} style={[styles.languageButton, mode === 'numbers' && styles.languageSelected]}><Text style={[styles.languageText, mode === 'numbers' && styles.languageTextSelected]}>Numbers</Text></Pressable>
      </View>

      <Pressable disabled={starting} onPress={() => conversationActive ? void stopConversation() : void startConversation()} style={[styles.actionButton, conversationActive && styles.stopButton, starting && styles.disabled]}>
        {starting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.actionText}>{conversationActive ? 'End Conversation' : 'Start Conversation'}</Text>}
      </Pressable>
      <Text style={styles.helper}>Start both together, then the deaf person signs while the hearing person speaks. SignBridge shows both as text.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#FBF8EF', paddingHorizontal: 20, paddingTop: 54, paddingBottom: 36 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: '#064B3B', borderRadius: 18, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 14 },
  backButton: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center' },
  backIcon: { color: '#FFFFFF', fontSize: 32, lineHeight: 34, fontWeight: '300' },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginLeft: 5 },
  description: { color: '#56665D', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  cameraFrame: { height: 260, backgroundColor: '#5A625D', borderRadius: 26, overflow: 'hidden', marginBottom: 14, alignItems: 'center', justifyContent: 'center' },
  cameraPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  cameraPlaceholderText: { color: '#FFFFFF', textAlign: 'center' },
  cameraStatus: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: 'rgba(5,55,43,0.78)', borderRadius: 20, padding: 9 },
  cameraStatusText: { color: '#FFFFFF', textAlign: 'center', fontSize: 12, fontWeight: '600' },
  resultCard: { backgroundColor: '#E5F0E1', borderRadius: 22, padding: 17, marginBottom: 13 },
  sectionTitle: { color: '#29483B', fontSize: 14, fontWeight: '700', marginBottom: 9 },
  resultText: { color: '#132922', fontSize: 27, fontWeight: '800', textAlign: 'center' },
  transcript: { color: '#132922', fontSize: 20, lineHeight: 29, minHeight: 48 },
  arabic: { textAlign: 'right', writingDirection: 'rtl' },
  confidence: { color: '#4D6357', fontSize: 12, textAlign: 'center', marginTop: 5 },
  status: { color: '#64746B', fontSize: 12, marginTop: 8 },
  error: { color: '#B42318', fontSize: 12, marginTop: 8 },
  languageRow: { flexDirection: 'row', gap: 10, backgroundColor: '#E9E6D9', borderRadius: 15, padding: 4, marginBottom: 14 },
  languageButton: { flex: 1, alignItems: 'center', borderRadius: 12, paddingVertical: 11 },
  languageSelected: { backgroundColor: '#0B684F' },
  languageText: { color: '#526159', fontWeight: '700', fontSize: 14 },
  languageTextSelected: { color: '#FFFFFF' },
  actionButton: { backgroundColor: '#064B3B', borderRadius: 28, padding: 16, alignItems: 'center', marginTop: 5 },
  stopButton: { backgroundColor: '#79524A' },
  disabled: { opacity: 0.65 },
  actionText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  helper: { color: '#69776F', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
});
