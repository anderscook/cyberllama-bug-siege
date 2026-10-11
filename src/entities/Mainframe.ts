import * as THREE from 'three';
import type { Damageable } from '../game/Damageable';
import { MAINFRAME_MAX_HP, MAINFRAME_POSITION, MAINFRAME_RADIUS } from '../game/GameConfig';

const HEALTHY_COLOR = new THREE.Color('#4de0ff');
const CRITICAL_COLOR = new THREE.Color('#ff3b3b');

export class Mainframe implements Damageable {
  readonly group = new THREE.Group();
  readonly position = this.group.position;
  readonly radius = MAINFRAME_RADIUS;
  readonly maxHp = MAINFRAME_MAX_HP;
  hp = MAINFRAME_MAX_HP;
  destroyed = false;

  private readonly coreMaterial: THREE.MeshStandardMaterial;
  private readonly ringA: THREE.Mesh;
  private readonly ringB: THREE.Mesh;
  private readonly reactorLight: THREE.PointLight;

  constructor() {
    this.group.position.copy(MAINFRAME_POSITION);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(this.radius, this.radius + 0.5, 1.1, 8),
      new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.6, metalness: 0.5 }),
    );
    base.position.y = 0.55;
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 2.6, 0.4),
        new THREE.MeshStandardMaterial({ color: '#1d2026', roughness: 0.5, metalness: 0.6 }),
      );
      pylon.position.set(Math.cos(angle) * (this.radius - 0.3), 1.4, Math.sin(angle) * (this.radius - 0.3));
      pylon.castShadow = true;
      this.group.add(pylon);
    }

    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: '#102734',
      roughness: 0.2,
      metalness: 0.3,
      emissive: HEALTHY_COLOR.clone(),
      emissiveIntensity: 1.4,
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), this.coreMaterial);
    core.position.y = 2.4;
    core.castShadow = true;
    this.group.add(core);

    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#8fe8ff', transparent: true, opacity: 0.75 });
    this.ringA = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.04, 8, 40), ringMaterial);
    this.ringA.position.y = 2.4;
    this.group.add(this.ringA);
    this.ringB = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.03, 8, 40), ringMaterial.clone());
    this.ringB.position.y = 2.4;
    this.ringB.rotation.x = Math.PI / 2;
    this.group.add(this.ringB);

    this.reactorLight = new THREE.PointLight('#4de0ff', 6, 14, 2);
    this.reactorLight.position.y = 2.4;
    this.group.add(this.reactorLight);
  }

  isAlive(): boolean {
    return !this.destroyed;
  }

  takeDamage(amount: number): void {
    if (this.destroyed) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.destroyed = true;
  }

  repair(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  update(delta: number, elapsed: number): void {
    this.ringA.rotation.z += delta * 0.6;
    this.ringB.rotation.z += delta * 0.4;
    const fraction = this.hp / this.maxHp;
    const color = HEALTHY_COLOR.clone().lerp(CRITICAL_COLOR, 1 - fraction);
    this.coreMaterial.emissive.copy(color);
    this.coreMaterial.emissiveIntensity = 1.1 + Math.sin(elapsed * (2 + (1 - fraction) * 6)) * 0.3 + (1 - fraction) * 0.8;
    this.reactorLight.color.copy(color);
    this.reactorLight.intensity = 5 + Math.sin(elapsed * 3) * 1.2;
  }

  dispose(): void {
    this.coreMaterial.dispose();
  }
}
