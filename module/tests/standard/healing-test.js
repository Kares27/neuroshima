import { SkillTest } from "./skill-test.js";
import { TestRules } from "../test-rules.js";
import { NEUROSHIMA } from "../../config.js";

export class HealingTest extends SkillTest {
  static classId = "healing";

  constructor(data = {}) {
    super({ ...data, type: "healing" });
    this.patient = data.patient ?? data.context?.patientActor ?? null;
    this.wound = data.wound ?? data.context?.wound ?? null;
  }

  static forWound({
    medicActor,
    patientActor,
    healingMethod,
    woundConfig,
    stat = null,
    skillBonus = 0,
    attributeBonus = 0,
    autoSuccess = false,
    annotations = [],
    dieManualBonus = 0,
    dieReductionBonus = 0,
    reroll = false
  }) {
    const skillName = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
    const baseStat = stat ?? (
      Number(medicActor.system.attributes?.dexterity ?? 0)
      + Number(medicActor.system.modifiers?.dexterity ?? 0)
    );
    const skillValue = Number(medicActor.system.skills?.[skillName]?.value ?? 0);
    const difficulty = NEUROSHIMA.difficulties?.[woundConfig.difficulty || "average"]
      ?? NEUROSHIMA.difficulties?.average
      ?? { min: 0 };
    const wound = patientActor.items?.get(woundConfig.woundId) ?? null;

    return new this({
      actor: medicActor,
      patient: patientActor,
      wound,
      attribute: { key: "dexterity", value: baseStat },
      skill: { key: skillName, value: skillValue },
      preData: {
        label: woundConfig.woundName,
        penalties: {
          mod: Number(difficulty.min ?? 0) + Number(woundConfig.modifier ?? 0)
        },
        skillBonus,
        attributeBonus,
        finalDifficultyShift: Number(woundConfig.failedAttempts ?? 0)
          + Number(woundConfig.difficultyShift ?? 0),
        autoSuccess,
        annotations,
        dieManualBonus,
        dieReductionBonus
      },
      context: {
        reroll,
        isOpen: false,
        rollType: "healing",
        healingMethod,
        patientActor,
        wound,
        woundConfig,
        eventArgs: { patientActor, wound }
      }
    });
  }

  async resolveDomain() {
    const config = this.context.woundConfig ?? {};
    const data = this.result.data;
    const calculated = globalThis.game?.neuroshima?.HealingApp?.calculateHealingResults?.(
      this.patient,
      [config.woundId],
      data.successCount,
      this.context.healingMethod,
      config.hadFirstAid,
      config.healingModifier,
      config.scriptHealingModifier ?? 0
    ) ?? [];

    Object.assign(data, {
      woundId: config.woundId,
      woundName: config.woundName,
      damageType: config.damageType,
      difficulty: config.difficulty,
      testTarget: data.target,
      isSuccess: data.success === true,
      finalStat: data.stat,
      skillShift: -TestRules.skillShift(data.skill),
      diceShift: TestRules.diceShift(data.rawResults),
      healingEffect: calculated[0] ?? null
    });
    return this.result;
  }

  async recalculate() {
    await super.recalculate();
    await this.resolveDomain();
    return this.result;
  }
}
