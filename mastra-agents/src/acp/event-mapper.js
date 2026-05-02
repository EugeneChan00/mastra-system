function getUsageFromEvent(event) {
  if (event?.usage && typeof event.usage === 'object') return event.usage;

  const usage = {
    inputTokens: event?.inputTokens,
    outputTokens: event?.outputTokens,
    thoughtTokens: event?.thoughtTokens,
    totalTokens: event?.totalTokens,
  };

  return Object.values(usage).some(value => typeof value === 'number') ? usage : undefined;
}

function getToolStatus(event) {
  if (event?.status) return event.status;
  switch (event?.type) {
    case 'tool-error':
      return 'failed';
    case 'tool-result':
      return 'completed';
    default:
      return 'in_progress';
  }
}

export function mapMastraEventToSessionUpdates(event) {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') return [];

  if (event.type === 'text-delta' && event.text) {
    return [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: event.text } }];
  }

  if (event.type === 'reasoning-delta' && event.text) {
    return [{ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: event.text } }];
  }

  if (event.type === 'usage' || event.type === 'finish') {
    const usage = getUsageFromEvent(event);
    if (usage) return [{ sessionUpdate: 'usage_update', usage }];
  }

  if (event.type.startsWith('tool-')) {
    return [{
      sessionUpdate: 'tool_call_update',
      toolCallId: event.toolCallId,
      status: getToolStatus(event),
      content: {
        type: 'tool_call',
        toolCallId: event.toolCallId,
        name: event.name,
        kind: event.kind,
        args: event.args,
        result: event.result,
        error: event.error,
      },
      toolCall: {
        id: event.toolCallId,
        name: event.name,
        kind: event.kind,
        input: event.args,
        output: event.result,
        error: event.error,
      },
    }];
  }

  return [];
}
