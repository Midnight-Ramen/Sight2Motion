import { it, expect } from 'vitest';
import { detectionRegion, withDetectionRegions } from '../src/core/DetectionRegions';
import { RuleEngine } from '../src/core/RuleEngine';
import { makeRule, makeProject, type Detection } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';
const detection = (center: number): Detection => ({className:'person', confidence:0.9,x:center-10,y:0,width:20,height:40,centerX:center,centerY:20});
it('classifies frame centers and exact third boundaries deterministically', () => {
  expect([30,150,270,100,200].map(x=>detectionRegion(detection(x),300))).toEqual(['left','center','right','center','right']);
});
it('matches a qualifying detection in the selected region and preserves timing', () => {
  const detections=withDetectionRegions([detection(30)],300);
  for(const region of ['left','right','anywhere'] as const) {
    const rule={...makeRule(),region}; const engine=new RuleEngine();
    expect(engine.evaluate([rule],detections,0)).toEqual([]);
    expect(engine.evaluate([rule],detections,500)).toHaveLength(region==='right'?0:1);
    expect(engine.evaluate([rule],detections,600)).toEqual([]);
  }
});
it('accepts one qualifying person among detections in different regions', () => {
  const rule={...makeRule(),region:'left' as const,minDuration:0};
  const detections=withDetectionRegions([detection(150),detection(270),detection(30)],300);
  expect(new RuleEngine().evaluate([rule],detections,0)).toHaveLength(1);
  detections[2].confidence=0.2;
  expect(new RuleEngine().evaluate([rule],detections,0)).toHaveLength(0);
});
it('persists regions and migrates missing locations to anywhere', () => {
  const project=makeProject(); project.rules[0].region='right';
  expect(parseProject(JSON.stringify(project)).rules[0].region).toBe('right');
  const {region,...legacy}=project.rules[0];
  expect(parseProject(JSON.stringify({...project,rules:[legacy]})).rules[0].region).toBe('anywhere');
});
