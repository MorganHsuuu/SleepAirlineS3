import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = join(root, 'public', 'vendor');

await mkdir(targetDir, { recursive: true });
await copyFile(
  join(root, 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js'),
  join(targetDir, 'html2canvas.min.js'),
);
console.log('✓ synced browser share-card renderer');
