'use client';

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

  // 1. 암호문 텍스트 시각화 (기존 데모처럼 일부 데이터만 Hex/String으로 변환하여 보여줌)
  const getDisplayValue = () => {
    if (isEncrypted && ciphertext) {
      // 암호문 데이터의 일부를 가져와서 시각적으로 보여줌
      return ciphertext.encrypted_data
        .slice(0, 8) 
        .map((n: number) => Math.abs(n % 1296).toString(36).padStart(2, '0'))
        .join('')
        .toUpperCase() + '...';
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
      `}</style>

      <div style={{
        padding: '12px',
        // 암호화 상태일 때 배경색을 살짝 틴트 처리
        background: isEncrypted ? `${color}1a` : '#0a0a0a', 
        borderRadius: '8px',
        // 테두리 색상 및 빛나는 효과(Box Shadow) 복원
        border: `2px solid ${isEncrypted ? color : '#333'}`,
        boxShadow: isEncrypted ? `0 0 15px ${color}4d` : 'none', // 4d = ~30% opacity
        minWidth: '200px',
        transition: 'all 0.3s ease'
      }}>
        <div style={{ fontSize: '12px', fontWeight: 'bold', color: color, marginBottom: '6px' }}>
          {label}
        </div>

        {/* 3. 텍스트 빛나는 효과 적용 */}
        <div style={{ 
          fontSize: '20px', 
          fontFamily: 'monospace', 
          marginBottom: '8px',
          minHeight: '30px',
          fontWeight: isEncrypted ? 'bold' : 'normal',
          
          // 핵심: 암호화 상태일 때 Gradient Text 적용
          ...(isEncrypted ? {
            background: `linear-gradient(90deg, ${color}, #ffffff, ${color})`,
            backgroundSize: '200% 100%',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            animation: 'gradient-shine 2s ease infinite'
          } : {
            color: state === 'decrypted' ? '#10b981' : '#fff' // 복호화시 초록/흰색
          })
        }}>
          {getDisplayValue()}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '10px', color: '#666' }}>
            {isEncrypted ? 'ENCRYPTED' : cid ? 'REGISTERED' : 'INITIAL'}
          </div>
          {cid && (
            <div style={{ fontSize: '10px', color: '#444', fontFamily: 'monospace' }}>
              CID: {cid.slice(0, 6)}...
            </div>
          )}
        </div>
      </div>
    </>
  );
}
