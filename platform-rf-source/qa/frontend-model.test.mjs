import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defaultModel,validateModel,modelNumbers,loadModel,createPublicUI,countLabel} from '../site/public.mjs';
import {metrics,localDateTimeInput} from '../site/model.mjs';

const publicData=JSON.parse(fs.readFileSync(new URL('../site/public-data.json',import.meta.url)));
test('Transfer deadline uses browser-local time and round-trips without the UTC-as-local shift',()=>{
  const previous=process.env.TZ,deadline='2026-11-19T21:46:00.000Z';
  try{
    for(const [zone,expected] of [['Europe/Moscow','2026-11-20T00:46'],['UTC','2026-11-19T21:46'],['America/New_York','2026-11-19T16:46']]){
      process.env.TZ=zone;const value=localDateTimeInput(deadline);assert.equal(value,expected);assert.equal(new Date(value).toISOString(),deadline);
    }
    assert.equal(localDateTimeInput('invalid'),'');
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('Russian counts distinguish one, two to four, many and the eleven to fourteen exception',()=>{
  for(const [n,label] of [[0,'карточек'],[1,'карточка'],[2,'карточки'],[4,'карточки'],[5,'карточек'],[11,'карточек'],[12,'карточек'],[14,'карточек'],[21,'карточка'],[22,'карточки'],[25,'карточек'],[111,'карточек']])assert.equal(countLabel(n,'карточка','карточки','карточек'),n+' '+label);
});
test('Original basket gives 199000 per point and a distinct forecast, not CRM revenue',()=>{
  assert.deepEqual(modelNumbers(defaultModel()),{perPoint:199000,targetRevenue:1990000,targetMargin:398000,baseRevenue:0});
  assert.equal(metrics({leads:[],activities:[],sales:[],today:'2026-11-13'}).revenue,0);
});
test('Custom basket is restored without allowing invalid values or arbitrary labels',()=>{
  const saved={outlets:2,target:12,margin:25,basket:[{label:'altered',quantity:2,price:15000},{quantity:1.5,price:40000},{quantity:0,price:80000}]};
  const restored=loadModel({getItem:()=>JSON.stringify(saved)});
  assert.equal(restored.basket[0].label,'Тонировочная плёнка');
  assert.deepEqual(modelNumbers(restored),{perPoint:90000,targetRevenue:1080000,targetMargin:270000,baseRevenue:180000});
  const invalid=validateModel({outlets:-1,target:Infinity,margin:200,basket:[{quantity:-7,price:'1'}]});
  assert.deepEqual(invalid,defaultModel());
});
test('A prior regional calculator is read without changing the previous result storage',()=>{
  const old={...defaultModel(),target:17},writes=[];
  const storage={getItem:key=>key==='fiverox-chechnya:sales-model:v1'?JSON.stringify(old):null,setItem:(...args)=>writes.push(args)};
  assert.equal(loadModel(storage).target,17);assert.deepEqual(writes,[]);
});
test('Unavailable or broken storage still gives a working default calculator',()=>{
  assert.deepEqual(loadModel({getItem(){throw Error('denied');}}),defaultModel());
  assert.deepEqual(loadModel({getItem:()=>'{broken'}),defaultModel());
  const a=defaultModel();a.basket[0].price=1;assert.equal(defaultModel().basket[0].price,13000);
});
test('A blocked localStorage getter does not prevent the public market from rendering',()=>{
  globalThis.window=Object.defineProperty({},'localStorage',{get(){throw Error('denied');}});
  try{assert.match(createPublicUI(publicData).render('market'),/Рынок и возможности/);}finally{delete globalThis.window;}
});
test('Research payload is limited to business fields and does not include CRM contacts or private endpoints',()=>{
  assert.equal(publicData.companies.length,178);
  assert.equal(publicData.market.length,48);
  const allowed=new Set(['id','name','city','profile','status','source','links','priceStatus','prices']);
  for(const company of publicData.companies)assert.deepEqual(Object.keys(company).filter(k=>!allowed.has(k)),[]);
  const serialized=JSON.stringify(publicData);
  assert.doesNotMatch(serialized,/@gmail\.com|script\.google\.com|docs\.google\.com\/spreadsheets|\+7\d{10}/i);
  assert.equal(publicData.medianSource.verified,false);
  assert.equal(publicData.autoSeries.find(s=>s.key==='used-chechnya').chart,false);
});
test('Market view preserves missing primary median and non-comparable auto-series limitations',()=>{
  const ui=createPublicUI(publicData,{getItem:()=>null,setItem(){}});
  const html=ui.render('market');
  assert.match(html,/Первоисточник Росстата по медиане за 2025 год не подтверждён/);
  assert.match(html,/не сравниваются как годовая динамика/);
  assert.match(html,/СКФО/);
  assert.match(html,/Прямая ссылка на статью сейчас возвращает 404/);
  assert.doesNotMatch(html,/undefined|null<\/strong>/);
});
test('Company detail separates conditional prices from confirmed published amounts',()=>{
  const html=createPublicUI(publicData,{getItem:()=>null,setItem(){}}).render('research');
  assert.match(html,/Условная сумма/);
  assert.match(html,/Опубликована сумма/);
  assert.doesNotMatch(html,/mailto:|tel:|wa\.me|t\.me\/\+/);
});
