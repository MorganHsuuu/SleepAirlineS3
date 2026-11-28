'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, content) => {
  const node=document.createElement(tag);
  if(cls) node.className=cls;
  if(content!=null) node.textContent=content;
  return node;
};
const icon = (name) => {
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  const use=document.createElementNS(ns,'use');
  svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');
  use.setAttribute('href','#i-'+name);svg.append(use);
  return svg;
};
const date = () => Date.now();
const id = () => crypto.randomUUID();
const base = '/api/extended/personal';
const storage = {
  read(name) { try { return localStorage.getItem(name); } catch { return null; } },
  write(name,value) { try { localStorage.setItem(name,value); } catch { /* private window */ } },
};
const demoStation = {
  id:'kathmandu',owner:'you',member:'平行的自己',name:'加德滿都',country:'尼泊爾',
  timezone:'Asia/Kathmandu',lat:27.7172,lon:85.324,origin:[121.5654,25.033],arrived:date()-45*60_000,
};
const demoReply = [
  '奶茶還剩半杯。門外有人把椅子搬回巷口，椅腳一落地，我才發現雨真的停了。',
  '出店門才發現鞋底黏了一小張濕紙。我坐回門檻上弄了半天，老闆還替我把杯子留著。',
  '把杯子送回櫃檯後，我才沿著那條濕巷慢慢走。一輛腳踏車從身邊經過，水滴一路跳。',
];
const demoStart = [{
  id:'demo-scene',kind:'ai',created:date()-21*60_000,labelTime:'16:20',
  text:'雨停了。我在佛塔旁的小店喝奶茶，店門一開，整條巷子都聞得到濕磚頭的味道。',
  photo:'/extended/kathmandu.jpg',
}];
function demoState() {
  let saved;
  try { saved=JSON.parse(storage.read('sa-extended-demo-personal') || '{}'); } catch { saved={}; }
  const messages=Array.isArray(saved.messages)&&saved.messages.length ? saved.messages : demoStart;
  return {station:demoStation,note:typeof saved.note==='string'?saved.note:'',messages,canNote:true,ai:true};
}
const demoArchives = [
  {
    item:{reference:'demo-ubud',name:'烏布',country:'印尼',timezone:'Asia/Makassar',arrived:date()-29*3600_000,photo:'/extended/ubud-demo.jpg'},
    station:{...demoStation,id:'demo-ubud',name:'烏布',country:'印尼',timezone:'Asia/Makassar',lat:-8.5098,lon:115.2654},
    note:'降落後想記得這裡午後的光。',
    messages:[{id:'ubud-story',kind:'ai',created:date()-29*3600_000,labelTime:'14:05',text:'在走廊邊點了冰檸檬茶，杯墊上有一輛歪歪的腳踏車。'}],
  },
  {
    item:{reference:'demo-tokyo',name:'東京',country:'日本',timezone:'Asia/Tokyo',arrived:date()-53*3600_000,photo:null},
    station:{...demoStation,id:'demo-tokyo',name:'東京',country:'日本',timezone:'Asia/Tokyo',lat:35.6762,lon:139.6503},
    note:'',
    messages:[{id:'tokyo-story',kind:'ai',created:date()-53*3600_000,text:'在月台等了一班車，從車窗看見一排小小的燈。'}],
  },
];
const demoTimeline = [{...demoStation,reference:'demo-current',photo:demoStart[0].photo,stationId:demoStation.id},...demoArchives.map((a)=>a.item)];
let mode='demo', state=demoState(), busy=false, pending=null, retry=null;
let archive=null, historyCursor=null, timelineItems=demoTimeline, timelineBusy=false, timelineLoaded=true;
let historyView=0, historyList=0;
const missingPhotos=new Set();
const globe=window.ExtendedGlobe(() => goToChat());
function syncTheme(theme) {
  document.body.dataset.theme=theme;
  const button=$('theme');
  button.replaceChildren(icon(theme==='night'?'sun':'moon'));
  button.setAttribute('aria-label',theme==='night'?'切換日航配色':'切換夜航配色');
  globe.repaint();
}
syncTheme(storage.read('sa-extended-visual')==='night'?'night':'day');
$('theme').onclick=() => {
  const theme=document.body.dataset.theme==='night'?'day':'night';
  storage.write('sa-extended-visual',theme);syncTheme(theme);
};
function saveDemo() {
  storage.write('sa-extended-demo-personal',JSON.stringify({note:state.note,messages:state.messages.slice(-25)}));
}
function timeString(at,timezone,includeDay=false) {
  if(!Number.isFinite(at)) return '';
  try {
    return new Intl.DateTimeFormat('zh-TW',{
      timeZone:timezone||undefined,hour:'2-digit',minute:'2-digit',hourCycle:'h23',
      ...(includeDay?{month:'numeric',day:'numeric'}:{}),
    }).format(at);
  } catch { return ''; }
}
function feedback(element,text,ok=false) {
  $(element).textContent=text;
  $(element).classList.toggle('ok',ok);
}
function goToChat() {
  const section=$('conversation');
  if (matchMedia('(max-width:780px)').matches) section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});
  else $('chat-scroll').focus({preventScroll:true});
}
$('station-card').onclick=() => { const station=archive?archive.station:state.station;if(station) globe.focus(station);goToChat(); };
function photoCard(url,landing=false) {
  const wrap=el('div');
  const btn=el('button','photo-card');
  btn.type='button';btn.setAttribute('aria-label','放大旅行照片');
  const photo=el('img');photo.src=url;photo.alt=landing?'這次降落的照片':'旅行訊息的照片';photo.decoding='async';
  photo.addEventListener('error',()=>{wrap.hidden=true;},{once:true});
  btn.append(photo,icon('expand'));
  btn.onclick=() => { $('lightbox-image').src=url;$('lightbox').showModal(); };
  wrap.append(btn,el('span','photo-label',landing?'降落風景':'AI 生成照片'));
  return wrap;
}
function renderMessage(message) {
  const mine=message.kind==='human';
  const row=el('article','message'+(mine?' mine':''));
  const avatar=el('span','avatar');
  avatar.append(icon(mine?'user':'spark'));
  const pack=el('div','pack'), meta=el('div','metadata',mine?'你':'AI 分身');
  const stamp=message.labelTime || timeString(message.created,(archive?.item||state.station)?.timezone);
  if(stamp) meta.append(el('time','',stamp));
  const bubble=el('div','bubble');
  if(message.noteMessage) {
    const label=el('div','note-label');label.append(icon('note'),'降落筆記');
    bubble.append(label);
  }
  bubble.append(el('p','',message.text));
  if(message.photo) bubble.append(photoCard(message.photo));
  pack.append(meta,bubble);row.append(avatar,pack);
  return row;
}
function renderTyping() {
  const row=el('div','message typing'), avatar=el('span','avatar'), pack=el('div','pack'), bubble=el('div','bubble');
  row.setAttribute('aria-label','正在產生回覆');
  avatar.append(icon('spark'));
  for(let i=0;i<3;i++) bubble.append(el('i'));
  pack.append(bubble);row.append(avatar,pack);
  return row;
}
function render(scrollToEnd=false) {
  const {station,messages}=archive||state;
  const place=archive?.item||station;
  $('chat-title').textContent=archive?'旅程回顧':'平行的自己';
  $('latest').hidden=!archive;
  $('quick-row').hidden=Boolean(archive);
  $('composer').hidden=Boolean(archive);
  $('note-open').lastElementChild.textContent=archive?'查看筆記':'降落筆記';
  const holder=$('landing-photo');
  holder.replaceChildren();
  if(archive?.item.photo&&!missingPhotos.has(archive.item.reference)) {
    const figure=el('div','landing-card');
    const heading=el('h3');
    heading.append(icon('photo'),'這次降落的照片');
    figure.append(heading,photoCard(archive.item.photo,true));
    figure.querySelector('img').addEventListener('error',()=>{holder.replaceChildren();},{once:true});
    holder.append(figure);
  }
  const latest=messages.findLast((m)=>m.kind==='ai');
  const picked=station && {...station,story:latest};
  globe.set(picked?[picked]:[],picked?.id);
  $('source').textContent=mode==='live'?'個人旅程 · Notion 航班':'示範旅程';
  $('account-label').textContent=mode==='live'?'登出':'連接旅程';
  $('chat-place').textContent=place ? [place.name,place.country].filter(Boolean).join('・') : '等待下一次降落';
  $('station-card').hidden=!place;
  $('note-open').disabled=archive?!archive.note:!state.canNote;
  $('station-name').textContent=place?.name||'';
  $('station-detail').textContent=place?(mode==='demo'&&!archive?'示範航點':(timeString(place.arrived,place.timezone,true)+' 抵達')):'';
  $('chat-date').firstElementChild.textContent=place?(mode==='demo'&&!archive?'加德滿都・旅行近況':timeString(place.arrived,place.timezone,true)+' 降落'):'';
  $('ask').disabled=busy||!station||!state.ai;
  $('message').disabled=!station||!state.ai;
  $('send').disabled=busy||!station||!state.ai;
  const photoMessage=messages.findLast((m)=>m.kind==='ai'&&m.sceneAvailable);
  $('photo').hidden=mode!=='live'||!state.ai||!photoMessage||Boolean(photoMessage.photo);
  $('photo').disabled=busy;
  const scroll=$('chat-scroll');
  const prev=scroll.scrollTop;
  const rows=messages.map(renderMessage);
  if(!archive&&pending) rows.push(renderMessage(pending));
  if(!archive&&busy&&pending!==false) rows.push(renderTyping());
  if(!rows.length) {
    const msg=archive?'這趟航班當時沒有留下對話。':station?(state.ai?'你可以寫一則降落筆記，或直接和分身說話。':'目前無法連接 AI，你仍可儲存降落筆記。'):'完成降落後，你可以在這裡和分身聊天、寫下筆記。';
    rows.push(el('p','empty',msg));
  }
  $('messages').replaceChildren(...rows);
  scroll.scrollTop=scrollToEnd ? scroll.scrollHeight : prev;
}
async function request(path, body) {
  const response=await fetch(base+path,body===undefined?{cache:'no-store'}:{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  if(!response.ok) {
    const result=await response.json().catch(()=>({}));
    throw new Error(result.error||'目前無法連線，請稍後再試。');
  }
  return response.json();
}
async function bootLive() {
  const next=await request('/state');
  state=next;mode='live';retry=null;archive=null;
  resetTimeline();
  void loadTimeline();
  $('login').close();
  if(state.station) globe.focus(state.station);
  render(false);
  if(state.station&&state.ai&&!state.messages.length) await turn('greeting');
}
function makeDemoResponse(action) {
  if(action==='note') return '你剛記下的那一刻，我想陪你再留一下。這邊雨聲剛停，我把冰涼的杯子往桌裡挪了一點，窗外還能聽見水滴。';
  const index=state.messages.filter((m)=>m.kind==='ai').length-1;
  return demoReply[index] || '奶茶喝完了，我沿著剛才那條巷子慢慢走，等你下次再來找我。';
}
async function turn(action,text='') {
  if(archive||busy||!state.station||!state.ai) return;
  const token=retry?.action===action&&retry?.text===text ? retry.key : id();
  const now=date();
  pending=action==='chat'?{id:token,kind:'human',text,created:now}:
    action==='note'?{id:token,kind:'human',text:'我剛寫好這次的降落筆記。',created:now,noteMessage:true}:null;
  busy=true;feedback('chat-feedback','');render(true);
  try {
    if(mode==='live') {
      const result=await request('/turn',{station:state.station.id,key:token,text,action});
      state.messages=result.messages;
    } else {
      await new Promise((resolve)=>setTimeout(resolve,750));
      if(pending) state.messages.push(pending);
      state.messages.push({id:id(),kind:'ai',text:makeDemoResponse(action),created:date()});
      saveDemo();
    }
    retry=null;
    if(action==='note') feedback('chat-feedback',mode==='live'?'筆記已儲存至 Notion。':'示範筆記已儲存。',true);
    if(action==='chat'&&$('message').value.trim()===text) $('message').value='';
  } catch(error) {
    retry={key:token,action,text};
    feedback('chat-feedback',action==='note'?'筆記已儲存，這次沒取得分身回覆。':error.message);
  } finally {
    pending=null;busy=false;render(true);
  }
}
$('ask').onclick=()=>turn('chat','你在幹嘛？');
$('composer').onsubmit=(event)=>{
  event.preventDefault();
  const text=$('message').value.trim();
  if(text) void turn('chat',text);
};
$('photo').onclick=async ()=>{
  if(busy||mode!=='live') return;
  const latest=state.messages.findLast((m)=>m.kind==='ai'&&m.sceneAvailable);
  if(!latest||latest.photo) return;
  busy=true;pending=false;feedback('chat-feedback','');render(false);
  try {
    const result=await request('/photo',{station:state.station.id,id:latest.id});
    state.messages=result.messages;
  } catch(error) { feedback('chat-feedback',error.message); }
  finally { busy=false;pending=null;render(false); }
};
$('note-open').onclick=()=>{
  if(!archive&&(!state.station||!state.canNote)) return;
  $('note-destination').textContent=archive?archive.item.name:
    [state.station.name,mode==='live'?'儲存到這筆 Notion 航班':'示範筆記儲存在此裝置'].join(' · ');
  $('note-text').value=archive?.note??state.note;
  $('note-text').readOnly=Boolean(archive);
  $('note-label').textContent=archive?'當時的筆記':'想記下什麼？';
  $('note-help').hidden=Boolean(archive);
  $('note-form').querySelector('button[type=submit]').hidden=Boolean(archive);
  feedback('note-feedback','');
  $('note').showModal();
};
$('note-form').onsubmit=async (event)=>{
  event.preventDefault();
  const submit=event.submitter, note=$('note-text').value.trim();
  if(archive) return;
  if(note===state.note) { $('note').close();return; }
  if(busy) return;
  submit.disabled=true;
  try {
    const result=mode==='live'
      ? await request('/note',{note,previous:state.note,station:state.station.id})
      : {note};
    state.note=result.note;
    if(mode==='demo') saveDemo();
    $('note').close();
    feedback('chat-feedback',mode==='live'?'筆記已儲存至 Notion。':'示範筆記已儲存。',true);
    if(note&&state.ai) await turn('note');
  } catch(error) { feedback('note-feedback',error.message); }
  finally { submit.disabled=false; }
};
$('account').onclick=async ()=>{
  if(mode==='demo') {
    feedback('login-feedback','');
    $('login').showModal();
    return;
  }
  if(busy) return;
  try {
    await request('/logout',{});
    mode='demo';state=demoState();retry=null;pending=null;archive=null;resetTimeline();renderTimeline();feedback('chat-feedback','');
    globe.focus(state.station);render();
  } catch(error) { feedback('chat-feedback',error.message); }
};
$('login-form').onsubmit=async (event)=>{
  event.preventDefault();
  const submit=event.submitter;submit.disabled=true;
  try {
    await request('/session',Object.fromEntries(new FormData(event.target)));
    event.target.reset();
    await bootLive();
  } catch(error) { feedback('login-feedback',error.message); }
  finally { submit.disabled=false; }
};
function resetTimeline() {
  ++historyList;++historyView;
  timelineItems=mode==='demo'?demoTimeline:[];
  timelineLoaded=mode==='demo';
  timelineBusy=false;historyCursor=null;missingPhotos.clear();
  renderTimeline();
}
function timelineDay(at) {
  const day=new Date(at);
  const key=[day.getFullYear(),day.getMonth()+1,day.getDate()].join('-');
  return {key,title:(day.getMonth()+1)+'月'+day.getDate()+'日',
    year:day.getFullYear()+' · '+new Intl.DateTimeFormat('zh-TW',{weekday:'short'}).format(day)};
}
function makeEntry(item) {
  const entry=el('button','glass timeline-entry');
  entry.type='button';
  entry.setAttribute('aria-pressed',String(archive?.item.reference===item.reference));
  entry.setAttribute('aria-label',item.name+'，'+timelineDay(item.arrived).title+'降落，打開旅程');
  entry.onclick=()=>openJourney(item);
  const preview=el('span','timeline-preview'), empty=el('span','timeline-placeholder');
  empty.append(icon('photo'));
  preview.append(empty);
  const unavailable=()=>empty.append(el('span','','沒有降落照片'));
  if(item.photo&&!missingPhotos.has(item.reference)) {
    const picture=el('img');picture.alt='';picture.loading='lazy';picture.decoding='async';
    picture.addEventListener('load',()=>{empty.hidden=true;},{once:true});
    picture.addEventListener('error',()=>{missingPhotos.add(item.reference);picture.remove();unavailable();},{once:true});
    picture.src=item.photo;
    preview.append(picture);
  } else unavailable();
  const copy=el('span','timeline-copy');
  copy.append(el('strong','',item.name),el('small','',item.country),
    el('small','timeline-time',(timeString(item.arrived,item.timezone)||'')+(item.timezone?' 目的地時間':' 降落')));
  entry.append(preview,copy,icon('arrow'));
  return entry;
}
function renderTimeline() {
  const days=new Map();
  for(const item of timelineItems) {
    const day=timelineDay(item.arrived);
    if(!days.has(day.key)) days.set(day.key,{...day,items:[]});
    days.get(day.key).items.push(item);
  }
  const rows=[...days.values()].map((day)=>{
    const date=el('h3','timeline-date',day.title);
    date.append(el('small','',day.year));
    const entries=el('div','timeline-entries');
    for(const item of day.items) entries.append(makeEntry(item));
    const row=el('div','timeline-day');
    row.append(date,entries);
    return row;
  });
  if(!rows.length&&timelineLoaded) rows.push(el('p','empty','完成降落後，航班與照片會依日期出現在這裡。'));
  $('timeline-days').replaceChildren(...rows);
  $('older').hidden=mode!=='live'||(timelineLoaded&&!historyCursor);
  $('older').disabled=timelineBusy;
  $('older').lastChild.textContent=timelineLoaded?' 載入更早旅程':' 讀取旅程';
}
async function loadTimeline() {
  if(mode!=='live'||timelineBusy||(timelineLoaded&&!historyCursor)) return;
  const cursor=historyCursor;
  const version=historyList;
  timelineBusy=true;
  feedback('timeline-feedback','');
  $('older').disabled=true;
  try {
    const data=await request('/journeys'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
    if(version!==historyList) return;
    const all=new Map(timelineItems.map((row)=>[row.reference,row]));
    for(const item of data.items) all.set(item.reference,item);
    timelineItems=[...all.values()];
    timelineLoaded=true;historyCursor=data.next;
  } catch(error) { if(version===historyList) feedback('timeline-feedback',error.message); }
  finally {
    if(version===historyList) { timelineBusy=false;renderTimeline(); }
  }
}
$('older').onclick=loadTimeline;
function returnLatest() {
  ++historyView;
  archive=null;
  if(state.station) globe.focus(state.station);
  render();renderTimeline();
}
$('latest').onclick=returnLatest;
async function openJourney(item) {
  const version=++historyView, source=mode;
  feedback('timeline-feedback','');
  try {
    const picked=source==='live' ? await request('/journey?ref='+encodeURIComponent(item.reference)):
      item.reference==='demo-current'?{item,station:state.station,note:state.note,messages:state.messages.slice()}:
      demoArchives.find((journey)=>journey.item.reference===item.reference);
    if(version!==historyView||source!==mode||!picked) return;
    archive=picked;
    if(archive.station) globe.focus(archive.station);
    render();renderTimeline();
    $('chat-scroll').scrollTop=0;
    $('conversation').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
  } catch(error) { if(version===historyView) feedback('timeline-feedback',error.message); }
}
document.querySelectorAll('[data-close]').forEach((button)=>button.onclick=()=>$(button.dataset.close).close());
render();renderTimeline();
void request('/status').then((result)=>{if(result.authenticated) return bootLive();}).catch(()=>{});
