import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import { createMastraAcpAgentHandler } from './adapter.js';
import type { MastraAcpAgentOptions } from './types.js';

export * from './types.js';
export * from './adapter.js';

export function createMastraAcpAgent(options: MastraAcpAgentOptions) {
  return (conn: AgentSideConnection) => createMastraAcpAgentHandler(conn, options);
}
