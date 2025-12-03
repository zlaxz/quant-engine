/**
 * MCP Client Manager for Quant-Engine
 *
 * Manages connections to MCP servers (Obsidian, Memory, etc.)
 * Exposes MCP tools for use by Gemini CIO and Claude Code CTO
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema
} from "@modelcontextprotocol/sdk/types.js";

interface MCPServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  connected: boolean;
}

interface MCPToolResult {
  success: boolean;
  content?: unknown;
  error?: string;
}

export class MCPClientManager {
  private servers: Map<string, MCPServer> = new Map();
  private vaultPath: string;

  constructor(vaultPath: string = '/Users/zstoc/ObsidianVault') {
    this.vaultPath = vaultPath;
  }

  /**
   * Connect to the Obsidian MCP server
   */
  async connectObsidian(): Promise<boolean> {
    if (this.servers.has('obsidian')) {
      const server = this.servers.get('obsidian')!;
      if (server.connected) {
        console.log('[MCP] Obsidian already connected');
        return true;
      }
    }

    try {
      console.log(`[MCP] Connecting to Obsidian MCP server (vault: ${this.vaultPath})...`);

      const transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', 'mcp-obsidian', this.vaultPath]
      });

      const client = new Client(
        { name: 'quant-engine', version: '1.0.0' },
        { capabilities: {} }
      );

      await client.connect(transport);

      this.servers.set('obsidian', {
        name: 'obsidian',
        client,
        transport,
        connected: true
      });

      console.log('[MCP] Obsidian MCP server connected successfully');
      return true;
    } catch (error) {
      console.error('[MCP] Failed to connect to Obsidian:', error);
      return false;
    }
  }

  /**
   * Connect to the Memory MCP server (knowledge graph)
   */
  async connectMemory(): Promise<boolean> {
    if (this.servers.has('memory')) {
      const server = this.servers.get('memory')!;
      if (server.connected) {
        console.log('[MCP] Memory already connected');
        return true;
      }
    }

    try {
      console.log('[MCP] Connecting to Memory MCP server...');

      const transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory']
      });

      const client = new Client(
        { name: 'quant-engine', version: '1.0.0' },
        { capabilities: {} }
      );

      await client.connect(transport);

      this.servers.set('memory', {
        name: 'memory',
        client,
        transport,
        connected: true
      });

      console.log('[MCP] Memory MCP server connected successfully');
      return true;
    } catch (error) {
      console.error('[MCP] Failed to connect to Memory:', error);
      return false;
    }
  }

  /**
   * Connect to all configured MCP servers
   */
  async connectAll(): Promise<{ obsidian: boolean; memory: boolean }> {
    const [obsidian, memory] = await Promise.all([
      this.connectObsidian(),
      this.connectMemory()
    ]);
    return { obsidian, memory };
  }

  /**
   * List available tools from a specific server
   */
  async listTools(serverName: string): Promise<unknown[]> {
    const server = this.servers.get(serverName);
    if (!server || !server.connected) {
      console.error(`[MCP] Server ${serverName} not connected`);
      return [];
    }

    try {
      const result = await server.client.request(
        { method: 'tools/list', params: {} },
        ListToolsResultSchema
      );
      return result.tools || [];
    } catch (error) {
      console.error(`[MCP] Failed to list tools for ${serverName}:`, error);
      return [];
    }
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const server = this.servers.get(serverName);
    if (!server || !server.connected) {
      return {
        success: false,
        error: `Server ${serverName} not connected`
      };
    }

    try {
      console.log(`[MCP] Calling ${serverName}/${toolName} with args:`, JSON.stringify(args).slice(0, 200));

      const result = await server.client.request(
        {
          method: 'tools/call',
          params: { name: toolName, arguments: args }
        },
        CallToolResultSchema
      );

      return {
        success: true,
        content: result.content
      };
    } catch (error) {
      console.error(`[MCP] Tool call failed ${serverName}/${toolName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Convenience methods for Obsidian operations
   */
  async obsidianReadNote(path: string): Promise<MCPToolResult> {
    return this.callTool('obsidian', 'read_note', { path });
  }

  async obsidianWriteNote(path: string, content: string): Promise<MCPToolResult> {
    return this.callTool('obsidian', 'write_note', { path, content });
  }

  async obsidianPatchNote(
    path: string,
    oldString: string,
    newString: string
  ): Promise<MCPToolResult> {
    return this.callTool('obsidian', 'patch_note', { path, oldString, newString });
  }

  async obsidianListDirectory(path: string = '/'): Promise<MCPToolResult> {
    return this.callTool('obsidian', 'list_directory', { path });
  }

  async obsidianSearchNotes(query: string, limit: number = 10): Promise<MCPToolResult> {
    return this.callTool('obsidian', 'search_notes', { query, limit });
  }

  /**
   * Convenience methods for Memory (knowledge graph) operations
   */
  async memoryCreateEntities(entities: Array<{
    name: string;
    entityType: string;
    observations: string[];
  }>): Promise<MCPToolResult> {
    return this.callTool('memory', 'create_entities', { entities });
  }

  async memoryCreateRelations(relations: Array<{
    from: string;
    to: string;
    relationType: string;
  }>): Promise<MCPToolResult> {
    return this.callTool('memory', 'create_relations', { relations });
  }

  async memorySearchNodes(query: string): Promise<MCPToolResult> {
    return this.callTool('memory', 'search_nodes', { query });
  }

  async memoryReadGraph(): Promise<MCPToolResult> {
    return this.callTool('memory', 'read_graph', {});
  }

  /**
   * Get connection status
   */
  getStatus(): { [key: string]: boolean } {
    const status: { [key: string]: boolean } = {};
    for (const [name, server] of this.servers) {
      status[name] = server.connected;
    }
    return status;
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    for (const [name, server] of this.servers) {
      if (server.connected) {
        try {
          await server.client.close();
          console.log(`[MCP] Disconnected from ${name}`);
        } catch (error) {
          console.error(`[MCP] Error disconnecting from ${name}:`, error);
        }
      }
    }
    this.servers.clear();
  }
}

// Singleton instance for use across the app
let mcpManagerInstance: MCPClientManager | null = null;

export function getMCPManager(vaultPath?: string): MCPClientManager {
  if (!mcpManagerInstance) {
    mcpManagerInstance = new MCPClientManager(vaultPath);
  }
  return mcpManagerInstance;
}

export async function initializeMCP(vaultPath?: string): Promise<MCPClientManager> {
  const manager = getMCPManager(vaultPath);
  await manager.connectAll();
  return manager;
}
