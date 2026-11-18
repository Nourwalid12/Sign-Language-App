// Metro resolves the platform-specific .web.ts or .native.ts implementation.
// This fallback exists so TypeScript can resolve the extensionless import.
export { createSignRecognizer } from './sign-recognition.native';
