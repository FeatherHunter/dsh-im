import assert from 'node:assert/strict';
import test from 'node:test';

import { askInWorkspaceSession } from '../src/channels/shared/workspace-session.mjs';

function memoryState(initial = {}) {
  let sessions = { ...initial };
  const calls = { clears: 0, sets: 0 };
  return {
    sessionFor(key) { return sessions[key] ?? null; },
    async setSession(key, sessionId) {
      calls.sets += 1;
      sessions[key] = sessionId;
      return true;
    },
    async clearSession(key) {
      calls.clears += 1;
      delete sessions[key];
    },
    snapshot() { return { ...sessions }; },
    calls,
  };
}

function presetDeadError(code = 'agent-preset-unavailable', details) {
  const error = new Error('agent-presets: preset "code" not found');
  error.code = code;
  if (details) error.details = details;
  return error;
}

test('a reused Session with a dead preset is retired once and the message succeeds on a fresh Session', async () => {
  const state = memoryState({ chat: 'session-old' });
  const calls = [];
  let creations = 0;
  const harness = {
    workspaceSession(sessionId) {
      return {
        async sessionExists() { return true; },
        async ask(text) {
          calls.push(['ask', sessionId, text]);
          if (sessionId === 'session-old') throw presetDeadError();
          return 'healed answer';
        },
      };
    },
    async createSession() {
      creations += 1;
      calls.push(['create']);
      return 'session-new';
    },
  };

  const result = await askInWorkspaceSession({
    harness, state, key: 'chat', text: 'hello',
  });

  assert.deepEqual(result, { sessionId: 'session-new', answer: 'healed answer' });
  assert.deepEqual(state.snapshot(), { chat: 'session-new' });
  assert.equal(creations, 1);
  assert.equal(state.calls.clears, 1);
  assert.deepEqual(calls, [
    ['ask', 'session-old', 'hello'],
    ['create'],
    ['ask', 'session-new', 'hello'],
  ]);
});

test('a Host slash-code preset failure on a reused Session heals the same way', async () => {
  const state = memoryState({ chat: 'session-old' });
  const harness = {
    workspaceSession(sessionId) {
      return {
        async sessionExists() { return true; },
        async ask() {
          if (sessionId === 'session-old') {
            throw presetDeadError('agent-preset/not-found', { agentPreset: 'code' });
          }
          return 'healed answer';
        },
      };
    },
    async createSession() { return 'session-new'; },
  };

  const result = await askInWorkspaceSession({
    harness, state, key: 'chat', text: 'hello',
  });

  assert.deepEqual(result, { sessionId: 'session-new', answer: 'healed answer' });
  assert.equal(state.calls.clears, 1);
});

test('a preset failure on a freshly created Session is reported, not retried', async () => {
  const state = memoryState();
  let creations = 0;
  const harness = {
    workspaceSession() {
      return {
        async sessionExists() { return true; },
        async ask() { throw presetDeadError(); },
      };
    },
    async createSession() {
      creations += 1;
      return 'session-new';
    },
  };

  await assert.rejects(
    askInWorkspaceSession({ harness, state, key: 'chat', text: 'hello' }),
    (error) => error?.code === 'agent-preset-unavailable',
  );
  assert.equal(creations, 1);
  assert.equal(state.calls.clears, 0);
});

test('a non-preset ask failure on a reused Session is reported without touching the binding', async () => {
  const state = memoryState({ chat: 'session-old' });
  let creations = 0;
  const harness = {
    workspaceSession() {
      return {
        async sessionExists() { return true; },
        async ask() {
          const error = new Error('boom');
          error.code = 'turn-interrupted';
          throw error;
        },
      };
    },
    async createSession() {
      creations += 1;
      return 'session-new';
    },
  };

  await assert.rejects(
    askInWorkspaceSession({ harness, state, key: 'chat', text: 'hello' }),
    (error) => error?.code === 'turn-interrupted',
  );
  assert.equal(creations, 0);
  assert.equal(state.calls.clears, 0);
  assert.deepEqual(state.snapshot(), { chat: 'session-old' });
});

test('healing happens at most once: a second preset failure still surfaces', async () => {
  const state = memoryState({ chat: 'session-old' });
  let creations = 0;
  const harness = {
    workspaceSession() {
      return {
        async sessionExists() { return true; },
        async ask() { throw presetDeadError(); },
      };
    },
    async createSession() {
      creations += 1;
      return 'session-new-' + creations;
    },
  };

  await assert.rejects(
    askInWorkspaceSession({ harness, state, key: 'chat', text: 'hello' }),
    (error) => error?.code === 'agent-preset-unavailable',
  );
  assert.equal(creations, 1);
  assert.equal(state.calls.clears, 1);
});
