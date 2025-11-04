import { useMemo, useCallback } from 'react'
import { IconWorld, IconDeviceDesktop } from '@tabler/icons-react'
import { MCPToolComponentProps } from '@janhq/core'

// List of tool names considered as web search tools
const WEB_SEARCH_TOOL_NAMES = ['google_search', 'scrape']
const DEFAULT_SERVER_NAME = 'Jan MCP Server'

export const WebSearchButton = ({
  tools,
  isToolEnabled,
  onToolToggle,
}: MCPToolComponentProps) => {
  const webSearchTools = useMemo(
    () => tools.filter((tool) => WEB_SEARCH_TOOL_NAMES.includes(tool.name)),
    [tools]
  )
  const browserTools = useMemo(
    () =>
      tools.filter(
        (tool) =>
          tool.server !== DEFAULT_SERVER_NAME &&
          !WEB_SEARCH_TOOL_NAMES.includes(tool.name)
      ),
    [tools]
  )

  // Early return if no tools available for either category
  if (webSearchTools.length === 0 && browserTools.length === 0) {
    return null
  }

  const isEnabled = useMemo(
    () => webSearchTools.every((tool) => isToolEnabled(tool.name)),
    [webSearchTools, isToolEnabled]
  )
  const isBrowserEnabled = useMemo(
    () => browserTools.length > 0 && browserTools.every((tool) => isToolEnabled(tool.name)),
    [browserTools, isToolEnabled]
  )

  const handleToggle = useCallback(() => {
    const newState = !isEnabled
    webSearchTools.forEach((tool) => {
      onToolToggle(tool.name, newState)
    })
  }, [isEnabled, webSearchTools, onToolToggle])

  const handleBrowserToggle = useCallback(() => {
    const newState = !isBrowserEnabled
    browserTools.forEach((tool) => {
      onToolToggle(tool.name, newState)
    })
  }, [browserTools, isBrowserEnabled, onToolToggle])

  return (
    <div className="flex items-center gap-1">
      {webSearchTools.length > 0 && (
        <button
          onClick={handleToggle}
          className={`h-7 px-2 py-1 flex items-center justify-center rounded-md transition-all duration-200 ease-in-out gap-1 cursor-pointer border-0 ${
            isEnabled
              ? 'bg-accent/20 text-accent'
              : 'bg-transparent text-main-view-fg/70 hover:bg-main-view-fg/5'
          }`}
          title={isEnabled ? 'Disable Web Search' : 'Enable Web Search'}
        >
          <IconWorld
            size={16}
            className={isEnabled ? 'text-accent' : 'text-main-view-fg/70'}
          />
          <span className={`text-sm font-medium ${isEnabled ? 'text-accent' : ''}`}>
            Search
          </span>
        </button>
      )}

      {browserTools.length > 0 && (
        <button
          onClick={handleBrowserToggle}
          className={`h-7 px-2 py-1 flex items-center justify-center rounded-md transition-all duration-200 ease-in-out gap-1 cursor-pointer border-0 ${
            isBrowserEnabled
              ? 'bg-accent/20 text-accent'
              : 'bg-transparent text-main-view-fg/70 hover:bg-main-view-fg/5'
          }`}
          title={isBrowserEnabled ? 'Disable Browser User' : 'Enable Browser User'}
        >
          <IconDeviceDesktop
            size={16}
            className={isBrowserEnabled ? 'text-accent' : 'text-main-view-fg/70'}
          />
          <span className={`text-sm font-medium ${isBrowserEnabled ? 'text-accent' : ''}`}>
            Browser
          </span>
        </button>
      )}
    </div>
  )
}
