import * as THREE from 'three';
import { buildFighter, Dressed } from './dress';
import { ikArm } from './anim';
import { WeaponId } from './weapons';
import { GRIP_Z, SUPPORT } from './grips';

// First-person arms: the real rigged character (armoured, head hidden) with both arms IK'd onto the gun's grips,
// so the gloved hands are genuine hand meshes with curled fingers instead of boxes.
export class FpArms {
  rig?: Dressed; ready = false;
  constructor(private scene: THREE.Scene, private eyeY = 1.66) {}

  async init() {
    const rig = await buildFighter('male', 0x35d8ff, 0x59626f);
    // keep only the arm armour; hide head, shoulders, torso and leg plates
    for (const [n, b] of Object.entries(rig.bones)) { if (/^(upperarm|lowerarm)_/.test(n)) continue; for (const c of b.children) if ((c as THREE.Mesh).isMesh) c.visible = false; }
    // solid glove/suit material (no skin-tone texture patches)
    // clip away shoulders/neck above the arm line (the camera sits inside the head)
    rig.body.material = new THREE.MeshLambertMaterial({ color: 0x3a4250, emissive: 0x0b0e14, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, -1, 0), -0.085)] });
    rig.root.rotation.y = Math.PI;                 // character faces +Z, the view camera looks down -Z
    rig.root.position.set(0, -this.eyeY, -0.02);
    this.scene.add(rig.root);
    this.rig = rig; this.ready = true;
  }

  update(holder: THREE.Object3D, id: WeaponId) {
    const rig = this.rig; if (!rig) return;
    rig.root.updateMatrixWorld(true); holder.updateWorldMatrix(true, false);
    const hq = holder.getWorldQuaternion(new THREE.Quaternion());
    const rqInv = rig.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const P = (x: number, y: number, z: number) => rig.root.worldToLocal(holder.localToWorld(new THREE.Vector3(x, y, z)));
    const D = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize().applyQuaternion(hq).applyQuaternion(rqInv);

    const gz = GRIP_Z[id];
    if (id === 'blade') {
      ikArm(rig, 'r', P(0.0, -0.015, gz + 0.09), D(0.6, -1, 0.7), D(-1, -0.2, 0), D(0, 0, -1), 1.05);
    } else {
      // palm on the right of the grip, fingers wrapping round the front
      ikArm(rig, 'r', P(0.05, -0.115, gz + 0.085), D(0.6, -1, 0.7), D(-0.15, 0.1, -1), D(-1, 0, 0), 0.95);
    }
    const s = SUPPORT[id];
    if (s) {
      if (s.type === 'cup') ikArm(rig, 'l', P(0.0, s.y - 0.005, s.z + 0.1), D(-0.6, -1, 0.7), D(0, 0.05, -1), D(0, 1, 0), 0.85);
      else ikArm(rig, 'l', P(-s.gw / 2 - 0.035, s.y, s.z + 0.075), D(-0.6, -1, 0.7), D(0.15, 0.05, -1), D(1, 0, 0), 0.95);
    } else {
      // one-handed weapons: left arm rests low and relaxed
      ikArm(rig, 'l', P(-0.17, -0.28, 0.16), D(-0.6, -1, 0.7), D(0, -0.4, -1), D(0.4, 1, 0), 0.5);
    }
  }
}
