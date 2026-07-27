/**
 * Composition of two completed melee tests. It never rolls dice and never
 * updates documents; callers remain responsible for presenting and applying
 * the resulting hits.
 */
export class MeleeOpposedResolver {
  constructor(attackerTest, defenderTest, { mode = "opposedSuccesses", context = {} } = {}) {
    this.attackerTest = attackerTest;
    this.defenderTest = defenderTest;
    this.mode = mode;
    this.context = context;
    this.result = null;
  }

  get triggerArgs() {
    return {
      actor: this.attackerTest.actor,
      defenderActor: this.defenderTest.actor,
      item: this.attackerTest.item,
      test: this.attackerTest,
      attackerTest: this.attackerTest,
      defenderTest: this.defenderTest,
      opposedTest: this,
      context: this.context
    };
  }

  async resolve() {
    const runner = this.attackerTest.getScriptRunner();
    await runner.executeEvent("preOpposedAttacker", this.triggerArgs, {
      metadata: { role: "source", item: this.attackerTest.item, opposedTest: this }
    });
    await runner.executeEvent("preOpposedDefender", {
      ...this.triggerArgs,
      actor: this.defenderTest.actor,
      item: this.defenderTest.item
    }, {
      metadata: { role: "target", item: this.defenderTest.item, opposedTest: this }
    });

    // Pre-opposed scripts may alter either completed result.
    if (this.attackerTest.needsRecalculation()) await this.attackerTest.recalculate();
    if (this.defenderTest.needsRecalculation()) await this.defenderTest.recalculate();

    const attacker = this.attackerTest.opposedResult;
    const defender = this.defenderTest.opposedResult;
    const hits = [];
    if (this.mode === "opposedPips") {
      const length = Math.max(attacker.dice.length, defender.dice.length);
      for (let index = 0; index < length; index++) {
        const attackDie = attacker.dice[index];
        const defenseDie = defender.dice[index];
        if (attackDie?.isSuccess
          && (!defenseDie?.isSuccess || attackDie.modified < defenseDie.modified)) {
          hits.push({ tier: index + 1 });
        }
      }
    } else {
      const difference = Number(attacker.successes ?? 0) - Number(defender.successes ?? 0);
      if (difference > 0) hits.push({ tier: Math.min(3, difference) });
    }

    this.result = {
      mode: this.mode,
      attacker,
      defender,
      difference: Number(attacker.successes ?? 0) - Number(defender.successes ?? 0),
      winner: hits.length ? "attacker" : "defender",
      hits
    };

    await runner.executeEvent("opposedAttacker", this.triggerArgs, {
      metadata: { role: "source", item: this.attackerTest.item, opposedTest: this }
    });
    await runner.executeEvent("opposedDefender", {
      ...this.triggerArgs,
      actor: this.defenderTest.actor,
      item: this.defenderTest.item
    }, {
      metadata: { role: "target", item: this.defenderTest.item, opposedTest: this }
    });
    return this.result;
  }

  async calculateDamage(damage = {}) {
    const args = { ...this.triggerArgs, damage };
    await this.attackerTest.getScriptRunner().executeEvent("calculateOpposedDamage", args, {
      metadata: { role: "source", item: this.attackerTest.item, opposedTest: this, damage }
    });
    return args.damage;
  }
}
