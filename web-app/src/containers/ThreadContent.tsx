/* eslint-disable @typescript-eslint/no-explicit-any */
import { ThreadMessage } from '@janhq/core'
import { RenderMarkdown } from './RenderMarkdown'
import React, { Fragment, memo, useCallback, useMemo, useState } from 'react'
import { IconCopy, IconCopyCheck, IconRefresh } from '@tabler/icons-react'
import { useAppState } from '@/hooks/useAppState'
import { cn } from '@/lib/utils'
import { useMessages } from '@/hooks/useMessages'
import ThinkingBlock from '@/containers/ThinkingBlock'
// import ToolCallBlock from '@/containers/ToolCallBlock'
import { useChat } from '@/hooks/useChat'
import {
  EditMessageDialog,
  MessageMetadataDialog,
  DeleteMessageDialog,
} from '@/containers/dialogs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatDate } from '@/utils/formatDate'
import { AvatarEmoji } from '@/containers/AvatarEmoji'

import TokenSpeedIndicator from '@/containers/TokenSpeedIndicator'

import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { extractFilesFromPrompt } from '@/lib/fileMetadata'
import { createImageAttachment } from '@/types/attachment'

// Define ToolCall interface for type safety when accessing metadata
interface ToolCall {
  tool?: {
    id: number
    function?: {
      name: string
      arguments?: object | string
    }
  }
  response?: any
  state?: 'pending' | 'completed'
}

// Define ReActStep type (Reasoning-Action Step)
type ReActStep = {
  type: 'reasoning' | 'tool_call' | 'tool_output' | 'done'
  content: string
  metadata?: any
  time?: number
}

const cleanReasoning = (content: string) => {
  return content
    .replace(/^<think>/, '') // Remove opening tag at start
    .replace(/<\/think>$/, '') // Remove closing tag at end
    .trim()
}

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      className="flex items-center gap-1 hover:text-accent transition-colors group relative cursor-pointer"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <IconCopyCheck size={16} className="text-accent" />
          <span className="opacity-100">{t('copied')}</span>
        </>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconCopy size={16} />
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('copy')}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </button>
  )
}

// Use memo to prevent unnecessary re-renders, but allow re-renders when props change
export const ThreadContent = memo(
  (
    item: ThreadMessage & {
      isLastMessage?: boolean
      index?: number
      showAssistant?: boolean
      streamingThread?: string

      streamTools?: any
      contextOverflowModal?: React.ReactNode | null
      updateMessage?: (
        item: ThreadMessage,
        message: string,
        imageUrls?: string[]
      ) => void
    }
  ) => {
    const { t } = useTranslation()
    const selectedModel = useModelProvider((state) => state.selectedModel)

    // Use useMemo to stabilize the components prop
    const linkComponents = useMemo(
      () => ({
        a: ({ ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
      }),
      []
    )
    const image = useMemo(() => item.content?.[0]?.image_url, [item])
    // Only check if streaming is happening for this thread, not the content itself
    const isStreamingThisThread = useAppState(
      (state) => state.streamingContent?.thread_id === item.thread_id
    )

    const text = useMemo(
      () => item.content.find((e) => e.type === 'text')?.text?.value ?? '',
      [item.content]
    )

    // Extract file metadata from user message text
    const { files: attachedFiles, cleanPrompt } = useMemo(() => {
      if (item.role === 'user') {
        return extractFilesFromPrompt(text)
      }
      return { files: [], cleanPrompt: text }
    }, [text, item.role])

    const {
      finalOutputText,
      streamedReasoningText,
      isReasoningActiveLoading,
      hasReasoningSteps,
    } = useMemo(() => {
      // With the streaming functions updated, the text variable now only contains the final output.
      const currentFinalText = text.trim()
      const currentReasoning = '' // Reasoning is now only derived from streamEvents/allSteps

      // Check for tool calls or reasoning events in metadata to determine steps/loading
      const isToolCallsPresent = !!(
        item.metadata &&
        'tool_calls' in item.metadata &&
        Array.isArray(item.metadata.tool_calls) &&
        item.metadata.tool_calls.length > 0
      )

      // Check for any reasoning chunks in the streamEvents
      const hasReasoningEvents = !!(
        item.metadata &&
        'streamEvents' in item.metadata &&
        Array.isArray(item.metadata.streamEvents) &&
        item.metadata.streamEvents.some(
          (e: StreamEvent) => e.type === 'reasoning_chunk'
        )
      )

      const hasSteps = isToolCallsPresent || hasReasoningEvents

      // Loading if streaming, no final output yet, but we expect steps (reasoning or tool calls)
      const loading =
        isStreamingThisThread && currentFinalText.length === 0 && hasSteps

      return {
        finalOutputText: currentFinalText,
        streamedReasoningText: currentReasoning,
        isReasoningActiveLoading: loading,
        hasReasoningSteps: hasSteps,
      }
    }, [item.metadata, text, isStreamingThisThread])

    const isToolCalls =
      item.metadata &&
      'tool_calls' in item.metadata &&
      Array.isArray(item.metadata.tool_calls) &&
      item.metadata.tool_calls.length

    const getMessages = useMessages((state) => state.getMessages)
    const deleteMessage = useMessages((state) => state.deleteMessage)
    const sendMessage = useChat()

    const regenerate = useCallback(() => {
      // Only regenerate assistant message is allowed
      deleteMessage(item.thread_id, item.id)
      const threadMessages = getMessages(item.thread_id)
      let toSendMessage = threadMessages.pop()
      while (toSendMessage && toSendMessage?.role !== 'user') {
        deleteMessage(toSendMessage.thread_id, toSendMessage.id ?? '')
        toSendMessage = threadMessages.pop()
      }
      if (toSendMessage) {
        deleteMessage(toSendMessage.thread_id, toSendMessage.id ?? '')
        // Extract text content and any attachments
        const rawText =
          toSendMessage.content?.find((c) => c.type === 'text')?.text?.value ||
          ''
        const { cleanPrompt: textContent } = extractFilesFromPrompt(rawText)
        const attachments = toSendMessage.content
          ?.filter((c) => (c.type === 'image_url' && c.image_url?.url) || false)
          .map((c) => {
            if (c.type === 'image_url' && c.image_url?.url) {
              const url = c.image_url.url
              const [mimeType, base64] = url
                .replace('data:', '')
                .split(';base64,')
              return createImageAttachment({
                name: 'image', // Original filename unavailable
                mimeType,
                size: 0,
                base64: base64,
                dataUrl: url,
              })
            }
            return null
          })
          .filter((v) => v !== null)
        // Keep embedded document metadata in the message for regenerate
        sendMessage(textContent, true, attachments)
      }
    }, [deleteMessage, getMessages, item, sendMessage])

    const removeMessage = useCallback(() => {
      if (
        item.index !== undefined &&
        (item.role === 'assistant' || item.role === 'tool')
      ) {
        const threadMessages = getMessages(item.thread_id).slice(
          0,
          item.index + 1
        )
        let toSendMessage = threadMessages.pop()
        while (toSendMessage && toSendMessage?.role !== 'user') {
          deleteMessage(toSendMessage.thread_id, toSendMessage.id ?? '')
          toSendMessage = threadMessages.pop()
          // Stop deletion when encountering an assistant message that isn't a tool call
          if (
            toSendMessage &&
            toSendMessage.role === 'assistant' &&
            !('tool_calls' in (toSendMessage.metadata ?? {}))
          )
            break
        }
      } else {
        deleteMessage(item.thread_id, item.id)
      }
    }, [deleteMessage, getMessages, item])

    const assistant = item.metadata?.assistant as
      | { avatar?: React.ReactNode; name?: React.ReactNode }
      | undefined

    type StreamEvent = {
      timestamp: number
      type: 'reasoning_chunk' | 'tool_call' | 'tool_output'
      data: any
    }

    // Constructing allSteps for ThinkingBlock - CHRONOLOGICAL approach
    const allSteps: ReActStep[] = useMemo(() => {
      const steps: ReActStep[] = []

      // Get streamEvents from metadata (if available)
      const streamEvents = (item.metadata?.streamEvents as StreamEvent[]) || []
      const toolCalls = (item.metadata?.tool_calls || []) as ToolCall[]

      const isMessageFinalized = !isStreamingThisThread

      if (streamEvents.length > 0) {
        // CHRONOLOGICAL PATH: Use streamEvents for true temporal order
        let reasoningBuffer = ''

        streamEvents.forEach((event) => {
          switch (event.type) {
            case 'reasoning_chunk':
              // Accumulate reasoning chunks
              reasoningBuffer += event.data.content
              break

            case 'tool_call':
            case 'tool_output':
              // Flush accumulated reasoning before tool event
              if (reasoningBuffer.trim()) {
                const cleanedBuffer = cleanReasoning(reasoningBuffer) // <--- Strip tags here

                // Split accumulated reasoning by paragraphs for display
                const paragraphs = cleanedBuffer
                  .split(/\n\s*\n/)
                  .filter((p) => p.trim().length > 0)

                paragraphs.forEach((para) => {
                  steps.push({
                    type: 'reasoning',
                    content: para.trim(),
                  })
                })

                reasoningBuffer = ''
              }

              if (event.type === 'tool_call') {
                // Add tool call
                const toolCall = event.data.toolCall
                steps.push({
                  type: 'tool_call',
                  content: toolCall?.function?.name || 'Tool Call',
                  metadata:
                    typeof toolCall?.function?.arguments === 'string'
                      ? toolCall.function.arguments
                      : JSON.stringify(
                          toolCall?.function?.arguments || {},
                          null,
                          2
                        ),
                })
              } else if (event.type === 'tool_output') {
                // Add tool output
                const result = event.data.result
                let outputContent = JSON.stringify(result, null, 2) // Default fallback

                const firstContentPart = result?.content?.[0]

                if (firstContentPart?.type === 'text') {
                  const textContent = firstContentPart.text
                  // Robustly check for { value: string } structure or direct string
                  if (
                    typeof textContent === 'object' &&
                    textContent !== null &&
                    'value' in textContent
                  ) {
                    outputContent = textContent.value as string
                  } else if (typeof textContent === 'string') {
                    outputContent = textContent
                  }
                } else if (typeof result === 'string') {
                  outputContent = result
                }

                steps.push({
                  type: 'tool_output',
                  content: outputContent,
                })
              }
              break
          }
        })

        // Flush any remaining reasoning at the end
        if (reasoningBuffer.trim()) {
          const cleanedBuffer = cleanReasoning(reasoningBuffer) // <--- Strip tags here
          const paragraphs = cleanedBuffer
            .split(/\n\s*\n/)
            .filter((p) => p.trim().length > 0)

          paragraphs.forEach((para) => {
            steps.push({
              type: 'reasoning',
              content: para.trim(),
            })
          })
        }
      } else if (isMessageFinalized) {
        // FALLBACK PATH: No streamEvents - use split text for content construction

        const rawReasoningContent = streamedReasoningText || ''
        const reasoningParagraphs = rawReasoningContent
          ? rawReasoningContent
              .split(/\n\s*\n/)
              .filter((s) => s.trim().length > 0)
              .map((content) => content.trim())
          : []

        let reasoningIndex = 0

        toolCalls.forEach((call) => {
          // Add reasoning before this tool call
          if (reasoningIndex < reasoningParagraphs.length) {
            steps.push({
              type: 'reasoning',
              content: reasoningParagraphs[reasoningIndex],
            })
            reasoningIndex++
          }

          // Add tool call
          steps.push({
            type: 'tool_call',
            content: call.tool?.function?.name || 'Tool Call',
            metadata:
              typeof call.tool?.function?.arguments === 'string'
                ? call.tool.function.arguments
                : JSON.stringify(call.tool?.function?.arguments || {}, null, 2),
          })

          // Add tool output
          if (call.response) {
            const result = call.response
            let outputContent = JSON.stringify(result, null, 2)

            const firstContentPart = result?.content?.[0]

            if (firstContentPart?.type === 'text') {
              const textContent = firstContentPart.text
              if (
                typeof textContent === 'object' &&
                textContent !== null &&
                'value' in textContent
              ) {
                outputContent = textContent.value as string
              } else if (typeof textContent === 'string') {
                outputContent = textContent
              }
            } else if (typeof result === 'string') {
              outputContent = result
            }

            steps.push({
              type: 'tool_output',
              content: outputContent,
            })
          }
        })

        // Add remaining reasoning
        while (reasoningIndex < reasoningParagraphs.length) {
          steps.push({
            type: 'reasoning',
            content: reasoningParagraphs[reasoningIndex],
          })
          reasoningIndex++
        }
      }

      // Add Done step
      const totalTime = item.metadata?.totalThinkingTime as number | undefined
      const lastStepType = steps[steps.length - 1]?.type

      if (!isStreamingThisThread && hasReasoningSteps) {
        const endsInToolOutputWithoutFinalText =
          lastStepType === 'tool_output' && finalOutputText.length === 0

        if (!endsInToolOutputWithoutFinalText) {
          steps.push({
            type: 'done',
            content: 'Done',
            time: totalTime,
          })
        }
      }

      return steps
    }, [
      item,
      isStreamingThisThread,
      hasReasoningSteps,
      finalOutputText,
      streamedReasoningText,
    ])
    // END: Constructing allSteps

    // ====================================================================
    // If we have streamEvents, rely on 'steps' and pass an empty text buffer.
    const streamingTextBuffer = useMemo(() => {
      const streamEvents = item.metadata?.streamEvents

      // Check if streamEvents exists AND is an array AND has a length greater than 0
      if (Array.isArray(streamEvents) && streamEvents.length > 0) {
        // We are using the chronological path (allSteps) for rendering
        // Return empty string to disable the ThinkingBlock's raw text buffer
        return ''
      }

      // Since we no longer concatenate reasoning to the main text,
      // the only time we'd rely on text buffer is if streamEvents fails to load.
      // For robustness, we can simply return an empty string to force use of 'steps'.
      return ''
    }, [item.metadata?.streamEvents]) // Use the object reference for dependency array
    // ====================================================================

    // Determine if we should show the thinking block
    const shouldShowThinkingBlock =
      hasReasoningSteps || isToolCalls || isReasoningActiveLoading

    return (
      <Fragment>
        {item.role === 'user' && (
          <div className="w-full">
            {/* Render text content in the message bubble */}
            {cleanPrompt && (
              <div className="flex justify-end w-full h-full text-start break-words whitespace-normal">
                <div className="bg-main-view-fg/4 relative text-main-view-fg p-2 rounded-md inline-block max-w-[80%] ">
                  <div className="select-text">
                    <RenderMarkdown
                      content={cleanPrompt}
                      components={linkComponents}
                      isUser
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Render document file attachments (extracted from message text) - below text */}
            {attachedFiles.length > 0 && (
              <div className="flex justify-end w-full mt-2 mb-2">
                <div className="flex flex-wrap gap-2 max-w-[80%] justify-end">
                  {attachedFiles.map((file, index) => (
                    <div
                      key={file.id || index}
                      className="flex items-center gap-2 px-3 py-2 bg-main-view-fg/5 rounded-md border border-main-view-fg/10 text-xs"
                    >
                      <svg
                        className="w-4 h-4 text-main-view-fg/50"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <span className="text-main-view-fg">{file.name}</span>
                      {file.type && (
                        <span className="text-main-view-fg/40 text-[10px]">
                          .{file.type}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Render image attachments - below files */}
            {item.content?.some(
              (c) => (c.type === 'image_url' && c.image_url?.url) || false
            ) && (
              <div className="flex justify-end w-full mb-2">
                <div className="flex flex-wrap gap-2 max-w-[80%] justify-end">
                  {item.content
                    ?.filter(
                      (c) =>
                        (c.type === 'image_url' && c.image_url?.url) || false
                    )
                    .map((contentPart, index) => {
                      // Handle images
                      if (
                        contentPart.type === 'image_url' &&
                        contentPart.image_url?.url
                      ) {
                        return (
                          <div key={index} className="relative">
                            <img
                              src={contentPart.image_url.url}
                              alt="Uploaded attachment"
                              className="size-40 rounded-md object-cover border border-main-view-fg/10"
                            />
                          </div>
                        )
                      }
                      return null
                    })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 text-main-view-fg/60 text-xs mt-2">
              <EditMessageDialog
                message={cleanPrompt || ''}
                imageUrls={
                  item.content
                    ?.filter((c) => c.type === 'image_url' && c.image_url?.url)
                    .map((c) => c.image_url!.url)
                    .filter((url): url is string => url !== undefined) || []
                }
                onSave={(message, imageUrls) => {
                  if (item.updateMessage) {
                    item.updateMessage(item, message, imageUrls)
                  }
                }}
              />
              <DeleteMessageDialog
                onDelete={() => deleteMessage(item.thread_id, item.id)}
              />
            </div>
          </div>
        )}
        {item.content?.[0]?.text && item.role !== 'user' && (
          <>
            {item.showAssistant && (
              <div className="flex items-center gap-2 mb-3 text-main-view-fg/60">
                {assistant?.avatar && (
                  <div className="flex items-center gap-2 size-8 rounded-md justify-center border border-main-view-fg/10 bg-main-view-fg/5 p-1">
                    <AvatarEmoji
                      avatar={assistant?.avatar}
                      imageClassName="w-6 h-6 object-contain"
                      textClassName="text-base"
                    />
                  </div>
                )}

                <div className="flex flex-col">
                  <span className="text-main-view-fg font-medium">
                    {assistant?.name || 'Jan'}
                  </span>
                  {item?.created_at && item?.created_at !== 0 && (
                    <span className="text-xs mt-0.5">
                      {formatDate(item?.created_at)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Single unified ThinkingBlock for both reasoning and tool calls */}
            {shouldShowThinkingBlock && (
              <ThinkingBlock
                id={
                  item.isLastMessage
                    ? `${item.thread_id}-last-${(streamingTextBuffer || text).slice(0, 50).replace(/\s/g, '').slice(-10)}`
                    : `${item.thread_id}-${item.index ?? item.id}`
                }
                // Pass the safe buffer
                text={streamingTextBuffer}
                steps={allSteps}
                loading={isReasoningActiveLoading}
                duration={
                  item.metadata?.totalThinkingTime as number | undefined
                }
              />
            )}

            {!isReasoningActiveLoading && finalOutputText.length > 0 && (
              <RenderMarkdown
                content={finalOutputText}
                components={linkComponents}
              />
            )}

            {(
              <div className="flex items-center gap-2 text-main-view-fg/60 text-xs">
                <div className={cn('flex items-center gap-2')}>
                  <div
                    className={cn(
                      'flex items-center gap-2',
                      item.isLastMessage && isStreamingThisThread && 'hidden'
                    )}
                  >
                    <EditMessageDialog
                      message={item.content?.[0]?.text.value || ''}
                      onSave={(message) =>
                        item.updateMessage && item.updateMessage(item, message)
                      }
                    />
                    <CopyButton text={item.content?.[0]?.text.value || ''} />
                    <DeleteMessageDialog onDelete={removeMessage} />
                    <MessageMetadataDialog metadata={item.metadata} />

                    {item.isLastMessage && selectedModel && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                            onClick={regenerate}
                          >
                            <IconRefresh size={16} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('regenerate')}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  <TokenSpeedIndicator
                    streaming={Boolean(
                      item.isLastMessage && isStreamingThisThread
                    )}
                    metadata={item.metadata}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {item.type === 'image_url' && image && (
          <div>
            <img
              src={image.url}
              alt={image.detail || 'Thread image'}
              className="max-w-full rounded-md"
            />
            {image.detail && <p className="text-sm mt-1">{image.detail}</p>}
          </div>
        )}
        {item.contextOverflowModal && item.contextOverflowModal}
      </Fragment>
    )
  }
)
