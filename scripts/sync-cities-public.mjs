import { copyFileSync, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const src = 'src/data/cities_data.json';
const dest = 'public/cities_data.json';
const isoDest = 'public/country-iso.json';

if (!existsSync(src)) {
  console.warn('sync-cities-public: missing', src);
  process.exit(0);
}

if (!existsSync(dest) || statSync(src).mtimeMs > statSync(dest).mtimeMs) {
  copyFileSync(src, dest);
  console.log('sync-cities-public: copied →', dest);
}

// 產生精簡的「國名（中/英）→ ISO2」對照，供前端顯示任何國家的國旗與當地文化
if (!existsSync(isoDest) || statSync(src).mtimeMs > statSync(isoDest).mtimeMs) {
  try {
    const rows = JSON.parse(readFileSync(src, 'utf8'));
    const map = {};
    for (const r of rows) {
      const iso = (r.country_iso_code || '').toUpperCase();
      if (!iso || iso.length !== 2) continue;
      for (const name of [r.country, r.country_zh]) {
        if (!name) continue;
        const key = String(name).trim().toLowerCase();
        if (key && !map[key]) map[key] = iso;
      }
    }
    writeFileSync(isoDest, JSON.stringify(map));
    console.log('sync-cities-public: wrote →', isoDest, `(${Object.keys(map).length} names)`);
  } catch (err) {
    console.warn('sync-cities-public: country-iso build failed:', err.message);
  }
}

// 同步飛行媒體 scripts/* → public/media/
const mediaDir = 'public/media';
const mediaMap = [
  ['scripts/takeoff1.mp4', 'takeoff.mp4'],
  ['scripts/takeoff2.mp4', 'takeoff2.mp4'],
  ['scripts/takeoff2.mp4', 'cruise.mp4'],
  ['scripts/landing.mp4', 'landing.mp4'],
];
const audioMap = [
  ['scripts/takeoff.mp3', 'takeoff.mp3'],
  ['scripts/captain.mp3', 'captain.mp3'],
  ['scripts/wakeup1.mp3', 'wakeup1.mp3'],
  ['scripts/wakeup2.mp3', 'wakeup2.mp3'],
  ['scripts/wakeup3.mp3', 'wakeup3.mp3'],
  ['scripts/wakeup4.mp3', 'wakeup4.mp3'],
];
if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });
for (const [srcFile, name] of [...mediaMap, ...audioMap]) {
  const destFile = join(mediaDir, name);
  if (!existsSync(srcFile)) continue;
  if (!existsSync(destFile) || statSync(srcFile).mtimeMs > statSync(destFile).mtimeMs) {
    copyFileSync(srcFile, destFile);
    console.log('sync-cities-public: copied →', destFile);
  }
}
