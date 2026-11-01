# AioMM (All in one mod manager)

A lightweight desktop mod manager and lossless INI injector for 3DMigoto and XXMI games (such as Wuthering Waves WWMI, Zenless Zone Zero ZZMI, and Genshin Impact GIMI).

Built with Tauri v2, Rust, React 18, TypeScript, and Tailwind CSS.

## Overview

Managing mods across 3DMigoto importers usually involves manually editing `.ini` text files, diagnosing duplicate keybinds, and manually toggling folder names. AioMM provides a self-contained desktop interface to organize mods, inspect textures, and inject shader or texture hooks without damaging existing configurations.

## Features

### Non-Destructive Mod Management
- Toggles mods on or off using the standard `DISABLED_` folder prefix.
- One-click bulk actions to disable all active mods before game patches or re-enable them after.
- Detects known XXMI and 3DMigoto folder locations automatically, with manual folder switching.

### Lossless INI Manipulation
- Custom parser written in pure Rust with no external INI dependencies.
- Preserves file structure completely: comments (`;`), UTF-8 BOM, line endings (CRLF and LF), leading indentation, duplicate runner keys (`run = ...`), and conditional blocks (`if/else/endif`).
- Automatic backup creation (`.aiomm.bak`) before any file modification, with single-click restore.

### Smart RabbitFX Auto-Converter
- Bypasses fragile vanilla texture hashes by mapping textures directly to RabbitFX pipeline slots so mods survive game patches without manual hash dumping.
- Scans `[Resource...]` sections to infer diffuse, lightmap, normalmap, and glowmap files automatically.
- Injects `CommandList\RabbitFX\Run` and slot assignments right below `handling = skip`.

### Keybind Collision Detection
- Scans active mods for internal hotkey conflicts where multiple toggle sections inside the same mod share an identical key combination.
- Ignores harmless overlaps between different character mods since only one character is active in-game at a time.
- Interactive key recorder to remap conflicting keys directly from the UI, supporting modifiers (`Ctrl`, `Alt`, `Shift`) and 3DMigoto virtual key codes (`VK_...`).
- Paginated hotkey table and searchable formatted cheat sheet with one-click clipboard copy or text file export.

### Mod Health and Conflict Linting
- Missing asset linter: verifies whether files referenced in `filename = ...` directives actually exist on disk, catching modder typos before game launch.
- Mesh clash detector: warns when two active mods target identical component hashes or the same character, preventing overlapping geometry in-game.

### Asset Cleaner and Packager
- Unreferenced asset scanner: identifies orphan `.dds`, `.png`, `.psd`, and 3D files left behind in mod directories that are never called in any `.ini` file.
- Selective deletion with size reporting to reclaim disk space.
- Clean `.zip` exporter: packages working mod setups to the Desktop while excluding backup files and temporary clutter.
- Drag and drop installer: drop any mod `.zip` archive from GameBanana directly onto the application window to unpack and register it.

### Responsive Workspace
- Dual resizable panels: drag handles on the left navigation sidebar (170px to 380px) and right mod inspector (260px to 700px).
- Double-click resizer handles to reset panels to their default dimensions.
- Collapsible left sidebar that shrinks into an icon rail to maximize screen space on compact displays.
- Visuals follow the Raycast dark surface system using Hugeicons and typography optimized for desktop utility work.

## Getting Started

### Prerequisites

- Node.js 20 or newer
- Rust toolchain (stable)
- Windows 10/11 with WebView2 runtime installed (pre-installed on modern Windows)

### Development

Clone the repository and install frontend dependencies:

```bash
git clone https://github.com/caya8205-2/AioMM.git
cd AioMM
npm install
```

Start the Vite development server:

```bash
npm run dev
```

Run tests (Rust backend and frontend type checks):

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

### Production Build

To compile the self-contained Windows executable:

```bash
npm run tauri:build
```

The resulting standalone executable will be located at:

```
src-tauri/target/release/aiomm.exe
```

The application embeds all assets and backend commands into this single binary. It runs fully offline with no background Node.js or web server required.

## Technical Details

- Frontend: React 18, TypeScript, Tailwind CSS, Hugeicons (`@hugeicons/react`)
- Desktop Runtime: Tauri v2
- Backend Core: Rust (`std::fs`, native Win32 APIs, lossless token parsing)
- Backup Schema: Original files preserved as `<name>.ini.aiomm.bak` with backwards compatibility for legacy `.modctl.bak` and `.bak` files.
- Configuration: Custom presets saved locally in `aiomm.presets.toml` inside the active Mods root.

## Author

Developed by Caya8205.
