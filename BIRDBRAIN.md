# BirdBrain integration notes

## Milestone status

**Real Finch A and Hummingbird Bit A are implemented through the desktop BlueBird HTTP API.** On September 13, 2026, the user confirmed physical Finch green and red beak output, a 10% wheel test, and its automatic stop after approximately one second. Live YOLO person detection has been observed; the combined vision-to-physical-action acceptance test is still pending.

Hummingbird Bit exposes single LEDs (ports 1–3), tri-color LEDs (1–2), position/rotation servos (1–4), Wait, and Stop outputs. No DC motor or sensor actions are exposed. Production robot simulation has been removed; automated tests intercept transport requests or use a test-only adapter.

September 15, 2026 physical acceptance stopped at identity: `GET http://127.0.0.1:30061/hummingbird/in/isHummingbird/static/A` returned HTTP 200 with body `Not Connected`. No physical output commands were sent. Connect Hummingbird Bit as A in BlueBird before continuing manual LED/servo and vision-rule acceptance.

## Implemented Hummingbird encoding and STOP

The manual position test uses port 2; rotation uses port 1. **Reset project** pauses rules, stops motion, clears all LED ports, and returns the default position port 2 plus position ports referenced by the rules to 90°. Ports referenced by rotation actions are excluded from position reset. Reset deletes all rules, conditions, and sensor configuration, including when disconnected. Save first to retain them. The connector does not report a servo's original angle; 90° is the app's reset position.

All output requests below use the existing transport and require response body `200`:

- Single LED: `/hummingbird/out/led/{port}/{value}/A`, value = truncate(brightness × 255 / 100).
- Tri-color LED: `/hummingbird/out/triled/{port}/{r}/{g}/{b}/A`, hex color decoded to bytes 0–255.
- Position servo: `/hummingbird/out/servo/{port}/{value}/A`, value = truncate(clamped degrees × 254 / 180), degrees 0–180.
- Rotation servo: `/hummingbird/out/rotation/{port}/{value}/A`, signed speed −100–100; value = 255 for absolute speed below 10, otherwise truncate(speed × 23 / 100 + 122). Forward 25% sends 127; reverse 25% sends 116; stop sends 255.
- Initial attachment: `/hummingbird/out/stopall/A` clears prior outputs after positive identity verification.

Conversions follow the linked Python reference below. Timed actions stop their servo port on completion/cancellation. Continuous actions send once on rule entry and release only their owned port on rule loss; position and rotation commands share the same port ownership key. Emergency STOP, disconnect, errors, AI pause, project changes and robot changes cancel actions and attempt rotation stop on all tracked rotation ports. Ordinary STOP preserves LED state and position angles; it never commands a position servo to zero degrees. HTTP acceptance cannot confirm physical behavior.

## Files changed for Hummingbird Bit

- Adapter/capabilities: `src/core/HummingbirdAdapter.ts`, `RobotCapabilities.ts`, `RobotAdapter.ts`, `RobotRouter.ts`, `BirdBrainTransport.ts`.
- Ownership/storage: `src/core/ActionEngine.ts`, `ProjectStorage.ts`, `types.ts`.
- UI: `src/App.tsx`, `src/components/HardwareTest.tsx`, `RuleCard.tsx`, `FinchView.tsx`, `src/styles.css`, `public/hummingbird-bit.png`.
- Tests: `tests/hummingbird.test.tsx`, `hummingbird.browser.mjs`, `MockRobotAdapter.ts`; existing `continuous-motion.test.ts`, `engines.test.ts`, `finch.test.ts`, `tail-sequence.test.ts`, `teachable-machine.test.tsx` import the relocated test double. `tests/teachable-machine.browser.mjs` and `scripts/browser-smoke.mjs` intercept real adapter HTTP instead of selecting a simulator.
- Documentation: `README.md`, `BIRDBRAIN.md`.

Validation: 102 unit tests pass. Hummingbird browser transport fixture, Teachable Machine browser fixture, and YOLO WASM browser smoke test pass. Browser robot commands were intercepted; these results do not establish physical output behavior.

## Hummingbird sensor milestone

Inputs 1–3 can be configured as Distance, Light, Sound, or Generic analog. Configuration and each rule's sensor conditions persist in project JSON; legacy projects default both fields to empty arrays. Conditions combine with the existing vision condition using AND. Changing the robot dropdown clears all rules, conditions, and sensor configuration. Importing a saved project restores its robot and rules instead of clearing them.

Reads reuse `HummingbirdAdapter` and `BirdBrainTransport`: `GET http://127.0.0.1:30061/hummingbird/in/sensor/{port}/{slot}`. The reference client's raw integer range is 0–255. Distance uses truncate(raw × 1.17) cm; light uses truncate(raw × 100 / 255)%; sound uses truncate(raw × 200 / 255), capped at 100%; generic analog uses truncate(raw × 100 / 255)%. Conversion is centralized in `Sensors.ts`. Source: [BirdBrain Python input methods and factors](https://github.com/fmorton/BirdBrain-Python-Library/blob/main/src/BirdBrain.py).

Polling is round-robin with 100 ms between completed requests, at most ten reads per second total, with no concurrent reads. Disconnect, robot/project configuration changes, and page exit cancel polling. Missing, failed, or older-than-750-ms readings fail conditions. A 100 ms rule-input check releases continuous outputs even when a read stalls; vision older than 1.5 seconds is not reused by that check. Read errors show Unavailable without exposing transport errors. BlueBird supplies raw analog values, not physical plug detection: a disconnected cable that still produces a numeric value cannot be identified automatically.

Digital/button input configuration is deferred because the reference exposes external ports as analog inputs; built-in micro:bit buttons are not these numbered ports. Boolean equality is supported and tested in the generic condition evaluator. Sensor-only rules are intentionally deferred to keep this milestone focused on the existing vision conditions plus AND.

Validation: 113 unit tests passed, production build passed, and an isolated browser test passed configuration, live values, vision/sensor LED gating, continuous rotation release, unavailable readings, persistence, and switching to Finch. Browser hardware requests were intercepted. Physical acceptance could not start: the identity request to `http://127.0.0.1:30061/hummingbird/in/isHummingbird/static/A` failed with connection refused. No physical output commands were sent for this milestone.

Changed files: `src/core/Sensors.ts`, `SensorProvider.ts`, `HummingbirdAdapter.ts`, `RuleEngine.ts`, `types.ts`, `ProjectStorage.ts`; `src/components/SensorInputs.tsx`, `SensorConditions.tsx`, `RuleCard.tsx`; `src/App.tsx`, `src/styles.css`; `tests/sensors.test.ts`, `tests/sensors.browser.mjs`; `BIRDBRAIN.md`.

## Firmware and connector preparation

For Hummingbird Bit, use BirdBrain's [official installation shortcuts](https://learn.birdbraintechnologies.com/install-shortcuts/) to download **BBTFirmware.hex**. Connect the micro:bit to the computer with a USB data cable. Drag the downloaded hex file onto the **MICROBIT** drive, wait for flashing to finish, then follow the product setup instructions to insert/power the micro:bit in the Hummingbird Bit. Some older instructions refer to BitFirmware.hex; use the current official file for your board. No firmware is bundled or flashed by this app.

Install and run BlueBird Connector using the same official download page. It mediates Bluetooth communication with supported BirdBrain robots. Power the Finch 2 or Hummingbird Bit, enable Bluetooth, and connect the matching device in the Connector. BirdBrain's Python client addresses connected device slots **A, B, or C**. A future adapter must verify both presence and robot type before issuing commands. Follow Finch-specific firmware instructions if its micro:bit needs recovery; do not flash arbitrary firmware images.

## Existing implementations investigated

- [BirdBrain BlueBirdJava](https://github.com/BirdBrainTechnologies/BlueBirdJava): the Java Connector and Windows Bluetooth helper. The repository is archived; inspect compatibility with the installed Connector rather than assuming the latest desktop app is identical.
- [BirdBrain-Python-Library](https://github.com/fmorton/BirdBrain-Python-Library), especially [src/BirdBrain.py](https://github.com/fmorton/BirdBrain-Python-Library/blob/main/src/BirdBrain.py): readable reference for current Finch/Hummingbird local HTTP commands, slot ordering, byte scaling, and response checks.
- [BirdBlox/FinchBlox browser frontend](https://github.com/BirdBrainTechnologies/BirdBlox-FinchBlox-JS-Frontend): a block programming frontend hosted inside the mobile apps. Its presence does not mean its native bridge is the desktop Connector API.
- BirdBrain's [open-source support page](https://www.birdbraintechnologies.com/support-article/are-your-products-or-software-open-source/) points developers to its repositories.

Reuse the HTTP transport; no Bluetooth protocol reverse engineering is necessary for these commands.

## Local API researched for milestone 2

The Python source uses **http://127.0.0.1:30061**, not port 27779. Requests are GETs. The table shows paths relative to that origin, with `slot` being A/B/C. These are researched examples, **not endpoints used by milestone 1**.

| Capability                     | Path pattern                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Finch identity                 | `/hummingbird/in/isFinch/static/{slot}`                                              |
| Hummingbird identity           | `/hummingbird/in/isHummingbird/static/{slot}`                                        |
| Connection probe               | `/hummingbird/in/orientation/Shake/{slot}`                                           |
| Stop Finch motors              | `/hummingbird/out/stopFinch/{slot}`                                                  |
| Stop all outputs on one device | `/hummingbird/out/stopall/{slot}`                                                    |
| Finch beak                     | `/hummingbird/out/triled/1/{r}/{g}/{b}/{slot}`                                       |
| Finch individual tail          | `/hummingbird/out/triled/{port}/{r}/{g}/{b}/{slot}` (ports 2–5 map to tail LEDs 1–4) |
| Whole Finch tail               | `/hummingbird/out/triled/all/{r}/{g}/{b}/{slot}`                                     |
| Independent wheel speeds       | `/hummingbird/out/wheels/{slot}/{left}/{right}/`                                     |
| Move a distance                | `/hummingbird/out/move/{slot}/{Forward-or-Backward}/{distance}/{speed}/`             |
| Turn an angle                  | `/hummingbird/out/turn/{slot}/{Left-or-Right}/{angle}/{speed}/`                      |
| Motion completion              | `/hummingbird/in/finchIsMoving/static/{slot}`                                        |
| MIDI note                      | `/hummingbird/out/playnote/{note}/{durationMs}/{slot}`                               |
| Hummingbird single LED         | `/hummingbird/out/led/{port}/{intensityByte}/{slot}`                                 |
| Hummingbird RGB LED            | `/hummingbird/out/triled/{port}/{r}/{g}/{b}/{slot}`                                  |
| Hummingbird position servo     | `/hummingbird/out/servo/{port}/{encodedPosition}/{slot}`                             |
| Hummingbird rotation servo     | `/hummingbird/out/rotation/{port}/{encodedSpeed}/{slot}`                             |

The Python library converts user-facing color percentages to 0–255 endpoint values. Finch wheel percentages are signed; distance/turn direction strings are spelled out, with device slot placed before movement parameters. Servo positions and rotation speeds need the reference client's conversion; do not pass raw degrees/signed percentages unexamined. The Python reference has three single LED ports, two tri-color LED ports, and four servo ports for Hummingbird Bit. Separate DC/vibration motor actions must not be exposed merely because older Hummingbird models support them.

Read response bodies as well as HTTP status: the client recognizes `Not Connected` and uses string values such as `true`/`false` and `200`. Movement completion uses `finchIsMoving`; a bounded timeout and explicit stop are needed if it never finishes. Discovery/pairing remains in the Connector until an installed version's discovery interface has been verified. Do not invent a `/scan` endpoint.

## Browser and hardware validation still required

The Python API proves the local service's command format, not that a hosted browser page is permitted to call it. Before enabling real robots, test CORS, HTTPS-to-loopback access, browser local-network permissions, response/error behavior, Connector version, device disconnect, and stop priority on the actual target computer. Never instruct students to disable browser security. If a minimal local bridge is needed, limit it to robot commands and keep image inference entirely in the browser.

## Troubleshooting for the next milestone

- **Connector unavailable:** Install/open BlueBird Connector; verify it is running on the same computer. The app should say “Open BlueBird Connector, then try again,” rather than showing a stack trace.
- **Robot absent:** Check power, Bluetooth, correct firmware, data cable, and whether another app is using the robot. Follow [BirdBrain's device-discovery troubleshooting](https://www.birdbraintechnologies.com/support-article/why-is-my-bluetooth-device-not-showing-up-as-an-option-in-the-bluebird-connector/).
- **Wrong slot/type:** Verify the A/B/C assignment and the identity endpoint before enabling actions.
- **Browser request blocked:** Test the origin/security boundary; do not guess it is a disconnected robot based on a fetch error alone.
- **Lost communication:** Pause AI and attempt direct stop immediately. Use bounded movements and teacher-accessible physical power control; an unreachable connection cannot guarantee delivery of a stop command.

Research checked September 13, 2026. No robot or firmware was modified during development.

