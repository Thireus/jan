/**
 * MCP Web Extension
 * Provides Model Context Protocol functionality for web platform
 * Uses official MCP TypeScript SDK with proper session handling
 */

import { MCPExtension, MCPTool, MCPToolCallResult, MCPToolComponentProps } from '@janhq/core'
import { getSharedAuthService, JanAuthService } from '../shared'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { JanMCPOAuthProvider } from './oauth-provider'
import { WebSearchButton } from './components'
import type { ComponentType } from 'react'

// JAN_BASE_URL is defined in vite.config.ts (defaults to 'https://api-dev.jan.ai/v1')
declare const JAN_BASE_URL: string
declare const JAN_WEB_EXTENSION_URL: string

interface MCPServerConfig {
  id: string
  url: URL
  displayName: string
  requiresAuth: boolean
}

interface MCPServerState {
  client: Client | null
  initialized: boolean
  tools: MCPTool[]
}

export default class MCPExtensionWeb extends MCPExtension {
  private readonly defaultMcpEndpoint = '/mcp'
  private readonly defaultServerName = 'Jan MCP Server'
  private readonly serverConfigs: MCPServerConfig[]
  private readonly serverConfigMap: Map<string, MCPServerConfig>
  private readonly serverStates: Map<string, MCPServerState>
  private readonly toolNameToServerId = new Map<string, string>()
  private tools: MCPTool[] = []
  private initialized = false
  private authService: JanAuthService
  private oauthProvider: JanMCPOAuthProvider

  constructor(
    url: string,
    name: string,
    productName?: string,
    active?: boolean,
    description?: string,
    version?: string
  ) {
    super(url, name, productName, active, description, version)
    this.authService = getSharedAuthService()
    this.oauthProvider = new JanMCPOAuthProvider(this.authService)
    this.serverConfigs = this.buildServerConfigs()
    this.serverConfigMap = new Map(this.serverConfigs.map((config) => [config.id, config]))
    this.serverStates = new Map(
      this.serverConfigs.map((config) => [
        config.id,
        {
          client: null,
          initialized: false,
          tools: [],
        },
      ])
    )
  }

  async onLoad(): Promise<void> {
    try {
      await this.initializeServers()
    } catch (error) {
      console.warn('Failed to initialize MCP extension:', error)
      this.tools = []
    }
  }

  async onUnload(): Promise<void> {
    this.initialized = false
    this.tools = []
    this.toolNameToServerId.clear()

    for (const [serverId, state] of this.serverStates) {
      if (state.client) {
        try {
          await state.client.close()
        } catch (error) {
          const serverName = this.serverConfigMap.get(serverId)?.displayName ?? serverId
          console.warn(`Error closing MCP client for ${serverName}:`, error)
        }
      }

      state.client = null
      state.initialized = false
      state.tools = []
    }
  }

  async getTools(): Promise<MCPTool[]> {
    if (!this.initialized) {
      await this.initializeServers()
    }
    return this.tools
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    if (!toolName) {
      return {
        error: 'Tool name must be provided',
        content: [{ type: 'text', text: 'Tool name must be provided' }],
      }
    }

    if (!this.initialized) {
      try {
        await this.initializeServers()
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          error: errorMessage,
          content: [{ type: 'text', text: `MCP client not initialized: ${errorMessage}` }],
        }
      }
    }

    const serverId = this.findServerForTool(toolName)
    if (!serverId) {
      const message = `Tool '${toolName}' not found in any MCP server`
      return {
        error: message,
        content: [{ type: 'text', text: message }],
      }
    }

    const config = this.serverConfigMap.get(serverId)
    let state = this.serverStates.get(serverId)
    if (!config || !state) {
      const message = `MCP server configuration missing for tool '${toolName}'`
      return {
        error: message,
        content: [{ type: 'text', text: message }],
      }
    }

    if (!state.initialized || !state.client) {
      try {
        await this.initializeServer(config)
        state = this.serverStates.get(serverId)
        this.tools = this.collectToolsFromStates()
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          error: errorMessage,
          content: [{ type: 'text', text: errorMessage }],
        }
      }
    }

    const client = state?.client
    if (!client) {
      const message = `MCP client for server '${config.displayName}' not available`
      return {
        error: message,
        content: [{ type: 'text', text: message }],
      }
    }

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args,
      })

      console.log(`MCP tool call result for ${toolName} (${config.displayName}):`, result)

      if (result.isError) {
        const errorText =
          Array.isArray(result.content) && result.content.length > 0
            ? result.content[0].type === 'text'
              ? (result.content[0] as any).text
              : 'Tool call failed'
            : 'Tool call failed'

        return {
          error: errorText,
          content: [{ type: 'text', text: errorText }],
        }
      }

      const content = Array.isArray(result.content)
        ? result.content.map((item) => {
            if (item.type === 'text') {
              return { type: 'text' as const, text: (item as any).text }
            }
            return { type: 'text' as const, text: JSON.stringify(item) }
          })
        : [{ type: 'text' as const, text: 'No content returned' }]

      return {
        error: '',
        content,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(
        `Failed to call MCP tool ${toolName} on ${config.displayName}:`,
        error
      )

      return {
        error: errorMessage,
        content: [{ type: 'text', text: errorMessage }],
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.initialized) {
      try {
        await this.initializeServers()
      } catch (error) {
        console.warn('MCP health check encountered initialization error:', error)
      }
    }

    return Array.from(this.serverStates.values()).some((state) => state.initialized)
  }

  async getConnectedServers(): Promise<string[]> {
    if (!this.initialized) {
      try {
        await this.initializeServers()
      } catch (error) {
        console.warn('Failed to refresh MCP servers list:', error)
      }
    }

    return this.serverConfigs
      .filter((config) => this.serverStates.get(config.id)?.initialized)
      .map((config) => config.displayName)
  }

  async refreshTools(): Promise<void> {
    this.initialized = false
    for (const state of this.serverStates.values()) {
      state.initialized = false
      state.tools = []
    }

    try {
      await this.initializeServers()
    } catch (error) {
      console.error('Failed to refresh tools:', error)
      throw error
    }
  }

  /**
   * Provides a custom UI component for web search tools
   * @returns The WebSearchButton component
   */
  getToolComponent(): ComponentType<MCPToolComponentProps> | null {
    return WebSearchButton
  }

  /**
   * Returns the list of tool names that should be disabled by default for new users
   * All MCP web tools are disabled by default to prevent accidental API usage
   * @returns Array of tool names to disable by default
   */
  async getDefaultDisabledTools(): Promise<string[]> {
    try {
      const tools = await this.getTools()
      return tools.map((tool) => tool.name)
    } catch (error) {
      console.error('Failed to get default disabled tools:', error)
      return []
    }
  }

  private buildServerConfigs(): MCPServerConfig[] {
    const configs: MCPServerConfig[] = []
    const defaultUrl = new URL(`${JAN_BASE_URL}${this.defaultMcpEndpoint}`)

    configs.push({
      id: 'default',
      url: defaultUrl,
      displayName: this.defaultServerName,
      requiresAuth: true,
    })

    const additionalUrl = (JAN_WEB_EXTENSION_URL || '').trim()
    if (additionalUrl.length > 0) {
      try {
        const targetUrl = new URL(additionalUrl)
        const defaultUrlString = defaultUrl.toString()

        if (targetUrl.toString() !== defaultUrlString) {
          configs.push({
            id: `custom-${configs.length}`,
            url: targetUrl,
            displayName: this.createDisplayName(targetUrl),
            requiresAuth: this.shouldUseAuthForTarget(targetUrl, defaultUrl),
          })
        }
      } catch (error) {
        console.warn('Invalid JAN_WEB_EXTENSION_URL provided, ignoring additional MCP server:', error)
      }
    }

    return configs
  }

  private shouldUseAuthForTarget(target: URL, defaultUrl: URL): boolean {
    // Only reuse Jan OAuth when the host matches the default JAN_BASE_URL host
    return target.origin === defaultUrl.origin
  }

  private createDisplayName(_url: URL): string {
    return 'Jan Extension MCP Server'
  }

  private async initializeServers(): Promise<void> {
    let initializedAny = false

    for (const config of this.serverConfigs) {
      try {
        const success = await this.initializeServer(config)
        initializedAny = initializedAny || success
      } catch (error) {
        console.warn(`Failed to initialize MCP server '${config.displayName}':`, error)
      }
    }

    this.tools = this.collectToolsFromStates()
    this.initialized = initializedAny

    if (!initializedAny) {
      throw new Error('Failed to initialize any MCP servers')
    }
  }

  private async initializeServer(config: MCPServerConfig): Promise<boolean> {
    const state = this.serverStates.get(config.id)
    if (!state) {
      return false
    }

    if (state.client) {
      try {
        await state.client.close()
      } catch (error) {
        console.warn(`Error closing existing MCP client for ${config.displayName}:`, error)
      }
    }

    state.client = null
    state.initialized = false
    state.tools = []

    const transportOptions = config.requiresAuth
      ? { authProvider: this.oauthProvider }
      : {}
    const transport = new StreamableHTTPClientTransport(config.url, transportOptions)
    const client = this.createClient()

    try {
      await client.connect(transport)
      const toolsResult = await client.listTools()

      const tools = Array.isArray(toolsResult.tools)
        ? toolsResult.tools.map((tool) => ({
            name: tool.name,
            description: tool.description || '',
            inputSchema: (tool.inputSchema || {}) as Record<string, unknown>,
            server: config.displayName,
          }))
        : []

      state.client = client
      state.tools = tools
      state.initialized = true

      console.log(
        `MCP client connected for ${config.displayName}, total tools: ${tools.length}`
      )
      return true
    } catch (error) {
      console.error(`Failed to initialize MCP client for ${config.displayName}:`, error)
      try {
        await client.close()
      } catch (closeError) {
        console.warn(`Error closing MCP client after failure for ${config.displayName}:`, closeError)
      }
      state.client = null
      state.initialized = false
      state.tools = []
      throw error
    }
  }

  private collectToolsFromStates(): MCPTool[] {
    const aggregated: MCPTool[] = []
    this.toolNameToServerId.clear()

    for (const config of this.serverConfigs) {
      const state = this.serverStates.get(config.id)
      if (!state || !state.initialized) {
        continue
      }

      aggregated.push(...state.tools)

      for (const tool of state.tools) {
        if (!this.toolNameToServerId.has(tool.name)) {
          this.toolNameToServerId.set(tool.name, config.id)
        }
      }
    }

    console.log(
      'Available MCP tools:',
      aggregated.map((tool) => ({
        name: tool.name,
        server: tool.server,
      }))
    )

    return aggregated
  }

  private createClient(): Client {
    return new Client(
      {
        name: 'jan-web-client',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {},
        },
      }
    )
  }

  private findServerForTool(toolName: string): string | undefined {
    const mappedServer = this.toolNameToServerId.get(toolName)
    if (mappedServer) {
      return mappedServer
    }

    for (const [serverId, state] of this.serverStates.entries()) {
      if (state.tools.some((tool) => tool.name === toolName)) {
        this.toolNameToServerId.set(toolName, serverId)
        return serverId
      }
    }

    return undefined
  }
}
