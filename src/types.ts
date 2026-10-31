export type ActiveView = 'mods' | 'keybinds' | 'presets';

export interface AnchorInsert {
  anchor: string;
  inject: string;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  group: string | null;
  sourceUrl: string | null;
  recommended: boolean;
  sectionPrefix: string;
  minComponent: number | null;
  insertAfter: AnchorInsert[];
  insertBefore: AnchorInsert[];
  builtin: boolean;
}

export interface DetectedFolder {
  label: string;
  gameCode: string;
  path: string;
}

export interface IniFileEntry {
  path: string;
  relName: string;
  isDisabled: boolean;
  hasBackup: boolean;
}

export interface KeyBind {
  iniPath: string;
  iniRelName: string;
  section: string;
  keyLineIdx: number;
  rawKey: string;
  normalizedKey: string;
  variable: string | null;
}

export interface ModEntry {
  id: string;
  name: string;
  displayName: string;
  category: string | null;
  path: string;
  enabled: boolean;
  previewPath: string | null;
  iniFiles: IniFileEntry[];
  keybinds: KeyBind[];
  appliedPresetIds: string[];
  hasAnyBackup: boolean;
}

export interface ConflictMember {
  modId: string;
  modDisplayName: string;
  modPath: string;
  keybind: KeyBind;
}

export interface KeyConflict {
  id: string;
  modId: string;
  modDisplayName: string;
  modPath: string;
  normalizedKey: string;
  entries: ConflictMember[];
}

export interface DryRunDto {
  presetId: string;
  injectedLines: number;
  touchedSections: number;
  alreadyAppliedLines: number;
  matchingSectionsTotal: number;
  preview: string[];
  hasBackup: boolean;
}

export interface WorkspaceSnapshot {
  root: string;
  mods: ModEntry[];
  presets: Preset[];
  conflicts: KeyConflict[];
}
