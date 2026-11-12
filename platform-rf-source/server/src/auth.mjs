import {randomUUID,randomBytes,randomInt,createHmac,timingSafeEqual} from 'node:crypto';
import {fail,email,uuid} from './validation.mjs';
export const hash=(secret,v)=>createHmac('sha256',secret).update(v).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class Auth {
 constructor(db,{secret,mail,now=()=>new Date()}){this.db=db;this.secret=secret;this.mail=mail;this.now=now;}
 async rate(key,limit,windowMs){const bucket=Math.floor(this.now().getTime()/windowMs),digest=hash(this.secret,key);const r=(await this.db.query('INSERT INTO fiverox.rate_limits(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key) DO UPDATE SET bucket=$2,count=CASE WHEN rate_limits.bucket=$2 THEN rate_limits.count+1 ELSE 1 END RETURNING count',[digest,bucket])).rows[0];if(r.count>limit)fail(429,'RATE_LIMIT','Слишком много попыток. Повторите позже.');}
 async start(body,ip){const address=email(body.email);await this.rate('start-ip:'+ip,100,900000);await this.rate('start-email:'+address,5,900000);
  const challengeId=randomUUID(),code=String(randomInt(10000000,100000000)),u=(await this.db.query('SELECT * FROM fiverox.users WHERE email=$1 AND active',[address])).rows[0];
  await this.db.query('INSERT INTO fiverox.challenges(id,email,user_id,code_digest,expires_at) VALUES($1,$2,$3,$4,$5)',[challengeId,address,u?.id??null,hash(this.secret,challengeId+':'+code),new Date(this.now().getTime()+600000)]);
  if(u){try{await this.mail.send({to:address,subject:'Код входа в FIVEROX CRM',text:'Ваш код входа: '+code+'\nКод действует 10 минут и используется один раз. Введите его только на странице FIVEROX CRM.'});}catch{await this.db.query('UPDATE fiverox.challenges SET consumed_at=$1 WHERE id=$2',[this.now(),challengeId]);fail(503,'MAIL_UNAVAILABLE','Сервис входа временно недоступен. Повторите позже.');}}
  return {challengeId,message:'Если адресу разрешён доступ, письмо с кодом отправлено. Код действует 10 минут.'};
 }
 async verify(body,ip){const address=email(body.email);if(!uuid(body.challengeId)||typeof body.code!=='string'||!/^\d{8}$/.test(body.code))fail(400,'CODE_INVALID','Проверьте код из письма.');await this.rate('verify-ip:'+ip,200,900000);
  const result=await this.db.transaction(async tx=>{const c=(await tx.query('SELECT * FROM fiverox.challenges WHERE id=$1 FOR UPDATE',[body.challengeId])).rows[0];if(!c||c.email!==address||c.consumed_at||new Date(c.expires_at)<=this.now()||c.attempts>=5)return null;
   const valid=equal(c.code_digest,hash(this.secret,c.id+':'+body.code));await tx.query('UPDATE fiverox.challenges SET attempts=attempts+1,consumed_at=CASE WHEN $1 THEN $2 ELSE consumed_at END WHERE id=$3',[valid,this.now(),c.id]);if(!valid||!c.user_id)return null;
   const u=(await tx.query('SELECT * FROM fiverox.users WHERE id=$1 AND active FOR SHARE',[c.user_id])).rows[0];if(!u)return null;
   if(u.dealer_id&&!(await tx.query('SELECT id FROM fiverox.dealers WHERE id=$1 AND active',[u.dealer_id])).rows.length)return null;
   const invitation=(await tx.query('SELECT * FROM fiverox.invitations WHERE user_id=$1 AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1',[u.id])).rows[0];if(invitation&&new Date(invitation.expires_at)<=this.now())return null;
   if(invitation)await tx.query('UPDATE fiverox.invitations SET accepted_at=$1 WHERE id=$2',[this.now(),invitation.id]);
   const token=randomBytes(32).toString('hex'),csrfToken=randomBytes(32).toString('hex');
   await tx.query('INSERT INTO fiverox.sessions(digest,user_id,user_version,csrf_digest,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[hash(this.secret,token),u.id,u.session_version,hash(this.secret,csrfToken),csrfToken,new Date(this.now().getTime()+8*3600000)]);
   return {token,session:{email:u.email,role:u.role,userId:u.id,dealerId:u.dealer_id},csrfToken};
  });if(!result)fail(401,'CODE_INVALID','Код неверен, использован или срок действия истёк.');return result;
 }
 async session(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail(401,'AUTH_REQUIRED','Войдите в кабинет.');const row=(await this.db.query('SELECT s.*,u.email,u.role,u.dealer_id,u.active,u.session_version FROM fiverox.sessions s JOIN fiverox.users u ON u.id=s.user_id WHERE s.digest=$1',[hash(this.secret,token)])).rows[0];if(!row||!row.active||row.user_version!==row.session_version||new Date(row.expires_at)<=this.now())fail(401,'AUTH_REQUIRED','Сессия завершена. Войдите снова.');if(row.dealer_id&&!(await this.db.query('SELECT id FROM fiverox.dealers WHERE id=$1 AND active',[row.dealer_id])).rows.length)fail(401,'AUTH_REQUIRED','Доступ приостановлен.');return {row,session:{email:row.email,role:row.role,userId:row.user_id,dealerId:row.dealer_id},csrfToken:row.csrf_token};}
 csrf(session,token){if(!equal(session.row.csrf_digest,hash(this.secret,String(token??''))))fail(403,'CSRF_REQUIRED','Обновите страницу перед сохранением.');}
 async logout(token){await this.db.query('DELETE FROM fiverox.sessions WHERE digest=$1',[hash(this.secret,token)]);}
}
export async function createMailer(env){
 if(env.NODE_ENV!=='production'&&!env.SMTP_HOST){const outbox=[];return {outbox,async send(msg){if(!/^[^@]+@[^@]+\.example\.test$|^[^@]+@example\.test$/.test(msg.to))throw Error('Development mail is restricted to synthetic example.test addresses');outbox.push({...msg,at:new Date().toISOString()});if(outbox.length>100)outbox.shift();}};}
 if(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASS||!env.MAIL_FROM)throw Error('SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM are required');
 const port=Number(env.SMTP_PORT||465);if(![465,587].includes(port))throw Error('SMTP uses port 465 or 587 with verified TLS');
 const {default:nodemailer}=await import('nodemailer');const transport=nodemailer.createTransport({host:env.SMTP_HOST,port,secure:port===465,requireTLS:true,auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},tls:{rejectUnauthorized:true},connectionTimeout:10000,socketTimeout:15000,logger:false,debug:false});
 return {async send(msg){await transport.sendMail({...msg,from:env.MAIL_FROM});}};
}
