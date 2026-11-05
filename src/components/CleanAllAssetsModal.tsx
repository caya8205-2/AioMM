import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { api, formatBytes } from '../lib/api';
import type { AllModsCleanScanDto, UnusedAssetInfo } from '../types';
import { Icon, Icons } from './Icon';

export interface CleanAllAssetsModalProps {
  root: string;
  isOpen: boolean;
  onClose: () => void;
  onNotify: (message: string) => void;
  onRefresh: () => Promise<void>;
}

interface QuarantinedModGroup {
  modName: string;
  files: UnusedAssetInfo[];
  totalBytes: number;
}

export function CleanAllAssetsModal({
  root,
  isOpen,
  onClose,
  onNotify,
  onRefresh,
}: CleanAllAssetsModalProps): JSX.Element | null {
  const [activeTab, setActiveTab] = useState<'scan' | 'quarantine'>('scan');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanResult, setScanResult] = useState<AllModsCleanScanDto | null>(null);

  // Scan tab state
  const [selectedScanPaths, setSelectedScanPaths] = useState<Set<string>>(new Set());
  const [expandedScanMods, setExpandedScanMods] = useState<Set<string>>(new Set());
  const [scanSearchQuery, setScanSearchQuery] = useState('');
  const [safeStagingMode, setSafeStagingMode] = useState(true);

  // Quarantine tab state
  const [quarantinedFiles, setQuarantinedFiles] = useState<UnusedAssetInfo[]>([]);
  const [selectedQuarantinePaths, setSelectedQuarantinePaths] = useState<Set<string>>(new Set());
  const [expandedQuarantineMods, setExpandedQuarantineMods] = useState<Set<string>>(new Set());
  const [quarantineSearchQuery, setQuarantineSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setScanResult(null);
      setSelectedScanPaths(new Set());
      setExpandedScanMods(new Set());
      setScanSearchQuery('');
      setQuarantinedFiles([]);
      setSelectedQuarantinePaths(new Set());
      setExpandedQuarantineMods(new Set());
      setQuarantineSearchQuery('');
      setActiveTab('scan');
      return;
    }
    void handleScan();
  }, [isOpen, root]);

  async function handleScan() {
    if (!root) return;
    setLoading(true);
    try {
      const [res, qFiles] = await Promise.all([
        api.scanAllUnusedAssets(root),
        api.scanQuarantinedAssets(root),
      ]);
      setScanResult(res);
      setQuarantinedFiles(qFiles);

      // Default all scan paths to selected and expanded
      const allScanPaths = new Set<string>();
      const allScanModPaths = new Set<string>();
      for (const m of res.modsWithUnused) {
        allScanModPaths.add(m.modPath);
        for (const u of m.unusedAssets) {
          allScanPaths.add(u.absPath);
        }
      }
      setSelectedScanPaths(allScanPaths);
      setExpandedScanMods(allScanModPaths);

      // Default all quarantine paths to selected and expanded
      const allQPaths = new Set<string>();
      const allQModNames = new Set<string>();
      for (const f of qFiles) {
        allQPaths.add(f.absPath);
        const modName = extractModNameFromRel(f.relPath);
        allQModNames.add(modName);
      }
      setSelectedQuarantinePaths(allQPaths);
      setExpandedQuarantineMods(allQModNames);

      // If there are quarantined files and no regular unused assets, open quarantine tab
      if (qFiles.length > 0 && res.modsWithUnused.length === 0) {
        setActiveTab('quarantine');
      }
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Failed to scan mods for unused assets.',
      );
    } finally {
      setLoading(false);
    }
  }

  function extractModNameFromRel(relPath: string): string {
    const clean = relPath.replace(/\\/g, '/');
    const parts = clean.split('/');
    return parts[0] || 'Mod';
  }

  // --- Scan Tab Logic ---
  function toggleScanModExpand(modPath: string) {
    setExpandedScanMods((prev) => {
      const next = new Set(prev);
      if (next.has(modPath)) next.delete(modPath);
      else next.add(modPath);
      return next;
    });
  }

  function toggleScanSelectAll() {
    if (!scanResult) return;
    const allPaths = new Set<string>();
    for (const m of scanResult.modsWithUnused) {
      for (const u of m.unusedAssets) {
        allPaths.add(u.absPath);
      }
    }
    if (selectedScanPaths.size === allPaths.size) {
      setSelectedScanPaths(new Set());
    } else {
      setSelectedScanPaths(allPaths);
    }
  }

  function toggleScanSelectMod(modPath: string) {
    if (!scanResult) return;
    const mod = scanResult.modsWithUnused.find((m) => m.modPath === modPath);
    if (!mod) return;

    const modFilePaths = mod.unusedAssets.map((u) => u.absPath);
    const allSelected = modFilePaths.every((p) => selectedScanPaths.has(p));

    setSelectedScanPaths((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const p of modFilePaths) next.delete(p);
      } else {
        for (const p of modFilePaths) next.add(p);
      }
      return next;
    });
  }

  function toggleScanSelectFile(absPath: string) {
    setSelectedScanPaths((prev) => {
      const next = new Set(prev);
      if (next.has(absPath)) next.delete(absPath);
      else next.add(absPath);
      return next;
    });
  }

  const selectedScanStats = useMemo(() => {
    if (!scanResult) return { count: 0, bytes: 0 };
    let bytes = 0;
    for (const m of scanResult.modsWithUnused) {
      for (const u of m.unusedAssets) {
        if (selectedScanPaths.has(u.absPath)) {
          bytes += u.fileSizeBytes;
        }
      }
    }
    return { count: selectedScanPaths.size, bytes };
  }, [scanResult, selectedScanPaths]);

  const filteredScanMods = useMemo(() => {
    if (!scanResult) return [];
    const q = scanSearchQuery.trim().toLowerCase();
    if (!q) return scanResult.modsWithUnused;
    return scanResult.modsWithUnused
      .map((m) => {
        const modMatches = m.modName.toLowerCase().includes(q);
        const matchingAssets = m.unusedAssets.filter(
          (u) =>
            u.relPath.toLowerCase().includes(q) ||
            u.extension.toLowerCase().includes(q),
        );
        if (modMatches) return m;
        if (matchingAssets.length > 0) {
          return {
            ...m,
            unusedAssets: matchingAssets,
          };
        }
        return null;
      })
      .filter((m): m is typeof scanResult.modsWithUnused[0] => m !== null);
  }, [scanResult, scanSearchQuery]);

  // --- Quarantine Tab Logic ---
  const quarantinedModGroups = useMemo<QuarantinedModGroup[]>(() => {
    const map = new Map<string, UnusedAssetInfo[]>();
    for (const f of quarantinedFiles) {
      const modName = extractModNameFromRel(f.relPath);
      const list = map.get(modName) ?? [];
      list.push(f);
      map.set(modName, list);
    }
    const groups: QuarantinedModGroup[] = [];
    for (const [modName, files] of map.entries()) {
      const totalBytes = files.reduce((acc, f) => acc + f.fileSizeBytes, 0);
      groups.push({ modName, files, totalBytes });
    }
    groups.sort((a, b) => a.modName.localeCompare(b.modName));
    return groups;
  }, [quarantinedFiles]);

  const filteredQuarantinedGroups = useMemo(() => {
    const q = quarantineSearchQuery.trim().toLowerCase();
    if (!q) return quarantinedModGroups;
    return quarantinedModGroups
      .map((g) => {
        const matchName = g.modName.toLowerCase().includes(q);
        const matchFiles = g.files.filter(
          (f) =>
            f.relPath.toLowerCase().includes(q) ||
            f.extension.toLowerCase().includes(q),
        );
        if (matchName) return g;
        if (matchFiles.length > 0) {
          return {
            ...g,
            files: matchFiles,
            totalBytes: matchFiles.reduce((acc, f) => acc + f.fileSizeBytes, 0),
          };
        }
        return null;
      })
      .filter((g): g is QuarantinedModGroup => g !== null);
  }, [quarantinedModGroups, quarantineSearchQuery]);

  function toggleQuarantineModExpand(modName: string) {
    setExpandedQuarantineMods((prev) => {
      const next = new Set(prev);
      if (next.has(modName)) next.delete(modName);
      else next.add(modName);
      return next;
    });
  }

  function toggleQuarantineSelectAll() {
    const allPaths = new Set(quarantinedFiles.map((f) => f.absPath));
    if (selectedQuarantinePaths.size === allPaths.size) {
      setSelectedQuarantinePaths(new Set());
    } else {
      setSelectedQuarantinePaths(allPaths);
    }
  }

  function toggleQuarantineSelectMod(group: QuarantinedModGroup) {
    const groupFilePaths = group.files.map((f) => f.absPath);
    const allSelected = groupFilePaths.every((p) => selectedQuarantinePaths.has(p));

    setSelectedQuarantinePaths((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const p of groupFilePaths) next.delete(p);
      } else {
        for (const p of groupFilePaths) next.add(p);
      }
      return next;
    });
  }

  function toggleQuarantineSelectFile(absPath: string) {
    setSelectedQuarantinePaths((prev) => {
      const next = new Set(prev);
      if (next.has(absPath)) next.delete(absPath);
      else next.add(absPath);
      return next;
    });
  }

  const selectedQuarantineStats = useMemo(() => {
    let bytes = 0;
    for (const f of quarantinedFiles) {
      if (selectedQuarantinePaths.has(f.absPath)) {
        bytes += f.fileSizeBytes;
      }
    }
    return { count: selectedQuarantinePaths.size, bytes };
  }, [quarantinedFiles, selectedQuarantinePaths]);

  // --- Actions ---
  async function handleExecuteScanAction() {
    if (selectedScanPaths.size === 0 || busy) return;
    const count = selectedScanPaths.size;
    const bytesFormatted = formatBytes(selectedScanStats.bytes);

    if (safeStagingMode) {
      setBusy(true);
      try {
        const toQuarantine = Array.from(selectedScanPaths);
        const quarantinedCount = await api.quarantineUnusedAssets(toQuarantine);
        onNotify(
          `Quarantined ${quarantinedCount} asset files. Test your mods in-game before permanent deletion.`,
        );
        await onRefresh();
        setActiveTab('quarantine');
        await handleScan();
      } catch (err) {
        onNotify(
          err instanceof Error
            ? err.message
            : 'Failed to quarantine asset files.',
        );
      } finally {
        setBusy(false);
      }
    } else {
      const confirmed = window.confirm(
        `Permanently delete ${count} unreferenced asset ${
          count === 1 ? 'file' : 'files'
        } (${bytesFormatted})?\n\nThis removes orphaned textures and models not called in any .ini file.`,
      );
      if (!confirmed) return;

      setBusy(true);
      try {
        const toDelete = Array.from(selectedScanPaths);
        const freed = await api.deleteUnusedAssets(toDelete);
        onNotify(`Cleaned ${count} unused files (${formatBytes(freed)} freed).`);
        await onRefresh();
        await handleScan();
      } catch (err) {
        onNotify(
          err instanceof Error
            ? err.message
            : 'Failed to delete selected unused assets.',
        );
      } finally {
        setBusy(false);
      }
    }
  }

  async function handleRestoreFiles(filePaths: string[]) {
    if (filePaths.length === 0 || busy) return;
    setBusy(true);
    try {
      const restored = await api.restoreQuarantinedAssetsBatch(filePaths);
      onNotify(
        `Restored ${restored} quarantined ${restored === 1 ? 'file' : 'files'} to original mod folders.`,
      );
      await onRefresh();
      await handleScan();
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Failed to restore quarantined files.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteQuarantinedFiles(filePaths: string[]) {
    if (filePaths.length === 0 || busy) return;
    const count = filePaths.length;
    const confirmed = window.confirm(
      `Permanently delete ${count} quarantined ${
        count === 1 ? 'file' : 'files'
      }?\n\nAll selected .aiomm_unused files will be purged from disk.`,
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const freed = await api.deleteUnusedAssets(filePaths);
      onNotify(
        `Permanently deleted ${count} quarantined files (${formatBytes(freed)} freed).`,
      );
      await onRefresh();
      await handleScan();
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Failed to purge quarantined files.',
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  if (!isOpen) return null;

  const totalScanPossiblePaths =
    scanResult?.modsWithUnused.reduce(
      (acc, m) => acc + m.unusedAssets.length,
      0,
    ) ?? 0;
  const isAllScanSelected =
    totalScanPossiblePaths > 0 && selectedScanPaths.size === totalScanPossiblePaths;

  const totalQuarantineCount = quarantinedFiles.length;
  const isAllQuarantineSelected =
    totalQuarantineCount > 0 && selectedQuarantinePaths.size === totalQuarantineCount;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clean-assets-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-xs sm:p-6"
    >
      <div className="flex h-full max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-hairline-strong bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-card text-ink-bright">
              <Icon icon={Icons.trash} size={16} />
            </span>
            <div>
              <h2
                id="clean-assets-title"
                className="text-[15px] font-semibold tracking-tight text-ink"
              >
                {activeTab === 'quarantine'
                  ? 'Quarantined Assets'
                  : 'Asset Cleaner & Quarantine'}
              </h2>
              <p className="max-w-md truncate font-mono text-[11px] text-ink-mute">
                {root}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Clean Segmented Tab Control */}
            <div className="flex items-center rounded-lg border border-hairline bg-surface-card p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab('scan')}
                className={clsx(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  activeTab === 'scan'
                    ? 'bg-surface-elevated text-ink-bright shadow-xs'
                    : 'text-ink-mute hover:text-ink-body',
                )}
              >
                Scan Unused
                {scanResult && scanResult.totalUnusedFiles > 0 && (
                  <span className="ml-1.5 rounded-xs border border-hairline bg-surface px-1 py-0.2 text-[10px] text-ink-mute">
                    {scanResult.totalUnusedFiles}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('quarantine')}
                className={clsx(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  activeTab === 'quarantine'
                    ? 'bg-surface-elevated text-ink-bright shadow-xs'
                    : 'text-ink-mute hover:text-ink-body',
                )}
              >
                Quarantined
                {quarantinedFiles.length > 0 && (
                  <span className="ml-1.5 rounded-xs border border-hairline-strong bg-surface-elevated px-1.5 py-0.2 text-[10px] font-semibold text-ink-bright tabular-nums">
                    {quarantinedFiles.length}
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void handleScan()}
              className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright transition-colors hover:border-hairline-strong disabled:opacity-50"
              title="Rescan mods folder"
            >
              <Icon
                icon={Icons.refresh}
                size={13}
                className={clsx('text-ink-mute', loading && 'animate-spin')}
              />
              <span>{loading ? 'Scanning...' : 'Rescan'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close dialog"
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-mute hover:bg-surface-elevated hover:text-ink-bright"
            >
              <Icon icon={Icons.close} size={15} />
            </button>
          </div>
        </div>

        {/* TAB 1: SCAN UNUSED ASSETS */}
        {activeTab === 'scan' && (
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
            {/* Overview Stats Bar */}
            {scanResult && !loading && (
              <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-hairline bg-surface-elevated/40 px-5 py-2.5 sm:grid-cols-4">
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-ink-mute">
                    Mods Scanned
                  </span>
                  <span className="text-[14px] font-semibold text-ink tabular-nums">
                    {scanResult.totalModsScanned}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-ink-mute">
                    Mods with Unused
                  </span>
                  <span
                    className={clsx(
                      'text-[14px] font-semibold tabular-nums',
                      scanResult.modsWithUnused.length > 0
                        ? 'text-status-red'
                        : 'text-status-green',
                    )}
                  >
                    {scanResult.modsWithUnused.length}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-ink-mute">
                    Orphan Files
                  </span>
                  <span className="text-[14px] font-semibold text-ink tabular-nums">
                    {scanResult.totalUnusedFiles}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-ink-mute">
                    Reclaimable
                  </span>
                  <span className="text-[14px] font-semibold text-ink-bright tabular-nums">
                    {formatBytes(scanResult.totalReclaimableBytes)}
                  </span>
                </div>
              </div>
            )}

            {/* Filter and Selection Header */}
            {scanResult && scanResult.modsWithUnused.length > 0 && !loading && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline bg-surface px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleScanSelectAll}
                    className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright hover:border-hairline-strong"
                  >
                    <span>{isAllScanSelected ? 'Deselect All' : 'Select All'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExpandedScanMods(new Set())}
                    className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright hover:border-hairline-strong"
                  >
                    <span>Collapse All</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedScanMods(
                        new Set(scanResult.modsWithUnused.map((m) => m.modPath)),
                      )
                    }
                    className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright hover:border-hairline-strong"
                  >
                    <span>Expand All</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      value={scanSearchQuery}
                      onChange={(e) => setScanSearchQuery(e.target.value)}
                      placeholder="Filter files or mod names..."
                      className="h-8 w-48 rounded-md border border-hairline bg-surface-card px-2.5 text-[12px] text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong focus:outline-none sm:w-60"
                    />
                    {scanSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setScanSearchQuery('')}
                        className="absolute right-2 text-ink-mute hover:text-ink-bright"
                      >
                        <Icon icon={Icons.close} size={13} />
                      </button>
                    )}
                  </div>

                  <span className="text-[12px] text-ink-mute">
                    Selected{' '}
                    <strong className="font-semibold text-ink">
                      {selectedScanStats.count}
                    </strong>{' '}
                    of {totalScanPossiblePaths} files ({formatBytes(selectedScanStats.bytes)})
                  </span>
                </div>
              </div>
            )}

            {/* List Body */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              {loading ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-body">
                    <Icon
                      icon={Icons.refresh}
                      size={20}
                      className="animate-spin text-ink-mute"
                    />
                  </div>
                  <p className="text-[14px] font-medium text-ink">
                    Scanning all mods for unreferenced assets...
                  </p>
                  <p className="text-[12px] text-ink-mute">
                    Checking .ini references against textures, buffers, and meshes
                  </p>
                </div>
              ) : !scanResult || scanResult.modsWithUnused.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-status-green/30 bg-status-green-soft text-status-green">
                    <Icon icon={Icons.check} size={22} />
                  </div>
                  <h3 className="text-[15px] font-medium text-ink">
                    All Clean! No Unused Assets Found
                  </h3>
                  <p className="max-w-md text-[13px] text-ink-mute">
                    All textures, models, and files across{' '}
                    {scanResult?.totalModsScanned ?? 0} scanned mods are properly
                    called by their .ini configurations.
                  </p>
                </div>
              ) : filteredScanMods.length === 0 ? (
                <div className="py-12 text-center text-sm text-ink-mute">
                  No unused files match &ldquo;{scanSearchQuery}&rdquo;.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredScanMods.map((mod) => {
                    const isExpanded = expandedScanMods.has(mod.modPath);
                    const modFiles = mod.unusedAssets;
                    const modSelectedCount = modFiles.filter((u) =>
                      selectedScanPaths.has(u.absPath),
                    ).length;
                    const isModAllSelected =
                      modFiles.length > 0 && modSelectedCount === modFiles.length;

                    return (
                      <div
                        key={mod.modPath}
                        className="overflow-hidden rounded-lg border border-hairline bg-surface-elevated/50 transition-colors"
                      >
                        {/* Mod Group Header */}
                        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => toggleScanModExpand(mod.modPath)}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-mute hover:bg-surface-card hover:text-ink-bright"
                              title={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              <Icon
                                icon={
                                  isExpanded ? Icons.chevronDown : Icons.chevronRight
                                }
                                size={14}
                              />
                            </button>

                            <input
                              type="checkbox"
                              checked={isModAllSelected}
                              onChange={() => toggleScanSelectMod(mod.modPath)}
                              className="h-4 w-4 rounded border-hairline bg-surface-card text-white accent-white"
                              title="Select all files in this mod"
                            />

                            <button
                              type="button"
                              onClick={() => toggleScanModExpand(mod.modPath)}
                              className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                            >
                              <span className="truncate text-[13px] font-semibold text-ink hover:underline">
                                {mod.modName}
                              </span>
                              <span className="font-mono text-[11px] text-ink-mute">
                                ({modFiles.length}{' '}
                                {modFiles.length === 1 ? 'file' : 'files'},{' '}
                                {formatBytes(mod.reclaimableBytes)})
                              </span>
                            </button>
                          </div>

                          <span className="shrink-0 rounded-xs border border-status-red/30 bg-status-red-soft px-2 py-0.5 text-[11px] font-medium text-status-red tabular-nums">
                            {modSelectedCount}/{modFiles.length} selected
                          </span>
                        </div>

                        {/* Files inside mod */}
                        {isExpanded && (
                          <div className="border-t border-hairline bg-canvas/60 px-3.5 py-2">
                            <div className="space-y-1">
                              {modFiles.map((asset) => {
                                const isChecked = selectedScanPaths.has(
                                  asset.absPath,
                                );
                                return (
                                  <label
                                    key={asset.absPath}
                                    className="flex cursor-pointer items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-[12px] transition-colors hover:bg-surface-elevated/80"
                                  >
                                    <div className="flex min-w-0 items-center gap-2.5">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() =>
                                          toggleScanSelectFile(asset.absPath)
                                        }
                                        className="h-3.5 w-3.5 rounded border-hairline bg-surface-card accent-white"
                                      />
                                      <span
                                        className="truncate font-mono text-[12px] text-ink-body"
                                        title={asset.absPath}
                                      >
                                        {asset.relPath}
                                      </span>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                      <span className="rounded-xs border border-hairline bg-surface-card px-1.5 py-0.5 font-mono text-[10px] text-ink-mute uppercase">
                                        {asset.extension}
                                      </span>
                                      <span className="font-mono text-[11px] text-ink-mute tabular-nums">
                                        {formatBytes(asset.fileSizeBytes)}
                                      </span>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Scan Tab Footer */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline bg-surface px-5 py-3">
              <div className="flex flex-col gap-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-body select-none">
                  <input
                    type="checkbox"
                    checked={safeStagingMode}
                    onChange={(e) => setSafeStagingMode(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-hairline bg-surface-card accent-white"
                  />
                  <span>
                    <strong>Quarantine before deletion</strong> (test mods in-game first, restorable if broken)
                  </span>
                </label>
                <div className="font-mono text-[11px] text-ink-mute">
                  {selectedScanStats.count > 0 ? (
                    <span>
                      Selected{' '}
                      <strong className="text-ink">
                        {selectedScanStats.count} {selectedScanStats.count === 1 ? 'file' : 'files'}
                      </strong>{' '}
                      ({formatBytes(selectedScanStats.bytes)})
                    </span>
                  ) : (
                    <span>No files selected</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="inline-flex min-h-[34px] items-center justify-center rounded-md border border-hairline bg-surface-elevated px-4 text-[13px] font-medium text-ink-body transition-colors hover:border-hairline-strong hover:text-ink-bright disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={selectedScanStats.count === 0 || busy}
                  onClick={() => void handleExecuteScanAction()}
                  className={clsx(
                    'inline-flex min-h-[34px] items-center gap-2 rounded-md border px-4 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    safeStagingMode
                      ? 'border-hairline-strong bg-white text-black hover:bg-[#e8e8e8]'
                      : 'border-status-red/40 bg-status-red-soft text-status-red hover:bg-status-red/20',
                  )}
                >
                  <Icon
                    icon={safeStagingMode ? Icons.folder : Icons.trash}
                    size={14}
                  />
                  <span>
                    {busy
                      ? 'Processing...'
                      : safeStagingMode
                        ? `Quarantine Files (${selectedScanStats.count})`
                        : `Delete Permanently (${selectedScanStats.count})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: QUARANTINE MANAGER */}
        {activeTab === 'quarantine' && (
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
            {/* Guidance Banner - Raycast Dark Theme compliant */}
            <div className="shrink-0 border-b border-hairline bg-surface-card/60 px-5 py-3">
              <div className="flex items-start gap-2.5">
                <Icon
                  icon={Icons.info}
                  size={15}
                  className="text-ink-mute shrink-0 mt-0.5"
                />
                <div className="space-y-0.5 leading-relaxed text-xs">
                  <span className="font-semibold text-ink">
                    Test Your Mods In-Game Before Deleting
                  </span>
                  <p className="text-ink-mute">
                    Quarantined files are renamed to{' '}
                    <code className="font-mono text-ink-bright">
                      .aiomm_unused
                    </code>{' '}
                    so the game ignores them. If any texture turns black or mesh
                    breaks, restore individual files or the whole mod below. Once
                    verified safe, delete permanently.
                  </p>
                </div>
              </div>
            </div>

            {/* Filter and Selection Toolbar */}
            {quarantinedFiles.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline bg-surface px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleQuarantineSelectAll}
                    className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright hover:border-hairline-strong"
                  >
                    <span>
                      {isAllQuarantineSelected ? 'Deselect All' : 'Select All'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExpandedQuarantineMods(new Set())}
                    className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright hover:border-hairline-strong"
                  >
                    <span>Collapse All</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedQuarantineMods(
                        new Set(quarantinedModGroups.map((g) => g.modName)),
                      )
                    }
                    className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright hover:border-hairline-strong"
                  >
                    <span>Expand All</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      value={quarantineSearchQuery}
                      onChange={(e) => setQuarantineSearchQuery(e.target.value)}
                      placeholder="Filter quarantined files or mods..."
                      className="h-8 w-48 rounded-md border border-hairline bg-surface-card px-2.5 text-[12px] text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong focus:outline-none sm:w-60"
                    />
                    {quarantineSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setQuarantineSearchQuery('')}
                        className="absolute right-2 text-ink-mute hover:text-ink-bright"
                      >
                        <Icon icon={Icons.close} size={13} />
                      </button>
                    )}
                  </div>

                  <span className="text-[12px] text-ink-mute">
                    Selected{' '}
                    <strong className="font-semibold text-ink">
                      {selectedQuarantineStats.count}
                    </strong>{' '}
                    of {totalQuarantineCount} files ({formatBytes(selectedQuarantineStats.bytes)})
                  </span>
                </div>
              </div>
            )}

            {/* List Body with Dropdown Cards per Mod */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              {quarantinedFiles.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-mute">
                    <Icon icon={Icons.folder} size={22} />
                  </div>
                  <h3 className="text-[15px] font-medium text-ink">
                    No Quarantined Assets
                  </h3>
                  <p className="max-w-md text-[13px] text-ink-mute">
                    There are no files currently quarantined. Run a scan from the
                    &ldquo;Scan Unused&rdquo; tab and quarantine files to stage
                    them here.
                  </p>
                </div>
              ) : filteredQuarantinedGroups.length === 0 ? (
                <div className="py-12 text-center text-sm text-ink-mute">
                  No quarantined files match &ldquo;{quarantineSearchQuery}&rdquo;.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredQuarantinedGroups.map((group) => {
                    const isExpanded = expandedQuarantineMods.has(group.modName);
                    const groupSelectedCount = group.files.filter((f) =>
                      selectedQuarantinePaths.has(f.absPath),
                    ).length;
                    const isGroupAllSelected =
                      group.files.length > 0 &&
                      groupSelectedCount === group.files.length;

                    return (
                      <div
                        key={group.modName}
                        className="overflow-hidden rounded-lg border border-hairline bg-surface-elevated/50 transition-colors"
                      >
                        {/* Mod Group Header */}
                        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => toggleQuarantineModExpand(group.modName)}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-mute hover:bg-surface-card hover:text-ink-bright"
                              title={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              <Icon
                                icon={
                                  isExpanded ? Icons.chevronDown : Icons.chevronRight
                                }
                                size={14}
                              />
                            </button>

                            <input
                              type="checkbox"
                              checked={isGroupAllSelected}
                              onChange={() => toggleQuarantineSelectMod(group)}
                              className="h-4 w-4 rounded border-hairline bg-surface-card text-white accent-white"
                              title="Select all files in this mod"
                            />

                            <button
                              type="button"
                              onClick={() => toggleQuarantineModExpand(group.modName)}
                              className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                            >
                              <span className="truncate text-[13px] font-semibold text-ink hover:underline">
                                {group.modName}
                              </span>
                              <span className="font-mono text-[11px] text-ink-mute">
                                ({group.files.length}{' '}
                                {group.files.length === 1 ? 'file' : 'files'},{' '}
                                {formatBytes(group.totalBytes)})
                              </span>
                            </button>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void handleRestoreFiles(
                                  group.files.map((f) => f.absPath),
                                )
                              }
                              className="inline-flex min-h-[26px] items-center gap-1 rounded-md border border-hairline bg-surface-elevated px-2 text-[11px] font-medium text-ink-body hover:border-hairline-strong hover:text-ink-bright disabled:opacity-50"
                              title="Restore all quarantined files in this mod"
                            >
                              <Icon icon={Icons.undo} size={12} />
                              <span>Restore Mod</span>
                            </button>

                            <span className="rounded-xs border border-hairline bg-surface-card px-2 py-0.5 text-[11px] font-medium text-ink-mute tabular-nums">
                              {groupSelectedCount}/{group.files.length} selected
                            </span>
                          </div>
                        </div>

                        {/* Files inside mod */}
                        {isExpanded && (
                          <div className="border-t border-hairline bg-canvas/60 px-3.5 py-2">
                            <div className="space-y-1">
                              {group.files.map((file) => {
                                const isChecked = selectedQuarantinePaths.has(
                                  file.absPath,
                                );
                                return (
                                  <div
                                    key={file.absPath}
                                    className="flex items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-[12px] transition-colors hover:bg-surface-elevated/80"
                                  >
                                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() =>
                                          toggleQuarantineSelectFile(file.absPath)
                                        }
                                        className="h-3.5 w-3.5 rounded border-hairline bg-surface-card accent-white"
                                      />
                                      <span
                                        className="truncate font-mono text-[12px] text-ink-body"
                                        title={file.absPath}
                                      >
                                        {file.relPath}
                                      </span>
                                    </label>

                                    <div className="flex shrink-0 items-center gap-2">
                                      <span className="rounded-xs border border-hairline bg-surface-card px-1.5 py-0.5 font-mono text-[10px] text-ink-mute uppercase">
                                        {file.extension}
                                      </span>
                                      <span className="font-mono text-[11px] text-ink-mute tabular-nums">
                                        {formatBytes(file.fileSizeBytes)}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                          void handleRestoreFiles([file.absPath])
                                        }
                                        className="p-1 text-ink-mute hover:text-ink-bright transition-colors"
                                        title="Restore this file"
                                      >
                                        <Icon icon={Icons.undo} size={13} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quarantine Tab Footer */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline bg-surface px-5 py-3">
              <div className="font-mono text-[11px] text-ink-mute">
                {selectedQuarantineStats.count > 0 ? (
                  <span>
                    Selected{' '}
                    <strong className="text-ink">
                      {selectedQuarantineStats.count}{' '}
                      {selectedQuarantineStats.count === 1 ? 'file' : 'files'}
                    </strong>{' '}
                    ({formatBytes(selectedQuarantineStats.bytes)})
                  </span>
                ) : (
                  <span>No files selected</span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('scan')}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-3 text-[13px] font-medium text-ink-body transition-colors hover:border-hairline-strong hover:text-ink-bright"
                  title="Return to Unused Assets scan"
                >
                  <Icon icon={Icons.arrowLeft} size={13} className="text-ink-mute" />
                  <span>Back to Scan</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="inline-flex min-h-[34px] items-center justify-center rounded-md border border-hairline bg-surface-elevated px-4 text-[13px] font-medium text-ink-body transition-colors hover:border-hairline-strong hover:text-ink-bright disabled:opacity-50"
                >
                  Close
                </button>

                <button
                  type="button"
                  disabled={selectedQuarantineStats.count === 0 || busy}
                  onClick={() =>
                    void handleRestoreFiles(Array.from(selectedQuarantinePaths))
                  }
                  className="inline-flex min-h-[34px] items-center gap-2 rounded-md border border-hairline bg-surface-elevated px-4 text-[13px] font-medium text-ink-bright hover:border-hairline-strong disabled:opacity-50"
                  title="Restore selected files back to their original names"
                >
                  <Icon icon={Icons.undo} size={14} />
                  <span>
                    {busy
                      ? 'Restoring...'
                      : `Restore Selected (${selectedQuarantineStats.count})`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={selectedQuarantineStats.count === 0 || busy}
                  onClick={() =>
                    void handleDeleteQuarantinedFiles(
                      Array.from(selectedQuarantinePaths),
                    )
                  }
                  className="inline-flex min-h-[34px] items-center gap-2 rounded-md border border-status-red/40 bg-status-red-soft px-4 text-[13px] font-medium text-status-red hover:bg-status-red/20 disabled:opacity-50"
                  title="Permanently remove selected quarantined files from disk"
                >
                  <Icon icon={Icons.trash} size={14} />
                  <span>
                    {busy
                      ? 'Deleting...'
                      : `Delete Selected (${selectedQuarantineStats.count})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
