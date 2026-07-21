/**
 * 将 Tauri 便携版 exe 复制到 release/portable/，便于双击运行。
 */
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function findExe(dir) {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isFile() && name.endsWith('.exe') && !name.includes('wix') && !name.includes('nsis')) {
      return p;
    }
  }
  return null;
}

/** 通过 cargo metadata 定位真实 target 目录 */
function cargoReleaseDir() {
  try {
    const meta = JSON.parse(
      execSync('cargo metadata --format-version 1', {
        cwd: join(root, 'src-tauri'),
        encoding: 'utf8',
      }),
    );
    return join(meta.target_directory, 'release');
  } catch {
    return join(root, 'src-tauri', 'target', 'release');
  }
}

const candidates = [
  cargoReleaseDir(),
  join(root, 'src-tauri', 'target', 'release'),
];

let exe = null;
for (const dir of candidates) {
  exe = findExe(dir);
  if (exe) break;
}

if (!exe) {
  console.error('未找到 release exe，请先运行: npm run tauri:portable');
  process.exit(1);
}

const outDir = join(root, 'release', 'portable');
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, 'SWARM-COMMAND.exe');
copyFileSync(exe, dest);

const sizeMb = (statSync(dest).size / 1024 / 1024).toFixed(1);
console.log('便携版已生成:', dest);
console.log(`文件大小: ${sizeMb} MB`);
console.log('双击 SWARM-COMMAND.exe 即可运行（需 Windows 10/11 自带 WebView2）');
