import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createSignRecognizer } from '@/services/sign-recognition';
import type { SignRecognizer } from '@/services/sign-recognition.types';

type RecognitionMode = 'words' | 'numbers';
type VoiceLanguage = 'en' | 'ar';

const arabicWords: Record<string, string> = {
  Bye: 'مع السلامة', Hello: 'مرحباً', I: 'أنا', No: 'لا', Perfect: 'ممتاز',
  'Thank You': 'شكراً', Yes: 'نعم', help: 'مساعدة', i_love_you: 'أحبك',
  my: 'لي', name: 'اسم', want: 'أريد',
  '0': 'صفر', '1': 'واحد', '2': 'اثنان', '3': 'ثلاثة', '4': 'أربعة',
};

function getVoiceText(sign: string, language: VoiceLanguage) {
  return language === 'ar' ? (arabicWords[sign] ?? sign) : sign.replaceAll('_', ' ');
}

function speakSign(sign: string, language: VoiceLanguage, onStart?: () => void, onError?: (error: string) => void) {
  const speech = window.speechSynthesis;
  if (!speech) throw new Error('Text-to-speech is not available in this browser.');
  const utterance = new SpeechSynthesisUtterance(getVoiceText(sign, language));
  // Let iOS select its own installed voice and manage its audio session. Explicitly
  // assigning a voice or changing the session can leave Safari speech silent on iPhone.
  utterance.lang = language === 'ar' ? 'ar-EG' : 'en-US';
  utterance.volume = 1;
  utterance.rate = 0.9;
  utterance.onstart = onStart ?? null;
  utterance.onerror = (event) => onError?.(event.error);
  // Keep the first utterance started by the user's tap alive. iOS Safari can block
  // the automatic sign utterance if it cancels that user-initiated speech session.
  speech.speak(utterance);
}

type RecognitionResponse = {
  hand_count: number;
  sign: string;
  confidence: number;
  mode: RecognitionMode;
  error?: string;
};

const expoHost = Constants.expoConfig?.hostUri?.split(':')[0];
const DEFAULT_SERVER_URL =
  process.env.EXPO_PUBLIC_MEDIAPIPE_URL ??
  (expoHost ? `http://${expoHost}:5001` : 'http://localhost:5001');
export default function SignToSpeechScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const cameraRef = useRef<CameraView>(null);
  const cameraFrameRef = useRef<HTMLElement | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const requestInFlight = useRef(false);
  const retryAfter = useRef(0);
  const permissionRequestStarted = useRef(false);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [cameraReady, setCameraReady] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [recognitionReady, setRecognitionReady] = useState(false);
  const [mode, setMode] = useState<RecognitionMode>('words');
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>('en');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Tap Enable voice to hear signs.');
  const modeRef = useRef<RecognitionMode>('words');
  const spokenSign = useRef<string | null>(null);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const [handCount, setHandCount] = useState<number | null>(null);
  const [prediction, setPrediction] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [error, setError] = useState('');

  const speakFromTap = (language: VoiceLanguage) => {
    const sample = handCount && prediction
      ? prediction
      : language === 'ar' ? 'الصوت يعمل الآن' : 'Voice is ready';
    try {
      speakSign(sample, language,
        () => setVoiceStatus('Voice is working.'),
        (reason) => setError(`Voice playback failed (${reason}). Check that your phone has a ${language === 'ar' ? 'Arabic' : 'English'} speech voice installed.`),
      );
      if (handCount && prediction) spokenSign.current = `${language}:${prediction}`;
      setVoiceEnabled(true);
      setVoiceStatus('Voice enabled. Hold a sign in view.');
      setError('');
    } catch (speechError) {
      setError(speechError instanceof Error ? speechError.message : 'Could not enable voice output.');
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || !voiceEnabled || !recognitionReady || handCount === 0 || !prediction) return;
    const timer = window.setTimeout(() => {
      if (spokenSign.current === `${voiceLanguage}:${prediction}`) return;
      try {
        const text = getVoiceText(prediction, voiceLanguage);
        speakSign(prediction, voiceLanguage,
          () => setVoiceStatus(`Speaking: ${text}`),
          (reason) => setError(`Voice playback failed (${reason}). Check that your phone has a ${voiceLanguage === 'ar' ? 'Arabic' : 'English'} speech voice installed.`),
        );
      } catch (speechError) {
        setError(speechError instanceof Error ? speechError.message : 'Could not speak the recognized sign.');
      }
      spokenSign.current = `${voiceLanguage}:${prediction}`;
    }, 600);
    return () => window.clearTimeout(timer);
  }, [handCount, prediction, recognitionReady, voiceEnabled, voiceLanguage]);

  useEffect(() => () => {
    if (Platform.OS === 'web') window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (!permission || permission.granted || permissionRequestStarted.current) return;
    permissionRequestStarted.current = true;
    void requestPermission().then((result) => {
      if (!result.granted) setError('Camera access is needed to recognize signs.');
    }).catch(() => {
      setError('Could not request camera access. Check the app permissions in your phone settings.');
    });
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!isFocused || !cameraReady || !isDetecting) return;

    let mounted = true;
    if (Platform.OS === 'web') {
      let timer: ReturnType<typeof setInterval> | undefined;
      let recognizer: SignRecognizer | null = null;
      const optimizedVideos = new WeakSet<HTMLVideoElement>();

      const detectLocally = () => {
        const activeRecognizer = recognizer;
        if (requestInFlight.current || !activeRecognizer) return;
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

        requestInFlight.current = true;
        try {
          const result = activeRecognizer.predict(video, modeRef.current);
          if (mounted) {
            setHandCount(result.hand_count);
            setPrediction(result.sign);
            setConfidence(result.confidence);
            setError('');
          }
        } catch (detectionError) {
          if (mounted) {
            setError(detectionError instanceof Error ? detectionError.message : 'On-device sign recognition failed.');
            setIsDetecting(false);
          }
        } finally {
          requestInFlight.current = false;
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
          setError('');
          setRecognitionReady(true);
          timer = setInterval(detectLocally, 300);
          detectLocally();
        } catch (recognizerError) {
          if (mounted) {
            setRecognitionReady(false);
            setError(recognizerError instanceof Error ? recognizerError.message : 'Could not load MediaPipe on this device.');
            setIsDetecting(false);
          }
        }
      };

      void loadRecognizer();
      return () => {
        mounted = false;
        if (timer) clearInterval(timer);
        recognizer?.close();
        requestInFlight.current = false;
      };
    }

    const detectHand = async () => {
      if (requestInFlight.current || !cameraRef.current) return;
      requestInFlight.current = true;

      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.4,
          base64: true,
          shutterSound: false,
        });
        if (!photo?.base64) throw new Error('Could not read a camera frame.');

        const response = await fetch(`${serverUrl.replace(/\/$/, '')}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: photo.base64, mode: modeRef.current }),
        });
        const result = (await response.json()) as RecognitionResponse;
        if (!response.ok) throw new Error(result.error ?? 'Sign recognition request failed.');

        if (mounted) {
          setHandCount(result.hand_count);
          setPrediction(result.sign);
          setConfidence(result.confidence);
          setError('');
          retryAfter.current = 0;
        }
      } catch (detectionError) {
        const message = detectionError instanceof Error ? detectionError.message : '';
        if (mounted) {
          setError(
            /fetch failed|network request failed|failed to fetch/i.test(message)
              ? `Cannot reach ${serverUrl}. Start mediapipe_server.py on your computer and make sure your phone and computer are on the same Wi-Fi.`
              : message || 'Could not connect to the MediaPipe server.',
          );
          setIsDetecting(false);
        }
      } finally {
        requestInFlight.current = false;
      }
    };

    const timer = setInterval(() => {
      if (Date.now() >= retryAfter.current) void detectHand();
    }, 300);
    void detectHand();
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [cameraReady, isDetecting, isFocused, serverUrl]);

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Sign to Speech</Text>
        <View style={styles.headerSpacer} />
        <View style={styles.modePill}>
          <Text style={styles.modePillText}>{mode === 'words' ? 'Words' : 'Numbers'}</Text>
          <Text style={styles.modePillArrow}>⌄</Text>
        </View>
      </View>

      <Text style={styles.description}>
        Show a sign to the camera. Recognition starts automatically.
      </Text>

      {permission?.granted && isFocused ? (
        <View ref={(instance) => { cameraFrameRef.current = instance as unknown as HTMLElement | null; }} style={styles.cameraFrame}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="front"
            mirror
            onCameraReady={() => {
              setCameraReady(true);
              setIsDetecting(true);
              setError('');
            }}
            onMountError={({ message }) => {
              setCameraReady(false);
              setIsDetecting(false);
              setError(message);
            }}
          />
          <View pointerEvents="none" style={styles.cameraCorners}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
          <View style={styles.cameraStatus}>
            {isDetecting ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
            <Text style={styles.cameraStatusText}>
              {isDetecting ? (recognitionReady ? 'Looking for a hand…' : 'Loading sign recognition…') : 'Center your hand in the frame'}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.cameraPlaceholder}>
          <View style={styles.placeholderIconCircle}><Text style={styles.placeholderIcon}>▣</Text></View>
          <Text style={styles.cameraTitle}>{permission ? 'Camera access needed' : 'Opening camera…'}</Text>
          <Text style={styles.cameraDescription}>
            Allow camera access so SignBridge can recognize signs and numbers.
          </Text>
          {!permission?.granted ? (
            <Pressable
              style={styles.allowButton}
              onPress={() => void requestPermission()}
            >
              <Text style={styles.buttonText}>Allow camera</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={styles.resultCard}>
        <View style={styles.resultTopline}>
          <View style={styles.resultStatusIcon}>
            <Text style={styles.resultCheck}>{prediction ? '✓' : '·'}</Text>
          </View>
          <Text style={styles.resultLabel}>
            {prediction ? 'Recognized Sign' : mode === 'words' ? 'Word Recognition' : 'Number Recognition'}
          </Text>
          {isDetecting ? <ActivityIndicator color="#0A7656" size="small" /> : null}
        </View>
        <Text style={styles.resultText}>
          {prediction ?? (isDetecting ? (recognitionReady ? 'Waiting for a hand…' : 'Loading sign recognition…') : 'Opening camera…')}
        </Text>
        {handCount !== null && handCount > 0 ? (
          <Text style={styles.confidence}>
            {handCount} {handCount === 1 ? 'hand' : 'hands'} detected
            {confidence !== null ? ` · Confidence: ${confidence}%` : ''}
          </Text>
        ) : (
          <Text style={styles.confidence}>Show a clear sign inside the camera frame</Text>
        )}
      </View>

      <Text style={styles.sectionLabel}>Recognition mode</Text>
      <View style={styles.modeToggle}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'words' }}
          style={[styles.modeButton, mode === 'words' && styles.modeButtonActive]}
          onPress={() => {
            setMode('words');
            setPrediction(null);
            setConfidence(null);
          }}
        >
          <Text style={[styles.modeButtonText, mode === 'words' && styles.modeButtonTextActive]}>
            Words
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'numbers' }}
          style={[styles.modeButton, mode === 'numbers' && styles.modeButtonActive]}
          onPress={() => {
            setMode('numbers');
            setPrediction(null);
            setConfidence(null);
          }}
        >
          <Text style={[styles.modeButtonText, mode === 'numbers' && styles.modeButtonTextActive]}>
            Numbers
          </Text>
        </Pressable>
      </View>

      {Platform.OS === 'web' ? (
        <>
          <View style={styles.voiceHeading}>
            <Text style={styles.sectionLabel}>Voice language</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: voiceEnabled }}
              style={[styles.voiceButton, voiceEnabled && styles.voiceButtonActive]}
              onPress={() => {
                if (voiceEnabled) {
                  window.speechSynthesis?.cancel();
                  setVoiceEnabled(false);
                  return;
                }
                speakFromTap(voiceLanguage);
              }}
            >
              <Text style={styles.voiceButtonText}>{voiceEnabled ? '🔊 Voice on' : '🔈 Enable voice'}</Text>
            </Pressable>
          </View>
          <Text style={styles.voiceStatus}>{voiceStatus}</Text>
          <View style={styles.modeToggle}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: voiceLanguage === 'en' }}
              style={[styles.modeButton, voiceLanguage === 'en' && styles.modeButtonActive]}
              onPress={() => {
                setVoiceLanguage('en');
                if (voiceEnabled) speakFromTap('en');
              }}
            >
              <Text style={[styles.modeButtonText, voiceLanguage === 'en' && styles.modeButtonTextActive]}>English</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: voiceLanguage === 'ar' }}
              style={[styles.modeButton, voiceLanguage === 'ar' && styles.modeButtonActive]}
              onPress={() => {
                setVoiceLanguage('ar');
                if (voiceEnabled) speakFromTap('ar');
              }}
            >
              <Text style={[styles.modeButtonText, voiceLanguage === 'ar' && styles.modeButtonTextActive]}>العربية</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <View style={styles.connectionCard}>
        <Text style={styles.sectionLabel}>{Platform.OS === 'web' ? 'MediaPipe model' : 'MediaPipe server URL'}</Text>
        {Platform.OS === 'web' ? (
          <TextInput
            editable={false}
            style={styles.serverInput}
            value="Runs on this device"
          />
        ) : (
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setServerUrl}
            placeholder="http://192.168.1.12:5001"
            placeholderTextColor="#87958C"
            style={styles.serverInput}
            value={serverUrl}
          />
        )}
        <Text style={styles.helperText}>
          {Platform.OS === 'web'
            ? 'Signs are recognized on your phone. No server or Wi-Fi setup is needed.'
            : 'Use your computer’s Wi-Fi address. Keep both devices on the same Wi-Fi.'}
        </Text>
      </View>

      {error && permission?.granted ? (
        <Pressable
          style={styles.retryButton}
          onPress={() => {
            retryAfter.current = 0;
            setError('');
            setHandCount(null);
            setPrediction(null);
            setConfidence(null);
            setIsDetecting(true);
          }}
        >
          <Text style={styles.retryButtonText}>{Platform.OS === 'web' ? 'Retry recognition' : 'Retry connection'}</Text>
        </Pressable>
      ) : null}

      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#FBF8EF', paddingHorizontal: 20, paddingTop: 58, paddingBottom: 36 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: '#064B3B', borderRadius: 18, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 14 },
  backButton: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center' },
  backIcon: { color: '#FFFFFF', fontSize: 32, lineHeight: 34, fontWeight: '300' },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginLeft: 5 },
  headerSpacer: { flex: 1 },
  modePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F8F68', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  modePillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  modePillArrow: { color: '#FFFFFF', fontSize: 15, marginLeft: 7, marginTop: -3 },
  description: { color: '#56665D', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  cameraFrame: { backgroundColor: '#5A625D', borderRadius: 26, height: 320, overflow: 'hidden', marginBottom: 14 },
  cameraCorners: { position: 'absolute', top: 18, left: 18, right: 18, bottom: 18 },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: '#FFFFFF', opacity: 0.95 },
  cornerTopLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  cornerTopRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  cornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  cornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  cameraStatus: { position: 'absolute', bottom: 14, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5, 55, 43, 0.78)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  cameraStatusText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  cameraPlaceholder: { height: 320, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7F0E2', borderRadius: 26, padding: 24, marginBottom: 14 },
  placeholderIconCircle: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D1E9D0', marginBottom: 12 },
  placeholderIcon: { color: '#064B3B', fontSize: 32 },
  cameraTitle: { color: '#132922', fontSize: 17, fontWeight: '700', marginBottom: 6 },
  cameraDescription: { color: '#69776F', textAlign: 'center', lineHeight: 20, marginBottom: 14 },
  allowButton: { backgroundColor: '#064B3B', borderRadius: 24, paddingHorizontal: 22, paddingVertical: 11 },
  resultCard: { backgroundColor: '#E5F0E1', borderRadius: 24, padding: 18, marginBottom: 16 },
  resultTopline: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  resultStatusIcon: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#16A36C', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  resultCheck: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  resultLabel: { color: '#28483A', fontSize: 13, fontWeight: '700', flex: 1 },
  resultText: { color: '#132922', fontSize: 27, lineHeight: 34, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  confidence: { color: '#4D6357', fontSize: 13, textAlign: 'center', marginTop: 3 },
  sectionLabel: { color: '#29483B', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  modeToggle: { flexDirection: 'row', backgroundColor: '#E9E6D9', borderRadius: 15, padding: 4, marginBottom: 14 },
  voiceHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  voiceButton: { backgroundColor: '#E9E6D9', borderRadius: 13, paddingHorizontal: 13, paddingVertical: 8 },
  voiceButtonActive: { backgroundColor: '#D4EBDD' },
  voiceButtonText: { color: '#0B684F', fontSize: 12, fontWeight: '700' },
  voiceStatus: { color: '#69776F', fontSize: 12, lineHeight: 18, marginTop: -3, marginBottom: 9 },
  modeButton: { flex: 1, alignItems: 'center', borderRadius: 12, paddingVertical: 11 },
  modeButtonActive: { backgroundColor: '#0B684F' },
  modeButtonText: { color: '#526159', fontWeight: '700', fontSize: 14 },
  modeButtonTextActive: { color: '#FFFFFF' },
  actionButton: { backgroundColor: '#064B3B', borderRadius: 28, padding: 16, alignItems: 'center', marginBottom: 16 },
  stopButton: { backgroundColor: '#79524A' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  connectionCard: { backgroundColor: '#FFFDF8', borderColor: '#ECE8DA', borderWidth: 1, borderRadius: 18, padding: 14 },
  serverInput: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E2D8', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#132922', fontSize: 14 },
  helperText: { color: '#78847C', fontSize: 11, lineHeight: 16, marginTop: 6 },
  retryButton: { alignSelf: 'center', backgroundColor: '#064B3B', borderRadius: 22, paddingHorizontal: 20, paddingVertical: 11, marginTop: 14 },
  retryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  error: { color: '#B42318', fontSize: 13, lineHeight: 19, marginTop: 12 },
});
