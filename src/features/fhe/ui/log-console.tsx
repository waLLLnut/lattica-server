'use client'

import { useFHE, LogEntry } from './fhe-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const getLogColor = (level: LogEntry['level'], component?: string) => {
  // logger.ts의 ANSI 컬러를 CSS로 변환
  if (component) return '#d946ef' // magenta for component
  switch (level) {
    case 'debug': return '#06b6d4' // cyan
    case 'info': return '#10b981' // green
    case 'warn': return '#f59e0b' // yellow
    case 'error': return '#ef4444' // red
    default: return '#a3a3a3' // gray
  }
}

const getLevelTag = (level: LogEntry['level']) => {
  return level.toUpperCase().padEnd(5)
}

export function LogConsole() {
  const { logs, clearLogs } = useFHE()

  return (
    <Card className="mt-8 p-4 bg-black border-zinc-800 font-mono text-xs">
      <div className="flex justify-between mb-2">
        <span className="text-zinc-400">System Logs</span>
        <Button
          onClick={clearLogs}
          variant="ghost"
          className="text-zinc-600 hover:text-white h-auto p-1"
        >
          Clear
        </Button>
      </div>
      <div className="h-40 overflow-y-auto space-y-1">
        {logs.map((log, i) => {
          const levelColor = getLogColor(log.level, log.component)
          const componentColor = log.component ? '#d946ef' : undefined
          
          return (
            <div key={i} className="flex items-start gap-2">
              <span className="text-zinc-500 text-[10px]">{log.timestamp}</span>
              <span 
                className="font-bold min-w-[50px]"
                style={{ color: levelColor }}
              >
                {getLevelTag(log.level)}
              </span>
              {log.component && (
                <span 
                  className="font-semibold"
                  style={{ color: componentColor }}
                >
                  {log.component.padEnd(12)}
                </span>
              )}
              <span 
                className="flex-1"
                style={{ color: log.level === 'error' ? '#ef4444' : log.level === 'warn' ? '#f59e0b' : '#e5e7eb' }}
              >
                {log.message}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
