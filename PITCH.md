# Funding pitch guide: Stirling Campus AR

Presenter notes for a 5–7 minute pitch to a university funding panel.
Numbers marked **[check]** are placeholders. Replace them with real figures before presenting, because a panel will ask where they came from.

---

## 1. The problem (45 seconds)

- The campus is large and spread around Airthrey Loch. Pathfoot, the Atrium, Cottrell and the Sports Centre are far apart for a newcomer.
- Every September, thousands of new students **[check: annual intake]** try to find lecture theatres, the Library and support services in their first week.
- Open-day visitors, conference guests and parents face the same problem.
- Static maps and signs do not tell you *which way to turn from where you are standing*.

**Line to say:** "The first week at university should be about learning, not about being lost."

## 2. The solution (30 seconds)

Stirling Campus AR is a web app. You hold up your phone and every building, café and landmark is labelled in the direction you are looking. Pick a destination and an arrow walks you there.

- No app store download. It opens from a QR code or link.
- Works on any modern phone.
- Built on open web standards and OpenStreetMap, so running costs are low.

## 3. Live demo (2 minutes)

Follow the demo flow in `README.md`. The strongest moment is **AR View then Simulate walk**: the panel watches the arrow guide "you" to the Library and the distance count down to "Arrived".

If the internet fails, the AR view still works. Only the map tiles need a connection.

## 4. Who benefits (30 seconds)

| Group | Benefit |
|---|---|
| New students | Find lectures, the Library and support on day one. |
| International students | Labels can be offered in multiple languages. |
| Disabled students and visitors | Step-free routes and accessible entrances can be added as a layer. |
| Open days and recruitment | A memorable, modern first impression of Stirling. |
| Events and conferences | Guests can find venues without staff guiding them. |

## 5. Roadmap (45 seconds)

| Phase | Timeline | Deliverables |
|---|---|---|
| 1. Prototype | Done | This demo: map, AR labels, AR arrow, search, 17 places. |
| 2. Pilot | 3 months **[check]** | Walking-path routing, every building and entrance verified on foot, accessibility routes, pilot with 200 students during Welcome Week. |
| 3. Launch | 6 months **[check]** | Room-level indoor guidance using QR anchors, timetable integration, multilingual labels, events layer. |
| 4. Extend | 12 months **[check]** | Heritage tour of campus art and Airthrey Castle, open-day mode, analytics dashboard for Estates. |

## 6. The ask (30 seconds)

Fill in real quotes before presenting. A typical breakdown for a student-led pilot:

| Item | Estimate |
|---|---|
| Developer time or student internships | £ **[check]** |
| Hosting and domain, 1 year | £ **[check]** (static hosting can be near zero) |
| Campus data survey (verifying entrances, step-free routes) | £ **[check]** |
| User testing with students during Welcome Week | £ **[check]** |
| Accessibility audit | £ **[check]** |
| **Total** | **£ [check]** |

**Line to say:** "For less than the cost of reprinting campus signage, we can give every student a guide in their pocket." Only use this line if your total supports it.

## 7. How we will measure success

- Number of unique users in Welcome Week.
- Percentage of pilot students who found their first lecture without asking for directions.
- Survey satisfaction score from new students and open-day visitors.
- Reduction in "where is…" questions at the Atrium help desk **[check with Student Services]**.

## Likely panel questions

- **"Why not just use Google Maps?"** Google Maps does not label individual university buildings, entrances or services, and has no campus-specific AR directions.
- **"What about GPS accuracy?"** Outdoor GPS is accurate to roughly 5–15 m, which is enough to pick out buildings. Indoor guidance in phase 3 uses QR anchors instead of GPS.
- **"Privacy?"** Location is used only on the phone and is not stored or sent anywhere in the current design.
- **"Who maintains it?"** Places are kept in one simple list that Estates or a student team can edit, with no app-store releases needed.
- **"Does it work on old phones?"** It needs a phone with a camera, GPS and a compass, which covers almost all smartphones from the last several years. There is a map-only fallback.
