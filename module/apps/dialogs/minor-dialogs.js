const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { TestRules, NeuroshimaTestFactory } from "../../tests.mjs";
import { NEUROSHIMA } from "../../config.js";
import { NeuroshimaScriptRunner } from "../neuroshima-script-engine.js";

export class AmmunitionLoadingDialog {
  static async wait({ ammo, magazine }) {
    const currentCount = magazine.system.totalCount;
    const capacity = magazine.system.capacity;
    const remainingSpace = Math.max(0, capacity - currentCount);
    const maxToLoad = Math.min(ammo.system.quantity, remainingSpace);

    if (maxToLoad <= 0) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.MagazineFull"));
      return null;
    }

    if (ammo.system.caliber !== magazine.system.caliber) {
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("NEUROSHIMA.Dialog.CaliberMismatch.Title") },
            content: `<p>${game.i18n.format("NEUROSHIMA.Dialog.CaliberMismatch.Content", {
                ammo: ammo.system.caliber,
                mag: magazine.system.caliber
            })}</p>`,
            classes: ["neuroshima"]
        });
        if (!confirmed) return null;
    }

    const content = `
      <div class="neuroshima ammo-loading-dialog">
        <p>${game.i18n.format("NEUROSHIMA.Dialog.AmmoLoading.Content", {
          name: ammo.name,
          mag: magazine.name,
          max: maxToLoad
        })}</p>
        <div class="form-group">
          <label>${game.i18n.localize("NEUROSHIMA.Dialog.AmmoLoading.Amount")}</label>
          <div class="form-fields">
            <input type="number" name="amount" value="${maxToLoad}" min="1" max="${maxToLoad}" step="1" autofocus>
          </div>
        </div>
      </div>
    `;

    const amount = await foundry.applications.api.DialogV2.wait({
      window: {
        title: game.i18n.localize("NEUROSHIMA.Dialog.AmmoLoading.Title")
      },
      content: content,
      buttons: [
        {
          action: "load",
          label: game.i18n.localize("NEUROSHIMA.Actions.Load"),
          default: true,
          callback: (event, button, dialog) => {
            const val = parseInt(button.form.elements.amount.value);
            return Math.clamp(val, 1, maxToLoad);
          }
        },
        {
          action: "cancel",
          label: game.i18n.localize("NEUROSHIMA.Actions.Cancel"),
          callback: () => null
        }
      ],
      classes: ["neuroshima"],
      rejectClose: false
    });

    return amount;
  }
}

export class RestDialog {
  static async wait() {
    const template = "systems/neuroshima/templates/dialog/rest-dialog.hbs";
    const content = await foundry.applications.handlebars.renderTemplate(template, {});

    try {
      const result = await foundry.applications.api.DialogV2.wait({
        window: {
          title: game.i18n.localize("NEUROSHIMA.Rest.Title"),
          width: 320
        },
        content: content,
        buttons: [
          {
            action: "rest",
            label: game.i18n.localize("NEUROSHIMA.Rest.Button"),
            default: true,
            callback: (event, button, dialog) => {
              const fd = new FormDataExtended(dialog.element.querySelector("form"));
              const data = fd.object;
              return {
                days: Math.round(parseInt(data.days) || 1),
                regularPenalty: Math.round(parseInt(data.regularPenalty) || 5),
                bruisePenalty: Math.round(parseInt(data.bruisePenalty) || 30)
              };
            }
          },
          {
            action: "cancel",
            label: game.i18n.localize("NEUROSHIMA.Actions.Cancel"),
            callback: () => null
          }
        ],
        classes: ["neuroshima"],
        rejectClose: false
      });
      return result;
    } catch (e) {
      return null;
    }
  }
}

export class EditRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(message, options={}) {
        super(options);
        this.message = message;
    }

    static DEFAULT_OPTIONS = {
        id: "edit-roll-dialog",
        tag: "form",
        classes: ["neuroshima", "edit-roll-dialog"],
        window: {
            title: "NEUROSHIMA | Edycja rzutu",
            resizable: true
        },
        position: {
            width: 460,
            height: "auto"
        },
        form: {
            handler: EditRollDialog.#onSubmit,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "systems/neuroshima/templates/apps/edit-roll-dialog.hbs"
        }
    };

    async _prepareContext(options) {
        const flags = foundry.utils.deepClone(
          this.message.getFlag("neuroshima", "test")?.rollData ?? {}
        );
        flags.rawResults ??= (flags.modifiedResults ?? []).map(die => die.original);
        const messageType = this.message.getFlag("neuroshima", "messageType");
        const storedBasePenalty = Number(flags.penalties?.base);
        const storedDifficultyLabel = flags.baseDifficultyLabel ?? flags.baseDifficulty?.label;
        const difficultyKey = messageType === "healingRoll"
          ? Object.entries(NEUROSHIMA.difficulties)
            .find(([, difficulty]) => difficulty.label === storedDifficultyLabel)?.[0] ?? "average"
          : Number.isFinite(storedBasePenalty)
            ? Object.entries(NEUROSHIMA.difficulties)
              .find(([, difficulty]) => Number(difficulty.min) === storedBasePenalty)?.[0] ?? "average"
            : "average";
        flags.baseDifficulty ??= TestRules.difficultyFromPenalty(Number(flags.totalPenalty ?? 0));
        flags.baseStat ??= flags.stat
          ?? (Number(flags.target ?? 0) - Number(flags.baseDifficulty?.mod ?? 0));
        flags.baseSkill ??= flags.skill ?? 0;
        flags.attributeBonus ??= 0;
        flags.skillBonus ??= 0;
        flags.penalties ??= {};
        for (const key of ["mod", "wounds", "armor", "disease"]) flags.penalties[key] ??= 0;
        if (messageType === "healingRoll") {
          flags.penalties.mod = Number(flags.penalties.mod) - Number(NEUROSHIMA.difficulties[difficultyKey]?.min ?? 0);
        }
        return {
            rollData: flags,
            dice: (flags?.rawResults ?? []).map((value, index) => ({
              index,
              displayIndex: index + 1,
              value: Number.isFinite(Number(value)) ? Number(value) : ""
            })),
            difficulties: Object.entries(NEUROSHIMA.difficulties).map(([key, difficulty]) => ({
              key, label: game.i18n.localize(difficulty.label), selected: key === difficultyKey
            }))
        };
    }

    static async #onSubmit(event, form, formData) {
        const data = formData.object;
        const message = this.message;
        const messageType = message.getFlag("neuroshima", "messageType");
        const isGrenade = messageType === "grenade";
        const serialized = foundry.utils.deepClone(message.getFlag("neuroshima", "test"));
        if (!serialized?.classId) {
          return ui.notifications.warn("Ta karta nie zawiera testu w nowym formacie.");
        }
        const beforeData = foundry.utils.deepClone(serialized.rollData);

        const updated = foundry.utils.deepClone(beforeData);
        updated.rawResults ??= (updated.modifiedResults ?? []).map(die => die.original);
        updated.rawResults = (updated.rawResults ?? []).map((value, index) =>
          Math.clamp(Number(data[`die${index}`] ?? value), 1, 20)
        );
        if (Array.isArray(updated.results)) updated.results = [...updated.rawResults];
        updated.rolledResults = [...updated.rawResults];
        updated.isOpen = data.isOpen === "true";
        updated.baseStat = Number(data.baseStat ?? updated.baseStat ?? 0);
        updated.baseSkill = Number(data.baseSkill ?? updated.baseSkill ?? 0);
        updated.attributeBonus = Number(data.attributeBonus ?? 0);
        updated.skillBonus = Number(data.skillBonus ?? 0);
        updated.stat = updated.baseStat + updated.attributeBonus;
        updated.skill = updated.baseSkill + updated.skillBonus;
        if (updated.isWeapon) {
          updated.isCombat = true;
          updated.isDefending = updated.isMelee && updated.meleeAction === "defense";
        }
        updated.penalties = {
          ...(updated.penalties ?? {}),
          mod: Number(data.penaltyMod ?? 0),
          wounds: Number(data.penaltyWounds ?? 0),
          armor: Number(data.penaltyArmor ?? 0),
          disease: Number(data.penaltyDisease ?? 0),
          base: Number(NEUROSHIMA.difficulties[data.difficultyKey]?.min ?? 0)
        };
        updated.penalty = updated.totalPenalty = Object.values(updated.penalties)
          .reduce((sum, value) => sum + (Number(value) || 0), 0);
        updated.baseDifficulty = foundry.utils.deepClone(
          TestRules.difficultyFromPenalty(updated.totalPenalty)
        );
        updated.baseDifficultyLabel = updated.baseDifficulty.label;
        if (!updated.annotations?.includes("Rzut edytowany przez MG")) {
          (updated.annotations ??= []).push("Rzut edytowany przez MG");
        }
        const editedActor = game.actors.get(updated.actorId);
        const editedItem = editedActor?.items.get(updated.weaponId ?? updated.itemId);
        const test = await NeuroshimaTestFactory.fromData({
          ...serialized,
          actor: editedActor,
          item: editedItem ?? null,
          rollData: updated
        });
        test._scriptRunner = NeuroshimaScriptRunner;
        test.context.edited = true;
        test.context.isOpen = updated.isOpen;
        test.markDirty("gm-roll-edit");
        await test.recalculate();
        await test.finish({ commit: false });
        Object.assign(updated, test.result.data);

        const snapshot = rollData => ({
          rawResults: rollData.rawResults,
          baseStat: rollData.baseStat,
          baseSkill: rollData.baseSkill,
          attributeBonus: rollData.attributeBonus,
          skillBonus: rollData.skillBonus,
          penalties: rollData.penalties,
          baseDifficulty: rollData.baseDifficulty,
          isOpen: rollData.isOpen
        });
        const history = foundry.utils.deepClone(
          message.getFlag("neuroshima", "rollEditHistory") ?? []
        );
        history.push({
          userId: game.user.id,
          timestamp: Date.now(),
          before: snapshot(beforeData),
          after: snapshot(updated)
        });
        await message.update({ "flags.neuroshima.rollEditHistory": history });
        await test.updateMessage(message);
    }

}
