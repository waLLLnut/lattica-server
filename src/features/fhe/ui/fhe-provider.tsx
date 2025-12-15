'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { FHE16Module, FHE_PARAMS, Ciphertext } from '@/types/fhe'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  component?: string
}

interface FHEContextState {
  moduleReady: boolean
  logs: LogEntry[]
  addLog: (msg: string, level?: LogLevel, component?: string) => void
  clearLogs: () => void
  encryptValue: (plaintext: string) => Ciphertext | null
  module: FHE16Module | null
}

const FHEContext = createContext<FHEContextState | null>(null)

export function FHEProvider({ children }: { children: ReactNode }) {
  const [module, setModule] = useState<FHE16Module | null>(null)
  const [moduleReady, setModuleReady] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const addLog = (msg: string, level: LogLevel = 'info', component?: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, { level, message: msg, timestamp, component }])
  }

  const clearLogs = () => setLogs([])

  // WASM 로드 로직
  useEffect(() => {
    const loadWASM = async () => {
      try {
        if (!window.createFHE16) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script')
            script.src = '/fhe16.js'
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load fhe16.js'))
            document.head.appendChild(script)
          })
        }

        if (!window.createFHE16) {
          throw new Error('createFHE16 not found')
        }

        const mod = await window.createFHE16({
          locateFile: (path: string) => `/${path}`,
          print: (text: string) => addLog(`WASM: ${text}`, 'debug', 'WASM'),
          printErr: (text: string) => addLog(`WASM ERROR: ${text}`, 'error', 'WASM'),
        })

        mod._FHE16_init_params(
          FHE_PARAMS.PK_ROW,
          FHE_PARAMS.PK_COL,
          FHE_PARAMS.PK_Q,
          FHE_PARAMS.Q_TOT,
          FHE_PARAMS.SIGMA
        )
        addLog('FHE parameters initialized', 'info', 'FHE')

        addLog('Loading public key...', 'info', 'FHE')
        const response = await fetch('/pk.bin')
        if (!response.ok) throw new Error(`Failed to fetch pk.bin`)

        const pkBuffer = await response.arrayBuffer()
        const pkBytes = new Uint8Array(pkBuffer)
        const nints = pkBytes.byteLength >>> 2

        addLog(`Public key loaded: ${pkBytes.byteLength} bytes (${nints} ints)`, 'info', 'FHE')

        const ptr = mod._malloc(pkBytes.byteLength)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mod.HEAP8.set(pkBytes as any, ptr)
        mod._FHE16_set_pk(ptr, nints)
        mod._free(ptr)

        addLog('Public key set successfully', 'info', 'FHE')
        setModule(mod)
        setModuleReady(true)
        addLog('FHE16 WASM ready!', 'info', 'FHE')
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        addLog(`Failed to initialize WASM: ${errorMsg}`, 'error', 'FHE')
      }
    }

    loadWASM()
  }, [])

  const encryptValue = (plaintext: string): Ciphertext | null => {
    if (!module || !moduleReady) {
      addLog('WASM module not ready', 'warn', 'Encrypt')
      return null
    }

    try {
      const msg = parseInt(plaintext)
      const p = module._FHE16_ENC_WASM(msg, FHE_PARAMS.BIT)

      if (!p) {
        addLog('WASM encryption returned null pointer', 'error', 'Encrypt')
        return null
      }

      const ctStr = module.UTF8ToString(p)
      module._FHE16_free(p)

      const ctArray = ctStr.split(',').map((s) => parseInt(s.trim()))

      const invalidElements = ctArray.filter((x) => isNaN(x) || !isFinite(x))
      if (invalidElements.length > 0) {
        addLog(`Encryption produced ${invalidElements.length} invalid elements`, 'error', 'Encrypt')
        return null
      }

      // 32바이트 핸들 생성 (실제로는 해시 등을 사용 권장)
      const mockHandle = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 256)
          .toString(16)
          .padStart(2, '0')
      ).join('')

      const ciphertext: Ciphertext = {
        handle: mockHandle,
        encrypted_data: ctArray,
        timestamp: Date.now(),
        scheme: 'FHE16_0.0.1v',
      }

      addLog(`Encrypted: ${ctArray.length} elements`, 'info', 'Encrypt')
      return ciphertext
    } catch (error) {
      addLog(`Encryption error: ${error}`, 'error', 'Encrypt')
      return null
    }
  }

  return (
    <FHEContext.Provider value={{ moduleReady, logs, addLog, clearLogs, encryptValue, module }}>
      {children}
    </FHEContext.Provider>
  )
}

export const useFHE = () => {
  const ctx = useContext(FHEContext)
  if (!ctx) throw new Error('useFHE must be used within FHEProvider')
  return ctx
}
