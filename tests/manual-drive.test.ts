import { expect, it, vi } from 'vitest';
import { driveKeys } from '../src/components/ManualDrive';
import { ActionEngine } from '../src/core/ActionEngine';
import { MockRobotAdapter } from './MockRobotAdapter';
import { makeRule, makeAction } from '../src/core/types';
it('maps WASD and arrows to the same four directions', () => {
 expect(driveKeys).toEqual({w:'forward',ArrowUp:'forward',s:'backward',ArrowDown:'backward',a:'left',ArrowLeft:'left',d:'right',ArrowRight:'right'});
});
it('reuses continuous ownership and releases it immediately on STOP', async () => {
 const robot=new MockRobotAdapter();await robot.connect();const engine=new ActionEngine(robot);
 const rule={...makeRule(),id:'manual',actions:[{...makeAction('move'),mode:'continuous' as const,speed:30}]};
 await engine.updateRules([rule],[rule]);
 expect(robot.state.left).toBe(30);expect(engine.activeMotorOwnerRuleId).toBe('manual');
 await engine.stop();expect(robot.state.left).toBe(0);expect(engine.activeMotorOwnerRuleId).toBeNull();
});
it('release cancels a pending manual start before it can issue motion', async () => {
 const robot=new MockRobotAdapter();await robot.connect();const execute=vi.spyOn(robot,'executeAction');const engine=new ActionEngine(robot);
 const rule={...makeRule(),id:'manual',actions:[{...makeAction('move'),mode:'continuous' as const}]};
 const starting=engine.updateRules([rule],[rule]);await engine.stop();await starting;
 expect(execute).not.toHaveBeenCalled();expect(engine.activeMotorOwnerRuleId).toBeNull();
});
