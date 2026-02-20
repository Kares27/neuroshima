/**
 * Dialog for loading ammunition into a magazine.
 */
export class AmmunitionLoadingDialog {
  /**
   * Show the dialog and wait for the result.
   * @param {Object} ammo - The ammunition item being loaded
   * @param {Object} magazine - The magazine item being loaded into
   * @returns {Promise<number|null>} - The number of bullets to load, or null if cancelled
   */
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
