import { AppearanceTracker } from '../core/AppearanceTracker';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CameraManager } from '../core/CameraManager';
import type { MobileSAMSegmenter } from '../core/MobileSAMSegmenter';
import { sourceClick, type SelectedSegment } from '../core/SegmentationGeometry';
import { TargetTracker, type TrackedTarget } from '../core/TargetTracker';
import type { VisionResult } from '../core/types';
import { TrackedFollowControls, type TrackedFollowAccess } from './TrackedFollowControls';
import type { SAMPrompts } from '../core/SAMPrompts';
import { associateSelection } from '../core/SAMAssociation';

export function ObjectSelection({ camera, available, mirror, detections, visionUpdatedAt, trackingEnabled, follow, controlsContainer, savedNames = [], onSaveName, onTracking }: {
  onTracking?: (target: TrackedTarget | null) => void;
  savedNames?: string[]; onSaveName?: (name: string) => void;
  camera: CameraManager; available: boolean; mirror: boolean; detections: VisionResult[];
  visionUpdatedAt: number; trackingEnabled: boolean;
  follow?: TrackedFollowAccess;
  controlsContainer?: HTMLElement | null;
}) {
  const service = useRef<MobileSAMSegmenter | null>(null);
  const snapshot = useRef<HTMLCanvasElement | null>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const generation = useRef(0), locked = useRef(false);
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<SelectedSegment | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'positive' | 'negative' | 'box'>('positive');
  const [prompts, setPrompts] = useState<SAMPrompts>({ points: [] });
  const history = useRef<SAMPrompts[]>([]);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ items: detections, at: visionUpdatedAt });
  latest.current = { items: detections, at: visionUpdatedAt };
  const [association, setAssociation] = useState<{ label: string; items: VisionResult[]; at: number } | null>(null);
  const [appearance] = useState(() => new AppearanceTracker());
  const appearanceActive = useRef(false);
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null);
  const lastVersion = useRef(-1);
  function pixels(frame: CanvasImageSource, width: number, height: number) {
    const c = sampleCanvas.current ??= document.createElement('canvas');
    c.width = 160; c.height = Math.round(height * 160 / width);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(frame, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  }
  const [tracker] = useState(() => new TargetTracker());
  const [target, setTarget] = useState<TrackedTarget | null>(null);
  useEffect(() => { onTracking?.(target); }, [target, onTracking]);
  useEffect(() => () => { onTracking?.(null); }, [onTracking]);
  useEffect(() => {
    if (appearanceActive.current && target && !savedNames.includes(target.displayName ?? '')) {
      appearanceActive.current = false; appearance.stop(); setTarget(null);
    }
  }, [savedNames, target, appearance]);
  const trackedAt = useRef(-Infinity);
  const trackingCanvas = useRef<HTMLCanvasElement>(null);
  const capturedDetections = useRef<{ items: VisionResult[]; at: number;
    history: { items: VisionResult[]; at: number }[]; expired: boolean } | null>(null);
  useEffect(() => {
    if (appearanceActive.current) return;
    if (!trackingEnabled) { tracker.stop(); setTarget(null); return; }
    const captured = capturedDetections.current;
    if (captured && visionUpdatedAt > captured.at && captured.history.at(-1)?.at !== visionUpdatedAt) {
      captured.history.push({ items: detections, at: visionUpdatedAt });
      if (captured.history.length > 720 || visionUpdatedAt - captured.at > 180000) {
        captured.expired = true; captured.history.shift();
      }
    }
    const next = tracker.update(detections, visionUpdatedAt);
    trackedAt.current = visionUpdatedAt;
    setTarget(next);
  }, [detections, visionUpdatedAt, trackingEnabled, tracker]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!appearanceActive.current) { setTarget(tracker.age()); return; }
      try {
        const frame = camera.frame, version = camera.frameVersion;
        if (available && frame && version !== lastVersion.current) {
          lastVersion.current = version;
          setTarget(appearance.update(pixels(frame, camera.width, camera.height), performance.now(), camera.width, camera.height));
          trackedAt.current = appearance.capturedAt;
        } else setTarget(appearance.age());
      } catch { appearance.stop(); appearanceActive.current = false; setTarget(null); setStatus('Tracking stopped. Capture a fresh frame.'); }
    }, 100);
    return () => clearInterval(timer);
  }, [tracker, appearance, camera, available]);
  useEffect(() => {
    const c = trackingCanvas.current;
    if (!c || !target) return;
    c.width = camera.width; c.height = camera.height;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (target.targetLost) return;
    const b = target.boundingBox;
    ctx.strokeStyle = target.state === 'TRACKING' ? '#38e69b' : '#ffc857';
    ctx.lineWidth = 3; ctx.setLineDash(target.state === 'TRACKING' ? [] : [8, 6]);
    ctx.strokeRect(b.x, b.y, b.width, b.height);
    ctx.beginPath(); ctx.moveTo(target.centerX - 10, target.centerY); ctx.lineTo(target.centerX + 10, target.centerY);
    ctx.moveTo(target.centerX, target.centerY - 10); ctx.lineTo(target.centerX, target.centerY + 10); ctx.stroke();
  }, [target, camera]);
  useEffect(() => () => { ++generation.current; service.current?.dispose(); }, []);
  function draw(segment?: SelectedSegment, prompt = prompts) {
    const c = view.current, image = snapshot.current;
    if (!c || !image) return;
    c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0);
    if (segment) {
      const pixels = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < segment.mask.length; i++) if (segment.mask[i]) {
        pixels.data[i * 4] = Math.round(pixels.data[i * 4] * 0.5 + 30);
        pixels.data[i * 4 + 1] = Math.round(pixels.data[i * 4 + 1] * 0.5 + 120);
        pixels.data[i * 4 + 2] = Math.round(pixels.data[i * 4 + 2] * 0.5 + 80);
      }
      ctx.putImageData(pixels, 0, 0);
    }
    ctx.lineWidth = 2;
    if (prompt.box) { ctx.strokeStyle = '#ffc857'; const b=prompt.box; ctx.strokeRect(b.x,b.y,b.width,b.height); }
    for (const p of prompt.points) {
      ctx.fillStyle = p.label ? '#147542' : '#b52c2c'; ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x,p.y,7,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      if (p.label) { ctx.moveTo(p.x-4,p.y);ctx.lineTo(p.x+4,p.y);ctx.moveTo(p.x,p.y-4);ctx.lineTo(p.x,p.y+4); }
      else { ctx.moveTo(p.x-3,p.y-3);ctx.lineTo(p.x+3,p.y+3);ctx.moveTo(p.x-3,p.y+3);ctx.lineTo(p.x+3,p.y-3); }
      ctx.stroke();
    }
  }
  function retryMatch(segment = selected, recentOnly = true) {
    if (!segment || !trackingEnabled) { setAssociation(null); return; }
    const captured = capturedDetections.current;
    const frames = recentOnly ? [latest.current] : [captured, latest.current];
    for (const frame of frames) {
      if (!frame || !Number.isFinite(frame.at) || (frame===latest.current && performance.now()-frame.at>2500)) continue;
      const match=associateSelection(segment,frame.items,mirror);
      if (match) { setAssociation({label:match.detection.className,items:frame.items,at:frame.at});
        setSelected({...segment,detectorLabel:match.detection.className});
        setStatus(`Target matched · YOLO class: ${match.detection.className} · Live tracking available`); return; }
    }
    setAssociation(null); setSelected({...segment,detectorLabel:null});
    setStatus('Object selected. Add it for appearance tracking without a YOLO class match. Keep the object still until tracking locks.');
  }
  function clearSelection() {
    history.current=[]; setPrompts({points:[]}); setSelected(null); setDisplayName(''); setAssociation(null);
    service.current?.clearSelection(); draw(undefined,{points:[]}); setStatus('Click an object · frozen frame');
  }
  async function capture() {
    if (locked.current || !camera.frame) return;
    locked.current = true; setBusy(true); setSelected(null);
    setDisplayName(''); setPrompts({points:[]}); history.current=[]; setAssociation(null);
    appearanceActive.current = false; appearance.stop();
    tracker.stop(); setTarget(null);
    capturedDetections.current = { items: trackingEnabled && performance.now() - visionUpdatedAt < 2500 ? detections : [],
      at: visionUpdatedAt, history: [], expired: false };
    const version = ++generation.current;
    try {
      snapshot.current ??= document.createElement('canvas');
      snapshot.current.width = camera.width; snapshot.current.height = camera.height;
      snapshot.current.getContext('2d')!.drawImage(camera.frame, 0, 0);
      setActive(true); setStatus('MobileSAM is loading. Wait a moment before selecting an object.');
      // Defer only rendering; capture itself occurs immediately on button activation.
      requestAnimationFrame(() => { if (version === generation.current) draw(undefined,{points:[]}); });
      if (!service.current) {
        const { MobileSAMSegmenter } = await import('../core/MobileSAMSegmenter');
        if (version !== generation.current) return;
        service.current = new MobileSAMSegmenter();
      }
      await service.current.load();
      if (version !== generation.current) return;
      setStatus('Preparing image…');
      await service.current.capture(snapshot.current);
      if (version === generation.current) setStatus('Click an object · frozen frame');
    } catch (e) { if (version === generation.current) { console.warn('Object selection failed:', e); setStatus('Object selection could not finish. Capture a new frame and try again.'); } }
    finally { if (version === generation.current) { locked.current = false; setBusy(false); } }
  }
  function pointFrom(event: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>) {
    if (!snapshot.current) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    return sourceClick(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height,
      snapshot.current.width, snapshot.current.height, mirror);
  }
  async function refine(next: SAMPrompts, undo = false) {
    if (locked.current || !service.current) return;
    if (!undo) history.current.push(prompts);
    setPrompts(next);
    if (!next.box && !next.points.some(p=>p.label===1)) {
      setSelected(null); setAssociation(null); service.current.clearSelection(); draw(undefined,next); return;
    }
    locked.current = true; setBusy(true); setStatus('Segmenting…');
    const version = generation.current;
    try {
      const result = await service.current.refine(next);
      if (version !== generation.current) return;
      const named={...result,displayName:displayName.trim() || 'Selected object'};
      setSelected(named); draw(named,next); retryMatch(named,false);
    } catch (e) { if (version === generation.current) { setSelected(null); setAssociation(null); draw(undefined,next); console.warn('Object selection failed:', e); setStatus('Object selection could not finish. Capture a new frame and try again.'); } }
    finally { if (version === generation.current) { locked.current = false; setBusy(false); } }
  }
  function select(event: React.MouseEvent<HTMLCanvasElement>) {
    if (mode==='box' || locked.current) return;
    const point=pointFrom(event); if (!point) return;
    if (mode==='negative' && !prompts.box && !prompts.points.some(p=>p.label===1)) { setStatus('Add a positive point or a box first.'); return; }
    void refine({...prompts,points:[...prompts.points,{...point,label:mode==='positive'?1:0}]});
  }
  async function close() {
    const version = ++generation.current;
    const wasBusy = locked.current;
    locked.current = true; setBusy(true); setActive(false); setStatus(''); setSelected(null);
    setDisplayName(''); setPrompts({points:[]}); history.current=[]; setAssociation(null);
    appearanceActive.current = false; appearance.stop();
    tracker.stop(); setTarget(null); capturedDetections.current = null;
    if (wasBusy) service.current?.dispose(); else await service.current?.clear().catch(() => {});
    if (version !== generation.current) return;
    locked.current = false; setBusy(false);
    if (snapshot.current) { snapshot.current.width = 0; snapshot.current.height = 0; }
  }
  async function lockTarget() {
    const captured = capturedDetections.current;
    if (!selected || !captured || busy) return;
    if (!trackingEnabled || !association || captured.expired) {
      setStatus('Load YOLO11 and capture a fresh frame to enable tracking.'); return;
    }
    const matched = tracker.initialize({...selected,displayName:displayName.trim() || 'Selected object'}, association.items, mirror, association.at);
    if (!matched) {
      retryMatch(); return;
    }
    // Replay existing detections, not a second inference pass, to bridge the frozen-frame interval.
    for (const frame of captured.history) if (frame.at>association.at) tracker.update(frame.items, frame.at);
    trackedAt.current = Math.max(captured.history.at(-1)?.at ?? association.at,association.at);
    capturedDetections.current = null;
    setTarget(tracker.age()); setActive(false); setStatus('');
    // No more MobileSAM work while tracking; release the obsolete embedding.
    const version = generation.current;
    locked.current = true; setBusy(true);
    await service.current?.clear().catch(() => {});
    if (version === generation.current) { locked.current = false; setBusy(false); }
  }
  async function addAppearanceTarget() {
    if (!selected || !snapshot.current || busy || !camera.frame) return;
    try {
      const name = displayName.trim() || 'Selected object';
      tracker.stop();
      appearance.initialize(pixels(snapshot.current, snapshot.current.width, snapshot.current.height), { ...selected, displayName: name }, mirror);
      const next = appearance.update(pixels(camera.frame, camera.width, camera.height), performance.now(), camera.width, camera.height);
      if (!next) { appearance.stop(); setStatus('Could not locate this appearance in the live frame. Keep the object still and capture again.'); return; }
      onSaveName?.(name);
      appearanceActive.current = true; lastVersion.current = camera.frameVersion;
      trackedAt.current = appearance.capturedAt; setTarget(next); setActive(false);
      capturedDetections.current = null;
      setStatus('Appearance tracking  -  one active object  -  Follow must be started separately.');
      await service.current?.clear().catch(() => {});
    } catch (e) { appearance.stop(); appearanceActive.current = false; setTarget(null); console.warn('Object selection failed:', e); setStatus('Object selection could not finish. Capture a new frame and try again.'); }
  }
  const controls = <div className={`selection-controls${active && controlsContainer ? ' selection-editor' : ''}`}>
      <button disabled={!available || busy} onClick={() => void capture()}>{active ? 'Capture new frame' : 'Select Object'}</button>
      {active && <button onClick={close}>Back to live</button>}
      {active && <>
        <label>Selection mode <select aria-label="Selection mode" disabled={busy} value={mode} onChange={e=>setMode(e.target.value as typeof mode)}>
          <option value="positive">Add to object</option><option value="negative">Remove from object</option><option value="box">Box Select</option>
        </select></label>
        <button disabled={busy || !history.current.length} onClick={()=>{const previous=history.current.pop();if(previous)void refine(previous,true);}}>Undo point</button>
        <button disabled={busy} onClick={clearSelection}>Clear selection</button>
      </>}
      {active && selected && <>
        <label>Target name <input list="saved-target-names" maxLength={80} value={displayName} disabled={busy} placeholder="Selected object"
          onChange={e=>{setDisplayName(e.target.value);setSelected({...selected,displayName:e.target.value.trim()||'Selected object'});}} /></label>
        <datalist id="saved-target-names">{savedNames.map(name=><option key={name} value={name}/>)}</datalist>
        <button disabled={busy || !available || (!savedNames.includes(displayName.trim() || 'Selected object') && savedNames.length >= 10)} onClick={()=>void addAppearanceTarget()}>Add object & track</button>
        <button disabled={busy} onClick={()=>retryMatch()}>Retry tracking match</button>
        <button disabled={busy || !association} onClick={lockTarget}>Lock target</button>
        <small>Name: {displayName.trim()||'Selected object'} · Positive points: {prompts.points.filter(p=>p.label===1).length} · Negative points: {prompts.points.filter(p=>p.label===0).length} · YOLO match: {association?.label??'none'}</small>
      </>}
      {target && <button onClick={close}>Stop Tracking</button>}
      {!active && target && <span role="status">{target.targetLost ? 'TARGET LOST' : target.state === 'TRACKING' ? 'TARGET LOCKED' : 'TARGET UNCERTAIN'} · Tracking: {target.displayName} · Detector: {target.detectorLabel}
        {' · '}X error {target.horizontalError.toFixed(2)}</span>}
      {status && <span role="status">{status}</span>}
      {available && !active && !target && !status && <span>Select an object in the camera view before using Selected Target.</span>}
      {selected && <small>{selected.area.toLocaleString()} pixels selected</small>}
    </div>;
  return <>
    {!active && target && <canvas ref={trackingCanvas} className="tracking-overlay" aria-label="Tracked target outline and center" />}
    {active && <canvas ref={view} className="selection-frame" aria-label="Frozen frame: click an object to segment"
      style={{ transform: mirror ? 'scaleX(-1)' : undefined, cursor: busy ? 'wait' : 'crosshair',touchAction:'none' }} onClick={select}
      onPointerDown={e=>{ if(mode==='box'&&!busy) {drag.current=pointFrom(e);e.currentTarget.setPointerCapture(e.pointerId);} }}
      onPointerMove={e=>{ const p=pointFrom(e),a=drag.current; if(!a||!p)return;
        draw(selected??undefined,{...prompts,box:{x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),width:Math.abs(a.x-p.x),height:Math.abs(a.y-p.y)}}); }}
      onPointerCancel={()=>{drag.current=null;draw(selected??undefined);}}
      onPointerUp={e=>{const a=drag.current,p=pointFrom(e);drag.current=null;if(!a||!p)return;
        if(Math.abs(a.x-p.x)>=3&&Math.abs(a.y-p.y)>=3) void refine({...prompts,box:{x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),width:Math.abs(a.x-p.x),height:Math.abs(a.y-p.y)}});
        else draw(selected??undefined);}} />}
    {active && controlsContainer ? createPortal(controls, controlsContainer) : controls}
    {follow && <TrackedFollowControls target={active ? null : target} capturedAt={trackedAt.current} timeout={tracker.lossTimeoutMs}
      access={{ ...follow, available: follow.available && available && (appearanceActive.current || trackingEnabled) && !active }} />}
  </>;
}
