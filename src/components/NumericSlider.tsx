import type { InputHTMLAttributes } from 'react';
// Both controls share the original value and handler; this component performs no conversion.
export function NumericSlider({ type = 'number', 'aria-label': label, ...props }: InputHTMLAttributes<HTMLInputElement> & { 'aria-label': string }) {
  return <span className="numeric-slider">
    <input {...props} type="range" aria-label={type === 'range' ? label : `${label} slider`} />
    <input {...props} type="number" aria-label={type === 'number' ? label : `${label} value`} />
  </span>;
}
