import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeProject, makeRule } from '../src/core/types';
import { parseProject, ProjectStorage } from '../src/core/ProjectStorage';
import { removalMessage } from '../src/core/ProjectObjects';
import { RuleCard } from '../src/components/RuleCard';

describe('project objects', () => {
  it('saves and loads selected classes through storage and JSON', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    try {
      const project = { ...makeProject(), selectedClasses: ['person', 'bottle', 'cell phone'] };
      const storage = new ProjectStorage();
      storage.save(project);
      expect(storage.list()[0].selectedClasses).toEqual(project.selectedClasses);
      expect(parseProject(JSON.stringify(project)).selectedClasses).toEqual(project.selectedClasses);
    } finally { vi.unstubAllGlobals(); }
  });
  it('renders only project objects in the rule dropdown', () => {
    const html = renderToStaticMarkup(createElement(RuleCard, {
      rule: makeRule(), index: 0, selectedClasses: ['person', 'bottle'], capabilities: [], onChange: () => {}, onDelete: () => {},
    }));
    const dropdown = html.match(/<select aria-label="Detected class"[\s\S]*?<\/select>/)?.[0];
    expect(dropdown).toContain('value="person"');
    expect(dropdown).toContain('value="bottle"');
    expect(dropdown).not.toContain('car');
    expect(dropdown?.match(/<option /g)).toHaveLength(2);
  });
  it('blocks removal of classes referenced even by disabled rules', () => {
    const rule = { ...makeRule(), name: 'Bottle Rule', className: 'bottle', enabled: false };
    expect(removalMessage('bottle', ['person', 'bottle'], [rule])).toBe('Bottle is being used by ‘Bottle Rule’. Change or remove that rule first.');
    expect(removalMessage('person', ['person', 'bottle'], [rule])).toBe('');
    expect(removalMessage('person', ['person'], [])).toContain('at least one');
  });
  it('migrates old projects and preserves all referenced classes', () => {
    const { selectedClasses, ...old } = makeProject();
    old.rules.push({ ...makeRule(), className: 'bottle' });
    expect(parseProject(JSON.stringify(old)).selectedClasses).toEqual(['person', 'bottle']);
    expect(parseProject(JSON.stringify({ ...old, rules: [] })).selectedClasses).toEqual(['person']);
    expect(parseProject(JSON.stringify({ ...old, selectedClasses: ['person'] })).selectedClasses).toEqual(['person', 'bottle']);
  });
});
