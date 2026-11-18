import type { BrowserSpeechCallbacks, BrowserSpeechLanguage, BrowserSpeechSession } from './browser-speech-recognition.types';

type RecognitionAlternative = { transcript: string };
type RecognitionResult = ArrayLike<RecognitionAlternative> & { isFinal: boolean };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error: string };

type RecognitionEngine = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionConstructor = new () => RecognitionEngine;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

export function startBrowserSpeechRecognition(
  language: BrowserSpeechLanguage,
  callbacks: BrowserSpeechCallbacks,
): BrowserSpeechSession {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Recognition) {
    throw new Error('Speech recognition is not available in this browser. Try the latest Safari or Chrome.');
  }

  const recognition = new Recognition();
  let failed = false;
  recognition.lang = language === 'ar' ? 'ar-EG' : 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = callbacks.onStart;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0]?.transcript?.trim();
      if (text) callbacks.onResult(text, result.isFinal);
    }
  };
  recognition.onerror = (event) => {
    failed = true;
    const message = event.error === 'not-allowed'
      ? 'Allow microphone access in your browser settings, then try again.'
      : event.error === 'network'
        ? 'This browser could not reach its speech recognition service. Check your internet connection and try the microphone again. This is separate from the sign recognition service.'
        : event.error === 'no-speech'
          ? 'No speech was heard. Tap the microphone and try speaking again.'
          : `Speech recognition error: ${event.error}.`;
    callbacks.onError(message);
  };
  recognition.onend = () => { if (!failed) callbacks.onEnd(); };
  recognition.start();

  return { stop: () => recognition.stop() };
}
