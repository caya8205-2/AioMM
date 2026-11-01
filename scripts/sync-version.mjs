import { readFileSync, writeFileSync } from 'fs';

const root = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = root.version;

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

// Sync tauri.conf.json
const tauriPath = 'src-tauri/tauri.conf.json';
const tauri = JSON.parse(readFileSync(tauriPath, 'utf-8'));
tauri.version = version;
writeJson(tauriPath, tauri);

// Sync Cargo.toml
const cargoPath = 'src-tauri/Cargo.toml';
let cargo = readFileSync(cargoPath, 'utf-8');
cargo = cargo.replace(/^version = ".+"/m, `version = "${version}"`);
writeFileSync(cargoPath, cargo);

// Sync package-lock.json if present
try {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf-8'));
  lock.version = version;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = version;
  }
  writeJson('package-lock.json', lock);
} catch {
  // package-lock is optional
}

console.log(`Synced version v${version} across package.json, tauri.conf.json, and Cargo.toml`);
