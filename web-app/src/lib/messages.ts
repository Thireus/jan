/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChatCompletionMessageParam } from 'token.js'
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources'
import { ThreadMessage, ContentType } from '@janhq/core'
import { removeReasoningContent } from '@/utils/reasoning'
// Attachments are now handled upstream in newUserThreadContent

type ThreadContent = NonNullable<ThreadMessage['content']>[number]

// Define a temporary type for the expected tool result shape (ToolResult as before)
export type ToolResult = {
  content: Array<{
    type?: string
    text?: string
    data?: string
    image_url?: { url: string; detail?: string }
  }>
  error?: string
}

// Helper function to convert the tool's output part into an API content part
const convertToolPartToApiContentPart = (part: ToolResult['content'][0]) => {
  if (part.text) {
    return { type: 'text', text: part.text }
  }

  // Handle base64 image data
  if (part.data) {
    // Assume default image type, though a proper tool should return the mime type
    const mimeType =
      part.type === 'image' ? 'image/png' : part.type || 'image/png'
    const dataUrl = `data:${mimeType};base64,${part.data}`

    return {
      type: 'image_url',
      image_url: {
        url: dataUrl,
        detail: 'auto',
      },
    }
  }

  // Handle pre-formatted image URL
  if (part.image_url) {
    return { type: 'image_url', image_url: part.image_url }
  }

  // Fallback to text stringification for structured but unhandled data
  return { type: 'text', text: JSON.stringify(part) }
}

/**
 * @fileoverview Helper functions for creating chat completion request.
 * These functions are used to create chat completion request objects
 */
export class CompletionMessagesBuilder {
  private messages: ChatCompletionMessageParam[] = []
  private readonly includeFullContext: boolean

  constructor(
    messages: ThreadMessage[],
    systemInstruction?: string,
    includeFullContext = false
  ) {
    this.includeFullContext = includeFullContext
    if (systemInstruction) {
      this.messages.push({
        role: 'system',
        content: systemInstruction,
      })
    }

    const filtered = messages.filter((e) => !e.metadata?.error)
    for (const msg of filtered) {
      if (msg.role === 'assistant') {
        const textValue = msg.content?.[0]?.text?.value || '.'
        const calls = this.includeFullContext
          ? this.mapToolCallsFromMetadata(msg)
          : undefined
        this.addAssistantMessage(textValue, undefined, calls)
        if (this.includeFullContext) this.appendHistoricalToolMessagesFromMetadata(msg)
        continue
      }

      const param = this.toCompletionParamFromThread(msg)
      if (param.role === 'user' && typeof param.content === 'string' && param.content === '') {
        this.messages.push({ ...param, content: '.' })
      } else {
        this.messages.push(param)
      }
    }
  }

  // Normalize a ThreadMessage into a ChatCompletionMessageParam for Token.js
  private toCompletionParamFromThread(
    msg: ThreadMessage
  ): ChatCompletionMessageParam {
    if (msg.role === 'assistant') {
      const textValue = msg.content?.[0]?.text?.value || '.'
      return {
        role: 'assistant',
        content: this.includeFullContext
          ? textValue
          : removeReasoningContent(textValue),
      } as ChatCompletionMessageParam
    }

    // System messages are uncommon here; normalize to plain text
    if (msg.role === 'system') {
      return {
        role: 'system',
        content: msg.content?.[0]?.text?.value || '.',
      } as ChatCompletionMessageParam
    }

    // User messages: handle multimodal content
    if (Array.isArray(msg.content) && msg.content.length > 1) {
      const content = msg.content.map((part: ThreadContent) => {
        if (part.type === ContentType.Text) {
          return { type: 'text' as const, text: part.text?.value ?? '' }
        }
        if (part.type === ContentType.Image) {
          return {
            type: 'image_url' as const,
            image_url: {
              url: part.image_url?.url || '',
              detail: part.image_url?.detail || 'auto',
            },
          }
        }
        // Fallback for unknown content types
        return { type: 'text' as const, text: '' }
      })
      return { role: 'user', content } as ChatCompletionMessageParam
    }
    // Single text part
    const text = msg?.content?.[0]?.text?.value ?? '.'
    return { role: 'user', content: text }
  }

  // Build ChatCompletionMessageToolCall[] from historical metadata
  private mapToolCallsFromMetadata(
    msg: ThreadMessage
  ): ChatCompletionMessageToolCall[] | undefined {
    try {
      const toolCallsMeta = (msg as any)?.metadata?.tool_calls
      if (!Array.isArray(toolCallsMeta) || toolCallsMeta.length === 0) return undefined
      const calls = toolCallsMeta
        .map((entry: any) => {
          const tool = entry?.tool ?? entry
          const fn = tool?.function
          const id = tool?.id ?? entry?.id
          if (!id || !fn?.name) return null
          const args =
            typeof fn.arguments === 'string'
              ? fn.arguments
              : JSON.stringify(fn.arguments ?? '')
          return {
            id,
            type: 'function',
            function: { name: fn.name, arguments: args },
          } as ChatCompletionMessageToolCall
        })
        .filter(Boolean) as ChatCompletionMessageToolCall[]
      return calls.length ? calls : undefined
    } catch (e) {
      void e
      return undefined
    }
  }

  // Append historical tool result messages based on metadata ordering
  private appendHistoricalToolMessagesFromMetadata(msg: ThreadMessage): void {
    try {
      const callsMeta: any[] = (msg as any)?.metadata?.tool_calls
      if (!Array.isArray(callsMeta) || callsMeta.length === 0) return
      for (const entry of callsMeta) {
        if (entry?.state && entry.state !== 'ready') continue
        const response = entry?.response
        const toolId = entry?.tool?.id || entry?.id || `tool_${this.messages.length}`
        if (response && toolId) {
          this.addToolMessage(response as ToolResult | string, toolId)
        }
      }
    } catch (e) {
      void e
    }
  }

  /**
   * Add a user message to the messages array from a parsed ThreadMessage.
   * Upstream code should construct the message via newUserThreadContent
   * and pass it here to avoid duplicated logic.
   */
  addUserMessage(message: ThreadMessage) {
    if (message.role !== 'user') {
      throw new Error('addUserMessage expects a user ThreadMessage')
    }
    // Ensure no consecutive user messages
    if (this.messages[this.messages.length - 1]?.role === 'user') {
      this.messages.pop()
    }
    this.messages.push(this.toCompletionParamFromThread(message))
  }

  /**
   * Add an assistant message to the messages array.
   * @param content - The content of the assistant message.
   * @param refusal - Optional refusal message.
   * @param calls - Optional tool calls associated with the message.
   */
  addAssistantMessage(
    content: string,
    refusal?: string,
    calls?: ChatCompletionMessageToolCall[]
  ) {
    this.messages.push({
      role: 'assistant',
      content: this.includeFullContext
        ? content
        : removeReasoningContent(content),
      ...(refusal !== undefined ? { refusal } : {}),
      ...(calls !== undefined ? { tool_calls: calls } : {}),
    } as ChatCompletionAssistantMessageParam)
  }

  /**
   * Add a tool message to the messages array.
   * @param content - The content of the tool message (string or ToolResult object).
   * @param toolCallId - The ID of the tool call associated with the message.
   */
  addToolMessage(result: string | ToolResult, toolCallId: string) {
    let content: string | any[] = ''

    // Handle simple string case
    if (typeof result === 'string') {
      content = result
    } else {
      // Check for multimodal content (more than just a simple text string)
      const hasMultimodalContent = result.content?.some(
        (p) => p.data || p.image_url
      )

      if (hasMultimodalContent) {
        // Build the structured content array
        content = result.content.map(convertToolPartToApiContentPart)
      } else if (result.content?.[0]?.text) {
        // Standard text case
        content = result.content[0].text
      } else if (result.error) {
        // Error case
        content = `Tool execution failed: ${result.error}`
      } else {
        // Fallback: serialize the whole result structure if content is unexpected
        try {
          content = JSON.stringify(result)
        } catch {
          content = 'Tool call completed, unexpected output format.'
        }
      }
    }
    this.messages.push({
      role: 'tool',
      // for role 'tool',  need to use 'as ChatCompletionMessageParam'
      content: content as any,
      tool_call_id: toolCallId,
    })
  }

  /**
   * Return the messages array.
   * @returns The array of chat completion messages.
   */
  getMessages(): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = []
    let prevRole: string | undefined

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i]

      // Handle first message
      if (i === 0) {
        if (msg.role === 'user') {
          result.push(msg)
          prevRole = msg.role
          continue
        } else if (msg.role === 'system') {
          result.push(msg)
          prevRole = msg.role
          // Check next message
          const nextMsg = this.messages[i + 1]
          if (!nextMsg || nextMsg.role !== 'user') {
            result.push({ role: 'user', content: '.' })
            prevRole = 'user'
          }
          continue
        } else {
          // First message is not user or system — insert user message
          result.push({ role: 'user', content: '.' })
          result.push(msg)
          prevRole = msg.role
          continue
        }
      }

      // Avoid consecutive same roles
      if (msg.role === prevRole) {
        const oppositeRole = prevRole === 'assistant' ? 'user' : 'assistant'
        result.push({ role: oppositeRole, content: '.' })
        prevRole = oppositeRole
      }
      result.push(msg)
      prevRole = msg.role
    }

    return result
  }
}
