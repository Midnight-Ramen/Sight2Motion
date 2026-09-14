import type { Rule } from './types';
export const objectLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
export function removalMessage(name: string, selected: string[], rules: Rule[]) {
  const rule = rules.find(r => r.className === name);
  if (rule) return `${objectLabel(name)} is being used by ‘${rule.name}’. Change or remove that rule first.`;
  if (selected.length <= 1) return 'Keep at least one object for this project.';
  return '';
}
