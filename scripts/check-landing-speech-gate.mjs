/**
 * Landing ceremony must wait for captain TTS to finish before landing.mp4 / takeoff.mp3.
 * Run: node scripts/check-landing-speech-gate.mjs
 */
import { readFile } from 'node:fs/promises';

const [app, audio] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/broadcast-audio.js', import.meta.url), 'utf8'),
]);

const checks = [
  ['waitForSpeechComplete helper exists', audio.includes('function waitForSpeechComplete')],
  ['isSpeechActive helper exists', audio.includes('function isSpeechActive')],
  ['BroadcastAudio exports waitForSpeechComplete', audio.includes('waitForSpeechComplete,')],
  ['Web Audio end uses audio clock, not wall-clock cut', audio.includes('ctx.currentTime') && audio.includes('endAt') && !/setTimeout\(\(\) => finish\(true\), timerMs\)/.test(audio)],
  ['bridge waits for speech before stopping', /async function bridgeAfterCaptainBroadcast\([\s\S]*?waitForSpeechComplete/.test(app)],
  ['bridge does not stopPlayback before wait', (() => {
    const start = app.indexOf('async function bridgeAfterCaptainBroadcast()');
    const end = app.indexOf('async function playLandingApproach()', start);
    if (start < 0 || end < 0) return false;
    const body = app.slice(start, end);
    const waitAt = body.indexOf('waitForSpeechComplete({');
    const stopAt = body.indexOf('stopPlayback?.(');
    return waitAt >= 0 && (stopAt < 0 || waitAt < stopAt);
  })()],
  ['doLand plays broadcast before landing approach', (() => {
    const landFn = app.slice(app.indexOf('async function doLand()'));
    const iBroadcast = landFn.indexOf('landed.captainBroadcast');
    const iBridge = landFn.indexOf('await bridgeAfterCaptainBroadcast()');
    const iApproach = landFn.indexOf('playLandingApproach()');
    return iBroadcast >= 0 && iBridge > iBroadcast && iApproach > iBridge;
  })()],
  ['playBroadcastWithWave settles until speech idle', /async function playBroadcastWithWave[\s\S]*?waitForSpeechComplete/.test(app)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\n✓ landing speech gate checks passed');
}
