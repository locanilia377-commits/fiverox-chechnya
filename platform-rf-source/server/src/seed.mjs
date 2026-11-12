import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createDatabase,migrate} from './db.mjs';
export const demo={
 admin:'11111111-1111-4111-8111-111111111111',coordinator:'22222222-2222-4222-8222-222222222222',a:'33333333-3333-4333-8333-333333333333',b:'44444444-4444-4444-8444-444444444444',
 dealerA:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',dealerB:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};
export async function seedDemo(db){
 if(process.env.NODE_ENV==='production')throw Error('Synthetic seed is forbidden in production');
 await db.query('INSERT INTO fiverox.dealers(id,name) VALUES($1,$2),($3,$4) ON CONFLICT DO NOTHING',[demo.dealerA,'Учебный дилер А',demo.dealerB,'Учебный дилер Б']);
 for(const [id,email,name,role,dealer] of [[demo.admin,'admin@example.test','Администратор','admin',null],[demo.coordinator,'coordinator@example.test','Координатор','coordinator',null],[demo.a,'dealer.a@example.test','Менеджер А','dealer_manager',demo.dealerA],[demo.b,'dealer.b@example.test','Менеджер Б','dealer_manager',demo.dealerB]])await db.query('INSERT INTO fiverox.users(id,email,name,role,dealer_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,email,name,role,dealer]);
 for(let i=1;i<=3;i++){const id='DEMO-'+i,m={name:'Учебная точка '+i,city:i===1?'Грозный':'Учебный город',address:'Синтетические данные для проверки',profile:'Тестовая компания',phones:'',channels:'',links:[]};await db.query('INSERT INTO fiverox.clients(id,master,staff_fields,created_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,JSON.stringify(m),JSON.stringify(['Новый','Координатор','','Проверить учебную карточку','','Внутренняя заметка координатора '+i,'','']),demo.admin]);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.env.NODE_ENV==='production')throw Error('Demo seed is forbidden in production');const db=await createDatabase({engine:process.env.DATABASE_ENGINE||'pglite',url:process.env.DATABASE_URL,dir:process.env.DATA_DIR||'./.data'});await migrate(db);await seedDemo(db);await db.close();console.info('Synthetic local demo initialized; no real users or mail.');}
