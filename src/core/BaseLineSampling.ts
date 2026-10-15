/** A rule suspension releases wheels, but an armed line program still needs fresh pairs to resume. */
export function baseLineSensorIds(activeIds: string[], mode: string, armed: boolean): string[] {
  return activeIds.length ? activeIds : mode === 'Line Follow' && armed ? ['finchLineLeft', 'finchLineRight'] : [];
}
