import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {ApiError,fail} from './validation.mjs';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const loopback=ip=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
export function createHttp({service,auth,mail,publicDir,origin,production=false}) {
 const cookieName=production?'__Host-fiverox_session':'fiverox_session';
 const cookie=(token,maxAge=28800)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production?'; Secure':''}`;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const respond=(code,value)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
  try{const url=new URL(req.url,'http://localhost'),p=url.pathname,method=req.method,ip=req.socket.remoteAddress;
   if(['/healthz','/api/health'].includes(p)&&method==='GET'){respond(200,{status:'ok'});return;}
   if(p==='/__dev/mail'&&method==='GET'){if(production||!loopback(ip)||!mail.outbox)fail(404,'NOT_FOUND','Страница не найдена.');respond(200,{messages:mail.outbox});return;}
   if(!p.startsWith('/api/')){
    if(p==='/config.js'&&method==='GET'){res.statusCode=200;res.setHeader('Content-Type','text/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end('window.FIVEROX_PLATFORM_CONFIG=Object.freeze('+JSON.stringify({name:'FIVEROX · Рынок и CRM',organization:'ООО «Автопленки»',apiEnabled:true,apiBase:'/api'})+');');return;}
    if(!['GET','HEAD'].includes(method)||!publicDir)fail(404,'NOT_FOUND','Страница не найдена.');let rel=decodeURIComponent(p);if(rel==='/'||rel.endsWith('/'))rel+='index.html';const file=path.resolve(publicDir,'.'+rel);if(!file.startsWith(path.resolve(publicDir)+path.sep))fail(404,'NOT_FOUND','Страница не найдена.');let bytes;try{bytes=await readFile(file);}catch{fail(404,'NOT_FOUND','Страница не найдена.');}res.statusCode=200;res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(method==='HEAD'?undefined:bytes);return;
   }
   if(!['GET','POST','PATCH'].includes(method))fail(405,'METHOD_NOT_ALLOWED','Метод не поддерживается.');let body={};
   if(method!=='GET'){
    if(req.headers.origin!==origin)fail(403,'ORIGIN_DENIED','Неверный источник запроса.');if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'CONTENT_TYPE','Ожидается JSON.');
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)fail(413,'TOO_LARGE','Запрос слишком большой.');chunks.push(chunk);}try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'JSON_INVALID','Запрос заполнен неверно.');}if(!body||Array.isArray(body)||typeof body!=='object')fail(400,'JSON_INVALID','Ожидается объект.');
   }
   if(p==='/api/auth/start'&&method==='POST'){respond(200,await auth.start(body,ip));return;}
   if(p==='/api/auth/verify'&&method==='POST'){const data=await auth.verify(body,ip);res.setHeader('Set-Cookie',cookie(data.token));delete data.token;respond(200,data);return;}
   const token=String(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1),identity=await auth.session(token),id=identity.session.userId;
   if(method!=='GET'){auth.csrf(identity,req.headers['x-csrf-token']);body.operationId??=req.headers['idempotency-key'];}
   if(p==='/api/session'&&method==='GET'){respond(200,{session:identity.session,csrfToken:identity.csrfToken});return;}
   if(p==='/api/auth/logout'&&method==='POST'){await auth.logout(token);res.setHeader('Set-Cookie',cookie('',0));respond(200,{signedOut:true});return;}
   if(p==='/api/workspace'&&method==='GET'){respond(200,await service.workspace(id));return;}
   if(p==='/api/clients'&&method==='POST'){respond(201,await service.createClient(id,body));return;}
   let profileRoute=p.match(/^\/api\/clients\/([^/]+)\/(qualify|convert|profile)$/);if(profileRoute&&((profileRoute[2]==='profile'&&method==='PATCH')||(profileRoute[2]!=='profile'&&method==='POST'))){respond(200,await service.qualify(id,decodeURIComponent(profileRoute[1]),body,{convert:profileRoute[2]!=='profile'}));return;}
   let m=p.match(/^\/api\/clients\/([^/]+)(?:\/(history|contacts))?$/);
   if(m){const clientId=decodeURIComponent(m[1]);if(m[2]&&method==='POST')respond(201,await service.contact(id,clientId,body));else if(!m[2]&&method==='GET')respond(200,await service.read(id,clientId));else if(!m[2]&&method==='PATCH')respond(200,await service.saveClient(id,clientId,body));else fail(405,'METHOD_NOT_ALLOWED','Метод не поддерживается.');return;}
   m=p.match(/^\/api\/(activities|sales)(?:\/([a-f0-9-]+))?$/);if(m&&((!m[2]&&method==='POST')||(m[2]&&method==='PATCH'))){respond(m[2]?200:201,await service.saveItem(id,m[1]==='activities'?'activity':'sale',m[2],body));return;}
   if(p==='/api/transfers'){if(method==='POST')respond(201,await service.createTransfer(id,body));else if(method==='GET')respond(200,(await service.workspace(id)).transfers);else fail(405,'METHOD_NOT_ALLOWED','Метод не поддерживается.');return;}
   m=p.match(/^\/api\/transfers\/([a-f0-9-]+)\/(accept|decline|revoke)$/);if(m&&method==='POST'){respond(200,await service.decideTransfer(id,m[1],m[2],body));return;}
   if(['/api/admin/users','/api/users'].includes(p)){if(method==='GET')respond(200,await service.adminData(id,'users'));else if(method==='POST'&&p.startsWith('/api/admin'))respond(201,await service.createUser(id,body));else fail(405,'METHOD_NOT_ALLOWED','Метод не поддерживается.');return;}
   if(['/api/admin/dealers','/api/dealers'].includes(p)){if(method==='GET')respond(200,p.startsWith('/api/admin')?await service.adminData(id,'dealers'):(await service.workspace(id)).dealers);else if(method==='POST'&&p.startsWith('/api/admin'))respond(201,await service.createDealer(id,body));else fail(405,'METHOD_NOT_ALLOWED','Метод не поддерживается.');return;}
   m=p.match(/^\/api\/admin\/users\/([a-f0-9-]+)$/);if(m&&method==='PATCH'){respond(200,await service.saveUser(id,m[1],body));return;}
   fail(404,'NOT_FOUND','Страница не найдена.');
  }catch(e){if(e instanceof ApiError)respond(e.status,{error:{code:e.code,message:e.message}});else {respond(500,{error:{code:'INTERNAL_ERROR',message:'Не удалось выполнить запрос. Обратитесь к администратору.'}});server.emit('applicationError',{name:e?.name,code:e?.code});}}
 });server.requestTimeout=15000;server.headersTimeout=10000;return server;
}
