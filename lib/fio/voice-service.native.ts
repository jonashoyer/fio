import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStreamTrack,
} from 'react-native-webrtc';

import { FioApiClient, type JsonObject, type JsonValue } from './fio-api-client';
import { installationCredentialStore } from './installation-credential-store';
import type {
  Artifact,
  ArtifactKind,
  VoiceArtifactSnapshot,
  VoiceService,
  VoiceSessionContext,
  VoiceStatus,
} from './types';
import { VOICE_UNAVAILABLE_MESSAGE } from './voice-service-base';

export { VOICE_UNAVAILABLE_MESSAGE };

const REQUIRED_TOOLS = [
  'artifact_list',
  'artifact_read',
  'artifact_create',
  'artifact_update',
  'artifact_undo',
  'artifact_select',
] as const;
const DATA_TOOLS = new Set<string>(REQUIRED_TOOLS.slice(0, 5));
const apiBaseUrl = process.env.EXPO_PUBLIC_FIO_API_BASE_URL?.replace(/\/$/u, '') ?? '';

type Listener = (status: VoiceStatus) => void;
type DataChannel = ReturnType<RTCPeerConnection['createDataChannel']>;
type DataChannelMessageEvent = Parameters<NonNullable<DataChannel['onmessage']>>[0];

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isJsonValue);
  return false;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue)
  );
}

function object(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function isRequiredTool(value: string): value is (typeof REQUIRED_TOOLS)[number] {
  return REQUIRED_TOOLS.some((tool) => tool === value);
}

function parseArtifact(value: unknown): Artifact | null {
  const item = object(value);
  if (!item || typeof item.id !== 'string' || typeof item.text !== 'string') return null;
  const now = new Date().toISOString();
  const kind: ArtifactKind =
    item.kind === 'message' ||
    item.kind === 'reply' ||
    item.kind === 'notes' ||
    item.kind === 'document'
      ? item.kind
      : 'notes';
  return {
    id: item.id,
    kind,
    title:
      typeof item.title === 'string'
        ? item.title
        : kind === 'document'
          ? 'Document'
          : kind === 'message'
            ? 'Message'
            : kind === 'reply'
              ? 'Reply'
              : 'Notes',
    text: item.text,
    createdAt: typeof item.created_at === 'string' ? item.created_at : now,
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : now,
  };
}

function voiceErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return 'Voice could not connect. You can keep writing instead.';
  if (/permission|denied|notallowed/u.test(`${cause.name} ${cause.message}`.toLowerCase())) {
    return 'Microphone access was denied. Enable it in iPhone Settings, or keep writing instead.';
  }
  return cause.message;
}

async function waitForIce(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const handler = () => {
      if (peer.iceGatheringState !== 'complete') return;
      clearTimeout(timeout);
      peer.onicegatheringstatechange = null;
      resolve();
    };
    const timeout = setTimeout(() => {
      peer.onicegatheringstatechange = null;
      reject(new Error('The voice connection timed out.'));
    }, 10_000);
    peer.onicegatheringstatechange = handler;
  });
}

class NativeWebRtcVoiceService implements VoiceService {
  readonly isConfigured = apiBaseUrl.startsWith('https://');
  private readonly api = new FioApiClient(apiBaseUrl, installationCredentialStore);
  private readonly listeners = new Set<Listener>();
  private status: VoiceStatus = {
    phase: this.isConfigured ? 'idle' : 'unconfigured',
    isMuted: false,
    message: this.isConfigured ? undefined : VOICE_UNAVAILABLE_MESSAGE,
  };
  private peer: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private channel: DataChannel | null = null;
  private context: VoiceSessionContext | null = null;
  private sessionThreadId: string | undefined;
  private deletedOrCancelled = false;

  getStatus(): VoiceStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<VoiceStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((listener) => listener(this.status));
  }

  async startConversation(context: VoiceSessionContext): Promise<void> {
    if (!this.isConfigured) throw new Error(VOICE_UNAVAILABLE_MESSAGE);
    await this.disconnect();
    this.context = context;
    this.sessionThreadId = context.getThreadId();
    this.deletedOrCancelled = false;
    this.update({ phase: 'connecting', message: undefined, frozenReadText: undefined });
    try {
      const grant = await this.api.createVoiceSession(this.sessionThreadId);
      const hasExactTools =
        grant.tools.length === REQUIRED_TOOLS.length &&
        REQUIRED_TOOLS.every((name) => grant.tools.includes(name));
      if (!hasExactTools)
        throw new Error('The voice broker did not confirm exactly Fio’s six reviewed tools.');

      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      this.stream = stream;
      const peer = new RTCPeerConnection();
      this.peer = peer;
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      const channel = peer.createDataChannel('fio-events');
      this.channel = channel;
      channel.onmessage = (event: DataChannelMessageEvent) => {
        if (typeof event.data !== 'string') return;
        void this.handleMessage(event.data).catch((cause: unknown) => {
          this.update({
            phase: 'error',
            message: cause instanceof Error ? cause.message : 'A voice result could not be saved.',
          });
        });
      };
      channel.onopen = () => this.update({ phase: 'listening' });
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          this.update({
            phase: 'error',
            message: 'The voice connection ended. Your saved writing is still available.',
          });
        }
      };

      const offer = await peer.createOffer({ offerToReceiveAudio: true });
      await peer.setLocalDescription(offer);
      await waitForIce(peer);
      const localSdp = peer.localDescription?.sdp;
      if (!localSdp) throw new Error('The phone could not create a voice connection offer.');
      const answerResponse = await fetch(grant.callUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${grant.temporaryCredential}`,
          'Content-Type': 'application/sdp',
        },
        body: localSdp,
      });
      if (!answerResponse.ok) throw new Error('Azure did not accept the temporary voice session.');
      await peer.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: await answerResponse.text() }),
      );
    } catch (cause) {
      await this.disconnect(false);
      const message = voiceErrorMessage(cause);
      this.update({ phase: 'error', message });
      throw new Error(message, { cause: cause });
    }
  }

  async stopListening(): Promise<void> {
    this.stream?.getAudioTracks().forEach((track: MediaStreamTrack) => track.stop());
    this.update({ phase: 'stopped', message: 'Listening stopped.' });
  }

  async stopSpeaking(): Promise<void> {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify({ type: 'response.cancel' }));
    }
    this.update({ phase: 'listening', message: 'Fio stopped speaking.' });
  }

  setMuted(muted: boolean): void {
    this.stream?.getAudioTracks().forEach((track: MediaStreamTrack) => {
      track.enabled = !muted;
    });
    this.update({ isMuted: muted });
  }

  async readArtifact(snapshot: VoiceArtifactSnapshot, context: VoiceSessionContext): Promise<void> {
    this.update({ frozenReadText: snapshot.text });
    if (
      !this.peer ||
      !this.channel ||
      this.channel.readyState !== 'open' ||
      this.context !== context
    ) {
      throw new Error(
        'Start the main Fio voice conversation before reading this frozen artifact text.',
      );
    }
    throw new Error(
      'The trusted broker has not confirmed a reviewed read-aloud request event. The frozen text was not sent or spoken.',
    );
  }

  async disconnect(reset = true): Promise<void> {
    this.deletedOrCancelled = true;
    this.channel?.close();
    this.peer?.close();
    this.stream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    this.channel = null;
    this.peer = null;
    this.stream = null;
    this.context = null;
    this.sessionThreadId = undefined;
    if (reset) this.update({ phase: this.isConfigured ? 'idle' : 'unconfigured', isMuted: false });
  }

  private async handleMessage(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const event = object(parsed);
    if (!event || this.deletedOrCancelled) return;
    const type = event.type;
    if (type === 'input_audio_buffer.speech_started') this.update({ phase: 'listening' });
    if (type === 'input_audio_buffer.speech_stopped') this.update({ phase: 'processing' });
    if (type === 'response.audio.delta') this.update({ phase: 'speaking' });
    if (type === 'response.audio.done') this.update({ phase: 'listening' });
    if (
      type === 'conversation.item.input_audio_transcription.completed' &&
      typeof event.transcript === 'string'
    ) {
      this.update({ youSaid: event.transcript });
      await this.context?.onFinalUserTranscript(event.transcript);
    }
    if (type === 'response.audio_transcript.done' && typeof event.transcript === 'string') {
      this.update({ fioSaid: event.transcript });
      await this.context?.onFinalFioTranscript(event.transcript);
    }
    if (type === 'response.function_call_arguments.done') await this.handleToolCall(event);
  }

  private async handleToolCall(event: JsonObject): Promise<void> {
    const callId = typeof event.call_id === 'string' ? event.call_id : null;
    const name = typeof event.name === 'string' ? event.name : null;
    if (!callId || !name || !isRequiredTool(name)) return;
    try {
      const parsed: unknown =
        typeof event.arguments === 'string' ? JSON.parse(event.arguments) : event.arguments;
      const args = object(parsed);
      if (!args) throw new Error('Tool arguments were invalid.');
      const currentThreadId = this.context?.getThreadId();
      const threadId = this.sessionThreadId;
      if (!threadId || currentThreadId !== threadId || args.thread_id !== threadId)
        throw new Error('Tool call targeted a different, deleted, or unsaved thread.');

      let output: JsonObject;
      if (name === 'artifact_select') {
        const artifactId = typeof args.artifact_id === 'string' ? args.artifact_id : '';
        if (!this.context?.getArtifacts().some(({ id }) => id === artifactId)) {
          throw new Error('The selected artifact is not in this thread.');
        }
        this.context.onSelectArtifact(artifactId);
        output = { artifact_id: artifactId, selected: true };
      } else if (DATA_TOOLS.has(name)) {
        output = await this.api.invokeTool(threadId, name, args);
        const artifact = parseArtifact(output.artifact);
        if (artifact && !this.deletedOrCancelled) {
          await this.context?.onPersistedArtifact(artifact, output.can_undo === true);
        }
      } else {
        throw new Error('Tool is not available.');
      }
      this.sendToolOutput(callId, output);
    } catch (cause) {
      this.sendToolOutput(callId, {
        error: cause instanceof Error ? cause.message : 'Tool persistence failed.',
      });
    }
  }

  private sendToolOutput(callId: string, output: JsonObject): void {
    if (this.deletedOrCancelled || this.channel?.readyState !== 'open') return;
    this.channel.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(output),
        },
      }),
    );
  }
}

export function createVoiceService(): VoiceService {
  return new NativeWebRtcVoiceService();
}
