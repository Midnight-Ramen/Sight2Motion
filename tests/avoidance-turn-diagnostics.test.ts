import { expect, it } from 'vitest';
import { AvoidanceTurnDiagnostics, AVOID_SCAN_ANGLE_DEG, AVOID_BYPASS_ANGLE_DEG, AVOID_TURN_POWER } from '../src/core/AvoidanceTurnDiagnostics';
import { OBSTACLE_AVOIDANCE } from '../src/core/ObstacleAvoidance';
import { turnRotations, FINCH_TURN_CALIBRATION } from '../src/core/FinchGeometry';

it('centralizes avoidance tuning without changing shared turn calibration or route defaults', () => {
  expect([AVOID_SCAN_ANGLE_DEG, AVOID_BYPASS_ANGLE_DEG, AVOID_TURN_POWER]).toEqual([30, 45, 20]);
  expect(OBSTACLE_AVOIDANCE.scanAngle).toBe(AVOID_SCAN_ANGLE_DEG);
  expect(OBSTACLE_AVOIDANCE.avoidanceTurn).toBe(AVOID_BYPASS_ANGLE_DEG);
  expect(OBSTACLE_AVOIDANCE.minimumTurnSpeed).toBe(AVOID_TURN_POWER);
  expect(FINCH_TURN_CALIBRATION).toBe(1);
  expect(turnRotations(30)).toBeCloseTo(0.1683333333);
});
it.each(['left', 'right'] as const)('records requested angle, target, signed actual travel and post-stop overshoot for %s turns', direction => {
  const diagnostics = new AvoidanceTurnDiagnostics();
  diagnostics.begin('SCAN_LEFT_TURN', direction, 30, { left: 10, right: 12 }, 20);
  const sign = direction === 'left' ? -1 : 1;
  diagnostics.update({ left: 10 + sign * 0.17, right: 12 - sign * 0.18 });
  const row = diagnostics.records[0];
  expect(row.requestedAngle).toBe(30);
  expect(row.targetRotations).toBeCloseTo(turnRotations(30));
  expect(row.actual[0]).toBeCloseTo(sign * 0.17);
  expect(row.actual[1]).toBeCloseTo(-sign * 0.18);
  diagnostics.finish();
  diagnostics.update({ left: 10 + sign * 0.21, right: 12 - sign * 0.22 });
  expect(row.completed).toBe(true);
  expect(Math.abs(row.actual[0]) - row.targetRotations).toBeGreaterThan(0.04);
  diagnostics.release();
  diagnostics.update({ left: 50, right: 50 });
  expect(row.actual[0]).toBeCloseTo(sign * 0.21);
});
it('retains each phase independently and resets between maneuvers', () => {
  const diagnostics = new AvoidanceTurnDiagnostics();
  diagnostics.begin('SCAN_RIGHT_TURN', 'right', 60, { left: 0, right: 0 }, 20);
  diagnostics.update({ left: 0.34, right: -0.34 }); diagnostics.finish(); diagnostics.release();
  diagnostics.begin('BYPASS_TURN', 'left', 45, { left: 0.34, right: -0.34 }, 20);
  diagnostics.update({ left: 0.09, right: -0.09 });
  expect(diagnostics.records.map(row => row.requestedAngle)).toEqual([60, 45]);
  expect(diagnostics.records[0].actual).toEqual([0.34, -0.34]);
  expect(diagnostics.records[1].actual[0]).toBeCloseTo(-0.25);
  diagnostics.reset(); expect(diagnostics.records).toEqual([]);
});
