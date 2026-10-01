import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { cameraFailure, modelGuidance, detectionEmpty } from '../src/core/StudentGuidance';
import { setupReadiness } from '../src/core/SetupReadiness';
import { makeProject, makeAction } from '../src/core/types';
import { RuleCard } from '../src/components/RuleCard';
import { HardwareTest } from '../src/components/HardwareTest';
import { ProjectObjects } from '../src/components/ProjectObjects';
import { TM_CAPABILITIES } from '../src/core/VisionCapabilities';
const ready = { usableFrame: true, modelReady: true, classes: ['person'], connected: true, hardwareBusy: false, running: false, demo: false };
it('camera permission failure explains recovery without raw errors', () => {
  expect(cameraFailure(false, new DOMException('secret detail', 'NotAllowedError'))).toContain('Allow camera permission');
  expect(cameraFailure(false, new Error('secret detail'))).not.toContain('secret');
});
it('network failure gives a retry instruction', () => {
  expect(cameraFailure(true, new Error('fetch failed'))).toContain('press Connect to retry');
});
it('TM empty and failed URLs give guidance and successful load clears it', () => {
  expect(modelGuidance('teachable-machine', false, false, false, '')).toContain('Paste');
  expect(modelGuidance('teachable-machine', false, false, true, 'bad')).toContain('Check the model link');
  expect(modelGuidance('teachable-machine', false, true, true, 'valid')).toBe('Ready');
});
it('missing objects and classes give provider-specific next actions', () => {
  const props = { selected: [], supported: [], rules: [], detections: [], threshold: .7, live: false, onChange: () => {} };
  expect(renderToStaticMarkup(<ProjectObjects {...props}/>)).toContain('Choose at least one object');
  expect(renderToStaticMarkup(<ProjectObjects {...props} capabilities={TM_CAPABILITIES}/>)).toContain('Load your Teachable Machine model');
});
it('robot guidance clears on connection and never exposes adapter details', () => {
  const props = { robotType: 'finch' as const, busy: false, onAttach: () => {}, onDisconnect: () => {}, onAction: () => {}, onStop: () => {}, onReset: () => {} };
  const status = { connector: 'detected' as const, connection: 'disconnected' as const, message: 'raw transport error' };
  const html = renderToStaticMarkup(<HardwareTest {...props} status={status}/>);
  expect(html).toContain('Robot not connected. Connect your');
  expect(html).not.toContain('raw transport error');
  expect(renderToStaticMarkup(<HardwareTest {...props} status={{...status, connection: 'connected'}}/>)).not.toContain('Robot not connected');
});
it('the existing validator supplies inline port guidance and clears it on repair', () => {
  const project = makeProject(); project.robotType = 'hummingbird';
  project.rules[0].actions = [{...makeAction('positionServo'), port: undefined}];
  const rule = project.rules[0];
  const guidance = setupReadiness(project, ready).ruleProblems[rule.id];
  expect(renderToStaticMarkup(<RuleCard rule={rule} index={0} selectedClasses={['person']} capabilities={['positionServo']} onChange={() => {}} onDelete={() => {}} guidance={guidance}/>)).toContain('Select the Hummingbird output port');
  rule.actions[0].port = 2;
  expect(setupReadiness(project, ready).ruleProblems[rule.id]).toBeUndefined();
});
it('empty detection text is provider-aware and not an error', () => {
  expect(detectionEmpty('yolo', true, false)).toBe('No matching objects detected yet.');
  expect(detectionEmpty('teachable-machine', true, false)).toContain('confident classification');
  expect(detectionEmpty('yolo', true, true)).toContain('selected target');
});
it('Play references its blocker and model failures are not duplicated in banners', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  expect(app).toContain('id="play-blocker"');
  expect(app).toContain("aria-describedby={!readiness.play ? 'play-blocker'");
  const modelCatch = app.slice(app.lastIndexOf('setModelError(true)'), app.indexOf('function toggleAI'));
  expect(modelCatch).not.toContain('setNotice(');
  expect(modelCatch).toContain('console.warn');
});
