import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from '@mariozechner/jiti';

const jiti = createJiti(import.meta.url);
const { MastraAcpSessionStore } = await jiti.import('../../acp/session-store.ts');
const { buildConfigOptions } = await jiti.import('../../acp/config-options.ts');
const { mapMastraChunkToUpdates } = await jiti.import('../../acp/event-mapper.ts');

test('session store creates stable ACP defaults', () => {
  const store = new MastraAcpSessionStore();
  const session = store.create({ sessionId: 'sess1', agentId: 'supervisor-agent', cwd: '/tmp/project' });
  assert.equal(session.threadId, 'acp:sess1:supervisor-agent');
  assert.match(session.resourceId, /^acp:[a-f0-9]{12}$/);
});

test('config options expose mode/model/thinking categories', () => {
  const options = buildConfigOptions({ sessionId:'x', agentId:'a', cwd:'/', threadId:'t', resourceId:'r', createdAt:'', updatedAt:'' });
  assert.deepEqual(options.map((o) => o.category), ['mode','model','thought_level']);
});

test('mastra chunk mapper emits text, reasoning, tool and usage updates', () => {
  assert.equal(mapMastraChunkToUpdates({ type:'text-delta', text:'hi' })[0].sessionUpdate, 'agent_message_chunk');
  assert.equal(mapMastraChunkToUpdates({ type:'reasoning-delta', text:'hmm' })[0].sessionUpdate, 'agent_thought_chunk');
  assert.equal(mapMastraChunkToUpdates({ type:'tool-result', payload:{ toolCallId:'1', toolName:'workspace.read-file', result:'ok' } })[0].sessionUpdate, 'tool_call_update');
  assert.equal(mapMastraChunkToUpdates({ type:'finish', usage:{ inputTokens:1 } })[0].sessionUpdate, 'usage_update');
});
