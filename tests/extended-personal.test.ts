import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import OpenAI from 'openai';
import routes from '../src/lib/extended/personal';
import { getNotionClient } from '../src/lib/notion/client';

test('personal diary and archived journeys stay scoped to the signed-in traveler', async (t) => {
  const passengerId='PAX-TESTPERSONAL';
  const code='synthetic-code-test-only-with-enough-length';
  const codeHash=createHash('sha256').update(code).digest('hex');
  Object.assign(process.env,{
    NOTION_API_KEY:'mock-notion',NOTION_DASHBOARD_DB_ID:'mock-flight-log',SLEEP_AIRLINE_DATA_MODE:'live',
    OPENAI_API_KEY:'mock-openai',EXTENDED_SESSION_SECRET:'mock-personal-secret-at-least-32-characters',
    EXTENDED_MEMBERS_JSON:JSON.stringify([{passengerId,alias:'測試旅人',codeHash}]),
  });
  const notion=getNotionClient();
  const text=(plain_text:string)=>({rich_text:[{plain_text}]});
  const date=(at:string)=>({date:{start:at}});
  const page={
    id:'mock-landing-page',properties:{
      'Passenger ID':text(passengerId),'Flight ID':text('mock-flight'),
      'Status':{select:{name:'landed'}},'Takeoff Time':date('2026-11-26T10:00:00Z'),
      'Landing Time':date('2026-11-27T02:00:00Z'),'Arrival Location':text('Ubud, Indonesia'),
      'Arrival Longitude':{number:115.2654},'Arrival Latitude':{number:-8.5098},
      'Departure Longitude':{number:121.5},'Departure Latitude':{number:25},
      'Immigration Note':{type:'rich_text',...text('原本的筆記')},
      'Files & media':{files:[{type:'file',file:{url:'https://images.example/landing.jpg'}}]},
    },
  };
  const blocks: Array<Record<string, unknown>>=[];
  const past={
    id:'mock-previous-page',properties:{...page.properties,
      'Flight ID':text('old-flight'),'Landing Time':date('2026-11-25T02:00:00Z'),
      'Arrival Latitude':{number:null},'Immigration Note':text('舊航班筆記'),
    },
  };
  const unrelated={...past,id:'someone-else',properties:{...past.properties,'Passenger ID':text('PAX-NOTTHEOWNER')}};
  t.mock.method(notion.databases,'query',async (args:{page_size:number;start_cursor?:string})=>{
    if(args.page_size===6) return args.start_cursor
      ? {results:[past,unrelated],next_cursor:null}
      : {results:[page],next_cursor:'test-cursor'};
    return {results:[page],next_cursor:null};
  });
  t.mock.method(notion.pages,'retrieve',async ({page_id}:{page_id:string}) =>
    page_id===page.id?page:past);
  t.mock.method(notion.blocks.children,'list',async ({block_id}:{block_id:string})=>{
    assert([page.id,past.id].includes(block_id));
    return {results:block_id===page.id?blocks:[],next_cursor:null};
  });
  t.mock.method(notion.blocks.children,'append',async ({block_id,children}:{block_id:string;children:Array<Record<string,unknown>>})=>{
    assert.equal(block_id,page.id);
    for(const child of children) blocks.push({id:randomUUID(),...child});
    return {results:blocks,next_cursor:null};
  });
  t.mock.method(notion.pages,'update',async ()=>assert.fail('Do not write new notes into public tracking fields'));
  const calls: Array<{currentLandingNote:string;previous:Array<{text:string}>;replyTo:{text:string}}> = [];
  t.mock.method(OpenAI.prototype,'post',async (_path:string,opts:{body:{messages:Array<{content:string}>}})=>{
    calls.push(JSON.parse(opts.body.messages[1].content));
    return {choices:[{message:{content:JSON.stringify({
      text:'想休息的話就慢一點吧。我在烏布的茶店推開窗，冰檸檬茶還沒喝完。',
      scene:{activity:'coffee',location:'錄入的茶店',object:'冰檸檬茶',action:'坐在窗前',light:'午後光'},
    })}}]};
  });
  const app=express();
  app.use(express.json());app.use('/api/extended/personal',routes);
  const server=app.listen(0,'127.0.0.1');
  t.after(()=>server.close());
  await new Promise<void>((resolve,reject)=>server.once('listening',resolve).once('error',reject));
  const address=server.address();
  if(!address||typeof address==='string') throw new Error('test port unavailable');
  const base=`http://127.0.0.1:${address.port}/api/extended/personal`;
  let cookie: string | undefined;
  function call(endpoint:string,body?:unknown) {
    return fetch(base+endpoint,{
      method:body===undefined?'GET':'POST',redirect:'manual',
      headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
      body:body===undefined?undefined:JSON.stringify(body),
    });
  }
  assert.equal((await call('/state')).status,401);
  assert.equal((await call('/session',{passenger:passengerId,code:'incorrect-code-in-test-long-enough'})).status,401);
  const login=await call('/session',{passenger:passengerId,code});
  assert.equal(login.status,200);
  cookie=login.headers.get('set-cookie')!.split(';')[0];
  type ResponseState = {station:{id:string;timezone:string};note:string;messages:Array<{text:string;kind:string}>};
  const start=await (await call('/state')).json() as ResponseState;
  assert.equal(start.station.timezone,'Asia/Makassar');
  assert.equal(start.note,'原本的筆記');
  type Timeline={items:Array<{reference:string;stationId:string|null;photo:string}>;next:string|null};
  const timeline=await (await call('/journeys')).json() as Timeline;
  assert.equal(timeline.items.length,1);
  assert.equal(timeline.next,'test-cursor');
  assert.equal(timeline.items[0].photo,'https://images.example/landing.jpg');
  assert.doesNotMatch(JSON.stringify(timeline),/原本的筆記|PAX-TESTPERSONAL/);
  const older=await (await call('/journeys?cursor='+timeline.next)).json() as Timeline;
  assert.equal(older.items.length,1);
  assert.equal(older.items[0].stationId,null);
  const ref=older.items[0].reference;
  const archive=await (await call('/journey?ref='+ref)).json() as ResponseState;
  assert.equal(archive.note,'舊航班筆記');
  assert.equal((await call('/journey?ref='+ref.replace('previous','somebody'))).status,404);
  assert.equal((await call('/landing-photo?ref='+ref.replace('previous','somebody'))).status,404);
  const station=start.station.id;
  const note='今天想好好休息，睡前把簡報收完了。';
  assert.equal((await call('/note',{station:'different-flight',note,previous:start.note})).status,409);
  assert.equal((await call('/note',{station,note,previous:start.note})).status,200);
  assert.equal((await call('/note',{station,note:'過時的編輯',previous:start.note})).status,409);
  assert.equal(blocks.filter((b)=>b.type==='quote').length,1);
  const saved=await (await call('/state')).json() as ResponseState;
  assert.equal(saved.note,note);
  const turn={station,key:randomUUID(),action:'note'};
  assert.equal((await call('/turn',turn)).status,200);
  assert.equal((await call('/turn',turn)).status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].currentLandingNote,note);
  const next=await call('/turn',{station,key:randomUUID(),action:'chat',text:'你那杯茶喝完了嗎？'});
  assert.equal(next.status,200);
  assert(calls[1].previous.some((m)=>m.text.includes('冰檸檬茶還沒喝完')));
  const state=await next.json() as ResponseState;
  assert.deepEqual(state.messages.map((m)=>m.kind),['human','ai','human','ai']);
});

test('anonymous demo chat sends the latest message and earlier context to the generator', async (t) => {
  process.env.OPENAI_API_KEY='mock-demo-openai';
  const seen: Array<{replyTo:{text:string};previous:Array<{text:string}>}>=[];
  t.mock.method(OpenAI.prototype,'post',async (_path:string, opts:{body:{messages:Array<{content:string}>}})=>{
    const input=JSON.parse(opts.body.messages[1].content);
    seen.push(input);
    return {choices:[{message:{content:JSON.stringify({
      text:'有，我在。你剛說想用彩色鉛筆畫海。',
      scene:{activity:'coffee',location:'佛塔旁的小店',object:'奶茶',action:'看街道',light:'日光'},
    })}}]};
  });
  const app=express();
  app.use(express.json());app.use('/api/extended/personal',routes);
  const server=app.listen(0,'127.0.0.1');
  t.after(()=>server.close());
  await new Promise<void>((resolve,reject)=>server.once('listening',resolve).once('error',reject));
  const address=server.address();
  if(!address||typeof address==='string') throw new Error('test port unavailable');
  const origin=`http://127.0.0.1:${address.port}`;
  const response=await fetch(origin+'/api/extended/personal/demo-chat',{
    method:'POST',
    headers:{'Content-Type':'application/json',Origin:origin},
    body:JSON.stringify({
      action:'chat',text:'你有在理我嗎？',
      history:[{kind:'human',text:'我今晚想用彩色鉛筆畫海。'}],
    }),
  });
  assert.equal(response.status,200);
  const reply=await response.json() as {text:string};
  assert.match(reply.text,/彩色鉛筆畫海/);
  assert.equal(seen[0].replyTo.text,'你有在理我嗎？');
  assert(seen[0].previous.some((m)=>m.text==='我今晚想用彩色鉛筆畫海。'));
  const foreign=await fetch(origin+'/api/extended/personal/demo-chat',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},
    body:JSON.stringify({action:'chat',text:'測試'}),
  });
  assert.equal(foreign.status,403);
  assert.equal(seen.length,1);
});
