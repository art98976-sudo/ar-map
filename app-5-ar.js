/* =====================================================================
   AR VIEW
   A simple camera model: the phone is held 1.5 m above the ground, looking
   along the compass heading and tilted by the measured pitch. Route points
   on the ground are projected onto the screen, so the arrows sit on the floor.
   ===================================================================== */
const FOV = 60;           // horizontal field of view in degrees
const MAX_RANGE = 1500;   // metres
const CAM_H = 1.5;        // phone height above the ground in metres
const HORIZON = 0.45;     // where the horizon sits in the simulated scene (fraction of screen height)
const labelEls = {};
function buildLabels(){
  const wrap=$('arLabels');
  POIS.forEach(p=>{
    const c=CATS[p.cat], el=document.createElement('div');
    el.className='ar-label';
    el.innerHTML=`<div class="ar-card"><div class="ic" style="background:${c.color}">${c.icon}</div><div><b>${p.name}</b><small class="dd"></small></div></div><div class="stem"></div>`;
    el.onclick=()=>openSheet(p);
    wrap.appendChild(el); labelEls[p.id]=el;
  });
  const tape=$('compassTape'); let h='';
  for(let a=-360;a<=720;a+=15){const n=((a%360)+360)%360; const t=n%90===0?['N','E','S','W'][n/90]:(n%45===0?CARD[n/45]:'·');
    h+=`<span style="left:${(a+360)*4}px">${t}</span>`;}
  tape.innerHTML=h;
}
// Screen focal length. With the real camera it comes from the video: phone cameras see about 65° along the
// long side of the picture, and the picture is cropped to fill the screen, so a portrait screen sees much less
// than 60° across. Getting this right is what makes labels and arrows land on the real things.
function camera(){
  const W=$('ar').clientWidth||innerWidth, H=$('ar').clientHeight||innerHeight, v=$('arVideo');
  let f;
  if(S.camOn && v.videoWidth){ const vw=v.videoWidth, vh=v.videoHeight, s=Math.max(W/vw,H/vh);
    f=(Math.max(vw,vh)/2)/Math.tan(rad(S.lensFov/2))*s; }
  else f=(W/2)/Math.tan(rad(FOV/2));
  const roll = S.mode==='live' ? S.roll : 0;
  return {W,H,f,cx:W/2,cy:H/2,hfov:2*deg(Math.atan(W/2/f)),roll,p:rad(S.pitch),cp:Math.cos(rad(S.pitch)),sp:Math.sin(rad(S.pitch))};
}
// right / forward are metres relative to the viewer; up is height above the ground
function project(c,right,fwd,up){
  const h=CAM_H-up, z=fwd*c.cp+h*c.sp, y=h*c.cp-fwd*c.sp;
  if(z<0.35) return null;
  return [c.cx+c.f*right/z, c.cy+c.f*y/z, z];
}
function renderAR(now){
  const c=camera(), W=c.W, H=c.H, half=c.hfov/2, here=S.view;
  // nearest places first: they keep their true spot; farther ones step up out of the way, or hide
  const items=POIS.map(p=>({p,d:dist(here,p),b:bearing(here,p)})).sort((a,b)=>a.d-b.d);
  // y is the bottom of a label's stem; the card sits about 100 px above it, and must stay clear of the compass and banner
  $('arLabels').style.transform = c.roll ? `rotate(${c.roll}rad)` : '';
  items.forEach(({p})=>{ labelEls[p.id].style.display='none'; });
  if(!S.camOn){ $('hills').style.transform=`translateX(${-((S.heading%360)/360)*66.666}%)`; }
  $('compassTape').style.transform=`translateX(${$('compass').clientWidth/2-(S.heading+360)*4}px)`;
  // status line: direction, plus GPS and compass health in live mode
  $('headingTxt').textContent=`${Math.round((S.heading+360)%360)}° ${cardinal((S.heading+360)%360)}`
    + (S.mode!=='live' ? ' · demo' : (S.gotFix ? ` · GPS ±${Math.round(S.accuracy||0)} m` : ' · finding GPS…')
       + (S.headingSrc==='compass' ? ' · compass ✓' : S.headingSrc==='gps' ? ' · heading from GPS' : ' · no compass'));
  $('liveBtn').style.display = S.mode==='demo' && !S.route ? 'block' : 'none';
  $('arChooseBtn').style.display = S.route ? 'none' : 'block';
  drawRadar(here, items);
  drawGround(c,now);
  // direction arrow: points at the path about 10 m ahead, so it shows where to walk right now
  if(S.route){
    const r=S.route, remain=r.total-S.along;
    const target = remain<12 ? S.dest : r.pointAt(S.along+Math.min(10,remain));
    const rel=norm180(bearing(here,target)-S.heading);
    $('navHud').style.display='none'; $('arHelp').style.display='none';
    $('navBanner').style.display=S.tab==='ar'?'none':'flex';
    $('navArrow').style.transform=`rotate(${rel}deg)`;
    $('navTxt').innerHTML = S.arrived ? `🎉 Arrived at ${S.dest.name}` :
      Math.abs(rel)>50 ? `Turn ${rel>0?'right':'left'} to face the route` :
      `Continue along the route<br><span style="font-weight:500">${fmtD(remain)} to ${S.dest.name}</span>`;
  } else { $('navHud').style.display='none'; $('arHelp').style.display=''; }
}

// draws the route as a glowing lane with moving chevrons on the ground, plus signs at the next turn and the destination
function drawGround(c,now){
  const cv=$('arGround'), dpr=Math.min(2,window.devicePixelRatio||1);
  if(cv.width!==Math.round(c.W*dpr) || cv.height!==Math.round(c.H*dpr)){ cv.width=Math.round(c.W*dpr); cv.height=Math.round(c.H*dpr); }
  const g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,c.W,c.H);
  const r=S.route; if(!r || S.arrived && r.total-S.along<2) return;
  if(c.roll){ g.translate(c.cx,c.cy); g.rotate(c.roll); g.translate(-c.cx,-c.cy); }
  const U=NAV.toXY(S.view.lat,S.view.lng), hr=rad(S.heading), ch=Math.cos(hr), sh=Math.sin(hr);
  const local=(x,y)=>{ const dx=x-U[0],dy=y-U[1]; return [dx*ch-dy*sh,dx*sh+dy*ch]; };
  const frame=d=>{ const a=r.pointXY(d),b=r.pointXY(d-0.6),e=r.pointXY(d+0.6); let tx=e[0]-b[0],ty=e[1]-b[1]; const L=Math.hypot(tx,ty)||1; return {x:a[0],y:a[1],tx:tx/L,ty:ty/L}; };
  const ground=(fr,side,ahead)=>{ const x=fr.x+fr.tx*ahead+fr.ty*side,y=fr.y+fr.ty*ahead-fr.tx*side,q=local(x,y); return project(c,q[0],q[1],0); };
  // Keep cues near the walker so they remain visibly attached to the ground in the camera view.
  const end=Math.min(r.total,S.along+22), width=S.camOn?0.72:0.9;
  const gap=2.5;
  const shape=[[0,1.05],[0.75,0.05],[0.38,0.05],[0,-0.55],[-0.38,0.05],[-0.75,0.05]];
  for(let d=S.along+4;d<end;d+=gap){
    const fr=frame(d),pts=shape.map(([side,ahead])=>ground(fr,side*width,ahead*width));
    if(pts.some(p=>!p) || pts.some(p=>p[1]<c.H*0.52 || p[1]>c.H*0.9)) continue;
    const alpha=Math.max(0.4,1-(d-S.along)/28);
    g.beginPath(); pts.forEach((p,i)=>i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1])); g.closePath();
    g.save(); g.shadowColor='rgba(0,0,0,.55)'; g.shadowBlur=3; g.shadowOffsetY=2;
    g.fillStyle=`rgba(255,190,0,${alpha})`; g.fill(); g.restore();
    g.lineWidth=2; g.strokeStyle=`rgba(255,255,255,${alpha})`; g.stroke();
  }
}

// GPS mini-map: your position, its accuracy and the route ahead, turned so "up" is the way you face
function drawRadar(here, items){
  const cv=$('radarCv'); if(!cv) return;
  const g=cv.getContext('2d'), W=cv.width, R=W/2, range=S.route?120:800, sc=(R-8)/range;
  const U=NAV.toXY(here.lat,here.lng), hr=rad(S.heading), ch=Math.cos(hr), sh=Math.sin(hr);
  const tr=(x,y)=>{ const dx=x-U[0], dy=y-U[1]; return [R+(dx*ch-dy*sh)*sc, R-(dx*sh+dy*ch)*sc]; };
  g.clearRect(0,0,W,W); g.save(); g.beginPath(); g.arc(R,R,R-2,0,Math.PI*2); g.clip();
  g.fillStyle='rgba(8,28,18,.62)'; g.fillRect(0,0,W,W);
  g.strokeStyle='rgba(255,255,255,.18)'; g.lineWidth=2; [0.33,0.66].forEach(f=>{ g.beginPath(); g.arc(R,R,(R-8)*f,0,Math.PI*2); g.stroke(); });
  if(S.mode==='live' && S.gotFix && S.accuracy){ g.fillStyle='rgba(59,130,246,.25)'; g.beginPath(); g.arc(R,R,Math.min(R,S.accuracy*sc),0,Math.PI*2); g.fill(); }
  if(S.route){
    const r=S.route, line=(from,to,col,w)=>{ g.beginPath(); let first=true;
      for(let d=from; d<=to; d+=2){ const p=r.pointXY(d), q=tr(p[0],p[1]); first?g.moveTo(q[0],q[1]):g.lineTo(q[0],q[1]); first=false; }
      g.strokeStyle=col; g.lineWidth=w; g.lineCap='round'; g.lineJoin='round'; g.stroke(); };
    line(Math.max(0,S.along-60),S.along,'rgba(148,163,184,.8)',6);
    line(S.along,Math.min(r.total,S.along+range*1.5),'#3b82f6',9);
    const e=r.pointXY(r.total), q=tr(e[0],e[1]); g.fillStyle='#f5b301'; g.beginPath(); g.arc(q[0],q[1],9,0,Math.PI*2); g.fill();
  } else {
    items.forEach(({p,d,b})=>{ if(d>range) return; const a=rad(norm180(b-S.heading)), rr=d*sc;
      g.fillStyle=CATS[p.cat].color; g.beginPath(); g.arc(R+Math.sin(a)*rr, R-Math.cos(a)*rr, 6, 0, Math.PI*2); g.fill(); });
  }
  // you
  g.fillStyle='#fff'; g.beginPath(); g.moveTo(R,R-16); g.lineTo(R+11,R+11); g.lineTo(R,R+5); g.lineTo(R-11,R+11); g.closePath(); g.fill();
  g.restore();
  g.strokeStyle='rgba(255,255,255,.6)'; g.lineWidth=3; g.beginPath(); g.arc(R,R,R-2,0,Math.PI*2); g.stroke();
}

// Demo controls: drag and keys to rotate view
(function(){
  let dragging=false,lx=0;
  const ar=$('ar');
  ar.addEventListener('pointerdown',e=>{ if(S.mode!=='demo'||e.target.closest('.ar-label,.ar-tools,#calibPanel'))return; dragging=true; lx=e.clientX; S.spin=false; $('spinToggle').classList.remove('on'); });
  window.addEventListener('pointermove',e=>{ if(!dragging)return; S.targetHeading-= (e.clientX-lx)*(FOV/ar.clientWidth); lx=e.clientX; });
  window.addEventListener('pointerup',()=>dragging=false);
  window.addEventListener('keydown',e=>{
    if(S.mode!=='demo'||document.activeElement===$('q'))return;
    if(e.key==='ArrowLeft') S.targetHeading-=10;
    if(e.key==='ArrowRight') S.targetHeading+=10;
  });
})();
$('spinToggle').onclick=()=>{ S.spin=!S.spin; $('spinToggle').classList.toggle('on',S.spin); };
$('camToggle').onclick=()=>{ S.camOn?stopCamera():startCamera(); };

// Calibration: compasses inside phones are often a few degrees off, more so near buildings and steel.
// "Align" takes the direction of the path you are standing on as the truth.
function alignToPath(){
  if(!S.route){ toast('Start a route first. Then point your phone along the path you are on and tap Align.',4500); return; }
  if(S.rawHeading==null){ toast('No compass reading yet. Move the phone a little and try again.'); return; }
  S.headingOffset=Math.round(norm180(S.route.headingAt(S.along+3)-S.rawHeading)); saveCalib(); showCalib();
  S.targetHeading=S.heading+norm180(S.rawHeading+S.headingOffset-S.heading);
  toast(`Aligned. Compass corrected by ${S.headingOffset>0?'+':''}${S.headingOffset}°.`);
}
function showCalib(){
  $('offRange').value=S.headingOffset; $('offVal').textContent=(S.headingOffset>0?'+':'')+S.headingOffset+'°';
  $('lensRange').value=S.lensFov; $('lensVal').textContent=S.lensFov+'°';
}
$('alignBtn').onclick=alignToPath; $('alignBtn2').onclick=alignToPath;
$('calibBtn').onclick=()=>{ showCalib(); $('calibPanel').classList.toggle('open'); };
$('calibClose').onclick=()=>$('calibPanel').classList.remove('open');
$('calibReset').onclick=()=>{ S.headingOffset=0; S.lensFov=65; saveCalib(); showCalib(); };
$('offRange').oninput=e=>{ S.headingOffset=+e.target.value; saveCalib(); showCalib();
  if(S.rawHeading!=null) S.targetHeading=S.heading+norm180(S.rawHeading+S.headingOffset-S.heading); };
$('lensRange').oninput=e=>{ S.lensFov=+e.target.value; saveCalib(); showCalib(); };

let stream=null;
async function startCamera(){
  if(S.camOn) return;
  try{
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('no camera API'),{name:'NotSupported'});
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    const v=$('arVideo'); v.srcObject=stream; v.setAttribute('playsinline',''); v.muted=true;
    await v.play().catch(()=>{});
    v.style.display='block'; $('arScene').style.display='none';
    S.camOn=true; $('camToggle').classList.add('on');
  }catch(err){
    const n=err&&err.name;
    toast(n==='NotAllowedError' ? 'Camera is blocked. Allow camera access for this site in your browser settings.' :
          !isSecureContext ? 'The camera needs a secure (https) link.' : 'Camera unavailable. Showing the simulated campus view.', 5000);
  }
}
function stopCamera(){
  stream?.getTracks().forEach(t=>t.stop()); stream=null;
  $('arVideo').style.display='none'; $('arScene').style.display='block'; S.camOn=false; $('camToggle').classList.remove('on');
}
