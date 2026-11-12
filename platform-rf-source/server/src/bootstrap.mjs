import {randomUUID} from 'node:crypto';
import {createDatabase} from './db.mjs';
import {email,text} from './validation.mjs';
const arg=n=>{const i=process.argv.indexOf(n);return i<0?'':process.argv[i+1]??'';};const address=email(arg('--email')),name=text(arg('--name'),254,true);
const db=await createDatabase({engine:process.env.DATABASE_ENGINE||'pg',url:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL,dir:process.env.DATA_DIR});
try{await db.transaction(async tx=>{await tx.query('LOCK TABLE fiverox.users IN EXCLUSIVE MODE');if((await tx.query('SELECT id FROM fiverox.users LIMIT 1')).rows.length)throw Error('Bootstrap works only on an empty users table; use authenticated admin invitations afterwards');await tx.query("INSERT INTO fiverox.users(id,email,name,role) VALUES($1,$2,$3,'admin')",[randomUUID(),address,name]);});console.info('Initial administrator created; no email sent.');}finally{await db.close();}
