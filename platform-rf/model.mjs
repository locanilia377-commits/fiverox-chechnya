export const closedStages=new Set(['Клиент','Отказ']);
export const closedActivities=new Set(['completed','cancelled','issued','returned']);
export function asNumber(value){const n=Number(value);return Number.isFinite(n)?n:0;}
export function localDateTimeInput(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';const pad=n=>String(n).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;}
export function dayPlus(day,amount){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
export function saleAmount(sale){return Math.round(asNumber(sale.quantity)*asNumber(sale.unitPrice)*100)/100;}
export function isConfirmedSale(sale){return sale.status==='confirmed'&&['material','service'].includes(sale.category);}
export function isOverdue(item,today){return Boolean(item.due&&item.due<today&&!closedActivities.has(item.status));}
export function stageCounts(leads,stages){return stages.map(stage=>({stage,count:leads.filter(l=>l.stage===stage).length}));}
export function metrics(db){
  const leads=db.leads||[], activities=db.activities||[], sales=(db.sales||[]).filter(isConfirmedSale),today=db.today;
  const clientSales=new Map();
  for(const s of sales){if(!clientSales.has(s.leadId))clientSales.set(s.leadId,[]);clientSales.get(s.leadId).push(s);}
  const cohorts=[];
  for(const [leadId,rows] of clientSales){const ordered=[...rows].sort((a,b)=>a.date.localeCompare(b.date));const first=ordered[0].date;const complete=Boolean(first&&dayPlus(first,60)<=today);const repeat=ordered.slice(1).some(s=>s.date<=dayPlus(first,60));cohorts.push({leadId,first,complete,repeat,count:rows.length,revenue:rows.reduce((n,s)=>n+saleAmount(s),0)});}
  const complete=cohorts.filter(c=>c.complete), repeated=complete.filter(c=>c.repeat);
  return {total:leads.length,active:leads.filter(l=>!closedStages.has(l.stage)).length,clients:leads.filter(l=>l.stage==='Клиент').length,declined:leads.filter(l=>l.stage==='Отказ').length,overdueCards:leads.filter(l=>l.due&&l.due<today&&!closedStages.has(l.stage)),overdueActions:activities.filter(a=>isOverdue(a,today)),openActions:activities.filter(a=>!closedActivities.has(a.status)),revenue:sales.reduce((n,s)=>n+saleAmount(s),0),sales,cohorts,buyers:cohorts.length,rr:complete.length?Math.round(repeated.length/complete.length*1000)/10:null,rrBase:complete.length,rrRepeats:repeated.length};
}
export function monthlyRevenue(sales,today,months=6){const current=new Date(today+'T12:00:00Z');const rows=[];for(let i=months-1;i>=0;i--){const date=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()-i,1,12));const key=date.toISOString().slice(0,7);rows.push({month:key,amount:sales.filter(s=>isConfirmedSale(s)&&s.date.startsWith(key)).reduce((n,s)=>n+saleAmount(s),0)});}return rows;}
export function nextActivity(activity,today){const base=activity.occurredAt||activity.due||today,interval=Number(activity.repeatDays)||0;if(interval<1)return null;const {id,createdAt,createdBy,updatedAt,updatedBy,...record}=activity;return {...record,status:'planned',due:dayPlus(base,interval),occurredAt:'',result:''};}
