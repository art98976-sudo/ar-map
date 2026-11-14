// Item 7: what a student types from a timetable, and the room they mean. Used by
// tests/search/probe.test.js (live, against MazeMap) and tests/unit/timetable-search.test.js.
// `expect` matches the top result's name; `floor` (when given) its floor.
export const TIMETABLE_CASES = [
  // Cottrell lecture theatres
  {q: 'A3', expect: /^A3 Lecture Theatre$/},
  {q: 'LT A3', expect: /^A3 Lecture Theatre$/},
  {q: 'Lecture Theatre A3', expect: /^A3 Lecture Theatre$/},
  {q: 'Cottrell A3', expect: /^A3 Lecture Theatre$/},
  {q: 'COTT A3LT', expect: /^A3 Lecture Theatre$/},
  {q: 'Cottrell LT A3', expect: /^A3 Lecture Theatre$/},
  {q: 'A3 LT', expect: /^A3 Lecture Theatre$/},
  {q: 'B4', expect: /^B4 Lecture Theatre$/},
  {q: 'LTW1', expect: /^W1 Lecture Theatre$/},
  {q: 'Cottrell W1', expect: /^W1 Lecture Theatre$/},
  // Cottrell teaching rooms (COTT/4B049 is room 4B49)
  {q: '4B49', expect: /^4B49$/, floor: 4},
  {q: '4B049', expect: /^4B49$/, floor: 4},
  {q: '4b49', expect: /^4B49$/, floor: 4},
  {q: '4B 49', expect: /^4B49$/, floor: 4},
  {q: '4B-49', expect: /^4B49$/, floor: 4},
  {q: 'Cottrell 4B49', expect: /^4B49$/, floor: 4},
  {q: 'COTT 4B49', expect: /^4B49$/, floor: 4},
  {q: 'COTT/4B049', expect: /^4B49$/, floor: 4},
  {q: 'Cottrell Building 4B49', expect: /^4B49$/, floor: 4},
  // Colin Bell
  {q: '3S29', expect: /^3S29$/, floor: 3},
  {q: 'Colin Bell 3S29', expect: /^3S29$/, floor: 3},
  {q: 'CB 3S29', expect: /^3S29$/, floor: 3},
  {q: '3S6', expect: /^3S6$/, floor: 3},
  // Named theatres and rooms
  {q: 'Logie LT', expect: /^Logie Lecture Theatre$/},
  {q: 'Logie Lecture Theatre', expect: /^Logie Lecture Theatre$/},
  {q: 'Pathfoot LT', expect: /^Pathfoot Lecture Theatre$/},
  {q: 'Pathfoot MLT', expect: /^Pathfoot Lecture Theatre$/},
  {q: 'Iris Murdoch Seminar Room 2', expect: /^Seminar Room 2$/, floor: 3},
  {q: 'Iris Murdoch 10.2', expect: /^Seminar Room 2$/, floor: 3},
  {q: 'Library 2.23', expect: /^Seminar Room$/, floor: 2},
]
