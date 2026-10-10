/**
 * Theatre presets. The terrain shape (real DEM + carved valleys) is shared; a biome re-skins it: terrain palette,
 * sky/fog/light, vegetation, weather particles and optional set dressing (the neon city). Missions pick one by id.
 */
export type BiomeId = 'arctic' | 'neon' | 'desert';

export interface BiomePalette {
  grass: number; grassDry: number; forest: number; rock: number; rock2: number; scree: number; snow: number; lake: number;
  snowLine: number;        // m MSL where snow starts (Infinity = never)
  forestTop: number;       // m MSL above which no forest colour is used
}
export interface BiomeSky {
  top: number; horizon: number; fogCalm: number; fogStorm: number;
  sunColor: number; sunIntensity: number; hemiSky: number; hemiGround: number; hemiIntensity: number;
  exposure: number; background: number;
  fogScale: number;        // multiplies the base fog density (haze)
  stars: boolean;
}
export interface BiomeSpec {
  id: BiomeId; name: string; palette: BiomePalette; sky: BiomeSky;
  trees: boolean;
  particles: number;       // weather particle tint (snow white, sand ochre…)
  city: boolean;           // neon megacity set dressing along the valley floor
  stormName: string;       // what the weather front is called in this theatre
}

export const BIOMES: Record<BiomeId, BiomeSpec> = {
  arctic: {
    id: 'arctic', name: 'Arctic Fjord',
    palette: { grass: 0x56603a, grassDry: 0x7a7447, forest: 0x2c3d2a, rock: 0x6f6a64, rock2: 0x4f4a47, scree: 0x8b8680, snow: 0xf2f5fa, lake: 0x4a4a3a, snowLine: 2150, forestTop: 1250 },
    sky: { top: 0x2f62a8, horizon: 0xb9cde0, fogCalm: 0xa9bdd2, fogStorm: 0xd5dce2, sunColor: 0xfff1dc, sunIntensity: 3.0, hemiSky: 0xaec6e6, hemiGround: 0x4a4a42, hemiIntensity: 0.9, exposure: 0.95, background: 0x9fb4ca, fogScale: 1, stars: false },
    trees: true, particles: 0xffffff, city: false, stormName: 'blizzard',
  },
  neon: {
    id: 'neon', name: 'Neon Megacity – Midnight Canyon',
    palette: { grass: 0x1b2026, grassDry: 0x24282f, forest: 0x14191c, rock: 0x2a2c33, rock2: 0x1d1f25, scree: 0x34363d, snow: 0x5d6578, lake: 0x101824, snowLine: 2600, forestTop: 900 },
    sky: { top: 0x05060f, horizon: 0x2a1840, fogCalm: 0x1d1530, fogStorm: 0x3a2f4a, sunColor: 0x9fb4ff, sunIntensity: 0.55, hemiSky: 0x4a3a8a, hemiGround: 0x101018, hemiIntensity: 0.55, exposure: 1.25, background: 0x0a0814, fogScale: 1.4, stars: true },
    trees: false, particles: 0xc8b8ff, city: true, stormName: 'ion storm',
  },
  desert: {
    id: 'desert', name: 'Desert Badlands',
    palette: { grass: 0xb48a58, grassDry: 0xc9a066, forest: 0x8a6a44, rock: 0x9a5e3a, rock2: 0x7a4630, scree: 0xc49870, snow: 0xe8d9b8, lake: 0x5a4a32, snowLine: Infinity, forestTop: 0 },
    sky: { top: 0x3b78c4, horizon: 0xe7d2b0, fogCalm: 0xd9c4a0, fogStorm: 0xc8a070, sunColor: 0xffe2b0, sunIntensity: 3.4, hemiSky: 0xf0e2c4, hemiGround: 0x9a7a52, hemiIntensity: 1.5, exposure: 1.0, background: 0xcfbd9c, fogScale: 1.25, stars: false },
    trees: false, particles: 0xd8b07a, city: false, stormName: 'sandstorm',
  },
};
