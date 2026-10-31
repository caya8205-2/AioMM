import clsx from 'clsx';
import { formatKeyTokens } from '../lib/keymap';

interface KeycapProps {
  rawKey: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'conflict';
}

export function Keycap({ rawKey, size = 'sm', tone = 'default' }: KeycapProps) {
  const tokens = formatKeyTokens(rawKey);
  if (tokens.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {tokens.map((tok, idx) => (
        <kbd
          key={`${tok}-${idx}`}
          className={clsx(
            'inline-flex items-center justify-center rounded-xs font-sans font-medium leading-none select-none',
            size === 'sm' ? 'min-h-[20px] px-1.5 py-0.5 text-[12px]' : 'min-h-[26px] px-2.5 py-1 text-[13px]',
            tone === 'conflict'
              ? 'border border-status-red/40 bg-status-red-soft text-status-red'
              : 'keycap-surface text-ink-body',
          )}
        >
          {tok}
        </kbd>
      ))}
    </span>
  );
}
