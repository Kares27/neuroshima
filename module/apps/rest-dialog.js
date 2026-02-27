/**
 * Dialog for configuring rest and daily healing.
 */
export class RestDialog {
  /**
   * Show the dialog and wait for the result.
   * @returns {Promise<Object|null>} - The rest configuration, or null if cancelled
   */
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
