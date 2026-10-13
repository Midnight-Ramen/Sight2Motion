import { useEffect, useState } from 'react';
import type { setupReadiness } from '../core/SetupReadiness';
type Readiness = ReturnType<typeof setupReadiness>;
export function setupStatus(readiness: Readiness, running: boolean, canPlay: boolean, wasRunning: boolean) {
  const count = [readiness.camera, readiness.vision, readiness.robot, readiness.rules, readiness.play || running].filter(Boolean).length;
  const short = running ? 'Running' : canPlay ? wasRunning ? 'Paused' : 'Ready' : `Setup ${count}/5`;
  const full = running ? '\u25cf Running' : canPlay ? wasRunning ? 'Rules paused' : '\u2713 Ready to run' : `Setup ${count}/5 \u00b7 ${readiness.helper}`;
  return { count, short, full };
}
export function SetupStatus({ readiness, running, canPlay, onStep }: { readiness: Readiness; running: boolean; canPlay: boolean; onStep: (id: string) => void }) {
  const [wasRunning, setWasRunning] = useState(running);
  useEffect(() => { if (running) setWasRunning(true); }, [running]);
  const status = setupStatus(readiness, running, canPlay, wasRunning);
  const steps = [
    { label: 'Start camera', done: readiness.camera, id: 'camera-panel' },
    { label: 'Load AI model', done: readiness.vision, id: 'model-panel' },
    { label: 'Connect robot', done: readiness.robot, id: 'robot-panel' },
    { label: 'Add rule', done: readiness.rules, id: 'rules' },
    { label: 'Bring it to life', done: readiness.play || running, id: 'play-controls' },
  ];
  return <div className="setup-status"><details>
    <summary aria-label={status.full}><span className="setup-status-full">{status.full}</span><span className="setup-status-short">{status.short}</span></summary>
    <nav className="setup-popover" aria-label="Setup steps">
      {steps.map(step => <button key={step.id} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onStep(step.id); }}>
        <span className={step.done ? 'setup-complete' : ''} aria-hidden="true">{step.done ? '\u2713' : '\u25cb'}</span>{step.label}
      </button>)}
    </nav>
  </details></div>;
}
