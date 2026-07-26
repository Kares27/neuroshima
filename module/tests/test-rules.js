import { NEUROSHIMA } from "../config.js";

export const DIFFICULTY_ORDER = Object.freeze([
  "easy", "average", "problematic", "hard", "veryHard",
  "damnHard", "luck", "masterful", "grandmasterful"
]);

export class TestRules {
  static difficultyFromPercent(percent) {
    const value = Number(percent ?? 0);
    const found = Object.values(NEUROSHIMA.difficulties)
      .find(difficulty => value >= difficulty.min && value <= difficulty.max);
    if (found) return found;
    return value < 0
      ? NEUROSHIMA.difficulties.easy
      : NEUROSHIMA.difficulties.grandmasterful;
  }

  static skillShift(skill) {
    const value = Number(skill ?? 0);
    return value <= 0 ? -1 : Math.floor(value / 4);
  }

  static diceShift(results = []) {
    return results.reduce((shift, result) => {
      if (result === 1) return shift - 1;
      if (result === 20) return shift + 1;
      return shift;
    }, 0);
  }

  static shiftDifficulty(base, shift = 0) {
    if (!base) return NEUROSHIMA.difficulties.average;
    const key = DIFFICULTY_ORDER.find(entry => NEUROSHIMA.difficulties[entry] === base)
      ?? DIFFICULTY_ORDER.find(entry => NEUROSHIMA.difficulties[entry]?.label === base.label)
      ?? "average";
    const index = DIFFICULTY_ORDER.indexOf(key);
    const shifted = Math.max(0, Math.min(DIFFICULTY_ORDER.length - 1, index + Number(shift ?? 0)));
    return NEUROSHIMA.difficulties[DIFFICULTY_ORDER[shifted]] ?? base;
  }

  static clampMaximumDifficulty(difficulty, maximumDifficulty) {
    if (!difficulty || !maximumDifficulty) return difficulty;
    const maximumIndex = DIFFICULTY_ORDER.indexOf(maximumDifficulty);
    if (maximumIndex < 0) return difficulty;
    const currentIndex = DIFFICULTY_ORDER.findIndex(
      key => NEUROSHIMA.difficulties[key] === difficulty
        || NEUROSHIMA.difficulties[key]?.label === difficulty.label
    );
    return currentIndex > maximumIndex
      ? (NEUROSHIMA.difficulties[maximumDifficulty] ?? difficulty)
      : difficulty;
  }
}
