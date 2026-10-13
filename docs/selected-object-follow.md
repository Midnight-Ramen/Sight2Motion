# MobileSAM target profiles and Follow

Choose **AI vision → MobileSAM — Selected Target** and start the camera.
MobileSAM loads in a worker on mode selection; the page retains its model
sessions across panel switches, camera resets and Retake. No progress percentages
are displayed because the current model loader does not report progress.

Use the camera overlay **Select target**, then **Capture frame**. Click the object
in the temporary frozen snapshot, enter a target name, and **Save view**. The camera
stream continues, with a small LIVE inset during selection. Retake and Save view
return to live video immediately. Undo and Clear are contextual selection controls;
positive/negative points and box selection remain under Advanced target settings.

Reference **+** starts from live video so the object can be repositioned or rotated
before another capture. Additional views retain the same target name. Remove an
individual thumbnail to discard a view. Save the project to retain its bounded
crops, binary masks and matching representations. Limits are eight views per
profile, ten profile names, sixteen total views, and the existing 1 MB project-file
limit. Old saved target names load safely but require a first reference capture.

## Global Play and STOP

A named profile with reference views exposes **Base behavior → Follow selected
target** for Finch. Choose it, connect Finch, and press the existing **Play rules**.
Play starts profile matching and hands the matched target to the existing
ActionEngine selected-target FollowController. A missing or uncertain initial
match keeps the robot stopped. Preview-only Track target remains available, but
no separate Follow start/stop button is required.

The current target profile is the Follow source. Its existing settings retain
forward speed, steering, dead zone, near/far area and confidence values. The
controller and wheel-command implementation are unchanged. AI rule reactions
can suspend this base, then resume the same safe matching session. Emergency
braking retains priority over both rules and Follow. STOP, Space, manual takeover,
disconnect, camera/profile changes and safety aborts cancel motion; later camera
matches do not restart it without a new global Play.

## Matching and loss

MobileSAM creates the selected mask. The existing local appearance tracker compares
masked RGB/context templates against nearby multi-scale live candidates and takes
the best score across all references. Rotation can match another stored view within
the same safe tracking session. Match threshold is under Advanced target settings.
No model is retrained, and the profile does not create a YOLO class.

Coordinates retain the shared camera mirror transform. Only real new camera frames
with reliable matches refresh the existing Follow watchdog. Uncertain matches do
not extend its deadline. The unchanged appearance loss deadline is 750 ms; after
terminal loss, matching and Follow require explicit restart. Reference views do
not enable global reacquisition or relax continuity/ambiguity safety. The camera
must move with Finch for camera-based following. Large rotations, occlusion,
lighting changes or similar nearby objects can still cause loss.

## Validation status

The current pass has 600 passing Vitest tests, a passing production build and
`git diff --check`. Tests cover profile creation/import, best-of-N matching and
rotation, Follow handoff, temporary rule override/resume, stale loss, and
STOP/manual/disconnect/Space cancellation. Browser interaction tests use a synthetic
camera, mocked SAM masks and intercepted BlueBird endpoints; no physical commands
are sent. Real MobileSAM worker initialization was also measured with real model
assets in isolated local Chrome/WebGPU: 2.87 seconds to ready, 0.15 seconds to ready
on repeat selection, and one model load. Times vary by browser and hardware.

**Physical MobileSAM/Finch Follow validation pending.**
**Physical Hummingbird servo + LED validation pending.** The pending classroom
polish includes Once per detection, Servo Home/Return Home and direct output-test
controls; mocked tests do not establish physical timing or hardware acceptance.
