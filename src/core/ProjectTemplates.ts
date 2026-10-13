import { FOLLOW_DEFAULTS } from './FollowController';
import { sensorDescriptor } from './Sensors';
import { makeAction, makeProject, makeRule, type Project, type RobotType, type VisionProviderKind } from './types';

export interface TemplateBaseSetup { id: string; mode: 'None' | 'Cruise Forward' | 'Line Follow' }
export interface TemplatePorts { sensor?: number; output?: number }
export interface ProjectTemplate {
  id: string; name: string; description: string;
  recommendedRobot: RobotType; visionProvider: VisionProviderKind;
  ports?: { output: 'LED' | 'Servo'; max: number; sensor?: boolean };
  helper?: string;
  steps?: string[];
  baseMode?: 'None' | 'Cruise Forward' | 'Line Follow';
  selectedTarget?: boolean;
  createProject(ports?: TemplatePorts): Project;
}
const base = (name: string, robotType: RobotType = 'finch'): Project => ({
  ...makeProject(), name, robotType, rules: [], selectedClasses: [],
});
function port(value: number | undefined, max: number) {
  if (!Number.isInteger(value) || value! < 1 || value! > max) throw new Error('Choose your connected ports first.');
  return value!;
}
const scaffold = (name: string, source: 'vision' | 'vision-sensor' = 'vision') => ({
  ...makeRule(), name, source, className: '', actions: [],
});
function servoProject(name: string, ports: TemplatePorts, sensor: boolean): Project {
  const output = port(ports.output, 4);
  const input = sensor ? sensorDescriptor('distance', port(ports.sensor, 3)) : undefined;
  return { ...base(name, 'hummingbird'), visionProvider: sensor ? 'yolo' : 'teachable-machine',
    servoHome: { port: output, angle: 90 }, sensorConfiguration: input ? [input] : [],
    rules: [{ ...scaffold('Choose a class and set servo angles', sensor ? 'vision-sensor' : 'vision'),
      ...(input ? { sensorConditions: [{ id: crypto.randomUUID(), sensorId: input.id, operator: 'lessThan' as const, value: 20 }] } : {}),
      actions: [{ ...makeAction('positionServo'), port: output, angle: 90, returnHome: true }, makeAction('wait')],
    }],
  };
}
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: 'ai-reaction', name: 'AI Reaction', description: 'Make your robot react to something the camera recognizes.',
    recommendedRobot: 'finch', visionProvider: 'yolo', baseMode: 'None',
    steps: ['Start the camera and load your model.', 'Choose an object for the rule.', 'Choose an action and connect your robot.', 'Press Play when ready.'],
    createProject: () => ({ ...base('AI Reaction'), rules: [scaffold('Choose an object and action')] }) },
  { id: 'ai-sorting', name: 'AI Sorting Mechanism', description: 'Use an image class to move a Hummingbird sorting servo.',
    recommendedRobot: 'hummingbird', visionProvider: 'teachable-machine', ports: { output: 'Servo', max: 4 },
    steps: ['Choose the connected servo port.', 'Load your Teachable Machine model and choose a class.', 'Set the sorting angle and Servo Home angle.', 'Adjust or remove Wait; Return Home is enabled.', 'Connect your robot and press Play.'],
    createProject: (ports = {}) => servoProject('AI Sorting Mechanism', ports, false) },
  { id: 'smart-gate', name: 'Smart Gate', description: 'Open a servo gate when vision and a distance sensor agree.',
    recommendedRobot: 'hummingbird', visionProvider: 'yolo', ports: { output: 'Servo', max: 4, sensor: true },
    steps: ['Choose the connected distance and servo ports.', 'Start vision and choose an object or person.', 'Set the distance threshold, open angle, and Servo Home angle.', 'Adjust Wait, then connect and press Play.'],
    createProject: (ports = {}) => servoProject('Smart Gate', ports, true) },
  { id: 'sensor-vision', name: 'Sensor + Vision', description: 'Combine a camera detection with a sensor condition.',
    recommendedRobot: 'hummingbird', visionProvider: 'yolo', baseMode: 'None',
    steps: ['Choose your robot and configure a sensor input.', 'Start vision and choose an object.', 'Add the sensor condition and an action.', 'Connect your robot and press Play.'],
    createProject: () => ({ ...base('Sensor + Vision', 'hummingbird'), rules: [scaffold('Choose vision, sensor, and action', 'vision-sensor')] }) },
  { id: 'self-driving', name: 'Self-Driving Car', description: 'Cruise with a Finch and add vision or sensor reactions.',
    recommendedRobot: 'finch', visionProvider: 'yolo', baseMode: 'Cruise Forward',
    steps: ['Connect Finch and check fresh distance readings.', 'Keep Emergency braking on and check its distance.', 'Choose Vision, Sensor, or Vision + Sensor for the rule.', 'Configure its condition and reaction, then press Play.'],
    createProject: () => ({ ...base('Self-Driving Car'), rules: [scaffold('Choose a driving condition and reaction')] }) },
  { id: 'follow-target', name: 'Follow a Target', description: 'Teach MobileSAM a target for Finch to follow.',
    recommendedRobot: 'finch', visionProvider: 'yolo', selectedTarget: true, baseMode: 'None',
    steps: ['Start the camera and select a target.', 'Add reference views of the target.', 'Connect Finch and choose Follow selected target.', 'Press Play when the target is ready.'],
    createProject: () => base('Follow a Target') },
  { id: 'line-vehicle', name: 'Line-Following Vehicle', description: 'Follow a track with Finch’s paired line sensors.',
    recommendedRobot: 'finch', visionProvider: 'yolo', baseMode: 'Line Follow',
    steps: ['Connect Finch and check its line readings.', 'Place it on your line track.', 'Review the marker action and Emergency braking.', 'Press Play; use STOP to end the run.'],
    createProject: () => base('Line-Following Vehicle') },
  { id: 'follow', name: 'Follow a Person', description: 'Make a Finch steer toward a detected person.',
    recommendedRobot: 'finch', visionProvider: 'yolo',
    createProject: () => ({ ...base('Follow a Person'), selectedClasses: ['person'], rules: [{
      ...makeRule(), name: 'Follow a person', mode: 'continuous',
      actions: [{ ...makeAction('move'), ...FOLLOW_DEFAULTS, mode: 'follow', followSpeed: 20 }],
    }] }) },
  { id: 'reaction', name: 'Object Reaction Robot', description: 'Make your robot react when the camera recognizes something.',
    recommendedRobot: 'finch', visionProvider: 'yolo',
    createProject: () => ({ ...base('Object Reaction Robot'), selectedClasses: ['person'], rules: [{ ...makeRule(), name: 'Person turns beak green' }] }) },
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
