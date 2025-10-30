import { useState, useMemo } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from '@/components/ui/dialog'
import {
  IconInfoCircle,
  IconRobot,
  IconGauge,
  IconId,
  IconCalendar,
  IconTemperature,
  IconHierarchy,
  IconTool,
  IconBoxMultiple,
  IconRuler,
  IconMessageCircle,
} from '@tabler/icons-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
// Removed CodeEditor and its styles

// Type definitions for the provided metadata structure
interface Parameters {
  temperature: number
  top_k: number
  top_p: number
}

interface AssistantMetadata {
  avatar: string
  created_at: number
  description: string
  id: string
  instructions: string
  name: string
  parameters: Parameters
  tool_steps: number
}

interface TokenSpeedMetadata {
  lastTimestamp: number
  message: string
  tokenCount: number
  tokenSpeed: number
}

interface MessageMetadata {
  assistant?: AssistantMetadata
  tokenSpeed?: TokenSpeedMetadata
}

interface MessageMetadataDialogProps {
  metadata: MessageMetadata // Use the specific interface
  triggerElement?: React.ReactNode
}

// --- Helper Components & Utilities ---

// A utility component to display a single detail row
const DetailItem: React.FC<{
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}> = ({ icon, label, value }) => (
  <div className="flex items-start text-sm p-2 bg-main-view-bg/5 rounded-md">
    <div className="text-accent mr-3 flex-shrink-0">{icon}</div>
    <div className="flex flex-col">
      <span className="font-semibold text-main-view-fg/80">{label}:</span>
      <span className="text-main-view-fg/90 whitespace-pre-wrap break-words">
        {value}
      </span>
    </div>
  </div>
)

// Helper for formatting timestamps
const formatDate = (timestamp: number) => {
  if (!timestamp) return 'N/A'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    timeZoneName: 'short',
  }).format(new Date(timestamp))
}

// --- Main Component ---

export function MessageMetadataDialog({
  metadata,
  triggerElement,
}: MessageMetadataDialogProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  const { assistant, tokenSpeed } = (metadata || {}) as MessageMetadata

  const defaultTrigger = (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="outline-0 focus:outline-0 flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setIsOpen(true)
            }
          }}
        >
          <IconInfoCircle size={16} />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t('metadata')}</p>
      </TooltipContent>
    </Tooltip>
  )

  const formattedTokenSpeed = useMemo(() => {
    if (tokenSpeed?.tokenSpeed === undefined) return 'N/A'
    return (
      new Intl.NumberFormat('en-US', {
        style: 'decimal',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(tokenSpeed.tokenSpeed) + ' tokens/s'
    )
  }, [tokenSpeed])

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger>{triggerElement || defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('common:dialogs.messageMetadata.title')}</DialogTitle>
          <div className="space-y-6 mt-4 max-h-[70vh] overflow-y-auto pr-2">
            {/* --- Assistant/Model Section --- */}
            {assistant && (
              <section>
                <h3 className="flex items-center text-lg font-bold border-b border-main-view-fg/10 pb-2 mb-3">
                  <IconRobot className="mr-2" size={20} />
                  {t('common:dialogs.messageMetadata.model')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <DetailItem
                    icon={<IconRobot size={18} />}
                    label={t('common:dialogs.messageMetadata.name')}
                    value={`${assistant.avatar} ${assistant.name}`}
                  />
                  <DetailItem
                    icon={<IconId size={18} />}
                    label={t('common:dialogs.messageMetadata.id')}
                    value={assistant.id}
                  />
                  <DetailItem
                    icon={<IconCalendar size={18} />}
                    label={t('common:dialogs.messageMetadata.createdAt')}
                    value={formatDate(assistant.created_at)}
                  />
                  <DetailItem
                    icon={<IconTool size={18} />}
                    label={t('common:dialogs.messageMetadata.toolSteps')}
                    value={assistant.tool_steps}
                  />

                  {/* Parameters */}
                  <div className="col-span-1 md:col-span-2 grid grid-cols-3 gap-3">
                    <DetailItem
                      icon={<IconTemperature size={18} />}
                      label={t('common:dialogs.messageMetadata.temperature')}
                      value={assistant.parameters.temperature}
                    />
                    <DetailItem
                      icon={<IconHierarchy size={18} />}
                      label={t('common:dialogs.messageMetadata.topK')}
                      value={assistant.parameters.top_k}
                    />
                    <DetailItem
                      icon={<IconBoxMultiple size={18} />}
                      label={t('common:dialogs.messageMetadata.topP')}
                      value={assistant.parameters.top_p}
                    />
                  </div>

                  {/* Description/Instructions */}
                  {(assistant.description || assistant.instructions) && (
                    <div className="col-span-1 md:col-span-2 space-y-3">
                      {assistant.description && (
                        <DetailItem
                          icon={<IconMessageCircle size={18} />}
                          label={t('common:dialogs.messageMetadata.description')}
                          value={assistant.description}
                        />
                      )}
                      {assistant.instructions && (
                        <DetailItem
                          icon={<IconMessageCircle size={18} />}
                          label={t('common:dialogs.messageMetadata.instructions')}
                          value={assistant.instructions}
                        />
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* --- Token Speed Section --- */}
            {tokenSpeed && (
              <section>
                <h3 className="flex items-center text-lg font-bold border-b border-main-view-fg/10 pb-2 mb-3">
                  <IconGauge className="mr-2" size={20} />
                  {t('Performance')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <DetailItem
                    icon={<IconGauge size={18} />}
                    label={t('common:dialogs.messageMetadata.tokenSpeed')}
                    value={formattedTokenSpeed}
                  />
                  <DetailItem
                    icon={<IconRuler size={18} />}
                    label={t('common:dialogs.messageMetadata.tokenCount')}
                    value={tokenSpeed.tokenCount}
                  />
                  <DetailItem
                    icon={<IconCalendar size={18} />}
                    label={t('common:dialogs.messageMetadata.lastUpdate')}
                    value={formatDate(tokenSpeed.lastTimestamp)}
                  />
                </div>
              </section>
            )}

            {!assistant && !tokenSpeed && (
              <p className="text-center text-main-view-fg/70 py-4">
                {t('common:dialogs.messageMetadata.noMetadataAvailable.')}
              </p>
            )}
          </div>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
