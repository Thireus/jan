/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChevronDown, ChevronUp, Loader, Check } from 'lucide-react'
import { create } from 'zustand'
import { RenderMarkdown } from './RenderMarkdown'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import ImageModal from '@/containers/dialogs/ImageModal'

// Define ReActStep type (Reasoning-Action Step)
type ReActStep = {
  type: 'reasoning' | 'tool_call' | 'tool_output' | 'done' // Changed 'thought' to 'reasoning'
  content: string
  metadata?: any
  time?: number
}

interface Props {
  text: string
  id: string
  steps?: ReActStep[] // Updated type
  loading?: boolean
  duration?: number
}

// Utility function to safely parse JSON
const safeParseJSON = (text: string) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Utility to create data URL for images
const createDataUrl = (base64Data: string, mimeType: string): string => {
  if (base64Data.startsWith('data:')) return base64Data
  return `data:${mimeType};base64,${base64Data}`
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
  if (ms > 0) {
    return Math.round(ms / 1000)
  }
  return 0
}

const ThinkingBlock = ({
  id,
  steps = [],
  loading: propLoading,
  duration,
}: Props) => {
  const thinkingState = useThinkingStore((state) => state.thinkingState)
  const setThinkingState = useThinkingStore((state) => state.setThinkingState)
  const { t } = useTranslation()

  // Move useState for modal management to the top level of the component
  const [modalImage, setModalImage] = useState<{
    url: string
    alt: string
  } | null>(null)
  const closeModal = () => setModalImage(null)
  const handleImageClick = (url: string, alt: string) =>
    setModalImage({ url, alt })

  // Actual loading state comes from prop, determined by whether final text started streaming (Req 2)
  const loading = propLoading

  // Set default expansion state: collapsed if done (not loading).
  // If loading transitions to false (textSegment starts), this defaults to collapsed.
  const isExpanded = thinkingState[id] ?? (loading ? true : false)

  // Filter out the 'done' step for streaming display
  const stepsWithoutDone = useMemo(
    () => steps.filter((step) => step.type !== 'done'),
    [steps]
  )
  const N = stepsWithoutDone.length

  // Determine the step to display in the condensed streaming view
  // When loading, we show the last available step (N-1), which is currently accumulating content.
  const activeStep = useMemo(() => {
    if (!loading || N === 0) return null
    return stepsWithoutDone[N - 1]
  }, [loading, N, stepsWithoutDone])

  // Determine if the block is truly empty (streaming started but no content/steps yet)
  const isStreamingEmpty = loading && N === 0

  // If loading started but no content or steps have arrived yet, display the non-expandable 'Thinking...' block
  if (isStreamingEmpty) {
    return (
      <div className="mx-auto w-full break-words">
        <div className="mb-4 rounded-lg bg-main-view-fg/4 border border-dashed border-main-view-fg/10 p-2 flex items-center gap-3">
          <Loader className="size-4 animate-spin text-main-view-fg/60" />
          <span className="font-medium text-main-view-fg/80">
            {t('thinking')}...
          </span>
        </div>
      </div>
    )
  }

  // If not loading, and there are no steps, hide the block entirely.
  const hasContent = steps.length > 0
  if (!loading && !hasContent) return null

  const handleClick = () => {
    // Only allow toggling expansion if not currently loading
    if (!loading) {
      setThinkingState(id, !isExpanded)
    }
  }

  // --- Rendering Functions for Expanded View ---
  const renderStepContent = (
    step: ReActStep,
    index: number,
    handleImageClick: (url: string, alt: string) => void,
    t: (key: string) => string
  ) => {
    // Updated type
    if (step.type === 'done') {
      const timeInSeconds = formatDuration(step.time ?? 0)
      const timeDisplay =
        timeInSeconds > 0
          ? `(${t('for')} ${timeInSeconds} ${t('seconds')})`
          : ''

      return (
        <div
          key={index}
          className="flex items-center gap-1 text-accent transition-all"
        >
          <Check className="size-4" />
          <span className="font-medium">{t('done')}</span>
          {timeDisplay && (
            <span className="text-main-view-fg/60 text-xs">{timeDisplay}</span>
          )}
        </div>
      )
    }

    const parsed = safeParseJSON(step.content)
    const mcpContent = parsed?.content ?? []
    const hasImages =
      Array.isArray(mcpContent) &&
      mcpContent.some((c) => c.type === 'image' && c.data && c.mimeType)

    let contentDisplay: React.ReactNode

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
      if (hasImages) {
        // Display each image
        contentDisplay = (
          <>
            <p className="font-medium text-main-view-fg/90">
              Tool Output (Images):
            </p>
            <div className="mt-2 space-y-2">
              {mcpContent.map((item: any, index: number) =>
                item.type === 'image' && item.data && item.mimeType ? (
                  <div key={index} className="my-2">
                    <img
                      src={createDataUrl(item.data, item.mimeType)}
                      alt={`MCP Image ${index + 1}`}
                      className="max-w-full max-h-64 object-contain rounded-md border border-main-view-fg/10 cursor-pointer hover:opacity-80 transition-opacity"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                      onClick={() =>
                        handleImageClick(
                          createDataUrl(item.data, item.mimeType),
                          `MCP Image ${index + 1}`
                        )
                      }
                    />
                  </div>
                ) : null
              )}
            </div>
          </>
        )
      } else {
        // Default behavior: wrap text in code block if no backticks
        let content = step.content.substring(0, 1000)
        if (!content.includes('```')) {
          content = '```json\n' + content + '\n```'
        }

        contentDisplay = (
          <>
            <p className="font-medium text-main-view-fg/90">Tool Output:</p>
            <div className="mt-1">
              <RenderMarkdown isWrapping={true} content={content} />
            </div>
          </>
        )
      }
    } else {
      contentDisplay = (
        <RenderMarkdown isWrapping={true} content={step.content} />
      )
    }

    return (
      <div key={index} className="text-main-view-fg/80">
        {contentDisplay}
      </div>
    )
  }

  const headerTitle: string = useMemo(() => {
    // Check if any step was a tool call
    const hasToolCalls = steps.some((step) => step.type === 'tool_call')
    const hasReasoning = steps.some((step) => step.type === 'reasoning')

    const timeInSeconds = formatDuration(duration ?? 0)

    if (loading) {
      // Check if the active step is a tool call
      if (activeStep?.type === 'tool_call' || hasToolCalls) {
        return 'Calling tool...'
      } else {
        return t('thinking')
      }
    }

    // Build label based on what steps occurred
    let label = ''
    if (hasReasoning && hasToolCalls) {
      label = `${t('thought')}`
    } else if (hasToolCalls) {
      label = 'Tool Called'
    } else {
      label = t('thought')
    }

    if (timeInSeconds > 0) {
      return `${label} ${t('for')} ${timeInSeconds} ${t('seconds')}`
    }
    return label
  }, [loading, duration, t, activeStep, steps])

  return (
    <div
      className="mx-auto w-full cursor-pointer break-words"
      onClick={handleClick}
    >
      <div className="mb-4 rounded-lg bg-main-view-fg/4 p-2 transition-all duration-200">
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
              steps.length > 0 &&
              (isExpanded ? (
                <ChevronUp className="size-4 text-main-view-fg/60 transition-transform duration-200" />
              ) : (
                <ChevronDown className="size-4 text-main-view-fg/60 transition-transform duration-200" />
              ))}
            <span className="font-medium transition-all duration-200">
              {headerTitle}
            </span>
          </button>
        </div>

        {/* Streaming/Condensed View - shows active step (N-1) */}
        {loading && activeStep && (
          <div
            key={`streaming-${N - 1}`}
            className={cn(
              'mt-4 pl-2 pr-4 text-main-view-fg/60',
              // Only animate fade-in if it's not the very first step (N > 1)
              N > 1 && 'animate-in fade-in slide-in-from-top-2 duration-300'
            )}
          >
            <div className="relative border-main-view-fg/20">
              <div className="relative pl-5">
                {/* Bullet point/Icon position relative to line */}
                <div
                  className={cn(
                    'absolute left-[-2px] top-1.5 size-2 rounded-full bg-main-view-fg/60',
                    activeStep.type !== 'done' && 'animate-pulse' // Pulse if active/streaming
                  )}
                />
                {/* Active step content */}
                {renderStepContent(activeStep, N - 1, handleImageClick, t)}
              </div>
            </div>
          </div>
        )}

        {/* Expanded View - shows all steps */}
        {isExpanded && !loading && (
          <div className="mt-4 pl-2 pr-4 text-main-view-fg/60 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="relative border-main-view-fg/20">
              {steps.map((step, index) => (
                <div
                  key={index}
                  className={cn(
                    'relative pl-5 pb-2',
                    'fade-in slide-in-from-left-1 duration-200',
                    step.type !== 'done' &&
                      'after:content-[] after:border-l after:border-dashed after:border-main-view-fg/20 after:absolute after:left-0.5 after:bottom-0 after:w-1 after:h-[calc(100%-8px)]'
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {/* Bullet point/Icon position relative to line */}
                  <div
                    className={cn(
                      'absolute left-[-2px] top-1.5 size-2 rounded-full transition-colors duration-200',
                      step.type === 'done' ? 'bg-accent' : 'bg-main-view-fg/60'
                    )}
                  />

                  {/* Step Content */}
                  {renderStepContent(step, index, handleImageClick, t)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* Render ImageModal once at the top level */}
      <ImageModal image={modalImage} onClose={closeModal} />
    </div>
  )
}

export default ThinkingBlock
