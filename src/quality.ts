// Quality tiers. Default is 'low' so weak GPUs (e.g. GT 730) run smoothly. Use ?q=med or ?q=high to opt up.
export type Tier = 'low' | 'med' | 'high';

export interface Quality {
  tier: Tier;
  antialias: boolean;
  pixelRatio: number;       // max device pixel ratio
  renderScale: number;      // starting internal resolution scale (adaptive scaler moves it)
  minScale: number;
  bloom: boolean;
  pbr: boolean;             // false: cheap Lambert materials, no env map
  liveSky: boolean;         // false: sky baked once to a cubemap
  skyCube: number;          // baked cube face size
  platformLights: boolean;
  padBeams: boolean;
}

const TIERS: Record<Tier, Quality> = {
  low:  { tier: 'low',  antialias: false, pixelRatio: 1,   renderScale: 0.85, minScale: 0.5, bloom: false, pbr: false, liveSky: false, skyCube: 1024,  platformLights: false, padBeams: false },
  med:  { tier: 'med',  antialias: false, pixelRatio: 1,   renderScale: 1.0,  minScale: 0.6, bloom: false, pbr: true,  liveSky: false, skyCube: 1024, platformLights: false, padBeams: false },
  high: { tier: 'high', antialias: true,  pixelRatio: 2,   renderScale: 1.0,  minScale: 0.75, bloom: true,  pbr: true,  liveSky: false, skyCube: 2048, platformLights: true,  padBeams: true },
};

export function getQuality(): Quality {
  let t: string | null = null;
  try { t = new URLSearchParams(location.search).get('q') || localStorage.getItem('mq-quality'); } catch { /* ignore */ }
  const q = { ...TIERS[(t === 'med' || t === 'high' || t === 'low') ? t : 'low'] };
  let phone = false; try { phone = matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
  // phones: render at up to 1.5x CSS pixels (sharp on high-DPI screens); the adaptive scaler drops toward 0.8x if the GPU can't keep 60 fps
  // MSAA is close to free on phone (tile-based) GPUs and removes the jagged/soft edges on the gun and level
  if (phone && q.tier === 'low') { q.antialias = true; q.pixelRatio = 2; q.renderScale = 0.85; q.minScale = 0.45; q.padBeams = false; }
  return q;
}
