'use client';

import { FHEProvider } from '@/features/fhe/ui/fhe-provider';
import { DemoContent } from '@/features/fhe/demo/demo-content';

export default function DemoPage() {
  return (
    <FHEProvider>
      <DemoContent />
    </FHEProvider>
  );
}
