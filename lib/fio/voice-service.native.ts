import type { VoiceService } from './types';
import { UnconfiguredVoiceService, VOICE_UNAVAILABLE_MESSAGE } from './voice-service-base';

export { VOICE_UNAVAILABLE_MESSAGE };

/**
 * Expo Go resolves native platform files but exposes no WebRTC peer connection to
 * React Native JavaScript. Keep this entrypoint free of custom native imports.
 * A hosted WebView bridge is also disabled until its HTTPS page and protocol are reviewed.
 */
export function createVoiceService(): VoiceService {
  return new UnconfiguredVoiceService();
}
