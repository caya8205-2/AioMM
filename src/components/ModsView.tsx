import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { api, IS_TAURI, resolveModImageUrl } from '../lib/api';
import { formatKeyTokens } from '../lib/keymap';
import type { DetectedFolder, ModEntry, Preset } from '../types';
import { Icon, Icons } from './Icon';
import { Keycap } from './Keycap';
import { ModInspector } from './ModInspector';
import { PaginationBar } from './PaginationBar';

export interface ModsViewProps {
  root: string | null;
  mods: ModEntry[];
  presets: Preset[];
  loading: boolean;
  error: string | null;
  detectedFolders: DetectedFolder[];
  selectedModId: string | null;
  onSelectMod: (modId: string | null) => void;
  onPickFolder: () => void;
  onSelectRoot: (path: string) => void;
  onToggleMod: (mod: ModEntry) => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
}

type ModFilter =
  | 'all'
  | 'active'
  | 'disabled'
  | 'conflicts'
  | 'clashes'
  | 'missing'
  | 'patched'
  | 'has-backup';

type ModSort = 'name-asc' | 'name-desc' | 'keys-count' | 'status' | 'category';

function modHasInternalConflict(mod: ModEntry): boolean {
  const seen = new Set<string>();
  for (const kb of mod.keybinds) {
    if (!kb.normalizedKey) continue;
    if (seen.has(kb.normalizedKey)) return true;
    seen.add(kb.normalizedKey);
  }
  return false;
}

function ModThumbnail({
  previewPath,
  enabled,
}: {
  previewPath: string | null;
  enabled: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const url = resolveModImageUrl(previewPath);

  useEffect(() => {
    setFailed(false);
  }, [previewPath]);

  return (
    <div
      className={clsx(
        'flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-hairline bg-surface-card',
        !enabled && 'opacity-70',
      )}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Icon icon={Icons.layers} size={20} className="text-ink-mute" />
      )}
    </div>
  );
}

export function ModsView(props: ModsViewProps): JSX.Element {
  const {
    root,
    mods,
    presets,
    loading,
    error,
    detectedFolders,
    selectedModId,
    onSelectMod,
    onPickFolder,
    onSelectRoot,
    onToggleMod,
    onRefresh,
    onNotify,
    searchInputRef,
  } = props;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ModFilter>('all');
  const [sortBy, setSortBy] = useState<ModSort>('name-asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('aiomm:inspectorWidth');
      if (saved) {
        const n = Number(saved);
        if (n >= 280 && n <= 700) return n;
      }
    } catch {}
    return 360;
  });
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [installingZip, setInstallingZip] = useState(false);

  function handleInspectorResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = inspectorWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(ev: MouseEvent) {
      const delta = startX - ev.clientX;
      const maxW = Math.min(700, Math.max(300, window.innerWidth - 300));
      const nextW = Math.max(260, Math.min(maxW, startW + delta));
      setInspectorWidth(nextW);
    }

    function onMouseUp(ev: MouseEvent) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const delta = startX - ev.clientX;
      const maxW = Math.min(700, Math.max(300, window.innerWidth - 300));
      const finalW = Math.max(260, Math.min(maxW, startW + delta));
      try {
        localStorage.setItem('aiomm:inspectorWidth', String(finalW));
      } catch {}
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  const counts = useMemo(() => {
    let active = 0;
    let disabled = 0;
    let patched = 0;
    let conflicts = 0;
    let clashes = 0;
    let missing = 0;
    let hasBackup = 0;
    for (const m of mods) {
      if (m.enabled) active++;
      else disabled++;
      if (m.appliedPresetIds.length > 0) patched++;
      if (modHasInternalConflict(m)) conflicts++;
      if (m.meshConflicts.length > 0 && m.enabled) clashes++;
      if (m.missingAssets.length > 0) missing++;
      if (m.hasAnyBackup) hasBackup++;
    }
    return {
      all: mods.length,
      active,
      disabled,
      patched,
      conflicts,
      clashes,
      missing,
      hasBackup,
    };
  }, [mods]);

  const filteredMods = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = mods.filter((mod) => {
      if (filter === 'active' && !mod.enabled) return false;
      if (filter === 'disabled' && mod.enabled) return false;
      if (filter === 'patched' && mod.appliedPresetIds.length === 0)
        return false;
      if (filter === 'conflicts' && !modHasInternalConflict(mod))
        return false;
      if (
        filter === 'clashes' &&
        (mod.meshConflicts.length === 0 || !mod.enabled)
      )
        return false;
      if (filter === 'missing' && mod.missingAssets.length === 0)
        return false;
      if (filter === 'has-backup' && !mod.hasAnyBackup)
        return false;

      if (!q) return true;

      if (mod.displayName.toLowerCase().includes(q)) return true;
      if (mod.name.toLowerCase().includes(q)) return true;
      if (mod.category?.toLowerCase().includes(q)) return true;
      if (mod.iniFiles.some((f) => f.relName.toLowerCase().includes(q)))
        return true;
      if (
        mod.keybinds.some(
          (kb) =>
            kb.rawKey.toLowerCase().includes(q) ||
            kb.normalizedKey.toLowerCase().includes(q) ||
            formatKeyTokens(kb.rawKey).join(' ').toLowerCase().includes(q),
        )
      ) {
        return true;
      }

      return false;
    });

    result.sort((a, b) => {
      switch (sortBy) {
        case 'name-asc':
          return a.displayName.localeCompare(b.displayName);
        case 'name-desc':
          return b.displayName.localeCompare(a.displayName);
        case 'keys-count':
          return b.keybinds.length - a.keybinds.length;
        case 'status':
          if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
          return a.displayName.localeCompare(b.displayName);
        case 'category':
          return (
            (a.category || '').localeCompare(b.category || '') ||
            a.displayName.localeCompare(b.displayName)
          );
        default:
          return 0;
      }
    });

    return result;
  }, [mods, filter, query, sortBy]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, filter, sortBy, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredMods.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredMods.length);
  const paginatedMods = useMemo(() => {
    return filteredMods.slice(startIndex, endIndex);
  }, [filteredMods, startIndex, endIndex]);

  const selectedMod = useMemo(
    () => mods.find((m) => m.id === selectedModId) ?? null,
    [mods, selectedModId],
  );

  async function handleCardToggle(mod: ModEntry) {
    if (togglingId) return;
    setTogglingId(mod.id);
    try {
      await onToggleMod(mod);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleOpenRootInExplorer(targetPath: string) {
    try {
      await api.revealInExplorer(targetPath);
      if (!IS_TAURI) {
        onNotify(`Folder path: ${targetPath}`);
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not open folder in Explorer.',
      );
    }
  }

  async function handleInstallZipPath(zipPath: string) {
    if (!root) return;
    setInstallingZip(true);
    try {
      const installed = await api.installModZip(zipPath, root);
      const folderName = installed.split(/[\\/]/).pop() || 'mod';
      onNotify(`Installed mod into ${folderName}!`);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to install zip mod.');
    } finally {
      setInstallingZip(false);
    }
  }

  async function handlePickAndInstallZip() {
    if (!root || installingZip) return;
    try {
      const zipPath = await api.pickModZipFile();
      if (zipPath) {
        await handleInstallZipPath(zipPath);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not open zip file.');
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!root) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const filePath = (file as unknown as { path?: string }).path;
    if (filePath && filePath.toLowerCase().endsWith('.zip')) {
      void handleInstallZipPath(filePath);
    } else {
      onNotify('Only .zip mod archive files can be dropped to install.');
    }
  }

  async function handleBatchToggle(enableAll: boolean) {
    if (!root || loading) return;
    const actionLabel = enableAll ? 'enable all mods' : 'disable all mods (Panic)';
    if (!window.confirm(`Are you sure you want to ${actionLabel}?`)) return;
    try {
      const count = await api.batchToggleMods(root, enableAll);
      onNotify(`${enableAll ? 'Enabled' : 'Disabled'} ${count} mods.`);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to batch toggle mods.');
    }
  }

  if (loading && mods.length === 0) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-canvas px-6 pb-20 text-center sm:pb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-body">
          <Icon icon={Icons.refresh} size={24} className="animate-spin" />
        </div>
        <p className="text-[15px] font-medium text-ink">
          Scanning mod folders and .ini files...
        </p>
        {root && (
          <p className="max-w-md truncate font-mono text-[12px] text-ink-mute">
            {root}
          </p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-canvas px-6 pb-20 text-center sm:pb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-status-red/30 bg-status-red-soft text-status-red">
          <Icon icon={Icons.alert} size={24} />
        </div>
        <h1 className="text-[18px] font-medium text-ink">
          Could not scan Mods folder
        </h1>
        <p className="max-w-md break-words text-[13px] leading-relaxed text-ink-body">
          {error}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
          {root && (
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-ink-bright px-4 py-2 text-[14px] font-medium text-black transition-colors hover:bg-[#e8e8e8] sm:min-h-[36px]"
            >
              <Icon icon={Icons.refresh} size={15} />
              <span>Retry Scan</span>
            </button>
          )}
          <button
            type="button"
            onClick={onPickFolder}
            className={clsx(
              'inline-flex min-h-[44px] items-center gap-2 rounded-md px-4 py-2 text-[14px] font-medium transition-colors sm:min-h-[36px]',
              root
                ? 'border border-hairline bg-surface-elevated text-ink-bright hover:border-hairline-strong'
                : 'bg-ink-bright text-black hover:bg-[#e8e8e8]',
            )}
          >
            <Icon icon={Icons.folderOpen} size={15} />
            <span>Choose Another Folder</span>
          </button>
        </div>
      </div>
    );
  }

  if (!root) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center bg-canvas px-6 pb-20 text-center sm:pb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-body">
          <Icon icon={Icons.folderOpen} size={26} />
        </div>
        <h1 className="mt-4 text-[22px] font-medium text-ink">
          Select your Mods folder
        </h1>
        <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-mute">
          Choose your XXMI or 3DMigoto Mods directory to browse character mods,
          apply texture presets, and check hotkeys.
        </p>
        <button
          type="button"
          onClick={onPickFolder}
          className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-md bg-ink-bright px-4 py-2 text-[14px] font-medium text-black transition-colors hover:bg-[#e8e8e8] sm:min-h-[36px]"
        >
          <Icon icon={Icons.folderOpen} size={16} />
          <span>Choose Mods Folder</span>
        </button>

        {detectedFolders.length > 0 && (
          <div className="mt-7 flex max-w-lg flex-col items-center gap-2.5">
            <span className="text-[12px] font-medium text-ink-mute">
              Detected game folders
            </span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {detectedFolders.map((df) => (
                <button
                  key={df.path}
                  type="button"
                  onClick={() => onSelectRoot(df.path)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-hairline bg-surface-elevated px-3 py-1.5 text-[13px] font-medium text-ink-bright transition-colors hover:border-hairline-strong sm:min-h-[36px]"
                >
                  <Icon
                    icon={Icons.folder}
                    size={15}
                    className="text-ink-mute"
                  />
                  <span>{df.label}</span>
                  <span className="rounded-xs border border-hairline bg-surface-card px-1.5 py-0.5 font-mono text-[11px] text-ink-mute">
                    {df.gameCode}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mods.length === 0) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center bg-canvas px-6 pb-20 text-center sm:pb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-body">
          <Icon icon={Icons.folder} size={26} />
        </div>
        <h1 className="mt-4 text-[18px] font-medium text-ink">
          No character mods found
        </h1>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-ink-mute">
          No mod folders containing .ini configuration files were found in{' '}
          <span className="break-all font-mono text-[12px] text-ink-charcoal">
            {root}
          </span>
          .
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={onPickFolder}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-ink-bright px-4 py-2 text-[14px] font-medium text-black transition-colors hover:bg-[#e8e8e8] sm:min-h-[36px]"
          >
            <Icon icon={Icons.folderOpen} size={16} />
            <span>Choose Another Folder</span>
          </button>
          <button
            type="button"
            onClick={() => void handleOpenRootInExplorer(root)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-hairline bg-surface-elevated px-4 py-2 text-[14px] font-medium text-ink-bright transition-colors hover:border-hairline-strong sm:min-h-[36px]"
          >
            <Icon icon={Icons.external} size={15} className="text-ink-mute" />
            <span>Open in Explorer</span>
          </button>
        </div>
      </div>
    );
  }

  const filterTabs: Array<{
    id: ModFilter;
    label: string;
    count: number;
    tone?: 'conflict' | 'warning';
  }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'disabled', label: 'Disabled', count: counts.disabled },
    ...(counts.clashes > 0
      ? [
          {
            id: 'clashes' as const,
            label: 'Mesh Clashes',
            count: counts.clashes,
            tone: 'conflict' as const,
          },
        ]
      : []),
    ...(counts.missing > 0
      ? [
          {
            id: 'missing' as const,
            label: 'Missing Files',
            count: counts.missing,
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(counts.conflicts > 0
      ? [{ id: 'conflicts' as const, label: 'Conflicts', count: counts.conflicts }]
      : []),
    { id: 'patched', label: 'Patched', count: counts.patched },
    ...(counts.hasBackup > 0
      ? [{ id: 'has-backup' as const, label: 'Has Backup', count: counts.hasBackup }]
      : []),
  ];

  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDraggingOver(false);
        }
      }}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-white/60 bg-black/80 backdrop-blur-xs">
          <Icon
            icon={Icons.folderOpen}
            size={40}
            className="animate-bounce text-white"
          />
          <p className="text-base font-medium text-white">
            Drop .zip mod archive here to install
          </p>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col gap-3 border-b border-hairline bg-canvas px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h1 className="text-[20px] font-medium leading-tight text-ink">
                Mods
              </h1>
              <p className="mt-0.5 text-[13px] text-ink-mute">
                {counts.active} active of {counts.all}{' '}
                {counts.all === 1 ? 'mod' : 'mods'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {loading && (
                <span className="mr-2 inline-flex items-center gap-1.5 text-[12px] text-ink-mute">
                  <Icon icon={Icons.refresh} size={14} className="animate-spin" />
                  <span>Refreshing...</span>
                </span>
              )}

              <button
                type="button"
                disabled={installingZip}
                onClick={() => void handlePickAndInstallZip()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-3 text-[12px] font-medium text-ink-bright transition-colors hover:border-hairline-strong sm:min-h-[32px]"
                title="Install a mod .zip file directly into Mods folder"
              >
                <Icon icon={Icons.add} size={14} className="text-ink-mute" />
                <span>{installingZip ? 'Installing...' : 'Install (.zip)'}</span>
              </button>

              {counts.active > 0 && (
                <button
                  type="button"
                  onClick={() => void handleBatchToggle(false)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-status-red/40 bg-status-red-soft px-3 text-[12px] font-medium text-status-red transition-colors hover:bg-status-red/20 sm:min-h-[32px]"
                  title="Disable all active mods at once (Panic Button for new patches)"
                >
                  <Icon icon={Icons.alert} size={13} />
                  <span>Disable All</span>
                </button>
              )}

              {counts.disabled > 0 && (
                <button
                  type="button"
                  onClick={() => void handleBatchToggle(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-3 text-[12px] font-medium text-ink-body transition-colors hover:border-hairline-strong hover:text-ink-bright sm:min-h-[32px]"
                  title="Enable all mods at once"
                >
                  <Icon icon={Icons.check} size={13} className="text-ink-mute" />
                  <span>Enable All</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex h-[44px] items-center gap-2.5 rounded-md border border-hairline bg-surface-elevated px-3.5 transition-colors focus-within:border-hairline-strong focus-within:ring-1 focus-within:ring-white/30">
            <Icon
              icon={Icons.search}
              size={16}
              className="shrink-0 text-ink-mute"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search mods by name, character, .ini, or hotkey..."
              aria-label="Search mods"
              className="w-full min-w-0 bg-transparent text-[14px] text-ink-bright placeholder:text-ink-mute focus:outline-none"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="-mr-2 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xs text-ink-mute transition-colors hover:text-ink-bright sm:mr-0 sm:min-h-[28px] sm:min-w-[28px]"
              >
                <Icon icon={Icons.close} size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div
              role="tablist"
              aria-label="Filter mods"
              className="flex flex-wrap items-center gap-1.5"
            >
              {filterTabs.map((tab) => {
                const isActive = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setFilter(tab.id)}
                    className={clsx(
                      'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors sm:min-h-[32px]',
                      isActive
                        ? 'border-hairline-strong bg-surface-elevated text-ink-bright'
                        : 'border-transparent bg-transparent text-ink-body hover:bg-surface-elevated/60 hover:text-ink-bright',
                    )}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={clsx(
                        'text-[11px] tabular-nums',
                        isActive ? 'text-ink-charcoal' : 'text-ink-mute',
                      )}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-ink-mute">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as ModSort)}
                  aria-label="Sort mods"
                  className="min-h-[44px] rounded-md border border-hairline bg-surface-elevated px-2 py-1 text-[12px] font-medium text-ink-bright focus:border-hairline-strong sm:min-h-[32px]"
                >
                  <option value="name-asc">Name (A to Z)</option>
                  <option value="name-desc">Name (Z to A)</option>
                  <option value="status">Status (Active first)</option>
                  <option value="keys-count">Most Hotkeys</option>
                  <option value="category">Character / Category</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-ink-mute">Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  aria-label="Items per page"
                  className="min-h-[44px] rounded-md border border-hairline bg-surface-elevated px-2 py-1 text-[12px] font-medium text-ink-bright focus:border-hairline-strong sm:min-h-[32px]"
                >
                  <option value="30">30</option>
                  <option value="60">60</option>
                  <option value="90">90</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-6 sm:px-6">
          {filteredMods.length === 0 ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2.5 px-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-mute">
                <Icon icon={Icons.search} size={20} />
              </div>
              <p className="text-[15px] font-medium text-ink">
                No mods match your filters
              </p>
              <p className="max-w-sm text-[13px] text-ink-mute">
                Try clearing your search query or switching back to all mods.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
                className="mt-1 inline-flex min-h-[44px] items-center rounded-md border border-hairline bg-surface-elevated px-3.5 py-1.5 text-[13px] font-medium text-ink-bright transition-colors hover:border-hairline-strong sm:min-h-[36px]"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <>
              <div
                className={clsx(
                  'grid gap-3',
                  selectedMod
                    ? 'grid-cols-1 xl:grid-cols-2'
                    : 'grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3',
                )}
              >
              {paginatedMods.map((mod) => {
                const isSelected = selectedModId === mod.id;
                const activeIniCount = mod.iniFiles.filter(
                  (f) => !f.isDisabled,
                ).length;
                const iniCountLabel =
                  activeIniCount > 0
                    ? `${activeIniCount} .ini`
                    : `${mod.iniFiles.length} backup .ini`;

                const uniqueKeybinds: typeof mod.keybinds = [];
                const seenKeys = new Set<string>();
                const duplicateKeys = new Set<string>();
                for (const kb of mod.keybinds) {
                  if (!kb.normalizedKey) continue;
                  if (seenKeys.has(kb.normalizedKey)) {
                    duplicateKeys.add(kb.normalizedKey);
                  } else {
                    seenKeys.add(kb.normalizedKey);
                    uniqueKeybinds.push(kb);
                  }
                }
                const visibleKeybinds = uniqueKeybinds.slice(0, 3);
                const extraKeyCount =
                  uniqueKeybinds.length - visibleKeybinds.length;

                return (
                  <article
                    key={mod.id}
                    className={clsx(
                      'relative flex items-center justify-between gap-3.5 rounded-md border p-4 transition-colors',
                      isSelected
                        ? 'border-hairline-strong bg-surface-card'
                        : 'border-hairline bg-surface hover:border-hairline-strong hover:bg-surface-elevated',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onSelectMod(isSelected ? null : mod.id)
                      }
                      aria-pressed={isSelected}
                      className="flex min-w-0 flex-1 items-center gap-3.5 text-left after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-white/60"
                    >
                      <ModThumbnail
                        previewPath={mod.previewPath}
                        enabled={mod.enabled}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={clsx(
                              'truncate text-[15px] font-medium',
                              mod.enabled ? 'text-ink' : 'text-ink-mute',
                            )}
                          >
                            {mod.displayName}
                          </span>
                          {mod.appliedPresetIds.length > 0 && (
                            <span className="shrink-0 rounded-xs border border-status-green/30 bg-status-green-soft px-1.5 py-0.5 text-[11px] font-medium text-status-green">
                              Patched
                            </span>
                          )}
                          {duplicateKeys.size > 0 && (
                            <span className="shrink-0 rounded-xs border border-status-red/30 bg-status-red-soft px-1.5 py-0.5 text-[11px] font-medium text-status-red">
                              Key conflict
                            </span>
                          )}
                          {mod.meshConflicts.length > 0 && mod.enabled && (
                            <span
                              className="shrink-0 rounded-xs border border-status-red/40 bg-status-red-soft px-1.5 py-0.5 text-[11px] font-medium text-status-red"
                              title={`Clashes with: ${mod.meshConflicts.join(', ')}`}
                            >
                              Mesh clash
                            </span>
                          )}
                          {mod.missingAssets.length > 0 && (
                            <span
                              className="shrink-0 rounded-xs border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300"
                              title={`Missing ${mod.missingAssets.length} asset files`}
                            >
                              Missing file ({mod.missingAssets.length})
                            </span>
                          )}
                          {!mod.enabled && (
                            <span className="shrink-0 rounded-xs border border-hairline bg-surface-elevated px-1.5 py-0.5 text-[11px] text-ink-mute">
                              Disabled
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-mute">
                          {mod.category && (
                            <>
                              <span className="font-medium text-ink-charcoal">
                                {mod.category}
                              </span>
                              <span aria-hidden="true">&middot;</span>
                            </>
                          )}
                          <span>{iniCountLabel}</span>
                        </div>

                        {visibleKeybinds.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {visibleKeybinds.map((kb) => (
                              <Keycap
                                key={`${kb.iniPath}-${kb.keyLineIdx}`}
                                rawKey={kb.rawKey}
                                size="sm"
                              />
                            ))}
                            {extraKeyCount > 0 && (
                              <span className="text-[11px] text-ink-mute">
                                +{extraKeyCount} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={mod.enabled}
                      aria-label={`${mod.enabled ? 'Disable' : 'Enable'} ${mod.displayName}`}
                      disabled={togglingId === mod.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCardToggle(mod);
                      }}
                      className="relative z-10 flex min-h-[44px] min-w-[52px] shrink-0 items-center justify-end px-1 disabled:opacity-50 sm:min-h-[36px]"
                    >
                      <span
                        className={clsx(
                          'flex h-[22px] w-10 items-center rounded-full border p-0.5 transition-colors',
                          mod.enabled
                            ? 'justify-end border-status-green/50 bg-status-green-soft'
                            : 'justify-start border-hairline-strong bg-surface-elevated',
                        )}
                      >
                        <span
                          className={clsx(
                            'h-4 w-4 rounded-full transition-colors',
                            mod.enabled ? 'bg-status-green' : 'bg-ink-mute',
                          )}
                        />
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>

            {/* Pagination Controls */}
            <PaginationBar
              currentPage={safePage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={filteredMods.length}
              itemLabel="mods"
              onPageChange={(p) => setCurrentPage(p)}
            />
          </>
        )}
        </div>
      </div>

      {selectedMod && (
        <aside
          aria-label="Mod inspector"
          style={{ width: `${inspectorWidth}px` }}
          className="relative fixed inset-0 z-40 flex flex-col bg-canvas sm:relative sm:inset-auto sm:z-auto sm:h-full sm:shrink-0 sm:border-l sm:border-hairline sm:bg-surface"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize inspector panel"
            onMouseDown={handleInspectorResizeStart}
            className="group hidden sm:block absolute -left-2 top-0 bottom-0 z-50 w-4 cursor-col-resize select-none"
          >
            <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-transparent transition-colors group-hover:bg-white/40 group-active:bg-white/70" />
          </div>
          <ModInspector
            key={selectedMod.id}
            mod={selectedMod}
            modsRoot={root}
            presets={presets}
            onClose={() => onSelectMod(null)}
            onToggleMod={onToggleMod}
            onRefresh={onRefresh}
            onNotify={onNotify}
          />
        </aside>
      )}
    </div>
  );
}
