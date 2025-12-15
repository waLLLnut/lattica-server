'use client';

import { ReactNode } from 'react';

interface StepCardProps {
  title: string;
  description?: string;
  isActive: boolean;
  isCompleted?: boolean;
  children: ReactNode;
}

export function StepCard({ title, description, isActive, isCompleted, children }: StepCardProps) {
  const borderColor = isCompleted ? '#0f0' : '#555';
  
  return (
    <fieldset className={`
      my-5 p-4 rounded-lg border-2 transition-all duration-300 bg-[#0a0a0a]
      ${isActive ? 'opacity-100' : 'opacity-60'}
    `}
    style={{ borderColor }}
    >
      <legend className={`text-lg font-bold px-2 ${isCompleted ? 'text-[#0f0]' : 'text-white'}`}>
        {title}
      </legend>
      {description && <p className="text-sm text-[#888] mb-4">{description}</p>}
      {children}
    </fieldset>
  );
}
