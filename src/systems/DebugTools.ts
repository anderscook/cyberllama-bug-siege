import GUI from 'lil-gui';
import type { PlayerTuning } from '../entities/Player';

export type DebugTuning = PlayerTuning & {
  cameraLag: number;
  exposure: number;
  maxDpr: number;
};

export class DebugTools {
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    const enabled = new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;

    this.gui = new GUI({ title: 'Game tuning' });
    this.gui.add(tuning, 'moveSpeed', 2, 14, 0.1);
    this.gui.add(tuning, 'sprintMultiplier', 1, 2.5, 0.05);
    this.gui.add(tuning, 'acceleration', 4, 28, 0.1);
    this.gui.add(tuning, 'jumpSpeed', 3, 12, 0.1);
    this.gui.add(tuning, 'gravity', 10, 32, 0.5);
    this.gui.add(tuning, 'dashSpeed', 6, 24, 0.5);
    this.gui.add(tuning, 'dashDuration', 0.05, 0.4, 0.01);
    this.gui.add(tuning, 'dashCooldown', 0.3, 2.5, 0.05);
    this.gui.add(tuning, 'cameraLag', 0.02, 0.8, 0.01);
    this.gui.add(tuning, 'maxDpr', 1, 2, 0.25).onChange(onChange);
    this.gui.add(tuning, 'exposure', 0.6, 1.8, 0.01).onChange(onChange);
  }

  setHidden(hidden: boolean): void {
    if (!this.gui) return;
    if (hidden) this.gui.hide();
    else this.gui.show();
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
