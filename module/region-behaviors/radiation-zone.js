/**
 * RadiationZoneBehaviorType
 *
 * Built-in Neuroshima region behavior type.
 * Automatically tracks token entry/exit and delegates wound application
 * to the game.neuroshima.radiation API + updateWorldTime hook.
 *
 * Registration: CONFIG.RegionBehavior.dataModels["neuroshima.radiationZone"]
 * Localization:  NEUROSHIMA.RegionBehavior.RadiationZone.*
 */
export class RadiationZoneBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
    static LOCALIZATION_PREFIXES = ["NEUROSHIMA.RegionBehavior.RadiationZone"];

    static defineSchema() {
        const fields = foundry.data.fields;
        return {
            events: this._createEventsField({
                events: [
                    CONST.REGION_EVENTS.TOKEN_ENTER,
                    CONST.REGION_EVENTS.TOKEN_EXIT
                ]
            }),
            level: new fields.NumberField({
                required: true,
                integer: true,
                initial: 10,
                min: 0
            }),
            intervalHours: new fields.NumberField({
                required: true,
                integer: true,
                initial: 1,
                min: 0
            }),
            intervalMinutes: new fields.NumberField({
                required: true,
                integer: true,
                initial: 0,
                min: 0
            }),
            intervalSeconds: new fields.NumberField({
                required: true,
                integer: true,
                initial: 0,
                min: 0
            }),
            woundDamageType: new fields.StringField({
                required: true,
                initial: "D",
                choices: {
                    "D":  "NEUROSHIMA.Damage.Full.D",
                    "L":  "NEUROSHIMA.Damage.Full.L",
                    "C":  "NEUROSHIMA.Damage.Full.C",
                    "K":  "NEUROSHIMA.Damage.Full.K",
                    "sD": "NEUROSHIMA.Damage.Full.sD",
                    "sL": "NEUROSHIMA.Damage.Full.sL",
                    "sC": "NEUROSHIMA.Damage.Full.sC",
                    "sK": "NEUROSHIMA.Damage.Full.sK"
                }
            }),
            woundCount: new fields.NumberField({
                required: true,
                integer: true,
                initial: 1,
                min: 1
            }),
            penaltyOverrideEnabled: new fields.BooleanField({ initial: false }),
            penaltyOverride: new fields.NumberField({
                required: false,
                nullable: true,
                integer: true,
                initial: null,
                min: 0
            }),
            createDisease: new fields.BooleanField({ initial: false }),
            diseaseIncrement: new fields.NumberField({
                required: true,
                integer: true,
                initial: 5,
                min: 0
            })
        };
    }

    async _handleRegionEvent(event) {
        if (!game.user.isGM) return;

        const token = event.data.token;
        if (!token) {
            game.neuroshima?.log("RadiationZone | No token in event — skipping");
            return;
        }

        const api = game.neuroshima?.radiation;
        if (!api) {
            game.neuroshima?.log("RadiationZone | radiation API not yet available — skipping");
            return;
        }

        const regionId = this.parent?.parent?.id;
        if (!regionId) {
            game.neuroshima?.log("RadiationZone | Could not resolve region ID — skipping");
            return;
        }

        const eventName = event.name;

        if (eventName === CONST.REGION_EVENTS.TOKEN_ENTER) {
            const totalIntervalHours = this.intervalHours
                + (this.intervalMinutes / 60)
                + (this.intervalSeconds / 3600);
            const config = {
                level:           this.level,
                intervalHours:   totalIntervalHours,
                woundDamageType: this.woundDamageType,
                woundCount:      this.woundCount,
                penaltyOverride:    this.penaltyOverrideEnabled ? (this.penaltyOverride ?? null) : null,
                createDisease:      this.createDisease,
                diseaseIncrement:   this.diseaseIncrement
            };
            game.neuroshima?.log(
                `RadiationZone | TOKEN_ENTER — token "${token.name}" → region ${regionId}`,
                config
            );
            await api.enter(token, regionId, config);

        } else if (eventName === CONST.REGION_EVENTS.TOKEN_EXIT) {
            game.neuroshima?.log(
                `RadiationZone | TOKEN_EXIT — token "${token.name}" ← region ${regionId}`
            );
            await api.exit(token, regionId);
        }
    }
}
