import * as THREE from 'three';
import type { Mainframe } from '../entities/Mainframe';
import type { Tower } from '../entities/Tower';
import { BUILD_INTERACT_RANGE, BUILD_PADS, MAINFRAME_POSITION, REPAIR_INTERACT_RANGE } from '../game/GameConfig';

export type BuildPad = {
  readonly position: THREE.Vector3;
  readonly markerMesh: THREE.Mesh;
  occupied: boolean;
};

export type RepairTarget = { hp: number; maxHp: number; position: THREE.Vector3; repair(amount: number): number };

const padGeometry = new THREE.RingGeometry(0.85, 1.05, 24);
padGeometry.rotateX(-Math.PI / 2);
const padMaterial = new THREE.MeshBasicMaterial({ color: '#59e8ff', transparent: true, opacity: 0.2, side: THREE.DoubleSide });

/** Fixed build pads around the Mainframe where the player can place towers during prep. */
export class BuildSystem {
  readonly group = new THREE.Group();
  readonly pads: BuildPad[] = [];
  buildMode = false;

  constructor() {
    for (const def of BUILD_PADS) {
      const position = new THREE.Vector3(
        MAINFRAME_POSITION.x + Math.cos(def.angle) * def.distance,
        0.02,
        MAINFRAME_POSITION.z + Math.sin(def.angle) * def.distance,
      );
      const markerMesh = new THREE.Mesh(padGeometry, padMaterial.clone());
      markerMesh.position.copy(position);
      this.group.add(markerMesh);
      this.pads.push({ position, markerMesh, occupied: false });
    }
  }

  setBuildMode(active: boolean): void {
    this.buildMode = active;
  }

  findPlaceablePad(playerPosition: THREE.Vector3): BuildPad | null {
    let best: BuildPad | null = null;
    let bestDist = BUILD_INTERACT_RANGE;
    for (const pad of this.pads) {
      if (pad.occupied) continue;
      const dist = pad.position.distanceTo(playerPosition);
      if (dist <= bestDist) {
        bestDist = dist;
        best = pad;
      }
    }
    return best;
  }

  findRepairTarget(playerPosition: THREE.Vector3, mainframe: Mainframe, towers: readonly Tower[]): RepairTarget | null {
    const candidates: RepairTarget[] = [mainframe];
    for (const tower of towers) if (!tower.destroyed) candidates.push(tower);

    let best: RepairTarget | null = null;
    let bestDist = REPAIR_INTERACT_RANGE;
    for (const candidate of candidates) {
      if (candidate.hp >= candidate.maxHp) continue;
      const dist = candidate.position.distanceTo(playerPosition);
      if (dist <= bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  }

  update(elapsed: number): void {
    for (const pad of this.pads) {
      const material = pad.markerMesh.material as THREE.MeshBasicMaterial;
      if (pad.occupied) {
        material.opacity = 0.08;
      } else if (this.buildMode) {
        material.opacity = 0.45 + Math.sin(elapsed * 4) * 0.2;
      } else {
        material.opacity = 0.16;
      }
    }
  }

  reset(): void {
    for (const pad of this.pads) pad.occupied = false;
    this.buildMode = false;
  }
}
