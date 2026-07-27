import { NeuroshimaTest } from "../neuroshima-test.js";
import { NEUROSHIMA } from "../../config.js";

export class AttackTest extends NeuroshimaTest {
  static classId = "attack";

  static shiftDamageType(type, steps = 0) {
    if (!steps) return type;
    const regular = ["D", "L", "C", "K"];
    const bruise = ["sD", "sL", "sC", "sK"];
    const track = String(type ?? "").startsWith("s") ? bruise : regular;
    const index = track.indexOf(type);
    if (index < 0) return type;
    return track[Math.min(track.length - 1, Math.max(0, index + Number(steps)))];
  }

  static locationFromRoll(value) {
    const rolled = Number(value);
    const entry = Object.entries(NEUROSHIMA.bodyLocations).find(([, data]) => (
      Array.isArray(data.roll) && rolled >= data.roll[0] && rolled <= data.roll[1]
    ));
    return entry?.[0] ?? "torso";
  }

  async computeHitLocation(requested = this.context.hitLocation ?? "torso") {
    if (requested !== "random") {
      this.result.data.finalLocation = requested;
      return requested;
    }
    const locationRoll = await new Roll("1d20").evaluate();
    const location = this.constructor.locationFromRoll(locationRoll.total);
    this.result.data.locationRoll = locationRoll.total;
    this.result.data.finalLocation = location;
    (this.result.data.auxiliaryRolls ??= []).push({
      type: "hitLocation",
      formula: locationRoll.formula ?? "1d20",
      result: locationRoll.total,
      value: location
    });
    return location;
  }

  computeMeleeDamageProfiles({
    location = this.result.data.finalLocation,
    damageShift = 0,
    damageShift1 = 0,
    damageShift2 = 0,
    damageShift3 = 0
  } = {}) {
    const system = this.item?.system ?? {};
    const headShift = location === "head" ? 1 : 0;
    const profiles = [
      this.constructor.shiftDamageType(system.damageMelee1 || "D", damageShift + damageShift1 + headShift),
      this.constructor.shiftDamageType(system.damageMelee2 || system.damageMelee1 || "D", damageShift + damageShift2 + headShift),
      this.constructor.shiftDamageType(system.damageMelee3 || system.damageMelee2 || system.damageMelee1 || "D", damageShift + damageShift3 + headShift)
    ];
    Object.assign(this.result.data, {
      damageMelee1: profiles[0],
      damageMelee2: profiles[1],
      damageMelee3: profiles[2],
      damage: profiles.join("/"),
      damageProfilesResolved: true,
      headDamageApplied: headShift === 1
    });
    return profiles;
  }
}
