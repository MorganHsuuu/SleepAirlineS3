/**
 * Landing ceremony must play landing.mp3 as audible music,
 * not only captain PA + airplane sfx, and not replace it with wakeup.
 * Run: node scripts/check-landing-music.mjs
 */
import { readFile } from 'node:fs/promises';

const [app, audio] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/broadcast-audio.js', import.meta.url), 'utf8'),
]);

function sliceFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const next = src.indexOf('\nfunction ', start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

const playGlassRoute = sliceFn(app, 'playGlassRoute');
const doLand = sliceFn(app, 'doLand');
const duckCeremonyBed = sliceFn(audio, 'duckCeremonyBed');
const restoreCeremonyBed = sliceFn(audio, 'restoreCeremonyBed');

const checks = [
  ['playGlassRoute starts landing.mp3', /playLandingMusic\?\.\(['"]media\/landing\.mp3['"]/.test(playGlassRoute)],
  ['doLand does not start wakeup as the landing bed', !/startWakeupBed\?\.?\(/.test(doLand)],
  ['landing.mp3 stays through weather fade-out', /fadeOutLandingMusic/.test(doLand)],
  ['duckCeremonyBed keeps landing music audible under airplane', duckCeremonyBed.includes('wakeupBedOpen') && /landingVolume/.test(duckCeremonyBed) && !/softWakeupVolume\(WAKEUP_DUCK_RATIO\.approach\)/.test(duckCeremonyBed.replace(/if\s*\(\s*wakeupBedOpen[\s\S]*?}/, ''))],
  ['restoreCeremonyBed restores landing.mp3 volume', restoreCeremonyBed.includes('wakeupBedOpen') && restoreCeremonyBed.includes('landingVolume')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\n✓ landing music checks passed');
}
