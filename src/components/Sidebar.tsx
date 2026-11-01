import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { ActiveView, DetectedFolder } from '../types';
import { Icon, Icons } from './Icon';

export interface SidebarProps {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  currentRoot: string | null;
  recentRoots: string[];
  detectedFolders: DetectedFolder[];
  onSelectRoot: (path: string) => void;
  onPickFolder: () => void;
  onRefresh: () => void;
  totalMods: number;
  conflictCount: number;
  isPreviewMode: boolean;
}

function formatRootLabel(path: string, detected: DetectedFolder[]): string {
  const known = detected.find((d) => d.path === path);
  if (known) {
    return known.label.replace(/\s*\[Preview Mode\]$/i, '').trim();
  }
  const parts = path.split(/[/\\]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] ?? path;
}

interface FolderSwitcherProps {
  currentRoot: string | null;
  recentRoots: string[];
  detectedFolders: DetectedFolder[];
  onSelectRoot: (path: string) => void;
  onPickFolder: () => void;
  onRefresh: () => void;
  compact?: boolean;
}

function FolderSwitcher({
  currentRoot,
  recentRoots,
  detectedFolders,
  onSelectRoot,
  onPickFolder,
  onRefresh,
  compact = false,
}: FolderSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const extraRecent = recentRoots.filter(
    (r) => !detectedFolders.some((d) => d.path === r),
  );
  const activeLabel = currentRoot
    ? formatRootLabel(currentRoot, detectedFolders)
    : 'Select Mods Folder';

  return (
    <div className="flex min-w-0 items-center gap-1.5" ref={containerRef}>
      <div className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={currentRoot ?? 'Select Mods Folder'}
          className={clsx(
            'flex w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-surface-elevated px-2.5 text-left transition-colors',
            compact ? 'min-h-[44px] max-w-[200px]' : 'h-9',
            open
              ? 'border-hairline-strong text-ink-bright'
              : 'border-hairline text-ink-body hover:border-hairline-strong hover:text-ink-bright',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon
              icon={currentRoot ? Icons.folderOpen : Icons.folder}
              size={15}
              className="shrink-0 text-ink-mute"
            />
            <span
              className={clsx(
                'truncate text-[13px] font-medium',
                currentRoot ? 'text-ink-bright' : 'text-ink-mute',
              )}
            >
              {activeLabel}
            </span>
          </span>
          <Icon
            icon={Icons.chevronDown}
            size={14}
            className={clsx(
              'shrink-0 text-ink-mute transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Mods folder switcher"
            className={clsx(
              'absolute top-full z-50 mt-1.5 w-[264px] max-w-[calc(100vw-24px)] rounded-md border border-hairline-strong bg-surface-elevated p-1.5',
              compact ? 'right-0' : 'left-0',
            )}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPickFolder();
              }}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-[13px] font-medium text-ink-bright transition-colors hover:bg-surface-card sm:min-h-[36px]"
            >
              <Icon
                icon={Icons.folderOpen}
                size={16}
                className="shrink-0 text-ink-mute"
              />
              <span>Choose Mods Folder...</span>
            </button>

            {detectedFolders.length > 0 && (
              <>
                <div className="my-1 border-t border-hairline" />
                <div className="px-2.5 py-1 text-[12px] font-medium text-ink-mute">
                  Detected Folders
                </div>
                {detectedFolders.map((df) => {
                  const isCurrent = currentRoot === df.path;
                  return (
                    <button
                      key={df.path}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        onSelectRoot(df.path);
                      }}
                      className={clsx(
                        'flex min-h-[44px] w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left transition-colors sm:min-h-[36px]',
                        isCurrent
                          ? 'bg-surface-card text-ink-bright'
                          : 'text-ink-body hover:bg-surface-card hover:text-ink-bright',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {df.label}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-ink-mute">
                          {df.path}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-xs border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-mute">
                          {df.gameCode}
                        </span>
                        {isCurrent && (
                          <Icon
                            icon={Icons.check}
                            size={14}
                            className="text-ink-bright"
                          />
                        )}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {extraRecent.length > 0 && (
              <>
                <div className="my-1 border-t border-hairline" />
                <div className="px-2.5 py-1 text-[12px] font-medium text-ink-mute">
                  Recent Folders
                </div>
                {extraRecent.map((path) => {
                  const isCurrent = currentRoot === path;
                  return (
                    <button
                      key={path}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        onSelectRoot(path);
                      }}
                      className={clsx(
                        'flex min-h-[44px] w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left transition-colors sm:min-h-[36px]',
                        isCurrent
                          ? 'bg-surface-card text-ink-bright'
                          : 'text-ink-body hover:bg-surface-card hover:text-ink-bright',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {formatRootLabel(path, detectedFolders)}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-ink-mute">
                          {path}
                        </span>
                      </span>
                      {isCurrent && (
                        <Icon
                          icon={Icons.check}
                          size={14}
                          className="shrink-0 text-ink-bright"
                        />
                      )}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRefresh}
        disabled={!currentRoot}
        title="Rescan current folder"
        aria-label="Rescan mods folder"
        className={clsx(
          'flex shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-elevated text-ink-body transition-colors hover:border-hairline-strong hover:text-ink-bright disabled:cursor-not-allowed disabled:opacity-40',
          compact ? 'min-h-[44px] min-w-[44px]' : 'h-9 w-9',
        )}
      >
        <Icon icon={Icons.refresh} size={15} />
      </button>
    </div>
  );
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const {
    activeView,
    onSelectView,
    currentRoot,
    recentRoots,
    detectedFolders,
    onSelectRoot,
    onPickFolder,
    onRefresh,
    totalMods,
    conflictCount,
    isPreviewMode,
  } = props;

  const navItems: Array<{
    id: ActiveView;
    label: string;
    icon: typeof Icons.folder;
    badge?: { text: string; tone: 'neutral' | 'danger' };
  }> = [
    {
      id: 'mods',
      label: 'Mods',
      icon: Icons.folder,
      badge:
        totalMods > 0
          ? { text: String(totalMods), tone: 'neutral' }
          : undefined,
    },
    {
      id: 'keybinds',
      label: 'Keybinds',
      icon: Icons.keyboard,
      badge:
        conflictCount > 0
          ? { text: String(conflictCount), tone: 'danger' }
          : undefined,
    },
    {
      id: 'presets',
      label: 'Presets',
      icon: Icons.sliders,
    },
  ];

  return (
    <>
      <aside
        aria-label="Primary sidebar"
        className="hidden w-[220px] shrink-0 flex-col border-r border-hairline bg-surface sm:flex lg:w-[240px]"
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-hairline p-3">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="flex items-center gap-2.5">
              <img
                src="/icon.png"
                alt="AIOMM"
                className="h-8 w-8 shrink-0 rounded-md border border-hairline object-cover shadow-xs"
              />
              <div className="flex flex-col">
                <span className="text-[16px] font-semibold tracking-tight text-ink">
                  AIOMM
                </span>
                <span className="text-[10px] font-normal tracking-wide text-ink-mute">
                  All in one mod manager
                </span>
              </div>
            </div>
            {isPreviewMode && (
              <span className="rounded-xs border border-hairline bg-surface-elevated px-1.5 py-0.5 text-[11px] font-medium text-ink-mute">
                Preview Mode
              </span>
            )}
          </div>

          <FolderSwitcher
            currentRoot={currentRoot}
            recentRoots={recentRoots}
            detectedFolders={detectedFolders}
            onSelectRoot={onSelectRoot}
            onPickFolder={onPickFolder}
            onRefresh={onRefresh}
          />
        </div>

        <nav
          aria-label="Workspace sections"
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2.5"
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                  'flex min-h-[42px] w-full items-center justify-between gap-2.5 rounded-md border px-2 py-1.5 text-left text-[14px] font-medium transition-colors',
                  isActive
                    ? 'border-hairline bg-surface-elevated text-ink-bright'
                    : 'border-transparent text-ink-body hover:bg-surface-elevated/60 hover:text-ink-bright',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={clsx(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-card transition-colors',
                      isActive ? 'text-ink-bright' : 'text-ink-mute',
                    )}
                  >
                    <Icon icon={item.icon} size={16} />
                  </span>
                  <span className="truncate">{item.label}</span>
                </span>

                {item.badge && (
                  <span
                    className={clsx(
                      'shrink-0 rounded-xs px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                      item.badge.tone === 'danger'
                        ? 'border border-status-red/30 bg-status-red-soft text-status-red'
                        : 'border border-hairline bg-surface-card text-ink-mute',
                    )}
                  >
                    {item.badge.text}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {currentRoot && (
          <div
            title={currentRoot}
            className="shrink-0 truncate border-t border-hairline px-3 py-2.5 font-mono text-[11px] text-ink-mute"
          >
            {currentRoot}
          </div>
        )}
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-hairline bg-surface px-3 sm:hidden">
        <div className="flex shrink-0 items-center gap-2">
          <img
            src="/icon.png"
            alt="AIOMM"
            className="h-7 w-7 shrink-0 rounded-md border border-hairline object-cover shadow-xs"
          />
          <div className="flex flex-col">
            <span className="text-[15px] font-semibold tracking-tight text-ink">
              AIOMM
            </span>
            <span className="text-[9px] font-normal tracking-wide text-ink-mute">
              All in one mod manager
            </span>
          </div>
          {isPreviewMode && (
            <span className="rounded-xs border border-hairline bg-surface-elevated px-1.5 py-0.5 text-[11px] font-medium text-ink-mute">
              Preview Mode
            </span>
          )}
        </div>

        <FolderSwitcher
          currentRoot={currentRoot}
          recentRoots={recentRoots}
          detectedFolders={detectedFolders}
          onSelectRoot={onSelectRoot}
          onPickFolder={onPickFolder}
          onRefresh={onRefresh}
          compact
        />
      </header>

      <nav
        aria-label="Mobile workspace navigation"
        className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-3 gap-1.5 border-t border-hairline bg-surface px-2 py-1.5 sm:hidden"
      >
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={clsx(
                'relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-1 transition-colors',
                isActive
                  ? 'border-hairline bg-surface-elevated text-ink-bright'
                  : 'border-transparent text-ink-mute hover:text-ink-bright',
              )}
            >
              <span className="flex items-center gap-1.5">
                <Icon icon={item.icon} size={18} />
                {item.badge && (
                  <span
                    className={clsx(
                      'rounded-xs px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums',
                      item.badge.tone === 'danger'
                        ? 'border border-status-red/30 bg-status-red-soft text-status-red'
                        : 'border border-hairline bg-surface-card text-ink-mute',
                    )}
                  >
                    {item.badge.text}
                  </span>
                )}
              </span>
              <span className="text-[11px] font-medium leading-tight">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
