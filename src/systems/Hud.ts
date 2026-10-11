import type { WavePhase } from './WaveManager';

export type HudState = {
  mainframeHp: number;
  mainframeMaxHp: number;
  playerHp: number;
  playerMaxHp: number;
  bits: number;
  waveNumber: number;
  totalWaves: number;
  phase: WavePhase;
  prepRemaining: number;
  weaponName: string;
  cooldownFraction: number;
  buildMode: boolean;
  bossHp: number | null;
  bossMaxHp: number | null;
  prompt: string | null;
};

export class Hud {
  private readonly mainframeFill = this.getElement('#mainframe-hp-fill');
  private readonly mainframeValue = this.getElement('#mainframe-hp-value');
  private readonly playerFill = this.getElement('#player-hp-fill');
  private readonly playerValue = this.getElement('#player-hp-value');
  private readonly bitsValue = this.getElement('#bits-value');
  private readonly waveValue = this.getElement('#wave-value');
  private readonly phaseValue = this.getElement('#phase-value');
  private readonly weaponValue = this.getElement('#weapon-value');
  private readonly weaponCooldownFill = this.getElement('#weapon-cooldown-fill');
  private readonly promptBanner = this.getElement('#prompt-banner');
  private readonly bossBar = this.getElement('#boss-bar');
  private readonly bossFill = this.getElement('#boss-hp-fill');
  private readonly endScreen = this.getElement('#end-screen');
  private readonly endTitle = this.getElement('#end-title');
  private readonly endSubtitle = this.getElement('#end-subtitle');
  private readonly buildHint = this.getElement('#build-hint');

  update(state: HudState): void {
    const mainframeFraction = Math.max(0, state.mainframeHp / state.mainframeMaxHp);
    this.mainframeFill.style.width = `${mainframeFraction * 100}%`;
    this.mainframeValue.textContent = `${Math.ceil(state.mainframeHp)}/${state.mainframeMaxHp}`;

    const playerFraction = Math.max(0, state.playerHp / state.playerMaxHp);
    this.playerFill.style.width = `${playerFraction * 100}%`;
    this.playerValue.textContent = `${Math.ceil(state.playerHp)}/${state.playerMaxHp}`;

    this.bitsValue.textContent = String(Math.floor(state.bits));
    this.waveValue.textContent = `${state.waveNumber}/${state.totalWaves}`;

    if (state.phase === 'prep') {
      const seconds = Math.max(0, Math.ceil(state.prepRemaining));
      this.phaseValue.textContent = `Prep ${seconds}s`;
    } else if (state.phase === 'combat') {
      this.phaseValue.textContent = state.waveNumber === state.totalWaves ? 'Final Wave' : 'Combat';
    } else {
      this.phaseValue.textContent = state.phase === 'victory' ? 'Victory' : 'Defeat';
    }

    this.weaponValue.textContent = state.weaponName;
    this.weaponCooldownFill.style.width = `${Math.max(0, Math.min(1, state.cooldownFraction)) * 100}%`;

    this.promptBanner.textContent = state.prompt ?? '';
    this.promptBanner.classList.toggle('visible', Boolean(state.prompt));
    this.buildHint.classList.toggle('visible', state.buildMode);

    if (state.bossHp !== null && state.bossMaxHp) {
      this.bossBar.classList.add('visible');
      this.bossFill.style.width = `${Math.max(0, state.bossHp / state.bossMaxHp) * 100}%`;
    } else {
      this.bossBar.classList.remove('visible');
    }
  }

  flashDamage(): void {
    this.playerFill.animate(
      [{ filter: 'brightness(2.6)' }, { filter: 'brightness(1)' }],
      { duration: 220, easing: 'ease-out' },
    );
  }

  punchBits(): void {
    this.bitsValue.animate(
      [{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
      { duration: 160, easing: 'ease-out' },
    );
  }

  showEndScreen(kind: 'victory' | 'defeat', subtitle: string): void {
    this.endScreen.classList.add('visible');
    this.endTitle.textContent = kind === 'victory' ? 'SYSTEM SECURED' : 'MAINFRAME TERMINATED';
    this.endTitle.classList.toggle('victory', kind === 'victory');
    this.endTitle.classList.toggle('defeat', kind === 'defeat');
    this.endSubtitle.textContent = subtitle;
  }

  hideEndScreen(): void {
    this.endScreen.classList.remove('visible');
  }

  onRetry(handler: () => void): void {
    this.getElement('#retry-button').addEventListener('click', handler);
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
