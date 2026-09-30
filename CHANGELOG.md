# Changelog

## v0.5.0 — Classroom Stability Release

- Hardened emergency STOP so pending output resets cannot resume actions.
- Project switching waits for STOP and robot handoff; reset cancellation preserves output ownership.
- Cleared stale predictions and incompatible runtime state on provider changes.
- Shared duplicate pending camera connections and invalidated stale inference during connection changes.
- Verified Follow cancellation, target-loss safety, and independent output ownership regressions.
- Physical hardware acceptance passed, confirmed by Jonathan Delgado on 2026-09-30; Hummingbird Bit dedicated DC motor checks are N/A.
- Release verification: 198 tests passed, 0 failed; production build passed; physical stability acceptance passed.
