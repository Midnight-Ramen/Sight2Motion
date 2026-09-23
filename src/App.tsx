import { ObjectSelection } from './components/ObjectSelection';
import { orientDetections } from './core/CameraOrientation';
import { withDetectionRegions, REGION_BOUNDARIES } from './core/DetectionRegions';
import { detectionAreaRatio } from './core/DetectionDistance';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Aperture,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  Leaf,
  LoaderCircle,
  Plus,
  Play,
  Radio,
  Save,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { CameraManager } from './core/CameraManager';
import { VisionSession } from './core/VisionSession';
import { capabilitiesFor } from './core/VisionCapabilities';
import { normalizeTeachableMachineUrl } from './core/TeachableMachineUrl';
import { RuleEngine } from './core/RuleEngine';
import { ActionEngine } from './core/ActionEngine';
import type { RobotStatus } from './core/RobotAdapter';
import { ProjectStorage, parseProject } from './core/ProjectStorage';
import {
  makeAction,
  makeProject,
  makeRule,
  type Detection,
  type VisionResult,
  type VisionProviderKind,
  hasBoundingBox,
  type Project,
  type Action,
  type RobotType,
} from './core/types';
import { RuleCard } from './components/RuleCard';
import { ProjectObjects } from './components/ProjectObjects';
import { HummingbirdAdapter } from './core/HummingbirdAdapter';
import { ROBOTS, resetActions } from './core/RobotCapabilities';
import { FinchAdapter, type FinchStatus } from './core/FinchAdapter';
import { RobotRouter } from './core/RobotRouter';
import { HardwareTest } from './components/HardwareTest';
import { SensorInputs } from './components/SensorInputs';
import type { SensorState } from './core/Sensors';
import './styles.css';
const demoDetection: Detection = {
  className: 'person',
  confidence: 0.94,
  x: 410,
  y: 70,
  width: 350,
  height: 580,
  centerX: 585,
  centerY: 360,
};
export default function App() {
  const [project, setProject] = useState<Project>(makeProject);
  const projectRef = useRef(project);
  projectRef.current = project;
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);
  const log = useCallback(
    (text: string) =>
      setLogs((old) =>
        [{ time: new Date().toLocaleTimeString([], { hour12: false }), text }, ...old].slice(0, 60),
      ),
    [],
  );
  const [ai, setAi] = useState(false),
    aiRef = useRef(false);
  const robotMode = project.robotType;
  const [sensorState, setSensorState] = useState<SensorState>({});
  const sensorRef = useRef<SensorState>({});
  const latestVision = useRef<{ items: VisionResult[]; updatedAt: number }>({ items: [], updatedAt: -Infinity });
  const [hardwareBusy, setHardwareBusy] = useState(false);
  const [followContainer, setFollowContainer] = useState<HTMLDivElement | null>(null);
  const [finchStatus, setFinchStatus] = useState<FinchStatus>({
    connector: 'not-detected',
    connection: 'disconnected',
    message: 'Open BlueBird and connect Finch A, then attach here.',
  });
  const [finch] = useState(
    () =>
      new FinchAdapter((status) => {
        setFinchStatus(status);
        if (status.connection !== 'connected') {
          aiRef.current = false;
          setAi(false);
        }
      }),
  );
  const [hummingbirdStatus, setHummingbirdStatus] = useState<RobotStatus>({
    connector: 'not-detected', connection: 'disconnected', message: 'Connect Hummingbird Bit A in BlueBird, then attach here.',
  });
  const [hummingbird] = useState(() => new HummingbirdAdapter(status => {
    setHummingbirdStatus(status);
    if (status.connection !== 'connected') { aiRef.current = false; setAi(false); }
  }));
  const [robot] = useState(() => new RobotRouter(finch));
  const connected = robotMode === 'finch' ? finchStatus.connection === 'connected' : hummingbirdStatus.connection === 'connected';
  const [actions] = useState(
    () =>
      new ActionEngine(robot, log, () => {
        aiRef.current = false;
        setAi(false);
      }),
  );
  const [rules] = useState(() => new RuleEngine());
  const [camera] = useState(() => new CameraManager());
  const [vision] = useState(() => new VisionSession());
  const [availableClasses, setAvailableClasses] = useState<readonly string[]>(() => vision.getClasses());
  const providerKind = project.visionProvider ?? 'yolo';
  const visionCapabilities = capabilitiesFor(providerKind);
  const [tmUrlInput, setTmUrlInput] = useState(project.teachableMachineUrl ?? '');
  const [modelError, setModelError] = useState(false);
  const modelVersion = useRef(0);
  const modelWork = useRef<Promise<unknown>>(Promise.resolve());
  const [storage] = useState(() => new ProjectStorage());
  const cameraSource = project.cameraSource ?? 'local';
  const mirrorHorizontal = project.mirrorHorizontal ?? false;
  const [cameraError, setCameraError] = useState(false);
  const cameraAttempt = useRef(0);
  const networkImage = useRef<HTMLImageElement>(null);
  const [cameraOn, setCameraOn] = useState(false),
    [cameraBusy, setCameraBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [device, setDevice] = useState('');
  const [modelReady, setModelReady] = useState(false),
    [modelBusy, setModelBusy] = useState(false),
    [backend, setBackend] = useState('Not loaded');
  const [demo, setDemo] = useState(false),
    [demoVisible, setDemoVisible] = useState(true);
  const [detections, setDetections] = useState<VisionResult[]>([]),
    [measuredFps, setMeasuredFps] = useState(0);
  const [notice, setNotice] = useState(''),
    [showLog, setShowLog] = useState(true),
    [help, setHelp] = useState(false),
    [saved, setSaved] = useState<Project[] | null>(null);
  const [lastRule, setLastRule] = useState(''),
    [dirty, setDirty] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    modelInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null);
  const inference = useRef<Promise<void> | null>(null),
    loopVersion = useRef(0);
  const modalOpen = help || saved !== null;
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHelp(false);
        setSaved(null);
      }
      if (event.key === 'Tab') {
        const dialog = document.querySelector('.modal');
        const items = Array.from(
          dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href]') ??
            [],
        );
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [modalOpen]);
  const edit = (p: Project) => {
    if (aiRef.current || actions.busy) pause();
    setNotice('Changes ready. Press Play rules to run your updated actions.');
    setProject(p);
    setDirty(true);
    rules.reset();
  };
  const pause = useCallback(() => {
    aiRef.current = false;
    setAi(false);
    rules.reset();
    void actions.stop();
  }, [actions, rules]);
  useEffect(() => {
    if (!connected) pause();
  }, [connected, pause]);
  const stop = useCallback(() => {
    pause();
    log('STOP requested — AI is paused.');
    setNotice('STOP requested. Check your robot has stopped before continuing.');
  }, [pause, log]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (!(e.target instanceof HTMLInputElement && e.target.type === 'text')) e.preventDefault();
        stop();
      }
    };
    const hidden = () => {
      if (document.hidden) pause();
    };
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pause);
    return () => {
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pause);
      camera.stop();
      pause();
      ++modelVersion.current;
      void modelWork.current.catch(() => {}).then(async () => {
        await inference.current?.catch(() => {});
        await vision.dispose();
      });
    };
  }, [stop, pause, camera, vision]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const evaluateInputs = useCallback(
    (items: VisionResult[]) => {
      if (
        !aiRef.current ||
        !robot.connected
      )
        return;
      const p = projectRef.current;
      const triggered = rules.evaluate(p.rules, items, performance.now(), capabilitiesFor(p.visionProvider),
        { state: sensorRef.current, configuration: p.sensorConfiguration ?? [], available: p.robotType === 'hummingbird' && hummingbird.connected });
      const wasBusy = actions.busy;
      void actions.updateRules(triggered, rules.activeRules, { detections: items, width: camera.width || (demo ? 1280 : 0), height: camera.height || (demo ? 720 : 0) });
      if (wasBusy) return;
      if (triggered.length) {
        triggered.forEach((r) => log(`Running “${r.name}”`));
        setLastRule(triggered.map((r) => r.name).join(', '));
      }
    },
    [actions, robot, rules, log, hummingbird, camera, demo],
  );
  const consume = useCallback((items: VisionResult[]) => {
    setDetections(items);
    latestVision.current = { items, updatedAt: performance.now() };
    evaluateInputs(items);
  }, [evaluateInputs]);
  useEffect(() => {
    sensorRef.current = {};
    setSensorState({});
    if (robotMode !== 'hummingbird' || !connected || !project.sensorConfiguration?.length) return;
    hummingbird.sensors.start(project.sensorConfiguration ?? [], state => {
      sensorRef.current = state;
      setSensorState(state);
    });
    // Evaluate sensor loss even if inference is slow or a sensor request stalls.
    const timer = setInterval(() => {
      setSensorState({ ...sensorRef.current });
      if (!projectRef.current.rules.some(r => r.sensorConditions?.length)) return;
      const vision = latestVision.current;
      evaluateInputs(performance.now() - vision.updatedAt <= 1500 ? vision.items : []);
    }, 100);
    const stopSensors = () => hummingbird.sensors.stop();
    window.addEventListener('pagehide', stopSensors);
    return () => { clearInterval(timer); stopSensors(); window.removeEventListener('pagehide', stopSensors); };
  }, [robotMode, connected, project.id, project.sensorConfiguration, hummingbird, evaluateInputs]);
  useEffect(() => {
    const version = ++loopVersion.current;
    let timer: ReturnType<typeof setTimeout>;
    let oldClasses = '';
    const tick = async () => {
      const started = performance.now();
      if (document.hidden) {
        timer = setTimeout(tick, 500);
        return;
      }
      try {
        let items: VisionResult[] = [];
        if (demo)
          items =
            demoVisible && projectRef.current.vision.confidence <= 0.94 ? [demoDetection] : [];
        else if (cameraOn && modelReady) {
          if (inference.current) await inference.current;
          if (version !== loopVersion.current) return;
          const frame = camera.frame;
          if (!frame) { timer = setTimeout(tick, 100); return; }
          const work = vision
            .detect(frame, projectRef.current.vision.confidence)
            .then((result) => {
              items = result;
            });
          inference.current = work;
          try {
            await work;
          } finally {
            if (inference.current === work) inference.current = null;
          }
        }
        if (version !== loopVersion.current) return;
        if (vision.capabilities.boundingBoxes) {
          const frameWidth = demo ? 1280 : camera.width || 1280;
          const displayed = orientDetections(items, frameWidth, !demo && (projectRef.current.mirrorHorizontal ?? false));
          items = withDetectionRegions(displayed.filter(hasBoundingBox), frameWidth);
        items = items.filter(hasBoundingBox).map(d => ({ ...d, areaRatio: detectionAreaRatio(d,
          demo ? 1280 : camera.width || 1280,
          demo ? 720 : camera.height || 720) }));
        }
        consume(items);
        const qualifying = items.filter(d => d.confidence >= projectRef.current.vision.confidence);
        const classes = [...new Set(qualifying.map((d) => d.className))].sort().join(',');
        if (classes && classes !== oldClasses)
          log(
            `${demo ? 'Demo: ' : ''}${qualifying[0].className} detected · ${Math.round(qualifying[0].confidence * 100)}%${qualifying[0].region ? ` · ${qualifying[0].region.toUpperCase()}` : ''}`,
          );
        oldClasses = classes;
        setMeasuredFps(
          demo || (cameraOn && modelReady)
            ? Math.min(
                projectRef.current.vision.fps,
                1000 / Math.max(1, performance.now() - started),
              )
            : 0,
        );
      } catch {
        if (version !== loopVersion.current) return;
        pause();
        setModelReady(false);
        setModelError(true);
        setNotice(
          vision.capabilities.boundingBoxes ? 'Detection paused. Use a static YOLO11 COCO ONNX model (640 × 640, without NMS), then load it again.' : "Image classification paused. Reload your Teachable Machine model and try again.",
        );
        return;
      }
      timer = setTimeout(
        tick,
        Math.max(250, 1000 / projectRef.current.vision.fps - (performance.now() - started)),
      );
    };
    void tick();
    return () => {
      ++loopVersion.current;
      clearTimeout(timer);
    };
  }, [demo, demoVisible, cameraOn, modelReady, consume, vision, pause, log, mirrorHorizontal]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = demo ? 1280 : camera.width || 1280;
    c.height = demo ? 720 : camera.height || 720;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!visionCapabilities.boundingBoxes) return;
    if (project.rules.some(r => r.enabled && r.region && r.region !== 'anywhere')) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 8]);
      for (const boundary of REGION_BOUNDARIES) {
        ctx.beginPath(); ctx.moveTo(c.width * boundary, 0); ctx.lineTo(c.width * boundary, c.height); ctx.stroke();
      }
      ctx.font = '14px system-ui'; ctx.textAlign = 'center';
      ['LEFT', 'CENTER', 'RIGHT'].forEach((label, i) => ctx.fillText(label, c.width * (i + 0.5) / 3, 22));
      ctx.restore();
    }
    if (!project.vision.visualize) return;
    for (const d of detections.filter(hasBoundingBox)) {
      ctx.strokeStyle = '#90efaa';
      ctx.lineWidth = 3;
      ctx.strokeRect(d.x, d.y, d.width, d.height);
      ctx.font = '600 22px system-ui';
      const text = `${d.className}  ${Math.round(d.confidence * 100)}%`;
      ctx.fillStyle = '#90efaa';
      ctx.fillRect(d.x, d.y - 34, ctx.measureText(text).width + 24, 34);
      ctx.fillStyle = '#17392c';
      ctx.fillText(text, d.x + 12, d.y - 10);
    }
  }, [detections, project.vision.visualize, project.rules, demo, visionCapabilities]);
  async function connectCamera(source: 'local' | 'network' = cameraSource) {
    const attempt = ++cameraAttempt.current;
    pause(); setDemo(false); setCameraOn(false); setCameraError(false);
    setCameraBusy(true); setNotice('');
    const ended = () => {
      if (attempt !== cameraAttempt.current) return;
      ++loopVersion.current;
      setCameraOn(false); setCameraError(true); pause(); consume([]);
      setNotice('Camera not reachable. Check that the camera is powered on and reachable from this network.');
    };
    try {
      if (source === 'network') {
        await camera.connectNetwork(networkImage.current!, project.networkCameraUrl || 'http://10.0.5.11/stream', ended);
      } else {
        const list = await camera.connect(video.current!, device);
        if (attempt !== cameraAttempt.current) return;
        setDevices(list);
        camera.onEnded(ended);
      }
      if (attempt !== cameraAttempt.current) return;
      setCameraOn(true);
      log('Camera connected. Frames are processed in this browser.');
    } catch (error) {
      if (attempt !== cameraAttempt.current) return;
      console.warn('Camera connection failed:', error);
      setCameraOn(false); setCameraError(true);
      setNotice(source === 'network'
        ? 'Camera not reachable. Check that the camera is powered on and reachable from this network. The browser may have blocked the network camera connection.'
        : 'Camera unavailable. Allow camera access in your browser, close other camera apps, and try again. You can also try the demo.');
    } finally {
      if (attempt === cameraAttempt.current) setCameraBusy(false);
    }
  }
  function disconnectCamera() {
    ++cameraAttempt.current; ++loopVersion.current;
    camera.stop(); pause(); consume([]);
    setCameraOn(false); setCameraBusy(false); setCameraError(false); setDemo(false);
  }
  function switchCamera(source: 'local' | 'network') {
    disconnectCamera();
    edit({ ...project, cameraSource: source,
      ...(source === 'network' ? { networkCameraUrl: project.networkCameraUrl || 'http://10.0.5.11/stream' } : {}) });
    void connectCamera(source);
  }
  function resetModel(kind: VisionProviderKind) {
    pause();
    setDemo(false);
    setModelReady(false);
    setModelBusy(false);
    setModelError(false);
    setBackend('Not loaded');
    setDetections([]);
    setAvailableClasses([]);
    ++loopVersion.current;
    const version = ++modelVersion.current;
    const work = modelWork.current.catch(() => {}).then(async () => {
      await inference.current?.catch(() => {});
      if (version !== modelVersion.current) return;
      await vision.select(kind);
      if (version === modelVersion.current) setAvailableClasses([...vision.getClasses()]);
    });
    modelWork.current = work.catch(() => {});
  }
  function changeProvider(kind: VisionProviderKind) {
    resetModel(kind);
    edit({ ...project, visionProvider: kind });
  }
  async function loadModel(file?: File) {
    pause();
    setDemo(false);
    setModelBusy(true);
    setModelReady(false);
    setModelError(false);
    setDetections([]);
    setNotice('');
    ++loopVersion.current;
    const version = ++modelVersion.current;
    const kind = providerKind;
    const previous = modelWork.current;
    const work = (async () => {
      await previous.catch(() => {});
      await inference.current?.catch(() => {});
      if (version !== modelVersion.current) return;
      const model = kind === 'teachable-machine' ? normalizeTeachableMachineUrl(tmUrlInput) :
        file ? new Uint8Array(await file.arrayBuffer()) : './models/yolo11n.onnx';
      await vision.select(kind);
      const result = await vision.load(model);
      if (version !== modelVersion.current) return;
      const labels = [...vision.getClasses()];
      setAvailableClasses(labels);
      setProject(current => {
        const selected = current.selectedClasses.filter(c => labels.includes(c));
        return { ...current, visionProvider: kind,
          ...(kind === 'teachable-machine' ? { teachableMachineUrl: model as string } : {}),
          selectedClasses: selected.length ? selected : labels.slice(0, kind === 'yolo' ? 1 : 10) };
      });
      setDirty(true);
      setBackend(result);
      setModelReady(true);
      log(`AI model ready · ${result}`);
    })();
    modelWork.current = work;
    try {
      await work;
    } catch (error) {
      if (version !== modelVersion.current) return;
      setModelError(true);
      setBackend('Not loaded');
      setNotice(
        kind === 'teachable-machine' ? "We couldn't load this Teachable Machine model. Check the model link and try again." :
          'YOLO11n could not load. Use an FP32 COCO detection ONNX model, 640 × 640, without NMS. ' + String(error),
      );
    } finally {
      if (version === modelVersion.current) setModelBusy(false);
    }
  }
  function toggleAI() {
    if (ai) {
      pause();
      log('AI paused. Detection continues.');
      return;
    }
    if (
      !robot.connected || hardwareBusy ||
      (!demo && (!cameraOn || !modelReady))
    ) {
      setNotice('Connect your selected robot and start the camera + model, or try the demo first.');
      return;
    }
    rules.reset();
    aiRef.current = true;
    setAi(true);
    setNotice('');
    log('AI enabled. Your rules are listening.');
  }
  function startDemo() {
    disconnectCamera();
    if (providerKind !== 'yolo') changeProvider('yolo');
    pause();
    camera.stop();
    setCameraOn(false);
    setDemo(true);
    setDemoVisible(true);
    setNotice('Demo mode uses a simulated person detection. No camera or AI model is running.');
    log('Demo scene ready. Attach your robot, then enable AI.');
  }
  async function selectRobot(mode: RobotType, updateProject = true) {
    aiRef.current = false;
    setAi(false);
    rules.reset();
    setHardwareBusy(true);
    try {
      await actions.stop();
      await robot.select(mode === 'finch' ? finch : hummingbird);
    } catch {
      setNotice(
        'Could not confirm STOP on the previous robot. Check it physically before continuing.',
      );
    } finally {
      if (updateProject) {
        setProject(current => ({ ...current, robotType: mode, rules: [], sensorConfiguration: [] }));
        setDirty(true);
        setLastRule('');
        setNotice('Robot changed. Rules and sensor conditions cleared.');
      }
      setHardwareBusy(false);
    }
  }
  async function attachRobot() {
    aiRef.current = false;
    setAi(false);
    rules.reset();
    setHardwareBusy(true);
    try {
      await robot.connect();
      log(`BlueBird accepted attachment to ${ROBOTS[robotMode].name} A. Test its outputs first.`);
    } catch {
      log('Robot attachment failed. Check BlueBird and device A.');
    } finally {
      setHardwareBusy(false);
    }
  }
  async function detachRobot() {
    pause();
    setHardwareBusy(true);
    try {
      await robot.disconnect();
    } catch {
      setNotice('Stop could not be confirmed. Check the robot physically.');
    } finally {
      setHardwareBusy(false);
    }
  }
  async function hardwareAction(action: Action) {
    aiRef.current = false;
    setAi(false);
    rules.reset();
    setHardwareBusy(true);
    try {
      await actions.stop();
      const ok = await actions.run([action]);
      if (ok) log('Hardware test request completed. Please observe the physical robot.');
    } finally {
      setHardwareBusy(false);
    }
  }
  async function resetProjectOutputs() {
    aiRef.current = false;
    setAi(false);
    rules.reset();
    setHardwareBusy(true);
    try {
      const ok = connected ? await actions.reset(resetActions(robotMode, project.rules)) : (await actions.stop(), true);
      setProject(current => ({ ...current, rules: [], sensorConfiguration: [] }));
      setDirty(true);
      setLastRule('');
      setNotice(ok ? 'Project reset. Rules and sensor conditions cleared.' : 'Rules cleared. Robot output reset could not be confirmed.');
      log('Project reset; rules and sensor configuration cleared.');
    } finally { setHardwareBusy(false); }
  }
  function replaceProject(p: Project) {
    disconnectCamera();
    pause();
    if (p.robotType !== robotMode) void selectRobot(p.robotType, false);
    if ((p.visionProvider ?? 'yolo') !== providerKind || p.teachableMachineUrl !== project.teachableMachineUrl)
      resetModel(p.visionProvider ?? 'yolo');
    setTmUrlInput(p.teachableMachineUrl ?? '');
    setProject(p);
    setDirty(false);
    setLastRule('');
    setSaved(null);
    log(`Opened “${p.name}”`);
  }
  function preserve() {
    if (dirty) {
      storage.save(project);
      setDirty(false);
    }
  }
  function projectCommand(command: 'new' | 'duplicate' | 'save' | 'load' | 'export') {
    try {
      if (command === 'save') {
        storage.export(project);
        storage.save(project);
        setDirty(false);
        setNotice('Project file downloaded. Use Import to open it later.');
      } else if (command === 'load') {
        setSaved(storage.list());
      } else if (command === 'export') storage.export(project);
      else {
        preserve();
        const p =
          command === 'new'
            ? makeProject()
            : {
                ...structuredClone(project),
                id: crypto.randomUUID(),
                name: `${project.name.slice(0, 90)} copy`,
              };
        replaceProject(p);
        setDirty(true);
      }
    } catch {
      setNotice(
        'Your browser could not save or read projects. Export a JSON copy to keep your work.',
      );
    }
  }
  async function importFile(file: File) {
    try {
      if (file.size > 1_000_000) throw new Error();
      const p = parseProject(await file.text());
      preserve();
      replaceProject({ ...p, id: crypto.randomUUID() });
      setDirty(true);
      setNotice('Project imported. AI is paused.');
    } catch {
      setNotice(
        'That file could not be imported. Choose a valid Robot Studio JSON project under 1 MB.',
      );
    }
  }
  return (
    <>
      <header className="topbar">
        <a href="#" className="brand">
          <span className="brand-icon">
            <Aperture size={25} />
          </span>
          <span>
            Sight<span className="brand-light"> 2 Vision</span>
          </span>
          <span className="beta">BETA</span>
        </a>
        <div className="header-right">
          <span className="local-badge">
            <span /> Runs on your device
          </span>
          <button className="text-button" onClick={() => setHelp(true)}>
            <BookOpen size={16} /> Getting started
          </button>
          <button className="icon-button" aria-label="Help" onClick={() => setHelp(true)}>
            <CircleHelp size={19} />
          </button>
        </div>
      </header>
      <main>
        <div className="project-bar">
          <div>
            <div className="eyebrow breadcrumb">
              YOUR WORKSPACE <span>/</span> UNTITLED COLLECTION
            </div>
            <div className="title-line">
              <input
                aria-label="Project name"
                maxLength={100}
                value={project.name}
                onChange={(e) => edit({ ...project, name: e.target.value })}
              />
              <span className="save-status">{dirty ? 'Unsaved changes' : 'Local project'}</span>
            </div>
            <p>Teach your robot to see. Give it something to do.</p>
          </div>
          <div className="project-buttons">
            <button
              title="New project"
              aria-label="New project"
              onClick={() => projectCommand('new')}
            >
              <FilePlus2 size={17} />
            </button>
            <button
              title="Duplicate project"
              aria-label="Duplicate project"
              onClick={() => projectCommand('duplicate')}
            >
              <Copy size={17} />
            </button>
            <button onClick={() => projectCommand('load')}>
              <FolderOpen size={16} />
              Open
            </button>
            <button onClick={() => projectCommand('save')}>
              <Save size={16} />
              Save project
            </button>
            <details className="more-menu">
              <summary aria-label="Import and export">
                <ChevronDown size={16} />
              </summary>
              <div>
                <button onClick={() => projectCommand('export')}>
                  <Download size={15} />
                  Export JSON
                </button>
                <button onClick={() => projectInput.current?.click()}>
                  <Upload size={15} />
                  Import JSON
                </button>
              </div>
            </details>
          </div>
        </div>
        <nav className="workflow" aria-label="Setup steps">
          {[
            {
              label: 'Connect camera',
              done: cameraOn || demo,
              icon: Camera,
              action: () => void connectCamera(),
            },
            {
              label: 'Load AI model',
              done: modelReady || demo,
              icon: Sparkles,
              action: () => providerKind === 'yolo' ? modelInput.current?.click() : document.getElementById('tm-model-url')?.focus(),
            },
            {
              label: 'Connect robot',
              done: connected,
              icon: Radio,
              action: () =>
                document.getElementById('robot-panel')?.scrollIntoView({ behavior: 'smooth' }),
            },
            {
              label: 'Create a rule',
              done: project.rules.length > 0,
              icon: SlidersHorizontal,
              action: () =>
                document.getElementById('rules')?.scrollIntoView({ behavior: 'smooth' }),
            },
            { label: 'Bring it to life', done: ai, icon: Zap, action: toggleAI },
          ].map((s, i) => (
            <button key={s.label} onClick={s.action} disabled={cameraBusy || modelBusy}>
              <span className={`step-number ${s.done ? 'done' : ''}`}>
                {s.done ? <Check size={13} /> : i + 1}
              </span>
              {s.label}
              {i < 4 && <span className="step-line" />}
            </button>
          ))}
        </nav>
        {notice && (
          <div className="notice" role="status">
            <CircleHelp size={17} />
            <span>{notice}</span>
            <button aria-label="Dismiss message" onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="studio-grid">
          <section className="panel camera-panel">
            <div className="panel-heading">
              <h2>
                <Camera size={18} />
                Vision preview
              </h2>
              <span className={`status ${cameraOn || demo ? 'active' : ''}`}>
                <i />
                {demo ? 'Demo scene' : cameraSource === 'network' ? cameraBusy ? 'Connecting' : cameraError ? 'Error' : cameraOn ? 'Connected' : 'Disconnected' : cameraOn ? 'Camera live' : 'Camera off'}
              </span>
            </div>
            <div className="camera-source-controls">
              <label>Camera Source
                <select aria-label="Camera Source" value={cameraSource} onChange={e => switchCamera(e.target.value as 'local' | 'network')}>
                  <option value="local">Laptop Camera</option>
                  <option value="network">Network Camera</option>
                </select>
              </label>
              <label>Mirror horizontally
                <input type="checkbox" role="switch" aria-label="Mirror horizontally" checked={mirrorHorizontal}
                  onChange={e => { ++loopVersion.current; pause(); consume([]); edit({ ...project, mirrorHorizontal: e.target.checked }); }} />
              </label>
              {cameraSource === 'network' && <>
                <label>Stream URL<input aria-label="Stream URL" type="url" value={project.networkCameraUrl ?? 'http://10.0.5.11/stream'}
                  onChange={e => { disconnectCamera(); edit({ ...project, networkCameraUrl: e.target.value }); }} /></label>
                {cameraOn ? <button onClick={disconnectCamera}>Disconnect</button> :
                  <button disabled={cameraBusy} onClick={() => void connectCamera()}>{cameraBusy ? 'Connecting' : 'Connect'}</button>}
              </>}
            </div>
            <div className="camera-stage">
              <video ref={video} style={{ transform: mirrorHorizontal ? 'scaleX(-1)' : undefined }} muted playsInline className={cameraSource === 'local' && cameraOn && !demo ? '' : 'hidden'} />
              <img ref={networkImage} style={{ transform: mirrorHorizontal ? 'scaleX(-1)' : undefined }} alt="Network camera live feed" className={cameraSource === 'network' && cameraOn && !demo ? '' : 'hidden'} />
              {!cameraOn && !demo && (
                <div className="camera-empty">
                  <div className="viewfinder">
                    <Camera size={38} strokeWidth={1.2} />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <h3>A little vision. A lot of possibility.</h3>
                  <p>
                    Connect your camera to let your robot
                    <br />
                    discover the world around you.
                  </p>
                  <button className="primary" disabled={cameraBusy} onClick={() => void connectCamera()}>
                    {cameraBusy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Camera size={17} />
                    )}
                    Connect camera
                  </button>
                  <button className="demo-link" onClick={startDemo}>
                    Just exploring? Try the demo <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {demo && (
                <div className="demo-scene">
                  <span className="scene-label">SIMULATED CLASSROOM</span>
                  <div className="demo-window" />
                  <div className="demo-shelf" />
                  <div className="demo-desk" />
                  {demoVisible && (
                    <div className="demo-person">
                      <div className="person-head" />
                      <div className="person-body" />
                      <div className="person-arm left" />
                      <div className="person-arm right" />
                    </div>
                  )}
                  <span className="demo-caption">Sample detection • not a live camera</span>
                </div>
              )}
              <canvas ref={canvas} />
              <ObjectSelection key={[project.id, cameraSource, cameraOn, demo, mirrorHorizontal].join('-')} camera={camera} available={cameraOn && !demo} mirror={mirrorHorizontal} detections={detections} visionUpdatedAt={latestVision.current.updatedAt} trackingEnabled={providerKind === 'yolo' && modelReady}
                follow={robotMode === 'finch' ? { engine: actions, container: followContainer, available: connected && !hardwareBusy,
                  prepare: () => { aiRef.current = false; setAi(false); rules.reset(); } } : undefined} />
              {(demo || cameraOn) && (
                <div className="feed-top">
                  <span>
                    <span className="live-dot" />
                    {demo ? 'DEMO' : 'LIVE'}{' '}
                    <b>
                      {demo
                        ? '1280 × 720'
                        : `${camera.width || 0} × ${camera.height || 0}`}
                    </b>
                  </span>
                  <button
                    aria-label="Disconnect camera or exit demo"
                    onClick={() => {
                      disconnectCamera();
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              <div className="privacy-caption">
                <ShieldCheck size={13} />
                Frames are processed in this browser. No video is uploaded.
              </div>
            </div>
            <div ref={setFollowContainer} />
            <div className="preview-toolbar">
              <span>
                <ScanLine size={16} />
                <b>{detections.length}</b> {visionCapabilities.boundingBoxes ? 'objects detected' : 'class predictions'}
              </span>
              <span className="fps">{measuredFps.toFixed(0)} FPS</span>
              {visionCapabilities.boundingBoxes && <label className="visualization-toggle">
                <input
                  type="checkbox"
                  checked={project.vision.visualize}
                  onChange={(e) =>
                    edit({ ...project, vision: { ...project.vision, visualize: e.target.checked } })
                  }
                />
                <Eye size={16} />
                Show boxes
              </label>}
            </div>
            <div className="detection-strip">
              {detections.length ? (
                detections.map((d, i) => (
                  <span
                    className={`detection-chip ${!visionCapabilities.boundingBoxes && i === 0 ? 'top-prediction' : ''}`}
                    title={hasBoundingBox(d) ? `Box: x ${Math.round(d.x)}, y ${Math.round(d.y)}, width ${Math.round(d.width)}, height ${Math.round(d.height)}` : undefined}
                    key={i}
                  >
                    <span />
                    {d.className}
                    <b>{Math.round(d.confidence * 100)}%</b>
                  </span>
                ))
              ) : (
                <span className="muted">{visionCapabilities.boundingBoxes ? 'Detected objects' : 'Class predictions'} will appear here</span>
              )}
              {demo && (
                <button className="text-button" onClick={() => setDemoVisible((v) => !v)}>
                  {demoVisible ? 'Hide person' : 'Show person'}
                </button>
              )}
            </div>
          </section>
          <aside>
            <section className="panel robot-panel" id="robot-panel">
              <div className="panel-heading">
                <h2>
                  <Radio size={18} />
                  Your robot
                </h2>
                <span className={`status ${connected ? 'active' : ''}`}>
                  <i />
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <div className="robot-select">
                <label htmlFor="robot-type">Robot</label>
                <select
                  id="robot-type"
                  value={robotMode}
                  disabled={hardwareBusy}
                  onChange={(e) => void selectRobot(e.target.value as RobotType)}
                >
                  {Object.entries(ROBOTS).map(([value, config]) => <option key={value} value={value}>{config.name}</option>)}
                </select>
              </div>
              <HardwareTest
                robotType={robotMode}
                status={robotMode === 'finch' ? finchStatus : hummingbirdStatus}
                busy={hardwareBusy}
                onAttach={() => void attachRobot()}
                onDisconnect={() => void detachRobot()}
                onAction={action => void hardwareAction(action)}
                onReset={() => void resetProjectOutputs()}
                onStop={stop}
              />
              {robotMode === 'hummingbird' && <SensorInputs configuration={project.sensorConfiguration ?? []} state={sensorState}
                onChange={sensorConfiguration => edit({ ...project, sensorConfiguration })} />}
            </section>
            <section className="panel model-panel">
              <div className="panel-heading">
                <h2>
                  <Sparkles size={17} />
                  AI model
                </h2>
                <span className="tiny-tag">LOCAL</span>
              </div>
              <div className="model-body">
                <label>AI model
                  <select aria-label="AI model" value={providerKind} onChange={e => changeProvider(e.target.value as VisionProviderKind)}>
                    <option value="yolo">YOLO11n — Object Detection</option>
                    <option value="teachable-machine">Teachable Machine — Image Classification</option>
                  </select>
                </label>
                <div className="model-name">
                  <span className="model-icon">
                    <ScanLine size={20} />
                  </span>
                  <div>
                    <strong>{providerKind === 'yolo' ? 'YOLO11n' : 'Teachable Machine'}</strong>
                    <span>{visionCapabilities.boundingBoxes ? 'Object detection' : 'Image Classification'} · {availableClasses.length} classes</span>
                  </div>
                  <span className={`model-indicator ${modelReady ? 'ready' : ''}`} />
                </div>
                {providerKind === 'teachable-machine' && <label>Model URL
                  <input id="tm-model-url" aria-label="Model URL" type="url" value={tmUrlInput}
                    placeholder="https://teachablemachine.withgoogle.com/models/.../"
                    onChange={e => {
                      const value = e.target.value;
                      setTmUrlInput(value);
                      resetModel(providerKind);
                      let teachableMachineUrl: string | undefined;
                      try { teachableMachineUrl = normalizeTeachableMachineUrl(value); } catch { /* Keep invalid drafts out of saved projects. */ }
                      edit({ ...project, teachableMachineUrl });
                    }} />
                </label>}
                <div className="model-load">
                  <button disabled={modelBusy} onClick={() => loadModel()}>
                    {modelBusy ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Download size={14} />
                    )}{' '}
                    {modelBusy ? 'Loading…' : modelReady ? 'Reload model' : providerKind === 'yolo' ? 'Load local model' : 'Load Model'}
                  </button>
                  {providerKind === 'yolo' && <button
                    disabled={modelBusy}
                    title="Choose ONNX model file"
                    aria-label="Choose ONNX model file"
                    onClick={() => modelInput.current?.click()}
                  >
                    <FolderOpen size={16} />
                  </button>}
                </div>
                <span role="status">{modelBusy ? 'Loading…' : modelReady ? 'Ready' : modelError ? 'Error' : 'Not loaded'}</span>
                {!visionCapabilities.boundingBoxes && modelReady && <small>
                  ✓ Custom classes · ✓ Confidence rules · ✓ Robot actions<br />
                  — Bounding boxes · — Location · — Near / Far
                </small>}
                <span className="backend">{demo ? 'Demo bypasses AI inference' : backend}</span>
                {visionCapabilities.boundingBoxes && <label className="slider-label">
                  Confidence threshold <b>{Math.round(project.vision.confidence * 100)}%</b>
                  <input
                    type="range"
                    aria-label="Detection confidence"
                    min={10}
                    max={100}
                    value={project.vision.confidence * 100}
                    onChange={(e) =>
                      edit({
                        ...project,
                        vision: { ...project.vision, confidence: +e.target.value / 100 },
                      })
                    }
                  />
                </label>}
                <div className="settings-row">
                  <label>
                    Inference speed
                    <select
                      aria-label="Inference FPS"
                      value={project.vision.fps}
                      onChange={(e) =>
                        edit({ ...project, vision: { ...project.vision, fps: +e.target.value } })
                      }
                    >
                      {[1, 2, 4, 8, 12, 16, 24, 30].map((n) => (
                        <option key={n} value={n}>
                          {n} FPS
                        </option>
                      ))}
                    </select>
                  </label>
                  {cameraSource === 'local' && <label>
                    Camera
                    <select
                      aria-label="Camera selection"
                      value={device}
                      disabled={cameraBusy}
                      onChange={(e) => {
                        pause();
                        camera.stop();
                        setCameraOn(false);
                        setDevice(e.target.value);
                      }}
                    >
                      <option value="">Default camera</option>
                      {devices.map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Camera ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>}
                </div>
              </div>
            </section>
            <ProjectObjects key={`${project.id}:${providerKind}`} selected={project.selectedClasses} supported={availableClasses}
              capabilities={visionCapabilities}
              rules={project.rules} detections={detections} threshold={project.vision.confidence}
              live={cameraOn && modelReady && !demo}
              onChange={selectedClasses => edit({ ...project, selectedClasses })} />
          </aside>
        </div>
        <section id="rules" className="rules-section">
          <div className="section-heading">
            <div>
              <h2>
                <SlidersHorizontal size={20} />
                Your AI rules <span className="count">{project.rules.length}</span>
              </h2>
              <p role="status">{ai ? 'Running · Stop, then Play to test again with the object still visible.' : 'Paused · Press Play rules after making changes. Detection continues while paused.'}</p>
            </div>
            <div className="rules-controls">
              <button className="primary" disabled={ai || hardwareBusy} onClick={toggleAI}>
                <Play size={16} /> Play rules
              </button>
              <button onClick={stop}><Square size={16} /> Stop rules</button>              <button
                className="primary"
                disabled={project.rules.length >= 50}
                onClick={() => edit({ ...project, rules: [...project.rules, { ...makeRule(), className: project.selectedClasses[0], actions: [makeAction(ROBOTS[robotMode].actions[0])] }] })}
              >
                <Plus size={16} />
                Add rule
              </button>
            </div>
          </div>
          {project.rules.map((r, i) => (
            <RuleCard
              key={r.id}
              rule={r}
              detections={detections}
              selectedClasses={visionCapabilities.boundingBoxes ? project.selectedClasses : project.selectedClasses.filter(c => availableClasses.includes(c))}
              visionCapabilities={visionCapabilities}
              index={i}
              capabilities={ROBOTS[robotMode].actions}
              robotName={ROBOTS[robotMode].name}
              sensors={project.sensorConfiguration ?? []}
              sensorsAvailable={robotMode === 'hummingbird'}
              onChange={(rule) =>
                edit({
                  ...project,
                  rules: project.rules.map((old) => (old.id === r.id ? rule : old)),
                })
              }
              onDelete={() =>
                edit({ ...project, rules: project.rules.filter((old) => old.id !== r.id) })
              }
            />
          ))}
          {!project.rules.length && (
            <div className="empty-rules">
              <Sparkles size={26} />
              <h3>What should your robot notice?</h3>
              <p>Add your first rule to turn a detection into an action.</p>
              <button onClick={() => edit({ ...project, rules: [{ ...makeRule(), className: project.selectedClasses[0], actions: [makeAction(ROBOTS[robotMode].actions[0])] }] })}>
                <Plus size={16} />
                Create a rule
              </button>
            </div>
          )}
          <div className="tip">
            <Leaf size={16} />
            <span>
              <b>Start small, think big.</b> Try “if person is detected, turn the beak green.” Then
              make it your own.
            </span>
          </div>
        </section>
        <section className="event-log">
          <button className="log-heading" onClick={() => setShowLog(!showLog)}>
            <span>
              <Square size={14} />
              Activity log <b>{logs.length}</b>
            </span>
            <span>
              {showLog ? 'Hide' : 'Show'}
              <ChevronDown size={14} />
            </span>
          </button>
          {showLog && (
            <div className="log-lines" aria-live="polite">
              {logs.length ? (
                logs.slice(0, 8).map((l, i) => (
                  <div key={`${l.time}-${i}`}>
                    <time>{l.time}</time>
                    <span className="log-dot" />
                    {l.text}
                  </div>
                ))
              ) : (
                <p>Your robot’s story will appear here. Connect it to get started.</p>
              )}
            </div>
          )}
        </section>
        <footer>
          <span>
            <Aperture size={15} />
            Created by Jonathan Delgado
          </span>
          <span>
            Milestone 01 <span>·</span> See → Think → Do
          </span>
        </footer>
      </main>
      <div className="safety-bar">
        <div>
          <span className={`safety-dot ${ai ? 'on' : ''}`} />
          <b>{ai ? 'Your rules are listening' : 'You’re in control'}</b>
          <span>
            {ai
              ? lastRule
                ? `Last run: ${lastRule}`
                : 'Waiting for a matching detection'
              : 'AI is paused. Your robot only moves when you say so.'}
          </span>
        </div>
        <button className="stop-button" onClick={stop}>
          <Square size={17} fill="currentColor" />
          STOP ROBOT<kbd>space</kbd>
        </button>
      </div>
      <input
        className="hidden"
        ref={modelInput}
        type="file"
        accept=".onnx"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadModel(f);
          e.target.value = '';
        }}
      />
      <input
        className="hidden"
        ref={projectInput}
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = '';
        }}
      />
      {(help || saved !== null) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setHelp(false);
            setSaved(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={help ? 'Getting started' : 'Open project'}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              autoFocus
              onClick={() => {
                setHelp(false);
                setSaved(null);
              }}
            >
              <X size={20} />
            </button>
            {help ? (
              <>
                <span className="eyebrow">YOUR FIRST ROBOT EXPERIMENT</span>
                <h2>From seeing to doing.</h2>
                <p>
                  Start with the demo, or let your webcam do the seeing. Everything runs in this
                  browser.
                </p>
                <ol>
                  <li>
                    <b>Connect a camera.</b> Allow browser access, or choose “Try the demo.”
                  </li>
                  <li>
                    <b>Load the model.</b> Choose a YOLO11 COCO ONNX file: static 640 × 640, no NMS.
                    Teachers can place it at <code>public/models/yolo11n.onnx</code> for the Load
                    button.
                  </li>
                  <li>
                    <b>Attach your robot.</b> Select Finch 2 or Hummingbird Bit, connect device A in BlueBird, and test its physical outputs.
                  </li>
                  <li>
                    <b>Make a rule.</b> Start with person → beak green. The object must be visible
                    for 500 ms.
                  </li>
                  <li>
                    <b>Enable AI.</b> Show a person, then watch your Finch respond. Press space to
                    stop.
                  </li>
                </ol>
                <p className="help-note">
                  Demo detections are simulated. Robot actions control the attached physical device. Read the project README for model export
                  instructions.
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    setHelp(false);
                    startDemo();
                  }}
                >
                  Try the demo
                  <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <h2>Open a project</h2>
                <p>Saved on this browser. Current changes are saved before switching.</p>
                {saved?.length ? (
                  saved.map((p) => (
                    <button
                      className="saved-project"
                      key={p.id}
                      onClick={() => {
                        try {
                          preserve();
                          replaceProject(p);
                        } catch {
                          setNotice('Could not preserve this project. Export it before switching.');
                        }
                      }}
                    >
                      <FolderOpen size={20} />
                      <span>
                        {p.name}
                        <small>{p.rules.length} rules</small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  ))
                ) : (
                  <div className="empty-rules">
                    No saved projects yet. Save your first experiment or import a JSON file.
                  </div>
                )}
                <button onClick={() => projectInput.current?.click()}>
                  <Upload size={16} />
                  Import project
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
