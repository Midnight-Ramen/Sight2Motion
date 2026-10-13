import { flushSync } from 'react-dom';
import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type SyntheticEvent } from 'react';
export type NumericOptions = { min?: number | string; max?: number | string; step?: number | string };
export function committedNumber(draft: string, previous: number, options: NumericOptions = {}, fallback = 0): number {
  const bound = (value: number | string | undefined) => value === undefined || value === '' ? undefined : Number.isFinite(Number(value)) ? Number(value) : undefined;
  const min = bound(options.min), max = bound(options.max), step = bound(options.step);
  let next = draft.trim() === '' || !Number.isFinite(Number(draft)) ? (Number.isFinite(previous) ? previous : fallback) : Number(draft);
  if (!Number.isFinite(next)) next = min ?? 0;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  if (step !== undefined && step > 0) next = Number(((min ?? 0) + Math.round((next - (min ?? 0)) / step) * step).toPrecision(12));
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}
/** Keep editing text local; only valid commits reach the existing runtime value handler. */
export function NumericInput({ value, defaultValue, onChange, onBlur, onFocus, onKeyDown, type: _type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const initial = value ?? defaultValue ?? '';
  const [draft, setDraft] = useState(String(initial));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value ?? defaultValue ?? '')); }, [value, defaultValue]);
  const commit = (event: SyntheticEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const previous = value === undefined || value === '' ? NaN : Number(value);
    const next = committedNumber(input.value, previous, props, Number(defaultValue ?? 0));
    const normalized = String(next);
    input.value = normalized;
    setDraft(normalized);
    // A pointer action may focus its button and immediately read the committed value.
    if (next !== previous) flushSync(() => onChange?.({ ...event, type: 'change', target: input, currentTarget: input } as ChangeEvent<HTMLInputElement>));
  };
  return <input {...props} type="number" value={draft}
    onFocus={event => { editing.current = true; onFocus?.(event); }}
    onChange={event => { editing.current = true; setDraft(event.currentTarget.value); }}
    onBlur={event => { editing.current = false; commit(event); onBlur?.(event); }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); editing.current = false; commit(event); }
      onKeyDown?.(event);
    }} />;
}
