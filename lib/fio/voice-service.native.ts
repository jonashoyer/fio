import * as Crypto from 'expo-crypto';
import { FioApiClient, FIO_LIVE_TOOL_CONTRACT_VERSION, type JsonObject } from './fio-api-client';
import { installationCredentialStore } from './installation-credential-store';
import { checkEffectiveLiveContract } from './live-protocol';
import { LiveToolDispatcher } from './live-tool-dispatcher';
import { ensureLiveBinding, localArtifactId, saveLiveBinding, serverArtifactId, serverView, type LiveThreadBinding } from './live-thread-binding.native';
import type { VoiceArtifactSnapshot, VoiceService, VoiceSessionContext, VoiceStatus } from './types';

export { VOICE_UNAVAILABLE_MESSAGE } from './voice-service-base';

const CHANNEL = 'fio-live-bridge';
export const LIVE_BRIDGE_URL = 'https://fioai.vercel.app/api/fio/voice/live/bridge';
type BridgeMessage = Record<string, unknown> & { channel: string; bridge_id: string; type: string };
type BridgeSender = (message: BridgeMessage) => void;

export class LiveWebViewVoiceService implements VoiceService {
  readonly isConfigured = true;
  private readonly api = new FioApiClient(installationCredentialStore, 'https://fioai.vercel.app/api/fio');
  private status: VoiceStatus = { phase: 'idle', isMuted: false };
  private listeners = new Set<(status: VoiceStatus) => void>();
  private bridgeId: string | null = null;
  private bridgeSend: BridgeSender | null = null;
  private ready = false;
  private generation = 0;
  private attemptId: number | null = null;
  private sessionId: string | null = null;
  private backendModel: string | null = null;
  private binding: LiveThreadBinding | null = null;
  private context: VoiceSessionContext | null = null;
  private dispatcher: LiveToolDispatcher | null = null;
  private verified = false;
  private channelOpen = false;
  private peerConnected = false;
  private activationSent = false;
  private userFragments = '';
  private fioFragments = '';

  getStatus(): VoiceStatus { return this.status; }
  subscribe(listener: (status: VoiceStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }
  private update(patch: Partial<VoiceStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }
  attachBridge(bridgeId: string, send: BridgeSender): void {
    this.generation++;
    this.bridgeId = bridgeId;
    this.bridgeSend = send;
    this.ready = false;
    this.attemptId = null;
    this.sessionId = null;
    this.backendModel = null;
    this.dispatcher?.cancel();
    this.dispatcher = null;
    this.verified = false;
    this.channelOpen = false;
    this.peerConnected = false;
    this.activationSent = false;
    this.update({ phase: 'idle', message: 'Loading the Live media bridge.' });
  }
  reportBridgeLoad(bridgeId: string, state: 'loaded' | 'blocked' | 'failed'): void {
    if (bridgeId !== this.bridgeId || this.ready) return;
    const message = state === 'loaded' ? 'Live bridge page loaded; waiting for its handshake.' :
      state === 'blocked' ? 'Live bridge navigation was blocked. Keep writing manually.' :
      'Live bridge page could not load. Keep writing manually.';
    this.update({ phase: state === 'loaded' ? 'idle' : 'error', message });
  }
  detachBridge(bridgeId: string): void {
    if (this.bridgeId !== bridgeId) return;
    this.generation++;
    this.bridgeSend = null;
    this.bridgeId = null;
    this.ready = false;
    this.attemptId = null;
    this.sessionId = null;
    this.backendModel = null;
    this.dispatcher?.cancel();
    this.dispatcher = null;
    this.verified = false;
    this.channelOpen = false;
    this.peerConnected = false;
    this.activationSent = false;
    this.update({ phase: 'stopped' });
  }
  private send(type: string, fields: Record<string, unknown> = {}): void {
    if (!this.bridgeId || !this.bridgeSend) throw new Error('The Live media bridge is unavailable. Keep writing manually.');
    this.bridgeSend({ channel: CHANNEL, bridge_id: this.bridgeId, type, ...fields });
  }
  async startConversation(context: VoiceSessionContext): Promise<void> {
    if (!this.ready) throw new Error(this.status.message ?? 'The Live media bridge is still loading. Keep writing manually.');
    this.generation++;
    const generation = this.generation;
    this.attemptId = null;
    this.sessionId = null;
    this.backendModel = null;
    this.dispatcher?.cancel();
    this.dispatcher = null;
    this.verified = false;
    this.channelOpen = false;
    this.peerConnected = false;
    this.activationSent = false;
    this.context = context;
    this.binding = null;
    this.userFragments = '';
    this.fioFragments = '';
    this.update({ phase: 'connecting', message: undefined, youSaid: undefined, fioSaid: undefined });
    const thread = context.getThreadSnapshot();
    try {
      if (thread) this.binding = await ensureLiveBinding(this.api, thread);
    } catch (cause) {
      if (generation !== this.generation) return;
      this.update({ phase: 'error', message: cause instanceof Error ? cause.message : 'Live could not prepare the saved writing.' });
      return;
    }
    if (generation !== this.generation) return;
    this.send('start');
  }
  async receiveBridgeMessage(raw: string): Promise<void> {
    let message: BridgeMessage;
    try { message = JSON.parse(raw) as BridgeMessage; } catch { return; }
    if (message.channel !== CHANNEL) return;
    if (message.bridge_id !== this.bridgeId) {
      this.update({ phase: 'error', message: 'Live bridge identity does not match this app session.' });
      return;
    }
    if (message.type === 'host_probe') {
      if (!this.ready) {
        const pageStatus = message.page_status === 'Ready for explicit app action' ? 'ready' :
          message.page_status === 'Media bridge unavailable' ? 'unsupported' : 'incomplete';
        this.update({ phase: pageStatus === 'unsupported' ? 'error' : 'idle',
          message: pageStatus === 'ready' ? 'Bridge page is ready, but its handshake did not reach the app.' :
            pageStatus === 'unsupported' ? 'Expo Go bridge lacks required media features.' :
              'Bridge page loaded without a ready media state.' });
      }
      return;
    }
    if (message.type === 'ready') {
      if (message.tool_contract_version !== FIO_LIVE_TOOL_CONTRACT_VERSION) {
        this.update({ phase: 'error', message: 'The Live bridge contract differs from the app.' });
        return;
      }
      this.ready = true;
      this.update({ phase: 'idle', message: undefined });
      return;
    }
    if (message.type === 'unsupported') {
      this.update({ phase: 'error', message: 'Expo Go cannot run the Live media bridge on this device. Keep writing manually.' });
      return;
    }
    if (message.type === 'starting' && typeof message.attempt_id === 'number') {
      this.attemptId = message.attempt_id;
      return;
    }
    if (message.attempt_id !== this.attemptId || !this.attemptId) return;
    if (message.type === 'offer' && typeof message.sdp === 'string') {
      const generation = this.generation;
      const attemptId = this.attemptId;
      try {
        const answer = await this.api.createLiveSession(message.sdp, this.binding?.serverThreadId);
        if (generation !== this.generation || attemptId !== this.attemptId) return;
        this.sessionId = answer.sessionId;
        this.backendModel = answer.backendModel;
        this.send('answer', { attempt_id: attemptId, sdp: answer.answerSdp });
      } catch (cause) {
        if (generation !== this.generation) return;
        await this.disconnect();
        this.update({ phase: 'error', message: cause instanceof Error ? cause.message : 'Live connection failed. Keep writing manually.' });
      }
      return;
    }
    if (message.type === 'channel_open') {
      this.channelOpen = true;
      this.maybeActivate();
      return;
    }
    if (message.type === 'connection_state') {
      this.peerConnected = message.state === 'connected';
      if (message.state === 'failed' || message.state === 'closed') {
        this.update({ phase: 'error', message: 'Live peer connection closed. Keep writing manually.' });
      } else this.maybeActivate();
      return;
    }
    if (message.type === 'active') {
      if (!this.verified || !this.activationSent) return;
      this.update({ phase: 'listening', message: undefined });
      this.sendAppState();
      return;
    }
    if (message.type === 'provider_event' && message.event && this.sessionId && this.backendModel) {
      const event = message.event as JsonObject;
      const type = typeof event.type === 'string' ? event.type : '';
      this.traceProviderEvent(event, type);
      if (type === 'session.started' || type === 'session.updated') {
        const session = event.session;
        if (!session || typeof session !== 'object' || Array.isArray(session) || session.id !== this.sessionId) {
          this.update({ phase: 'error', message: 'Live session identity could not be verified.' });
          this.send('stop');
          return;
        }
        const check = checkEffectiveLiveContract(event, this.backendModel);
        if (check.status === 'unavailable') {
          this.update({ phase: 'error', message: check.reason });
          this.send('stop');
        } else if (check.confirmed && !this.verified) {
          this.verified = true;
          this.installDispatcher();
          this.maybeActivate();
        }
      } else if (this.status.phase === 'listening' || this.status.phase === 'speaking' || this.status.phase === 'processing') {
        if (type === 'session.input_transcript.delta' && typeof event.delta === 'string') {
          this.userFragments += event.delta;
          this.update({ phase: 'listening', youSaid: this.userFragments });
        } else if (type === 'session.output_transcript.delta' && typeof event.delta === 'string') {
          this.fioFragments += event.delta;
          this.update({ phase: 'speaking', fioSaid: this.fioFragments });
        } else if (type === 'session.delegation.created') {
          this.update({ phase: 'processing', message: 'Fio is preparing the writing change.' });
        } else if (type === 'response.event' && event.event && typeof event.event === 'object') {
          const nested = event.event as JsonObject;
          if (nested.type === 'response.failed' || nested.type === 'response.incomplete' || nested.type === 'error') {
            this.update({ phase: 'error', message: 'Fio could not finish the writing request. Your text is still here.' });
          }
        }
        this.dispatcher?.handle(event);
      }
      return;
    }
    if (message.type === 'error') {
      const code = typeof message.code === 'string' ? message.code : 'unknown';
      this.update({ phase: 'error', message: `Live media error: ${code}. Keep writing manually.` });
      return;
    }
    if (message.type === 'stopped') this.update({ phase: 'stopped' });
  }
  async stopListening(): Promise<void> { await this.disconnect(); }
  async stopSpeaking(): Promise<void> { await this.disconnect(); }
  setMuted(muted: boolean): void {
    this.update({ isMuted: muted });
    if (this.attemptId) this.send('mute', { attempt_id: this.attemptId, input_muted: muted, output_muted: muted });
  }
  selectionChanged(): void { if (this.verified) this.sendAppState(); }
  async readArtifact(_snapshot: VoiceArtifactSnapshot, _context: VoiceSessionContext): Promise<void> {
    throw new Error('Live Read aloud is not ready on this build. The selected text is still available to copy.');
  }
  async disconnect(): Promise<void> {
    this.generation++;
    this.dispatcher?.cancel();
    this.dispatcher = null;
    this.verified = false;
    this.channelOpen = false;
    this.peerConnected = false;
    this.activationSent = false;
    if (this.bridgeSend) this.send('stop');
    this.attemptId = null;
    this.sessionId = null;
    this.backendModel = null;
    this.binding = null;
    this.context = null;
    this.update({ phase: 'stopped' });
  }

  private installDispatcher(): void {
    if (!this.context) return;
    const context = this.context;
    const generation = this.generation;
    const mapped: VoiceSessionContext = {
      ...context,
      getArtifacts: () => context.getArtifacts().map((artifact) => this.binding
        ? serverView(this.binding, artifact) : artifact),
      getSelectedArtifactId: () => {
        const id = context.getSelectedArtifactId();
        return id && this.binding ? serverArtifactId(this.binding, id) : id;
      },
      onSelectArtifact: (id) => context.onSelectArtifact(this.binding
        ? localArtifactId(this.binding, id) : id),
      onPersistedArtifact: async (artifact, canUndo) => {
        await context.onPersistedArtifact({ ...artifact, id: this.binding
          ? localArtifactId(this.binding, artifact.id) : artifact.id }, canUndo);
        this.update({ message: 'Writing change saved.' });
      },
    };
    this.dispatcher = new LiveToolDispatcher(this.api, this.binding?.serverThreadId ?? null, mapped,
      { send: (event) => {
        if (process.env.NODE_ENV !== 'production') {
          const item = event.item;
          console.info('[Fio Live] client event', {
            type: event.type,
            call_id: item && typeof item === 'object' && !Array.isArray(item) && typeof item.call_id === 'string'
              ? item.call_id : null,
          });
        }
        this.send('send_event', { attempt_id: this.attemptId,
          event: { ...event, event_id: Crypto.randomUUID() } });
      } },
      () => generation === this.generation && this.verified,
      async (serverThreadId) => {
        const localThreadId = context.getThreadId();
        if (!localThreadId) throw new Error('The voice artifact has no saved local thread.');
        this.binding = { localThreadId, serverThreadId, artifactIds: {} };
        await saveLiveBinding(this.binding);
        this.sendAppState();
      });
  }

  private maybeActivate(): void {
    if (!this.verified || !this.channelOpen || !this.peerConnected ||
        this.activationSent || this.attemptId === null) return;
    this.activationSent = true;
    this.send('activate', { attempt_id: this.attemptId,
      tool_contract_version: FIO_LIVE_TOOL_CONTRACT_VERSION });
  }

  private traceProviderEvent(event: JsonObject, type: string): void {
    if (process.env.NODE_ENV === 'production') return;
    if (type === 'session.delegation.created') {
      const delegation = event.delegation;
      if (!delegation || typeof delegation !== 'object' || Array.isArray(delegation)) return;
      console.info('[Fio Live] delegation', {
        type, id: typeof delegation.id === 'string' ? delegation.id : null,
        response_id: typeof delegation.response_id === 'string' ? delegation.response_id : null,
      });
      return;
    }
    if (type === 'response.event') {
      const nested = event.event;
      if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return;
      const item = nested.item;
      const response = nested.response;
      console.info('[Fio Live] delegated event', {
        type: typeof nested.type === 'string' ? nested.type : 'unknown',
        delegation_id: typeof event.delegation_id === 'string' ? event.delegation_id : null,
        response_id: typeof event.response_id === 'string' ? event.response_id :
          response && typeof response === 'object' && !Array.isArray(response) && typeof response.id === 'string'
            ? response.id : null,
        call_id: item && typeof item === 'object' && !Array.isArray(item) && typeof item.call_id === 'string'
          ? item.call_id : null,
      });
    }
  }

  private sendAppState(): void {
    if (!this.binding || !this.context || !this.attemptId) return;
    const selectedLocalId = this.context.getSelectedArtifactId() ?? this.context.getArtifacts()[0]?.id;
    const selected = this.context.getArtifacts().find((artifact) => artifact.id === selectedLocalId);
    const state = {
      type: 'app_state', thread_id: this.binding.serverThreadId,
      selection: { artifact_id: selected ? serverArtifactId(this.binding, selected.id) : null },
      displayed: selected ? { artifact_id: serverArtifactId(this.binding, selected.id), text: selected.text } : null,
      context_complete: false,
    };
    const content = JSON.stringify(state);
    if (new TextEncoder().encode(content).length > 450) {
      this.update({ message: 'Live context is too long to send safely; selected writing remains visible.' });
      return;
    }
    this.send('send_event', { attempt_id: this.attemptId,
      event: { type: 'session.thinking.append', event_id: Crypto.randomUUID(), delegation_id: null, content } });
  }
}

export const liveWebViewVoiceService = new LiveWebViewVoiceService();
export function createVoiceService(): VoiceService { return liveWebViewVoiceService; }
