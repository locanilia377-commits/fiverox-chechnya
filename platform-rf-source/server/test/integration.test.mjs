import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,migrate,installDevelopmentRole} from '../src/db.mjs';
import {seedDemo,demo} from '../src/seed.mjs';
import {CrmService} from '../src/service.mjs';
import {Auth,createMailer} from '../src/auth.mjs';
import {createHttp} from '../src/http.mjs';
import {master,day,item} from '../src/validation.mjs';
let db,s,auth,mail,server,base,origin;let transferA,transferB,activityA,activityPayload,sessionA;
const op=()=>randomUUID();
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
const clock=()=>new Date('2026-11-13T09:00:00.000Z');
async function signIn(email){const c=await auth.start({email},'127.0.0.1');const code=mail.outbox.at(-1).text.match(/\d{8}/)[0];return auth.verify({email,challengeId:c.challengeId,code},'127.0.0.1');}
before(async()=>{db=await createDatabase({engine:'pglite'});await migrate(db);await seedDemo(db);await installDevelopmentRole(db);mail=await createMailer({NODE_ENV:'test'});auth=new Auth(db,{secret:'test-only-cryptographic-secret-not-for-production',mail,now:clock});s=new CrmService(db,{mail,now:clock});server=createHttp({service:s,auth,mail,origin:'http://127.0.0.1',production:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;origin='http://127.0.0.1';});
after(async()=>{await new Promise(r=>server.close(r));await db.close();});

test('Business transactions run as a non-owner role, RLS denies unassigned manager',async()=>{
 assert.equal((await db.transaction(tx=>tx.query('SELECT current_user'))).rows[0].current_user,'fiverox_runtime');
 const role=(await db.transaction(tx=>tx.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user'))).rows[0];assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
 assert.equal((await s.workspace(demo.admin)).leads.length,3);assert.equal((await s.workspace(demo.coordinator)).leads.length,3);assert.equal((await s.workspace(demo.a)).leads.length,0);
});
test('Pending transfer returns only approved company summary, not a client card',async()=>{
 transferA=await s.createTransfer(demo.admin,{leadId:'DEMO-1',dealerId:demo.dealerA,assigneeUserId:demo.a,note:'Одобренное резюме передачи',operationId:op()});
 const w=await s.workspace(demo.a);assert.equal(w.leads.length,0);assert.equal(w.transfers[0].companyName,'Учебная точка 1');assert.equal(w.transfers[0].fields,undefined);assert.equal(w.transfers[0].phones,undefined);await rejects(()=>s.read(demo.a,'DEMO-1'),'NOT_FOUND');
});
test('Another dealer cannot accept a transfer or grant themselves access',async()=>{
 await rejects(()=>s.decideTransfer(demo.b,transferA.id,'accept',{version:transferA.version,operationId:op()}),'NOT_FOUND');
 await rejects(()=>s.createTransfer(demo.a,{leadId:'DEMO-1',dealerId:demo.dealerA,assigneeUserId:demo.a,operationId:op()}),'ACCESS_DENIED');
});
test('Recipient accepts under real RLS, stable client ID and clean context are preserved',async()=>{
 transferA=await s.decideTransfer(demo.a,transferA.id,'accept',{version:transferA.version,operationId:op()});assert.equal(transferA.status,'active');
 const c=await s.read(demo.a,'DEMO-1');assert.equal(c.id,'DEMO-1');assert.equal(c.note,'');assert.equal(c.next,'');assert.equal(c.manager,'Менеджер А');assert.equal((await s.workspace(demo.a)).leads.length,1);
});
test('Client patch is scoped, versioned and audited with exact server actor',async()=>{
 const old=await s.read(demo.a,'DEMO-1'),f=[...old.fields];f[0]='Согласовано тестирование';f[1]='Подставной администратор';f[5]='Закрытая заметка А';const c=await s.saveClient(demo.a,'DEMO-1',{version:old.version,fields:f,operationId:op()});assert.equal(c.stage,'Согласовано тестирование');assert.equal(c.manager,'Менеджер А');assert.equal(c.note,'Закрытая заметка А');const changed=c.audit.find(e=>e.changes.some(x=>x.field==='Заметка менеджера'&&x.after==='Закрытая заметка А'));assert.ok(changed);assert.equal(changed.email,'dealer.a@example.test');await rejects(()=>s.saveClient(demo.a,'DEMO-1',{version:old.version,fields:f,operationId:op()}),'VERSION_CONFLICT');await rejects(()=>s.read(demo.b,'DEMO-1'),'NOT_FOUND');
});
test('Manager cannot read another client by ID or create its child record',async()=>{
 await rejects(()=>s.read(demo.a,'DEMO-2'),'NOT_FOUND');await rejects(()=>s.saveItem(demo.a,'activity',null,{record:{leadId:'DEMO-2',kind:'task',title:'Нельзя',status:'planned'},operationId:op()}),'NOT_FOUND');
});
test('Activity saves, replay is idempotent and changed replay is denied',async()=>{
 const body={record:{leadId:'DEMO-1',kind:'visit',title:'Визит А',status:'planned',repeatDays:30},operationId:op()};activityPayload=body;activityA=await s.saveItem(demo.a,'activity',null,body);const replay=await s.saveItem(demo.a,'activity',null,body);assert.equal(replay.id,activityA.id);assert.equal((await s.workspace(demo.a)).activities.length,1);await rejects(()=>s.saveItem(demo.a,'activity',null,{...body,record:{...body.record,title:'Другой текст'}}),'IDEMPOTENCY_CONFLICT');
});
test('Foreign child edit and client reassignment through item payload are denied',async()=>{
 await rejects(()=>s.saveItem(demo.b,'activity',activityA.id,{record:{...activityA,title:'Подмена'},version:activityA.version,operationId:op()}),'NOT_FOUND');await rejects(()=>s.saveItem(demo.a,'activity',activityA.id,{record:{...activityA,leadId:'DEMO-2'},version:activityA.version,operationId:op()}),'NOT_FOUND');
});
test('Staff-only action and contact history are not disclosed to a dealer',async()=>{
 await s.saveItem(demo.coordinator,'activity',null,{record:{leadId:'DEMO-1',kind:'task',title:'Внутреннее действие',status:'planned'},operationId:op()});await s.contact(demo.coordinator,'DEMO-1',{action:'Звонок',note:'Закрытая история координатора',operationId:op()});await s.contact(demo.a,'DEMO-1',{action:'Сообщение',note:'История А',operationId:op()});const a=await s.read(demo.a,'DEMO-1');assert.equal(a.history.length,1);assert.equal(a.history[0][2],'История А');assert.equal((await s.read(demo.admin,'DEMO-1')).history.length,2);assert.equal((await s.workspace(demo.a)).activities.length,1);
});
test('Sales persist and remain within the same client/assignment scope',async()=>{
 const sale=await s.saveItem(demo.a,'sale',null,{record:{leadId:'DEMO-1',date:'2026-11-13',item:'Материал',category:'material',quantity:2,unit:'рулон',unitPrice:1500,seller:'Дилер А',warehouse:'Учебный склад',source:'Ручная запись',status:'confirmed'},operationId:op()});assert.equal(sale.quantity*sale.unitPrice,3000);assert.equal((await s.workspace(demo.a)).sales.length,1);assert.equal((await s.workspace(demo.b)).sales.length,0);
});
test('Equipment validation requires positive quantity and a contract',async()=>{
 await rejects(()=>s.saveItem(demo.a,'activity',null,{record:{leadId:'DEMO-1',kind:'equipment',title:'Выдача',equipment:'Учебный образец',status:'issued',quantity:1,contract:''},operationId:op()}),'VALIDATION');
 const v=await s.saveItem(demo.a,'activity',null,{record:{leadId:'DEMO-1',kind:'equipment',title:'Выдача',equipment:'Учебный образец',status:'issued',quantity:1,contract:'Учебный договор'},operationId:op()});assert.equal(v.contract,'Учебный договор');
});
test('Failed audit rolls back business data and operation receipt',async()=>{
 await db.exec("CREATE FUNCTION fiverox.test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit rejection'; END $$; CREATE TRIGGER test_audit_failure BEFORE INSERT ON fiverox.audit FOR EACH ROW EXECUTE FUNCTION fiverox.test_audit_failure();");const key=op();const count=(await s.workspace(demo.a)).activities.length;try{await assert.rejects(()=>s.saveItem(demo.a,'activity',null,{record:{leadId:'DEMO-1',kind:'task',title:'Откатить',status:'planned'},operationId:key}));}finally{await db.exec('DROP TRIGGER test_audit_failure ON fiverox.audit; DROP FUNCTION fiverox.test_audit_failure();');}assert.equal((await s.workspace(demo.a)).activities.length,count);assert.equal((await db.query('SELECT operation_id FROM fiverox.operations WHERE operation_id=$1',[key])).rows.length,0);
});
test('Decline does not revoke an existing active assignment',async()=>{
 let t=await s.createTransfer(demo.admin,{leadId:'DEMO-1',dealerId:demo.dealerB,assigneeUserId:demo.b,note:'Предложение Б',operationId:op()});await s.decideTransfer(demo.b,t.id,'decline',{version:t.version,operationId:op()});assert.equal((await s.workspace(demo.a)).leads.length,1);assert.equal((await s.workspace(demo.b)).leads.length,0);
});
test('Reassignment A→B atomically revokes A and never shares old commercial data',async()=>{
 const initial=await s.read(demo.admin,'DEMO-1');await s.qualify(demo.admin,'DEMO-1',{version:initial.version,profileData:{contractReference:'Закрытый реквизит договора А',pointType:'Детейлинг'},operationId:op()},{convert:false});
 transferB=await s.createTransfer(demo.admin,{leadId:'DEMO-1',dealerId:demo.dealerB,assigneeUserId:demo.b,note:'Только разрешённое резюме Б',operationId:op()});const aBefore=await s.read(demo.a,'DEMO-1');assert.equal(aBefore.note,'Закрытая заметка А');await s.decideTransfer(demo.b,transferB.id,'accept',{version:transferB.version,operationId:op()});await rejects(()=>s.read(demo.a,'DEMO-1'),'NOT_FOUND');const b=await s.read(demo.b,'DEMO-1');assert.equal(b.note,'');assert.equal(b.history.length,0);assert.equal(b.profileData.contractReference,undefined);const w=await s.workspace(demo.b);assert.equal(w.activities.length,0);assert.equal(w.sales.length,0);assert.equal((await db.query("SELECT id FROM fiverox.transfers WHERE client_id='DEMO-1' AND status='active'")).rows.length,1);
});
test('Revoked manager cannot save an old draft or replay a prior write',async()=>{
 const body={record:{leadId:'DEMO-1',kind:'task',title:'Старый черновик',status:'planned'},operationId:op()};await rejects(()=>s.saveItem(demo.a,'activity',null,body),'NOT_FOUND');await rejects(()=>s.saveItem(demo.a,'activity',null,{record:{...activityA},operationId:op()}),'NOT_FOUND');await rejects(()=>s.saveItem(demo.a,'activity',null,activityPayload),'NOT_FOUND');assert.equal((await s.workspace(demo.a)).leads.length,0);
});
test('Admin/coordinator see the full data set; manager lookup does not expose other users',async()=>{
 const w=await s.workspace(demo.coordinator);assert.equal(w.leads.length,3);assert.equal(w.sales.length,1);assert.ok(w.activities.length>=3);const a=await s.workspace(demo.a);assert.equal(a.users.length,1);assert.equal(a.dealers.length,1);await rejects(()=>s.adminData(demo.a,'users'),'ACCESS_DENIED');
});
test('Qualification and profile edit preserve the stable ID, kind and stage',async()=>{
 const c=await s.read(demo.admin,'DEMO-2');const q=await s.qualify(demo.coordinator,c.id,{version:c.version,profileData:{pointType:'Детейлинг',assortment:'Материал А',targetAssortment:'Материал Б'},operationId:op()});assert.equal(q.id,c.id);assert.equal(q.kind,'customer');assert.equal(q.stage,'Клиент');const p=await s.qualify(demo.coordinator,c.id,{version:q.version,profileData:{assortment:'Обновлённый ассортимент'},operationId:op()},{convert:false});assert.equal(p.stage,q.stage);assert.equal(p.profileData.assortment,'Обновлённый ассортимент');await rejects(()=>s.qualify(demo.b,'DEMO-1',{version:1,profileData:{},operationId:op()}),'ACCESS_DENIED');
});
test('Input validation returns controlled errors for bad dates, link arrays and activity periods',()=>{
 assert.throws(()=>day('2026-99-99'),e=>e.code==='VALIDATION');assert.throws(()=>master({name:'Test',links:'https://example.test'}),e=>e.code==='VALIDATION');assert.equal(item('activity',{leadId:'DEMO-1',title:'Task',kind:'task',status:'planned',repeatDays:0},'2026-11-13').repeatDays,0);
});
test('OTP is delivered only to the local synthetic sink, once and with real session identity',async()=>{
 sessionA=await signIn('dealer.a@example.test');assert.equal(sessionA.session.role,'dealer_manager');assert.equal(sessionA.session.userId,demo.a);const c=await auth.start({email:'admin@example.test'},'127.0.0.1'),code=mail.outbox.at(-1).text.match(/\d{8}/)[0];await auth.verify({email:'admin@example.test',challengeId:c.challengeId,code},'127.0.0.1');await rejects(()=>auth.verify({email:'admin@example.test',challengeId:c.challengeId,code},'127.0.0.1'),'CODE_INVALID');const n=mail.outbox.length;const unknown=await auth.start({email:'unknown@example.test'},'127.0.0.1');assert.ok(unknown.challengeId);assert.equal(mail.outbox.length,n);
});
test('HTTP rejects missing session, CSRF and foreign Origin; session cookie is HttpOnly',async()=>{
 let r=await fetch(base+'/api/workspace');assert.equal(r.status,401);
 r=await fetch(base+'/api/auth/start',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.test'})});assert.equal(r.status,403);
 const c=await auth.start({email:'coordinator@example.test'},'127.0.0.1'),code=mail.outbox.at(-1).text.match(/\d{8}/)[0];r=await fetch(base+'/api/auth/verify',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'coordinator@example.test',challengeId:c.challengeId,code})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);const data=await r.json();assert.equal(data.session.role,'coordinator');const cookieValue=cookie.split(';')[0];r=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookieValue},body:'{}'});assert.equal(r.status,403);r=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookieValue,'X-CSRF-Token':data.csrfToken},body:'{}'});assert.equal(r.status,200);r=await fetch(base+'/api/workspace',{headers:{Cookie:cookieValue}});assert.equal(r.status,401);
});
test('HTTP authenticates two dealer sessions and rejects a cross-client child write',async()=>{
 const b=await signIn('dealer.b@example.test');const headers={Cookie:'fiverox_session='+b.token};let r=await fetch(base+'/api/workspace',{headers});const w=await r.json();assert.equal(w.leads.length,1);assert.equal(w.leads[0].id,'DEMO-1');r=await fetch(base+'/api/clients/DEMO-2',{headers});assert.equal(r.status,404);r=await fetch(base+'/api/activities',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':b.csrfToken},body:JSON.stringify({record:{leadId:'DEMO-2',kind:'task',title:'Подмена роли',status:'planned'},role:'admin',operationId:op()})});assert.equal(r.status,404);r=await fetch(base+'/api/workspace',{headers:{Cookie:'fiverox_session='+sessionA.token}});assert.equal((await r.json()).leads.length,0);
});
test('OTP expires and repeated wrong codes lock the challenge',async()=>{
 const c=await auth.start({email:'dealer.b@example.test'},'127.0.0.1'),code=mail.outbox.at(-1).text.match(/\d{8}/)[0];for(let i=0;i<5;i++)await rejects(()=>auth.verify({email:'dealer.b@example.test',challengeId:c.challengeId,code:code==='00000000'?'11111111':'00000000'},'127.0.0.1'),'CODE_INVALID');await rejects(()=>auth.verify({email:'dealer.b@example.test',challengeId:c.challengeId,code},'127.0.0.1'),'CODE_INVALID');const c2=await auth.start({email:'coordinator@example.test'},'127.0.0.1'),code2=mail.outbox.at(-1).text.match(/\d{8}/)[0];const later=new Auth(db,{secret:auth.secret,mail,now:()=>new Date(clock().getTime()+11*60000)});await rejects(()=>later.verify({email:'coordinator@example.test',challengeId:c2.challengeId,code:code2},'127.0.0.1'),'CODE_INVALID');
});
test('Disabling a user revokes the session and all subsequent business requests',async()=>{
 await auth.session(sessionA.token);await s.saveUser(demo.admin,demo.a,{active:false,operationId:op()});await rejects(()=>auth.session(sessionA.token),'AUTH_REQUIRED');await rejects(()=>s.workspace(demo.a),'AUTH_REQUIRED');
});
test('Runtime has no permission to rewrite or delete audit events',async()=>{
 await assert.rejects(()=>db.transaction(tx=>tx.query('DELETE FROM fiverox.audit')));await assert.rejects(()=>db.transaction(tx=>tx.query("UPDATE fiverox.audit SET action='rewrite'")));
});
test('Changing dealer organization revokes old assignment scope and pending/history visibility',async()=>{
 const user=await s.createUser(demo.admin,{email:'orgswitch@example.test',name:'Учебный менеджер перевода',role:'dealer_manager',dealerId:demo.dealerA,operationId:op()});
 await db.query("UPDATE fiverox.clients SET master=jsonb_set(master,'{phones}','\"SYNTHETIC-APPROVED-CONTACT\"'::jsonb) WHERE id='DEMO-3'");
 let t=await s.createTransfer(demo.admin,{leadId:'DEMO-3',dealerId:demo.dealerA,assigneeUserId:user.id,shareContacts:true,note:'Разрешённая передача',operationId:op()});t=await s.decideTransfer(user.id,t.id,'accept',{version:t.version,operationId:op()});assert.equal((await s.read(user.id,'DEMO-3')).phones,'SYNTHETIC-APPROVED-CONTACT');
 await s.saveUser(demo.admin,user.id,{dealerId:demo.dealerB,operationId:op()});const w=await s.workspace(user.id);assert.equal(w.leads.length,0);assert.equal(w.transfers.length,0);await rejects(()=>s.read(user.id,'DEMO-3'),'NOT_FOUND');
});
test('Creating a customer retains all eight working values and cannot be done by a dealer',async()=>{
 const f=['Клиент','Рабочая метка','2026-11-14','План действия','2026-11-13','Сохранённая заметка','12000',''];const c=await s.createClient(demo.admin,{record:{name:'Учебная новая точка',kind:'customer',fields:f},operationId:op()});assert.equal(c.kind,'customer');assert.deepEqual(c.fields,f);await rejects(()=>s.createClient(demo.b,{record:{name:'Нельзя'},operationId:op()}),'ACCESS_DENIED');
});
