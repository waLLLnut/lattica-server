'use client'

import { useState } from 'react'
import { BlinkComponent } from '@/components/blink/blink-component'

export default function BlinkPage() {
  const [blinkUrl, setBlinkUrl] = useState<string>('')
  const [activeUrl, setActiveUrl] = useState<string>('')

  // 기존 API 엔드포인트들
  const apiEndpoints = [
    { name: 'Register Input Handle', url: '/api/actions/register_input_handle' },
    { name: 'Request Binary Op', url: '/api/actions/request_binary_op' },
    { name: 'Request Unary Op', url: '/api/actions/request_unary_op' },
    { name: 'Request Ternary Op', url: '/api/actions/request_ternary_op' },
  ]

  const handleLoadBlink = () => {
    if (blinkUrl.trim()) {
      const url = blinkUrl.startsWith('http') 
        ? blinkUrl 
        : `${window.location.origin}${blinkUrl.startsWith('/') ? blinkUrl : `/${blinkUrl}`}`
      setActiveUrl(url)
    }
  }

  const handleUseApiEndpoint = (endpoint: string) => {
    const fullUrl = `${window.location.origin}${endpoint}`
    setBlinkUrl(fullUrl)
    setActiveUrl(fullUrl)
  }

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Blink 테스트 페이지</h1>

      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
          <h2 className="text-xl font-semibold mb-4">Blink URL 입력</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={blinkUrl}
              onChange={(e) => setBlinkUrl(e.target.value)}
              placeholder="Blink API URL"
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleLoadBlink()
                }
              }}
            />
            <button
              onClick={handleLoadBlink}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              로드
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
          <h2 className="text-xl font-semibold mb-4">API 엔드포인트</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {apiEndpoints.map((endpoint) => (
              <button
                key={endpoint.url}
                onClick={() => handleUseApiEndpoint(endpoint.url)}
                className="p-4 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <div className="font-semibold text-gray-900 dark:text-gray-100">
                  {endpoint.name}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-500 mt-2 font-mono">
                  {endpoint.url}
                </div>
              </button>
            ))}
          </div>
        </div>

        {activeUrl && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
            <h2 className="text-xl font-semibold mb-4">Blink 컴포넌트</h2>
            <BlinkComponent url={activeUrl} />
          </div>
        )}
      </div>
    </div>
  )
}

