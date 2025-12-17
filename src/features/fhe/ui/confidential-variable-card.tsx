'use client';

import { useEffect, useRef, useState } from 'react';
import { Ciphertext } from '@/types/fhe';

interface ConfidentialVariableCardProps {
  label: string;
  value: string;
  state: 'initial' | 'encrypted' | 'decrypted' | string;
  ciphertext: Ciphertext | null;
  cid?: string;
  color: string;
  onDecrypt?: () => void; // 복호화 버튼이 필요하다면 추가
}

export function ConfidentialVariableCard({ 
  label, 
  value, 
  state, 
  ciphertext, 
  cid, 
  color 
}: ConfidentialVariableCardProps) {
  const isEncrypted = state === 'encrypted';
  const prevHandleRef = useRef<string | null>(null);
  const [isChanging, setIsChanging] = useState(false);

  // 암호문 변경 감지 및 시각적 피드백
  useEffect(() => {
    if (ciphertext?.handle) {
      const currentHandle = ciphertext.handle;
      if (prevHandleRef.current && prevHandleRef.current !== currentHandle) {
        // 암호문이 변경되었을 때 플래시 효과
        setIsChanging(true);
        setTimeout(() => setIsChanging(false), 600);
      }
      prevHandleRef.current = currentHandle;
    }
  }, [ciphertext?.handle]);

  // 1. 암호문 텍스트 시각화 (핸들 값만 표시)
  const getDisplayValue = () => {
    if (isEncrypted && ciphertext) {
      // 핸들 값만 표시 (앞 8자리)
      return ciphertext.handle.slice(0, 8);
    }
    return value;
  };

  return (
    <>
      {/* 2. 애니메이션 정의 (Gradient Animation) */}
      <style>{`
        @keyframes gradient-shine {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes flash {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.02); }
        }
        @keyframes pulse-border {
          0%, 100% { box-shadow: 0 0 15px ${color}4d; }
          50% { box-shadow: 0 0 30px ${color}ff, 0 0 20px ${color}aa; }
        }
      `}</style>

      <div style={{
        padding: '12px',
        // 암호화 상태일 때 배경색을 살짝 틴트 처리
        background: isEncrypted ? `${color}1a` : '#0a0a0a', 
        borderRadius: '8px',
        // 테두리 색상 및 빛나는 효과(Box Shadow) 복원
        border: `2px solid ${isEncrypted ? (isChanging ? '#ffffff' : color) : '#333'}`,
        boxShadow: isEncrypted ? `0 0 15px ${color}4d` : 'none', // 4d = ~30% opacity
        minWidth: '200px',
        transition: 'all 0.3s ease',
        // 변경 감지 시 플래시 효과
        animation: isChanging ? 'flash 0.6s ease, pulse-border 0.6s ease' : undefined
      }}>
        <div style={{ fontSize: '12px', fontWeight: 'bold', color: color, marginBottom: '6px' }}>
          {label}
        </div>

        {/* 3. 텍스트 표시 */}
        <div style={{ 
          fontSize: '16px', 
          fontFamily: 'monospace', 
          marginBottom: '8px',
          minHeight: '30px',
          fontWeight: isEncrypted ? 'bold' : 'normal',
          color: isEncrypted ? color : (state === 'decrypted' ? '#10b981' : '#fff'),
          transition: 'all 0.3s ease'
        }}>
          {getDisplayValue()}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '10px', color: isChanging ? color : '#666', transition: 'color 0.3s ease' }}>
            {isEncrypted ? (isChanging ? 'RE-ENCRYPTED!' : 'ENCRYPTED') : cid ? 'REGISTERED' : 'INITIAL'}
          </div>
          {ciphertext && (
            <div style={{ fontSize: '9px', color: '#444', fontFamily: 'monospace' }}>
              Handle: {ciphertext.handle.slice(0, 8)}...
            </div>
          )}
          {cid && !ciphertext && (
            <div style={{ fontSize: '10px', color: '#444', fontFamily: 'monospace' }}>
              CID: {cid.slice(0, 6)}...
            </div>
          )}
        </div>
      </div>
    </>
  );
}

