/* =====================================================================
   PLACES LIST + SEARCH (17 highlights, plus every room on the University map)
   ===================================================================== */
function renderChips(){
  const all=[['all','All','📍'],...Object.entries(CATS).filter(([k,v])=>!v.hidden).map(([k,v])=>[k,v.label,v.icon])];
  $('chips').innerHTML=all.map(([k,l,i])=>`<button class="chip ${S.cat===k?'on':''}" data-cat="${k}">${i} ${l}</button>`).join('');
  $('chips').querySelectorAll('.chip').forEach(b=>b.onclick=()=>{S.cat=b.dataset.cat;renderChips();renderPlaces();});
}
function renderPlaces(){
  if(S.tab!=='places') return;
  const list=POIS.filter(p=>S.cat==='all'||p.cat===S.cat).map(p=>({p,d:dist(S.pos,p)})).sort((a,b)=>a.d-b.d);
  $('placeList').innerHTML=list.map(({p,d})=>{const c=CATS[p.cat];return `<button class="place" data-id="${p.id}">
    <div class="ic" style="background:${c.color}">${c.icon}</div><div><b>${p.name}</b><small>${c.label} · ${fmtD(d)} away</small></div>
    <div class="d">${fmtD(d)}</div></button>`}).join('');
  $('placeList').querySelectorAll('.place').forEach(b=>b.onclick=()=>openSheet(POIS.find(p=>p.id===b.dataset.id)));
}
let searchSeq=0, searchTimer=null, roomHits={};
$('q').addEventListener('input',()=>{
  const q=$('q').value.trim(), ql=q.toLowerCase(), box=$('searchResults'), seq=++searchSeq;
  clearTimeout(searchTimer);
  if(!q){box.style.display='none';return;}
  const hits=POIS.filter(p=>(p.name+' '+p.desc+' '+p.tags.join(' ')+' '+CATS[p.cat].label).toLowerCase().includes(ql));
  const local = hits.map(p=>`<button data-id="${p.id}"><span>${CATS[p.cat].icon}</span><span><b>${esc(p.name)}</b><br><small style="color:#64748b">${fmtD(dist(S.pos,p))} away</small></span></button>`).join('');
  const render=(rooms,status)=>{
    box.innerHTML = local + (rooms && rooms.length ? `<div class="sr-hd">Rooms and places inside buildings</div>`+rooms.map(r=>`<button data-room="${r.id}"><span>🚪</span><span><b>${esc(r.name)}</b><br><small style="color:#64748b">${esc([r.building, r.z!=null?'Floor '+r.z:'', r.kind].filter(Boolean).join(' · '))}</small></span></button>`).join('') : '')
      + (status ? `<div class="sr-st">${status}</div>` : '') + (!local && !(rooms&&rooms.length) && !status ? '<div class="sr-st">No matches. Try "library", "coffee", "toilet" or a room number.</div>' : '');
    box.style.display='block';
    box.querySelectorAll('button').forEach(b=>b.onclick=()=>{ box.style.display='none'; $('q').value=''; $('q').blur();
      const p = b.dataset.room ? roomHits[b.dataset.room] : POIS.find(x=>x.id===b.dataset.id);
      openSheet(p); if(S.tab==='mapView'){ MAPV.flyTo(p,18); if(p.z!=null) MAPV.setFloor(p.z); } });
  };
  render(null, q.length>=2 ? 'Searching the University map…' : '');
  if(q.length<2) return;
  searchTimer=setTimeout(async()=>{
    try{ const rooms=(await MM.search(q)).slice(0,8); if(seq!==searchSeq) return; rooms.forEach(r=>roomHits[r.id]=r); render(rooms,''); }
    catch(e){ if(seq===searchSeq) render(null, local ? '' : 'Room search needs the University map, which is not reachable here.'); }
  },300);
});

/* =====================================================================
   DETAIL SHEET
   ===================================================================== */
let sheetPoi=null;
function openSheet(p){
  sheetPoi=p; const c=CATS[p.cat], r=NAV.route(S.pos,p), d=r?r.total:dist(S.pos,p);
  $('sIc').style.background=c.color; $('sIc').textContent=c.icon;
  $('sName').textContent=p.name; $('sMeta').textContent=`${p.cat==='room'?(p.building||'Campus'):c.label} · about ${fmtD(d)} walk · ${fmtT(d)}`;
  $('sDesc').textContent= p.cat==='room' ? [p.kind, p.building, p.z!=null?'Floor '+p.z:''].filter(Boolean).join(' · ') : p.desc;
  const tags = p.cat==='room' ? ['Indoor', 'From the University map'] : p.tags;
  $('sTags').innerHTML=tags.map(t=>`<span>${esc(t)}</span>`).join('');
  $('stepsPanel').classList.remove('open');
  $('sheet').classList.add('open');
  if(p.cat==='room') showTempMarker(p);
}
const closeSheet=()=>$('sheet').classList.remove('open');
$('sheetClose').onclick=closeSheet;
$('sNav').onclick=()=>{ startNav(sheetPoi); closeSheet(); };
$('sAr').onclick=()=>{ startNav(sheetPoi); closeSheet(); switchTab('ar'); };

/* =====================================================================
   TURN-BY-TURN NAVIGATION
   ===================================================================== */
async function startNav(p){
  if(S.dest) document.getElementById('mk-'+S.dest.id)?.classList.remove('dest');
  S.dest=p; S.walking=false; S.spin=false; $('spinToggle').classList.remove('on'); updateWalkBtn();
  if(p.cat==='room') showTempMarker(p);
  document.getElementById('mk-'+p.id)?.classList.add('dest');
  $('navBanner').style.display='flex'; $('simWalk').style.display=S.mode==='demo'?'':'none';
  $('app').classList.add('navigating'); $('navBanner').classList.remove('arrived');
  $('nbIcon').textContent='⏳'; $('nbDist').textContent=''; $('navName').textContent='Finding the best route…'; $('navInfo').textContent=p.name;
  S.follow=true;
  // live: a route needs a real starting point, so wait for the first GPS fix
  if(S.mode==='live' && !S.gotFix){ S.pendingNav=p; $('navName').textContent='Waiting for your GPS position…'; $('navInfo').textContent='Route to '+p.name+' starts when GPS is found. Go outside if it takes long.'; return; }
  S.pendingNav=null;
  if(!await planRoute() || S.dest!==p) return;
  if(S.mode==='demo') S.targetHeading=S.heading+norm180(S.route.headingAt(4)-S.heading);   // face the way to go
  if(S.tab==='mapView') MAPV.fit(S.route.ll);
  speak(`Starting route to ${p.name}. ${spokenDist(S.route.total)}, about ${fmtT(S.route.total).replace(' walk','')}.`);
}
let routeToken=0;
// asks the University map for the official route; falls back to the built-in OpenStreetMap paths
async function planRoute(){
  const token=++routeToken, dest=S.dest; S.lastReroute=performance.now();
  const from={lat:S.pos.lat, lng:S.pos.lng};
  if(S.route && S.route.source==='mazemap'){ const f=S.route.floorAt(S.along); if(f.indoor) from.z=f.z; }
  let r=null;
  try{ r=await MM.route(from,dest); }catch(e){ console.warn('University route unavailable, using OpenStreetMap paths:',e.message||e); }
  if(token!==routeToken || S.dest!==dest) return false;
  if(!r){ r=NAV.route(S.pos,dest)||NAV.straight(S.pos,dest); r.source='osm'; }
  applyRoute(r);
  return true;
}
function applyRoute(r){
  S.route=r; S.along=0; S.off=0; S.spoken={}; S.stepIdx=-1; S.arrived=false; S.autoZ=null;
  MAPV.setDots(r.steps.filter(st=>st.type!=='arrive').map(st=>{ const q=r.pointAt(st.at), f=r.floorAt?r.floorAt(st.at+0.5):{z:0,indoor:false};
    return {lat:q.lat,lng:q.lng,z:f.z,indoor:f.indoor,text:NAV.ICON[st.type]+' '+sayStep(st)}; }));
  updateProgress(false);
  if($('stepsPanel').classList.contains('open')) renderSteps();
}
function stopNav(){
  if(S.dest) document.getElementById('mk-'+S.dest.id)?.classList.remove('dest');
  routeToken++; S.dest=null; S.route=null; S.pendingNav=null; S.walking=false; updateWalkBtn();
  MAPV.clearRoute(); showTempMarker(null); S.view=S.pos; MAPV.setMe(S.view);
  $('navBanner').style.display='none'; $('navHud').style.display='none'; $('stepsPanel').classList.remove('open');
  $('app').classList.remove('navigating'); $('navBanner').classList.remove('arrived');
  if('speechSynthesis' in window) speechSynthesis.cancel();
}
$('navStop').onclick=stopNav;
// the next thing to do: a lift or stair step stays up until you have actually reached it
function nextStepIndex(r){
  let k=r.steps.findIndex(s=>s.at > S.along + (s.type==='lift'||s.type==='stairs' ? -0.5 : 3));
  return k<0 ? r.steps.length-1 : k;
}

// work out where we are on the route, then update the map line, the banner and the voice
function updateProgress(fromSim){
  const r=S.route; if(!r) return;
  const gpsAcc=S.accuracy||10, offRouteLimit=Math.max(25,2*gpsAcc);
  if(!fromSim){
    const pr=NAV.progress(r,S.pos.lat,S.pos.lng,S.along);
    S.off=pr.off;
    // GPS jitter must not make you go "backwards" along the route
    S.along = (pr.along<S.along && S.along-pr.along<8) ? S.along : pr.along;
    if(S.mode==='live' && pr.off>offRouteLimit && gpsAcc<40 && performance.now()-S.lastReroute>8000 && !S.arrived){
      toast('Off route. Finding a new way…'); speak('Rerouting.'); planRoute(); return;
    }
  }
  // show you on the path when you are within GPS error of it (like car sat-navs), so the map and AR stay steady
  // Let the marker and AR lane meet when the measured GPS error covers the route,
  // while keeping the correction small enough to avoid snapping to a nearby path.
  const snapR = S.mode==='live' ? Math.max(10, Math.min(30, gpsAcc*0.75)) : Infinity;
  S.view = (fromSim || S.off<=snapR) ? r.pointAt(S.along) : S.pos;
  MAPV.drawRoute(routeParts(r,S.along));
  const fl = r.floorAt ? r.floorAt(S.along+0.5) : null;
  if(fl && fl.indoor && fl.z!==S.autoZ){ S.autoZ=fl.z; MAPV.setFloor(fl.z); }
  const k=nextStepIndex(r), st=r.steps[k], toStep=Math.max(0,st.at-S.along), remain=Math.max(0,r.total-S.along);
  // arrive by distance left along the route (indoor routes can pass close to the place's pin long before the end)
  const endDistance=dist(S.pos,r.pointAt(r.total));
  const arrivalRadius=S.mode==='live' ? Math.max(10,Math.min(20,gpsAcc*0.35)) : 10;
  const arrived = S.arrived || (remain<8 && (S.mode!=='live' || endDistance<=arrivalRadius)) || (remain<20 && endDistance<=arrivalRadius);
  $('navBanner').classList.toggle('arrived',arrived);
  if(arrived){
    $('nbIcon').textContent='🏁'; $('nbDist').textContent='';
    $('navName').textContent='You have arrived'; $('navInfo').textContent=S.dest.name;
  } else {
    $('nbIcon').textContent=NAV.ICON[st.type]; $('nbDist').textContent=fmtD(toStep);
    $('navName').textContent = toStep<10 ? sayStep(st)+(st.type==='lift'||st.type==='stairs'?'':' now') : 'In '+fmtD(toStep)+', '+lc1(sayStep(st));
    const confidentlyOffRoute=S.mode==='live' && gpsAcc<40 && S.off>offRouteLimit;
    $('navInfo').textContent = `${S.dest.name} · ${fmtD(remain)} · ${fmtT(remain)}` + (fl&&fl.indoor ? ` · you are on floor ${fl.z}` : '') + (confidentlyOffRoute ? ' · off the path' : '');
  }
  if(k!==S.stepIdx){ S.stepIdx=k; if($('stepsPanel').classList.contains('open')) renderSteps(); }
  // spoken prompts: once ahead of the turn, once at the turn
  if(!arrived && st.type!=='arrive'){
    if(toStep<=45 && toStep>18 && !S.spoken[k+'a']){ S.spoken[k+'a']=1; speak(`In ${spokenDist(toStep)}, ${lc1(sayStep(st))}.`); }
    if(toStep<=10 && !S.spoken[k+'b']){ S.spoken[k+'b']=1; speak(sayStep(st)+'.'); buzz([120,60,120]); }
  }
  if(arrived && !S.arrived){
    S.arrived=true; S.walking=false; updateWalkBtn();
    toast(`🎉 You have arrived at ${S.dest.name}`,4000); speak(`You have arrived at ${S.dest.name}.`); buzz([200,80,200,80,300]);
  }
  if(S.follow && S.tab==='mapView' && (S.mode==='live' || S.walking)) MAPV.panTo(S.view);
}
function renderSteps(){
  const r=S.route; if(!r) return;
  $('stepsSum').innerHTML=`${esc(S.dest.name)} · ${fmtD(r.total)} · ${fmtT(r.total)}<br>`+
    (r.source==='mazemap' ? '<span class="src mm">Route from the University campus map (MazeMap)</span>' : '<span class="src">Route from OpenStreetMap paths</span>');
  let items;
  if(r.official){
    // the University's own written directions, in full
    const cur = r.official.reduce((c,s,i)=>s.at<=S.along+3?i:c,0);
    items = r.official.map((s,i)=>{ const t=NAV.shortText(s.full);
      const ty = /you have reached/i.test(s.full)?'🏁' : i===0 ? '🧭' : NAV.ICON[typeOfText(t)];
      const next=r.official[i+1], leg=next?next.at-s.at:0;
      return {icon:ty, text:s.full, leg, cls: S.arrived||i<cur?'done':i===cur?'cur':''}; });
  } else {
    const list=[{type:'straight',text:`Head ${cardinalName(r.headingAt(2))}`,at:0},...r.steps];
    items = list.map((s,i)=>({icon:i===0?'⬆':NAV.ICON[s.type], text:i===0?s.text:sayStep(s), leg:i<list.length-1?list[i+1].at-s.at:0,
      cls: i===0 ? (S.along>5?'done':'') : (i-1<S.stepIdx?'done':i-1===S.stepIdx?'cur':'')}));
  }
  $('stepsList').innerHTML=items.map(it=>`<li class="${it.cls}"><span class="si">${it.icon}</span><span>${esc(it.text)}</span><span class="sd">${it.leg>1?'then '+fmtD(it.leg):''}</span></li>`).join('');
  $('stepsList').querySelector('li.cur')?.scrollIntoView({block:'nearest'});
}
function typeOfText(t){
  t=t.toLowerCase();
  if(/^take the (lift|elevator)/.test(t)) return 'lift';
  if(/^take the stair/.test(t)) return 'stairs';
  if(/slightly to the left|bear left/.test(t)) return 'slight-left';
  if(/slightly to the right|bear right/.test(t)) return 'slight-right';
  if(/turn left/.test(t)) return 'left';
  if(/turn right/.test(t)) return 'right';
  if(/^enter|^exit/.test(t)) return 'enter';
  return 'straight';
}
const cardinalName = h => ['north','north-east','east','south-east','south','south-west','west','north-west'][Math.round(h/45)%8];
const spokenDist = m => m<1000 ? (Math.round(m/5)*5||5)+' metres' : (m/1000).toFixed(1)+' kilometres';
$('stepsBtn').onclick=()=>{ closeSheet(); renderSteps(); $('stepsPanel').classList.toggle('open'); };
$('stepsClose').onclick=()=>$('stepsPanel').classList.remove('open');

function updateWalkBtn(){ $('simWalk').textContent=S.walking?'⏸ Pause':'▶ Simulate walk'; }
$('simWalk').onclick=async()=>{
  if(!S.route) return;
  if(S.arrived){ if(!await planRoute()) return; }          // walk it again from where you are
  S.walking=!S.walking; updateWalkBtn(); S.follow=true;
  if(S.walking){ S.spin=false; $('spinToggle').classList.remove('on'); }
};

// voice + vibration
function speak(text){
  if(!S.voice || !('speechSynthesis' in window)) return;
  try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang='en-GB'; speechSynthesis.speak(u); }catch(e){}
}
function buzz(p){ try{ navigator.vibrate && navigator.vibrate(p); }catch(e){} }
function setVoice(on){ S.voice=on; $('voiceBtn').textContent=on?'🔊 Voice':'🔇 Voice'; if(!on && 'speechSynthesis' in window) speechSynthesis.cancel(); }
$('voiceBtn').onclick=()=>{ setVoice(!S.voice); if(S.voice) speak('Voice directions on.'); };

/* =====================================================================
   TABS
   ===================================================================== */
function switchTab(t){
  S.tab=t;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===t));
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  if(t==='mapView') setTimeout(()=>{ MAPV.resize(); if(S.route && S.follow) MAPV.panTo(S.view); },50);
  if(t==='places'){ renderChips(); renderPlaces(); }
  if(t==='ar' && S.mode==='live' && !S.camOn) startCamera();
  closeSheet(); $('stepsPanel').classList.remove('open');
}
document.querySelectorAll('nav.tabs button').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
