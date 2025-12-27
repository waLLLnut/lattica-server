'use client'

import { useBlink } from '@dialectlabs/blinks'
import { Blink } from '@dialectlabs/blinks'
import { useBlinkAdapter } from '@/features/blink/data-access/use-blink-adapter'
import type React from 'react'

export const BlinkComponent: React.FC<{
  url: string
}> = ({ url }) => {
  const adapter = useBlinkAdapter()
  
  let cleanUrl = url.startsWith('solana-actions:') 
    ? url.replace('solana-actions:', '') 
    : url
  
  if (typeof window !== 'undefined' && cleanUrl.startsWith('/')) {
    cleanUrl = `${window.location.origin}${cleanUrl}`
  }
  
  const { blink, isLoading, blinkApiUrl } = useBlink({ url: cleanUrl })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    )
  }

  if (!blink) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-red-500">Blink를 불러올 수 없습니다.</div>
      </div>
    )
  }

  if (!adapter) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-yellow-500">지갑을 연결해주세요.</div>
      </div>
    )
  }

  const urlToParse = blinkApiUrl || cleanUrl
  let websiteUrl: string
  let websiteText: string
  
  try {
    const blinkUrl = new URL(urlToParse)
    websiteUrl = blinkUrl.href
    websiteText = blinkUrl.hostname
  } catch {
    websiteUrl = urlToParse
    const match = urlToParse.match(/https?:\/\/([^\/]+)/)
    websiteText = match ? match[1] : urlToParse
  }

  return (
    <div 
      className="w-full"
      style={{
        '--blink-button': '#1D9BF0',
        '--blink-border-radius-rounded-button': '9999',
      } as React.CSSProperties}
    >
      <Blink
        blink={blink}
        adapter={adapter}
        websiteUrl={websiteUrl}
        websiteText={websiteText}
        securityLevel="all"
      />
    </div>
  )
}

