
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Searchable single-choice dialog used by effect scripts and routed choices.
 *
 * Besides the required `value` and `label`, each row may provide `description`,
 * `img`, `tooltipHtml`, and plain-object `rollData`. Tooltip HTML is enriched
 * once per dialog, with item roll data at `@...` and Actor data at `@actor...`.
 */
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
    this._actor      = options.actor   ?? null;
    this._selectedIdx = 0;
    this._preparedItemsPromise = null;
    this._resolve    = null;
  }

  get title() {
    return this._titleText || game.i18n.localize("NEUROSHIMA.Dialog.Choose");
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.prompt = this._prompt;
    const preparedItems = await this._prepareItems();
    ctx.items = preparedItems.map((item, idx) => ({
      ...item,
      isSelected: idx === this._selectedIdx
    }));
    return ctx;
  }

  _prepareItems() {
    // Cache enrichment: rendering after a selection/search must not evaluate
    // inline rolls in tooltipHtml for a second time.
    this._preparedItemsPromise ??= Promise.all(this._items.map(async item => {
      if (!item.tooltipHtml) return { ...item };

      const actorRollData = this._actor?.getRollData() ?? {};
      const itemRollData = item.rollData?.constructor === Object
        ? foundry.utils.deepClone(item.rollData)
        : {};
      const description = await foundry.applications.ux.TextEditor.enrichHTML(String(item.tooltipHtml), {
        async: true,
        secrets: this._actor?.isOwner ?? game.user.isGM,
        rollData: {
          ...itemRollData,
          actor: actorRollData
        },
        ...(this._actor ? { relativeTo: this._actor } : {})
      });

      const safeLabel = foundry.utils.escapeHTML(String(item.label ?? ""));
      const safeImg = item.img ? foundry.utils.escapeHTML(String(item.img)) : "";
      const imageHtml = safeImg ? `<img src="${safeImg}" alt="">` : "";
      const headerClass = safeImg ? "trait-choice-tooltip-header" : "trait-choice-tooltip-header without-image";

      return {
        ...item,
        tooltipHtml: `
          <article class="trait-choice-tooltip">
            <header class="${headerClass}">
              ${imageHtml}
              <strong>${safeLabel}</strong>
            </header>
            <div class="trait-choice-tooltip-description">${description}</div>
          </article>`
      };
    }));
    return this._preparedItemsPromise;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const searchInput = this.element?.querySelector("[data-list-choice-search]");
    searchInput?.addEventListener("input", () => this._applySearch(searchInput.value));
    this._applySearch(searchInput?.value ?? "");
  }

  _applySearch(value) {
    const query = String(value ?? "").trim().toLocaleLowerCase(game.i18n.lang);
    const rows = Array.from(this.element?.querySelectorAll(".list-choice-row") ?? []);
    const visibleIndexes = [];

    for (const row of rows) {
      const idx = Number.parseInt(row.dataset.itemIdx ?? "-1", 10);
      const item = this._items[idx];
      const searchable = `${item?.label ?? ""} ${item?.description ?? ""}`.toLocaleLowerCase(game.i18n.lang);
      const visible = !query || searchable.includes(query);
      row.hidden = !visible;
      if (visible) visibleIndexes.push(idx);
    }

    if (!visibleIndexes.includes(this._selectedIdx)) {
      this._selectedIdx = visibleIndexes[0] ?? -1;
    }
    this._syncSelection(rows);

    const emptyState = this.element?.querySelector("[data-list-choice-empty]");
    if (emptyState) emptyState.hidden = visibleIndexes.length > 0;
    const confirm = this.element?.querySelector('[data-action="confirmItem"]');
    if (confirm) confirm.disabled = visibleIndexes.length === 0;
  }

  _syncSelection(rows = this.element?.querySelectorAll(".list-choice-row") ?? []) {
    rows.forEach(row => {
      const idx = Number.parseInt(row.dataset.itemIdx ?? "-1", 10);
      const selected = !row.hidden && idx === this._selectedIdx;
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-checked", String(selected));
      row.querySelector(".list-choice-cb")?.classList.toggle("checked", selected);
    });
  }

  async _onSelectItem(event, target) {
    const row = target.closest("[data-item-idx]");
    if (!row) return;
    this._selectedIdx = parseInt(row.dataset.itemIdx ?? "0");

    this._syncSelection();
  }

  async _onConfirmItem() {
    const selectedRow = this.element?.querySelector(`[data-item-idx="${this._selectedIdx}"]`);
    if (this._selectedIdx < 0 || !selectedRow || selectedRow.hidden) return;
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
   * @param {Array<{
   *   value: string,
   *   label: string,
   *   description?: string,
   *   img?: string,
   *   tooltipHtml?: string,
   *   rollData?: object
   * }>} items
   *   List of choices.  Each entry must have `value` (returned on confirm) and `label`
   *   (shown in the row). Optional `description` appears as a subtitle, `img` as a
   *   decorative thumbnail, and `tooltipHtml` as richer details on hover. Optional
   *   plain `rollData` is merged into the tooltip enrichment context.
   * @param {string} [prompt]   Explanatory text shown above the list.
   * @param {string} [title]    Window title.
   * @param {Actor|null} [actor] Actor whose roll data is available as `@actor`
   *   while enriching tooltip inline rolls.
   * @returns {Promise<string|null>}  The selected `value`, or `null` if cancelled.
   */
  static async wait(items, prompt = "", title = "", actor = null) {
    return new Promise(resolve => {
      const dialog = new ListChoiceDialog({ items, prompt, title, actor });
      dialog._resolve = resolve;
      dialog.render(true);
    });
  }
}
