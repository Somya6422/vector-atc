// Aircraft-specific parameters. SI units. Original game approximations: NOT real performance data.
export type AircraftId = 'SU57' | 'F35' | 'DRONE';

export interface AircraftConfig {
  id: AircraftId;
  name: string;
  callsignBoy?: string;
  emptyMass: number;       // kg
  fuelCapacity: number;    // kg
  wingArea: number;        // m^2
  wingspan: number;
  length: number;
  CL0: number;             // zero-alpha lift coefficient
  CLalpha: number;         // per rad
  alphaCrit: number;       // rad, onset of stall degradation
  alphaCritNeg: number;
  CD0: number;
  kInduced: number;
  CYbeta: number;          // side-force slope
  thrustMil: number;       // N, sea level static (total)
  thrustAB: number;        // N, with afterburner
  spool: number;           // 1/s engine response
  fuelFlowMil: number;     // kg/s
  fuelFlowAB: number;
  maxPitchRate: number;    // rad/s commanded limit
  maxRollRate: number;
  maxYawRate: number;
  pitchResponse: number;   // 1/s
  rollResponse: number;
  yawResponse: number;
  gLimit: number;
  gLimitNeg: number;
  vectoringAuthority: number; // 0..1 low-speed pitch/yaw authority retained from thrust vectoring
  gearHeight: number;      // CG height above ground with gear down
  bellyHeight: number;
  gearDrag: number;        // delta CD
  airbrakeDrag: number;    // delta CD
  stallSpeedKt: number;    // nominal clean 1g stall (informational/HUD)
  rotationKt: number;
  approachKt: number;
  touchdownKt: number;
  engines: 1 | 2;
  eye: [number, number, number]; // cockpit eye in body coords (x right, y up, z back)
  gunMuzzle: [number, number, number];
  gunAmmo: number;
  flares: number;
  irMissiles: number;
  radarMissiles: number;
  hullHealth: number;
  radius: number;          // hit sphere
  irSignature: number;     // relative IR output
  rcs: number;             // relative radar cross-section
  color: number;
}

export const SU57: AircraftConfig = {
  id: 'SU57', name: 'Su-57 Felon', emptyMass: 18500, fuelCapacity: 3200, wingArea: 78, wingspan: 14.1, length: 20.1,
  CL0: 0.06, CLalpha: 4.3, alphaCrit: 22 * Math.PI / 180, alphaCritNeg: 14 * Math.PI / 180,
  CD0: 0.021, kInduced: 0.115, CYbeta: 1.3,
  thrustMil: 190000, thrustAB: 310000, spool: 1.6, fuelFlowMil: 1.5, fuelFlowAB: 5.2,
  maxPitchRate: 1.15, maxRollRate: 3.4, maxYawRate: 0.75, pitchResponse: 5.5, rollResponse: 6.5, yawResponse: 3.5,
  gLimit: 9, gLimitNeg: 3.5, vectoringAuthority: 0.62,
  gearHeight: 2.3, bellyHeight: 1.1, gearDrag: 0.028, airbrakeDrag: 0.065,
  stallSpeedKt: 98, rotationKt: 135, approachKt: 130, touchdownKt: 115, engines: 2,
  eye: [0, 0.95, -4.8], gunMuzzle: [0.8, 0.0, -9], gunAmmo: 260, flares: 36, irMissiles: 4, radarMissiles: 4,
  hullHealth: 100, radius: 9, irSignature: 1.0, rcs: 0.35, color: 0x6c7480,
};

export const F35: AircraftConfig = {
  id: 'F35', name: 'F-35 Lightning II', emptyMass: 13300, fuelCapacity: 2500, wingArea: 42.7, wingspan: 10.7, length: 15.7,
  CL0: 0.07, CLalpha: 4.0, alphaCrit: 22 * Math.PI / 180, alphaCritNeg: 12 * Math.PI / 180,
  CD0: 0.024, kInduced: 0.14, CYbeta: 1.2,
  thrustMil: 125000, thrustAB: 190000, spool: 1.2, fuelFlowMil: 1.1, fuelFlowAB: 4.0,
  maxPitchRate: 0.95, maxRollRate: 3.0, maxYawRate: 0.55, pitchResponse: 4.2, rollResponse: 5.2, yawResponse: 3.0,
  gLimit: 9, gLimitNeg: 3, vectoringAuthority: 0.1,
  gearHeight: 2.0, bellyHeight: 1.0, gearDrag: 0.03, airbrakeDrag: 0.06,
  stallSpeedKt: 108, rotationKt: 135, approachKt: 142, touchdownKt: 128, engines: 1,
  eye: [0, 0.9, -3.4], gunMuzzle: [-0.9, 0.2, -7], gunAmmo: 220, flares: 40, irMissiles: 4, radarMissiles: 4,
  hullHealth: 100, radius: 7.5, irSignature: 0.8, rcs: 0.05, color: 0x7d838c,
};

// Hostile stealth drone ("Wraith" UCAV, fictional)
export const DRONE: AircraftConfig = {
  id: 'DRONE', name: 'Hostile UCAV', emptyMass: 4200, fuelCapacity: 1400, wingArea: 28, wingspan: 11, length: 8.5,
  CL0: 0.05, CLalpha: 3.8, alphaCrit: 20 * Math.PI / 180, alphaCritNeg: 12 * Math.PI / 180,
  CD0: 0.02, kInduced: 0.13, CYbeta: 1.0,
  thrustMil: 52000, thrustAB: 52000, spool: 1.5, fuelFlowMil: 0.55, fuelFlowAB: 0.55,
  maxPitchRate: 0.85, maxRollRate: 3.0, maxYawRate: 0.4, pitchResponse: 4.5, rollResponse: 5.5, yawResponse: 3,
  gLimit: 8, gLimitNeg: 3, vectoringAuthority: 0.1,
  gearHeight: 1.2, bellyHeight: 0.6, gearDrag: 0, airbrakeDrag: 0,
  stallSpeedKt: 95, rotationKt: 120, approachKt: 130, touchdownKt: 110, engines: 1,
  eye: [0, 0.4, -1], gunMuzzle: [0, 0, -4], gunAmmo: 0, flares: 6, irMissiles: 2, radarMissiles: 0,
  hullHealth: 60, radius: 6, irSignature: 0.55, rcs: 0.02, color: 0x2a2d33,
};

export const AIRCRAFT: Record<AircraftId, AircraftConfig> = { SU57: SU57, F35: F35, DRONE: DRONE };
