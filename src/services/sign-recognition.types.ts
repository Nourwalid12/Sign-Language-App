export type RecognitionMode = 'words' | 'numbers';

export type SignRecognitionResult = {
  hand_count: number;
  sign: string;
  confidence: number;
};

export type SignRecognizer = {
  predict: (frame: HTMLVideoElement | HTMLImageElement, mode: RecognitionMode) => SignRecognitionResult;
  close: () => void;
};
