import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sendCardMarkup} from '../src/send-card.js';
const src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const fn=n=>{const m=new RegExp(`^function ${n}\\(`,'m').exec(src);assert.ok(m,n);return src.slice(m.index,src.indexOf('\n}',m.index)+2)};
let busy=false,blocked=false,pass=0;
const c={state:{sendCardVisible:true,message:'Piggy is home.',detail:''},isAllowedPiggyRpId:()=>!blocked,sendBusy:()=>busy,displayPiggyName:()=>'',sendCardMarkup,firstSendAmountSecondary:()=> '0.001 MON test',FIRST_SEND_USD_LABEL:'$5',buttonInkFilter:()=>'',arasoBrandMarkup:()=>'',corner:()=>'',homeCharacter:()=>'',recordsCardMarkup:()=>'',inviteHoles:()=>'',inviteHero:()=>'',inviteFace:()=>'',chogInviteMarkup:()=>'<span data-chog-invite></span>',GIFT_PAPER_LINES:{for:['a Piggy','for you'],came:['a Piggy came','for you.']}};
vm.createContext(c);vm.runInContext(['inviteExplanation','inviteMobile','inviteWide','renderSendStay'].map(fn).join('\n'),c);
function check(label,f){f();pass++;console.log('PASS '+label)}
check('received both families readable copy; both Gift kinds excluded',()=>{for(const render of [c.inviteMobile,c.inviteWide]){assert.match(render(),/Your Piggy keeps your money\.<br>Tap Face ID\. It hatches!/);for(const gift of ['for','came'])assert.doesNotMatch(render(gift),/invite__explain/)}});
check('idle Send explains without replacing existing amount or message',()=>{const h=c.renderSendStay();assert.match(h,/You sign\. Piggy takes your money to work\./);assert.match(h,/Piggy&#39;s first job\?|Piggy's first job\?/);assert.match(h,/0\.001 MON test/)});
for(const [message,detail] of [['Piggy is waking up.',''],["Piggy can't go out yet.",'nothing moved.'],['Piggy is home.','checking…']])check('status wins: '+message+' '+detail,()=>{Object.assign(c.state,{message,detail});assert.doesNotMatch(c.renderSendStay(),/sendCard__explain/)});
check('busy and blocked hide explanation',()=>{Object.assign(c.state,{message:'',detail:''});busy=true;assert.doesNotMatch(c.renderSendStay(),/sendCard__explain/);busy=false;blocked=true;assert.doesNotMatch(c.renderSendStay(),/sendCard__explain/);blocked=false});
check('birth restored',()=>{assert.match(src,/setScene\("birth", "The egg is checking this device\.", "Face ID may appear once\."\)/);assert.doesNotMatch(src,/Face ID is your Piggy's key\. No password\./)});
console.log(`A1224 ${pass} PASS / 0 FAIL / 0 SKIP (VM/render only)`);
