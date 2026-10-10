import { FIELD_ELEV, RUNWAY } from './Heightfield';
import { DEG, clamp } from '../util/math';

export const GLIDE_DEG = 3;
export const AIM_OFFSET = 320; // aim point beyond the threshold (m)

export interface ApproachInfo {
  dirNorth: boolean;
  runwayHeading: number;   // deg
  dz: number;              // distance before threshold along the runway (m); negative once past it
  lateral: number;         // + = right of centreline (m)
  gsAlt: number;           // glide-slope altitude MSL at this distance (m)
  gsError: number;         // + = above the glide-slope (m)
  onRunway: boolean;
}

/** Runway 36 (north-facing, threshold at z=+1200) or runway 18 (south-facing, threshold z=-1200). */
export function approachInfo(x: number, y: number, z: number, dirNorth: boolean): ApproachInfo {
  const s = dirNorth ? 1 : -1;
  const dz = s * z - RUNWAY.halfLen;
  const lateral = dirNorth ? x : -x;
  const aimDz = dz + AIM_OFFSET;
  const gsAlt = FIELD_ELEV + Math.max(0, aimDz) * Math.tan(GLIDE_DEG * DEG);
  return {
    dirNorth, runwayHeading: dirNorth ? 0 : 180, dz, lateral, gsAlt, gsError: y - gsAlt,
    onRunway: Math.abs(x) < RUNWAY.halfWid + RUNWAY.shoulder && Math.abs(z) <= RUNWAY.halfLen,
  };
}

/** Pick the runway direction the aircraft is already lined up for. */
export function chooseRunwayDirection(z: number, headingDeg: number): boolean {
  const h = ((headingDeg % 360) + 360) % 360;
  const northish = h < 90 || h > 270;
  if (z > 1200) return true;       // south of the field: land north
  if (z < -1200) return false;     // north of the field: land south
  return northish;
}

/** Target heading to capture the centreline from the current lateral offset. */
export function centrelineHeading(info: ApproachInfo): number {
  const corr = clamp(Math.atan(info.lateral / Math.max(600, info.dz * 0.6)) / DEG, -30, 30);
  return info.runwayHeading - corr;
}
