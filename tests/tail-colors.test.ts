import { expect, it } from 'vitest';
import { makeAction, makeProject } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';
it('round-trips per-light colors and preserves legacy shared-color projects', () => {
 const p=makeProject(); p.robotType='finch';
 p.rules[0].actions=[{...makeAction('tail'),tailLights:[1,3],color:'#00ff00'}];
 expect(parseProject(JSON.stringify(p)).rules[0].actions[0]).not.toHaveProperty('tailColors');
 p.rules[0].actions[0].tailColors={1:'#ff0000',3:'#0000ff'};
 expect(parseProject(JSON.stringify(p)).rules[0].actions[0].tailColors).toEqual({1:'#ff0000',3:'#0000ff'});
});
it('rejects invalid per-light color keys and values', () => {
 for(const tailColors of [{5:'#ff0000'},{1:'red'},[]]) {
  const p=makeProject(); p.rules[0].actions=[{...makeAction('tail'),tailColors} as never];
  expect(()=>parseProject(JSON.stringify(p))).toThrow();
 }
});
