import { createSeededRandom } from '../utils/random';

type SfxName =
  | 'blasterShot'
  | 'spitShot'
  | 'enemyHit'
  | 'enemyDeath'
  | 'resourcePickup'
  | 'waveStart'
  | 'playerHit'
  | 'gatlingFire'
  | 'railgunFire'
  | 'buildPlace'
  | 'repairHum'
  | 'bossRoar'
  | 'mainframeAlarm';

// Generated via threejs-audio-generator (ElevenLabs); served from assets/audio/sfx
// through Vite's publicDir. If a fetch/decode fails (offline, asset missing), each
// call site falls back to its original oscillator synthesis below.
const SFX_MANIFEST: Record<SfxName, string> = {
  blasterShot: '/audio/sfx/blaster-shot.mp3',
  spitShot: '/audio/sfx/spit-shot.mp3',
  enemyHit: '/audio/sfx/enemy-hit.mp3',
  enemyDeath: '/audio/sfx/enemy-death.mp3',
  resourcePickup: '/audio/sfx/resource-pickup.mp3',
  waveStart: '/audio/sfx/wave-start.mp3',
  playerHit: '/audio/sfx/player-hit.mp3',
  gatlingFire: '/audio/sfx/gatling-fire.mp3',
  railgunFire: '/audio/sfx/railgun-fire.mp3',
  buildPlace: '/audio/sfx/build-place.mp3',
  repairHum: '/audio/sfx/repair-hum.mp3',
  bossRoar: '/audio/sfx/boss-roar.mp3',
  mainframeAlarm: '/audio/sfx/mainframe-alarm.mp3',
};

export class AudioSystem {
  private context: AudioContext | null = null;
  private unlocked = false;
  private noiseBuffer: AudioBuffer | null = null;
  private duck = 1;
  private readonly buffers = new Map<SfxName, AudioBuffer>();

  constructor() {
    const unlock = () => {
      void this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    await this.context.resume();
    this.unlocked = true;
    this.noiseBuffer = this.buildNoiseBuffer(this.context);
    // Fire-and-forget: gameplay can start immediately on synthesized fallbacks
    // while the real clips decode in the background.
    void this.loadBuffers(this.context);
  }

  setDuck(value: number): void {
    this.duck = value;
  }

  private async loadBuffers(ctx: AudioContext): Promise<void> {
    await Promise.all(
      (Object.entries(SFX_MANIFEST) as [SfxName, string][]).map(async ([name, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return;
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          this.buffers.set(name, audioBuffer);
        } catch {
          // Keep the synthesized fallback for this cue.
        }
      }),
    );
  }

  private ready(): boolean {
    return Boolean(this.context) && this.context!.state === 'running';
  }

  /** Plays a generated clip if it has finished loading; returns false so the caller can fall back to synthesis. */
  private playBuffer(name: SfxName, pitchMultiplier: number, peakGain: number): boolean {
    const buffer = this.buffers.get(name);
    if (!this.ready() || !buffer) return false;
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = pitchMultiplier;
    gain.gain.value = peakGain * this.duck;
    source.connect(gain).connect(ctx.destination);
    source.start();
    return true;
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    peakGain: number,
    rng: () => number,
  ): void {
    if (!this.ready()) return;
    const ctx = this.context!;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const pitchVariance = 1 + (rng() - 0.5) * 0.08;
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart * pitchVariance, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd * pitchVariance), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain * this.duck, now + Math.min(0.02, duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noiseBurst(duration: number, peakGain: number, filterFreq = 2000): void {
    if (!this.ready() || !this.noiseBuffer) return;
    const ctx = this.context!;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain * this.duck, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  private pitch(rng: () => number, range = 0.1): number {
    return 1 + (rng() - 0.5) * range;
  }

  blasterShot(rng: () => number): void {
    if (this.playBuffer('blasterShot', this.pitch(rng), 0.5)) return;
    this.tone(980, 420, 0.09, 'square', 0.05, rng);
  }

  spitShot(rng: () => number): void {
    if (this.playBuffer('spitShot', this.pitch(rng), 0.55)) return;
    this.tone(320, 160, 0.16, 'sawtooth', 0.06, rng);
  }

  enemyHit(rng: () => number): void {
    if (this.playBuffer('enemyHit', this.pitch(rng), 0.4)) return;
    this.tone(260, 140, 0.05, 'triangle', 0.04, rng);
  }

  enemyDeath(rng: () => number): void {
    if (this.playBuffer('enemyDeath', this.pitch(rng), 0.6)) return;
    this.tone(220, 60, 0.22, 'sawtooth', 0.07, rng);
    this.noiseBurst(0.12, 0.05, 1200);
  }

  resourcePickup(rng: () => number): void {
    if (this.playBuffer('resourcePickup', this.pitch(rng), 0.5)) return;
    this.tone(420, 760, 0.14, 'triangle', 0.07, rng);
  }

  waveStart(): void {
    if (this.playBuffer('waveStart', 1, 0.6)) return;
    this.tone(220, 440, 0.4, 'sawtooth', 0.08, () => 0.5);
  }

  playerHit(rng: () => number): void {
    if (this.playBuffer('playerHit', this.pitch(rng), 0.6)) return;
    this.tone(160, 70, 0.18, 'square', 0.09, rng);
    this.noiseBurst(0.15, 0.08, 500);
  }

  gatlingFire(rng: () => number): void {
    if (this.playBuffer('gatlingFire', this.pitch(rng, 0.16), 0.3)) return;
    this.tone(640, 380, 0.05, 'square', 0.025, rng);
  }

  railgunFire(rng: () => number): void {
    if (this.playBuffer('railgunFire', this.pitch(rng, 0.06), 0.65)) return;
    this.tone(180, 70, 0.3, 'sawtooth', 0.08, rng);
    this.noiseBurst(0.18, 0.06, 800);
  }

  buildPlace(): void {
    if (this.playBuffer('buildPlace', 1, 0.55)) return;
    this.tone(300, 620, 0.2, 'triangle', 0.08, () => 0.5);
  }

  repairHum(): void {
    if (this.playBuffer('repairHum', 1, 0.3)) return;
    this.tone(180, 240, 0.12, 'sine', 0.03, () => 0.5);
  }

  bossRoar(): void {
    if (this.playBuffer('bossRoar', 1, 0.7)) return;
    this.tone(90, 45, 1.1, 'sawtooth', 0.1, () => 0.5);
    this.noiseBurst(0.8, 0.07, 300);
  }

  mainframeAlarm(): void {
    if (this.playBuffer('mainframeAlarm', 1, 0.5)) return;
    this.tone(500, 500, 0.12, 'square', 0.05, () => 0.5);
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const duration = 0.4;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const noiseRng = createSeededRandom(7);
    for (let i = 0; i < data.length; i += 1) data[i] = noiseRng() * 2 - 1;
    return buffer;
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }
}
