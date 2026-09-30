import { FOLLOW_DEFAULTS } from './FollowController';
import { sensorDescriptor } from './Sensors';
import { makeAction, makeProject, makeRule, type Project, type RobotType, type VisionProviderKind } from './types';

export interface TemplatePorts { sensor?: number; output?: number }
export interface ProjectTemplate {
  id: string; name: string; description: string;
  recommendedRobot: RobotType; visionProvider: VisionProviderKind;
  ports?: { output: 'LED' | 'Servo'; max: number; sensor?: boolean };
  helper?: string;
  createProject(ports?: TemplatePorts): Project;
}
const base = (name: string, robotType: RobotType = 'finch'): Project => ({
  ...makeProject(), name, robotType, rules: [], selectedClasses: [],
});
function port(value: number | undefined, max: number) {
  if (!Number.isInteger(value) || value! < 1 || value! > max) throw new Error('Choose your connected ports first.');
  return value!;
}
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: 'follow', name: 'Follow a Person', description: 'Make a Finch steer toward a detected person.',
    recommendedRobot: 'finch', visionProvider: 'yolo',
    createProject: () => ({ ...base('Follow a Person'), selectedClasses: ['person'], rules: [{
      ...makeRule(), name: 'Follow a person', mode: 'continuous',
      actions: [{ ...makeAction('move'), ...FOLLOW_DEFAULTS, mode: 'follow', followSpeed: 20 }],
    }] }) },
  { id: 'reaction', name: 'Object Reaction Robot', description: 'Make your robot react when the camera recognizes something.',
    recommendedRobot: 'finch', visionProvider: 'yolo',
    createProject: () => ({ ...base('Object Reaction Robot'), selectedClasses: ['person'], rules: [makeRule()] }) },
  { id: 'sensor', name: 'Vision + Sensor Challenge', description: 'Combine AI vision with a physical sensor.',
    recommendedRobot: 'hummingbird', visionProvider: 'yolo', ports: { output: 'LED', max: 3, sensor: true },
    createProject: (ports = {}) => {
      const sensor = sensorDescriptor('distance', port(ports.sensor, 3));
      return { ...base('Vision + Sensor Challenge', 'hummingbird'), selectedClasses: ['person'], sensorConfiguration: [sensor],
        rules: [{ ...makeRule(), name: 'Person and distance below 30 cm',
          sensorConditions: [{ id: crypto.randomUUID(), sensorId: sensor.id, operator: 'lessThan', value: 30 }],
          actions: [{ ...makeAction('singleLed'), port: port(ports.output, 3), brightness: 100 }],
        }] };
    } },
  { id: 'servo', name: 'Vision-Controlled Servo', description: 'Move a Hummingbird servo using what the camera sees.',
    recommendedRobot: 'hummingbird', visionProvider: 'yolo', ports: { output: 'Servo', max: 4 },
    createProject: (ports = {}) => ({ ...base('Vision-Controlled Servo', 'hummingbird'), selectedClasses: ['person'],
      rules: [{ ...makeRule(), name: 'Person moves servo', actions: [{ ...makeAction('positionServo'), port: port(ports.output, 4), angle: 90 }] }] }) },
  { id: 'classifier', name: 'Custom AI Classifier', description: 'Use your own Teachable Machine classes.',
    recommendedRobot: 'finch', visionProvider: 'teachable-machine',
    helper: 'Load your Teachable Machine image model, then choose a class to control your robot.',
    createProject: () => ({ ...base('Custom AI Classifier'), visionProvider: 'teachable-machine' }) },
  { id: 'blank', name: 'Blank Project', description: 'Start from scratch.', recommendedRobot: 'finch', visionProvider: 'yolo',
    createProject: () => base('Name Your Project') },
];
/** The UI supplies the existing STOP-before-replacement path; templates have no runtime. */
export async function selectProjectTemplate(template: ProjectTemplate, ports: TemplatePorts,
  replaceProject: (project: Project) => Promise<void>) {
  await replaceProject(template.createProject(ports));
}
