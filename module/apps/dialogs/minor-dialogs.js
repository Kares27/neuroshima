const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { NEUROSHIMA } from "../../config.js";

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
    constructor(message, test, options={}) {
        super(options);
        this.message = message;
        this.test = test;
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
        const flags = foundry.utils.deepClone(this.test.result);
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
        flags.baseDifficulty ??= foundry.utils.deepClone(
          NEUROSHIMA.difficulties[difficultyKey] ?? NEUROSHIMA.difficulties.average
        );
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
        const rawResults = (this.test.result.rawResults ?? []).map((value, index) =>
          Math.clamp(Number(data[`die${index}`] ?? value), 1, 20)
        );
        await this.test.edit({
          rawResults,
          preData: {
            stat: Number(data.baseStat ?? 0),
            skill: Number(data.baseSkill ?? 0),
            attributeBonus: Number(data.attributeBonus ?? 0),
            skillBonus: Number(data.skillBonus ?? 0),
            isOpen: data.isOpen === "true",
            penalties: {
              base: Number(NEUROSHIMA.difficulties[data.difficultyKey]?.min ?? 0),
              mod: Number(data.penaltyMod ?? 0),
              wounds: Number(data.penaltyWounds ?? 0),
              armor: Number(data.penaltyArmor ?? 0),
              disease: Number(data.penaltyDisease ?? 0)
            },
            annotations: [
              ...(this.test.preData.annotations ?? []),
              "Rzut edytowany przez MG"
            ]
          }
        }, { message: this.message });
    }

}
