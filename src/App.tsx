import { ManualDrive } from './components/ManualDrive';
import { SetupSection } from './components/SetupSection';
import { cameraFailure, modelGuidance, detectionEmpty } from './core/StudentGuidance';
import { LiveDiagnostics } from './components/LiveDiagnostics';
import { FOLLOW_STABILITY } from './core/FollowController';
import type { TrackedTarget } from './core/TargetTracker';
import { ObjectSelection } from './components/ObjectSelection';
import { orientDetections } from './core/CameraOrientation';
import { withDetectionRegions, REGION_BOUNDARIES } from './core/DetectionRegions';
import { detectionAreaRatio } from './core/DetectionDistance';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Aperture,
  Sun,
  Moon,
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
import { finchSensorDescriptor, type SensorState } from './core/Sensors';
import { ruleSource } from './core/types';
import './styles.css';
import './theme.css';
import { ProjectTemplatePicker } from './components/ProjectTemplatePicker';
import { selectProjectTemplate } from './core/ProjectTemplates';
import { setupReadiness, focusSetupSection, cameraGuidanceReady } from './core/SetupReadiness';
const networkCameras = [1, 2, 3, 4].map(number => ({
  name: `Camera ${number}`,
  url: `http://robosight-cam-${String(number).padStart(2, '0')}.local/stream`,
}));
const defaultNetworkCameraUrl = networkCameras[0].url;
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
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
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
  const latestVision = useRef<{ items: VisionResult[]; updatedAt: number; capturedAt: number }>({ items: [], updatedAt: -Infinity, capturedAt: -Infinity });
  const [manualStopRevision, setManualStopRevision] = useState(0);
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
  const [cameraError, setCameraError] = useState('');
  const cameraAttempt = useRef(0);
  const cameraConnecting = useRef(false);
  const projectTransition = useRef(0);
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
  const [customTracked, setCustomTracked] = useState<TrackedTarget | null>(null);
  const appearanceVisible = customTracked?.detectorLabel === 'appearance' && customTracked.state === 'TRACKING';
  const [setupOpen, setSetupOpen] = useState<string | null>(null);
  const toggleSetup = (id: string) => setSetupOpen(current => current === id ? null : id);
  const openSetup = (id: string) => { setSetupOpen(id); requestAnimationFrame(() => focusSetupSection(id)); };
  const [cameraExpanded, setCameraExpanded] = useState(false);
  const [usableFrame, setUsableFrame] = useState(false);
  const [, setDiagnosticNow] = useState(() => performance.now());
  useEffect(() => {
    let lastFrameAt = -Infinity, lastFrameVersion = -1;
    const update = () => {
      const now = performance.now();
      if (cameraOn && camera.frame && camera.frameVersion !== lastFrameVersion) {
        lastFrameVersion = camera.frameVersion;
        lastFrameAt = now;
      }
      setUsableFrame(cameraSource === 'network' ? camera.networkHealthy : cameraGuidanceReady(cameraOn, lastFrameAt, now));
      if (cameraOn || cameraBusy) setDiagnosticNow(now);
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [camera, cameraOn, cameraSource, cameraBusy]);
  const readiness = setupReadiness(project, {
    usableFrame: cameraOn && usableFrame, modelReady, classes: availableClasses,
    connected, hardwareBusy, running: ai, demo,
    trackedName: customTracked?.state === 'TRACKING' ? customTracked.displayName : undefined,
  });
  const setupGuidance = cameraBusy ? 'Camera connecting. Wait for the preview to appear.' :
    cameraError || (cameraOn && !usableFrame ? 'Camera frames are unavailable. Reconnect your camera.' : readiness.helper);
  const edit = (p: Project) => {
    if (aiRef.current || actions.busy) pause();
    setProject(p);
    setDirty(true);
    rules.reset();
  };
  const pause = useCallback(() => {
    setManualStopRevision(value => value + 1);
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
    (items: VisionResult[], capturedAt = performance.now()) => {
      if (
        (!aiRef.current && !actions.followingSelectedTarget) ||
        !robot.connected
      )
        return;
      const p = projectRef.current;
      const selectedSafety = !aiRef.current && actions.followingSelectedTarget;
      const evaluatedRules = selectedSafety ? p.rules.filter(r => ruleSource(r) !== 'vision' && r.actions.some(a => a.enabled && a.kind === 'stop')) : p.rules;
      const triggered = rules.evaluate(evaluatedRules, items, performance.now(), capabilitiesFor(p.visionProvider),
        { state: sensorRef.current, configuration: p.sensorConfiguration ?? [], available: robot.connected });
      if (selectedSafety && !rules.activeRules.length && !triggered.length) return;
      const wasBusy = actions.busy;
      void actions.updateRules(triggered, rules.activeRules, { detections: items, capturedAt, width: camera.width || (demo ? 1280 : 0), height: camera.height || (demo ? 720 : 0) });
      if (wasBusy) return;
      if (triggered.length) {
        triggered.forEach((r) => log(`Running “${r.name}”`));
        setLastRule(triggered.map((r) => r.name).join(', '));
      }
    },
    [actions, robot, rules, log, hummingbird, camera, demo],
  );
  const consume = useCallback((items: VisionResult[], capturedAt = performance.now()) => {
    setDetections(items);
    latestVision.current = { items, updatedAt: performance.now(), capturedAt };
    evaluateInputs(items, capturedAt);
  }, [evaluateInputs]);
  useEffect(() => {
    sensorRef.current = {};
    setSensorState({});
    if (!connected) return;
    const inputs = [...(project.sensorConfiguration ?? [])];
    if (robotMode === 'finch') for (const type of ['finchEncoderLeft', 'finchEncoderRight', 'finchDistance', 'finchLineLeft', 'finchLineRight'] as const) {
      if (!inputs.some(sensor => sensor.id === type)) inputs.push(finchSensorDescriptor(type));
    }
    if (!inputs.length) return;
    const provider = robotMode === 'finch' ? finch.sensors : hummingbird.sensors;
    provider.start(inputs, state => {
      sensorRef.current = state;
      setSensorState(state);
    });
    // Evaluate sensor loss even if inference is slow or a sensor request stalls.
    const timer = setInterval(() => {
      setSensorState({ ...sensorRef.current });
      if (!projectRef.current.rules.some(r => r.sensorConditions?.length)) return;
      const vision = latestVision.current;
      evaluateInputs(performance.now() - vision.updatedAt <= 1500 ? vision.items : [], vision.capturedAt);
    }, 100);
    const stopSensors = () => provider.stop();
    window.addEventListener('pagehide', stopSensors);
    return () => { clearInterval(timer); stopSensors(); window.removeEventListener('pagehide', stopSensors); };
  }, [robotMode, connected, project.id, project.sensorConfiguration, hummingbird, finch, evaluateInputs]);
  useEffect(() => {
    const version = ++loopVersion.current;
    let timer: ReturnType<typeof setTimeout>;
    let oldClasses = '';
    let lastFrameVersion = -1;
    const tick = async () => {
      const started = performance.now();
      if (document.hidden) {
        timer = setTimeout(tick, 500);
        return;
      }
      try {
        let items: VisionResult[] = [];
        let capturedAt = started;
        if (demo)
          items =
            demoVisible && projectRef.current.vision.confidence <= 0.94 ? [demoDetection] : [];
        else if (cameraOn && modelReady) {
          if (inference.current) await inference.current;
          if (version !== loopVersion.current) return;
          const frame = camera.frame;
          if (!frame) { timer = setTimeout(tick, 100); return; }
          const frameVersion = camera.frameVersion;
          if (frameVersion === lastFrameVersion) { timer = setTimeout(tick, 100); return; }
          lastFrameVersion = frameVersion;
          capturedAt = performance.now();
          // Keep the retention band available to an existing Follow lock only.
          const p = projectRef.current;
          const followRule = p.robotType === 'finch' && aiRef.current
            ? p.rules.find(r => r.id === actions.activeMotorOwnerRuleId && r.actions.some(a => a.enabled && a.kind === 'move' && a.mode === 'follow')) : undefined;
          const threshold = followRule ? Math.min(p.vision.confidence, Math.max(0, followRule.confidence - FOLLOW_STABILITY.confidenceMargin)) : p.vision.confidence;
          const work = vision
            .detect(frame, threshold)
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
        consume(items, capturedAt);
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
  }, [demo, demoVisible, cameraOn, modelReady, consume, vision, pause, log, mirrorHorizontal, actions]);
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
    if (cameraConnecting.current) return;
    cameraConnecting.current = true;
    ++loopVersion.current;
    pause();
    consume([]);
    const attempt = ++cameraAttempt.current;
    pause(); setDemo(false); setCameraOn(false); setCameraError('');
    setCameraBusy(true); setNotice('');
    const ended = () => {
      if (attempt !== cameraAttempt.current) return;
      ++loopVersion.current;
      setCameraOn(false); pause(); consume([]);
      if (source === 'network') {
        const warning = camera.networkDiagnostics.browserWarning;
        cameraConnecting.current = !warning; setCameraBusy(!warning);
        setCameraError(warning ?? 'Camera stream stopped. Reconnecting. Rules remain paused.');
      } else setCameraError('Camera stream stopped. Check its power and connection, then press Connect to retry.');
    };
    try {
      if (source === 'network') {
        await camera.connectNetwork(networkImage.current!, project.networkCameraUrl ?? defaultNetworkCameraUrl, ended, () => {
          if (attempt !== cameraAttempt.current) return;
          cameraConnecting.current = false; setCameraBusy(false); setCameraError(''); setCameraOn(true);
        });
      } else {
        const list = await camera.connect(video.current!, device);
        if (attempt !== cameraAttempt.current) return;
        setDevices(list);
        camera.onEnded(ended);
      }
      if (attempt !== cameraAttempt.current) return;
      if (source !== 'network') setCameraOn(true);
      log('Camera connected. Frames are processed in this browser.');
    } catch (error) {
      if (attempt !== cameraAttempt.current) return;
      console.warn('Camera connection failed:', error);
      cameraConnecting.current = false; setCameraBusy(false);
      setCameraOn(false);
      setCameraError((source === 'network' && camera.networkDiagnostics.browserWarning) || cameraFailure(source === 'network', error));
    } finally {
      if (attempt === cameraAttempt.current && source !== 'network') { cameraConnecting.current = false; setCameraBusy(false); }
    }
  }
  function disconnectCamera() {
    cameraConnecting.current = false;
    ++cameraAttempt.current; ++loopVersion.current;
    camera.stop(); pause(); consume([]);
    setCameraOn(false); setCameraBusy(false); setCameraError(''); setDemo(false);
  }
  function switchCamera(source: 'local' | 'network') {
    disconnectCamera();
    edit({ ...project, cameraSource: source,
      ...(source === 'network' ? { networkCameraUrl: project.networkCameraUrl ?? defaultNetworkCameraUrl } : {}) });
    void connectCamera(source);
  }
  function resetModel(kind: VisionProviderKind) {
    pause();
    setDemo(false);
    setModelReady(false);
    setModelBusy(false);
    setModelError(false);
    setBackend('Not loaded');
    consume([]);
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
  async function loadModel(file?: File, kind: VisionProviderKind = providerKind) {
    pause();
    setDemo(false);
    setModelBusy(true);
    setModelReady(false);
    setModelError(false);
    setDetections([]);
    setNotice('');
    ++loopVersion.current;
    const version = ++modelVersion.current;
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
      console.warn('Model load failed:', error);
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
    if (!readiness.play) {
      setNotice(readiness.helper);
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
    log('Demo scene ready. Connect your robot, then press Play rules.');
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
        setProject(current => ({ ...current, robotType: mode, rules: [], sensorConfiguration: [], customObjects: [] }));
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
      setProject(current => ({ ...current, rules: [], sensorConfiguration: [], customObjects: [] }));
      setDirty(true);
      setLastRule('');
      setNotice(ok ? 'Project reset. Rules and sensor conditions cleared.' : 'Rules cleared. Robot output reset could not be confirmed.');
      log('Project reset; rules and sensor configuration cleared.');
    } finally { setHardwareBusy(false); }
  }
  async function replaceProject(p: Project) {
    const transition = ++projectTransition.current;
    disconnectCamera();
    await actions.stop();
    if (transition !== projectTransition.current) return;
    if (p.robotType !== robotMode) await selectRobot(p.robotType, false);
    if (transition !== projectTransition.current) return;
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
  async function projectCommand(command: 'new' | 'duplicate' | 'save' | 'load' | 'export') {
    if (command === 'new') { pause(); setChoosingTemplate(true); return; }
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
        const p = {
                ...structuredClone(project),
                id: crypto.randomUUID(),
                name: `${project.name.slice(0, 90)} copy`,
              };
        await replaceProject(p);
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
      await replaceProject({ ...p, id: crypto.randomUUID() });
      setDirty(true);
      setNotice('Project imported. AI is paused.');
    } catch {
      setNotice(
        'That file could not be imported. Choose a valid Robot Studio JSON project under 1 MB.',
      );
    }
  }
  return (
    <div className="app-shell">
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
          <button className="theme-toggle" role="switch" aria-label="Dark mode" aria-checked={theme === 'dark'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')}>
            {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
            <span>{theme === 'dark' ? 'Dark' : 'Light'}</span><span className="theme-toggle-track" aria-hidden="true"><span /></span>
          </button>
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
                <div className="project-bar">
          <div>
            <div className="title-line">
              <input
                aria-label="Project name"
                placeholder="Click here to name your project"
                size={Math.max(20, project.name.length + 2)}
                onFocus={e => e.currentTarget.select()}
                maxLength={100}
                value={project.name === 'Name Your Project' || project.name === 'My first vision project' ? '' : project.name}
                onChange={(e) => edit({ ...project, name: e.target.value })}
              />
              <span className="save-status">{dirty ? 'Unsaved changes' : 'Local project'}</span>
            </div>
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

      </header>
      <main>
        <nav className="workflow" aria-label="Setup steps">
          {[
            {
              label: 'Start Camera',
              done: readiness.camera,
              icon: Camera,
              action: () => focusSetupSection('camera-panel'),
            },
            {
              label: 'Load AI model',
              done: readiness.vision,
              icon: Sparkles,
              action: () => openSetup('model-panel'),
            },
            {
              label: 'Connect robot',
              done: readiness.robot,
              icon: Radio,
              action: () =>
                openSetup('robot-panel'),
            },
            {
              label: 'Add Rule',
              done: readiness.rules,
              icon: SlidersHorizontal,
              action: () =>
                focusSetupSection('rules'),
            },
            { label: ai ? 'Running' : 'Bring it to life', done: readiness.play || ai, icon: Zap, action: () => focusSetupSection('play-controls') },
          ].map((s, i) => (
            <button key={s.label} onClick={s.action}>
              <span className={`step-number ${s.done ? 'done' : ''}`}>
                {s.done ? <Check size={13} /> : i + 1}
              </span>
              {s.label}
              {i < 4 && <span className="step-line" />}
            </button>
          ))}
        </nav>
        <p className="setup-guidance" role="status">{setupGuidance}</p>
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
          <div className="vision-column" role="region" aria-label="Vision and setup" tabIndex={0}>
          <section className={`panel camera-panel ${cameraExpanded ? 'camera-expanded' : 'camera-compact'}`} id="camera-panel" tabIndex={-1}>
            <div className="panel-heading">
              <h2>
                <Camera size={18} />
                Vision preview
              </h2>
              <button className="camera-size-toggle" aria-expanded={cameraExpanded} aria-controls="camera-view" onClick={() => setCameraExpanded(value => !value)}>{cameraExpanded ? 'Collapse camera' : 'Expand camera'}</button>
              <span className={`status ${cameraOn || demo ? 'active' : ''}`}>
                <i />
                {demo ? 'Demo scene' : cameraSource === 'network' ? cameraBusy ? 'Connecting' : cameraError ? 'Error' : cameraOn ? 'Connected' : 'Disconnected' : cameraOn ? 'Camera live' : 'Camera off'}
              </span>
            </div>
            <div className="camera-stage" id="camera-view">
              <video ref={video} style={{ transform: mirrorHorizontal ? 'scaleX(-1)' : undefined }} muted playsInline className={cameraSource === 'local' && cameraOn && !demo ? '' : 'hidden'} />
              <img ref={networkImage} style={{ transform: mirrorHorizontal ? 'scaleX(-1)' : undefined }} alt="Network camera live feed" className={cameraSource === 'network' && cameraOn && !demo ? '' : 'hidden'} />
              {!cameraOn && !demo && (
                <div className="camera-empty">
                  <h3>A little vision. A lot of possibility.</h3>
                  <button className="primary" disabled={cameraBusy} onClick={() => void connectCamera()}>
                    {cameraBusy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Camera size={17} />
                    )}
                    Start Camera
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
              <ObjectSelection key={[project.id, cameraSource, cameraOn, demo, mirrorHorizontal].join('-')} camera={camera} available={cameraOn && !demo} mirror={mirrorHorizontal} detections={detections} visionUpdatedAt={latestVision.current.capturedAt} trackingEnabled={providerKind === 'yolo' && modelReady}
                controlsContainer={followContainer}
                savedNames={project.customObjects} onTracking={setCustomTracked}
                onSaveName={name => { setProject(current => ({ ...current, customObjects: [...new Set([...(current.customObjects ?? []), name])].slice(0, 10) })); setDirty(true); }} follow={robotMode === 'finch' ? { engine: actions, container: followContainer, available: connected && !hardwareBusy,
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
            <div className="camera-source-controls">
              <label>Camera Source
                <select aria-label="Camera Source" value={cameraSource} onChange={e => switchCamera(e.target.value as 'local' | 'network')}>
                  <option value="local">Laptop Camera</option>
                  <option value="network">Network Camera</option>
                </select>
              </label>
              <label className="mirror-control">Mirror horizontally
                <input type="checkbox" role="switch" aria-label="Mirror horizontally" checked={mirrorHorizontal}
                  onChange={e => { ++loopVersion.current; pause(); consume([]); edit({ ...project, mirrorHorizontal: e.target.checked }); }} />
              </label>
              {cameraSource === 'network' && <>
                <label>Network camera
                  <select aria-label="Network camera" value={networkCameras.some(camera => camera.url === (project.networkCameraUrl ?? defaultNetworkCameraUrl)) ? (project.networkCameraUrl ?? defaultNetworkCameraUrl) : ''}
                    onChange={e => { disconnectCamera(); edit({ ...project, networkCameraUrl: e.target.value }); }}>
                    {networkCameras.map(camera => <option key={camera.url} value={camera.url}>{camera.name} — {new URL(camera.url).hostname}</option>)}
                    <option value="">Use another camera…</option>
                  </select>
                </label>
                <label>Stream URL<input aria-label="Stream URL" type="url" placeholder="http://your-camera.local/stream" value={project.networkCameraUrl ?? defaultNetworkCameraUrl}
                  onChange={e => { disconnectCamera(); edit({ ...project, networkCameraUrl: e.target.value }); }} /></label>
                {cameraOn || cameraBusy ? <button onClick={disconnectCamera}>Disconnect</button> :
                  <button disabled={cameraBusy} onClick={() => void connectCamera()}>{cameraBusy ? 'Connecting' : 'Connect'}</button>}
              </>}
            </div>
            <details className="selection-drawer"><summary>Selected object &amp; Follow controls</summary><div ref={setFollowContainer} /></details>
            <div className="preview-toolbar">
              <span>
                <ScanLine size={16} />
                <b>{detections.length}</b> {visionCapabilities.boundingBoxes ? 'objects detected' : 'class predictions'}
              </span>
              {appearanceVisible && <span>1 selected target tracked</span>}
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
              {appearanceVisible && <span className="detection-chip"><span />{customTracked.displayName}<b>Tracked selection</b></span>}
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
              ) : !appearanceVisible && (
                <span className="muted">{detectionEmpty(providerKind, (cameraOn && modelReady) || demo, !!project.customObjects?.length)}</span>
              )}
              {demo && (
                <button className="text-button" onClick={() => setDemoVisible((v) => !v)}>
                  {demoVisible ? 'Hide person' : 'Show person'}
                </button>
              )}
            </div>
          </section>
          <aside>
            <SetupSection id="model-panel" title="AI model" summary={`${providerKind === 'yolo' ? 'YOLO11n' : 'Teachable Machine'} · ${modelBusy ? 'Loading' : modelReady ? 'Ready' : 'Not loaded'}`} icon={<Sparkles size={18} />} open={setupOpen === 'model-panel'} onToggle={() => toggleSetup('model-panel')}>
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
                <span role="status">{modelGuidance(providerKind, modelBusy, modelReady, modelError, tmUrlInput)}</span>
                {!visionCapabilities.boundingBoxes && modelReady && <small>
                  ✓ Custom classes · ✓ Confidence rules · ✓ Robot actions<br />
                  — Bounding boxes · — Location · — Near / Far
                </small>}
                <details className="compact-advanced"><summary>Advanced vision settings</summary>
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
                </details>
              </div>
            </SetupSection>
            <SetupSection id="robot-panel" title="Your robot" summary={`${ROBOTS[robotMode].name} · ${connected ? 'Connected' : 'Disconnected'}`} icon={<Radio size={18} />} open={setupOpen === 'robot-panel'} onToggle={() => toggleSetup('robot-panel')}>
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
              {robotMode === 'finch' && <ManualDrive lineSensorProvider={finch.sensors} robot={robot} stopRevision={manualStopRevision} sensors={sensorState} engine={actions} connected={connected} running={ai} busy={hardwareBusy} open={setupOpen === 'robot-panel'} />}
            </SetupSection>
            <SetupSection id="sensors-panel" title="Sensors" summary={`${project.sensorConfiguration?.length ?? 0} configured · ${ROBOTS[robotMode].name}`} icon={<SlidersHorizontal size={18} />} open={setupOpen === 'sensors-panel'} onToggle={() => toggleSetup('sensors-panel')}>
              <SensorInputs robotType={robotMode} connected={connected} configuration={project.sensorConfiguration ?? []} state={sensorState}
                onChange={sensorConfiguration => edit({ ...project, sensorConfiguration })} />
            </SetupSection>
            <SetupSection id="objects-panel" title="Objects for this project" summary={[...project.selectedClasses, ...(project.customObjects ?? [])].join(', ') || 'None selected'} icon={<ScanLine size={18} />} open={setupOpen === 'objects-panel'} onToggle={() => toggleSetup('objects-panel')}>
            {!!project.customObjects?.length && <section className="project-objects" aria-label="Custom selected objects">
              <h3>My selected objects</h3>
              <div className="project-object-chips">{project.customObjects.map(name => <span className="project-object-chip" key={name}>{name} - {customTracked?.detectorLabel === 'appearance' && customTracked.displayName === name ? customTracked.state : 'Select to track'}
                <button aria-label={`Remove selected object ${name}`} onClick={() => edit({ ...project, customObjects: project.customObjects?.filter(n => n !== name) })}>×</button></span>)}</div>
              <p>Select an object in the camera and reuse its name to track it. One active target at a time. Names are saved; visual selections must be made again after loading. Use Follow selected target to follow these objects.</p>
            </section>}
            <ProjectObjects key={`${project.id}:${providerKind}`} selected={project.selectedClasses} supported={availableClasses}
              capabilities={visionCapabilities}
              rules={project.rules} detections={detections} threshold={project.vision.confidence}
              live={cameraOn && modelReady && !demo}
              onChange={selectedClasses => edit({ ...project, selectedClasses })} />
            </SetupSection>
            <SetupSection id="diagnostics-panel" title="Diagnostics" summary={ai ? 'Rules running' : 'Rules paused'} icon={<SlidersHorizontal size={18} />} open={setupOpen === 'diagnostics-panel'} onToggle={() => toggleSetup('diagnostics-panel')}>
        <LiveDiagnostics embedded project={project} detections={detections} target={customTracked} sensors={sensorState} networkCamera={camera.networkDiagnostics}
          ruleResults={rules.diagnostics} follow={actions.followSnapshot} camera={cameraOn && usableFrame}
          model={modelReady} robot={connected} running={ai} fps={measuredFps} demo={demo} />
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
            </SetupSection>
          </aside>
          <div className="workspace-secondary">
        <footer>
          <span>
            <Aperture size={15} />
            Created by Jonathan Delgado
          </span>
          <span>
            Milestone 01 <span>·</span> See → Think → Do
          </span>
        </footer>
          </div>
          </div>
        <section id="rules" className="rules-section" tabIndex={-1}>
          <div className="section-heading">
            <div>
              <h2>
                <SlidersHorizontal size={20} />
                Your AI rules <span className="count">{project.rules.length}</span><small className="rules-status" role="status">{ai ? 'Running' : 'Paused'}</small>
              </h2>
            </div>
            <div className="rules-controls">
              <button
                className="primary"
                disabled={project.rules.length >= 50}
                onClick={() => edit({ ...project, rules: [...project.rules, { ...makeRule(), className: project.selectedClasses[0], actions: [makeAction(ROBOTS[robotMode].actions[0])] }] })}
              >
                <Plus size={16} />
                Add rule
              </button>
            </div>
          </div>
          <p className="setup-guidance rules-guidance" id="play-blocker" aria-live="polite">Create rules to tell your robot what to do. {!ai && !readiness.play
            ? ` · Before Play: ${setupGuidance.replace(/^Next: /, '').replace(/^Ready! /, '')}` : ''}</p>
          {project.rules.map((r, i) => (
            <RuleCard
              key={r.id}
              rule={r}
              guidance={readiness.ruleProblems[r.id]}
              detections={detections}
              selectedClasses={visionCapabilities.boundingBoxes ? project.selectedClasses : project.selectedClasses.filter(c => availableClasses.includes(c))}
              visionCapabilities={visionCapabilities}
              index={i}
              capabilities={ROBOTS[robotMode].actions}
              robotName={ROBOTS[robotMode].name}
              sensors={project.sensorConfiguration ?? []}
              sensorsAvailable={true}
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
                Add Rule
              </button>
            </div>
          )}
          <div className="tip">
            <Leaf size={16} />
            <span>
              <b>Start small, think big.</b> Choose an object and add one robot action. Then
              make it your own.
            </span>
          </div>
        </section>
        </div>
      </main>
      <div className="safety-bar" id="play-controls" tabIndex={-1}>
              <button className="primary" disabled={ai || !readiness.play} aria-describedby={!readiness.play ? 'play-blocker' : undefined} onClick={toggleAI}>
                <Play size={16} /> {ai ? 'Running' : 'Play rules'}
              </button>

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
      {choosingTemplate && <ProjectTemplatePicker onClose={() => setChoosingTemplate(false)} onSelect={async (template, ports) => {
        preserve();
        await selectProjectTemplate(template, ports, replaceProject);
        setDirty(true);
        setChoosingTemplate(false);
        setNotice(template.helper ?? 'Project ready. Connect your camera and robot when you are ready. Rules are paused.');
        // Use the template's provider explicitly: this handler may still close over the previous project.
        if (template.id === 'follow' && (providerKind !== 'yolo' || !modelReady))
          await loadModel(undefined, 'yolo');
      }} />}
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
                    <b>Connect your robot.</b> Select Finch 2 or Hummingbird Bit, connect device A in BlueBird, and test its physical outputs.
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
    </div>
  );
}
