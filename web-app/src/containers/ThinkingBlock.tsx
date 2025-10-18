import { ChevronDown, ChevronUp, Loader, Check } from 'lucide-react'
import { create } from 'zustand'
import { RenderMarkdown } from './RenderMarkdown'
import { useAppState } from '@/hooks/useAppState'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { extractThinkingContent } from '@/lib/utils'
import { useMemo, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

// Define ThoughtStep type
type ThoughtStep = {
  type: 'thought' | 'tool_call' | 'tool_output' | 'done'
  content: string
  metadata?: any
  time?: number
}

interface Props {
  text: string
  id: string
  steps?: ThoughtStep[]
  loading?: boolean
  duration?: number
}

// Zustand store for thinking block state
type ThinkingBlockState = {
  thinkingState: { [id: string]: boolean }
  setThinkingState: (id: string, expanded: boolean) => void
}

const useThinkingStore = create<ThinkingBlockState>((set) => ({
  thinkingState: {},
  setThinkingState: (id, expanded) =>
    set((state) => ({
      thinkingState: {
        ...state.thinkingState,
        [id]: expanded,
      },
    })),
}))

// Helper to format duration in seconds
const formatDuration = (ms: number) => {
  // Only show seconds if duration is present and non-zero
  if (ms > 0) {
    return Math.round(ms / 1000)
  }
  return 0
}

// Function to safely extract thought paragraphs from streaming text
const extractStreamingParagraphs = (rawText: string): string[] => {
  const cleanedContent = rawText.replace(/<\/?think>/g, '').trim()

  // Split by double newline (paragraph boundary)
  let paragraphs = cleanedContent
    .split(/\n\s*\n/)
    .filter((s) => s.trim().length > 0)

  // If no explicit double newline paragraphs, treat single newlines as breaks for streaming visualization
  if (paragraphs.length <= 1 && cleanedContent.includes('\n')) {
    paragraphs = cleanedContent.split('\n').filter((s) => s.trim().length > 0)
  }

  // Ensure we always return at least one item if content exists
  if (paragraphs.length === 0 && cleanedContent.length > 0) {
    return [cleanedContent]
  }

  return paragraphs
}

const ThinkingBlock = ({
  id,
  text,
  steps,
  loading: propLoading,
  duration,
}: Props) => {
  const thinkingState = useThinkingStore((state) => state.thinkingState)
  const setThinkingState = useThinkingStore((state) => state.setThinkingState)
  const isStreamingApp = useAppState((state) => !!state.streamingContent)
  const { t } = useTranslation()

  // Determine actual loading state
  const hasThinkTag = text.includes('<think>') && !text.includes('</think>')
  const hasAnalysisChannel =
    text.includes('<|channel|>analysis<|message|>') &&
    !text.includes('<|start|>assistant<|channel|>final<|message|>')

  const loading =
    propLoading ?? ((hasThinkTag || hasAnalysisChannel) && isStreamingApp)

  // Set default expansion state: expanded if loading, collapsed if done.
  const isExpanded = thinkingState[id] ?? (loading ? true : false)

  const thinkingContent = extractThinkingContent(text)

  // If we are not loading AND there is no content/steps, hide the block entirely.
  const hasContent = !!thinkingContent || (steps && steps.length >= 1)
  if (!loading && !hasContent) return null

  // --- Streaming Logic ---
  const streamingParagraphs = extractStreamingParagraphs(thinkingContent)
  const currentParagraph =
    streamingParagraphs[streamingParagraphs.length - 1] || ''

  // State for replacement animation
  const [visibleParagraph, setVisibleParagraph] = useState(currentParagraph)
  const [transitioning, setTransitioning] = useState(false)

  useEffect(() => {
    if (loading && currentParagraph !== visibleParagraph) {
      // Start transition out (opacity: 0)
      setTransitioning(true)

      // Simulate subtle easeIn replacement after a short delay
      const timeout = setTimeout(() => {
        setVisibleParagraph(currentParagraph)
        // After content replacement, transition in (opacity: 1)
        setTransitioning(false)
      }, 150)

      return () => clearTimeout(timeout)
    } else if (!loading) {
      // Ensure the last state is captured when streaming stops
      setVisibleParagraph(currentParagraph)
    }
    // Update immediately on initial render or if content is stable
    if (!loading || streamingParagraphs.length <= 1) {
      setVisibleParagraph(currentParagraph)
    }
  }, [currentParagraph, loading, visibleParagraph, streamingParagraphs.length])

  // Check if we are currently streaming but haven't received enough content for a meaningful paragraph
  const isInitialStreaming =
    loading && currentParagraph.length === 0 && steps?.length === 0

  // If loading but we have no content yet, hide the component until the first content piece arrives.
  if (isInitialStreaming) {
    return null
  }

  const handleClick = () => {
    // Only allow toggling expansion if not currently loading
    if (!loading) {
      setThinkingState(id, !isExpanded)
    }
  }

  // --- Rendering Functions for Expanded View ---

  const renderStepContent = (step: ThoughtStep, index: number) => {
    if (step.type === 'done') {
      const timeInSeconds = formatDuration(step.time ?? 0)

      // TODO: Add translations
      const timeDisplay =
        timeInSeconds > 0
          ? `(${t('for')} ${timeInSeconds} ${t('seconds')})`
          : ''

      return (
        <div key={index} className="flex items-center gap-2 mt-2 text-accent">
          {/* Use Check icon for done state */}
          <Check className="size-4" />
          <span className="font-medium">{t('common:done')}</span>
          {timeDisplay && (
            <span className="text-main-view-fg/60 text-xs">{timeDisplay}</span>
          )}
        </div>
      )
    }

    let contentDisplay
    if (step.type === 'tool_call') {
      const args = step.metadata ? step.metadata : ''
      contentDisplay = (
        <>
          <p className="font-medium text-main-view-fg/90">
            Tool Call: <span className="text-accent">{step.content}</span>
          </p>
          {args && (
            <div className="mt-1">
              <RenderMarkdown
                isWrapping={true}
                content={'```json\n' + args + '\n```'}
              />
            </div>
          )}
        </>
      )
    } else if (step.type === 'tool_output') {
      contentDisplay = (
        <>
          <p className="font-medium text-main-view-fg/90">Tool Output:</p>
          <div className="mt-1">
            <RenderMarkdown
              isWrapping={true}
              content={'```json\n' + step.content + '\n```'}
            />
          </div>
        </>
      )
    } else {
      // thought
      contentDisplay = (
        <RenderMarkdown isWrapping={true} content={step.content} />
      )
    }

    return (
      <div key={index} className="py-1 text-main-view-fg/80">
        {contentDisplay}
      </div>
    )
  }

  const headerTitle = useMemo(() => {
    if (loading) return t('thinking')
    const timeInSeconds = formatDuration(duration ?? 0)

    if (timeInSeconds > 0) {
      // Ensure translated strings are used correctly
      return `${t('thought')} ${t('for')} ${timeInSeconds} ${t('seconds')}`
    }
    return t('thought')
  }, [loading, duration, t])

  return (
    <div
      className="mx-auto w-full cursor-pointer break-words"
      onClick={handleClick}
    >
      <div className="mb-4 rounded-lg bg-main-view-fg/4 border border-dashed border-main-view-fg/10 p-2">
        <div className="flex items-center gap-3">
          {loading && (
            <Loader className="size-4 animate-spin text-main-view-fg/60" />
          )}
          <button
            className="flex items-center gap-2 focus:outline-none"
            disabled={loading}
          >
            {/* Display chevron only if not loading AND steps exist to expand */}
            {!loading &&
              steps &&
              steps.length > 0 &&
              (isExpanded ? (
                <ChevronUp className="size-4 text-main-view-fg/60" />
              ) : (
                <ChevronDown className="size-4 text-main-view-fg/60" />
              ))}
            <span className="font-medium">{headerTitle}</span>
          </button>
        </div>

        {/* Streaming/Condensed View (Visible ONLY when loading) */}
        {loading && (
          <div
            className={cn(
              'mt-2 pl-6 pr-4 text-main-view-fg/60 transition-opacity duration-150 ease-in',
              transitioning ? 'opacity-0' : 'opacity-100'
            )}
          >
            <RenderMarkdown content={visibleParagraph} />
          </div>
        )}

        {/* Expanded View (Req 5) */}
        {isExpanded && !loading && (
          <div className="mt-2 pl-6 pr-4 text-main-view-fg/60">
            <div className="relative border-l border-dashed border-main-view-fg/20 ml-1.5">
              {steps?.map((step, index) => (
                <div key={index} className="relative pl-6 pb-2">
                  {/* Bullet point/Icon position relative to line */}
                  <div
                    className={cn(
                      'absolute left-[-5px] top-[10px] size-2 rounded-full',
                      step.type === 'done' ? 'bg-accent' : 'bg-main-view-fg/60'
                    )}
                  />

                  {/* Step Content */}
                  {renderStepContent(step, index)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ThinkingBlock
