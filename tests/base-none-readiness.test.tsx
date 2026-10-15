import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BaseDrivingControls } from '../src/components/BaseDrivingControls';
import { BaseBehaviorCoordinator } from '../src/core/BaseBehaviorCoordinator';
import { EncoderRecording } from '../src/core/EncoderRecording';
import type { ActionEngine } from '../src/core/ActionEngine';
import type { RobotAdapter } from '../src/core/RobotAdapter';
import type { SensorState } from '../src/core/Sensors';
import { makeRule } from '../src/core/types';

afterEach(()=>vi.unstubAllGlobals());
function render(sensors:SensorState,available=true) {
 vi.stubGlobal('document',{hidden:false});
 const engine={busy:false,updateRules:vi.fn(async()=>true),stop:vi.fn(async()=>{})};
 const coordinator=new BaseBehaviorCoordinator(engine as unknown as ActionEngine);
 const html=renderToStaticMarkup(createElement(BaseDrivingControls,{
  engine:engine as unknown as ActionEngine,robot:{} as RobotAdapter,sensors,available,
  rulesRunning:false,speed:30,recording:new EncoderRecording(),cancelRef:{current:null},
  coordinator,ruleSensors:[],onActiveChange:()=>{},onProgramChange:()=>{},
 }));
 return {engine,coordinator,html};
}
it.each(['missing','near','stale'])('Base None permits rule-only Play and turns with %s distance data',async kind=>{
 const sensors:SensorState=kind==='missing'?{}:{finchDistance:{reading:{kind:'number',value:kind==='near'?5:50},updatedAt:kind==='stale'?-10000:performance.now()}};
 const {engine,coordinator,html}=render(sensors);
 expect(coordinator.programReady).toBe(true);
 expect(coordinator.startProgram()).toBe(true);
 expect(coordinator.enabled).toBe(false);
 const rule=makeRule();
 await coordinator.update([rule],[rule]);
 expect(engine.updateRules).toHaveBeenCalledOnce();
 expect(engine.stop).not.toHaveBeenCalled();
 expect(html).not.toContain('Distance unavailable');
 expect(html).not.toContain('title="Emergency braking"');
});
it('Base None retains disconnect and hidden-tab protection',()=>{
 const disconnected=render({},false);expect(disconnected.coordinator.programReady).toBe(false);expect(disconnected.coordinator.safety()).toBe(false);
 const connected=render({});vi.stubGlobal('document',{hidden:true});expect(connected.coordinator.safety()).toBe(false);
});
