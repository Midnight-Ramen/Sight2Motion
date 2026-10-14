import {afterEach,expect,it,vi} from 'vitest';
import {SelectedTargetProgram} from '../src/core/SelectedTargetProgram';
import {BaseBehaviorCoordinator} from '../src/core/BaseBehaviorCoordinator';
import {ActionEngine} from '../src/core/ActionEngine';
import {AppearanceTracker} from '../src/core/AppearanceTracker';
import {saveTargetView,type TargetReference} from '../src/core/TargetProfiles';
import {summarizeMask} from '../src/core/SegmentationGeometry';
import {makeRule,makeAction} from '../src/core/types';
import {MockRobotAdapter} from './MockRobotAdapter';
const width=100,height=80;
function frame(side=false,hidden=false){
 const data=new Uint8ClampedArray(width*height*4).fill(30);
 if(!hidden)for(let y=25;y<49;y++)for(let x=30;x<50;x++){const i=(y*width+x)*4;data[i]=(side?180:80)+(x%5)*10;data[i+1]=(side?50:150)+(y%4)*15;data[i+2]=side?190:40;}
 return {data,width,height};
}
function reference(side=false):TargetReference {
 const mask=new Uint8Array(width*height);for(let y=25;y<49;y++)for(let x=30;x<50;x++)mask[y*width+x]=1;
 return {id:crypto.randomUUID(),crop:{image:'',mask:'',width:1,height:1},appearance:AppearanceTracker.reference(frame(side),summarizeMask(mask,width,height))};
}
class Wheels extends MockRobotAdapter {
 get connected(){return this.state.connected;}
 setWheelSpeeds=vi.fn(async(left:number,right:number,_duration:number,signal:AbortSignal)=>{if(!signal.aborted&&this.connected){this.state.left=left;this.state.right=right;}});
}
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(fn=>fn());vi.useRealTimers();});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
async function setup(){
 vi.useFakeTimers();const robot=new Wheels();await robot.connect();const engine=new ActionEngine(robot),coordinator=new BaseBehaviorCoordinator(engine);
 const abort=vi.fn(()=>{coordinator.disarm();program.end();});
 const program=new SelectedTargetProgram(engine,abort);const tracker=new AppearanceTracker();
 const profile=saveTargetView(saveTargetView([],'Red robot',reference()),'Red robot',reference(true))[0];
 let side=false,hidden=false,safe=true;
 const match=vi.fn(()=>{tracker.initializeProfile(profile,false,width,height);return tracker.update(frame(side,hidden),performance.now(),width,height);});
 const source={profile,canMatch:()=>true,match};program.setSource(Symbol('fixture'),source);
 coordinator.safety=()=>safe;
 const driver={safe:()=>safe&&robot.connected&&program.safe,start:()=>program.start(),suspend:()=>program.suspend()};
 coordinator.program={selected:true,ready:()=>safe&&robot.connected&&program.ready,start:()=>{if(!program.begin())return false;coordinator.arm(driver);}};
 cleanups.push(()=>{program.end();coordinator.disarm();void engine.stop();});
 async function sample(){const target=tracker.update(frame(side,hidden),performance.now(),width,height);await program.publish(target,tracker.capturedAt,tracker.lossTimeoutMs);await coordinator.update([],[]);}
 async function run(ms=1200){for(let t=0;t<ms;t+=100){await vi.advanceTimersByTimeAsync(100);await sample();}}
 return {robot,engine,program,coordinator,tracker,profile,source,match,abort,run,sample,setSide:(value:boolean)=>{side=value;},hide:()=>{hidden=true;},show:()=>{hidden=false;},brake:()=>{safe=false;},clearBrake:()=>{safe=true;}};
}
it('a valid multi-view profile is configured, but matching and motion wait for global Play',async()=>{
 const s=await setup();expect(s.program.configured).toBe(true);expect(s.program.label).toBe('Red robot');expect(s.profile.references).toHaveLength(2);
 await s.run(200);expect(s.match).not.toHaveBeenCalled();expect(s.robot.setWheelSpeeds).not.toHaveBeenCalled();
 expect(s.coordinator.startProgram()).toBe(true);await settle();await s.run();expect(s.engine.followingSelectedTarget).toBe(true);expect(Math.max(s.robot.state.left,s.robot.state.right)).toBeGreaterThan(0);
});
it('rotation matches another view and short uncertainty recovers within the unchanged loss window',async()=>{
 const s=await setup();const starts=vi.spyOn(s.engine,'startSelectedFollow');s.coordinator.startProgram();await settle();await s.run();
 s.setSide(true);await s.run(400);expect(s.tracker.age()?.state).toBe('TRACKING');expect(s.engine.followingSelectedTarget).toBe(true);
 expect(starts).toHaveBeenCalledTimes(1);expect(s.match).toHaveBeenCalledTimes(1);expect(s.abort).not.toHaveBeenCalled();
 const at=s.tracker.capturedAt;await s.program.publish({...s.tracker.age()!,state:'TEMPORARILY_LOST',trackingConfidence:0},at,750);
 await vi.advanceTimersByTimeAsync(400);await s.sample();expect(s.engine.followingSelectedTarget).toBe(true);expect(starts).toHaveBeenCalledTimes(2);
});
it('Play rejects an unmatched target without starting Follow',async()=>{
 const s=await setup();s.hide();expect(s.coordinator.startProgram()).toBe(false);await settle();expect(s.engine.followingSelectedTarget).toBe(false);expect(s.robot.setWheelSpeeds).not.toHaveBeenCalled();
});
it.each(['STOP','manual takeover','disconnect'])('%s prevents restart even when reference matching continues',async cause=>{
 const s=await setup();s.coordinator.startProgram();await settle();await s.run();
 s.program.end();s.coordinator.disarm();await s.engine.stop();if(cause==='disconnect')await s.robot.disconnect();
 const count=s.robot.setWheelSpeeds.mock.calls.length;await s.run(1000);
 expect(s.robot.state.left).toBe(0);expect(s.robot.state.right).toBe(0);expect(s.robot.setWheelSpeeds).toHaveBeenCalledTimes(count);expect(s.match).toHaveBeenCalledTimes(1);expect(s.engine.followingSelectedTarget).toBe(false);
});
it('target loss holds Play while stopped, then times out without auto-start',async()=>{
 const s=await setup();s.coordinator.startProgram();await settle();await s.run();s.hide();await s.run(900);expect(s.program.armed).toBe(true);expect(s.robot.state.left).toBe(0);await s.run(4400);
 expect(s.robot.state.left).toBe(0);expect(s.robot.state.right).toBe(0);expect(s.engine.followingSelectedTarget).toBe(false);expect(s.program.armed).toBe(false);expect(s.abort).toHaveBeenCalled();
 await s.run(300);expect(s.match).toHaveBeenCalledTimes(1);expect(s.coordinator.enabled).toBe(false);
});
it('temporary Stop rules suspend Follow and clear safely back to the same target session',async()=>{
 const s=await setup();s.coordinator.startProgram();await settle();await s.run();
 const rule={...makeRule(),source:'sensor' as const,mode:'continuous' as const,actions:[makeAction('stop')]};
 await s.coordinator.update([rule],[rule]);expect(s.engine.followingSelectedTarget).toBe(false);expect(s.coordinator.enabled).toBe(true);
 await vi.advanceTimersByTimeAsync(100);const target=s.tracker.update(frame(),performance.now(),width,height);await s.program.publish(target,s.tracker.capturedAt,750);
 await s.coordinator.update([],[]);await s.run();expect(s.engine.followingSelectedTarget).toBe(true);expect(s.match).toHaveBeenCalledTimes(1);
});
it('emergency braking cancels selected Follow and never auto-resumes when clearance returns',async()=>{
 const s=await setup();s.coordinator.startProgram();await settle();await s.run();s.brake();await s.coordinator.update([],[]);
 expect(s.robot.state.left).toBe(0);expect(s.robot.state.right).toBe(0);expect(s.coordinator.enabled).toBe(false);
 const count=s.robot.setWheelSpeeds.mock.calls.length;s.clearBrake();await s.run(600);expect(s.robot.setWheelSpeeds).toHaveBeenCalledTimes(count);
});
it('source removal stops the program without retaining a stale profile',async()=>{
 const s=await setup();const owner=Symbol('owner');s.program.setSource(owner,s.source);s.coordinator.startProgram();await settle();await s.run();
 s.program.clearSource(owner);await settle();expect(s.program.configured).toBe(false);expect(s.program.armed).toBe(false);expect(s.robot.state.left).toBe(0);expect(s.abort).toHaveBeenCalled();
});

it('STOP during an in-flight initial STOP cannot create a late Follow controller',async()=>{
 const s=await setup();let release!:()=>void;
 const original=s.robot.stop.bind(s.robot);
 vi.spyOn(s.robot,'stop').mockImplementationOnce(()=>new Promise<void>(resolve=>{release=()=>{void original().then(resolve);};}));
 s.coordinator.startProgram();await settle();s.program.end();s.coordinator.disarm();await s.engine.stop();release();await settle();
 await s.run(500);expect(s.engine.followingSelectedTarget).toBe(false);expect(s.robot.setWheelSpeeds).not.toHaveBeenCalled();
});

it('three stable returning views resume through normal Follow start, with wheels stopped throughout recovery',async()=>{
 const s=await setup();const starts=vi.spyOn(s.engine,'startSelectedFollow');
 s.coordinator.startProgram();await settle();await s.run();s.hide();await s.run(200);
 expect(s.robot.state.left).toBe(0);expect(s.robot.state.right).toBe(0);expect(s.program.armed).toBe(true);
 s.show();s.setSide(true);await s.run(300);expect(s.robot.state.left).toBe(0);
 await s.run(1200);expect(s.engine.followingSelectedTarget).toBe(true);expect(starts).toHaveBeenCalledTimes(2);
});
it.each(['STOP','manual','disconnect','camera change','profile change'])('%s cancels during reacquisition',async cause=>{
 const s=await setup();s.coordinator.startProgram();await settle();await s.run();s.hide();await s.run(200);
 s.program.end();s.coordinator.disarm();await s.engine.stop();if(cause==='disconnect')await s.robot.disconnect();
 const count=s.robot.setWheelSpeeds.mock.calls.length;s.show();await s.run(1500);
 expect(s.program.armed).toBe(false);expect(s.robot.setWheelSpeeds).toHaveBeenCalledTimes(count);
});

it('a Stop rule during reacquisition retains ownership until the rule clears',async()=>{
 const s=await setup();s.coordinator.startProgram();await settle();await s.run();s.hide();await s.run(100);
 const rule={...makeRule(),source:'sensor' as const,mode:'continuous' as const,actions:[makeAction('stop')]};
 await s.coordinator.update([rule],[rule]);s.show();
 for(let i=0;i<12;i++){
  await vi.advanceTimersByTimeAsync(100);
  const t=s.tracker.update(frame(),performance.now(),width,height);
  await s.program.publish(t,s.tracker.capturedAt,750);await s.coordinator.update([], [rule]);
  expect(s.robot.state.left).toBe(0);expect(s.robot.state.right).toBe(0);
 }
 await s.coordinator.update([],[]);await s.run();expect(s.engine.followingSelectedTarget).toBe(true);
});
it('ending a recovery cancels matching and prevents later auto-resume',async()=>{
 const s=await setup();const cancelMatch=vi.fn(()=>s.tracker.stop());s.program.setSource(Symbol('cancel-source'),{...s.source,cancelMatch});
 s.coordinator.startProgram();await settle();await s.run();s.hide();await s.run(100);
 s.program.end();s.coordinator.disarm();await settle();
 expect(cancelMatch).toHaveBeenCalled();expect(s.tracker.age()).toBeNull();s.show();await s.run(1000);expect(s.engine.followingSelectedTarget).toBe(false);
});

it('an admitted verification keeps recovery stopped and armed past deadline until completion; STOP remains authoritative',async()=>{
 const s=await setup();let pending=true;
 s.program.setSource(Symbol('pending'),{...s.source,recoveryPending:()=>pending});
 s.coordinator.startProgram();await settle();await s.run();
 const lost={...s.tracker.age()!,state:'REACQUIRING' as const,trackingConfidence:0};
 await s.program.publish(lost,s.tracker.capturedAt,750);await vi.advanceTimersByTimeAsync(5100);
 await s.program.publish(lost,s.tracker.capturedAt,750);expect(s.program.safe).toBe(true);expect(s.program.armed).toBe(true);expect(s.robot.state.left).toBe(0);expect(s.robot.state.right).toBe(0);
 pending=false;await s.program.publish({...lost,state:'LOST',targetLost:true},s.tracker.capturedAt,750);expect(s.program.armed).toBe(false);
});

it('a fresh completed recovery result can resume after an admitted cycle crosses the deadline',async()=>{
 const s=await setup();let pending=true;s.program.setSource(Symbol('pending'),{...s.source,recoveryPending:()=>pending});
 s.coordinator.startProgram();await settle();await s.run();const original=s.tracker.age()!;
 await s.program.publish({...original,state:'REACQUIRING',trackingConfidence:0},s.tracker.capturedAt,750);
 await vi.advanceTimersByTimeAsync(5100);pending=false;
 const at=performance.now()-100;
 await s.program.publish({...original,state:'TRACKING',lastSeenAt:at},at,750);await settle();
 expect(s.program.armed).toBe(true);expect(s.engine.followingSelectedTarget).toBe(true);expect(s.abort).not.toHaveBeenCalled();
 s.program.end();await s.engine.stop();expect(s.program.armed).toBe(false);
});
