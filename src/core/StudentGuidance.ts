export function cameraFailure(network: boolean, error: unknown): string {
  if (network) return 'Network camera unavailable. Check its power and Wi-Fi, then press Connect to retry.';
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  return name === 'NotAllowedError' || name === 'PermissionDeniedError'
    ? 'Camera access was blocked. Allow camera permission in your browser, then try again.'
    : 'Laptop camera unavailable. Close other camera apps, check the selected camera, then try again.';
}
export function modelGuidance(provider: string, busy: boolean, ready: boolean, failed: boolean, url: string): string {
  if (busy) return 'AI model is loading. Wait a moment before pressing Play.';
  if (ready) return 'Ready';
  if (provider === 'teachable-machine') {
    if (!url.trim()) return 'Paste your Teachable Machine image model link, then press Load Model.';
    if (failed) return 'Teachable Machine model could not load. Check the model link and try again.';
    return 'Press Load Model to load your classes.';
  }
  return failed ? 'YOLO could not load. Try Load local model again or choose a compatible ONNX file.' : 'AI model not loaded. Press Load local model.';
}
export function detectionEmpty(provider: string, live: boolean, selectedTarget: boolean): string {
  if (!live) return 'Detection results will appear here when camera and model are ready.';
  if (selectedTarget) return 'Waiting for the selected target. Select it in the camera view to track it.';
  return provider === 'teachable-machine' ? 'Waiting for a confident classification.' : 'No matching objects detected yet.';
}
