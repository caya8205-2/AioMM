import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { api } from '../lib/api';
import type { ModEntry } from '../types';
import { Icon, Icons } from './Icon';

export type FileManagerAction =
  | { type: 'new_folder'; parentPath: string; currentNavPath: string }
  | { type: 'rename'; targetPath: string; currentName: string; isDir: boolean }
  | { type: 'move'; sourcePath: string; sourceName: string; isDir: boolean }
  | { type: 'delete'; targetPath: string; targetName: string; isDir: boolean };

export interface FileManagerModalProps {
  root: string;
  mods: ModEntry[];
  action: FileManagerAction | null;
  onClose: () => void;
  onSuccess: (message: string) => Promise<void>;
}

export function FileManagerModal({
  root,
  mods,
  action,
  onClose,
  onSuccess,
}: FileManagerModalProps): JSX.Element | null {
  const [inputText, setInputText] = useState('');
  const [selectedDestFolder, setSelectedDestFolder] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setErrorMsg(null);
    if (!action) {
      setInputText('');
      setSelectedDestFolder('');
      return;
    }
    if (action.type === 'new_folder') {
      setInputText('New Folder');
    } else if (action.type === 'rename') {
      setInputText(action.currentName);
    } else if (action.type === 'move') {
      setSelectedDestFolder(root);
    }
  }, [action, root]);

  // Collect unique folder directories available inside current mod library for the Move dialog
  const availableFolders = useMemo(() => {
    if (!root || !action || action.type !== 'move') return [];
    const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const folderSet = new Set<string>();
    folderSet.add(normRoot);

    for (const m of mods) {
      const normModPath = m.path.replace(/\\/g, '/').replace(/\/+$/, '');
      if (normModPath.startsWith(normRoot + '/')) {
        const rel = normModPath.slice(normRoot.length + 1);
        const parts = rel.split('/');
        // Every directory up to the mod folder
        let accum = normRoot;
        for (let i = 0; i < parts.length - 1; i++) {
          accum += '/' + parts[i];
          folderSet.add(accum);
        }
      }
    }

    const list = Array.from(folderSet);
    list.sort((a, b) => a.localeCompare(b));

    // Exclude source folder and its descendants if moving a folder
    const normSource = action.sourcePath.replace(/\\/g, '/').replace(/\/+$/, '');
    return list.filter((f) => {
      if (action.isDir && (f === normSource || f.startsWith(normSource + '/'))) {
        return false;
      }
      return true;
    });
  }, [root, mods, action]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  if (!action) return null;
  const currentAction = action;

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (busy) return;
    setErrorMsg(null);

    if (currentAction.type === 'new_folder') {
      const name = inputText.trim();
      if (!name) {
        setErrorMsg('Folder name cannot be empty.');
        return;
      }
      setBusy(true);
      try {
        await api.createFolder(currentAction.parentPath, name);
        await onSuccess(`Created folder "${name}".`);
        onClose();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    } else if (currentAction.type === 'rename') {
      const name = inputText.trim();
      if (!name) {
        setErrorMsg('Name cannot be empty.');
        return;
      }
      if (name === currentAction.currentName) {
        onClose();
        return;
      }
      setBusy(true);
      try {
        await api.renameEntry(currentAction.targetPath, name);
        await onSuccess(`Renamed to "${name}".`);
        onClose();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    } else if (currentAction.type === 'move') {
      if (!selectedDestFolder) {
        setErrorMsg('Please select a destination folder.');
        return;
      }
      setBusy(true);
      try {
        await api.moveEntry(currentAction.sourcePath, selectedDestFolder);
        const destRel =
          selectedDestFolder === root.replace(/\\/g, '/')
            ? 'root Mods folder'
            : selectedDestFolder.split('/').pop() || selectedDestFolder;
        await onSuccess(`Moved "${currentAction.sourceName}" to ${destRel}.`);
        onClose();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    } else if (currentAction.type === 'delete') {
      setBusy(true);
      try {
        await api.deleteEntry(currentAction.targetPath);
        await onSuccess(`Deleted "${currentAction.targetName}".`);
        onClose();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }
  }

  function getDisplayFolderRel(folderPath: string): string {
    const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (folderPath === normRoot) {
      return 'Mods (Root)';
    }
    if (folderPath.startsWith(normRoot + '/')) {
      return folderPath.slice(normRoot.length + 1).replace(/\//g, ' / ');
    }
    return folderPath;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-xs sm:p-6"
    >
      <div className="flex w-full max-w-md flex-col rounded-xl border border-hairline-strong bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-surface-card text-ink-bright">
              {action.type === 'new_folder' ? (
                <Icon icon={Icons.folderAdd} size={15} />
              ) : action.type === 'rename' ? (
                <Icon icon={Icons.edit} size={15} />
              ) : action.type === 'move' ? (
                <Icon icon={Icons.folderMove} size={15} />
              ) : (
                <Icon icon={Icons.trash} size={15} className="text-status-red" />
              )}
            </span>
            <h3 className="text-[15px] font-semibold tracking-tight text-ink">
              {action.type === 'new_folder'
                ? 'Create New Folder'
                : action.type === 'rename'
                  ? `Rename ${action.isDir ? 'Folder' : 'Mod'}`
                  : action.type === 'move'
                    ? `Move ${action.isDir ? 'Folder' : 'Mod'}`
                    : `Delete ${action.isDir ? 'Folder' : 'Mod'}`}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-mute hover:bg-surface-elevated hover:text-ink-bright disabled:opacity-50"
          >
            <Icon icon={Icons.close} size={15} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          {errorMsg && (
            <div className="rounded-md border border-status-red/40 bg-status-red-soft px-3 py-2 text-xs text-status-red">
              {errorMsg}
            </div>
          )}

          {action.type === 'new_folder' && (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-ink-mute">
                Location:{' '}
                <span className="font-mono text-ink-bright">
                  {action.currentNavPath ? action.currentNavPath : 'Root (Mods)'}
                </span>
              </label>
              <input
                type="text"
                autoFocus
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Folder name"
                className="h-9 w-full rounded-md border border-hairline bg-surface-card px-3 text-sm text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong focus:outline-none"
              />
            </div>
          )}

          {action.type === 'rename' && (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-ink-mute">
                Current Name:{' '}
                <span className="font-semibold text-ink">{action.currentName}</span>
              </label>
              <input
                type="text"
                autoFocus
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="New name"
                className="h-9 w-full rounded-md border border-hairline bg-surface-card px-3 text-sm text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong focus:outline-none"
              />
            </div>
          )}

          {action.type === 'move' && (
            <div className="flex flex-col gap-2.5">
              <p className="text-xs text-ink-mute">
                Select target destination for{' '}
                <strong className="text-ink">{action.sourceName}</strong>:
              </p>
              <div className="max-h-56 overflow-y-auto rounded-md border border-hairline bg-canvas p-1 space-y-0.5">
                {availableFolders.map((folderPath) => {
                  const isSelected = selectedDestFolder === folderPath;
                  const label = getDisplayFolderRel(folderPath);
                  return (
                    <button
                      key={folderPath}
                      type="button"
                      onClick={() => setSelectedDestFolder(folderPath)}
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                        isSelected
                          ? 'bg-surface-elevated text-ink-bright font-medium'
                          : 'text-ink-body hover:bg-surface-elevated/60 hover:text-ink-bright',
                      )}
                    >
                      <Icon
                        icon={Icons.folder}
                        size={14}
                        className={clsx(
                          'shrink-0',
                          isSelected ? 'text-ink-bright' : 'text-ink-mute',
                        )}
                      />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {action.type === 'delete' && (
            <div className="flex flex-col gap-2 leading-relaxed text-xs text-ink-body">
              <p>
                Are you sure you want to permanently delete{' '}
                <strong className="font-semibold text-ink">
                  {action.targetName}
                </strong>
                ?
              </p>
              <p className="rounded-md border border-status-red/30 bg-status-red-soft/40 p-2.5 text-status-red">
                This action is permanent and will completely remove all contents from disk.
              </p>
            </div>
          )}

          {/* Footer buttons */}
          <div className="mt-2 flex items-center justify-end gap-2.5 border-t border-hairline pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex min-h-[32px] items-center justify-center rounded-md border border-hairline bg-surface-elevated px-3 text-[13px] font-medium text-ink-body transition-colors hover:border-hairline-strong hover:text-ink-bright disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={busy}
              className={clsx(
                'inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium transition-colors disabled:opacity-50',
                action.type === 'delete'
                  ? 'border border-status-red/40 bg-status-red-soft text-status-red hover:bg-status-red/20'
                  : 'border border-hairline-strong bg-white text-black hover:bg-[#e8e8e8]',
              )}
            >
              {action.type === 'new_folder' && <span>{busy ? 'Creating...' : 'Create Folder'}</span>}
              {action.type === 'rename' && <span>{busy ? 'Renaming...' : 'Rename'}</span>}
              {action.type === 'move' && <span>{busy ? 'Moving...' : 'Move Here'}</span>}
              {action.type === 'delete' && <span>{busy ? 'Deleting...' : 'Delete Permanently'}</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
