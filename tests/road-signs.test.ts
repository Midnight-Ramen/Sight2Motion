import {expect,it} from 'vitest';
import {RoadSignDetector,type RoadSignMapping} from '../src/core/RoadSigns';
const map:RoadSignMapping[]=[{className:'sign',action:'left'}];
const seen=[{className:'sign',confidence:.8}];
it('requires class, confidence, and 250ms fresh stability; triggers once',()=>{
 const d=new RoadSignDetector();
 expect(d.update([{className:'other',confidence:1}],0,0,.7,map)).toBeUndefined();
 expect(d.update([{className:'sign',confidence:.69}],100,100,.7,map)).toBeUndefined();
 expect(d.update(seen,200,200,.7,map)).toBeUndefined();expect(d.update(seen,449,449,.7,map)).toBeUndefined();
 expect(d.update(seen,450,450,.7,map)).toBe('left');expect(d.update(seen,900,900,.7,map)).toBeUndefined();
});
it('requires 500ms absence before a new 250ms appearance',()=>{
 const d=new RoadSignDetector();d.update(seen,0,0,.7,map);d.update(seen,250,250,.7,map);
 d.update([],300,300,.7,map);d.update([],799,799,.7,map);expect(d.update(seen,800,800,.7,map)).toBeUndefined();
 d.update([],900,900,.7,map);d.update([],1400,1400,.7,map);d.update(seen,1500,1500,.7,map);expect(d.update(seen,1750,1750,.7,map)).toBe('left');
});
it.each(['stop','continue','left','right'] as const)('maps %s from classification or detection results',action=>{
 const d=new RoadSignDetector(),m=[{className:'sign',action}];d.update(seen,0,0,.7,m);expect(d.update(seen,250,250,.7,m)).toBe(action);
});
it('rejects duplicate/stale frames and gaps do not count as stable sightings',()=>{
 const d=new RoadSignDetector();d.update(seen,0,0,.7,map);expect(d.update(seen,0,250,.7,map)).toBeUndefined();
 expect(d.update(seen,250,2000,.7,map)).toBeUndefined();expect(d.update(seen,2000,2000,.7,map)).toBeUndefined();
 expect(d.update(seen,2250,2250,.7,map)).toBe('left');
});
it('Stop takes priority when multiple mapped classes qualify',()=>{
 const d=new RoadSignDetector(),m=[...map,{className:'stop',action:'stop' as const}],items=[...seen,{className:'stop',confidence:1}];
 d.update(items,0,0,.7,m);expect(d.update(items,250,250,.7,m)).toBe('stop');
});

it('Stop remains held while visible and releases only after 500ms continuous absence, then repeats',()=>{
 const d=new RoadSignDetector(),m:RoadSignMapping[]=[{className:'sign',action:'stop'}];
 d.update(seen,0,0,.7,m);expect(d.update(seen,250,250,.7,m)).toBe('stop');
 for(let t=500;t<=2250;t+=250)expect(d.update(seen,t,t,.7,m)).toBeUndefined();
 expect(d.update([],2300,2300,.7,m)).toBeUndefined();expect(d.update([],2799,2799,.7,m)).toBeUndefined();
 expect(d.update([],2800,2800,.7,m)).toBe('resume');
 d.update(seen,2900,2900,.7,m);expect(d.update(seen,3150,3150,.7,m)).toBe('stop');
});
it('interrupted absence and missing frames never release a Stop hold',()=>{
 const d=new RoadSignDetector(),m:RoadSignMapping[]=[{className:'sign',action:'stop'}];
 d.update(seen,0,0,.7,m);d.update(seen,250,250,.7,m);d.update([],300,300,.7,m);d.update(seen,700,700,.7,m);
 expect(d.update([],800,800,.7,m)).toBeUndefined();expect(d.update([],800,1400,.7,m)).toBeUndefined();
 expect(d.update([],4000,4000,.7,m)).toBeUndefined();d.reset();expect(d.update([],4500,4500,.7,m)).toBeUndefined();
});
