export interface SAMPoint { x: number; y: number; label: 0 | 1 }
export interface SAMBox { x: number; y: number; width: number; height: number }
export interface SAMPrompts { points: SAMPoint[]; box?: SAMBox }
export function promptInputs(prompts: SAMPrompts, scaleX: number, scaleY: number) {
  const coords: number[] = [], labels: number[] = [];
  for (const p of prompts.points) { coords.push(p.x * scaleX, p.y * scaleY); labels.push(p.label); }
  if (prompts.box) {
    const b = prompts.box;
    coords.push(b.x * scaleX, b.y * scaleY, (b.x + b.width) * scaleX, (b.y + b.height) * scaleY);
    labels.push(2, 3);
  } else { coords.push(0, 0); labels.push(-1); }
  if (!prompts.box && !prompts.points.some(p => p.label === 1)) throw new Error('Add a positive point or a box first.');
  return { coords: new Float32Array(coords), labels: new Float32Array(labels), count: labels.length };
}
