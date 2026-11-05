import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { KeyBind, KeyConflict, ModEntry } from '../types';
import { api } from '../lib/api';
import {
  formatKeyTokens,
  keyboardEventTo3DMigoto,
  normalizeKeyComboClient,
} from '../lib/keymap';
import { Icon, Icons } from './Icon';
import { Keycap } from './Keycap';
import { PaginationBar } from './PaginationBar';

export interface KeybindsViewProps {
  root: string | null;
  mods: ModEntry[];
  conflicts: KeyConflict[];
  onPickFolder: () => void;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
}

interface ActiveBindingRow {
  mod: ModEntry;
  keybind: KeyBind;
}

type KeybindFilter = 'all' | 'conflicts' | 'combos' | 'single';
type KeybindSort =
  | 'key-asc'
  | 'key-desc'
  | 'mod-asc'
  | 'section-asc'
  | 'conflicts-first';

function cleanSectionName(section: string): string {
  const stripped = section.replace(/^key[\s_-]*/i, '').trim();
  return stripped.length > 0 ? stripped : section;
}

export function KeybindsView({
  root,
  mods,
  conflicts,
  onPickFolder,
  onRefresh,
  onNotify,
}: KeybindsViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<KeybindFilter>('all');
  const [sortBy, setSortBy] = useState<KeybindSort>('key-asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [copiedCheatSheet, setCopiedCheatSheet] = useState(false);
  const [captureTarget, setCaptureTarget] = useState<ActiveBindingRow | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [showRawInput, setShowRawInput] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searchKey, setSearchKey] = useState('');
  const [isRecordingKey, setIsRecordingKey] = useState(false);
  const [expandedMods, setExpandedMods] = useState<Set<string>>(new Set());

  const captureZoneRef = useRef<HTMLDivElement>(null);
  const rawInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRecordingKey) return;

    function handleSearchKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsRecordingKey(false);
        return;
      }
      const mapped = keyboardEventTo3DMigoto(e);
      if (mapped) {
        e.preventDefault();
        e.stopPropagation();
        setSearchKey(mapped);
        setIsRecordingKey(false);
      }
    }

    window.addEventListener('keydown', handleSearchKeyDown, true);
    return () => window.removeEventListener('keydown', handleSearchKeyDown, true);
  }, [isRecordingKey]);

  const activeBindings = useMemo<ActiveBindingRow[]>(() => {
    const rows: ActiveBindingRow[] = [];
    for (const mod of mods) {
      if (!mod.enabled) continue;
      for (const keybind of mod.keybinds) {
        rows.push({ mod, keybind });
      }
    }
    return rows;
  }, [mods]);

  const activeModWithKeysCount = useMemo(() => {
    return new Set(activeBindings.map((r) => r.mod.id)).size;
  }, [activeBindings]);

  const conflictPairSet = useMemo(
    () => new Set(conflicts.map((c) => `${c.modId}::${c.normalizedKey}`)),
    [conflicts],
  );

  const counts = useMemo(() => {
    let conflictsCount = 0;
    let combosCount = 0;
    let singleCount = 0;
    for (const { mod, keybind } of activeBindings) {
      if (conflictPairSet.has(`${mod.id}::${keybind.normalizedKey}`)) {
        conflictsCount++;
      }
      if (formatKeyTokens(keybind.rawKey).length > 1) {
        combosCount++;
      } else {
        singleCount++;
      }
    }
    return {
      all: activeBindings.length,
      conflicts: conflictsCount,
      combos: combosCount,
      single: singleCount,
    };
  }, [activeBindings, conflictPairSet]);

  const filteredBindings = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = activeBindings.filter(({ mod, keybind }) => {
      const isConflict = conflictPairSet.has(`${mod.id}::${keybind.normalizedKey}`);
      const tokensCount = formatKeyTokens(keybind.rawKey).length;

      if (filter === 'conflicts' && !isConflict) return false;
      if (filter === 'combos' && tokensCount <= 1) return false;
      if (filter === 'single' && tokensCount > 1) return false;

      if (searchKey) {
        const normSearch = normalizeKeyComboClient(searchKey);
        const normKb =
          keybind.normalizedKey || normalizeKeyComboClient(keybind.rawKey);
        if (
          normSearch !== normKb &&
          !normKb.includes(normSearch) &&
          !keybind.rawKey.toLowerCase().includes(searchKey.toLowerCase())
        ) {
          return false;
        }
      }

      if (!q) return true;

      const tokens = formatKeyTokens(keybind.rawKey).join(' ').toLowerCase();
      return (
        mod.displayName.toLowerCase().includes(q) ||
        (mod.category ?? '').toLowerCase().includes(q) ||
        keybind.section.toLowerCase().includes(q) ||
        cleanSectionName(keybind.section).toLowerCase().includes(q) ||
        keybind.rawKey.toLowerCase().includes(q) ||
        keybind.normalizedKey.toLowerCase().includes(q) ||
        tokens.includes(q) ||
        (keybind.variable ?? '').toLowerCase().includes(q) ||
        keybind.iniRelName.toLowerCase().includes(q)
      );
    });

    result.sort((a, b) => {
      switch (sortBy) {
        case 'key-asc':
          return (
            a.keybind.normalizedKey.localeCompare(b.keybind.normalizedKey) ||
            a.mod.displayName.localeCompare(b.mod.displayName)
          );
        case 'key-desc':
          return (
            b.keybind.normalizedKey.localeCompare(a.keybind.normalizedKey) ||
            a.mod.displayName.localeCompare(b.mod.displayName)
          );
        case 'mod-asc':
          return (
            a.mod.displayName.localeCompare(b.mod.displayName) ||
            a.keybind.normalizedKey.localeCompare(b.keybind.normalizedKey)
          );
        case 'section-asc':
          return (
            cleanSectionName(a.keybind.section).localeCompare(
              cleanSectionName(b.keybind.section),
            ) || a.mod.displayName.localeCompare(b.mod.displayName)
          );
        case 'conflicts-first': {
          const aConflict = conflictPairSet.has(
            `${a.mod.id}::${a.keybind.normalizedKey}`,
          );
          const bConflict = conflictPairSet.has(
            `${b.mod.id}::${b.keybind.normalizedKey}`,
          );
          if (aConflict !== bConflict) return aConflict ? -1 : 1;
          return a.keybind.normalizedKey.localeCompare(b.keybind.normalizedKey);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [activeBindings, query, searchKey, filter, sortBy, conflictPairSet]);

  interface ModKeybindGroup {
    modId: string;
    modDisplayName: string;
    mod: ModEntry;
    iniFiles: string[];
    bindings: Array<{
      mod: ModEntry;
      keybind: KeyBind;
      isConflict: boolean;
    }>;
    conflictKeysCount: number;
  }

  const modGroups = useMemo<ModKeybindGroup[]>(() => {
    const map = new Map<string, ModKeybindGroup>();

    for (const { mod, keybind } of filteredBindings) {
      const isConflict = conflictPairSet.has(
        `${mod.id}::${keybind.normalizedKey}`,
      );
      let group = map.get(mod.id);
      if (!group) {
        group = {
          modId: mod.id,
          modDisplayName: mod.displayName,
          mod,
          iniFiles: [],
          bindings: [],
          conflictKeysCount: 0,
        };
        map.set(mod.id, group);
      }
      if (!group.iniFiles.includes(keybind.iniRelName)) {
        group.iniFiles.push(keybind.iniRelName);
      }
      group.bindings.push({ mod, keybind, isConflict });
    }

    for (const group of map.values()) {
      const conflictKeys = new Set(
        group.bindings
          .filter((b) => b.isConflict)
          .map((b) => b.keybind.normalizedKey),
      );
      group.conflictKeysCount = conflictKeys.size;
    }

    const groups = Array.from(map.values());

    groups.sort((a, b) => {
      switch (sortBy) {
        case 'conflicts-first': {
          if (a.conflictKeysCount !== b.conflictKeysCount) {
            return b.conflictKeysCount - a.conflictKeysCount;
          }
          return a.modDisplayName.localeCompare(b.modDisplayName);
        }
        case 'mod-asc':
          return a.modDisplayName.localeCompare(b.modDisplayName);
        case 'key-asc': {
          const aKey = a.bindings[0]?.keybind.normalizedKey ?? '';
          const bKey = b.bindings[0]?.keybind.normalizedKey ?? '';
          return (
            aKey.localeCompare(bKey) ||
            a.modDisplayName.localeCompare(b.modDisplayName)
          );
        }
        case 'key-desc': {
          const aKey = a.bindings[0]?.keybind.normalizedKey ?? '';
          const bKey = b.bindings[0]?.keybind.normalizedKey ?? '';
          return (
            bKey.localeCompare(aKey) ||
            a.modDisplayName.localeCompare(b.modDisplayName)
          );
        }
        case 'section-asc': {
          const aSec = cleanSectionName(a.bindings[0]?.keybind.section ?? '');
          const bSec = cleanSectionName(b.bindings[0]?.keybind.section ?? '');
          return (
            aSec.localeCompare(bSec) ||
            a.modDisplayName.localeCompare(b.modDisplayName)
          );
        }
        default:
          return 0;
      }
    });

    return groups;
  }, [filteredBindings, conflictPairSet, sortBy]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, searchKey, filter, sortBy, pageSize]);

  const totalPages = Math.max(1, Math.ceil(modGroups.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, modGroups.length);
  const paginatedModGroups = useMemo(() => {
    return modGroups.slice(startIndex, endIndex);
  }, [modGroups, startIndex, endIndex]);

  function toggleMod(modId: string) {
    setExpandedMods((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  }

  function handleExpandAll() {
    setExpandedMods(new Set(modGroups.map((g) => g.modId)));
  }

  function handleCollapseAll() {
    setExpandedMods(new Set());
  }

  const collidingSameModSections = useMemo(() => {
    if (!captureTarget) return [];
    const trimmed = draftKey.trim();
    if (!trimmed) return [];
    const norm = normalizeKeyComboClient(trimmed);
    const sections: string[] = [];
    for (const kb of captureTarget.mod.keybinds) {
      const isSelf =
        kb.iniPath === captureTarget.keybind.iniPath &&
        kb.keyLineIdx === captureTarget.keybind.keyLineIdx;
      if (isSelf) continue;
      const kbNorm = kb.normalizedKey || normalizeKeyComboClient(kb.rawKey);
      if (kbNorm === norm) {
        sections.push(`[${kb.section}]`);
      }
    }
    return sections;
  }, [captureTarget, draftKey]);

  const cheatSheetText = useMemo(() => {
    const lines: string[] = [
      '========================================',
      '       MOD HOTKEY CHEAT SHEET',
      '========================================',
      '',
    ];

    const activeModsWithKeys = mods.filter(
      (m) => m.enabled && m.keybinds.length > 0,
    );

    if (activeModsWithKeys.length === 0) {
      lines.push('No active hotkeys found in enabled mods.');
      return lines.join('\n');
    }

    for (const mod of activeModsWithKeys) {
      lines.push(`[${mod.displayName}]`);
      for (const kb of mod.keybinds) {
        const sec = cleanSectionName(kb.section);
        lines.push(`  - ${sec}: ${kb.rawKey}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }, [mods]);

  async function handleCopyCheatSheet() {
    try {
      await navigator.clipboard.writeText(cheatSheetText);
      setCopiedCheatSheet(true);
      setTimeout(() => setCopiedCheatSheet(false), 2000);
      onNotify('Copied hotkey cheat sheet to clipboard.');
    } catch {
      onNotify('Could not copy cheat sheet.');
    }
  }

  function handleSaveCheatSheetFile() {
    const blob = new Blob([cheatSheetText], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Hotkey_Cheat_Sheet.txt';
    a.click();
    URL.revokeObjectURL(url);
    onNotify('Downloaded Hotkey_Cheat_Sheet.txt');
  }

  function openCaptureModal(mod: ModEntry, keybind: KeyBind) {
    setCaptureTarget({ mod, keybind });
    setDraftKey(keybind.rawKey);
    setShowRawInput(false);
    setSaveError(null);
  }

  function closeCaptureModal() {
    if (savingKey) return;
    setCaptureTarget(null);
    setSaveError(null);
  }

  useEffect(() => {
    if (!captureTarget) return;
    const frame = requestAnimationFrame(() => {
      captureZoneRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [captureTarget]);

  useEffect(() => {
    if (!captureTarget) return;

    function handleWindowKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!savingKey) {
          setCaptureTarget(null);
          setSaveError(null);
        }
        return;
      }

      if (document.activeElement === rawInputRef.current) {
        return;
      }

      if (e.key === 'Tab') {
        return;
      }

      if (
        document.activeElement instanceof HTMLButtonElement &&
        (e.key === 'Enter' || e.key === ' ')
      ) {
        return;
      }

      const mapped = keyboardEventTo3DMigoto(e);
      if (mapped) {
        e.preventDefault();
        e.stopPropagation();
        setDraftKey(mapped);
        setSaveError(null);
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true);
  }, [captureTarget, savingKey]);

  async function handleSaveKeybind(e?: React.FormEvent) {
    e?.preventDefault();
    if (!captureTarget) return;
    const trimmed = draftKey.trim();
    if (!trimmed) {
      setSaveError('Press a key combination or type a raw 3DMigoto key before saving.');
      return;
    }
    setSavingKey(true);
    setSaveError(null);
    try {
      await api.updateKeybind(
        captureTarget.keybind.iniPath,
        captureTarget.keybind.keyLineIdx,
        trimmed,
      );
      await onRefresh();
      onNotify('Hotkey updated. Press F10 in-game to reload.');
      setCaptureTarget(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(false);
    }
  }

  if (!root) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-mute">
          <Icon icon={Icons.keyboard} size={26} />
        </div>
        <h1 className="mt-4 text-lg font-medium text-ink">No Mods folder selected</h1>
        <p className="mt-1.5 max-w-sm text-sm text-ink-mute">
          Pick your 3DMigoto or XXMI Mods folder first to inspect active hotkeys and fix duplicate keys within each mod.
        </p>
        <button
          type="button"
          onClick={onPickFolder}
          className="mt-5 inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-ink-bright px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-[#e8e8e8] active:bg-[#dcdcdc]"
        >
          Choose Mods Folder
        </button>
      </div>
    );
  }

  if (activeBindings.length === 0) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-mute">
          <Icon icon={Icons.keyboard} size={26} />
        </div>
        <h1 className="mt-4 text-lg font-medium text-ink">No active hotkeys in this folder</h1>
        <p className="mt-1.5 max-w-md text-sm text-ink-mute">
          Active mods in this folder do not define any <code className="font-mono text-xs text-ink-body">[Key...]</code> sections. Enable a mod that uses toggle keys or rescan after adding new mods.
        </p>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="mt-5 inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-hairline bg-surface-elevated px-4 py-2 text-sm font-medium text-ink-bright transition-colors hover:bg-surface-card"
        >
          <Icon icon={Icons.refresh} size={15} />
          Rescan Folder
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      {/* 1. Header with title and quick actions */}
      <header className="flex flex-col gap-3 border-b border-hairline pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink sm:text-2xl">
            Hotkeys
          </h1>
          <p className="mt-0.5 text-sm text-ink-mute">
            {activeBindings.length} active {activeBindings.length === 1 ? 'hotkey' : 'hotkeys'} across{' '}
            {activeModWithKeysCount} enabled {activeModWithKeysCount === 1 ? 'mod' : 'mods'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCheatSheet(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-3 text-xs font-medium text-ink-bright hover:border-hairline-strong sm:min-h-[36px]"
          >
            <Icon icon={Icons.file} size={14} className="text-ink-mute" />
            <span>Cheat Sheet</span>
          </button>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-3 text-xs font-medium text-ink-bright hover:border-hairline-strong sm:min-h-[36px]"
          >
            <Icon icon={Icons.refresh} size={14} className="text-ink-mute" />
            <span>Rescan</span>
          </button>
        </div>
      </header>

      {/* 2. Primary Search & Toolbar right at top */}
      <section className="mt-6 space-y-3" aria-label="Hotkey search and filters">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-mute">
              <Icon icon={Icons.search} size={16} />
            </span>
            <input
              type="search"
              data-view-search="keybinds"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search hotkeys by mod name, toggle section, or variable..."
              aria-label="Filter active hotkeys"
              className="min-h-[44px] w-full rounded-md border border-hairline bg-surface-elevated pl-10 pr-10 text-sm text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong focus:outline-none sm:min-h-[38px]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear hotkey filter"
                className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-mute hover:text-ink-bright sm:min-h-[38px] sm:min-w-[38px]"
              >
                <Icon icon={Icons.close} size={14} />
              </button>
            )}
          </div>

          {/* Quick Hotkey Finder Button */}
          <div className="flex shrink-0 items-center gap-2">
            {searchKey ? (
              <div className="inline-flex min-h-[38px] items-center gap-2 rounded-md border border-hairline-strong bg-surface-card px-2.5 py-1">
                <span className="text-[12px] text-ink-mute">Key:</span>
                <Keycap rawKey={searchKey} size="sm" />
                <button
                  type="button"
                  onClick={() => setSearchKey('')}
                  className="p-0.5 text-ink-mute hover:text-ink-bright"
                  title="Clear hotkey filter"
                >
                  <Icon icon={Icons.close} size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsRecordingKey(true)}
                className={clsx(
                  'inline-flex min-h-[44px] sm:min-h-[38px] items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors',
                  isRecordingKey
                    ? 'border-white bg-surface-elevated text-white ring-2 ring-white/30 animate-pulse'
                    : 'border-hairline bg-surface-elevated text-ink-bright hover:border-hairline-strong',
                )}
                title="Press any key on your keyboard to find all mods using it"
              >
                <Icon icon={Icons.keyboard} size={15} className="text-ink-mute" />
                <span>
                  {isRecordingKey ? 'Press any hotkey...' : 'Press Key to Find'}
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Filter hotkeys"
            className="flex flex-wrap items-center gap-1.5"
          >
            {[
              { id: 'all' as const, label: 'All', count: counts.all },
              ...(counts.conflicts > 0
                ? [
                    {
                      id: 'conflicts' as const,
                      label: 'Conflicts',
                      count: counts.conflicts,
                    },
                  ]
                : []),
              { id: 'single' as const, label: 'Single Key', count: counts.single },
              { id: 'combos' as const, label: 'Combos', count: counts.combos },
            ].map((tab) => {
              const isActive = filter === tab.id;
              const isConflictTab = tab.id === 'conflicts';
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
                      ? isConflictTab
                        ? 'border-status-red/40 bg-status-red-soft text-status-red'
                        : 'border-hairline-strong bg-surface-elevated text-ink-bright'
                      : isConflictTab
                        ? 'border-status-red/20 bg-status-red-soft/40 text-status-red hover:bg-status-red-soft'
                        : 'border-transparent bg-transparent text-ink-body hover:bg-surface-elevated/60 hover:text-ink-bright',
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={clsx(
                      'text-[11px] tabular-nums',
                      isActive ? 'text-ink-charcoal' : 'text-ink-mute',
                      isConflictTab && 'text-status-red font-semibold',
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
                onChange={(e) => setSortBy(e.target.value as KeybindSort)}
                aria-label="Sort hotkeys"
                className="min-h-[44px] rounded-md border border-hairline bg-surface-elevated px-2 py-1 text-[12px] font-medium text-ink-bright focus:border-hairline-strong sm:min-h-[32px]"
              >
                <option value="key-asc">Hotkey (A to Z)</option>
                <option value="key-desc">Hotkey (Z to A)</option>
                <option value="mod-asc">Mod Name</option>
                <option value="section-asc">Toggle Section</option>
                <option value="conflicts-first">Conflicts First</option>
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
                <option value="15">15</option>
                <option value="30">30</option>
                <option value="50">50</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Conflict Alert Banner (compact when not on conflicts tab) */}
      {conflicts.length > 0 && filter !== 'conflicts' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-status-red/35 bg-status-red-soft px-4 py-2.5 text-xs text-status-red">
          <div className="flex items-center gap-2">
            <Icon icon={Icons.alert} size={15} />
            <span>
              {conflicts.length} same-mod hotkey {conflicts.length === 1 ? 'conflict' : 'conflicts'} detected. Multiple toggle sections inside the same mod share a key.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFilter('conflicts')}
            className="rounded-xs border border-status-red/40 bg-surface px-2 py-1 font-medium text-status-red hover:bg-status-red/10"
          >
            Show Conflicts ({conflicts.length})
          </button>
        </div>
      )}

      {/* 4. Unified Collapsible Mod Dropdown Cards View */}
      <section className="mt-5 space-y-3" aria-label="Hotkeys list by mod">
        {modGroups.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-surface px-4 py-10 text-center">
            <p className="text-sm font-medium text-ink">
              {query || searchKey ? 'No matching hotkeys' : 'No hotkeys found'}
            </p>
            <p className="mt-1 text-xs text-ink-mute">
              {query || searchKey
                ? 'Nothing matched your search or key filter. Try clearing filters.'
                : 'No active hotkeys found for the current filter.'}
            </p>
            {(query || searchKey || filter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSearchKey('');
                  setFilter('all');
                }}
                className="mt-4 inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-hairline bg-surface-elevated px-3.5 text-sm font-medium text-ink-bright hover:bg-surface-card"
              >
                Clear All Filters
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* Header controls for expand/collapse all */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-ink-mute">
              <span>
                Showing {startIndex + 1}–{endIndex} of {modGroups.length}{' '}
                {filter === 'conflicts' ? 'conflicting mods' : 'mods'} (
                {filteredBindings.length}{' '}
                {filteredBindings.length === 1 ? 'hotkey' : 'hotkeys'} total)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExpandAll}
                  className="underline transition-colors hover:text-ink-bright"
                >
                  Expand Page
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={handleCollapseAll}
                  className="underline transition-colors hover:text-ink-bright"
                >
                  Collapse All
                </button>
              </div>
            </div>

            {/* Mod Dropdown Cards */}
            <div className="space-y-3">
              {paginatedModGroups.map((group) => {
                const isExpanded = expandedMods.has(group.modId);
                return (
                  <div
                    key={group.modId}
                    className={clsx(
                      'overflow-hidden rounded-lg border transition-colors',
                      group.conflictKeysCount > 0
                        ? 'border-status-red/40 bg-surface'
                        : 'border-hairline bg-surface',
                    )}
                  >
                    {/* Collapsible Dropdown Header */}
                    <button
                      type="button"
                      onClick={() => toggleMod(group.modId)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-elevated/60"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-mute">
                          <Icon
                            icon={
                              isExpanded
                                ? Icons.chevronDown
                                : Icons.chevronRight
                            }
                            size={14}
                          />
                        </span>
                        <span className="truncate text-sm font-semibold text-ink">
                          {group.modDisplayName}
                        </span>
                        {group.iniFiles.map((ini) => (
                          <span
                            key={ini}
                            className="hidden rounded-xs border border-hairline bg-surface-elevated px-1.5 py-0.5 font-mono text-[11px] text-ink-mute sm:inline-block"
                          >
                            {ini}
                          </span>
                        ))}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {group.conflictKeysCount > 0 && (
                          <span className="rounded-xs border border-status-red/30 bg-status-red-soft px-2 py-0.5 text-xs font-medium text-status-red">
                            {group.conflictKeysCount}{' '}
                            {group.conflictKeysCount === 1
                              ? 'conflict key'
                              : 'conflict keys'}
                          </span>
                        )}
                        <span className="rounded-xs border border-hairline bg-surface-card px-2 py-0.5 text-xs font-medium text-ink-mute">
                          {group.bindings.length}{' '}
                          {group.bindings.length === 1 ? 'hotkey' : 'hotkeys'}
                        </span>
                      </div>
                    </button>

                    {/* Collapsible Body */}
                    {isExpanded && (
                      <div className="divide-y divide-hairline border-t border-hairline bg-canvas/40 px-4 py-2">
                        {group.bindings.map(
                          ({ mod, keybind, isConflict }) => (
                            <div
                              key={`${mod.id}-${keybind.iniPath}-${keybind.keyLineIdx}`}
                              className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-ink">
                                    {cleanSectionName(keybind.section)}
                                  </span>
                                  {isConflict && (
                                    <span className="rounded-xs bg-status-red-soft px-2 py-0.5 text-xs font-medium text-status-red">
                                      Duplicate in mod
                                    </span>
                                  )}
                                  {keybind.variable && (
                                    <span className="rounded-xs border border-hairline bg-surface-elevated px-1.5 py-0.5 font-mono text-xs text-ink-body">
                                      Cycle: {keybind.variable}
                                    </span>
                                  )}
                                </div>

                                <p className="mt-0.5 break-all font-mono text-xs text-ink-mute">
                                  {keybind.iniRelName} [{keybind.section}]
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
                                <Keycap
                                  rawKey={keybind.rawKey}
                                  size="md"
                                  tone={isConflict ? 'conflict' : 'default'}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    openCaptureModal(mod, keybind)
                                  }
                                  className="inline-flex min-h-[44px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-hairline bg-surface-elevated px-3 text-xs font-medium text-ink-bright transition-colors hover:bg-surface-card sm:min-h-[32px]"
                                >
                                  Change Key
                                </button>
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls for Mod Cards */}
            <div className="mt-4">
              <PaginationBar
                currentPage={safePage}
                totalPages={totalPages}
                startIndex={startIndex}
                endIndex={endIndex}
                totalItems={modGroups.length}
                itemLabel={filter === 'conflicts' ? 'conflicting mods' : 'mods'}
                onPageChange={(p) => setCurrentPage(p)}
              />
            </div>
          </div>
        )}
      </section>

      {captureTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCaptureModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="capture-hotkey-title"
            className="w-full max-w-md rounded-xl border border-hairline-strong bg-surface p-5 sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="capture-hotkey-title"
                  className="text-base font-medium text-ink"
                >
                  Change Hotkey
                </h2>
                <p className="mt-0.5 break-all text-xs text-ink-mute">
                  {captureTarget.mod.displayName} ({captureTarget.keybind.iniRelName} [
                  {captureTarget.keybind.section}])
                </p>
              </div>
              <button
                type="button"
                onClick={closeCaptureModal}
                aria-label="Close dialog"
                className="inline-flex min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] shrink-0 items-center justify-center rounded-md text-ink-mute transition-colors hover:bg-surface-elevated hover:text-ink-bright"
              >
                <Icon icon={Icons.close} size={16} />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveKeybind(e)} className="mt-4">
              <div
                ref={captureZoneRef}
                tabIndex={0}
                onClick={() => captureZoneRef.current?.focus()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-hairline-strong bg-surface-elevated px-4 py-6 text-center focus:border-ink-bright"
              >
                <span className="text-xs text-ink-mute">
                  Press any key or modifier combo now
                </span>
                <div className="mt-3 min-h-[32px]">
                  {draftKey.trim() ? (
                    <Keycap
                      rawKey={draftKey}
                      size="md"
                      tone={collidingSameModSections.length > 0 ? 'conflict' : 'default'}
                    />
                  ) : (
                    <span className="text-sm text-ink-mute">Waiting for key press...</span>
                  )}
                </div>
                <code className="mt-3 break-all rounded-xs border border-hairline bg-canvas px-2.5 py-1 font-mono text-xs text-ink-body">
                  key = {draftKey.trim() || '...'}
                </code>
              </div>

              {collidingSameModSections.length > 0 && (
                <div
                  role="status"
                  className="mt-3 rounded-md border border-status-yellow/35 bg-status-yellow-soft px-3 py-2.5 text-xs text-status-yellow"
                >
                  Already used by {collidingSameModSections.join(', ')} inside{' '}
                  {captureTarget.mod.displayName}. Saving this key will trigger them together.
                </div>
              )}

              <div className="mt-3">
                <button
                  type="button"
                  aria-expanded={showRawInput}
                  onClick={() => {
                    const next = !showRawInput;
                    setShowRawInput(next);
                    if (next) {
                      requestAnimationFrame(() => rawInputRef.current?.focus());
                    }
                  }}
                  className="inline-flex min-h-[44px] sm:min-h-[32px] items-center gap-1.5 text-xs font-medium text-ink-mute transition-colors hover:text-ink-bright"
                >
                  <Icon
                    icon={showRawInput ? Icons.chevronDown : Icons.chevronRight}
                    size={14}
                  />
                  Type raw 3DMigoto key (mouse or controller)
                </button>

                {showRawInput && (
                  <div className="mt-2">
                    <label
                      htmlFor="raw-3dmigoto-key"
                      className="block text-xs text-ink-mute"
                    >
                      Examples: <code className="font-mono text-ink-body">VK_XBUTTON1</code>,{' '}
                      <code className="font-mono text-ink-body">no_ctrl VK_MBUTTON</code>,{' '}
                      <code className="font-mono text-ink-body">XB_DPAD_UP</code>
                    </label>
                    <input
                      ref={rawInputRef}
                      id="raw-3dmigoto-key"
                      type="text"
                      value={draftKey}
                      onChange={(e) => {
                        setDraftKey(e.target.value);
                        setSaveError(null);
                      }}
                      placeholder="VK_XBUTTON1"
                      className={clsx(
                        'mt-1.5 min-h-[44px] sm:min-h-[36px] w-full rounded-md border bg-surface-elevated px-3 font-mono text-xs text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong',
                        'border-hairline',
                      )}
                    />
                  </div>
                )}
              </div>

              {saveError && (
                <div
                  role="alert"
                  className="mt-3 rounded-md border border-status-red/35 bg-status-red-soft px-3 py-2 text-xs text-status-red"
                >
                  {saveError}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={savingKey}
                  onClick={closeCaptureModal}
                  className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-hairline bg-surface-elevated px-4 text-sm font-medium text-ink-bright transition-colors hover:bg-surface-card disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingKey || !draftKey.trim()}
                  className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-ink-bright px-4 text-sm font-medium text-black transition-colors hover:bg-[#e8e8e8] active:bg-[#dcdcdc] disabled:cursor-not-allowed disabled:bg-surface-elevated disabled:text-ink-ash"
                >
                  {savingKey ? 'Saving...' : 'Save Hotkey'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCheatSheet && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Hotkey Cheat Sheet"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
        >
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-lg border border-hairline-strong bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-hairline p-4 sm:p-5">
              <div>
                <h3 className="text-base font-medium text-ink">
                  Hotkey Cheat Sheet
                </h3>
                <p className="mt-0.5 text-xs text-ink-mute">
                  Quick reference of active character mod toggles in-game.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCheatSheet(false)}
                aria-label="Close cheat sheet"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hairline bg-surface-elevated text-ink-mute hover:text-ink-bright sm:min-h-[32px] sm:min-w-[32px]"
              >
                <Icon icon={Icons.close} size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <pre className="rounded-md border border-hairline bg-canvas p-3.5 font-mono text-xs leading-relaxed text-ink-bright whitespace-pre-wrap">
                {cheatSheetText}
              </pre>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline p-4 sm:p-5">
              <button
                type="button"
                onClick={handleSaveCheatSheetFile}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-3 text-xs font-medium text-ink-body hover:border-hairline-strong hover:text-ink-bright sm:min-h-[36px]"
              >
                <Icon icon={Icons.folderOpen} size={14} className="text-ink-mute" />
                <span>Save as .txt</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCheatSheet(false)}
                  className="min-h-[44px] rounded-md px-3 text-xs font-medium text-ink-mute hover:text-ink-body sm:min-h-[36px]"
                >
                  Close
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopyCheatSheet()}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-white px-3.5 text-xs font-medium text-black hover:bg-[#e8e8e8] sm:min-h-[36px]"
                >
                  <Icon
                    icon={copiedCheatSheet ? Icons.check : Icons.code}
                    size={14}
                  />
                  <span>{copiedCheatSheet ? 'Copied to Clipboard' : 'Copy Cheat Sheet'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
