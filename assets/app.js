// Shared state — accessible to both the list logic and the create modal
let sites = [];
let _searchEl = null;
let _cardsEl = null;
let _archivedCountEl = null;
const _isArchivedView = (document.body?.dataset?.view || "active").toLowerCase() === "archived";

function updateArchivedCount() {
  if (!_archivedCountEl) return;
  const count = sites.filter(s => !!s.archived).length;
  _archivedCountEl.textContent = `Archived: ${count}`;
  _archivedCountEl.style.display = count > 0 ? "" : "none";
}

function render(filterText) {
  const cardsEl = _cardsEl;
  if (!cardsEl) return;

  const q = (filterText || "").toLowerCase();
  const API_BASE = window.SWORDTHAIN_API || "";

  const subset = sites.filter(s => _isArchivedView ? !!s.archived : !s.archived);
  const filtered = subset.filter(s => {
    const hay = `${s.name} ${s.description} ${s.tag} ${s.id}`.toLowerCase();
    return hay.includes(q);
  });

  if (filtered.length === 0) {
    cardsEl.innerHTML = `<div class="card"><h3>No ${_isArchivedView ? "archived" : "active"} companies found</h3></div>`;
    return;
  }

  cardsEl.innerHTML = filtered.map(s => {
    const action = _isArchivedView ? "restore" : "archive";
    const actionLabel = _isArchivedView ? "Restore" : "Archive";

    const archiveBtn = API_BASE
      ? `<button type="button" class="btn ghost btn-archive" data-action="${action}" data-company-id="${s.id}">${actionLabel}</button>`
      : ``;

    const deleteBtn = _isArchivedView && s.id !== "company-template" && API_BASE
      ? `<button type="button" class="btn ghost btn-delete" data-company-id="${s.id}">Delete</button>`
      : ``;

    return `
      <article class="card">
        <div class="card-head">
          <img class="logo" src="${s.logoUrl}" alt="${s.name} logo" />
          <div>
            <h3>${s.name}</h3>
            <div style="opacity:.7;font-size:12px;">/${s.id}/</div>
          </div>
        </div>
        <p>${s.description || ""}</p>
        <div class="row row-actions">
          <span class="tag">${s.tag || "Demo"}</span>
          ${!_isArchivedView ? `<a class="btn" href="${s.path}index.html">Open</a>` : ""}
          ${archiveBtn}
          ${deleteBtn || ""}
        </div>
      </article>
    `;
  }).join("");

  // Archive / Restore buttons
  cardsEl.querySelectorAll(".btn-archive").forEach(btn => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const companyId = btn.dataset.companyId;
      btn.disabled = true;
      btn.textContent = "...";
      try {
        const res = await fetch(`${API_BASE}/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, companyId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

        const archived = action === "archive";
        sites = sites.map(s => s.id === companyId ? { ...s, archived } : s);
        render(_searchEl?.value || "");
        updateArchivedCount();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = action === "restore" ? "Restore" : "Archive";
        alert(e.message || "Request failed");
      }
    });
  });

  // Delete buttons
  cardsEl.querySelectorAll(".btn-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const companyId = btn.dataset.companyId;
      if (!confirm(`Permanently delete ${companyId}? This cannot be undone.`)) return;
      btn.disabled = true;
      btn.textContent = "...";
      try {
        const res = await fetch(`${API_BASE}/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", companyId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

        sites = sites.filter(s => s.id !== companyId);
        render(_searchEl?.value || "");
        updateArchivedCount();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Delete";
        alert(e.message || "Request failed");
      }
    });
  });
}


// ===== Landing + Archived list logic =====
(async function () {
  _cardsEl = document.getElementById("cards");
  _archivedCountEl = document.getElementById("archivedCount");
  _searchEl = document.getElementById("search");

  const updatedEl = document.getElementById("updated");
  const yearEl = document.getElementById("year");

  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  try {
    const res = await fetch(`/assets/sites.json?v=${Date.now()}`);
    const data = await res.json();
    if (updatedEl) updatedEl.textContent = `Updated: ${data.updated || "—"}`;
    sites = Array.isArray(data.sites) ? data.sites : [];
    updateArchivedCount();
  } catch (e) {
    if (_cardsEl) _cardsEl.innerHTML = `<div class="card"><h3>Couldn't load site list</h3></div>`;
    return;
  }

  _searchEl?.addEventListener("input", () => render(_searchEl.value));
  render(_searchEl?.value || "");
})();


// ===== Create new company modal logic =====
(function () {
  const openBtn = document.getElementById("openCreate");
  const modal = document.getElementById("createModal");
  const closeBtn = document.getElementById("closeCreate");

  const form = document.getElementById("createCompanyForm");
  const createBtn = document.getElementById("createIssue");

  const nameEl = document.getElementById("companyName");
  const urlEl = document.getElementById("companyUrl");
  const toneEl = document.getElementById("tone");
  const demoDescEl = document.getElementById("demoDescription");

  const nameErrorEl = document.getElementById("nameError");
  const urlErrorEl = document.getElementById("urlError");

  const dialog = modal?.querySelector?.(".modal");
  const API_BASE = window.SWORDTHAIN_API || "";

  if (!openBtn || !modal || !closeBtn || !form || !createBtn || !nameEl || !demoDescEl || !dialog) return;

  let lastFocused = null;

  function getFocusable() {
    const focusables = dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    return Array.from(focusables).filter((el) => {
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    });
  }

  function clearErrors() {
    if (nameErrorEl) nameErrorEl.textContent = "";
    if (urlErrorEl) urlErrorEl.textContent = "";
    nameEl.removeAttribute("aria-invalid");
    urlEl?.removeAttribute("aria-invalid");
  }

  function normalizeUrl(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return "";
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let parsed;
    try {
      parsed = new URL(withScheme);
    } catch (e) {
      return null;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  }

  function validate() {
    clearErrors();
    const rawName = (nameEl.value || "").trim();
    const rawUrl = (urlEl?.value || "").trim();

    if (!rawName) {
      if (nameErrorEl) nameErrorEl.textContent = "Please enter a company name.";
      nameEl.setAttribute("aria-invalid", "true");
      nameEl.focus();
      return null;
    }

    const normalizedUrl = normalizeUrl(rawUrl);
    if (rawUrl && !normalizedUrl) {
      if (urlErrorEl) urlErrorEl.textContent = "That doesn't look like a valid website address.";
      urlEl?.setAttribute("aria-invalid", "true");
      urlEl?.focus();
      return null;
    }

    return {
      name: rawName,
      url: normalizedUrl || "",
      tone: (toneEl?.value || "Professional").trim(),
      demoDescription: (demoDescEl?.value || "").trim(),
    };
  }

  function setOpen(isOpen) {
    modal.hidden = !isOpen;
    document.body.classList.toggle("modal-open", isOpen);

    if (isOpen) {
      lastFocused = document.activeElement;
      clearErrors();
      setTimeout(() => nameEl.focus(), 0);
    } else {
      clearErrors();
      if (lastFocused && typeof lastFocused.focus === "function") {
        setTimeout(() => lastFocused.focus(), 0);
      }
      lastFocused = null;
    }
  }

  setOpen(false);

  openBtn.addEventListener("click", () => setOpen(true));
  closeBtn.addEventListener("click", () => setOpen(false));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) setOpen(false);
  });

  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key !== "Tab") return;

    const focusables = getFocusable();
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const data = validate();
    if (!data) return;

    if (!API_BASE) {
      alert("API is not configured. Set window.SWORDTHAIN_API.");
      return;
    }

    const origLabel = createBtn.textContent;
    createBtn.disabled = true;
    createBtn.textContent = "Creating…";

    try {
      const res = await fetch(`${API_BASE}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          website: data.url || "",
          tone: data.tone,
          demoDescription: data.demoDescription || "",
        }),
      });

      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(result.error || `Request failed (${res.status})`);
      }

      // Add new entry to local state and re-render immediately
      const S3_BASE = "https://sfdcdemoimages.s3.eu-west-1.amazonaws.com";
      sites.push({
        id: result.companyId,
        name: data.name,
        path: `/${result.companyId}/`,
        description: data.demoDescription || "",
        tag: "Demo",
        logoUrl: `${S3_BASE}/${result.companyId}/logo.png`,
        archived: false,
        projects: [],
      });

      setOpen(false);
      form.reset();
      if (_searchEl) _searchEl.value = "";
      render("");
      updateArchivedCount();
    } catch (err) {
      createBtn.disabled = false;
      createBtn.textContent = origLabel;
      const msg = err.message || "Request failed";
      if (nameErrorEl) nameErrorEl.textContent = msg + (msg.includes("fetch") ? " Check API URL and CORS." : "");
    }
  });
})();
