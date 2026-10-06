import { expect, it } from 'vitest';
import { makeRule, makeAction } from '../src/core/types';
import { finchSensorDescriptor } from '../src/core/Sensors';
import { ruleSummary, actionCaption } from '../src/components/RuleSummary';
it('summarizes existing vision and movement data without modifying it', () => {
 const rule = {...makeRule(), className:'person', region:'center' as const, actions:[{...makeAction('move'), mode:'follow' as const}]};
 const before = JSON.stringify(rule);
 expect(ruleSummary(rule, [])).toBe('person in center → Follow');
 expect(JSON.stringify(rule)).toBe(before);
});
it('summarizes sensor and combined conditions including units', () => {
 const rule = {...makeRule(), source:'sensor' as const, sensorConditions:[{id:'c',sensorId:'finchDistance',operator:'lessThan' as const,value:20}], actions:[makeAction('stop')]};
 expect(ruleSummary(rule,[finchSensorDescriptor('finchDistance')])).toContain('Distance < 20 cm →');
 expect(ruleSummary({...rule,source:'vision-sensor',className:'person'},[finchSensorDescriptor('finchDistance')])).toContain('person AND Distance < 20 cm');
});
it('excludes disabled actions and describes existing turn directions', () => {
 expect(ruleSummary({...makeRule(),actions:[{...makeAction('beak'),enabled:false}]},[])).toContain('Add an action');
 expect(actionCaption({...makeAction('move'),direction:'left'})).toBe('Turn Left');
});
