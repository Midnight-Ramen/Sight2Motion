# Changelog

## v0.8.0 — Tracking & Follow Stability

- Improved target association and retention, including MobileSAM-selected targets and short-loss reacquisition.
- Protected motion against stale and duplicate detections; expired locks require fresh acquisition.
- Smoothed Finch Follow steering with distance hysteresis and 100 ms motor-control interpolation.
- Added 300 ms target settling, distance-aware steering/tolerance, and alignment-aware forward speed.
- Added acquisition ramps: 600 ms steering and 500 ms forward, seeded from settling samples.
- Expanded Live Diagnostics with target freshness, lock state, steering, and wheel-command details.
- Added network-camera dropout diagnostics and single-client stream recovery; bounded repeated immediate browser fetch failures.
- Physical Finch acceptance passed at 40% Follow speed; network camera stable in Chrome, confirmed by Jonathan Delgado.
- Release verification: 291 tests passed, 0 failed; production build passed. Runtime behavior frozen after physical acceptance.

## v0.6.0 — Guided Student Experience

- Added six editable project templates, including blank projects and custom AI classifiers.
- Upgraded setup progression with clickable steps and actual readiness checks.
- Added contextual next-step guidance and clear explanations when Play is unavailable.
- Improved empty states and actionable camera, model, robot, sensor, and rule error guidance.
- Clarified template port requirements and example rule names.
- Made student-facing action wording more consistent.
- Polished light/dark readability and guidance spacing.
- Release verification: 222 tests passed, 0 failed; production build passed.

## v0.5.0 — Classroom Stability Release

- Hardened emergency STOP so pending output resets cannot resume actions.
- Project switching waits for STOP and robot handoff; reset cancellation preserves output ownership.
- Cleared stale predictions and incompatible runtime state on provider changes.
- Shared duplicate pending camera connections and invalidated stale inference during connection changes.
- Verified Follow cancellation, target-loss safety, and independent output ownership regressions.
- Physical hardware acceptance passed, confirmed by Jonathan Delgado on 2026-09-30; Hummingbird Bit dedicated DC motor checks are N/A.
- Release verification: 198 tests passed, 0 failed; production build passed; physical stability acceptance passed.
