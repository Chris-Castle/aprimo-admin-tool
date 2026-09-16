import cytoscape from "cytoscape"
import { Expander } from "aprimo-js"

// ── Helpers ────────────────────────────────────────────────────────────────────
const DT_COLOR = {
  SingleLineText: "#3b82f6", MultiLineText: "#3b82f6", Html: "#3b82f6",
  RichContent: "#3b82f6", TextList: "#3b82f6",
  Integer: "#16a34a", Decimal: "#16a34a", Duration: "#16a34a", NumericList: "#16a34a",
  DateTime: "#ca8a04",
  Boolean: "#9333ea",
  Option: "#ea580c",
  Link: "#db2777", RecordLink: "#db2777", RecordList: "#db2777",
  ClassificationList: "#0891b2", LanguageList: "#0891b2",
  Json: "#6b7280",
}
function dtColor(dt) { return DT_COLOR[dt ?? ""] ?? "#6b7280" }

function getLabel(labels, name) {
  if (!labels?.length) return name
  const en = labels.find(l =>
    l.languageId.toLowerCase().includes("c2bd4f9b") ||
    l.languageId.toLowerCase().startsWith("en"),
  )
  return en?.value ?? labels[0]?.value ?? name
}

function normalizeId(id) { return id.replace(/-/g, "").toLowerCase() }

const FIELD_NAME_RE = /fieldName\s*=\s*["']([^"']+)["']/gi
const FIELD_ID_RE = /fieldId\s*=\s*["']([^"']+)["']/gi

function expressionReferences(expr, target) {
  if (!expr) return false
  const idMatches = [...expr.matchAll(FIELD_ID_RE)].map(m => m[1])
  if (idMatches.some(id => normalizeId(id) === normalizeId(target.id))) return true
  const nameMatches = [...expr.matchAll(FIELD_NAME_RE)].map(m => m[1])
  return nameMatches.some(n => n.toLowerCase() === target.name.toLowerCase())
}

function findCrossFieldRefs(target, allFDs) {
  const refs = []
  for (const other of allFDs) {
    if (other.id === target.id) continue
    const inDefault = expressionReferences(other.defaultValue ?? "", target)
    const inValidation = expressionReferences(other.validation ?? "", target)
    if (inDefault) refs.push({ field: other, via: "default" })
    else if (inValidation) refs.push({ field: other, via: "validation" })
  }
  return refs
}

function findRuleRefs(target, rules) {
  const refs = []
  for (const rule of rules) {
    for (const cond of rule.conditions) {
      const byId = cond.fieldDefinitionId && normalizeId(cond.fieldDefinitionId) === normalizeId(target.id)
      const byExpr = (cond.expression && expressionReferences(cond.expression, target)) ||
                     (cond.reference && expressionReferences(cond.reference, target))
      if (byId || byExpr) { refs.push({ rule, via: "condition", detail: cond.conditionType }); break }
    }
    for (const action of rule.actions) {
      const byId = action.fieldDefinitionId && normalizeId(action.fieldDefinitionId) === normalizeId(target.id)
      const byExpr = (action.reference && expressionReferences(action.reference, target)) ||
                     (action.expression && expressionReferences(action.expression, target))
      if (byId || byExpr) { refs.push({ rule, via: "action", detail: action.actionType }); break }
    }
  }
  return refs
}

// ── Build Cytoscape elements ───────────────────────────────────────────────────
function buildCyElements(fd, containers, fieldGroupMap, allFDs, rules) {
  const elements = []

  const usedFGs = new Map()
  for (const [id, fg] of fieldGroupMap) {
    if (fg.memberIds.includes(fd.id)) usedFGs.set(id, fg)
  }

  const relevantContainers = containers.filter(c => {
    const hasGroup = c.registeredFieldGroupIds.some(gId => usedFGs.has(gId))
    return hasGroup || c.registeredFieldIds.includes(fd.id)
  })

  const fdLabel = getLabel(fd.labels, fd.name)
  const crossRefs = findCrossFieldRefs(fd, allFDs)
  const ruleRefs = findRuleRefs(fd, rules)

  const FD_W = 210, FD_H = 70
  const FG_W = 200, FG_H = 70
  const CT_W = 210, CT_H = 60
  const REF_W = 200, REF_H = 70
  const RULE_W = 200, RULE_H = 70
  const COL_GAP = 160
  const ROW_GAP = 140

  const fgList = [...usedFGs.values()]
  const fgTotalW = fgList.length * FG_W + Math.max(0, fgList.length - 1) * COL_GAP
  const ruleTotalW = ruleRefs.length * RULE_W + Math.max(0, ruleRefs.length - 1) * COL_GAP

  const classificationCTs = relevantContainers.filter(c => c.kind === "classification")
  const contentTypeCTs = relevantContainers.filter(c => c.kind === "contentType")

  const clsTotalW = classificationCTs.length * CT_W + Math.max(0, classificationCTs.length - 1) * COL_GAP
  const ctTotalH = contentTypeCTs.length * CT_H + Math.max(0, contentTypeCTs.length - 1) * COL_GAP

  const refTotalH = crossRefs.length * REF_H + Math.max(0, crossRefs.length - 1) * COL_GAP
  const hasRefs = crossRefs.length > 0

  const hasCTs = contentTypeCTs.length > 0
  const structW = Math.max(fgTotalW, clsTotalW, FD_W)

  const ORIGIN_X = hasRefs ? REF_W + ROW_GAP : 0
  const CENTER_X = ORIGIN_X + Math.max(structW + (hasCTs ? COL_GAP + CT_W : 0), ruleTotalW, FD_W) / 2

  const hasFGs = fgList.length > 0
  const hasCls = classificationCTs.length > 0
  const CLS_Y = 0
  const FG_Y = hasCls ? CT_H + ROW_GAP : 0
  const FD_Y = FG_Y + (hasFGs ? FG_H + ROW_GAP : 0)
  const RULE_Y = FD_Y + FD_H + ROW_GAP

  const FD_X = CENTER_X - FD_W / 2
  const FD_CY = FD_Y + FD_H / 2
  const FG_CY = FG_Y + FG_H / 2

  // Cytoscape positions are node centres
  function node(id, x, y, w, h, data) {
    elements.push({ data: { id, ...data }, position: { x: x + w / 2, y: y + h / 2 } })
  }
  function edge(id, source, target, color) {
    elements.push({ data: { id, source, target, edgeColor: color } })
  }

  // Central field definition
  node("fd-selected", FD_X, FD_Y, FD_W, FD_H, {
    label: fd.dataType ? `${fdLabel}\n${fd.dataType}` : fdLabel,
    nodeType: "fieldDefinition", isHighlight: "true", dataType: fd.dataType, raw: fd,
  })

  // Field groups
  const fgStartX = CENTER_X - fgTotalW / 2
  fgList.forEach((fg, i) => {
    node(`fg-${fg.id}`, fgStartX + i * (FG_W + COL_GAP), FG_Y, FG_W, FG_H, {
      label: `${fg.name}\n${fg.memberIds.length} field${fg.memberIds.length !== 1 ? "s" : ""}`,
      nodeType: "fieldGroup", raw: fg,
    })
    edge(`e-fd-fg-${fg.id}`, "fd-selected", `fg-${fg.id}`, "#f97316")
  })

  // Classifications (above field groups)
  const clsStartX = CENTER_X - clsTotalW / 2
  classificationCTs.forEach((c, i) => {
    node(`c-${c.id}`, clsStartX + i * (CT_W + COL_GAP), CLS_Y, CT_W, CT_H, {
      label: getLabel(c.labels, c.name), nodeType: "container", kind: "classification", raw: c,
    })
    for (const fg of fgList) {
      if (c.registeredFieldGroupIds.includes(fg.id))
        edge(`e-fg-${fg.id}-c-${c.id}`, `fg-${fg.id}`, `c-${c.id}`, "#22c55e")
    }
    if (c.registeredFieldIds.includes(fd.id))
      edge(`e-fd-direct-c-${c.id}`, "fd-selected", `c-${c.id}`, "#22c55e")
  })

  // Content types (right of field group row)
  const ctX = CENTER_X + structW / 2 + COL_GAP
  const ctStartY = FG_CY - ctTotalH / 2
  contentTypeCTs.forEach((c, i) => {
    node(`c-${c.id}`, ctX, ctStartY + i * (CT_H + COL_GAP), CT_W, CT_H, {
      label: getLabel(c.labels, c.name), nodeType: "container", kind: "contentType", raw: c,
    })
    for (const fg of fgList) {
      if (c.registeredFieldGroupIds.includes(fg.id))
        edge(`e-fg-${fg.id}-c-${c.id}`, `fg-${fg.id}`, `c-${c.id}`, "#3b82f6")
    }
    if (c.registeredFieldIds.includes(fd.id))
      edge(`e-fd-direct-c-${c.id}`, "fd-selected", `c-${c.id}`, "#3b82f6")
  })

  // Rules (below field definition)
  const ruleStartX = CENTER_X - ruleTotalW / 2
  ruleRefs.forEach((ref, i) => {
    node(`ruleref-${ref.rule.id}`, ruleStartX + i * (RULE_W + COL_GAP), RULE_Y, RULE_W, RULE_H, {
      label: `${ref.rule.name}\nRule · ${ref.via}`,
      nodeType: "rule", raw: ref.rule,
    })
    edge(`e-ruleref-${ref.rule.id}`, `ruleref-${ref.rule.id}`, "fd-selected", "#0369a1")
  })

  // Cross-field refs (left of field definition)
  const refX = ORIGIN_X - ROW_GAP - REF_W
  const refStartY = FD_CY - refTotalH / 2
  crossRefs.forEach((ref, i) => {
    const refLabel = getLabel(ref.field.labels, ref.field.name)
    node(`ref-${ref.field.id}`, refX, refStartY + i * (REF_H + COL_GAP), REF_W, REF_H, {
      label: `${refLabel}\n${ref.via === "default" ? "default value" : "validation"}`,
      nodeType: "crossRef", refKind: ref.via, raw: ref.field,
    })
    edge(`e-ref-${ref.field.id}`, `ref-${ref.field.id}`, "fd-selected",
      ref.via === "default" ? "#7c3aed" : "#b45309")
  })

  return elements
}

// ── Cytoscape stylesheet ───────────────────────────────────────────────────────
const CY_STYLE = [
  {
    selector: "node",
    style: {
      shape: "roundrectangle", width: 200, height: 68,
      label: "data(label)", "text-wrap": "wrap", "text-max-width": 185,
      "text-valign": "center", "text-halign": "center",
      "font-family": "system-ui,-apple-system,sans-serif",
      "font-size": 12, "font-weight": 600,
      color: "#ffffff", "border-width": 2, "border-color": "#00000033",
    },
  },
  { selector: "node[nodeType='fieldDefinition']",
    style: { "background-color": "#4c1d95", "border-color": "#8b5cf6" } },
  { selector: "node[nodeType='fieldGroup']",
    style: { "background-color": "#ea580c", "border-color": "#c2410c" } },
  { selector: "node[nodeType='container'][kind='contentType']",
    style: { "background-color": "#2563eb", "border-color": "#1d4ed8" } },
  { selector: "node[nodeType='container'][kind='classification']",
    style: { "background-color": "#16a34a", "border-color": "#15803d" } },
  { selector: "node[nodeType='rule']",
    style: { "background-color": "#0369a1", "border-color": "#075985" } },
  { selector: "node[nodeType='crossRef'][refKind='default']",
    style: { "background-color": "#f5f3ff", "border-color": "#c4b5fd", color: "#4c1d95", "border-width": 2 } },
  { selector: "node[nodeType='crossRef'][refKind='validation']",
    style: { "background-color": "#fffbeb", "border-color": "#fcd34d", color: "#78350f", "border-width": 2 } },
  { selector: "node:selected",
    style: { "border-width": 3, "border-color": "#fbbf24", "border-opacity": 1 } },
  {
    selector: "edge",
    style: {
      width: 2, "line-color": "data(edgeColor)",
      "target-arrow-color": "data(edgeColor)", "target-arrow-shape": "triangle",
      "arrow-scale": 1.2, "curve-style": "bezier",
    },
  },
]

// ── Detail panel ───────────────────────────────────────────────────────────────
function renderDetailHtml(node, fieldGroupMap, fieldDefMap, containers) {
  const d = node.data()
  const raw = d.raw
  const primaryLabel = d.label.split("\n")[0]

  function row(label, val) {
    return `<div class="dm-row"><div class="dm-row-label">${label}</div><div>${val}</div></div>`
  }
  function idBox(id) { return `<div class="dm-id-box">${id}</div>` }
  function listRow(name, meta) {
    return `<div class="dm-list-row"><span>${name}</span><span class="muted small">${meta}</span></div>`
  }

  if (d.nodeType === "container") {
    const fgRows = raw.registeredFieldGroupIds.map(id => {
      const fg = fieldGroupMap.get(id)
      return listRow(fg?.name ?? id, fg ? `${fg.memberIds.length} fields` : "")
    }).join("")
    const fdRows = raw.registeredFieldIds.map(id => {
      const fd = fieldDefMap.get(id)
      return listRow(fd?.name ?? id, fd?.dataType ?? "")
    }).join("")
    return [
      row("Name", primaryLabel),
      primaryLabel !== raw.name ? row("System name", raw.name) : "",
      row("ID", idBox(raw.id)),
      fgRows ? row(`Field Groups (${raw.registeredFieldGroupIds.length})`, fgRows) : "",
      fdRows ? row(`Direct Fields (${raw.registeredFieldIds.length})`, fdRows) : "",
    ].join("")
  }

  if (d.nodeType === "fieldGroup") {
    const usedIn = containers.filter(c => c.registeredFieldGroupIds.includes(raw.id))
    const dot = kind => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${kind === "contentType" ? "#2563eb" : "#16a34a"};margin-right:6px;flex-shrink:0;vertical-align:middle"></span>`
    const usedInHtml = usedIn.map(c =>
      `<div class="dm-list-row">${dot(c.kind)}${getLabel(c.labels, c.name)}</div>`
    ).join("")
    const members = raw.memberIds.map(id => {
      const fd = fieldDefMap.get(id)
      return listRow(fd?.name ?? id, fd?.dataType ?? "")
    }).join("")
    return [
      row("Name", primaryLabel),
      row("ID", idBox(raw.id)),
      usedInHtml ? row("Used in", usedInHtml) : "",
      members ? row(`Fields (${raw.memberIds.length})`, members) : "",
    ].join("")
  }

  // Field definition
  const color = dtColor(raw.dataType)
  const isGlobal = raw.scope?.toLowerCase().includes("global") ?? false
  const dtBadge = raw.dataType
    ? `<span style="color:${color};background:${color}1a;font-size:11px;font-weight:600;padding:2px 7px;border-radius:5px">${raw.dataType}</span>`
    + (isGlobal ? ` <span style="font-size:9px;font-weight:700;letter-spacing:.05em;color:#16a34a;background:#dcfce7;border-radius:3px;padding:2px 5px">GLOBAL</span>` : "")
    : ""
  return [
    row("Name", primaryLabel),
    primaryLabel !== raw.name ? row("System name", raw.name) : "",
    row("ID", idBox(raw.id)),
    dtBadge ? row("Data Type", dtBadge) : "",
    raw.scope ? row("Scope", raw.scope) : "",
    raw.defaultValue ? row("Default Value", `<pre class="dm-expr">${escHtml(raw.defaultValue)}</pre>`) : "",
    raw.validation ? row("Validation", `<pre class="dm-expr">${escHtml(raw.validation)}</pre>`) : "",
  ].join("")
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// ── Module state ───────────────────────────────────────────────────────────────
let _client = null
let _allFDs = []
let _fieldGroupMap = new Map()
let _containers = []
let _rules = []
let _rulesLoaded = false
let _rulesLoading = false
let _selectedFD = null
let _fdSearch = ""
let _cy = null
let _clickedNodeId = null

const $d = id => document.getElementById(id)

function setStatus(msg) { $d("dataModelStatus").textContent = msg }
function setErr(msg) {
  const el = $d("dataModelErr")
  el.textContent = msg
  el.classList.toggle("hidden", !msg)
}

// ── FD list ────────────────────────────────────────────────────────────────────
function renderFdList() {
  const q = _fdSearch.trim().toLowerCase()
  const filtered = q
    ? _allFDs.filter(fd => fd.name.toLowerCase().includes(q) || (fd.dataType ?? "").toLowerCase().includes(q))
    : _allFDs

  $d("dmCount").textContent = `${filtered.length.toLocaleString()} of ${_allFDs.length.toLocaleString()} fields`

  const list = $d("dmFdList")
  list.innerHTML = ""
  for (const fd of filtered) {
    const color = dtColor(fd.dataType)
    const isSelected = _selectedFD?.id === fd.id
    const isGlobal = fd.scope?.toLowerCase().includes("global") ?? false
    const btn = document.createElement("button")
    btn.className = "dm-fd-item" + (isSelected ? " active" : "")
    btn.innerHTML =
      `<div class="dm-fd-name">${fd.name}${isGlobal ? ' <span class="dm-badge-global">GLOBAL</span>' : ""}</div>` +
      (fd.dataType ? `<span style="color:${color};background:${color}1a;font-size:10px;font-weight:600;padding:1px 5px;border-radius:4px">${fd.dataType}</span>` : "")
    btn.onclick = () => selectFD(fd)
    list.append(btn)
  }
}

// ── Summary bar ────────────────────────────────────────────────────────────────
function updateSummaryBar() {
  const bar = $d("dmSummaryBar")
  if (!_selectedFD) { bar.style.display = "none"; return }

  const fgs = [..._fieldGroupMap.values()].filter(fg => fg.memberIds.includes(_selectedFD.id))
  const fgIds = new Set(fgs.map(fg => fg.id))
  const allC = new Set([
    ..._containers.filter(c => c.registeredFieldGroupIds.some(id => fgIds.has(id))).map(c => c.id),
    ..._containers.filter(c => c.registeredFieldIds.includes(_selectedFD.id)).map(c => c.id),
  ])
  const ctCount = [...allC].filter(id => _containers.find(c => c.id === id)?.kind === "contentType").length
  const clCount = [...allC].filter(id => _containers.find(c => c.id === id)?.kind === "classification").length
  const direct = _containers.filter(c => c.registeredFieldIds.includes(_selectedFD.id)).length
  const refs = findCrossFieldRefs(_selectedFD, _allFDs)
  const ruleRefs = findRuleRefs(_selectedFD, _rules)

  const color = dtColor(_selectedFD.dataType)
  const displayLabel = getLabel(_selectedFD.labels, _selectedFD.name)
  const dtBadge = _selectedFD.dataType
    ? `<span style="color:${color};background:${color}1a;font-size:11px;font-weight:600;padding:2px 7px;border-radius:5px;margin-left:6px">${_selectedFD.dataType}</span>`
    : ""

  const stats = []
  if (fgs.length) stats.push(`<b>${fgs.length}</b> group${fgs.length !== 1 ? "s" : ""}`)
  if (ctCount) stats.push(`<b>${ctCount}</b> content type${ctCount !== 1 ? "s" : ""}`)
  if (clCount) stats.push(`<b>${clCount}</b> classification${clCount !== 1 ? "s" : ""}`)
  if (direct) stats.push(`<b>${direct}</b> direct`)
  if (refs.length) stats.push(`<span style="color:#7c3aed"><b>${refs.length}</b> expression ref${refs.length !== 1 ? "s" : ""}</span>`)
  if (_rulesLoading) stats.push(`<span class="muted">loading rules…</span>`)
  else if (ruleRefs.length) stats.push(`<span style="color:#0369a1"><b>${ruleRefs.length}</b> rule${ruleRefs.length !== 1 ? "s" : ""}</span>`)
  if (!stats.length) stats.push(`<span class="muted" style="font-style:italic">not assigned anywhere</span>`)

  bar.innerHTML = `<span style="font-weight:700">${displayLabel}</span>${dtBadge}<span style="margin-left:auto;display:flex;gap:10px;align-items:center;font-size:12px;flex-wrap:wrap">${stats.join('<span class="muted">·</span>')}</span>`
  bar.style.display = "flex"
}

// ── Graph ──────────────────────────────────────────────────────────────────────
function renderGraph() {
  const graphEl = $d("dmGraph")
  const emptyEl = $d("dmEmpty")

  if (!_selectedFD) {
    emptyEl.textContent = "Select a field definition to see its usage"
    emptyEl.style.display = "flex"
    if (_cy) { _cy.destroy(); _cy = null }
    return
  }

  const elements = buildCyElements(_selectedFD, _containers, _fieldGroupMap, _allFDs, _rules)
  const hasNodes = elements.some(el => !el.data.source)

  if (!hasNodes) {
    emptyEl.textContent = "This field definition is not assigned to any content type or classification."
    emptyEl.style.display = "flex"
    if (_cy) { _cy.destroy(); _cy = null }
    return
  }

  emptyEl.style.display = "none"
  if (_cy) _cy.destroy()

  _cy = cytoscape({
    container: graphEl,
    elements,
    layout: { name: "preset", fit: true, padding: 40 },
    style: CY_STYLE,
    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false,
    autoungrabify: true,
  })

  _cy.on("tap", "node", evt => {
    const node = evt.target
    _clickedNodeId = _clickedNodeId === node.id() ? null : node.id()
    renderDetail(_clickedNodeId ? node : null)
  })
  _cy.on("tap", evt => {
    if (evt.target === _cy) { _clickedNodeId = null; renderDetail(null) }
  })
}

// ── Detail panel ───────────────────────────────────────────────────────────────
function renderDetail(node) {
  const panel = $d("dmDetail")
  if (!node) { panel.style.display = "none"; return }

  const d = node.data()
  const typeLabel = d.nodeType === "container"
    ? (d.kind === "classification" ? "Classification" : "Content Type")
    : d.nodeType === "fieldGroup" ? "Field Group" : "Field Definition"

  const fieldDefMap = new Map(_allFDs.map(f => [f.id, f]))
  panel.innerHTML = `
    <div class="dm-detail-header">
      <span class="dm-detail-type">${typeLabel}</span>
      <button id="dmDetailClose" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:18px;padding:0;line-height:1">×</button>
    </div>
    <div style="padding:14px;display:flex;flex-direction:column;gap:12px">
      ${renderDetailHtml(node, _fieldGroupMap, fieldDefMap, _containers)}
    </div>`
  $d("dmDetailClose").onclick = () => { _clickedNodeId = null; panel.style.display = "none" }
  panel.style.display = "flex"
}

// ── Select FD ──────────────────────────────────────────────────────────────────
function selectFD(fd) {
  _selectedFD = _selectedFD?.id === fd.id ? null : fd
  _clickedNodeId = null
  renderDetail(null)
  updateSummaryBar()
  renderGraph()
  renderFdList()
  if (_selectedFD && !_rulesLoaded && !_rulesLoading) loadRules()
}

async function loadRules() {
  if (!_client || _rulesLoaded || _rulesLoading) return
  _rulesLoading = true
  updateSummaryBar()
  try {
    const expander = Expander.create().for("Rule").expand("conditions", "actions")
    for await (const page of _client.rules.getPaged({ pageSize: 200 }, expander)) {
      if (!page.ok) break
      for (const r of page.data?.items ?? []) {
        _rules.push({
          id: r.id,
          name: r.name,
          conditions: r._embedded?.conditions?.items ?? [],
          actions: r._embedded?.actions?.items ?? [],
        })
      }
    }
    _rulesLoaded = true
  } catch {
    _rulesLoaded = true // don't retry on error
  } finally {
    _rulesLoading = false
    updateSummaryBar()
    if (_selectedFD) renderGraph()
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────
export async function loadDataModel(client) {
  _client = client
  _allFDs = []
  _fieldGroupMap = new Map()
  _containers = []
  _rules = []
  _rulesLoaded = false
  _rulesLoading = false
  _selectedFD = null
  _fdSearch = ""
  _clickedNodeId = null
  if (_cy) { _cy.destroy(); _cy = null }

  const body = $d("dataModelBody")
  body.style.display = "none"
  setStatus("Loading field definitions…")
  setErr("")

  try {
    // 1. Field definitions
    for await (const page of client.fieldDefinitions.getPaged({ pageSize: 500 })) {
      if (!page.ok) break
      for (const raw of page.data?.items ?? []) {
        _allFDs.push({
          id: raw.id, name: raw.name, dataType: raw.dataType, labels: raw.labels,
          defaultValue: raw.defaultValue, validation: raw.validation,
          resetToDefaultFields: raw.resetToDefaultFields ?? [], scope: raw.scope,
        })
      }
    }
    _allFDs.sort((a, b) => a.name.localeCompare(b.name))
    setStatus("Loading field groups…")

    // 2. Field groups with embedded members
    const fgExpander = Expander.create().for("FieldGroup").expand("members")
    for await (const page of client.fieldGroups.getPaged({ pageSize: 200 }, fgExpander)) {
      if (!page.ok) break
      for (const raw of page.data?.items ?? []) {
        const memberIds = raw._embedded?.members?.items?.map(m => m.id) ?? []
        _fieldGroupMap.set(raw.id, { id: raw.id, name: raw.name, memberIds })
      }
    }
    setStatus("Loading content types…")

    // 3. Content types
    for await (const page of client.contentTypes.getPaged({ pageSize: 200 })) {
      if (!page.ok) break
      for (const raw of page.data?.items ?? []) {
        _containers.push({
          kind: "contentType", id: raw.id, name: raw.name, labels: raw.labels,
          registeredFieldGroupIds: raw.registeredFieldGroups?.map(g => g.fieldGroupId) ?? [],
          registeredFieldIds: raw.registeredFields?.map(f => f.fieldId) ?? [],
        })
      }
    }
    setStatus("Loading classifications…")

    // 4. Classifications that have field assignments
    for await (const page of client.classifications.getPaged(undefined, undefined, "*")) {
      if (!page.ok) break
      for (const raw of page.data?.items ?? []) {
        const fgIds = raw.registeredFieldGroups?.map(g => g.fieldGroupId) ?? []
        const fdIds = raw.registeredFields?.map(f => f.fieldId) ?? []
        if (fgIds.length || fdIds.length) {
          _containers.push({
            kind: "classification", id: raw.id, name: raw.name, labels: raw.labels,
            registeredFieldGroupIds: fgIds, registeredFieldIds: fdIds,
          })
        }
      }
    }

    setStatus("")
    body.style.display = "flex"
    renderFdList()
    updateSummaryBar()
    renderGraph()

    $d("dmSearch").oninput = e => { _fdSearch = e.target.value; renderFdList() }
    $d("dmReloadBtn").onclick = () => loadDataModel(client)
  } catch (e) {
    setStatus("")
    setErr(e?.message ?? "Failed to load data model")
  }
}
