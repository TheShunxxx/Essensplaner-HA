/* eslint-disable */
// Essen Planer Card – merged build:
// base: essen-planer-card (1).js (working)
// added: tabs (Mittag/Abend/Reste), leftovers inventory + from-day dialog, robust grey-out

class EssenPlanerCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this.mode = this.config.mode || "plan";
    this._draft = this._draft || {};

    // tabs
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
    this._draft.resteDialogAblauf = this._draft.resteDialogAblauf || "";
    this._draft.resteDialogDayKey = this._draft.resteDialogDayKey || null;

    // UI flags: days already booked as leftovers (front-end only)
    // UI flags: abendessen checked (front-end only)
    this._draft.uiAbendDone = this._draft.uiAbendDone || {};

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
    const prevPlan   = this._hass && this._hass.states && this._hass.states["sensor.essen_wochenplan"];
    const prevDishes = this._hass && this._hass.states && this._hass.states["sensor.essen_gerichte"];
    const prevReste  = this._hass && this._hass.states && this._hass.states["sensor.essen_reste"];

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

    const newPlan   = hass && hass.states && hass.states["sensor.essen_wochenplan"];
    const newDishes = hass && hass.states && hass.states["sensor.essen_gerichte"];
    const newReste  = hass && hass.states && hass.states["sensor.essen_reste"];

    const planChanged   = !prevPlan   || !newPlan   || prevPlan.last_changed   !== newPlan.last_changed;
    const dishesChanged = !prevDishes || !newDishes || prevDishes.last_changed !== newDishes.last_changed;
    const resteChanged  = !prevReste  || !newReste  || prevReste.last_changed  !== newReste.last_changed;

    if (planChanged || dishesChanged || resteChanged) {
      this._render();
    }
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
    return [...source].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de"));
  }

  async _loadDishesFallback() {
    this._draft.fallbackDishesLoading = true;
    try {
      this._draft.fallbackDishes = await this._fetchDishesFallback();
      this._writeSharedDishes(this._draft.fallbackDishes);
      this._draft.fallbackDishesLoaded = true;
      if (!this._focusedRole()) {
        this._refreshAfterDataLoad();
      }
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
    const dishes = Array.isArray(this._draft.fallbackDishes)
      ? [...this._draft.fallbackDishes]
      : [...this._activeDishes()];
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
    return this._activeDishes().some(
      (dish) => Number(dish.id) !== Number(ignoreId) && this._searchText(dish.name) === wanted
    );
  }

  async _loadPlansFallback() {
    this._draft.fallbackPlansLoading = true;
    try {
      const response = await fetch(`/local/essen-wochenplaene.json?v=${Date.now()}`, { cache: "no-store" });
      this._draft.fallbackPlans = await response.json();
      this._draft.fallbackPlansLoaded = true;
      if (!this._focusedRole()) {
        this._refreshAfterDataLoad();
      }
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
      this._draft.reste = Array.isArray(data) ? data : data && Array.isArray(data.reste) ? data.reste : [];
    } catch (e) {
      this._draft.reste = [];
    } finally {
      this._draft.resteLoaded = true;
      this._draft.resteLoading = false;
      // Kein _render() wenn ein Eingabefeld fokussiert ist - Daten sind im Draft, 
      // der nächste Render (z.B. nach Button-Klick) übernimmt sie.
      if (!this._focusedRole()) {
        this._render();
      }
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

  _isPastNoonForDay(dayValue) {
    // dayValue can be "YYYY-MM-DD" OR "DD.MM." (as in the UI)
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const noonPassed = now.getHours() >= 12;

      let dayDate = null;
      const s = String(dayValue || "").trim();

      // ISO: YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split("-").map((x) => Number(x));
        dayDate = new Date(y, m - 1, d);
      }

      // Short: DD.MM.
      if (!dayDate && /^\d{2}\.\d{2}\.$/.test(s)) {
        const dd = Number(s.slice(0, 2));
        const mm = Number(s.slice(3, 5));

        // Wichtig: Jahr NICHT aus "weekMonday.getFullYear()" ziehen.
        // Das kann an Jahreswechseln (KW 1/52/53) daneben liegen und graut dann alles aus.
        // Wir nehmen stattdessen das Jahr aus der ausgewählten Plan-Periode.
        const period = this._selectedPlanPeriod();
        dayDate = new Date(Number(period.year), mm - 1, dd);
      }

      if (!dayDate || isNaN(dayDate.getTime())) return false;

      const dayOnly = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());

      if (dayOnly < today) return true;
      if (dayOnly > today) return false;

      return noonPassed;
    } catch (e) {
      return false;
    }
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
    return { editListScrollTop: editList ? editList.scrollTop : null };
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
    const btn = (id, label) =>
      `<button class="plan-tab ${tab === id ? "active" : ""}" data-action="set-plan-tab" data-tab="${this._escape(id)}">${this._escape(label)}</button>`;
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

          ${hasPlan ? "" : `<div class="plan-notice">Für ${this._escape(plan.label)} gibt es noch keinen Plan.</div>`}

          ${tab === "mittag" ? `
            <div class="days">
              ${days.length ? days.map((day) => this._dayRow(day)).join("") : `<div class="empty-plan">Noch kein Plan.</div>`}
            </div>
            ${this._dishPickerOverlay()}
            ${this._resteFromDayOverlay()}
          ` : ""}

          ${tab === "abend" ? this._abendView(plan) : ""}
          ${tab === "reste" ? this._resteView() : ""}

          ${this._abendPickerOverlay()}
        </section>
      </div>
    `;
  }

  _dayRow(day) {
    const draftValue = this._draft[`day-${day.key}`];
    const value = draftValue != null ? draftValue : day.dish_name || "";
    const hasDish = String(value || "").trim().length > 0;

    const booked = !!(this._draft.uiResteBookedDays && this._draft.uiResteBookedDays[day.key]);
    const past = this._isPastNoonForDay(day.date || day.date_display);
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
          <button class="plain-button" data-action="open-abend-picker">Aus Liste wählen</button>
          <input class="text-input" data-role="abend-name" placeholder="(optional) Freitext…" value="${this._escape(this._draft.abendName || "")}">
          <button class="plain-button primary" data-action="abend-add">Hinzufügen</button>
        </div>

        <div class="hint-line">Liste zeigt nur Gerichte vom Typ <strong>Abend</strong>.</div>

        <div class="abend-list">
          ${pool.length ? pool.map((name, idx) => `
            <div class="abend-row ${this._draft.uiAbendDone && this._draft.uiAbendDone[this._searchText(name)] ? "abend-row--done" : ""}">
              <button class="icon-button" title="Erledigt umschalten" data-action="abend-toggle-done" data-name="${this._escape(name)}">
                <ha-icon icon="mdi:check"></ha-icon>
              </button>
              <div class="abend-num">${idx + 1}.</div>
              <div class="abend-name">${this._escape(name)}</div>
              <button class="icon-button" title="Als Reste einbuchen" data-action="open-reste-dialog" data-dish="${this._escape(name)}" data-source="abend">
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
          <select class="plan-select" data-role="reste-ort" data-action="reste-ort-changed">
            <option value="Kühlschrank" ${String(this._draft.resteOrt || "Kühlschrank") === "Kühlschrank" ? "selected" : ""}>Kühlschrank</option>
            <option value="Eingefroren" ${String(this._draft.resteOrt || "") === "Eingefroren" ? "selected" : ""}>Gefrierschrank</option>
          </select>
          <input class="text-input small" type="date" data-role="reste-ablauf" value="${this._escape(this._draft.resteAblauf || this._defaultAblaufForOrt(this._draft.resteOrt || "Kühlschrank"))}" autocomplete="off">
          <button class="plain-button primary" data-action="reste-add">Einbuchen</button>
          <button class="plain-button" data-action="reste-refresh">Aktualisieren</button>
        </div>
        <div class="reste-list">
          ${sorted.length ? `<div class="reste-list-header"><span class="reste-header-haltbar">Haltbar</span></div>` : ""}
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
                    ${r.ablauf_datum ? `<span>· Ablauf ${this._escape(r.ablauf_datum)}</span>` : ""}
                  </div>

                  <div class="reste-controls">
                    <span class="reste-port-label">Portionen</span>
                    <div class="stepper" role="group" aria-label="Portionen anpassen">
                      <button class="icon-button" title="-0,5" data-action="reste-port-delta" data-id="${this._escape(r.id)}" data-delta="-0.5">
                        <ha-icon icon="mdi:chevron-down"></ha-icon>
                      </button>
                      <input class="stepper-input" data-role="reste-port-set" data-id="${this._escape(r.id)}" value="${this._escape(r.portionen || "0")}" inputmode="decimal" autocomplete="off">
                      <button class="icon-button" title="+0,5" data-action="reste-port-delta" data-id="${this._escape(r.id)}" data-delta="0.5">
                        <ha-icon icon="mdi:chevron-up"></ha-icon>
                      </button>
                    </div>
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
      ${this._abendPickerOverlay()}
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

  _abendPickerOverlay() {
    if (!this._draft.abendPickerOpen) return "";
    const dishes = this._abendDishes(this._draft.abendPickerSearch || "");
    return `
      <div class="modal-backdrop" data-action="close-abend-picker">
        <div class="dish-picker-dialog">
          <div class="picker-head">
            <strong>Abendessen auswählen</strong>
            <button class="icon-button" title="Schließen" data-action="close-abend-picker">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          <input data-role="abend-picker-search" class="text-input" value="${this._escape(this._draft.abendPickerSearch || "")}" placeholder="Gericht suchen" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="search">
          <div class="picker-list abend-picker-list">
            ${this._abendPickerListHtml(dishes)}
          </div>
        </div>
      </div>
    `;
  }

  _isoDateAddDays(isoDate, days) {
    const d = new Date(isoDate + "T00:00:00");
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  _defaultAblaufForOrt(ort, baseDate) {
    const base = baseDate || this._todayIso();
    const days = String(ort || "").toLowerCase().includes("eingefror") ? 90 : 3;
    return this._isoDateAddDays(base, days);
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
            <select class="plan-select" data-role="reste-dialog-ort" data-action="reste-dialog-ort-changed">
              <option value="Kühlschrank" ${String(this._draft.resteDialogOrt || "Kühlschrank") === "Kühlschrank" ? "selected" : ""}>Kühlschrank</option>
              <option value="Eingefroren" ${String(this._draft.resteDialogOrt || "") === "Eingefroren" ? "selected" : ""}>Gefrierschrank</option>
            </select>
            <label class="field-label">Haltbar bis</label>
            <input class="text-input" type="date" data-role="reste-dialog-ablauf" value="${this._escape(this._draft.resteDialogAblauf || "")}" autocomplete="off">
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
    return dishes
      .map(
        (dish) => `
      <button class="dish-list-item" data-action="choose-day-dish" data-day="${this._escape(dayKey)}" data-id="${this._escape(dish.id)}">
        <span>${this._escape(dish.name)}</span>
        <small>ID ${this._escape(dish.id)} · K${this._escape(dish.klasse)}</small>
      </button>
    `
      )
      .join("");
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
        ${[1, 2, 3, 4]
          .map(
            (klasse) => `
          <label class="radio-line">
            <input type="radio" name="${prefix}-class" value="${klasse}" ${selected === klasse ? "checked" : ""}>
            <span>Klasse ${klasse} / ${this._escape(this._classShort(klasse))}</span>
          </label>
        `
          )
          .join("")}
      </div>
    `;
  }

  _classShort(klasse) {
    return (
      {
        1: "Beliebig oft",
        2: "Max. 2x Woche",
        3: "Max. 1x Woche",
        4: "Nur am WE",
      }[klasse] || ""
    );
  }

  _classDescription(klasse) {
    return (
      {
        1: "Klasse 1 darf beliebig oft pro Woche vorkommen.",
        2: "Klasse 2 darf maximal zweimal pro Woche vorkommen.",
        3: "Klasse 3 darf maximal einmal pro Woche vorkommen.",
        4: "Klasse 4 wird nur für Samstag oder Sonntag eingeplant.",
      }[klasse] || ""
    );
  }

  _bindEvents() {
    this._bindActions(this.shadowRoot);
    const pickerDialog = this.shadowRoot.querySelector(".dish-picker-dialog");
    if (pickerDialog) {
      pickerDialog.addEventListener("click", (event) => event.stopPropagation());
    }
    const resteDialog = this.shadowRoot.querySelector('[data-role="reste-dialog"]');
    if (resteDialog) {
      resteDialog.addEventListener("click", (event) => event.stopPropagation());
    }

    this.shadowRoot.querySelectorAll("input, textarea, select").forEach((element) => {
      element.addEventListener("input", (event) => this._handleInput(event));

      if (element.dataset.role === "reste-port-set") {
        element.addEventListener("blur", (event) => this._commitRestePortSet(event.currentTarget));
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this._commitRestePortSet(event.currentTarget);
            event.currentTarget.blur();
          }
        });
      }
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

    if (role === "abend-picker-search") {
      this._draft.abendPickerSearch = target.value;
      this._refreshAbendPickerList();
    }

    if (role === "reste-name") this._draft.resteName = target.value;
    if (role === "reste-port") this._draft.restePort = target.value;
    if (role === "reste-ort") { this._draft.resteOrt = target.value; }
    if (role === "reste-ablauf") this._draft.resteAblauf = target.value;
    if (role === "reste-dialog-port") this._draft.resteDialogPort = target.value;
    if (role === "reste-dialog-ort") { this._draft.resteDialogOrt = target.value; }
    if (role === "reste-dialog-ablauf") this._draft.resteDialogAblauf = target.value;

    if (role === "reste-port-set") {
      // live update only; commit happens on blur / Enter
      target.value = target.value;
    }

    if (target.type === "radio") {
      if (target.name === "new-class") this._draft.newClass = Number(target.value);
      if (target.name === "edit-class") this._draft.editClass = Number(target.value);
      this._render();
    }
  }

  async _handleAction(event) {
    const action = event.currentTarget.dataset.action;
    const day = event.currentTarget.dataset.day;

    if (action === "set-plan-tab") {
      this._draft.planTab = event.currentTarget.dataset.tab || "mittag";
      this._render();
      return;
    }

    // Wenn Ort geändert wird: Ablaufdatum-Vorschlag neu berechnen
    if (action === "reste-dialog-ort-changed") {
      const newOrt = event.currentTarget.value;
      this._draft.resteDialogOrt = newOrt;
      this._draft.resteDialogAblauf = this._defaultAblaufForOrt(newOrt);
      this._render();
      return;
    }
    if (action === "reste-ort-changed") {
      const newOrt = event.currentTarget.value;
      this._draft.resteOrt = newOrt;
      this._draft.resteAblauf = this._defaultAblaufForOrt(newOrt);
      this._render();
      return;
    }

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
    if (action === "choose-day-dish")
      return this._chooseDishForDay(event.currentTarget.dataset.day, event.currentTarget.dataset.id);
    if (action === "save-new") return this._saveNewDish();
    if (action === "select-dish") return this._selectDishById(event.currentTarget.dataset.id);
    if (action === "save-edit") return this._saveEditDish();
    if (action === "delete-dish") return this._deleteDish();

    if (action === "reste-add") return this._resteAdd();
    if (action === "reste-refresh") return this._resteRefresh();
    if (action === "reste-remove") return this._resteRemove(event.currentTarget.dataset.id);
    if (action === "reste-port-delta") return this._restePortDelta(event.currentTarget.dataset.id, event.currentTarget.dataset.delta);

    if (action === "reste-port-apply") return this._confirmResteDialog();

    if (action === "open-abend-picker") return this._openAbendPicker();
    if (action === "abend-add") return this._abendAdd();
    if (action === "abend-remove") return this._abendRemove(event.currentTarget.dataset.name);
    if (action === "choose-abend-dish") return this._chooseAbendDish(event.currentTarget.dataset.id);
    if (action === "close-abend-picker") return this._closeAbendPicker();

    if (action === "open-reste-dialog") {
      const dish = String(event.currentTarget.dataset.dish || "").trim();
      const dayKey = event.currentTarget.dataset.day || null;
      const source = String(event.currentTarget.dataset.source || "");
      if (!dish) return;

      // Datum des Tages aus dem Plan ermitteln (für Vorschlag Ablaufdatum)
      let dayDate = null;
      if (dayKey) {
        const plan = this._planAttrs();
        const dayEntry = (plan.days || []).find((d) => d.key === dayKey);
        dayDate = dayEntry && dayEntry.date ? dayEntry.date : null;
      }
      const defaultOrt = "Kühlschrank";
      const defaultAblauf = this._defaultAblaufForOrt(defaultOrt, dayDate);

      this._draft.resteDialogOpen = true;
      this._draft.resteDialogDish = dish;
      this._draft.resteDialogDayKey = dayKey;
      this._draft.resteDialogPort = "1";
      this._draft.resteDialogOrt = defaultOrt;
      this._draft.resteDialogAblauf = defaultAblauf;
      this._draft.resteDialogSource = source;
      this._render();
      return;
    }

    if (action === "close-reste-dialog") {
      this._draft.resteDialogOpen = false;
      this._draft.resteDialogDish = "";
      this._draft.resteDialogDayKey = null;
      this._draft.resteDialogSource = "";
      this._draft.resteDialogAblauf = "";
      this._render();
      return;
    }

    if (action === "confirm-reste-dialog") {
      await this._confirmResteDialog();
      return;
    }

    // passthrough: additional actions can be implemented here
  }

  async _resteRefresh() {
    this._draft.resteLoaded = false;
    await this._loadResteFallback();
  }

  async _resteAdd() {
    const dish = String(this._draft.resteName || "").trim();
    if (!dish) return this._notify("Bitte einen Gerichtnamen eingeben.");
    const portionen = String(this._draft.restePort || "1").trim() || "1";
    const ort = String(this._draft.resteOrt || "Kühlschrank");
    const ablauf = String(this._draft.resteAblauf || this._defaultAblaufForOrt(ort)).trim();

    await this._callPlanner("reste_hinzufuegen", { gericht_name: dish, portionen, ort, ablauf_datum: ablauf });

    this._draft.resteName = "";
    this._draft.restePort = "";
    this._draft.resteAblauf = "";
    this._draft.resteOrt = ort;

    this._draft.resteLoaded = false;
    await this._loadResteFallback();
  }

  async _resteRemove(id) {
    const resteId = String(id || "").trim();
    if (!resteId) return;
    await this._callPlanner("reste_entfernen", { reste_id: resteId });
    this._draft.resteLoaded = false;
    await this._loadResteFallback();
  }

  _parsePortionen(value) {
    const raw = String(value == null ? "" : value).trim().replace(",", ".");
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }

  async _restePortDelta(id, deltaRaw) {
    const resteId = String(id || "").trim();
    const delta = Number(deltaRaw);
    if (!resteId || Number.isNaN(delta)) return;

    await this._callPlanner("reste_portionen_aendern", { reste_id: resteId, delta });

    this._draft.resteLoaded = false;
    await this._loadResteFallback();
  }

  async _commitRestePortSet(input) {
    const resteId = String(input && input.dataset ? input.dataset.id : "").trim();
    if (!resteId) return;

    const wanted = this._parsePortionen(input.value);
    if (wanted == null) {
      // revert
      this._draft.resteLoaded = false;
      await this._loadResteFallback();
      return;
    }

    const currentEntry = (Array.isArray(this._draft.reste) ? this._draft.reste : []).find((r) => String(r.id) === resteId);
    const current = currentEntry ? this._parsePortionen(currentEntry.portionen) : null;
    if (current == null) {
      this._draft.resteLoaded = false;
      await this._loadResteFallback();
      return;
    }

    const delta = Math.round((wanted - current) * 100) / 100;
    if (Math.abs(delta) < 1e-9) return;

    await this._callPlanner("reste_portionen_aendern", { reste_id: resteId, delta });

    this._draft.resteLoaded = false;
    await this._loadResteFallback();
  }

  async _openAbendPicker() {
    this._draft.abendPickerOpen = true;
    this._draft.abendPickerSearch = "";
    this._render();
    await this._refreshDishesNow();
    this._refreshAbendPickerList();
  }

  _closeAbendPicker() {
    this._draft.abendPickerOpen = false;
    this._draft.abendPickerSearch = "";
    this._render();
  }

  _abendDishes(search) {
    const wanted = this._searchText(search || "");
    return this._activeDishes()
      .filter((dish) => String(dish.typ || "Mittag") === "Abend")
      .filter((dish) => this._searchText(`${dish.id} ${dish.name}`).includes(wanted));
  }

  _refreshAbendPickerList() {
    const list = this.shadowRoot && this.shadowRoot.querySelector(".abend-picker-list");
    if (!list || !this._draft.abendPickerOpen) return;
    list.innerHTML = this._abendPickerListHtml(this._abendDishes(this._draft.abendPickerSearch || ""));
    this._bindActions(list);
  }

  _abendPickerListHtml(dishes) {
    if (!dishes.length) return `<div class="empty-list">Kein Abend-Gericht gefunden.</div>`;
    return dishes
      .map(
        (dish) => `
      <button class="dish-list-item" data-action="choose-abend-dish" data-id="${this._escape(dish.id)}">
        <span>${this._escape(dish.name)}</span>
        <small>ID ${this._escape(dish.id)} · K${this._escape(dish.klasse)}</small>
      </button>
    `
      )
      .join("");
  }

  async _chooseAbendDish(dishId) {
    const dish = this._activeDishes().find((entry) => Number(entry.id) === Number(dishId));
    if (!dish) return;
    this._draft.abendName = dish.name;
    this._closeAbendPicker();
  }

  async _abendAdd() {
    const name = String(this._draft.abendName || "").trim();
    if (!name) return this._notify("Bitte einen Namen eingeben.");
    await this._callPlanner("abendessen_hinzufuegen", this._planPayload({ gericht_name: name }));
    this._draft.abendName = "";
    this._render();
  }

  async _abendRemove(name) {
    const dishName = String(name || "").trim();
    if (!dishName) return;
    await this._callPlanner("abendessen_entfernen", this._planPayload({ gericht_name: dishName }));
    this._render();
  }

  async _confirmResteDialog() {
    const dish = String(this._draft.resteDialogDish || "").trim();
    const dayKey = this._draft.resteDialogDayKey;
    const portionen = String(this._draft.resteDialogPort || "1").trim() || "1";
    const ort = String(this._draft.resteDialogOrt || "Kühlschrank");
    const ablauf = String(this._draft.resteDialogAblauf || this._defaultAblaufForOrt(ort)).trim();

    await this._callPlanner("reste_hinzufuegen", { gericht_name: dish, portionen, ort, ablauf_datum: ablauf });

    if (dayKey) {
      this._draft.uiResteBookedDays = this._draft.uiResteBookedDays || {};
      this._draft.uiResteBookedDays[dayKey] = true;
    }

    // Wenn der Dialog aus dem Abendessen-Pool kam: optional nach Einbuchen direkt aus dem Pool entfernen.
    // So bleibt der Pool sauber, ohne dass du extra "X" drücken musst.
    const fromAbend = String(this._draft.resteDialogSource || "") === "abend";
    const dishToRemove = dish;

    this._draft.resteDialogOpen = false;
    this._draft.resteDialogDish = "";
    this._draft.resteDialogDayKey = null;
    this._draft.resteDialogSource = "";

    if (fromAbend && dishToRemove) {
      await this._callPlanner("abendessen_entfernen", this._planPayload({ gericht_name: dishToRemove }));
    }

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
      await Promise.all([this._refreshDishesNow(), this._loadPlansFallback()]);
      await this._hass
        .callService("homeassistant", "update_entity", {
          entity_id: ["sensor.essen_wochenplan", "sensor.essen_gerichte", "sensor.essen_reste"],
        })
        .catch(() => undefined);

      // Wenn Services Reste verändern, sind die neuen Daten sofort im JSON unter /local/…
      // Wir laden das hier nach, damit UI-Buttons (Löschen) sichtbar wirken.
      this._draft.resteLoaded = false;
      await this._loadResteFallback();

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
    return dishes
      .map(
        (dish) => `
      <button class="dish-list-item ${Number(this._draft.editId) === Number(dish.id) ? "selected" : ""}" data-action="select-dish" data-id="${this._escape(dish.id)}">
        <span>${this._escape(dish.name)}</span>
        <small>ID ${this._escape(dish.id)} · K${this._escape(dish.klasse)}</small>
      </button>
    `
      )
      .join("");
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
    list.innerHTML = this._dayPickerListHtml(
      this._filteredDishes(this._draft.pickerSearch || ""),
      this._draft.pickerDay
    );
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
    return [
      "edit-search", "day-picker-search", "day-input", "new-name", "edit-name",
      "reste-dialog-port", "reste-dialog-ablauf", "reste-name", "reste-port",
      "reste-ablauf", "abend-name", "reste-port-set", "abend-picker-search"
    ].includes(role) ? role : null;
  }

  _searchText(value) {
    return String(value || "")
      .toLocaleLowerCase("de")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  async _fetchDishesFallback() {
    const response = await fetch(`/local/essen-gerichte.json?v=${Date.now()}`, { cache: "no-store" });
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
        // retry
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
      window.localStorage.setItem(
        "essen-planer-active-dishes",
        JSON.stringify({ revision, dishes: dishes || [] })
      );
    } catch (error) {
      // ignore
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
    const normalize = (path) => String(path || "").replace(/\/+$/, "") || "/";
    return normalize(window.location.pathname) === normalize(this._viewPath(view));
  }

  _notify(message) {
    this.dispatchEvent(
      new CustomEvent("hass-notification", {
        detail: { message },
        bubbles: true,
        composed: true,
      })
    );
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
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  _styles() {
    return `
      :host {
        display: block;
        --ep-gap: 24px;
        --ep-pad: 26px;
        --ep-radius: 6px;
        --ep-tap: 44px;
        -webkit-tap-highlight-color: transparent;
      }
      ha-card {
        overflow: hidden;
      }

      .plan-tabs { display:flex; gap:8px; margin-top: 10px; flex-wrap: wrap; }
      .plan-tab { font: inherit; border:1px solid var(--divider-color); background: var(--card-background-color); border-radius: 999px; padding: 6px 12px; cursor:pointer; font-weight: 800; min-height: var(--ep-tap); }
      .plan-tab.active { border-color: var(--primary-color); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--primary-color) 55%, transparent); }

      .day-row--grey .dish-input { background: var(--secondary-background-color); opacity: 0.55; }
      .day-row--grey .day-name, .day-row--grey .day-date { opacity: 0.7; }
      .day-row--grey .icon-button, .day-row--grey .plain-button { opacity: 0.65; }

      .modal-backdrop { position: fixed; inset: 0; z-index: 9999; display:flex; align-items:center; justify-content:center; padding:18px; background: rgba(0,0,0,.5); box-sizing:border-box; }
      .dish-picker-dialog { width: min(620px, 100%); max-height: min(720px, 88vh); display:flex; flex-direction:column; gap:12px; padding:16px; background: var(--card-background-color); border:1px solid var(--divider-color); border-radius: var(--ep-radius); box-sizing:border-box; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
      .picker-head { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:18px; }
      .picker-list { max-height:480px; overflow:auto; border:1px solid var(--divider-color); border-radius:4px; }
      .reste-dialog-body { display:grid; gap: 10px; }
      .reste-dialog-name { font-size: 18px; font-weight: 800; }

      /* Abend-Liste – Mittag-Stil */
      .abend-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
      .abend-row {
        display: grid;
        grid-template-columns: 36px minmax(180px, 1fr) 44px 44px;
        gap: 10px;
        align-items: center;
      }
      .abend-num {
        font-size: 16px;
        font-weight: 700;
        color: var(--secondary-text-color);
        text-align: right;
        padding-right: 4px;
      }
      .abend-name {
        background: var(--secondary-background-color);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: inherit;
        font-weight: 700;
        font-style: italic;
        min-height: 44px;
        display: flex;
        align-items: center;
        box-sizing: border-box;
      }

      /* Reste-Liste Header */
      .reste-list-header {
        display: grid;
        grid-template-columns: 56px 1fr;
        gap: 12px;
        padding: 4px 0 2px;
        border-bottom: 1px solid var(--divider-color);
        margin-bottom: 4px;
      }
      .reste-header-haltbar {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--secondary-text-color);
        text-align: center;
      }

      .shell {
        display: grid;
        grid-template-columns: 230px minmax(0, 1fr);
        gap: var(--ep-gap);
        padding: var(--ep-pad);
        box-sizing: border-box;
        min-height: 520px;
      }
      .sidebar {
        display: flex;
        flex-direction: column;
        gap: var(--ep-gap);
        padding-top: 18px;
      }
      .side-button,
      .plain-button,
      .icon-button,
      .dish-list-item {
        font: inherit;
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color);
        background: var(--card-background-color);
        border-radius: var(--ep-radius);
        cursor: pointer;
      }
      .side-button {
        min-height: var(--ep-tap);
        font-size: 18px;
        font-weight: 700;
        padding: 0 14px;
      }
      .side-button.active {
        border-color: var(--primary-color);
        box-shadow: inset 4px 0 0 var(--primary-color);
      }
      .panel {
        position: relative;
        border: 1px solid var(--divider-color);
        border-radius: 2px;
        padding: 34px 16px 18px;
        min-height: 360px;
      }
      .tab-label {
        position: absolute;
        top: -11px;
        left: 0;
        padding: 1px 8px;
        background: var(--card-background-color);
        border: 1px solid var(--divider-color);
        font-size: 12px;
      }
      .plan-head {
        margin-bottom: 12px;
      }
      .kw-line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        color: var(--primary-color);
        font-size: 18px;
        font-weight: 700;
      }
      .pipe {
        color: var(--primary-color);
      }
      .selected-week {
        min-width: 122px;
        text-align: center;
      }
      .week-button {
        width: 40px;
        min-height: var(--ep-tap);
      }
      .plan-select,
      .text-input {
        color: var(--primary-text-color);
        background: var(--secondary-background-color);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        min-height: var(--ep-tap);
        padding: 8px 10px;
        box-sizing: border-box;
        font: inherit;
      }
      .plan-select {
        min-width: 160px;
        font-weight: 700;
      }
      .plain-button {
        min-height: var(--ep-tap);
        padding: 0 18px;
        font-weight: 700;
      }
      .plain-button.primary {
        border-color: var(--primary-color);
      }
      .danger-button {
        color: var(--error-color, #db4437);
      }
      .days {
        display: flex;
        flex-direction: column;
        gap: 11px;
        margin-top: 8px;
      }
      .plan-notice {
        margin: 0 0 14px;
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, var(--primary-color) 45%, var(--divider-color));
        border-radius: 10px;
        color: var(--secondary-text-color);
        background: color-mix(in srgb, var(--primary-color) 8%, transparent);
        font-weight: 600;
      }
      .day-row {
        display: grid;
        grid-template-columns: 120px 64px minmax(180px, 1fr) 44px 44px 44px;
        gap: 10px;
        align-items: center;
      }
      .day-name,
      .day-date {
        font-size: 18px;
        font-weight: 700;
      }
      .dish-input,
      .name-box {
        width: 100%;
        color: var(--primary-text-color);
        background: var(--secondary-background-color);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        box-sizing: border-box;
        font: inherit;
      }
      .dish-input {
        min-height: var(--ep-tap);
        padding: 10px 12px;
        font-style: italic;
        font-weight: 700;
      }
      .icon-button {
        width: var(--ep-tap);
        height: var(--ep-tap);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .icon-button ha-icon {
        color: var(--secondary-text-color);
      }
      .icon-button:disabled {
        cursor: default;
        opacity: 0.35;
      }
      .icon-button.danger ha-icon,
      .danger {
        color: var(--error-color, #db4437);
      }
      .empty-plan {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 80px 20px;
        text-align: center;
        color: var(--secondary-text-color);
      }
      .form-panel {
        max-width: 720px;
      }
      .field-label {
        display: block;
        margin: 0 0 8px;
        font-weight: 700;
      }
      .name-box {
        min-height: 84px;
        padding: 10px;
        font-size: 18px;
        font-weight: 700;
        resize: vertical;
      }
      .radio-group {
        display: grid;
        gap: 12px;
        margin: 28px 0 10px;
      }
      .radio-line {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 700;
      }
      .radio-line input {
        accent-color: var(--primary-color);
      }
      .class-help {
        min-height: 24px;
        color: var(--secondary-text-color);
        margin: 12px 0 24px;
      }
      .form-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        justify-content: flex-end;
      }

      /* --- Responsive / Mobile --- */
      @media (max-width: 900px) {
        :host { --ep-gap: 16px; --ep-pad: 16px; }
        .shell { grid-template-columns: 1fr; min-height: unset; }
        .sidebar { flex-direction: row; padding-top: 0; gap: 10px; flex-wrap: wrap; }
        .side-button { flex: 1 1 160px; }
        .panel { padding: 34px 12px 14px; }
      }

      @media (max-width: 600px) {
        :host { --ep-gap: 12px; --ep-pad: 12px; }
        .kw-line { font-size: 16px; gap: 10px; }
        .selected-week { min-width: unset; }

        .day-row {
          grid-template-columns: 1fr 1fr;
          grid-template-areas:
            "name date"
            "input input"
            "btn1 btn2"
            "btn3 btn4";
          gap: 10px;
          padding: 10px;
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          background: color-mix(in srgb, var(--card-background-color) 92%, transparent);
        }
        .day-name { grid-area: name; }
        .day-date { grid-area: date; text-align: right; }
        .dish-input { grid-area: input; }
        .day-row .icon-button:nth-of-type(1) { grid-area: btn1; width: 100%; }
        .day-row .icon-button:nth-of-type(2) { grid-area: btn2; width: 100%; }
        .day-row .icon-button:nth-of-type(3) { grid-area: btn3; width: 100%; }
        .day-row .icon-button:nth-of-type(4) { grid-area: btn4; width: 100%; }

        .plan-tabs { gap: 10px; }
        .plan-tab { flex: 1 1 90px; justify-content: center; }

        .dish-picker-dialog {
          width: 100%;
          max-height: 92vh;
          border-radius: 14px;
        }
        .picker-list { max-height: 52vh; }

        .edit-grid { grid-template-columns: 1fr; }
        .dish-list { max-height: 44vh; }

        .abend-add, .reste-add { align-items: stretch; }
        .abend-add .text-input, .reste-add .text-input, .reste-add .plan-select { flex: 1 1 100%; min-width: 0; }
        .reste-add .text-input.small { max-width: 120px; }
      }

      @media (prefers-reduced-motion: reduce) {
        * { scroll-behavior: auto !important; }
      }

      :focus-visible {
        outline: 3px solid color-mix(in srgb, var(--primary-color) 65%, transparent);
        outline-offset: 2px;
      }

      .edit-grid {
        display: grid;
        grid-template-columns: minmax(220px, 320px) minmax(320px, 1fr);
        gap: 24px;
      }
      .dish-list {
        margin-top: 10px;
        max-height: 360px;
        overflow: auto;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
      }
      .dish-list-item {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 3px;
        padding: 9px 10px;
        border-width: 0 0 1px;
        border-radius: 0;
        text-align: left;
      }
      .dish-list-item.selected {
        background: color-mix(in srgb, var(--primary-color) 18%, transparent);
      }
      .dish-list-item small {
        color: var(--secondary-text-color);
      }

      .reste-subpanel .reste-item { display:flex; gap: 12px; align-items:flex-start; padding: 10px 0; border-bottom: 1px solid var(--divider-color); }
      .badge { display:inline-flex; align-items:center; justify-content:center; min-width: 44px; height: 24px; border-radius: 999px; font-weight: 900; font-size: 12px; border: 1px solid var(--divider-color); }
      .badge-good { background: color-mix(in srgb, #2e7d32 18%, transparent); color: #2e7d32; }
      .badge-ok { background: color-mix(in srgb, #2e7d32 10%, transparent); color: #2e7d32; }
      .badge-warn { background: color-mix(in srgb, #f9a825 18%, transparent); color: #f9a825; }
      .badge-bad { background: color-mix(in srgb, #c62828 18%, transparent); color: #c62828; }
      .badge-neutral { background: color-mix(in srgb, var(--secondary-text-color) 10%, transparent); color: var(--secondary-text-color); }
      .reste-text { display:flex; flex-direction:column; gap:6px; min-width: 0; }
      .reste-meta { display:flex; flex-wrap: wrap; gap: 8px; color: var(--secondary-text-color); font-weight: 700; }
      .reste-controls { display:flex; align-items:center; justify-content:space-between; gap: 10px; margin-top: 6px; }
      .reste-port-label { color: var(--secondary-text-color); font-weight: 800; font-size: 12px; letter-spacing: .02em; text-transform: uppercase; }
      .stepper { display:flex; align-items:center; gap: 10px; padding: 6px; border: 1px solid var(--divider-color); border-radius: 999px; background: color-mix(in srgb, var(--secondary-background-color) 85%, transparent); }
      .stepper-input { width: 64px; min-width: 64px; text-align:center; font-weight: 900; font: inherit; color: var(--primary-text-color); background: transparent; border: 0; outline: none; padding: 0; }
      .stepper-input:focus { outline: none; }
      .stepper .icon-button { width: 38px; height: 38px; border-radius: 999px; }
      .stepper .icon-button ha-icon { color: var(--primary-text-color); }

      .subpanel { padding-top: 6px; }
      .subhead { margin-bottom: 10px; }
      .abend-add, .reste-add { display:flex; flex-wrap: wrap; gap: 10px; align-items:center; margin-bottom: 12px; }
      .abend-item, .reste-item { display:flex; align-items:flex-start; justify-content:space-between; gap: 10px; }
      .hint-line { color: var(--secondary-text-color); font-weight: 700; margin: 6px 0 10px; }
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
