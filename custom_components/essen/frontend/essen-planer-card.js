/* eslint-disable */
// Essen Planer Card – erweitert: Tabs in Plan-Ansicht für Mittag/Abend/Reste
// Fixes:
//  - Dish-Picker wieder als echtes Overlay (z-index / fixed / inset)
//  - "Reste von Tag" mit Dropdown-Dialog (keine prompt Freitext-Eingabe)
//  - Dropdown in Reste-Tab robuster (kein Clip/Overflow)

class EssenPlanerCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this.mode = this.config.mode || "plan";
    this._draft = this._draft || {};

    this._draft.planTab = this._draft.planTab || "mittag";

    // reste
    this._draft.resteLoaded = this._draft.resteLoaded || false;
    this._draft.resteLoading = this._draft.resteLoading || false;
    this._draft.reste = this._draft.reste || [];

    // reste-from-day dialog
    this._draft.resteDialogOpen = this._draft.resteDialogOpen || false;
    this._draft.resteDialogDish = this._draft.resteDialogDish || "";
    this._draft.resteDialogPort = this._draft.resteDialogPort || "1";
    this._draft.resteDialogOrt = this._draft.resteDialogOrt || "Kühlschrank";

    this._boundLocationHandler = this._boundLocationHandler || (() => this._handleLocationChange());
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
  }

  connectedCallback() {
    this.mode = this.mode || "plan";
    this._draft = this._draft || {};
    this._draft.planTab = this._draft.planTab || "mittag";
    this._boundLocationHandler = this._boundLocationHandler || (() => this._handleLocationChange());
    window.addEventListener("location-changed", this._boundLocationHandler);
    window.addEventListener("popstate", this._boundLocationHandler);
    this._lastLocationPath = window.location.pathname;
    this._handleCurrentLocation();
  }

  disconnectedCallback() {
    window.removeEventListener("location-changed", this._boundLocationHandler);
    window.removeEventListener("popstate", this._boundLocationHandler);
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureDraftDefaults();
    const focusedRole = this._focusedRole();
    if (focusedRole) {
      if (focusedRole === "edit-search") this._refreshEditList();
      if (focusedRole === "day-picker-search") this._refreshDayPickerList();
      return;
    }
    if (this.mode === "plan" && !this._draft.resteLoaded && !this._draft.resteLoading) {
      this._loadResteFallback();
    }
    this._render();
  }

  _handleLocationChange() {
    const path = window.location.pathname;
    const previousPath = this._lastLocationPath;
    this._lastLocationPath = path;
    if (path === previousPath) return;
    this._handleCurrentLocation();
  }

  _handleCurrentLocation() {
    this._resetPlanWhenEntering();
    this._refreshDishesWhenEnteringEdit();
  }

  _resetPlanWhenEntering() {
    if (this.mode !== "plan" || !this._currentPathMatches("essen")) return;
    const before = this._selectedPlanPeriod();
    this._selectCurrentWeek();
    const after = this._selectedPlanPeriod();
    if (this._hass && (before.year !== after.year || before.week !== after.week)) {
      this._render();
    }
  }

  async _refreshDishesWhenEnteringEdit() {
    if (this.mode !== "edit" || !this._currentPathMatches("essen-bearbeiten")) return;
    const shared = this._readSharedDishes();
    if (shared.revision > Number(this._draft.sharedDishesRevision || 0)) {
      this._draft.fallbackDishes = shared.dishes;
      this._draft.fallbackDishesLoaded = true;
      this._draft.sharedDishesRevision = shared.revision;
      if (this._hass) this._render();
    }
    const refreshed = await this._refreshDishesNow();
    if (refreshed && this._hass && this._currentPathMatches("essen-bearbeiten")) {
      this._render();
    }
  }

  getCardSize() {
    return this.mode === "plan" ? 8 : 7;
  }

  _ensureDraftDefaults() {
    const current = this._currentIsoWeek();
    if (this._draft.planYear == null) this._draft.planYear = current.year;
    if (this._draft.planWeek == null) this._draft.planWeek = current.week;
    if (this._draft.newClass == null) this._draft.newClass = 1;
    if (this._draft.editClass == null) this._draft.editClass = 1;
    if (this._draft.editSearch == null) this._draft.editSearch = "";
    if (this._draft.planTab == null) this._draft.planTab = "mittag";
  }

  _sensorPlanAttrs() {
    const sensorEntity = this._hass && this._hass.states && this._hass.states["sensor.essen_wochenplan"];
    return sensorEntity && sensorEntity.attributes ? sensorEntity.attributes : {};
  }

  _planAttrs() {
    const sensor = this._sensorPlanAttrs();
    if (!this._draft.fallbackPlansLoading && !this._draft.fallbackPlansLoaded) {
      this._loadPlansFallback();
    }
    const period = this._selectedPlanPeriod();
    const fallbackPlan = this._planForPeriod(period.year, period.week);
    const sensorPlan =
      Number(sensor.year) === Number(period.year) &&
      Number(sensor.week) === Number(period.week) &&
      Array.isArray(sensor.days)
        ? sensor
        : null;
    const plan = fallbackPlan || sensorPlan;
    if (!plan) {
      const blankPlan = this._blankPlan(period.year, period.week);
      return {
        ...sensor,
        ...blankPlan,
        has_plan: false,
        state: `KW ${blankPlan.week} / ${blankPlan.year}: kein Plan`,
      };
    }
    const filled = (plan.days || []).filter((day) => day.dish_name).length;
    return {
      ...sensor,
      label: `KW ${plan.week} / ${plan.year}`,
      year: plan.year,
      week: plan.week,
      key: plan.key,
      days: plan.days || [],
      abendessen: Array.isArray(plan.abendessen) ? plan.abendessen : [],
      has_plan: true,
      state: `KW ${plan.week} / ${plan.year}: ${filled}/7`,
    };
  }

  _dishesAttrs() {
    const sensorEntity = this._hass && this._hass.states && this._hass.states["sensor.essen_gerichte"];
    return sensorEntity && sensorEntity.attributes ? sensorEntity.attributes : {};
  }

  _activeDishes() {
    const sensorDishes = this._dishesAttrs().active_dishes || [];
    const shared = this._readSharedDishes();
    if (shared.revision > Number(this._draft.sharedDishesRevision || 0)) {
      this._draft.fallbackDishes = shared.dishes;
      this._draft.fallbackDishesLoaded = true;
      this._draft.sharedDishesRevision = shared.revision;
    }
    if (!this._draft.fallbackDishesLoading && !this._draft.fallbackDishesLoaded) {
      this._loadDishesFallback();
    }
    const hasFallbackDishes = Array.isArray(this._draft.fallbackDishes);
    const hasSharedDishes = shared.revision > 0 || shared.dishes.length > 0;
    const fallbackDishes = Array.isArray(this._draft.fallbackDishes) ? this._draft.fallbackDishes : [];
    const source = hasFallbackDishes ? fallbackDishes : hasSharedDishes ? shared.dishes : sensorDishes;
    return [...source].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "de")
    );
  }

  async _loadDishesFallback() {
    this._draft.fallbackDishesLoading = true;
    try {
      this._draft.fallbackDishes = await this._fetchDishesFallback();
      this._writeSharedDishes(this._draft.fallbackDishes);
      this._draft.fallbackDishesLoaded = true;
      this._refreshAfterDataLoad();
    } catch (error) {
      this._draft.fallbackDishesLoaded = true;
    } finally {
      this._draft.fallbackDishesLoading = false;
    }
  }

  async _refreshDishesNow() {
    this._draft.fallbackDishesLoading = true;
    try {
      this._draft.fallbackDishes = await this._fetchDishesFallback();
      this._writeSharedDishes(this._draft.fallbackDishes);
      this._draft.fallbackDishesLoaded = true;
      return true;
    } catch (error) {
      this._draft.fallbackDishesLoaded = true;
      return false;
    } finally {
      this._draft.fallbackDishesLoading = false;
    }
  }

  _upsertLocalDish(dish) {
    const dishes = Array.isArray(this._draft.fallbackDishes) ? [...this._draft.fallbackDishes] : [...this._activeDishes()];
    const index = dishes.findIndex((entry) => Number(entry.id) === Number(dish.id));
    if (index >= 0) {
      dishes[index] = { ...dishes[index], ...dish };
    } else {
      dishes.push(dish);
    }
    this._draft.fallbackDishes = dishes.filter((entry) => entry.active !== false);
    this._draft.fallbackDishesLoaded = true;
    this._writeSharedDishes(this._draft.fallbackDishes);
  }

  _removeLocalDish(dishId) {
    const dishes = Array.isArray(this._draft.fallbackDishes) ? this._draft.fallbackDishes : this._activeDishes();
    this._draft.fallbackDishes = dishes.filter((dish) => Number(dish.id) !== Number(dishId));
    this._draft.fallbackDishesLoaded = true;
    this._writeSharedDishes(this._draft.fallbackDishes);
  }

  _dishNameExists(name, ignoreId = null) {
    const wanted = this._searchText(name);
    return this._activeDishes().some((dish) =>
      Number(dish.id) !== Number(ignoreId) && this._searchText(dish.name) === wanted
    );
  }

  async _loadPlansFallback() {
    this._draft.fallbackPlansLoading = true;
    try {
      const response = await fetch(`/local/essen-wochenplaene.json?v=${Date.now()}`, {
        cache: "no-store",
      });
      this._draft.fallbackPlans = await response.json();
      this._draft.fallbackPlansLoaded = true;
      this._refreshAfterDataLoad();
    } catch (error) {
      this._draft.fallbackPlansLoaded = true;
    } finally {
      this._draft.fallbackPlansLoading = false;
    }
  }

  async _loadResteFallback() {
    this._draft.resteLoading = true;
    try {
      const response = await fetch(`/local/essen-reste.json?v=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      this._draft.reste = Array.isArray(data) ? data : (data && Array.isArray(data.reste) ? data.reste : []);
    } catch (e) {
      this._draft.reste = [];
    } finally {
      this._draft.resteLoaded = true;
      this._draft.resteLoading = false;
      this._render();
    }
  }

  _currentIsoWeek() {
    return this._isoWeekFromDate(new Date());
  }

  _isoWeekFromDate(sourceDate) {
    const date = new Date(Date.UTC(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return { year: date.getUTCFullYear(), week };
  }

  _planKey(year, week) {
    return `${Number(year)}-W${String(Number(week)).padStart(2, "0")}`;
  }

  _planForPeriod(year, week) {
    const plans = (this._draft.fallbackPlans && this._draft.fallbackPlans.plans) || {};
    return plans[this._planKey(year, week)] || null;
  }

  _blankPlan(year, week) {
    const monday = this._mondayForIsoWeek(year, week);
    const dayDefs = [
      ["montag", "Montag", 0],
      ["dienstag", "Dienstag", 1],
      ["mittwoch", "Mittwoch", 2],
      ["donnerstag", "Donnerstag", 3],
      ["freitag", "Freitag", 4],
      ["samstag", "Samstag", 5],
      ["sonntag", "Sonntag", 6],
    ];
    return {
      key: this._planKey(year, week),
      year: Number(year),
      week: Number(week),
      label: `KW ${Number(week)} / ${Number(year)}`,
      days: dayDefs.map(([key, name, offset]) => {
        const date = new Date(monday);
        date.setUTCDate(date.getUTCDate() + offset);
        return {
          key,
          name,
          date: date.toISOString().slice(0, 10),
          date_display: this._formatShortDate(date),
          dish_id: null,
          dish_name: "",
          klasse: null,
          custom: false,
        };
      }),
      abendessen: [],
    };
  }

  _mondayForIsoWeek(year, week) {
    const fourthOfJanuary = new Date(Date.UTC(Number(year), 0, 4));
    const day = fourthOfJanuary.getUTCDay() || 7;
    const monday = new Date(fourthOfJanuary);
    monday.setUTCDate(fourthOfJanuary.getUTCDate() - day + 1 + (Number(week) - 1) * 7);
    return monday;
  }

  _formatShortDate(date) {
    return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.`;
  }

  _selectedPlanPeriod() {
    const current = this._currentIsoWeek();
    return {
      year: Number(this._draft.planYear || current.year),
      week: Number(this._draft.planWeek || current.week),
    };
  }

  _selectedWeekLabel(plan) {
    const diffWeeks = this._selectedWeekOffset(plan);
    if (diffWeeks === 0) return "Diese Woche";
    if (diffWeeks === 1) return "Nächste Woche";
    if (diffWeeks === -1) return "Letzte Woche";
    return plan.label || `KW ${plan.week} / ${plan.year}`;
  }

  _selectedWeekOffset(plan = this._selectedPlanPeriod()) {
    const selected = this._mondayForIsoWeek(plan.year, plan.week);
    const current = this._mondayForIsoWeek(this._currentIsoWeek().year, this._currentIsoWeek().week);
    return Math.round((selected - current) / (7 * 86400000));
  }

  _render() {
    if (!this._hass) return;
    const renderState = this._captureRenderState();
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        ${this.mode === "new" ? this._newDishView() : ""}
        ${this.mode === "edit" ? this._editDishView() : ""}
        ${this.mode === "plan" ? this._planView() : ""}
      </ha-card>
    `;
    this._bindEvents();
    this._restoreRenderState(renderState);
  }

  _captureRenderState() {
    const editList = this.shadowRoot && this.shadowRoot.querySelector(".dish-list");
    return {
      editListScrollTop: editList ? editList.scrollTop : null,
    };
  }

  _restoreRenderState(state) {
    if (!state || state.editListScrollTop == null) return;
    const restore = () => {
      const editList = this.shadowRoot && this.shadowRoot.querySelector(".dish-list");
      if (editList) editList.scrollTop = state.editListScrollTop;
    };
    restore();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
  }

  _planTabs() {
    const tab = String(this._draft.planTab || "mittag");
    const btn = (id, label) => `<button class="plan-tab ${tab === id ? "active" : ""}" data-action="set-plan-tab" data-tab="${this._escape(id)}">${this._escape(label)}</button>`;
    return `<div class="plan-tabs">${btn("mittag", "Mittag")}${btn("abend", "Abend")}${btn("reste", "Reste")}</div>`;
  }

  _planView() {
    const plan = this._planAttrs();
    const days = plan.days || [];
    const current = this._currentIsoWeek();
    const hasPlan = Boolean(plan.has_plan);
    const selectedWeekLabel = this._selectedWeekLabel(plan);
    const weekOffset = this._selectedWeekOffset(plan);
    const tab = String(this._draft.planTab || "mittag");

    return `
      <div class="shell">
        ${this._sidebar("plan")}
        <section class="panel plan-panel">
          <div class="tab-label">Wochenplan</div>
          <div class="plan-head">
            <div class="kw-line">
              <span>Aktuelle Woche: <strong>KW ${current.week} / ${current.year}</strong></span>
              <span class="pipe">|</span>
              <button class="icon-button week-button" title="Vorige Woche" data-action="prev-week" ${weekOffset <= -1 ? "disabled" : ""}>
                <ha-icon icon="mdi:chevron-left"></ha-icon>
              </button>
              <strong class="selected-week">${this._escape(selectedWeekLabel)}</strong>
              <button class="icon-button week-button" title="Nächste Woche" data-action="next-week" ${weekOffset >= 1 ? "disabled" : ""}>
                <ha-icon icon="mdi:chevron-right"></ha-icon>
              </button>
              <button class="plain-button primary" data-action="create-plan">${hasPlan ? "Plan neu generieren" : "Plan generieren"}</button>
            </div>
            ${this._planTabs()}
          </div>

          ${
            hasPlan
              ? ""
              : `<div class="plan-notice">
                  Für ${this._escape(plan.label)} gibt es noch keinen Plan. Du kannst die Tage manuell füllen oder einen Plan generieren.
                </div>`
          }

          ${tab === "mittag" ? `
            <div class="days">
              ${
                days.length
                  ? days.map((day) => this._dayRow(day)).join("")
                  : `<div class="empty-plan">
                      <strong>Noch kein Plan angelegt.</strong>
                      <span>Wähle oben eine Woche aus und klicke auf „Plan generieren“.</span>
                    </div>`
              }
            </div>
            ${this._dishPickerOverlay()}
            ${this._resteFromDayOverlay()}
          ` : ""}

          ${tab === "abend" ? this._abendView(plan) : ""}
          ${tab === "reste" ? this._resteView() : ""}
        </section>
      </div>
    `;
  }

  _abendView(plan) {
    const pool = Array.isArray(plan.abendessen) ? plan.abendessen : [];
    return `
      <div class="subpanel">
        <div class="subhead">
          <strong>Abendessen (Pool)</strong>
          <span class="hint">Sammelliste für die Woche</span>
        </div>
        <div class="abend-add">
          <input class="text-input" data-role="abend-name" placeholder="Gerichtname…" value="${this._escape(this._draft.abendName || "")}">
          <button class="plain-button primary" data-action="abend-add">Hinzufügen</button>
        </div>
        <div class="abend-list">
          ${pool.length ? pool.map((name) => `
            <div class="abend-item">
              <span>${this._escape(name)}</span>
              <button class="icon-button danger" title="Entfernen" data-action="abend-remove" data-name="${this._escape(name)}">
                <ha-icon icon="mdi:close-thick"></ha-icon>
              </button>
            </div>
          `).join("") : `<div class="empty-list">Noch nichts eingeplant.</div>`}
        </div>
      </div>
    `;
  }

  _todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  _daysDiffIso(a, b) {
    const da = new Date(a + "T00:00:00");
    const db = new Date(b + "T00:00:00");
    return Math.round((db - da) / 86400000);
  }

  _resteBadge(entry) {
    const today = this._todayIso();
    const ablauf = String(entry.ablauf_datum || "");
    if (!ablauf) return { cls: "badge-neutral", text: "?" };
    const diff = this._daysDiffIso(today, ablauf);
    if (diff < 0) return { cls: "badge-bad", text: `abgelaufen` };
    if (diff === 0) return { cls: "badge-warn", text: `heute` };
    if (diff <= 2) return { cls: "badge-warn", text: `${diff}T` };
    if (diff <= 4) return { cls: "badge-ok", text: `${diff}T` };
    return { cls: "badge-good", text: `${diff}T` };
  }

  _resteView() {
    const reste = Array.isArray(this._draft.reste) ? this._draft.reste : [];
    const sorted = [...reste].sort((a, b) => String(a.ablauf_datum || "9999").localeCompare(String(b.ablauf_datum || "9999")));
    return `
      <div class="subpanel reste-subpanel">
        <div class="subhead">
          <strong>Reste (Inventur)</strong>
          <span class="hint">Einbuchen + Haltbarkeit</span>
        </div>

        <div class="reste-add">
          <input class="text-input" data-role="reste-name" placeholder="Gerichtname…" value="${this._escape(this._draft.resteName || "")}">
          <input class="text-input small" data-role="reste-port" placeholder="Port." value="${this._escape(this._draft.restePort || "")}">
          <select class="plan-select" data-role="reste-ort">
            <option value="Kühlschrank" ${String(this._draft.resteOrt || "Kühlschrank") === "Kühlschrank" ? "selected" : ""}>Kühlschrank</option>
            <option value="Eingefroren" ${String(this._draft.resteOrt || "") === "Eingefroren" ? "selected" : ""}>Gefrierschrank</option>
          </select>
          <button class="plain-button primary" data-action="reste-add">Einbuchen</button>
          <button class="plain-button" data-action="reste-refresh">Aktualisieren</button>
        </div>

        <div class="reste-list">
          ${sorted.length ? sorted.map((r) => {
            const badge = this._resteBadge(r);
            const ortLabel = String(r.ort || "");
            const ortPretty = ortLabel.toLowerCase().includes("eingefror") ? "Gefrierschrank" : ortLabel;
            return `
              <div class="reste-item">
                <span class="badge ${badge.cls}">${this._escape(badge.text)}</span>
                <div class="reste-text">
                  <strong>${this._escape(r.gericht || "")}</strong>
                  <div class="reste-meta">
                    <span>${this._escape(ortPretty || "")}</span>
                    ${r.portionen ? `<span>· ${this._escape(r.portionen)} Portion(en)</span>` : ""}
                    ${r.ablauf_datum ? `<span>· Ablauf ${this._escape(r.ablauf_datum)}</span>` : ""}
                  </div>
                </div>
                <button class="icon-button danger" title="Entfernen" data-action="reste-remove" data-id="${this._escape(r.id)}">
                  <ha-icon icon="mdi:close-thick"></ha-icon>
                </button>
              </div>
            `;
          }).join("") : `<div class="empty-list">Keine Reste eingetragen.</div>`}
        </div>
      </div>
    `;
  }

  _dayRow(day) {
    const draftValue = this._draft[`day-${day.key}`];
    const value = draftValue != null ? draftValue : day.dish_name || "";
    const hasDish = String(value || "").trim().length > 0;
    return `
      <div class="day-row">
        <div class="day-name">${this._escape(day.name)}</div>
        <div class="day-date">${this._escape(day.date_display || "")}</div>
        <input
          class="dish-input"
          data-role="day-input"
          data-day="${this._escape(day.key)}"
          value="${this._escape(value)}"
          placeholder="Gericht eintragen"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="none"
          spellcheck="false"
          enterkeyhint="done"
        >
        <button class="icon-button" title="Gericht aus Liste wählen" data-action="open-day-picker" data-day="${this._escape(day.key)}">
          <ha-icon icon="mdi:format-list-bulleted"></ha-icon>
        </button>
        <button class="icon-button" title="Diesen Tag neu würfeln" data-action="reroll-day" data-day="${this._escape(day.key)}">
          <ha-icon icon="mdi:sync"></ha-icon>
        </button>
        <button class="icon-button" title="Als Reste einbuchen" data-action="open-reste-dialog" data-dish="${this._escape(value)}" ${hasDish ? "" : "disabled"}>
          <ha-icon icon="mdi:food-variant"></ha-icon>
        </button>
        <button class="icon-button danger" title="Gericht löschen" data-action="clear-day" data-day="${this._escape(day.key)}">
          <ha-icon icon="mdi:close-thick"></ha-icon>
        </button>
      </div>
    `;
  }

  _dishPickerOverlay() {
    const dayKey = this._draft.pickerDay;
    if (!dayKey) return "";
    const plan = this._planAttrs();
    const day = (plan.days || []).find((entry) => entry.key === dayKey) || { name: "Tag" };
    const dishes = this._filteredDishes(this._draft.pickerSearch || "");
    return `
      <div class="modal-backdrop" data-action="close-picker">
        <div class="dish-picker-dialog">
          <div class="picker-head">
            <strong>${this._escape(day.name)} auswählen</strong>
            <button class="icon-button" title="Schließen" data-action="close-picker">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          <input data-role="day-picker-search" class="text-input" value="${this._escape(this._draft.pickerSearch || "")}" placeholder="Gericht suchen" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="search">
          <div class="picker-list">
            ${this._dayPickerListHtml(dishes, dayKey)}
          </div>
        </div>
      </div>
    `;
  }

  _resteFromDayOverlay() {
    if (!this._draft.resteDialogOpen) return "";
    const dish = String(this._draft.resteDialogDish || "");
    return `
      <div class="modal-backdrop" data-action="close-reste-dialog">
        <div class="dish-picker-dialog" data-role="reste-dialog">
          <div class="picker-head">
            <strong>Reste einbuchen</strong>
            <button class="icon-button" title="Schließen" data-action="close-reste-dialog">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>

          <div class="reste-dialog-body">
            <div class="reste-dialog-dish">
              <small>Gericht</small>
              <div class="reste-dialog-name">${this._escape(dish)}</div>
            </div>

            <label class="field-label">Portionen</label>
            <input class="text-input" data-role="reste-dialog-port" value="${this._escape(this._draft.resteDialogPort || "1")}" autocomplete="off" inputmode="numeric">

            <label class="field-label">Ort</label>
            <select class="plan-select" data-role="reste-dialog-ort">
              <option value="Kühlschrank" ${String(this._draft.resteDialogOrt || "Kühlschrank") === "Kühlschrank" ? "selected" : ""}>Kühlschrank</option>
              <option value="Eingefroren" ${String(this._draft.resteDialogOrt || "") === "Eingefroren" ? "selected" : ""}>Gefrierschrank</option>
            </select>

            <div class="form-actions">
              <button class="plain-button primary" data-action="confirm-reste-dialog">Einbuchen</button>
              <button class="plain-button" data-action="close-reste-dialog">Abbrechen</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _dayPickerListHtml(dishes, dayKey) {
    if (!dishes.length) {
      return `<div class="empty-list">Kein Gericht gefunden.</div>`;
    }
    return dishes.map((dish) => `
      <button class="dish-list-item" data-action="choose-day-dish" data-day="${this._escape(dayKey)}" data-id="${this._escape(dish.id)}">
        <span>${this._escape(dish.name)}</span>
        <small>ID ${this._escape(dish.id)} · K${this._escape(dish.klasse)}</small>
      </button>
    `).join("");
  }

  _newDishView() {
    return `
      <div class="shell">
        ${this._sidebar("new")}
        <section class="panel form-panel">
          <div class="tab-label">Neues Gericht</div>
          <label class="field-label" for="new-dish-name">Name des Gerichts:</label>
          <textarea id="new-dish-name" data-role="new-name" class="name-box" rows="3" autocomplete="off" autocorrect="off" spellcheck="false">${this._escape(this._draft.newName || "")}</textarea>
          ${this._classPicker("new")}
          <div class="class-help">${this._classDescription(Number(this._draft.newClass || 1))}</div>
          <div class="form-actions">
            <button class="plain-button primary" data-action="save-new">Gericht hinzufügen</button>
            <button class="plain-button" data-action="cancel-new">Abbrechen</button>
          </div>
        </section>
      </div>
    `;
  }

  _editDishView() {
    const dishes = this._activeDishes();
    if (!this._draft.editId && dishes.length) {
      this._selectDish(dishes[0], false);
    }
    const filtered = this._filteredEditDishes(dishes);
    return `
      <div class="shell">
        ${this._sidebar("edit")}
        <section class="panel edit-panel">
          <div class="tab-label">Gerichte bearbeiten</div>
          <div class="edit-grid">
            <div class="dish-list-panel">
              <label class="field-label" for="dish-search">Gericht wählen:</label>
              <input id="dish-search" data-role="edit-search" class="text-input" value="${this._escape(this._draft.editSearch || "")}" placeholder="Suchen" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="search">
              <div class="dish-list">
                ${this._editListHtml(filtered)}
              </div>
            </div>
            <div class="dish-edit-panel">
              <label class="field-label" for="edit-dish-name">Name des Gerichts:</label>
              <textarea id="edit-dish-name" data-role="edit-name" class="name-box" rows="3" autocomplete="off" autocorrect="off" spellcheck="false">${this._escape(this._draft.editName || "")}</textarea>
              ${this._classPicker("edit")}
              <div class="class-help">${this._classDescription(Number(this._draft.editClass || 1))}</div>
              <div class="form-actions">
                <button class="plain-button primary" data-action="save-edit">Speichern</button>
                <button class="plain-button danger-button" data-action="delete-dish">Gericht löschen</button>
                <button class="plain-button" data-action="go-main">Zurück</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  _sidebar(active) {
    return `
      <aside class="sidebar">
        <button class="side-button ${active === "new" ? "active" : ""}" data-action="go-new">Neues Gericht</button>
        <button class="side-button ${active === "edit" ? "active" : ""}" data-action="go-edit">Gerichte bearbeiten</button>
        <button class="side-button ${active === "plan" ? "active" : ""}" data-action="go-main">Wochenplan</button>
      </aside>
    `;
  }

  _classPicker(prefix) {
    const selected = Number(this._draft[`${prefix}Class`] || 1);
    return `
      <div class="radio-group" data-role="${prefix}-class">
        ${[1, 2, 3, 4].map((klasse) => `
          <label class="radio-line">
            <input type="radio" name="${prefix}-class" value="${klasse}" ${selected === klasse ? "checked" : ""}>
            <span>Klasse ${klasse} / ${this._escape(this._classShort(klasse))}</span>
          </label>
        `).join("")}
      </div>
    `;
  }

  _classShort(klasse) {
    return {
      1: "Beliebig oft",
      2: "Max. 2x Woche",
      3: "Max. 1x Woche",
      4: "Nur am WE",
    }[klasse] || "";
  }

  _classDescription(klasse) {
    return {
      1: "Klasse 1 darf beliebig oft pro Woche vorkommen.",
      2: "Klasse 2 darf maximal zweimal pro Woche vorkommen.",
      3: "Klasse 3 darf maximal einmal pro Woche vorkommen.",
      4: "Klasse 4 wird nur für Samstag oder Sonntag eingeplant.",
    }[klasse] || "";
  }

  _bindEvents() {
    this._bindActions(this.shadowRoot);
    const pickerDialog = this.shadowRoot.querySelector(".dish-picker-dialog");
    if (pickerDialog) {
      pickerDialog.addEventListener("click", (event) => event.stopPropagation());
    }

    // prevent backdrop click from bubbling for reste-dialog too
    const resteDialog = this.shadowRoot.querySelector('[data-role="reste-dialog"]');
    if (resteDialog) {
      resteDialog.addEventListener("click", (event) => event.stopPropagation());
    }

    this.shadowRoot.querySelectorAll("input, textarea, select").forEach((element) => {
      element.addEventListener("input", (event) => this._handleInput(event));
      if (element.dataset.role === "edit-search") {
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
          }
        });
      }
      if (element.dataset.role === "day-input") {
        element.addEventListener("change", (event) => this._saveDayInput(event.currentTarget));
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this._saveDayInput(event.currentTarget);
            event.currentTarget.blur();
          }
        });
      }

      // reste-dialog inputs
      if (element.dataset.role === "reste-dialog-port") {
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this._confirmResteDialog();
          }
        });
      }
    });
  }

  _bindActions(root) {
    root.querySelectorAll("[data-action]").forEach((element) => {
      element.addEventListener("click", (event) => this._handleAction(event));
    });
  }

  _handleInput(event) {
    const target = event.currentTarget;
    const role = target.dataset.role;
    if (role === "new-name") this._draft.newName = target.value;
    if (role === "edit-name") this._draft.editName = target.value;
    if (role === "edit-search") {
      this._draft.editSearch = target.value;
      this._refreshEditList();
    }
    if (role === "day-picker-search") {
      this._draft.pickerSearch = target.value;
      this._refreshDayPickerList();
    }
    if (role === "day-input") this._draft[`day-${target.dataset.day}`] = target.value;

    if (role === "abend-name") this._draft.abendName = target.value;
    if (role === "reste-name") this._draft.resteName = target.value;
    if (role === "reste-port") this._draft.restePort = target.value;
    if (role === "reste-ort") this._draft.resteOrt = target.value;

    if (role === "reste-dialog-port") this._draft.resteDialogPort = target.value;
    if (role === "reste-dialog-ort") this._draft.resteDialogOrt = target.value;

    if (target.type === "radio") {
      if (target.name === "new-class") this._draft.newClass = Number(target.value);
      if (target.name === "edit-class") this._draft.editClass = Number(target.value);
      this._render();
    }
  }

  async _handleAction(event) {
    const action = event.currentTarget.dataset.action;
    const day = event.currentTarget.dataset.day;

    if (action === "go-main") return this._goMain();
    if (action === "go-new") return this._navigate(this._viewPath("essen-neu"));
    if (action === "go-edit") return this._navigate(this._viewPath("essen-bearbeiten"));
    if (action === "cancel-new") return this._cancelNewDish();
    if (action === "prev-week") return this._shiftSelectedWeek(-1);
    if (action === "next-week") return this._shiftSelectedWeek(1);
    if (action === "create-plan") return this._createPlan();
    if (action === "reroll-day") return this._rerollDay(day);
    if (action === "clear-day") return this._clearDay(day);
    if (action === "open-day-picker") return this._openDayPicker(day);
    if (action === "close-picker") return this._closeDayPicker();
    if (action === "choose-day-dish") return this._chooseDishForDay(event.currentTarget.dataset.day, event.currentTarget.dataset.id);
    if (action === "save-new") return this._saveNewDish();
    if (action === "select-dish") return this._selectDishById(event.currentTarget.dataset.id);
    if (action === "save-edit") return this._saveEditDish();
    if (action === "delete-dish") return this._deleteDish();

    if (action === "set-plan-tab") {
      this._draft.planTab = event.currentTarget.dataset.tab || "mittag";
      if (this._draft.planTab === "reste" && !this._draft.resteLoaded && !this._draft.resteLoading) {
        this._loadResteFallback();
      }
      this._render();
      return;
    }

    if (action === "abend-add") {
      const name = String(this._draft.abendName || "").trim();
      if (!name) return this._notify("Bitte einen Namen eingeben.");
      const period = this._selectedPlanPeriod();
      await this._callPlanner("abendessen_hinzufuegen", { gericht_name: name, year: period.year, week: period.week });
      this._draft.abendName = "";
      this._draft.fallbackPlansLoaded = false;
      await this._loadPlansFallback();
      this._render();
      return;
    }

    if (action === "abend-remove") {
      const name = String(event.currentTarget.dataset.name || "");
      const period = this._selectedPlanPeriod();
      await this._callPlanner("abendessen_entfernen", { gericht_name: name, year: period.year, week: period.week });
      this._draft.fallbackPlansLoaded = false;
      await this._loadPlansFallback();
      this._render();
      return;
    }

    if (action === "reste-refresh") {
      this._draft.resteLoaded = false;
      this._loadResteFallback();
      return;
    }

    if (action === "reste-add") {
      const name = String(this._draft.resteName || "").trim();
      if (!name) return this._notify("Bitte einen Namen eingeben.");
      const portionen = String(this._draft.restePort || "1").trim() || "1";
      const ort = String(this._draft.resteOrt || "Kühlschrank");
      await this._callPlanner("reste_hinzufuegen", { gericht_name: name, portionen, ort });
      this._draft.resteName = "";
      this._draft.restePort = "";
      this._draft.resteOrt = "Kühlschrank";
      this._draft.resteLoaded = false;
      this._loadResteFallback();
      return;
    }

    if (action === "reste-remove") {
      const id = String(event.currentTarget.dataset.id || "");
      await this._callPlanner("reste_entfernen", { reste_id: id });
      this._draft.resteLoaded = false;
      this._loadResteFallback();
      return;
    }

    if (action === "open-reste-dialog") {
      const dish = String(event.currentTarget.dataset.dish || "").trim();
      if (!dish) return;
      this._draft.resteDialogOpen = true;
      this._draft.resteDialogDish = dish;
      this._draft.resteDialogPort = "1";
      this._draft.resteDialogOrt = "Kühlschrank";
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._draft.resteDialogDish = "";
      this._render();
      return;
    }

    if (action === "close-reste-dialog" || action === "close-reste") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "confirm-reste-dialog") {
      await this._confirmResteDialog();
      return;
    }

    if (action === "close-reste-dialog" || action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }
  }

  async _confirmResteDialog() {
    const dish = String(this._draft.resteDialogDish || "").trim();
    if (!dish) {
      this._draft.resteDialogOpen = false;
      this._render();
      return;
    }
    const portionen = String(this._draft.resteDialogPort || "1").trim() || "1";
    const ort = String(this._draft.resteDialogOrt || "Kühlschrank");
    await this._callPlanner("reste_hinzufuegen", { gericht_name: dish, portionen, ort });
    this._draft.resteDialogOpen = false;
    this._draft.resteDialogDish = "";
    this._draft.resteLoaded = false;
    this._loadResteFallback();
  }

  async _createPlan() {
    const period = this._selectedPlanPeriod();
    this._draft.planYear = period.year;
    this._draft.planWeek = period.week;
    const existingPlan = this._planAttrs().has_plan;
    if (existingPlan && !confirm(`Für KW ${period.week} / ${period.year} gibt es bereits einen Plan. Wirklich neu generieren?`)) {
      return;
    }
    this._clearDayDrafts();
    await this._callPlanner("create_plan", {
      year: period.year,
      week: period.week,
    });
    this._clearDayDrafts();
  }

  _shiftSelectedWeek(offset) {
    const period = this._selectedPlanPeriod();
    const monday = this._mondayForIsoWeek(period.year, period.week);
    monday.setUTCDate(monday.getUTCDate() + offset * 7);
    const next = this._isoWeekFromDate(monday);
    const nextOffset = this._selectedWeekOffset(next);
    if (nextOffset < -1 || nextOffset > 1) return;
    this._draft.planYear = next.year;
    this._draft.planWeek = next.week;
    this._draft.pickerDay = null;
    this._draft.pickerSearch = "";
    this._clearDayDrafts();
    this._render();
  }

  _goMain() {
    this._selectCurrentWeek();
    this._navigate(this._viewPath("essen"));
  }

  _selectCurrentWeek() {
    const current = this._currentIsoWeek();
    this._draft.planYear = current.year;
    this._draft.planWeek = current.week;
    this._draft.pickerDay = null;
    this._draft.pickerSearch = "";
    this._clearDayDrafts();
  }

  _cancelNewDish() {
    this._draft.newName = "";
    this._draft.newClass = 1;
    this._render();
  }

  async _rerollDay(day) {
    delete this._draft[`day-${day}`];
    const success = await this._callPlanner("reroll_day", this._planPayload({ day }));
    if (success) {
      delete this._draft[`day-${day}`];
    }
  }

  async _clearDay(day) {
    if (!this._selectedPlanExists()) {
      delete this._draft[`day-${day}`];
      this._render();
      return;
    }
    this._draft[`day-${day}`] = "";
    await this._callPlanner("clear_day", this._planPayload({ day }));
  }

  async _saveDayInput(input) {
    const day = input.dataset.day;
    const value = input.value.trim();
    if (!value && !this._selectedPlanExists()) {
      delete this._draft[`day-${day}`];
      this._render();
      return;
    }
    const success = await this._callPlanner("set_day", this._planPayload({ day, dish_name: value }));
    if (success) {
      delete this._draft[`day-${day}`];
    }
  }

  async _openDayPicker(day) {
    this._draft.pickerDay = day;
    this._draft.pickerSearch = "";
    this._render();
    await this._refreshDishesNow();
    this._refreshDayPickerList();
  }

  _closeDayPicker() {
    this._draft.pickerDay = null;
    this._draft.pickerSearch = "";
    this._render();
  }

  async _chooseDishForDay(day, dishId) {
    const dish = this._activeDishes().find((entry) => Number(entry.id) === Number(dishId));
    if (!dish) return this._notify("Gericht nicht gefunden.");
    this._draft[`day-${day}`] = dish.name;
    this._draft.pickerDay = null;
    this._draft.pickerSearch = "";
    const success = await this._callPlanner("set_day", this._planPayload({ day, dish_name: dish.name }));
    if (success) {
      delete this._draft[`day-${day}`];
    }
  }

  async _saveNewDish() {
    const name = String(this._draft.newName || "").trim();
    if (!name) return this._notify("Bitte einen Namen eingeben.");
    if (this._dishNameExists(name)) {
      return this._notify("Dieses Gericht gibt es bereits.");
    }
    const success = await this._callPlanner("add_dish", {
      name,
      klasse: Number(this._draft.newClass || 1),
    });
    if (success) {
      const dish = await this._waitForDishInFallback(name);
      if (dish) this._upsertLocalDish(dish);
      this._draft.newName = "";
      this._notify("Gericht hinzugefügt.");
      this._render();
    }
  }

  _selectDishById(id) {
    const dish = this._activeDishes().find((entry) => Number(entry.id) === Number(id));
    if (dish) {
      this._selectDish(dish, false);
    }
  }

  _selectDish(dish, rerender = true) {
    this._draft.editId = Number(dish.id);
    this._draft.editName = dish.name || "";
    this._draft.editClass = Number(dish.klasse || 1);
    if (rerender) {
      this._render();
      return;
    }
    this._refreshEditSelection();
  }

  _refreshEditSelection() {
    const editName = this.shadowRoot.querySelector('[data-role="edit-name"]');
    if (editName) editName.value = this._draft.editName || "";

    this.shadowRoot.querySelectorAll('input[name="edit-class"]').forEach((input) => {
      input.checked = Number(input.value) === Number(this._draft.editClass || 1);
    });

    const classHelp = this.shadowRoot.querySelector(".dish-edit-panel .class-help");
    if (classHelp) {
      classHelp.textContent = this._classDescription(Number(this._draft.editClass || 1));
    }

    this.shadowRoot.querySelectorAll(".dish-list-item").forEach((item) => {
      item.classList.toggle("selected", Number(item.dataset.id) === Number(this._draft.editId));
    });
  }

  async _saveEditDish() {
    if (!this._draft.editId) return this._notify("Bitte ein Gericht auswählen.");
    const name = String(this._draft.editName || "").trim();
    if (!name) return this._notify("Bitte einen Namen eingeben.");
    if (this._dishNameExists(name, this._draft.editId)) {
      return this._notify("Dieses Gericht gibt es bereits.");
    }
    const updatedDish = {
      id: Number(this._draft.editId),
      name,
      klasse: Number(this._draft.editClass || 1),
      active: true,
    };
    const success = await this._callPlanner("update_dish", {
      dish_id: Number(this._draft.editId),
      name,
      klasse: Number(this._draft.editClass || 1),
    });
    if (success) {
      this._upsertLocalDish(updatedDish);
      this._notify("Gericht aktualisiert.");
      this._refreshEditList();
    }
  }

  async _deleteDish() {
    if (!this._draft.editId) return this._notify("Bitte ein Gericht auswählen.");
    if (!confirm("Dieses Gericht wirklich löschen?")) return;
    const deletedId = Number(this._draft.editId);
    const success = await this._callPlanner("deactivate_dish", {
      dish_id: Number(this._draft.editId),
    });
    if (success) {
      this._removeLocalDish(deletedId);
      this._draft.editSearch = "";
      const nextDish = this._activeDishes().find((dish) => Number(dish.id) !== deletedId);
      if (nextDish) {
        this._selectDish(nextDish, false);
      } else {
        this._draft.editId = null;
        this._draft.editName = "";
        this._draft.editClass = 1;
      }
      this._notify("Gericht gelöscht.");
      this._render();
    }
  }

  _planPayload(extra) {
    const plan = this._planAttrs();
    return {
      year: Number(plan.year || this._draft.planYear),
      week: Number(plan.week || this._draft.planWeek),
      ...extra,
    };
  }

  _selectedPlanExists() {
    return Boolean(this._planAttrs().has_plan);
  }

  async _callPlanner(service, data) {
    try {
      await this._hass.callService("essen", service, data);
      await new Promise((resolve) => setTimeout(resolve, 350));
      this._draft.fallbackDishesLoaded = false;
      this._draft.fallbackPlansLoaded = false;
      await Promise.all([
        this._refreshDishesNow(),
        this._loadPlansFallback(),
      ]);
      await this._hass.callService("homeassistant", "update_entity", {
        entity_id: ["sensor.essen_wochenplan", "sensor.essen_gerichte"],
      }).catch(() => undefined);
      return true;
    } catch (error) {
      this._notify(this._errorMessage(error));
      return false;
    }
  }

  _errorMessage(error) {
    const message = (error && error.message) || String(error);
    if (message.includes("Dieses Gericht gibt es bereits")) return "Dieses Gericht gibt es bereits.";
    return message;
  }

  _filteredEditDishes(dishes = this._activeDishes()) {
    const search = this._searchText(this._draft.editSearch || "");
    return dishes.filter((dish) => this._searchText(`${dish.id} ${dish.name}`).includes(search));
  }

  _filteredDishes(search) {
    const wanted = this._searchText(search || "");
    return this._activeDishes().filter((dish) => this._searchText(`${dish.id} ${dish.name}`).includes(wanted));
  }

  _editListHtml(dishes) {
    if (!dishes.length) {
      return `<div class="empty-list">Kein Gericht gefunden.</div>`;
    }
    return dishes.map((dish) => `
      <button class="dish-list-item ${Number(this._draft.editId) === Number(dish.id) ? "selected" : ""}" data-action="select-dish" data-id="${this._escape(dish.id)}">
        <span>${this._escape(dish.name)}</span>
        <small>ID ${this._escape(dish.id)} · K${this._escape(dish.klasse)}</small>
      </button>
    `).join("");
  }

  _refreshEditList() {
    const list = this.shadowRoot.querySelector(".dish-list");
    if (!list) return;
    const scrollTop = list.scrollTop;
    list.innerHTML = this._editListHtml(this._filteredEditDishes());
    this._bindActions(list);
    list.scrollTop = scrollTop;
  }

  _refreshDayPickerList() {
    const list = this.shadowRoot.querySelector(".picker-list");
    if (!list || !this._draft.pickerDay) return;
    list.innerHTML = this._dayPickerListHtml(this._filteredDishes(this._draft.pickerSearch || ""), this._draft.pickerDay);
    this._bindActions(list);
  }

  _refreshAfterDataLoad() {
    const focusedRole = this._focusedRole();
    if (focusedRole === "edit-search") return this._refreshEditList();
    if (focusedRole === "day-picker-search") return this._refreshDayPickerList();
    if (focusedRole) return;
    this._render();
  }

  _focusedRole() {
    const activeElement = this.shadowRoot && this.shadowRoot.activeElement;
    const role = activeElement && activeElement.dataset ? activeElement.dataset.role : null;
    return ["edit-search", "day-picker-search", "day-input", "new-name", "edit-name", "reste-dialog-port", "reste-dialog-ort"].includes(role) ? role : null;
  }

  _searchText(value) {
    return String(value || "")
      .toLocaleLowerCase("de")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  async _fetchDishesFallback() {
    const response = await fetch(`/local/essen-gerichte.json?v=${Date.now()}`, {
      cache: "no-store",
    });
    const data = await response.json();
    return (data.dishes || []).filter((dish) => dish.active !== false);
  }

  async _waitForDishInFallback(name) {
    const wanted = this._searchText(name);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const dishes = await this._fetchDishesFallback();
        this._draft.fallbackDishes = dishes;
        this._draft.fallbackDishesLoaded = true;
        this._writeSharedDishes(dishes);
        const dish = dishes.find((entry) => this._searchText(entry.name) === wanted);
        if (dish) return dish;
      } catch (error) {
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  _readSharedDishes() {
    try {
      const raw = window.localStorage.getItem("essen-planer-active-dishes");
      if (!raw) return { dishes: [], revision: 0 };
      const data = JSON.parse(raw || "[]");
      if (Array.isArray(data)) return { dishes: data, revision: 0 };
      return {
        dishes: Array.isArray(data.dishes) ? data.dishes : [],
        revision: Number(data.revision || 0),
      };
    } catch (error) {
      return { dishes: [], revision: 0 };
    }
  }

  _writeSharedDishes(dishes) {
    try {
      const revision = Math.max(Date.now(), Number(this._draft.sharedDishesRevision || 0) + 1);
      this._draft.sharedDishesRevision = revision;
      window.localStorage.setItem("essen-planer-active-dishes", JSON.stringify({
        revision,
        dishes: dishes || [],
      }));
    } catch (error) {
    }
  }

  _navigate(path) {
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed"));
  }

  _viewPath(view) {
    const base = this._dashboardBasePath();
    return `${base}/${view}`;
  }

  _dashboardBasePath() {
    const firstSegment = window.location.pathname.split("/").filter(Boolean)[0];
    return firstSegment ? `/${firstSegment}` : "/lovelace";
  }

  _currentPathMatches(view) {
    const normalizePath = (path) => String(path || "").replace(/\/+$/, "") || "/";
    return normalizePath(window.location.pathname) === normalizePath(this._viewPath(view));
  }

  _notify(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", {
      detail: { message },
      bubbles: true,
      composed: true,
    }));
  }

  _clearDayDrafts() {
    Object.keys(this._draft)
      .filter((key) => key.startsWith("day-"))
      .forEach((key) => delete this._draft[key]);
  }

  _escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  _styles() {
    return `
      :host { display:block; }
      ha-card { overflow:hidden; }
      .shell { display:grid; grid-template-columns: 230px minmax(0,1fr); gap:24px; padding:26px; box-sizing:border-box; min-height:520px; }
      .sidebar { display:flex; flex-direction:column; gap:24px; padding-top:18px; }
      .side-button, .plain-button, .icon-button, .dish-list-item { font:inherit; color: var(--primary-text-color); border:1px solid var(--divider-color); background: var(--card-background-color); border-radius:6px; cursor:pointer; }
      .side-button { min-height:48px; font-size:18px; font-weight:700; }
      .side-button.active { border-color: var(--primary-color); box-shadow: inset 4px 0 0 var(--primary-color); }
      .panel { position:relative; border:1px solid var(--divider-color); border-radius:2px; padding:34px 16px 18px; min-height:360px; }
      .tab-label { position:absolute; top:-11px; left:0; padding:1px 8px; background: var(--card-background-color); border:1px solid var(--divider-color); font-size:12px; }
      .plan-head { margin-bottom: 12px; }
      .kw-line { display:flex; flex-wrap:wrap; align-items:center; gap:12px; color: var(--primary-color); font-size:18px; font-weight:700; }
      .pipe { color: var(--primary-color); }
      .selected-week { min-width: 122px; text-align:center; }
      .week-button { width:34px; }
      .plan-select, .text-input { color: var(--primary-text-color); background: var(--secondary-background-color); border:1px solid var(--divider-color); border-radius:2px; min-height:34px; padding:4px 8px; box-sizing:border-box; }
      .plan-select { min-width:160px; font:inherit; font-weight:700; }
      .plain-button { min-height:36px; padding:0 18px; font-weight:700; }
      .plain-button.primary { border-color: var(--primary-color); }
      .danger-button { color: var(--error-color, #db4437); }

      .plan-tabs { display:flex; gap:10px; margin-top: 10px; }
      .plan-tab { font:inherit; border:1px solid var(--divider-color); background: var(--card-background-color); border-radius: 999px; padding: 6px 12px; cursor:pointer; font-weight: 800; }
      .plan-tab.active { border-color: var(--primary-color); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--primary-color) 24%, transparent); }

      .days { display:flex; flex-direction:column; gap:11px; margin-top:8px; }
      .day-row { display:grid; grid-template-columns: 120px 64px minmax(180px, 1fr) 42px 42px 42px 42px; gap:10px; align-items:center; }
      .day-name, .day-date { font-size:18px; font-weight:700; }
      .dish-input, .name-box { width:100%; color: var(--primary-text-color); background: var(--secondary-background-color); border:1px solid var(--divider-color); border-radius:2px; box-sizing:border-box; font:inherit; }
      .dish-input { min-height:38px; padding:6px 10px; font-style:italic; font-weight:700; }
      .icon-button { width:38px; height:32px; display:inline-flex; align-items:center; justify-content:center; }
      .icon-button ha-icon { color: var(--secondary-text-color); }
      .icon-button:disabled { cursor: default; opacity: .35; }
      .icon-button.danger ha-icon, .danger { color: var(--error-color, #db4437); }

      .subpanel { margin-top: 12px; border-top: 1px solid var(--divider-color); padding-top: 12px; }
      .subhead { display:flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      .hint { color: var(--secondary-text-color); font-size: 12px; font-weight: 600; }

      .abend-add { display:grid; grid-template-columns: 1fr auto; gap: 10px; margin-bottom: 10px; }
      .abend-list { display:flex; flex-direction:column; gap: 8px; }
      .abend-item { display:flex; align-items:center; justify-content: space-between; gap: 10px; border:1px solid var(--divider-color); border-radius:6px; padding: 8px 10px; background: var(--card-background-color); }

      .reste-subpanel { overflow: visible; }
      .reste-add { display:grid; grid-template-columns: 1fr 90px 160px auto auto; gap: 10px; margin-bottom: 10px; overflow: visible; }
      .text-input.small { width: 90px; }
      .reste-list { display:flex; flex-direction:column; gap: 8px; }
      .reste-item { display:grid; grid-template-columns: 70px 1fr 42px; gap: 10px; align-items: center; border:1px solid var(--divider-color); border-radius:6px; padding: 8px 10px; background: var(--card-background-color); }
      .reste-meta { color: var(--secondary-text-color); font-size: 12px; font-weight: 600; display:flex; flex-wrap: wrap; gap: 6px; margin-top: 3px; }

      .badge { display:inline-flex; align-items:center; justify-content:center; font-weight: 900; border-radius: 999px; padding: 4px 8px; border: 1px solid var(--divider-color); font-size: 12px; }
      .badge-good { border-color: color-mix(in srgb, var(--primary-color) 40%, var(--divider-color)); background: color-mix(in srgb, var(--primary-color) 10%, transparent); }
      .badge-ok { border-color: color-mix(in srgb, var(--primary-color) 25%, var(--divider-color)); background: color-mix(in srgb, var(--primary-color) 6%, transparent); }
      .badge-warn { border-color: color-mix(in srgb, var(--error-color, #db4437) 35%, var(--divider-color)); background: color-mix(in srgb, var(--error-color, #db4437) 10%, transparent); }
      .badge-bad { border-color: color-mix(in srgb, var(--error-color, #db4437) 55%, var(--divider-color)); background: color-mix(in srgb, var(--error-color, #db4437) 16%, transparent); }
      .badge-neutral { }

      /* overlays: harden to always overlay */
      .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(0, 0, 0, 0.5);
        box-sizing: border-box;
      }
      .dish-picker-dialog {
        width: min(620px, 100%);
        max-height: min(720px, 88vh);
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        background: var(--card-background-color);
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        box-sizing: border-box;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      }
      .picker-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 18px;
      }
      .picker-list {
        max-height: 480px;
        overflow: auto;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
      }

      .reste-dialog-body { display: grid; gap: 10px; }
      .reste-dialog-dish small { color: var(--secondary-text-color); font-weight: 700; }
      .reste-dialog-name { font-size: 18px; font-weight: 800; }

      .empty-list { padding: 18px; color: var(--secondary-text-color); }

      @media (max-width: 760px) {
        .shell { grid-template-columns: 1fr; padding: 14px; }
        .sidebar { display:grid; grid-template-columns: 1fr; padding-top:0; gap:10px; }
        .day-row { grid-template-columns: 1fr repeat(4, 42px); }
        .day-name { grid-column: 1 / 2; }
        .day-date { grid-column: 2 / -1; justify-self:end; }
        .dish-input { grid-column: 1 / -1; }
        .reste-add { grid-template-columns: 1fr; }
        .abend-add { grid-template-columns: 1fr; }
      }
    `;
  }
}

if (!customElements.get("essen-planer-card")) {
  customElements.define("essen-planer-card", EssenPlanerCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "essen-planer-card",
  name: "Essensplaner",
  description: "Essensplaner mit Wochenplan, Abendessen-Pool und Reste-Inventur",
});
