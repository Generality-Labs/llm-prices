const API = "/api";
const PAGE_SIZE = 50;
let allModels = [];
let filteredModels = [];
let currentPage = 0;
let sortCol = "input_cost_per_token";
let sortDir = "asc";
const activeCapabilities = new Set();

const COLUMNS = [
  { key: "key", label: "Model", cls: "model-name" },
  { key: "litellm_provider", label: "Provider" },
  { key: "mode", label: "Mode" },
  {
    key: "input_cost_per_token",
    label: "Input $/1M",
    cls: "cost cost-input",
    format: costPerMillion,
  },
  {
    key: "output_cost_per_token",
    label: "Output $/1M",
    cls: "cost cost-output",
    format: costPerMillion,
  },
  { key: "max_input_tokens", label: "Context", format: formatTokens },
  { key: "max_output_tokens", label: "Max Output", format: formatTokens },
  { key: "_capabilities", label: "Capabilities", sortable: false },
];

const CAPABILITIES = [
  { key: "supports_function_calling", label: "Tools", cls: "tools" },
  { key: "supports_vision", label: "Vision", cls: "vision" },
  { key: "supports_reasoning", label: "Reasoning", cls: "reasoning" },
  { key: "supports_prompt_caching", label: "Caching", cls: "caching" },
];

function costPerMillion(v) {
  if (v == null || v === undefined) return "—";
  const m = v * 1_000_000;
  if (m < 0.01) return `$${m.toFixed(4)}`;
  if (m < 1) return `$${m.toFixed(3)}`;
  return `$${m.toFixed(2)}`;
}

function formatTokens(v) {
  if (!v) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

async function init() {
  const [modelsResp, providersResp, modesResp, metaResp] = await Promise.all([
    fetch(`${API}/models?limit=10000`).then((r) => r.json()),
    fetch(`${API}/providers`).then((r) => r.json()),
    fetch(`${API}/modes`).then((r) => r.json()),
    fetch(`${API}/meta`).then((r) => r.json()),
  ]);

  allModels = modelsResp.data || [];

  // Populate providers
  const provSelect = document.getElementById("provider");
  for (const p of providersResp.providers || []) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    provSelect.appendChild(opt);
  }

  // Populate modes
  const modeSelect = document.getElementById("mode");
  for (const m of modesResp.modes || []) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modeSelect.appendChild(opt);
  }

  // Meta
  if (metaResp.updated_at) {
    document.getElementById("meta").textContent =
      `Updated: ${new Date(metaResp.updated_at).toLocaleString()}`;
  }

  // Capability pills
  const pillBar = document.getElementById("capabilities");
  for (const cap of CAPABILITIES) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = cap.label;
    pill.dataset.key = cap.key;
    pill.addEventListener("click", () => {
      pill.classList.toggle("active");
      if (activeCapabilities.has(cap.key)) activeCapabilities.delete(cap.key);
      else activeCapabilities.add(cap.key);
      applyFilters();
    });
    pillBar.appendChild(pill);
  }

  renderHeader();
  applyFilters();

  document.getElementById("search").addEventListener("input", debounce(applyFilters, 200));
  document.getElementById("provider").addEventListener("change", applyFilters);
  document.getElementById("mode").addEventListener("change", applyFilters);
}

function escapeRegex(s) {
  return s.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
}

function buildMatchers(q) {
  if (!q) return [];
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => {
      if (term.indexOf("*") >= 0) {
        const parts = term.split("*").map(escapeRegex);
        const re = new RegExp(parts.join(".*"));
        return (s) => re.test(s);
      }
      return (s) => s.indexOf(term) >= 0;
    });
}

function applyFilters() {
  const q = document.getElementById("search").value;
  const provider = document.getElementById("provider").value;
  const mode = document.getElementById("mode").value;
  const matchers = buildMatchers(q);

  filteredModels = allModels.filter((m) => {
    if (matchers.length) {
      const haystack = `${m.key.toLowerCase()} ${(m.litellm_provider || "").toLowerCase()}`;
      if (!matchers.every((fn) => fn(haystack))) return false;
    }
    if (provider && m.litellm_provider !== provider) return false;
    if (mode && m.mode !== mode) return false;
    for (const cap of activeCapabilities) {
      if (!m[cap]) return false;
    }
    return true;
  });

  // Sort
  filteredModels.sort((a, b) => {
    const va = a[sortCol];
    const vb = b[sortCol];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sortDir === "asc" ? cmp : -cmp;
  });

  currentPage = 0;
  renderStats();
  renderBody();
  renderPagination();
}

function renderHeader() {
  const thead = document.getElementById("thead");
  const tr = document.createElement("tr");
  for (const col of COLUMNS) {
    const th = document.createElement("th");
    th.textContent = col.label;
    if (col.sortable !== false) {
      const arrow = document.createElement("span");
      arrow.className = "sort-arrow";
      arrow.textContent = sortCol === col.key ? (sortDir === "asc" ? "↑" : "↓") : "↕";
      th.appendChild(arrow);
      if (sortCol === col.key) th.classList.add("sorted");
      th.addEventListener("click", () => {
        if (sortCol === col.key) sortDir = sortDir === "asc" ? "desc" : "asc";
        else {
          sortCol = col.key;
          sortDir = "asc";
        }
        renderHeader();
        applyFilters();
      });
    }
    tr.appendChild(th);
  }
  thead.innerHTML = "";
  thead.appendChild(tr);
}

function renderStats() {
  document.getElementById("stats").innerHTML =
    "<span>Showing <strong>" +
    filteredModels.length +
    "</strong> of <strong>" +
    allModels.length +
    "</strong> models</span>";
}

function renderBody() {
  const tbody = document.getElementById("tbody");
  const start = currentPage * PAGE_SIZE;
  const page = filteredModels.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = "";
  if (page.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = COLUMNS.length;
    td.style.textAlign = "center";
    td.style.padding = "40px";
    td.style.color = "var(--text-muted)";
    td.textContent = "No models match your filters";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const model of page) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-clickable", "");
    tr.addEventListener("click", () => showDetail(model));
    for (const col of COLUMNS) {
      const td = document.createElement("td");
      if (col.cls) td.className = col.cls;

      if (col.key === "_capabilities") {
        let html = "";
        for (const cap of CAPABILITIES) {
          if (model[cap.key]) html += `<span class="badge ${cap.cls}">${cap.label}</span>`;
        }
        td.innerHTML = html;
      } else if (col.format) {
        td.textContent = col.format(model[col.key]);
      } else {
        td.textContent = model[col.key] ?? "—";
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function renderPagination() {
  const totalPages = Math.ceil(filteredModels.length / PAGE_SIZE);
  const el = document.getElementById("pagination");
  if (totalPages <= 1) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = "";
  const prev = document.createElement("button");
  prev.textContent = "← Prev";
  prev.disabled = currentPage === 0;
  prev.addEventListener("click", () => {
    currentPage--;
    renderBody();
    renderPagination();
  });

  const info = document.createElement("span");
  info.style.color = "var(--text-muted)";
  info.style.fontSize = "0.82rem";
  info.textContent = `Page ${currentPage + 1} of ${totalPages}`;

  const next = document.createElement("button");
  next.textContent = "Next →";
  next.disabled = currentPage >= totalPages - 1;
  next.addEventListener("click", () => {
    currentPage++;
    renderBody();
    renderPagination();
  });

  el.appendChild(prev);
  el.appendChild(info);
  el.appendChild(next);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const SKIP_KEYS = new Set(["key", "litellm_provider"]);

const COST_KEYS = [
  "input_cost_per_token",
  "output_cost_per_token",
  "output_cost_per_reasoning_token",
  "input_cost_per_audio_token",
  "cache_read_input_token_cost",
  "input_cost_per_token_flex",
  "output_cost_per_token_flex",
  "input_cost_per_token_priority",
  "cache_read_input_token_cost_flex",
];

function showDetail(model) {
  const panel = document.getElementById("detail-panel");
  const overlay = document.getElementById("overlay");

  // Pricing section
  let pricingHtml = '<div class="detail-grid">';
  for (const k of COST_KEYS) {
    if (model[k] != null) {
      const label = k.replace(/_/g, " ").replace("cost per token", "$/1M tok");
      const val = costPerMillion(model[k]);
      const cls = k.includes("input") || k.includes("cache") ? "green" : "yellow";
      pricingHtml +=
        '<div class="detail-item"><div class="label">' +
        esc(label) +
        '</div><div class="value ' +
        cls +
        '">' +
        val +
        "</div></div>";
    }
  }
  if (model.output_cost_per_image != null) {
    pricingHtml +=
      '<div class="detail-item"><div class="label">output cost per image</div><div class="value yellow">$' +
      model.output_cost_per_image +
      "</div></div>";
  }
  pricingHtml += "</div>";

  // Context section
  let contextHtml = '<div class="detail-grid">';
  const ctxFields = [
    ["max_input_tokens", "Max Input"],
    ["max_output_tokens", "Max Output"],
    ["max_tokens", "Max Tokens (legacy)"],
  ];
  for (const [k, label] of ctxFields) {
    if (model[k] != null) {
      contextHtml +=
        '<div class="detail-item"><div class="label">' +
        label +
        '</div><div class="value">' +
        formatTokens(model[k]) +
        " (" +
        Number(model[k]).toLocaleString() +
        ")</div></div>";
    }
  }
  contextHtml += "</div>";

  // Capabilities
  const allCaps = Object.keys(model).filter((k) => k.startsWith("supports_") && model[k] === true);
  let capsHtml = '<div class="detail-badges">';
  const capStyles = {
    supports_function_calling: "tools",
    supports_vision: "vision",
    supports_reasoning: "reasoning",
    supports_prompt_caching: "caching",
  };
  for (const c of allCaps) {
    const label = c.replace("supports_", "").replace(/_/g, " ");
    const cls = capStyles[c] || "";
    capsHtml += `<span class="badge ${cls}">${esc(label)}</span>`;
  }
  capsHtml += "</div>";

  // Raw JSON of remaining fields
  const shown = new Set([
    ...SKIP_KEYS,
    ...COST_KEYS,
    "output_cost_per_image",
    ...ctxFields.map((f) => f[0]),
    ...allCaps,
    "mode",
  ]);
  const extra = {};
  for (const [k, v] of Object.entries(model)) {
    if (!shown.has(k)) extra[k] = v;
  }

  let rawHtml = "";
  if (Object.keys(extra).length > 0) {
    rawHtml =
      '<div class="detail-section"><h3>All Properties</h3><div class="detail-raw">' +
      esc(JSON.stringify(extra, null, 2)) +
      "</div></div>";
  }

  panel.innerHTML =
    "" +
    '<button class="close-btn" id="detail-close">&times;</button>' +
    "<h2>" +
    esc(model.key) +
    "</h2>" +
    '<div class="subtitle">' +
    esc(model.litellm_provider) +
    (model.mode ? ` · ${esc(model.mode)}` : "") +
    "</div>" +
    '<div class="detail-section"><h3>Pricing (per 1M tokens)</h3>' +
    pricingHtml +
    "</div>" +
    '<div class="detail-section"><h3>Context Window</h3>' +
    contextHtml +
    "</div>" +
    (allCaps.length ? `<div class="detail-section"><h3>Capabilities</h3>${capsHtml}</div>` : "") +
    rawHtml;

  overlay.classList.add("open");
  document.getElementById("detail-close").addEventListener("click", closeDetail);
}

function closeDetail() {
  document.getElementById("overlay").classList.remove("open");
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

document.getElementById("overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeDetail();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDetail();
});

init();
