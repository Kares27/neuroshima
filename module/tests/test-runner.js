const WEAPON_TYPES = new Set(["weapon", "melee", "ranged", "thrown"]);

/**
 * The sole lifecycle coordinator for tests. Domain resolvers calculate their
 * own data, but may not dispatch roll triggers or commit document changes.
 */
export class TestRunner {
  static scriptRunner = null;

  static getScriptRunner() {
    const runner = this.scriptRunner ?? globalThis.game?.neuroshima?.NeuroshimaScriptRunner;
    if (!runner) throw new Error("NeuroshimaScriptRunner is not available");
    return runner;
  }

  static async begin(test, { specialized = null } = {}) {
    const isWeapon = WEAPON_TYPES.has(test.rollType);
    const special = specialized ?? (isWeapon
      ? {
          pre: "preRollWeaponTest",
          post: "rollWeaponTest",
          preLegacy: ["preWeaponTest"],
          postLegacy: ["weaponTest"]
        }
      : {});
    test.phase = "preRollTest";
    if (test.actor && !test.context.isDebug) {
      await this._dispatch("preRollTest", test, { phase: "pre" });
      if (!test.preData.cancelled && special.pre) {
        await this._dispatch(special.pre, test, {
          phase: "pre",
          legacyTriggers: special.preLegacy
        });
      }
    }
    if (test.preData.cancelled) {
      test.phase = "cancelled";
      test.result.cancelled = true;
      test.sideEffects.clear();
      return false;
    }
    test.result.annotations = test.preData.annotations;
    return true;
  }

  static async finish(test, {
    specialized = null,
    recalculate = null,
    synchronize = null,
    legacyAfter = [],
    commit = true
  } = {}) {
    const isWeapon = WEAPON_TYPES.has(test.rollType);
    const special = specialized ?? (isWeapon
      ? {
          pre: "preRollWeaponTest",
          post: "rollWeaponTest",
          preLegacy: ["preWeaponTest"],
          postLegacy: ["weaponTest"]
        }
      : {});
    test.phase = "rollTest";
    if (test.actor && !test.context.isDebug) {
      const before = {
        isSuccess: test.result.isSuccess,
        successCount: test.result.successCount,
        successPoints: test.result.successPoints
      };
      await this._dispatch("rollTest", test, { phase: "result" });
      if (special.post) {
        await this._dispatch(special.post, test, {
          phase: "result",
          legacyTriggers: special.postLegacy
        });
      }
      await test.transformations.apply(test);
      if (recalculate) await recalculate(test);
      if (synchronize) await synchronize(test, before);

      for (const entry of legacyAfter) {
        const trigger = typeof entry === "string" ? entry : entry.trigger;
        const args = typeof entry === "string"
          ? this._args(test)
          : (entry.args?.(test) ?? this._args(test));
        await this.getScriptRunner().executeLegacy(trigger, args, {
          ...this._metadata(test, "result"),
          ...(entry.metadata ?? {}),
          mutable: false
        });
      }
    }
    if (test._forcedSuccess) test.result.forceSuccess(test._forcedSuccess);
    test.phase = "commit";
    if (commit) await test.sideEffects.commit(test);
    else test.sideEffects.clear();
    test.phase = "complete";
    return test.result;
  }

  static async run(test, {
    prepare = null,
    roll,
    evaluate,
    resolve = null,
    recalculate = null,
    synchronize = null,
    specialized = null,
    legacyAfter = [],
    commit = true
  } = {}) {
    const actor = test.actor;
    const isWeapon = WEAPON_TYPES.has(test.rollType);
    const special = specialized ?? (isWeapon
      ? {
          pre: "preRollWeaponTest",
          post: "rollWeaponTest",
          preLegacy: ["preWeaponTest"],
          postLegacy: ["weaponTest"]
        }
      : {});

    const proceed = await this.begin(test, { specialized: special });
    if (!proceed) return test.result;

    test.phase = "prepare";
    if (prepare) await prepare(test);

    // Compatibility with old scripts: preData.autoSuccess historically meant
    // "do not roll". Dialog input is converted explicitly to keepRoll.
    if (test.preData.autoSuccess && !test._forcedSuccess) {
      test.forceSuccess({ mode: "skipRoll" });
    }

    if (test._forcedSuccess !== "skipRoll") {
      test.phase = "roll";
      const rolled = await roll(test);
      test.result.roll = rolled?.roll ?? rolled ?? null;
      if (rolled?.rawResults) test.result.data.rawResults = [...rolled.rawResults];

      test.phase = "evaluate";
      await evaluate(test, rolled);

      test.phase = "resolve";
      if (resolve) await resolve(test, rolled);
    } else {
      test.result.skipped = true;
      test.result.data.rawResults ??= [];
      test.result.data.rolledResults ??= [];
      test.result.data.modifiedResults ??= [];
    }

    if (test._forcedSuccess) test.result.forceSuccess(test._forcedSuccess);

    return this.finish(test, {
      specialized: special,
      recalculate,
      synchronize,
      legacyAfter,
      commit
    });
  }

  static _args(test) {
    const rollData = test.result.rollData;
    return {
      ...(test.context.eventArgs ?? {}),
      actor: test.actor,
      item: test.item,
      weapon: test.item,
      test,
      rollData,
      roll: test.result.roll
    };
  }

  static _metadata(test, phase) {
    return {
      type: test.rollType,
      subtype: test.subtype,
      item: test.item,
      test,
      roll: test.result.roll,
      result: test.result.rollData,
      phase,
      reroll: test.context.reroll === true,
      edited: test.context.edited === true,
      tags: [...test.result.tags]
    };
  }

  static async _dispatch(trigger, test, { phase, legacyTriggers = [] }) {
    return this.getScriptRunner().executeEvent(trigger, this._args(test), {
      legacyTriggers,
      metadata: this._metadata(test, phase)
    });
  }
}
