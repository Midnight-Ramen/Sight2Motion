import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { PROJECT_TEMPLATES, type ProjectTemplate, type TemplatePorts } from '../core/ProjectTemplates';

export function ProjectTemplatePicker({ onSelect, onClose }: {
  onSelect: (template: ProjectTemplate, ports: TemplatePorts) => Promise<void>; onClose: () => void;
}) {
  const [selected, setSelected] = useState<ProjectTemplate>();
  const [ports, setPorts] = useState<Record<string, TemplatePorts>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const template = selected;
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Start a Project"
    onKeyUp={event => {
      // Global Space STOP cancels the native keydown default. Keep that safety handler,
      // then activate the focused picker button on release without changing STOP.
      if (event.code === 'Space' && event.target instanceof HTMLButtonElement) {
        event.preventDefault();
        if (!event.target.disabled) event.target.click();
      }
    }}>
    <button className="modal-close icon-button" autoFocus aria-label="Close project chooser" disabled={busy} onClick={onClose}>×</button>
    <h2>Start a Project</h2>
    {PROJECT_TEMPLATES.map(item => <div key={item.id} className="template-choice">
      <button type="button" aria-pressed={template?.id === item.id} aria-controls="starter-details" disabled={busy}
        onClick={() => { setSelected(item); setError(''); }}>
        <BookOpen size={20} aria-hidden="true" /><strong>{item.name}</strong><span>{item.description}</span>
      </button>
      {template?.id === item.id && <section id="starter-details" className="starter-details" aria-label={`${template.name} details`}>
        <p>{template.description}</p>
        {template.steps && <ol className="template-steps">{template.steps.map(step => <li key={step}>{step}</li>)}</ol>}
        {template.helper && <p>{template.helper}</p>}
        {template.ports && <p className="template-port-hint">Choose your connected ports, then use this starter.</p>}
        {template.ports && <div className="template-ports">
          {(['sensor', 'output'] as const).filter(kind => kind === 'output' || template.ports!.sensor).map(kind =>
            <label key={kind}>{kind === 'sensor' ? 'Distance sensor port' : `${template.ports!.output} port`}
              <select aria-label={`${template.name} ${kind} port`} disabled={busy} value={ports[template.id]?.[kind] ?? ''}
                onChange={e => setPorts(current => ({ ...current, [template.id]: { ...current[template.id], [kind]: Number(e.target.value) || undefined } }))}>
                <option value="">Select Port</option>
                {Array.from({ length: kind === 'sensor' ? 3 : template.ports!.max }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select></label>)}
        </div>}
        <button type="button" className="primary" disabled={busy || !!template.ports && (!ports[template.id]?.output || !!template.ports.sensor && !ports[template.id]?.sensor)}
          onClick={async () => {
            setBusy(true); setError('');
            try { await onSelect(template, ports[template.id] ?? {}); }
            catch (error) { console.warn('Template creation failed:', error); setError('Could not start this project. Check your selections and try again.'); }
            finally { setBusy(false); }
          }}>{busy ? 'Loading starter…' : 'Use starter'}</button>
      </section>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section></div>;
}
