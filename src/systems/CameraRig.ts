import * as THREE from 'three';

export type CameraObstacle = { position: THREE.Vector3; radius: number };

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const PITCH_MIN = -1.3;
const PITCH_MAX = 1.0;

const ANCHOR_HEIGHT = 1.7;
const CAMERA_DISTANCE = 5.8;
const CAMERA_LATERAL = 0.62;
const CAMERA_LIFT = 1.85;
const CAMERA_NEAR_MARGIN = 0.35;

/** Over-the-shoulder third-person rig: mouse/stick yaw+pitch drive both the aim direction and camera orbit. */
export class CameraRig {
  yaw = 0;
  // Default pitch looks slightly downward so ground-level enemies stay
  // visible without the player having to fight the camera first.
  pitch = -0.2;

  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly right = new THREE.Vector3(1, 0, 0);
  private readonly anchor = new THREE.Vector3();
  private readonly idealPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly segment = new THREE.Vector3();
  private readonly toObstacle = new THREE.Vector3();
  private readonly closestPoint = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.recomputeBasis();
  }

  applyLook(deltaYaw: number, deltaPitch: number): void {
    this.yaw += deltaYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaPitch, PITCH_MIN, PITCH_MAX);
    this.recomputeBasis();
  }

  /** Direction the player aims/fires and faces; also the camera's look direction. */
  getForward(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.forward);
  }

  getRight(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.right);
  }

  snapTo(playerPosition: THREE.Vector3, obstacles: readonly CameraObstacle[]): void {
    this.update(1, playerPosition, obstacles, 1000);
  }

  update(delta: number, playerPosition: THREE.Vector3, obstacles: readonly CameraObstacle[], lag = 0.1): void {
    this.anchor.copy(playerPosition);
    this.anchor.y += ANCHOR_HEIGHT;

    this.idealPosition
      .copy(this.anchor)
      .addScaledVector(this.forward, -CAMERA_DISTANCE)
      .addScaledVector(this.right, CAMERA_LATERAL);
    this.idealPosition.y += CAMERA_LIFT;

    const allowedDistance = this.resolveCollision(this.anchor, this.idealPosition, obstacles);
    this.idealPosition
      .copy(this.anchor)
      .addScaledVector(this.forward, -allowedDistance)
      .addScaledVector(this.right, CAMERA_LATERAL * (allowedDistance / CAMERA_DISTANCE));
    this.idealPosition.y = this.anchor.y + CAMERA_LIFT * (allowedDistance / CAMERA_DISTANCE);

    const factor = 1 - Math.exp(-delta / Math.max(0.001, lag));
    this.camera.position.lerp(this.idealPosition, factor);
    this.lookTarget.copy(this.anchor).addScaledVector(this.forward, 6);
    this.camera.lookAt(this.lookTarget);
  }

  private recomputeBasis(): void {
    const cosPitch = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), -Math.cos(this.yaw) * cosPitch).normalize();
    this.right.crossVectors(this.forward, WORLD_UP).normalize();
  }

  /** Clamps the camera's orbit distance so it never clips through mainframe/tower colliders. */
  private resolveCollision(anchor: THREE.Vector3, ideal: THREE.Vector3, obstacles: readonly CameraObstacle[]): number {
    this.segment.copy(ideal).sub(anchor);
    const fullLength = this.segment.length();
    if (fullLength < 0.0001) return CAMERA_DISTANCE;
    const direction = this.segment.clone().normalize();

    let allowed = fullLength;
    for (const obstacle of obstacles) {
      this.toObstacle.copy(obstacle.position).sub(anchor);
      const t = THREE.MathUtils.clamp(this.toObstacle.dot(direction), 0, fullLength);
      this.closestPoint.copy(anchor).addScaledVector(direction, t);
      const clearance = obstacle.radius + CAMERA_NEAR_MARGIN;
      const distSq = this.closestPoint.distanceToSquared(obstacle.position);
      if (distSq < clearance * clearance) {
        const penetration = Math.sqrt(Math.max(0, clearance * clearance - distSq));
        const hitT = Math.max(0, t - penetration);
        if (hitT < allowed) allowed = hitT;
      }
    }

    return (allowed / fullLength) * CAMERA_DISTANCE;
  }
}
