import { STARTING_BITS } from '../game/GameConfig';

/** "Bits" currency earned from kills, spent on towers and repairs. */
export class EconomySystem {
  bits = STARTING_BITS;

  add(amount: number): void {
    this.bits += amount;
  }

  canAfford(cost: number): boolean {
    return this.bits >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.bits -= cost;
    return true;
  }

  reset(): void {
    this.bits = STARTING_BITS;
  }
}
