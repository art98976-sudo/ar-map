# Field test sheet: Stirling Welcome AR

Use this sheet on campus with **one iPhone (Safari)** and **one Android phone (Chrome)**. Walk each of the three routes once per phone, so six walks in total. Tick each line, or write what happened instead.

Before you start:

- Open the live link with `?fieldtest=1` added, for example `https://stirling-welcome-ar.vercel.app/?fieldtest=1#/?to=library`. The phone then records a log you can save as a CSV at the end of each walk.
- Add `?debug=1` to show the status line at the top of the camera view.
- Write down the phone model, its OS version, the browser, the weather and the time of day.

| | iPhone | Android |
|---|---|---|
| Model and OS | | |
| Browser and version | | |
| Weather and light | | |
| Date and time | | |

## The three routes

| Route | From | To | What it tests |
|---|---|---|---|
| A. Outdoor only | Bus hub (Airthrey Road) | Library entrance | Arrows on paths, turns, arrival |
| B. Outdoor to an entrance | Pathfoot car park | Cottrell Building, room A3 (`?to=mm-1002085033`) | Arrival at the door, then "Continue inside on the map" |
| C. Indoor with a floor change | Cottrell main entrance | A Level 2 room in Cottrell | Indoor map, "Go to Level 2", "I'm on Level 2" |

Route C uses the indoor map by default. To test arrows indoors as well, a developer must first set `INDOOR.indoorAR = true` in `src/config.js` and deploy a preview.

## Pass marks by phase

For each line, write **P** (pass), **F** (fail) or **–** (not seen), once per walk.

### Phase 1: the place card

| Check | Pass when | A iOS | A And | B iOS | B And | C iOS | C And |
|---|---|---|---|---|---|---|---|
| Walk time and distance | The card shows "n min · n m", within 2 min of the walk | | | | | | |
| Door and level | A room card says "Enter by …, then Level n" | – | – | | | | |
| Approximate location | With GPS worse than 20 m, "Location is approximate" shows | | | | | | |

### Phase 2: arrows follow the line

| Check | Pass when | A iOS | A And | B iOS | B And | C iOS | C And |
|---|---|---|---|---|---|---|---|
| On the line | Chevrons lie on the path within about 1 m, the whole walk | | | | | | |
| Turns | Chevrons bend with the route at each corner, never before it | | | | | | |
| Unsure position | When GPS is bad for 3 s, arrows hide and the map opens | | | | | | |
| Back from another app | Coming back from another app shows the line-up card | | | | | | |

### Phase 3: on the ground

| Check | Pass when | A iOS | A And | B iOS | B And | C iOS | C And |
|---|---|---|---|---|---|---|---|
| Strip and pulse | A faint green strip under the chevrons, with a slow pulse | | | | | | |
| Corner ring | A ring at each corner fills as you walk up to it | | | | | | |
| Buzz before a corner | The phone buzzes about 5 m before a corner (Android only; iPhone cannot) | – | | – | | – | |
| Edge chevron | Turning away shows a chevron at the screen edge pointing back | | | | | | |

### Phase 4: walls and doors

| Check | Pass when | A iOS | A And | B iOS | B And | C iOS | C And |
|---|---|---|---|---|---|---|---|
| Hidden behind walls | Near Cottrell, chevrons behind a wall do not show through it | – | – | | | | |
| Doorways | A green outline marks the door the route goes through | – | – | | | | |

### Phase 5: indoors

| Check | Pass when | A iOS | A And | B iOS | B And | C iOS | C And |
|---|---|---|---|---|---|---|---|
| Door handover | At the door: "You're at Cottrell main entrance" and "Continue inside on the map" | – | – | | | | |
| Indoor map | The indoor map opens on the right floor, with the room highlighted | – | – | | | | |
| Floor change | "Go to Level 2" at the stair, then "I'm on Level 2" carries on | – | – | – | – | | |
| "I'm here" | Tapping a door or stair on the map moves the route to it | – | – | | | | |

### Phase 6: guidance and safety

| Check | Pass when | A iOS | A And | B iOS | B And | C iOS | C And |
|---|---|---|---|---|---|---|---|
| First-time guide | On a new phone, "Before we start" lists camera, location, motion, then the prompts follow | | | | | | |
| Tilt hint | On the first trip only, a phone tilting to the floor shows for 3 s | | | | | | |
| One message | Only one message shows at a time, at the top | | | | | | |
| Look up | After 10 s of walking with the phone held up: "Look up while you walk" | | | | | | |
| Entrance marker | Within 30 m: a ring and a pin with the entrance's name | | | | | | |
| Arrival | "You've arrived", or "You're at …" for a room | | | | | | |

### Phase 7: the home map and search

| Check | Pass when | iOS | Android |
|---|---|---|---|
| Opening | A fresh tab with no place in the link: a green launch screen, then one camera move onto the campus | | |
| Pins | Names on the map are not hidden under pins; close pins merge into a numbered circle | | |
| Result icons | Each kind of place has its own icon and colour | | |
| Empty search | Searching "zzzz" shows "No room found. Try the room number, like 2B87." | | |

### Phase 8: offline, privacy, unsupported phones

| Check | Pass when | iOS | Android |
|---|---|---|---|
| Opens offline | After one visit, airplane mode, then reload: the app opens | | |
| Trip through a drop | Turn on airplane mode mid-walk: the arrows carry on along the route | | |
| Offline search | Offline, a room search says "Offline. Room search is off until you reconnect." | | |
| Privacy line | The menu shows "Anonymous trip counts only. No location is kept." | | |
| In-app browser | Opening the link from Instagram or WhatsApp: the card offers the map, not AR | | |

## Numbers to write down per walk

From the saved CSV, or from the `?debug=1` line:

| | A iOS | A And | B iOS | B And | C iOS | C And |
|---|---|---|---|---|---|---|
| Worst distance from the route (m) | | | | | | |
| Largest gap between compass and tracked heading (°) | | | | | | |
| Lowest fps | | | | | | |
| Times "Tracking lost" showed | | | | | | |
| New routes ("Finding a new route") | | | | | | |
| Walk finished without the map? (yes / no) | | | | | | |

## Overall pass

A phone passes a route when:

- every line in Phases 1–6 that applies to it is **P**;
- the worst distance from the route is under 2 m;
- the walk was finished by following the arrows alone.

If anything fails, write what you saw and where, and attach the CSV.
