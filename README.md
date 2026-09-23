# AI Vision Robot Studio

A student-friendly, local-first vision playground built with React, strict TypeScript, Vite, and ONNX Runtime Web. This is a standalone project in the Computer Vision + Yolo folder.

## Milestone 1

Connect a camera, load YOLO11n, see labeled bounding boxes, and use a visual **IF person → THEN beak green** rule with a real Finch. Finch 2 and Hummingbird Bit use BlueBird Connector device A. A clearly labeled demo supplies detections without a camera or model.

Also included: editable action sequences, drag and arrow-button reordering, timing/cooldown controls, a STOP button and spacebar shortcut, activity log, and local project save/load/duplicate/import/export.

## Teacher setup

1. Install a current Node.js LTS release on your classroom computer.
2. Open a terminal **in this `Computer Vision + Yolo` folder**, then run:

   ```sh
   npm ci
   npm run setup:model
   npm run dev
   ```

3. Open **http://127.0.0.1:5174** in Chrome or Edge. Keep the terminal open while teaching. Stop the development server with Ctrl+C afterward.
4. Click **Connect camera**, then allow camera access. Select another camera in the model panel and reconnect if necessary.
5. Click **Load local model**. The model and runtime are served from your own computer; video frames are never sent to a server.
6. Connect the robot as A in BlueBird, choose **Finch 2** or **Hummingbird Bit**, and click **Attach**. Test its connected outputs using the hardware test buttons. The starter Finch rule says person → beak green; select a compatible action for Hummingbird.
7. Press **Play rules**, stand in view for at least half a second, and observe the physical output. Move out of view and back to test a new appearance.

**Try the demo** supplies synthetic detections. Attach a real robot and enable AI to test rules with **Hide person / Show person**. This does not test the neural network.

## Stop and pause

The red **STOP ROBOT** button and **spacebar** pause AI and cancel the current action sequence immediately. Space still enters spaces in text fields while stopping the robot. Disconnecting the robot or camera, a camera track ending, hiding the tab, page exit, and inference/action failures also pause AI and attempt to stop the adapter. Detection continues while AI is paused, except in hidden tabs. Re-enable AI explicitly to resume.

Finch supports beak color, tail LEDs, wheel movement, and STOP. Hummingbird Bit supports single LEDs (ports 1–3), tri-color LEDs (1–2), position and rotation servos (1–4), Wait, and Stop outputs. Rotation servos support timed or continuous behavior with ownership per port. STOP targets active rotation outputs without changing position angles or LEDs. Initial attachment uses stopall to clear prior outputs. Bit has no dedicated DC motor action. See [BIRDBRAIN.md](BIRDBRAIN.md) for transport mappings and hardware validation status.

## Models and local processing

The default 10.7 MB YOLO11n ONNX model is included in this repository at `public/models/yolo11n.onnx`, so **Load local model** works after cloning. `npm run setup:model` verifies its SHA-256 and, if missing or changed, downloads the original export from [webnn/yolo11n](https://huggingface.co/webnn/yolo11n/blob/9c5acfdd74aaff2d0f47c51b878506361039a51f/onnx/yolo11n.onnx). Downloading weights requires internet; running inference does not. Other ONNX model files remain excluded from git.

You can instead choose a compatible `.onnx` file with the folder button. The implemented contract is **YOLO11 COCO object detection, float32 input `[1,3,640,640]`, output `[1,84,8400]`, no embedded NMS, 80 COCO labels**. Other label sets, dynamic image sizes, YOLOv5 objectness tensors, segmentation, and NMS-integrated exports are not supported yet. Model filenames are not evidence of compatibility.

To export your own copy from Ultralytics (on a teacher machine with Python):

```sh
python -m pip install ultralytics onnx
 yolo export model=yolo11n.pt format=onnx imgsz=640 batch=1 dynamic=False half=False nms=False opset=17
```

Copy the exported model to `public/models/yolo11n.onnx`. See [Ultralytics export documentation](https://docs.ultralytics.com/modes/export/). YOLO weights and Ultralytics code have their own [AGPL-3.0 / enterprise licensing terms](https://www.ultralytics.com/license); do not assume this repository changes their license.

The browser tries WebGPU with WASM operator fallback, then retries a WASM-only session if initialization fails. ONNX Runtime's WebGPU support and fallback are described in its [official documentation](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html). WASM uses one thread so cross-origin isolation is not required. Lower the requested FPS on slower classroom devices; the displayed FPS reflects processing capacity. A single inference is in flight at any time. Runtime WASM assets ship with the app, rather than loading from a CDN. Fonts may load from Google Fonts; system fonts work offline. Camera images are never saved.

## Rules

Each rule has a class, confidence threshold, minimum visible duration, cooldown, trigger mode, and ordered enabled actions. Defaults: 70%, 500 ms, 2000 ms, once per appearance. The model's confidence threshold filters detections first; set it at or below the lowest rule threshold you want to use.

The milestone tracks **class presence**, not individual objects. Several people in the frame count as one person appearance. A missing detection resets visible duration. While-visible rules repeat no faster than cooldown; interval rules use the greater of interval and cooldown. Disappearance rules need a qualified appearance first. Simultaneous rules run as one ordered sequence. Triggers arriving while a sequence is busy are dropped to prevent a movement backlog.

## Projects

Save downloads a JSON project file and also stores a browser copy. Students can restore the file using Import project. Reset project and changing the robot dropdown clear rules, conditions, and sensor configuration; save a file first to retain them. Open lists saved projects. New, Duplicate, Import, and Open preserve unsaved work before switching; if browser storage fails, export JSON first. Files include only the project name, schema version, selected real robot type, model selection, vision settings, rules, and action parameters. No model binaries or camera media are stored. Imported settings are validated, and AI stays paused. Browser storage is local to its origin/profile; export JSON to share or back up projects.

## Development and verification

```sh
npm test
npm run build
npm run typecheck
```

The tests cover DetectionManager, RuleEngine, ActionEngine (test-only transport doubles), and project validation. The production output is `dist/`. Serve it over localhost or HTTPS; opening `index.html` directly will not provide camera access.

For the repeatable browser integration check, leave Vite running and run `npm run test:browser`. It requires installed Chrome, downloads an upstream Ultralytics image fixture if needed, substitutes that prerecorded image for camera capture, forces WASM, and verifies real model detection → rule → green beak, spacebar stop, project storage, action editing, and mobile overflow. It never requests your physical webcam. Screenshots and the JSON report go to `test-results/`.

Physical webcam permission/device switching and actual WebGPU acceleration still need an interactive check on the target classroom hardware. Finch/Hummingbird hardware testing is not claimed.

## Next milestones

- **2:** FinchAdapter through BlueBird Connector, connection health, real bounded movement, individual tail LEDs, sound, and hardware safety tests.
- **3:** HummingbirdAdapter with its actual LED/servo capabilities.
- **4:** segmentation decoder, spatial regions, individual object tracking, and custom class metadata.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [BIRDBRAIN.md](BIRDBRAIN.md).


## Current project controls

Choose 1–10 model-supported classes in **Objects for this project**. Rules offer only selected classes. **Test objects** displays existing live detections. Edits pause rules; press **Play rules** to apply them and reset appearance triggers. Tail actions include checkboxes for LEDs 1–4; unselected LEDs keep their previous color.
