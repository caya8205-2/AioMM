import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveView,
  DetectedFolder,
  ModEntry,
  Preset,
  WorkspaceSnapshot,
} from './types';
import { api, IS_TAURI, pickModsDirectory } from './lib/api';
import { Sidebar } from './components/Sidebar';
import { ModsView } from './components/ModsView';
import { KeybindsView } from './components/KeybindsView';
import { PresetsView } from './components/PresetsView';
import { Icon, Icons } from './components/Icon';

const STORAGE_CURRENT_ROOT = 'modctl:currentRoot';
const STORAGE_RECENT_ROOTS = 'modctl:recentRoots';
const MAX_RECENT_ROOTS = 6;

interface StatusToast {
  id: number;
  message: string;
}

function readStorageString(key: string): string | null {
  try {
    const val = localStorage.getItem(key);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

function readRecentRoots(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_RECENT_ROOTS);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, MAX_RECENT_ROOTS);
  } catch {
    return [];
  }
}

function persistRootSelection(path: string, prevRecents: string[]): string[] {
  const normalizedLower = path.toLowerCase();
  const next = [
    path,
    ...prevRecents.filter((p) => p.toLowerCase() !== normalizedLower),
  ].slice(0, MAX_RECENT_ROOTS);
  try {
    localStorage.setItem(STORAGE_CURRENT_ROOT, path);
    localStorage.setItem(STORAGE_RECENT_ROOTS, JSON.stringify(next));
  } catch {
    // Ignore storage write errors in restricted webviews.
  }
  return next;
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    if (typeof window === 'undefined') return 'mods';
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'mods' || v === 'keybinds' || v === 'presets') return v;
    return 'mods';
  });

  const [currentRoot, setCurrentRoot] = useState<string | null>(null);
  const [recentRoots, setRecentRoots] = useState<string[]>(() => readRecentRoots());
  const [detectedFolders, setDetectedFolders] = useState<DetectedFolder[]>([]);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<StatusToast | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const scanReqIdRef = useRef(0);

  const notify = useCallback((message: string) => {
    setStatusToast({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    if (!statusToast) return;
    const timer = window.setTimeout(() => {
      setStatusToast((curr) => (curr?.id === statusToast.id ? null : curr));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [statusToast]);

  const scanRoot = useCallback(
    async (path: string, options?: { background?: boolean }) => {
      const reqId = ++scanReqIdRef.current;
      if (!options?.background) {
        setLoading(true);
      }
      setError(null);

      try {
        const nextSnap = await api.scanModsFolder(path);
        if (reqId !== scanReqIdRef.current) return;
        setSnapshot(nextSnap);
        setSelectedModId((prev) =>
          prev && nextSnap.mods.some((m) => m.id === prev) ? prev : null,
        );
      } catch (err) {
        if (reqId !== scanReqIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reqId === scanReqIdRef.current && !options?.background) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const handleSelectRoot = useCallback(
    async (path: string) => {
      const trimmed = path.trim();
      if (!trimmed) return;
      setCurrentRoot(trimmed);
      setRecentRoots((prev) => persistRootSelection(trimmed, prev));
      await scanRoot(trimmed);
    },
    [scanRoot],
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      let folders: DetectedFolder[] = [];
      try {
        folders = await api.detectKnownModFolders();
        if (!cancelled) {
          setDetectedFolders(folders);
        }
      } catch {
        // Non-fatal if auto-detection fails on startup.
      }

      if (cancelled) return;

      if (IS_TAURI) {
        const saved = readStorageString(STORAGE_CURRENT_ROOT);
        if (saved) {
          setCurrentRoot(saved);
          await scanRoot(saved);
        }
      } else {
        const params = new URLSearchParams(window.location.search);
        if (params.get('demo') === '1') {
          const demoPath = folders[0]?.path ?? 'PREVIEW:\\XXMI\\ZZMI\\Mods';
          setCurrentRoot(demoPath);
          await scanRoot(demoPath);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [scanRoot]);

  const handlePickFolder = useCallback(async () => {
    try {
      const picked = await pickModsDirectory();
      if (picked) {
        await handleSelectRoot(picked);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not open folder picker.');
    }
  }, [handleSelectRoot, notify]);

  const handleRefresh = useCallback(async () => {
    try {
      const folders = await api.detectKnownModFolders();
      setDetectedFolders(folders);
    } catch {
      // Keep existing detected folders if refresh check fails.
    }
    if (currentRoot) {
      await scanRoot(currentRoot);
    }
  }, [currentRoot, scanRoot]);

  const handleToggleMod = useCallback(
    async (mod: ModEntry) => {
      if (!currentRoot) return;
      const wasEnabled = mod.enabled;
      try {
        await api.toggleMod(mod.path);
        await scanRoot(currentRoot, { background: true });
        notify(
          wasEnabled
            ? `Disabled ${mod.displayName}. Press F10 in-game to reload.`
            : `Enabled ${mod.displayName}. Press F10 in-game to reload.`,
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [currentRoot, notify, scanRoot],
  );

  const handleSavePreset = useCallback(
    async (preset: Preset) => {
      if (!currentRoot) return;
      const nextPresets = await api.savePreset(currentRoot, preset);
      setSnapshot((prev) => (prev ? { ...prev, presets: nextPresets } : prev));
      await scanRoot(currentRoot, { background: true });
      notify(`Saved preset "${preset.name}".`);
    },
    [currentRoot, notify, scanRoot],
  );

  const handleDeletePreset = useCallback(
    async (presetId: string) => {
      if (!currentRoot) return;
      const nextPresets = await api.deletePreset(currentRoot, presetId);
      setSnapshot((prev) => (prev ? { ...prev, presets: nextPresets } : prev));
      await scanRoot(currentRoot, { background: true });
      notify('Deleted custom preset.');
    },
    [currentRoot, notify, scanRoot],
  );

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;

      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (e.key === '/' && !isEditable) {
        if (activeView === 'mods' && searchInputRef.current) {
          e.preventDefault();
          searchInputRef.current.focus();
          searchInputRef.current.select();
          return;
        }
        const localSearch = document.querySelector<HTMLInputElement>('[data-view-search]');
        if (localSearch) {
          e.preventDefault();
          localSearch.focus();
          localSearch.select();
          return;
        }
        if (currentRoot) {
          e.preventDefault();
          setActiveView('mods');
          requestAnimationFrame(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
          });
        }
        return;
      }

      if (e.key === 'Escape' && !isEditable) {
        if (window.innerWidth < 1024 && selectedModId !== null) {
          setSelectedModId(null);
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeView, currentRoot, selectedModId]);

  const mods = snapshot?.mods ?? [];
  const presets = snapshot?.presets ?? [];
  const conflicts = snapshot?.conflicts ?? [];

  const crossModConflictCount = useMemo(
    () => conflicts.filter((c) => c.crossMod).length,
    [conflicts],
  );

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-canvas text-ink-body sm:flex-row">
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        currentRoot={currentRoot}
        recentRoots={recentRoots}
        detectedFolders={detectedFolders}
        onSelectRoot={(path: string) => void handleSelectRoot(path)}
        onPickFolder={() => void handlePickFolder()}
        onRefresh={() => void handleRefresh()}
        totalMods={mods.length}
        crossModConflictCount={crossModConflictCount}
        isPreviewMode={!IS_TAURI}
      />

      <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pt-14 pb-20 sm:h-full sm:pt-0 sm:pb-0">
        {activeView !== 'mods' && error && (
          <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-6 lg:px-8">
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-status-red/35 bg-status-red-soft px-4 py-3 text-sm text-status-red"
            >
              <span>Could not read Mods folder: {error}</span>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                className="inline-flex min-h-[44px] sm:min-h-[32px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-status-red/40 bg-surface px-3 text-xs font-medium text-ink-bright hover:bg-surface-elevated"
              >
                Retry Scan
              </button>
            </div>
          </div>
        )}

        {activeView === 'mods' && (
          <ModsView
            root={currentRoot}
            mods={mods}
            presets={presets}
            loading={loading}
            error={error}
            detectedFolders={detectedFolders}
            selectedModId={selectedModId}
            onSelectMod={setSelectedModId}
            onPickFolder={() => void handlePickFolder()}
            onSelectRoot={(path: string) => void handleSelectRoot(path)}
            onToggleMod={handleToggleMod}
            onRefresh={handleRefresh}
            onNotify={notify}
            searchInputRef={searchInputRef}
          />
        )}

        {activeView === 'keybinds' &&
          (loading && currentRoot && !snapshot ? (
            <div className="flex min-h-full items-center justify-center px-6 py-16 text-sm text-ink-mute">
              Scanning Mods folder for active hotkeys...
            </div>
          ) : (
            <KeybindsView
              root={currentRoot}
              mods={mods}
              conflicts={conflicts}
              onPickFolder={() => void handlePickFolder()}
              onToggleMod={handleToggleMod}
              onRefresh={handleRefresh}
              onNotify={notify}
            />
          ))}

        {activeView === 'presets' &&
          (loading && currentRoot && !snapshot ? (
            <div className="flex min-h-full items-center justify-center px-6 py-16 text-sm text-ink-mute">
              Loading presets from Mods folder...
            </div>
          ) : (
            <PresetsView
              root={currentRoot}
              presets={presets}
              onPickFolder={() => void handlePickFolder()}
              onSavePreset={handleSavePreset}
              onDeletePreset={handleDeletePreset}
            />
          ))}
      </main>

      {statusToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 right-4 z-50 flex max-w-sm items-center gap-3 rounded-md border border-hairline-strong bg-surface-elevated px-3.5 py-2.5 text-sm text-ink-bright sm:bottom-5 sm:right-5"
        >
          <span className="min-w-0 flex-1">{statusToast.message}</span>
          <button
            type="button"
            onClick={() => setStatusToast(null)}
            aria-label="Dismiss notification"
            className="inline-flex min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] shrink-0 items-center justify-center rounded-sm text-ink-mute transition-colors hover:bg-surface-card hover:text-ink-bright"
          >
            <Icon icon={Icons.close} size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
