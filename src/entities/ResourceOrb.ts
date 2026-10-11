import * as THREE from 'three';

const coreGeometry = new THREE.OctahedronGeometry(0.22, 0);
const coreMaterial = new THREE.MeshStandardMaterial({
  color: '#f5ba49',
  emissive: '#c77a12',
  emissiveIntensity: 1.1,
  roughness: 0.25,
  metalness: 0.2,
});

/** A "bits" currency drop left by a defeated enemy; walk over it to collect. */
export class ResourceOrb {
  readonly group = new THREE.Group();
  active = true;
  readonly radius = 0.5;

  constructor(
    readonly value: number,
    position: THREE.Vector3,
    private readonly spin: number,
  ) {
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.castShadow = true;
    this.group.add(core);
    this.group.position.copy(position);
    this.group.position.y = 0.5;
  }

  update(delta: number, elapsed: number): void {
    if (!this.active) return;
    this.group.rotation.y += delta * (2.2 + this.spin);
    this.group.position.y = 0.5 + Math.sin(elapsed * 2.4 + this.spin * 4) * 0.14;
  }

  collect(): void {
    this.active = false;
    this.group.visible = false;
  }

  dispose(): void {
    // geometry/material are shared module-level resources; nothing instance-owned to free.
  }
}
