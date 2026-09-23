// React deck builder (phase 3): single-file React SPA presentation with real
// react-bits components — TextType (gsap cursor) + CircularText (motion) —
// inlined into a babel script. CDN React/Babel/gsap/framer-motion.
import { chartSvg } from '../shared/chart-svg'
import { translate, type Lang } from '../shared/locales'
import { loadSettings } from './settings-store'
const dk = (): Lang => loadSettings().language === 'en' ? 'en' : 'zh'

const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')

const csvTable = (csv: string): string => {
  const rows = csv.split('\n').slice(0, 30).map(l => l.split(/[,，\t]/).map((c: string) => esc(c.replace(/^"|"$/g, '').trim()))).filter((r: string[]) => r.some(Boolean))
  return `<table><tbody>${rows.map((r: string[], i: number) => `<tr>${r.map((c: string) => `<td${i === 0 ? ' style="color:#ff6a3d;font-weight:700"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

export function buildReactDeck(title: string, blocks: { kind: string; content: string }[], themeColor = '#ff6a3d', themeFont = ''): string {
  const slides: any[] = [{ type: 'cover', kicker: 'DESKAPP · CREATION', title, sub: translate(dk(), 'deck.sub') + '，文字可直接编辑' }]
  for (const b of blocks) {
    if (b.kind === 'image') slides.push({ type: 'image', src: 'file://' + b.content })
    else if (b.kind === 'table') slides.push({ type: 'table', table: csvTable(b.content) })
    else if (b.kind === 'chart') slides.push({ type: 'chart', svg: chartSvg(b.content) })
    else if (b.kind === 'component') slides.push({ type: 'html', html: b.content })
    else slides.push({ type: 'text', heading: b.content.split('\n')[0].slice(0, 40), body: b.content })
  }
  const slidesJson = JSON.stringify(slides).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://unpkg.com/framer-motion@10/dist/framer-motion.js"></script>
<style>
  *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#050507;color:#f8f4ec;font-family:${themeFont ? `'${themeFont}', ` : ''}-apple-system,'PingFang SC','Noto Sans SC',sans-serif}
  :root{--accent:${themeColor}}
  .viewport{position:fixed;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 80% 10%,rgba(255,106,61,.22),transparent 30%),#050507}
  .stage{width:min(100vw,calc(100vh*16/9));aspect-ratio:16/9;position:relative;overflow:hidden;background:#0b0b0f;padding:92px 104px;box-shadow:0 32px 120px rgba(0,0,0,.42)}
  .kicker{font-size:24px;color:var(--accent);text-transform:uppercase;margin:0}
  h1{margin:34px 0 0;font-size:112px;line-height:.95;min-height:130px}
  h2{margin:0;font-size:72px;line-height:1.02}
  p{margin:0;color:rgba(248,244,236,.68);font-size:32px;line-height:1.65}
  .lead{margin-top:42px;max-width:980px;white-space:pre-wrap}
  img{max-width:86%;max-height:70vh;border-radius:12px}
  table{border-collapse:collapse;width:100%;font-size:22px;margin-top:40px}td{border:1px solid rgba(255,255,255,.15);padding:10px 16px;color:var(--accent);font-weight:700}
  td:not(:first-child){color:inherit;font-weight:400}
  .counter{position:fixed;right:28px;bottom:24px;font-size:13px;color:rgba(255,255,255,.6);z-index:10}
  .edit-note{position:fixed;left:28px;bottom:24px;font-size:13px;color:rgba(255,255,255,.45);z-index:10}
  [contenteditable]{outline:none}
  .circular-text{border-radius:50%;width:200px;height:200px;font-weight:900;color:#fff;text-align:center;cursor:pointer;transform-origin:50% 50%;flex-shrink:0}
  .circular-text span{position:absolute;display:inline-block;left:0;right:0;top:0;bottom:0;font-size:24px}
  .cursor{margin-left:.2rem}
</style>
</head>
<body>
<div class="viewport"><div class="stage" id="root"></div></div>
<div class="counter" id="counter"></div>
<div class="edit-note">{translate(dk(), 'deck.editNote')}</div>
<script type="text/babel">
const {useEffect,useRef,useState}=React;
// react-bits TextType (original gsap cursor blink)
function TextType({text,typingSpeed=50,pauseDuration=2000,deletingSpeed=30,loop=true,showCursor=true}){
  const [displayed,setDisplayed]=useState('');
  const [idx,setIdx]=useState(0);
  const [deleting,setDeleting]=useState(false);
  const [ci,setCi]=useState(0);
  const cursorRef=useRef(null);
  const arr=Array.isArray(text)?text:[text];
  useEffect(()=>{
    if(showCursor&&cursorRef.current){
      gsap.set(cursorRef.current,{opacity:1});
      gsap.to(cursorRef.current,{opacity:0,duration:0.5,repeat:-1,yoyo:true,ease:'power2.inOut'});
    }
  },[showCursor]);
  useEffect(()=>{
    let t;
    const cur=arr[idx];
    const step=()=>{
      if(deleting){
        if(displayed===''){if(idx===arr.length-1&&!loop)return;setDeleting(false);setIdx(p=>(p+1)%arr.length);setCi(0);t=setTimeout(()=>{},pauseDuration);}
        else t=setTimeout(()=>setDisplayed(p=>p.slice(0,-1)),deletingSpeed);
      }else{
        if(ci<cur.length)t=setTimeout(()=>{setDisplayed(p=>p+cur[ci]);setCi(p=>p+1);},typingSpeed);
        else if(!(!loop&&idx===arr.length-1))t=setTimeout(()=>setDeleting(true),pauseDuration);
      }
    };
    if(ci===0&&!deleting&&displayed==='')t=setTimeout(step,400);else step();
    return ()=>clearTimeout(t);
  },[displayed,ci,deleting,idx]);
  return <span>{displayed}{showCursor&&<span ref={cursorRef} className="cursor">|</span>}</span>;
}
// react-bits CircularText (motion)
const {motion,useAnimation,useMotionValue}=Motion;
function CircularText({text,spinDuration=20}){
  const letters=Array.from(text);
  const controls=useAnimation();
  const rotation=useMotionValue(0);
  useEffect(()=>{
    controls.start({rotate:rotation.get()+360,scale:1,transition:{rotate:{from:rotation.get(),to:rotation.get()+360,ease:'linear',duration:spinDuration,repeat:Infinity},scale:{type:'spring',damping:20,stiffness:300}}});
  },[spinDuration]);
  return (
    <motion.div className="circular-text" style={{rotate:rotation}} initial={{rotate:0}} animate={controls}>
      {letters.map((letter,i)=>{const d=(360/letters.length)*i;const f=Math.PI/letters.length;return <span key={i} style={{transform:\`rotateZ(\${d}deg) translate3d(\${f*i}px, \${f*i}px, 0)\`}}>{letter}</span>;})}
    </motion.div>
  );
}
// react-bits Shuffle (condensed — progressive char scramble, no SplitText)
function Shuffle({text}){
  const target=Array.from(text);
  const [chars,setChars]=useState(Array(target.length).fill(' '));
  useEffect(()=>{
    let revealed=0;
    const iv=setInterval(()=>{
      if(revealed>=target.length){clearInterval(iv);return;}
      revealed++;
      setChars(target.map((c,i)=>{
        if(i<revealed)return c;
        const set='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return set[Math.floor(Math.random()*set.length)];
      }));
    },35);
    return ()=>clearInterval(iv);
  },[]);
  return <span>{chars.join('')}</span>;
}
// react-bits ASCIIText (condensed — 2D canvas ASCII rain, no THREE)
function AsciiRain(){
  const ref=useRef(null);
  useEffect(()=>{
    const canvas=ref.current; const ctx=canvas.getContext('2d');
    let w,h,cols,chars=[];
    const setup=()=>{w=canvas.width=canvas.offsetWidth;h=canvas.height=canvas.offsetHeight;cols=Math.floor(w/14);chars=Array(cols).fill(0).map(()=>Math.floor(Math.random()*30));};
    setup();
    const iv=setInterval(()=>{
      ctx.fillStyle='rgba(5,5,7,.12)';ctx.fillRect(0,0,w,h);
      ctx.font='14px monospace';
      for(let c=0;c<cols;c++){
        const ch=String.fromCharCode(33+Math.floor(Math.random()*90));
        ctx.fillStyle=c%3?'#34d399':'#ff6a3d';
        ctx.fillText(ch,c*14,chars[c]*18);
        if(chars[c]*18>h&&Math.random()>.975)chars[c]=0;
        chars[c]++;
      }
    },50);
    window.addEventListener('resize',setup);
    return ()=>{clearInterval(iv);window.removeEventListener('resize',setup);};
  },[]);
  return <canvas ref={ref} style={{width:'100%',height:'100%'}}/>;
}
const SLIDES=${slidesJson};
function App(){
  const [i,setI]=useState(0);
  useEffect(()=>{
    const onKey=(e)=>{if(e.key==='ArrowRight'||e.key===' ')setI(p=>Math.min(p+1,SLIDES.length-1));if(e.key==='ArrowLeft')setI(p=>Math.max(p-1,0));};
    window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey);
  },[]);
  useEffect(()=>{document.getElementById('counter').textContent=(i+1)+' / '+SLIDES.length;},[i]);
  const s=SLIDES[i];
  return (
    <div key={i} style={{width:'100%',height:'100%'}}>
      {s.type==='cover'&&<div style={{display:'flex',alignItems:'center',gap:60}}><div><p className="kicker">{s.kicker}</p><h1><TextType text={s.title}/></h1><p className="lead">{s.sub}</p></div><CircularText text="DESKAPP · CREATION · "/></div>}
      {s.type==='text'&&<div><h2><Shuffle text={s.heading}/></h2><p className="lead" contentEditable suppressContentEditableWarning={true}>{s.body}</p></div>}
      {s.type==='image'&&<div style={{display:'grid',place-items:'center',height:'100%'}}><img src={s.src} alt=""/></div>}
      {s.type==='table'&&<div dangerouslySetInnerHTML={{__html:s.table}}/>}
      {s.type==='chart'&&<div dangerouslySetInnerHTML={{__html:s.svg}}/>}
      {s.type==='html'&&(s.html.indexOf('::ascii::')===0
        ? <div style={{position:'relative',width:'100%',height:'100%'}}><AsciiRain/><div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',fontSize:72,fontWeight:900,textShadow:'0 0 40px rgba(52,211,153,.4)'}}>{s.html.slice(8)}</div></div>
        : <div style={{display:'grid',placeItems:'center',height:'100%'}} dangerouslySetInnerHTML={{__html:s.html}}/>)}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
</script>
</body></html>`
}
