import {afterEach,expect,it,vi} from 'vitest';
import {baseLineSensorIds} from '../src/core/BaseLineSampling';
import {BaseBehaviorCoordinator} from '../src/core/BaseBehaviorCoordinator';
import {ActionEngine} from '../src/core/ActionEngine';
import {FinchNavigation,freshLines} from '../src/core/FinchNavigation';
import {SensorProvider} from '../src/core/SensorProvider';
import {finchSensorDescriptor,type SensorState} from '../src/core/Sensors';
import {makeRule,makeAction} from '../src/core/types';
import type {RobotAdapter} from '../src/core/RobotAdapter';
import {RuleEngine} from '../src/core/RuleEngine';
import {TM_CAPABILITIES} from '../src/core/VisionCapabilities';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it.each(['resume','global STOP','manual takeover','disconnect'])('line base holds for Stop and handles %s with fresh paired sampling',async ending=>{
 vi.useFakeTimers();vi.spyOn(performance,'now').mockImplementation(()=>Date.now());
 let state:SensorState={};
 const robot:RobotAdapter={connected:true,connect:async()=>{},disconnect:async()=>{},getCapabilities:()=>['move','stop'],executeAction:vi.fn(async()=>{}),stop:vi.fn(async()=>{}),setWheelSpeeds:vi.fn(async()=>{})};
 const engine=new ActionEngine(robot),coordinator=new BaseBehaviorCoordinator(engine);
 const navigation=new FinchNavigation(engine,robot,()=>state,()=>!!robot.connected,()=>{},()=>Date.now());
 const provider=new SensorProvider(async()=>{await new Promise(r=>setTimeout(r,80));return {kind:'number',value:98};});
 const sync=()=>provider.setPriority(baseLineSensorIds(navigation.lineSensorIds,'Line Follow',coordinator.enabled),async next=>{state=next;await navigation.sensorsUpdated(true);});
 provider.start(['finchEncoderLeft','finchEncoderRight','finchDistance','finchLineLeft','finchLineRight'].map(id=>finchSensorDescriptor(id as 'finchLineLeft')),next=>{state=next;});
 await vi.advanceTimersByTimeAsync(900);
 const start=vi.fn(()=>navigation.lineFollow(20,'stop',true));
 coordinator.arm({start,suspend:async()=>{navigation.cancel();sync();await engine.waitForStops();},safe:()=>!!robot.connected&&!!freshLines(state,Date.now())});sync();
 await vi.advanceTimersByTimeAsync(400);
 expect(navigation.lineActive).toBe(true);
 const sign={...makeRule(),className:'Stop sign',minDuration:0,actions:[makeAction('stop')]};
 const rules=new RuleEngine();
 const evaluate=async(visible:boolean)=>{
  const triggered=rules.evaluate([sign],visible?[{className:'Stop sign',confidence:.95}]:[],Date.now(),TM_CAPABILITIES);
  await coordinator.update(triggered,rules.activeRules);
 };
 await evaluate(true);sync();
 expect(navigation.active).toBe(false);expect(coordinator.enabled).toBe(true);
 const commands=vi.mocked(robot.setWheelSpeeds!).mock.calls.length;
 for(let i=0;i<20;i++){await vi.advanceTimersByTimeAsync(100);await evaluate(true);}
 expect(vi.mocked(robot.setWheelSpeeds!).mock.calls).toHaveLength(commands);
 expect(freshLines(state,Date.now())).not.toBeNull();
 expect(provider.diagnostics.priorityIds).toEqual(['finchLineLeft','finchLineRight']);
 if(ending!=='resume'){if(ending==='disconnect')Object.assign(robot,{connected:false});coordinator.disarm();await engine.stop();sync();}
 await evaluate(false);await vi.advanceTimersByTimeAsync(400);sync();
 expect(start).toHaveBeenCalledTimes(ending==='resume'?2:1);
 expect(navigation.lineActive).toBe(ending==='resume');
 if(ending!=='resume')expect(provider.diagnostics.priorityIds).toEqual([]);
 coordinator.disarm();navigation.cancel();provider.stop();await engine.waitForStops();vi.restoreAllMocks();
});
