import type { VoiceService } from './types';
import { UnconfiguredVoiceService, VOICE_UNAVAILABLE_MESSAGE } from './voice-service-base';

export { VOICE_UNAVAILABLE_MESSAGE };

/**
 * Expo Go resolves native platform files, but it does not include react-native-webrtc.
 * Keep the native entrypoint free of unsupported native imports so manual Fio stays usable.
 */
export function createVoiceService(): VoiceService {
  return new UnconfiguredVoiceService();
}
