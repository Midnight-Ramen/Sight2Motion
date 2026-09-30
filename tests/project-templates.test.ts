import { afterEach, expect, it, vi } from 'vitest';
import { PROJECT_TEMPLATES, selectProjectTemplate } from '../src/core/ProjectTemplates';
import { parseProject, ProjectStorage } from '../src/core/ProjectStorage';
import { ROBOTS } from '../src/core/RobotCapabilities';
import { FOLLOW_DEFAULTS } from '../src/core/FollowController';
import type { Project } from '../src/core/types';
const template = (id: string) => PROJECT_TEMPLATES.find(t => t.id === id)!;
afterEach(() => vi.unstubAllGlobals());
it('Follow creates a normal YOLO Finch project with safe defaults', () => {
  const p = template('follow').createProject();
  expect(p).toMatchObject({ robotType: 'finch', visionProvider: 'yolo', selectedClasses: ['person'] });
  expect(p.rules[0]).toMatchObject({ className: 'person', mode: 'continuous' });
  expect(p.rules[0].actions[0]).toMatchObject({ ...FOLLOW_DEFAULTS, kind: 'move', mode: 'follow', followSpeed: 20 });
});
it('Reaction example is editable and each project has independent IDs and state', () => {
  const a = template('reaction').createProject(), b = template('reaction').createProject();
  expect(a.rules[0].actions[0]).toMatchObject({ kind: 'beak', color: '#51d691' });
  a.rules[0].name = 'Changed'; a.rules[0].actions[0].color = '#000000';
  expect(b.rules[0].name).toBe('Say hello');
  expect(a.id).not.toBe(b.id); expect(a.rules[0].id).not.toBe(b.rules[0].id);
});
it('Hummingbird templates require explicit ports and use supported actions', () => {
  for (const id of ['sensor', 'servo']) {
    expect(() => template(id).createProject()).toThrow('Choose');
    const p = template(id).createProject({ sensor: 2, output: 3 });
    expect(p.robotType).toBe('hummingbird');
    expect(ROBOTS.hummingbird.actions).toContain(p.rules[0].actions[0].kind);
    expect(p.rules[0].actions[0].port).toBe(3);
  }
  const p = template('sensor').createProject({ sensor: 2, output: 3 });
  expect(p.sensorConfiguration?.[0]).toMatchObject({ type: 'distance', port: 2 });
  expect(p.rules[0].sensorConditions?.[0]).toMatchObject({ sensorId: 'distance:2', operator: 'lessThan', value: 30 });
});
it('Custom AI starts without fake URLs, classes, or rules', () => {
  const p = template('classifier').createProject();
  expect(p.visionProvider).toBe('teachable-machine');
  expect(p.teachableMachineUrl).toBeUndefined();
  expect(p.rules).toEqual([]); expect(p.selectedClasses).toEqual([]);
});
it('Blank remains blank with valid defaults', () => {
  const p = template('blank').createProject();
  expect(p.rules).toEqual([]); expect(p.selectedClasses).toEqual([]);
  expect(parseProject(JSON.stringify(p)).selectedClasses).toEqual([]);
});
it('template selection awaits the supplied safe replacement path', async () => {
  let finish!: () => void;
  const replace = vi.fn((_project: Project) => new Promise<void>(resolve => { finish = resolve; }));
  let completed = false;
  const selecting = selectProjectTemplate(template('follow'), {}, replace).then(() => { completed = true; });
  expect(replace).toHaveBeenCalledOnce();
  expect(replace.mock.calls[0][0]).toMatchObject({ name: 'Follow a Person' });
  await Promise.resolve(); expect(completed).toBe(false);
  finish(); await selecting; expect(completed).toBe(true);
});
it('every template round-trips through existing storage without template metadata', () => {
  let saved = '';
  vi.stubGlobal('localStorage', { getItem: () => saved || null, setItem: (_key: string, value: string) => { saved = value; } });
  const storage = new ProjectStorage();
  for (const t of PROJECT_TEMPLATES) {
    const p = t.createProject({ sensor: 2, output: 2 });
    storage.save(p);
    const restored = storage.list().find(item => item.id === p.id)!;
    expect(restored).toEqual(parseProject(JSON.stringify(p)));
    expect(restored.rules).toHaveLength(p.rules.length);
    expect(restored.selectedClasses).toEqual(p.selectedClasses);
    expect(restored).not.toHaveProperty('templateId');
  }
});
