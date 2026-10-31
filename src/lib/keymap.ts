import type React from 'react';

const VK_DISPLAY_NAMES: Record<string, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  return: 'Enter',
  enter: 'Enter',
  space: 'Space',
  tab: 'Tab',
  back: 'Backspace',
  backspace: 'Backspace',
  delete: 'Del',
  insert: 'Ins',
  home: 'Home',
  end: 'End',
  prior: 'PgUp',
  pageup: 'PgUp',
  next: 'PgDn',
  pagedown: 'PgDn',
  oem_4: '[',
  oem_6: ']',
  oem_5: '\\',
  oem_1: ';',
  oem_7: "'",
  oem_comma: ',',
  oem_period: '.',
  oem_2: '/',
  oem_minus: '-',
  oem_plus: '=',
  oem_3: '`',
  lbutton: 'Mouse Left',
  rbutton: 'Mouse Right',
  mbutton: 'Mouse Mid',
  xbutton1: 'Mouse 4',
  xbutton2: 'Mouse 5',
};

export function normalizeKeyComboClient(raw: string): string {
  const mods: string[] = [];
  let mainKey = '';

  for (const part of raw.trim().split(/\s+/)) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower.startsWith('no_')) continue;
    const stripped = lower.startsWith('vk_') ? lower.slice(3) : lower;
    if (['ctrl', 'control', 'lctrl', 'rctrl'].includes(stripped)) {
      mods.push('ctrl');
    } else if (['alt', 'menu', 'lalt', 'ralt'].includes(stripped)) {
      mods.push('alt');
    } else if (['shift', 'lshift', 'rshift'].includes(stripped)) {
      mods.push('shift');
    } else {
      mainKey = stripped;
    }
  }

  const uniqMods = Array.from(new Set(mods)).sort();
  if (!mainKey) return raw.trim().toLowerCase();
  return uniqMods.length > 0 ? `${uniqMods.join('+')}+${mainKey}` : mainKey;
}

export function formatKeyTokens(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const mods: string[] = [];
  let main = '';

  for (const part of trimmed.split(/\s+/)) {
    const lower = part.toLowerCase();
    if (lower.startsWith('no_')) continue;
    const stripped = lower.startsWith('vk_') ? lower.slice(3) : lower;

    if (['ctrl', 'control', 'lctrl', 'rctrl'].includes(stripped)) {
      if (!mods.includes('Ctrl')) mods.push('Ctrl');
    } else if (['alt', 'menu', 'lalt', 'ralt'].includes(stripped)) {
      if (!mods.includes('Alt')) mods.push('Alt');
    } else if (['shift', 'lshift', 'rshift'].includes(stripped)) {
      if (!mods.includes('Shift')) mods.push('Shift');
    } else {
      main = stripped;
    }
  }

  if (!main) return [trimmed];

  let label = VK_DISPLAY_NAMES[main];
  if (!label) {
    if (main.startsWith('numpad')) {
      label = `Num ${main.slice(6).toUpperCase()}`;
    } else if (/^f\d{1,2}$/.test(main)) {
      label = main.toUpperCase();
    } else if (main.length === 1) {
      label = main.toUpperCase();
    } else {
      label = main.toUpperCase();
    }
  }

  return [...mods, label];
}

const CODE_TO_3DMIGOTO: Record<string, string> = {
  ArrowUp: 'VK_UP',
  ArrowDown: 'VK_DOWN',
  ArrowLeft: 'VK_LEFT',
  ArrowRight: 'VK_RIGHT',
  Space: 'VK_SPACE',
  Enter: 'VK_RETURN',
  Tab: 'VK_TAB',
  Backspace: 'VK_BACK',
  Delete: 'VK_DELETE',
  Insert: 'VK_INSERT',
  Home: 'VK_HOME',
  End: 'VK_END',
  PageUp: 'VK_PRIOR',
  PageDown: 'VK_NEXT',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Numpad0: 'VK_NUMPAD0',
  Numpad1: 'VK_NUMPAD1',
  Numpad2: 'VK_NUMPAD2',
  Numpad3: 'VK_NUMPAD3',
  Numpad4: 'VK_NUMPAD4',
  Numpad5: 'VK_NUMPAD5',
  Numpad6: 'VK_NUMPAD6',
  Numpad7: 'VK_NUMPAD7',
  Numpad8: 'VK_NUMPAD8',
  Numpad9: 'VK_NUMPAD9',
  NumpadAdd: 'VK_ADD',
  NumpadSubtract: 'VK_SUBTRACT',
  NumpadMultiply: 'VK_MULTIPLY',
  NumpadDivide: 'VK_DIVIDE',
  NumpadDecimal: 'VK_DECIMAL',
};

export function keyboardEventTo3DMigoto(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    return null;
  }

  let mainKey: string | null = CODE_TO_3DMIGOTO[e.code] ?? null;
  if (!mainKey) {
    if (/^Key[A-Z]$/.test(e.code)) {
      mainKey = e.code.slice(3);
    } else if (/^Digit[0-9]$/.test(e.code)) {
      mainKey = e.code.slice(5);
    } else if (/^F([1-9]|1[0-2])$/.test(e.code)) {
      mainKey = `VK_${e.code.toUpperCase()}`;
    }
  }

  if (!mainKey) return null;

  const parts: string[] = [
    e.ctrlKey ? 'ctrl' : 'no_ctrl',
    e.altKey ? 'alt' : 'no_alt',
    e.shiftKey ? 'shift' : 'no_shift',
    mainKey,
  ];

  return parts.join(' ');
}
