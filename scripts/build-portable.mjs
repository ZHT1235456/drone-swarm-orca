/**
 * 一键构建免安装便携版：固定输出到 release/portable/SWARM-COMMAND.exe
 */
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = join(root, 'src-tauri', 'target');
const releaseDir = join(targetDir, 'release');
const outDir = join(root, 'release', 'portable');
const dest = join(outDir, 'SWARM-COMMAND.exe');

function findExe(dir) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter(
    (n) => n.endsWith('.exe') && !n.includes('wix') && !n.includes('nsis'),
  );
  if (names.length === 0) return null;
  // 优先 drone-swarm-orca.exe
  const preferred = names.find((n) => n.includes('drone-swarm')) ?? names[0];
  return join(dir, preferred);
}

console.log('正在构建便携版（免安装）...');
process.env.CARGO_TARGET_DIR = targetDir;

const build = spawnSync('npx', ['tauri', 'build', '--no-bundle'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
  shell: true,
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

let exe = findExe(releaseDir);
if (!exe) {
  console.error('构建完成但未找到 exe:', releaseDir);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(exe, dest);

const sizeMb = (statSync(dest).size / 1024 / 1024).toFixed(1);
console.log('');
console.log('========================================');
console.log('便携版已就绪，双击即可运行：');
console.log(dest);
console.log(`大小: ${sizeMb} MB`);
console.log('（Windows 10/11 需已安装 WebView2 运行时）');
console.log('========================================');
