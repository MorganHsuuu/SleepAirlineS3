import type { Request, Response } from 'express';
import { openAiApiKey } from '../ai/openai-env';
import type { Message, Station } from './model';
import { generateMoment } from './prompts';

const opening = '雨停了。我在佛塔旁的小店喝奶茶，店門一開，整條巷子都聞得到濕磚頭的味道。';
const minute = 60_000;
let windowEnds = 0;
let requests = 0;
const requestsByAddress = new Map<string,number>();

function sameOrigin(req: Request) {
  try {
    const origin = new URL(req.get('origin') || '');
    return (origin.protocol==='https:' || origin.protocol==='http:') && origin.host===req.get('host');
  } catch { return false; }
}

function allowRequest(req: Request) {
  const now=Date.now();
  if(now>=windowEnds) {
    windowEnds=now+minute;
    requests=0;
    requestsByAddress.clear();
  }
  const address=(process.env.VERCEL ? req.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() : req.ip) || 'unknown';
  const count=requestsByAddress.get(address) || 0;
  if(count>=8 || requests>=90) return false;
  requests++;
  requestsByAddress.set(address,count+1);
  return true;
}

const textPart = (value: unknown, limit: number) =>
  typeof value==='string' ? Array.from(value.trim().slice(0,limit*2)).slice(0,limit).join('') : '';

export async function demoChat(req: Request, res: Response) {
  if(!sameOrigin(req)) return res.status(403).json({error:'請在 Extended 頁面使用示範聊天。'});
  const { action, text, note, history }=req.body || {};
  const isNote=action==='note';
  const content=textPart(isNote?note:text,isNote?850:400);
  if((action!=='chat'&&!isNote)||!content) return res.status(400).json({error:'請先寫下訊息。'});
  if(!openAiApiKey()) return res.status(503).json({error:'目前無法連接 AI，請稍後再試。'});
  if(!allowRequest(req)) {
    res.set('Retry-After',String(Math.max(1,Math.ceil((windowEnds-Date.now())/1000))));
    return res.status(429).json({error:'訊息送得有點快，稍等一下再試。'});
  }
  const now=Date.now();
  const station: Station={
    id:'kathmandu-demo',owner:'demo',member:'平行的自己',name:'加德滿都',country:'尼泊爾',
    timezone:'Asia/Kathmandu',lat:27.7172,lon:85.324,origin:[121.5654,25.033],arrived:now-45*minute,
  };
  const message=(kind: Message['kind'], text: string, index: number):Message=>({
    id:String(index),kind,text,owner:'demo',member:kind==='ai'?'平行的自己':'旅人',
    channel:'demo',station:station.id,created:now,
  });
  const prior=Array.isArray(history) ? history.slice(-8).flatMap((item,index)=>{
    const body=textPart(item?.text,400);
    return body && (item?.kind==='human'||item?.kind==='ai') ? [message(item.kind,body,index+1)] : [];
  }) : [];
  try {
    const result=await generateMoment({
      station,kind:action,channel:'demo',
      history:[message('ai',opening,0),...prior],
      source:message('human',isNote?'我寫好這次的降落筆記了。':content,prior.length+1),
      currentLandingNote:isNote ? content : textPart(note,850)||undefined,
    });
    return res.json({text:result.text});
  } catch(err) {
    console.warn('[extended/demo] reply unavailable', (err as {status?:number}).status || 'local');
    return res.status(503).json({error:'這次沒有收到 AI 回覆，請再試一次。'});
  }
}
