/**
 * @mastrasystem/paseo — Custom adapter (Paseto/Paseo) entry point.
 * TODO: implement Paseto/Paseo adapter for remote Mastra agent communication.
 */
export interface PaseoAdapter {
  connect(agentId: string): Promise<void>;
  send(message: unknown): Promise<void>;
  receive(): Promise<unknown>;
  disconnect(): Promise<void>;
}
