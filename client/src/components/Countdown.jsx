/**
 * -----------------------------------------------------------------------------
 *  components/Countdown.jsx — the flash-sale timer
 * -----------------------------------------------------------------------------
 *  Anchored to the *server's* clock: the API sends `secondsRemaining` together
 *  with `serverTime`, so a phone with a wrong clock still counts down to the
 *  moment the sale actually ends. We capture a monotonic reference on mount
 *  (performance.now) and derive the remainder from it — no drift, no jumps
 *  when the tab sleeps and wakes.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { splitCountdown } from '../lib/format';

export default function Countdown({ secondsRemaining, onExpire, size = 'md', className }) {
  // The moment we learned the remainder, in monotonic time.
  const anchor = useMemo(() => performance.now(), [secondsRemaining]);
  const [now, setNow] = useState(anchor);

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, (secondsRemaining ?? 0) - (now - anchor) / 1000);
  const { days, hours, minutes, seconds } = splitCountdown(remaining);

  useEffect(() => {
    if (remaining <= 0 && secondsRemaining > 0) onExpire?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps — fire once at zero
  }, [remaining <= 0]);

  if (secondsRemaining == null) return null;

  const cell = clsx(
    'flex flex-col items-center rounded-xl bg-soil-950/90 text-white tabular-nums',
    size === 'lg' ? 'min-w-[3.5rem] px-2 py-2' : 'min-w-[2.6rem] px-1.5 py-1',
  );
  const num = clsx('font-bold leading-none', size === 'lg' ? 'text-2xl' : 'text-base');
  const label = 'mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/60';

  const parts = [
    ...(days > 0 ? [[days, 'days']] : []),
    [hours, 'hrs'],
    [minutes, 'min'],
    [seconds, 'sec'],
  ];

  return (
    <div className={clsx('flex items-center gap-1.5', className)} role="timer" aria-label="Sale ends in">
      {parts.map(([value, unit]) => (
        <div key={unit} className={cell}>
          <span className={num}>{String(value).padStart(2, '0')}</span>
          <span className={label}>{unit}</span>
        </div>
      ))}
    </div>
  );
}
