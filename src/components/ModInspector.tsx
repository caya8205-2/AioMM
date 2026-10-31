import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { api, IS_TAURI, resolveModImageUrl } from '../lib/api';
import type { DryRunDto, IniFileEntry, ModEntry, Preset } from '../types';
import { Icon, Icons } from './Icon';
import { Keycap } from './Keycap';

export interface ModInspectorProps {
  mod: ModEntry;
  modsRoot: string;
  presets: Preset[];
  onClose: () => void;
  onToggleMod: (mod: ModEntry) => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
}

interface PresetGroup {
  groupName: string;
  items: Preset[];
}

export function ModInspector(props: ModInspectorProps): JSX.Element {
  const {
    mod,
    modsRoot,
    presets,
    onClose,
    onToggleMod,
    onRefresh,
    onNotify,
  } = props;

  const activeInis = useMemo(
    () => mod.iniFiles.filter((f) => !f.isDisabled),
    [mod.iniFiles],
  );
  const disabledInis = useMemo(
    () => mod.iniFiles.filter((f) => f.isDisabled),
    [mod.iniFiles],
  );

  const [selectedRelName, setSelectedRelName] = useState<string>(() => {
    const first = mod.iniFiles.find((f) => !f.isDisabled) ?? mod.iniFiles[0];
    return first?.relName ?? '';
  });
  const [showDisabledInis, setShowDisabledInis] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [dryRuns, setDryRuns] = useState<Record<string, DryRunDto>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [expandedDiffGroups, setExpandedDiffGroups] = useState<
    Record<string, boolean>
  >({});
  const [selectedDiffVariant, setSelectedDiffVariant] = useState<
    Record<string, string>
  >({});
  const [justPatched, setJustPatched] = useState(false);

  useEffect(() => {
    const exists = mod.iniFiles.some((f) => f.relName === selectedRelName);
    if (!exists) {
      const first = mod.iniFiles.find((f) => !f.isDisabled) ?? mod.iniFiles[0];
      setSelectedRelName(first?.relName ?? '');
    }
  }, [mod.iniFiles, selectedRelName]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (document.querySelector('[role="menu"], [role="dialog"]')) return;
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const selectedIni: IniFileEntry | null = useMemo(() => {
    return (
      mod.iniFiles.find((f) => f.relName === selectedRelName) ??
      activeInis[0] ??
      mod.iniFiles[0] ??
      null
    );
  }, [mod.iniFiles, selectedRelName, activeInis]);

  const loadPreviews = useCallback(async () => {
    if (!selectedIni || !modsRoot || presets.length === 0) {
      setDryRuns({});
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const entries = await Promise.all(
        presets.map(
          async (p) =>
            [
              p.id,
              await api.previewPreset(selectedIni.path, modsRoot, p.id),
            ] as const,
        ),
      );
      setDryRuns(Object.fromEntries(entries));
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : 'Could not preview preset changes.',
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedIni, modsRoot, presets]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedIni || !modsRoot || presets.length === 0) {
      setDryRuns({});
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    Promise.all(
      presets.map(
        async (p) =>
          [
            p.id,
            await api.previewPreset(selectedIni.path, modsRoot, p.id),
          ] as const,
      ),
    )
      .then((entries) => {
        if (!cancelled) {
          setDryRuns(Object.fromEntries(entries));
          setPreviewLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPreviewError(
            err instanceof Error
              ? err.message
              : 'Could not preview preset changes.',
          );
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mod.id, selectedIni, modsRoot, presets]);

  const presetGroups: PresetGroup[] = useMemo(() => {
    const grouped = new Map<string, Preset[]>();
    for (const p of presets) {
      const key = p.group?.trim() || p.name;
      const list = grouped.get(key) ?? [];
      list.push(p);
      grouped.set(key, list);
    }
    return Array.from(grouped.entries()).map(([groupName, items]) => ({
      groupName,
      items,
    }));
  }, [presets]);

  // Enforce a single solid white CTA button across the entire inspector pane.
  const primaryPresetId: string | null = useMemo(() => {
    for (const grp of presetGroups) {
      const p3 = grp.items.find((p) => p.id === 'oilskin-3plus');
      const pAll = grp.items.find((p) => p.id === 'oilskin-all');
      if (p3 && pAll) {
        const d3 = dryRuns[p3.id];
        const dAll = dryRuns[pAll.id];
        if (d3 && d3.injectedLines > 0) return p3.id;
        if (
          d3 &&
          d3.matchingSectionsTotal === 0 &&
          dAll &&
          dAll.injectedLines > 0
        ) {
          return pAll.id;
        }
        continue;
      }
      const readyItem =
        grp.items.find(
          (p) => p.recommended && (dryRuns[p.id]?.injectedLines ?? 0) > 0,
        ) ?? grp.items.find((p) => (dryRuns[p.id]?.injectedLines ?? 0) > 0);
      if (readyItem) return readyItem.id;
    }
    return null;
  }, [presetGroups, dryRuns]);

  const hasSelectedBackup = useMemo(() => {
    if (!selectedIni) return false;
    if (selectedIni.hasBackup) return true;
    return Object.values(dryRuns).some((d) => d.hasBackup);
  }, [selectedIni, dryRuns]);

  async function handleOpenFolder() {
    try {
      await api.revealInExplorer(mod.path);
      if (!IS_TAURI) {
        onNotify(`Folder path: ${mod.path}`);
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not open folder in Explorer.',
      );
    }
  }

  async function handleToggleCurrentMod() {
    if (busyAction) return;
    setBusyAction('toggle');
    try {
      await onToggleMod(mod);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleApplyPreset(preset: Preset) {
    if (!selectedIni || busyAction) return;
    setBusyAction(preset.id);
    try {
      const result = await api.applyPreset(
        selectedIni.path,
        modsRoot,
        preset.id,
      );
      await onRefresh();
      await loadPreviews();
      setJustPatched(true);
      if (result.injectedLines > 0) {
        onNotify(
          `Applied ${preset.name} (${result.injectedLines} lines in ${result.touchedSections} sections).`,
        );
      } else {
        onNotify(`${preset.name} is already applied to ${selectedIni.relName}.`);
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to apply preset to .ini file.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestoreBackup() {
    if (!selectedIni || busyAction) return;
    setBusyAction('restore');
    try {
      await api.restoreIniBackup(selectedIni.path);
      await onRefresh();
      await loadPreviews();
      setJustPatched(false);
      onNotify(`Restored original ${selectedIni.relName}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not restore original .ini file.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  const previewUrl = resolveModImageUrl(mod.previewPath);
  const visibleInis = showDisabledInis ? mod.iniFiles : activeInis;
  const showF10Hint =
    justPatched ||
    hasSelectedBackup ||
    mod.hasAnyBackup ||
    mod.appliedPresetIds.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-medium text-ink">
            {mod.displayName}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-mute">
            {mod.category && (
              <span className="rounded-xs border border-hairline bg-surface-card px-1.5 py-0.5 text-[11px] font-medium text-ink-charcoal">
                {mod.category}
              </span>
            )}
            <span className="truncate font-mono text-[11px]" title={mod.path}>
              {mod.name}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleOpenFolder()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright transition-colors hover:border-hairline-strong sm:min-h-[36px]"
          >
            <Icon icon={Icons.external} size={14} className="text-ink-mute" />
            <span>Open Folder</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close mod inspector"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-hairline bg-surface-elevated text-ink-body transition-colors hover:border-hairline-strong hover:text-ink-bright sm:min-h-[36px] sm:min-w-[36px]"
          >
            <Icon icon={Icons.close} size={16} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-8">
        {previewUrl && (
          <div className="overflow-hidden rounded-md border border-hairline bg-surface-card">
            {!imgFailed ? (
              <img
                src={previewUrl}
                alt={`${mod.displayName} preview`}
                onError={() => setImgFailed(true)}
                className="h-40 w-full object-cover"
              />
            ) : (
              <div className="flex h-28 w-full items-center justify-center gap-2.5 px-4 text-ink-mute">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface">
                  <Icon icon={Icons.image} size={18} />
                </span>
                <span className="text-[12px]">Preview image unavailable</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface-card px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-ink">
              {mod.enabled ? 'Mod Enabled' : 'Mod Disabled'}
            </div>
            <div className="text-[12px] text-ink-mute">
              {mod.enabled
                ? 'Active on next game launch or F10 reload'
                : 'Folder starts with DISABLED_ and is skipped'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={mod.enabled}
            aria-label={`${mod.enabled ? 'Disable' : 'Enable'} ${mod.displayName}`}
            disabled={busyAction !== null}
            onClick={() => void handleToggleCurrentMod()}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md border border-hairline bg-surface-elevated px-3 text-[12px] font-medium text-ink-bright transition-colors hover:border-hairline-strong disabled:opacity-50 sm:min-h-[36px]"
          >
            <span>{mod.enabled ? 'Disable' : 'Enable'}</span>
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-medium text-ink-charcoal">
              Active .ini Config
            </h3>
            <span className="text-[12px] text-ink-mute">
              {activeInis.length} active
            </span>
          </div>

          {visibleInis.length === 0 ? (
            <div className="rounded-md border border-hairline bg-surface-card p-3 text-[12px] text-ink-mute">
              No active .ini files found in this mod.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {visibleInis.map((ini) => {
                const isSelected = selectedIni?.path === ini.path;
                return (
                  <button
                    key={ini.path}
                    type="button"
                    onClick={() => setSelectedRelName(ini.relName)}
                    className={clsx(
                      'flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors sm:min-h-[36px]',
                      isSelected
                        ? 'border-hairline-strong bg-surface-card text-ink-bright'
                        : 'border-hairline bg-surface-elevated text-ink-body hover:border-hairline-strong hover:text-ink-bright',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon
                        icon={Icons.file}
                        size={15}
                        className="shrink-0 text-ink-mute"
                      />
                      <span className="truncate font-mono text-[12px]">
                        {ini.relName}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {ini.isDisabled && (
                        <span className="rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-[11px] text-ink-mute">
                          Ignored
                        </span>
                      )}
                      {ini.hasBackup && (
                        <span className="rounded-xs border border-status-blue/30 bg-status-blue-soft px-1.5 py-0.5 text-[11px] font-medium text-status-blue">
                          Backup
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {disabledInis.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowDisabledInis((prev) => {
                  const next = !prev;
                  if (
                    !next &&
                    selectedIni?.isDisabled &&
                    activeInis.length > 0
                  ) {
                    setSelectedRelName(activeInis[0].relName);
                  }
                  return next;
                });
              }}
              className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-sm px-1 text-[12px] font-medium text-ink-mute transition-colors hover:text-ink-bright sm:min-h-[32px]"
            >
              <Icon
                icon={Icons.chevronRight}
                size={14}
                className={clsx(
                  'transition-transform',
                  showDisabledInis && 'rotate-90',
                )}
              />
              <span>
                {showDisabledInis
                  ? `Hide ignored backup configs (${disabledInis.length})`
                  : `Show ignored backup configs (${disabledInis.length})`}
              </span>
            </button>
          )}

          {hasSelectedBackup && selectedIni && (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleRestoreBackup()}
              className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-hairline bg-surface-elevated px-3 py-2 text-[13px] font-medium text-ink-bright transition-colors hover:border-hairline-strong disabled:opacity-50 sm:min-h-[36px]"
            >
              <Icon icon={Icons.undo} size={15} className="text-ink-mute" />
              <span>
                {busyAction === 'restore'
                  ? 'Restoring Original File...'
                  : 'Restore Original File'}
              </span>
            </button>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <h3 className="text-[13px] font-medium text-ink-charcoal">
            Guided Effect Applier
          </h3>

          {!selectedIni ? (
            <div className="rounded-md border border-hairline bg-surface-card p-3.5 text-[13px] text-ink-mute">
              Select an .ini file above to check compatible presets.
            </div>
          ) : presets.length === 0 ? (
            <div className="rounded-md border border-hairline bg-surface-card p-3.5 text-[13px] text-ink-mute">
              No texture or shader presets saved yet. Open Presets to create one.
            </div>
          ) : previewError ? (
            <div className="flex flex-col gap-2.5 rounded-md border border-status-red/30 bg-status-red-soft p-3.5">
              <p className="text-[12px] text-status-red">{previewError}</p>
              <button
                type="button"
                onClick={() => void loadPreviews()}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-hairline bg-surface-elevated px-3 text-[12px] font-medium text-ink-bright hover:border-hairline-strong sm:min-h-[36px]"
              >
                Retry Preview
              </button>
            </div>
          ) : previewLoading && Object.keys(dryRuns).length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-md border border-hairline bg-surface-card p-3.5 text-[13px] text-ink-mute">
              <Icon icon={Icons.refresh} size={16} className="animate-spin" />
              <span>Checking .ini sections against presets...</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {presetGroups.map((grp) => {
                const p3 = grp.items.find((p) => p.id === 'oilskin-3plus');
                const pAll = grp.items.find((p) => p.id === 'oilskin-all');
                const isOilSkinPair = Boolean(p3 && pAll);

                if (isOilSkinPair && p3 && pAll) {
                  const d3 = dryRuns[p3.id];
                  const dAll = dryRuns[pAll.id];
                  const is3Applied = Boolean(
                    d3 && d3.alreadyAppliedLines > 0 && d3.injectedLines === 0,
                  );
                  const isAllApplied = Boolean(
                    dAll &&
                      dAll.alreadyAppliedLines > 0 &&
                      dAll.injectedLines === 0,
                  );
                  const isAnyApplied = is3Applied || isAllApplied;
                  const fallbackTo0Plus = Boolean(
                    d3 &&
                      d3.matchingSectionsTotal === 0 &&
                      dAll &&
                      dAll.injectedLines > 0,
                  );
                  const readyDto =
                    d3 && d3.injectedLines > 0
                      ? d3
                      : fallbackTo0Plus
                        ? dAll
                        : null;

                  const defaultDiffId =
                    d3 && d3.injectedLines > 0
                      ? p3.id
                      : dAll && dAll.injectedLines > 0
                        ? pAll.id
                        : p3.id;
                  const activeDiffId =
                    selectedDiffVariant[grp.groupName] ?? defaultDiffId;
                  const activeDiffDto = dryRuns[activeDiffId];
                  const diffOpen = Boolean(expandedDiffGroups[grp.groupName]);

                  const p3IsPrimary = primaryPresetId === p3.id;
                  const pAllIsPrimary = primaryPresetId === pAll.id;

                  return (
                    <div
                      key={grp.groupName}
                      className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-card p-3.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h4 className="text-[14px] font-medium text-ink">
                            {grp.groupName}
                          </h4>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-mute">
                            Adds OilSkin and Clear shader calls around shared
                            resource overrides.
                          </p>
                        </div>

                        {isAnyApplied && (
                          <span className="shrink-0 rounded-xs border border-status-green/30 bg-status-green-soft px-2 py-0.5 text-[11px] font-medium text-status-green">
                            Applied
                          </span>
                        )}
                      </div>

                      {readyDto && (
                        <div>
                          <span className="inline-flex items-center gap-1.5 rounded-xs border border-status-green/30 bg-status-green-soft px-2 py-1 text-[12px] font-medium text-status-green">
                            <Icon icon={Icons.check} size={13} />
                            <span>
                              Ready: {readyDto.injectedLines} lines in{' '}
                              {readyDto.touchedSections} sections
                            </span>
                          </span>
                        </div>
                      )}

                      {fallbackTo0Plus && (
                        <div className="rounded-md border border-status-yellow/30 bg-status-yellow-soft px-3 py-2 text-[12px] leading-relaxed text-status-yellow">
                          This mod uses Component 0 to 2. Use &apos;Apply All
                          Parts (0+)&apos; below.
                        </div>
                      )}

                      {!readyDto && !isAnyApplied && d3 && dAll && (
                        <p className="text-[12px] text-ink-mute">
                          No matching shared resource lines were found in{' '}
                          <span className="font-mono">{selectedIni.relName}</span>.
                        </p>
                      )}

                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          disabled={
                            busyAction !== null ||
                            !d3 ||
                            d3.injectedLines === 0
                          }
                          onClick={() => void handleApplyPreset(p3)}
                          className={clsx(
                            'inline-flex min-h-[44px] w-full items-center justify-center rounded-md px-3 py-2 text-[13px] font-medium transition-colors sm:min-h-[36px]',
                            p3IsPrimary && d3 && d3.injectedLines > 0
                              ? 'bg-ink-bright text-black hover:bg-[#e8e8e8] disabled:opacity-50'
                              : d3 && d3.injectedLines > 0
                                ? 'border border-hairline bg-surface-elevated text-ink-bright hover:border-hairline-strong disabled:opacity-50'
                                : 'cursor-not-allowed border border-hairline bg-surface-elevated text-ink-ash',
                          )}
                        >
                          {busyAction === p3.id
                            ? 'Applying Body Parts 3+...'
                            : is3Applied
                              ? 'Body Parts 3+ Applied'
                              : 'Apply Body Parts 3+ (Recommended)'}
                        </button>

                        <button
                          type="button"
                          disabled={
                            busyAction !== null ||
                            !dAll ||
                            dAll.injectedLines === 0
                          }
                          onClick={() => void handleApplyPreset(pAll)}
                          className={clsx(
                            'inline-flex min-h-[44px] w-full items-center justify-center rounded-md px-3 py-2 text-[13px] font-medium transition-colors sm:min-h-[36px]',
                            pAllIsPrimary && dAll && dAll.injectedLines > 0
                              ? 'bg-ink-bright text-black hover:bg-[#e8e8e8] disabled:opacity-50'
                              : dAll && dAll.injectedLines > 0
                                ? 'border border-hairline bg-surface-elevated text-ink-bright hover:border-hairline-strong disabled:opacity-50'
                                : 'cursor-not-allowed border border-hairline bg-surface-elevated text-ink-ash',
                          )}
                        >
                          {busyAction === pAll.id
                            ? 'Applying All Parts (0+)...'
                            : isAllApplied
                              ? 'All Parts (0+) Applied'
                              : 'Apply All Parts (0+)'}
                        </button>
                      </div>

                      <div className="border-t border-hairline pt-2">
                        <button
                          type="button"
                          aria-expanded={diffOpen}
                          onClick={() =>
                            setExpandedDiffGroups((prev) => ({
                              ...prev,
                              [grp.groupName]: !prev[grp.groupName],
                            }))
                          }
                          className="inline-flex min-h-[44px] items-center gap-1.5 text-[12px] font-medium text-ink-mute transition-colors hover:text-ink-bright sm:min-h-[32px]"
                        >
                          <Icon
                            icon={Icons.code}
                            size={14}
                            className="shrink-0"
                          />
                          <span>
                            {diffOpen
                              ? 'Hide exact .ini changes'
                              : 'Show exact .ini changes'}
                          </span>
                        </button>

                        {diffOpen && (
                          <div className="mt-2 flex flex-col gap-2">
                            <div className="flex items-center gap-1.5">
                              {[
                                { id: p3.id, label: 'Body Parts 3+' },
                                { id: pAll.id, label: 'All Parts 0+' },
                              ].map((tab) => (
                                <button
                                  key={tab.id}
                                  type="button"
                                  onClick={() =>
                                    setSelectedDiffVariant((prev) => ({
                                      ...prev,
                                      [grp.groupName]: tab.id,
                                    }))
                                  }
                                  className={clsx(
                                    'min-h-[44px] rounded-full px-3 py-1 text-[11px] font-medium transition-colors sm:min-h-[28px] sm:px-2.5',
                                    activeDiffId === tab.id
                                      ? 'border border-hairline-strong bg-surface-elevated text-ink-bright'
                                      : 'text-ink-mute hover:text-ink-bright',
                                  )}
                                >
                                  {tab.label}
                                </button>
                              ))}
                            </div>

                            <pre className="max-h-52 overflow-x-auto overflow-y-auto rounded-md border border-hairline bg-canvas p-3 font-mono text-xs leading-relaxed">
                              {activeDiffDto &&
                              activeDiffDto.preview.length > 0 ? (
                                activeDiffDto.preview.map((line, i) => (
                                  <div
                                    key={`${i}-${line}`}
                                    className={clsx(
                                      line.startsWith('+')
                                        ? 'text-status-green'
                                        : 'text-ink-charcoal',
                                    )}
                                  >
                                    {line}
                                  </div>
                                ))
                              ) : (
                                <span className="text-ink-mute">
                                  No pending lines to add
                                </span>
                              )}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={grp.groupName}
                    className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-card p-3.5"
                  >
                    <h4 className="text-[14px] font-medium text-ink">
                      {grp.groupName}
                    </h4>

                    {grp.items.map((preset) => {
                      const dr = dryRuns[preset.id];
                      const isApplied = Boolean(
                        dr && dr.alreadyAppliedLines > 0 && dr.injectedLines === 0,
                      );
                      const isReady = Boolean(dr && dr.injectedLines > 0);
                      const isPrimary = primaryPresetId === preset.id;
                      const diffKey = `${grp.groupName}:${preset.id}`;
                      const diffOpen = Boolean(expandedDiffGroups[diffKey]);

                      return (
                        <div
                          key={preset.id}
                          className="flex flex-col gap-2.5 border-t border-hairline pt-2.5 first:border-t-0 first:pt-0"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[12px] leading-relaxed text-ink-mute">
                              {preset.description || preset.name}
                            </p>
                            {isApplied && (
                              <span className="shrink-0 rounded-xs border border-status-green/30 bg-status-green-soft px-2 py-0.5 text-[11px] font-medium text-status-green">
                                Applied
                              </span>
                            )}
                          </div>

                          {isReady && dr && (
                            <div>
                              <span className="inline-flex items-center gap-1.5 rounded-xs border border-status-green/30 bg-status-green-soft px-2 py-1 text-[12px] font-medium text-status-green">
                                <Icon icon={Icons.check} size={13} />
                                <span>
                                  Ready: {dr.injectedLines} lines in{' '}
                                  {dr.touchedSections} sections
                                </span>
                              </span>
                            </div>
                          )}

                          <button
                            type="button"
                            disabled={busyAction !== null || !isReady}
                            onClick={() => void handleApplyPreset(preset)}
                            className={clsx(
                              'inline-flex min-h-[44px] w-full items-center justify-center rounded-md px-3 py-2 text-[13px] font-medium transition-colors sm:min-h-[36px]',
                              isPrimary && isReady
                                ? 'bg-ink-bright text-black hover:bg-[#e8e8e8] disabled:opacity-50'
                                : isReady
                                  ? 'border border-hairline bg-surface-elevated text-ink-bright hover:border-hairline-strong disabled:opacity-50'
                                  : 'cursor-not-allowed border border-hairline bg-surface-elevated text-ink-ash',
                            )}
                          >
                            {busyAction === preset.id
                              ? `Applying ${preset.name}...`
                              : isApplied
                                ? `${preset.name} Applied`
                                : `Apply ${preset.name}`}
                          </button>

                          <button
                            type="button"
                            aria-expanded={diffOpen}
                            onClick={() =>
                              setExpandedDiffGroups((prev) => ({
                                ...prev,
                                [diffKey]: !prev[diffKey],
                              }))
                            }
                            className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-[12px] font-medium text-ink-mute transition-colors hover:text-ink-bright sm:min-h-[32px]"
                          >
                            <Icon
                              icon={Icons.code}
                              size={14}
                              className="shrink-0"
                            />
                            <span>
                              {diffOpen
                                ? 'Hide exact .ini changes'
                                : 'Show exact .ini changes'}
                            </span>
                          </button>

                          {diffOpen && (
                            <pre className="max-h-52 overflow-x-auto overflow-y-auto rounded-md border border-hairline bg-canvas p-3 font-mono text-xs leading-relaxed">
                              {dr && dr.preview.length > 0 ? (
                                dr.preview.map((line, i) => (
                                  <div
                                    key={`${i}-${line}`}
                                    className={clsx(
                                      line.startsWith('+')
                                        ? 'text-status-green'
                                        : 'text-ink-charcoal',
                                    )}
                                  >
                                    {line}
                                  </div>
                                ))
                              ) : (
                                <span className="text-ink-mute">
                                  No pending lines to add
                                </span>
                              )}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {mod.keybinds.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-medium text-ink-charcoal">
              Mod Hotkeys
            </h3>
            <div className="flex flex-col gap-1.5 rounded-md border border-hairline bg-surface-card p-3">
              {mod.keybinds.map((kb, idx) => (
                <div
                  key={`${kb.iniPath}-${kb.keyLineIdx}-${idx}`}
                  className="flex items-center justify-between gap-2 text-[12px]"
                >
                  <span className="truncate text-ink-body" title={kb.section}>
                    {kb.section.replace(/^Key/i, '') || kb.section}
                  </span>
                  <Keycap rawKey={kb.rawKey} size="sm" />
                </div>
              ))}
            </div>
          </section>
        )}

        {showF10Hint && (
          <div className="rounded-md border border-hairline bg-surface-elevated px-3 py-2.5 text-[12px] leading-relaxed text-ink-body">
            Press <Keycap rawKey="VK_F10" size="sm" /> in-game to reload mods
            after making changes.
          </div>
        )}
      </div>
    </div>
  );
}
