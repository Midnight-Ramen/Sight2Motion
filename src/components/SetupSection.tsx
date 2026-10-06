import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
export function SetupSection({ id, title, summary, icon, open, onToggle, children }: {
  id: string; title: string; summary: string; icon: ReactNode; open: boolean;
  onToggle: () => void; children: ReactNode;
}) {
  return <section className="setup-section" id={id} tabIndex={-1}>
    <button className="setup-section-heading" aria-label={title} aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}>
      {icon}<span className="setup-section-title">{title}</span><span className="setup-section-status" title={summary}>{summary}</span>
      <ChevronDown size={16} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
    </button>
    <div id={`${id}-body`} className="setup-section-body" hidden={!open}>{children}</div>
  </section>;
}
