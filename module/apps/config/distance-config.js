const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export const DEFAULT_DISTANCE_PENALTIES = {
  rows: [
    { distance: 10,   P: 0,   PM: 0,   K: 0,   S: 0,   SR: 30   },
    { distance: 20,   P: 20,  PM: 10,  K: 0,   S: 0,   SR: 0    },
    { distance: 30,   P: 40,  PM: 20,  K: 10,  S: 10,  SR: 30   },
    { distance: 40,   P: 80,  PM: 30,  K: 10,  S: 10,  SR: null },
    { distance: 60,   P: 120, PM: 40,  K: 20,  S: 20,  SR: null },
    { distance: 80,   P: 160, PM: 60,  K: 20,  S: 20,  SR: null },
    { distance: 100,  P: null, PM: 80,  K: 30,  S: 30,  SR: null },
    { distance: 150,  P: null, PM: 120, K: 40,  S: 30,  SR: null },
    { distance: 200,  P: null, PM: 160, K: 60,  S: 40,  SR: null },
    { distance: 250,  P: null, PM: null, K: 80,  S: 40,  SR: null },
    { distance: 300,  P: null, PM: null, K: 120, S: 60,  SR: null },
    { distance: 400,  P: null, PM: null, K: 160, S: 80,  SR: null },
    { distance: 600,  P: null, PM: null, K: null, S: 100, SR: null },
    { distance: 1000, P: null, PM: null, K: null, S: 120, SR: null },
    { distance: 1500, P: null, PM: null, K: null, S: 160, SR: null }
  ]
};

export const RANGED_SUBTYPE_TO_COL = {
  pistols:          "P",
  submachineRifles: "PM",
  rifles:           "K",
  sniperRifles:     "S",
  shotguns:         "SR"
};

/**
 * Returns the distance penalty (as a positive number or null) for the given
 * ranged weapon subtype and distance in meters.
 * Positive values increase difficulty. null means out of range.
 */
export function getDistancePenalty(rangedSubtype, distanceM) {
  const col = RANGED_SUBTYPE_TO_COL[rangedSubtype] ?? "P";
  const setting = game.settings.get("neuroshima", "distancePenalties");
  const rows = [...(setting?.rows ?? DEFAULT_DISTANCE_PENALTIES.rows)]
    .sort((a, b) => a.distance - b.distance);

  let lastKnown = null;
  for (const row of rows) {
    const rowVal = row[col];
    const isDefined = rowVal !== null && rowVal !== undefined && rowVal !== "";
    if (isDefined) lastKnown = Number(rowVal);

    if (distanceM <= row.distance) {
      return isDefined ? Number(rowVal) : lastKnown;
    }
  }
  return lastKnown;
}

/**
 * Settings menu application for configuring range distance penalties.
 */
export class DistanceConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @inheritdoc */
  static DEFAULT_OPTIONS = {
    id: "distance-config",
    tag: "form",
    classes: ["neuroshima", "distance-config"],
    window: {
      title: "NEUROSHIMA.Settings.DistanceConfig.Title",
      resizable: true
    },
    position: {
      width: 640,
      height: "auto"
    },
    form: {
      handler: async function(event, form, formData) {
        await this._onSubmit(event, form, formData);
      },
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  /** @inheritdoc */
  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/apps/distance-config.hbs"
    }
  };

  /** @inheritdoc */
  async _prepareContext(options) {
    const setting = game.settings.get("neuroshima", "distancePenalties");
    const rows = (setting?.rows ?? DEFAULT_DISTANCE_PENALTIES.rows).map(r => ({
      distance: r.distance,
      P:  r.P  ?? "",
      PM: r.PM ?? "",
      K:  r.K  ?? "",
      S:  r.S  ?? "",
      SR: r.SR ?? ""
    }));
    return { rows };
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    html.querySelector("[data-action='addRow']")?.addEventListener("click", () => {
      const tbody = html.querySelector(".distance-table tbody");
      const idx = tbody.querySelectorAll("tr").length;
      const tr = document.createElement("tr");
      tr.dataset.rowIndex = idx;
      tr.innerHTML = `
        <td class="distance-col-cell"><input type="number" name="distance_${idx}" value="" min="0" step="1" class="distance-input"></td>
        <td><input type="number" name="P_${idx}" value="" step="1" min="0" class="penalty-input" placeholder="—"></td>
        <td><input type="number" name="PM_${idx}" value="" step="1" min="0" class="penalty-input" placeholder="—"></td>
        <td><input type="number" name="K_${idx}" value="" step="1" min="0" class="penalty-input" placeholder="—"></td>
        <td><input type="number" name="S_${idx}" value="" step="1" min="0" class="penalty-input" placeholder="—"></td>
        <td><input type="number" name="SR_${idx}" value="" step="1" min="0" class="penalty-input" placeholder="—"></td>
        <td><a class="delete-row" title="${game.i18n.localize('DOCUMENT.Delete')}"><i class="fas fa-trash"></i></a></td>
      `;
      tr.querySelector(".delete-row").addEventListener("click", () => tr.remove());
      tbody.appendChild(tr);
    });

    html.querySelectorAll(".delete-row").forEach(btn => {
      btn.addEventListener("click", () => btn.closest("tr").remove());
    });
  }

  async _onSubmit(event, form, formData) {
    const html = this.element;
    const rows = [];
    html.querySelectorAll(".distance-table tbody tr").forEach(tr => {
      const get = name => {
        const input = tr.querySelector(`input[name^="${name}_"]`);
        return input ? (input.value === "" ? null : Number(input.value)) : null;
      };
      const distance = get("distance");
      if (distance === null || isNaN(distance)) return;
      rows.push({
        distance,
        P:  get("P"),
        PM: get("PM"),
        K:  get("K"),
        S:  get("S"),
        SR: get("SR")
      });
    });
    rows.sort((a, b) => a.distance - b.distance);

    await game.settings.set("neuroshima", "distancePenalties", { rows });
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.Settings.DistanceConfig.Saved"));
  }
}
