const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../public/kiosk-session.js');
function locks() {
 let tail=Promise.resolve();
 return {request:(_name,fn)=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;}};
}
function env(shared,device=true) {
 const events=new Map();let timeout;
 return {
  navigator:{locks:shared}, FlightDeviceControls:{shouldProbeLocalBridge:()=>device},
  setTimeout:fn=>{timeout=fn;return 1},clearTimeout:()=>{timeout=null},
  addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key),
  pending:()=>timeout?.(),close:()=>events.get('pagehide')?.(),
  restore:()=>events.get('pageshow')?.({persisted:true}),location:{reload(){this.reloaded=true;}},
 };
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('two tabs polling the same device initialize only one flight/audio controller',async()=>{
 const shared=locks(),a=env(shared),b=env(shared);let starts=0,waits=0;
 const first=run(a,()=>{starts++});const second=run(b,()=>{starts++},()=>{waits++});
 await tick();b.pending();assert.equal(starts,1);assert.equal(waits,1);
 a.close();await first;await tick();assert.equal(starts,2);
 b.close();await second;
});
test('startup failure releases ownership so the next window can start',async()=>{
 const shared=locks(),a=env(shared),b=env(shared);let starts=0;
 const failed=run(a,()=>{throw new Error('boot failed')});
 const next=run(b,()=>{starts++});await assert.rejects(failed,/boot failed/);
 await tick();assert.equal(starts,1);b.close();await next;
});
test('closing while startup is pending cannot leave an orphan lock',async()=>{
 const shared=locks(),a=env(shared),b=env(shared);let finish,starts=0;
 const first=run(a,()=>new Promise(r=>{finish=r}));await tick();a.close();finish();
 const next=run(b,()=>{starts++});await first;await tick();assert.equal(starts,1);b.close();await next;
});
test('ordinary phone/desktop visitors remain independent',async()=>{
 const e=env(locks(),false);let starts=0;
 await Promise.all([run(e,()=>starts++),run(e,()=>starts++)]);assert.equal(starts,2);
});
test('pagehide stops old audio before a waiting tab takes over',async()=>{
 const a=env(locks());const stopped=[];
 a.BroadcastAudio={stopPlayback:()=>stopped.push('speech'),stopTowerSignalLoop:()=>stopped.push('tower'),stopFlightSfx:()=>stopped.push('sfx'),stopLandingMusic:()=>stopped.push('music')};
 const session=run(a,()=>{});await tick();a.close();await session;
 assert.deepEqual(stopped,['speech','tower','sfx','music']);
});
test('history restoration reloads before reusing the old initialized controller',async()=>{
 const a=env(locks());const session=run(a,()=>{});await tick();a.close();await session;
 a.restore();assert.equal(a.location.reloaded,true);
});
