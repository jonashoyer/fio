import { FIO_LIVE_MODEL, type JsonObject, type JsonValue } from './fio-api-client';
import { REVIEWED_LIVE_CONTRACT } from './live-contract';

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
export type LiveContractStatus = 'confirmed' | 'awaiting' | 'unavailable';

export interface LiveContractCheck {
  confirmed: boolean;
  status: LiveContractStatus;
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

function awaiting(reason: string): LiveContractCheck {
  return { confirmed: false, status: 'awaiting', reason };
}

function unavailable(reason: string): LiveContractCheck {
  return { confirmed: false, status: 'unavailable', reason };
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Independently confirms the effective server-installed Live session configuration.
 * Only the embedded reviewed bundle is trusted; broker assertions and client/user text
 * never supply expected instructions or schemas.
 */
export function checkEffectiveLiveContract(
  envelope: unknown,
  brokerBackendModel: string,
): LiveContractCheck {
  if (!brokerBackendModel) {
    return unavailable('The broker did not provide its delegated backend model.');
  }

  const event = unwrapResponseEvent(envelope);
  if (!event || (event.type !== 'session.started' && event.type !== 'session.updated')) {
    return awaiting('Waiting for a complete Live session configuration event.');
  }
  if (!isJsonObject(event.session)) {
    return awaiting('The Live session configuration is incomplete.');
  }

  const session = event.session;
  if (
    !hasOwn(session, 'model') ||
    !hasOwn(session, 'instructions') ||
    !hasOwn(session, 'delegation')
  ) {
    return awaiting('The Live session configuration is incomplete.');
  }
  if (session.model !== GPT_LIVE_MODEL) {
    return unavailable('The effective session is not bound to GPT-Live-1.');
  }
  if (session.instructions !== REVIEWED_LIVE_CONTRACT.voiceInstructions) {
    return unavailable('The effective voice instructions drift from the reviewed bundle.');
  }
  if (!isJsonObject(session.delegation)) {
    return unavailable('The effective Live delegation configuration is invalid.');
  }

  const delegation = session.delegation;
  if (!hasOwn(delegation, 'type') || !hasOwn(delegation, 'responses')) {
    return awaiting('The Live delegation configuration is incomplete.');
  }
  if (delegation.type !== 'responses' || !isJsonObject(delegation.responses)) {
    return unavailable('The effective Live delegation type does not match the reviewed bundle.');
  }

  const responses = delegation.responses;
  const requiredResponseFields = [
    'model',
    'instructions',
    'tool_choice',
    'parallel_tool_calls',
    'tools',
  ] as const;
  if (requiredResponseFields.some((field) => !hasOwn(responses, field))) {
    return awaiting('The delegated Responses configuration is incomplete.');
  }
  if (responses.model !== brokerBackendModel) {
    return unavailable('The delegated Responses model differs from the broker backend model.');
  }
  if (responses.instructions !== REVIEWED_LIVE_CONTRACT.delegatedInstructions) {
    return unavailable('The delegated instructions drift from the reviewed bundle.');
  }
  if (responses.tool_choice !== 'auto') {
    return unavailable('The delegated tool choice does not match the reviewed bundle.');
  }
  if (responses.parallel_tool_calls !== false) {
    return unavailable('Parallel delegated tool calls are not allowed by the reviewed bundle.');
  }
  if (!Array.isArray(responses.tools)) {
    return unavailable('The effective Live tool bundle is invalid.');
  }
  if (!exactlyMatches(responses.tools, [...REVIEWED_LIVE_CONTRACT.tools])) {
    return unavailable('The effective Live tool bundle drifts from the reviewed bundle.');
  }

  return {
    confirmed: true,
    status: 'confirmed',
    reason: 'The effective Live session contract is confirmed.',
  };
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
