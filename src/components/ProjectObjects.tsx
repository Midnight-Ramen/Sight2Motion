import { useEffect, useRef, useState } from 'react';
import type { Detection, Rule } from '../core/types';
import { DetectionManager } from '../core/DetectionManager';
import { objectLabel, removalMessage } from '../core/ProjectObjects';

export function ProjectObjects({ selected, supported, rules, detections, threshold, live, onChange }: {
  selected: string[]; supported: readonly string[]; rules: Rule[]; detections: Detection[];
  threshold: number; live: boolean; onChange: (selected: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const manager = useRef(new DetectionManager());
  useEffect(() => {
    const next: Record<string, number> = {};
    manager.current.reset();
    if (testing && live) for (const name of selected) {
      if (manager.current.update(name, detections, name, threshold, performance.now()).visible)
        next[name] = Math.max(...detections.filter(d => d.className === name && d.confidence >= threshold).map(d => d.confidence));
    }
    setSeen(next);
  }, [detections, selected, threshold, testing, live]);
  const toggle = (name: string) => {
    if (selected.includes(name)) {
      const reason = removalMessage(name, selected, rules);
      if (reason) { setMessage(reason); return; }
      onChange(selected.filter(c => c !== name));
    } else {
      if (selected.length >= 10) { setMessage('Choose up to 10 objects for this project.'); return; }
      onChange([...selected, name]);
    }
    setMessage('');
  };
  const matches = supported.filter(c => c.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="project-objects" aria-label="Objects for this project">
    <h3>Objects for this project</h3>
    <div className="project-object-chips">{selected.map(name => <span key={name} className="project-object-chip">
      {objectLabel(name)}{!supported.includes(name) && ' · unavailable in this model'}
      <button aria-label={`Remove ${objectLabel(name)}`} onClick={() => toggle(name)}>×</button>
    </span>)}</div>
    <details className="object-picker">
      <summary>+ Choose objects</summary>
      <label>Search objects<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search this model’s objects" /></label>
      <p>Choose 1–10 objects. {selected.length} selected.</p>
      <div className="object-picker-options">{matches.map(name => <label key={name}>
        <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} />{objectLabel(name)}
      </label>)}</div>
      {!matches.length && <div role="status"><p>{objectLabel(query.trim())} is not available in this AI model.</p><p>Try another object. Custom object models can be added later.</p></div>}
    </details>
    {message && <p role="status">{message}</p>}
    <label className="vision-check-toggle"><input type="checkbox" checked={testing} onChange={e => setTesting(e.target.checked)} /> Test objects</label>
    {testing && <div className="vision-check">
      {!live && <p>Connect your camera and load the model to test objects.</p>}
      {selected.map(name => <div key={name}><span>{objectLabel(name)}</span><span>{seen[name] ? `✓ Seen ${Math.round(seen[name] * 100)}%` : '— Waiting'}</span></div>)}
    </div>}
  </section>;
}
