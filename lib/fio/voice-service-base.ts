import type {
  VoiceArtifactSnapshot,
  VoiceService,
  VoiceSessionContext,
  VoiceStatus,
} from './types';

export const VOICE_UNAVAILABLE_MESSAGE =
  'GPT-Live-1 voice is unavailable in Expo Go: React Native JavaScript has no WebRTC peer connection, and no reviewed HTTPS media bridge is configured. Keep writing manually.';

export class UnconfiguredVoiceService implements VoiceService {
  readonly isConfigured = false;
  private status: VoiceStatus = {
    phase: 'unconfigured',
    isMuted: false,
    message: VOICE_UNAVAILABLE_MESSAGE,
  };

  getStatus(): VoiceStatus {
    return this.status;
  }

  subscribe(listener: (status: VoiceStatus) => void): () => void {
    listener(this.status);
    return () => undefined;
  }

  private unavailable(): Promise<never> {
    return Promise.reject(new Error(VOICE_UNAVAILABLE_MESSAGE));
  }

  startConversation(_context: VoiceSessionContext): Promise<void> {
    return this.unavailable();
  }
  stopListening(): Promise<void> {
    return this.unavailable();
  }
  stopSpeaking(): Promise<void> {
    return this.unavailable();
  }
  setMuted(_muted: boolean): void {
    this.status = { ...this.status, message: VOICE_UNAVAILABLE_MESSAGE };
  }
  readArtifact(_snapshot: VoiceArtifactSnapshot, _context: VoiceSessionContext): Promise<void> {
    return this.unavailable();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}
