const MAX_TEXT_BYTES = 128 * 1024;
const SYNC_HEADER = 'X-Fio-Sync-Token';
export const FIO_TOOL_CONTRACT_VERSION =
  'fio-tools-v1:e84b0d5d4e661714212210a2f7231bbb12135cfb178ecd2b7ff570c3b5760a02';
export const FIO_LIVE_MODEL = 'gpt-live-1';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type FioApiErrorCode =
  | 'operation_cancelled'
  | 'unauthorized'
  | 'capacity'
  | 'idempotency_conflict'
  | 'idempotency_mismatch'
  | 'unknown';

export class FioApiError extends Error {
  constructor(
    message: string,
    readonly code: FioApiErrorCode,
    readonly operationId: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface LiveSessionAnswer {
  threadId: string | null;
  contextRestored: false;
  provider: 'azure';
  transport: 'webrtc';
  model: typeof FIO_LIVE_MODEL;
  backendModel: string;
  sessionId: string;
  answerSdp: string;
  toolContractVersion: typeof FIO_TOOL_CONTRACT_VERSION;
  toolContractStatus: 'confirmed' | 'awaiting_session_started';
  credentialExpiresAt: null;
}

interface CredentialStore {
  getIdentity(): Promise<{ deviceId: string; credential: string } | null>;
  saveIdentity(identity: { deviceId: string; credential: string }): Promise<void>;
  getSyncToken(): Promise<string | null>;
  saveSyncToken(token: string): Promise<void>;
}

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

function record(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value)
    throw new Error(`The Fio API response is missing ${label}.`);
  return value;
}

function assertTextLimit(value: JsonValue): void {
  const visit = (item: JsonValue): void => {
    if (typeof item === 'string' && new TextEncoder().encode(item).byteLength > MAX_TEXT_BYTES) {
      throw new Error('Text exceeds Fio’s 128 KiB UTF-8 limit.');
    }
    if (Array.isArray(item)) item.forEach(visit);
    else if (typeof item === 'object' && item !== null) Object.values(item).forEach(visit);
  };
  visit(value);
}

function errorCode(value: unknown, status: number): FioApiErrorCode {
  if (value === 'operation_cancelled' || value === 'unauthorized' || value === 'capacity')
    return value;
  if (value === 'idempotency_conflict' || value === 'idempotency_mismatch') return value;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429 || status === 503) return 'capacity';
  return 'unknown';
}

export class FioApiClient {
  private readonly baseUrl: string;

  constructor(
    private readonly credentials: CredentialStore,
    baseUrl = process.env.EXPO_PUBLIC_FIO_API_BASE_URL ?? '',
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get isConfigured(): boolean {
    try {
      const url = new URL(this.baseUrl);
      return (
        url.protocol === 'https:' &&
        url.username === '' &&
        url.password === '' &&
        url.search === '' &&
        url.hash === '' &&
        url.pathname.replace(/\/+$/, '') === '/api/fio'
      );
    } catch {
      return false;
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    authenticated = true,
    expectedStatus?: number,
  ): Promise<unknown> {
    if (!this.isConfigured) {
      throw new Error(
        'Set EXPO_PUBLIC_FIO_API_BASE_URL to the full HTTPS Fio API prefix ending in /api/fio.',
      );
    }
    const identity = authenticated ? await this.ensureInstallation() : null;
    const syncToken = await this.credentials.getSyncToken();
    const headers = new Headers({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    if (identity) headers.set('Authorization', `Bearer ${identity.credential}`);
    if (syncToken) headers.set(SYNC_HEADER, syncToken);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const nextSyncToken = response.headers.get(SYNC_HEADER);
    if (nextSyncToken) await this.credentials.saveSyncToken(nextSyncToken);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const data = record(body);
      const codeValue = data?.code ?? record(data?.error)?.code;
      const operationId = data?.operation_id;
      const message = data?.message ?? record(data?.error)?.message;
      throw new FioApiError(
        typeof message === 'string' ? message : 'The Fio API request failed.',
        errorCode(codeValue, response.status),
        typeof operationId === 'string' ? operationId : null,
        response.status,
      );
    }
    if (expectedStatus !== undefined && response.status !== expectedStatus) {
      throw new Error(`The Fio API returned ${response.status}; expected ${expectedStatus}.`);
    }
    return body;
  }

  async ensureInstallation(): Promise<{ deviceId: string; credential: string }> {
    const existing = await this.credentials.getIdentity();
    if (existing) return existing;
    const body = record(await this.request('/devices', { method: 'POST', body: '{}' }, false));
    const identity = {
      deviceId: requiredString(body?.device_id, 'device_id'),
      credential: requiredString(body?.credential, 'credential'),
    };
    // Registration credentials are durable before any authenticated request can begin.
    await this.credentials.saveIdentity(identity);
    return identity;
  }

  async createLiveSession(offerSdp: string, threadId?: string): Promise<LiveSessionAnswer> {
    if (!offerSdp.trim()) throw new Error('A phone WebRTC offer is required for Live.');
    const body = record(
      await this.request(
        '/voice/live/sessions',
        {
          method: 'POST',
          body: JSON.stringify({ sdp: offerSdp, ...(threadId ? { thread_id: threadId } : {}) }),
        },
        true,
        201,
      ),
    );
    if (!body || body.ok !== true) {
      throw new Error('The Live broker did not return a successful SDP answer.');
    }
    if (body.context_restored !== false) {
      throw new Error('The Live broker returned an unsupported restored context.');
    }
    if (body.provider !== 'azure' || body.transport !== 'webrtc') {
      throw new Error('The Live broker returned an unsupported provider or transport.');
    }
    if (body.model !== FIO_LIVE_MODEL) {
      throw new Error('The broker did not bind this session to GPT-Live-1.');
    }
    if (body.tool_contract_version !== FIO_TOOL_CONTRACT_VERSION) {
      throw new Error('The Live tool contract is unavailable or unreviewed.');
    }
    if (
      body.tool_contract_status !== 'confirmed' &&
      body.tool_contract_status !== 'awaiting_session_started'
    ) {
      throw new Error('The Live broker returned an invalid contract status.');
    }
    if (body.credential_expires_at !== null) {
      throw new Error('The Live broker returned an unexpected client credential.');
    }

    const returnedThreadId = body.thread_id;
    if (returnedThreadId !== null && typeof returnedThreadId !== 'string') {
      throw new Error('The Live broker returned an invalid thread_id.');
    }
    if (threadId && returnedThreadId !== threadId) {
      throw new Error('The Live broker returned a session for a different thread.');
    }

    return {
      threadId: returnedThreadId,
      contextRestored: false,
      provider: 'azure',
      transport: 'webrtc',
      model: FIO_LIVE_MODEL,
      backendModel: requiredString(body.backend_model, 'backend_model'),
      sessionId: requiredString(body.session_id, 'session_id'),
      answerSdp: requiredString(body.sdp, 'sdp'),
      toolContractVersion: FIO_TOOL_CONTRACT_VERSION,
      toolContractStatus: body.tool_contract_status,
      credentialExpiresAt: null,
    };
  }

  async createThread(operationId: string, title: string, initial: JsonObject): Promise<JsonObject> {
    assertTextLimit(initial);
    const body = record(
      await this.request('/threads', {
        method: 'POST',
        body: JSON.stringify({ operation_id: operationId, title, initial }),
      }),
    );
    if (!body) throw new Error('The Fio thread response was invalid.');
    return body;
  }

  async appendThreadOperation(
    threadId: string,
    operationId: string,
    change: JsonObject,
  ): Promise<JsonObject> {
    assertTextLimit(change);
    const body = record(
      await this.request(`/threads/${encodeURIComponent(threadId)}/operations`, {
        method: 'POST',
        body: JSON.stringify({ operation_id: operationId, change }),
      }),
    );
    if (!body) throw new Error('The Fio operation response was invalid.');
    return body;
  }

  async getThread(threadId: string): Promise<JsonObject> {
    const body = record(
      await this.request(`/threads/${encodeURIComponent(threadId)}`, { method: 'GET' }),
    );
    if (!body) throw new Error('The Fio thread response was invalid.');
    return body;
  }

  async listArtifacts(threadId: string): Promise<JsonObject> {
    const body = record(
      await this.request(`/threads/${encodeURIComponent(threadId)}/artifacts`, {
        method: 'GET',
      }),
    );
    if (!body) throw new Error('The Fio artifact list response was invalid.');
    return body;
  }

  async getArtifact(threadId: string, artifactId: string): Promise<JsonObject> {
    const body = record(
      await this.request(
        `/threads/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}`,
        { method: 'GET' },
      ),
    );
    if (!body) throw new Error('The Fio artifact response was invalid.');
    return body;
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.request(`/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' });
  }

  async invokeTool(
    threadId: string,
    name: string,
    argumentsValue: JsonObject,
  ): Promise<JsonObject> {
    const toolArguments: JsonObject =
      name === 'artifact_create'
        ? {
            operation_id: requiredString(
              argumentsValue.operation_id,
              'artifact_create.operation_id',
            ),
            title: requiredString(argumentsValue.title, 'artifact_create.title'),
            text: requiredString(argumentsValue.text, 'artifact_create.text'),
          }
        : argumentsValue;
    assertTextLimit(toolArguments);
    const body = record(
      await this.request(`/threads/${encodeURIComponent(threadId)}/tools`, {
        method: 'POST',
        body: JSON.stringify({ name, arguments: toolArguments }),
      }),
    );
    const data = record(body?.data);
    if (!data) throw new Error('The Fio tool response is missing confirmed persistence data.');
    return data;
  }
}
