export type BrowserSpeechLanguage = 'en' | 'ar';

export type BrowserSpeechSession = {
  stop: () => void;
};

export type BrowserSpeechCallbacks = {
  onStart: () => void;
  onResult: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
};
