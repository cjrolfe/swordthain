document.getElementById("lu").textContent = new Date().toISOString().slice(0, 10);

(function () {
  var COMPANY_ID = document.body.dataset.companyId || "";
  var API_BASE = window.SWORDTHAIN_API || "";
  var projectCardsEl = document.getElementById("projectCards");

  // Reads the swordthain_session cookie set by apps/media-app on
  // .swordthain.com (see apps/media-app/src/auth.ts) and returns it as a
  // Bearer token header for the API's Cognito authorizer (see
  // infra/lib/playground-stack.ts). Same helper as assets/app.js — this
  // page is a separate script context (a generated company subpage), so
  // it can't just import that one.
  function authHeader() {
    var match = document.cookie.match(/(?:^|;\s*)swordthain_session=([^;]+)/);
    return match ? { Authorization: "Bearer " + decodeURIComponent(match[1]) } : {};
  }

  function renderProjects(projects) {
    if (!projectCardsEl) return;
    if (!projects || projects.length === 0) {
      projectCardsEl.innerHTML = '<div class="card"><p style="margin:0;">No projects yet. Click “Add project” above.</p></div>';
      return;
    }
    projectCardsEl.innerHTML = projects.map(function (p) {
      return '<article class="card">'
        + '<div class="card-head"><div>'
        + '<h3>' + p.name + '</h3>'
        + '<div style="opacity:.7;font-size:12px;">/' + COMPANY_ID + '/' + p.id + '/</div>'
        + '</div></div>'
        + (p.description ? '<p>' + p.description + '</p>' : '')
        + '<div class="row row-actions">'
        + '<span class="tag">Project</span>'
        + '<a class="btn" href="/' + COMPANY_ID + '/' + p.id + '/index.html">Open</a>'
        + (API_BASE ? '<button type="button" class="btn ghost btn-delete-project" data-project-id="' + p.id + '">Delete</button>' : '')
        + '</div>'
        + '</article>';
    }).join('');

    projectCardsEl.querySelectorAll(".btn-delete-project").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var projectId = btn.dataset.projectId;
        if (!confirm('Permanently delete project "' + projectId + '"? This cannot be undone.')) return;
        btn.disabled = true;
        btn.textContent = "...";
        fetch(API_BASE + "/project/delete", {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, authHeader()),
          body: JSON.stringify({ companyId: COMPANY_ID, projectId: projectId }),
        })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (r) {
          if (!r.ok) throw new Error(r.data.error || "Request failed");
          loadProjects();
        })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = "Delete";
          alert(e.message || "Request failed");
        });
      });
    });
  }

  function loadProjects() {
    if (!projectCardsEl) return;
    projectCardsEl.innerHTML = '<div class="card skeleton"></div>';
    fetch("/assets/sites.json?v=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var site = (data.sites || []).find(function (s) { return s.id === COMPANY_ID; });
        renderProjects(site && Array.isArray(site.projects) ? site.projects : []);
      })
      .catch(function () {
        if (projectCardsEl) projectCardsEl.innerHTML = '<div class="card"><p style="margin:0;">Could not load projects.</p></div>';
      });
  }

  // Modal logic
  var modal = document.getElementById("addProjectModal");
  var openBtn = document.getElementById("openAddProject");
  var closeBtn = document.getElementById("closeAddProject");
  var form = document.getElementById("addProjectForm");
  var submitBtn = document.getElementById("addProjectSubmit");
  var nameEl = document.getElementById("projectName");
  var descEl = document.getElementById("projectDescription");
  var nameErrorEl = document.getElementById("projectNameError");
  var dialog = modal && modal.querySelector(".modal");
  var lastFocused = null;

  function getFocusable() {
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); });
  }

  function setOpen(isOpen) {
    if (!modal) return;
    modal.hidden = !isOpen;
    document.body.classList.toggle("modal-open", isOpen);
    if (isOpen) {
      lastFocused = document.activeElement;
      if (nameErrorEl) nameErrorEl.textContent = "";
      if (form) form.reset();
      setTimeout(function () { if (nameEl) nameEl.focus(); }, 0);
    } else {
      if (lastFocused && lastFocused.focus) setTimeout(function () { lastFocused.focus(); }, 0);
      lastFocused = null;
    }
  }

  if (openBtn) openBtn.addEventListener("click", function () { setOpen(true); });
  if (closeBtn) closeBtn.addEventListener("click", function () { setOpen(false); });
  if (modal) modal.addEventListener("click", function (e) { if (e.target === modal) setOpen(false); });

  if (modal) {
    modal.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
      if (e.key !== "Tab") return;
      var focusables = getFocusable();
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
    });
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (nameErrorEl) nameErrorEl.textContent = "";
      if (nameEl) nameEl.removeAttribute("aria-invalid");

      var name = (nameEl ? nameEl.value : "").trim();
      if (!name) {
        if (nameErrorEl) nameErrorEl.textContent = "Please enter a project name.";
        if (nameEl) { nameEl.setAttribute("aria-invalid", "true"); nameEl.focus(); }
        return;
      }
      if (!API_BASE) { alert("API is not configured."); return; }

      var origLabel = submitBtn ? submitBtn.textContent : "Create";
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Creating…"; }

      fetch(API_BASE + "/project/create", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, authHeader()),
        body: JSON.stringify({
          companyId: COMPANY_ID,
          name: name,
          description: (descEl ? descEl.value : "").trim(),
        }),
      })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.error || "Request failed");
        setOpen(false);
        loadProjects();
      })
      .catch(function (err) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origLabel; }
        if (nameErrorEl) nameErrorEl.textContent = err.message || "Request failed";
      });
    });
  }

  setOpen(false);
  loadProjects();
})();
