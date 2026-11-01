import clsx from 'clsx';
import { Icon, Icons } from './Icon';

export interface PaginationBarProps {
  currentPage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  totalItems: number;
  itemLabel?: string;
  onPageChange: (page: number) => void;
}

export function PaginationBar({
  currentPage,
  totalPages,
  startIndex,
  endIndex,
  totalItems,
  itemLabel = 'items',
  onPageChange,
}: PaginationBarProps): JSX.Element | null {
  if (totalItems === 0) return null;

  const pages: (number | 'ellipsis')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('ellipsis');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
  }

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-hairline pt-4 sm:flex-row">
      <span className="text-xs text-ink-mute">
        Showing <span className="font-medium text-ink-body">{startIndex + 1}</span> to{' '}
        <span className="font-medium text-ink-body">{endIndex}</span> of{' '}
        <span className="font-medium text-ink-body">{totalItems}</span> {itemLabel}
      </span>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Previous page"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hairline bg-surface-elevated text-ink-mute hover:border-hairline-strong hover:text-ink-bright disabled:pointer-events-none disabled:opacity-40 sm:min-h-[32px] sm:min-w-[32px]"
          >
            <Icon icon={Icons.arrowLeft} size={13} />
          </button>

          {pages.map((p, idx) => {
            if (p === 'ellipsis') {
              return (
                <span
                  key={`ellipsis-${idx}`}
                  className="flex min-w-[28px] items-center justify-center text-xs text-ink-mute"
                >
                  &hellip;
                </span>
              );
            }
            const isActive = p === currentPage;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-xs font-medium transition-colors sm:min-h-[32px] sm:min-w-[32px]',
                  isActive
                    ? 'border border-hairline-strong bg-white font-semibold text-black'
                    : 'border border-hairline bg-surface-elevated text-ink-body hover:border-hairline-strong hover:text-ink-bright',
                )}
              >
                {p}
              </button>
            );
          })}

          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Next page"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hairline bg-surface-elevated text-ink-mute hover:border-hairline-strong hover:text-ink-bright disabled:pointer-events-none disabled:opacity-40 sm:min-h-[32px] sm:min-w-[32px]"
          >
            <Icon icon={Icons.chevronRight} size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
