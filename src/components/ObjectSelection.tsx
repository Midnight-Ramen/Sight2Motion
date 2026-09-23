import { useEffect, useRef, useState } from 'react';
import type { CameraManager } from '../core/CameraManager';
import type { MobileSAMSegmenter } from '../core/MobileSAMSegmenter';
import { sourceClick, type SelectedSegment } from '../core/SegmentationGeometry';
import { TargetTracker, type TrackedTarget } from '../core/TargetTracker';
import type { VisionResult } from '../core/types';
import { TrackedFollowControls, type TrackedFollowAccess } from './TrackedFollowControls';

export function ObjectSelection({ camera, available, mirror, detections, visionUpdatedAt, trackingEnabled, follow }: {
  camera: CameraManager; available: boolean; mirror: boolean; detections: VisionResult[];
  visionUpdatedAt: number; trackingEnabled: boolean;
  follow?: TrackedFollowAccess;
}) {
  const service = useRef<MobileSAMSegmenter | null>(null);
  const snapshot = useRef<HTMLCanvasElement | null>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const generation = useRef(0), locked = useRef(false);
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<SelectedSegment | null>(null);
  const [tracker] = useState(() => new TargetTracker());
  const [target, setTarget] = useState<TrackedTarget | null>(null);
  const trackedAt = useRef(-Infinity);
  const trackingCanvas = useRef<HTMLCanvasElement>(null);
  const capturedDetections = useRef<{ items: VisionResult[]; at: number;
    history: { items: VisionResult[]; at: number }[]; expired: boolean } | null>(null);
  useEffect(() => {
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
    const timer = setInterval(() => setTarget(tracker.age()), 100);
    return () => clearInterval(timer);
  }, [tracker]);
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
  function draw(segment?: SelectedSegment) {
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
  }
  async function capture() {
    if (locked.current || !camera.frame) return;
    locked.current = true; setBusy(true); setSelected(null);
    tracker.stop(); setTarget(null);
    capturedDetections.current = { items: trackingEnabled && performance.now() - visionUpdatedAt < 2500 ? detections : [],
      at: visionUpdatedAt, history: [], expired: false };
    const version = ++generation.current;
    try {
      snapshot.current ??= document.createElement('canvas');
      snapshot.current.width = camera.width; snapshot.current.height = camera.height;
      snapshot.current.getContext('2d')!.drawImage(camera.frame, 0, 0);
      setActive(true); setStatus('Loading MobileSAM…');
      // Defer only rendering; capture itself occurs immediately on button activation.
      requestAnimationFrame(() => { if (version === generation.current) draw(); });
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
    } catch (e) { if (version === generation.current) setStatus(String(e)); }
    finally { if (version === generation.current) { locked.current = false; setBusy(false); } }
  }
  async function select(event: React.MouseEvent<HTMLCanvasElement>) {
    if (locked.current || !service.current || !snapshot.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = sourceClick(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height,
      snapshot.current.width, snapshot.current.height, mirror);
    if (!point) return;
    locked.current = true; setBusy(true); setStatus('Segmenting…');
    const version = generation.current;
    try {
      const result = await service.current.select(point.x, point.y);
      if (version !== generation.current) return;
      setSelected(result); draw(result); setStatus('Object selected · frozen frame');
    } catch (e) { if (version === generation.current) setStatus(String(e)); }
    finally { if (version === generation.current) { locked.current = false; setBusy(false); } }
  }
  async function close() {
    const version = ++generation.current;
    const wasBusy = locked.current;
    locked.current = true; setBusy(true); setActive(false); setStatus(''); setSelected(null);
    tracker.stop(); setTarget(null); capturedDetections.current = null;
    if (wasBusy) service.current?.dispose(); else await service.current?.clear().catch(() => {});
    if (version !== generation.current) return;
    locked.current = false; setBusy(false);
    if (snapshot.current) { snapshot.current.width = 0; snapshot.current.height = 0; }
  }
  async function lockTarget() {
    const captured = capturedDetections.current;
    if (!selected || !captured || busy) return;
    if (!trackingEnabled || !Number.isFinite(captured.at) || captured.expired) {
      setStatus('Load YOLO11 and capture a fresh frame to enable tracking.'); return;
    }
    const matched = tracker.initialize(selected, captured.items, mirror, captured.at);
    if (!matched) {
      setStatus('Object selected. Live tracking unavailable: YOLO does not recognize this target.'); return;
    }
    // Replay existing detections, not a second inference pass, to bridge the frozen-frame interval.
    for (const frame of captured.history) tracker.update(frame.items, frame.at);
    trackedAt.current = captured.history.at(-1)?.at ?? captured.at;
    capturedDetections.current = null;
    setTarget(tracker.age()); setActive(false); setStatus('');
    // No more MobileSAM work while tracking; release the obsolete embedding.
    const version = generation.current;
    locked.current = true; setBusy(true);
    await service.current?.clear().catch(() => {});
    if (version === generation.current) { locked.current = false; setBusy(false); }
  }
  return <>
    {!active && target && <canvas ref={trackingCanvas} className="tracking-overlay" aria-label="Tracked target outline and center" />}
    {active && <canvas ref={view} className="selection-frame" aria-label="Frozen frame: click an object to segment"
      style={{ transform: mirror ? 'scaleX(-1)' : undefined, cursor: busy ? 'wait' : 'crosshair' }} onClick={select} />}
    <div className="selection-controls">
      <button disabled={!available || busy} onClick={() => void capture()}>{active ? 'Capture new frame' : 'Select Object'}</button>
      {active && <button onClick={close}>Back to live</button>}
      {active && selected && <button disabled={busy} onClick={lockTarget}>Lock target</button>}
      {target && <button onClick={close}>Stop Tracking</button>}
      {!active && target && <span role="status">{target.targetLost ? 'TARGET LOST' : target.state === 'TRACKING' ? 'TARGET LOCKED' : 'TARGET UNCERTAIN'} · {target.label}
        {' · '}X error {target.horizontalError.toFixed(2)}</span>}
      {status && <span role="status">{status}</span>}
      {selected && <small>{selected.area.toLocaleString()} pixels selected</small>}
    </div>
    {follow && <TrackedFollowControls target={active ? null : target} capturedAt={trackedAt.current} timeout={tracker.lossTimeoutMs}
      access={{ ...follow, available: follow.available && available && trackingEnabled && !active }} />}
  </>;
}
