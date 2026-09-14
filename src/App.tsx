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
import { YoloVisionEngine } from './core/VisionEngine';
import { RuleEngine } from './core/RuleEngine';
import { ActionEngine } from './core/ActionEngine';
import { MockRobotAdapter, type MockState } from './core/RobotAdapter';
import { ProjectStorage, parseProject } from './core/ProjectStorage';
import {
  makeAction,
  makeProject,
  makeRule,
  type Detection,
  type Project,
  type Action,
} from './core/types';
import { RuleCard } from './components/RuleCard';
import { ProjectObjects } from './components/ProjectObjects';
import { FinchView } from './components/FinchView';
import { FinchAdapter, type FinchStatus } from './core/FinchAdapter';
import { RobotRouter } from './core/RobotRouter';
import { HardwareTest } from './components/HardwareTest';
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
  const [robotState, setRobotState] = useState<MockState>({
    connected: false,
    beak: '#ccd7d0',
    tails: Array(4).fill('#ccd7d0'),
    left: 0,
    right: 0,
    sound: null,
  });
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
  const [mockRobot] = useState(() => new MockRobotAdapter(setRobotState));
  const [robotMode, setRobotMode] = useState<'mock' | 'real'>('mock');
  const [hardwareBusy, setHardwareBusy] = useState(false);
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
  const [robot] = useState(() => new RobotRouter(mockRobot));
  const connected =
    robotMode === 'mock' ? robotState.connected : finchStatus.connection === 'connected';
  const [actions] = useState(
    () =>
      new ActionEngine(robot, log, () => {
        aiRef.current = false;
        setAi(false);
      }),
  );
  const [rules] = useState(() => new RuleEngine());
  const [camera] = useState(() => new CameraManager());
  const [vision] = useState(() => new YoloVisionEngine());
  const [storage] = useState(() => new ProjectStorage());
  const [cameraOn, setCameraOn] = useState(false),
    [cameraBusy, setCameraBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [device, setDevice] = useState('');
  const [modelReady, setModelReady] = useState(false),
    [modelBusy, setModelBusy] = useState(false),
    [backend, setBackend] = useState('Not loaded');
  const [demo, setDemo] = useState(false),
    [demoVisible, setDemoVisible] = useState(true);
  const [detections, setDetections] = useState<Detection[]>([]),
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
      void inference.current?.finally(() => vision.dispose());
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
  const consume = useCallback(
    (items: Detection[]) => {
      setDetections(items);
      if (
        !aiRef.current ||
        !(robot.current === mockRobot ? mockRobot.state.connected : finch.connected)
      )
        return;
      const triggered = rules.evaluate(projectRef.current.rules, items, performance.now());
      if (actions.busy) return;
      if (triggered.length) {
        triggered.forEach((r) => log(`Running “${r.name}”`));
        setLastRule(triggered.map((r) => r.name).join(', '));
        void actions.run(triggered.flatMap((r) => r.actions));
      }
    },
    [actions, robot, mockRobot, finch, rules, log],
  );
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
        let items: Detection[] = [];
        if (demo)
          items =
            demoVisible && projectRef.current.vision.confidence <= 0.94 ? [demoDetection] : [];
        else if (cameraOn && modelReady && video.current) {
          if (inference.current) await inference.current;
          if (version !== loopVersion.current) return;
          const work = vision
            .detect(video.current, projectRef.current.vision.confidence)
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
        consume(items);
        const classes = [...new Set(items.map((d) => d.className))].sort().join(',');
        if (classes && classes !== oldClasses)
          log(
            `${demo ? 'Demo: ' : ''}${items[0].className} detected · ${Math.round(items[0].confidence * 100)}%`,
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
        setNotice(
          'Detection paused. Use a static YOLOv8 COCO ONNX model (640 × 640, without NMS), then load it again.',
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
  }, [demo, demoVisible, cameraOn, modelReady, consume, vision, pause, log]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = demo ? 1280 : video.current?.videoWidth || 1280;
    c.height = demo ? 720 : video.current?.videoHeight || 720;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!project.vision.visualize) return;
    for (const d of detections) {
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
  }, [detections, project.vision.visualize, demo]);
  async function connectCamera() {
    pause();
    setDemo(false);
    setCameraBusy(true);
    setNotice('');
    try {
      const list = await camera.connect(video.current!, device);
      setDevices(list);
      setCameraOn(true);
      camera.onEnded(() => {
        setCameraOn(false);
        pause();
        setNotice('Camera disconnected. Connect it again to continue.');
      });
      log('Camera connected. Your video stays on this device.');
    } catch {
      setCameraOn(false);
      setNotice(
        'Camera unavailable. Allow camera access in your browser, close other camera apps, and try again. You can also try the demo.',
      );
    } finally {
      setCameraBusy(false);
    }
  }
  async function loadModel(file?: File) {
    pause();
    setDemo(false);
    setModelBusy(true);
    setModelReady(false);
    setNotice('');
    ++loopVersion.current;
    try {
      await inference.current;
      const result = await vision.load(
        file ? new Uint8Array(await file.arrayBuffer()) : './models/yolov8n.onnx',
      );
      setBackend(result);
      setModelReady(true);
      log(`AI model ready · ${result}`);
    } catch {
      setBackend('Not loaded');
      setNotice(
        'Model could not load. Choose a YOLOv8 COCO .onnx file exported at 640 × 640 without NMS. Open the guide for instructions.',
      );
    } finally {
      setModelBusy(false);
    }
  }
  function toggleAI() {
    if (ai) {
      pause();
      log('AI paused. Detection continues.');
      return;
    }
    if (
      !(robot.current === mockRobot ? mockRobot.state.connected : finch.connected) ||
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
    pause();
    camera.stop();
    setCameraOn(false);
    setDemo(true);
    setDemoVisible(true);
    setNotice('Demo mode uses a simulated person detection. No camera or AI model is running.');
    log('Demo scene ready. Connect the mock Finch, then enable AI.');
  }
  async function selectRobot(mode: 'mock' | 'real') {
    aiRef.current = false;
    setAi(false);
    rules.reset();
    setHardwareBusy(true);
    try {
      await actions.stop();
      await robot.select(mode === 'real' ? finch : mockRobot);
    } catch {
      setNotice(
        'Could not confirm STOP on the previous robot. Check it physically before continuing.',
      );
    } finally {
      setRobotMode(mode);
      setHardwareBusy(false);
    }
  }
  async function attachFinch() {
    aiRef.current = false;
    setAi(false);
    rules.reset();
    setHardwareBusy(true);
    try {
      await finch.connect();
      log('BlueBird accepted attachment to Finch A. Test its beak first.');
    } catch {
      log('Finch attachment failed. Check BlueBird and device A.');
    } finally {
      setHardwareBusy(false);
    }
  }
  async function detachFinch() {
    pause();
    setHardwareBusy(true);
    try {
      await finch.disconnect();
    } catch {
      setNotice('Stop could not be confirmed. Check the Finch physically.');
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
      const ok = await actions.run([action]);
      if (ok) log('Hardware test request completed. Please observe the physical Finch.');
    } finally {
      setHardwareBusy(false);
    }
  }
  async function manual(direction: Action['direction']) {
    pause();
    await actions.run([{ ...makeAction('move'), direction, duration: 700 }]);
  }
  function replaceProject(p: Project) {
    pause();
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
        storage.save(project);
        setDirty(false);
        setNotice('Project saved on this browser.');
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
            vision<span className="brand-light"> / robot studio</span>
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
              action: connectCamera,
            },
            {
              label: 'Load AI model',
              done: modelReady || demo,
              icon: Sparkles,
              action: () => modelInput.current?.click(),
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
                {demo ? 'Demo scene' : cameraOn ? 'Camera live' : 'Camera off'}
              </span>
            </div>
            <div className="camera-stage">
              <video ref={video} muted playsInline className={cameraOn && !demo ? '' : 'hidden'} />
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
                  <button className="primary" disabled={cameraBusy} onClick={connectCamera}>
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
              {(demo || cameraOn) && (
                <div className="feed-top">
                  <span>
                    <span className="live-dot" />
                    {demo ? 'DEMO' : 'LIVE'}{' '}
                    <b>
                      {demo
                        ? '1280 × 720'
                        : `${video.current?.videoWidth || 0} × ${video.current?.videoHeight || 0}`}
                    </b>
                  </span>
                  <button
                    aria-label="Disconnect camera or exit demo"
                    onClick={() => {
                      pause();
                      camera.stop();
                      setCameraOn(false);
                      setDemo(false);
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              <div className="privacy-caption">
                <ShieldCheck size={13} />
                Your camera stays yours. Video never leaves this device.
              </div>
            </div>
            <div className="preview-toolbar">
              <span>
                <ScanLine size={16} />
                <b>{detections.length}</b> objects detected
              </span>
              <span className="fps">{measuredFps.toFixed(0)} FPS</span>
              <label className="visualization-toggle">
                <input
                  type="checkbox"
                  checked={project.vision.visualize}
                  onChange={(e) =>
                    edit({ ...project, vision: { ...project.vision, visualize: e.target.checked } })
                  }
                />
                <Eye size={16} />
                Show boxes
              </label>
            </div>
            <div className="detection-strip">
              {detections.length ? (
                detections.map((d, i) => (
                  <span
                    className="detection-chip"
                    title={`Box: x ${Math.round(d.x)}, y ${Math.round(d.y)}, width ${Math.round(d.width)}, height ${Math.round(d.height)}`}
                    key={i}
                  >
                    <span />
                    {d.className}
                    <b>{Math.round(d.confidence * 100)}%</b>
                  </span>
                ))
              ) : (
                <span className="muted">Detected objects will appear here</span>
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
                <span className={`status ${robotState.connected ? 'active' : ''}`}>
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
                  onChange={(e) => void selectRobot(e.target.value as 'mock' | 'real')}
                >
                  <option value="mock">Mock Finch 2</option>
                  <option value="real">Finch 2 — Real Robot</option>
                </select>
                {robotMode === 'mock' && <span className="mock-chip">NO HARDWARE NEEDED</span>}
              </div>
              {robotMode === 'real' ? (
                <HardwareTest
                  status={finchStatus}
                  busy={hardwareBusy}
                  onAttach={() => void attachFinch()}
                  onDisconnect={() => void detachFinch()}
                  onBeak={(color) => void hardwareAction({ ...makeAction('beak'), color })}
                  onWheels={() =>
                    void hardwareAction({ ...makeAction('move'), speed: 10, duration: 1000 })
                  }
                  onStop={stop}
                />
              ) : (
                <>
                  {' '}
                  <FinchView state={robotState} />
                  <div className="robot-connect">
                    <button
                      className={robotState.connected ? 'secondary' : 'primary'}
                      onClick={async () => {
                        pause();
                        if (robotState.connected) {
                          await robot.disconnect();
                          log('Mock Finch disconnected.');
                        } else {
                          await robot.connect();
                          log('Mock Finch connected.');
                        }
                      }}
                    >
                      <Radio size={15} />
                      {robotState.connected ? 'Disconnect' : 'Connect mock Finch'}
                    </button>
                  </div>
                  <details className="manual-controls">
                    <summary>
                      Manual controls <SlidersHorizontal size={14} />
                    </summary>
                    <div className="manual-row">
                      {[
                        { dir: 'left', icon: ArrowLeft },
                        { dir: 'forward', icon: ArrowUp },
                        { dir: 'backward', icon: ArrowDown },
                        { dir: 'right', icon: ArrowRight },
                      ].map(({ dir, icon: Icon }) => (
                        <button
                          key={dir}
                          aria-label={`Move ${dir}`}
                          disabled={!robotState.connected}
                          onClick={() => manual(dir as Action['direction'])}
                        >
                          <Icon size={17} />
                        </button>
                      ))}
                      <label>
                        Beak
                        <input
                          type="color"
                          aria-label="Manual beak color"
                          disabled={!robotState.connected}
                          value={robotState.beak}
                          onChange={(e) => {
                            pause();
                            void actions.run([{ ...makeAction(), color: e.target.value }]);
                          }}
                        />
                      </label>
                    </div>
                    <p>Movement and sound are simulated.</p>
                  </details>
                </>
              )}
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
                <div className="model-name">
                  <span className="model-icon">
                    <ScanLine size={20} />
                  </span>
                  <div>
                    <strong>YOLOv8n</strong>
                    <span>Object detection · 80 classes</span>
                  </div>
                  <span className={`model-indicator ${modelReady ? 'ready' : ''}`} />
                </div>
                <div className="model-load">
                  <button disabled={modelBusy} onClick={() => loadModel()}>
                    {modelBusy ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Download size={14} />
                    )}{' '}
                    {modelBusy ? 'Loading…' : modelReady ? 'Reload model' : 'Load local model'}
                  </button>
                  <button
                    disabled={modelBusy}
                    title="Choose ONNX model file"
                    aria-label="Choose ONNX model file"
                    onClick={() => modelInput.current?.click()}
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
                <span className="backend">{demo ? 'Demo bypasses AI inference' : backend}</span>
                <label className="slider-label">
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
                </label>
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
                  <label>
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
                  </label>
                </div>
              </div>
            </section>
            <ProjectObjects key={project.id} selected={project.selectedClasses} supported={vision.getClasses()}
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
              <button className="primary" disabled={ai} onClick={toggleAI}>
                <Play size={16} /> Play rules
              </button>
              <button onClick={stop}><Square size={16} /> Stop rules</button>              <button
                className="primary"
                disabled={project.rules.length >= 50}
                onClick={() => edit({ ...project, rules: [...project.rules, { ...makeRule(), className: project.selectedClasses[0] }] })}
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
              selectedClasses={project.selectedClasses}
              index={i}
              capabilities={robot.getCapabilities()}
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
              <button onClick={() => edit({ ...project, rules: [makeRule()] })}>
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
            Made for curious minds.
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
                    <b>Load the model.</b> Choose a YOLOv8 COCO ONNX file: static 640 × 640, no NMS.
                    Teachers can place it at <code>public/models/yolov8n.onnx</code> for the Load
                    button.
                  </li>
                  <li>
                    <b>Connect Mock Finch.</b> Its beak, wheels, lights, and sound events appear on
                    screen.
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
                  Demo detections are simulated. Real hardware, segmentation, and individual object
                  tracking are future milestones. Read the project README for model export
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



