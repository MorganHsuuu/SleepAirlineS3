import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { CITIES } from '../../data/cities';
import { openAiApiKey } from '../ai/openai-env';
import { loadPreviousArrivalStory } from '../flight/arrival-story';
import { getNotionClient, isNotionConfigured } from '../notion/client';
import { parseFlight } from '../notion/flights';
import { uploadImageToNotion } from '../notion/notion-file-upload';
import { findPassenger } from '../pairing/notion-store';
import { type Message, type Station } from './model';
import { generateMoment, generatePicture } from './prompts';

const router = Router();
const cookieName = 'sa_extended_personal';
const cookieAge = 7 * 86400_000;
const blockLabel = 'Sleep Airline Extended';
const noteLabel = 'Sleep Airline · Extended 降落筆記\n';
const photoLabel = 'Sleep Airline Extended photo: ';
const blockVersion = '2025-09-03';

type Identity = { passengerId: string; alias: string };
type TextPart = { plain_text?: string; text?: { content?: string } };
type Props = Record<string, { type?: string; rich_text?: TextPart[] }>;
type Landing = NonNullable<Awaited<ReturnType<typeof getLanding>>>;
type Entry = { key: string; messages: Message[] };

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function signingKey() { return process.env.EXTENDED_SESSION_SECRET || process.env.PAIRING_SIGNING_SECRET || ''; }
function signature(value: string) { return createHmac('sha256', signingKey()).update('sa-extended-personal/v1:').update(value).digest('hex'); }
function equal(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function isReady() { return isNotionConfigured() && Boolean(process.env.NOTION_DASHBOARD_DB_ID) && signingKey().length >= 32; }
function validId(id: unknown): id is string { return typeof id === 'string' && /^PAX-[A-Z0-9]{8,36}$/i.test(id); }
function verifiedIdentity(req: Request): Identity | null {
  const raw = (req.get('cookie') || '').split(/;\s*/).find((p) => p.startsWith(cookieName + '='))?.slice(cookieName.length+1) || '';
  const [payload, mac, extra] = raw.slice(0, 1024).split('.');
  if (!isReady() || !payload || !mac || extra || !equal(signature(payload),mac)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if (validId(data.passengerId) && typeof data.alias==='string' && Number.isFinite(data.exp) && data.exp > Date.now()) {
      return { passengerId: data.passengerId, alias: data.alias };
    }
  } catch { /* malformed session */ }
  return null;
}
async function login(passengerId: string, code: string): Promise<Identity | null> {
  const digest = hash(code);
  try {
    const list: Array<Identity & { codeHash: string }> = JSON.parse(process.env.EXTENDED_MEMBERS_JSON || '[]');
    const invite = list.find((x) => x?.passengerId===passengerId && typeof x.codeHash==='string' && equal(x.codeHash,digest));
    if (invite) return { passengerId, alias: String(invite.alias || '').trim().slice(0,40) };
  } catch { /* pairing is still available */ }
  if (!process.env.NOTION_PAIRING_DB_ID || !process.env.NOTION_PARENT_PAGE_ID) return null;
  const passenger = await findPassenger(passengerId);
  return passenger && equal(passenger.recoveryHash,digest) ? { passengerId,alias:passenger.displayName } : null;
}

const plain = (values?: TextPart[]) => (values || []).map((p) => p.plain_text ?? p.text?.content ?? '').join('');
const rich = (text: string) => (text.match(/[\s\S]{1,900}/gu) || []).map((content) => ({ type:'text' as const, text:{content} }));
const clean = (text: unknown, max: number) => typeof text==='string' ? Array.from(text.trim()).slice(0,max).join('') : '';

async function getLanding(user: Identity) {
  const notion = getNotionClient();
  const result = await notion.databases.query({
    database_id: process.env.NOTION_DASHBOARD_DB_ID!,
    filter:{and:[
      {property:'Passenger ID',rich_text:{equals:user.passengerId}},
      {property:'Status',select:{equals:'landed'}},
    ]},
    sorts:[{property:'Landing Time',direction:'descending'}],
    page_size:1,
  });
  const record = result.results[0];
  if (!record || !('properties' in record)) return null;
  const f = parseFlight(record as unknown as Record<string,unknown>);
  if (f.passengerId !== user.passengerId || f.status !== 'landed' || !f.flightId) return null;
  const props = record.properties as Props;
  const lat=f.arrivalLatitude, lon=f.arrivalLongitude;
  const arrival=Date.parse(f.landingTime || '');
  if (lat==null || lon==null || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(arrival) || !f.arrivalLocation) return null;
  const match=CITIES.find((c) => Math.abs(c.latitude-lat)<.025 && Math.abs(c.longitude-lon)<.025);
  const [city,country='']=f.arrivalLocation.split(/[,，]/).map((s) => s.trim());
  const station: Station={
    id:signature(f.flightId).slice(0,24), owner:'you',member:'平行的自己',
    name:match?.displayName.split(',')[0] || city, country:match?.displayName.split(',').at(1)?.trim() || country,
    timezone:match?.timezone || null, lat,lon, origin:[f.departureLongitude,f.departureLatitude], arrived:arrival,
  };
  return { flight:f, station, legacyNote:plain(props['Immigration Note']?.rich_text) };
}

async function notesAndHistory(pageId: string, legacyNote = '') {
  const entries = new Map<string, Entry>();
  const photos = new Map<string,string>();
  let noteId: string | undefined;
  let note = legacyNote;
  let cursor: string | undefined;
  do {
    const page = await getNotionClient().blocks.children.list({ block_id:pageId, page_size:100, start_cursor:cursor });
    for (const block of page.results) {
      if ('quote' in block) {
        const text = plain(block.quote.rich_text);
        if (text.startsWith(noteLabel)) { noteId=block.id;note=text.slice(noteLabel.length); }
      }
      if ('code' in block && plain(block.code.caption)===blockLabel) {
        try {
          const entry = JSON.parse(plain(block.code.rich_text)) as Entry;
          if (typeof entry.key==='string' && Array.isArray(entry.messages) && !entries.has(entry.key)) entries.set(entry.key,entry);
        } catch { /* a manually edited block is not a turn */ }
      }
      if ('image' in block && block.image.type==='file') {
        const label=plain(block.image.caption);
        if (label.startsWith(photoLabel)) photos.set(label.slice(photoLabel.length),block.image.file.url);
      }
    }
    cursor = page.next_cursor || undefined;
  } while (cursor);
  return { entries, photos, note, noteId, messages:[...entries.values()].flatMap((ent) => ent.messages) };
}
function history(landing: Landing) {
  return notesAndHistory(landing.flight.notionId,landing.legacyNote);
}

async function previousNote(landing: Landing): Promise<string | undefined> {
  const {flight}=landing;
  const previous=await getNotionClient().databases.query({
    database_id:process.env.NOTION_DASHBOARD_DB_ID!,
    page_size:4,
    sorts:[{property:'Landing Time',direction:'descending'}],
    filter:{and:[
      {property:'Passenger ID',rich_text:{equals:flight.passengerId}},
      {property:'Status',select:{equals:'landed'}},
      {property:'Landing Time',date:{before:flight.takeoffTime}},
    ]},
  });
  for(const page of previous.results) {
    if (!('properties' in page)) continue;
    const props=page.properties as Props;
    if(plain(props['Passenger ID']?.rich_text)!==flight.passengerId || page.id===flight.notionId) continue;
    const saved=await notesAndHistory(page.id,plain(props['Immigration Note']?.rich_text));
    if(saved.note.trim()) return clean(saved.note,850);
  }
  return (await loadPreviousArrivalStory(flight))?.text;
}

function publicHistory(data: Awaited<ReturnType<typeof history>>) {
  return data.messages.slice(-60).map(({ id,kind,text,created,scene,noteMessage }) => ({
    id,kind,text,created,noteMessage,photo:data.photos.get(id),sceneAvailable:Boolean(scene),
  }));
}

async function appendTurn(landing: Landing, entry: Entry) {
  await getNotionClient().blocks.children.append({block_id:landing.flight.notionId,children:[{
    object:'block',type:'code',code:{language:'plain text',caption:rich(blockLabel),rich_text:rich(JSON.stringify(entry))},
  }]});
}

router.use((req,res,next) => {
  res.set('Cache-Control','private, no-store');
  if (req.method==='POST' && !req.is('application/json')) return res.status(415).json({error:'此操作需要 JSON。'});
  return next();
});

router.get('/status',(req,res) => res.json({ available:isReady(), authenticated:Boolean(verifiedIdentity(req)), ai:Boolean(openAiApiKey()) }));
router.post('/session',async (req,res) => {
  if (!isReady()) return res.status(503).json({error:'這個環境還沒連接 V3，你可以先試玩示範。'});
  const {passenger,code}=req.body || {};
  if (!validId(passenger) || typeof code!=='string' || code.trim().length<24 || code.length>128) {
    return res.status(401).json({error:'旅客編號或登入碼不符。'});
  }
  try {
    const user=await login(passenger.trim().toUpperCase(),code.trim());
    if (!user) return res.status(401).json({error:'旅客編號或登入碼不符。'});
    const payload=Buffer.from(JSON.stringify({...user,exp:Date.now()+cookieAge})).toString('base64url');
    res.cookie(cookieName,payload+'.'+signature(payload),{path:'/api/extended/personal',httpOnly:true,sameSite:'strict',secure:Boolean(process.env.VERCEL),maxAge:cookieAge});
    return res.json({ok:true});
  } catch { return res.status(503).json({error:'暫時無法連接旅程，請稍後再試。'}); }
});
router.post('/logout',(_req,res) => res.clearCookie(cookieName,{path:'/api/extended/personal'}).json({ok:true}));
router.use((req,res,next) => {
  const user=verifiedIdentity(req);
  if(!user) return res.status(401).json({error:'請先連接你的旅程。'});
  res.locals.user=user;
  return next();
});

router.get('/state',async (_req,res) => {
  try {
    const landing=await getLanding(res.locals.user);
    if (!landing) return res.json({station:null,note:'',canNote:false,ai:Boolean(openAiApiKey()),messages:[]});
    const data=await history(landing);
    return res.json({station:landing.station,note:data.note,canNote:true,ai:Boolean(openAiApiKey()),messages:publicHistory(data)});
  } catch { return res.status(502).json({error:'暫時讀不到你的旅程，請稍後再試。'}); }
});

router.post('/note',async (req,res) => {
  const note=clean(req.body?.note,1200);
  if (typeof req.body?.note!=='string') return res.status(400).json({error:'請輸入筆記。'});
  try {
    const landing=await getLanding(res.locals.user);
    if (!landing || landing.station.id!==req.body.station) return res.status(409).json({error:'降落紀錄更新了，請重新整理。'});
    const saved=await history(landing);
    if (typeof req.body.previous!=='string' || (req.body.previous!==saved.note && note!==saved.note)) {
      return res.status(409).json({error:'筆記已在別處更新，請重新載入後再儲存。'});
    }
    // Keep the new diary under its own flight page. The legacy tracking feed exposes
    // the Immigration Note field, so a private Extended note must use a separate block.
    if(note!==saved.note) {
      const quote={rich_text:rich(noteLabel+note)};
      const client=getNotionClient();
      if(saved.noteId) await client.blocks.update({block_id:saved.noteId,quote});
      else await client.blocks.children.append({block_id:landing.flight.notionId,children:[{object:'block',type:'quote',quote}]});
    }
    return res.json({note,saved:true,ai:Boolean(openAiApiKey())});
  } catch { return res.status(503).json({error:'筆記沒能儲存，請再試一次。'}); }
});

router.post('/turn',async (req,res) => {
  const { action,key,station }=req.body || {};
  if (!['greeting','chat','note'].includes(action) || typeof key!=='string' || !/^[a-f0-9-]{36}$/.test(key)) {
    return res.status(400).json({error:'無法辨識這則訊息。'});
  }
  const text=clean(req.body?.text,400);
  if (action==='chat'&&!text) return res.status(400).json({error:'請先寫下訊息。'});
  try {
    const landing=await getLanding(res.locals.user);
    if (!landing || landing.station.id!==station) return res.status(409).json({error:'降落紀錄更新了，請重新整理。'});
    const data=await history(landing);
    const entryKey=action==='greeting'?'greeting':action==='note'?'note-'+hash(data.note):key;
    if(data.entries.has(entryKey) || (action==='greeting' && data.messages.length)) return res.json({messages:publicHistory(data)});
    if(action==='note' && !data.note) return res.json({messages:publicHistory(data)});
    if(data.messages.filter((m) => m.kind==='ai' && Date.now()-m.created<60_000).length>=5) {
      return res.status(429).json({error:'訊息送得有點快，請稍後再試。'});
    }
    if (!openAiApiKey()) return res.status(503).json({error:'現在無法連接 AI。'});
    const author=(kind:Message['kind'], body:string):Message=>({
      id:key+'-'+kind,kind,text:body,created:Date.now(),member:kind==='ai'?'平行的自己':'你',
      channel:'you',owner:'you',station,
    });
    const source=action==='chat'?author('human',text):action==='note'?{ ...author('human','我剛寫好這次的降落筆記。'), noteMessage:true }:undefined;
    const previous=data.note ? undefined : await previousNote(landing).catch(()=>undefined);
    const output=await generateMoment({
      station:landing.station,kind:action,channel:'you',history:data.messages,source,
      currentLandingNote:clean(data.note,850)||undefined,previousLandingNote:previous,
    });
    const reply={...author('ai',output.text),scene:output.scene,replyTo:source?.id};
    const entry={ key:entryKey,messages:source?[source,reply]:[reply] };
    await appendTurn(landing,entry);
    data.messages.push(...entry.messages);
    return res.json({messages:publicHistory(data)});
  } catch (err) {
    console.warn('[extended/personal] turn failed', (err as {status?:number}).status || 'local');
    return res.status(503).json({error:'這則回覆沒能送達，請再試一次。'});
  }
});

router.post('/photo',async (req,res) => {
  if (!openAiApiKey()) return res.status(503).json({error:'現在無法生成照片。'});
  try {
    const landing=await getLanding(res.locals.user);
    if (!landing || landing.station.id!==req.body?.station) return res.status(409).json({error:'降落紀錄更新了，請重新整理。'});
    const data=await history(landing);
    const moment=data.messages.find((m) => m.kind==='ai' && m.scene && m.id===req.body?.id);
    if (!moment) return res.status(404).json({error:'找不到可生成照片的訊息。'});
    if (data.photos.has(moment.id)) return res.json({messages:publicHistory(data)});
    if(data.photos.size>=4) return res.status(429).json({error:'這段旅程已保存四張照片。'});
    const jpg=await generatePicture(landing.station,moment);
    const upload=await uploadImageToNotion(Buffer.from(jpg,'base64'),'extended-'+moment.id+'.jpg','image/jpeg');
    const response=await fetch(`https://api.notion.com/v1/blocks/${landing.flight.notionId}/children`,{
      method:'PATCH',headers:{Authorization:`Bearer ${process.env.NOTION_API_KEY}`,'Notion-Version':blockVersion,'Content-Type':'application/json'},
      body:JSON.stringify({children:[{object:'block',type:'image',image:{type:'file_upload',file_upload:{id:upload},caption:rich(photoLabel+moment.id)}}]}),
    });
    if(!response.ok) throw new Error('Notion photo attachment failed');
    return res.json({messages:publicHistory(await history(landing))});
  } catch { return res.status(503).json({error:'照片沒能儲存，請稍後再試。'}); }
});
export default router;
