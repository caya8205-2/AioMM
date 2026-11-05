import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { api } from '../lib/api';
import type { OrganizeScanDto } from '../types';
import { Icon, Icons } from './Icon';

export interface AutoOrganizeModalProps {
  root: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => Promise<void>;
}

type ActiveFilter = 'unorganized' | 'high' | 'unknown' | 'already' | 'all';

export function AutoOrganizeModal({
  root,
  isOpen,
  onClose,
  onSuccess,
}: AutoOrganizeModalProps): JSX.Element | null {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanResult, setScanResult] = useState<OrganizeScanDto | null>(null);
  const [selectedModIds, setSelectedModIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveFilter>('unorganized');

  useEffect(() => {
    if (!isOpen) {
      setScanResult(null);
      setSelectedModIds(new Set());
      setSearchQuery('');
      setActiveTab('unorganized');
      return;
    }
    void handleScan();
  }, [isOpen, root]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  async function handleScan() {
    if (!root) return;
    setLoading(true);
    try {
      const res = await api.scanOrganizeMods(root);
      setScanResult(res);

      // Default select all unorganized proposals that have high confidence (>= 60%)
      const initialSelected = new Set<string>();
      for (const p of res.proposals) {
        if (!p.isAlreadyOrganized && p.confidence >= 60) {
          initialSelected.add(p.modId);
        }
      }
      setSelectedModIds(initialSelected);

      if (res.unorganizedCount === 0) {
        setActiveTab('already');
      } else {
        setActiveTab('unorganized');
      }
    } catch (err) {
      console.error('Failed to scan for mod organization:', err);
    } finally {
      setLoading(false);
    }
  }

  // Filter stats count
  const counts = useMemo(() => {
    if (!scanResult) return { unorganized: 0, high: 0, unknown: 0, already: 0, all: 0 };
    let unorganized = 0;
    let high = 0;
    let unknown = 0;
    let already = 0;

    for (const p of scanResult.proposals) {
      if (p.isAlreadyOrganized) {
        already++;
      } else {
        unorganized++;
        if (p.confidence >= 60) {
          high++;
        } else {
          unknown++;
        }
      }
    }

    return {
      unorganized,
      high,
      unknown,
      already,
      all: scanResult.proposals.length,
    };
  }, [scanResult]);

  const filteredProposals = useMemo(() => {
    if (!scanResult) return [];
    const q = searchQuery.trim().toLowerCase();

    return scanResult.proposals.filter((p) => {
      if (activeTab === 'unorganized' && p.isAlreadyOrganized) return false;
      if (activeTab === 'high' && (p.isAlreadyOrganized || p.confidence < 60)) return false;
      if (activeTab === 'unknown' && (p.isAlreadyOrganized || p.confidence >= 60)) return false;
      if (activeTab === 'already' && !p.isAlreadyOrganized) return false;

      if (!q) return true;
      return (
        p.modName.toLowerCase().includes(q) ||
        p.currentRelPath.toLowerCase().includes(q) ||
        p.targetFolderRel.toLowerCase().includes(q) ||
        (p.characterName && p.characterName.toLowerCase().includes(q)) ||
        p.matchReason.toLowerCase().includes(q)
      );
    });
  }, [scanResult, searchQuery, activeTab]);

  const actionableFilteredProposals = useMemo(() => {
    return filteredProposals.filter((p) => !p.isAlreadyOrganized);
  }, [filteredProposals]);

  function toggleSelectAll() {
    if (actionableFilteredProposals.length === 0) return;
    const allFilteredIds = new Set(actionableFilteredProposals.map((p) => p.modId));
    const allSelected = actionableFilteredProposals.every((p) => selectedModIds.has(p.modId));

    setSelectedModIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of allFilteredIds) next.delete(id);
      } else {
        for (const id of allFilteredIds) next.add(id);
      }
      return next;
    });
  }

  function toggleItemSelect(modId: string) {
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  }

  async function handleApplyOrganize() {
    if (!scanResult || selectedModIds.size === 0 || busy) return;

    const toMove = scanResult.proposals
      .filter((p) => !p.isAlreadyOrganized && selectedModIds.has(p.modId))
      .map((p) => ({
        sourcePath: p.currentPath,
        targetDir: p.targetDirAbs,
      }));

    if (toMove.length === 0) return;

    setBusy(true);
    try {
      const res = await api.applyOrganizeMods(toMove);
      if (res.errors.length > 0 && res.movedCount === 0) {
        alert(`Failed to organize mods:\n${res.errors.slice(0, 3).join('\n')}`);
      } else {
        await onSuccess(
          `Successfully organized ${res.movedCount} mod ${
            res.movedCount === 1 ? 'folder' : 'folders'
          }!`,
        );
        onClose();
      }
    } catch (err) {
      alert(`Error organizing mods: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  const isAllActionableSelected =
    actionableFilteredProposals.length > 0 &&
    actionableFilteredProposals.every((p) => selectedModIds.has(p.modId));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="organize-title"
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
              <Icon icon={Icons.magic} size={16} />
            </span>
            <div>
              <h2
                id="organize-title"
                className="text-[15px] font-semibold tracking-tight text-ink"
              >
                Auto-Organize Mod Library
              </h2>
              <p className="max-w-md truncate font-mono text-[11px] text-ink-mute">
                {root}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void handleScan()}
              className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright transition-colors hover:border-hairline-strong disabled:opacity-50"
              title="Rescan unorganized mods"
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

        {/* Interactive Clickable Filter Tabs Bar */}
        {scanResult && !loading && (
          <div className="grid shrink-0 grid-cols-2 gap-1.5 border-b border-hairline bg-surface-elevated/40 p-2.5 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => setActiveTab('unorganized')}
              className={clsx(
                'flex flex-col rounded-lg p-2.5 text-left transition-all cursor-pointer',
                activeTab === 'unorganized'
                  ? 'border border-hairline-strong bg-surface shadow-xs'
                  : 'hover:bg-surface-elevated/80 border border-transparent',
              )}
            >
              <span className="text-[11px] font-medium text-ink-mute">
                Needs Organization
              </span>
              <span
                className={clsx(
                  'text-[15px] font-semibold tabular-nums mt-0.5',
                  counts.unorganized > 0 ? 'text-status-yellow' : 'text-status-green',
                )}
              >
                {counts.unorganized} {counts.unorganized === 1 ? 'mod' : 'mods'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('high')}
              className={clsx(
                'flex flex-col rounded-lg p-2.5 text-left transition-all cursor-pointer',
                activeTab === 'high'
                  ? 'border border-hairline-strong bg-surface shadow-xs'
                  : 'hover:bg-surface-elevated/80 border border-transparent',
              )}
            >
              <span className="text-[11px] font-medium text-ink-mute">
                Identified (High Match)
              </span>
              <span className="text-[15px] font-semibold text-ink-bright tabular-nums mt-0.5">
                {counts.high} {counts.high === 1 ? 'mod' : 'mods'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('unknown')}
              className={clsx(
                'flex flex-col rounded-lg p-2.5 text-left transition-all cursor-pointer',
                activeTab === 'unknown'
                  ? 'border border-hairline-strong bg-surface shadow-xs'
                  : 'hover:bg-surface-elevated/80 border border-transparent',
              )}
            >
              <span className="text-[11px] font-medium text-ink-mute">
                Unknown (Manual Review)
              </span>
              <span
                className={clsx(
                  'text-[15px] font-semibold tabular-nums mt-0.5',
                  counts.unknown > 0 ? 'text-amber-400' : 'text-ink-mute',
                )}
              >
                {counts.unknown} {counts.unknown === 1 ? 'mod' : 'mods'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('already')}
              className={clsx(
                'flex flex-col rounded-lg p-2.5 text-left transition-all cursor-pointer',
                activeTab === 'already'
                  ? 'border border-hairline-strong bg-surface shadow-xs'
                  : 'hover:bg-surface-elevated/80 border border-transparent',
              )}
            >
              <span className="text-[11px] font-medium text-ink-mute">
                Already Organized
              </span>
              <span className="text-[15px] font-semibold text-status-green tabular-nums mt-0.5">
                {counts.already} {counts.already === 1 ? 'mod' : 'mods'}
              </span>
            </button>
          </div>
        )}

        {/* Toolbar: Select All + Search */}
        {scanResult && !loading && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline bg-surface px-5 py-2.5">
            <div className="flex items-center gap-2">
              {actionableFilteredProposals.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-hairline bg-surface-elevated px-2.5 text-[12px] font-medium text-ink-bright hover:border-hairline-strong transition-colors cursor-pointer"
                >
                  <span>{isAllActionableSelected ? 'Deselect All' : 'Select All'}</span>
                </button>
              )}

              <span className="text-xs text-ink-mute">
                Showing{' '}
                <strong className="text-ink font-semibold">
                  {filteredProposals.length}
                </strong>{' '}
                {filteredProposals.length === 1 ? 'mod' : 'mods'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by mod name, character, or reason..."
                  className="h-8 w-56 rounded-md border border-hairline bg-surface-card px-2.5 text-[12px] text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong focus:outline-none sm:w-72"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 text-ink-mute hover:text-ink-bright"
                  >
                    <Icon icon={Icons.close} size={13} />
                  </button>
                )}
              </div>

              {counts.unorganized > 0 && (
                <span className="text-[12px] text-ink-mute">
                  Selected{' '}
                  <strong className="font-semibold text-ink">
                    {selectedModIds.size}
                  </strong>{' '}
                  of {counts.unorganized} unorganized
                </span>
              )}
            </div>
          </div>
        )}

        {/* Proposals List Body */}
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
                Scanning mods and extracting game signatures...
              </p>
              <p className="text-[12px] text-ink-mute">
                Analyzing .ini overrides, texture hashes, and character identifiers
              </p>
            </div>
          ) : filteredProposals.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-mute">
                <Icon icon={Icons.check} size={22} className="text-status-green" />
              </div>
              <h3 className="text-[15px] font-medium text-ink">
                {activeTab === 'unorganized'
                  ? 'No Unorganized Mods Found!'
                  : activeTab === 'high'
                    ? 'No High-Match Proposals'
                    : activeTab === 'unknown'
                      ? 'No Unknown Mods'
                      : 'No Mods in this Category'}
              </h3>
              <p className="max-w-md text-[13px] text-ink-mute">
                {searchQuery
                  ? `No mods matched your search query "${searchQuery}".`
                  : activeTab === 'unorganized'
                    ? 'All mods in your library are already properly categorized inside character and category folders.'
                    : 'Check another category tab above to see mod proposals.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredProposals.map((proposal) => {
                const isSelected = selectedModIds.has(proposal.modId);

                return (
                  <article
                    key={proposal.modId}
                    onClick={() => {
                      if (!proposal.isAlreadyOrganized) {
                        toggleItemSelect(proposal.modId);
                      }
                    }}
                    className={clsx(
                      'flex items-center justify-between gap-3 rounded-lg border p-3.5 transition-colors',
                      proposal.isAlreadyOrganized
                        ? 'border-hairline bg-surface-elevated/20 opacity-80'
                        : isSelected
                          ? 'cursor-pointer border-hairline-strong bg-surface-elevated/70'
                          : 'cursor-pointer border-hairline bg-surface hover:border-hairline-strong hover:bg-surface-elevated/40',
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3.5">
                      {proposal.isAlreadyOrganized ? (
                        <span
                          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-status-green-soft text-status-green border border-status-green/30"
                          title="Already in organized folder structure"
                        >
                          <Icon icon={Icons.check} size={11} />
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItemSelect(proposal.modId)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-hairline bg-surface-card text-white accent-white cursor-pointer"
                        />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold text-[14px] text-ink">
                            {proposal.modName}
                          </span>

                          <span
                            className={clsx(
                              'rounded-xs px-1.5 py-0.2 font-mono text-[10px] font-semibold uppercase',
                              proposal.isAlreadyOrganized
                                ? 'border border-status-green/30 bg-status-green-soft text-status-green'
                                : proposal.confidence >= 90
                                  ? 'border border-status-green/30 bg-status-green-soft text-status-green'
                                  : proposal.confidence >= 60
                                    ? 'border border-hairline bg-surface-card text-ink-bright'
                                    : 'border border-status-yellow/30 bg-status-yellow-soft text-status-yellow',
                            )}
                          >
                            {proposal.isAlreadyOrganized
                              ? 'Organized'
                              : `${proposal.confidence}% match`}
                          </span>

                          <span className="font-mono text-[11px] text-ink-mute truncate max-w-sm">
                            from{' '}
                            <code className="text-ink-body">
                              {proposal.currentRelPath.startsWith('./')
                                ? proposal.currentRelPath
                                : !proposal.currentRelPath.includes('/') && !proposal.currentRelPath.includes('\\')
                                  ? `./${proposal.currentRelPath}`
                                  : proposal.currentRelPath}
                            </code>
                          </span>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-ink-mute">
                            {proposal.isAlreadyOrganized
                              ? 'Current location:'
                              : 'Target folder:'}
                          </span>
                          <span className="font-mono font-semibold text-ink-bright">
                            {proposal.suggestedFullRel}
                          </span>
                          <span className="text-hairline-strong">·</span>
                          <span className="text-ink-mute italic">
                            {proposal.matchReason}
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline bg-surface px-5 py-3">
          <div className="font-mono text-[11px] text-ink-mute">
            {selectedModIds.size > 0 ? (
              <span>
                Selected{' '}
                <strong className="text-ink">
                  {selectedModIds.size}{' '}
                  {selectedModIds.size === 1 ? 'mod' : 'mods'}
                </strong>{' '}
                to move into organized folders
              </span>
            ) : (
              <span>No proposals selected</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex min-h-[34px] items-center justify-center rounded-md border border-hairline bg-surface-elevated px-4 text-[13px] font-medium text-ink-body transition-colors hover:border-hairline-strong hover:text-ink-bright disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={selectedModIds.size === 0 || busy}
              onClick={() => void handleApplyOrganize()}
              className="inline-flex min-h-[34px] items-center gap-2 rounded-md border border-hairline-strong bg-white px-4 text-[13px] font-medium text-black transition-colors hover:bg-[#e8e8e8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon icon={Icons.magic} size={14} />
              <span>
                {busy
                  ? 'Moving Mods...'
                  : `Organize Selected (${selectedModIds.size})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
