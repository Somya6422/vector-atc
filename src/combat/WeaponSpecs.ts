import { DEG } from '../util/math';

/** Fictional, configurable game parameters (entertainment mechanics – not real-world weapon data). */
export type WeaponId = 'GUN' | 'IR' | 'RADAR';

export const GUN_SPEC = {
  name: '20 mm cannon', muzzleVelocity: 1050, roundsPerSecond: 80, lifetime: 1.6, damage: 3.2, hitRadiusScale: 0.85, burstSpread: 0.0016,
};

export interface MissileSpec {
  id: 'IR' | 'RADAR';
  name: string;
  designation: string;
  boostTime: number; boostAccel: number; maxSpeed: number; life: number;
  navConstant: number; maxG: number; proximity: number; blastRadius: number; damage: number; armTime: number;
  seekerHalfAngle: number;       // rad (seeker FOV half-angle)
  launchMaxRange: number;        // m
  launchMinRange: number;
  lockTime: number;              // s to reach confirmed lock
  lockCone: number;              // rad half-angle of the launch cone
  activeRange: number;           // radar missiles: range at which the onboard seeker goes active
}

export const IR_SPEC: MissileSpec = {
  id: 'IR', name: 'IR-7 "Whisper" (Fox-2 class, infrared)', designation: 'FOX-2',
  boostTime: 2.4, boostAccel: 210, maxSpeed: 850, life: 20, navConstant: 4, maxG: 38, proximity: 13, blastRadius: 22, damage: 85, armTime: 0.8,
  seekerHalfAngle: 24 * DEG, launchMaxRange: 6500, launchMinRange: 350, lockTime: 1.3, lockCone: 14 * DEG, activeRange: 0,
};
export const RADAR_SPEC: MissileSpec = {
  id: 'RADAR', name: 'LR-9 "Sabre" (long-range radar-guided)', designation: 'LR-9',
  boostTime: 5.5, boostAccel: 190, maxSpeed: 1050, life: 55, navConstant: 4, maxG: 32, proximity: 20, blastRadius: 30, damage: 110, armTime: 1.5,
  seekerHalfAngle: 40 * DEG, launchMaxRange: 38000, launchMinRange: 1500, lockTime: 1.8, lockCone: 30 * DEG, activeRange: 9000,
};
export const MISSILES = { IR: IR_SPEC, RADAR: RADAR_SPEC } as const;

export const SENSOR = {
  radarRange: 72000,          // reference range vs RCS 1.0 target
  scanHalfAngle: 60 * DEG,    // radar scan sector
  boreCone: 30 * DEG,         // 60-degree total cone for lock/boresight selection
  idRange: 12000,             // visual/sensor identification range
  idTime: 2.0,
};
