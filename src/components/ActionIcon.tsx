import { ArrowUp, ArrowDown, CornerUpLeft, CornerUpRight, ScanLine, Square, Lightbulb, Timer, RotateCw, Gauge, Music } from 'lucide-react';
import type { Action } from '../core/types';
export function ActionIcon({ action }: { action: Action }) {
  const Icon = action.kind === 'move' ? action.mode === 'follow' ? ScanLine :
    action.direction === 'left' ? CornerUpLeft : action.direction === 'right' ? CornerUpRight : action.direction === 'backward' ? ArrowDown : ArrowUp :
    action.kind === 'stop' ? Square : action.kind === 'wait' ? Timer : action.kind === 'rotationServo' ? RotateCw :
    action.kind === 'positionServo' ? Gauge : action.kind === 'sound' ? Music : Lightbulb;
  return <Icon size={19} aria-hidden="true" />;
}
