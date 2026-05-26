const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { NeuroshimaDice } from "../../helpers/dice.js";

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
            title: "NEUROSHIMA | Edit Roll",
            resizable: false
        },
        position: {
            width: 350,
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
        const flags = this.message.getFlag("neuroshima", "rollData");
        return {
            rollData: flags
        };
    }

    static async #onSubmit(event, form, formData) {
        const data = formData.object;
        const message = this.message;
        const isOpen = data.isOpen === "true";
        
        await NeuroshimaDice.updateRollMessage(message, isOpen);
    }
}
