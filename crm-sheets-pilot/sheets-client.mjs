// Google Sheets pilot transport. Credentials are sent only in a POST body.
const endpointPattern=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const tokenPattern=/^[a-f0-9]{64}\.[a-f0-9]{64}$/;
export const sessionLifetime=12*60*60*1000;
export const rpcArity=Object.freeze({crmEmailStart:2,crmEmailVerify:3,crmEmailLogout:1,crmSession:1,crmWorkspace:1,crmWorkspaceFresh:1,crmRead:2,crmSaveRead:5,crmMoveRead:5,crmRecordRead:5,crmCreateLead:3,crmItemSave:5});
export function endpointReady(value){return endpointPattern.test(value||'');}
export function createSheetsClient(backendUrl,{fetchImpl=fetch,onMeasure=()=>{},now=()=>performance.now()}={}){
  return async function call(method,...args){
    if(!endpointReady(backendUrl))throw new Error('CRM_UNAVAILABLE: Тестовая CRM ещё подключается.');
    if(!Object.hasOwn(rpcArity,method)||args.length!==rpcArity[method])throw new Error('CRM_REQUEST: Неизвестная команда CRM.');
    const started=now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
    let reply;
    try{
      const response=await fetchImpl(backendUrl,{method:'POST',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({method,args})});
      if(!response.ok)throw new Error('network');
      reply=await response.json();
    }catch{
      throw new Error('CRM_NETWORK: Ответ сервера не получен. Изменение могло сохраниться. Повторите ту же команду без изменения полей.');
    }finally{
      clearTimeout(timer);
      // Method and duration only. Never record body, email, code or token.
      onMeasure({method,milliseconds:Math.max(0,Math.round(now()-started))});
    }
    if(reply?.ok===true)return reply.result;
    if(reply?.ok===false&&typeof reply.error==='string')throw new Error(reply.error);
    throw new Error('CRM_RESPONSE: Сервер вернул неподдерживаемый ответ.');
  };
}
function sessionKey(backendUrl){return 'fiverox.sheets.pilot.session.v1:'+String(backendUrl||'').split('/s/')[1]?.split('/')[0];}
export function readStoredSession(storage,backendUrl,now=Date.now()){
  try{
    const value=JSON.parse(storage.getItem(sessionKey(backendUrl))||'null');
    if(!value||value.role!=='admin'||typeof value.email!=='string'||!value.email||value.email.length>254||!tokenPattern.test(value.token||'')||!Number.isFinite(value.issuedAt)||!Number.isFinite(value.expiresAt)||value.issuedAt>now||value.expiresAt<=now||value.expiresAt-value.issuedAt>sessionLifetime){storage.removeItem(sessionKey(backendUrl));return null;}
    return value;
  }catch{return null;}
}
export function storeSession(storage,backendUrl,identity,now=Date.now()){
  if(identity?.role!=='admin'||!tokenPattern.test(identity.token||''))return false;
  try{storage.setItem(sessionKey(backendUrl),JSON.stringify({email:identity.email,role:identity.role,token:identity.token,issuedAt:now,expiresAt:now+sessionLifetime}));return true;}catch{return false;}
}
export function clearStoredSession(storage,backendUrl){try{storage.removeItem(sessionKey(backendUrl));}catch{}}
export function verifiedSheetUrl(value){try{const url=new URL(value);return url.origin==='https://docs.google.com'&&/^\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/.test(url.pathname)&&!url.search&&!url.hash?url.href:'';}catch{return '';}}
export function workingValues(record){return ['stage','manager','due','next','last','note','amount','reason'].map(key=>String(record?.[key]??''));}
export function normalizePilotLead(record){return {...record,kind:record.stage==='Клиент'?'customer':'inquiry',fields:Array.isArray(record.fields)?record.fields:workingValues(record)};}
export function upsertById(items,record){if(!record||typeof record.id!=='string'||!record.id)throw new Error('Сервер не вернул ID сохранённой записи.');const index=items.findIndex(item=>item.id===record.id);if(index<0)items.push(record);else items[index]=record;return record;}
