export function maxMeleeTempo(actor, weapon) {
  const key = weapon?.system?.skill;
  const value = key === "experience" && actor?.type === "creature"
    ? actor.system.experience : actor?.system?.skills?.[key]?.value;
  return Math.min(3, Math.max(0, Math.trunc(Number(value) || 0)));
}

export function clampMeleeTempo(value, maximum = 3) {
  return Math.min(maximum, Math.max(0, Math.trunc(Number(value) || 0)));
}

/** Full defense needs two consecutive successful defenses against failed attacks. */
export function resolveDefensiveManeuver(state, { ownerSide, ownerSuccesses, responderSuccesses, responderAction, outcome }) {
  const responderSide = ownerSide === "attacker" ? "defender" : "attacker";
  const maneuver = state[`${responderSide}Maneuver`];
  state.fullDefenseStreak ??= { attacker: 0, defender: 0 };
  if (responderAction === "attack" || maneuver !== "fullDefense") {
    state.fullDefenseStreak[responderSide] = 0;
    return outcome;
  }
  const consecutive = ownerSuccesses === 0 && responderSuccesses > 0;
  state.fullDefenseStreak[responderSide] = consecutive
    ? (Number(state.fullDefenseStreak[responderSide]) || 0) + responderSuccesses : 0;
  if (outcome !== "takeover") return outcome;
  if (state.fullDefenseStreak[responderSide] < 2) return "blocked";
  state.fullDefenseStreak[responderSide] = 0;
  return "takeover";
}
