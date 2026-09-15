import { actionDefinitions, validTailSequence, type Action, type Project } from './types';
import { normalizeTeachableMachineUrl } from './TeachableMachineUrl';
import { SENSOR_TYPES, SENSOR_OPERATORS, sensorDescriptor } from './Sensors';
const KEY = 'vision-robot-studio.projects.v1';
const number = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function parseProject(text: string): Project {
  if (text.length > 1_000_000) throw new Error('This project file is too large.');
  const p: unknown = JSON.parse(text);
  if (
    !obj(p) ||
    p.version !== 1 ||
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    p.name.length > 100 ||
    !['mock-finch', 'finch', 'hummingbird'].includes(String(p.robotType)) ||
    (p.visionProvider !== undefined && !['yolo', 'teachable-machine'].includes(String(p.visionProvider))) ||
    (p.teachableMachineUrl !== undefined && (typeof p.teachableMachineUrl !== 'string' || p.teachableMachineUrl.length > 2048)) ||
    !obj(p.vision) ||
    !number(p.vision.confidence, 0.1, 1) ||
    !number(p.vision.fps, 1, 30) ||
    typeof p.vision.visualize !== 'boolean' ||
    typeof p.vision.model !== 'string' ||
    !Array.isArray(p.rules) ||
    p.rules.length > 50
  )
    throw new Error('Choose a valid Robot Studio project.');
  const ids = new Set<string>();
  const configuration = p.sensorConfiguration ?? [];
  if (!Array.isArray(configuration) || configuration.length > 3 || configuration.some(s => !obj(s) ||
    !Object.hasOwn(SENSOR_TYPES, String(s.type)) || !Number.isInteger(s.port) || !number(s.port, 1, 3) ||
    s.id !== `${s.type}:${s.port}`) || new Set(configuration.map(s => s.port)).size !== configuration.length)
    throw new Error('Sensor configuration is not valid.');
  for (const r of p.rules) {
    if (
      !obj(r) ||
      typeof r.id !== 'string' ||
      ids.has(r.id) ||
      typeof r.name !== 'string' ||
      r.name.length > 100 ||
      typeof r.className !== 'string' ||
      r.className.length > 100 ||
      typeof r.enabled !== 'boolean' ||
      (r.region !== undefined && !['anywhere', 'left', 'center', 'right'].includes(String(r.region))) ||
      (r.distance !== undefined && !['any', 'far', 'near'].includes(String(r.distance))) ||
      (r.nearThreshold !== undefined && !number(r.nearThreshold, 0.03, 0.4)) ||
      !number(r.confidence, 0.1, 1) ||
      !number(r.minDuration, 0, 60000) ||
      !number(r.cooldown, 100, 60000) ||
      !number(r.interval, 100, 60000) ||
      !['appearance', 'continuous', 'interval', 'disappearance'].includes(String(r.mode)) ||
      !Array.isArray(r.actions) ||
      r.actions.length > 30
    )
      throw new Error('A rule in this file is not valid.');
    ids.add(r.id);
    const conditions = r.sensorConditions ?? [];
    if (!Array.isArray(conditions) || conditions.length > 10 || conditions.some(c => !obj(c) ||
      typeof c.id !== 'string' || typeof c.sensorId !== 'string' || !/^(distance|light|sound|analog|digital):[1-3]$/.test(c.sensorId) ||
      !Object.hasOwn(SENSOR_OPERATORS, String(c.operator)) ||
      !(typeof c.value === 'boolean' ? c.operator === 'equals' : number(c.value, -10000, 10000))) ||
      new Set(conditions.map(c => c.id)).size !== conditions.length)
      throw new Error('A sensor condition is not valid.');
    for (const a of r.actions) {
      if (
        !obj(a) ||
        typeof a.id !== 'string' ||
        ids.has(a.id) ||
        !Object.hasOwn(actionDefinitions, String(a.kind)) ||
        typeof a.enabled !== 'boolean' ||
        (['singleLed', 'triLed', 'positionServo', 'rotationServo'].includes(String(a.kind)) &&
          (!Number.isInteger(a.port) || !number(a.port, 1, a.kind === 'singleLed' ? 3 : a.kind === 'triLed' ? 2 : 4))) ||
        (a.kind === 'singleLed' && !number(a.brightness, 0, 100)) ||
        (a.kind === 'positionServo' && !number(a.angle, 0, 180)) ||
        (a.kind === 'rotationServo' && !['forward', 'backward'].includes(String(a.direction))) ||
        (a.mode !== undefined && !['timed', 'continuous'].includes(String(a.mode))) ||
        (a.kind === 'tailLightSequence' && !validTailSequence(a as Partial<Action>)) ||
        (a.tailLights !== undefined && (!Array.isArray(a.tailLights) || a.tailLights.length > 4 || a.tailLights.some(v => ![1, 2, 3, 4].includes(v as number)))) ||
        typeof a.color !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(a.color) ||
        !number(a.duration, 0, 10000) ||
        !number(a.speed, 0, 100) ||
        !['forward', 'backward', 'left', 'right'].includes(String(a.direction)) ||
        !['C4', 'E4', 'G4', 'C5', 'D5', 'E5', 'G5'].includes(String(a.note))
      )
        throw new Error('An action in this file is not valid.');
      ids.add(a.id);
    }
  }
  if (p.selectedClasses !== undefined && (!Array.isArray(p.selectedClasses) ||
    p.selectedClasses.length > 80 || p.selectedClasses.some(c => typeof c !== 'string' || !c.trim() || c.length > 100)))
    throw new Error('Project objects are not valid.');
  const valid = p as unknown as Project;
  const teachableMachineUrl = valid.teachableMachineUrl ? normalizeTeachableMachineUrl(valid.teachableMachineUrl) : undefined;
  // Preserve every referenced class, including legacy projects with more than ten objects.
  const selectedClasses = [...new Set([...(valid.selectedClasses ?? []), ...valid.rules.map(r => r.className)])];
  if (!selectedClasses.length) selectedClasses.push('person');
  // Keep only our schema: extra imported fields (including media) are discarded.
  return {
    version: 1,
    visionProvider: valid.visionProvider ?? 'yolo',
    ...(teachableMachineUrl ? { teachableMachineUrl } : {}),
    selectedClasses,
    sensorConfiguration: configuration.map(s => sensorDescriptor(s.type as keyof typeof SENSOR_TYPES, s.port)),
    id: valid.id,
    name: valid.name,
    robotType: String(valid.robotType) === 'mock-finch' ? 'finch' : valid.robotType,
    vision: {
      model: valid.vision.model,
      confidence: valid.vision.confidence,
      fps: valid.vision.fps,
      visualize: valid.vision.visualize,
    },
    rules: valid.rules.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      className: r.className,
      confidence: r.confidence,
      region: r.region ?? 'anywhere',
      distance: r.distance ?? 'any',
      nearThreshold: r.nearThreshold ?? 0.12,
      minDuration: r.minDuration,
      cooldown: r.cooldown,
      interval: r.interval,
      mode: r.mode,
      sensorConditions: (r.sensorConditions ?? []).map(c => ({ id: c.id, sensorId: c.sensorId, operator: c.operator, value: c.value })),
      actions: r.actions.map((a) => ({
        id: a.id,
        kind: a.kind,
        enabled: a.enabled,
        mode: a.mode ?? 'timed',
        ...(['singleLed', 'triLed', 'positionServo', 'rotationServo'].includes(a.kind) ? { port: a.port } : {}),
        ...(a.kind === 'singleLed' ? { brightness: a.brightness } : {}),
        ...(a.kind === 'positionServo' ? { angle: a.angle } : {}),
        color: a.color,
        ...(a.tailLights !== undefined ? { tailLights: [...new Set(a.tailLights)] } : {}),
        ...(a.kind === 'tailLightSequence' ? {
          steps: a.steps!.map(s => ({ light: s.light, color: s.color })),
          stepDurationMs: a.stepDurationMs, repeatCount: a.repeatCount,
          clearPrevious: a.clearPrevious, clearWhenFinished: a.clearWhenFinished,
        } : {}),
        duration: a.duration,
        speed: a.speed,
        direction: a.direction,
        note: a.note,
      })),
    })),
  };
}
export class ProjectStorage {
  list(): Project[] {
    const text = localStorage.getItem(KEY);
    if (!text) return [];
    const rows: unknown = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error('Saved projects could not be read.');
    return rows.map((p) => parseProject(JSON.stringify(p)));
  }
  save(project: Project) {
    const projects = this.list().filter((p) => p.id !== project.id);
    projects.unshift(parseProject(JSON.stringify(project)));
    localStorage.setItem(KEY, JSON.stringify(projects));
  }
  export(project: Project) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9-_]/gi, '-') || 'project'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}




