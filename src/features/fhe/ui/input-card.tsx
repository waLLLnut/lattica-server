'use client'

import { useState } from 'react'
import { useFHE } from './fhe-provider'
import { useFheActions } from '@/features/fhe/data-access/use-fhe-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

interface InputCardProps {
  label: string
  onRegistered?: (handle: string) => void
}

export function InputCard({ label, onRegistered }: InputCardProps) {
  const [val, setVal] = useState('0')
  const [handle, setHandle] = useState<string | null>(null)
  const { encryptValue, moduleReady } = useFHE()
  const { registerInputHandle, loading } = useFheActions()

  const handleRegister = async () => {
    if (!moduleReady) return

    const ct = encryptValue(val)
    if (ct) {
      try {
        const registeredHandle = await registerInputHandle(ct.handle, ct.encrypted_data)
        if (registeredHandle) {
          setHandle(registeredHandle)
          onRegistered?.(registeredHandle)
        }
      } catch (error) {
        // Error is already logged by useFheActions
      }
    }
  }

  return (
    <Card className="p-4 border border-zinc-800 bg-zinc-900">
      <Label className="text-xs text-zinc-400 mb-2">{label}</Label>
      <div className="flex gap-2">
        <Input
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          disabled={!!handle}
          className="bg-black border-zinc-700 text-white"
        />
        <Button
          onClick={handleRegister}
          disabled={loading || !moduleReady || !!handle}
          className="bg-green-600 hover:bg-green-700 text-white px-4 disabled:opacity-50"
        >
          {handle ? 'Done' : loading ? '...' : 'Register'}
        </Button>
      </div>
      {handle && (
        <div className="text-[10px] font-mono text-green-500 mt-2 truncate">
          Handle: {handle.slice(0, 16)}...
        </div>
      )}
    </Card>
  )
}
