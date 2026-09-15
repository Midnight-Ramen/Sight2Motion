import { makeAction, type Action, type ActionKind, type RobotType, type Rule } from './types';
export const ROBOTS: Record<RobotType, { name: string; actions: ActionKind[] }> = {
  finch: { name: 'Finch 2', actions: ['beak', 'tail', 'tailLightSequence', 'move', 'wait', 'stop'] },
  hummingbird: { name: 'Hummingbird Bit', actions: ['singleLed', 'triLed', 'positionServo', 'rotationServo', 'stop', 'wait'] },
};
export const portsFor = (kind: ActionKind): number[] =>
  kind === 'singleLed' ? [1, 2, 3] : kind === 'triLed' ? [1, 2] :
    ['positionServo', 'rotationServo'].includes(kind) ? [1, 2, 3, 4] : [];
// Position and rotation commands address the same physical servo connector.
export const outputKey = (action: Action): string | null => action.kind === 'move' ? 'wheels' :
  ['rotationServo', 'positionServo'].includes(action.kind) ? `servo:${action.port ?? 1}` : null;
export const continuousOutput = (action: Action) =>
  ['move', 'rotationServo'].includes(action.kind) && action.mode === 'continuous';
export function resetActions(kind: RobotType, rules: Rule[]): Action[] {
  if (kind === 'finch') return [
    { ...makeAction('beak'), color: '#000000' },
    { ...makeAction('tail'), color: '#000000', tailLights: [1, 2, 3, 4] },
  ];
  const actions = rules.flatMap(rule => rule.actions);
  const rotationPorts = new Set(actions.filter(a => a.kind === 'rotationServo').map(a => a.port ?? 1));
  const positionPorts = new Set([2, ...actions.filter(a => a.kind === 'positionServo').map(a => a.port ?? 1)]);
  return [
    ...portsFor('singleLed').map(port => ({ ...makeAction('singleLed'), port, brightness: 0 })),
    ...portsFor('triLed').map(port => ({ ...makeAction('triLed'), port, color: '#000000' })),
    ...[...positionPorts].filter(port => !rotationPorts.has(port)).map(port => ({ ...makeAction('positionServo'), port, angle: 90 })),
  ];
}
export const manualTests = (kind: RobotType): { label: string; action: Action }[] => kind === 'finch' ? [
  { label: 'GREEN BEAK', action: { ...makeAction('beak'), color: '#00ff00' } },
  { label: 'RED BEAK', action: { ...makeAction('beak'), color: '#ff0000' } },
  { label: 'WHEELS 10% · 1 sec', action: { ...makeAction('move'), speed: 10, duration: 1000 } },
] : [
  { label: 'Single LED 1 → 100%', action: makeAction('singleLed') },
  { label: 'Tri LED 1 → Green', action: { ...makeAction('triLed'), color: '#00ff00' } },
  { label: 'Position servo 2 → 90°', action: { ...makeAction('positionServo'), port: 2 } },
  { label: 'Rotation servo 1 → 25% · 500 ms', action: { ...makeAction('rotationServo'), speed: 25, duration: 500 } },
];
