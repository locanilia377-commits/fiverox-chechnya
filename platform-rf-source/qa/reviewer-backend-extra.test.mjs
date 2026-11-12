import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,migrate,installDevelopmentRole} from '../server/src/db.mjs';
import {seedDemo,demo} from '../server/src/seed.mjs';
import {CrmService} from '../server/src/service.mjs';
import {createMailer} from '../server/src/auth.mjs';
import {createHttp} from '../server/src/http.mjs';

let db,s;
const now=new Date('2026-11-13T09:00:00.000Z');
const op=()=>randomUUID();
const rejectCode=(fn,code)=>assert.rejects(fn,e=>e.code===code);
before(async()=>{db=await createDatabase({engine:'pglite'});await migrate(db);await seedDemo(db);await installDevelopmentRole(db);s=new CrmService(db,{now:()=>now});});
after(async()=>db.close());
async function client(name){return s.createClient(demo.admin,{record:{name,phones:'SYNTHETIC-CONTACT-NOT-A-REAL-PHONE',channels:'contact@example.test',fields:['В работе','Старый куратор','2026-11-14','Внутренний следующий шаг','','Внутренняя заметка','1234','']},operationId:op()});}
async function offer(c,userId,dealerId,extra={}){return s.createTransfer(demo.admin,{leadId:c.id,assigneeUserId:userId,dealerId,note:'Одобренное резюме',...extra,operationId:op()});}
async function accept(user,t){return s.decideTransfer(user,t.id,'accept',{version:t.version,operationId:op()});}

test('Fresh card creation preserves all eight explicit working values',async()=>{
 const c=await client('Synthetic field preservation');
 assert.deepEqual(c.fields,['В работе','Старый куратор','2026-11-14','Внутренний следующий шаг','','Внутренняя заметка','1234','']);
});
test('Non-empty master contacts stay hidden by default, including pending projection',async()=>{
 const c=await client('Synthetic withheld contact');const t=await offer(c,demo.a,demo.dealerA);
 const pending=(await s.workspace(demo.a)).transfers.find(x=>x.id===t.id);
 assert.equal(JSON.stringify(pending).includes('SYNTHETIC-CONTACT'),false);
 assert.equal(JSON.stringify(pending).includes('contact@example.test'),false);
 await accept(demo.a,t);const a=await s.read(demo.a,c.id);
 assert.equal(a.phones,'');assert.equal(a.channels,'');assert.equal(a.note,'');assert.equal(a.next,'');
});
test('Explicitly shared contacts are visible only after acceptance and not inherited by next dealer',async()=>{
 const c=await client('Synthetic explicitly shared contact');const t=await offer(c,demo.a,demo.dealerA,{shareContacts:true});
 await rejectCode(()=>s.read(demo.a,c.id),'NOT_FOUND');await accept(demo.a,t);
 const a=await s.read(demo.a,c.id);assert.equal(a.phones,c.phones);assert.equal(a.channels,c.channels);
 const bOffer=await offer(c,demo.b,demo.dealerB);await accept(demo.b,bOffer);
 await rejectCode(()=>s.read(demo.a,c.id),'NOT_FOUND');const b=await s.read(demo.b,c.id);assert.equal(b.phones,'');assert.equal(b.channels,'');
});
test('Restricted PostgreSQL runtime SELECT itself excludes unassigned client rows',async()=>{
 const c=await client('Synthetic raw RLS proof');
 const rows=await db.transaction(async tx=>{await tx.query("SELECT set_config('fiverox.actor_id',$1,true)",[demo.b]);return (await tx.query('SELECT id FROM fiverox.clients WHERE id=$1',[c.id])).rows;});
 assert.equal(rows.length,0);
});
test('A same-user reassignment cannot replay the previous assignment private card receipt',async()=>{
 const c=await client('Synthetic receipt reassignment proof');let a=await offer(c,demo.a,demo.dealerA,{shareContacts:true});await accept(demo.a,a);
 const old=await s.read(demo.a,c.id),working=[...old.fields];working[5]='PRIVATE-PREVIOUS-ASSIGNMENT';
 const priorBody={fields:working,version:old.version,operationId:op()};await s.saveClient(demo.a,c.id,priorBody);
 a=(await s.workspace(demo.admin)).transfers.find(t=>t.id===a.id);
 await s.decideTransfer(demo.admin,a.id,'revoke',{version:a.version,reason:'Synthetic revoke',operationId:op()});
 const next=await offer(c,demo.a,demo.dealerA);await accept(demo.a,next);
 const clean=await s.read(demo.a,c.id);assert.equal(clean.note,'');assert.equal(clean.phones,'');
 await assert.rejects(()=>s.saveClient(demo.a,c.id,priorBody),e=>['IDEMPOTENCY_CONFLICT','NOT_FOUND','SCOPE_CHANGED'].includes(e.code));
});
test('Expired pending offer cannot be accepted and does not remove previous active access',async()=>{
 const c=await client('Synthetic expiry proof');const a=await offer(c,demo.a,demo.dealerA);await accept(demo.a,a);
 const pending=await offer(c,demo.b,demo.dealerB,{expiresAt:new Date(now.getTime()+1000).toISOString()});
 const later=new CrmService(db,{now:()=>new Date(now.getTime()+2000)});
 await rejectCode(()=>later.decideTransfer(demo.b,pending.id,'accept',{version:pending.version,operationId:op()}),'TRANSFER_EXPIRED');
 assert.equal((await s.read(demo.a,c.id)).id,c.id);await rejectCode(()=>s.read(demo.b,c.id),'NOT_FOUND');
});
test('Synthetic mailer rejects real-world recipient domains',async()=>{
 const mail=await createMailer({NODE_ENV:'test'});await assert.rejects(()=>mail.send({to:'person@gmail.com',text:'never sent'}));assert.equal(mail.outbox.length,0);
});
test('Production mailer fails closed if SMTP configuration is absent',async()=>{
 await assert.rejects(()=>createMailer({NODE_ENV:'production'}),/SMTP_HOST/);
});
test('Production HTTP never exposes an in-memory mail sink',async()=>{
 const server=createHttp({service:{},auth:{},mail:{outbox:[{text:'synthetic proof'}]},origin:'https://crm.example.test',production:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const r=await fetch('http://127.0.0.1:'+server.address().port+'/__dev/mail');assert.equal(r.status,404);assert.equal((await r.text()).includes('synthetic proof'),false);}finally{await new Promise(resolve=>server.close(resolve));}
});
