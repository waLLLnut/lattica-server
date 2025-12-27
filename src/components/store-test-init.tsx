'use client';

/**
 * @file store-test-init.tsx
 * @description 개발 환경에서 스토어 테스트 유틸리티를 초기화하는 컴포넌트
 * 
 * 브라우저 콘솔에서 window.store와 window.testStore를 사용할 수 있도록 합니다.
 */

import { useEffect } from 'react';

export function StoreTestInit() {
  useEffect(() => {
    // 개발 환경에서만 실행
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    // 동적 import로 테스트 유틸리티 로드
    import('@/lib/store/__tests__/store-test-utils').catch(() => {
      // 에러 무시 (테스트 유틸리티가 없어도 앱은 정상 동작)
    });
  }, []);

  return null; // 렌더링하지 않음
}

