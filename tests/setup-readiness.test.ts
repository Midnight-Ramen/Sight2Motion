import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { setupReadiness, focusSetupSection, type SetupState } from '../src/core/SetupReadiness';
import { makeProject, makeAction } from '../src/core/types';
import { PROJECT_TEMPLATES } from '../src/core/ProjectTemplates';
const ready: SetupState = { usableFrame: true, modelReady: true, classes: ['person'], connected: true, hardwareBusy: false, running: false, demo: false };
afterEach(() => vi.unstubAllGlobals());
it('keeps one existing progression and navigates every step', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  expect(app.match(/aria-label="Setup steps"/g)).toHaveLength(1);
  for (const id of ['camera-panel', 'model-panel', 'robot-panel', 'rules', 'play-controls']) {
    expect(app).toContain(`${['model-panel', 'robot-panel'].includes(id) ? 'openSetup' : 'focusSetupSection'}('${id}')`);
    expect(app).toContain(`id="${id}"`);
  }
  const section = { scrollIntoView: vi.fn(), focus: vi.fn() };
  const getElementById = vi.fn(() => section);
  vi.stubGlobal('document', { getElementById });
  focusSetupSection('camera-panel');
  expect(getElementById).toHaveBeenCalledWith('camera-panel');
  expect(section.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(section.scrollIntoView).toHaveBeenCalledOnce();
});
it('requires usable camera frames and explains the first blocker', () => {
  expect(setupReadiness(makeProject(), { ...ready, usableFrame: false })).toMatchObject({ camera: false, play: false, helper: 'Next: Start your camera.' });
});
it('YOLO requires project objects and an actually loaded model', () => {
  const project = { ...makeProject(), selectedClasses: [] };
  expect(setupReadiness(project, ready)).toMatchObject({ vision: false, play: false, helper: 'Next: Choose an object for this project.' });
  expect(setupReadiness(makeProject(), { ...ready, modelReady: false }).vision).toBe(false);
});
it('TM requires loaded classes and rejects unavailable rule classes', () => {
  const project = { ...makeProject(), visionProvider: 'teachable-machine' as const };
  expect(setupReadiness(project, { ...ready, classes: [] })).toMatchObject({ vision: false, rules: false, play: false });
  expect(setupReadiness(project, { ...ready, classes: ['cup'] }).rules).toBe(false);
});
it('missing Hummingbird output or sensor ports keep Rules incomplete', () => {
  const p = { ...makeProject(), robotType: 'hummingbird' as const };
  p.rules[0].actions = [{ ...makeAction('positionServo'), port: undefined }];
  expect(setupReadiness(p, ready)).toMatchObject({ rules: false, helper: 'Next: Select the Hummingbird output port in your rule.' });
  p.rules[0].actions[0].port = 2;
  p.rules[0].sensorConditions = [{ id: 's', sensorId: 'distance:2', operator: 'lessThan', value: 30 }];
  expect(setupReadiness(p, ready).rules).toBe(false);
});
it('valid enabled rules complete Rules, disabled rules do not', () => {
  const p = makeProject();
  expect(setupReadiness(p, ready).rules).toBe(true);
  p.rules[0].enabled = false;
  expect(setupReadiness(p, ready).rules).toBe(false);
});
it('templates require robot attachment for the connection checkmark', () => {
  const p = PROJECT_TEMPLATES[0].createProject();
  expect(setupReadiness(p, { ...ready, usableFrame: false, connected: false })).toMatchObject({ camera: false, vision: true, robot: false, rules: true, play: false });
  expect(setupReadiness(p, { ...ready, connected: false }).helper).toBe('Next: Connect your robot.');
});
it('all requirements enable Play and running has clear guidance', () => {
  expect(setupReadiness(makeProject(), ready)).toMatchObject({ play: true, helper: 'Ready! Press Play.' });
  expect(setupReadiness(makeProject(), { ...ready, running: true }).helper).toContain('Running');
});
it('a saved custom target name requires an actively tracked selection', () => {
  const p = makeProject(); p.customObjects = ['My cup']; p.rules[0].className = 'My cup';
  expect(setupReadiness(p, ready)).toMatchObject({ vision: false, rules: false, helper: 'Next: Select and track your target.' });
  expect(setupReadiness(p, { ...ready, trackedName: 'My cup' }).rules).toBe(true);
});
it('guides camera, model, robot, rules and Play in order', () => {
 const p=makeProject(); p.rules=[];
 expect(setupReadiness(p,{...ready,usableFrame:false,modelReady:false,connected:false}).helper).toContain('Start your camera');
 expect(setupReadiness(p,{...ready,modelReady:false,connected:false}).helper).toContain('Load your AI');
 expect(setupReadiness(p,{...ready,connected:false})).toMatchObject({robot:false,helper:'Next: Connect your robot.'});
 expect(setupReadiness(p,ready).helper).toContain('Add and enable a rule');
});
