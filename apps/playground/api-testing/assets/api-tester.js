// Same pattern as apps/playground/assets/app.js's authHeaders() — reads the
// swordthain_session cookie set by apps/media-app on .swordthain.com and
// attaches it as a Bearer token for the API's Cognito authorizer.
function authHeaders() {
  const match = document.cookie.match(/(?:^|;\s*)swordthain_session=([^;]+)/);
  return match ? { Authorization: `Bearer ${decodeURIComponent(match[1])}` } : {};
}

(function () {
  const config = window.API_TESTING_CONFIG;
  if (!config) return;

  const API_BASE = window.SWORDTHAIN_API || "";
  const endpointSelect = document.getElementById("endpointSelect");
  const formEl = document.getElementById("paramForm");
  const paramsContainer = document.getElementById("paramsContainer");
  const sendBtn = document.getElementById("sendBtn");
  const responseEl = document.getElementById("response");
  const responseMetaEl = document.getElementById("responseMeta");

  document.getElementById("apiTitle").textContent = config.title;
  document.getElementById("apiDescription").textContent = config.description;

  // Group endpoint indices by folder (if any have one) for <optgroup>s in
  // the select. Indices, not ep.id, are used as option values — two
  // endpoints can share an id when they target different providers (e.g.
  // VES's UAT vs Production), so id alone isn't guaranteed unique per page.
  const groups = new Map();
  config.endpoints.forEach((ep, index) => {
    const key = ep.folder || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });

  for (const [folder, indices] of groups) {
    const parent = folder
      ? endpointSelect.appendChild(Object.assign(document.createElement("optgroup"), { label: folder }))
      : endpointSelect;
    for (const index of indices) {
      const opt = document.createElement("option");
      opt.value = String(index);
      opt.textContent = config.endpoints[index].name;
      parent.appendChild(opt);
    }
  }

  function currentEndpoint() {
    return config.endpoints[Number(endpointSelect.value)];
  }

  function renderParamFields() {
    const ep = currentEndpoint();
    paramsContainer.innerHTML = "";
    if (!ep) return;

    const allParams = [
      ...ep.pathParams.map((key) => ({ key, kind: "path", required: true })),
      ...ep.queryParams.map((p) => ({ ...p, kind: "query" })),
      ...(ep.bodyParams || []).map((p) => ({ ...p, kind: "body" })),
    ];

    if (allParams.length === 0) {
      paramsContainer.innerHTML = `<p class="muted">This endpoint takes no parameters.</p>`;
      return;
    }

    for (const p of allParams) {
      const label = document.createElement("label");
      label.className = "field";
      label.innerHTML = `
        <span>${p.key}${p.required ? " *" : ""} <span class="muted">(${p.kind})</span></span>
        <input class="search" type="text" name="${p.key}" value="${p.example || ""}" />
      `;
      paramsContainer.appendChild(label);
    }
  }

  endpointSelect.addEventListener("change", renderParamFields);
  renderParamFields();

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ep = currentEndpoint();
    if (!ep || !API_BASE) return;

    const params = {};
    for (const input of paramsContainer.querySelectorAll("input")) {
      if (input.value.trim()) params[input.name] = input.value.trim();
    }

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    responseEl.textContent = "";
    responseMetaEl.textContent = "";

    try {
      const res = await fetch(`${API_BASE}/api-testing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ provider: ep.provider || config.provider, endpointId: ep.id, params }),
      });
      const data = await res.json().catch(() => ({}));
      responseMetaEl.textContent = `Status: ${res.status}`;
      responseMetaEl.className = res.ok ? "pill" : "pill field-error";
      responseEl.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
      responseMetaEl.textContent = "Request failed";
      responseMetaEl.className = "pill field-error";
      responseEl.textContent = err.message || String(err);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send request";
    }
  });
})();
