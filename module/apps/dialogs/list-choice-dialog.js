
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class ListChoiceDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["neuroshima", "list-choice-dialog"],
    position: { width: 480, height: "auto" },
    window: {
      resizable: false,
      minimizable: false
    },
    actions: {
      selectItem:  ListChoiceDialog.prototype._onSelectItem,
      confirmItem: ListChoiceDialog.prototype._onConfirmItem,
      cancelItem:  ListChoiceDialog.prototype._onCancelItem
    }
  };

  static PARTS = {
    main: {
      template: "systems/neuroshima/templates/apps/list-choice-dialog.hbs"
    }
  };

  constructor(options = {}) {
    super(options);
    this._items      = options.items   ?? [];
    this._prompt     = options.prompt  ?? "";
    this._titleText  = options.title   ?? "";
    this._selectedIdx = 0;
    this._resolve    = null;
  }

  get title() {
    return this._titleText || game.i18n.localize("NEUROSHIMA.Dialog.Choose");
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.prompt = this._prompt;
    ctx.items = this._items.map((item, idx) => ({
      ...item,
      isSelected: idx === this._selectedIdx
    }));
    return ctx;
  }

  async _onSelectItem(event, target) {
    const row = target.closest("[data-item-idx]");
    if (!row) return;
    this._selectedIdx = parseInt(row.dataset.itemIdx ?? "0");

    const rows = this.element.querySelectorAll(".list-choice-row");
    rows.forEach((r, i) => {
      const sel = i === this._selectedIdx;
      r.classList.toggle("selected", sel);
      r.querySelector(".list-choice-cb")?.classList.toggle("checked", sel);
    });
  }

  async _onConfirmItem() {
    const item = this._items[this._selectedIdx];
    if (this._resolve) {
      this._resolve(item?.value ?? null);
      this._resolve = null;
    }
    this.close();
  }

  async _onCancelItem() {
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
    }
    this.close();
  }

  async close(options = {}) {
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
    }
    return super.close(options);
  }

  /**
   * Show a list-choice dialog and wait for the user to pick one item.
   *
   * @param {Array<{value: string, label: string, description?: string}>} items
   *   List of choices.  Each entry must have `value` (returned on confirm) and `label`
   *   (shown in the row).  Optional `description` appears as a subtitle below the label.
   * @param {string} [prompt]   Explanatory text shown above the list.
   * @param {string} [title]    Window title.
   * @returns {Promise<string|null>}  The selected `value`, or `null` if cancelled.
   */
  static async wait(items, prompt = "", title = "") {
    return new Promise(resolve => {
      const dialog = new ListChoiceDialog({ items, prompt, title });
      dialog._resolve = resolve;
      dialog.render(true);
    });
  }
}
