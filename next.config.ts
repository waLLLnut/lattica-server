import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* config options here */
  // instrumentation.ts 파일 활성화 (Next.js 13+)
  experimental: {
    instrumentationHook: true,
  },
}

export default nextConfig
