import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
const OWNER = new Set(['554198848435@s.whatsapp.net','20714727989466@lid']);
const SENDER='554197483429@s.whatsapp.net';
// 26/10/2026 (decisao do dono): alem do dono, texto simples via POST /send so para os 9 grupos
// de clientes confirmados (group-ritual-policy.json, output_enabled). Lista fechada em arquivo
// root:mercurio-token 0640; o nome do grupo e conferido ao vivo antes de cada envio.
const ALLOWED_GROUPS_FILE='/etc/mercurio-pilot/allowed-groups.json';
const ALLOWED_GROUP_COUNT=13;
const GROUP_TEXT_MAX=4096;
function forwarded(v) {if(!v||typeof v!=='object')return false;if(v.isForwarded===true||Number(v.forwardingScore)>0)return true;return Object.values(v).some(forwarded);}
function pin(id) {if(typeof id!=='string')return false;const [local,domain,...extra]=id.split('@');return !extra.length&&domain==='s.whatsapp.net'&&local.split(':')[0]==='554197483429'&&local.split(':').length<=2;}
export function loadAllowedGroups(file=ALLOWED_GROUPS_FILE){
 const groups=new Map();
 if(!existsSync(file))return groups;
 try{
  const data=JSON.parse(readFileSync(file,'utf8'));
  const list=Array.isArray(data?.groups)?data.groups:[];
  if(data?.schemaVersion!==1||list.length!==ALLOWED_GROUP_COUNT)throw Error('allowed groups: expected schemaVersion 1 and exactly '+ALLOWED_GROUP_COUNT+' groups');
  for(const g of list){
   const id=String(g?.chat_id||''),name=String(g?.group_name||'');
   if(!/^\d{10,30}@g\.us$/.test(id)||!name.trim()||groups.has(id))throw Error('allowed groups: invalid or duplicated entry');
   groups.set(id,{name,clientId:String(g?.client_id||'')});
  }
 }catch(e){console.error(JSON.stringify({event:'allowed_groups_rejected',reason:String(e?.message||e).slice(0,200)}));return new Map();}
 return groups;
}
export class PilotGuard {
 constructor({token,stateDir,allowedGroupsFile=ALLOWED_GROUPS_FILE}) {
  if(typeof token!=='string'||token.length<32||!stateDir)throw Error('Missing operator-provisioned credentials/state');
  this.digest=createHash('sha256').update('Bearer '+token).digest();this.stateDir=stateDir;this.started=Math.floor(Date.now()/1000);this.pending=new Map();this.seen=new Set();this.out=new Map();this.operations=[];
  this.groups=loadAllowedGroups(allowedGroupsFile);
  mkdirSync(stateDir,{recursive:true,mode:0o700});this.file=join(stateDir,'pilot-journal.jsonl');
  if(existsSync(this.file))for(const line of readFileSync(this.file,'utf8').split('\n').filter(Boolean))this.apply(JSON.parse(line));
 }
 authenticate(header){const d=createHash('sha256').update(typeof header==='string'?header:'').digest();return timingSafeEqual(d,this.digest);}
 assertSender(sock){if(!pin(sock?.user?.id))throw Error('live sender pin mismatch; expected '+SENDER);}
 assertDestination(id){if(!OWNER.has(id))throw Error('owner-only destination denied');}
 isAllowedGroup(id){return typeof id==='string'&&this.groups.has(id);}
 // Grupo liberado so recebe texto simples: sem midia, edicao, mencao, enquete ou citacao.
 assertGroupText(id,payload,options={}){
  if(!this.isAllowedGroup(id))throw Error('guard: destination denied');
  const keys=Object.keys(payload||{});
  if(keys.length!==1||keys[0]!=='text'||typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>GROUP_TEXT_MAX)throw Error('guard: group accepts plain text only');
  if(options&&Object.keys(options).length)throw Error('guard: group accepts plain text only');
 }
 async assertGroupName(sock,id,timeout=15000){
  let timer;
  try{
   const meta=await Promise.race([sock.groupMetadata(id),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeout);})]);
   if(String(meta?.subject||'')!==this.groups.get(id).name)throw Error('guard: group name mismatch');
  }catch(e){if(String(e?.message||'').startsWith('guard:'))throw e;throw Error('guard: group name check failed');}
  finally{clearTimeout(timer);}
 }
 record(e){const fd=openSync(this.file,'a',0o600);try{writeSync(fd,JSON.stringify(e)+'\n');fsyncSync(fd);}finally{closeSync(fd);}this.apply(e);}
 apply(e){if(e.kind==='in'){this.seen.add(e.id);this.pending.set(e.id,e.event);}if(e.kind==='ack')for(const id of e.ids)this.pending.delete(id);if(e.kind==='out'){this.operations.push(e);if(e.messageId)this.out.set(e.messageId,e);}if(e.kind==='receipt'){const old=this.out.get(e.messageId);if(old){const ranks={indeterminate:0,submitted:1,server_ack:2,delivered:3,read:4,played:5};this.out.set(e.messageId,{...old,status:(ranks[e.status]||0)>(ranks[old.status]||0)?e.status:old.status});}}}
 id(m){return m?.key?.id ? 'owner:'+m.key.id:null;}
 acceptInbound(m,type){return type==='notify'&&m?.key?.fromMe===false&&OWNER.has(m.key.remoteJid)&&(!m.key.participant||OWNER.has(m.key.participant))&&!!m.message&&Number(m.messageTimestamp)>=this.started&&!forwarded(m.message)&&!!this.id(m)&&!this.seen.has(this.id(m));}
 enqueue(m,event){const id=this.id(m);if(!id||this.seen.has(id))return false;this.record({kind:'in',id,event:{...event,inboxId:id}});return true;}
 peek(){return [...this.pending.values()].slice(0,100);}
 ack(ids){if(!Array.isArray(ids)||ids.length>100||ids.some(x=>typeof x!=='string'||!this.seen.has(x)))throw Error('invalid ack');this.record({kind:'ack',ids});}
 async send(sock,id,payload,timeout=60000,options={}){this.assertSender(sock);if(OWNER.has(id)){if(payload?.edit?.remoteJid)this.assertDestination(payload.edit.remoteJid);for(const mention of payload?.mentions||[])this.assertDestination(mention);}else{this.assertGroupText(id,payload,options);await this.assertGroupName(sock,id);}const op=randomUUID();this.record({kind:'out',op,chatId:id,status:'indeterminate',phase:'intent'});let timer;try{const sent=await Promise.race([sock.sendMessage(id,payload,options),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('send outcome indeterminate')),timeout);})]);const messageId=sent?.key?.id;if(!messageId)throw Error('send returned no message ID');this.record({kind:'out',op,chatId:id,messageId,status:'submitted'});return sent;}catch(e){this.record({kind:'out',op,chatId:id,status:'indeterminate',phase:'error'});throw e;}finally{clearTimeout(timer);}}
 receipt(key,update){const old=this.out.get(key?.id);if(!old||!(OWNER.has(key?.remoteJid)||this.isAllowedGroup(key?.remoteJid)))return;const status=({2:'server_ack',3:'delivered',4:'read',5:'played'})[update?.status]||'indeterminate';this.record({kind:'receipt',messageId:key.id,status,at:Date.now()});}
 status(id){return this.out.get(id)||{messageId:id,status:'indeterminate'};}
 middleware(getSocket){return (req,res,next)=>{if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.status(403).json({error:'loopback required'});if(!this.authenticate(req.headers.authorization))return res.status(401).json({error:'unauthorized'});if(req.path==='/read')return res.status(403).json({error:'read receipts disabled'});if(req.path.startsWith('/chat/')){try{this.assertDestination(decodeURIComponent(req.path.slice(6)));}catch{return res.status(403).json({error:'owner only'});}}if(req.method==='POST'&&!['/messages/ack'].includes(req.path)){try{this.assertSender(getSocket());const chatId=req.body?.chatId;if(req.path==='/send'&&this.isAllowedGroup(chatId)){if((req.body?.mentions||[]).length||req.body?.replyTo)throw Error('guard: group accepts plain text only');}else{this.assertDestination(chatId);for(const id of req.body?.mentions||[])this.assertDestination(id);}}catch(e){return res.status(403).json({error:e.message});}}next();};}
}
