import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sendCardMarkup} from '../src/send-card.js';
const src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const fn=n=>{const m=new RegExp(`^function ${n}\\(`,'m').exec(src);assert.ok(m,n);return src.slice(m.index,src.indexOf('\n}',m.index)+2)};
let busy=false,blocked=false,pass=0;
const c={state:{sendCardVisible:true,message:'Piggy is home.',detail:''},isAllowedPiggyRpId:()=>!blocked,sendBusy:()=>busy,displayPiggyName:()=>'',sendCardMarkup,firstSendAmountSecondary:()=> '0.001 MON test',/* [A-1434] the card's more info + its escape/amount helpers */formatMoney:()=> '0.001 MON',SEND_AMOUNT:0,escapeHtml:(v)=>String(v),FIRST_SEND_USD_LABEL:'$5',buttonInkFilter:()=>'',arasoBrandMarkup:()=>'',corner:()=>'',homeCharacter:()=>'',recordsCardMarkup:()=>'',inviteHoles:()=>'',inviteHero:()=>'',inviteFace:()=>'',chogInviteMarkup:()=>'<span data-chog-invite></span>',GIFT_PAPER_LINES:{for:['a Piggy','for you'],came:['a Piggy came','for you.']}};
vm.createContext(c);vm.runInContext(['trialPhaseStamp','inviteExplanation','inviteMobile','inviteWide','firstSendActualLine','firstSendInfoMarkup','renderSendStay'].map(fn).join('\n'),c);
function check(label,f){f();pass++;console.log('PASS '+label)}
// [A-1434 A6] the Send stamp reads "tutorial · free" (pre: "trial phase · free" on both); the invite stamp is unchanged
check('testnet first entry and Send include one readable stamp',()=>{c.LEGACY_TESTNET_PATH=true;for(const html of [c.inviteMobile(),c.inviteWide()])assert.equal((html.match(/trial phase · free/g)||[]).length,1);assert.equal((c.renderSendStay().match(/tutorial · free/g)||[]).length,1)});
check('Gift envelopes never include trial stamp',()=>{for(const render of [c.inviteMobile,c.inviteWide])for(const gift of ['for','came'])assert.doesNotMatch(render(gift),/trialStamp/)});
check('fork and inactive profiles exclude stamp in both renderers',()=>{c.LEGACY_TESTNET_PATH=false;for(const html of [c.inviteMobile(),c.inviteWide(),c.renderSendStay()])assert.doesNotMatch(html,/trialStamp/)});
check('unknown profile fails closed',()=>{delete c.LEGACY_TESTNET_PATH;assert.equal(c.trialPhaseStamp('send'),'');assert.equal(c.trialPhaseStamp('invite'),'')});
console.log(`A1230 ${pass} PASS / 0 FAIL / 0 SKIP (render/profile gates)`);
