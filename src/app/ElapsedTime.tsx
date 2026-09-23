import { useEffect, useState } from 'react';
import { serverClockOffset } from './api';

/** Time since a server-stamped start, on the server's clock so another machine's clock cannot freeze it at 0s. */
export function ElapsedTime({ startedAt, format }: { startedAt?: string; format: (value: number) => string }) {
  const startedAtMs = Date.parse(startedAt || "");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const serverNow = now + serverClockOffset;
  return format(Math.max(0, serverNow - (Number.isFinite(startedAtMs) ? startedAtMs : serverNow)));
}
