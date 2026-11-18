export type CameraSource = 'mobile' | 'pi';

const CAMERA_SOURCE_KEY = 'signbridge.cameraSource';
const PI_STREAM_URL_KEY = 'signbridge.piCameraStreamUrl';

function storage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function loadCameraSource(): CameraSource {
  try {
    return storage()?.getItem(CAMERA_SOURCE_KEY) === 'pi' ? 'pi' : 'mobile';
  } catch {
    return 'mobile';
  }
}

export function saveCameraSource(source: CameraSource) {
  try {
    storage()?.setItem(CAMERA_SOURCE_KEY, source);
  } catch {
    // Storage may be disabled in a private browsing session.
  }
}

export function loadPiStreamUrl() {
  try {
    return storage()?.getItem(PI_STREAM_URL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePiStreamUrl(url: string) {
  try {
    storage()?.setItem(PI_STREAM_URL_KEY, url);
  } catch {
    // Storage may be disabled in a private browsing session.
  }
}

export function isSecurePiStreamUrl(url: string) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
