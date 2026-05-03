import test from 'node:test';
import assert from 'node:assert/strict';
import { MastraAcpAdapter } from '../../src/acp/adapter.js';
import { mapMastraEventToSessionUpdates } from '../../src/acp/event-mapper.js';

test('cancel returns cancelled true when prompt aborted', async () => {
  const adapter = new MastraAcpAdapter();
  const p = adapter.prompt('s1', async function* (signal) {
    yield { type: 'text-delta', text: 'hi' };
    await new Promise(r => setTimeout(r, 50));
    if (signal.aborted) throw new Error('aborted');
    yield { type: 'text-delta', text: 'after' };
  });
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(adapter.cancel('s1'), { cancelled: true });
  const res = await p;
  assert.equal(res.stopReason, 'cancelled');
});

test('cancel returns cancelled false without active prompt', () => {
  const adapter = new MastraAcpAdapter();
  adapter.newSession('s0');
  assert.deepEqual(adapter.cancel('s0'), { cancelled: false });
});

test('prompt handles stream failure without throwing', async () => {
  const adapter = new MastraAcpAdapter();
  const res = await adapter.prompt('s2', async function* () {
    throw new Error('network down');
  });
  assert.equal(res.error, 'stream_failed');
  assert.equal(res.stopReason, 'end_turn');
  assert.match(res.updates.at(-1).content.text, /network down/);
});

test('finish usage maps from token fields', () => {
  const updates = mapMastraEventToSessionUpdates({ type: 'finish', inputTokens: 1, outputTokens: 2, totalTokens: 3 });
  assert.equal(updates[0].sessionUpdate, 'usage_update');
  assert.equal(updates[0].usage.outputTokens, 2);
});

test('tool call update keeps structured content', () => {
  const updates = mapMastraEventToSessionUpdates({ type: 'tool-result', toolCallId: 'tc1', name: 'workspace.read-file', args: { path: 'a' }, result: 'ok' });
  assert.equal(updates[0].sessionUpdate, 'tool_call_update');
  assert.equal(updates[0].toolCall.id, 'tc1');
  assert.deepEqual(updates[0].toolCall.input, { path: 'a' });
  assert.deepEqual(updates[0].content.args, { path: 'a' });
});

test('invalid events are ignored', () => {
  assert.deepEqual(mapMastraEventToSessionUpdates(null), []);
  assert.deepEqual(mapMastraEventToSessionUpdates({}), []);
});
