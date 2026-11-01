import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type {
  DetectedFolder,
  DryRunDto,
  KeyConflict,
  ModCleanScanDto,
  ModEntry,
  Preset,
  RabbitFxAnalysisDto,
  RabbitFxApplyRequest,
  WorkspaceSnapshot,
} from '../types';
import { normalizeKeyComboClient } from './keymap';

export const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function resolveModImageUrl(previewPath: string | null): string | null {
  if (!previewPath) return null;
  if (
    previewPath.startsWith('data:') ||
    previewPath.startsWith('http://') ||
    previewPath.startsWith('https://')
  ) {
    return previewPath;
  }
  return IS_TAURI ? convertFileSrc(previewPath) : null;
}

export async function pickModsDirectory(): Promise<string | null> {
  if (!IS_TAURI) {
    return 'PREVIEW:\\XXMI\\ZZMI\\Mods';
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select 3DMigoto or XXMI Mods Folder',
  });
  return typeof selected === 'string' ? selected : null;
}

// Browser-only preview state used strictly when running outside Tauri during layout verification.
interface PreviewIniState {
  original: string;
  current: string;
  hasBackup: boolean;
}

const PREVIEW_PRESETS_INIT: Preset[] = [
  {
    id: 'oilskin-3plus',
    name: 'KatFXMatcap OilSkin (Body Parts 3+)',
    description: 'Recommended first pass: applies OilSkin and Clear to Component 3 and higher.',
    group: 'KatFXMatcap OilSkin',
    sourceUrl: 'https://gamebanana.com/mods/733773',
    recommended: true,
    sectionPrefix: 'TextureOverride',
    minComponent: 3,
    insertAfter: [
      {
        anchor: 'run = CommandListOverrideSharedResources',
        inject: 'run = CommandList\\KatFXMatcap\\OilSkin',
      },
    ],
    insertBefore: [
      {
        anchor: 'run = CommandListCleanupSharedResources',
        inject: 'run = CommandList\\KatFXMatcap\\Clear',
      },
    ],
    builtin: true,
  },
  {
    id: 'oilskin-all',
    name: 'KatFXMatcap OilSkin (All Parts 0+)',
    description: 'Fallback pass when meshes live in Component 0 to 2. Skips already patched parts.',
    group: 'KatFXMatcap OilSkin',
    sourceUrl: 'https://gamebanana.com/mods/733773',
    recommended: false,
    sectionPrefix: 'TextureOverride',
    minComponent: 0,
    insertAfter: [
      {
        anchor: 'run = CommandListOverrideSharedResources',
        inject: 'run = CommandList\\KatFXMatcap\\OilSkin',
      },
    ],
    insertBefore: [
      {
        anchor: 'run = CommandListCleanupSharedResources',
        inject: 'run = CommandList\\KatFXMatcap\\Clear',
      },
    ],
    builtin: true,
  },
  {
    id: 'orfix-global',
    name: 'ORFix (Reflection and Outline Fix)',
    description: 'Injects ORFix to fix broken object reflections and black outlines in 3DMigoto mods.',
    group: 'ORFix',
    sourceUrl: 'https://gamebanana.com/tools/14106',
    recommended: false,
    sectionPrefix: 'TextureOverride',
    minComponent: 0,
    insertAfter: [
      {
        anchor: 'run = CommandListOverrideSharedResources',
        inject: 'run = CommandList\\global\\ORFix\\ORFix',
      },
    ],
    insertBefore: [],
    builtin: true,
  },
  {
    id: 'rabbitfx-runner',
    name: 'RabbitFX Base Runner Hook',
    description: 'Injects RabbitFX pipeline runner call right after skip handling.',
    group: 'RabbitFX',
    sourceUrl: 'https://gamebanana.com/mods/527815',
    recommended: false,
    sectionPrefix: 'TextureOverride',
    minComponent: 0,
    insertAfter: [
      {
        anchor: 'handling = skip',
        inject: 'run = CommandList\\RabbitFX\\Run',
      },
    ],
    insertBefore: [],
    builtin: true,
  },
];

let previewPresets: Preset[] = [...PREVIEW_PRESETS_INIT];

const previewInis: Record<string, PreviewIniState> = {
  'PREVIEW:\\XXMI\\ZZMI\\Mods\\JaneDoe_Jacket\\merged.ini': {
    original: `[KeySwapJacket]\nkey = no_ctrl no_alt VK_UP\ntype = cycle\n$jacket = 0,1\n\n[KeySwapHair]\nkey = VK_UP\ntype = cycle\n$hair = 0,1\n\n[TextureOverrideComponent0]\nhash = 11aa22\nrun = CommandListOverrideSharedResources\nib = ResourceIB0\nrun = CommandListCleanupSharedResources\n\n[TextureOverrideComponent3]\nhash = 33bb44\n\trun = CommandListOverrideSharedResources\n\tib = ResourceIB3\n\trun = CommandListCleanupSharedResources\n`,
    current: `[KeySwapJacket]\nkey = no_ctrl no_alt VK_UP\ntype = cycle\n$jacket = 0,1\n\n[KeySwapHair]\nkey = VK_UP\ntype = cycle\n$hair = 0,1\n\n[TextureOverrideComponent0]\nhash = 11aa22\nrun = CommandListOverrideSharedResources\nib = ResourceIB0\nrun = CommandListCleanupSharedResources\n\n[TextureOverrideComponent3]\nhash = 33bb44\n\trun = CommandListOverrideSharedResources\n\tib = ResourceIB3\n\trun = CommandListCleanupSharedResources\n`,
    hasBackup: false,
  },
  'PREVIEW:\\XXMI\\ZZMI\\Mods\\JaneDoe_Jacket\\Slot0\\DISABLED_base.ini': {
    original: `; Ignored backup slot\n`,
    current: `; Ignored backup slot\n`,
    hasBackup: false,
  },
  'PREVIEW:\\XXMI\\ZZMI\\Mods\\Burnice_Alt\\Burnice.ini': {
    original: `[KeyToggleGlasses]\nkey = VK_UP\ntype = cycle\n$glasses = 0,1\n\n[TextureOverrideBurniceComponent1]\nhash = 99cc00\nrun = CommandListOverrideSharedResources\nib = ResourceBurniceIB1\nrun = CommandListCleanupSharedResources\n`,
    current: `[KeyToggleGlasses]\nkey = VK_UP\ntype = cycle\n$glasses = 0,1\n\n[TextureOverrideBurniceComponent1]\nhash = 99cc00\nrun = CommandListOverrideSharedResources\nib = ResourceBurniceIB1\nrun = CommandListCleanupSharedResources\n`,
    hasBackup: false,
  },
  'PREVIEW:\\XXMI\\ZZMI\\Mods\\DISABLED_Evelyn_Old\\Evelyn.ini': {
    original: `[TextureOverrideComponent3]\nhash = 55dd66\nrun = CommandListOverrideSharedResources\nrun = CommandListCleanupSharedResources\n`,
    current: `[TextureOverrideComponent3]\nhash = 55dd66\nrun = CommandListOverrideSharedResources\nrun = CommandListCleanupSharedResources\n`,
    hasBackup: false,
  },
};

const previewModEnabled: Record<string, boolean> = {
  JaneDoe_Jacket: true,
  Burnice_Alt: true,
  Evelyn_Old: false,
};

function runPreviewPatch(raw: string, preset: Preset) {
  const lines = raw.split('\n');
  const out: string[] = [];
  const preview: string[] = [];
  let inTarget = false;
  let currentSec = '';
  let secTouched = false;
  let touchedSections = 0;
  let injectedLines = 0;
  let alreadyAppliedLines = 0;
  let matchingSectionsTotal = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trim = line.trim();
    if (trim.startsWith('[') && trim.endsWith(']')) {
      const sec = trim.slice(1, -1).trim();
      const lower = sec.toLowerCase();
      const prefOk = lower.startsWith(preset.sectionPrefix.toLowerCase());
      let compOk = true;
      if (preset.minComponent !== null) {
        const m = lower.match(/component[\s_-]*(\d+)/);
        compOk = m ? Number(m[1]) >= preset.minComponent : false;
      }
      inTarget = prefOk && compOk;
      if (inTarget) matchingSectionsTotal++;
      currentSec = sec;
      secTouched = false;
    }

    if (inTarget && !trim.startsWith(';')) {
      const indent = line.match(/^(\s*)/)?.[1] ?? '';
      for (const r of preset.insertBefore) {
        if (trim.toLowerCase() === r.anchor.toLowerCase()) {
          const prev = [...out].reverse().find((s) => s.trim() && !s.trim().startsWith(';'))?.trim() ?? '';
          if (prev.toLowerCase() === r.inject.toLowerCase()) {
            alreadyAppliedLines++;
          } else {
            if (!secTouched) {
              preview.push(`[${currentSec}]`);
              secTouched = true;
              touchedSections++;
            }
            out.push(`${indent}${r.inject}`);
            preview.push(`+ ${indent}${r.inject}`);
            injectedLines++;
          }
        }
      }
      out.push(line);
      for (const r of preset.insertAfter) {
        if (trim.toLowerCase() === r.anchor.toLowerCase()) {
          const next = lines.slice(i + 1).find((s) => s.trim() && !s.trim().startsWith(';'))?.trim() ?? '';
          if (next.toLowerCase() === r.inject.toLowerCase()) {
            alreadyAppliedLines++;
          } else {
            if (!secTouched) {
              preview.push(`[${currentSec}]`);
              secTouched = true;
              touchedSections++;
            }
            out.push(`${indent}${r.inject}`);
            preview.push(`+ ${indent}${r.inject}`);
            injectedLines++;
          }
        }
      }
    } else {
      out.push(line);
    }
  }

  return {
    content: out.join('\n'),
    injectedLines,
    touchedSections,
    alreadyAppliedLines,
    matchingSectionsTotal,
    preview,
  };
}

function buildPreviewSnapshot(root: string): WorkspaceSnapshot {
  const specs = [
    {
      key: 'JaneDoe_Jacket',
      category: 'Jane Doe',
      inis: [
        {
          path: 'PREVIEW:\\XXMI\\ZZMI\\Mods\\JaneDoe_Jacket\\merged.ini',
          relName: 'merged.ini',
          isDisabled: false,
        },
        {
          path: 'PREVIEW:\\XXMI\\ZZMI\\Mods\\JaneDoe_Jacket\\Slot0\\DISABLED_base.ini',
          relName: 'Slot0\\DISABLED_base.ini',
          isDisabled: true,
        },
      ],
    },
    {
      key: 'Burnice_Alt',
      category: 'Burnice',
      inis: [
        {
          path: 'PREVIEW:\\XXMI\\ZZMI\\Mods\\Burnice_Alt\\Burnice.ini',
          relName: 'Burnice.ini',
          isDisabled: false,
        },
      ],
    },
    {
      key: 'Evelyn_Old',
      category: 'Evelyn',
      inis: [
        {
          path: 'PREVIEW:\\XXMI\\ZZMI\\Mods\\DISABLED_Evelyn_Old\\Evelyn.ini',
          relName: 'Evelyn.ini',
          isDisabled: false,
        },
      ],
    },
  ];

  const mods: ModEntry[] = specs.map((sp) => {
    const enabled = previewModEnabled[sp.key];
    const folderName = enabled ? sp.key : `DISABLED_${sp.key}`;
    const modPath = `${root}\\${folderName}`;
    const iniFiles = sp.inis.map((i) => ({
      ...i,
      hasBackup: previewInis[i.path]?.hasBackup ?? false,
    }));
    const keybinds: ModEntry['keybinds'] = [];
    const appliedPresetIds: string[] = [];

    for (const ini of iniFiles) {
      if (ini.isDisabled) continue;
      const raw = previewInis[ini.path]?.current ?? '';
      const rawLines = raw.split('\n');
      let sec = '';
      for (let idx = 0; idx < rawLines.length; idx++) {
        const t = rawLines[idx].trim();
        if (t.startsWith('[') && t.endsWith(']')) {
          sec = t.slice(1, -1).trim();
          continue;
        }
        if (sec.toLowerCase().startsWith('key') && t.toLowerCase().startsWith('key')) {
          const val = t.split('=')[1]?.trim() ?? '';
          keybinds.push({
            iniPath: ini.path,
            iniRelName: ini.relName,
            section: sec,
            keyLineIdx: idx,
            rawKey: val,
            normalizedKey: normalizeKeyComboClient(val),
            variable: null,
          });
        }
      }
      for (const p of previewPresets) {
        const rep = runPreviewPatch(raw, p);
        if (rep.alreadyAppliedLines > 0 && rep.injectedLines === 0) {
          if (!appliedPresetIds.includes(p.id)) appliedPresetIds.push(p.id);
        }
      }
    }

    return {
      id: sp.key,
      name: folderName,
      displayName: sp.key.replace(/_/g, ' '),
      category: sp.category,
      path: modPath,
      enabled,
      previewPath: null,
      iniFiles,
      keybinds: enabled ? keybinds : [],
      appliedPresetIds,
      hasAnyBackup: iniFiles.some((f) => f.hasBackup),
    };
  });

  const conflicts: KeyConflict[] = [];
  for (const m of mods) {
    if (!m.enabled) continue;
    const byKey = new Map<string, KeyConflict['entries']>();
    for (const kb of m.keybinds) {
      const list = byKey.get(kb.normalizedKey) ?? [];
      list.push({
        modId: m.id,
        modDisplayName: m.displayName,
        modPath: m.path,
        keybind: kb,
      });
      byKey.set(kb.normalizedKey, list);
    }
    for (const [normalizedKey, entries] of byKey.entries()) {
      if (entries.length >= 2) {
        conflicts.push({
          id: `${m.id}::${normalizedKey}`,
          modId: m.id,
          modDisplayName: m.displayName,
          modPath: m.path,
          normalizedKey,
          entries,
        });
      }
    }
  }

  return {
    root,
    mods,
    presets: previewPresets,
    conflicts,
  };
}

export const api = {
  async detectKnownModFolders(): Promise<DetectedFolder[]> {
    if (!IS_TAURI) {
      return [
        {
          label: 'ZZMI Sample [Preview Mode]',
          gameCode: 'PREVIEW',
          path: 'PREVIEW:\\XXMI\\ZZMI\\Mods',
        },
      ];
    }
    return invoke<DetectedFolder[]>('detect_known_mod_folders');
  },

  async scanModsFolder(root: string): Promise<WorkspaceSnapshot> {
    if (!IS_TAURI) {
      return buildPreviewSnapshot(root);
    }
    return invoke<WorkspaceSnapshot>('scan_mods_folder', { root });
  },

  async toggleMod(modPath: string): Promise<string> {
    if (!IS_TAURI) {
      for (const k of Object.keys(previewModEnabled)) {
        if (modPath.endsWith(k)) {
          previewModEnabled[k] = !previewModEnabled[k];
        }
      }
      return modPath;
    }
    return invoke<string>('toggle_mod', { modPath });
  },

  async previewPreset(
    iniPath: string,
    modsRoot: string,
    presetId: string,
  ): Promise<DryRunDto> {
    if (!IS_TAURI) {
      const st = previewInis[iniPath];
      const p = previewPresets.find((x) => x.id === presetId);
      if (!st || !p) throw new Error('Config or preset not found');
      const r = runPreviewPatch(st.current, p);
      return {
        presetId,
        injectedLines: r.injectedLines,
        touchedSections: r.touchedSections,
        alreadyAppliedLines: r.alreadyAppliedLines,
        matchingSectionsTotal: r.matchingSectionsTotal,
        preview: r.preview,
        hasBackup: st.hasBackup,
      };
    }
    return invoke<DryRunDto>('preview_preset', { iniPath, modsRoot, presetId });
  },

  async applyPreset(
    iniPath: string,
    modsRoot: string,
    presetId: string,
  ): Promise<DryRunDto> {
    if (!IS_TAURI) {
      const st = previewInis[iniPath];
      const p = previewPresets.find((x) => x.id === presetId);
      if (!st || !p) throw new Error('Config or preset not found');
      const r = runPreviewPatch(st.current, p);
      if (r.injectedLines > 0) {
        st.hasBackup = true;
        st.current = r.content;
      }
      return {
        presetId,
        injectedLines: r.injectedLines,
        touchedSections: r.touchedSections,
        alreadyAppliedLines: r.alreadyAppliedLines,
        matchingSectionsTotal: r.matchingSectionsTotal,
        preview: r.preview,
        hasBackup: st.hasBackup,
      };
    }
    return invoke<DryRunDto>('apply_preset', { iniPath, modsRoot, presetId });
  },

  async restoreIniBackup(iniPath: string): Promise<void> {
    if (!IS_TAURI) {
      const st = previewInis[iniPath];
      if (!st || !st.hasBackup) throw new Error('No backup found');
      st.current = st.original;
      st.hasBackup = false;
      return;
    }
    return invoke<void>('restore_ini_backup', { iniPath });
  },

  async updateKeybind(
    iniPath: string,
    lineIdx: number,
    newKey: string,
  ): Promise<void> {
    if (!IS_TAURI) {
      const st = previewInis[iniPath];
      if (!st) throw new Error('Config not found');
      const lines = st.current.split('\n');
      lines[lineIdx] = `key = ${newKey}`;
      st.hasBackup = true;
      st.current = lines.join('\n');
      return;
    }
    return invoke<void>('update_keybind', { iniPath, lineIdx, newKey });
  },

  async savePreset(modsRoot: string, preset: Preset): Promise<Preset[]> {
    if (!IS_TAURI) {
      const idx = previewPresets.findIndex((p) => p.id === preset.id);
      if (idx >= 0) previewPresets[idx] = preset;
      else previewPresets = [...previewPresets, preset];
      return previewPresets;
    }
    return invoke<Preset[]>('save_preset', { modsRoot, preset });
  },

  async deletePreset(modsRoot: string, presetId: string): Promise<Preset[]> {
    if (!IS_TAURI) {
      previewPresets = previewPresets.filter((p) => p.id !== presetId || p.builtin);
      return previewPresets;
    }
    return invoke<Preset[]>('delete_preset', { modsRoot, presetId });
  },

  async analyzeRabbitFx(iniPath: string): Promise<RabbitFxAnalysisDto> {
    if (!IS_TAURI) {
      const st = previewInis[iniPath];
      const cur = st?.current ?? '';
      const alreadyConverted =
        cur.includes('CommandList\\RabbitFX\\SetTextures') ||
        cur.includes('Resource\\RabbitFX\\Diffuse');
      return {
        iniPath,
        alreadyConverted,
        targetComponents: ['TextureOverrideComponent3'],
        resources: [
          {
            section: 'ResourceDiffuse',
            filename: 'Textures/Body_Diffuse.dds',
            inferredType: 'diffuse',
          },
          {
            section: 'ResourceLightmap',
            filename: 'Textures/Body_Lightmap.dds',
            inferredType: 'lightmap',
          },
          {
            section: 'ResourceNormal',
            filename: 'Textures/Body_Normal.dds',
            inferredType: 'normalmap',
          },
        ],
        suggestedDiffuse: 'ResourceDiffuse',
        suggestedLightmap: 'ResourceLightmap',
        suggestedNormalmap: 'ResourceNormal',
        suggestedGlowmap: null,
      };
    }
    return invoke<RabbitFxAnalysisDto>('analyze_rabbitfx', { iniPath });
  },

  async applyRabbitFx(request: RabbitFxApplyRequest): Promise<DryRunDto> {
    if (!IS_TAURI) {
      const st = previewInis[request.iniPath];
      if (st) {
        st.hasBackup = true;
        st.current = st.current.replace(
          'handling = skip',
          `handling = skip\nrun = CommandList\\RabbitFX\\Run\nResource\\RabbitFX\\Diffuse = ref ${request.diffuseResource || 'ResourceDiffuse'}\nResource\\RabbitFX\\Lightmap = ref ${request.lightmapResource || 'ResourceLightmap'}\nResource\\RabbitFX\\Normalmap = ref ${request.normalmapResource || 'ResourceNormal'}\nrun = CommandList\\RabbitFX\\SetTextures`,
        );
      }
      return {
        presetId: 'rabbitfx-stable-textures',
        injectedLines: 5,
        touchedSections: 1,
        alreadyAppliedLines: 0,
        matchingSectionsTotal: 1,
        preview: [
          '[TextureOverrideComponent3]',
          '+ run = CommandList\\RabbitFX\\Run',
          `+ Resource\\RabbitFX\\Diffuse = ref ${request.diffuseResource || 'ResourceDiffuse'}`,
          `+ Resource\\RabbitFX\\Lightmap = ref ${request.lightmapResource || 'ResourceLightmap'}`,
          `+ Resource\\RabbitFX\\Normalmap = ref ${request.normalmapResource || 'ResourceNormal'}`,
          '+ run = CommandList\\RabbitFX\\SetTextures',
        ],
        hasBackup: true,
      };
    }
    return invoke<DryRunDto>('apply_rabbitfx', { request });
  },

  async revealInExplorer(path: string): Promise<void> {
    if (!IS_TAURI) return;
    return invoke<void>('reveal_in_explorer', { path });
  },

  async openExternalUrl(url: string): Promise<void> {
    if (!IS_TAURI) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    return invoke<void>('open_external_url', { url });
  },

  async scanUnusedAssets(modPath: string): Promise<ModCleanScanDto> {
    if (!IS_TAURI) {
      return {
        modName: 'Sample Mod',
        totalScannedFiles: 8,
        unusedAssets: [
          {
            relPath: 'Textures/old_unreferenced_texture.dds',
            absPath: `${modPath}/Textures/old_unreferenced_texture.dds`,
            fileSizeBytes: 4194304,
            extension: 'dds',
          },
          {
            relPath: 'source_files/character_model.psd',
            absPath: `${modPath}/source_files/character_model.psd`,
            fileSizeBytes: 25165824,
            extension: 'psd',
          },
        ],
        reclaimableBytes: 29360128,
      };
    }
    return invoke<ModCleanScanDto>('scan_unused_assets', { modPath });
  },

  async deleteUnusedAssets(filePaths: string[]): Promise<number> {
    if (!IS_TAURI) {
      return 29360128;
    }
    return invoke<number>('delete_unused_assets', { filePaths });
  },

  async packageMod(
    modPath: string,
    outputDir: string | null = null,
    includeBackups = false,
  ): Promise<string> {
    if (!IS_TAURI) {
      return `${modPath}.zip`;
    }
    return invoke<string>('package_mod', {
      modPath,
      outputDir,
      includeBackups,
    });
  },
};
