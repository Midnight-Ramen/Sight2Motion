import { NumericInput } from './NumericInput';
import type { InputHTMLAttributes } from 'react';
// Slider changes commit immediately; the numeric field keeps its own editing draft.
export function NumericSlider({ type = 'number', 'aria-label': label, ...props }: InputHTMLAttributes<HTMLInputElement> & { 'aria-label': string }) {
  return <span className="numeric-slider">
    <input {...props} type="range" aria-label={type === 'range' ? label : `${label} slider`} />
    <NumericInput {...props} type="number" aria-label={type === 'number' ? label : `${label} value`} />
  </span>;
}
