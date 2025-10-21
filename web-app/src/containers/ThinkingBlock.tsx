/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChevronDown, ChevronUp, Loader, Check } from 'lucide-react'
import { create } from 'zustand'
import { RenderMarkdown } from './RenderMarkdown'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useMemo } from 'react'
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
  // When step N-1 is streaming, show the previously finished step (N-2).
  const stepToRenderWhenStreaming = useMemo(() => {
    if (!loading) return null
    // If N >= 2, the N-1 step is currently streaming, so we show the finished step N-2.
    if (N >= 2) {
      return stepsWithoutDone[N - 2]
    }
    return null
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
  const renderStepContent = (step: ThoughtStep, index: number) => {
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
      <div key={index} className="text-main-view-fg/80">
        {contentDisplay}
      </div>
    )
  }

  const headerTitle = useMemo(() => {
    if (loading) return t('thinking')
    const timeInSeconds = formatDuration(duration ?? 0)

    if (timeInSeconds > 0) {
      return `${t('thought')} ${t('for')} ${timeInSeconds} ${t('seconds')}`
    }
    return t('thought')
  }, [loading, duration, t])

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

        {/* Streaming/Condensed View - shows previous finished step */}
        {loading && stepToRenderWhenStreaming && (
          <div
            key={`streaming-${N - 2}`}
            className={cn(
              'mt-4 pl-2 pr-4 text-main-view-fg/60',
              'animate-in fade-in slide-in-from-top-2 duration-300'
            )}
          >
            <div className="relative border-main-view-fg/20">
              <div className="relative pl-5">
                {/* Bullet point */}
                <div className="absolute left-[-2px] top-1.5 size-2 rounded-full bg-main-view-fg/60 animate-pulse" />
                {/* Previous completed step content */}
                {renderStepContent(stepToRenderWhenStreaming, N - 2)}
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
