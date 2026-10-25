/* =====================================================================
   LIVE SENSORS (GPS + compass + tilt)
   ===================================================================== */
// heading of the back camera from the full phone orientation (works when the phone is held upright)
function cameraHeading(a,b,gm){
  const x=rad(b), y=rad(gm), z=rad(a), cX=Math.cos(x), cY=Math.cos(y), cZ=Math.cos(z), sX=Math.sin(x), sY=Math.sin(y), sZ=Math.sin(z);
  const Vx=-cZ*sY-sZ*sX*cY, Vy=-sZ*sY+cZ*sX*cY;
  return (deg(Math.atan2(Vx,Vy))+360)%360;
}
/* ---------- Position filter ----------
   A small Kalman filter in metres. Each GPS fix is weighed by its reported accuracy, so a poor
   fix moves you a little and a good fix moves you a lot. Fixes that jump further than you could
   have walked are ignored (up to 3 in a row). Between fixes, detected footsteps move you forward. */
// It tracks position AND walking velocity (a "constant velocity" model), so it does not lag behind
// someone walking at a steady pace.
const TRACK = {
  x:null, y:null, vx:0, vy:0, P:null, t:0, rejects:0, stepLen:0.72, SA:0.8,   // SA: how quickly walking speed can change (m/s²)
  reset(){ this.x=null; this.y=null; this.vx=0; this.vy=0; this.P=null; this.rejects=0; },
  // P = [[pp, pv],[pv, vv]], shared by both axes
  predict(dt, still){
    if(this.x==null || dt<=0) return;
    if(still){ this.vx=0; this.vy=0; }                  // the pedometer says you are standing: no drifting
    this.x+=this.vx*dt; this.y+=this.vy*dt;
    const [pp,pv,vv]=this.P, q=this.SA*this.SA;
    this.P=[pp+2*dt*pv+dt*dt*vv + q*dt*dt*dt*dt/4, pv+dt*vv + q*dt*dt*dt/2, (still?Math.min(vv,0.05):vv) + q*dt*dt];
  },
  fix(lat,lng,acc,t,still){
    const [zx,zy]=NAV.toXY(lat,lng), R=Math.pow(Math.max(3,acc||30),2);
    if(this.x==null){ this.x=zx; this.y=zy; this.vx=0; this.vy=0; this.P=[R,0,1]; this.t=t; return true; }
    const dt=Math.min(10,Math.max(0.05,(t-this.t)/1000));
    // reject jumps further than you could have walked (up to 3 in a row, then trust GPS again)
    const px=this.x+this.vx*dt, py=this.y+this.vy*dt, d=Math.hypot(zx-px, zy-py);
    const gate=3*Math.sqrt(this.P[0]+R)+3*dt+5;
    if(d>gate && this.rejects<3){ this.rejects++; return false; }
    if(this.rejects>=3){ this.x=zx; this.y=zy; this.vx=0; this.vy=0; this.P=[R,0,1]; this.rejects=0; this.t=t; return true; }
    this.rejects=0;
    this.predict(dt, still); this.t=t;
    const [pp,pv,vv]=this.P, Sx=pp+R, Kp=pp/Sx, Kv=pv/Sx;
    const ex=zx-this.x, ey=zy-this.y;
    this.x+=Kp*ex; this.y+=Kp*ey; this.vx+=Kv*ex; this.vy+=Kv*ey;
    const sp=Math.hypot(this.vx,this.vy); if(sp>3){ this.vx*=3/sp; this.vy*=3/sp; }   // nobody walks faster than 3 m/s
    this.P=[(1-Kp)*pp, (1-Kp)*pv, vv-Kv*pv];
    return true;
  },
  moveBy(dx,dy){ if(this.x==null) return; this.x+=dx; this.y+=dy; this.P[0]+=0.12; },
  pullTo(x,y,k){ if(this.x==null) return; this.x+=(x-this.x)*k; this.y+=(y-this.y)*k; },
  pos(){ return NAV.toLL(this.x,this.y); },
  acc(){ return this.P ? Math.sqrt(this.P[0]) : 50; },
  speed(){ return Math.hypot(this.vx,this.vy); }
};

/* ---------- Footsteps (pedometer) ----------
   The phone's accelerometer bounces once per step. Each bounce moves you one step forward:
   along the route when you are on it and facing its way, otherwise in the direction you face. */
const PED = { avg:9.81, up:false, last:0,
  onMotion(e){
    const a=e.accelerationIncludingGravity; if(!a || a.x==null) return;
    S.hasMotion=true;
    const m=Math.hypot(a.x,a.y,a.z), t=performance.now(); this.avg+=(m-this.avg)*0.04; const v=m-this.avg;
    if(!this.up && v>1.3 && t-this.last>280){ this.up=true; this.last=t; onStep(); }
    else if(this.up && v<0.3) this.up=false;
  }
};
function onStep(){
  const now=performance.now();
  S.lastStep=now; S.stepCount++;
  if(S.mode!=='live' || TRACK.x==null) return;
  // with fresh, good GPS the filter already knows your speed; footsteps take over when GPS is stale or weak (indoors)
  if(now-(S.lastFixT||0)<2500 && (S.rawAcc||99)<=25) return;
  const L=TRACK.stepLen;
  if(S.route && !S.arrived && S.off<12){
    const rh=S.route.headingAt(S.along+1);
    if(Math.abs(norm180(S.heading-rh))<75){
      const q=S.route.pointXY(Math.min(S.route.total,S.along+L));
      TRACK.pullTo(q[0],q[1],1); TRACK.P[0]+=0.08;
      S.pos=TRACK.pos(); onPosChange(); return;
    }
  }
  TRACK.moveBy(L*Math.sin(rad(S.heading)), L*Math.cos(rad(S.heading)));
  S.pos=TRACK.pos(); onPosChange();
}

/* ---------- GPS ---------- */
let gpsWatch=null;
let weakGpsTimer=null, lastWeakFix=null;
// Phones can only show one permission prompt at a time. When camera and location are asked for
// together, some browsers silently dismiss one of them, which then looks like "location blocked".
// So the camera waits until the location question has been answered (or 15 s have passed).
let gpsAnswerWaiters=[];
function gpsAnswered(){ gpsAnswerWaiters.splice(0).forEach(f=>f()); }
function waitForGpsAnswer(ms=15000){
  if(S.mode!=='live' || S.gotFix || S.gpsErr!=null || gpsPerm==='granted' || gpsPerm==='denied') return Promise.resolve();
  return new Promise(r=>{ gpsAnswerWaiters.push(r); setTimeout(r,ms); });
}
function onFix(p){
  gpsAnswered();
  const c=p.coords, now=performance.now();
  S.gpsErr=null; S.rawAcc=c.accuracy;
  if(c.speed!=null && c.speed>0.8 && c.heading!=null && !isNaN(c.heading) && c.accuracy<30){ S.gpsCourse=c.heading; S.gpsCourseT=now; }
  // the first answers are often rough Wi-Fi or mast positions (hundreds of metres off): wait for real GPS,
  // but after 20 s take what there is
  if(!S.gotFix){
    S.firstTry=S.firstTry||now;
    if(c.accuracy>60 && now-S.firstTry<20000){
      lastWeakFix=p;
      if(weakGpsTimer==null){
        weakGpsTimer=setTimeout(()=>{
          weakGpsTimer=null;
          const fallback=lastWeakFix; lastWeakFix=null;
          if(!S.gotFix && fallback) onFix(fallback);
        },Math.max(0,20000-(now-S.firstTry)));
      }
      S.rawAcc=c.accuracy; S.pos={lat:c.latitude,lng:c.longitude}; S.accuracy=c.accuracy;
      if(MAPV){ MAPV.setMe(S.pos); MAPV.setAccuracy(S.pos,Math.min(c.accuracy,500)); }
      updateGpsPill(); return;
    }
    if(weakGpsTimer!=null){ clearTimeout(weakGpsTimer); weakGpsTimer=null; }
    lastWeakFix=null;
    TRACK.reset();
  }
  const still = S.hasMotion && now-S.lastStep>3000;
  if(!TRACK.fix(c.latitude,c.longitude,c.accuracy,now,still)){ updateGpsPill(); return; }
  S.pos=TRACK.pos(); S.accuracy=TRACK.acc(); S.lastFixT=now;
  if(!S.gotFix){
    S.gotFix=true; $('app').classList.remove('nofix');
    if(dist(S.pos,{lat:CAMPUS_CENTER[0],lng:CAMPUS_CENTER[1]})>3000) toast('You seem to be off campus. Routes and distances will be long.',4500);
    if(MAPV) MAPV.setView(S.pos,17.5);
    if(S.pendingNav){ const p2=S.pendingNav; S.pendingNav=null; onPosChange(); updateGpsPill(); startNav(p2); return; }
    if(S.dest) planRoute();
  }
  onPosChange(); updateGpsPill();
}
function onGpsError(e){
  gpsAnswered();
  S.gpsErr=e.code;
  if(e.code===1){
    // A revoked permission invalidates the previous fix too. Keep the last map position,
    // but expose the retry control and mark the GPS dot as stale until a new fix arrives.
    S.gotFix=false; S.rawAcc=null; S.accuracy=null; S.firstTry=0; TRACK.reset(); $('app').classList.add('nofix');
    if(MAPV) MAPV.setAccuracy(S.pos,0);
    if(weakGpsTimer!=null){ clearTimeout(weakGpsTimer); weakGpsTimer=null; }
    lastWeakFix=null;
    // A dismissed prompt also reports "denied", but the browser will ask again. Only a real block needs settings.
    S.gpsBlocked = gpsPerm!=='prompt';
    if(S.gpsBlocked){
      toast('Location is blocked. Check that phone Location is on and your browser may use it, allow Location for this site, then tap Retry GPS.',9000);
      if(S.pendingNav){ $('navName').textContent='Allow location access'; $('navInfo').textContent='Enable Location for this site in your browser settings, then tap Retry GPS to start the route to '+S.pendingNav.name+'.'; }
    } else {
      toast('Location was not allowed. Tap Enable GPS and choose Allow.',6000);
      if(S.pendingNav){ $('navName').textContent='Allow location access'; $('navInfo').textContent='Tap Enable GPS and choose Allow to start the route to '+S.pendingNav.name+'.'; }
    }
  } else if(!S.gotFix){
    toast(e.code===3 ? 'Still looking for GPS… go outside and keep the phone still for a moment.' : 'GPS is unavailable right now. Trying again…',5000);
  }
  updateGpsPill();
}
let gpsRetryTimer=null, gpsPerm=null, gpsPermWatched=false;
function startGps(){
  if(!('geolocation' in navigator)){ toast('This device has no location support.'); return; }
  if(!isSecureContext){ S.gpsErr=2; toast('GPS needs the secure https link. Open the GitHub Pages address again.',7000); updateGpsPill(); return; }
  if(gpsRetryTimer!=null){ clearTimeout(gpsRetryTimer); gpsRetryTimer=null; }
  if(gpsWatch!=null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch=navigator.geolocation.watchPosition(onFix,e=>{
      onGpsError(e);
      // one pending retry at a time; a blocked permission waits for the user (or the permission change below)
      if(e.code!==1 && gpsRetryTimer==null) gpsRetryTimer=setTimeout(()=>{ gpsRetryTimer=null; startGps(); },4000);
    },
    {enableHighAccuracy:true,maximumAge:0,timeout:20000});
}
// Follow the location permission itself. When the user allows location in the browser or system
// settings, GPS restarts on its own, without having to find the Retry button.
function watchGpsPermission(){
  if(gpsPermWatched || !navigator.permissions || !navigator.permissions.query) return;
  gpsPermWatched=true;
  navigator.permissions.query({name:'geolocation'}).then(st=>{
    gpsPerm=st.state; if(st.state!=='prompt') gpsAnswered();
    st.onchange=()=>{
      gpsPerm=st.state; if(st.state!=='prompt') gpsAnswered();
      if(S.mode!=='live') return;
      if(st.state==='granted' && !S.gotFix){
        S.gpsErr=null; S.gpsBlocked=false; S.firstTry=0; startGps();
        if(S.pendingNav){ $('navName').textContent='Waiting for your GPS position…'; $('navInfo').textContent='Route to '+S.pendingNav.name+' starts when GPS is found.'; }
        toast('Location allowed. Finding your position…',4000);
      } else if(st.state==='denied' && S.gpsErr!==1) onGpsError({code:1});
      updateGpsPill();
    };
  }).catch(()=>{ gpsPermWatched=false; });
}
function updateGpsPill(){
  if(S.mode!=='live') return;
  const requestBtn=$('gpsPermissionBtn');
  requestBtn.style.display=S.gotFix?'none':'block';
  const blocked=S.gpsErr===1 && S.gpsBlocked!==false;
  requestBtn.textContent=blocked?'📍 Retry GPS':'📍 Enable GPS';
  requestBtn.title=blocked?'Location is blocked. Allow location for this site in browser settings, then tap to retry.':'Tap to request location permission and start GPS.';
  requestBtn.setAttribute('aria-label',requestBtn.title);
  const pill=$('modePill'), a=S.accuracy, raw=S.rawAcc;
  pill.classList.remove('gps-good','gps-ok','gps-poor','gps-none');
  if(S.gpsErr===1){ $('modeTxt').textContent=blocked?'GPS blocked':'GPS off'; pill.classList.add('gps-none'); return; }
  if(!S.gotFix){ $('modeTxt').textContent = raw ? `LIVE · weak GPS ±${Math.round(raw)} m` : 'LIVE · finding GPS…'; pill.classList.add('gps-none'); return; }
  const shown=Math.round(Math.max(a||0, Math.min(raw||a, a*2)));
  $('modeTxt').textContent=`LIVE · ±${shown} m`;
  pill.classList.add(shown<=10?'gps-good':shown<=25?'gps-ok':'gps-poor');
}

/* ---------- Compass and tilt ---------- */
let lastCalibTip=0;
function onOrientation(e){
  if(e.beta==null || e.gamma==null) return;
  // world "up" seen from the phone: gives tilt (pitch) and sideways lean (roll), even in the upright pose
  const b=rad(e.beta), g=rad(e.gamma), ux=-Math.cos(b)*Math.sin(g), uy=Math.sin(b), uz=Math.cos(b)*Math.cos(g);
  S.targetPitch=Math.max(-30,Math.min(75,deg(Math.asin(Math.max(-1,Math.min(1,uz))))));
  S.targetRoll = Math.abs(S.targetPitch)<70 ? Math.atan2(ux,uy) : 0;
  let h=null;
  if(typeof e.webkitCompassHeading==='number' && e.webkitCompassHeading>=0){             // iPhone
    const so=(screen.orientation&&screen.orientation.angle)||window.orientation||0;
    h=e.webkitCompassHeading+so;
    S.compassAcc=typeof e.webkitCompassAccuracy==='number'?e.webkitCompassAccuracy:null;
  } else if((e.absolute===true || e.type==='deviceorientationabsolute') && e.alpha!=null){ // Android
    h = Math.abs(S.targetPitch)<65 ? cameraHeading(e.alpha,e.beta,e.gamma) : 360-e.alpha;
  }
  if(h==null) return;
  S.rawHeading=((h%360)+360)%360; S.lastCompass=performance.now(); S.headingSrc='compass';
  S.targetHeading=S.heading+norm180(S.rawHeading+S.headingOffset-S.heading);
  const now=performance.now();
  if(S.compassAcc!=null && (S.compassAcc<0 || S.compassAcc>30) && now-lastCalibTip>45000 && S.tab==='ar'){
    lastCalibTip=now; toast('The compass is unsure. Move your phone in a figure-8 a few times to calibrate it.',5000);
  }
}
// with no compass, face the way you are walking (GPS), or the way the route goes
function headingFallback(now){
  if(S.mode!=='live' || now-S.lastCompass<3000) return;
  if(S.gpsCourse!=null && now-S.gpsCourseT<6000){ S.headingSrc='gps'; S.targetHeading=S.heading+norm180(S.gpsCourse-S.heading); }
  else if(S.route && !S.arrived){ S.headingSrc='route'; S.targetHeading=S.heading+norm180(S.route.headingAt(S.along+3)-S.heading); }
  else S.headingSrc='none';
}
let wakeLock=null;
async function keepAwake(){ try{ if('wakeLock' in navigator && document.visibilityState==='visible' && !wakeLock){
  wakeLock=await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release',()=>{ wakeLock=null; }); } }catch(e){} }
document.addEventListener('visibilitychange',()=>{ if(S.mode==='live' && document.visibilityState==='visible'){ keepAwake(); startGps(); } });

function startSensors(){
  $('app').classList.add('nofix'); updateGpsPill();
  watchGpsPermission();
  startGps();
  if('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute',onOrientation,true);
  window.addEventListener('deviceorientation',e=>{ if(typeof e.webkitCompassHeading==='number' || e.absolute===true || !('ondeviceorientationabsolute' in window)) onOrientation(e); },true);
  window.addEventListener('devicemotion',e=>PED.onMotion(e),true);
  keepAwake();
}

/* =====================================================================
   MAIN LOOP
   ===================================================================== */
let last=performance.now();
function loop(now){
  const dt=Math.min(0.1,(now-last)/1000); last=now;
  if(S.spin) S.targetHeading+=12*dt;
  // simulated walk along the real route: brisk in AR so the arrows are easy to follow, faster on the map
  if(S.walking && S.route){
    S.along=Math.min(S.route.total, S.along+(S.tab==='ar'?4:14)*dt);
    S.pos=S.route.pointAt(S.along);
    S.targetHeading=S.heading+norm180(S.route.headingAt(S.along+2)-S.heading);
    MAPV.setMe(S.pos);
    updateProgress(true);
    if(S.route && S.along>=S.route.total){ S.walking=false; updateWalkBtn(); }
  }
  // live: glide the position forward at your walking speed between GPS fixes (about 5 times a second)
  if(S.mode==='live' && S.gotFix && TRACK.x!=null && now-(S.lastGlide||0)>200){
    S.lastGlide=now;
    const age=Math.min(2,(now-TRACK.t)/1000), still=S.hasMotion && now-S.lastStep>3000;
    if(!still && TRACK.speed()>0.3 && age>0.1){ const q=NAV.toLL(TRACK.x+TRACK.vx*age, TRACK.y+TRACK.vy*age); S.pos=q; onPosChange(); }
  }
  // smooth heading and tilt
  headingFallback(now);
  S.heading+=norm180(S.targetHeading-S.heading)*Math.min(1,dt*(S.mode==='live'?5:8));
  if(S.heading>=360||S.heading<0){ const w=Math.floor(S.heading/360)*360; S.heading-=w; S.targetHeading-=w; }
  if(S.mode==='demo'){ const c=camera(); S.pitch=deg(Math.atan((0.5-HORIZON)*c.H/c.f)); }
  else {
    S.pitch+=(S.targetPitch-S.pitch)*Math.min(1,dt*5);
    S.roll+=(S.targetRoll-S.roll)*Math.min(1,dt*6);
    // AR is built for an upright (portrait) phone
    $('rotateMsg').style.display = (S.tab==='ar' && innerWidth>innerHeight*1.15 && 'ontouchstart' in window) ? 'flex' : 'none';
  }
  const cone=document.getElementById('meCone'); if(cone) cone.style.transform=`rotate(${S.heading}deg)`;
  if(S.tab==='ar') renderAR(now);
  requestAnimationFrame(loop);
}

/* =====================================================================
   START
   ===================================================================== */
// iPhone only shows the compass / motion prompt when asked straight from a tap, so this runs first in tap handlers
function askMotion(){
  const asks=[];
  try{ if(typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function') asks.push(DeviceOrientationEvent.requestPermission().catch(()=>'denied')); }catch(e){}
  try{ if(typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function') asks.push(DeviceMotionEvent.requestPermission().catch(()=>'denied')); }catch(e){}
  // (desktop browsers without motion sensors also answer "denied", so only phones get the message)
  return Promise.all(asks).then(r=>{ if(r.includes('denied') && 'ontouchstart' in window) toast('Motion access was refused, so the compass will follow your walking direction instead.',5000); });
}
function setLiveUI(){
  S.mode='live'; $('modeTxt').textContent='LIVE'; $('modePill').classList.add('live');
  $('gpsBtn').classList.add('on'); $('gpsBtn').title='Recenter on my GPS location'; $('gpsBtn').setAttribute('aria-label','Recenter on my GPS location');
  $('arHelp').textContent='Pick a place (search or Places) and tap “View in AR”: arrows appear on the ground. Hold the phone upright.';
  $('alignBtn').style.display=''; $('spinToggle').style.display='none'; $('liveBtn').style.display='none'; $('simWalk').style.display='none';
  S.spin=false; S.walking=false; $('spinToggle').classList.remove('on'); updateWalkBtn();
  if(!isSecureContext) toast('Live AR needs a secure (https) link for GPS, compass and camera.',6000);
}
// from the demo straight into real AR: camera, GPS, compass. A route in progress is re-planned from your real position.
async function goLive(){
  if(S.mode==='live') return;
  askMotion();
  setLiveUI(); setVoice(true);
  S.gotFix=false; S.firstTry=0; TRACK.reset();
  if(S.tab==='ar') startCamera();
  const dest=S.dest||POIS.find(p=>p.id==='library');
  if(dest){ MAPV.clearRoute(); S.route=null; }
  startSensors();
  if(dest) startNav(dest);
  toast('Real AR is on. Hold the phone upright and follow the arrows on the ground.',4500);
}
$('liveBtn').onclick=goLive;
async function startLiveToLibrary(){
  const library=POIS.find(p=>p.id==='library');
  // Start the camera during this tap so mobile browsers can show their permission prompt.
  const startup=launch('live');
  switchTab('ar');
  await startup;
  if(library) startNav(library);
}
async function launch(mode){
  S.mode=mode;
  $('splash').style.display='none';
  $('modeTxt').textContent= mode==='live'?'LIVE':'DEMO';
  $('modePill').classList.toggle('live',mode==='live');
  $('arHelp').textContent = mode==='live' ? 'Hold your phone upright and turn slowly.' : 'Drag or use ← → keys to look around.';
  setVoice(mode==='live');
  if(mode==='live'){ askMotion(); setLiveUI(); startSensors(); }
  buildCompassTape();
  const slow=setTimeout(()=>toast('Loading the University campus map…',6000),500);
  await initMap(); clearTimeout(slow); $('toast').classList.remove('show');
  onPosChange();
  if(mode!=='live'){
    $('hint').style.display='block'; setTimeout(()=>$('hint').style.display='none',7000);
    S.spin=true; $('spinToggle').classList.add('on');
  }
  requestAnimationFrame(loop);
}
$('startDemo').onclick=()=>launch('demo');
$('startLive').onclick=startLiveToLibrary;
$('gpsBtn').onclick=()=>{
  if(S.mode==='demo'){ goLive(); return; }
  S.follow=true;
  if(S.gotFix && MAPV) MAPV.setView(S.view,17.5);
  else { startGps(); toast('Allow location in the browser prompt to start GPS.',4500); }
};
$('gpsPermissionBtn').onclick=()=>{
  const retryingBlocked=S.gpsErr===1;
  S.gpsErr=null; S.gpsBlocked=false; S.firstTry=0; lastWeakFix=null;
  if(weakGpsTimer!=null){ clearTimeout(weakGpsTimer); weakGpsTimer=null; }
  if(retryingBlocked && S.pendingNav){ $('navName').textContent='Waiting for your GPS position…'; $('navInfo').textContent='Requesting a fresh location fix for the route to '+S.pendingNav.name+'.'; }
  startGps(); updateGpsPill();
  toast('Requesting GPS. Allow location if your browser asks.',4500);
};
// Start screen: ask for location on its own, so the user can sort out the permission before starting AR
function locationHelp(){
  const ua=navigator.userAgent;
  if(/iPhone|iPad|iPod/.test(ua)) return 'On iPhone: Settings → Privacy & Security → Location Services → turn it on, then Safari Websites → While Using. In Safari, tap aA → Website Settings → Location → Allow. Then tap the button again.';
  if(/Android/.test(ua)) return 'On Android: turn on Location in the quick settings, then Settings → Apps → Chrome → Permissions → Location → Allow. In Chrome, tap the icon left of the address → Permissions → Location → Allow. Then tap the button again.';
  return 'Allow Location for this site in your browser settings (the icon left of the address bar), then tap the button again.';
}
function setSplashGps(state,msg){
  const b=$('splashGpsBtn'); if(!b) return;
  b.classList.toggle('ok',state==='ok'); b.classList.toggle('bad',state==='bad');
  b.textContent = state==='ok' ? '✅ Location allowed' : state==='bad' ? '📍 Location blocked · tap to try again' : state==='busy' ? '⏳ Asking for location…' : '📍 Allow location access';
  $('splashGpsMsg').textContent=msg||'';
}
$('splashGpsBtn').onclick=()=>{
  if(!('geolocation' in navigator)){ setSplashGps('bad','This browser has no location support.'); return; }
  if(!isSecureContext){ setSplashGps('bad','Location needs the secure https link. Open the GitHub Pages address.'); return; }
  setSplashGps('busy','Choose “Allow” when your browser asks.');
  navigator.geolocation.getCurrentPosition(
    p=>setSplashGps('ok',`Your position was found (±${Math.round(p.coords.accuracy)} m). Now tap Start AR.`),
    async e=>{
      if(e.code===1){
        let st=null; try{ st=(await navigator.permissions.query({name:'geolocation'})).state; }catch(_){}
        if(st==='prompt') setSplashGps('','The prompt was closed. Tap the button again and choose Allow.');
        else setSplashGps('bad','Location is blocked. '+locationHelp());
      } else setSplashGps('ok','Location is allowed, but there is no GPS signal yet. Go outside and tap Start AR.');
    },
    {enableHighAccuracy:true,maximumAge:0,timeout:15000});
};
// show the current permission straight away when the browser can tell
try{ navigator.permissions && navigator.permissions.query({name:'geolocation'}).then(st=>{
  const show=()=>{ if(st.state==='granted') setSplashGps('ok','Location is allowed. Tap Start AR.');
    else if(st.state==='denied') setSplashGps('bad','Location is blocked. '+locationHelp()); else setSplashGps('',''); };
  show(); st.addEventListener('change',show);
}).catch(()=>{}); }catch(e){}
$('arChooseBtn').onclick=()=>{
  switchTab('mapView');
  $('q').focus();
  toast('Search for a place, then tap “View in AR” to load its route arrows.',4500);
};
$('recenter').onclick=()=>{ S.follow=true; MAPV && MAPV.setView(S.view,17.5); };

// Presenter shortcuts, e.g. index.html?demo&tab=ar&nav=library
(async function(){
  const u=new URLSearchParams(location.search);
  if(u.has('demo')){
    await launch('demo');
    if(u.get('tab')) switchTab(u.get('tab'));
    const nav=POIS.find(p=>p.id===u.get('nav')); if(nav) startNav(nav);
    return;
  }
  if(u.has('live')){
    await launch('live');
    switchTab(u.get('tab')||'ar');
    const nav=POIS.find(p=>p.id===u.get('nav'))||POIS.find(p=>p.id==='library');
    if(nav) startNav(nav);
  }
})();
