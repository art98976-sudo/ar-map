#!/usr/bin/env node
/**
 * Generates the SAMPLE campus dataset in public/data/.
 *
 * Every position here is APPROXIMATE and hand-placed for development only.
 * It is not official University of Stirling or MazeMap data, and must never
 * be used for real navigation. Edit the tables below, then run:
 *
 *   npm run data:generate
 *
 * Paths are defined as edges between named nodes, so connected paths always
 * share exact coordinates (the routing graph in Step 2 relies on this).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

const NOTICE =
  'SAMPLE DATA: approximate, hand-placed positions for development only. ' +
  'Not official University of Stirling or MazeMap data. Do not use for real navigation.';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
/** [lat, lng] -> GeoJSON [lng, lat], rounded to ~1 cm. */
const pos = ([lat, lng]) => [round(lng), round(lat)];
const round = (n) => Math.round(n * 1e7) / 1e7;

/** Axis-aligned rectangle from south/north latitude and west/east longitude. */
function rect(south, north, west, east) {
  return [[
    pos([south, west]), pos([south, east]), pos([north, east]), pos([north, west]), pos([south, west]),
  ]];
}

/** Rectangle around a centre, half-sizes given in degrees. */
const box = ([lat, lng], dLat, dLng) => rect(lat - dLat, lat + dLat, lng - dLng, lng + dLng);

/** Ellipse polygon (used for the loch). */
function ellipse([lat, lng], dLat, dLng, n = 32, wobble = 0) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + wobble * Math.sin(a * 3);
    ring.push(pos([lat + Math.sin(a) * dLat * w, lng + Math.cos(a) * dLng * w]));
  }
  ring.push(ring[0]);
  return [ring];
}

const feature = (geometry, properties) => ({ type: 'Feature', properties, geometry });
const collection = (features) => ({ type: 'FeatureCollection', _meta: { sample: true, notice: NOTICE }, features });

// ---------------------------------------------------------------------------
// Buildings (approximate footprints)
// ---------------------------------------------------------------------------
const BUILDINGS = [
  {
    id: 'cottrell', name: 'Cottrell Building', shortName: 'Cottrell',
    categories: ['teaching'], hasIndoorData: true,
    description: 'Main teaching building with lecture theatres and seminar rooms. Pilot building for indoor maps.',
    footprint: rect(56.1444, 56.1449, -3.9211, -3.9199),
  },
  {
    id: 'library', name: 'Library', categories: ['study'], hasIndoorData: false,
    description: 'Quiet study, group rooms, computers and printing.',
    footprint: box([56.14605, -3.92068], 0.00018, 0.0004),
  },
  {
    id: 'campus-central', name: 'Campus Central', categories: ['food', 'study'], hasIndoorData: false,
    description: 'The central hub with student services, cafés and shops.',
    footprint: box([56.14605, -3.9197], 0.00018, 0.00035),
  },
  {
    id: 'students-union', name: "Students' Union", shortName: 'Union', categories: ['food'], hasIndoorData: false,
    description: 'Clubs, societies, advice and events.',
    footprint: box([56.14605, -3.91862], 0.00018, 0.00035),
  },
  {
    id: 'into', name: 'INTO Building', shortName: 'INTO', categories: ['teaching'], hasIndoorData: false,
    description: 'International study centre. Position is a rough placeholder and needs checking.',
    footprint: box([56.14385, -3.9218], 0.00015, 0.0003),
  },
  {
    id: 'pathfoot', name: 'Pathfoot Building', shortName: 'Pathfoot', categories: ['teaching'], hasIndoorData: false,
    description: 'The original 1960s campus building, home to the University Art Collection.',
    footprint: box([56.14935, -3.9265], 0.00025, 0.0009),
  },
  {
    id: 'sports-centre', name: 'Sports Centre', categories: ['sports'], hasIndoorData: false,
    description: 'Gym, sports halls and swimming pool.',
    footprint: box([56.1459, -3.9249], 0.0002, 0.0006),
  },
  {
    id: 'airthrey-castle', name: 'Airthrey Castle', shortName: 'Castle', categories: [], hasIndoorData: false,
    description: 'Late-18th-century castle on the east of the estate.',
    footprint: box([56.14825, -3.9134], 0.00012, 0.00025),
  },
  {
    id: 'accommodation-village', name: 'Accommodation Village', categories: ['accommodation'], hasIndoorData: false,
    description: 'Student residences. Position is a rough placeholder and needs checking.',
    footprint: box([56.14995, -3.9232], 0.0002, 0.0005),
  },
];

// ---------------------------------------------------------------------------
// Outdoor walking network: named nodes + edges
// ---------------------------------------------------------------------------
const N = {
  lib_e: [56.14582, -3.92068], // Library entrance
  cc_e: [56.14582, -3.9197], // Campus Central entrance
  su_e: [56.14584, -3.91862], // Students' Union entrance
  sp_w: [56.1456, -3.9218], // main walkway, west end
  sp_lib: [56.1456, -3.92068],
  sp_cc: [56.1456, -3.9197],
  sp_su: [56.1456, -3.91862],
  sp_e: [56.1456, -3.917],
  st_bot: [56.14508, -3.92048], // bottom of the Library steps
  ct_n: [56.14491, -3.92048], // Cottrell north entrance
  rp_mid: [56.14515, -3.91975], // middle of the step-free ramp
  ct_e: [56.14465, -3.91989], // Cottrell east entrance
  ct_s: [56.14439, -3.92048], // Cottrell main (south) entrance
  s_jn: [56.1442, -3.92048],
  bus_c: [56.14418, -3.91975], // Cottrell bus stop
  cp_c: [56.14385, -3.9196], // Cottrell car park
  into_e: [56.14401, -3.9217], // INTO entrance
  sport_jn: [56.1456, -3.9238],
  sport_e: [56.14565, -3.9244], // Sports Centre entrance
  cp_s: [56.14522, -3.9252], // Sports Centre car park
  pf_mid: [56.1476, -3.9252],
  pf_e: [56.14905, -3.9264], // Pathfoot entrance
  bus_pf: [56.14885, -3.9274], // Pathfoot bus stop
  cp_pf: [56.1488, -3.9256], // Pathfoot car park
  acc_jn: [56.149, -3.924],
  acc_e: [56.14965, -3.92335], // Accommodation Village entrance
  ln_w: [56.148, -3.9225], // loch north path, west
  ln_e: [56.148, -3.915], // loch north path, east
  le_s: [56.14615, -3.9147],
  le_n: [56.147, -3.9142],
  cas_e: [56.14805, -3.91365], // Airthrey Castle entrance
};

/** [from, to, kind, name?]. kind: footpath | steps | ramp. Only "steps" is not step-free. */
const EDGES = [
  ['lib_e', 'sp_lib', 'footpath'],
  ['cc_e', 'sp_cc', 'footpath'],
  ['su_e', 'sp_su', 'footpath'],
  ['sp_w', 'sp_lib', 'footpath', 'Main walkway'],
  ['sp_lib', 'sp_cc', 'footpath', 'Main walkway'],
  ['sp_cc', 'sp_su', 'footpath', 'Main walkway'],
  ['sp_su', 'sp_e', 'footpath', 'Main walkway'],
  ['sp_lib', 'st_bot', 'steps', 'Library steps'],
  ['st_bot', 'ct_n', 'footpath'],
  ['sp_cc', 'rp_mid', 'ramp', 'Cottrell ramp'],
  ['rp_mid', 'ct_e', 'footpath'],
  ['ct_e', 'bus_c', 'footpath'],
  ['ct_s', 's_jn', 'footpath'],
  ['s_jn', 'bus_c', 'footpath'],
  ['bus_c', 'cp_c', 'footpath'],
  ['s_jn', 'into_e', 'footpath'],
  ['into_e', 'sp_w', 'footpath'],
  ['sp_w', 'sport_jn', 'footpath'],
  ['sport_jn', 'sport_e', 'footpath'],
  ['sport_e', 'cp_s', 'footpath'],
  ['sport_jn', 'pf_mid', 'footpath'],
  ['pf_mid', 'pf_e', 'footpath'],
  ['pf_e', 'bus_pf', 'footpath'],
  ['pf_e', 'cp_pf', 'footpath'],
  ['pf_mid', 'acc_jn', 'footpath'],
  ['acc_jn', 'acc_e', 'footpath'],
  ['acc_jn', 'ln_w', 'footpath', 'Loch north path'],
  ['ln_w', 'ln_e', 'footpath', 'Loch north path'],
  ['ln_e', 'le_n', 'footpath'],
  ['le_n', 'cas_e', 'footpath'],
  ['sp_e', 'le_s', 'footpath'],
  ['le_s', 'le_n', 'footpath'],
];

// ---------------------------------------------------------------------------
// Entrances (all on the ground, level 0)
// ---------------------------------------------------------------------------
const ENTRANCES = [
  ['cottrell-north', 'cottrell', 'Cottrell north entrance', 'ct_n', true],
  ['cottrell-east', 'cottrell', 'Cottrell east entrance', 'ct_e', true],
  ['cottrell-main', 'cottrell', 'Cottrell main entrance', 'ct_s', true],
  ['library-main', 'library', 'Library entrance', 'lib_e', true],
  ['campus-central-main', 'campus-central', 'Campus Central entrance', 'cc_e', true],
  ['students-union-main', 'students-union', "Students' Union entrance", 'su_e', true],
  ['into-main', 'into', 'INTO Building entrance', 'into_e', true],
  ['sports-centre-main', 'sports-centre', 'Sports Centre entrance', 'sport_e', true],
  ['pathfoot-main', 'pathfoot', 'Pathfoot entrance', 'pf_e', true],
  ['accommodation-village-main', 'accommodation-village', 'Accommodation Village entrance', 'acc_e', true],
  ['airthrey-castle-main', 'airthrey-castle', 'Airthrey Castle entrance', 'cas_e', false],
];

// ---------------------------------------------------------------------------
// Outdoor places (points)
// ---------------------------------------------------------------------------
/** [id, name, kind, categories, [lat,lng], buildingId|null, description, aliases] */
const PLACES = [
  ['campus-central-cafe', 'Campus Central café', 'cafe', ['food'], [56.14612, -3.91965], 'campus-central', 'Coffee, snacks and hot food.', ['coffee']],
  ['library-cafe', 'Library café', 'cafe', ['food'], [56.14598, -3.9204], 'library', 'Coffee and snacks by the Library entrance.', ['coffee']],
  ['union-cafe', "Students' Union café bar", 'cafe', ['food'], [56.1461, -3.9186], 'students-union', 'Food and drink in the Union.', ['bar', 'coffee']],
  ['library-study', 'Library study spaces', 'study-space', ['study'], [56.14615, -3.92085], 'library', 'Quiet and group study across the Library.', ['quiet study', 'group room']],
  ['campus-central-study', 'Campus Central study space', 'study-space', ['study'], [56.146, -3.9199], 'campus-central', 'Drop-in study tables.', []],
  ['sports-pool', 'Swimming pool', 'sports', ['sports'], [56.14598, -3.9252], 'sports-centre', 'Pool inside the Sports Centre.', ['swim']],
  ['sports-pitches', 'Sports pitches', 'sports', ['sports'], [56.1448, -3.926], null, 'Outdoor grass and synthetic pitches.', ['football', 'rugby']],
  ['bus-cottrell', 'Cottrell bus stop', 'bus-stop', ['transport'], [56.14418, -3.91975], null, 'Buses to Stirling city centre and the railway station.', ['bus']],
  ['bus-pathfoot', 'Pathfoot bus stop', 'bus-stop', ['transport'], [56.14885, -3.9274], null, 'Buses on the west side of campus.', ['bus']],
  ['car-park-cottrell', 'Cottrell car park', 'car-park', ['transport'], [56.14385, -3.9196], null, 'Pay-and-display parking.', ['parking']],
  ['car-park-sports', 'Sports Centre car park', 'car-park', ['transport'], [56.14522, -3.9252], null, 'Parking for the Sports Centre.', ['parking']],
  ['car-park-pathfoot', 'Pathfoot car park', 'car-park', ['transport'], [56.1488, -3.9256], null, 'Parking by the Pathfoot Building.', ['parking']],
  ['airthrey-loch', 'Airthrey Loch', 'landmark', [], [56.147, -3.91925], null, 'The loch at the heart of campus, with a walking loop.', ['lake', 'loch walk']],
];

// ---------------------------------------------------------------------------
// Areas: loch and green spaces
// ---------------------------------------------------------------------------
const AREAS = [
  ['airthrey-loch', 'Airthrey Loch', 'water', ellipse([56.147, -3.91925], 0.00055, 0.0037, 40, 0.06)],
  ['library-lawn', 'Library lawn', 'green', rect(56.145, 56.1455, -3.9217, -3.9208)],
  ['loch-side-park', 'Loch-side park', 'green', rect(56.1458, 56.1462, -3.918, -3.9158)],
  ['pathfoot-meadow', 'Pathfoot meadow', 'green', rect(56.1478, 56.1487, -3.9275, -3.9258)],
];

// ---------------------------------------------------------------------------
// Indoor pilot: Cottrell Building, 2 floors
// ---------------------------------------------------------------------------
const C_LAT = 56.14465; // east-west corridor
const C_LNG = -3.92048; // north-south corridor
const CORRIDOR_LNGS = { w: -3.921, st: -3.9208, cw: -3.92064, c: C_LNG, lf: -3.9203, ce: -3.92008, e: -3.91995 };

const FLOORS = [
  // Placeholder labels. Real Cottrell floor names must come from the University.
  { id: 'cottrell-0', buildingId: 'cottrell', level: 0, name: 'Floor 1' },
  { id: 'cottrell-1', buildingId: 'cottrell', level: 1, name: 'Floor 2' },
];

/** Rooms: [id, name, kind, categories, level, polygon, doorCorridorKey, doorSide(+1 north / -1 south)] */
const ROOMS = [
  ['cottrell-0-cafe', 'Cottrell café (sample)', 'cafe', ['food'], 0, rect(56.14444, 56.1446, -3.92105, -3.92055), 'cw', -1],
  ['cottrell-0-g01', 'Seminar room G.01 (sample)', 'room', ['teaching'], 0, rect(56.1447, 56.14488, -3.92108, -3.9209), 'w', 1],
  ['cottrell-0-g02', 'Lecture theatre G.02 (sample)', 'room', ['teaching'], 0, rect(56.14444, 56.1446, -3.9204, -3.91995), 'lf', -1],
  ['cottrell-1-101', 'Seminar room 1.01 (sample)', 'room', ['teaching'], 1, rect(56.1447, 56.14488, -3.92022, -3.91995), 'ce', 1],
  ['cottrell-1-102', 'Computer lab 1.02 (sample)', 'room', ['teaching', 'study'], 1, rect(56.14444, 56.1446, -3.92105, -3.92055), 'cw', -1],
  ['cottrell-1-103', 'Study area 1.03 (sample)', 'study-space', ['study'], 1, rect(56.14444, 56.1446, -3.9204, -3.91995), 'ce', -1],
];

function buildIndoor() {
  const nodes = [];
  const edges = [];
  const features = [];
  const add = (id, lat, lng, level, kind, name) => nodes.push({ id, lat: round(lat), lng: round(lng), level, kind, ...(name ? { name } : {}) });
  const link = (from, to, kind, stepFree = true) => edges.push({ from, to, kind, stepFree });

  for (const floor of FLOORS) {
    const L = floor.level;
    const p = `cottrell-${L}`;
    // East-west corridor
    const keys = Object.keys(CORRIDOR_LNGS);
    keys.forEach((k) => add(`${p}-${k}`, C_LAT, CORRIDOR_LNGS[k], L, 'corridor'));
    keys.slice(1).forEach((k, i) => link(`${p}-${keys[i]}`, `${p}-${k}`, 'corridor'));
    // North-south corridor
    add(`${p}-n`, 56.14486, C_LNG, L, 'corridor');
    add(`${p}-s`, 56.14444, C_LNG, L, 'corridor');
    link(`${p}-n`, `${p}-c`, 'corridor');
    link(`${p}-s`, `${p}-c`, 'corridor');
    // Stairs and lift cores
    add(`${p}-stairs`, 56.14474, CORRIDOR_LNGS.st, L, 'stairs', 'Main stairs');
    add(`${p}-lift`, 56.14474, CORRIDOR_LNGS.lf, L, 'lift', 'Lift');
    link(`${p}-stairs`, `${p}-st`, 'corridor');
    link(`${p}-lift`, `${p}-lf`, 'corridor');

    features.push(
      feature({ type: 'Polygon', coordinates: rect(C_LAT - 0.000025, C_LAT + 0.000025, -3.92108, -3.91992) },
        { featureType: 'corridor', id: `${p}-corridor-ew`, buildingId: 'cottrell', floorId: floor.id, level: L }),
      feature({ type: 'Polygon', coordinates: rect(56.14441, 56.14489, C_LNG - 0.000045, C_LNG + 0.000045) },
        { featureType: 'corridor', id: `${p}-corridor-ns`, buildingId: 'cottrell', floorId: floor.id, level: L }),
      feature({ type: 'Polygon', coordinates: rect(56.14469, 56.14479, -3.92087, -3.92073) },
        { featureType: 'stairs', id: `${p}-stairs`, name: 'Main stairs', buildingId: 'cottrell', floorId: floor.id, level: L, nodeId: `${p}-stairs` }),
      feature({ type: 'Polygon', coordinates: rect(56.14469, 56.14479, -3.92036, -3.92024) },
        { featureType: 'lift', id: `${p}-lift`, name: 'Lift', buildingId: 'cottrell', floorId: floor.id, level: L, nodeId: `${p}-lift` }),
    );
  }

  // Vertical links between floors
  link('cottrell-0-stairs', 'cottrell-1-stairs', 'stairs', false);
  link('cottrell-0-lift', 'cottrell-1-lift', 'lift', true);

  // Entrances (ground floor) connect the outdoor network to the corridors
  const ENTRY = [['cottrell-north', 'ct_n', 'n'], ['cottrell-east', 'ct_e', 'e'], ['cottrell-main', 'ct_s', 's']];
  for (const [id, nodeKey, corridorKey] of ENTRY) {
    const [lat, lng] = N[nodeKey];
    add(`entrance:${id}`, lat, lng, 0, 'entrance', ENTRANCES.find((e) => e[0] === id)[2]);
    link(`entrance:${id}`, `cottrell-0-${corridorKey}`, 'entrance');
  }

  // Rooms with a door node on the corridor
  for (const [id, name, kind, categories, level, polygon, corridorKey, side] of ROOMS) {
    const floor = FLOORS.find((f) => f.level === level);
    const doorId = `${id}-door`;
    add(doorId, C_LAT + side * 0.00004, CORRIDOR_LNGS[corridorKey], level, 'door', `${name} door`);
    link(doorId, `cottrell-${level}-${corridorKey}`, 'door');
    features.push(feature({ type: 'Polygon', coordinates: polygon }, {
      featureType: 'room', id, name, kind, categories, buildingId: 'cottrell', floorId: floor.id, level, doorNodeId: doorId,
    }));
  }

  return { _meta: { sample: true, notice: NOTICE }, buildingId: 'cottrell', floors: FLOORS, nodes, edges, features: { type: 'FeatureCollection', features } };
}

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------
function write(rel, data) {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('wrote', rel);
}

write('campus/buildings.geojson', collection(BUILDINGS.map(({ footprint, ...props }) =>
  feature({ type: 'Polygon', coordinates: footprint }, props))));

write('campus/paths.geojson', collection(EDGES.map(([a, b, kind, name], i) =>
  feature({ type: 'LineString', coordinates: [pos(N[a]), pos(N[b])] }, {
    id: `path-${String(i + 1).padStart(3, '0')}`, kind, stepFree: kind !== 'steps', ...(name ? { name } : {}),
  }))));

write('campus/entrances.geojson', collection(ENTRANCES.map(([id, buildingId, name, nodeKey, stepFree]) =>
  feature({ type: 'Point', coordinates: pos(N[nodeKey]) }, { id, buildingId, name, stepFree, level: 0 }))));

write('campus/places.geojson', collection(PLACES.map(([id, name, kind, categories, ll, buildingId, description, aliases]) =>
  feature({ type: 'Point', coordinates: pos(ll) }, {
    id, name, kind, categories, description, aliases, ...(buildingId ? { buildingId } : {}),
  }))));

write('campus/areas.geojson', collection(AREAS.map(([id, name, kind, coords]) =>
  feature({ type: 'Polygon', coordinates: coords }, { id, name, kind }))));

write('indoor/cottrell.json', buildIndoor());
