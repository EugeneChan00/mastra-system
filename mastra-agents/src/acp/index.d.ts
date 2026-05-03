export type MastraAcpSessionUpdate = Record<string, unknown>;

export type MastraAcpPromptResult = {
  stopReason: "cancelled" | "end_turn";
  updates: MastraAcpSessionUpdate[];
  error?: "stream_failed";
};

export declare class MastraAcpAdapter {
  sessions: Map<string, unknown>;
  newSession(sessionId: string): unknown;
  getSession(sessionId: string): unknown;
  cancel(sessionId: string): { cancelled: boolean };
  prompt(
    sessionId: string,
    streamFactory: (signal: AbortSignal) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>,
  ): Promise<MastraAcpPromptResult>;
}

export declare function mapMastraEventToSessionUpdates(event: unknown): MastraAcpSessionUpdate[];
