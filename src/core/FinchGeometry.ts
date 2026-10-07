// Wheel diameter verified by BirdBrain Finch 2.0 lesson documentation (provided by user).
export const FINCH_WHEEL_DIAMETER_CM = 5.0;
export const FINCH_WHEEL_CIRCUMFERENCE_CM = Math.PI * FINCH_WHEEL_DIAMETER_CM;
// User-supplied effective width; physical turn calibration remains required.
export const FINCH_EFFECTIVE_TRACK_WIDTH_CM: number | null = 10.1;
export const FINCH_TURN_CALIBRATION = 1.0;
export const distanceRotations = (cm: number) => cm / FINCH_WHEEL_CIRCUMFERENCE_CM;
export function turnRotations(degrees: number, width: number | null = FINCH_EFFECTIVE_TRACK_WIDTH_CM) {
 if (width === null || !Number.isFinite(width) || width <= 0) throw new Error('Turn calibration required');
 return (Math.PI * width * Math.abs(degrees) / 360) / FINCH_WHEEL_CIRCUMFERENCE_CM * FINCH_TURN_CALIBRATION;
}
