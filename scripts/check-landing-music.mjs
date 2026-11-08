/**
 * Landing ceremony rotates wakeup1–4 instead of landing.mp3,
 * and ducks that bed under captain speech then restores it.
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
const playBroadcast = sliceFn(app, 'playBroadcast');
const muteCeremonyBedForSpeech = sliceFn(audio, 'muteCeremonyBedForSpeech');
const restoreCeremonyBed = sliceFn(audio, 'restoreCeremonyBed');
const playCaptainBroadcast = sliceFn(audio, 'playCaptainBroadcast');

const checks = [
  ['wakeup tracks are wakeup1–4', /wakeup1\.mp3/.test(app) && /wakeup2\.mp3/.test(app) && /wakeup3\.mp3/.test(app) && /wakeup4\.mp3/.test(app)],
  ['playGlassRoute rotates wakeup via nextWakeup', /playLandingMusic\?\.\(`media\/\$\{nextWakeup\(\)\}`/.test(playGlassRoute)],
  ['playGlassRoute no longer plays landing.mp3', !/landing\.mp3/.test(playGlassRoute)],
  ['doLand does not start wakeup as a crushed startWakeupBed', !/startWakeupBed\?\.?\(/.test(doLand)],
  ['landing music stays through weather fade-out', /fadeOutLandingMusic/.test(doLand)],
  ['landing PA restores the bed after speech', /restoreBed:\s*true/.test(doLand) && /restoreBed/.test(playBroadcast)],
  ['arrival PA plays captain.mp3 first then AI voice', /skipCaptainIntro:\s*false/.test(doLand)],
  ['arrival PA cancels descent chime before AI voice', /landingCueGen \+= 1/.test(doLand)],
  ['muteCeremonyBedForSpeech fades the bed quieter', /fadeLandingBedVolume/.test(muteCeremonyBedForSpeech)],
  ['muteCeremonyBedForSpeech does not pause landing music', !/\.pause\(\)/.test(muteCeremonyBedForSpeech)],
  ['restoreCeremonyBed brings landing music back up', restoreCeremonyBed.includes('landingVolume')],
  ['playCaptainBroadcast restores the bed when restoreBed is true', /if \(restoreBed\) await restoreCeremonyBed/.test(playCaptainBroadcast)],
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
