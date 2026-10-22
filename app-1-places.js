/* =====================================================================
   CAMPUS DATA
   Coordinates come from OpenStreetMap (Oct 2026). Verify with Estates /
   a GPS walk before any real deployment. Edit freely.
   ===================================================================== */
const CATS = {
  academic:{label:'Academic',  color:'#2563eb', icon:'🎓'},
  library: {label:'Library',   color:'#7c3aed', icon:'📚'},
  food:    {label:'Food & Drink', color:'#ea580c', icon:'☕'},
  sport:   {label:'Sport',     color:'#16a34a', icon:'🏃'},
  living:  {label:'Residences',color:'#0891b2', icon:'🏠'},
  landmark:{label:'Landmarks', color:'#b45309', icon:'🏰'},
  services:{label:'Services',  color:'#db2777', icon:'ℹ️'},
};

const POIS = [
  {id:'cottrell', name:'Cottrell Building', cat:'academic', lat:56.14465, lng:-3.92048,
   desc:'The main teaching building, with lecture theatres, seminar rooms and many academic departments.', tags:['Lecture theatres','Seminar rooms','Wi-Fi']},
  {id:'logie', name:'Logie Lecture Theatre', cat:'academic', lat:56.14396, lng:-3.92046,
   desc:'One of the largest lecture theatres on campus, just south of the Cottrell Building.', tags:['Lectures','Events']},
  {id:'amb', name:'Atrium / Andrew Miller Building', cat:'services', lat:56.14596, lng:-3.91970,
   desc:'The central hub of campus, with student services, cafés and shops under one roof.', tags:['Help desk','Shops','Meeting point']},
  {id:'library', name:'University Library', cat:'library', lat:56.14597, lng:-3.92068,
   desc:'Study spaces, group rooms, computers and print services. Ideal first stop for new students.', tags:['Quiet study','Group rooms','Printing']},
  {id:'atriumfood', name:'Atrium Food Court', cat:'food', lat:56.14614, lng:-3.91995,
   desc:'Cafés and food outlets in the heart of campus.', tags:['Coffee','Hot food','Seating']},
  {id:'union', name:'Students\' Union', cat:'services', lat:56.14596, lng:-3.91861,
   desc:'Clubs, societies, advice and events, run by students for students.', tags:['Societies','Advice','Events']},
  {id:'pathfoot', name:'Pathfoot Building', cat:'academic', lat:56.14927, lng:-3.92673,
   desc:'The campus\'s original 1960s building, admired for its modernist architecture and home to the University Art Collection.', tags:['Heritage','Art collection','Teaching']},
  {id:'iris', name:'Iris Murdoch Building', cat:'academic', lat:56.14396, lng:-3.91685,
   desc:'Home to the Dementia Services Development Centre, beside the Colin Bell Building.', tags:['Research','Health']},
  {id:'court', name:'Stirling Court Hotel', cat:'services', lat:56.14327, lng:-3.92210,
   desc:'On-campus hotel and conference venue, often used for events and visiting guests.', tags:['Hotel','Events','Dining']},
  {id:'macrobert', name:'Macrobert Arts Centre', cat:'landmark', lat:56.14564, lng:-3.91959,
   desc:'Cinema, theatre and gallery on campus, open to students and the public.', tags:['Cinema','Theatre','Café']},
  {id:'sport', name:'Gannochy Sports Centre', cat:'sport', lat:56.14570, lng:-3.92479,
   desc:'Gym, sports halls and the National Swimming Academy pool, at one of the UK\'s leading sports universities.', tags:['Gym','Pool','Sports hall']},
  {id:'tennis', name:'National Tennis Centre', cat:'sport', lat:56.14488, lng:-3.92489,
   desc:'Indoor and outdoor tennis courts next to the Gannochy Sports Centre.', tags:['Tennis','Coaching']},
  {id:'loch', name:'Airthrey Loch', cat:'landmark', lat:56.14655, lng:-3.91898,
   desc:'The loch at the heart of campus, with a popular walking loop and plenty of wildlife.', tags:['Walks','Wildlife','Photo spot']},
  {id:'castle', name:'Airthrey Castle', cat:'landmark', lat:56.14823, lng:-3.91338,
   desc:'A late-18th-century castle on the east of the estate, designed by Robert Adam.', tags:['Heritage','Architecture']},
  {id:'andrewstewart', name:'Andrew Stewart Hall', cat:'living', lat:56.14863, lng:-3.92286,
   desc:'Student hall on the north side of the loch, close to Pathfoot and the Library.', tags:['Accommodation','Laundry']},
  {id:'pendreich', name:'Pendreich Way Residences', cat:'living', lat:56.14988, lng:-3.92329,
   desc:'Modern student flats on the north side of campus.', tags:['Accommodation']},
  {id:'wallace', name:'National Wallace Monument', cat:'landmark', lat:56.13890, lng:-3.91780,
   desc:'Off-campus landmark on the Abbey Craig, a Victorian tower commemorating William Wallace. Visible from much of campus.', tags:['Off campus','Views','Heritage']},
];

const CAMPUS_CENTER = [56.1462, -3.9205];
const DEMO_START = {lat:56.14525, lng:-3.92010};   // main walkway between the Cottrell Building and the Atrium

/* =====================================================================
   GEO HELPERS
   ===================================================================== */
const R = 6371000, rad = d => d*Math.PI/180, deg = r => r*180/Math.PI;
function dist(a,b){
  const dLat=rad(b.lat-a.lat), dLng=rad(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function bearing(a,b){
  const y=Math.sin(rad(b.lng-a.lng))*Math.cos(rad(b.lat));
  const x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lng-a.lng));
  return (deg(Math.atan2(y,x))+360)%360;
}
const norm180 = a => ((a+540)%360)-180;
const fmtD = m => m<1000 ? Math.round(m)+' m' : (m/1000).toFixed(1)+' km';
const fmtT = m => Math.max(1,Math.round(m/1.33/60))+' min walk';
const CARD = ['N','NE','E','SE','S','SW','W','NW'];
const cardinal = h => CARD[Math.round(h/45)%8];
