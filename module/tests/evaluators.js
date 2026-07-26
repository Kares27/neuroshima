function orderedDice(rawResults = []) {
  return rawResults.map((value, index) => ({
    original: Number(value),
    index,
    modified: Number(value),
    isSuccess: false,
    ignored: false,
    isNat1: Number(value) === 1,
    isNat20: Number(value) === 20
  }));
}

export class Closed3d20Evaluator {
  evaluate(data, rawResults) {
    const dice = orderedDice(rawResults);
    const target = Number(data.target ?? 0);
    const skill = Number(data.skill ?? 0);
    const reduction = Number(data.dieReductionBonus ?? 0);
    const sorted = [...dice].sort((a, b) => a.original - b.original);

    for (const die of sorted) {
      die.cost = die.original <= target ? 0 : (die.original === 20 ? 999 : die.original - target);
    }
    sorted.sort((a, b) => a.cost - b.cost);

    let pool = skill + reduction;
    for (const die of sorted) {
      if (die.original === 20) continue;
      const spent = pool > 0
        ? Math.min(pool, die.cost, Math.max(0, die.original - 1))
        : 0;
      pool -= spent;
      die.modified = die.original - spent;
      die.isSuccess = die.modified <= target;
    }

    if (pool > 0) {
      const successes = sorted.filter(die => die.isSuccess && die.original !== 1);
      while (pool > 0 && successes.some(die => die.modified > 1)) {
        successes.sort((a, b) => b.modified - a.modified);
        successes[0].modified -= 1;
        pool -= 1;
      }
    }

    data.modifiedResults = [...dice].sort((a, b) => a.index - b.index);
    data.successCount = data.modifiedResults.filter(die => die.isSuccess).length;
    data.success = data.successCount >= 2;
    const spent = skill + reduction - pool;
    data.skillUsed = Math.min(skill, spent);
    data.remainingSkill = skill - data.skillUsed;
    data.isCritSuccess = data.successCount === 3;
    data.isCritFailure = data.successCount === 0 && dice.some(die => die.original === 20);
    return data;
  }
}

export class Defense3d20Evaluator {
  evaluate(data, rawResults) {
    const target = Number(data.target ?? 0);
    data.modifiedResults = orderedDice(rawResults).map(die => ({
      ...die,
      isSuccess: die.original <= target && die.original !== 20
    }));
    data.successCount = data.modifiedResults.filter(die => die.isSuccess).length;
    data.success = data.successCount >= 2;
    data.isCritSuccess = data.successCount === 3;
    data.isCritFailure = data.successCount === 0
      && data.modifiedResults.some(die => die.original === 20);
    return data;
  }
}

export class Open3d20Evaluator {
  evaluate(data, rawResults) {
    const dice = orderedDice(rawResults);
    const sorted = [...dice].sort((a, b) => a.original - b.original);
    const ignored = sorted[2];
    ignored.ignored = true;

    const first = sorted[0];
    const second = sorted[1];
    let pool = Number(data.skill ?? 0) + Number(data.dieReductionBonus ?? 0);
    const match = second.original === 20
      ? 0
      : Math.min(pool, second.original - first.original, Math.max(0, second.original - 1));
    second.modified -= match;
    pool -= match;

    while (pool > 0 && (
      (first.modified > 1 && first.original !== 20)
      || (second.modified > 1 && second.original !== 20)
    )) {
      if (first.modified > 1 && first.original !== 20 && pool > 0) {
        first.modified -= 1;
        pool -= 1;
      }
      if (second.modified > 1 && second.original !== 20 && pool > 0) {
        second.modified -= 1;
        pool -= 1;
      }
    }

    const target = Number(data.target ?? 0);
    first.isSuccess = first.modified <= target && first.original !== 20;
    second.isSuccess = second.modified <= target && second.original !== 20;
    data.successPoints = target - Math.max(first.modified, second.modified);
    data.successCount = data.successPoints;
    data.success = data.successPoints >= 0;
    data.modifiedResults = [...dice].sort((a, b) => a.index - b.index);
    return data;
  }
}
