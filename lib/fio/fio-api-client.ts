const MAX_TEXT_BYTES = 128 * 1024;
const SYNC_HEADER = 'X-Fio-Sync-Token';

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

export interface VoiceSessionGrant {
  temporaryCredential: string;
  callUrl: string;
  tools: string[];
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
  constructor(
    private readonly baseUrl: string,
    private readonly credentials: CredentialStore,
  ) {}

  get isConfigured(): boolean {
    return this.baseUrl.startsWith('https://');
  }

  private async request(path: string, init: RequestInit, authenticated = true): Promise<unknown> {
    if (!this.isConfigured)
      throw new Error('Set EXPO_PUBLIC_FIO_API_BASE_URL to the private HTTPS Fio API.');
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
    return body;
  }

  async ensureInstallation(): Promise<{ deviceId: string; credential: string }> {
    const existing = await this.credentials.getIdentity();
    if (existing) return existing;
    const body = record(
      await this.request('/api/fio/devices', { method: 'POST', body: '{}' }, false),
    );
    const identity = {
      deviceId: requiredString(body?.device_id, 'device_id'),
      credential: requiredString(body?.credential, 'credential'),
    };
    // Registration credentials are durable before any authenticated request can begin.
    await this.credentials.saveIdentity(identity);
    return identity;
  }

  async createVoiceSession(threadId?: string): Promise<VoiceSessionGrant> {
    const body = record(
      await this.request('/api/fio/voice/sessions', {
        method: 'POST',
        body: JSON.stringify(threadId ? { thread_id: threadId } : {}),
      }),
    );
    // These names are a fail-closed mobile handoff. The live broker must confirm them.
    const tools = body?.tools;
    if (!Array.isArray(tools) || !tools.every((tool) => typeof tool === 'string')) {
      throw new Error('The voice broker did not confirm its installed tools.');
    }
    return {
      temporaryCredential: requiredString(body?.temporary_credential, 'temporary_credential'),
      callUrl: requiredString(body?.webrtc_call_url, 'webrtc_call_url'),
      tools,
    };
  }

  async createThread(operationId: string, title: string, initial: JsonObject): Promise<JsonObject> {
    assertTextLimit(initial);
    const body = record(
      await this.request('/api/fio/threads', {
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
      await this.request(`/api/fio/threads/${encodeURIComponent(threadId)}/operations`, {
        method: 'POST',
        body: JSON.stringify({ operation_id: operationId, change }),
      }),
    );
    if (!body) throw new Error('The Fio operation response was invalid.');
    return body;
  }

  async getThread(threadId: string): Promise<JsonObject> {
    const body = record(
      await this.request(`/api/fio/threads/${encodeURIComponent(threadId)}`, { method: 'GET' }),
    );
    if (!body) throw new Error('The Fio thread response was invalid.');
    return body;
  }

  async listArtifacts(threadId: string): Promise<JsonObject> {
    const body = record(
      await this.request(`/api/fio/threads/${encodeURIComponent(threadId)}/artifacts`, {
        method: 'GET',
      }),
    );
    if (!body) throw new Error('The Fio artifact list response was invalid.');
    return body;
  }

  async getArtifact(threadId: string, artifactId: string): Promise<JsonObject> {
    const body = record(
      await this.request(
        `/api/fio/threads/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}`,
        { method: 'GET' },
      ),
    );
    if (!body) throw new Error('The Fio artifact response was invalid.');
    return body;
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.request(`/api/fio/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' });
  }

  async invokeTool(
    threadId: string,
    name: string,
    argumentsValue: JsonObject,
  ): Promise<JsonObject> {
    assertTextLimit(argumentsValue);
    const body = record(
      await this.request(`/api/fio/threads/${encodeURIComponent(threadId)}/tools`, {
        method: 'POST',
        body: JSON.stringify({ name, arguments: argumentsValue }),
      }),
    );
    const data = record(body?.data);
    if (!data) throw new Error('The Fio tool response is missing confirmed persistence data.');
    return data;
  }
}
