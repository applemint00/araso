// Responsive composition and coupled Home/History placement.
// Pure geometry: no DOM, storage, network, or app state. The caller supplies the
// established closed-card layout; the same solver drives preview and runtime.
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x)};
export function responsiveFrame(w,h){
 const scale=1+.05*clamp((w-1440)/500,0,1);
 const width=Math.min(w,1440),height=Math.min(h,900);
 return {width,height,scale,x:(w-width*scale)/2,y:(h-height*scale)/2};
}
function transformLayout(L,F,w,h){
 const out={...L,vw:w,vh:h};
 for(const k of ['s','k','stageW','bottom','cardW','cardH','asFont','pitch','S'])out[k]=L[k]*F.scale;
 for(const k of ['M','cardX','cx','boardLeft','stageLeft'])out[k]=L[k]*F.scale+F.x;
 for(const k of ['cardY','cy','asTop','asBottom','boardTop','floorY','stageTop'])out[k]=L[k]*F.scale+F.y;
 out.ox=(L.ox||0)*F.scale+F.x;
 return out;
}
export function createResponsiveLayout(layout){
 const before=(w,h)=>{const L=layout(w,h);return {L,cardW:L.cardW,cardH:L.cardH,top:L.cardY,homeLeft:L.cardX,histLeft:L.cardX,histRight:L.cardX+L.cardW,mode:'stacked',overlap:L.cardW};};
const cache=new Map();
function rawJoint(w,h,rho=220/335){
 if(w<=550){const p=before(w,h);return {...p,homeLeft:p.L.cardX,histLeft:p.L.cardX,histRight:p.L.cardX+p.cardW,mode:'stacked',route:'폰 쌓기 후보'};}
 if(w<641){
  const a=rawJoint(550,h,rho),b=rawJoint(641,h,rho),t=smooth((w-550)/91),mix=(x,y)=>x+(y-x)*t;
  const cw=mix(a.cardW,b.cardW),homeLeft=mix(a.homeLeft,b.homeLeft),histLeft=mix(a.homeLeft,b.histLeft),top=mix(a.top,b.top);
  return {...b,L:layout(w,h),cardW:cw,cardH:cw*1.42,homeLeft,histLeft,histRight:histLeft+cw,top,
   signedGap:histLeft-homeLeft-cw,overlap:Math.max(0,homeLeft+cw-histLeft),mode:'stacked',route:'쌓기 → 겹침 (전환 후보)'};
 }
 const key=`${h}:${rho}`;
 if(!cache.has(key)){if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,[]);}
 const rows=cache.get(key),alpha=1-rho;
 const firstGap=-alpha*layout(641,h).cardW;
 const tabletGap=Math.max(firstGap,-115.4084507042254);
 const desktopGap=24*376.5/282;
 for(let x=641+rows.length;x<=Math.ceil(w);x++){
  const L=layout(x,h),W=Math.min(x,1920),rail=L.stageLeft-12,full=x-L.M;
  const desired=W<810?firstGap+(tabletGap-firstGap)*(W-641)/169:W<1440?tabletGap+(desktopGap-tabletGap)*(W-810)/630:desktopGap*Math.min(W/1440,1.33);
  let g=Math.max(rows.at(-1)?.signedGap??-Infinity,desired),cw=L.cardW;
  const above=Math.max(0,Math.min(L.cardW,(L.stageTop-L.cardY-.5)/1.42));
  for(let n=0;n<35;n++){
   const side=Math.max(0,Math.min(L.cardW,(rail-L.M-g)/2));
   cw=Math.max(0,Math.min(L.cardW,Math.max(above,side),(full-L.M-g)/2));
   g=Math.max(g,-alpha*cw);
  }
  const group=2*cw+g,sideRoom=rail-L.M;
  const t=smooth((sideRoom-(2*above+g)+.30*Math.max(1,2*above+g))/(.30*Math.max(1,2*above+g)));
  const right=Math.max(L.M+group,full+(rail-full)*t);
  const free=Math.max(0,right-L.M-group);
  const desiredLeft=(L.M+free/2)+((L.M+(L.stageLeft-.03*W))/2-group/2-(L.M+free/2))*L.posT;
  const centre=clamp(g/(24*cw/282||1),0,1);
  const homeLeft=L.M+clamp(desiredLeft-L.M,0,free)*centre;
  const histLeft=homeLeft+cw+g;
  rows.push({L,cardW:cw,cardH:cw*1.42,top:L.cardY,homeLeft,histLeft,histRight:histLeft+cw,
   signedGap:g,overlap:Math.max(0,-g),mode:g>=0?'pair':'fan',Rr:right,
   conflict:L.cardY+cw*1.42>L.stageTop+.5,route:t<.001?'위 공간':t>.999?'옆 공간':'위 → 옆',t,above});
 }
 return rows[Math.round(w)-641];
}
// Isolated proposal: choose a continuous nondecreasing width inside the feasible
// envelope of the entire preview range. Never retain a local peak that forces
// a later shrink. This changes intermediate reference sizes; expose that in UI.
const growthCache=new Map();
function joint(w,h,rho=220/335){
 const key=`${h}:${rho}`;
 if(!growthCache.has(key)){
  const rows=Array.from({length:1440-390+1},(_,i)=>rawJoint(i+390,h,rho));
  let limit=Infinity;
  const caps=rows.map(p=>p.cardW);
  for(let i=caps.length-1;i>=0;i--){limit=Math.min(limit,caps[i]);caps[i]=limit;}
  // Piecewise linear growth between the phone and desktop reference widths,
  // clipped by a nondecreasing feasible envelope. Both terms never decrease.
  const start=caps[0],desktop=caps[1440-390];
  let prevGap=-Infinity;
  const result=rows.map((p,i)=>{
   const x=i+390,target=start+(desktop-start)*(x-390)/1050;
   const cw=Math.min(caps[i],target),oldGap=(p.histLeft??p.homeLeft)-p.homeLeft-p.cardW;
   let g=oldGap;
   if(x>=641)g=Math.max(prevGap,oldGap,-(1-rho)*cw);
   else g=oldGap*cw/p.cardW;
   prevGap=g;
   const homeLeft=p.homeLeft,histLeft=homeLeft+cw+g;
   return {...p,cardW:cw,cardH:cw*1.42,homeLeft,histLeft,histRight:histLeft+cw,signedGap:g,overlap:Math.max(0,-g)};
  });
  if(growthCache.size>=8)growthCache.delete(growthCache.keys().next().value);growthCache.set(key,result);
 }
 return growthCache.get(key)[Math.round(clamp(w,390,1440))-390];
}

 return {
  layout(w,h){const F=responsiveFrame(w,h);return transformLayout(layout(F.width,F.height),F,w,h);},
  history(w,h){
   const F=responsiveFrame(w,h),p=F.width<390?before(F.width,F.height):joint(F.width,F.height);
   const L=transformLayout(p.L,F,w,h),homeLeft=p.homeLeft*F.scale+F.x,histLeft=p.histLeft*F.scale+F.x;
   const cardW=p.cardW*F.scale,cardH=p.cardH*F.scale,overlap=Math.max(0,homeLeft+cardW-histLeft);
   return {...p,L,cardW,cardH,top:p.top*F.scale+F.y,homeLeft,histLeft,histRight:histLeft+cardW,
    homeDx:homeLeft-L.cardX,gap:(p.signedGap??-p.cardW)*F.scale,signedGap:(p.signedGap??-p.cardW)*F.scale,overlap,
    underDx:homeLeft-histLeft,clearDx:overlap+10*F.scale,Rr:(p.Rr??p.histRight)*F.scale+F.x};
  }
 };
}
