import { ruleNeedsVision, ruleSource, type Project, type Rule } from './types';
import { isFinchSensor } from './Sensors';
import { parseProject } from './ProjectStorage';
import { capabilitiesFor, compatibleRule } from './VisionCapabilities';
import { portsFor, ROBOTS } from './RobotCapabilities';
export const CAMERA_GUIDANCE_GRACE_MS = 1500;
/** Guidance tolerance only. Motor safety continues to use its own shorter watchdog. */
export function cameraGuidanceReady(connected: boolean, lastFrameAt: number, now: number) {
  return connected && Number.isFinite(lastFrameAt) && now >= lastFrameAt && now - lastFrameAt < CAMERA_GUIDANCE_GRACE_MS;
}

export interface SetupState {
  usableFrame: boolean; modelReady: boolean; classes: readonly string[];
  connected: boolean; hardwareBusy: boolean; running: boolean; demo: boolean;
  trackedName?: string;
}
export function setupReadiness(project: Project, state: SetupState) {
  const robot = Object.hasOwn(ROBOTS, project.robotType);
  const enabled = project.rules.filter(rule => rule.enabled);
  const needsVision = !enabled.length || enabled.some(ruleNeedsVision);
  const custom = project.customObjects ?? [];
  const needsTarget = enabled.some(rule => ruleNeedsVision(rule) && custom.includes(rule.className) && rule.className !== state.trackedName);
  const known = (name: string) => custom.includes(name) ? name === state.trackedName :
    project.visionProvider === 'teachable-machine' || state.modelReady ? state.classes.includes(name) : project.selectedClasses.includes(name);
  function ruleProblem(rule: Rule): string | undefined {
    if (!robot || !compatibleRule(rule, capabilitiesFor(project.visionProvider))) return 'Next: Update the rule for this AI vision mode.';
    if (ruleNeedsVision(rule) && !known(rule.className)) return custom.includes(rule.className) ? 'Next: Select and track your target.' : 'Next: Choose an available class in your rule.';
    const actions = rule.actions.filter(action => action.enabled);
    if (!actions.length) return 'Next: Enable an action in your rule.';
    for (const action of actions) {
      if (!ROBOTS[project.robotType].actions.includes(action.kind)) return 'Next: Choose an action supported by your robot.';
      const ports = portsFor(action.kind);
      if (ports.length && !ports.includes(action.port!)) return 'Next: Select the Hummingbird output port in your rule.';
    }
    if (ruleSource(rule) !== 'vision' && !rule.sensorConditions?.length) return 'Next: Add a sensor condition.';
    for (const condition of ruleSource(rule) === 'vision' ? [] : rule.sensorConditions ?? []) {
      const sensor = project.sensorConfiguration?.find(sensor => sensor.id === condition.sensorId);
      if (!sensor || (project.robotType === 'finch' ? !isFinchSensor(sensor.type) : isFinchSensor(sensor.type) || ![1, 2, 3].includes(sensor.port!)))
        return project.robotType === 'finch' ? 'Next: Configure the Finch sensor for your rule.' : 'Next: Configure the sensor port for your rule.';
    }
    try { parseProject(JSON.stringify({ ...project, rules: [{ ...rule, actions }] })); }
    catch { return 'Next: Complete your rule settings.'; }
  }
  const problems = enabled.map(ruleProblem);
  const rules = problems.some(problem => !problem);
  const objects = project.visionProvider === 'teachable-machine'
    ? state.classes.length > 0
    : project.selectedClasses.some(name => !state.modelReady || state.classes.includes(name)) || !!state.trackedName;
  const vision = state.modelReady && objects && !needsTarget;
  const camera = state.usableFrame;
  const configured = (!needsVision || camera || state.demo) && (!needsVision || vision || state.demo) && robot && rules;
  const play = configured && state.connected && !state.hardwareBusy;
  const helper = state.running ? 'Running. Press STOP or Space to pause.' :
    needsVision && !camera && !state.demo ? 'Next: Start your camera.' :
    needsVision && !state.modelReady && !state.demo ? 'Next: Load your AI vision model.' :
    needsTarget ? 'Next: Select and track your target.' :
    needsVision && !objects && !state.demo ? (project.visionProvider === 'teachable-machine' ? 'Next: Load a model with classes.' : 'Next: Choose an object for this project.') :
    !robot ? 'Next: Choose a robot.' :
    !state.connected ? 'Next: Connect your robot.' :
    !rules ? problems[0] ?? 'Next: Add and enable a rule.' :
    state.hardwareBusy ? 'Wait for the robot operation to finish.' :
    'Ready! Press Play.';
  return { camera, vision, robot: robot && state.connected, rules, play, helper, ruleProblems: Object.fromEntries(project.rules.map(rule => [rule.id, ruleProblem(rule)])) };
}
export function focusSetupSection(id: string) {
  const section = document.getElementById(id);
  section?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  section?.focus({ preventScroll: true });
}
