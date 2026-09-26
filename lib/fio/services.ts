import * as Clipboard from 'expo-clipboard';

import type { ClipboardService } from './types';
import { createVoiceService } from './voice-service';

export { VOICE_UNAVAILABLE_MESSAGE } from './voice-service';

export class ExpoClipboardService implements ClipboardService {
  async copyExact(text: string): Promise<void> {
    const copied = await Clipboard.setStringAsync(text);
    if (!copied) throw new Error('Copy failed. Select the text and copy it manually.');
  }
}

export const voiceService = createVoiceService();
export const clipboardService: ClipboardService = new ExpoClipboardService();
