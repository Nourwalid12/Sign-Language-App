import type { BrowserSpeechCallbacks, BrowserSpeechLanguage, BrowserSpeechSession } from './browser-speech-recognition.types';

export function startBrowserSpeechRecognition(
  _language: BrowserSpeechLanguage,
  _callbacks: BrowserSpeechCallbacks,
): BrowserSpeechSession {
  throw new Error('Browser speech recognition is only available on the web.');
}
