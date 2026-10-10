import { parseDem, setDem } from './Heightfield';

/** Loads the real-world elevation grid. Returns false (procedural terrain stays active) if it is missing. */
export async function loadDem(): Promise<boolean> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}models/dem.bin`);
    if (!r.ok) throw new Error(String(r.status));
    setDem(parseDem(await r.arrayBuffer()));
    return true;
  } catch (e) { console.warn('DEM unavailable – using procedural mountains', e); return false; }
}
