import {createDatabase,migrate} from './db.mjs';
const db=await createDatabase({engine:process.env.DATABASE_ENGINE||'pg',url:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL,dir:process.env.DATA_DIR});
try{await migrate(db);console.info('Migration 001 applied. Configure the separate restricted runtime role and runtime-grants.sql before production.');}finally{await db.close();}
