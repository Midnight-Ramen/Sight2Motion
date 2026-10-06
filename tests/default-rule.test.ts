import { expect, it } from 'vitest';
import { makeProject, makeRule } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';

it('creates new rules with the existing continuous trigger', () => {
  expect(makeRule().mode).toBe('continuous');
});

it('preserves every saved trigger mode when loading projects', () => {
  for (const mode of ['appearance', 'continuous', 'interval', 'disappearance'] as const) {
    const project = makeProject();
    project.rules = [{ ...makeRule(), mode }];
    expect(parseProject(JSON.stringify(project)).rules[0].mode).toBe(mode);
  }
});
