import { useState } from 'react';
import { initials } from '@/lib/format';

export function Avatar({ name, url, size = 36, premium }: { name: string; url?: string | null; size?: number; premium?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`avatar${premium ? ' avatar-premium' : ''}`} style={{ ['--size' as string]: `${size}px` }} aria-hidden="true">
      {url && !broken ? <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}
