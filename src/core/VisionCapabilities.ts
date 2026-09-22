import type { Rule, VisionProviderKind } from './types';

export interface VisionCapabilities {
  classification: boolean;
  boundingBoxes: boolean;
  regions: boolean;
  apparentDistance: boolean;
}
export const YOLO_CAPABILITIES: VisionCapabilities = {
  classification: true, boundingBoxes: true, regions: true, apparentDistance: true,
};
export const TM_CAPABILITIES: VisionCapabilities = {
  classification: true, boundingBoxes: false, regions: false, apparentDistance: false,
};
export const capabilitiesFor = (provider: VisionProviderKind = 'yolo') =>
  provider === 'yolo' ? YOLO_CAPABILITIES : TM_CAPABILITIES;
export function compatibleRule(rule: Rule, capabilities: VisionCapabilities): boolean {
  return (capabilities.boundingBoxes || !rule.actions.some(a => a.enabled && a.kind === 'move' && a.mode === 'follow')) &&
    (capabilities.regions || (rule.region ?? 'anywhere') === 'anywhere') &&
    (capabilities.apparentDistance || (rule.distance ?? 'any') === 'any');
}
export const classificationRule = (rule: Rule): Rule => ({ ...rule, region: 'anywhere', distance: 'any' });
