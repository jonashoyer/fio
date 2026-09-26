import * as Clipboard from 'expo-clipboard';

import type { Artifact, ClipboardService, VoiceService } from './types';

export const VOICE_UNAVAILABLE_MESSAGE =
  'Native voice is not connected yet. You can keep writing and save editable artifacts.';

export class UnconfiguredVoiceService implements VoiceService {
  readonly isConfigured = false;

  async startConversation(): Promise<never> {
    throw new Error(VOICE_UNAVAILABLE_MESSAGE);
  }

  async readArtifact(_artifact: Artifact): Promise<never> {
    throw new Error(VOICE_UNAVAILABLE_MESSAGE);
  }
}

export class ExpoClipboardService implements ClipboardService {
  async copyExact(text: string): Promise<void> {
    const copied = await Clipboard.setStringAsync(text);
    if (!copied) throw new Error('Copy failed. Select the text and copy it manually.');
  }
}

export const voiceService: VoiceService = new UnconfiguredVoiceService();
export const clipboardService: ClipboardService = new ExpoClipboardService();
