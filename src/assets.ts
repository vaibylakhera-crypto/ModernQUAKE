import * as THREE from 'three';

// Asset loading policy, applied to every GLTFLoader (they all use THREE.DefaultLoadingManager):
//  - THREE.Cache: each texture/buffer URL is fetched + decoded ONCE, even though ~20 kit pieces reference the same atlases.
//  - unused PBR maps (normal / roughness / ORM) are swapped for a 1-pixel image when the materials never sample them.
//  - LOW tier gets 1024px WebP copies of the colour textures (public/tex-lo, built by scripts/make-lo-textures.py).

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaPgPAAODAgAApfuJAAAAAElFTkSuQmCC';
const PBR_DATA = /_(Normal|ORM|Roughness|Metallic)[^/]*\.png$/i;
const LO = new Set([
  'T_Decals', 'T_Eye_Brown', 'T_Hair_1_BaseColor', 'T_PaddedWall_BaseColor',
  'T_PaddingWall_Emissive', 'T_Superhero_Female_Dark_BaseColor', 'T_Superhero_Male_Dark', 'T_Trim_01_BaseColor',
  'T_Trim_01_BaseColor_Red', 'T_Trim_01_DetailMask', 'T_Trim_01_Emissive', 'T_Trim_02_BaseColor',
  'T_Trim_02_BaseColor_Blue', 'T_Trim_02_BaseColor_Red', 'T_Trim_02_DetailMask', 'T_Trim_03_BaseColor',
  'T_Trim_03_Cables',
]);

export function setupAssets(opts: { cheap: boolean; lowTex: boolean; onProgress?: (loaded: number, total: number) => void }) {
  THREE.Cache.enabled = true;
  const mgr = THREE.DefaultLoadingManager;
  mgr.setURLModifier(url => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    // character bodies are always drawn with Lambert (dress.ts), so their PBR maps are never used on any tier
    if (PBR_DATA.test(url) && (opts.cheap || url.includes('/chars/'))) return PIXEL;
    if (opts.lowTex) {
      const m = url.match(/\/(?:kit|chars)\/([^/?]+)\.png$/);
      if (m && LO.has(m[1])) return `/tex-lo/${m[1]}.webp`;
    }
    return url;
  });
  if (opts.onProgress) mgr.onProgress = (_u, loaded, total) => opts.onProgress!(loaded, total);
}
