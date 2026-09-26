import type { VoiceService } from './types';
import { UnconfiguredVoiceService, VOICE_UNAVAILABLE_MESSAGE } from './voice-service-base';

export { VOICE_UNAVAILABLE_MESSAGE };

export function createVoiceService(): VoiceService {
  return new UnconfiguredVoiceService();
}
