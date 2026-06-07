class EssenPlanerCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this.mode = this.config.mode || "plan";
    this._draft = this._draft || {};
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
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
    this._render();
  }

  getCardSize() {
    return this.mode === "plan" ? 8 : 7;
  }

  _ensureDraftDefaults() {
    const current = this._currentIsoWeek();
    const plan = this._planAttrs();
    if (this._draft.planYear == null) this._draft.planYear = plan.year || current.year;
    if (this._draft.planWeek == null) this._draft.planWeek = plan.week || current.week;
    if (this._draft.planTarget == null) this._draft.planTarget = "next";
    if (this._draft.newClass == null) this._draft.newClass = 1;
    if (this._draft.editClass == null) this._draft.editClass = 1;
    if (this._draft.editSearch == null) this._draft.editSearch = "";
  }

  _planAttrs() {
    const sensorEntity = this._hass && this._hass.states && this._hass.states["sensor.essen_wochenplan"];
    const sensor = sensorEntity && sensorEntity.attributes ? sensorEntity.attributes : {};
    if (!this._draft.fallbackPlansLoading && !this._draft.fallbackPlansLoaded) {
      this._loadPlansFallback();
    }
    const plansData = this._draft.fallbackPlans || {};
    const plan = plansData.plans && plansData.current_plan ? plansData.plans[plansData.current_plan] : null;
    if (!plan) return sensor;
    const filled = (plan.days || []).filter((day) => day.dish_name).length;
    return {
      ...sensor,
      label: `KW ${plan.week} / ${plan.year}`,
      year: plan.year,
      week: plan.week,
      key: plan.key,
      days: plan.days || [],
      state: `KW ${plan.week} / ${plan.year}: ${filled}/7`,
    };
  }

  _dishesAttrs() {
    const sensorEntity = this._hass && this._hass.states && this._hass.states["sensor.essen_gerichte"];
    return sensorEntity && sensorEntity.attributes ? sensorEntity.attributes : {};
  }

  _activeDishes() {
    const sensorDishes = this._dishesAttrs().active_dishes || [];
    if (!this._draft.fallbackDishesLoading && !this._draft.fallbackDishesLoaded) {
      this._loadDishesFallback();
    }
    const fallbackDishes = this._draft.fallbackDishesLoaded ? this._draft.fallbackDishes || [] : [];
    const sharedDishes = this._readSharedDishes();
    const source = fallbackDishes.length ? fallbackDishes : sharedDishes.length ? sharedDishes : sensorDishes;
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

  _currentIsoWeek() {
    return this._isoWeekFromDate(new Date());
  }

  _nextIsoWeek() {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return this._isoWeekFromDate(date);
  }

  _isoWeekFromDate(sourceDate) {
    const date = new Date(Date.UTC(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return { year: date.getUTCFullYear(), week };
  }

  _selectedPlanPeriod() {
    return this._draft.planTarget === "current" ? this._currentIsoWeek() : this._nextIsoWeek();
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

  _planView() {
    const plan = this._planAttrs();
    const days = plan.days || [];
    const current = this._currentIsoWeek();
    const hasPlan = days.length > 0 && plan.key;
    return `
      <div class="shell">
        ${this._sidebar("plan")}
        <section class="panel plan-panel">
          <div class="tab-label">Wochenplan erstellen</div>
          <div class="plan-head">
            <div class="kw-line">
              <span>Aktuelle Woche: <strong>KW ${current.week}</strong></span>
              <label>Plan erstellen:</label>
              <select class="plan-select" data-role="plan-target">
                <option value="current" ${this._draft.planTarget === "current" ? "selected" : ""}>Diese Woche</option>
                <option value="next" ${this._draft.planTarget !== "current" ? "selected" : ""}>Nächste Woche</option>
              </select>
              <button class="plain-button" data-action="create-plan">Plan erstellen</button>
            </div>
          </div>
          <div class="days">
            ${
              hasPlan
                ? days.map((day) => this._dayRow(day)).join("")
                : `<div class="empty-plan">
                    <strong>Noch kein Plan angelegt.</strong>
                    <span>Wähle oben den Zeitraum aus und klicke auf „Plan erstellen“.</span>
                  </div>`
            }
          </div>
          ${this._dishPickerOverlay()}
        </section>
      </div>
    `;
  }

  _dayRow(day) {
    const draftValue = this._draft[`day-${day.key}`];
    const value = draftValue != null ? draftValue : day.dish_name || "";
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
            <button class="plain-button" data-action="go-main">Abbrechen</button>
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
        <button class="side-button ${active === "plan" ? "active" : ""}" data-action="go-main">Wochenplan erstellen</button>
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
    this.shadowRoot.querySelectorAll("input, textarea, select").forEach((element) => {
      element.addEventListener("input", (event) => this._handleInput(event));
      if (element.dataset.role === "plan-target") {
        element.addEventListener("change", (event) => this._handleInput(event));
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
    if (role === "plan-target") {
      this._draft.planTarget = target.value;
      this._render();
    }
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
    if (target.type === "radio") {
      if (target.name === "new-class") this._draft.newClass = Number(target.value);
      if (target.name === "edit-class") this._draft.editClass = Number(target.value);
      this._render();
    }
  }

  async _handleAction(event) {
    const action = event.currentTarget.dataset.action;
    const day = event.currentTarget.dataset.day;
    if (action === "go-main") return this._navigate(this._viewPath("essen"));
    if (action === "go-new") return this._navigate(this._viewPath("essen-neu"));
    if (action === "go-edit") return this._navigate(this._viewPath("essen-bearbeiten"));
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
  }

  async _createPlan() {
    const period = this._selectedPlanPeriod();
    this._draft.planYear = period.year;
    this._draft.planWeek = period.week;
    this._clearDayDrafts();
    await this._callPlanner("create_plan", {
      year: period.year,
      week: period.week,
    });
    this._clearDayDrafts();
  }

  async _rerollDay(day) {
    delete this._draft[`day-${day}`];
    const success = await this._callPlanner("reroll_day", this._planPayload({ day }));
    if (success) {
      delete this._draft[`day-${day}`];
    }
  }

  async _clearDay(day) {
    this._draft[`day-${day}`] = "";
    await this._callPlanner("clear_day", this._planPayload({ day }));
  }

  async _saveDayInput(input) {
    const day = input.dataset.day;
    const success = await this._callPlanner("set_day", this._planPayload({ day, dish_name: input.value.trim() }));
    if (success) {
      delete this._draft[`day-${day}`];
    }
  }

  _openDayPicker(day) {
    this._draft.pickerDay = day;
    this._draft.pickerSearch = "";
    this._render();
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
    const success = await this._callPlanner("add_dish", {
      name,
      klasse: Number(this._draft.newClass || 1),
    });
    if (success) {
      await this._waitForDishInFallback(name);
      this._draft.newName = "";
      this._notify("Gericht hinzugefügt.");
      this._render();
    }
  }

  _selectDishById(id) {
    const dish = this._activeDishes().find((entry) => Number(entry.id) === Number(id));
    if (dish) {
      this._selectDish(dish, true);
    }
  }

  _selectDish(dish, rerender = true) {
    this._draft.editId = Number(dish.id);
    this._draft.editName = dish.name || "";
    this._draft.editClass = Number(dish.klasse || 1);
    if (rerender) this._render();
  }

  async _saveEditDish() {
    if (!this._draft.editId) return this._notify("Bitte ein Gericht auswählen.");
    const name = String(this._draft.editName || "").trim();
    if (!name) return this._notify("Bitte einen Namen eingeben.");
    const success = await this._callPlanner("update_dish", {
      dish_id: Number(this._draft.editId),
      name,
      klasse: Number(this._draft.editClass || 1),
    });
    if (success) {
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

  async _callPlanner(service, data) {
    try {
      await this._hass.callService("essen", service, data);
      await new Promise((resolve) => setTimeout(resolve, 350));
      this._draft.fallbackDishesLoaded = false;
      this._draft.fallbackPlansLoaded = false;
      await Promise.all([
        this._loadDishesFallback(),
        this._loadPlansFallback(),
      ]);
      await this._hass.callService("homeassistant", "update_entity", {
        entity_id: ["sensor.essen_wochenplan", "sensor.essen_gerichte"],
      }).catch(() => undefined);
      return true;
    } catch (error) {
      this._notify((error && error.message) || String(error));
      return false;
    }
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
    list.innerHTML = this._editListHtml(this._filteredEditDishes());
    this._bindActions(list);
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
    return ["edit-search", "day-picker-search", "day-input", "new-name", "edit-name"].includes(role) ? role : null;
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
        if (dishes.some((dish) => this._searchText(dish.name) === wanted)) return true;
      } catch (error) {
        // Retry below; the file can briefly be between writes.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  _readSharedDishes() {
    try {
      const raw = window.localStorage.getItem("essen-planer-active-dishes");
      const data = JSON.parse(raw || "[]");
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  _writeSharedDishes(dishes) {
    try {
      window.localStorage.setItem("essen-planer-active-dishes", JSON.stringify(dishes || []));
    } catch (error) {
      // Storage can be unavailable in restricted browser modes.
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
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  _styles() {
    return `
      :host {
        display: block;
      }
      ha-card {
        overflow: hidden;
      }
      .shell {
        display: grid;
        grid-template-columns: 230px minmax(0, 1fr);
        gap: 24px;
        padding: 26px;
        box-sizing: border-box;
        min-height: 520px;
      }
      .sidebar {
        display: flex;
        flex-direction: column;
        gap: 24px;
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
        border-radius: 6px;
        cursor: pointer;
      }
      .side-button {
        min-height: 48px;
        font-size: 18px;
        font-weight: 700;
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
      .kw-line label {
        color: var(--primary-color);
      }
      .pipe {
        color: var(--primary-color);
      }
      .plan-select,
      .text-input {
        color: var(--primary-text-color);
        background: var(--secondary-background-color);
        border: 1px solid var(--divider-color);
        border-radius: 2px;
        min-height: 34px;
        padding: 4px 8px;
        box-sizing: border-box;
      }
      .plan-select {
        min-width: 160px;
        font: inherit;
        font-weight: 700;
      }
      .plain-button {
        min-height: 36px;
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
      .day-row {
        display: grid;
        grid-template-columns: 120px 64px minmax(180px, 1fr) 42px 42px 42px;
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
        border-radius: 2px;
        box-sizing: border-box;
        font: inherit;
      }
      .dish-input {
        min-height: 38px;
        padding: 6px 10px;
        font-style: italic;
        font-weight: 700;
      }
      .icon-button {
        width: 38px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .icon-button ha-icon {
        color: var(--secondary-text-color);
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
      .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10;
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
      .empty-list {
        padding: 18px;
        color: var(--secondary-text-color);
      }
      @media (max-width: 760px) {
        .shell {
          grid-template-columns: 1fr;
          padding: 14px;
        }
        .sidebar {
          display: grid;
          grid-template-columns: 1fr;
          padding-top: 0;
          gap: 10px;
        }
        .day-row {
          grid-template-columns: 1fr repeat(3, 42px);
        }
        .day-name {
          grid-column: 1 / 2;
        }
        .day-date {
          grid-column: 2 / -1;
          justify-self: end;
        }
        .dish-input {
          grid-column: 1 / -1;
        }
        .edit-grid {
          grid-template-columns: 1fr;
        }
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
  name: "Essensplanung",
  description: "Essensplaner mit Wochenplan, Gerichten und Regeln",
});
