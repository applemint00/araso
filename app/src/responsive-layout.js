import {CHOG_HOME_GEOMETRY as cg} from './chog-home.js';
// Responsive composition and coupled Home/History placement.
// Pure geometry: no DOM, storage, network, or app state. The caller supplies the
// established closed-card layout; the same solver drives preview and runtime.
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x)};
export function responsiveFrame(w,h){
 const scale=1+.05*clamp((w-1440)/500,0,1);
 const width=Math.min(w,1440),height=h/scale;
 return {width,height,scale,x:(w-width*scale)/2,y:0};
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
 const soloCache=new Map();
 const phonePositionCache=new Map();
 function solo(w,h){
  if(w>550&&w<640){
   if(!phonePositionCache.has(h)){
    const ys=Array.from({length:91},(_,i)=>layout(550+i,h).cardY);
    // The same 1.5px/px envelope used by joint placement, restricted to the
    // phone join. Moving up removes clearance overshoot without shrinking.
    for(let i=1;i<ys.length;i++)ys[i]=Math.min(ys[i],ys[i-1]+1.5);
    for(let i=ys.length-2;i>=0;i--)ys[i]=Math.min(ys[i],ys[i+1]+1.5);
    if(phonePositionCache.size>=8)phonePositionCache.delete(phonePositionCache.keys().next().value);
    phonePositionCache.set(h,ys);
   }
   const L=layout(w,h),ys=phonePositionCache.get(h),x=w-550,i=Math.floor(x),t=x-i;
   const y=Math.max(L.asBottom,Math.min(L.cardY,ys[i]+(ys[Math.min(i+1,90)]-ys[i])*t));
   return {...L,cardY:y,cy:L.cy+y-L.cardY};
  }
  if(w<1440)return layout(w,h);
  if(!soloCache.has(h)){
   const widths=Array.from({length:1051},(_,i)=>layout(i+390,h).cardW);
   let limit=Infinity;
   for(let i=widths.length-1;i>=0;i--){limit=Math.min(limit,widths[i]);widths[i]=limit;}
   if(soloCache.size>=8)soloCache.delete(soloCache.keys().next().value);
   soloCache.set(h,widths);
  }
  const widths=soloCache.get(h),x=clamp(w-390,0,1050),i=Math.floor(x);
  const cap=widths[i]+((widths[Math.min(i+1,1050)]-widths[i])*(x-i));
  return layout(w,h,cap*Math.min(1,w/390));
 }
 // History consumes exactly the closed-card size. Space pressure changes only
 // separation/position; it must never feed another scale back into Home.
 function residents(L){return [
  {l:L.boardLeft+L.S*(cg.cornerTransform.x+cg.inkLocal.left*cg.homeScale),t:L.boardTop+L.S*(cg.cornerTransform.y+cg.inkLocal.top*cg.homeScale)},
  {l:L.boardLeft+L.S*(1041-.4991*150),t:L.stageTop-6*(L.floorY-L.stageTop)/208.23144}
 ];}
 function rail(L,w){const full=w-L.M;return Math.min(full,...residents(L).map(r=>
  r.l-12+(full-r.l+12)*smooth((r.t-L.cardY-L.cardH-12)/56)));}
 const historyCache=new Map();
 const phoneHistoryCache=new Map();
 function joint(w,h){
  if(!historyCache.has(h)){
   const rows=Array.from({length:1051},(_,i)=>{const x=i+390,L=solo(x,h),right=rail(L,x);return {L,right,room:Math.max(0,right-L.M-L.cardW)};});
   // Anticipate a narrower character lane instead of reversing separation as
   // the viewport grows. Interpolate the resulting envelope during resize.
   let cap=Infinity;
   for(let i=1050;i>=0;i--){cap=Math.min(cap,rows[i].room);rows[i].cap=cap;}
   let previous=0;
   rows.forEach((r,i)=>{const x=i+390,wide=clamp((x-810)/630,0,1),desired=r.L.cardW*(.72+(1+24/282-.72)*wide)*smooth((x-550)/260);
    r.sep=Math.min(r.cap,desired,previous+1.5);previous=r.sep;
    r.left=x<=550?r.L.cardX:clamp(r.L.cardX-r.sep/2,r.L.M,Math.max(r.L.M,r.right-r.L.cardW-r.sep));
   });
   for(let i=1049;i>=0;i--)rows[i].left=Math.min(rows[i].left,rows[i+1].left+1.25);
   for(let i=1;i<=1050;i++)rows[i].left=Math.min(rows[i].left,rows[i-1].left+1.25);
   if(historyCache.size>=8)historyCache.delete(historyCache.keys().next().value);historyCache.set(h,rows);
  }
  const rows=historyCache.get(h),x=clamp(w-390,0,1050),i=Math.floor(x),a=rows[i],b=rows[Math.min(1050,i+1)],t=x-i;
  return {sep:a.sep+(b.sep-a.sep)*t,left:a.left+(b.left-a.left)*t};
 }

 return {
  layout(w,h){const F=responsiveFrame(w,h);return transformLayout(solo(F.width,F.height),F,w,h);},
  history(w,h){
   const F=responsiveFrame(w,h),base=solo(F.width,F.height),L=transformLayout(base,F,w,h);
   let q;
   if(F.width<1440){
    const v10=(w)=>{
     const b=solo(w,F.height),t=smooth((w-550)/90),left=b.cardX+(b.M-b.cardX)*t;
     const available=Math.max(0,rail(b,w)-left-b.cardW);
     return {left,sep:Math.min(available,b.cardW*(1+24/282))};
    };
    q=v10(F.width);
    if(F.width>550&&F.width<640){
     if(!phoneHistoryCache.has(F.height)){
      const a=v10(550),z=v10(640);
      // Join the approved endpoints in viewport space. Re-easing card-bottom
      // clearance through rail() made a 1px resize move History by 10px.
      const rows=Array.from({length:91},(_,i)=>{
       const w=550+i,b=solo(w,F.height),left=v10(w).left;
       const right=Math.min(w-b.M,...residents(b)
        .filter(r=>b.cardY+b.cardH>r.t+.01).map(r=>r.l));
       const desired=a.sep+(z.sep-a.sep)*smooth(i/90);
       return {left,hist:left+Math.min(desired,Math.max(0,right-left-b.cardW))};
      });
      // A-1142's 3px/1px rendered-motion limit; envelopes only reduce available
      // separation, so smoothing cannot move History through character ink.
      for(let i=1;i<rows.length;i++)rows[i].hist=Math.min(rows[i].hist,rows[i-1].hist+3);
      for(let i=rows.length-2;i>=0;i--)rows[i].hist=Math.min(rows[i].hist,rows[i+1].hist+3);
      if(phoneHistoryCache.size>=8)phoneHistoryCache.delete(phoneHistoryCache.keys().next().value);
      phoneHistoryCache.set(F.height,rows);
     }
     const rows=phoneHistoryCache.get(F.height),x=F.width-550,i=Math.floor(x),t=x-i;
     const hist=rows[i].hist+(rows[Math.min(i+1,90)].hist-rows[i].hist)*t;
     q.sep=Math.max(0,hist-q.left);
    }
    // FINAL 경계 연결용: join the last v10 frame (1280) to the retained 1440
    // desktop placement through the unkeyframed band; the card size makes the
    // same handoff, so neither position nor size steps at the width cap.
    if(F.width>1280){
     const a=v10(1280),b=joint(1440,F.height),t=smooth((F.width-1280)/160);
     q={left:a.left+(b.left-a.left)*t,sep:a.sep+(b.sep-a.sep)*t};
    }
   }else q=joint(F.width,F.height);
   const homeLeft=q.left*F.scale+F.x,histLeft=homeLeft+q.sep*F.scale;
   const cardW=L.cardW,cardH=L.cardH,histRight=histLeft+cardW,overlap=Math.max(0,cardW-q.sep*F.scale);
   const right=rail(base,F.width)*F.scale+F.x;
   return {L,cardW,cardH,top:L.cardY,homeLeft,histLeft,histRight,
    mode:F.width<641?'stacked':overlap>0?'fan':'pair',
    homeDx:homeLeft-L.cardX,gap:histLeft-homeLeft-cardW,signedGap:histLeft-homeLeft-cardW,overlap,
    underDx:homeLeft-histLeft,
    // Preserve the original tuck-out timing/layer order, but stop its excursion
    // before character ink. Full clearance cannot require shrinking the cards.
    clearDx:Math.max(0,Math.min(overlap+10*F.scale,right-histRight)),Rr:right};
  }
 };
}
