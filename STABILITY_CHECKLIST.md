# v0.5 classroom stability acceptance

Release gate: **passed**. All applicable physical acceptance items passed, as confirmed by Jonathan Delgado for this release on 2026-09-30. Hardware results are user-reported, not independently observed by automation.

Use a clear floor area, modest speed, and an observer at the robot power switch. A successful HTTP response does not prove physical stopping. Hummingbird Bit has LEDs and servos, not dedicated DC motor ports; DC motor checks are N/A.

| ID | Combination / executable check | Expected result | Physical status |
|---|---|---|---|
| A | YOLO11n + laptop + Finch; Person → beak light | Light follows rule | Passed |
| B | YOLO11n + CamS3 + Finch; repeat A | Same response | Passed |
| C | Teachable Machine + Finch; custom class → light | Correct class triggers; no spatial/Follow action | Passed |
| D | MobileSAM + Finch; select/name/track object, start Follow, hide target | Tracks selected object; loss stops wheels | Passed |
| E | YOLO11n + Hummingbird; LED and position/rotation servo actions | Correct port responds; rotation stop preserves position servo | Passed |
| F | YOLO11n + Hummingbird AND sensor; vary each condition independently; unplug sensor | Fires only when both true; unavailable input releases motion | Passed |
| G | Finch continuous motion; match then remove target | Continuous drive, then stop; no stale owner | Passed |
| H | Finch Follow; move target left/right/closer; hide target | Correct steering, distance hold, loss stop | Passed |
| I | Disconnect CamS3 during Follow | Wheels stop; no stale-frame restart | Passed |
| J | Disconnect Finch during motion; repeat with Hummingbird rotation | Runtime ownership clears; reconnect does not resume actions | Passed |
| K | STOP button and Space during timed move + queued action | Immediate stop; queued action never runs | Passed |
| L | Repeat K during continuous motion | Immediate stop; ownership clears | Passed |
| M | Repeat K during Follow | Immediate stop; later frames cannot restart Follow | Passed |
| N | Load/import/new/reset project during continuous motion | STOP precedes replacement; old rules never resume | Passed |
| O | With AI active, laptop → network → laptop; repeat Connect | One source/client; tracks released; recovers without reload | Passed |

Also test: AI OFF, provider change, robot change, page hide/unload; each cancels motion. Test Hummingbird rotation ports 1/2 independently, with position servo on another port. Test malformed import (existing project survives), unavailable webcam, unreachable hostname/stream, model failure, unavailable BlueBird, and sensor failure (short error, app remains usable).

Network UI uses Connecting / Connected / Error / Disconnected and manual Connect retry. No automatic reconnection or discovery is introduced. Saved stream URLs remain unchanged.

## Automated verification

Run `npm test` and `npm run build`. Existing focused suites cover timed/continuous STOP, Follow watchdog and cancellation, stale ownership, independent Hummingbird ports, sensor polling cancellation, malformed projects, provider capability gating, and camera switching. Added regressions cover duplicate local/network Connect and STOP superseding a pending reset.

## v0.5.0 stability changes

- Duplicate camera requests share a pending connection; camera attempts invalidate old inference.
- Project replacement waits for STOP and robot handoff before committing project state.
- Provider reset clears cached predictions used by sensor evaluation.
- Emergency STOP invalidates a pending output reset before it can issue new actions.
- Existing Follow, disconnect, Hummingbird ownership and polling checks retained.

Release verification: 198 tests passed; 0 failed; production build passed; physical stability acceptance passed. Supplemental applicable checks above passed per user confirmation. Dedicated Hummingbird Bit DC motor checks: N/A (no dedicated DC motor ports).

Browser smoke (2026-09-29, no hardware): demo detections cleared after switching to Teachable Machine; spatial controls disappeared and Follow remained disabled; New Project returned to YOLO with no detections; Space displayed STOP and left rules paused. These checks do not substitute for physical rows A–O.

