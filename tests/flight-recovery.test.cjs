const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const takeoff = section('async function doTakeoff()', 'async function requestPreviewScenery');
const recovery = section('async function recoverActiveFlight(', 'function setCeremony(');
function fixture() {
  const notices = [], calls = [];
  const state = {stage:'ready', busy:false, mode:'live', sound:false, profile:{passengerId:'PAX-TEST'}, origin:{name:'臺北'}, direction:0};
  const ctx = {state, window:{BroadcastAudio:{}}, BroadcastAudio:{}, console:{error(){}},
    $:()=>({value:'northbound',textContent:''}), ensureGuestProfile(){}, hasResearchConsent:()=>true,
    render(){}, setShade(){}, setInflightStandby(){}, clearTimeout(){}, compassTimer:null,
    hideGlassPanel(){}, directions:[{name:'向北'}], flightBody:()=>({passengerId:'PAX-TEST'}),
    Intl, Date, Promise, encodeURIComponent, delay:async()=>{}, locationFromFlight:()=>({name:'臺北'}),
    setCeremony(){}, hideCeremony(){}, setScene(){}, applyDestinationSky:async()=>{}, destinationFor:()=>({}),
    fetchBoard:async()=>{}, showFlightNotice:m=>notices.push(m),
    rememberFlightView(){calls.push('remember');},
    flightKey(flight){ return flight?.flightId || ''; },
    applyStoredScenery(){ calls.push('scenery'); return Promise.resolve(); },
    adoptInFlight(f){state.stage='cruise'; state.activeFlight=f; calls.push('restore');},
    adoptLanded(f){state.stage='landed'; state.lastFlight=f; calls.push('landed');},
  };
  vm.createContext(ctx); vm.runInContext(recovery + takeoff, ctx);
  return {ctx,state,notices,calls};
}
test('normal takeoff releases busy so a subsequent landing can run',async()=>{
 const f=fixture(); f.ctx.api=async()=>({flight:{flightId:'F1',takeoffTime:new Date().toISOString(),takeoffBroadcast:'歡迎'}});
 await f.ctx.doTakeoff(); assert.equal(f.state.stage,'cruise'); assert.equal(f.state.busy,false);
});
test('409 or lost response after server creation restores existing flight instead of ready',async()=>{
 for(const reason of ['already_in_flight','Failed to fetch']) {
  const f=fixture(); f.ctx.api=async(method,path)=>{
   if(path.includes('/progress')) return {activeFlight:{flightId:'F1'}};
   throw new Error(reason);
  };
  await f.ctx.doTakeoff(); assert.equal(f.state.stage,'cruise'); assert.equal(f.state.busy,false);
  assert.equal(f.state.activeFlight.flightId,'F1'); assert.deepEqual(f.calls,['restore','remember']);
 }
});
test('genuine takeoff failure stays actionable and includes original reason',async()=>{
 const f=fixture(); f.ctx.api=async(method,path)=>{if(path.includes('/progress')) return {activeFlight:null}; throw new Error('Notion unavailable');};
 await f.ctx.doTakeoff(); assert.equal(f.state.stage,'ready'); assert.equal(f.state.busy,false);
 assert.match(f.notices.at(-1),/Notion unavailable/);
});
test('boot sync cannot replace a passenger or interrupt a new transition',async()=>{
 const f=fixture(); f.ctx.api=async()=>({activeFlight:{flightId:'F1'}});
 f.state.busy=true; assert.equal(await f.ctx.recoverActiveFlight('PAX-TEST',true),false);
 f.state.busy=false; assert.equal(await f.ctx.recoverActiveFlight('PAX-OTHER'),false);
 assert.equal(f.state.stage,'ready');
});
test('landing reconciliation accepts only the exact flight and current passenger',async()=>{
 const f=fixture(); f.ctx.api=async()=>({lastLandedFlight:{flightId:'F1'}});
 assert.equal(await f.ctx.recoverLandingFlight('PAX-TEST','OLD'),false);
 assert.equal(await f.ctx.recoverLandingFlight('PAX-OTHER','F1'),false);
 assert.equal(await f.ctx.recoverLandingFlight('PAX-TEST','F1'),true);
 assert.equal(f.state.stage,'landed');
});
test('direct landing cannot interrupt takeoff or another busy operation',async()=>{
 const f=fixture(); vm.runInContext(section('async function doLand()', 'async function submitSleepReport'),f.ctx);
 f.state.stage='takeoff'; f.state.busy=true; await f.ctx.doLand(); assert.equal(f.state.stage,'takeoff');
 f.state.stage='cruise'; await f.ctx.doLand(); assert.equal(f.state.stage,'cruise');
});
test('late boot response cannot resurrect a flight completed while the lookup was pending',async()=>{
 const f=fixture();let resolve;
 f.ctx.api=()=>new Promise(r=>{resolve=r;});
 const pending=f.ctx.recoverActiveFlight('PAX-TEST',true);
 f.state.stage='landed'; f.state.lastFlight={flightId:'F1'};
 resolve({activeFlight:{flightId:'F1'}});
 assert.equal(await pending,false); assert.equal(f.state.stage,'landed');
 assert.deepEqual(f.calls,[]);
});
test('boot restores an in-flight Notion trip for the paired device',async()=>{
 const f=fixture();
 f.ctx.api=async()=>({activeFlight:{flightId:'F-AIR'}, lastLandedFlight:null});
 assert.equal(await f.ctx.recoverPairedFlight('PAX-TEST',true),true);
 assert.equal(f.state.stage,'cruise');
 assert.equal(f.state.activeFlight.flightId,'F-AIR');
});
test('boot restores the last landed Notion trip when nothing is in the air',async()=>{
 const f=fixture();
 f.ctx.api=async()=>({activeFlight:null, lastLandedFlight:{flightId:'F-LAND', arrivalLocation:'東京, 日本'}});
 assert.equal(await f.ctx.recoverPairedFlight('PAX-TEST',true),true);
 assert.equal(f.state.stage,'landed');
 assert.equal(f.state.lastFlight.flightId,'F-LAND');
 assert.ok(f.calls.includes('landed'));
});
test('boot replaces a cached cruise view with the landed Notion trip',async()=>{
 const f=fixture();
 f.state.stage='cruise'; f.state.activeFlight={flightId:'F-OLD'};
 f.ctx.api=async()=>({activeFlight:null, lastLandedFlight:{flightId:'F-LAND'}});
 assert.equal(await f.ctx.recoverPairedFlight('PAX-TEST',true),true);
 assert.equal(f.state.stage,'landed');
 assert.equal(f.state.lastFlight.flightId,'F-LAND');
});
test('takeoff recovery still ignores a previous landing when no flight is in the air',async()=>{
 const f=fixture();
 f.ctx.api=async()=>({activeFlight:null, lastLandedFlight:{flightId:'F-LAND'}});
 assert.equal(await f.ctx.recoverActiveFlight('PAX-TEST'),false);
 assert.equal(f.state.stage,'ready');
});

const hydrateSrc = section('let pairedHydrate =', 'function ensureGuestProfile(');
const restoreSrc = section('async function restoreNotionFlight(', 'function revealApp(');
function hydrateFixture() {
  const calls = [];
  const state = {
    stage:'ready', busy:false, mode:'live', profile:{passengerId:'PAX-TEST', name:'旅人', groupId:'0001'},
    activeFlight:null, lastFlight:null, origin:{name:'臺北'}, destination:null, direction:0,
  };
  const ctx = {
    state, console:{error(){}}, Promise, encodeURIComponent,
    hasResearchConsent:()=>true,
    resolvePairedPassengerName:(_id, incoming, current)=> (incoming && incoming !== '旅人' ? incoming : current.name),
    rememberPairedProfile(profile){ state.profile = profile; calls.push('profile:'+profile.name); },
    flightKey(flight){ return flight?.flightId || ''; },
    adoptInFlight(f){ state.stage='cruise'; state.activeFlight=f; state.lastFlight=null; calls.push('restore'); },
    adoptLanded(f){ state.stage='landed'; state.lastFlight=f; state.activeFlight=null; calls.push('landed'); },
    rememberFlightView(){ calls.push('remember'); },
    applyStoredScenery(){ calls.push('scenery'); return Promise.resolve(); },
    loadWeather:async()=>null,
    showWeatherCard(){},
    applyPassengerOrigin(){ calls.push('origin'); },
    directions:[{name:'向北'}],
    showToast(){},
    showFlightNotice(){},
    refreshProgress:async()=>({activeFlight:null}),
  };
  vm.createContext(ctx);
  vm.runInContext(recovery + hydrateSrc + restoreSrc, ctx);
  return {ctx,state,calls};
}
test('reboot hydrates an in-flight Notion trip through passenger lookup',async()=>{
 const f=hydrateFixture();
 f.ctx.api=async(method,path)=>{
  if (method==='POST' && path==='/api/passenger') return {passenger:{name:'Morgan',groupId:'0001'}, activeFlight:{flightId:'F-AIR'}, lastLandedFlight:null};
  return {activeFlight:null, lastLandedFlight:null};
 };
 assert.equal(await f.ctx.hydratePairedPassenger('PAX-TEST'),true);
 assert.equal(f.state.stage,'cruise');
 assert.equal(f.state.profile.name,'Morgan');
});
test('reboot hydrates the last landed Notion trip through passenger lookup',async()=>{
 const f=hydrateFixture();
 f.ctx.api=async(method)=>{
  if (method==='POST') return {passenger:{name:'Morgan'}, activeFlight:null, lastLandedFlight:{flightId:'F-LAND'}};
  return {activeFlight:null};
 };
 assert.equal(await f.ctx.hydratePairedPassenger('PAX-TEST'),true);
 assert.equal(f.state.stage,'landed');
 assert.equal(f.state.lastFlight.flightId,'F-LAND');
});
test('reboot falls back to progress when passenger lookup has no flight payload',async()=>{
 const f=hydrateFixture();
 f.ctx.api=async(method,path)=>{
  if (method==='POST') return {passenger:{name:'Morgan'}, activeFlight:null, lastLandedFlight:null};
  if (String(path).includes('/progress')) return {activeFlight:null, lastLandedFlight:{flightId:'F-LAND'}};
  return {};
 };
 assert.equal(await f.ctx.hydratePairedPassenger('PAX-TEST'),true);
 assert.equal(f.state.stage,'landed');
});
test('reboot Notion landing overrides a cached cruise after empty passenger payload',async()=>{
 const f=hydrateFixture();
 f.state.stage='cruise'; f.state.activeFlight={flightId:'F-OLD'};
 f.ctx.api=async(method,path)=>{
  if (method==='POST') return {passenger:{name:'Morgan'}, activeFlight:null, lastLandedFlight:null};
  if (String(path).includes('/progress')) return {activeFlight:null, lastLandedFlight:{flightId:'F-LAND'}};
  return {};
 };
 assert.equal(await f.ctx.hydratePairedPassenger('PAX-TEST'),true);
 assert.equal(f.state.stage,'landed');
 assert.equal(f.state.lastFlight.flightId,'F-LAND');
});
