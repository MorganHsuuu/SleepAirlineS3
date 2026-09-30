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

try {
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [join(root, 'node_modules', 'qrcode', 'lib', 'browser.js')],
    bundle: true,
    format: 'iife',
    globalName: 'QRCode',
    platform: 'browser',
    outfile: join(targetDir, 'qrcode.js'),
  });
  console.log('✓ synced browser QR code');
} catch (error) {
  console.warn('QR code bundle skipped:', error instanceof Error ? error.message : error);
}
