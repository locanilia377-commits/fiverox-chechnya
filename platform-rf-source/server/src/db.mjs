import {readFile} from 'node:fs/promises';
export async function createDatabase({engine='pg',url,dir}={}) {
  if(engine==='pglite') {
    if(process.env.NODE_ENV==='production')throw Error('PGlite is test/development only');
    const {PGlite}=await import('@electric-sql/pglite'); const raw=new PGlite(dir||'memory://');
    let tail=Promise.resolve();
    const adapter={engine,query:(q,p)=>raw.query(q,p),exec:q=>raw.exec(q),close:()=>raw.close(),runtimeRole:false,
      transaction(fn){const next=tail.then(()=>raw.transaction(async tx=>{if(adapter.runtimeRole)await tx.exec('SET LOCAL ROLE fiverox_runtime');return fn({query:(q,p)=>tx.query(q,p)});}));tail=next.catch(()=>{});return next;}};return adapter;
  }
  if(!url)throw Error('DATABASE_URL is required');
  const ssl=process.env.NODE_ENV==='production'?{rejectUnauthorized:true,...(process.env.DATABASE_CA_FILE?{ca:await readFile(process.env.DATABASE_CA_FILE,'utf8')}:{})}:undefined;
  if(ssl&&/[?&]ssl(mode|cert|key|rootcert)=/i.test(url))throw Error('Set verified TLS via DATABASE_CA_FILE, not ssl query parameters');
  const {Pool}=await import('pg');const pool=new Pool({connectionString:url,ssl,max:12,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
  return {engine,query:(q,p)=>pool.query(q,p),exec:q=>pool.query(q),close:()=>pool.end(),async transaction(fn){
    const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }};
}
export async function migrate(db) {await db.exec(await readFile(new URL('../migrations/001-platform.sql',import.meta.url),'utf8'));}
export async function installDevelopmentRole(db){
 if(db.engine!=='pglite'||process.env.NODE_ENV==='production')throw Error('Development runtime role is local PGlite only');
 await db.exec("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fiverox_runtime') THEN CREATE ROLE fiverox_runtime NOLOGIN NOBYPASSRLS; END IF; END $$;");
 await db.exec(await readFile(new URL('../migrations/runtime-grants.sql',import.meta.url),'utf8'));db.runtimeRole=true;
}
