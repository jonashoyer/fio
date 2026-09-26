import assert from 'node:assert/strict';
import test from 'node:test';
import type { FioApiClient, JsonObject } from './fio-api-client';
import { LiveToolDispatcher } from './live-tool-dispatcher';
import type { Artifact, VoiceSessionContext } from './types';

const artifactId = '11111111-1111-4111-8111-111111111111';
const now = '2026-09-26T13:00:00.000Z';

void test('a Live function executes only after its matching completed response', async () => {
  const writes: { threadId: string; name: string; args: JsonObject }[] = [];
  const sent: JsonObject[] = [];
  const artifacts: Artifact[] = [{ id: artifactId, kind: 'notes', title: 'Maya',
    text: 'Thursday', createdAt: now, updatedAt: now }];
  const api = { invokeTool: async (threadId: string, name: string, args: JsonObject) => {
    writes.push({ threadId, name, args });
    return { artifact: { artifact_id: artifactId, title: 'Maya', kind: 'note', text: 'Friday',
      created_at: now, updated_at: now }, can_undo: true };
  } } as unknown as FioApiClient;
  const context = { getThreadId: () => 'thread-1', getThreadSnapshot: () => null,
    getSelectedArtifactId: () => artifactId, getArtifacts: () => artifacts,
    onFinalUserTranscript: async () => undefined, onFinalFioTranscript: async () => undefined,
    onPersistedArtifact: async (artifact: Artifact) => { artifacts[0] = artifact; },
    onSelectArtifact: () => undefined } satisfies VoiceSessionContext;
  const dispatcher = new LiveToolDispatcher(api, 'thread-1', context,
    { send: (event) => sent.push(event) }, () => true);
  const args = JSON.stringify({ operation_id: 'edit-1', artifact_id: artifactId, text: 'Friday' });
  dispatcher.handle({ type: 'session.delegation.created', delegation: {
    type: 'delegation', target: 'responses', id: 'delegation-1', response_id: 'response-1',
  } });
  dispatcher.handle({ type: 'response.event', delegation_id: 'delegation-1', event: {
    type: 'response.output_item.done', response_id: 'response-1', item: {
      type: 'function_call', status: 'completed', call_id: 'call-1', name: 'artifact_update', arguments: args,
    },
  } });
  assert.equal(writes.length, 0);
  dispatcher.handle({ type: 'response.event', delegation_id: 'wrong', event: {
    type: 'response.completed', response: { id: 'response-1', status: 'completed' },
  } });
  assert.equal(writes.length, 0);
  dispatcher.handle({ type: 'response.event', delegation_id: 'delegation-1', event: {
    type: 'response.completed', response: { id: 'response-1', status: 'completed', output: [{
      type: 'function_call', call_id: 'call-1', name: 'artifact_update', arguments: args,
    }] },
  } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { threadId: 'thread-1', name: 'artifact_update',
    args: { operation_id: 'edit-1', artifact_id: artifactId, text: 'Friday' } });
  assert.equal(artifacts[0].text, 'Friday');
  assert.equal(sent[0].type, 'response.item.create');
  assert.equal(sent[1].type, 'response.create');
});

void test('stopping a Live delegation before completion prevents the write', async () => {
  let writes = 0;
  const api = { invokeTool: async () => { writes++; return {}; } } as unknown as FioApiClient;
  const context = { getThreadId: () => 'thread-1', getThreadSnapshot: () => null,
    getSelectedArtifactId: () => null, getArtifacts: () => [],
    onFinalUserTranscript: async () => undefined, onFinalFioTranscript: async () => undefined,
    onPersistedArtifact: async () => undefined,
    onSelectArtifact: () => undefined } satisfies VoiceSessionContext;
  const dispatcher = new LiveToolDispatcher(api, 'thread-1', context, { send: () => undefined }, () => true);
  dispatcher.handle({ type: 'session.delegation.created', delegation: {
    type: 'delegation', target: 'responses', id: 'delegation-1', response_id: 'response-1',
  } });
  dispatcher.cancel();
  dispatcher.handle({ type: 'response.event', delegation_id: 'delegation-1', event: {
    type: 'response.completed', response: { id: 'response-1', status: 'completed' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(writes, 0);
});

void test('first voice artifact creates a saved backend thread before continuing', async () => {
  const sent: JsonObject[] = [];
  const calls: JsonObject[] = [];
  const artifacts: Artifact[] = [];
  let boundId = '';
  const serverThreadId = '22222222-2222-4222-8222-222222222222';
  const api = { createThread: async (operationId: string, title: string, initial: JsonObject) => {
    calls.push({ operationId, title, initial });
    return { thread: { thread_id: serverThreadId, artifacts: [{
      artifact_id: artifactId, title, text: 'A note from speech', kind: 'note',
      created_at: now, updated_at: now,
    }] } };
  } } as unknown as FioApiClient;
  const context = { getThreadId: () => artifacts.length ? 'local-1' : undefined,
    getThreadSnapshot: () => null, getSelectedArtifactId: () => null,
    getArtifacts: () => artifacts,
    onFinalUserTranscript: async () => undefined, onFinalFioTranscript: async () => undefined,
    onPersistedArtifact: async (artifact: Artifact) => { artifacts.push(artifact); },
    onSelectArtifact: () => undefined } satisfies VoiceSessionContext;
  const dispatcher = new LiveToolDispatcher(api, null, context, { send: (event) => sent.push(event) },
    () => true, async (threadId) => { boundId = threadId; });
  const args = JSON.stringify({ operation_id: 'first-voice-artifact',
    title: 'Spoken note', text: 'A note from speech' });
  dispatcher.handle({ type: 'session.delegation.created', delegation: {
    type: 'delegation', target: 'responses', id: 'delegation-1', response_id: 'response-1',
  } });
  dispatcher.handle({ type: 'response.event', delegation_id: 'delegation-1', event: {
    type: 'response.output_item.done', response_id: 'response-1', item: {
      type: 'function_call', call_id: 'call-1', name: 'artifact_create', arguments: args,
    },
  } });
  dispatcher.handle({ type: 'response.event', delegation_id: 'delegation-1', event: {
    type: 'response.completed', response: { id: 'response-1', status: 'completed' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls[0], { operationId: 'first-voice-artifact', title: 'Spoken note',
    initial: { type: 'artifact_create', kind: 'note', title: 'Spoken note', text: 'A note from speech' } });
  assert.equal(boundId, serverThreadId);
  assert.equal(artifacts[0].id, artifactId);
  assert.equal(sent[0].type, 'response.item.create');
  assert.equal(sent[1].type, 'response.create');
});

void test('new response.in_progress ID continues the same Live delegation after a tool result', async () => {
  const sent: JsonObject[] = [];
  const artifacts: Artifact[] = [];
  let selected: string | null = null;
  let writes = 0;
  const api = { invokeTool: async () => {
    writes++;
    return { artifact: { artifact_id: artifactId, title: 'Maya', kind: 'note',
      text: 'Friday', created_at: now, updated_at: now }, can_undo: false };
  } } as unknown as FioApiClient;
  const context = { getThreadId: () => 'local-1', getThreadSnapshot: () => null,
    getSelectedArtifactId: () => selected, getArtifacts: () => artifacts,
    onFinalUserTranscript: async () => undefined, onFinalFioTranscript: async () => undefined,
    onPersistedArtifact: async (artifact: Artifact) => { artifacts.push(artifact); },
    onSelectArtifact: (id: string) => { selected = id; } } satisfies VoiceSessionContext;
  const dispatcher = new LiveToolDispatcher(api, 'thread-1', context,
    { send: (event) => sent.push(event) }, () => true);
  const responseEvent = (nested: JsonObject) => ({ type: 'response.event',
    delegation_id: 'delegation-1', event: nested });
  dispatcher.handle({ type: 'session.delegation.created', delegation: {
    type: 'delegation', target: 'responses', id: 'delegation-1', response_id: 'response-1',
  } });
  dispatcher.handle(responseEvent({ type: 'response.output_item.done', response_id: 'response-1',
    item: { type: 'function_call', call_id: 'call-create', name: 'artifact_create',
      arguments: JSON.stringify({ operation_id: 'create-1', title: 'Maya', text: 'Friday' }) } }));
  dispatcher.handle(responseEvent({ type: 'response.completed', response: {
    id: 'response-1', status: 'completed' } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(writes, 1);
  assert.equal(sent[1].type, 'response.create');

  dispatcher.handle(responseEvent({ type: 'response.in_progress', response: {
    id: 'response-2', status: 'in_progress' } }));
  dispatcher.handle(responseEvent({ type: 'response.output_item.done', response_id: 'response-2',
    item: { type: 'function_call', call_id: 'call-select', name: 'artifact_select',
      arguments: JSON.stringify({ artifact_id: artifactId }) } }));
  dispatcher.handle(responseEvent({ type: 'response.completed', response: {
    id: 'response-2', status: 'completed' } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(selected, artifactId);
  assert.deepEqual(sent.map((event) => event.type), [
    'response.item.create', 'response.create', 'response.item.create', 'response.create',
  ]);
});
