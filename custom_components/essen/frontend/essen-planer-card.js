/* eslint-disable */
// Essen Planer Card – erweitert: Tabs in Plan-Ansicht für Mittag/Abend/Reste
// Added:
//  - day row greys out automatically for past days after noon
//  - day row greys out immediately after booking leftovers (local UI flag)

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
    this._draft.resteDialogDayKey = this._draft.resteDialogDayKey || null;

    // UI flags: days already booked as leftovers (front-end only)
    this._draft.uiResteBookedDays = this._draft.uiResteBookedDays || {};

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

  async _loadPlansFallback() {
    this._draft.fallbackPlansLoading = true;
    try {
      const response = await fetch(`/local/essen-wochenplaene.json?v=${Date.now()}`, { cache: "no-store" });
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
      const response = await fetch(`/local/essen-reste.json?v=${Date.now()}`, { cache: "no-store" });
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
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        ${this.mode === "new" ? this._newDishView() : ""}
        ${this.mode === "edit" ? this._editDishView() : ""}
        ${this.mode === "plan" ? this._planView() : ""}
      </ha-card>
    `;
    this._bindEvents();
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
              : `<div class="plan-notice">Für ${this._escape(plan.label)} gibt es noch keinen Plan.</div>`
          }

          ${tab === "mittag" ? `
            <div class="days">
              ${days.length ? days.map((day) => this._dayRow(day)).join("") : `<div class="empty-plan">Noch kein Plan.</div>`}
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

  _isPastNoonForDay(dayIso) {
    // grey out days in the past; today greys out only after 12:00
    try {
      const now = new Date();
      const todayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
      if (String(dayIso || "") < todayIso) return true;
      if (String(dayIso || "") > todayIso) return false;
      return now.getHours() >= 12;
    } catch (e) {
      return false;
    }
  }

  _dayRow(day) {
    const draftValue = this._draft[`day-${day.key}`];
    const value = draftValue != null ? draftValue : day.dish_name || "";
    const hasDish = String(value || "").trim().length > 0;

    const booked = !!(this._draft.uiResteBookedDays && this._draft.uiResteBookedDays[day.key]);
    const past = this._isPastNoonForDay(day.date);
    const grey = booked || past;

    return `
      <div class="day-row ${grey ? "day-row--grey" : ""}">
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
        <button class="icon-button" title="Als Reste einbuchen" data-action="open-reste-dialog" data-dish="${this._escape(value)}" data-day="${this._escape(day.key)}" ${hasDish ? "" : "disabled"}>
          <ha-icon icon="mdi:food-variant"></ha-icon>
        </button>
        <button class="icon-button danger" title="Gericht löschen" data-action="clear-day" data-day="${this._escape(day.key)}">
          <ha-icon icon="mdi:close-thick"></ha-icon>
        </button>
      </div>
    `;
  }

  _abendView(plan) {
    const pool = Array.isArray(plan.abendessen) ? plan.abendessen : [];
    return `
      <div class="subpanel">
        <div class="subhead"><strong>Abendessen (Pool)</strong></div>

        <div class="abend-add">
          <button class="plain-button" data-action="open-abend-picker">
            Aus Liste wählen
          </button>

          <input class="text-input" data-role="abend-name" placeholder="(optional) Freitext…" value="${this._escape(this._draft.abendName || "")}">
          <button class="plain-button primary" data-action="abend-add">Hinzufügen</button>
        </div>

        <div class="hint-line">Liste zeigt nur Gerichte vom Typ <strong>Abend</strong>.</div>

        <div class="abend-list">
          ${pool.length ? pool.map((name) => `
            <div class="abend-item">
              <span>${this._escape(name)}</span>
              <button class="icon-button" title="Als Reste einbuchen" data-action="open-reste-dialog" data-dish="${this._escape(name)}">
                <ha-icon icon="mdi:food-variant"></ha-icon>
              </button>
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
        <div class="subhead"><strong>Reste (Inventur)</strong></div>
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

                  <div class="reste-portion-controls" aria-label="Portionen anpassen">
                    <button class="chip" data-action="reste-delta" data-id="${this._escape(r.id)}" data-delta="-1">-1</button>
                    <button class="chip" data-action="reste-delta" data-id="${this._escape(r.id)}" data-delta="-0.5">-0,5</button>
                    <button class="chip" data-action="reste-delta" data-id="${this._escape(r.id)}" data-delta="0.5">+0,5</button>
                    <button class="chip" data-action="reste-delta" data-id="${this._escape(r.id)}" data-delta="1">+1</button>
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

  _dishPickerOverlay() {
    const mode = String(this._draft.pickerMode || "day"); // day | abend
    const dayKey = this._draft.pickerDay;
    const isAbend = mode === "abend";

    if (!isAbend && !dayKey) return "";

    const plan = this._planAttrs();
    const title = isAbend ? "Abendessen auswählen" : `${((plan.days || []).find((e) => e.key === dayKey) || { name: "Tag" }).name)} auswählen`;

    const dishes = this._filteredDishesByTyp(this._draft.pickerSearch || "", isAbend ? "Abend" : "Mittag");

    return `
      <div class="modal-backdrop" data-action="close-picker">
        <div class="dish-picker-dialog">
          <div class="picker-head">
            <strong>${this._escape(title)}</strong>
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
    if (!dishes.length) return `<div class="empty-list">Kein Gericht gefunden.</div>`;
    return dishes.map((dish) => `
      <button class="dish-list-item" data-action="choose-day-dish" data-day="${this._escape(dayKey)}" data-id="${this._escape(dish.id)}">
        <span>${this._escape(dish.name)}</span>
        <small>ID ${this._escape(dish.id)} · K${this._escape(dish.klasse)}</small>
      </button>
    `).join("");
  }

  _bindEvents() {
    this._bindActions(this.shadowRoot);
    const pickerDialog = this.shadowRoot.querySelector(".dish-picker-dialog");
    if (pickerDialog) pickerDialog.addEventListener("click", (event) => event.stopPropagation());
    const resteDialog = this.shadowRoot.querySelector('[data-role="reste-dialog"]');
    if (resteDialog) resteDialog.addEventListener("click", (event) => event.stopPropagation());

    this.shadowRoot.querySelectorAll("input, textarea, select").forEach((element) => {
      element.addEventListener("input", (event) => this._handleInput(event));
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
    if (role === "day-picker-search") { this._draft.pickerSearch = target.value; this._refreshDayPickerList(); }
    if (role === "day-input") this._draft[`day-${target.dataset.day}`] = target.value;
    if (role === "abend-name") this._draft.abendName = target.value;
    if (role === "reste-name") this._draft.resteName = target.value;
    if (role === "reste-port") this._draft.restePort = target.value;
    if (role === "reste-ort") this._draft.resteOrt = target.value;
    if (role === "reste-dialog-port") this._draft.resteDialogPort = target.value;
    if (role === "reste-dialog-ort") this._draft.resteDialogOrt = target.value;
  }

  async _handleAction(event) {
    const action = event.currentTarget.dataset.action;
    const day = event.currentTarget.dataset.day;

    if (action === "set-plan-tab") { this._draft.planTab = event.currentTarget.dataset.tab || "mittag"; this._render(); return; }

    if (action === "open-day-picker") {
      this._draft.pickerMode = "day";
      return this._openDayPicker(day);
    }

    if (action === "open-abend-picker") {
      this._draft.pickerMode = "abend";
      this._draft.pickerDay = "__abend__";
      this._draft.pickerSearch = "";
      this._render();
      return;
    }

    if (action === "close-picker") return this._closeDayPicker();

    if (action === "choose-day-dish") {
      const id = event.currentTarget.dataset.id;
      if (String(this._draft.pickerMode || "day") === "abend") {
        const dish = this._activeDishes().find((d) => String(d.id) === String(id));
        if (!dish) return;
        await this._callPlanner("abendessen_hinzufuegen", { gericht_name: dish.name });
        this._draft.pickerDay = null;
        this._draft.pickerMode = "day";
        this._render();
        return;
      }
      return this._chooseDishForDay(event.currentTarget.dataset.day, id);
    }

    if (action === "open-reste-dialog") {
      const dish = String(event.currentTarget.dataset.dish || "").trim();
      const dayKey = event.currentTarget.dataset.day || null;
      if (!dish) return;
      this._draft.resteDialogOpen = true;
      this._draft.resteDialogDish = dish;
      this._draft.resteDialogDayKey = dayKey;
      this._draft.resteDialogPort = "1";
      this._draft.resteDialogOrt = "Kühlschrank";
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._draft.resteDialogDish = "";
      this._draft.resteDialogDayKey = null;
      this._render();
      return;
    }

    if (action === "confirm-reste-dialog") { await this._confirmResteDialog(); return; }

    if (action === "reste-delta") {
      const id = event.currentTarget.dataset.id;
      const delta = parseFloat(String(event.currentTarget.dataset.delta || "0"));
      if (!id || !Number.isFinite(delta) || delta === 0) return;
      await this._callPlanner("reste_portionen_aendern", { reste_id: id, delta });
      this._draft.resteLoaded = false;
      this._loadResteFallback();
      return;
    }

    // keep other existing actions in your repo version
  }

  async _confirmResteDialog() {
    const dish = String(this._draft.resteDialogDish || "").trim();
    const dayKey = this._draft.resteDialogDayKey;
    const portionen = String(this._draft.resteDialogPort || "1").trim() || "1";
    const ort = String(this._draft.resteDialogOrt || "Kühlschrank");
    await this._callPlanner("reste_hinzufuegen", { gericht_name: dish, portionen, ort });

    if (dayKey) {
      this._draft.uiResteBookedDays = this._draft.uiResteBookedDays || {};
      this._draft.uiResteBookedDays[dayKey] = true;
    }

    this._draft.resteDialogOpen = false;
    this._draft.resteDialogDish = "";
    this._draft.resteDialogDayKey = null;
    this._draft.resteLoaded = false;
    this._loadResteFallback();
  }

  // NOTE: The rest of original methods (create_plan, reroll, clear, edit/new, service calls etc.)
  // should remain from your current repo file. This build focuses only on the grey-out behavior.

  _filteredDishes(search) {
    // backwards compatible: default shows all
    const wanted = this._searchText(search || "");
    return this._activeDishes().filter((dish) => this._searchText(`${dish.id} ${dish.name}`).includes(wanted));
  }

  _filteredDishesByTyp(search, typWanted) {
    const wanted = this._searchText(search || "");
    const tWanted = this._searchText(typWanted || "");
    return this._activeDishes().filter((dish) => {
      const hit = this._searchText(`${dish.id} ${dish.name}`).includes(wanted);
      if (!hit) return false;
      const typ = this._searchText(dish.typ || "Mittag");
      return typ === tWanted;
    });
  }

  _searchText(value) {
    return String(value || "").toLocaleLowerCase("de").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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

      .day-row--grey .dish-input {
        background: var(--secondary-background-color);
        opacity: 0.55;
      }
      .day-row--grey .day-name,
      .day-row--grey .day-date {
        opacity: 0.7;
      }
      .day-row--grey .icon-button,
      .day-row--grey .plain-button {
        opacity: 0.65;
      }

      /* Reste portion controls */
      .reste-portion-controls { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
      .chip { border:1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); padding:6px 10px; border-radius:999px; font-weight:700; cursor:pointer; }
      .chip:hover { border-color: var(--primary-color); }
      .chip:focus { outline: 2px solid var(--primary-color); outline-offset: 2px; }

      /* overlays */
      .modal-backdrop { position: fixed; inset: 0; z-index: 9999; display:flex; align-items:center; justify-content:center; padding:18px; background: rgba(0,0,0,.5); box-sizing:border-box; }
      .dish-picker-dialog { width: min(620px, 100%); max-height: min(720px, 88vh); display:flex; flex-direction:column; gap:12px; padding:16px; background: var(--card-background-color); border:1px solid var(--divider-color); border-radius:6px; box-sizing:border-box; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
      .picker-head { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:18px; }
      .picker-list { max-height:480px; overflow:auto; border:1px solid var(--divider-color); border-radius:4px; }
      .reste-dialog-body { display:grid; gap: 10px; }
      .reste-dialog-name { font-size: 18px; font-weight: 800; }
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
