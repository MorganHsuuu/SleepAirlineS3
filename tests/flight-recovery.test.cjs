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
