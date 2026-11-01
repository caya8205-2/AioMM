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
  collapsed?: boolean;
}

function FolderSwitcher({
  currentRoot,
  recentRoots,
  detectedFolders,
  onSelectRoot,
  onPickFolder,
  onRefresh,
  compact = false,
  collapsed = false,
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
    <div
      className={clsx(
        'flex items-center',
        collapsed ? 'justify-center w-full' : 'min-w-0 gap-1.5',
      )}
      ref={containerRef}
    >
      <div className={clsx('relative', collapsed ? '' : 'min-w-0 flex-1')}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={currentRoot ?? 'Select Mods Folder'}
          className={clsx(
            'flex items-center rounded-md border transition-colors',
            collapsed
              ? 'h-9 w-9 justify-center bg-surface-elevated'
              : compact
                ? 'min-h-[44px] max-w-[200px] w-full justify-between gap-2 bg-surface-elevated px-2.5 text-left'
                : 'h-9 w-full justify-between gap-2 bg-surface-elevated px-2.5 text-left',
            open
              ? 'border-hairline-strong text-ink-bright'
              : 'border-hairline text-ink-body hover:border-hairline-strong hover:text-ink-bright',
          )}
        >
          {collapsed ? (
            <Icon
              icon={currentRoot ? Icons.folderOpen : Icons.folder}
              size={16}
              className="shrink-0 text-ink-mute"
            />
          ) : (
            <>
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
            </>
          )}
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Mods folder switcher"
            className={clsx(
              'absolute z-50 rounded-md border border-hairline-strong bg-surface-elevated p-1.5 shadow-2xl',
              collapsed
                ? 'left-full top-0 ml-2 w-[264px]'
                : compact
                  ? 'right-0 top-full mt-1.5 w-[264px] max-w-[calc(100vw-24px)]'
                  : 'left-0 top-full mt-1.5 w-[264px] max-w-[calc(100vw-24px)]',
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

      {!collapsed && (
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
      )}
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

  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('aiomm:sidebarWidth');
      if (saved) {
        const n = Number(saved);
        if (n >= 170 && n <= 380) return n;
      }
    } catch {}
    return 220;
  });

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('aiomm:sidebarCollapsed') === 'true';
    } catch {}
    return false;
  });

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('aiomm:sidebarCollapsed', String(next));
      } catch {}
      return next;
    });
  }

  function handleResizeStart(e: React.MouseEvent) {
    if (collapsed) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;

    function onMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      const nextW = Math.max(170, Math.min(380, startW + delta));
      setWidth(nextW);
    }

    function onMouseUp(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      const finalW = Math.max(170, Math.min(380, startW + delta));
      try {
        localStorage.setItem('aiomm:sidebarWidth', String(finalW));
      } catch {}
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  return (
    <>
      <aside
        aria-label="Primary sidebar"
        style={{ width: collapsed ? '60px' : `${width}px` }}
        className="relative hidden shrink-0 flex-col border-r border-hairline bg-surface select-none sm:flex"
      >
        {!collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize sidebar"
            onMouseDown={handleResizeStart}
            className="absolute top-0 right-0 bottom-0 z-30 w-1.5 cursor-col-resize transition-colors hover:bg-white/30 active:bg-white/50"
          />
        )}

        <div
          className={clsx(
            'flex shrink-0 flex-col gap-2.5 border-b border-hairline',
            collapsed ? 'items-center p-2' : 'p-3',
          )}
        >
          <div
            className={clsx(
              'flex items-center',
              collapsed ? 'w-full justify-center' : 'justify-between px-0.5',
            )}
          >
            <button
              type="button"
              onClick={toggleCollapse}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={clsx(
                'inline-flex min-h-[32px] items-center rounded-md text-xs text-ink-mute transition-colors hover:bg-surface-elevated hover:text-ink-bright',
                collapsed ? 'h-8 w-8 justify-center p-0' : 'gap-1.5 px-2 py-1',
              )}
            >
              <Icon
                icon={collapsed ? Icons.chevronRight : Icons.arrowLeft}
                size={15}
              />
              {!collapsed && <span className="font-medium">Collapse</span>}
            </button>

            {!collapsed && isPreviewMode && (
              <span className="rounded-xs border border-hairline bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-ink-mute">
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
            collapsed={collapsed}
          />
        </div>

        <nav
          aria-label="Workspace sections"
          className={clsx(
            'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto',
            collapsed ? 'items-center p-2' : 'p-2.5',
          )}
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={clsx(
                  'flex min-h-[40px] items-center rounded-md border transition-colors',
                  collapsed
                    ? 'h-10 w-10 justify-center p-0'
                    : 'w-full justify-between gap-2.5 px-2 py-1.5 text-left text-[14px] font-medium',
                  isActive
                    ? 'border-hairline bg-surface-elevated text-ink-bright'
                    : 'border-transparent text-ink-body hover:bg-surface-elevated/60 hover:text-ink-bright',
                )}
              >
                <span
                  className={clsx(
                    'flex min-w-0 items-center',
                    collapsed ? 'justify-center' : 'gap-2.5',
                  )}
                >
                  <span
                    className={clsx(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-card transition-colors',
                      isActive ? 'text-ink-bright' : 'text-ink-mute',
                    )}
                  >
                    <Icon icon={item.icon} size={15} />
                  </span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>

                {!collapsed && item.badge && (
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

        {!collapsed && currentRoot && (
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
