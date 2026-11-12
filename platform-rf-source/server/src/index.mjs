import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDatabase,migrate,installDevelopmentRole} from './db.mjs';
import {Auth,createMailer} from './auth.mjs';
import {CrmService} from './service.mjs';
import {createHttp} from './http.mjs';
const env=process.env,production=env.NODE_ENV==='production';
const engine=env.DATABASE_ENGINE||(production?'pg':'pglite'),port=Number(env.PORT||8080),host=env.HOST||(production?'0.0.0.0':'127.0.0.1');
if(production&&(engine!=='pg'||!env.APP_SECRET||env.APP_SECRET.length<32||/^(GENERATE_|CHANGE_ME)/.test(env.APP_SECRET)||!env.APP_ORIGIN?.startsWith('https://')))throw Error('Production requires PostgreSQL, APP_SECRET >=32 characters and HTTPS APP_ORIGIN');
const origin=env.APP_ORIGIN||`http://127.0.0.1:${port}`;
if(new URL(origin).origin!==origin)throw Error('APP_ORIGIN must be an exact origin without path or trailing slash');
const mail=await createMailer(env),db=await createDatabase({engine,url:env.DATABASE_URL,dir:env.DATA_DIR||'./.data'});
if(!production){await migrate(db);if(process.argv.includes('--demo')){const {seedDemo}=await import('./seed.mjs');await seedDemo(db);}if(engine==='pglite')await installDevelopmentRole(db);}
else {const role=(await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];if(!role||role.rolsuper||role.rolbypassrls)throw Error('Production runtime must not be superuser/BYPASSRLS');const owner=(await db.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fiverox' AND pg_has_role(current_user,c.relowner,'MEMBER') LIMIT 1")).rows[0];if(owner)throw Error('Production runtime must not own or inherit ownership of schema tables');const schemaOwner=(await db.query("SELECT nspname FROM pg_namespace WHERE nspname='fiverox' AND pg_has_role(current_user,nspowner,'MEMBER')")).rows[0];if(schemaOwner)throw Error('Production runtime must not own or inherit ownership of the schema');}
const secret=env.APP_SECRET||randomBytes(32).toString('hex'),auth=new Auth(db,{secret,mail}),service=new CrmService(db,{mail});
const publicDir=env.PUBLIC_DIR||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../site');
const server=createHttp({service,auth,mail,publicDir,origin,production});
server.on('applicationError',e=>console.error(JSON.stringify({event:'application_error',...e})));
await new Promise(resolve=>server.listen(port,host,resolve));
console.info(JSON.stringify({event:'listening',host,port,mode:production?'production':'development',engine,syntheticOnly:!production}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(async()=>{await db.close();process.exit(0);}));
