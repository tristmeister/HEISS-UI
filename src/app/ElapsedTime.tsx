import { useEffect, useState } from 'react';

export function ElapsedTime({ startedAt, format }: { startedAt?: string; format: (value: number) => string }) {
  const startedAtMs = Date.parse(startedAt || "");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return format(Math.max(0, now - (Number.isFinite(startedAtMs) ? startedAtMs : now)));
}
