import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import OpenAI from 'openai';
import routes from '../src/lib/extended/personal';
import { getNotionClient } from '../src/lib/notion/client';

test('personal diary stays out of the legacy feed and follows the authenticated flight and chat', async (t) => {
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
    },
  };
  const blocks: Array<Record<string, unknown>>=[];
  t.mock.method(notion.databases,'query',async ()=>({results:[page],next_cursor:null}));
  t.mock.method(notion.blocks.children,'list',async ({block_id}:{block_id:string})=>{
    assert.equal(block_id,page.id);
    return {results:blocks,next_cursor:null};
  });
  t.mock.method(notion.blocks.children,'append',async ({block_id,children}:{block_id:string;children:Array<Record<string,unknown>>})=>{
    assert.equal(block_id,page.id);
    for(const child of children) blocks.push({id:randomUUID(),...child});
    return {results:blocks,next_cursor:null};
  });
  t.mock.method(notion.pages,'update',async ()=>assert.fail('Do not write new notes into public tracking fields'));
  const calls: Array<{currentLandingNote:string;previous:Array<{text:string}>}>=[];
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
      method:body===undefined?'GET':'POST',
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
