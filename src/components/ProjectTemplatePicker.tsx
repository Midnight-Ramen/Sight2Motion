import { useState } from 'react';
import { PROJECT_TEMPLATES, type ProjectTemplate, type TemplatePorts } from '../core/ProjectTemplates';

export function ProjectTemplatePicker({ onSelect, onClose }: {
  onSelect: (template: ProjectTemplate, ports: TemplatePorts) => Promise<void>; onClose: () => void;
}) {
  const [ports, setPorts] = useState<Record<string, TemplatePorts>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Start a Project">
    <button className="modal-close icon-button" autoFocus aria-label="Close project chooser" disabled={busy} onClick={onClose}>×</button>
    <h2>Start a Project</h2>
    {PROJECT_TEMPLATES.map(template => <div key={template.id} className="template-choice">
      <button disabled={busy || !!template.ports && (!ports[template.id]?.output || !!template.ports.sensor && !ports[template.id]?.sensor)}
        onClick={async () => {
          setBusy(true); setError('');
          try { await onSelect(template, ports[template.id] ?? {}); }
          catch (error) { console.warn('Template creation failed:', error); setError('Could not start this project. Check your selections and try again.'); }
          finally { setBusy(false); }
        }}><strong>{template.name}</strong><span>{template.description}</span></button>
      {template.ports && <p className="template-port-hint">Select the connected ports below, then choose this project.</p>}
      {template.ports && <div className="template-ports">
        {(['sensor', 'output'] as const).filter(kind => kind === 'output' || template.ports!.sensor).map(kind =>
          <label key={kind}>{kind === 'sensor' ? 'Distance sensor port' : `${template.ports!.output} port`}
            <select aria-label={`${template.name} ${kind} port`} disabled={busy} value={ports[template.id]?.[kind] ?? ''}
              onChange={e => setPorts(current => ({ ...current, [template.id]: { ...current[template.id], [kind]: Number(e.target.value) || undefined } }))}>
              <option value="">Select Port</option>
              {Array.from({ length: kind === 'sensor' ? 3 : template.ports!.max }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select></label>)}
      </div>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section></div>;
}
