import * as THREE from 'three';

type StickState = {
  active: boolean;
  id: number | null;
  centerX: number;
  centerY: number;
  radius: number;
};

const LOOK_TURN_RATE = 2.6; // radians/sec at full right-stick deflection
const MOUSE_SENSITIVITY = 0.0022;

function freshStick(): StickState {
  return { active: false, id: null, centerX: 0, centerY: 0, radius: 1 };
}

export class InputController {
  private readonly keys = new Set<string>();
  private readonly keyVector = new THREE.Vector2();
  private readonly moveStickVector = new THREE.Vector2();
  private readonly lookStickVector = new THREE.Vector2();
  private readonly mouseLookAccum = new THREE.Vector2();

  private readonly moveStick = freshStick();
  private readonly lookStick = freshStick();

  private fireHeld = false;
  private firePressed = false;
  private sprintHeld = false;
  private repairHeld = false;
  private jumpPressed = false;
  private dashPressed = false;
  private buildTogglePressed = false;
  /** Raw "1" / "2" press — interpreted contextually by the caller (weapon switch outside build mode, tower-type pick while building). */
  private pendingDigit: '1' | '2' | null = null;
  private pointerLocked = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.code);
    if (event.code === 'Space') this.jumpPressed = true;
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.sprintHeld = true;
    if (event.code === 'KeyQ') this.dashPressed = true;
    if (event.code === 'KeyB') this.buildTogglePressed = true;
    if (event.code === 'KeyR') this.repairHeld = true;
    if (event.code === 'Digit1') this.pendingDigit = '1';
    if (event.code === 'Digit2') this.pendingDigit = '2';
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.sprintHeld = false;
    if (event.code === 'KeyR') this.repairHeld = false;
  };

  private readonly onCanvasPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    // Firing never blocks on pointer lock succeeding (it can fail in embedded/
    // automated contexts) — the same click both fires and best-effort locks.
    if (!this.pointerLocked) {
      try {
        // Modern Chromium returns a Promise that rejects in some embedding/
        // automated contexts; swallow it either way so it never surfaces as
        // an unhandled rejection. Aiming just falls back to the current yaw/
        // pitch (or the touch look-stick) until/unless lock succeeds.
        const result = this.canvas.requestPointerLock() as unknown;
        if (result instanceof Promise) result.catch(() => undefined);
      } catch {
        // Synchronous rejection (older browsers) — nothing to clean up.
      }
    }
    if (event.button === 0) {
      this.fireHeld = true;
      this.firePressed = true;
    }
  };

  private readonly onCanvasPointerUp = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    if (event.button === 0) this.fireHeld = false;
  };

  private readonly onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) this.fireHeld = false;
  };

  private readonly onMouseMove = (event: MouseEvent) => {
    if (!this.pointerLocked) return;
    this.mouseLookAccum.x += event.movementX * MOUSE_SENSITIVITY;
    this.mouseLookAccum.y += event.movementY * MOUSE_SENSITIVITY;
  };

  private readonly onMoveStickDown = (event: PointerEvent) => this.beginStick(event, this.moveStick, this.moveStickElements);
  private readonly onMoveStickMove = (event: PointerEvent) => this.dragStick(event, this.moveStick, this.moveStickVector, this.moveStickElements);
  private readonly onMoveStickUp = (event: PointerEvent) => this.endStick(event, this.moveStick, this.moveStickVector, this.moveStickElements);

  private readonly onLookStickDown = (event: PointerEvent) => this.beginStick(event, this.lookStick, this.lookStickElements);
  private readonly onLookStickMove = (event: PointerEvent) => this.dragStick(event, this.lookStick, this.lookStickVector, this.lookStickElements);
  private readonly onLookStickUp = (event: PointerEvent) => this.endStick(event, this.lookStick, this.lookStickVector, this.lookStickElements);

  private readonly onFireDown = (event: PointerEvent) => {
    event.preventDefault();
    this.fireHeld = true;
    this.firePressed = true;
  };
  private readonly onFireUp = (event: PointerEvent) => {
    event.preventDefault();
    this.fireHeld = false;
  };
  private readonly onJumpDown = (event: PointerEvent) => {
    event.preventDefault();
    this.jumpPressed = true;
  };
  private readonly onDashDown = (event: PointerEvent) => {
    event.preventDefault();
    this.dashPressed = true;
  };
  private readonly onBuildDown = (event: PointerEvent) => {
    event.preventDefault();
    this.buildTogglePressed = true;
  };
  private readonly onRepairDown = (event: PointerEvent) => {
    event.preventDefault();
    this.repairHeld = true;
  };
  private readonly onRepairUp = (event: PointerEvent) => {
    event.preventDefault();
    this.repairHeld = false;
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly moveStickElements: { stick: HTMLElement; knob: HTMLElement },
    private readonly lookStickElements: { stick: HTMLElement; knob: HTMLElement },
    touchButtons: { fire: HTMLElement; jump: HTMLElement; dash: HTMLElement; build: HTMLElement; repair: HTMLElement },
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    this.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.addEventListener('pointerup', this.onCanvasPointerUp);

    moveStickElements.stick.addEventListener('pointerdown', this.onMoveStickDown);
    moveStickElements.stick.addEventListener('pointermove', this.onMoveStickMove);
    moveStickElements.stick.addEventListener('pointerup', this.onMoveStickUp);
    moveStickElements.stick.addEventListener('pointercancel', this.onMoveStickUp);

    lookStickElements.stick.addEventListener('pointerdown', this.onLookStickDown);
    lookStickElements.stick.addEventListener('pointermove', this.onLookStickMove);
    lookStickElements.stick.addEventListener('pointerup', this.onLookStickUp);
    lookStickElements.stick.addEventListener('pointercancel', this.onLookStickUp);

    touchButtons.fire.addEventListener('pointerdown', this.onFireDown);
    touchButtons.fire.addEventListener('pointerup', this.onFireUp);
    touchButtons.fire.addEventListener('pointercancel', this.onFireUp);
    touchButtons.fire.addEventListener('pointerleave', this.onFireUp);
    touchButtons.jump.addEventListener('pointerdown', this.onJumpDown);
    touchButtons.dash.addEventListener('pointerdown', this.onDashDown);
    touchButtons.build.addEventListener('pointerdown', this.onBuildDown);
    touchButtons.repair.addEventListener('pointerdown', this.onRepairDown);
    touchButtons.repair.addEventListener('pointerup', this.onRepairUp);
    touchButtons.repair.addEventListener('pointercancel', this.onRepairUp);
    touchButtons.repair.addEventListener('pointerleave', this.onRepairUp);
  }

  readMovement(target: THREE.Vector2): THREE.Vector2 {
    this.keyVector.set(0, 0);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.keyVector.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.keyVector.x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.keyVector.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.keyVector.y += 1;

    target.copy(this.keyVector).add(this.moveStickVector);
    if (target.lengthSq() > 1) target.normalize();
    return target;
  }

  /** Yaw/pitch delta for this frame, in radians. Drains the mouse accumulator and scales the touch look stick by delta. */
  readLookDelta(delta: number, target: THREE.Vector2): THREE.Vector2 {
    target.copy(this.mouseLookAccum);
    target.addScaledVector(this.lookStickVector, LOOK_TURN_RATE * delta);
    this.mouseLookAccum.set(0, 0);
    return target;
  }

  isFireHeld(): boolean {
    return this.fireHeld;
  }

  /** Edge-triggered: true once for a click/tap, even if press+release happens between frames. */
  consumeFirePressed(): boolean {
    const value = this.firePressed;
    this.firePressed = false;
    return value;
  }

  isSprintHeld(): boolean {
    return this.sprintHeld;
  }

  isRepairHeld(): boolean {
    return this.repairHeld;
  }

  consumeJumpPressed(): boolean {
    const value = this.jumpPressed;
    this.jumpPressed = false;
    return value;
  }

  consumeDashPressed(): boolean {
    const value = this.dashPressed;
    this.dashPressed = false;
    return value;
  }

  consumeBuildTogglePressed(): boolean {
    const value = this.buildTogglePressed;
    this.buildTogglePressed = false;
    return value;
  }

  /** Edge-triggered: drains the pending "1"/"2" digit press, if any, this frame. */
  consumeDigitPress(): '1' | '2' | null {
    const value = this.pendingDigit;
    this.pendingDigit = null;
    return value;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.removeEventListener('pointerup', this.onCanvasPointerUp);
  }

  private beginStick(event: PointerEvent, state: StickState, elements: { stick: HTMLElement; knob: HTMLElement }): void {
    event.preventDefault();
    const rect = elements.stick.getBoundingClientRect();
    state.active = true;
    state.id = event.pointerId;
    state.centerX = rect.left + rect.width / 2;
    state.centerY = rect.top + rect.height / 2;
    state.radius = rect.width * 0.42;
    try {
      elements.stick.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events do not always have a capturable pointer id.
    }
    this.updateStickVector(event.clientX, event.clientY, state, state === this.moveStick ? this.moveStickVector : this.lookStickVector, elements);
  }

  private dragStick(
    event: PointerEvent,
    state: StickState,
    vector: THREE.Vector2,
    elements: { stick: HTMLElement; knob: HTMLElement },
  ): void {
    if (!state.active || event.pointerId !== state.id) return;
    event.preventDefault();
    this.updateStickVector(event.clientX, event.clientY, state, vector, elements);
  }

  private endStick(
    event: PointerEvent,
    state: StickState,
    vector: THREE.Vector2,
    elements: { stick: HTMLElement; knob: HTMLElement },
  ): void {
    if (event.pointerId !== state.id) return;
    event.preventDefault();
    state.active = false;
    state.id = null;
    vector.set(0, 0);
    elements.knob.style.transform = 'translate(-50%, -50%)';
  }

  private updateStickVector(
    clientX: number,
    clientY: number,
    state: StickState,
    vector: THREE.Vector2,
    elements: { stick: HTMLElement; knob: HTMLElement },
  ): void {
    const dx = clientX - state.centerX;
    const dy = clientY - state.centerY;
    vector.set(dx / state.radius, dy / state.radius);
    if (vector.lengthSq() > 1) vector.normalize();
    const distance = 38;
    elements.knob.style.transform = `translate(calc(-50% + ${vector.x * distance}px), calc(-50% + ${vector.y * distance}px))`;
  }
}
