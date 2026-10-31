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

export interface KeybindsViewProps {
  root: string | null;
  mods: ModEntry[];
  conflicts: KeyConflict[];
  onPickFolder: () => void;
  onToggleMod: (mod: ModEntry) => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
}

interface ActiveBindingRow {
  mod: ModEntry;
  keybind: KeyBind;
}

function cleanSectionName(section: string): string {
  const stripped = section.replace(/^key[\s_-]*/i, '').trim();
  return stripped.length > 0 ? stripped : section;
}

export function KeybindsView({
  root,
  mods,
  conflicts,
  onPickFolder,
  onToggleMod,
  onRefresh,
  onNotify,
}: KeybindsViewProps) {
  const [query, setQuery] = useState('');
  const [busyModId, setBusyModId] = useState<string | null>(null);
  const [captureTarget, setCaptureTarget] = useState<ActiveBindingRow | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [showRawInput, setShowRawInput] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const captureZoneRef = useRef<HTMLDivElement>(null);
  const rawInputRef = useRef<HTMLInputElement>(null);

  const modsById = useMemo(() => {
    const map = new Map<string, ModEntry>();
    for (const m of mods) map.set(m.id, m);
    return map;
  }, [mods]);

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

  const crossModConflicts = useMemo(
    () => conflicts.filter((c) => c.crossMod),
    [conflicts],
  );

  const crossModKeySet = useMemo(
    () => new Set(crossModConflicts.map((c) => c.normalizedKey)),
    [crossModConflicts],
  );

  const sharedInModKeySet = useMemo(
    () => new Set(conflicts.filter((c) => !c.crossMod).map((c) => c.normalizedKey)),
    [conflicts],
  );

  const filteredBindings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeBindings;
    return activeBindings.filter(({ mod, keybind }) => {
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
  }, [activeBindings, query]);

  const collidingOtherMods = useMemo(() => {
    if (!captureTarget) return [];
    const trimmed = draftKey.trim();
    if (!trimmed) return [];
    const norm = normalizeKeyComboClient(trimmed);
    const names = new Set<string>();
    for (const mod of mods) {
      if (!mod.enabled || mod.id === captureTarget.mod.id) continue;
      for (const kb of mod.keybinds) {
        const kbNorm = kb.normalizedKey || normalizeKeyComboClient(kb.rawKey);
        if (kbNorm === norm) {
          names.add(mod.displayName);
        }
      }
    }
    return Array.from(names);
  }, [captureTarget, draftKey, mods]);

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

  async function handleDisableMod(modId: string) {
    const mod = modsById.get(modId);
    if (!mod || !mod.enabled || busyModId) return;
    setBusyModId(modId);
    try {
      await onToggleMod(mod);
    } finally {
      setBusyModId(null);
    }
  }

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
          Pick your 3DMigoto or XXMI Mods folder first to inspect active hotkeys and fix key collisions across mods.
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
      <header className="flex flex-col gap-1 border-b border-hairline pb-5">
        <h1 className="text-xl font-medium tracking-tight text-ink sm:text-2xl">
          Hotkeys
        </h1>
        <p className="text-sm text-ink-mute">
          {activeBindings.length} active {activeBindings.length === 1 ? 'hotkey' : 'hotkeys'} across{' '}
          {activeModWithKeysCount} enabled {activeModWithKeysCount === 1 ? 'mod' : 'mods'}
        </p>
      </header>

      <section className="mt-6" aria-label="Conflict status">
        {crossModConflicts.length === 0 ? (
          <div className="rounded-md border border-status-green/25 bg-status-green-soft px-4 py-3 text-sm text-status-green">
            No cross-mod hotkey conflicts across active mods.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-status-red/35 bg-status-red-soft px-4 py-3 text-sm text-status-red">
              {crossModConflicts.length} cross-mod {crossModConflicts.length === 1 ? 'keybind collision' : 'keybind collisions'} detected. Pressing a shared key triggers multiple active mods at the same time.
            </div>

            <div className="space-y-3">
              {crossModConflicts.map((conflict) => {
                const sampleRawKey =
                  conflict.entries[0]?.keybind.rawKey ?? conflict.normalizedKey;
                const modCount = new Set(conflict.entries.map((e) => e.modId)).size;

                return (
                  <div
                    key={conflict.normalizedKey}
                    className="rounded-lg border border-status-red/40 bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Keycap rawKey={sampleRawKey} size="md" tone="conflict" />
                        <span className="text-xs text-status-red">
                          Bound in {modCount} active mods
                        </span>
                      </div>
                      <span className="font-mono text-xs text-ink-mute">
                        {conflict.normalizedKey}
                      </span>
                    </div>

                    <div className="mt-3 divide-y divide-hairline">
                      {conflict.entries.map((entry) => {
                        const mod = modsById.get(entry.modId);
                        const isBusy = busyModId === entry.modId;
                        return (
                          <div
                            key={`${entry.modId}-${entry.keybind.iniPath}-${entry.keybind.keyLineIdx}`}
                            className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-ink">
                                  {entry.modDisplayName}
                                </span>
                                <span className="text-xs text-ink-mute">
                                  {cleanSectionName(entry.keybind.section)}
                                </span>
                                {entry.keybind.variable && (
                                  <span className="rounded-xs border border-hairline bg-surface-elevated px-1.5 py-0.5 font-mono text-xs text-ink-body">
                                    {entry.keybind.variable}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 break-all font-mono text-xs text-ink-mute">
                                {entry.keybind.iniRelName} [{entry.keybind.section}]
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                              {mod && (
                                <button
                                  type="button"
                                  onClick={() => openCaptureModal(mod, entry.keybind)}
                                  className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-hairline-strong bg-surface-elevated px-3 text-sm font-medium text-ink-bright transition-colors hover:bg-surface-card"
                                >
                                  Change Key
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={!mod || isBusy}
                                onClick={() => void handleDisableMod(entry.modId)}
                                className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-hairline bg-transparent px-3 text-sm font-medium text-ink-body transition-colors hover:border-status-red/40 hover:bg-status-red-soft hover:text-status-red disabled:cursor-not-allowed disabled:text-ink-ash"
                              >
                                {isBusy ? 'Disabling...' : 'Disable Mod'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="mt-8" aria-label="All active hotkeys">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-medium text-ink">All Active Hotkeys</h2>
            <p className="text-xs text-ink-mute">
              Search by mod name, toggle section, key, or variable.
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-mute">
              <Icon icon={Icons.search} size={15} />
            </span>
            <input
              type="search"
              data-view-search="keybinds"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter hotkeys..."
              aria-label="Filter active hotkeys"
              className="min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated pl-9 pr-9 text-sm text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear hotkey filter"
                className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] items-center justify-center text-ink-mute hover:text-ink-bright"
              >
                <Icon icon={Icons.close} size={14} />
              </button>
            )}
          </div>
        </div>

        {filteredBindings.length === 0 ? (
          <div className="mt-4 rounded-lg border border-hairline bg-surface px-4 py-10 text-center">
            <p className="text-sm font-medium text-ink">No matching hotkeys</p>
            <p className="mt-1 text-xs text-ink-mute">
              Nothing matched &ldquo;{query}&rdquo;. Try a key label like Up or a mod name.
            </p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-4 inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-hairline bg-surface-elevated px-3.5 text-sm font-medium text-ink-bright hover:bg-surface-card"
            >
              Clear Filter
            </button>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
            {filteredBindings.map(({ mod, keybind }) => {
              const isCrossMod = crossModKeySet.has(keybind.normalizedKey);
              const isSharedInMod = sharedInModKeySet.has(keybind.normalizedKey);

              return (
                <div
                  key={`${mod.id}-${keybind.iniPath}-${keybind.keyLineIdx}`}
                  className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-surface-elevated/60 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">
                        {mod.displayName}
                      </span>
                      <span className="text-sm text-ink-body">
                        {cleanSectionName(keybind.section)}
                      </span>
                      {isSharedInMod && (
                        <span className="rounded-xs bg-status-blue-soft px-2 py-0.5 text-xs font-medium text-status-blue">
                          Shared in mod
                        </span>
                      )}
                      {isCrossMod && (
                        <span className="rounded-xs bg-status-red-soft px-2 py-0.5 text-xs font-medium text-status-red">
                          Cross-mod conflict
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mute">
                      <span className="break-all font-mono">
                        {keybind.iniRelName} [{keybind.section}]
                      </span>
                      {keybind.variable && (
                        <span className="rounded-xs border border-hairline bg-surface-elevated px-1.5 py-0.5 font-mono text-xs text-ink-body">
                          Cycle: {keybind.variable}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
                    <Keycap
                      rawKey={keybind.rawKey}
                      size="md"
                      tone={isCrossMod ? 'conflict' : 'default'}
                    />
                    <button
                      type="button"
                      onClick={() => openCaptureModal(mod, keybind)}
                      className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-hairline bg-surface-elevated px-3 text-sm font-medium text-ink-bright transition-colors hover:bg-surface-card"
                    >
                      Change Key
                    </button>
                  </div>
                </div>
              );
            })}
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
                      tone={collidingOtherMods.length > 0 ? 'conflict' : 'default'}
                    />
                  ) : (
                    <span className="text-sm text-ink-mute">Waiting for key press...</span>
                  )}
                </div>
                <code className="mt-3 break-all rounded-xs border border-hairline bg-canvas px-2.5 py-1 font-mono text-xs text-ink-body">
                  key = {draftKey.trim() || '...'}
                </code>
              </div>

              {collidingOtherMods.length > 0 && (
                <div
                  role="status"
                  className="mt-3 rounded-md border border-status-yellow/35 bg-status-yellow-soft px-3 py-2.5 text-xs text-status-yellow"
                >
                  This key is already bound in {collidingOtherMods.join(', ')}. Saving it will create a cross-mod conflict.
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
    </div>
  );
}
