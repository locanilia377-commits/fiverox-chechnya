import {closedStages,closedActivities,metrics,monthlyRevenue,saleAmount,isOverdue,nextActivity,localDateTimeInput} from './model.mjs';
import {createPublicUI,countLabel} from './public.mjs';
import {createSheetsClient,endpointReady,readStoredSession,storeSession,clearStoredSession,normalizePilotLead,upsertById,verifiedSheetUrl} from './sheets-client.mjs?v=20261118';

const $=id=>document.getElementById(id);
const config=window.FIVEROX_PLATFORM_CONFIG||{};
const roleLabels={admin:'Владелец · тестовый пилот'};
const publicRoutes=[['market','◒','Рынок региона'],['research','⌕','Компании и конкуренция'],['model','∑','Модель продаж']];
const isPublic=route=>publicRoutes.some(r=>r[0]===route);
const isLoopback=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const apiAvailable=()=>config.pilotEnabled===true&&endpointReady(config.backendUrl);
let publicUI=null,publicLoadFailed=false;
const isStaff=()=>session?.role==='admin';
const allRoutes=()=>[...publicRoutes,...routes];
const fields=['stage','manager','due','next','last','note','amount','reason'];
const routes=[['leads','▦','Заявки'],['transfers','⇄','Передачи дилерам'],['customers','▣','Клиенты и точки'],['plan','✓','План действий'],['visits','◷','Посещения'],['tests','◇','Тесты плёнок'],['equipment','▱','Оборудование'],['sales','₽','Продажи'],['analytics','▥','Аналитика']];
const activityNames={task:'Целевое действие',visit:'Посещение',test:'Тест плёнки',equipment:'Оборудование'};
const statusLabels={pending:'Ожидает принятия',active:'Принято · доступ открыт',revoked:'Доступ отозван',expired:'Срок истёк',planned:'Запланировано',in_progress:'В работе',completed:'Выполнено',cancelled:'Отменено',issued:'Выдано',returned:'Возвращено',transferred:'Передано',accepted:'Принято',declined:'Отклонено',confirmed:'Подтверждено'};
const colors=['#52a7c2','#6195ce','#7c8fd4','#8e8acb','#ad8cc6','#c29f5f','#76a87d','#459e87','#bf7d8b'];
const money=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(value)||0)+' ₽';
const count=value=>new Intl.NumberFormat('ru-RU').format(value||0);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(new Date(value+'T12:00:00Z')):'Без даты';
const fullDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('.'):'—';
const shortTimestamp=value=>{try{return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))+' МСК';}catch{return String(value||'');}};
const option=(value,label=value,selected='')=>`<option value="${esc(value)}"${value===selected?' selected':''}>${esc(label)}</option>`;
const options=(items,selected)=>items.map(item=>Array.isArray(item)?option(item[0],item[1],selected):option(item,item,selected)).join('');
const btn=(text,action,attrs='',extra='')=>`<button type="button" class="btn ${extra}" data-action="${action}" ${attrs}>${esc(text)}</button>`;
const pill=(text,color='')=>`<span class="pill ${color}">${esc(text)}</span>`;
const empty=(title,body,action='')=>`<div class="empty-state"><div class="empty-icon" aria-hidden="true">◇</div><strong>${esc(title)}</strong>${esc(body)}${action}</div>`;
const table=(headers,rows)=>rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
const leadButton=leadId=>{const l=db?.leads.find(l=>l.id===leadId);return `<button type="button" class="company-button" data-action="open-card" data-id="${esc(leadId)}">${esc(l?.name||'Карточка недоступна')}</button>`;};
const rowCompany=l=>`${leadButton(l.id)}<div class="sub">${esc(l.city||'Город не указан')} · ${esc(l.profile||'Услуги не указаны')}</div>`;
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:'';}catch{return '';}};
let session=null,viewId=0,requestId=0,cardRequestId=0,db=null,current=null,screen='market',mode='board',query='',filterStage='',filterDue='',filterManager='',itemStatus='',saving=false,loading=false,drawerTab='overview',focusReturn=null,modal=null;
let emailProof='',emailAddress='',emailResendTimer,emailResendUntil=0,toastTimer;
const pendingOperations=new Map();
const pendingMoves=new Map();
let writeQueue=Promise.resolve();
let cardReady=false, eventState='idle', workspaceError='';
const crmRouteKey='fiverox.sheets.pilot.last-route';
let lastCrmRoute='leads';
let crmStatus='Загружаю кабинет…', crmSync='';
function rememberCrmRoute(route){
  lastCrmRoute=route;
  try{sessionStorageSafe()?.setItem(crmRouteKey,route);}catch{}
}
function setCrmStatus(message,detail=crmSync){
  crmStatus=message;
  crmSync=detail;
  if(!session||isPublic(screen))return;
  $('syncStatus').textContent=message;
  $('lastSync').textContent=detail;
}
const routeViews=new Map();
function savedDuration(ms){return (ms/1000).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+' с';}

const abandoned=new Error('Запрос отменён.');
const emailStart=$('emailStart'),emailVerify=$('emailVerify'),resendEmail=$('resendEmail');
const canEdit=()=>session?.role==='admin';
function errorCode(error){const code=error?.message?.match(/\b(?:CRM_)?(AUTH_REQUIRED|FORBIDDEN|ACCESS_DENIED)\b/)?.[1];return code==='AUTH_REQUIRED'?'CRM_AUTH_REQUIRED':code?'CRM_FORBIDDEN':undefined;}
function errorText(error){return String(error?.message||'Проверьте подключение и попробуйте снова.').replace(/^(?:Error:\s*)?(?:CRM_)?[A-Z_]+:\s*/,'');}
function accessStatus(id,message='',error=false){const node=$(id);if(!node)return;node.textContent=message;node.classList.toggle('error',error);}
function setFormBusy(target,value){for(const control of target.elements)control.disabled=value;}
function notice(message='',error=false){$('globalNotice').textContent=message;$('globalNotice').hidden=!message;$('globalNotice').classList.toggle('error',error);}
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').classList.add('show');toastTimer=setTimeout(()=>$('toast').classList.remove('show'),6000);}
let lastRpcMilliseconds=0,lastWriteMilliseconds=0;
const rpc=createSheetsClient(config.backendUrl,{onMeasure:sample=>{lastRpcMilliseconds=sample.milliseconds;}});
function sessionStorageSafe(){try{return window.sessionStorage;}catch{return null;}}
async function call(name,...args){if(!apiAvailable())throw new Error('CRM_UNAVAILABLE: Тестовая CRM ещё подключается.');return rpc(name,...args);}
async function crmCall(name,...args){const identity=session,view=viewId;try{const result=await call(name,identity?.token??'',...args);if(view!==viewId)throw abandoned;return result;}catch(error){if(view!==viewId)throw abandoned;if(identity&&errorCode(error)==='CRM_AUTH_REQUIRED'){endSession(errorText(error));throw abandoned;}throw error;}}
async function write(name,args,key,validate=()=>true){
  const view=viewId, fingerprint=JSON.stringify([name,args]);
  let operation=pendingOperations.get(key);
  if(!operation || operation.fingerprint!==fingerprint){
    operation={fingerprint,id:crypto.randomUUID()};
    pendingOperations.set(key,operation);
  }
  const task=writeQueue.then(async()=>{
    if(view!==viewId)throw abandoned;
    const started=performance.now();
    const result=await crmCall(name,...args,operation.id);
    if(!validate(result))throw new Error('CRM_RESPONSE: Не удалось подтвердить результат команды.');
    lastWriteMilliseconds=performance.now()-started;
    if(pendingOperations.get(key)===operation)pendingOperations.delete(key);
    return result;
  });
  writeQueue=task.catch(()=>{});
  return task;
}
function updateEmailResend(){clearTimeout(emailResendTimer);const delay=emailResendUntil-Date.now();resendEmail.disabled=delay>0;if(delay>0)emailResendTimer=setTimeout(updateEmailResend,delay);}
function resetEmailSignIn(){emailAddress='';emailResendUntil=0;emailStart.reset();emailVerify.reset();setFormBusy(emailStart,false);setFormBusy(emailVerify,false);emailStart.hidden=false;emailVerify.hidden=true;$('emailDestination').textContent='';updateEmailResend();}
function showSignIn(message=''){$('appShell').hidden=false;$('main').hidden=true;$('authScreen').hidden=false;$('signInPanel').open=true;resetEmailSignIn();drawNav();$('breadcrumb').textContent='Личный кабинет';$('syncStatus').textContent='Вход в CRM';$('refreshWorkspace').hidden=true;$('signOut').hidden=true;setFormBusy(emailStart,!apiAvailable());accessStatus('signInStatus',message||(!apiAvailable()?'Подключение тестовой Google CRM ещё не завершено.':''),!!message);$('authConnectionNote').hidden=apiAvailable();$('retrySession').hidden=!readStoredSession(sessionStorageSafe(),config.backendUrl);}
function endSession(message=''){clearStoredSession(sessionStorageSafe(),config.backendUrl);session=null;$('sheetLink').hidden=true;$('sheetLink').removeAttribute('href');viewId+=1;requestId+=1;db=current=null;pendingOperations.clear();pendingMoves.clear();writeQueue=Promise.resolve();routeViews.clear();rememberCrmRoute('leads');setCrmStatus('Загружаю кабинет…','');workspaceError='';saving=loading=false;closeCard(true);closeModal(true);$('dialogTitle').textContent='';$('dialogStatus').textContent='';$('main').replaceChildren();$('cardTitle').textContent='Карточка';$('cardMeta').textContent='';$('sidebarCount').textContent='Публичное исследование';$('lastSync').textContent='';$('toast').textContent='';$('toast').classList.remove('show');$('identityEmail').textContent='Личный кабинет';$('identityRole').textContent='Вход';$('avatar').textContent='?';notice();showSignIn(message);}
async function openSession(identity,{persist=true,workspace=null}={}){const display=identity?.email||'';if(identity?.role!=='admin'||typeof display!=='string'||!display||typeof identity.token!=='string'||!identity.token)throw new Error('CRM_FORBIDDEN: Сейчас тестовая CRM доступна только владельцу.');if(workspace)applyWorkspace(workspace);session=identity;if(persist)storeSession(sessionStorageSafe(),config.backendUrl,identity);viewId+=1;requestId+=1;if(!workspace)db=null;current=null;resetEmailSignIn();$('authScreen').hidden=true;$('main').hidden=false;$('appShell').hidden=false;$('identityEmail').textContent=display;$('identityRole').textContent=roleLabels.admin;$('avatar').textContent=display.slice(0,1).toUpperCase();$('signOut').hidden=false;const sheetUrl=verifiedSheetUrl(identity.sheetUrl);$('sheetLink').hidden=!sheetUrl;if(sheetUrl)$('sheetLink').href=sheetUrl;$('accessNotice').textContent='Тестовая CRM на закрытой Google Таблице. Доступ только владельцу; дилеры пока не приглашены. Сессия действует до 12 часов в этой вкладке.';if(workspace){render();showSynced();}else await loadWorkspace().catch(()=>{});}
async function requestEmailCode(email){const view=viewId;let sent=false;setFormBusy(emailStart,true);setFormBusy(emailVerify,true);accessStatus('signInStatus','Запрашиваю код…');try{if(!emailProof)emailProof=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');await call('crmEmailStart',email,emailProof);if(view!==viewId)return;sent=true;emailAddress=email;emailResendUntil=Date.now()+90000;emailVerify.reset();$('emailDestination').textContent='Адрес: '+email;emailStart.hidden=true;emailVerify.hidden=false;accessStatus('signInStatus','Запрос на код принят. Проверьте «Входящие» и «Спам» и введите код в этой же вкладке. Код действует 10 минут. Повторить запрос можно через 90 секунд. Если письма нет, уточните у администратора, что у этого адреса есть доступ к тестовой CRM.');}catch(error){if(view===viewId)accessStatus('signInStatus',errorText(error),true);}finally{if(view===viewId){setFormBusy(emailStart,false);setFormBusy(emailVerify,false);updateEmailResend();if(sent)emailVerify.elements.code.focus();}}}
emailStart.addEventListener('submit',event=>{event.preventDefault();const email=emailStart.elements.email.value.trim();if(email)requestEmailCode(email);});
resendEmail.addEventListener('click',()=>{if(emailAddress&&Date.now()>=emailResendUntil)requestEmailCode(emailAddress);});
$('changeEmail').addEventListener('click',()=>{const email=emailAddress;resetEmailSignIn();emailStart.elements.email.value=email;emailStart.elements.email.focus();accessStatus('signInStatus');});
emailVerify.addEventListener('submit',async event=>{event.preventDefault();if(!emailAddress||!emailProof)return;const view=viewId,code=emailVerify.elements.code.value.trim();setFormBusy(emailVerify,true);accessStatus('signInStatus','Проверяю код…');try{const {token,session:identity}=await call('crmEmailVerify',emailAddress,emailProof,code);if(view===viewId)await openSession({...identity,token,provider:'email'});}catch(error){if(view===viewId)accessStatus('signInStatus',errorText(error),true);}finally{if(view===viewId){setFormBusy(emailVerify,false);updateEmailResend();}}});
$('signOut').addEventListener('click',async()=>{if(!discardChanges())return;const token=session?.token;endSession('Кабинет закрыт.');if(!token)return;const view=viewId;try{await call('crmEmailLogout',token);}catch(error){if(view===viewId)accessStatus('signInStatus','Кабинет закрыт на этом устройстве. Срок сессии истечёт автоматически.',true);}});

function isCardDirty(){const form=$('cardForm'),comment=Boolean($('contactForm')?.elements.comment.value);return comment||Boolean(current&&form&&fields.some((key,index)=>form.elements[key].value!==String(current.fields[index]??'')));}
function modalValues(){return modal?JSON.stringify(Object.fromEntries(new FormData($('entityForm')))):'';}
function isModalDirty(){return modal&&modalValues()!==modal.initial;}
function discardChanges(){if(saving){toast('Дождитесь завершения сохранения.');return false;}return !(isCardDirty()||isModalDirty())||confirm('Есть несохранённые изменения. Закрыть их без сохранения?');}
function setSaving(value){saving=value;for(const form of [$('cardForm'),$('contactForm'),$('entityForm')])if(form)setFormBusy(form,value||!canEdit()||(form.id!=='entityForm'&&(!cardReady||pendingMoves.has(current?.id))));for(const node of document.querySelectorAll('[data-write]'))node.disabled=value||!canEdit()||($('cardBody').contains(node)&&(!cardReady||pendingMoves.has(current?.id)));$('refreshWorkspace').disabled=value||loading||[...pendingMoves.values()].some(move=>move.status==='pending');}
function applyWorkspace(result){
  if(!result||!['leads','stages','actions','activities','sales','transfers'].every(key=>Array.isArray(result[key])))throw new Error('Не удалось прочитать структуру CRM.');
  db={...result,leads:result.leads.map(normalizePilotLead)};
  workspaceError='';
}
function showSynced(){
  setCrmStatus('Данные обновлены','Синхронизация '+new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date())+' МСК');
}
async function loadWorkspace(force=false){
  if(loading||[...pendingMoves.values()].some(move=>move.status==='pending'))return;
  const view=viewId,request=++requestId;
  loading=true;
  setCrmStatus('Синхронизация…');
  $('refreshWorkspace').disabled=true;
  try{
    const result=await crmCall(force?'crmWorkspaceFresh':'crmWorkspace');
    if(view!==viewId||request!==requestId)return;
    applyWorkspace(result);
    if(!isPublic(screen)){notice();renderCrmAtSamePosition();}
    showSynced();
  }catch(error){
    if(view!==viewId||request!==requestId||error===abandoned)return;
    workspaceError=errorText(error);
    setCrmStatus('Ошибка синхронизации');
    if(!isPublic(screen)){notice(workspaceError,true);renderCrmAtSamePosition();}
    throw error;
  }finally{
    if(view===viewId&&request===requestId){loading=false;setSaving(saving);}
  }
}
$('refreshWorkspace').addEventListener('click',async()=>{if(!discardChanges())return;closeCard(true);try{await loadWorkspace(true);}catch{}});
function stat(label,value,note,extra=''){return `<article class="stat ${extra}"><div class="stat-label">${esc(label)}</div><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;}
function heading(title,subtitle,actions=''){return `<header class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></header>`;}
function searchToolbar(extra='',total=0){return `<div class="toolbar"><div class="search-wrap"><span aria-hidden="true">⌕</span><input id="workspaceSearch" type="search" placeholder="Компания, город или ID" aria-label="Поиск" value="${esc(query)}"></div>${extra}<span class="result-count">${countLabel(total,'запись','записи','записей')}</span></div>`;}
function stagePill(stage){return pill(stage,stage==='Клиент'?'green':stage==='Отказ'?'red':'blue');}
function activityPill(a){return pill(statusLabels[a.status]||a.status,closedActivities.has(a.status)?(a.status==='cancelled'?'red':'green'):a.status==='issued'?'purple':'blue');}
function duePill(due,closed=false){return due?pill(day(due),!closed&&due<db.today?'red':due===db.today?'orange':''):pill('Без даты');}
function leadMatches(l){const q=query.toLocaleLowerCase('ru');return (!q||[l.name,l.city,l.id,l.profile,l.phones,l.manager].some(v=>String(v||'').toLocaleLowerCase('ru').includes(q)))&&(!filterStage||l.stage===filterStage)&&(!filterManager||l.manager===filterManager)&&(!filterDue||(filterDue==='none'&&!l.due)||(filterDue==='today'&&l.due===db.today)||(filterDue==='late'&&l.due&&l.due<db.today&&!closedStages.has(l.stage))||(filterDue==='planned'&&l.due>db.today));}
function leadFilters(){const managers=[...new Set(db.leads.map(l=>l.manager).filter(Boolean))].sort();return `<select id="stageFilter" aria-label="Этап">${option('','Все этапы',filterStage)}${options(db.stages,filterStage)}</select><select id="managerFilter" aria-label="Ответственный">${option('','Все ответственные',filterManager)}${options(managers,filterManager)}</select><select id="dueFilter" aria-label="Следующий контакт">${options([['','Любой срок'],['late','Просрочено'],['today','Сегодня'],['planned','Запланировано'],['none','Без даты']],filterDue)}</select>`;}
function moveLabel(move){return move.status==='pending'?'Сохраняется этап…':'Этап не подтверждён';}
function boardCard(l){
  const move=pendingMoves.get(l.id);
  const card=leadCard(l);
  if(!move)return card;
  return `<div class="move-card">${card}<div class="move-status" role="status">${moveLabel(move)}</div>${move.status==='unknown'?btn('Повторить перенос','retry-move',`data-id="${esc(l.id)}"`,'small'):''}</div>`;
}
function leadCard(l){return `<button type="button" class="lead-card" data-action="open-card" data-id="${esc(l.id)}" data-movable="${canEdit()&&!saving&&!pendingMoves.has(l.id)}"><h3>${esc(l.name)}</h3><span class="profile-label">${esc(l.profile||'Услуги не указаны')}</span><p>${esc(l.city||'Город не указан')}</p>${l.next?`<p>${esc(l.next)}</p>`:''}${l.due?`<div class="due-pill">${duePill(l.due,closedStages.has(l.stage))}</div>`:''}<div class="lead-card-footer"><strong>${esc(l.manager||'Не назначен')}</strong><span>${l.amount?money(l.amount):'Без оценки'}</span></div></button>`;}
function renderLeads(customers=false){const baseLeads=db.leads.filter(l=>customers?l.kind==='customer':l.kind!=='customer'),m=metrics({...db,leads:baseLeads}),matches=baseLeads.filter(l=>pendingMoves.has(l.id)||leadMatches(l)).map(l=>{
  const move=pendingMoves.get(l.id);
  return move?{...l,stage:move.target}:l;
});return heading(customers?'Клиенты и точки':'Заявки',customers?'Компании на этапе «Клиент» и регулярное сопровождение':'Входящие компании и первый контакт',isStaff()?btn(customers?'Добавить точку':'+ Новая заявка','new-lead',`data-write data-kind="${customers?'customer':'inquiry'}"`,'primary'):'')+`<div class="stats">${stat('Всего карточек',count(m.total),'Единая база компаний','accent')}${stat('В работе',count(m.active),'Открытые этапы воронки')}${stat('Клиенты',count(m.clients),'Этап «Клиент»')}${stat('Просроченные контакты',count(m.overdueCards.length),'Открытые карточки с датой в прошлом',m.overdueCards.length?'attention':'')}</div>`+(customers?'':`<div class="views" role="group" aria-label="Вид заявок"><button class="view-button ${mode==='board'?'active':''}" data-action="view-board" aria-pressed="${mode==='board'}">▦ Канбан</button><button class="view-button ${mode==='list'?'active':''}" data-action="view-list" aria-pressed="${mode==='list'}">☷ Список</button></div>`)+searchToolbar(leadFilters(),matches.length)+(customers||mode==='list'?`<section class="box table-box">${table(['Компания / точка','Этап','Ответственный','Следующий контакт','Следующий шаг','Оценка сделки'],matches.map(l=>[rowCompany(l),stagePill(l.stage)+(pendingMoves.has(l.id)?` <span class="move-status" role="status">${moveLabel(pendingMoves.get(l.id))}</span>`+(pendingMoves.get(l.id).status==='unknown'?btn('Повторить перенос','retry-move',`data-id="${esc(l.id)}"`,'small'):''):''),esc(l.manager||'Не назначен'),duePill(l.due,closedStages.has(l.stage)),esc(l.next||'—'),l.amount?money(l.amount):'—']))||empty('Карточки не найдены','Измените поиск или фильтры.')}</section>`:`<p class="selection-info">Перетаскивайте карточки между этапами. На телефоне этап можно изменить внутри карточки.</p><section class="board" aria-label="Воронка заявок" tabindex="0">${db.stages.map((stage,index)=>{const ls=matches.filter(l=>l.stage===stage);return `<div class="column" data-stage="${esc(stage)}" style="--stage:${colors[index%colors.length]}"><header class="column-head"><span>${esc(stage)}</span><span>${ls.length}</span></header>${ls.map(boardCard).join('')||'<div class="empty-column">Карточек пока нет</div>'}</div>`;}).join('')}</section>`);}
function matchItem(item){const lead=db.leads.find(l=>l.id===item.leadId),q=query.toLocaleLowerCase('ru');return (!itemStatus||item.status===itemStatus)&&(!q||[lead?.name,lead?.city,item.id,item.title,item.item,item.dealer,item.manager,item.result].some(v=>String(v||'').toLocaleLowerCase('ru').includes(q)));}
function itemFilter(statuses){return `<select id="itemStatus" aria-label="Статус">${option('','Все статусы',itemStatus)}${statuses.map(s=>option(s,statusLabels[s],itemStatus)).join('')}</select>`;}
function renderActivities(kind=''){const titles={task:'План действий',visit:'Посещения',test:'Тесты плёнок',equipment:'Оборудование'},subs={task:'Независимые цели, сроки и исполнители по каждой точке',visit:'План и факт посещений, результаты и следующая дата',test:'Плёнка, тестирование, обратная связь и следующий шаг',equipment:'Потребность, договор, выдача и возврат'},type=kind||'task';const items=db.activities.filter(a=>(!kind||a.kind===kind)&&matchItem(a)).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));const all=db.activities.filter(a=>!kind||a.kind===kind),open=all.filter(a=>!closedActivities.has(a.status)),late=open.filter(a=>isOverdue(a,db.today));const actionLabel={task:'Целевое действие',visit:'Запланировать посещение',test:'Новый тест',equipment:'Новая потребность'}[type];const statuses=kind==='equipment'?['planned','issued','returned','cancelled']:!kind?['planned','in_progress','completed','issued','returned','cancelled']:['planned','in_progress','completed','cancelled'];return heading(titles[type],subs[type],canEdit()?btn('+ '+actionLabel,'new-activity',`data-kind="${type}" data-write`,'primary'):'')+`<div class="stats">${stat('Всего',count(all.length),'Записано в CRM','accent')}${stat('Открыто',count(open.length),'Запланировано и в работе')}${stat('Завершено',count(all.filter(a=>closedActivities.has(a.status)&&a.status!=='cancelled').length),'Результат зафиксирован')}${stat('Просрочено',count(late.length),'Требуют внимания',late.length?'attention':'')}</div>`+searchToolbar(itemFilter(statuses),items.length)+`<section class="box table-box">${table(['Действие','Точка','Срок / факт','Исполнитель','Статус','Периодичность',''],items.map(a=>[`${esc(a.title)}<div class="sub">${esc(activityNames[a.kind])}</div>`,leadButton(a.leadId),`${duePill(a.due,closedActivities.has(a.status))}${a.occurredAt?`<div class="sub">Факт: ${fullDay(a.occurredAt)}</div>`:''}`,esc(a.manager||'Не назначен'),activityPill(a),a.repeatDays?esc(a.repeatDays)+' дней':'Разовое',btn('Открыть','edit-item',`data-kind="activity" data-id="${esc(a.id)}"`,'small')]))||empty('Действий пока нет','Добавьте первое действие по клиенту.',canEdit()?btn(actionLabel,'new-activity',`data-kind="${type}" data-write`,'primary'):'')}</section>`+(kind==='equipment'?'<div class="note warning">Выдача оборудования требует заполненного договора. Оборудование учитывается отдельно от продаж материалов.</div>':'');}
function renderTransfers(){const items=db.transfers.filter(matchItem).sort((a,b)=>(b.date||'').localeCompare(a.date||''));return heading('Передачи дилерам','Учёт передач и результатов · тестовый пилот владельца',canEdit()?btn('+ Передать клиента','new-transfer','data-write','primary'):'')+searchToolbar(itemFilter(['planned','transferred','accepted','declined']),items.length)+`<section class="box table-box">${table(['Клиент','Дилер','Исполнитель','Статус','Дата передачи','Следующий контакт',''],items.map(t=>[leadButton(t.leadId),esc(t.dealer),esc(t.manager||'Не назначен'),pill(statusLabels[t.status],t.status==='accepted'?'green':t.status==='declined'?'red':'blue'),fullDay(t.date),duePill(t.nextContact,t.status==='declined'),btn('Открыть','edit-item',`data-kind="transfer" data-id="${esc(t.id)}"`,'small')]))||empty('Передач пока нет','Создайте передачу и укажите дилера, исполнителя и срок.',canEdit()?btn('Передать клиента','new-transfer','data-write','primary'):'')}</section><div class="note">Передача сохраняет связь с карточкой клиента. Это учётная запись. Она не открывает доступ дилеру: в пилоте работает только владелец.</div>`;}
function renderSales(){const items=db.sales.filter(matchItem).sort((a,b)=>b.date.localeCompare(a.date)),m=metrics(db);return heading('Продажи','Каждая покупка — отдельная запись с продавцом, складом и источником',canEdit()?btn('+ Записать продажу','new-sale','data-write','primary'):'')+`<div class="stats">${stat('Подтверждённые продажи',money(m.revenue),'Материалы и услуги','accent')}${stat('Покупок',count(m.sales.length),'Только подтверждённые записи')}${stat('Покупающих точек',count(m.buyers),'Есть подтверждённая покупка')}${stat('Средняя покупка',m.sales.length?money(m.revenue/m.sales.length):'Нет данных','Сумма подтверждённых продаж / покупки')}</div>`+searchToolbar(itemFilter(['planned','confirmed','cancelled']),items.length)+`<section class="box table-box">${salesTable(items)||empty('Продаж пока нет','Запишите реальную покупку, чтобы видеть результаты.',canEdit()?btn('Записать продажу','new-sale','data-write','primary'):'')}</section><div class="note">Оценка сделки в карточке не является продажей. В выручку входят только подтверждённые материалы и услуги; отменённые записи и оборудование исключены.</div>`;}
function salesTable(items){return table(['Дата','Точка','Товар / услуга','Количество × цена','Сумма','Продавец / склад','Статус / источник',''],items.map(s=>[fullDay(s.date),leadButton(s.leadId),`${esc(s.item)}<div class="sub">${s.category==='material'?'Материал':'Услуга'}</div>`,`${count(s.quantity)} ${esc(s.unit||'')} × ${money(s.unitPrice)}`,`<strong class="inline-value">${money(saleAmount(s))}</strong>`,`${esc(s.seller)}<div class="sub">${esc(s.warehouse)}</div>`,`${pill(statusLabels[s.status],s.status==='confirmed'?'green':s.status==='cancelled'?'red':'blue')}<div class="sub">${esc(s.source)}</div>`,btn('Открыть','edit-item',`data-kind="sale" data-id="${esc(s.id)}"`,'small')]));}
function activityCard(a){return `<article class="action-item"><div><h3>${esc(a.title)}</h3><p>${esc(db.leads.find(l=>l.id===a.leadId)?.name||'Клиент')} · ${esc(a.manager||'Не назначен')}</p><p>${day(a.due)} · ${esc(activityNames[a.kind])}</p></div>${btn('Открыть','edit-item',`data-kind="activity" data-id="${esc(a.id)}"`,'small')}</article>`;}
function renderAnalytics(){const m=metrics(db),months=monthlyRevenue(db.sales,db.today),max=Math.max(...months.map(x=>x.amount),1),late=m.overdueActions.sort((a,b)=>a.due.localeCompare(b.due));return heading('Аналитика','Реальные записи CRM, текущая воронка и результаты сопровождения')+`<div class="stats">${stat('Накопленная выручка',money(m.revenue),'Подтверждённые материалы и услуги','accent')}${stat('RR · окно 60 дней',m.rr===null?'Нет данных':m.rr+'%',`${m.rrRepeats} из ${m.rrBase} завершённых окон`)}${stat('Покупающие точки',count(m.buyers),'Есть подтверждённая покупка')}${stat('Просроченные действия',count(late.length),'Незавершённые действия со сроком в прошлом',late.length?'attention':'')}</div><div class="analytics-grid"><section class="box"><h2>Распределение по этапам</h2>${db.stages.map((stage,i)=>{const n=db.leads.filter(l=>l.stage===stage).length;return `<div class="bar-row"><span>${esc(stage)}</span><div class="bar-track"><div class="bar-fill" style="width:${m.total?n/m.total*100:0}%;background:${colors[i%colors.length]}"></div></div><strong>${n}</strong></div>`;}).join('')}<p class="chart-legend">Текущее состояние карточек. Для расчёта конверсии нужна история переходов за выбранный период.</p></section><section class="box"><h2>Подтверждённые продажи по месяцам</h2>${m.sales.length?`<div class="monthly-chart" role="img" aria-label="Продажи за последние шесть месяцев: ${esc(months.map(x=>x.month+' '+money(x.amount)).join('; '))}">${months.map(x=>`<div class="month-col"><strong>${x.amount?money(x.amount):'—'}</strong><div class="month-bar" style="height:${Math.max(2,x.amount/max*125)}px"></div></div>`).join('')}</div><div class="month-labels">${months.map(x=>`<span>${esc(new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(new Date(x.month+'-15T12:00:00Z')))}</span>`).join('')}</div>`:'<div class="empty-chart">График появится после первой подтверждённой продажи</div>'}<p class="chart-legend">Накопленная выручка не является прибылью или прогнозным LTV.</p></section></div><section class="box"><div class="box-header"><h2>Требуют внимания</h2>${btn('План действий','navigate','data-screen="plan"','small')}</div><div class="action-stack">${late.slice(0,5).map(activityCard).join('')||empty('Просроченных действий нет','Планируйте следующие шаги, чтобы сопровождение было регулярным.')}</div></section><section class="box table-box">${table(['Клиент','Первая покупка','Покупок','Накопленная выручка','RR · 60 дней'],m.cohorts.sort((a,b)=>b.revenue-a.revenue).map(c=>[leadButton(c.leadId),fullDay(c.first),count(c.count),money(c.revenue),pill(c.complete?(c.repeat?'Повторил':'Не повторил'):'Окно ещё не завершено',c.complete?(c.repeat?'green':'orange'):'blue')]))||empty('История покупок пока пуста','Клиентская аналитика рассчитывается только по подтверждённым продажам.')}</section><p class="chart-legend">RR: доля клиентов с повторной покупкой в течение 60 дней после первой. В знаменатель входят только клиенты с завершённым окном наблюдения. Ручная отчётность может быть неполной.</p>`;}
function drawNav(){const counts=db?{leads:db.leads.filter(l=>!closedStages.has(l.stage)).length,plan:metrics(db).openActions.length}:{};const item=([route,icon,label],publicRoute=false)=>`<button class="nav-item ${publicRoute?'public ':''}${screen===route?'active':''}" data-action="navigate" data-screen="${route}" ${screen===route?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>${counts[route]?`<span class="nav-badge">${count(counts[route])}</span>`:''}</button>`;$('nav').innerHTML=`<div class="public-section-label">РЕГИОН И ПОТЕНЦИАЛ</div>${publicRoutes.map(r=>item(r,true)).join('')}<div class="public-section-label">РАБОТА С КЛИЕНТАМИ</div>${routes.map(r=>item(r)).join('')}`;$('breadcrumb').textContent=allRoutes().find(r=>r[0]===screen)?.[2]||'Рынок региона';document.title=$('breadcrumb').textContent+' · FIVEROX';$('sidebarCount').textContent=db?countLabel(db.leads.length,'клиент','клиента','клиентов')+(isStaff()?' в контуре':' · доступны вам'):'Исследование региона';$('refreshWorkspace').hidden=!session||isPublic(screen);}
function render(){drawNav();if(isPublic(screen)){$('authScreen').hidden=true;$('main').hidden=false;$('main').innerHTML=publicUI?publicUI.render(screen):empty(publicLoadFailed?'Исследование пока недоступно':'Загружаю исследование',publicLoadFailed?'Обновите страницу, чтобы повторить загрузку.':'');$('main').insertAdjacentHTML('afterbegin',`<div class="public-return">${btn(session?'Вернуться в CRM':'Открыть CRM','return-crm','','small')}</div>`);$('syncStatus').textContent='Снимок 07.11.2026';$('lastSync').textContent='Исследование региона · рабочая CRM отделена';return;}if(!session){showSignIn();return;}setCrmStatus(crmStatus);$('authScreen').hidden=true;$('main').hidden=false;if(!db){$('main').innerHTML=workspaceError?empty('Данные пока недоступны',workspaceError,btn('Повторить','refresh')):'<div class="loading-state">Загружаю рабочие данные…</div>';return;}const renders={leads:()=>renderLeads(),customers:()=>renderLeads(true),plan:()=>renderActivities(),visits:()=>renderActivities('visit'),tests:()=>renderActivities('test'),equipment:()=>renderActivities('equipment'),transfers:renderTransfers,sales:renderSales,analytics:renderAnalytics};$('main').innerHTML=(renders[screen]||renders.leads)();$('main').insertAdjacentHTML('afterbegin','<p class="scope-note">Тестовая CRM · доступ только владельцу · данные сохраняются в закрытую Google Таблицу.</p>');setSaving(saving);}
function renderCrmAtSamePosition(){
  if(isPublic(screen))return;
  const left=$('main').querySelector('.board')?.scrollLeft;
  const top=window.scrollY;
  render();
  const board=$('main').querySelector('.board');
  if(board&&left!==undefined)board.scrollLeft=left;
  window.scrollTo(0,top);
}
async function navigate(next,{push=true}={}){
  if(!allRoutes().some(r=>r[0]===next))next='market';
  if(next===screen){if(!session&&!isPublic(screen)&&apiAvailable())await restoreSession();return;}
  if(!discardChanges()){
    if(!push)history.pushState(null,'','#'+screen);
    return;
  }
  if(!isPublic(screen)){
    routeViews.set(screen,{query,mode,filterStage,filterDue,filterManager,itemStatus,left:$('main').querySelector('.board')?.scrollLeft,top:window.scrollY});
  }
  cancelPointerKanban();
  closeCard(true);
  if($('editorDialog').open)$('editorDialog').close();
  modal=null;
  screen=next;
  if(!isPublic(screen))rememberCrmRoute(screen);
  const saved=routeViews.get(screen)||{};
  ({query='',mode='board',filterStage='',filterDue='',filterManager='',itemStatus=''}=saved);
  if(push)history.pushState(null,'','#'+screen);
  notice();
  render();
  closeMenu();
  const board=$('main').querySelector('.board');
  if(board&&saved.left!==undefined)board.scrollLeft=saved.left;
  $('main').focus({preventScroll:true});
  window.scrollTo(0,saved.top||0);
  if(!isPublic(screen)&&!session&&apiAvailable())await restoreSession();
}
function closeMenu(){$('sidebar').classList.remove('open');$('navBackdrop').hidden=true;$('menuToggle').setAttribute('aria-expanded','false');}
$('menuToggle').addEventListener('click',()=>{const on=!$('sidebar').classList.contains('open');$('sidebar').classList.toggle('open',on);$('navBackdrop').hidden=!on;$('menuToggle').setAttribute('aria-expanded',String(on));});$('navBackdrop').addEventListener('click',closeMenu);

function preserveSearchFocus(renderTask){const input=$('workspaceSearch'),pos=input?.selectionStart;renderTask();const next=$('workspaceSearch');if(next){next.focus();try{next.setSelectionRange(pos,pos);}catch{}}}
$('main').addEventListener('input',event=>{if(event.target.id==='workspaceSearch'){query=event.target.value;preserveSearchFocus(render);}});
$('main').addEventListener('change',event=>{const id=event.target.id;if(id==='stageFilter')filterStage=event.target.value;else if(id==='managerFilter')filterManager=event.target.value;else if(id==='dueFilter')filterDue=event.target.value;else if(id==='itemStatus')itemStatus=event.target.value;else return;render();});

function inputField(label,name,value='',type='text',required=false,attrs='',full=false){return `<label class="field ${full?'full':''}">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}"${required?' required':''} ${attrs}></label>`;}
function selectField(label,name,values,value='',required=false,full=false){return `<label class="field ${full?'full':''}">${esc(label)}<select name="${name}"${required?' required':''}>${options(values,value)}</select></label>`;}
function textField(label,name,value='',full=true,max=3000){return `<label class="field ${full?'full':''}">${esc(label)}<textarea name="${name}" maxlength="${max}" rows="3">${esc(value)}</textarea></label>`;}
function leadSelect(selected=''){return `<label class="field full">Клиент / точка<select name="leadId" required>${option('','Выберите компанию',selected)}${db.leads.map(l=>option(l.id,[l.name,l.city].filter(Boolean).join(' · '),selected)).join('')}</select></label>`;}
function cardFormHtml(){const values=Object.fromEntries(fields.map((f,i)=>[f,String(current.fields[i]??'')]));return `<form id="cardForm"><div class="form-grid">${selectField('Этап','stage',db.stages,values.stage,true)}${inputField('Ответственный','manager',values.manager,'text',false,'maxlength="254"'+(session.role==='dealer_manager'?' readonly':''))}${inputField('Следующий контакт','due',values.due,'date')}${inputField('Последний контакт','last',values.last,'date')}${inputField('Следующий шаг','next',values.next,'text',false,'maxlength="500"',true)}${textField('Заметка менеджера','note',values.note)}${inputField('Оценка сделки, ₽','amount',values.amount,'number',false,'min="0" step="0.01" max="1000000000000"')}${inputField('Причина отказа','reason',values.reason,'text',false,'maxlength="500"')}</div><div class="form-actions"><p class="muted">Изменение и событие журнала сохраняются сервером вместе.</p><button type="submit" class="btn primary" data-write>Сохранить карточку</button></div><p id="cardStatus" class="drawer-status" role="status"></p></form>`;}
function historyHtml(){const contacts=current.history||[],audit=current.audit||[];return `<section><h3>История контактов</h3>${canEdit()?`<form id="contactForm" class="form-section"><div class="form-grid">${selectField('Действие','action',db.actions,db.actions[0],true,true)}${textField('Результат','comment')}</div><div class="form-actions"><p class="muted">Автор и время фиксируются автоматически.</p><button type="submit" class="btn primary" data-write>Добавить в историю</button></div><p id="contactStatus" class="drawer-status" role="status"></p></form>`:''}<div class="timeline">${contacts.map(row=>{if(Array.isArray(row))return `<article class="event"><strong>${esc(row[1]||'Контакт')}</strong><p>${esc(row[2]||'Без комментария')}</p><small>${esc([row[0],row[3]].filter(Boolean).join(' · '))}</small></article>`;return `<article class="event"><strong>${esc(row.action||'Контакт')}</strong><p>${esc(row.note||row.result||'Без комментария')}</p><small>${esc([row.at,row.actor||row.email].filter(Boolean).join(' · '))}</small></article>`;}).join('')||'<p class="meta">Контакты ещё не записаны.</p>'}</div></section><section class="form-section"><h3>Журнал изменений</h3><p class="meta">Изменения, внесённые через CRM. В карточке показаны последние события.</p><div class="timeline">${audit.map(event=>`<article class="event"><strong>${esc(event.action||'Изменение')}</strong><small>${esc(event.at)} · ${esc(event.email||event.actor||'')}</small>${(event.changes||[]).map(change=>`<div class="diff"><b>${esc(change.field||'Поле')}</b><div class="diff-values"><span class="before">${esc(change.before===undefined||change.before===null||change.before===''?'Пусто':change.before)}</span><span aria-label="изменено на">→</span><span class="after">${esc(change.after===undefined||change.after===null||change.after===''?'Пусто':change.after)}</span></div></div>`).join('')}</article>`).join('')||'<p class="meta">Изменений пока нет.</p>'}</div></section>`;}
function renderDrawer(){if(!current)return;$('cardTitle').textContent=current.name;$('cardMeta').textContent=[current.city,current.address,current.profile,current.id].filter(Boolean).join(' · ');const links=(current.links||[]).map((link,i)=>{const url=safeUrl(link);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${i?'Яндекс':'2ГИС'} ↗</a>`:'';}).join('');const tabs=[['overview','Работа с клиентом'],['profile','Профиль точки'],['plan','План действий'],['sales','Продажи'],['history','История и журнал']];let content='';if(drawerTab==='overview')content=cardFormHtml();if(drawerTab==='profile')content=profileHtml();if(drawerTab==='history')content=eventState==='ready'?historyHtml():eventState==='error'?empty('История недоступна','Повторите загрузку.',btn('Повторить','retry-events')):'<p role="status">Загружаю историю и журнал…</p>';if(drawerTab==='plan'){const items=db.activities.filter(a=>a.leadId===current.id);content=`<div class="box-header"><h3>Индивидуальный план</h3>${canEdit()?btn('+ Действие','new-activity',`data-kind="task" data-lead="${esc(current.id)}" data-write`,'small primary'):''}</div><div class="action-stack">${items.map(activityCard).join('')||empty('Действий пока нет','Назначьте первый целевой шаг для этой точки.')}</div>`;}if(drawerTab==='sales'){const items=db.sales.filter(s=>s.leadId===current.id).sort((a,b)=>b.date.localeCompare(a.date));content=`<div class="box-header"><h3>История покупок</h3>${canEdit()?btn('+ Продажа','new-sale',`data-lead="${esc(current.id)}" data-write`,'small primary'):''}</div>${salesTable(items)||empty('Покупок пока нет','Запишите первую реальную покупку клиента.')}`;}$('cardBody').innerHTML=`<div class="contact-block"><div>${esc(current.phones||'Телефон не указан')}</div>${current.channels?`<div>${esc(current.channels)}</div>`:''}${links?`<div class="contact-links">${links}</div>`:''}</div><div class="detail-actions">${canEdit()?btn('Посещение','new-activity',`data-kind="visit" data-lead="${esc(current.id)}" data-write`,'small')+btn('Тест плёнки','new-activity',`data-kind="test" data-lead="${esc(current.id)}" data-write`,'small')+(isStaff()?btn('Передать дилеру','new-transfer',`data-lead="${esc(current.id)}" data-write`,'small'):''):''}</div><div class="drawer-tabs" role="group" aria-label="Разделы карточки">${tabs.map(([value,label])=>`<button type="button" class="${value===drawerTab?'active':''}" aria-pressed="${value===drawerTab}" data-action="card-tab" data-tab="${value}">${label}</button>`).join('')}</div>${cardReady?'':'<p id="cardReadStatus" role="status">Обновляю карточку…</p>'}${pendingMoves.has(current.id)?'<p role="status">Дождитесь подтверждения этапа или повторите перенос в списке.</p>':''}${content}`;setSaving(saving);}
function validCard(record,id){
  return record?.id===id&&Array.isArray(record.fields)&&record.fields.length===fields.length&&db.stages.includes(record.stage)&&record.fields[0]===record.stage;
}
async function openCard(id){
  if(!discardChanges())return;
  const preview=db.leads.find(lead=>lead.id===id);
  if(!preview)return;
  focusReturn=document.activeElement;
  const view=viewId,request=++cardRequestId;
  current=normalizePilotLead(preview);
  cardReady=false;
  eventState='idle';
  drawerTab='overview';
  $('cardDrawer').hidden=false;
  $('drawerBackdrop').hidden=false;
  document.body.classList.add('drawer-open');
  renderDrawer();
  $('cardTitle').focus();
  try{
    const record=await crmCall('crmCard',id);
    if(view!==viewId||request!==cardRequestId)return;
    if(!validCard(record,id))throw new Error('Формат карточки не поддерживается.');
    current=normalizePilotLead(record);
    cardReady=true;
    renderDrawer();
    if(drawerTab==='history')void loadCardEvents();
  }catch(error){
    if(error===abandoned||request!==cardRequestId)return;
    const status=$('cardReadStatus');
    if(status){status.textContent=errorText(error);status.insertAdjacentHTML('beforeend',btn('Повторить','open-card',`data-id="${esc(id)}"`,'small'));}
  }
}
async function loadCardEvents(){
  if(!cardReady||!current)return;
  if(eventState==='loading'){renderDrawer();return;}
  const {id}=current,view=viewId,request=cardRequestId;
  eventState='loading';
  renderDrawer();
  try{
    const events=await crmCall('crmEvents',id);
    if(view!==viewId||request!==cardRequestId)return;
    if(!Array.isArray(events?.history)||!Array.isArray(events?.audit))throw new Error('Формат истории не поддерживается.');
    Object.assign(current,events);
    eventState='ready';
  }catch(error){
    if(error===abandoned||request!==cardRequestId)return;
    eventState='error';
  }
  if(drawerTab==='history')renderDrawer();
}
function closeCard(force=false){if(!force&&!discardChanges())return;cardRequestId+=1;$('cardDrawer').hidden=true;$('drawerBackdrop').hidden=true;$('cardBody').replaceChildren();current=null;cardReady=false;eventState='idle';document.body.classList.remove('drawer-open');if(focusReturn?.isConnected)focusReturn.focus();focusReturn=null;}
$('drawerBackdrop').addEventListener('click',()=>closeCard());
function applySavedCard(record,message,statusId){
  current=normalizePilotLead(record);
  eventState=Array.isArray(record.history)&&Array.isArray(record.audit)?'ready':'idle';
  upsertById(db.leads,current);
  renderCrmAtSamePosition();
  renderDrawer();
  setCrmStatus('Сохранено','Последнее сохранение: '+savedDuration(lastWriteMilliseconds));
  accessStatus(statusId,message+' · '+savedDuration(lastWriteMilliseconds));
}
$('cardBody').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!current||!cardReady||!canEdit()||saving||pendingMoves.has(current.id))return;
  const form=event.target,{id}=current,view=viewId;
  const isCard=form.id==='cardForm';
  if(!isCard&&form.id!=='contactForm')return;
  const statusId=isCard?'cardStatus':'contactStatus';
  setSaving(true);
  accessStatus(statusId,'Сохраняю…');
  try{
    const saved=isCard
      ?await write('crmSaveCard',[id,current.fields,fields.map(key=>form.elements[key].value)],'card:'+id,result=>validCard(result,id))
      :await write('crmRecordRead',[id,form.elements.action.value,form.elements.comment.value],'contact:'+id,result=>validCard(result,id));
    applySavedCard(saved,isCard?'Карточка сохранена.':'Контакт добавлен в историю.',statusId);
  }catch(error){
    if(error!==abandoned&&view===viewId)accessStatus(statusId,errorText(error),true);
  }finally{
    if(view===viewId)setSaving(false);
  }
});

function newLead(kind='inquiry'){if(!canEdit()||saving)return;openModal('Новая заявка','lead',null,`<div class="form-grid">${inputField('Компания / точка','name','','text',true,'maxlength="254"',true)}${inputField('Населённый пункт','city','','text',false,'maxlength="254"')}${inputField('Услуги / профиль','profile','','text',false,'maxlength="500"')}${inputField('Адрес','address','','text',false,'maxlength="500"',true)}${inputField('Телефоны','phones','','text',false,'maxlength="500"')}${inputField('Почта, сайт, мессенджеры','channels','','text',false,'maxlength="1000"')}${selectField('Этап','stage',db.stages,kind==='customer'?'Клиент':db.stages[0],true)}${inputField('Ответственный','manager','','text',false,'maxlength="254"')}${inputField('Следующий контакт','due','','date')}${inputField('Следующий шаг','next','','text',false,'maxlength="500"')}${textField('Заметка менеджера','note')}${inputField('Оценка сделки, ₽','amount','','number',false,'min="0" step="0.01" max="1000000000000"')}${inputField('Причина отказа','reason','','text',false,'maxlength="500"')}</div>`);}
function openActivity(kind='task',leadId='',record=null,prefill=null){if(!canEdit()||saving)return;const a=record||prefill||{leadId,kind,title:'',status:'planned',due:'',occurredAt:'',manager:'',note:'',result:'',equipment:'',quantity:0,contract:'',repeatDays:0};const isEquipment=a.kind==='equipment',status=isEquipment?['planned','issued','returned','cancelled']:['planned','in_progress','completed','cancelled'];const titleLabel={task:'Цель действия',visit:'Цель посещения',test:'Плёнка / цель теста',equipment:'Потребность'}[a.kind];openModal((record?'Изменить: ':'')+activityNames[a.kind],'activity',record,`<div class="form-grid">${leadSelect(a.leadId)}<input type="hidden" name="kind" value="${a.kind}">${inputField(titleLabel,'title',a.title,'text',true,'maxlength="254"',true)}${selectField('Статус','status',status.map(s=>[s,statusLabels[s]]),a.status,true)}${inputField('Ответственный','manager',a.manager,'text',false,'maxlength="254"')}${inputField(a.kind==='visit'?'Плановая дата посещения':'Срок','due',a.due,'date')}${inputField(a.kind==='visit'?'Фактическая дата посещения':'Дата выполнения / выдачи','occurredAt',a.occurredAt,'date')}${inputField('Периодичность, дней','repeatDays',a.repeatDays||0,'number',false,'min="0" max="3650" step="1"')}${isEquipment?inputField('Количество','quantity',a.quantity,'number',false,'min="0" step="0.01"'):''}${isEquipment?inputField('Оборудование','equipment',a.equipment,'text',true,'maxlength="500"',true)+inputField('Договор на оборудование','contract',a.contract,'text',false,'maxlength="500"',true):''}${textField(a.kind==='test'?'Обратная связь / результат теста':'Результат','result',a.result)}${textField('Примечание','note',a.note)}</div><div class="note ${isEquipment?'warning':''}">${isEquipment?'Для статуса «Выдано» нужны договор, наименование оборудования и количество больше нуля.':'У каждого действия собственные срок, ответственный и результат. Выполнение одного действия не закрывает другие.'} Периодичность 0 — разовое действие.</div>${record&&closedActivities.has(a.status)&&a.status!=='cancelled'&&a.repeatDays>0?`<div class="button-row">${btn('Запланировать следующее','repeat-activity',`data-id="${esc(a.id)}"`,'small')}</div>`:''}`);}
function openTransfer(leadId='',record=null){if(!canEdit()||saving)return;const t=record||{leadId,dealer:'',manager:'',status:'planned',date:db.today,nextContact:'',note:''};openModal(record?'Передача клиента':'Передать клиента дилеру','transfer',record,`<div class="form-grid">${leadSelect(t.leadId)}${inputField('Дилер','dealer',t.dealer,'text',true,'maxlength="254"',true)}${inputField('Ответственный исполнитель','manager',t.manager,'text',false,'maxlength="254"')}${selectField('Статус передачи','status',['planned','transferred','accepted','declined'].map(s=>[s,statusLabels[s]]),t.status,true)}${inputField('Дата передачи','date',t.date,'date')}${inputField('Следующий контакт','nextContact',t.nextContact,'date')}${textField('Следующий шаг / результат','note',t.note)}</div><div class="note">Назначение, принятие и результат фиксируются отдельно. В пилоте эта запись не выдаёт права: доступ только владельцу.</div>`);}
function openSale(leadId='',record=null){if(!canEdit()||saving)return;const s=record||{leadId,date:db.today,item:'',category:'material',quantity:1,unit:'рулон',unitPrice:0,seller:'',warehouse:'',source:'',status:'confirmed',note:''};openModal(record?'Продажа':'Записать продажу','sale',record,`<div class="form-grid">${leadSelect(s.leadId)}${inputField('Дата продажи','date',s.date,'date',true)}${selectField('Статус','status',['planned','confirmed','cancelled'].map(s=>[s,statusLabels[s]]),s.status,true)}${inputField('Товар / услуга','item',s.item,'text',true,'maxlength="500"',true)}${selectField('Категория','category',[['material','Материал'],['service','Услуга']],s.category,true)}${selectField('Единица','unit',['рулон','метр','шт.','услуга'],s.unit||(s.category==='service'?'услуга':'рулон'),true)}${inputField('Количество','quantity',s.quantity,'number',true,'min="0.01" step="0.01"')}${inputField('Цена за единицу, ₽','unitPrice',s.unitPrice,'number',true,'min="0" step="0.01"')}${inputField('Продавец','seller',s.seller,'text',true,'maxlength="254"')}${inputField('Склад отгрузки','warehouse',s.warehouse,'text',true,'maxlength="254"')}${inputField('Источник данных','source',s.source,'text',true,'maxlength="254" placeholder="Например, отчёт дилера"')}${textField('Примечание','note',s.note)}</div><div class="amount-total"><span>Сумма продажи</span><strong id="saleTotal">${money(saleAmount(s))}</strong></div><div class="note">Выручка рассчитывается по подтверждённым продажам материалов и услуг. Выдачу оборудования записывайте в разделе «Оборудование».</div>`);if(modal?.kind==='sale')modal.category=s.category;}
function openModal(title,kind,record,html){if(isCardDirty()){toast('Сначала сохраните изменения в карточке.',true);return;}if(isModalDirty()&&!discardChanges())return;if($('editorDialog').open)$('editorDialog').close();modal={kind,original:record?structuredClone(record):null,initial:''};$('dialogTitle').textContent=title;$('dialogBody').innerHTML=html;$('dialogStatus').textContent='';$('dialogStatus').classList.remove('error');$('dialogSubmit').hidden=false;$('dialogSubmit').textContent='Сохранить';setFormBusy($('entityForm'),false);modal.initial=modalValues();$('editorDialog').showModal();}
function closeModal(force=false){if(!force&&!discardChanges())return;$('editorDialog').close();$('dialogBody').replaceChildren();modal=null;}
$('editorDialog').addEventListener('cancel',event=>{event.preventDefault();closeModal();});
$('entityForm').addEventListener('input',event=>{if(modal?.kind==='sale'&&['quantity','unitPrice'].includes(event.target.name))$('saleTotal').textContent=money(saleAmount(Object.fromEntries(new FormData($('entityForm')))));});
$('entityForm').addEventListener('change',event=>{if(modal?.kind==='sale'&&event.target.name==='category'){const unit=$('entityForm').elements.unit,prior=modal.category==='service'?'услуга':'рулон';if(unit.value===prior)unit.value=event.target.value==='service'?'услуга':'рулон';modal.category=event.target.value;}});
$('entityForm').addEventListener('submit',async event=>{event.preventDefault();if(!modal||!canEdit()||saving)return;const kind=modal.kind,original=modal.original,values=Object.fromEntries(new FormData(event.target));let record;if(kind==='lead')record={name:values.name,city:values.city,address:values.address,profile:values.profile,phones:values.phones,channels:values.channels,links:['',''],stage:values.stage,manager:values.manager,due:values.due,next:values.next,last:'',note:values.note,amount:values.amount,reason:values.reason};else if(kind==='activity')record={...(original?{id:original.id}:{}),leadId:values.leadId,kind:values.kind,title:values.title,status:values.status,due:values.due,occurredAt:values.occurredAt,manager:values.manager,note:values.note,result:values.result,equipment:values.equipment||'',quantity:Number(values.quantity||0),contract:values.contract||'',repeatDays:Number(values.repeatDays||0)};else if(kind==='transfer')record={...(original?{id:original.id}:{}),leadId:values.leadId,dealer:values.dealer,manager:values.manager,status:values.status,date:values.date,nextContact:values.nextContact,note:values.note};else if(kind==='sale')record={...(original?{id:original.id}:{}),leadId:values.leadId,date:values.date,item:values.item,category:values.category,quantity:Number(values.quantity),unit:values.unit,unitPrice:Number(values.unitPrice),seller:values.seller,warehouse:values.warehouse,source:values.source,status:values.status,note:values.note};else return;const view=viewId;setSaving(true);accessStatus('dialogStatus','Сохраняю…');try{const saved=kind==='lead'?await write('crmCreateLead',[record],'new-lead'):await write('crmItemSave',[kind,original,record],kind+':'+(original?.id||'new'));if(kind==='lead'){upsertById(db.leads,normalizePilotLead(saved));}else{upsertById(kind==='activity'?db.activities:kind==='sale'?db.sales:db.transfers,saved);if(current){eventState='idle';if(drawerTab==='history')void loadCardEvents();}}closeModal(true);render();toast('Сохранено в Google Таблице · '+(lastWriteMilliseconds/1000).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+' с');if(kind==='lead'&&saved?.id){closeCard(true);setSaving(false);await openCard(saved.id);}else if(current){renderDrawer();}}catch(error){if(error!==abandoned&&view===viewId)accessStatus('dialogStatus',errorText(error),true);}finally{if(view===viewId)setSaving(false);}});

function openItem(kind,id){const pool=kind==='activity'?db.activities:kind==='sale'?db.sales:db.transfers,item=pool.find(x=>x.id===id);if(!item){toast('Запись не найдена. Обновите данные.',true);return;}if(kind==='activity')openActivity(item.kind,item.leadId,item);else if(kind==='sale')openSale(item.leadId,item);else openTransfer(item.leadId,item);}
function help(){if(!discardChanges())return;openModal('Как работать с платформой','help',null,`<div class="help-grid"><section class="help-step"><b>Рынок и модель продаж</b><p>Исследование региона и калькулятор доступны без входа. Параметры корзины сохраняются только в вашем браузере.</p></section><section class="help-step"><b>Карточки и сохранение</b><p>После входа владельца откройте компанию, измените этап, следующий шаг или заметку. Подтверждение появляется после ответа сервера. Журнал хранит автора, время и значения до/после.</p></section><section class="help-step"><b>План и результаты</b><p>Действия, посещения, тесты, оборудование и продажи сохраняются отдельными записями. Этап «Клиент» помещает карточку в список клиентов.</p></section><section class="help-step"><b>Доступ и обновление</b><p>Пилот доступен только владельцу. Сессия сохраняется до 12 часов в этой вкладке и проверяется сервером. Кнопка обновления перечитывает данные, включая ручные изменения таблицы.</p></section><section class="help-step"><b>Передачи</b><p>Раздел ведёт учёт передач и результатов. Раздельный доступ дилеров в этом пилоте не включён; не выдавайте дилерам права редактора таблицы для такой изоляции.</p></section></div>`);$('dialogSubmit').hidden=true;}
document.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
  if(action==='close-card')return closeCard();if(action==='close-dialog')return closeModal();
  if(action==='help')return help();
  if(action==='navigate')return navigate(button.dataset.screen);
  if(action==='return-crm')return navigate(lastCrmRoute);
  if(action==='retry-session')return restoreSession();
  if(action==='retry-move')return sendMove(pendingMoves.get(button.dataset.id));
  if(action==='retry-events')return loadCardEvents();
  if(!db||!session)return;
  if(action==='refresh'){try{await loadWorkspace(true);}catch{}return;}
  if(action==='open-card'){if($('editorDialog').open){if(!discardChanges())return;closeModal(true);}return openCard(button.dataset.id);}
  if(action==='view-board'||action==='view-list'){mode=action==='view-board'?'board':'list';return render();}
  if(action==='card-tab'){
    if(!discardChanges()||!current)return;
    drawerTab=button.dataset.tab;
    if(drawerTab==='history'&&eventState!=='ready'&&cardReady)return loadCardEvents();
    return renderDrawer();
  }
  if(action==='new-lead')return newLead(button.dataset.kind||'inquiry');
  if(action==='new-activity')return openActivity(button.dataset.kind||'task',button.dataset.lead||'');
  if(action==='new-transfer')return openTransfer(button.dataset.lead||'');
  if(action==='new-sale')return openSale(button.dataset.lead||'');
  if(action==='edit-item')return openItem(button.dataset.kind,button.dataset.id);
  if(action==='repeat-activity'){if(!discardChanges())return;const original=db.activities.find(a=>a.id===button.dataset.id),next=original&&nextActivity(original,db.today);if(!next)return toast('Периодичность не задана.',true);closeModal(true);return openActivity(next.kind,next.leadId,null,next);}
});
function validMove(result,id){
  return typeof result?.conflict==='boolean'&&validCard(result.card,id);
}
function startMove(id,target){
  const lead=db?.leads.find(item=>item.id===id);
  if(!lead||!db.stages.includes(target)||lead.stage===target||pendingMoves.has(id)||saving||loading||!canEdit())return;
  if(isCardDirty()||isModalDirty()){toast('Сначала сохраните изменения формы.',true);return;}
  const move={id,target,previous:lead.stage,view:viewId,status:'queued'};
  pendingMoves.set(id,move);
  return sendMove(move);
}
async function sendMove(move){
  if(!move||move.status==='pending'||move.view!==viewId||!canEdit())return;
  move.status='pending';
  renderCrmAtSamePosition();
  if(current?.id===move.id)setSaving(saving);
  setCrmStatus('Сохраняется этап…');
  try{
    const result=await write('crmMoveCard',[move.id,move.previous,move.target],'move:'+move.id,
      reply=>validMove(reply,move.id));
    pendingMoves.delete(move.id);
    const card=normalizePilotLead(result.card);
    upsertById(db.leads,card);
    if(current?.id===move.id){
      cardRequestId+=1;
      current=card;
      cardReady=true;
      eventState='idle';
      renderDrawer();
      if(drawerTab==='history')void loadCardEvents();
    }
    renderCrmAtSamePosition();
    const synchronized=result.conflict||card.stage!==move.target;
    const hasPending=[...pendingMoves.values()].some(item=>item.status==='pending');
    const hasUnknown=[...pendingMoves.values()].some(item=>item.status==='unknown');
    const status=hasPending?'Сохраняется этап…':hasUnknown?'Этап не подтверждён':synchronized?'Данные обновлены':'Этап сохранён';
    setCrmStatus(status,synchronized?undefined:'Последнее сохранение: '+savedDuration(lastWriteMilliseconds));
    if(!isPublic(screen))toast(synchronized?'Показан актуальный этап карточки.':'Этап сохранён · '+savedDuration(lastWriteMilliseconds),synchronized);
  }catch(error){
    if(error===abandoned||move.view!==viewId)return;
    // A response or canonical re-read can fail after the atomic commit.
    // Keep this command and its UUID until reconciliation succeeds.
    if(/^CRM_(?:FORBIDDEN|ACCESS_DENIED):/.test(error.message))pendingMoves.delete(move.id);
    else move.status='unknown';
    renderCrmAtSamePosition();
    if(current?.id===move.id)renderDrawer();
    setCrmStatus(pendingMoves.has(move.id)?'Этап не подтверждён':'Перенос отклонён');
    if(!isPublic(screen)){
      toast(pendingMoves.has(move.id)?'Этап не подтверждён. Нажмите «Повторить перенос» на карточке.':errorText(error),true);
    }
  }
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('editorDialog').open&&!$('cardDrawer').hidden){event.preventDefault();closeCard();}if(event.key==='Tab'&&!$('cardDrawer').hidden&&!$('editorDialog').open){const nodes=[...$('cardDrawer').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(n=>n.getClientRects().length);if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&(document.activeElement===first||!$('cardDrawer').contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
window.addEventListener('beforeunload',event=>{if(saving||pendingMoves.size||isCardDirty()||isModalDirty()){event.preventDefault();event.returnValue='';}});
function followBrowserRoute(){
  const route=location.hash.slice(1)||'market';
  if(route!==screen)void navigate(route,{push:false});
}
window.addEventListener('hashchange',followBrowserRoute);
window.addEventListener('popstate',followBrowserRoute);
document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#"]');
  if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const route=link.getAttribute('href').slice(1);
  if(!allRoutes().some(item=>item[0]===route))return;
  event.preventDefault();
  void navigate(route==='leads'&&isPublic(screen)?lastCrmRoute:route);
});
let restoringSession=null;
async function restoreSession(){
  if(restoringSession)return restoringSession;
  if(session)return;
  const stored=readStoredSession(sessionStorageSafe(),config.backendUrl);
  if(!stored)return;
  const view=viewId;
  $('retrySession').disabled=true;
  setFormBusy(emailStart,true);
  accessStatus('signInStatus','Восстанавливаю вход…');
  restoringSession=(async()=>{
    try{
      const result=await call('crmResume',stored.token);
      if(view!==viewId)return;
      await openSession({...result.session,token:stored.token},{persist:false,workspace:result.workspace});
    }catch(error){
      if(view!==viewId)return;
      if(errorCode(error)){
        clearStoredSession(sessionStorageSafe(),config.backendUrl);
        $('retrySession').hidden=true;
        accessStatus('signInStatus','Сессия завершилась. Войдите по коду.');
      }else{
        $('retrySession').hidden=false;
        accessStatus('signInStatus','Вход не удалось проверить. Повторите загрузку кабинета.',true);
      }
    }finally{
      if(view===viewId){$('retrySession').disabled=false;setFormBusy(emailStart,false);}
      restoringSession=null;
    }
  })();
  return restoringSession;
}
async function initialize(){
  screen=allRoutes().some(r=>r[0]===location.hash.slice(1))?location.hash.slice(1):'market';
  if(!isPublic(screen)){
    rememberCrmRoute(screen);
  }else{
    try{
      const route=sessionStorageSafe()?.getItem(crmRouteKey);
      if(routes.some(item=>item[0]===route))lastCrmRoute=route;
    }catch{}
  }
  $('appShell').hidden=false;
  $('authScreen').hidden=true;
  $('identityEmail').textContent='Личный кабинет';
  $('identityRole').textContent='Вход';
  $('avatar').textContent='?';
  $('signOut').hidden=true;
  render();
  fetch(new URL('./public-data.json',import.meta.url))
    .then(response=>{if(!response.ok)throw new Error();return response.json();})
    .then(data=>{publicUI=createPublicUI(data);if(isPublic(screen))render();})
    .catch(()=>{publicLoadFailed=true;if(isPublic(screen))render();});
  if(!isPublic(screen)&&apiAvailable())await restoreSession();
}
// Desktop Pointer Events avoid Safari's OS drag session and keep the board local
// until release. Touch scrolling and keyboard activation retain their defaults.
let pointerKanban=null, suppressKanbanClickUntil=0;
function cancelPointerKanban(){
  const drag=pointerKanban;pointerKanban=null;if(!drag)return;
  if(drag.started)suppressKanbanClickUntil=performance.now()+450;
  if(drag.frame)cancelAnimationFrame(drag.frame);
  drag.preview?.remove();drag.card.classList.remove('dragging');
  if(drag.card.hasPointerCapture?.(drag.pointerId))drag.card.releasePointerCapture(drag.pointerId);
  drag.column?.classList.remove('drop-target');
}
function pointerKanbanColumn(x,y){
  const column=document.elementFromPoint(x,y)?.closest('.column');
  return column&&$('main').contains(column)?column:null;
}
function paintPointerKanban(){
  const drag=pointerKanban;if(!drag?.started)return;
  drag.preview.style.left=(drag.x+14)+'px';drag.preview.style.top=(drag.y+14)+'px';
  const column=pointerKanbanColumn(drag.x,drag.y);
  if(column!==drag.column){document.querySelectorAll('.drop-target').forEach(node=>node.classList.remove('drop-target'));column?.classList.add('drop-target');drag.column=column;}
}
function scrollPointerKanban(){
  const drag=pointerKanban;if(!drag?.started)return;
  drag.frame=0;const board=$('main').querySelector('.board');
  if(board){const box=board.getBoundingClientRect(),edge=44;
    if(drag.y>=box.top&&drag.y<=box.bottom&&drag.x>=box.left&&drag.x<=box.right){
      const direction=drag.x<box.left+edge?-1:drag.x>box.right-edge?1:0;
      if(direction){board.scrollLeft+=direction*10;paintPointerKanban();}
    }
  }
  drag.frame=requestAnimationFrame(scrollPointerKanban);
}
function beginPointerKanban(event){
  if(event.button!==0||event.isPrimary===false||!['mouse','pen'].includes(event.pointerType)||saving||loading||!canEdit())return;
  const card=event.target.closest('.lead-card[data-movable="true"]');
  if(!card||card.disabled||pendingMoves.has(card.dataset.id))return;
  cancelPointerKanban();event.preventDefault();card.focus({preventScroll:true});
  pointerKanban={pointerId:event.pointerId,id:card.dataset.id,card,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,started:false,view:viewId,frame:0};
  card.setPointerCapture(event.pointerId);
}
function movePointerKanban(event){
  const drag=pointerKanban;if(!drag||drag.pointerId!==event.pointerId)return;
  if(drag.view!==viewId||saving||loading||!canEdit()){cancelPointerKanban();return;}
  drag.x=event.clientX;drag.y=event.clientY;
  if(!drag.started){
    if(Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6)return;
    drag.started=true;drag.card.classList.add('dragging');
    const preview=drag.card.cloneNode(true);preview.removeAttribute('id');preview.removeAttribute('data-action');preview.classList.remove('dragging');preview.classList.add('kanban-drag-preview');preview.setAttribute('aria-hidden','true');preview.tabIndex=-1;preview.draggable=false;
    preview.style.width=drag.card.getBoundingClientRect().width+'px';document.body.append(preview);drag.preview=preview;
    drag.frame=requestAnimationFrame(scrollPointerKanban);
  }
  event.preventDefault();paintPointerKanban();
}
function endPointerKanban(event){
  const drag=pointerKanban;if(!drag||drag.pointerId!==event.pointerId)return;
  const column=drag.started?pointerKanbanColumn(event.clientX,event.clientY):null,stage=column?.dataset.stage;
  if(drag.started){event.preventDefault();suppressKanbanClickUntil=performance.now()+450;}
  cancelPointerKanban();
  if(stage&&drag.view===viewId)return startMove(drag.id,stage);
}
function initializePointerKanban(){
  if(!('PointerEvent' in window))return;
  $('main').addEventListener('pointerdown',beginPointerKanban);
  window.addEventListener('pointermove',movePointerKanban,{passive:false});
  window.addEventListener('pointerup',endPointerKanban);
  window.addEventListener('pointercancel',event=>{if(pointerKanban?.pointerId===event.pointerId)cancelPointerKanban();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelPointerKanban();});
  $('main').addEventListener('lostpointercapture',event=>{if(pointerKanban?.pointerId===event.pointerId)cancelPointerKanban();});
  window.addEventListener('blur',cancelPointerKanban);
  $('main').addEventListener('click',event=>{if(event.detail>0&&performance.now()<suppressKanbanClickUntil&&event.target.closest('.lead-card')){event.preventDefault();event.stopImmediatePropagation();}},true);
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&pointerKanban){event.preventDefault();event.stopPropagation();cancelPointerKanban();}},true);
}

initializePointerKanban();
initialize();

$('main').addEventListener('click',event=>{if(isPublic(screen))publicUI?.handleClick(event,render);});
$('main').addEventListener('input',event=>{if(isPublic(screen))publicUI?.handleInput(event,render);});
$('main').addEventListener('change',event=>{if(isPublic(screen))publicUI?.handleInput(event,render);});

function profileHtml(){return `<section><h3>Профиль компании</h3><div class="profile-data-grid">${[['Компания',current.name],['Город',current.city],['Адрес',current.address],['Услуги',current.profile],['ID',current.id]].map(([label,value])=>`<article><span>${esc(label)}</span><p>${esc(value||'Не заполнено')}</p></article>`).join('')}</div><p class="meta">Рабочий этап меняется в разделе «Работа с клиентом». Этап «Клиент» переносит компанию в список клиентов. Фото и расширенная квалификация в этой Google-версии не подключены.</p></section>`;}

document.querySelector('.profile>summary').addEventListener('click',event=>{if(!session){event.preventDefault();navigate('leads');}});
