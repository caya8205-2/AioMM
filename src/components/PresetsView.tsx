import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { AnchorInsert, Preset } from '../types';
import { api } from '../lib/api';
import { Icon, Icons } from './Icon';

export interface PresetsViewProps {
  root: string | null;
  presets: Preset[];
  onPickFolder: () => void;
  onSavePreset: (preset: Preset) => Promise<void>;
  onDeletePreset: (presetId: string) => Promise<void>;
}

type ComponentFilterChoice = '3plus' | '0plus' | 'any';

const DEFAULT_AFTER_ANCHOR = 'run = CommandListOverrideSharedResources';
const DEFAULT_BEFORE_ANCHOR = 'run = CommandListCleanupSharedResources';

const FALLBACK_BUILTIN_PRESETS: Preset[] = [
  {
    id: 'oilskin-3plus',
    name: 'KatFXMatcap OilSkin (Body Parts 3+)',
    description:
      'Recommended first pass: applies OilSkin and Clear to Component 3 and higher.',
    group: 'KatFXMatcap OilSkin',
    sourceUrl: 'https://gamebanana.com/mods/733773',
    recommended: true,
    sectionPrefix: 'TextureOverride',
    minComponent: 3,
    insertAfter: [
      {
        anchor: DEFAULT_AFTER_ANCHOR,
        inject: 'run = CommandList\\KatFXMatcap\\OilSkin',
      },
    ],
    insertBefore: [
      {
        anchor: DEFAULT_BEFORE_ANCHOR,
        inject: 'run = CommandList\\KatFXMatcap\\Clear',
      },
    ],
    builtin: true,
  },
  {
    id: 'oilskin-all',
    name: 'KatFXMatcap OilSkin (All Parts 0+)',
    description:
      'Fallback pass when meshes live in Component 0 to 2. Skips already patched parts.',
    group: 'KatFXMatcap OilSkin',
    sourceUrl: 'https://gamebanana.com/mods/733773',
    recommended: false,
    sectionPrefix: 'TextureOverride',
    minComponent: 0,
    insertAfter: [
      {
        anchor: DEFAULT_AFTER_ANCHOR,
        inject: 'run = CommandList\\KatFXMatcap\\OilSkin',
      },
    ],
    insertBefore: [
      {
        anchor: DEFAULT_BEFORE_ANCHOR,
        inject: 'run = CommandList\\KatFXMatcap\\Clear',
      },
    ],
    builtin: true,
  },
];

function formatTargetRule(preset: Preset): string {
  const prefixLabel = preset.sectionPrefix
    ? `[${preset.sectionPrefix}...]`
    : 'All sections';
  if (preset.minComponent !== null) {
    return `${prefixLabel} / Component >= ${preset.minComponent}`;
  }
  return preset.sectionPrefix ? `${prefixLabel} / Any matching section` : 'All sections';
}

function slugifyPresetId(name: string, existingIds: Set<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom-preset';
  if (!existingIds.has(base)) return base;
  let counter = 2;
  while (existingIds.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

export function PresetsView({
  root,
  presets,
  onPickFolder,
  onSavePreset,
  onDeletePreset,
}: PresetsViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [description, setDescription] = useState('');
  const [sectionPrefix, setSectionPrefix] = useState('TextureOverride');
  const [componentFilter, setComponentFilter] = useState<ComponentFilterChoice>('3plus');

  const [afterInject, setAfterInject] = useState('');
  const [afterAnchor, setAfterAnchor] = useState(DEFAULT_AFTER_ANCHOR);
  const [showCustomAfterAnchor, setShowCustomAfterAnchor] = useState(false);

  const [beforeInject, setBeforeInject] = useState('');
  const [beforeAnchor, setBeforeAnchor] = useState(DEFAULT_BEFORE_ANCHOR);
  const [showCustomBeforeAnchor, setShowCustomBeforeAnchor] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const effectivePresets = presets.length > 0 ? presets : FALLBACK_BUILTIN_PRESETS;

  const builtinPresets = useMemo(
    () => effectivePresets.filter((p) => p.builtin),
    [effectivePresets],
  );
  const customPresets = useMemo(
    () => effectivePresets.filter((p) => !p.builtin),
    [effectivePresets],
  );

  function resetForm() {
    setName('');
    setGroup('');
    setSourceUrl('');
    setDescription('');
    setSectionPrefix('TextureOverride');
    setComponentFilter('3plus');
    setAfterInject('');
    setAfterAnchor(DEFAULT_AFTER_ANCHOR);
    setShowCustomAfterAnchor(false);
    setBeforeInject('');
    setBeforeAnchor(DEFAULT_BEFORE_ANCHOR);
    setShowCustomBeforeAnchor(false);
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!root) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Enter a preset name.');
      return;
    }

    const insertAfter: AnchorInsert[] = [];
    const insertBefore: AnchorInsert[] = [];

    if (afterInject.trim()) {
      const anchor = afterAnchor.trim();
      if (!anchor) {
        setFormError('Anchor line for the insert-after rule cannot be empty.');
        return;
      }
      insertAfter.push({ anchor, inject: afterInject.trim() });
    }

    if (beforeInject.trim()) {
      const anchor = beforeAnchor.trim();
      if (!anchor) {
        setFormError('Anchor line for the insert-before rule cannot be empty.');
        return;
      }
      insertBefore.push({ anchor, inject: beforeInject.trim() });
    }

    if (insertAfter.length === 0 && insertBefore.length === 0) {
      setFormError('Add at least one line to insert (after override or before cleanup).');
      return;
    }

    const trimmedUrl = sourceUrl.trim();
    if (
      trimmedUrl &&
      !trimmedUrl.startsWith('https://') &&
      !trimmedUrl.startsWith('http://')
    ) {
      setFormError('Mod page URL must start with https:// or http://.');
      return;
    }

    const existingIds = new Set(effectivePresets.map((p) => p.id));
    const minComponent =
      componentFilter === '3plus' ? 3 : componentFilter === '0plus' ? 0 : null;

    const newPreset: Preset = {
      id: slugifyPresetId(trimmedName, existingIds),
      name: trimmedName,
      description:
        description.trim() ||
        `Custom INI injection rule targeting ${sectionPrefix.trim() || 'matching'} sections.`,
      group: group.trim() || null,
      sourceUrl: trimmedUrl || null,
      recommended: false,
      sectionPrefix: sectionPrefix.trim(),
      minComponent,
      insertAfter,
      insertBefore,
      builtin: false,
    };

    setSaving(true);
    setFormError(null);
    try {
      await onSavePreset(newPreset);
      resetForm();
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(presetId: string) {
    if (!root || deletingId) return;
    setDeletingId(presetId);
    try {
      await onDeletePreset(presetId);
    } finally {
      setDeletingId(null);
    }
  }

  function renderPresetCard(preset: Preset) {
    const isDeleting = deletingId === preset.id;

    return (
      <article
        key={preset.id}
        className="rounded-lg border border-hairline bg-surface p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-medium text-ink">{preset.name}</h3>
              {preset.recommended && (
                <span className="rounded-xs bg-status-green-soft px-2 py-0.5 text-xs font-medium text-status-green">
                  Recommended
                </span>
              )}
              <span className="rounded-xs border border-hairline bg-surface-elevated px-2 py-0.5 text-xs text-ink-mute">
                {preset.builtin ? 'Built-in' : 'Custom'}
              </span>
              {preset.group && (
                <span className="text-xs text-ink-mute">{preset.group}</span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-ink-body">{preset.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {preset.sourceUrl && (
              <button
                type="button"
                onClick={() => void api.openExternalUrl(preset.sourceUrl!)}
                className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-hairline-strong bg-surface-elevated px-3 text-sm font-medium text-ink-bright transition-colors hover:bg-surface-card"
              >
                <Icon icon={Icons.external} size={14} className="text-ink-mute" />
                {preset.builtin ? 'Get Base Mod (GameBanana)' : 'Open Mod Page'}
              </button>
            )}
            {!preset.builtin && root && (
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDelete(preset.id)}
                className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-hairline bg-surface-elevated px-3 text-sm font-medium text-ink-body transition-colors hover:border-status-red/40 hover:bg-status-red-soft hover:text-status-red disabled:cursor-not-allowed disabled:text-ink-ash"
              >
                <Icon icon={Icons.trash} size={14} />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
        </div>

        {preset.builtin && preset.sourceUrl && (
          <div className="mt-3 rounded-md border border-hairline bg-surface-elevated px-3 py-2 text-xs text-ink-body">
            Requires the base texture mod in your Mods folder first (not built into XXMI):{' '}
            <span className="font-mono text-ink-mute">{preset.sourceUrl}</span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-mute">Target sections:</span>
          <code className="rounded-xs border border-hairline bg-surface-elevated px-2 py-0.5 font-mono text-xs text-ink-bright">
            {formatTargetRule(preset)}
          </code>
        </div>

        <div className="mt-3 space-y-2">
          {preset.insertAfter.map((rule, idx) => (
            <div
              key={`after-${idx}`}
              className="overflow-x-auto rounded-md border border-hairline bg-surface-elevated p-3 font-mono text-xs"
            >
              <div className="text-ink-mute">
                Insert after: <span className="text-ink-body">{rule.anchor}</span>
              </div>
              <div className="mt-1 text-status-green">+ {rule.inject}</div>
            </div>
          ))}

          {preset.insertBefore.map((rule, idx) => (
            <div
              key={`before-${idx}`}
              className="overflow-x-auto rounded-md border border-hairline bg-surface-elevated p-3 font-mono text-xs"
            >
              <div className="text-ink-mute">
                Insert before: <span className="text-ink-body">{rule.anchor}</span>
              </div>
              <div className="mt-1 text-status-green">+ {rule.inject}</div>
            </div>
          ))}
        </div>
      </article>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-hairline pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink sm:text-2xl">
            Effect Presets
          </h1>
          <p className="mt-1 text-sm text-ink-mute">
            Reusable INI rules that inject shader or CommandList lines into matching mod sections with automatic backups.
          </p>
        </div>

        {root ? (
          showForm ? (
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
              className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-hairline bg-surface-elevated px-4 text-sm font-medium text-ink-bright transition-colors hover:bg-surface-card"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-ink-bright px-4 text-sm font-medium text-black transition-colors hover:bg-[#e8e8e8] active:bg-[#dcdcdc]"
            >
              <Icon icon={Icons.add} size={15} />
              New Preset
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={onPickFolder}
            className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-ink-bright px-4 text-sm font-medium text-black transition-colors hover:bg-[#e8e8e8] active:bg-[#dcdcdc]"
          >
            Choose Mods Folder
          </button>
        )}
      </header>

      {!root && (
        <div className="mt-6 rounded-lg border border-hairline bg-surface p-4 text-sm text-ink-body">
          Custom presets are saved inside your Mods directory as{' '}
          <code className="font-mono text-xs text-ink-bright">modctl.presets.toml</code>. Choose a Mods folder first to load existing custom presets or create new ones.
        </div>
      )}

      {root && showForm && (
        <section
          aria-label="New Effect Preset"
          className="mt-6 rounded-lg border border-hairline-strong bg-surface p-4 sm:p-6"
        >
          <div className="border-b border-hairline pb-4">
            <h2 className="text-base font-medium text-ink">New Effect Preset</h2>
            <p className="mt-0.5 text-xs text-ink-mute">
              Saves to <code className="font-mono text-ink-body">modctl.presets.toml</code> in your active Mods folder.
            </p>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="preset-name"
                  className="block text-xs font-medium text-ink-body"
                >
                  Preset Name
                </label>
                <input
                  id="preset-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="KatFXMatcap Custom"
                  className="mt-1.5 min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated px-3 text-sm text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong"
                />
              </div>

              <div>
                <label
                  htmlFor="preset-group"
                  className="block text-xs font-medium text-ink-body"
                >
                  Group Name <span className="font-normal text-ink-mute">(optional)</span>
                </label>
                <input
                  id="preset-group"
                  type="text"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  placeholder="KatFXMatcap OilSkin"
                  className="mt-1.5 min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated px-3 text-sm text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="preset-description"
                  className="block text-xs font-medium text-ink-body"
                >
                  Description
                </label>
                <input
                  id="preset-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Applies custom matcap call to character body components."
                  className="mt-1.5 min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated px-3 text-sm text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong"
                />
              </div>

              <div>
                <label
                  htmlFor="preset-source-url"
                  className="block text-xs font-medium text-ink-body"
                >
                  Mod Download Page URL{' '}
                  <span className="font-normal text-ink-mute">(optional)</span>
                </label>
                <input
                  id="preset-source-url"
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => {
                    setSourceUrl(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="https://gamebanana.com/mods/..."
                  className="mt-1.5 min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated px-3 font-mono text-xs text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <label
                  htmlFor="preset-section-prefix"
                  className="block text-xs font-medium text-ink-body"
                >
                  Section Prefix
                </label>
                <input
                  id="preset-section-prefix"
                  type="text"
                  value={sectionPrefix}
                  onChange={(e) => setSectionPrefix(e.target.value)}
                  placeholder="TextureOverride"
                  className="mt-1.5 min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated px-3 font-mono text-xs text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong"
                />
              </div>

              <div className="lg:col-span-8">
                <span className="block text-xs font-medium text-ink-body">
                  Component Filter
                </span>
                <div
                  role="group"
                  aria-label="Component Filter"
                  className="mt-1.5 grid grid-cols-1 gap-1.5 rounded-md border border-hairline bg-canvas p-1 sm:grid-cols-3"
                >
                  {(
                    [
                      { id: '3plus', label: 'Component 3+' },
                      { id: '0plus', label: 'All Components 0+' },
                      { id: 'any', label: 'Any matching section' },
                    ] as const
                  ).map((opt) => {
                    const active = componentFilter === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setComponentFilter(opt.id)}
                        className={clsx(
                          'min-h-[44px] sm:min-h-[32px] rounded-sm px-2.5 text-xs font-medium transition-colors',
                          active
                            ? 'bg-surface-card text-ink-bright'
                            : 'text-ink-mute hover:text-ink-body',
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-hairline bg-canvas p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="preset-after-inject"
                  className="text-xs font-medium text-ink-body"
                >
                  Line to insert after{' '}
                  <code className="font-mono text-ink-bright">
                    CommandListOverrideSharedResources
                  </code>{' '}
                  <span className="font-normal text-ink-mute">(optional)</span>
                </label>
                <button
                  type="button"
                  aria-expanded={showCustomAfterAnchor}
                  onClick={() => setShowCustomAfterAnchor((v) => !v)}
                  className="inline-flex min-h-[44px] sm:min-h-[28px] items-center gap-1 text-xs text-ink-mute hover:text-ink-bright"
                >
                  <Icon
                    icon={showCustomAfterAnchor ? Icons.chevronDown : Icons.chevronRight}
                    size={13}
                  />
                  Custom anchor
                </button>
              </div>
              <input
                id="preset-after-inject"
                type="text"
                value={afterInject}
                onChange={(e) => {
                  setAfterInject(e.target.value);
                  setFormError(null);
                }}
                placeholder="run = CommandList\KatFXMatcap\OilSkin"
                className="mt-1.5 min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated px-3 font-mono text-xs text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong"
              />
              {showCustomAfterAnchor && (
                <div className="mt-2.5">
                  <label
                    htmlFor="preset-after-anchor"
                    className="block text-xs text-ink-mute"
                  >
                    Match anchor line (case-insensitive)
                  </label>
                  <input
                    id="preset-after-anchor"
                    type="text"
                    value={afterAnchor}
                    onChange={(e) => setAfterAnchor(e.target.value)}
                    className="mt-1 min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated px-3 font-mono text-xs text-ink-bright focus:border-hairline-strong"
                  />
                </div>
              )}
            </div>

            <div className="rounded-md border border-hairline bg-canvas p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="preset-before-inject"
                  className="text-xs font-medium text-ink-body"
                >
                  Line to insert before{' '}
                  <code className="font-mono text-ink-bright">
                    CommandListCleanupSharedResources
                  </code>{' '}
                  <span className="font-normal text-ink-mute">(optional)</span>
                </label>
                <button
                  type="button"
                  aria-expanded={showCustomBeforeAnchor}
                  onClick={() => setShowCustomBeforeAnchor((v) => !v)}
                  className="inline-flex min-h-[44px] sm:min-h-[28px] items-center gap-1 text-xs text-ink-mute hover:text-ink-bright"
                >
                  <Icon
                    icon={showCustomBeforeAnchor ? Icons.chevronDown : Icons.chevronRight}
                    size={13}
                  />
                  Custom anchor
                </button>
              </div>
              <input
                id="preset-before-inject"
                type="text"
                value={beforeInject}
                onChange={(e) => {
                  setBeforeInject(e.target.value);
                  setFormError(null);
                }}
                placeholder="run = CommandList\KatFXMatcap\Clear"
                className="mt-1.5 min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated px-3 font-mono text-xs text-ink-bright placeholder:text-ink-mute focus:border-hairline-strong"
              />
              {showCustomBeforeAnchor && (
                <div className="mt-2.5">
                  <label
                    htmlFor="preset-before-anchor"
                    className="block text-xs text-ink-mute"
                  >
                    Match anchor line (case-insensitive)
                  </label>
                  <input
                    id="preset-before-anchor"
                    type="text"
                    value={beforeAnchor}
                    onChange={(e) => setBeforeAnchor(e.target.value)}
                    className="mt-1 min-h-[44px] sm:min-h-[36px] w-full rounded-md border border-hairline bg-surface-elevated px-3 font-mono text-xs text-ink-bright focus:border-hairline-strong"
                  />
                </div>
              )}
            </div>

            {formError && (
              <div
                role="alert"
                className="rounded-md border border-status-red/35 bg-status-red-soft px-3 py-2.5 text-xs text-status-red"
              >
                {formError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-hairline bg-surface-elevated px-4 text-sm font-medium text-ink-bright transition-colors hover:bg-surface-card"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-ink-bright px-4 text-sm font-medium text-black transition-colors hover:bg-[#e8e8e8] active:bg-[#dcdcdc] disabled:cursor-not-allowed disabled:bg-surface-elevated disabled:text-ink-ash"
              >
                {saving ? 'Saving...' : 'Save Preset'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-7" aria-label="Built-in Presets">
        <div className="mb-3">
          <h2 className="text-base font-medium text-ink">Built-in Presets</h2>
          <p className="text-xs text-ink-mute">
            Included with modctl and ready to preview or apply from any mod inspector.
          </p>
        </div>
        <div className="space-y-3">{builtinPresets.map(renderPresetCard)}</div>
      </section>

      <section className="mt-8" aria-label="Custom Presets">
        <div className="mb-3">
          <h2 className="text-base font-medium text-ink">
            Custom Presets (<code className="font-mono text-sm">modctl.presets.toml</code>)
          </h2>
          <p className="text-xs text-ink-mute">
            Stored per Mods folder so your custom rules stay portable with your mod setup.
          </p>
        </div>

        {customPresets.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-hairline bg-surface px-6 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-hairline bg-surface-card text-ink-mute">
              <Icon icon={Icons.sliders} size={24} />
            </div>
            <p className="mt-3 text-sm font-medium text-ink">No custom presets saved</p>
            <p className="mt-1 max-w-sm text-xs text-ink-mute">
              {root
                ? 'Create a preset above to save your own shader or CommandList injection rules into modctl.presets.toml.'
                : 'Select a Mods folder to view or add custom presets in modctl.presets.toml.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">{customPresets.map(renderPresetCard)}</div>
        )}
      </section>
    </div>
  );
}
