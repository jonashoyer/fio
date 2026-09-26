export type AttachmentKind = 'image';
export type ArtifactKind = 'message' | 'reply' | 'notes' | 'document';
export type TurnRole = 'user' | 'fio';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  uri: string;
  mimeType: string;
  createdAt: string;
}

export interface Turn {
  id: string;
  role: TurnRole;
  text: string;
  contextText?: string;
  attachmentIds: string[];
  createdAt: string;
}

export interface ArtifactRevision {
  text: string;
  savedAt: string;
}

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  text: string;
  previous?: ArtifactRevision;
  createdAt: string;
  updatedAt: string;
}

export interface Thread {
  id: string;
  title: string;
  referenceContext?: string;
  turns: Turn[];
  attachments: Attachment[];
  artifacts: Artifact[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ThreadRepository {
  list(): Promise<Thread[]>;
  get(id: string): Promise<Thread | null>;
  save(thread: Thread): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ReferenceContextDraftRepository {
  get(): Promise<string>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}

export type VoicePhase =
  | 'unconfigured'
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'stopped'
  | 'error';

export interface VoiceStatus {
  phase: VoicePhase;
  isMuted: boolean;
  youSaid?: string;
  fioSaid?: string;
  frozenReadText?: string;
  message?: string;
}

export interface VoiceArtifactSnapshot {
  id: string;
  text: string;
}

export interface VoiceSessionContext {
  getThreadId: () => string | undefined;
  getArtifacts: () => readonly Artifact[];
  onSelectArtifact: (artifactId: string) => void;
  onFinalUserTranscript: (text: string) => Promise<void>;
  onFinalFioTranscript: (text: string) => Promise<void>;
  onPersistedArtifact: (artifact: Artifact, canUndo: boolean) => Promise<void>;
}

export interface VoiceService {
  readonly isConfigured: boolean;
  getStatus(): VoiceStatus;
  subscribe(listener: (status: VoiceStatus) => void): () => void;
  startConversation(context: VoiceSessionContext): Promise<void>;
  stopListening(): Promise<void>;
  stopSpeaking(): Promise<void>;
  setMuted(muted: boolean): void;
  readArtifact(snapshot: VoiceArtifactSnapshot, context: VoiceSessionContext): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ClipboardService {
  copyExact(text: string): Promise<void>;
}

export interface AttachmentService {
  pickImage(): Promise<Attachment | null>;
  remove(attachment: Attachment): Promise<void>;
}
