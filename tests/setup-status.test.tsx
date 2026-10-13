import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {setupReadiness} from '../src/core/SetupReadiness';
import {makeProject} from '../src/core/types';
import {SetupStatus,setupStatus} from '../src/components/SetupStatus';
const state={usableFrame:false,modelReady:false,classes:['person'],connected:false,hardwareBusy:false,running:false,demo:false};
it('formats progress and next guidance using existing readiness values',()=>{
 const readiness=setupReadiness(makeProject(),state);
 const status=setupStatus(readiness,false,readiness.play,false);
 expect(status.count).toBe([readiness.camera,readiness.vision,readiness.robot,readiness.rules,readiness.play].filter(Boolean).length);
 expect(status.full).toContain(readiness.helper);
 expect(status.short).toBe(`Setup ${status.count}/5`);
});
it('shows camera/model/connection progress without evaluating a second readiness model',()=>{
 const readiness=setupReadiness(makeProject(),{...state,usableFrame:true,modelReady:true});
 const status=setupStatus(readiness,false,readiness.play,false);
 expect(status.full).toContain('Next: Connect your robot.');
 expect(status.count).toBe(3);
});
it('shows Ready, Running and paused states without changing readiness',()=>{
 const readiness=setupReadiness(makeProject(),{...state,usableFrame:true,modelReady:true,connected:true});
 const original=JSON.stringify(readiness);
 expect(setupStatus(readiness,false,true,false).full).toBe('\u2713 Ready to run');
 expect(setupStatus(readiness,true,true,true).full).toBe('\u25cf Running');
 expect(setupStatus(readiness,false,true,true).full).toBe('Rules paused');
 expect(JSON.stringify(readiness)).toBe(original);
});
it('keeps the step list inside a closed popover with compact responsive text',()=>{
 const readiness=setupReadiness(makeProject(),state);
 const html=renderToStaticMarkup(<SetupStatus readiness={readiness} running={false} canPlay={false} onStep={()=>{}}/>);
 expect(html).toContain('<details>');expect(html).not.toContain('<details open');
 expect(html).toContain('setup-status-short');expect(html).toContain('Load AI model');
 expect(html).not.toContain('class="workflow"');
});
