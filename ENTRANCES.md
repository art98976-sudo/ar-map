# Entrance checklist

Outdoor directions end at each place's **main entrance**. These points were worked out from the University's MazeMap walking routes (the spot where a route first goes indoors). **None are confirmed yet**: please check each one on campus.

## How to check one

1. Stand at the door people normally use.
2. Open the Google Maps link below on your phone. The red pin should be within a few steps of you.
3. If it is off, long-press the right spot in Google Maps, copy the numbers (for example 56.14545, -3.91980) and send them to me, or edit `entrance` in [src/data/destinations.json](src/data/destinations.json) yourself.
4. When it is right, set `"confirmed": true` for that place and tick the box here.

Popular places are in **bold**: check these first.

| Place | Entrance (lat, lng) | Check | How it was found | Confirmed |
|---|---|---|---|---|
| **Library** | 56.145454, -3.919805 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.145454,-3.919805) | Enter through the Andrew Miller Building (Atrium). The Library is inside. | ☐ |
| **Atrium** | 56.145956, -3.919276 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.145956,-3.919276) | mazemap route, door into building 1009836 | ☐ |
| **Cottrell Building** | 56.144904, -3.920317 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.144904,-3.920317) | mazemap route door, matches the A3 Entrance foyer | ☐ |
| **Pathfoot Building** | 56.148705, -3.926991 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.148705,-3.926991) | mazemap route, door into building 1009791 | ☐ |
| **Sports Centre** | 56.146165, -3.924479 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.146165,-3.924479) | mazemap route, door into building 1009835 | ☐ |
| **Campus Central** | 56.145454, -3.919805 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.145454,-3.919805) | mazemap route, door into building 1009836 | ☐ |
| Logie Lecture Theatre | 56.143966, -3.920488 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.143966,-3.920488) | mazemap route, route end (no indoor map) | ☐ |
| Students' Union | 56.146057, -3.918672 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.146057,-3.918672) | mazemap route, door into building 1009829 | ☐ |
| Macrobert Arts Centre | 56.145454, -3.919805 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.145454,-3.919805) | mazemap route, door into building 1009836 | ☐ |
| Iris Murdoch Building | 56.143885, -3.917163 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.143885,-3.917163) | mazemap route, door into building 1009790 | ☐ |
| National Tennis Centre | 56.146165, -3.924479 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.146165,-3.924479) | mazemap route, door into building 1009835 | ☐ |
| Stirling Court Hotel | 56.143177, -3.922341 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.143177,-3.922341) | mazemap route, route end (no indoor map) | ☐ |
| Andrew Stewart Hall | 56.148680, -3.923674 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.14868,-3.923674) | mazemap route, route end (no indoor map) | ☐ |
| Airthrey Loch | 56.146550, -3.918980 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.14655,-3.91898) | outdoor place | ☐ |
| Airthrey Castle | 56.148394, -3.913483 | [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=56.148394,-3.913483) | mazemap route, route end (no indoor map) | ☐ |

## Things to look at

- **Library**: you enter through the Andrew Miller Building (Atrium), so its entrance is the same door as Campus Central. Is that the door you would send a new student to?
- **National Tennis Centre** currently shares the Sports Centre door. It probably has its own entrance.
- **Macrobert Arts Centre** shares the Campus Central door. Check whether it has a separate public entrance.
- Places marked *route end (no indoor map)* have no indoor map on MazeMap, so their point is just where the outdoor route stops. These need checking the most.

To regenerate all suggestions after MazeMap updates: `node tools/find-entrances.mjs --write` (this overwrites manual changes, so note them first).

## Added for the map chips

Food and bus places come from the University's MazeMap, and Starbucks from OpenStreetMap. Check they still exist and where the door is.

- [ ] Bus Hub: [56.143862, -3.921099](https://www.google.com/maps?q=56.143862,-3.921099)
- [ ] Scran: [56.145956, -3.919276](https://www.google.com/maps?q=56.145956,-3.919276)
- [ ] The Bite: [56.144904, -3.920317](https://www.google.com/maps?q=56.144904,-3.920317)
- [ ] Umami: [56.144327, -3.921595](https://www.google.com/maps?q=56.144327,-3.921595)
- [ ] Starbucks: [56.146068, -3.918701](https://www.google.com/maps?q=56.146068,-3.918701)
