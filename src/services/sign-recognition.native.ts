import type { SignRecognizer } from './sign-recognition.types';

export async function createSignRecognizer(): Promise<SignRecognizer> {
  throw new Error('On-device MediaPipe recognition is available in the web app.');
}
