# Architecture

## Boundaries

```text
CameraManager → local video frame → VisionEngine → Detection[]
                                                     ↓
                                       RuleEngine / DetectionManager
                                                     ↓
                                                ActionEngine
                                                     ↓
                                                RobotAdapter
                                                     ↓
                                             MockRobotAdapter

ProjectStorage ↔ versioned project ↔ React UI
```

- `CameraManager` owns MediaStream acquisition, camera enumeration, track-ended notification, and teardown. The UI owns the video element.
- `VisionEngine` is an interface independent of robots and React. `YoloVisionEngine` owns ONNX session lifecycle, GPU/WASM selection, 640-pixel letterboxing, RGB CHW normalization, YOLOv8 output decoding, class-aware NMS, and tensor disposal.
- `Detection` exposes className, confidence, x/y/width/height and centerX/centerY in **original image pixels**, without mirroring. Canvas uses the same intrinsic resolution and contain fit as video. Future regions can normalize centerX by image width; future segmentation implementations can extend detections with mask data without affecting adapters.
- `DetectionManager` tracks class-level presence separately for each rule threshold. It produces appeared/disappeared flags and timing; it does not claim individual object identity.
- `RuleEngine` uses caller-provided monotonic time and no browser APIs. It qualifies duration, applies cooldown, and implements appearance, disappearance, continuous, and interval modes. Reset removes timing history.
- `ActionEngine` serializes a bounded sequence and rejects overlapping runs. AbortController interrupts waits/movements; stop goes directly to the adapter. Exceptions stop the adapter and notify the UI to pause AI. No action engine code knows about YOLO.
- `RobotAdapter` is the extension contract. The mock reports supported action kinds, publishes immutable display snapshots, and guarantees stop clears both wheels and sound. No fake real-hardware adapters are provided.
- `ProjectStorage` handles versioned JSON, validation, browser persistence, and export. Import limits: 1 MB, 50 rules, 30 actions per rule; numeric ranges and duplicate identifiers are checked.
- `UI` orchestrates these systems. `RuleCard` is the visual condition/action editor; `FinchView` renders mock state. Action definitions supply labels and choices. `App` owns camera/model lifecycle, project state, inference scheduling, dialogs, status, and safety shortcuts.

## Safety and lifecycle

AI begins disabled. It can only be enabled with the connected mock and either a real camera/model or explicit demo mode. Pausing disables the synchronous AI ref before aborting actions, so another frame cannot start movement. Hidden tabs suspend the inference loop. Session replacement invalidates earlier frame results and waits for any inference before releasing its model. Old frame callbacks cannot publish results after a source switch.

Action stop bypasses sequencing and preserves beak/tail colors. A busy engine does not collect future trigger work. Multiple rules triggering on the same tick are flattened in rule order; their actions are performed sequentially. The maximum program is bounded by project validation and UI limits. Real adapter work must add communication health checks and bounded device commands; browser stop attempts alone cannot guarantee physical stops after loss of communication.

## Scope limits

No FinchAdapter or HummingbirdAdapter is instantiated or advertised as working in milestone 1. Their planned transport is the existing local BlueBird HTTP service described in BIRDBRAIN.md. Camera inference will remain in the browser even if a local connector bridge becomes necessary for browser-origin policy.

Mock movement models signed wheel speeds for a duration, without pose/odometry. Sound is visual only. No autonomous following, segmentation, object IDs, or custom label sets are implemented. These are explicit future steps.
