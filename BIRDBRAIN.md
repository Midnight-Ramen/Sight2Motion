# BirdBrain integration notes

## Milestone status

**Real Finch A is implemented through the desktop BlueBird HTTP API.** On September 13, 2026, the user confirmed physical green and red beak output, a 10% wheel test, and its automatic stop after approximately one second. Live YOLO person detection has been observed; the combined vision-to-physical-action acceptance test is still pending. Hummingbird is not implemented.

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

