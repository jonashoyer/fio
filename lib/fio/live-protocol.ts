import {
  FIO_LIVE_MODEL,
  FIO_TOOL_CONTRACT_VERSION,
  type JsonObject,
  type JsonValue,
} from './fio-api-client';

export const GPT_LIVE_MODEL = FIO_LIVE_MODEL;

export const LIVE_TOOL_NAMES = [
  'artifact_list',
  'artifact_read',
  'artifact_create',
  'artifact_update',
  'artifact_undo',
  'artifact_select',
] as const;

export type LiveToolName = (typeof LIVE_TOOL_NAMES)[number];

export interface FrozenLiveContract {
  version: typeof FIO_TOOL_CONTRACT_VERSION;
  instructions: string;
  tools: readonly JsonValue[];
}

export interface LiveContractCheck {
  confirmed: boolean;
  reason: string;
}

export interface LiveFunctionCall {
  callId: string;
  name: LiveToolName;
  arguments: JsonObject;
}

export interface LiveDataChannel {
  send(event: JsonObject): void;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function unwrapResponseEvent(envelope: unknown): JsonObject | null {
  if (!isJsonObject(envelope)) return null;
  const response = isJsonObject(envelope.response) ? envelope.response : null;
  return isJsonObject(response?.event) ? response.event : envelope;
}

function stableValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  const sorted: JsonObject = {};
  for (const key of Object.keys(value).sort()) sorted[key] = stableValue(value[key]);
  return sorted;
}

function exactlyMatches(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

/**
 * Confirms the effective server-installed Live session configuration.
 * A version string or broker assertion alone never opens the media/tool gate.
 */
export function checkEffectiveLiveContract(
  envelope: unknown,
  expected: FrozenLiveContract | null,
): LiveContractCheck {
  if (!expected) {
    return {
      confirmed: false,
      reason: 'The reviewed server-frozen Live instruction and tool bundle is not available.',
    };
  }
  if (expected.version !== FIO_TOOL_CONTRACT_VERSION) {
    return {
      confirmed: false,
      reason: 'The reviewed Live tool contract version does not match.',
    };
  }

  const event = unwrapResponseEvent(envelope);
  if (!event || (event.type !== 'session.started' && event.type !== 'session.updated')) {
    return { confirmed: false, reason: 'Waiting for a complete Live session configuration event.' };
  }

  const session = isJsonObject(event.session) ? event.session : event;
  const delegation = isJsonObject(session.delegation) ? session.delegation : null;
  const responses = isJsonObject(delegation?.responses) ? delegation.responses : null;
  const tools = responses?.tools;

  if (session.model !== GPT_LIVE_MODEL) {
    return { confirmed: false, reason: 'The effective session is not bound to GPT-Live-1.' };
  }
  if (session.instructions !== expected.instructions || !Array.isArray(tools)) {
    return {
      confirmed: false,
      reason: 'The effective Live session did not expose the reviewed instruction and tool bundle.',
    };
  }
  if (!exactlyMatches(tools, [...expected.tools])) {
    return {
      confirmed: false,
      reason: 'The effective Live tool bundle does not match the reviewed server-frozen bundle.',
    };
  }

  return { confirmed: true, reason: 'The effective Live session contract is confirmed.' };
}

export function isLiveToolName(value: unknown): value is LiveToolName {
  return typeof value === 'string' && LIVE_TOOL_NAMES.some((candidate) => candidate === value);
}

export function parseLiveFunctionCall(envelope: unknown): LiveFunctionCall | null {
  const event = unwrapResponseEvent(envelope);
  if (!event || event.type !== 'response.output_item.done') return null;
  const item = isJsonObject(event.item) ? event.item : null;
  if (!item || item.type !== 'function_call') return null;

  const callId = typeof item.call_id === 'string' ? item.call_id : '';
  const name = item.name;
  if (!callId || !isLiveToolName(name)) {
    throw new Error('Live returned an unreviewed function call.');
  }

  let argumentsValue: unknown;
  try {
    argumentsValue =
      typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments;
  } catch {
    throw new Error('Live returned invalid function-call arguments.');
  }
  if (!isJsonObject(argumentsValue)) {
    throw new Error('Live returned invalid function-call arguments.');
  }

  return { callId, name, arguments: argumentsValue };
}

export function functionCallOutputEvent(callId: string, output: JsonObject): JsonObject {
  return {
    type: 'response.item.create',
    item: {
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify(output),
    },
  };
}

export function responseCreateEvent(): JsonObject {
  return { type: 'response.create' };
}
