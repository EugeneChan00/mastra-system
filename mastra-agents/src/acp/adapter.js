import { mapMastraEventToSessionUpdates } from './event-mapper.js';

export class MastraAcpAdapter {
  sessions = new Map();

  newSession(sessionId) {
    const session = { sessionId, activePromptId: undefined, abortController: undefined };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) ?? this.newSession(sessionId);
  }

  cancel(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session?.abortController || session.abortController.signal.aborted) return { cancelled: false };
    session.abortController.abort();
    return { cancelled: true };
  }

  async prompt(sessionId, streamFactory) {
    const session = this.getSession(sessionId);
    const abortController = new AbortController();
    const promptId = Symbol('prompt');

    session.abortController = abortController;
    session.activePromptId = promptId;

    const updates = [];

    try {
      const stream = await streamFactory(abortController.signal);
      for await (const event of stream) {
        updates.push(...mapMastraEventToSessionUpdates(event));
      }
      return { stopReason: abortController.signal.aborted ? 'cancelled' : 'end_turn', updates };
    } catch (error) {
      if (abortController.signal.aborted) return { stopReason: 'cancelled', updates };
      updates.push({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `Stream error: ${error?.message ?? 'unknown error'}` },
      });
      return { stopReason: 'end_turn', updates, error: 'stream_failed' };
    } finally {
      const current = this.sessions.get(sessionId);
      if (current?.activePromptId === promptId) {
        current.abortController = undefined;
        current.activePromptId = undefined;
      }
    }
  }
}
