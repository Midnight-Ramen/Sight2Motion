import { expect, it } from 'vitest';
import { EncoderRecording, encoderPair } from '../src/core/EncoderRecording';
import { readFileSync } from 'node:fs';
it('captures origin, zeros relative values, and clears the session', () => {
 const r=new EncoderRecording();expect(r.setHome(null)).toBe(false);
 r.setHome({left:12,right:-4});expect(r.relative({left:12,right:-4})).toEqual({left:0,right:0});
 r.begin('forward',{left:12,right:-4});r.clear();expect(r.origin).toBeNull();expect(r.segments).toEqual([]);
});
it('groups each held direction and records signed relative deltas', () => {
 const r=new EncoderRecording();r.setHome({left:10,right:10});
 for(const direction of ['forward','backward','left','right'] as const) {
  r.begin(direction,{left:10,right:10});r.begin(direction,{left:10,right:10});
  r.observe({left:11,right:9});
 }
 expect(r.segments.map(s=>s.direction)).toEqual(['forward','backward','left','right']);
 expect(r.segments.every(s=>s.delta.left===1&&s.delta.right===-1)).toBe(true);
 r.stop({left:12,right:8});r.observe({left:99,right:99});expect(r.segments.at(-1)?.end).toEqual({left:2,right:-2});
});
it('ignores stale/unavailable values and never bridges data gaps', () => {
 const state={finchEncoderLeft:{reading:{kind:'number' as const,value:1},updatedAt:100},finchEncoderRight:{reading:{kind:'number' as const,value:2},updatedAt:100}};
 expect(encoderPair(state,100)).toEqual({left:1,right:2});expect(encoderPair(state,851)).toBeNull();expect(encoderPair({},100)).toBeNull();
 const r=new EncoderRecording();r.setHome({left:0,right:0});r.begin('forward',{left:0,right:0});r.observe(null);r.observe({left:10,right:10});expect(r.segments[0].delta).toEqual({left:0,right:0});
});
it('uses the existing provider with deduplicated encoder inputs and no recording timer', () => {
 const app=readFileSync('src/App.tsx','utf8');expect(app).toContain('provider.start(inputs, state =>');expect(app).toContain('!inputs.some(sensor => sensor.id === type)');
 const recorder=readFileSync('src/core/EncoderRecording.ts','utf8');expect(recorder).not.toMatch(/setInterval|setTimeout|setWheelSpeeds/);
});
