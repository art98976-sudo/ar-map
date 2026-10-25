/* =====================================================================
   STATE
   ===================================================================== */
const S = {
  mode:'demo', pos:{...DEMO_START}, heading:20, targetHeading:20, pitch:4, targetPitch:4, gotFix:false,
  dest:null, cat:'all', tab:'mapView', camOn:false, spin:false, walking:false, accuracy:null,
  route:null, along:0, off:0, stepIdx:-1, voice:false, spoken:{}, lastReroute:0, follow:true, arrived:false, autoZ:null,
  // live tracking
  view:{...DEMO_START},            // position shown on the map and used by AR (snapped onto the route when close)
  rawAcc:null, gpsErr:null, gpsCourse:null, gpsCourseT:0, pendingNav:null,
  rawHeading:null, lastCompass:0, compassAcc:null, headingSrc:'none', headingOffset:0,
  roll:0, targetRoll:0, lensFov:65, hasMotion:false, lastStep:0, stepCount:0
};
// calibration the viewer chose earlier (compass correction, camera lens angle)
try{ const saved=JSON.parse(localStorage.getItem('stirlingAR')||'{}');
  if(typeof saved.off==='number') S.headingOffset=saved.off; if(typeof saved.lens==='number') S.lensFov=saved.lens; }catch(e){}
function saveCalib(){ try{ localStorage.setItem('stirlingAR',JSON.stringify({off:S.headingOffset,lens:S.lensFov})); }catch(e){} }
const $ = id => document.getElementById(id);
function toast(msg,ms=2600){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),ms); }
const lc1 = s => s.charAt(0).toLowerCase()+s.slice(1);
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function sayStep(st){ return st.type==='arrive' ? 'Arrive at '+S.dest.name : NAV.say(st); }
CATS.room = {label:'Room', color:'#475569', icon:'🚪', hidden:true};

/* =====================================================================
   UNIVERSITY CAMPUS MAP (MazeMap)
   The University of Stirling's campus map and wayfinder run on MazeMap
   (campus 2058). When it can be reached, this page uses its map with indoor
   floors, its walking routes (inside and between buildings) and its
   written directions. Otherwise it falls back to OpenStreetMap.
   ===================================================================== */
const MAZEMAP_CAMPUS = 2058, MAZEMAP_JS = 'https://api.mazemap.com/js/v2.2.6/';
// where each place's official route should end (an entrance, reception or the place itself)
const MM_TARGET = {
  cottrell:{poi:1002084982}, logie:{poi:1002292415}, amb:{poi:1002096717}, library:{poi:1002083724},
  atriumfood:{poi:1002096704}, union:{poi:1003110012}, pathfoot:{poi:1002068872}, iris:{poi:1002064286},
  macrobert:{poi:1002330440}, sport:{poi:1003110019}, tennis:{poi:1002084303}, castle:{poi:1002292463},
  andrewstewart:{poi:1002292376}
};
const MAZEMAP_READY = new Promise(res=>{
  const qs=new URLSearchParams(location.search);
  if(qs.has('osm') || !window.WebGLRenderingContext) return res(false);
  try{
    const css=document.createElement('link'); css.rel='stylesheet'; css.href=MAZEMAP_JS+'mazemap.min.css'; document.head.appendChild(css);
    const s=document.createElement('script'); s.src=MAZEMAP_JS+'mazemap.min.js'; s.async=true;
    s.onload=()=>res(!!(window.Mazemap && Mazemap.Map)); s.onerror=()=>res(false);
    document.head.appendChild(s);
  }catch(e){ res(false); }
  setTimeout(()=>res(false),20000);
});
const MM = {
  async get(url,ms=7000){
    const c=new AbortController(), t=setTimeout(()=>c.abort(),ms);
    try{ const r=await fetch(url,{signal:c.signal}); if(!r.ok) throw new Error('HTTP '+r.status); return await r.json(); }
    finally{ clearTimeout(t); }
  },
  params(from,to){
    const q=new URLSearchParams({srid:4326,hc:'false',sourcelat:from.lat,sourcelon:from.lng,lang:'en',distanceunitstype:'metric',mode:'PEDESTRIAN'});
    if(from.z!=null) q.set('sourcez',from.z);
    const t=to.mm||MM_TARGET[to.id]||{};
    if(t.poi) q.set('targetpoi',t.poi); else { q.set('targetlat',to.lat); q.set('targetlon',to.lng); }
    return q;
  },
  async route(from,to){
    const q=MM.params(from,to), base='https://routing.mazemap.com/routing/';
    const [p,d]=await Promise.all([MM.get(base+'path/?'+q), MM.get(base+'directions/?'+q).catch(()=>null)]);
    return NAV.fromMazeMap(p,d);
  },
  async search(text){
    const q=new URLSearchParams({q:text,rows:12,withpois:'true',withbuilding:'false',withtype:'true',campusid:MAZEMAP_CAMPUS});
    const j=await MM.get('https://search.mazemap.com/search/equery/?'+q,5000), strip=s=>String(s||'').replace(/<[^>]+>/g,'').trim();
    return (j.result||[]).filter(r=>r.poiId && r.point && strip(r.title) && !/^null$/i.test(strip(r.title)) && !(r.dispTypeNames||[]).some(t=>/hidden/i.test(t)))
      .map(r=>({id:'mm-'+r.poiId, name:strip(r.title), cat:'room', lat:r.point.coordinates[1], lng:r.point.coordinates[0], mm:{poi:r.poiId},
        z:r.zValue, building:(r.dispBldNames||[])[0]||'', kind:(r.dispTypeNames||[]).map(strip).join(', ')}));
  }
};

/* =====================================================================
   MAP VIEW
   One small interface, two engines: the University's MazeMap map (with indoor
   floors) or a Leaflet + OpenStreetMap map as a fallback.
   ===================================================================== */
let MAPV = null;
const markers = {};
const poiHtml = p => { const c=CATS[p.cat]; return `<div class="poi-marker" id="mk-${p.id}" style="background:${c.color}" title="${esc(p.name)}"><span>${c.icon}</span></div>`; };
const ME_HTML = '<div class="me-marker"><div class="me-cone" id="meCone"></div></div>';
// split the route at the current position into walked / still-to-walk pieces, grouped by floor
function routeParts(r, along){
  const meta=k=>({z: r.Z ? r.Z[Math.min(k,r.Z.length-1)] : 0, indoor: r.IN ? !!r.IN[Math.min(k,r.IN.length-1)] : false});
  let i=1; while(i<r.cum.length && r.cum[i]<=along) i++;
  const cur=r.pointAt(along), here=[cur.lat,cur.lng], LL=r.ll.map(p=>[p.lat,p.lng]);
  const runs=(pts,metas)=>{ const out=[]; for(let k=0;k<pts.length-1;k++){ const m=metas[k], last=out[out.length-1];
    if(last && last.z===m.z && last.indoor===m.indoor) last.ll.push(pts[k+1]); else out.push({z:m.z, indoor:m.indoor, ll:[pts[k],pts[k+1]]}); } return out; };
  const donePts=[...LL.slice(0,i),here], doneMeta=[]; for(let k=1;k<i;k++) doneMeta.push(meta(k)); doneMeta.push(meta(i));
  const aheadPts=[here,...LL.slice(i)], aheadMeta=[]; for(let k=i;k<LL.length;k++) aheadMeta.push(meta(k));
  return {done:runs(donePts,doneMeta), ahead:runs(aheadPts,aheadMeta)};
}

function LeafletView(onClick,onDrag){
  const map = L.map('map',{zoomControl:false, attributionControl:true}).setView(CAMPUS_CENTER,16);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'© OpenStreetMap contributors'}).addTo(map);
  // if online tiles are blocked or offline, draw the built-in campus map instead
  let tileOk=false, tileErr=0, basemapOn=false;
  const addBasemap=()=>{ if(basemapOn) return; basemapOn=true;
    const bm=NAV.basemap(); map.createPane('base').style.zIndex=250; $('map').style.background='#e9efe4';
    bm.water.forEach(p=>L.polygon(p,{pane:'base',stroke:false,fillColor:'#a9d3ee',fillOpacity:1,interactive:false}).addTo(map));
    bm.paths.forEach(w=>L.polyline(w.ll,{pane:'base',color:'#ffffff',weight:w.t===2?6:3,opacity:1,interactive:false}).addTo(map));
    bm.buildings.forEach(p=>L.polygon(p,{pane:'base',color:'#bdb5a8',weight:1,fillColor:'#dcd5ca',fillOpacity:1,interactive:false}).addTo(map)); };
  tiles.on('tileload',()=>tileOk=true);
  tiles.on('tileerror',()=>{ if(!tileOk && ++tileErr>=3) addBasemap(); });
  setTimeout(()=>{ if(!tileOk) addBasemap(); },6000);
  const casing=L.polyline([],{color:'#ffffff',weight:11,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
  const ahead=L.polyline([],{color:'#1a73e8',weight:7,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
  const done=L.polyline([],{color:'#64748b',weight:5,opacity:.8,dashArray:'1 9',lineCap:'round',interactive:false}).addTo(map);
  const dots=L.layerGroup().addTo(map);
  const me=L.marker([S.pos.lat,S.pos.lng],{zIndexOffset:1000,interactive:false,icon:L.divIcon({className:'',iconSize:[22,22],iconAnchor:[11,11],html:ME_HTML})}).addTo(map);
  const accC=L.circle([S.pos.lat,S.pos.lng],{radius:1,color:'#2563eb',weight:1,opacity:.5,fillColor:'#2563eb',fillOpacity:.12,interactive:false});
  map.on('click',e=>onClick({lat:e.latlng.lat,lng:e.latlng.lng}));
  map.on('dragstart',onDrag);
  return {
    kind:'osm',
    setView:(ll,z)=>map.setView([ll.lat,ll.lng],z), flyTo:(ll,z)=>map.flyTo([ll.lat,ll.lng],z), panTo:ll=>map.panTo([ll.lat,ll.lng],{animate:false}),
    fit:lls=>map.fitBounds(L.latLngBounds(lls.map(p=>[p.lat,p.lng])).pad(0.3)),
    resize:()=>map.invalidateSize(),
    addMarker:(p,html,click)=>{ const m=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',iconSize:[34,34],iconAnchor:[17,34],html}),title:p.name}).addTo(map).on('click',click); return {remove:()=>map.removeLayer(m)}; },
    setMe:ll=>me.setLatLng([ll.lat,ll.lng]),
    setAccuracy:(ll,m)=>{ if(!m){ if(map.hasLayer(accC)) map.removeLayer(accC); return; } accC.setLatLng([ll.lat,ll.lng]).setRadius(m); if(!map.hasLayer(accC)) accC.addTo(map); },
    drawRoute:parts=>{ const a=parts.ahead.map(x=>x.ll); casing.setLatLngs(a); ahead.setLatLngs(a); done.setLatLngs(parts.done.map(x=>x.ll)); },
    setDots:list=>{ dots.clearLayers(); list.forEach(d=>L.circleMarker([d.lat,d.lng],{radius:5,color:'#1a73e8',weight:3,fillColor:'#fff',fillOpacity:1}).bindTooltip(d.text).addTo(dots)); },
    clearRoute:()=>{ [casing,ahead,done].forEach(l=>l.setLatLngs([])); dots.clearLayers(); },
    setFloor:()=>{}
  };
}

function MazeMapView(onClick,onDrag){
  // the map adds its own floor bar (bottom left) once the campus has loaded
  const map = new Mazemap.Map({container:'map', campuses:MAZEMAP_CAMPUS, center:{lng:CAMPUS_CENTER[1],lat:CAMPUS_CENTER[0]}, zoom:15.6});
  map.dragRotate.disable(); map.touchZoomRotate.disableRotation();
  const empty={type:'FeatureCollection',features:[]};
  let loaded=false, pending={};
  const zNow=()=>{ try{ return map.getZLevel(); }catch(e){ return null; } };
  const opacity=()=>['case',['any',['!',['get','indoor']],['==',['get','z'],zNow()==null?-999:zNow()]],1,0.28];
  const set=(id,data)=>{ if(loaded) map.getSource(id).setData(data); else pending[id]=data; };
  map.on('load',()=>{
    ['acc','r-ahead','r-done','r-dots'].forEach(id=>map.addSource(id,{type:'geojson',data:pending[id]||empty}));
    map.addLayer({id:'acc',type:'fill',source:'acc',paint:{'fill-color':'#2563eb','fill-opacity':0.13,'fill-outline-color':'#2563eb'}});
    const lay={'line-cap':'round','line-join':'round'};
    map.addLayer({id:'r-done',type:'line',source:'r-done',layout:lay,paint:{'line-color':'#64748b','line-width':5,'line-dasharray':[0.1,1.8],'line-opacity':0.85}});
    map.addLayer({id:'r-case',type:'line',source:'r-ahead',layout:lay,paint:{'line-color':'#ffffff','line-width':11,'line-opacity':opacity()}});
    map.addLayer({id:'r-ahead',type:'line',source:'r-ahead',layout:lay,paint:{'line-color':'#1a73e8','line-width':7,'line-opacity':opacity()}});
    map.addLayer({id:'r-dots',type:'circle',source:'r-dots',paint:{'circle-radius':5,'circle-color':'#ffffff','circle-stroke-color':'#1a73e8','circle-stroke-width':3,'circle-opacity':opacity(),'circle-stroke-opacity':opacity()}});
    loaded=true; pending={};
  });
  // route pieces on other floors fade out; the floor bar switches what is shown
  map.on('zlevel',()=>{ if(!loaded) return; ['r-case','r-ahead'].forEach(id=>map.setPaintProperty(id,'line-opacity',opacity()));
    map.setPaintProperty('r-dots','circle-opacity',opacity()); map.setPaintProperty('r-dots','circle-stroke-opacity',opacity()); });
  map.on('click',e=>onClick({lat:e.lngLat.lat,lng:e.lngLat.lng}));
  map.on('dragstart',onDrag);
  const mk=(html,anchor)=>{ const el=document.createElement('div'); el.innerHTML=html; return new Mazemap.mapboxgl.Marker({element:el,anchor}); };
  const me=mk(ME_HTML,'center').setLngLat([S.pos.lng,S.pos.lat]).addTo(map);
  const feats=(runs)=>({type:'FeatureCollection',features:runs.map(x=>({type:'Feature',properties:{z:x.z,indoor:x.indoor},geometry:{type:'LineString',coordinates:x.ll.map(([la,ln])=>[ln,la])}}))});
  const pad=()=>({top:window.innerWidth>=900?90:220, bottom:110, left:50, right:window.innerWidth>=900?480:50});
  return {
    kind:'mazemap',
    setView:(ll,z)=>map.jumpTo({center:[ll.lng,ll.lat],zoom:z}), flyTo:(ll,z)=>map.flyTo({center:[ll.lng,ll.lat],zoom:z}),
    panTo:ll=>map.jumpTo({center:[ll.lng,ll.lat]}),
    fit:lls=>{ const xs=lls.map(p=>p.lng), ys=lls.map(p=>p.lat); map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],{padding:pad(),maxZoom:18.5,duration:600}); },
    resize:()=>map.resize(),
    addMarker:(p,html,click)=>{ const m=mk(`<div style="width:34px;height:34px">${html}</div>`,'bottom').setLngLat([p.lng,p.lat]).addTo(map);
      m.getElement().addEventListener('click',e=>{ e.stopPropagation(); click(); }); return {remove:()=>m.remove()}; },
    setMe:ll=>me.setLngLat([ll.lng,ll.lat]),
    setAccuracy:(ll,m)=>{ if(!m){ set('acc',empty); return; } const ring=[]; for(let i=0;i<=40;i++){ const a=i/40*2*Math.PI;
      ring.push([ll.lng+m*Math.sin(a)/(111320*Math.cos(ll.lat*Math.PI/180)), ll.lat+m*Math.cos(a)/110540]); }
      set('acc',{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}}]}); },
    drawRoute:parts=>{ set('r-ahead',feats(parts.ahead)); set('r-done',feats(parts.done)); },
    setDots:list=>set('r-dots',{type:'FeatureCollection',features:list.map(d=>({type:'Feature',properties:{z:d.z,indoor:d.indoor},geometry:{type:'Point',coordinates:[d.lng,d.lat]}}))}),
    clearRoute:()=>{ set('r-ahead',empty); set('r-done',empty); set('r-dots',empty); },
    setFloor:z=>{ try{ if(z!=null && map.getZLevel()!==z) map.setZLevel(z); }catch(e){} }
  };
}

async function initMap(){
  const onClick=ll=>{
    if(S.mode!=='demo') return;
    S.pos=ll; S.walking=false; updateWalkBtn();
    if(S.dest) planRoute(); onPosChange();
  };
  const onDrag=()=>{ if(S.route) S.follow=false; };
  if(!MAPV && await MAZEMAP_READY){ try{ MAPV=MazeMapView(onClick,onDrag); }catch(e){ console.warn('MazeMap map failed',e); MAPV=null; $('map').innerHTML=''; } }
  if(!MAPV) MAPV=LeafletView(onClick,onDrag);
  $('mapSrc').textContent = MAPV.kind==='mazemap' ? 'University campus map · MazeMap' : 'OpenStreetMap';
  POIS.forEach(p=>{ markers[p.id]=MAPV.addMarker(p,poiHtml(p),()=>openSheet(p)); });
}
let tempMarker=null;
function showTempMarker(p){
  if(tempMarker){ tempMarker.remove(); tempMarker=null; }
  if(p && p.cat==='room') tempMarker=MAPV.addMarker(p,poiHtml(p),()=>openSheet(p));
}
function onPosChange(){
  S.view=S.pos;
  if(S.route) updateProgress(false);       // may snap S.view onto the route
  if(MAPV){ MAPV.setMe(S.view); MAPV.setAccuracy(S.pos, S.mode==='live' && S.gotFix ? S.accuracy : 0);
    if(S.mode==='live' && !S.route && S.follow) MAPV.panTo(S.view); }
  renderPlaces();
}
