import {expect,it} from 'vitest';
import {AppearanceTracker} from '../src/core/AppearanceTracker';
import {summarizeMask} from '../src/core/SegmentationGeometry';
import {saveTargetView,removeTargetView,migrateTargetProfiles,parseTargetProfiles,type TargetReference} from '../src/core/TargetProfiles';
import {makeProject} from '../src/core/types';
import {parseProject} from '../src/core/ProjectStorage';
import {trackedFollowCommand,TRACKED_FOLLOW_DEFAULTS} from '../src/core/FollowController';
const width=100,height=80;
function frame(side=false,offset=0){
 const data=new Uint8ClampedArray(width*height*4).fill(30);
 for(let y=25;y<49;y++)for(let x=30;x<50;x++){
  const i=(y*width+x)*4;
  data[i]=(side?180:80)+(x%5)*10+offset;data[i+1]=(side?50:150)+(y%4)*15;data[i+2]=side?190:40;
 }
 return {data,width,height};
}
function selection(){const mask=new Uint8Array(width*height);for(let y=25;y<49;y++)for(let x=30;x<50;x++)mask[y*width+x]=1;return summarizeMask(mask,width,height);}
function reference(side=false):TargetReference{return {id:crypto.randomUUID(),crop:{image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6bRoAAAAASUVORK5CYII=',mask:'AQ==',width:1,height:1},appearance:AppearanceTracker.reference(frame(side),selection())};}
it('first view creates a profile, additional views retain its label, removal retains the remaining view',()=>{
 const front=reference(),side=reference(true);const first=saveTargetView([],' Red robot ',front);
 expect(first[0].label).toBe('Red robot');expect(first[0].references).toEqual([front]);
 const both=saveTargetView(first,'Red robot',side);expect(both).toHaveLength(1);expect(both[0].references).toEqual([front,side]);
 expect(first[0].references).toEqual([front]);
 expect(removeTargetView(both,'Red robot',front.id)[0].references).toEqual([side]);
});
it('best-of-N accepts a side view that the front-only template rejects',()=>{
 const front=reference(),side=reference(true);
 const one=new AppearanceTracker();one.initializeProfile(saveTargetView([],'Robot',front)[0],false,width,height);
 expect(one.update(frame(true),100,width,height)).toBeNull();
 const profile=saveTargetView(saveTargetView([],'Robot',front),'Robot',side)[0];
 const tracker=new AppearanceTracker();tracker.initializeProfile(profile,false,width,height);
 const matched=tracker.update(frame(true),100,width,height)!;
 expect(matched.state).toBe('TRACKING');expect(matched.displayName).toBe('Robot');expect(matched.trackingConfidence).toBeCloseTo(1);
 expect(tracker.update(frame(),200,width,height)?.state).toBe('TRACKING');
});
it('configurable threshold rejects weak matching without refreshing target freshness',()=>{
 const profile={...saveTargetView([],'Robot',reference())[0],matchThreshold:.99};
 const tracker=new AppearanceTracker();tracker.initializeProfile(profile,false,width,height);
 expect(tracker.update(frame(false,30),100,width,height)).toBeNull();expect(tracker.capturedAt).toBe(-Infinity);
 expect(tracker.update(frame(),200,width,height)?.state).toBe('TRACKING');
 expect(tracker.update(frame(false,30),300,width,height)?.state).toBe('TEMPORARILY_LOST');expect(tracker.capturedAt).toBe(200);
});
it('lost profiles cannot auto-reacquire after the unchanged stale deadline',()=>{
 const tracker=new AppearanceTracker();tracker.initializeProfile(saveTargetView([],'Robot',reference())[0],false,width,height);
 tracker.update(frame(),100,width,height);expect(tracker.age(900)?.targetLost).toBe(true);
 expect(tracker.update(frame(),1000,width,height)?.targetLost).toBe(true);
});
it('legacy saved target names migrate without fabricating visual references',()=>{
 const profiles=migrateTargetProfiles(undefined,['My cup','My cup']);
 expect(profiles).toEqual([{label:'My cup',references:[],matchThreshold:.7}]);
 const project=parseProject(JSON.stringify({...makeProject(),customObjects:['My cup']}));
 expect(project.targetProfiles).toEqual(profiles);expect(project.customObjects).toEqual(['My cup']);
 expect(()=>new AppearanceTracker().initializeProfile(profiles[0],false,width,height)).toThrow('Capture');
});
it('profile crop/mask/representation safely round-trips through project save/import',()=>{
 const targetProfiles=saveTargetView([],'Robot',reference());
 const parsed=parseProject(JSON.stringify({...makeProject(),targetProfiles}));
 expect(parsed.targetProfiles).toEqual(targetProfiles);expect(parsed.customObjects).toContain('Robot');
 expect(parseTargetProfiles([{...targetProfiles[0],matchThreshold:undefined}])[0].matchThreshold).toBe(.7);
 expect(()=>parseTargetProfiles([{...targetProfiles[0],matchThreshold:2}])).toThrow();
 expect(()=>parseTargetProfiles([{...targetProfiles[0],references:[{...targetProfiles[0].references[0],crop:{...targetProfiles[0].references[0].crop,image:'https://remote/image.png'}}]}])).toThrow();
});
it('profile views are bounded and never overwrite the original reference',()=>{
 let profiles=saveTargetView([],'Robot',reference());for(let i=1;i<8;i++)profiles=saveTargetView(profiles,'Robot',reference());
 expect(()=>saveTargetView(profiles,'Robot',reference())).toThrow('Remove');
 expect(profiles[0].references).toHaveLength(8);
});
it('the unchanged FollowController consumes mirrored profile targets',()=>{
 const profile=saveTargetView([],'Robot',reference())[0],left=new AppearanceTracker(),right=new AppearanceTracker();
 left.initializeProfile(profile,false,width,height);right.initializeProfile(profile,true,width,height);
 const a=left.update(frame(),100,width,height)!,b=right.update(frame(),100,width,height)!;
 expect(b.horizontalError).toBeCloseTo(-a.horizontalError);
 const l=trackedFollowCommand(a,TRACKED_FOLLOW_DEFAULTS),r=trackedFollowCommand(b,TRACKED_FOLLOW_DEFAULTS);
 expect(l.left).toBeLessThan(l.right);expect(r.left).toBeGreaterThan(r.right);
});
