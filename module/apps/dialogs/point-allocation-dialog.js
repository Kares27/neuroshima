const {
  HandlebarsApplicationMixin,
  ApplicationV2
} = foundry.applications.api;

export class PointAllocationDialog
  extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    tag: "div",

    classes: [
      "neuroshima",
      "point-allocation-dialog"
    ],

    position: {
      width: 640,
      height: "auto"
    },

    window: {
      resizable: false,
      minimizable: false
    },

    actions: {
      increase: PointAllocationDialog.prototype._onIncrease,
      decrease: PointAllocationDialog.prototype._onDecrease,
      confirm: PointAllocationDialog.prototype._onConfirm,
      cancel: PointAllocationDialog.prototype._onCancel
    }
  };

  static PARTS = {
        main: {
            template:
            "systems/neuroshima/templates/apps/point-allocation-dialog.hbs",

            scrollable: [
            ".point-allocation-list"
            ]
        }
    };

  constructor(options = {}) {
    super(options);

    this._titleText = options.title ?? "";
    this._prompt =  options.prompt ?? "";
    this._summary =  options.summary ?? "";
    this._hint = options.hint ?? "";
    this._pool = Math.max( 0, Math.floor( Number(options.pool) || 0 ));
    this._step = Math.max(  1, Math.floor( Number(options.step) || 1 ));
    this._requireExact = options.requireExact ?? true;
    this._showCurrent = options.showCurrent ?? true;

    this._showResult = options.showResult ?? true;

    this._showMaximum = options.showMaximum ?? true;

    this._validate = typeof options.validate === "function" ? options.validate : null;

    this._labels = { remaining:
        "Pozostało",

      current:
        "Aktualnie",

      result:
        "Po premii",

      maximum:
        "Dostępny limit",

      increase:
        "Dodaj punkt",

      decrease:
        "Odejmij punkt",

      confirm:
        "Zatwierdź",

      cancel:
        "Anuluj",

      ...(options.labels ?? {})
    };

    this._rows = [];

    for (const sourceRow of options.rows ?? []) {
      const min = Number.isFinite(
        Number(sourceRow.min)
      )
        ? Number(sourceRow.min)
        : 0;

      const max = Number.isFinite(
        Number(sourceRow.max)
      )
        ? Math.max(
            min,
            Number(sourceRow.max)
          )
        : this._pool;

      const initial = Math.clamp(
        Number(sourceRow.initial) || 0,
        min,
        max
      );

      this._rows.push({
        key:
          String(sourceRow.key),

        label:
          String(
            sourceRow.label
            ?? sourceRow.key
          ),

        description:
          String(
            sourceRow.description ?? ""
          ),

        current:
          Number(sourceRow.current) || 0,

        min,
        max,

        value:
          initial
      });
    }

    this._resolve = null;
  }

  get title() {
    return this._titleText;
  }

  get spent() {
    return this._rows.reduce(
      (sum, row) =>
        sum + Number(row.value || 0),
      0
    );
  }

  get remaining() {
    return Math.max(
      0,
      this._pool - this.spent
    );
  }

  get canConfirm() {
    if (!this._requireExact) {
      return true;
    }

    return this.remaining === 0;
  }

  async _prepareContext(options) {
    const context =
      await super._prepareContext(options);

    context.prompt =
      this._prompt;

    context.summary =
      this._summary;

    context.hint =
      this._hint;

    context.labels =
      this._labels;

    context.pool =
      this._pool;

    context.spent =
      this.spent;

    context.remaining =
      this.remaining;

    context.canConfirm =
      this.canConfirm;

    context.showCurrent =
      this._showCurrent;

    context.showResult =
      this._showResult;

    context.showMaximum =
      this._showMaximum;

    context.rows = this._rows.map(row => {
      /*
       * Dynamiczne maksimum uwzględnia:
       *
       * 1. maksymalną wartość danego wiersza,
       * 2. punkty już przyznane,
       * 3. punkty pozostałe w puli.
       */
      const dynamicMax = Math.min(
        row.max,
        row.value + this.remaining
      );

      return {
        ...row,

        result:
          row.current + row.value,

        dynamicMax,

        canDecrease:
          row.value - this._step >= row.min,

        canIncrease:
          this.remaining >= this._step
          && row.value + this._step <= row.max
      };
    });

    return context;
  }

  _getRow(target) {
    const rowElement =
      target.closest("[data-row-key]");

    const rowKey =
      rowElement?.dataset.rowKey;

    if (!rowKey) {
      return null;
    }

    return this._rows.find(
      row => row.key === rowKey
    ) ?? null;
  }

  async _onIncrease(event, target) {
    const row =
      this._getRow(target);

    if (!row) {
      return;
    }

    const maximumIncrease = Math.min(
      this._step,
      this.remaining,
      row.max - row.value
    );

    if (maximumIncrease <= 0) {
      return;
    }

    row.value += maximumIncrease;

    this.render({
      parts: ["main"]
    });
  }

  async _onDecrease(event, target) {
    const row =
      this._getRow(target);

    if (!row) {
      return;
    }

    const maximumDecrease = Math.min(
      this._step,
      row.value - row.min
    );

    if (maximumDecrease <= 0) {
      return;
    }

    row.value -= maximumDecrease;

    this.render({
      parts: ["main"]
    });
  }

  _buildResult() {
    return Object.fromEntries(
      this._rows.map(row => [
        row.key,
        row.value
      ])
    );
  }

  async _onConfirm() {
    if (!this.canConfirm) {
      ui.notifications.warn(
        `Pozostało jeszcze ${this.remaining} punktów do rozdania.`
      );

      return;
    }

    const result =
      this._buildResult();

    if (this._validate) {
      const validationResult =
        await this._validate(
          result,
          this._rows
        );

      /*
       * Funkcja walidacyjna może zwrócić komunikat.
       */
      if (
        typeof validationResult === "string"
        && validationResult.length > 0
      ) {
        ui.notifications.warn(
          validationResult
        );

        return;
      }

      if (validationResult === false) {
        return;
      }
    }

    const resolve =
      this._resolve;

    this._resolve = null;

    resolve?.(result);

    await this.close();
  }

  async _onCancel() {
    const resolve =
      this._resolve;

    this._resolve = null;

    resolve?.(null);

    await this.close();
  }

  async close(options = {}) {
    if (this._resolve) {
      const resolve =
        this._resolve;

      this._resolve = null;

      resolve(null);
    }

    return super.close(options);
  }

  static async wait(options = {}) {
    return new Promise(resolve => {
      const dialog =
        new PointAllocationDialog(options);

      dialog._resolve =
        resolve;

      dialog.render(true);
    });
  }
}