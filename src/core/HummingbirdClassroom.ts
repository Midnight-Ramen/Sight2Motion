import { makeAction, type Action, type Rule, type ServoHome } from './types';
export const DEFAULT_SERVO_HOME: ServoHome = { port: 1, angle: 90 };
export const homeAngleForPort = (home: ServoHome | undefined, port: number) => home?.port === port ? home.angle : 90;
export const servoHomeAction = (home: ServoHome = DEFAULT_SERVO_HOME): Action => ({ ...makeAction('positionServo'), port: home.port, angle: home.angle });
/** Compile the optional helper into ordinary actions; use the existing sequence/cancellation engine. */
export function classroomRules(rules: Rule[], home?: ServoHome): Rule[] {
  return rules.map(rule => {
    const actions: Action[] = [];
    for (let i = 0; i < rule.actions.length; i++) {
      const action = rule.actions[i]; actions.push(action);
      if (action.enabled && action.kind === 'positionServo' && action.returnHome) {
        while (i + 1 < rule.actions.length && (!rule.actions[i + 1].enabled || rule.actions[i + 1].kind === 'wait')) actions.push(rule.actions[++i]);
        actions.push({ ...action, id: `${action.id}:return-home`, angle: homeAngleForPort(home, action.port ?? 1), returnHome: false });
      }
    }
    return { ...rule, actions };
  });
}
