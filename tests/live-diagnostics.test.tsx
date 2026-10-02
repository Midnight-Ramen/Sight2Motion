import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { LiveDiagnostics } from '../src/components/LiveDiagnostics';
import { makeProject, makeAction, type Detection } from '../src/core/types';
import { RuleEngine } from '../src/core/RuleEngine';
import { FollowController } from '../src/core/FollowController';
import { TargetTracker } from '../src/core/TargetTracker';
import { sensorDescriptor } from '../src/core/Sensors';
const person: Detection = { className: 'person', confidence: .94, x: 100, y: 100, width: 100, height: 200, centerX: 150, centerY: 200, region: 'left', areaRatio: .1 };
const base = { project: makeProject(), detections: [person], target: null, sensors: {}, ruleResults: {}, follow: { selected: false, target: undefined }, camera: true, model: true, robot: true, running: false, fps: 2.8, demo: false, now: 100 };
it('shows selected YOLO objects with confidence, region and distance', () => {
  const html = renderToStaticMarkup(<LiveDiagnostics {...base} detections={[person, {...person, className: 'bottle'}]}/>);
  expect(html).toContain('94%'); expect(html).toContain('LEFT'); expect(html).toContain('FAR'); expect(html).not.toContain('bottle');
  expect(renderToStaticMarkup(<LiveDiagnostics {...base} detections={[]}/>)).toContain('No selected objects detected.');
});
it('sorts classification probabilities without spatial labels or mutating input', () => {
  const detections = [{className:'Low',confidence:.03},{className:'High',confidence:.91}];
  const html = renderToStaticMarkup(<LiveDiagnostics {...base} project={{...base.project,visionProvider:'teachable-machine'}} detections={detections}/>);
  expect(html.indexOf('High')).toBeLessThan(html.indexOf('Low')); expect(html).not.toContain('FAR'); expect(detections[0].className).toBe('Low');
});
it('shows existing tracker states and normalized geometry', () => {
  const tracker = new TargetTracker();
  const target = tracker.initialize({width:640,height:480,mask:new Uint8Array(),boundingBox:{x:100,y:100,width:100,height:200},centroid:{x:150,y:200},area:20000,displayName:'Cup'},[person],false,0)!;
  for (const [state, label] of [['TRACKING','Tracking'],['TEMPORARILY_LOST','Temporarily Lost'],['LOST','Lost']] as const) {
    expect(renderToStaticMarkup(<LiveDiagnostics {...base} target={{...target,state}}/>)).toContain(label);
  }
  expect(renderToStaticMarkup(<LiveDiagnostics {...base} target={target}/>)).toContain('Size:');
});
it('shows Follow active, waiting and inactive command state', () => {
  const project = makeProject(); project.rules[0].actions = [{...makeAction('move'), mode:'follow'}];
  const html = renderToStaticMarkup(<LiveDiagnostics {...base} project={project} follow={{selected:false,active:true,wheels:[18,31],target:'person'}}/>);
  expect(html).toContain('Active'); expect(html).toContain('Left wheel:'); expect(html).toContain('Left');
  expect(renderToStaticMarkup(<LiveDiagnostics {...base} project={project} follow={{selected:false,active:true,waiting:true,target:undefined}}/>)).toContain('Waiting for target');
  expect(renderToStaticMarkup(<LiveDiagnostics {...base} project={project}/>)).toContain('Inactive');
});
it('shows only configured Hummingbird sensors, with stale data unavailable', () => {
  const project = {...makeProject(),robotType:'hummingbird' as const,sensorConfiguration:[sensorDescriptor('distance',1)]};
  const sensors = {'distance:1':{reading:{kind:'number' as const,value:24,unit:'cm'},updatedAt:100}};
  expect(renderToStaticMarkup(<LiveDiagnostics {...base} project={project} sensors={sensors}/>)).toContain('24 cm');
  expect(renderToStaticMarkup(<LiveDiagnostics {...base} project={project} sensors={sensors} now={1000}/>)).toContain('No data');
  expect(renderToStaticMarkup(<LiveDiagnostics {...base} project={project} sensors={sensors} robot={false}/>)).toContain('No data');
});
it('uses recorded evaluation results for TRUE/FALSE/Waiting and reset', () => {
  const project = makeProject(), engine = new RuleEngine(), id = project.rules[0].id;
  engine.evaluate(project.rules,[person],0); expect(engine.diagnostics[id]).toBe('Waiting');
  engine.evaluate(project.rules,[person],600); expect(engine.diagnostics[id]).toBe('TRUE');
  expect(renderToStaticMarkup(<LiveDiagnostics {...base} project={project} running ruleResults={engine.diagnostics}/>)).toContain('TRUE');
  engine.evaluate(project.rules,[],700); expect(engine.diagnostics[id]).toBe('FALSE');
  engine.reset(); expect(engine.diagnostics).toEqual({});
});
it('hides irrelevant sections and starts collapsed', () => {
  const html = renderToStaticMarkup(<LiveDiagnostics {...base} model={false}/>);
  for (const label of ['Vision diagnostics','Selected target diagnostics','Follow diagnostics','Sensor diagnostics']) expect(html).not.toContain(label);
  expect(html).not.toContain(' open=');
});
it('reads commands without sending again and returns an isolated wheel snapshot', async () => {
  const send = vi.fn(async () => {}), controller = new FollowController(makeAction('move'),send,()=>{},()=>{});
  await controller.update([{x:.2,y:.2,width:.1,height:.1}],performance.now());
  const calls = send.mock.calls.length, snapshot = controller.commandSnapshot;
  if (snapshot.wheels) snapshot.wheels[0] = 999;
  expect(controller.commandSnapshot.wheels?.[0]).not.toBe(999); expect(send).toHaveBeenCalledTimes(calls);
  controller.cancel(); expect(controller.commandSnapshot.active).toBe(false);
});
it('diagnostic rendering introduces no polling or runtime evaluation', () => {
  const source = readFileSync('src/components/LiveDiagnostics.tsx','utf8');
  for (const forbidden of ['setInterval(', 'setTimeout(', '.evaluate(', '.predict(', '.update(', 'useEffect(']) expect(source).not.toContain(forbidden);
});

it('shows network frame age and reconnect evidence only for a network camera', () => {
  const time = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const networkCamera = {url:'http://camera/stream',status:'Connected' as const,stream:'Healthy' as const,phase:'read' as const,attempt:2,reconnectAttempts:1,frames:3,lastFrameAt:760};
  const html = renderToStaticMarkup(<LiveDiagnostics {...base} project={{...base.project,cameraSource:'network'}} networkCamera={networkCamera}/>);
  expect(html).toContain('240 ms ago'); expect(html).toContain('Reconnect attempts: 1');
  expect(html).toContain('Stream: Healthy');
  expect(renderToStaticMarkup(<LiveDiagnostics {...base} networkCamera={networkCamera}/>)).not.toContain('Network camera diagnostics');
  time.mockRestore();
});
