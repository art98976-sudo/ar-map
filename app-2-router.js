/* =====================================================================
   WALKING ROUTER
   Uses the real campus footpaths, roads and steps from OpenStreetMap,
   built into this page (CAMPUS_OSM), so routes work with no server.
   ===================================================================== */
// the built-in OpenStreetMap data arrives in five small files (osm-1.js … osm-5.js)
const CAMPUS_OSM = {base:OSM.base, p:[].concat(OSM.p1,OSM.p2,OSM.p3), names:OSM.names, w:OSM.w, b:OSM.b, water:OSM.water};
const NAV = (function(){
  const D = CAMPUS_OSM, LAT0 = D.base[0], LNG0 = D.base[1];
  const KX = 111320*Math.cos(LAT0*Math.PI/180), KY = 110540;
  const toXY = (lat,lng) => [(lng-LNG0)*KX, (lat-LAT0)*KY];
  const toLL = (x,y) => ({lat:LAT0+y/KY, lng:LNG0+x/KX});
  const n = D.p.length/2, X = new Float64Array(n), Y = new Float64Array(n);
  for(let i=0;i<n;i++){ const q=toXY(LAT0+D.p[2*i]/1e6, LNG0+D.p[2*i+1]/1e6); X[i]=q[0]; Y[i]=q[1]; }
  const COST = [1, 1.25, 1.12];            // footpath, steps, road: prefer real footpaths a little
  const adj = Array.from({length:n}, () => []);
  const segs = [];                         // [a, b, wayIndex]
  D.w.forEach((w,wi) => {
    for(let k=3;k<w.length;k++){
      const a=w[k-1], b=w[k], c=Math.hypot(X[a]-X[b],Y[a]-Y[b])*COST[w[0]];
      adj[a].push([b,c,wi]); adj[b].push([a,c,wi]); segs.push([a,b,wi]);
    }
  });
  // coarse grid for fast nearest-path lookup
  const CELL = 60, grid = new Map(), key = (i,j) => i+','+j;
  segs.forEach((s,si) => {
    const x0=Math.min(X[s[0]],X[s[1]]), x1=Math.max(X[s[0]],X[s[1]]), y0=Math.min(Y[s[0]],Y[s[1]]), y1=Math.max(Y[s[0]],Y[s[1]]);
    for(let i=Math.floor(x0/CELL);i<=Math.floor(x1/CELL);i++) for(let j=Math.floor(y0/CELL);j<=Math.floor(y1/CELL);j++){
      const k=key(i,j); if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(si);
    }
  });
  function projSeg(px,py,ax,ay,bx,by){
    const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy; let t=L2?((px-ax)*dx+(py-ay)*dy)/L2:0; t=Math.max(0,Math.min(1,t));
    const qx=ax+t*dx, qy=ay+t*dy; return {t, x:qx, y:qy, d:Math.hypot(px-qx,py-qy)};
  }
  function snap(lat,lng){
    const [px,py]=toXY(lat,lng), ci=Math.floor(px/CELL), cj=Math.floor(py/CELL); let best=null;
    for(let r=0; r<=10 && (!best || best.d > (r-1)*CELL); r++){
      for(let i=ci-r;i<=ci+r;i++) for(let j=cj-r;j<=cj+r;j++){
        if(Math.max(Math.abs(i-ci),Math.abs(j-cj))!==r) continue;
        (grid.get(key(i,j))||[]).forEach(si => { const s=segs[si], q=projSeg(px,py,X[s[0]],Y[s[0]],X[s[1]],Y[s[1]]);
          if(!best || q.d<best.d) best={...q, seg:s}; });
      }
    }
    return best;
  }
  // every path segment within reach of a point, nearest first (one entry per segment)
  function candidates(lat,lng,radius,limit){
    const [px,py]=toXY(lat,lng), ci=Math.floor(px/CELL), cj=Math.floor(py/CELL), rr=Math.ceil(radius/CELL), seen=new Set(), out=[];
    for(let i=ci-rr;i<=ci+rr;i++) for(let j=cj-rr;j<=cj+rr;j++) (grid.get(key(i,j))||[]).forEach(si=>{
      if(seen.has(si)) return; seen.add(si);
      const s=segs[si], q=projSeg(px,py,X[s[0]],Y[s[0]],X[s[1]],Y[s[1]]);
      if(q.d<=radius) out.push({...q, seg:s});
    });
    out.sort((a,b)=>a.d-b.d);
    if(!out.length){ const b=snap(lat,lng); return b?[b]:[]; }
    return out.slice(0,limit);
  }
  // walking off the mapped paths (plazas, lawns, car parks) costs more, and long stretches much more
  const OFF = d => d*1.4 + Math.max(0,d-25)*2.5;
  // shortest walking route (Dijkstra with a binary heap) between two points
  function route(from, to){
    const sc=candidates(from.lat,from.lng,150,30), ec=candidates(to.lat,to.lng,150,30);
    if(!sc.length || !ec.length) return null;
    const nv=n+2+sc.length+ec.length, S=n, E=n+1;
    const VX=new Float64Array(nv), VY=new Float64Array(nv);
    const fxy=toXY(from.lat,from.lng), txy=toXY(to.lat,to.lng);
    VX[S]=fxy[0]; VY[S]=fxy[1]; VX[E]=txy[0]; VY[E]=txy[1];
    const dist=new Float64Array(nv).fill(Infinity), prev=new Int32Array(nv).fill(-1), pway=new Int32Array(nv).fill(-1);
    const extra = {};                      // temporary links for the start, the end and the points where they join a path
    const link=(u,v,c,wi)=>{ (extra[u]=extra[u]||[]).push([v,c,wi]); };
    const both=(u,v,c,wi)=>{ link(u,v,c,wi); link(v,u,c,wi); };
    const joinPath=(q,id)=>{ const [a,b,wi]=q.seg, c=COST[D.w[wi][0]]; VX[id]=q.x; VY[id]=q.y;
      both(id,a,Math.hypot(q.x-X[a],q.y-Y[a])*c,wi); both(id,b,Math.hypot(q.x-X[b],q.y-Y[b])*c,wi); };
    sc.forEach((q,k)=>{ const id=n+2+k; joinPath(q,id); link(S,id,OFF(q.d),-1); });
    ec.forEach((q,k)=>{ const id=n+2+sc.length+k; joinPath(q,id); link(id,E,OFF(q.d),-1);
      sc.forEach((p,j)=>{ if(p.seg===q.seg) link(n+2+j,id,Math.hypot(p.x-q.x,p.y-q.y)*COST[D.w[q.seg[2]][0]],q.seg[2]); }); });
    const direct=Math.hypot(fxy[0]-txy[0],fxy[1]-txy[1]);
    if(direct<=80) link(S,E,OFF(direct),-1);   // short hop straight across, if nothing better exists
    const PX=i=>i<n?X[i]:VX[i], PY=i=>i<n?Y[i]:VY[i];
    const heap=[];
    const push=(d,v)=>{ heap.push([d,v]); let i=heap.length-1; while(i>0){ const p=(i-1)>>1; if(heap[p][0]<=heap[i][0]) break; [heap[p],heap[i]]=[heap[i],heap[p]]; i=p; } };
    const pop=()=>{ const top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; let i=0; for(;;){ const l=2*i+1, r=l+1; let m=i;
      if(l<heap.length&&heap[l][0]<heap[m][0]) m=l; if(r<heap.length&&heap[r][0]<heap[m][0]) m=r; if(m===i) break; [heap[m],heap[i]]=[heap[i],heap[m]]; i=m; } } return top; };
    dist[S]=0; push(0,S);
    while(heap.length){
      const [d,u]=pop(); if(d>dist[u]) continue; if(u===E) break;
      const nb = u<n ? (extra[u] ? adj[u].concat(extra[u]) : adj[u]) : (extra[u]||[]);
      for(const [v,c,wi] of nb){ const nd=d+c; if(nd<dist[v]){ dist[v]=nd; prev[v]=u; pway[v]=wi; push(nd,v); } }
    }
    if(!isFinite(dist[E])) return null;
    const xy=[], wayOf=[]; let v=E;
    while(v!==-1){ xy.push([PX(v),PY(v)]); wayOf.push(pway[v]); v=prev[v]; }
    xy.reverse(); wayOf.reverse();         // wayOf[i] = path used to reach point i
    return buildRoute(xy, wayOf);
  }
  const brg=(a,b)=>(Math.atan2(b[0]-a[0],b[1]-a[1])*180/Math.PI+360)%360;
  const n180=a=>((a+540)%360)-180;
  // meta (optional, MazeMap routes): per point floor z, whether that stretch is indoors, and flags such as ELEVATOR / STAIR
  function buildRoute(xy, wayOf, meta){
    const P=[], Wn=[], Z=[], IN=[], FL=[];
    xy.forEach((p,i)=>{
      const keep = !P.length || Math.hypot(p[0]-P[P.length-1][0],p[1]-P[P.length-1][1])>0.3;
      const z = meta?meta.z[i]:null, ind = meta?meta.ind[i]:false, fl = meta?meta.flags[i]:[];
      if(keep){ P.push(p); Wn.push(wayOf[i]); Z.push(z); IN.push(ind); FL.push(fl); }
      else { Z[Z.length-1]=z; IN[IN.length-1]=ind; FL[FL.length-1]=FL[FL.length-1].concat(fl); }   // a lift or stair hop barely moves on the ground
    });
    const cum=[0]; for(let i=1;i<P.length;i++) cum.push(cum[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
    const total=cum[cum.length-1];
    const pointAt=dd=>{ dd=Math.max(0,Math.min(total,dd)); let i=1; while(i<cum.length-1&&cum[i]<dd) i++;
      const f=(dd-cum[i-1])/((cum[i]-cum[i-1])||1); return [P[i-1][0]+(P[i][0]-P[i-1][0])*f, P[i-1][1]+(P[i][1]-P[i-1][1])*f]; };
    const wayName=wi=>wi>=0?D.names[D.w[wi][1]]:'', wayType=wi=>wi>=0?D.w[wi][0]:-1;
    // a turn is measured over ~8 m either side of a bend, so tiny kinks in the data are ignored
    const steps=[]; let lastAt=-1e9;
    for(let i=1;i<P.length-1;i++){
      const inB=brg(pointAt(cum[i]-8),P[i]), outB=brg(P[i],pointAt(cum[i]+8)), t=n180(outB-inB);
      const intoSteps = wayType(Wn[i+1])===1 && wayType(Wn[i])!==1;
      if((Math.abs(t)<30 && !intoSteps) || cum[i]-lastAt<12 || total-cum[i]<8) continue;
      const type = Math.abs(t)>=150?'uturn': Math.abs(t)>=55?(t<0?'left':'right'): Math.abs(t)>=30?(t<0?'slight-left':'slight-right'):'straight';
      steps.push({at:cum[i], type, turn:t, name:wayName(Wn[i+1]), steps:intoSteps});
      lastAt=cum[i];
    }
    // floor changes and building entrances (used when no official directions are available)
    if(meta){
      for(let i=1;i<P.length;i++){
        if(Z[i]!==Z[i-1] && IN[i] && IN[i-1]){
          let j=i; while(j+1<P.length && Z[j+1]!==Z[j] && cum[j+1]-cum[i]<3) j++;
          const lift=FL.slice(i,j+1).some(f=>f.includes('ELEVATOR')), up=Z[j]>Z[i-1];
          steps.push({at:cum[i-1], type:lift?'lift':'stairs', text:`Take the ${lift?'lift':'stairs'} ${up?'up':'down'} to floor ${Z[j]}`});
          i=j;
        } else if(IN[i]!==IN[i-1] && cum[i]>5 && total-cum[i]>5){
          steps.push({at:cum[i], type:'enter', text:IN[i]?'Go in through the entrance':'Go out of the building'});
        }
      }
      steps.sort((a,b)=>a.at-b.at);
    }
    steps.push({at:total, type:'arrive', turn:0, name:''});
    const segAt = dd => { let i=1; while(i<cum.length-1 && cum[i]<dd) i++; return i; };
    return {P, cum, total, steps, Z, IN, ll:P.map(p=>toLL(p[0],p[1])),
      floorAt: dd => { const i=segAt(dd); return {z:Z[i], indoor:!!IN[i]}; },
      pointXY:pointAt, pointAt:dd=>{ const q=pointAt(dd); return toLL(q[0],q[1]); },
      headingAt:dd=>brg(pointAt(dd-3),pointAt(dd+6))};
  }
  // how far along the route a position is; searches near the last known progress so loops do not confuse it
  function progress(r, lat, lng, hint){
    const [px,py]=toXY(lat,lng); let best=null;
    for(let i=1;i<r.P.length;i++){
      if(hint!=null && (r.cum[i]<hint-60 || r.cum[i-1]>hint+150)) continue;
      const q=projSeg(px,py,r.P[i-1][0],r.P[i-1][1],r.P[i][0],r.P[i][1]);
      if(!best||q.d<best.off) best={off:q.d, along:r.cum[i-1]+q.t*(r.cum[i]-r.cum[i-1])};
    }
    return best || (hint!=null ? progress(r,lat,lng,null) : {off:Infinity, along:0});
  }
  const ICON={left:'↰',right:'↱','slight-left':'↖','slight-right':'↗',uturn:'↶',straight:'↑',arrive:'🏁',lift:'🛗',stairs:'🪜',enter:'🚪'};
  function say(step){
    if(step.text) return step.text;
    if(step.type==='arrive') return 'Arrive at your destination';
    const v={left:'Turn left',right:'Turn right','slight-left':'Bear left','slight-right':'Bear right',uturn:'Turn around',straight:'Continue straight'}[step.type];
    if(step.steps) return step.type==='straight' ? 'Take the steps' : v+' and take the steps';
    return v + (step.name ? ' onto '+step.name : '');
  }
  const poly = arr => arr.map(i=>{ const q=toLL(X[i],Y[i]); return [q.lat,q.lng]; });
  const straight = (a,b) => buildRoute([toXY(a.lat,a.lng),toXY(b.lat,b.lng)],[-1,-1]);

  /* ---------- Official University routes from MazeMap ----------
     path: the routing/path answer (line pieces with floor z, building and flags)
     dirs: the routing/directions answer (official written steps with their stretch of path), or null */
  const tidy = s => String(s||'').replace(/\s+/g,' ').replace(/\s+([.,])/g,'$1').trim();
  function shortText(full){
    let t=tidy(full).split(/ and then /i)[0];
    t=t.replace(/ and walk forward \d+ (meters?|metres?)/gi,'').replace(/ and walk \d+ (meters?|metres?)/gi,'');
    t=t.replace(/^Walk forward \d+ (meters?|metres?)/i,'Walk straight on');
    t=t.replace(/^Entering (the )?(.+?) building,? (turn|walk|go)/i,(m,a,b,c)=>`Enter the ${/building$/i.test(b)?b:b+' building'}, then ${c.toLowerCase()}`);
    t=t.replace(/^Entering (the )?(.+?) building\.?$/i,(m,a,b)=>`Enter the ${/building$/i.test(b)?b:b+' building'}`);
    t=t.replace(/\.$/,'').replace(/\ban elevator\b/gi,'a lift').replace(/\belevator\b/gi,'lift');
    return t.charAt(0).toUpperCase()+t.slice(1);
  }
  function typeOf(text){
    const t=text.toLowerCase();
    if(/^take the (lift|elevator)/.test(t)) return 'lift';
    if(/^take the stair/.test(t)) return 'stairs';
    const turn = /slightly to the left|bear left/.test(t)?'slight-left': /slightly to the right|bear right/.test(t)?'slight-right':
      /turn around|u-turn/.test(t)?'uturn': /turn left/.test(t)?'left': /turn right/.test(t)?'right': null;
    if(/^enter|^exit the building|^leave the building/.test(t)) return turn||'enter';
    return turn||'straight';
  }
  function fromMazeMap(path, dirs){
    const feats=(path&&path.path&&path.path.features)||[];
    if(!feats.length) return null;
    const xy=[], meta={z:[],ind:[],flags:[]};
    feats.forEach(f=>{
      const pr=f.properties||{}, cs=f.geometry&&f.geometry.type==='LineString'?f.geometry.coordinates:[];
      cs.forEach((c,k)=>{ if(k===0 && xy.length) return;
        xy.push(toXY(c[1],c[0])); meta.z.push(pr.z==null?0:pr.z); meta.ind.push(pr.buildingId!=null); meta.flags.push(pr.flags||[]); });
    });
    if(xy.length<2) return null;
    const official = dirs && dirs.routes && dirs.routes[0] && dirs.routes[0].legs && dirs.routes[0].legs[0] ? dirs.routes[0].legs[0].steps : null;
    const f=buildRoute(xy, xy.map(()=>-1), meta);      // with floor changes and building entrances
    f.source='mazemap';
    if(!official) return f;
    const r=buildRoute(xy, xy.map(()=>-1), null);      // bends only; official wording is added below
    r.Z=f.Z; r.IN=f.IN; r.floorAt=f.floorAt; r.source='mazemap';
    // place each official step on the route
    let from=0; const list=[];
    official.forEach((s,idx)=>{
      const full=tidy(s.instruction);
      if(!s.geometry || !s.geometry.coordinates || !s.geometry.coordinates.length){
        list.push({at: idx===0?0:r.total, full, first: idx===0}); return;
      }
      const c=s.geometry.coordinates[0], q=toXY(c[1],c[0]); let best=null;
      for(let i=1;i<r.P.length;i++){
        if(r.cum[i]<from-1) continue;
        const pj=projSeg(q[0],q[1],r.P[i-1][0],r.P[i-1][1],r.P[i][0],r.P[i][1]);
        const at=r.cum[i-1]+pj.t*(r.cum[i]-r.cum[i-1]);
        if(!best || pj.d<best.d-0.5) best={d:pj.d, at};
        if(pj.d<1.5) break;
      }
      const at=Math.max(best?best.at:from, from+0.01); from=at;     // official steps never go backwards
      list.push({at, full});
    });
    r.official=list;
    // manoeuvres = official steps (short form) + any extra sharp bends the official wording folds into one step
    const offM=list.filter(s=>s.at>2 && s.at<r.total-2 && !/^walk forward/i.test(s.full)).map(s=>{ const text=shortText(s.full); return {at:s.at, type:typeOf(text), text, official:true}; });
    const geo=r.steps.filter(s=>s.type!=='arrive' && !offM.some(o=>Math.abs(o.at-s.at)<8));
    // building exits / entrances and floor changes the written directions do not mention
    const floors=f.steps.filter(s=>['enter','lift','stairs'].includes(s.type) && !offM.some(o=>Math.abs(o.at-s.at)<8));
    const geo2=geo.filter(s=>!floors.some(o=>Math.abs(o.at-s.at)<5));
    const arrive=list.find(s=>/you have reached/i.test(s.full));
    r.steps=[...offM,...floors,...geo2].sort((a,b)=>a.at-b.at);
    r.steps.push({at:r.total, type:'arrive', turn:0, name:'', official:true, full: arrive?arrive.full:''});
    return r;
  }
  return {route, straight, fromMazeMap, shortText, progress, say, ICON, toXY, toLL,
    basemap:()=>({buildings:D.b.map(poly), water:D.water.map(poly), paths:D.w.map(w=>({t:w[0], ll:poly(w.slice(2))}))})};
})();
