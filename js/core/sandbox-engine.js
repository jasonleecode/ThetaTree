'use strict';
// Standard normal CDF: rational approximation in the central region,
// continued fraction in the tails. Absolute error is near double precision.
const SQRT_2PI = Math.sqrt(2 * Math.PI);
function normalPDF(x) { return Math.exp(-0.5 * x * x) / SQRT_2PI; }
function normalCDF(x) {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 0.5;
  const y = Math.abs(x);
  if (y > 37) return x > 0 ? 1 : 0;
  const e = Math.exp(-0.5 * y * y);
  let tail;
  if (y < 7.0710678118654755) {
    const n = ((((((0.0352624965998911*y+0.700383064443688)*y+6.37396220353165)*y+33.9128660783830)*y+112.079291497871)*y+221.213596169931)*y+220.206867912376);
    const d = (((((((0.0883883476483184*y+1.75566716318264)*y+16.0641775792070)*y+86.7807322029461)*y+296.564248779674)*y+637.333633378831)*y+793.826512519948)*y+440.413735824752);
    tail = e * n / d;
  } else {
    tail = e / (y + 1/(y + 2/(y + 3/(y + 4/(y + 0.65))))) / SQRT_2PI;
  }
  return x > 0 ? 1-tail : tail;
}
// T in YEARS, sigma/r/q in decimals. Greeks per option share;
// theta per calendar day, vega per one percentage point of IV.
// European exercise, continuous compounding, constant volatility.
function blackScholes(type, S, K, T, sigma, r=0.04, q=0) {
  if (!['put','call'].includes(type) || ![S,K,T,sigma,r,q].every(Number.isFinite) || S<0 || K<=0 || T<0 || sigma<0) throw new RangeError('Invalid Black–Scholes inputs');
  const call = type === 'call';
  if (T === 0) {
    const callDelta = S>K ? 1 : S<K ? 0 : 0.5;
    return {price:Math.max(call?S-K:K-S,0),delta:call?callDelta:callDelta-1,gamma:0,theta:0,vega:0};
  }
  const dq=Math.exp(-q*T), dr=Math.exp(-r*T);
  if (S === 0) return {price:call?0:K*dr,delta:call?0:-dq,gamma:0,theta:call?0:r*K*dr/365,vega:0};
  if (sigma === 0) {
    const forwardDiff=S*dq-K*dr, active=call?forwardDiff>0:forwardDiff<0;
    return {price:Math.max(call?forwardDiff:-forwardDiff,0),delta:active?(call?dq:-dq):0,gamma:0,theta:active?(call?q*S*dq-r*K*dr:r*K*dr-q*S*dq)/365:0,vega:0};
  }
  const rootT=Math.sqrt(T), d1=(Math.log(S/K)+(r-q+sigma*sigma/2)*T)/(sigma*rootT), d2=d1-sigma*rootT;
  const pdf=normalPDF(d1), base=-S*dq*pdf*sigma/(2*rootT);
  return {
    price:Math.max(0,call?S*dq*normalCDF(d1)-K*dr*normalCDF(d2):K*dr*normalCDF(-d2)-S*dq*normalCDF(-d1)),
    delta:call?dq*normalCDF(d1):-dq*normalCDF(-d1),
    gamma:dq*pdf/(S*sigma*rootT),
    theta:(call?base-r*K*dr*normalCDF(d2)+q*S*dq*normalCDF(d1):base+r*K*dr*normalCDF(-d2)-q*S*dq*normalCDF(-d1))/365,
    vega:S*dq*pdf*rootT/100
  };
}
const DEFAULT_SCENARIO = {s:135,iv:65,days:30,r:4};
const multiplier = leg => leg.type==='stock'?1:100;
function mark(leg, scenario, spot=scenario.s, expiry=false) {
  if (leg.type==='stock') return {price:spot,delta:1,gamma:0,theta:0,vega:0};
  return blackScholes(leg.type,spot,leg.strike,expiry?0:scenario.days/365,scenario.iv/100,scenario.r/100);
}
let nextId=0;
function makeLeg(type,strike,qty,scenario,tag='custom') {
  const leg={id:++nextId,type,strike,qty,tag,entry:0};
  leg.entry=mark(leg,scenario).price;
  return leg;
}
function createBook(scenario=DEFAULT_SCENARIO, mode='ratio', strikes={long:135,short:125,protection:115}) {
  const legs=[makeLeg('put',strikes.long,1,scenario,'base'),makeLeg('put',strikes.short,-2,scenario,'short')];
  if(mode!=='ratio') legs.push(makeLeg('put',strikes.protection,2,scenario,'protection'));
  if(mode==='w') legs.push(makeLeg('call',strikes.long,1,scenario,'wing'));
  return {legs,realized:0,log:[],mode};
}
function pnl(book,scenario,spot=scenario.s,expiry=false) {
  return book.realized+book.legs.reduce((sum,leg)=>sum+leg.qty*multiplier(leg)*(mark(leg,scenario,spot,expiry).price-leg.entry),0);
}
function portfolioGreeks(book,scenario) {
  return book.legs.reduce((out,leg)=>{
    const g=mark(leg,scenario), scale=leg.qty*multiplier(leg);
    for(const name of ['delta','gamma','theta','vega']) out[name]+=g[name]*scale;
    return out;
  },{delta:0,gamma:0,theta:0,vega:0});
}
// Exact piecewise-linear expiry roots on the WHOLE domain S>=0,
// including flat zero intervals and the unbounded final segment.
function expiryAnalysis(book,scenario) {
  const knots=[...new Set([0,...book.legs.filter(l=>l.type!=='stock').map(l=>l.strike)])].sort((a,b)=>a-b);
  const value=s=>pnl(book,scenario,s,true), roots=[], intervals=[];
  const add=x=>{if(x>=0&&!roots.some(y=>Math.abs(y-x)<1e-6)) roots.push(x);};
  for(let i=0;i<knots.length-1;i++){
    const a=knots[i],b=knots[i+1],fa=value(a),fb=value(b);
    if(Math.abs(fa)<1e-8&&Math.abs(fb)<1e-8){intervals.push([a,b]);continue;}
    if(Math.abs(fa)<1e-8)add(a);
    if(fa*fb<0)add(a-fa*(b-a)/(fb-fa));
    if(Math.abs(fb)<1e-8)add(b);
  }
  const last=knots[knots.length-1],f=value(last);
  const slope=book.legs.reduce((s,l)=>s+(l.type==='put'?0:l.qty*multiplier(l)),0);
  if(Math.abs(slope)<1e-10){if(Math.abs(f)<1e-8)intervals.push([last,Infinity]);}
  else{const x=last-f/slope;if(x>=last-1e-8)add(Math.max(last,x));}
  const vals=knots.map(value);
  return {roots:roots.filter(x=>!intervals.some(([a,b])=>x>=a&&x<=b)).sort((a,b)=>a-b),intervals,min:slope<0?-Infinity:Math.min(...vals),max:slope>0?Infinity:Math.max(...vals),knots,slope};
}
// Simulated close/reopen at the same mark preserves total P&L at execution.
function replaceLeg(book,id,replacement,scenario) {
  const old=book.legs.find(l=>l.id===id);
  if(!old)return book;
  const realized=book.realized+old.qty*multiplier(old)*(mark(old,scenario).price-old.entry);
  return {...book,realized,legs:book.legs.flatMap(l=>l.id===id?(replacement?[replacement]:[]):[l]),mode:'custom'};
}
const roundPrice=n=>Math.round(n*100)/100;
const BUILTIN_ASSETS=[
  {symbol:'SPCX',name:'SpaceX',s:135,iv:65,gap:10,min:90,max:170},
  {symbol:'TQQQ',name:'TQQQ',s:60,iv:65,gap:5,min:35,max:85}
];
const assetScenario=asset=>({s:asset.s,iv:asset.iv,days:30,r:4});
const assetStrikes=asset=>({long:asset.s,short:roundPrice(asset.s-asset.gap),protection:roundPrice(asset.s-2*asset.gap)});
function createWorkspace(asset){const scenario=assetScenario(asset);return {scenario,book:createBook(scenario,'ratio',assetStrikes(asset)),calc:{type:'put',strike:asset.s},history:[]};}
const STORAGE_KEY='thetatree.multi-asset.v1';
function defaultStore(){return {version:1,active:'TQQQ',assets:BUILTIN_ASSETS.map(config=>({config:{...config},workspace:createWorkspace(config)}))};}
const inRange=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
function validateAsset(asset){
  return asset&&/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(asset.symbol)&&typeof asset.name==='string'&&asset.name.trim().length>0&&asset.name.length<=60&&
    inRange(asset.s,1,10000)&&inRange(asset.iv,15,100)&&inRange(asset.gap,.01,(asset.s-.01)/2)&&
    inRange(asset.min,.01,asset.s)&&inRange(asset.max,asset.s,20000)&&asset.min<asset.max;
}
// Restore only validated data. Undo stacks are session-local; books and logs persist.
function decodeStore(raw){
  const data=JSON.parse(raw);
  if(data?.version!==1||!Array.isArray(data.assets)||!data.assets.length||data.assets.length>50)throw new Error('Invalid saved catalog');
  const symbols=new Set();let maxId=nextId;
  for(const item of data.assets){
    const a=item.config,w=item.workspace,s=w?.scenario,b=w?.book,c=w?.calc;
    if(!validateAsset(a)||symbols.has(a.symbol))throw new Error('Invalid or duplicate symbol');
    symbols.add(a.symbol);
    if(!s||!inRange(s.s,a.min,a.max)||!inRange(s.iv,15,100)||!inRange(s.days,1,60)||!Number.isInteger(s.days)||!inRange(s.r,-5,30))throw new Error('Invalid saved scenario');
    if(!b||!Number.isFinite(b.realized)||!Array.isArray(b.legs)||!Array.isArray(b.log)||b.log.length>60)throw new Error('Invalid saved book');
    const ids=new Set();
    for(const l of b.legs){
      if(!['put','call','stock'].includes(l.type)||!Number.isSafeInteger(l.id)||l.id<1||l.id>=Number.MAX_SAFE_INTEGER||ids.has(l.id)||!Number.isSafeInteger(l.qty)||l.qty===0||!inRange(l.entry,0,100000)||!inRange(l.strike,l.type==='stock'?0:.01,10000)||typeof l.tag!=='string')throw new Error('Invalid saved leg');
      ids.add(l.id);maxId=Math.max(maxId,l.id);
    }
    if(!b.log.every(l=>typeof l.message==='string'&&l.message.length<=1000&&Number.isFinite(l.id)&&Number.isFinite(l.s)&&Number.isFinite(l.iv)&&Number.isFinite(l.days)))throw new Error('Invalid saved log');
    if(!c||!['put','call'].includes(c.type)||!inRange(c.strike,.01,10000))throw new Error('Invalid saved calculator');
    w.history=[];
  }
  if(!symbols.has('SPCX')||!symbols.has('TQQQ'))throw new Error('Missing built-in assets');
  if(!symbols.has(data.active))data.active='TQQQ';
  nextId=maxId;return data;
}
function encodeStore(data){return JSON.stringify({version:1,active:data.active,assets:data.assets.map(({config,workspace})=>({config,workspace:{scenario:workspace.scenario,book:workspace.book,calc:workspace.calc}}))});}
globalThis.ThetaEngine={STORAGE_KEY,multiplier,roundPrice,normalCDF,normalPDF,blackScholes,mark,pnl,portfolioGreeks,expiryAnalysis,createBook,makeLeg,replaceLeg,DEFAULT_SCENARIO,assetScenario,assetStrikes,createWorkspace,defaultStore,decodeStore,encodeStore,validateAsset};
