// ---------- Settings ----------
const SETTINGS_KEY = 'mindmap-settings-v1';
// Wenn der User noch keine Theme-Praeferenz gespeichert hat, OS-Setting
// via prefers-color-scheme respektieren (light auf Light-OS, sonst dark).
const _savedSettingsRaw = localStorage.getItem(SETTINGS_KEY);
const _osLight = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-color-scheme: light)').matches;
const settings = Object.assign({
  historyDepth: 69,          // 0..100 % des Transkripts
  onlyActive: false,
  showLabels: true,
  labelOutline: true,
  collapsed: {},
  threeD: false,
  lightMode: _osLight,       // Default: OS-Theme
  overview: false,
}, JSON.parse(_savedSettingsRaw || '{}'));
// Merker: hat der User je manuell ein Theme gewaehlt? Wenn nicht, darf die
// OS-Praeferenz-Aenderung live durchschlagen.
let __themeAuto = !_savedSettingsRaw || !('lightMode' in JSON.parse(_savedSettingsRaw));
// Wenn OS-Theme sich waehrend Session aendert und User nie manuell
// umgeschaltet hat → live anpassen.
if (typeof window.matchMedia === 'function') {
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
      if (__themeAuto) {
        settings.lightMode = !!e.matches;
        if (typeof applySettings === 'function') applySettings();
      }
    });
  } catch (_) { /* Safari < 14 hat addListener statt addEventListener — egal */ }
}
// Alte Keys aufräumen
delete settings.focusActive; delete settings.dimInactive; delete settings.hideInactive;
delete settings.branchVisible; delete settings.fullHistory; delete settings.showToolSubs;
delete settings.maxToolEntries;
if (typeof settings.historyDepth !== 'number') settings.historyDepth = 69;
if (typeof settings.showLabels !== 'boolean') settings.showLabels = true;
// Label-Outline ist intern immer an (UI-Toggle entfernt — Outline ist Teil der
// Default-Darstellung fuer gute Lesbarkeit ueber farbigen Bubbles).
settings.labelOutline = true;
if (!settings.collapsed || typeof settings.collapsed !== 'object') settings.collapsed = {};

// View-Mode aus URL-Parameter (?view=topictree). Nicht persistiert — pro Tab
// frei waehlbar, so koennen Default- und TopicTree-Ansicht parallel laufen.
//   default    → klassischer Baum mit festen Buckets Topics/Tools/Web/Agents/Thoughts/Mindmap
//   topictree  → LLM-Cluster als Hauptaeste, Kategorien je Cluster
try {
  const _v = new URLSearchParams(window.location.search).get('view');
  settings.viewMode = (_v === 'topictree') ? 'topictree' : 'default';
} catch (_) { settings.viewMode = 'default'; }

function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
let _prevThreeD = null;
function applySettings() {
  document.body.classList.toggle('light', !!settings.lightMode);
  document.body.classList.toggle('no-labels', !settings.showLabels);
  document.body.classList.toggle('no-label-outline', !settings.labelOutline);
  document.body.classList.toggle('three-d', !!settings.threeD);
  // Three.js-Graph immer initialisieren (auch im 2D-Modus)
  if (typeof init3D === 'function') init3D();
  // Transition 2D → 3D: sinnvolle Default-Perspektive setzen
  if (forceGraph3d && settings.threeD && _prevThreeD === false) {
    forceGraph3d.cameraPosition({ x: 260, y: 180, z: 420 }, { x: 0, y: 0, z: 0 }, 800);
  }
  _prevThreeD = !!settings.threeD;
  if (forceGraph3d) {
    forceGraph3d.backgroundColor(settings.lightMode ? '#eaedf3' : '#070b10');
    // Dimension + Kamera anhand 2D/3D-Toggle konfigurieren
    const dims = settings.threeD ? 3 : 2;
    if (forceGraph3d.numDimensions) forceGraph3d.numDimensions(dims);
    const controls = forceGraph3d.controls && forceGraph3d.controls();
    if (controls) {
      controls.enableRotate = !!settings.threeD;
      controls.enablePan = true;
      controls.enableZoom = true;
      if (controls.mouseButtons) {
        if (settings.threeD) {
          // 3D: LEFT=Orbit, RIGHT=Pan, MIDDLE=Zoom (Standard-Orbit)
          controls.mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
        } else {
          // 2D: LEFT=Pan (intuitiv im 2D-Modus), RIGHT=Pan, MIDDLE=Zoom
          controls.mouseButtons = { LEFT: 2, MIDDLE: 1, RIGHT: 2 };
        }
      }
      if (!settings.threeD) {
        // 2D: Top-Down-Kamera, keine Rotation
        forceGraph3d.cameraPosition({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 0 }, 600);
      }
      if (controls.update) controls.update();
    }
    if (forceGraph3d.refresh) forceGraph3d.refresh();
  }
  if (typeof rebuild === 'function' && root) rebuild();
  document.querySelectorAll('#settings .setting[data-key]').forEach(el => {
    const k = el.dataset.key; el.classList.toggle('on', !!settings[k]);
  });
  // Overview-Box ein-/ausblenden (Toggle in Settings)
  const ovBox = document.getElementById('overview');
  if (ovBox) {
    ovBox.classList.toggle('visible', !!settings.overview);
    if (settings.overview && typeof updateOverview === 'function' && root) {
      updateOverview(root);
      if (typeof updateOverviewViewport === 'function') updateOverviewViewport();
    }
  }
  const slider = document.getElementById('history-slider');
  const pct = document.getElementById('history-pct');
  if (slider) slider.value = settings.historyDepth;
  if (pct) pct.textContent = settings.historyDepth + '%';
}
document.querySelectorAll('#settings .setting[data-key]').forEach(el => {
  el.addEventListener('click', async (ev) => {
    if (ev.target.closest('input')) return;
    const k = el.dataset.key;
    settings[k] = !settings[k];
    // Wenn der User lightMode manuell umschaltet → Auto-Modus deaktivieren,
    // OS-Praeferenz-Aenderungen sollen dann nicht mehr durchschlagen.
    if (k === 'lightMode') __themeAuto = false;
    saveSettings(); applySettings();
    rebuild();
  });
});

setTimeout(() => {
  const slider = document.getElementById('history-slider');
  const pct = document.getElementById('history-pct');
  if (slider) {
    slider.value = settings.historyDepth;
    pct.textContent = settings.historyDepth + '%';
    // Während Drag: NUR Prozent-Anzeige aktualisieren, keine Graph-Neuberechnung
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value);
      pct.textContent = v + '%';
    });
    // Erst bei Release (change): Settings + Graph aktualisieren
    slider.addEventListener('change', () => {
      const v = parseInt(slider.value);
      settings.historyDepth = v;
      saveSettings();
      rebuild();  // Client-side Filter auf Basis der neuen Tiefe
    });
    slider.addEventListener('click', e => e.stopPropagation());
  }
}, 0);

// (Branch-Toggles sind jetzt in der Legende integriert — renderLegend erstellt sie.)

async function applyHistoryDepth() {
  const pctVal = Math.max(0, Math.min(100, parseInt(settings.historyDepth) || 0));
  // Server gibt immer Full-History (depth=1) zurück, Client schneidet per settings.historyDepth ab.
  // So kann der Slider frei nach oben/unten ohne weitere Server-Calls bewegt werden.
  statusEl.textContent = '⏳ loading history…';
  liveThoughts.clear(); lastSeq = 0;
  logList.innerHTML = ''; logTotal = 0; logCount.textContent = 0;
  try {
    if (pctVal === 0) {
      await fetch('/api/clear', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
    } else {
      await fetch('/api/replay', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({depth: 1.0})});  // immer komplett
    }
    await poll();
  } catch (e) {
    statusEl.textContent = '○ load error';
  }
}

function toggleBox(id) { document.getElementById(id).classList.toggle('collapsed'); }

// ---------- Tree ----------
const baseTree = {
  name: "Current Context",
  color: "#ffffff",
  children: [
    { name: "Topics", color: "#10b981", children: [] },
    { name: "Tools", color: "#fbbf24", children: [] },
    { name: "Agents", color: "#c084fc", children: [] },
    { name: "Web", color: "#22d3ee", children: [] },
    { name: "Thoughts", color: "#f472b6", children: [] },
    { name: "Mindmap", color: "#84cc16", children: [] }
  ]
};

// Classify prompts by topic (simple keyword heuristic)
function classifyTopic(text) {
  const t = (text || "").toLowerCase();
  if (/noyron|leap\s*71|rocket|engine|picogk/.test(t)) return "Noyron / LEAP 71";
  if (/\bapfel\b|\bapple\b/.test(t)) return "Apple";
  if (/new\s*york|nyc|uhrzeit|time/.test(t)) return "NYC Time";
  if (/banane|banana/.test(t)) return "Bananas";
  if (/oktopus|octopus|zufällige|zufaellige|random|experiment|nachdenk|think/.test(t)) return "Thought Experiments";
  if (/veröffent|veroeff|publish|marketplace|markt/.test(t)) return "Publishing";
  if (/\bhook\b|usersubmit|posttooluse|pretooluse|stop[- ]?hook/.test(t)) return "Hooks & Events";
  if (/install|local|lokal|plugin\.json|brainmap|plugin.*test/.test(t)) return "Installation";
  if (/server|\bport\b|preview|shutdown|nohup|4823/.test(t)) return "Server & Ports";
  if (/slider|verlauf|history|chatverlauf|tiefe|depth/.test(t)) return "Slider & History";
  if (/legende|legend|footer|\.ai\b|austro/.test(t)) return "Legend & Footer";
  if (/toggle|\bsetting|einstellung|tool-details|nur aktive|only active/.test(t)) return "Toggles & Options";
  if (/opacity|age|alter|schriftgröße|schriftgroesse|font|darstell|display|label/.test(t)) return "Display";
  if (/collapse|einklapp|ausblend|versteck|hide|\+.*symbol|plus[- ]/.test(t)) return "Collapse & Visibility";
  if (/panel|click|klick|interakt|kontext-?panel|context[- ]?panel|zusammenfas|summar|markdown/.test(t)) return "Panel & Context";
  if (/mindmap|grafisch|visual|gedank|thought/.test(t)) return "Mindmap Structure";
  if (/such|search|highlight|glassy/.test(t)) return "Search";
  return "Other";
}

// Label-Text kürzen — max. ca. 2/3 der bisherigen Länge
function truncateLabel(s, max = 45) {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

// Deterministische Themen-Farbe
function themeColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `hsl(${((h % 360) + 360) % 360}, 55%, 62%)`;
}

// Kontrast-Outline für Text: je nach Helligkeit weiß oder schwarz
function contrastStroke(color) {
  const c = d3.color(color);
  if (!c) return '#000';
  const rgb = c.rgb();
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return lum > 0.55 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)';
}

// Im Light-Mode helle Farben abdunkeln für Text-Lesbarkeit
function readableColor(color) {
  if (!settings.lightMode) return color;
  try {
    const hsl = d3.hsl(color);
    if (isNaN(hsl.h)) return color;
    hsl.l = Math.min(hsl.l, 0.35);
    hsl.s = Math.min(0.95, hsl.s + 0.1);
    return hsl.formatHex();
  } catch (e) { return color; }
}

// Root-Knoten in Light-Mode dunkel statt weiß
function nodeColor(d) {
  if (d.depth === 0 && settings.lightMode) return '#1e293b';
  return colorOf(d);
}

const svg = d3.select("#map");
const g = svg.append("g");
g.append("g").attr("class", "links");
g.append("g").attr("class", "nodes");
const zoomBehavior = d3.zoom().scaleExtent([0.1, 3]).on("zoom", e => {
  g.attr("transform", e.transform);
  if (typeof updateOverviewViewport === 'function') updateOverviewViewport();
});
svg.call(zoomBehavior);

let root, sim;
const liveThoughts = new Map();
const logList = document.getElementById('log-list');
const logCount = document.getElementById('log-count');
const statusEl = { textContent: "", style: { color: "" } }; // no-op Stub, Status ist entfernt
const legendList = document.getElementById('legend-list');
let logTotal = 0;
let lastSeq = 0;
let connected = false;
let selectedKey = null;
let selectedColor = null;
const knownColors = new Map();

const TOOL_BRANCHES = new Set(["Tools", "Agents", "Web"]);

const colorOf = d => { let n = d; while (n.parent && !n.data.color) n = n.parent;
  return n.data.color || "#7dd3fc"; };
const keyOf = d => d.data._key || d.data.name;

function findNode(tree, name) {
  if (tree.name === name) return tree;
  if (tree.children) for (const c of tree.children) { const r = findNode(c, name); if (r) return r; }
  return null;
}

function resolveParent(tree, thought) {
  // "User" / legacy "Nutzer" → "Topics"
  let name = (thought.parent === "User" || thought.parent === "Nutzer") ? "Topics" : thought.parent;
  const node = findNode(tree, name);
  if (node) return node;
  if (thought.kind && thought.kind.startsWith('tool')) return findNode(tree, "Tools");
  return findNode(tree, "Current Context");
}

function isCollapsed(key) { return !!settings.collapsed[key]; }
let hasHiddenChildren = new Set();
// Explizit an window haengen, damit Closures (rAF-Loops) zuverlaessig die
// aktuelle Instanz bekommen — nicht eine ueberholte Referenz.
window.__hasHiddenChildren = hasHiddenChildren;

function buildTreeDefault() {
  hasHiddenChildren = new Set();
  window.__hasHiddenChildren = hasHiddenChildren;
  const tree = JSON.parse(JSON.stringify(baseTree));

  // Thoughts nach seq sortieren (Prompts kommen vor ihren Tools)
  let all = [...liveThoughts.values()].filter(t => !t.silent)
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));

  // Live-Client-Side-Filter nach Verlaufs-Tiefe (für flüssiges Slider-Dragging ohne Server-Hit)
  const depthPct = Math.max(0, Math.min(100, parseInt(settings.historyDepth) || 0));
  if (depthPct < 100 && all.length > 5) {
    const keep = Math.max(1, Math.ceil(all.length * (depthPct / 100)));
    all = all.slice(-keep);
  }

  // "Nur aktive Knoten" — zeigt den aktuellen Task:
  //    letzter user_prompt + alle seine Tools/Subs, plus aktiv pulsierende Knoten.
  //    Toggle ON  → filtern (nur aktiver Task sichtbar)
  //    Toggle OFF → kompletter Verlauf sichtbar
  if (settings.onlyActive) {
    let latestPromptId = null, latestPromptSeq = -1;
    for (const t of all) {
      if (t.kind === "user_prompt" && (t.seq || 0) > latestPromptSeq) {
        latestPromptSeq = t.seq || 0;
        latestPromptId = t.id;
      }
    }
    // Nur filtern, wenn tatsächlich ein Prompt existiert — sonst bleibt der
    // Basis-Baum (Themen/Werkzeuge/…) sichtbar und der Toggle fühlt sich
    // nicht "kaputt" an, wenn noch keine Aktivität da ist.
    if (latestPromptId) {
      const allowed = new Set();
      allowed.add(latestPromptId);
      // Iterativ: Tools können unter dem Prompt hängen, weitere Nodes könnten unter Tools hängen
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of all) {
          if (!allowed.has(t.id) && t.parent_id && allowed.has(t.parent_id)) {
            allowed.add(t.id); changed = true;
          }
        }
      }
      // Aktiv pulsierende Knoten immer einschließen (Stop-Race-Condition-Sicherheit)
      for (const t of all) if (t.status === "thinking") allowed.add(t.id);
      all = all.filter(t => allowed.has(t.id));
    }
  }

  const nodeById = new Map();

  // Eigenen _key pro target pflegen, damit Collapse-Check funktioniert
  // (muss identisch zu keyOf() sein — _key falls gesetzt, sonst name)
  function keyForNode(n) { return n._key || n.name; }

  // Themen-Map aus Prompts aufbauen (promptId → themeName) + Themen-Set
  const promptTheme = new Map();
  const themeSet = new Set();
  for (const t of all) {
    if (t.kind === "user_prompt") {
      const theme = classifyTopic((t.detail && t.detail.prompt) || t.text || "");
      promptTheme.set(t.id, theme);
      themeSet.add(theme);
    }
  }
  // Theme sub-branches under Topics + all tool buckets (Tools/Web/Agents)
  const topicsBranch = findNode(tree, "Topics");
  const toolsBranch = findNode(tree, "Tools");
  const thoughtsBranch = findNode(tree, "Thoughts");
  const toolBucketNames = ["Tools", "Web", "Agents"];
  const themeNodes = {
    topics: new Map(), Tools: new Map(), Web: new Map(), Agents: new Map()
  };
  const sortedThemes = [...themeSet].sort();
  for (const theme of sortedThemes) {
    const col = themeColor(theme);
    if (topicsBranch) {
      const n = { name: theme, color: col, _key: 'th:t:' + theme, children: [] };
      topicsBranch.children.push(n);
      themeNodes.topics.set(theme, n);
    }
    for (const bucketName of toolBucketNames) {
      const bucket = findNode(tree, bucketName);
      if (!bucket) continue;
      // Theme sub-branches under tool buckets inherit the BUCKET color
      // (Tools = yellow, Web = cyan, Agents = purple) — not the theme color.
      // Only under "Topics" the theme color is used.
      const n = { name: theme, color: bucket.color, _key: `th:${bucketName}:${theme}`, children: [] };
      bucket.children.push(n);
      themeNodes[bucketName].set(theme, n);
    }
  }

  // Thoughts-Gruppierung: pro LLM-Cluster einen Theme-Node direkt unter
  // "Thoughts". Subclusters werden per "Parent › Child" in den Namen
  // geflatted — der Ast bleibt flach. Thoughts ohne Cluster landen in
  // einem lazy-erzeugten "Unclustered"-Bucket.
  const thoughtCluster = new Map();  // thoughtId → themeNode
  if (thoughtsBranch && llmCluster && Array.isArray(llmCluster.clusters)) {
    const seen = new Set();
    const walk = (c, prefix) => {
      const label = prefix ? `${prefix} › ${c.name || 'Cluster'}` : (c.name || 'Cluster');
      const items = (c.items || []).filter(id => {
        const t = liveThoughts.get(id);
        return t && (t.kind === 'thinking' || t.kind === 'assistant_text');
      });
      if (items.length > 0) {
        const themeNode = { name: label, color: thoughtsBranch.color,
          _key: `th:Thoughts:llm:${label}`, children: [] };
        thoughtsBranch.children.push(themeNode);
        for (const id of items) {
          if (seen.has(id)) continue;
          seen.add(id);
          thoughtCluster.set(id, themeNode);
        }
      }
      for (const sc of (c.subclusters || [])) walk(sc, label);
    };
    for (const c of llmCluster.clusters) walk(c, '');
  }
  let unclusteredNode = null;
  const getUnclusteredNode = () => {
    if (unclusteredNode || !thoughtsBranch) return unclusteredNode;
    unclusteredNode = { name: "Unclustered", color: thoughtsBranch.color,
      _key: `th:Thoughts:unclustered`, children: [] };
    thoughtsBranch.children.push(unclusteredNode);
    return unclusteredNode;
  };

  for (const t of all) {
    let target = null;
    const isTool = t.kind && t.kind.startsWith("tool");
    const isThought = t.kind === "thinking" || t.kind === "assistant_text";
    if (t.kind === "user_prompt") {
      const theme = promptTheme.get(t.id);
      target = theme ? themeNodes.topics.get(theme) : topicsBranch;
    } else if (isTool) {
      // Bucket from t.parent (Tools/Web/Agents), theme from parent_id → prompt
      const bucket = toolBucketNames.includes(t.parent) ? t.parent : "Tools";
      const parentTheme = t.parent_id && promptTheme.get(t.parent_id);
      if (parentTheme && themeNodes[bucket] && themeNodes[bucket].has(parentTheme)) {
        target = themeNodes[bucket].get(parentTheme);
      } else {
        target = findNode(tree, bucket) || toolsBranch;
      }
    } else if (isThought) {
      target = thoughtCluster.get(t.id) || getUnclusteredNode() || thoughtsBranch;
    } else {
      target = findNode(tree, t.parent);
    }
    if (!target) continue;
    const tkey = keyForNode(target);
    if (isCollapsed(tkey)) { hasHiddenChildren.add(tkey); continue; }
    // Bubble-Text für alle Gedanken (thinking + assistant_text). So können
    // auch aktuelle Antworten als Gedankenblase/Wolke erscheinen, nicht nur
    // Reasoning-Blöcke.
    const bubbleText = (t.kind === "thinking" || t.kind === "assistant_text")
      ? ((t.detail && t.detail.body) || t.text || "")
      : null;
    const newNode = {
      name: t.text, _key: 't:' + t.id, _status: t.status, _kind: t.kind,
      _thoughtId: t.id, _ts: t.ts || 0,
      _bubbleText: bubbleText
    };
    if (!target.children) target.children = [];
    target.children.push(newNode);
    nodeById.set(t.id, newNode);
  }

  // --- LLM-Mindmap: unter "Mindmap"-Hauptast eine hierarchische Struktur
  //     aus dem Cluster-Payload aufbauen. Jeder Blatt-Knoten zeigt auf eine
  //     Thought-ID (als Kurzlabel); Cluster-/Subcluster-Knoten sind Kategorien.
  const mindmapBranch = findNode(tree, "Mindmap");
  if (mindmapBranch && llmCluster && Array.isArray(llmCluster.clusters)) {
    const thoughtById = new Map();
    for (const t of all) thoughtById.set(t.id, t);
    const addCluster = (c, parent, inheritColor) => {
      const col = c.color || inheritColor || mindmapBranch.color;
      const cNode = {
        name: c.name || 'Cluster',
        color: col,
        _key: `mm:${parent._key || parent.name}:${c.name}`,
        children: []
      };
      parent.children.push(cNode);
      // Sub-Cluster
      for (const sc of (c.subclusters || [])) addCluster(sc, cNode, col);
      // Items (Thought-IDs → Leaf-Knoten)
      for (const id of (c.items || [])) {
        const t = thoughtById.get(id);
        if (!t) continue;
        const leaf = {
          name: t.text,
          color: col,
          _key: 'mm-t:' + id,
          _status: t.status,
          _kind: t.kind,
          _thoughtId: id,
          _ts: t.ts || 0,
          _bubbleText: t.kind === 'thinking' ? ((t.detail && t.detail.body) || t.text || '') : null
        };
        cNode.children.push(leaf);
      }
    };
    for (const c of llmCluster.clusters) addCluster(c, mindmapBranch, null);
  }
  return tree;
}

// ---------- TopicTree-Ansicht ----------
// LLM-Cluster werden zu Hauptaesten, innerhalb jedes Clusters werden die Items
// nach Kategorie gruppiert (Topics gruen, Tools gelb, Web cyan, Agents purple,
// Thoughts pink). Subcluster werden als separate Top-Level-Aeste mit "Parent ›
// Child"-Name flach abgebildet. Items ohne Cluster landen unter "Unclustered".
const TOPICTREE_CATEGORIES = [
  { name: "Topics",   color: "#10b981", kinds: ["user_prompt"] },
  { name: "Tools",    color: "#fbbf24", parents: ["Tools"] },
  { name: "Web",      color: "#22d3ee", parents: ["Web"] },
  { name: "Agents",   color: "#c084fc", parents: ["Agents"] },
  { name: "Thoughts", color: "#f472b6", kinds: ["thinking", "assistant_text"] },
];

function classifyItemForTopicTree(t) {
  if (t.kind === "user_prompt") return "Topics";
  if (t.kind === "thinking" || t.kind === "assistant_text") return "Thoughts";
  if (t.kind && t.kind.startsWith("tool")) {
    if (t.parent === "Web") return "Web";
    if (t.parent === "Agents") return "Agents";
    return "Tools";
  }
  return null;
}

function buildTreeTopicTree() {
  hasHiddenChildren = new Set();
  window.__hasHiddenChildren = hasHiddenChildren;
  const tree = { name: "Current Context", color: "#ffffff", children: [] };

  // Filter (historyDepth + onlyActive) — identisch zu buildTreeDefault.
  let all = [...liveThoughts.values()].filter(t => !t.silent)
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const depthPct = Math.max(0, Math.min(100, parseInt(settings.historyDepth) || 0));
  if (depthPct < 100 && all.length > 5) {
    const keep = Math.max(1, Math.ceil(all.length * (depthPct / 100)));
    all = all.slice(-keep);
  }
  if (settings.onlyActive) {
    let latestPromptId = null, latestPromptSeq = -1;
    for (const t of all) {
      if (t.kind === "user_prompt" && (t.seq || 0) > latestPromptSeq) {
        latestPromptSeq = t.seq || 0;
        latestPromptId = t.id;
      }
    }
    if (latestPromptId) {
      const allowed = new Set([latestPromptId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of all) {
          if (!allowed.has(t.id) && t.parent_id && allowed.has(t.parent_id)) {
            allowed.add(t.id); changed = true;
          }
        }
      }
      for (const t of all) if (t.status === "thinking") allowed.add(t.id);
      all = all.filter(t => allowed.has(t.id));
    }
  }

  const idSet = new Set(all.map(t => t.id));
  const byId = new Map(all.map(t => [t.id, t]));

  // Seed: id → cluster-label aus LLM-Output, Subcluster geflatted.
  const itemCluster = new Map();
  const labelOrder = [];
  if (llmCluster && Array.isArray(llmCluster.clusters)) {
    const walk = (c, prefix) => {
      const label = prefix ? `${prefix} › ${c.name || 'Cluster'}` : (c.name || 'Cluster');
      let seeded = false;
      for (const id of (c.items || [])) {
        if (!idSet.has(id) || itemCluster.has(id)) continue;
        itemCluster.set(id, label);
        seeded = true;
      }
      if (seeded && !labelOrder.includes(label)) labelOrder.push(label);
      for (const sc of (c.subclusters || [])) walk(sc, label);
    };
    for (const c of llmCluster.clusters) walk(c, '');
  }

  // Parent-Chain-Vererbung: lokale LLMs assignen in der Praxis oft nur
  // thinking-Bloecke, aber user_prompts/Tools gehoeren inhaltlich zum gleichen
  // Cluster wie ihre Geschwister-Thoughts. Wir propagieren Labels bidirektional
  // (Kind → Eltern, Eltern → Kind) bis Fixpunkt. Ohne dieses Post-Processing
  // landen ~95 % aller Items in "Unclustered".
  const childrenByParent = new Map();
  for (const t of all) {
    if (!t.parent_id) continue;
    if (!childrenByParent.has(t.parent_id)) childrenByParent.set(t.parent_id, []);
    childrenByParent.get(t.parent_id).push(t.id);
  }
  let propChanged = true;
  while (propChanged) {
    propChanged = false;
    for (const t of all) {
      if (itemCluster.has(t.id)) continue;
      const clusteredChild = (childrenByParent.get(t.id) || []).find(c => itemCluster.has(c));
      if (clusteredChild) {
        itemCluster.set(t.id, itemCluster.get(clusteredChild));
        propChanged = true;
        continue;
      }
      if (t.parent_id && itemCluster.has(t.parent_id)) {
        itemCluster.set(t.id, itemCluster.get(t.parent_id));
        propChanged = true;
      }
    }
  }

  // Timeline-Nachbarschafts-Vererbung mit Distanz-Cutoff: Items, die weder
  // thematisch (LLM) noch ueber Parent-Chain erfasst wurden, erben den Cluster
  // des zeitlich naechsten gelabelten Nachbarn — ABER nur, wenn der Nachbar
  // <= TIMELINE_MAX_DIST Schritte entfernt ist. Sonst wandert das Item in
  // einen "Older context"-Bucket, damit einzelne Cluster nicht ganze Zeitzonen
  // aufsaugen. Zwei Sweeps: forward/backward-Distanz + naeher-gelegen gewinnt.
  const TIMELINE_MAX_DIST = 25;
  const fwd = new Array(all.length).fill(null);
  let lastLbl = null;
  for (let i = 0; i < all.length; i++) {
    const c = itemCluster.get(all[i].id);
    if (c) lastLbl = c;
    fwd[i] = lastLbl;
  }
  const bwd = new Array(all.length).fill(null);
  lastLbl = null;
  // Rueckwaertspass braucht auch die Distanz, damit wir vergleichen koennen
  const fwdDist = new Array(all.length).fill(Infinity);
  const bwdDist = new Array(all.length).fill(Infinity);
  let d = Infinity;
  for (let i = 0; i < all.length; i++) {
    if (itemCluster.has(all[i].id)) d = 0;
    else if (d !== Infinity) d++;
    fwdDist[i] = d;
  }
  d = Infinity;
  for (let i = all.length - 1; i >= 0; i--) {
    const c = itemCluster.get(all[i].id);
    if (c) { lastLbl = c; d = 0; }
    else if (d !== Infinity) d++;
    bwd[i] = lastLbl;
    bwdDist[i] = d;
  }
  for (let i = 0; i < all.length; i++) {
    if (itemCluster.has(all[i].id)) continue;
    const f = fwd[i], b = bwd[i];
    // Beste Distanz (naeherer Nachbar)
    const bestDist = Math.min(fwdDist[i], bwdDist[i]);
    if (!isFinite(bestDist) || bestDist > TIMELINE_MAX_DIST) continue;  // zu weit weg
    if (f && !b) itemCluster.set(all[i].id, f);
    else if (!f && b) itemCluster.set(all[i].id, b);
    else if (f && b) {
      itemCluster.set(all[i].id, fwdDist[i] <= bwdDist[i] ? f : b);
    }
  }

  // Cluster-Liste aus itemCluster aufbauen (stabil nach labelOrder).
  const clusters = [];
  const itemsByLabel = new Map();
  for (const [id, label] of itemCluster) {
    if (!itemsByLabel.has(label)) itemsByLabel.set(label, new Set());
    itemsByLabel.get(label).add(id);
  }
  for (const label of labelOrder) {
    if (itemsByLabel.has(label)) clusters.push({ label, items: itemsByLabel.get(label) });
  }
  const unclaimed = new Set();
  for (const id of idSet) if (!itemCluster.has(id)) unclaimed.add(id);
  if (unclaimed.size > 0) clusters.push({ label: "Unclustered", items: unclaimed });

  // Cluster-Aeste aufbauen.
  for (const cl of clusters) {
    const clusterColor = cl.label === "Unclustered" ? "#888" : themeColor(cl.label);
    const clusterNode = {
      name: cl.label,
      color: clusterColor,
      _key: `tt:${cl.label}`,
      children: []
    };
    // Pro Kategorie einen Sub-Bucket (wird spaeter geleert von pruneEmptyBranches).
    const catNodes = {};
    for (const cat of TOPICTREE_CATEGORIES) {
      const n = {
        name: cat.name,
        color: cat.color,
        _key: `tt:${cl.label}:${cat.name}`,
        children: []
      };
      catNodes[cat.name] = n;
      clusterNode.children.push(n);
    }
    // Items einsortieren.
    for (const id of cl.items) {
      const t = byId.get(id);
      if (!t) continue;
      const category = classifyItemForTopicTree(t);
      const bucket = category && catNodes[category];
      if (!bucket) continue;
      const bkey = bucket._key;
      if (isCollapsed(bkey)) { hasHiddenChildren.add(bkey); continue; }
      const bubbleText = (t.kind === "thinking" || t.kind === "assistant_text")
        ? ((t.detail && t.detail.body) || t.text || "")
        : null;
      bucket.children.push({
        name: t.text, _key: 't:' + t.id, _status: t.status, _kind: t.kind,
        _thoughtId: t.id, _ts: t.ts || 0, _bubbleText: bubbleText
      });
    }
    const ckey = clusterNode._key;
    if (isCollapsed(ckey)) { hasHiddenChildren.add(ckey); continue; }
    tree.children.push(clusterNode);
  }

  return tree;
}

// ---------- Pruning ----------
// Entfernt alle Nicht-Blatt-Aeste, die keinen einzigen Thought-Leaf
// enthalten. Greift in beiden Modi: leere Top-Level-Buckets (z.B. "Mindmap"
// ohne LLM-Cluster) und leere Theme-/Kategorie-Zwischenknoten verschwinden,
// sobald der History-Slider Items aus dem Snapshot wegschneidet.
function pruneEmptyBranches(tree) {
  const hasLeaf = n => {
    if (n && n._thoughtId) return true;
    if (!n || !Array.isArray(n.children)) return false;
    return n.children.some(hasLeaf);
  };
  const walk = n => {
    if (!n || !Array.isArray(n.children)) return;
    n.children = n.children.filter(hasLeaf);
    n.children.forEach(walk);
  };
  walk(tree);
}

// ---------- Dispatcher ----------
function buildTree() {
  const tree = settings.viewMode === 'topictree'
    ? buildTreeTopicTree()
    : buildTreeDefault();
  pruneEmptyBranches(tree);
  return tree;
}

function hasThinking(node) {
  if (!node.children) return false;
  return node.children.some(c => c.data._status === 'thinking' || hasThinking(c));
}

function rebuild(opts) {
  const saved = new Map();
  if (root) root.descendants().forEach(n => saved.set(keyOf(n), { x: n.x, y: n.y, vx: n.vx || 0, vy: n.vy || 0 }));

  root = d3.hierarchy(buildTree());
  const W = window.innerWidth, H = window.innerHeight;
  root.descendants().forEach(n => {
    const p = saved.get(keyOf(n));
    if (p) Object.assign(n, p);
    else if (n.parent) {
      const pp = saved.get(keyOf(n.parent));
      if (pp) { n.x = pp.x + (Math.random() - 0.5) * 40; n.y = pp.y + (Math.random() - 0.5) * 40; }
      else { n.x = W / 2; n.y = H / 2; }
    } else { n.x = W / 2; n.y = H / 2; }
  });

  // Legende aktualisieren, wenn neue depth-1-Farben auftauchen
  let legendChanged = false;
  for (const c of baseTree.children) {
    if (knownColors.get(c.name) !== c.color) {
      knownColors.set(c.name, c.color); legendChanged = true;
    }
  }
  if (legendChanged) renderLegend();

  function isDim() { return false; }

  const linkSel = g.select(".links").selectAll("path")
    .data(root.links(), d => keyOf(d.source) + "→" + keyOf(d.target));
  linkSel.exit().remove();
  const linkEnter = linkSel.enter().append("path").attr("class", "link").attr("stroke", d => colorOf(d.target));
  linkEnter.merge(linkSel)
    .classed("thinking", d => d.target.data._status === "thinking")
    .classed("dim", d => isDim(d.target));

  const nodeSel = g.select(".nodes").selectAll("g.node").data(root.descendants(), keyOf);
  nodeSel.exit().remove();
  const nodeEnter = nodeSel.enter().append("g")
    .attr("class", d => nodeClass(d))
    .call(d3.drag()
      // Drag-Reheat bewusst niedrig (0.08 statt 0.3): nur der gezogene Knoten
      // soll sich bewegen, Nachbarn sollen NICHT mittanzen.
      .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.08).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
  // Große unsichtbare Hitbox zuerst (empfängt Klicks für Toggle)
  nodeEnter.append("circle").attr("class", "hitbox")
    .on("click", (ev, d) => { ev.stopPropagation(); toggleCollapse(d); });
  nodeEnter.append("circle").attr("class", "halo").attr("stroke", d => colorOf(d));
  nodeEnter.append("circle").attr("class", "main");
  nodeEnter.append("text").attr("class", "plus").text("+")
    .on("click", (ev, d) => { ev.stopPropagation(); toggleCollapse(d); });
  nodeEnter.append("text").attr("class", "label")
    .on("click", (ev, d) => { ev.stopPropagation(); onNodeClick(d); });
  nodeEnter.append("rect").attr("class", "search-box");

  const all = nodeEnter.merge(nodeSel);
  all.attr("class", d => nodeClass(d));
  all.select("circle.hitbox")
    .attr("r", d => d.depth === 0 ? 48 : d.depth === 1 ? 28 : d.depth === 2 ? 20 : 14);
  all.select("circle.main").attr("r", d => d.depth === 0 ? 22 : d.depth === 1 ? 9 : d.depth === 2 ? 7 : 5).attr("fill", nodeColor);
  all.select("circle.halo").attr("stroke", d => nodeColor(d));
  all.select("text.label").attr("dy", 4).attr("x", d => d.depth === 0 ? 30 : 12)
    .text(d => truncateLabel(d.data.name))
    .style("fill", d => readableColor(nodeColor(d)))  // Font im Light-Mode abgedunkelt für Kontrast
    .style("stroke", null)
    .style("stroke-width", null);
  // "+" nur bei eingeklappten Knoten mit tatsächlich vorhandenen Kindern
  all.select("text.plus")
    .attr("x", 0).attr("y", 0)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .style("display", d => hasHiddenChildren.has(keyOf(d)) ? null : "none");

  // Opacity + Schriftgröße je nach Alter
  const tss = root.descendants().map(n => n.data._ts).filter(x => x);
  const tmax = tss.length ? Math.max(...tss) : 0;
  const tmin = tss.length ? Math.min(...tss) : 0;
  const span = Math.max(1, tmax - tmin);
  function ageFactor(d) {
    if (d.data._status === "thinking") return 1;
    if (!d.data._ts || d.depth <= 1) return 1;
    return 1 - (tmax - d.data._ts) / span;  // 0 = alt, 1 = neu
  }
  function opacityFor(d) {
    const f = ageFactor(d);
    if (d.data._status === "thinking" || d.depth <= 1) return 0.97;
    return 0.05 + f * 0.92;  // 0.05..0.97
  }
  function fontSizeFor(d) {
    // Alle Werte ca. 20 % kleiner als zuvor
    if (d.depth === 0) return "14px";
    if (d.depth === 1) return "12px";
    if (d.data._status === "thinking") return "13px";
    const f = ageFactor(d);
    return (3.2 + f * 9.6).toFixed(1) + "px";  // 3.2 .. 12.8 px
  }
  all.select("circle.main").style("opacity", opacityFor);
  all.select("text.label").style("opacity", opacityFor).style("font-size", fontSizeFor);
  g.select(".links").selectAll("path").style("opacity", d => opacityFor(d.target));

  // Such-Rechteck pro Knoten an Label+Kreis anpassen (wird erst bei
  // search-match sichtbar; siehe .node rect.search-box CSS).
  all.select("rect.search-box").each(function() {
    try {
      const gNode = this.parentNode;
      const label = gNode.querySelector("text.label");
      const circle = gNode.querySelector("circle.main");
      if (!label || !circle) return;
      const lb = label.getBBox();
      const cr = +circle.getAttribute("r") || 5;
      const pad = 6;
      const x = -cr - pad;
      const yTop = Math.min(lb.y, -cr) - pad;
      const xEnd = Math.max(lb.x + lb.width, cr) + pad;
      const yBot = Math.max(lb.y + lb.height, cr) + pad;
      this.setAttribute("x", x);
      this.setAttribute("y", yTop);
      this.setAttribute("width", xEnd - x);
      this.setAttribute("height", yBot - yTop);
    } catch (_) {}
  });

  // Suchfilter nach jedem Rebuild erneut anwenden
  if (typeof applySearch === 'function') applySearch();

  // WebGL-Graph synchronisieren — auch im 2D-Modus, denn die sichtbare
  // Darstellung laeuft in beiden Modi ueber forceGraph3d (numDimensions 2/3).
  // Ohne diesen Call wuerde z.B. der Verlaufs-Tiefe-Slider im 2D-Modus
  // den Graph nicht live aktualisieren.
  if (typeof update3D === 'function') update3D(opts);

  // Overview-Mini-Mindmap synchronisieren (no-op wenn settings.overview === false)
  if (typeof updateOverview === 'function') updateOverview(root);

  // Hover-Sync Main → Overview an neuen Nodes registrieren
  if (typeof syncHoverFromMain === 'function') {
    nodeEnter
      .on("mouseenter.ov", (ev, d) => syncHoverFromMain(keyOf(d)))
      .on("mouseleave.ov", () => syncHoverFromMain(null));
  }

  // Adaptive Skalierung: mehr Knoten → etwas kompakter, aber nie zu klein
  const nCount = root.descendants().length;
  const densityScale = Math.max(0.8, Math.min(1.2, Math.sqrt(50 / Math.max(30, nCount))));
  if (!sim) {
    sim = d3.forceSimulation(root.descendants())
      .velocityDecay(0.82)      // Staerkere Daempfung: schnellerer Impuls-Abbau,
                                // Graph kommt ruhiger zur Ruhe, Bewegungen wirken "schwerer".
      .alphaDecay(0.012)        // 3.33x laenger bis Stillstand
      .alphaMin(0.002)
      .force("link", d3.forceLink(root.links()).id(keyOf)
        // Kurze Distanz + starker Pull fuer tiefe Knoten, damit Blatt-Cluster
        // eng um ihren Parent bleiben und keine "frei fliegenden" Einzel-
        // knoten entstehen, die visuell vom Graph getrennt wirken.
        .distance(d => (d.source.depth === 0 ? 190 : d.source.depth === 1 ? 70 : d.source.depth === 2 ? 38 : 32) * densityScale)
        .strength(d => d.source.depth === 1 ? 1.1 : d.source.depth === 2 ? 1.0 : d.source.depth >= 3 ? 1.6 : 0.7))
      .force("charge", d3.forceManyBody().strength(d => (d.depth === 0 ? -1500 : d.depth === 1 ? -420 : d.depth === 2 ? -120 : -20) * densityScale))
      .force("center", d3.forceCenter(W / 2, H / 2))
      // Radial-Force fuer Tiefe >=3 abgeschaltet: Blätter sollen ausschliesslich
      // von ihrem Parent-Link angezogen werden, nicht in einen festen Aussenring.
      .force("radial", d3.forceRadial(d => [0, 140, 260, 340, 400][Math.min(d.depth, 4)] * densityScale, W / 2, H / 2).strength(d => d.depth <= 1 ? 0.3 : d.depth === 2 ? 0.08 : 0))
      .force("x", d3.forceX(W / 2).strength(0.035))
      .force("y", d3.forceY(H / 2).strength(0.035))
      // Kleinerer Collide-Radius fuer Tiefe >=3: viele Cluster-Leaves
      // sollen sich eng um ihren Parent packen koennen, ohne dass der
      // Collide-Radius (ueber 2x Node-Radius) den Link-Constraint sprengt.
      .force("collide", d3.forceCollide().radius(d => (d.data._kind === "thinking" ? 60 : d.depth === 0 ? 90 : d.depth === 1 ? 55 : d.depth === 2 ? 32 : 10) * densityScale))
      .on("tick", tick);
  } else {
    sim.force("link").distance(d => (d.source.depth === 0 ? 190 : d.source.depth === 1 ? 70 : d.source.depth === 2 ? 38 : 32) * densityScale)
      .strength(d => d.source.depth === 1 ? 1.1 : d.source.depth === 2 ? 1.0 : d.source.depth >= 3 ? 1.6 : 0.7);
    sim.force("charge").strength(d => (d.depth === 0 ? -1500 : d.depth === 1 ? -420 : d.depth === 2 ? -120 : -20) * densityScale);
    sim.force("radial").radius(d => [0, 140, 260, 340, 400][Math.min(d.depth, 4)] * densityScale)
      .strength(d => d.depth <= 1 ? 0.3 : d.depth === 2 ? 0.08 : 0);
    sim.force("collide").radius(d => (d.data._kind === "thinking" ? 60 : d.depth === 0 ? 90 : d.depth === 1 ? 55 : d.depth === 2 ? 32 : 10) * densityScale);
    sim.nodes(root.descendants());
    sim.force("link").links(root.links());
    // Reheat: beim Toggle mit kraeftigerem Impuls damit neue Sub-Knoten
    // schnell ihre Position finden. Bei neuen Thoughts sanfter.
    if (opts && opts.fromToggle) sim.alpha(0.25).restart();
    else sim.alpha(0.08).restart();
  }

  // Auto-Fit beim ersten Rebuild (nach Settle der Simulation)
  if (!autoFitDone && root.descendants().length > 4) {
    autoFitDone = true;
    const fitAfterSettle = () => { setTimeout(autoFit, 200); sim.on('end', null); };
    sim.on('end', fitAfterSettle);
    setTimeout(fitAfterSettle, 3500);  // Safety-Fallback
  }
}

let autoFitDone = false;
function autoFit() {
  try {
    const bbox = g.node().getBBox();
    if (!bbox.width || !bbox.height || bbox.width < 50) return;
    const W = window.innerWidth, H = window.innerHeight;
    const pad = 120;
    const scale = Math.min((W - 2*pad) / bbox.width, (H - 2*pad) / bbox.height, 1);
    const tx = W/2 - (bbox.x + bbox.width/2) * scale;
    const ty = H/2 - (bbox.y + bbox.height/2) * scale;
    svg.transition().duration(950).ease(d3.easeCubicInOut)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  } catch (e) { /* ignore */ }
}

function nodeClass(d) {
  const parts = ["node", "depth-" + d.depth];
  if (d.depth === 0) parts.push("center");
  if (d.data._status) parts.push(d.data._status);
  if (d.data._kind) parts.push(d.data._kind);
  if (selectedKey === keyOf(d)) parts.push("selected");
  if (settings.collapsed[keyOf(d)]) parts.push("collapsed-node");
  return parts.join(" ");
}

// Retract-Animation fuer Knoten die gleich verschwinden: sie fliegen in
// das Parent-Zentrum und schrumpfen dabei. Die tatsaechliche Entfernung
// aus dem Graph erfolgt erst NACH der Animation.
const RETRACT_DUR = 733;  // ms
function startRetractAnimation(rootD) {
  if (!forceGraph3d || !window.THREE) return;
  const scene = forceGraph3d.scene && forceGraph3d.scene();
  if (!scene) return;
  const parentKey = keyOf(rootD);
  // Parent-Weltposition ermitteln
  let parentGroup = null;
  scene.traverse(o => { if (!parentGroup && o.userData && o.userData.nodeId === parentKey) parentGroup = o; });
  if (!parentGroup) return;
  const pwp = new THREE.Vector3();
  parentGroup.getWorldPosition(pwp);
  // IDs aller Nachkommen sammeln (die gleich hidden werden)
  const toHide = new Set();
  (function collect(n){ if(!n.children) return; for(const c of n.children){ toHide.add(keyOf(c)); collect(c); } })(rootD);
  // Deren Gruppen fuer Retract markieren
  const now = performance.now();
  scene.traverse(obj => {
    if (!obj.userData || !obj.userData.nodeId) return;
    if (!toHide.has(obj.userData.nodeId)) return;
    obj.userData.retracting = true;
    obj.userData.retractStartT = now;
    obj.userData.retractFrom = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    obj.userData.retractTo = { x: pwp.x, y: pwp.y, z: pwp.z };
  });
}

function toggleCollapse(d) {
  const k = keyOf(d);
  // Entscheiden: ist der Klick insgesamt eine Collapse-Aktion (→ Retract
  // zeigen) oder eine Expand-Aktion (→ sofort rebuilden, Bubble-Out im rAF)?
  const isD1Main = d.depth === 1 && d.children && d.children.length > 1;
  const willCollapse = isD1Main
    ? d.children.some(c => !settings.collapsed[keyOf(c)])
    : !settings.collapsed[k];

  const applyToggle = () => {
    if (isD1Main) {
      const anyExpanded = d.children.some(c => !settings.collapsed[keyOf(c)]);
      for (const c of d.children) {
        const ck = keyOf(c);
        if (anyExpanded) settings.collapsed[ck] = true;
        else delete settings.collapsed[ck];
      }
    } else {
      if (settings.collapsed[k]) delete settings.collapsed[k];
      else settings.collapsed[k] = true;
    }
    saveSettings();
    rebuild({ fromToggle: true });
  };

  if (willCollapse) {
    // Kinder schnuppern zuerst in den Parent zurueck, dann erst wegraeumen
    startRetractAnimation(d);
    setTimeout(applyToggle, RETRACT_DUR);
  } else {
    // Expand: sofort bauen — neue Kinder spawnen am Parent + Bubble-Out-Scale
    applyToggle();
  }
}

function tick() {
  g.select(".links").selectAll("path").attr("d", d => {
    const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
    return `M${d.source.x},${d.source.y} Q${d.source.x + dx/2},${d.source.y + dy/2} ${d.target.x},${d.target.y}`;
  });
  g.select(".nodes").selectAll("g.node").attr("transform", d => `translate(${d.x},${d.y})`);
}

function renderLegend() {
  legendList.innerHTML = '';
  const rows = [{name: baseTree.name, color: baseTree.color}];
  for (const c of baseTree.children) rows.push({name: c.name, color: c.color});
  rows.push({name: "active (thinking)", color: "#fde047"});
  rows.push({name: "User prompt", color: "#10b981"});
  for (const r of rows) {
    const el = document.createElement('div');
    el.className = 'row';
    el.innerHTML = `<span class="dot" style="background:${r.color};color:${r.color}"></span><span>${r.name}</span>`;
    legendList.appendChild(el);
  }
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============ Kompakte Overview-Mini-Mindmap ============
const OV_RADIUS = 96;
let overviewHoverKey = null;
function overviewSvgSel() { return d3.select('#overview-svg'); }
function buildOverviewHierarchy(mainRoot) {
  function clone(n) {
    const c = { name: n.data.name, _key: keyOf(n), color: n.data.color || colorOf(n),
                _depth: n.depth, _thoughtId: n.data._thoughtId };
    if (n.children && n.children.length) c.children = n.children.map(clone);
    return c;
  }
  return d3.hierarchy(clone(mainRoot));
}
function updateOverview(mainRoot) {
  if (!settings.overview || !mainRoot) return;
  const svgEl = document.getElementById('overview-svg');
  if (!svgEl) return;
  const ov = overviewSvgSel();
  const h = buildOverviewHierarchy(mainRoot);
  // d3.cluster: verteilt Blätter gleichmäßig im Winkelbereich — vermeidet,
  // dass grosse Sub-Baeume (z.B. Thoughts) die Radial-Scheibe einseitig
  // dominieren. Dafür werden alle Blätter auf den äußeren Ring gezogen.
  d3.cluster().size([2 * Math.PI, OV_RADIUS])
    .separation((a, b) => (a.parent == b.parent ? 1 : 2))(h);
  h.each(d => { d._ox = d.y * Math.cos(d.x - Math.PI / 2);
                d._oy = d.y * Math.sin(d.x - Math.PI / 2); });
  // Basis-Ring als Orientierung (dezent, hinter allem)
  if (ov.select('circle.ov-bg').empty()) {
    ov.insert('circle', ':first-child').attr('class', 'ov-bg')
      .attr('cx', 0).attr('cy', 0).attr('r', OV_RADIUS)
      .attr('fill', 'none')
      .attr('stroke', 'var(--border)')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5);
  }
  if (ov.select('g.ov-links').empty()) ov.append('g').attr('class', 'ov-links');
  if (ov.select('g.ov-viewport-layer').empty()) ov.append('g').attr('class', 'ov-viewport-layer');
  if (ov.select('g.ov-nodes').empty()) ov.append('g').attr('class', 'ov-nodes');
  const linkSel = ov.select('g.ov-links').selectAll('path.ov-link')
    .data(h.links(), d => d.source.data._key + '→' + d.target.data._key);
  linkSel.exit().remove();
  linkSel.enter().append('path').attr('class', 'ov-link').merge(linkSel)
    .attr('d', d => `M${d.source._ox},${d.source._oy}L${d.target._ox},${d.target._oy}`)
    .attr('stroke', d => d.target.data.color || '#888');
  const nodeSel = ov.select('g.ov-nodes').selectAll('circle.ov-node')
    .data(h.descendants(), d => d.data._key);
  nodeSel.exit().remove();
  const nodeEnter = nodeSel.enter().append('circle').attr('class', 'ov-node');
  const allNodes = nodeEnter.merge(nodeSel);
  allNodes
    .attr('cx', d => d._ox).attr('cy', d => d._oy)
    .attr('r', d => d.depth === 0 ? 3.5 : d.depth === 1 ? 2.6 : d.depth === 2 ? 1.8 : 1.3)
    .attr('fill', d => d.data.color || '#888')
    .classed('hovered', d => d.data._key === overviewHoverKey)
    .attr('data-ov-key', d => d.data._key);
  nodeEnter
    .on('click', (ev, d) => { ev.stopPropagation(); overviewJumpTo(d.data); })
    .on('mouseenter', (ev, d) => {
      overviewHoverKey = d.data._key;
      allNodes.classed('hovered', n => n.data._key === overviewHoverKey);
      syncHoverToMain(d.data._key);
    })
    .on('mouseleave', () => {
      overviewHoverKey = null;
      allNodes.classed('hovered', false);
      syncHoverToMain(null);
    });
  updateOverviewViewport();
}
function syncHoverToMain(key) {
  // Haupt-Graph rendert via WebGL (forceGraph3d) — Hover wird dort über
  // window.__hoveredNodeId gesteuert. Wir setzen es, damit die animLoop
  // Glow/Scale im WebGL-Node triggert.
  window.__hoveredNodeId = key || null;
  g.select('.nodes').selectAll('g.node')
    .classed('hover-linked', function(d) { return !!key && keyOf(d) === key; });
}
function syncHoverFromMain(key) {
  overviewHoverKey = key;
  d3.select('#overview-svg').selectAll('circle.ov-node')
    .classed('hovered', function() { return !!key && this.getAttribute('data-ov-key') === key; });
}
// Polling: window.__hoveredNodeId wird vom Canvas-Picker (init3D) gesetzt.
// Wir spiegeln Änderungen in die Overview-Highlight-Klasse, wenn der Hover
// nicht gerade aus der Overview selbst kommt.
let __lastMainHover = null;
setInterval(() => {
  if (!settings.overview) return;
  const cur = window.__hoveredNodeId || null;
  if (cur !== __lastMainHover) {
    __lastMainHover = cur;
    if (cur !== overviewHoverKey) syncHoverFromMain(cur);
  }
}, 100);
function overviewJumpTo(nodeData) {
  const key = nodeData._key;
  // Haupt-Graph rendert in beiden Modi über forceGraph3d — also immer die
  // 3D-Kamera bewegen. Im 2D-Modus bleibt die Z-Achse fix (Top-Down-Blick).
  if (!forceGraph3d || !forceGraph3d.graphData) return;
  const data = forceGraph3d.graphData();
  const n3d = data.nodes.find(n => n.id === key);
  if (!n3d || n3d.x == null) return;
  if (settings.threeD) {
    const distance = 180;
    const len = Math.hypot(n3d.x || 0.01, n3d.y || 0.01, n3d.z || 0.01);
    const distRatio = 1 + distance / Math.max(len, 10);
    forceGraph3d.cameraPosition(
      { x: n3d.x * distRatio, y: n3d.y * distRatio, z: n3d.z * distRatio },
      n3d, 900);
  } else {
    // 2D: Kamera parallel zur Z-Achse, nur x/y verschieben, z behalten
    const curZ = (forceGraph3d.camera && forceGraph3d.camera().position.z) || 520;
    forceGraph3d.cameraPosition(
      { x: n3d.x, y: n3d.y, z: Math.max(Math.abs(curZ), 260) },
      { x: n3d.x, y: n3d.y, z: 0 }, 800);
  }
}
function updateOverviewViewport() {
  if (!settings.overview) return;
  const ov = overviewSvgSel();
  const layer = ov.select('g.ov-viewport-layer');
  if (layer.empty() || !root) return;
  layer.selectAll('*').remove();
  const descs = root.descendants().filter(n => n.x != null && n.y != null);
  if (descs.length < 2) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of descs) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
  }
  const wRange = Math.max(1, maxX - minX);
  const hRange = Math.max(1, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const scale = Math.min((OV_RADIUS * 1.8) / wRange, (OV_RADIUS * 1.8) / hRange);
  const toOv = (wx, wy) => [(wx - cx) * scale, (wy - cy) * scale];
  // Haupt-Graph läuft in beiden Modi über forceGraph3d → immer die Kamera
  // verwenden. Im 2D-Modus: rechteckiger Frustum-Schnitt auf z=0-Ebene.
  if (!forceGraph3d || !forceGraph3d.camera) return;
  const cam = forceGraph3d.camera();
  if (!cam) return;
  const camPos = cam.position;
  const fov = (cam.fov || 50) * Math.PI / 180;
  const W = window.innerWidth, H = window.innerHeight;
  const aspect = W / Math.max(H, 1);

  if (settings.threeD) {
    // 3D: Kreis als sichtbare Sphäre (vereinfacht)
    const dist = Math.hypot(camPos.x, camPos.y, camPos.z);
    const visR = Math.abs(dist * Math.tan(fov / 2));
    let [ox, oy] = toOv(camPos.x, camPos.y);
    // Zentrum auf Overview-Grenzen clampen + Radius begrenzen
    const CLAMP = 108;
    ox = Math.max(-CLAMP, Math.min(CLAMP, ox));
    oy = Math.max(-CLAMP, Math.min(CLAMP, oy));
    const r = Math.min(CLAMP, Math.max(6, visR * scale));
    layer.append('circle').attr('class', 'ov-viewport')
      .attr('cx', ox).attr('cy', oy)
      .attr('r', r);
  } else {
    // 2D: sichtbarer Bereich auf z=0-Ebene = rechteck zentriert auf (camX, camY)
    const distZ = Math.abs(camPos.z) || 1;
    const halfH = distZ * Math.tan(fov / 2);
    const halfW = halfH * aspect;
    const x0 = camPos.x - halfW, x1 = camPos.x + halfW;
    const y0 = camPos.y - halfH, y1 = camPos.y + halfH;
    let [ox0, oy0] = toOv(x0, y0);
    let [ox1, oy1] = toOv(x1, y1);
    // Auf Overview-viewBox clippen (±108, 2px Innenabstand), damit der Rahmen
    // bei weiten Zoom-Outs nicht komplett verschwindet.
    const CLAMP = 108;
    const cox0 = Math.max(-CLAMP, Math.min(CLAMP, ox0));
    const cox1 = Math.max(-CLAMP, Math.min(CLAMP, ox1));
    const coy0 = Math.max(-CLAMP, Math.min(CLAMP, oy0));
    const coy1 = Math.max(-CLAMP, Math.min(CLAMP, oy1));
    layer.append('rect').attr('class', 'ov-viewport')
      .attr('x', cox0).attr('y', coy0)
      .attr('width', Math.max(2, cox1 - cox0))
      .attr('height', Math.max(2, coy1 - coy0));
  }
}

function logLine(thought) {
  const status = thought.status || 'done';
  const mark = status === 'thinking' ? '◉' : '✓';
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const kind = thought.kind || '';
  const existing = logList.querySelector(`[data-id="${CSS.escape(thought.id || '')}"]`);
  if (existing) {
    existing.className = `log-entry ${status} ${kind}`;
    existing.querySelector('.mark').textContent = mark;
    existing.querySelector('.text').textContent = thought.text;
    return;
  }
  const el = document.createElement('div');
  el.className = `log-entry ${status} ${kind}`;
  el.dataset.id = thought.id || '';
  el.innerHTML = `<span class="mark">${mark}</span>` +
    `<span class="time">${hh}:${mm}:${ss}</span>` +
    `<span><span class="parent">${escapeHtml(thought.parent || '')}</span>` +
    `<span class="arrow">›</span>` +
    `<span class="text">${escapeHtml(thought.text || '')}</span></span>`;
  el.addEventListener('click', () => focusNodeById(thought.id));
  logList.prepend(el);
  logTotal++;
  logCount.textContent = logTotal;
  while (logList.children.length > 60) logList.removeChild(logList.lastChild);
}

let llmCluster = null;          // aktuelles Cluster-Payload vom Server
let llmNextRefresh = 0;         // unix-TS
let llmClusterSig = '';         // Signature zum Erkennen echter Cluster-Updates

// Zentrale Delta-Verarbeitung. Wird sowohl aus SSE (setupStream)
// als auch aus dem Fallback-Poll (pollOnce) heraus aufgerufen.
function applyState(data) {
  if (!data || typeof data !== 'object') return;
  setOnline(true);
  let changed = false;
  const arr = Array.isArray(data.thoughts) ? data.thoughts : [];
  for (const t of arr) {
    liveThoughts.set(t.id, { ...liveThoughts.get(t.id), ...t });
    lastSeq = Math.max(lastSeq, t.seq || 0);
    changed = true;
    logLine(t);
  }
  if (typeof data.llm_next_refresh === 'number') llmNextRefresh = data.llm_next_refresh;
  if (data.llm_cluster) {
    const sig = (data.llm_cluster.updated_at || 0) + ':' + (data.llm_cluster.clusters?.length || 0);
    if (sig !== llmClusterSig) {
      llmCluster = data.llm_cluster;
      llmClusterSig = sig;
      changed = true;
    }
  }
  if (data.llm_status) {
    const hint = document.getElementById('llm-hint');
    if (hint) {
      if (data.llm_status === 'running') { hint.textContent = '⟳ clustering…'; hint.classList.remove('err'); }
      else if (typeof data.llm_status === 'string' && data.llm_status.startsWith('error:')) {
        hint.textContent = data.llm_status.slice(6, 80);
        hint.classList.add('err');
      } else { hint.textContent = ''; hint.classList.remove('err'); }
    }
  }
  if (changed) rebuild();
}

// Server-Offline-Banner: dezent oben, sobald SSE reconnecting ist
// oder laengere Zeit kein Heartbeat mehr ankommt.
const offlineBanner = document.getElementById('offline-banner');
let lastServerContact = Date.now();
function setOnline(online) {
  if (online) {
    lastServerContact = Date.now();
    connected = true;
    if (offlineBanner) offlineBanner.classList.remove('show');
  } else {
    connected = false;
    if (offlineBanner) offlineBanner.classList.add('show');
  }
}

// Fallback-Poll: wird nur benutzt, wenn EventSource nicht verfuegbar ist.
async function pollOnce() {
  try {
    const r = await fetch('/api/state?since=' + lastSeq, { cache: 'no-store' });
    if (!r.ok) throw new Error('state ' + r.status);
    applyState(await r.json());
  } catch (e) {
    setOnline(false);
  }
}

// SSE: Server pusht State-Deltas sobald sich was aendert. Ersetzt 500 ms-Polling.
// Der Browser reconnected EventSource automatisch bei Verbindungsabbruch.
let __sseSource = null;
function setupStream() {
  if (typeof EventSource === 'undefined') {
    // Sehr alter Browser → Fallback auf Polling
    setInterval(pollOnce, 500);
    pollOnce();
    return;
  }
  if (__sseSource) { try { __sseSource.close(); } catch (_) {} }
  __sseSource = new EventSource('/api/stream?since=' + lastSeq);
  __sseSource.onopen = () => setOnline(true);
  __sseSource.onmessage = (ev) => {
    try { applyState(JSON.parse(ev.data)); }
    catch (_) { /* malformed frame — Browser reconnect ignoriert das */ }
  };
  // Named 'heartbeat'-Events halten Verbindung warm und fuettern den Watchdog.
  __sseSource.addEventListener('heartbeat', () => setOnline(true));
  __sseSource.onerror = () => {
    // EventSource reconnected von sich aus. Wir markieren nur Offline,
    // bis ein onopen/onmessage-Event das wieder aufhebt.
    setOnline(false);
  };
}

// Watchdog: wenn der Server keine Heartbeats mehr sendet (z.B. eingefrorener
// TCP-Fluss), erkennen wir das nach 15 s und zeigen den Banner.
setInterval(() => {
  if (connected && Date.now() - lastServerContact > 15000) {
    setOnline(false);
  }
}, 3000);

// ---------- LLM-Settings (lokales LLM für Bubble-Clustering) ----------
async function loadLlmConfig() {
  try {
    const r = await fetch('/api/llm/config');
    if (!r.ok) return null;
    const cfg = await r.json();
    const u = document.getElementById('llm-url');
    const p = document.getElementById('llm-port');
    const m = document.getElementById('llm-model');
    if (u) u.value = cfg.url || 'localhost';
    if (p) p.value = cfg.port || 1234;
    if (m) {
      // Placeholder mit aktuellem Wert setzen — wird durch Modelle-Liste überschrieben
      if (![...m.options].some(o => o.value === cfg.model)) {
        m.innerHTML = `<option value="${cfg.model}">${cfg.model}</option>`;
      }
      m.value = cfg.model;
    }
    return cfg;
  } catch (e) { return null; }
}

async function saveLlmConfig() {
  const u = document.getElementById('llm-url');
  const p = document.getElementById('llm-port');
  const m = document.getElementById('llm-model');
  const body = {
    url: (u?.value || 'localhost').trim(),
    port: parseInt(p?.value || '1234', 10) || 1234,
    model: (m?.value || 'qwen3.5-9b').trim(),
  };
  await fetch('/api/llm/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
}

async function loadLlmModels() {
  const hint = document.getElementById('llm-hint');
  const m = document.getElementById('llm-model');
  if (hint) { hint.textContent = '⟳ loading…'; hint.classList.remove('err'); }
  try {
    // Aktuelle URL/Port zuerst speichern, damit der Proxy sie nutzt
    await saveLlmConfig();
    const r = await fetch('/api/llm/models');
    const data = await r.json();
    if (!data.ok) {
      if (hint) { hint.textContent = 'no models (' + (data.error || 'offline') + ')'; hint.classList.add('err'); }
      return;
    }
    const current = m?.value || '';
    if (m) {
      m.innerHTML = '';
      for (const id of data.models) {
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = id;
        m.appendChild(opt);
      }
      if (current && [...m.options].some(o => o.value === current)) m.value = current;
      else if (data.models.length) m.value = data.models[0];
    }
    if (hint) { hint.textContent = data.models.length + ' model(s)'; hint.classList.remove('err'); }
    await saveLlmConfig();
  } catch (e) {
    if (hint) { hint.textContent = 'Error: ' + e.message; hint.classList.add('err'); }
  }
}

async function triggerLlmRefresh() {
  const hint = document.getElementById('llm-hint');
  if (hint) { hint.textContent = '⟳ clustering…'; hint.classList.remove('err'); }
  try {
    const r = await fetch('/api/llm/refresh', { method:'POST' });
    const data = await r.json();
    if (!data.ok && hint) { hint.textContent = data.error || 'Error'; hint.classList.add('err'); }
  } catch (e) {
    if (hint) { hint.textContent = 'Error: ' + e.message; hint.classList.add('err'); }
  }
}

function updateCountdown() {
  const el = document.getElementById('llm-countdown');
  if (!el) return;
  if (!llmNextRefresh) { el.textContent = '—'; return; }
  const sec = Math.max(0, Math.round(llmNextRefresh - Date.now() / 1000));
  el.textContent = sec + 's';
}
setInterval(updateCountdown, 500);

// ---------- M1: Session-History-Picker ----------
async function loadSessionsList() {
  const sel = document.getElementById('session-select');
  if (!sel) return;
  try {
    const r = await fetch('/api/sessions');
    if (!r.ok) return;
    const data = await r.json();
    // Reset ohne die erste "latest (live)"-Option zu verlieren
    sel.innerHTML = '<option value="">— latest (live) —</option>';
    for (const s of (data.sessions || [])) {
      const dt = new Date(s.mtime * 1000);
      const when = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
      const preview = (s.preview || '').slice(0, 60);
      const opt = document.createElement('option');
      opt.value = s.path;
      opt.textContent = `${when} · ${preview} (${s.entries})`;
      sel.appendChild(opt);
    }
  } catch (_) { /* offline → Dropdown bleibt minimal */ }
}

async function loadSelectedSession(path) {
  if (!path) return; // "latest (live)" — nichts zu tun
  try {
    liveThoughts.clear();
    lastSeq = 0;
    logList.innerHTML = '';
    logTotal = 0;
    if (logCount) logCount.textContent = '0';
    const r = await fetch('/api/replay', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ transcript_path: path, depth: 1.0 }),
    });
    if (!r.ok) throw new Error('replay ' + r.status);
    // Nach Replay auch den SSE-Stream neu konnekten, damit wir den aktuellen
    // State als initial frame bekommen (inkl. der neu eingeladenen Thoughts).
    setupStream();
  } catch (e) {
    console.warn('session load failed', e);
  }
}

// ---------- M3: Export (PNG / SVG / JSON) ----------
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportPNG() {
  if (!forceGraph3d || !forceGraph3d.renderer) {
    alert('3D-Renderer noch nicht bereit');
    return;
  }
  try {
    const r = forceGraph3d.renderer();
    // Vor toDataURL explizit rendern — ohne preserveDrawingBuffer liefert
    // toDataURL sonst oft leere Pixel. Direkt danach ist der Buffer frisch.
    r.render(forceGraph3d.scene(), forceGraph3d.camera());
    const url = r.domElement.toDataURL('image/png');
    fetch(url).then(r => r.blob()).then(b => downloadBlob('brainmap.png', b));
  } catch (e) { console.warn('PNG export failed', e); }
}

function exportSVG() {
  try {
    const node = svg.node();
    // viewBox + width/height sicherstellen, damit der Export auch standalone rendert
    const bbox = node.getBBox();
    const clone = node.cloneNode(true);
    if (bbox.width > 0 && bbox.height > 0) {
      clone.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
      clone.setAttribute('width', bbox.width);
      clone.setAttribute('height', bbox.height);
    }
    const s = new XMLSerializer().serializeToString(clone);
    const prefix = '<?xml version="1.0" encoding="UTF-8"?>\n';
    downloadBlob('brainmap.svg', new Blob([prefix + s], { type: 'image/svg+xml' }));
  } catch (e) { console.warn('SVG export failed', e); }
}

function exportJSON() {
  try {
    const data = {
      exported_at: new Date().toISOString(),
      baseTree,
      thoughts: Array.from(liveThoughts.values()),
      llmCluster,
      settings,
    };
    const text = JSON.stringify(data, null, 2);
    downloadBlob('brainmap.json', new Blob([text], { type: 'application/json' }));
  } catch (e) { console.warn('JSON export failed', e); }
}

// Settings-Handler nach DOMReady verdrahten
window.addEventListener('DOMContentLoaded', () => {
  loadLlmConfig();
  loadSessionsList();
  const btnReload  = document.getElementById('llm-reload');
  const btnRefresh = document.getElementById('llm-refresh');
  const inpUrl = document.getElementById('llm-url');
  const inpPort = document.getElementById('llm-port');
  const inpModel = document.getElementById('llm-model');
  if (btnReload)  btnReload.addEventListener('click', loadLlmModels);
  if (btnRefresh) btnRefresh.addEventListener('click', triggerLlmRefresh);
  for (const el of [inpUrl, inpPort, inpModel]) if (el) el.addEventListener('change', saveLlmConfig);
  // Session-Picker
  const sel = document.getElementById('session-select');
  if (sel) {
    sel.addEventListener('focus', loadSessionsList);  // frische Liste bei Oeffnen
    sel.addEventListener('change', () => loadSelectedSession(sel.value));
    sel.addEventListener('click', e => e.stopPropagation());
  }
  // Export-Buttons
  const ePng  = document.getElementById('export-png');
  const eSvg  = document.getElementById('export-svg');
  const eJson = document.getElementById('export-json');
  if (ePng)  ePng.addEventListener('click', exportPNG);
  if (eSvg)  eSvg.addEventListener('click', exportSVG);
  if (eJson) eJson.addEventListener('click', exportJSON);
});

// ---------- Panel ----------
const panel = document.getElementById('panel');
const pTitle = document.getElementById('p-title');
const pMeta = document.getElementById('p-meta');
const pBody = document.getElementById('p-body');

function closePanel() { panel.classList.remove('open'); selectedKey = null; selectedColor = null;
  panel.style.setProperty('--panel-accent', '#fde047'); rebuild(); }
svg.on("click", closePanel);

async function onNodeClick(d) {
  selectedKey = keyOf(d);
  selectedColor = colorOf(d);
  panel.style.setProperty('--panel-accent', selectedColor);
  rebuild();
  const tid = d.data._thoughtId;
  pTitle.textContent = d.data.name;
  pMeta.textContent = '';
  pBody.innerHTML = '<div style="opacity:0.5;font-size:11px">loading context…</div>';
  panel.classList.add('open');
  if (!tid) {
    pBody.innerHTML = `<h4>Category</h4><div>Structure node without chat entry.</div>`;
    return;
  }
  try {
    const r = await fetch('/api/context?id=' + encodeURIComponent(tid));
    const data = await r.json();
    renderPanel(data);
  } catch (e) {
    pBody.innerHTML = '<div style="color:#f87171">Load error.</div>';
  }
}

function renderMd(text) {
  try {
    const raw = marked.parse(text || '', { breaks: true, gfm: true });
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
  } catch (e) { return escapeHtml(text || ''); }
}

function renderPanel(data) {
  const t = data.thought || {};
  const c = data.context || {};
  const parts = [];
  if (c.question) parts.push(`<h4>Question</h4><div class="md">${renderMd(c.question)}</div>`);
  if (c.assistant) parts.push(`<h4>Claude's response</h4><div class="md">${renderMd(c.assistant)}</div>`);
  if (c.tool) {
    const ti = typeof c.tool.input === 'string' ? c.tool.input : JSON.stringify(c.tool.input, null, 2);
    parts.push(`<h4>Tool call · ${escapeHtml(c.tool.name || t.tool_name || '')}</h4><pre>${escapeHtml(ti || '')}</pre>`);
  }
  if (c.tool_result) parts.push(`<h4>Tool result</h4><div class="md">${renderMd(c.tool_result)}</div>`);
  if (!parts.length) parts.push(`<div style="opacity:0.6">No context data available.</div>`);
  const buttons = [];
  if (t.transcript_path) buttons.push(`<button class="btn" onclick='openTranscript(${JSON.stringify(t.transcript_path)})'>📂 Open transcript</button>`);
  if (t.session_id) {
    buttons.push(`<button class="btn" onclick='copyText(${JSON.stringify(t.session_id)})'>📋 Session-ID</button>`);
    buttons.push(`<button class="btn" onclick='copyText("claude --resume " + ${JSON.stringify(t.session_id)})'>📋 claude --resume</button>`);
  }
  if (buttons.length) {
    parts.push('<h4>Jump to chat</h4><div>' + buttons.join('') + '</div>');
    parts.push(`<div class="meta">Terminal: <kbd>claude --resume ${escapeHtml(t.session_id || '')}</kbd></div>`);
  }
  pMeta.textContent = t.session_id ? ('Session · ' + t.session_id.slice(0, 8)) : '';
  pBody.innerHTML = parts.join('');
}

async function openTranscript(path) {
  await fetch('/api/open', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({path}) });
}
async function copyText(s) { try { await navigator.clipboard.writeText(s); } catch (e) {} }

// --- Suche (vor Boot initialisieren, damit rebuild() applySearch nutzen kann) ---
const searchInput = document.getElementById('search-input');
const searchHits = document.getElementById('search-hits');
let searchTerm = "";
// Speichert die aktuellen Treffer-IDs fuer den Fokus-Zoom der Suche.
window.__searchMatchIds = new Set();

function applySearch() {
  if (!searchHits) return;
  const q = searchTerm.trim().toLowerCase();
  const active = q.length >= 1;
  let hits = 0;
  // 2D-Match
  d3.selectAll('g.node').each(function(d) {
    const hit = active && ((d.data.name || "").toLowerCase().includes(q));
    this.classList.toggle('search-match', active && hit);
    this.classList.toggle('search-nomatch', active && !hit);
    if (hit) hits++;
  });
  d3.selectAll('.link').each(function(d) {
    const hit = active && ((d.target.data.name || "").toLowerCase().includes(q)
      || (d.source.data.name || "").toLowerCase().includes(q));
    this.classList.toggle('search-dim', active && !hit);
  });
  // Treffer-IDs fuer den Fokus-Zoom merken (Pfad-Set bleibt nur als
  // Datenbasis fuer das Heranzoomen auf die Trefferregion — keine
  // visuellen Dim-Effekte mehr auf Knoten oder Links).
  if (forceGraph3d) {
    const data = forceGraph3d.graphData();
    const ids = new Set();
    if (active) {
      data.nodes.forEach(n => {
        if ((n.name || "").toLowerCase().includes(q)) ids.add(n.id);
      });
      hits = ids.size;
    }
    window.__searchMatchIds = ids;
    window.__searchPathIds = new Set();  // leer → keine Pfad-Filterung mehr
    apply3DSearchBorder(ids);
  }
  searchHits.textContent = active ? (hits + ' Treffer') : '';
}

// Weißer Rahmen (border-radius) um die Label-Sprites der Suchtreffer.
// Die sichtbare Darstellung läuft über SpriteText — daher wird das
// Rechteck dort als Border am Label-Canvas gezeichnet.
function apply3DSearchBorder(matchIds) {
  if (!forceGraph3d) return;
  const scene = forceGraph3d.scene && forceGraph3d.scene();
  if (!scene) return;
  const active = matchIds && matchIds.size > 0;
  scene.traverse(obj => {
    const u = obj && obj.userData;
    if (!u || !u.nodeId || !u.labelSprite) return;
    const spr = u.labelSprite;
    const hit = active && matchIds.has(u.nodeId);
    if (hit) {
      spr.borderColor = '#ffffff';
      spr.borderWidth = 2;
      spr.borderRadius = 8;
      spr.padding = [6, 10];
      spr.backgroundColor = 'rgba(0,0,0,0.35)';
    } else {
      spr.borderWidth = 0;
      spr.borderRadius = 0;
      spr.padding = 0;
      spr.backgroundColor = null;
    }
    // three-spritetext redraws die Canvas-Textur nicht bei allen Property-
    // Setters zuverlaessig — explizit nachtreiben.
    if (typeof spr._genCanvas === 'function') spr._genCanvas();
  });
}

// Fokus-Zoom: nutzt die gleiche orbitale Kamerafahrt wie focusNodeById
// (Klick im Aktivitaetslog). Fliegt auf den Treffer-Centroiden, waehlt
// Distanz passend zur Treffer-BBox. Bei leerer Suche -> Full-Auto-Fit.
function zoomToSearch() {
  if (!forceGraph3d) return;
  const ids = window.__searchMatchIds;
  if (!ids || ids.size === 0) {
    if (forceGraph3d.zoomToFit) forceGraph3d.zoomToFit(1066, 80);
    return;
  }
  const data = forceGraph3d.graphData();
  const matches = data.nodes.filter(n => ids.has(n.id) && typeof n.x === 'number');
  if (matches.length === 0) return;

  // Centroid + maximale Distanz vom Centroid (= BBox-Radius)
  let cx = 0, cy = 0, cz = 0;
  matches.forEach(n => { cx += n.x; cy += n.y; cz += (n.z || 0); });
  cx /= matches.length; cy /= matches.length; cz /= matches.length;
  let maxDist = 0;
  matches.forEach(n => {
    const d = Math.hypot(n.x - cx, n.y - cy, (n.z || 0) - cz);
    if (d > maxDist) maxDist = d;
  });

  // Kamera-Distanz: Mindestens 140 (wie focusNodeById fuer Single-Node),
  // skaliert mit BBox-Radius fuer Multi-Match
  const distance = Math.max(140, maxDist * 2.4 + 90);
  const len = Math.hypot(cx || 0.01, cy || 0.01, cz || 0.01);
  const distRatio = 1 + distance / Math.max(len, 10);

  forceGraph3d.cameraPosition(
    { x: cx * distRatio, y: cy * distRatio, z: cz * distRatio },
    { x: cx, y: cy, z: cz },
    1400
  );
}

// Debounce-Timer fuer zoomToSearch: verhindert, dass sich Kamerafahrten bei
// schneller Eingabe ueberlappen. Erst nach kurzer Tipp-Pause zoomen.
let __searchZoomTimer = null;
if (searchInput) {
  // "input" feuert bei jeder Aenderung (Tippen, Backspace, Paste, Clear-X).
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value;
    applySearch();
    // Kamerafahrt debounced — erst ~280 ms nach letztem Keystroke.
    if (__searchZoomTimer) clearTimeout(__searchZoomTimer);
    __searchZoomTimer = setTimeout(() => {
      __searchZoomTimer = null;
      zoomToSearch();
    }, 280);
  });
}

// Auto-Fit Button (beide Modi — nutzen denselben WebGL-Graph)
function doAutoFit() {
  if (!forceGraph3d || !forceGraph3d.zoomToFit) { autoFit(); return; }
  // Warte bis Simulation settled bevor fit (sonst kann bbox noch 0 sein)
  const pad = settings.threeD ? 80 : 110;
  forceGraph3d.zoomToFit(1665, pad);
  // In 2D: zusätzlich Kamera auf Z-Achse zwingen (nach zoomToFit kann sich x/y verschieben)
  if (!settings.threeD) {
    setTimeout(() => {
      const pos = forceGraph3d.cameraPosition();
      forceGraph3d.cameraPosition({ x: pos.x || 0, y: pos.y || 0, z: Math.abs(pos.z) || 500 },
        { x: pos.x || 0, y: pos.y || 0, z: 0 }, 0);
    }, 950);
  }
}
document.getElementById('auto-fit-btn').addEventListener('click', doAutoFit);
window.addEventListener('keydown', e => {
  // e.target kann bei synth events auch `window` sein → closest() gibt's dann nicht.
  const inField = !!(e.target && typeof e.target.closest === 'function'
                     && e.target.closest('input, textarea'));
  // Cmd/Ctrl+K: Suche fokussieren (funktioniert IMMER, auch aus Input)
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (searchInput) { searchInput.focus(); searchInput.select(); }
    return;
  }
  // Esc: Panel schliessen, danach ggf. Such-Feld clearen
  if (e.key === 'Escape') {
    if (panel && panel.classList.contains('open')) {
      closePanel();
    } else if (searchInput && searchInput.value) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.blur();
    }
    return;
  }
  // Shortcuts nur ausserhalb von Inputs/Textareas
  if (inField) return;
  if (e.key === 'f') { doAutoFit(); return; }
  // 'c' = Suche leeren (wenn welche aktiv ist)
  if (e.key === 'c' && searchInput && searchInput.value) {
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
});

// --- 3D-Modus via 3d-force-graph ---
let forceGraph3d = null;

function init3D() {
  if (forceGraph3d) { update3D(); return; }
  if (!window.ForceGraph3D) {
    console.warn('ForceGraph3D not loaded');
    return;
  }
  const el = document.getElementById('map-3d');
  forceGraph3d = ForceGraph3D({ controlType: 'orbit' })(el);
  window.__fg3d = forceGraph3d;
  forceGraph3d
    .backgroundColor(settings.lightMode ? '#eaedf3' : '#070b10')
    .nodeResolution(24)
    // Physik 3.33x laenger: Simulation kuehlt deutlich langsamer ab,
    // Knoten-Bewegungen wirken ausgedehnter und cineastischer.
    .d3VelocityDecay(0.82)
    .d3AlphaDecay(0.012)
    .d3AlphaMin(0.002)
    .warmupTicks(20)
    .cooldownTime(13320)
    .nodeLabel(n => `<div class="graph-tooltip" style="color:${n.color};background:rgba(15,20,25,0.92);border:1px solid ${n.color}40;font-weight:600">${escapeHtml(n.name)}</div>`)
    .linkColor(l => l.color || '#555')
    .linkOpacity(0.35)
    .linkWidth(l => l.active ? 2.2 : 1.3)
    .linkDirectionalParticles(l => l.active ? 4 : 2)
    .linkDirectionalParticleSpeed(l => {
      if (l.active) return 0.020;
      const af = typeof l.ageFactor === 'number' ? l.ageFactor : 0.5;
      return 0.0015 + af * 0.015;  // alt → langsam, neu → schnell
    })
    .linkDirectionalParticleWidth(l => {
      if (l.active) return 3.2;
      const af = typeof l.ageFactor === 'number' ? l.ageFactor : 0.5;
      return 0.7 + af * 2.3;  // 0.7 (alt) .. 3.0 (neu)
    })
    .linkDirectionalParticleColor(l => l.color || '#fde047')
    .showNavInfo(false)
    .onBackgroundClick(() => closePanel());

  // --- Klick-Logik einmal extrahieren, damit sie vom Raycast- UND vom
  //     Screen-Space-Picker aufgerufen werden kann ---
  // Regeln:
  //   • Sonne (Root, depth 0): expandet ALLE Knoten.
  //   • Knoten mit Panel-Inhalt (Leaf): oeffnet/aktualisiert Side-Panel.
  //   • Struktur-Knoten: toggelt Collapse + schliesst Side-Panel.
  function handleNodeClick(n) {
    if (!n) return;
    const d3Node = root.descendants().find(x => keyOf(x) === n.id);
    if (!d3Node) return;
    if (d3Node.depth === 0) {
      // Sonne: Global-Toggle zwischen vollstaendig expandiert und komplett kollabiert.
      // Wenn irgendwas collapsed ist → alle expanden. Sonst → alle (Struktur-)Knoten
      // mit Kindern zuklappen.
      const hasAnyCollapsed = Object.keys(settings.collapsed).length > 0;
      if (hasAnyCollapsed) {
        settings.collapsed = {};
      } else {
        settings.collapsed = {};
        root.descendants().forEach(x => {
          if (x.depth > 0 && x.children && x.children.length > 0) {
            settings.collapsed[keyOf(x)] = true;
          }
        });
      }
      saveSettings();
      rebuild({ fromToggle: true });
      closePanel();
      return;
    }
    const k = keyOf(d3Node);
    const hasKids = (d3Node.children && d3Node.children.length > 0) || hasHiddenChildren.has(k);
    const isStructure = d3Node.depth <= 1 || hasKids;
    if (isStructure) {
      toggleCollapse(d3Node);
      closePanel();
    } else {
      onNodeClick(d3Node);
    }
  }

  // Screen-Space-Picker: projiziert jeden Knoten in Bildschirmkoordinaten und
  // findet den in Pixelabstand naechsten (der vor der Kamera steht). Das
  // umgeht Raycast-Probleme bei dicht beieinander liegenden kleinen Spheren.
  const PICK_RADIUS_PX = 26;
  // Label-Pick-Hilfsfunktion: Textbreite grob aus der SpriteText-Canvas ableiten,
  // dann in Welt-Einheiten umrechnen ueber sprite.scale (SpriteText setzt scale
  // = (canvasW/canvasH * textHeight, textHeight, 1)).
  function __labelWorldHalfSize(sprite) {
    if (!sprite) return null;
    const sx = sprite.scale.x * 0.5;  // halbe Breite in Welt-Einheiten
    const sy = sprite.scale.y * 0.5;  // halbe Hoehe in Welt-Einheiten
    return { hx: sx, hy: sy };
  }
  function findNearestNodeAtPx(clientX, clientY) {
    const canvas = document.querySelector('#map-3d canvas');
    if (!canvas || !forceGraph3d) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const W = rect.width, H = rect.height;
    const cam = forceGraph3d.camera();
    const data = forceGraph3d.graphData();
    if (!cam || !data) return null;
    const v = new THREE.Vector3();
    const vLabel = new THREE.Vector3();
    let best = null, bestD = Infinity, bestDepth = Infinity;
    for (const n of data.nodes) {
      v.set(n.x || 0, n.y || 0, n.z || 0).project(cam);
      if (v.z < -1 || v.z > 1) continue;  // ausserhalb Frustum
      const sx = (v.x * 0.5 + 0.5) * W;
      const sy = (-v.y * 0.5 + 0.5) * H;
      const dCenter = Math.hypot(sx - mx, sy - my);
      let d = dCenter;
      // --- Label-Hit: Rechteck um die Sprite-Weltposition in Screenraum ---
      // Klick innerhalb => effektive Distanz 0 (Label schlaegt Knoten-Zentrum).
      const obj = n.__threeObj;
      if (obj && obj.userData && obj.userData.labelSprite) {
        const spr = obj.userData.labelSprite;
        spr.getWorldPosition(vLabel);
        vLabel.project(cam);
        if (vLabel.z >= -1 && vLabel.z <= 1) {
          const lx = (vLabel.x * 0.5 + 0.5) * W;
          const ly = (-vLabel.y * 0.5 + 0.5) * H;
          // Halbgroessen der Sprite-Bounds in Screenspace: pro Welt-Einheit
          // Pixelskala ueber Vergleichspunkt + 1 Welt-Einheit in Kamera-X/Y.
          // Approximation: nutze projected delta der Sprite-scale.
          const s = __labelWorldHalfSize(spr);
          if (s) {
            // Projiziere Offset-Punkte, um Welt→Screen-Skala zu ermitteln.
            const wpos = new THREE.Vector3(); spr.getWorldPosition(wpos);
            const right = new THREE.Vector3(); const up = new THREE.Vector3();
            cam.matrixWorld.extractBasis(right, up, new THREE.Vector3());
            const pR = wpos.clone().add(right.clone().multiplyScalar(s.hx)).project(cam);
            const pU = wpos.clone().add(up.clone().multiplyScalar(s.hy)).project(cam);
            const halfW = Math.abs((pR.x * 0.5 + 0.5) * W - lx) + 6;  // +6 px Toleranz
            const halfH = Math.abs((-pU.y * 0.5 + 0.5) * H - ly) + 4;
            const dx = Math.max(0, Math.abs(mx - lx) - halfW);
            const dy = Math.max(0, Math.abs(my - ly) - halfH);
            const dLabel = Math.hypot(dx, dy);  // 0 wenn innerhalb
            if (dLabel < d) d = dLabel;
          }
        }
      }
      // --- Wolken-Hit: Gedankenblasen-Sprite als klickbare Hit-Region. ---
      // Die Bubble-Sprites sind visuell deutlich groesser als PICK_RADIUS_PX.
      // Projektion der Sprite-Bounds in Screenspace — Klick darin ⇒ dist = 0.
      if (obj && obj.userData && obj.userData.bubbleSprite) {
        const bspr = obj.userData.bubbleSprite;
        const bw = new THREE.Vector3(); bspr.getWorldPosition(bw);
        const bp = bw.clone().project(cam);
        if (bp.z >= -1 && bp.z <= 1) {
          const bx = (bp.x * 0.5 + 0.5) * W;
          const by = (-bp.y * 0.5 + 0.5) * H;
          // Welt-Halbgroessen inkl. dynamischer Skala des Hover-Containers
          // (wird im animLoop per cloudScale*hover-Ease skaliert — getWorldScale
          //  liefert die effektive Weltgroesse).
          const ws = new THREE.Vector3(); bspr.getWorldScale(ws);
          const hxw = Math.abs(ws.x) * 0.5;
          const hyw = Math.abs(ws.y) * 0.5;
          const right = new THREE.Vector3(); const up = new THREE.Vector3();
          cam.matrixWorld.extractBasis(right, up, new THREE.Vector3());
          const pR = bw.clone().add(right.clone().multiplyScalar(hxw)).project(cam);
          const pU = bw.clone().add(up.clone().multiplyScalar(hyw)).project(cam);
          const halfW = Math.abs((pR.x * 0.5 + 0.5) * W - bx);
          const halfH = Math.abs((-pU.y * 0.5 + 0.5) * H - by);
          // Ganze Wolkenflaeche als Clickbox — keine Einengung.
          const dxB = Math.max(0, Math.abs(mx - bx) - halfW);
          const dyB = Math.max(0, Math.abs(my - by) - halfH);
          const dBubble = Math.hypot(dxB, dyB);
          if (dBubble < d) d = dBubble;
        }
      }
      if (d > PICK_RADIUS_PX) continue;
      // Ziehe in dichten Clustern den naeheren Knoten vor; bei gleichem
      // Pixelabstand den kamera-naeheren (kleinerer z).
      if (d < bestD - 2 || (Math.abs(d - bestD) < 2 && v.z < bestDepth)) {
        best = n; bestD = d; bestDepth = v.z;
      }
    }
    return best;
  }

  // Drag-Erkennung, damit Kamera-Orbit keinen Klick ausloest
  let __dragMoved = false, __downX = 0, __downY = 0;
  const attachScreenPicker = () => {
    const canvas = document.querySelector('#map-3d canvas');
    if (!canvas || canvas.__screenPickerAttached) return;
    canvas.__screenPickerAttached = true;
    canvas.addEventListener('pointerdown', ev => {
      __dragMoved = false; __downX = ev.clientX; __downY = ev.clientY;
    });
    canvas.addEventListener('pointermove', ev => {
      if (ev.buttons) {
        if (Math.hypot(ev.clientX - __downX, ev.clientY - __downY) > 4) __dragMoved = true;
        return;
      }
      const n = findNearestNodeAtPx(ev.clientX, ev.clientY);
      window.__hoveredNodeId = n ? n.id : null;
      document.body.style.cursor = n ? 'pointer' : '';
    });
    canvas.addEventListener('pointerleave', () => {
      window.__hoveredNodeId = null;
      document.body.style.cursor = '';
    });
    // Capture-Phase: wir fangen den Klick vor 3d-force-graph ab und
    // verhindern das Default-Click-Handling, damit nichts doppelt feuert.
    canvas.addEventListener('click', ev => {
      if (__dragMoved) return;
      const n = findNearestNodeAtPx(ev.clientX, ev.clientY);
      if (n) {
        ev.stopPropagation();
        handleNodeClick(n);
      }
    }, true);
  };
  // Canvas existiert evtl. erst nach dem ersten graphData-Set; versuchen
  // wir es sowohl jetzt als auch nach kurzem Delay.
  attachScreenPicker();
  setTimeout(attachScreenPicker, 50);
  setTimeout(attachScreenPicker, 500);
  // --- Quadratische "+"-Textur: weiss mit schwarzem Outline, einmal gecached ---
  function __plusTex() {
    if (window.__plusTex) return window.__plusTex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    // Zeichne das "+" als 2 dicke Balken mit rundem Cap
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Outline (schwarz, dicker)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(64, 26); ctx.lineTo(64, 102);
    ctx.moveTo(26, 64); ctx.lineTo(102, 64);
    ctx.stroke();
    // Fill (weiss, duenner darueber)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(64, 30); ctx.lineTo(64, 98);
    ctx.moveTo(30, 64); ctx.lineTo(98, 64);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    window.__plusTex = tex;
    return tex;
  }

  // --- Sinus-Ease-Utilities (fuer alle Hover/Transition-Animationen) ---
  const easeSineInOut = p => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, p)));
  const easeSineIn    = p => 1 - Math.cos((Math.PI / 2) * Math.max(0, Math.min(1, p)));
  const easeSineOut   = p => Math.sin((Math.PI / 2) * Math.max(0, Math.min(1, p)));

  // --- HDR-Sonnen-Texturen: prozedural in Canvas gemalt (einmal cachen) ---
  function __sunCoreTex() {
    if (window.__sunCoreTex) return window.__sunCoreTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d');
    // Basis-Gradient: weissglueh im Aequator, kuehler an den Polen (realistischer)
    const baseG = ctx.createLinearGradient(0, 0, 0, 512);
    baseG.addColorStop(0.00, '#ffb860');
    baseG.addColorStop(0.25, '#ffd688');
    baseG.addColorStop(0.50, '#fff1b4');
    baseG.addColorStop(0.75, '#ffc46c');
    baseG.addColorStop(1.00, '#ff9a48');
    ctx.fillStyle = baseG; ctx.fillRect(0, 0, 1024, 512);
    // Granulation: tausende kleine Blobs (Konvektionszellen)
    for (let i = 0; i < 2200; i++) {
      const x = Math.random() * 1024, y = Math.random() * 512;
      const r = 1.5 + Math.random() * 9;
      const hot = Math.random();
      const h = 25 + hot * 25;
      const l = 60 + hot * 30;
      const a = 0.15 + Math.random() * 0.35;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `hsla(${h},100%,${l}%,${a})`);
      rg.addColorStop(1, `hsla(${h},100%,${l}%,0)`);
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Sonnenflecken (dunkle gekuehlte Regionen)
    for (let i = 0; i < 28; i++) {
      const x = Math.random() * 1024, y = 120 + Math.random() * 272;
      const r = 4 + Math.random() * 9;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0.0, 'rgba(70,24,8,0.78)');
      rg.addColorStop(0.55, 'rgba(120,48,14,0.35)');
      rg.addColorStop(1.0, 'rgba(120,48,14,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Heisse Fackeln (hellere Regionen)
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * 1024, y = Math.random() * 512;
      const r = 3 + Math.random() * 7;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0.0, 'rgba(255,252,230,0.85)');
      rg.addColorStop(1.0, 'rgba(255,252,230,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    window.__sunCoreTex = tex;
    return tex;
  }

  function __sunBloomTex() {
    if (window.__sunBloomTex) return window.__sunBloomTex;
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(256, 256, 12, 256, 256, 256);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.10, 'rgba(255,240,200,0.9)');
    g.addColorStop(0.28, 'rgba(255,190,110,0.5)');
    g.addColorStop(0.55, 'rgba(255,100,40,0.18)');
    g.addColorStop(0.80, 'rgba(255,50,10,0.05)');
    g.addColorStop(1.00, 'rgba(255,30,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
    window.__sunBloomTex = new THREE.CanvasTexture(c);
    return window.__sunBloomTex;
  }

  function __sunFlareTex() {
    if (window.__sunFlareTex) return window.__sunFlareTex;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 512;
    const ctx = c.getContext('2d');
    // Vertikales Flammenprofil: weiss-heiss unten → orange → rot → transparent oben
    const v = ctx.createLinearGradient(0, 512, 0, 0);
    v.addColorStop(0.00, 'rgba(255,60,10,0)');
    v.addColorStop(0.05, 'rgba(255,110,40,0.55)');
    v.addColorStop(0.22, 'rgba(255,200,110,0.9)');
    v.addColorStop(0.45, 'rgba(255,240,200,0.95)');
    v.addColorStop(0.72, 'rgba(255,170,60,0.75)');
    v.addColorStop(0.92, 'rgba(255,80,20,0.3)');
    v.addColorStop(1.00, 'rgba(255,40,0,0)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, 64, 512);
    // Feather an den Seiten
    ctx.globalCompositeOperation = 'destination-out';
    const h = ctx.createLinearGradient(0, 0, 64, 0);
    h.addColorStop(0.0, 'rgba(0,0,0,1)');
    h.addColorStop(0.5, 'rgba(0,0,0,0)');
    h.addColorStop(1.0, 'rgba(0,0,0,1)');
    ctx.fillStyle = h; ctx.fillRect(0, 0, 64, 512);
    ctx.globalCompositeOperation = 'source-over';
    window.__sunFlareTex = new THREE.CanvasTexture(c);
    return window.__sunFlareTex;
  }

  // --- HDR-Sonnen-Root: kleiner, detaillierter, game-like realistisch ---
  function createSunObject(n) {
    const group = new THREE.Group();
    const R = 8;   // deutlich kleiner als zuvor (war 14)

    // Kern mit prozeduraler Oberflaechentextur (Granulation + Sonnenflecken)
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 64),
      new THREE.MeshBasicMaterial({ map: __sunCoreTex() })
    );
    group.add(core);

    // Chromosphaere: duenne orangene Schicht knapp ueber der Oberflaeche
    const chromo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.04, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff8a3a, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide
      })
    );
    group.add(chromo);

    // Bloom/Glow-Schichten (HDR-Feel via additive Sprite-Billboards)
    const bloomTex = __sunBloomTex();
    const bloomLayers = [];
    const bloomCfgs = [
      { scale: 2.3, color: 0xfff2c8, opacity: 0.90 },  // heiss-nah
      { scale: 3.6, color: 0xffb060, opacity: 0.55 },  // orange mid
      { scale: 5.8, color: 0xff6628, opacity: 0.32 },  // tief-orange
      { scale: 9.0, color: 0xcc2a10, opacity: 0.17 }   // roter Auslaeufer
    ];
    for (const cfg of bloomCfgs) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({
        map: bloomTex, color: cfg.color,
        transparent: true, opacity: cfg.opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
      }));
      m.scale.set(R * cfg.scale, R * cfg.scale, 1);
      m.renderOrder = -10 - bloomLayers.length;
      m.userData.baseScale = cfg.scale;
      m.userData.baseOpacity = cfg.opacity;
      m.userData.phase = Math.random() * Math.PI * 2;
      bloomLayers.push(m); group.add(m);
    }

    // Protuberanzen: 14 duenne Flammen-Planes — 1/3 kleiner als vorher
    const flareTex = __sunFlareTex();
    const flares = [];
    const N = 14;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const theta = i * Math.PI * (3 - Math.sqrt(5));
      const dir = new THREE.Vector3(Math.cos(theta) * rad, y, Math.sin(theta) * rad).normalize();
      const mat = new THREE.MeshBasicMaterial({
        map: flareTex, color: 0xffcc78,
        transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      plane.userData.dir = dir;
      plane.userData.phase = Math.random() * Math.PI * 2;
      plane.userData.speed = 0.5 + Math.random() * 0.7;
      plane.userData.twist = Math.random() * Math.PI;
      plane.renderOrder = -2;
      flares.push(plane); group.add(plane);
    }

    // --- Funken (sparks): viele kleine, schnell pulsierende Lichtpunkte ---
    const sparkTex = __sunBloomTex();  // reuse radial-gradient texture
    const sparks = [];
    const NSPARK = 26;
    for (let i = 0; i < NSPARK; i++) {
      const mat = new THREE.SpriteMaterial({
        map: sparkTex,
        color: new THREE.Color().setHSL(0.1 + Math.random() * 0.05, 1, 0.7),
        transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
      });
      const s = new THREE.Sprite(mat);
      // Viel kleinere Funken (~1/4 der vorherigen Groesse)
      const size = R * (0.04 + Math.random() * 0.06);
      s.scale.set(size, size, 1);
      s.userData.baseSize = size;
      s.userData.life = Math.random();               // 0..1
      s.userData.lifeSpeed = 0.6 + Math.random() * 1.2;  // Hz-ish
      s.userData.dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize();
      s.userData.dist = 1.05 + Math.random() * 0.4;  // Abstand in R-Vielfachen
      s.renderOrder = -1;
      sparks.push(s); group.add(s);
    }

    // --- Eruptionen / Sonnenstuerme: grosse Bursts, expandieren + fade ---
    // Sehr hell, satt in Orange-Rot-Gelb-Spektrum (HSL 0.00 Rot .. 0.13 Gelb)
    const bursts = [];
    const NBURST = 5;
    for (let i = 0; i < NBURST; i++) {
      const mat = new THREE.SpriteMaterial({
        map: sparkTex,
        color: new THREE.Color().setHSL(Math.random() * 0.13, 1, 0.75),
        transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
      });
      const s = new THREE.Sprite(mat);
      s.userData.maxSize = R * (1.2 + Math.random() * 0.8);
      s.userData.life = Math.random();               // 0..1
      s.userData.lifeSpeed = 0.15 + Math.random() * 0.2;
      s.userData.dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize();
      s.renderOrder = -1;
      bursts.push(s); group.add(s);
    }

    // --- Kleine Explosionen: Mini-Bursts zwischen Funken und grossen Eruptionen ---
    // Haeufigere, schnellere Flashes auf der Oberflaeche — lebendige Mikro-Dynamik.
    const miniBursts = [];
    const NMINI = 14;
    for (let i = 0; i < NMINI; i++) {
      const mat = new THREE.SpriteMaterial({
        map: sparkTex,
        color: new THREE.Color().setHSL(Math.random() * 0.13, 1, 0.72),
        transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
      });
      const s = new THREE.Sprite(mat);
      s.userData.maxSize = R * (0.32 + Math.random() * 0.32);
      s.userData.life = Math.random();
      s.userData.lifeSpeed = 0.4 + Math.random() * 0.6;  // schneller als grosse Bursts
      s.userData.dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize();
      s.renderOrder = -1;
      miniBursts.push(s); group.add(s);
    }

    group.userData.isSun = true;
    group.userData.core = core;
    group.userData.chromo = chromo;
    group.userData.bloomLayers = bloomLayers;
    group.userData.flares = flares;
    group.userData.sparks = sparks;
    group.userData.bursts = bursts;
    group.userData.miniBursts = miniBursts;
    group.userData.baseR = R;
    group.userData.nodeId = n.id;
    group.userData.baseRadius = R;
    return group;
  }

  // --- Gedankenblase: Cloud-förmiger Sprite mit eingebettetem Text.
  // Pro Thought-ID einmal in eine CanvasTexture gerendert und gecached.
  const __bubbleTexCache = new Map();  // thoughtId -> { tex, canvas, text, color }

  function __wrapTextLines(ctx, text, maxWidth, maxLines) {
    const words = (text || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        if (lines.length >= maxLines) { line = ''; break; }
        line = w;
      } else {
        line = test;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    // Letzte Zeile ggf. mit Ellipse
    if (lines.length === maxLines) {
      let last = lines[lines.length - 1];
      while (ctx.measureText(last + '…').width > maxWidth && last.length > 1) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = last + '…';
    }
    return lines;
  }

  function __thoughtBubbleTex(id, text, color) {
    const cached = __bubbleTexCache.get(id);
    if (cached && cached.text === text && cached.color === color) return cached.tex;

    const W = 1024, H = 512;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const parsed = d3.color(color) || d3.color('#f472b6');
    const rgb = parsed.rgb();
    const fillBase = `rgba(${rgb.r|0},${rgb.g|0},${rgb.b|0},0.92)`;
    const fillSoft = `rgba(${rgb.r|0},${rgb.g|0},${rgb.b|0},0.55)`;
    const ink = (0.299*rgb.r + 0.587*rgb.g + 0.114*rgb.b) / 255 > 0.6 ? '#0b1020' : '#ffffff';

    // Drop-Shadow für HDR-Wirkung
    ctx.shadowColor = fillSoft;
    ctx.shadowBlur = 30;

    // Hauptoval
    ctx.fillStyle = fillBase;
    ctx.beginPath();
    ctx.ellipse(W/2, H/2 - 20, 420, 170, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wolken-Bumps (drei Kreise am Rand, damit Kontur organisch wird)
    const bumps = [
      [W/2 - 300, H/2 - 130, 90],
      [W/2 + 260, H/2 - 150, 110],
      [W/2 + 330, H/2 + 40, 90],
      [W/2 - 340, H/2 + 60, 80],
      [W/2 - 80, H/2 - 190, 85],
      [W/2 + 80, H/2 + 150, 80],
    ];
    for (const [bx, by, br] of bumps) {
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sprechblasen-Tails unten-links
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(W/2 - 380, H/2 + 170, 28, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W/2 - 430, H/2 + 220, 16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W/2 - 460, H/2 + 250, 9,  0, Math.PI * 2); ctx.fill();

    // Text
    const trimmed = (text || '').replace(/\s+/g, ' ').trim().slice(0, 420);
    ctx.fillStyle = ink;
    ctx.font = '600 30px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const maxWidth = 740;
    const lineHeight = 40;
    const maxLines = 7;
    const lines = __wrapTextLines(ctx, trimmed, maxWidth, maxLines);
    const totalH = lines.length * lineHeight;
    const startY = H/2 - 20 - totalH/2;
    const startX = W/2 - maxWidth/2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], startX, startY + i * lineHeight);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    __bubbleTexCache.set(id, { tex, canvas: c, text, color });
    return tex;
  }

  function createThoughtBubbleObject(n) {
    const group = new THREE.Group();
    // Hover-Container: animLoop setzt scale(x,y,z) darauf — uniform, daher
    // behält die Blase ihre Breite:Höhe-Proportion, weil der Sprite seine
    // eigene (W,H,1)-Skalierung IM Container hat.
    const hover = new THREE.Group();
    group.add(hover);

    const tex = __thoughtBubbleTex(n.id, n._bubbleText || n.name || '', n.color);
    const mat = new THREE.SpriteMaterial({
      map: tex, color: 0xffffff, transparent: true, opacity: 0,
      depthTest: true, depthWrite: false
    });
    const spr = new THREE.Sprite(mat);
    const W = 28, H = 14;   // Welt-Einheiten — ~2× Standard-Bubble
    spr.scale.set(W, H, 1);
    hover.add(spr);

    // Halo hinter der Blase für thinking-Pulsieren / Hover
    const glowMat = new THREE.MeshBasicMaterial({
      color: n.color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(W * 0.55, 20, 20), glowMat);
    glow.renderOrder = -1;
    hover.add(glow);

    group.userData.nodeId = n.id;
    // mainSphere = hover-Container: animLoop.scale.set(scl,scl,scl) bleibt uniform.
    // Opacity wird auf den Sprite-Material durchgereicht via _bubbleSprite.
    group.userData.mainSphere = hover;
    group.userData.glowSphere = glow;
    group.userData.baseOpacity = 0.97;
    group.userData.baseRadius = W * 0.5;
    group.userData.isThoughtBubble = true;
    group.userData.bubbleSprite = spr;   // für Opacity-Propagation
    group.userData.spawnT = performance.now();
    group.userData.bubbleOut = !!n.__bubbleOut;
    // Für realistische Cloud-Animation: zufällige Phase, Basis-Dimensionen
    // (für Wobble auf Sprite-Scale) und Thought-Timestamp/Status für Alters-
    // basiertes Fade vor der 60-s-Grenze.
    group.userData.bubblePhase = Math.random() * Math.PI * 2;
    group.userData.bubbleBaseW = W;
    group.userData.bubbleBaseH = H;
    group.userData.bubbleTs = n._ts || 0;
    group.userData.bubbleStatus = n.status;
    if (n.__bubbleOut) group.scale.setScalar(0.01);
    // Sprite soll beim Spawn unsichtbar sein (Fade-In im animLoop)
    spr.material.opacity = 0;
    return group;
  }

  // Custom nodeThreeObject: Kugel mit alter-abhängiger Opacity + Label rechts daneben
  forceGraph3d.nodeThreeObjectExtend(false);
  forceGraph3d.nodeThreeObject(n => {
    if (!window.THREE) return null;
    // --- Spezialfall Root: animierte Sonne ---
    if (n.depth === 0) return createSunObject(n);
    // --- Spezialfall Gedankenblase: aktuelle + zuletzt (≤ 60 s) gedachte
    //     Gedanken (thinking + assistant_text) als Cloud-Sprite darstellen.
    //     Ältere Gedanken fallen auf die normale Kugel zurück.
    {
      const isThought = n._kind === "thinking" || n._kind === "assistant_text";
      const nowSec = Date.now() / 1000;
      const ageSec = n._ts ? (nowSec - n._ts) : Infinity;
      const isRecent = n.status === 'thinking' || (n._ts && ageSec < 60);
      if (isThought && isRecent && n._bubbleText) return createThoughtBubbleObject(n);
    }

    const group = new THREE.Group();
    const r = n.depth === 1 ? 5 : n.depth === 2 ? 3 : 1.8;
    const af = typeof n._ageFactor === 'number' ? n._ageFactor : 0.6;
    // Opacity: 0.05 (sehr alt) .. 0.97 (neu), aktiv/Struktur = 0.97
    let opacity = 0.97;
    if (n.status !== 'thinking' && n.depth > 1) opacity = 0.05 + af * 0.92;
    const mat = new THREE.MeshBasicMaterial({
      color: n.color, transparent: true, opacity, depthWrite: opacity > 0.9
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 24), mat);
    group.add(sphere);

    // Glow-Halo fuer Hover (unsichtbar bis Hover) — additiv + grosser Radius
    const glowMat = new THREE.MeshBasicMaterial({
      color: n.color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(r * 1.9, 20, 20), glowMat);
    glow.renderOrder = -1;
    group.add(glow);

    // "+"-Marker: eigene quadratische Textur (weiss mit schwarzem Outline),
    // Sprite bleibt camera-facing und behaelt garantiert das Seitenverhaeltnis 1:1.
    {
      const plusMat = new THREE.SpriteMaterial({
        map: __plusTex(), color: 0xffffff,
        transparent: true, opacity: 0,
        depthTest: false, depthWrite: false
      });
      const plus = new THREE.Sprite(plusMat);
      // Groesse: quadratisch, skaliert an Knoten-Radius
      const plusSize = r * 1.6;
      plus.scale.set(plusSize, plusSize, 1);
      plus.position.set(0, 0, 0);  // exakt im Knoten-Zentrum
      plus.renderOrder = 50;
      plus.visible = false;
      plus.userData.baseSize = plusSize;
      group.add(plus);
      group.userData.plusSprite = plus;
    }

    // Referenzen fuer Hover-Animation
    group.userData.nodeId = n.id;
    group.userData.mainSphere = sphere;
    group.userData.glowSphere = glow;
    group.userData.baseOpacity = opacity;
    group.userData.baseRadius = r;
    // Spawn-Zeit fuer globalen Fade-In — jeder neu erzeugte Knoten startet
    // unsichtbar und faded sinus-eased ein. Neue Kinder einer Expand-Aktion
    // (__bubbleOut) starten zusaetzlich mit Scale 0 → 1 ("bubbeln" aus dem
    // Parent heraus).
    group.userData.spawnT = performance.now();
    group.userData.bubbleOut = !!n.__bubbleOut;
    sphere.material.opacity = 0;
    if (n.__bubbleOut) {
      group.scale.setScalar(0.01);
    }
    // Root nie mit Label (auch in 3D)
    if (settings.showLabels && window.SpriteText && n.depth !== 0) {
      const baseSize = n.depth === 1 ? 4.8 : n.depth === 2 ? 3.2 : 2;
      const sizeScale = n.depth <= 1 ? 1 : (0.5 + af * 0.6);
      const sprite = new SpriteText(truncateLabel(n.name));
      sprite.color = settings.lightMode ? readableColor(n.color) : n.color;
      // Outline: fett fuer klare Lesbarkeit ueber farbigen Bubbles.
      sprite.strokeColor = settings.lightMode ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
      sprite.strokeWidth = 1.2;  // deutlich dickere Outline
      // Such-Rahmen: weißes Rechteck mit Border-Radius um Treffer-Labels.
      const __isMatch = window.__searchMatchIds && window.__searchMatchIds.has(n.id);
      if (__isMatch) {
        sprite.borderColor = '#ffffff';
        sprite.borderWidth = 2;
        sprite.borderRadius = 8;
        sprite.padding = [6, 10];
        sprite.backgroundColor = 'rgba(0,0,0,0.35)';
      } else {
        sprite.backgroundColor = null;  // kein Hintergrund
        sprite.padding = 0;
      }
      sprite.textHeight = baseSize * sizeScale;
      // Label-Offset oberhalb der Bubble (Bubble-Radius + halbe Texthoehe + kleiner Gap)
      const labelOffset = r + (baseSize * sizeScale) * 0.55 + 1.5;
      sprite.position.set(0, labelOffset, 0);
      sprite.material.depthTest = false;
      sprite.material.transparent = true;
      // Opacity nach Alter: 0.05 (sehr alt) .. 0.97 (neu), Structure/Aktiv = 0.97
      // Minimum-Opacity 0.222 fuer Labels — auch aelteste Knoten bleiben deutlich lesbar.
      sprite.material.opacity = (n.status === 'thinking' || n.depth <= 1) ? 0.97 : Math.max(0.222, 0.222 + af * 0.748);
      sprite.renderOrder = 10;
      // Target-Opacity merken + initial auf 0 setzen (Fade-In im animLoop)
      sprite.userData.targetOpacity = sprite.material.opacity;
      sprite.material.opacity = 0;
      group.add(sprite);
      // Referenzen fuer Hit-Testing von Labels (siehe findNearestNodeAtPx)
      group.userData.labelSprite = sprite;
      group.userData.labelOffset = labelOffset;
      // Label immer zentriert OBERHALB der Bubble in Kamera-UP-Richtung
      group.userData.updateLabelPos = (cam) => {
        const up = new THREE.Vector3();
        cam.matrixWorld.extractBasis(new THREE.Vector3(), up, new THREE.Vector3());
        sprite.position.copy(up.multiplyScalar(labelOffset));
      };
    }
    return group;
  });

  // Pro Frame: Label-Positionen in Kamera-Rechts-Richtung aktualisieren (für "rechts neben Bubble")
  forceGraph3d.onEngineTick(() => {
    const scene = forceGraph3d.scene();
    const cam = forceGraph3d.camera();
    if (!scene || !cam) return;
    scene.traverse(obj => {
      if (obj.userData && obj.userData.updateLabelPos) obj.userData.updateLabelPos(cam);
    });
  });
  // Unabhaengige rAF-Loop: Hover-Animation + "+"-Indikator + Sonnen-Animation.
  // Laeuft auch nach Stillstand der Simulation.
  const __TMPV = new THREE.Vector3();
  const __TMPV2 = new THREE.Vector3();
  const __TMPQ = new THREE.Quaternion();
  const __TMPQ2 = new THREE.Quaternion();
  const __UPAX = new THREE.Vector3(0, 1, 0);
  let __lastFrameT = performance.now() * 0.001;
  // Dauern fuer getweente Transitions (Sekunden) — 3.33x laenger fuer mehr Wirkung
  const HOVER_DUR = 0.466;
  const PLUS_DUR  = 0.400;
  const BUBBLE_HOVER_DUR = 0.333;   // Sekunden — Wolken-Darken-Fade
  (function animLoop(){
    const scene = forceGraph3d.scene && forceGraph3d.scene();
    if (scene) {
      const tNow = performance.now() * 0.001;
      const dt = Math.min(0.08, Math.max(0, tNow - __lastFrameT));
      __lastFrameT = tNow;
      const t = tNow;
      const hoveredId = window.__hoveredNodeId;
      const hidden = window.__hasHiddenChildren || null;
      scene.traverse(obj => {
        const u = obj.userData; if (!u) return;
        // --- HDR-Sonne animieren (Kern rotiert, Chromosphaere flimmert,
        //     Bloom-Layer atmen, Protuberanzen flackern in Sinus) ---
        if (u.isSun) {
          const R = u.baseR;
          // Kern: sehr langsame Rotation + mini Pulsation
          if (u.core) {
            u.core.rotation.y = t * 0.035;
            u.core.rotation.x = Math.sin(t * 0.17) * 0.08;
            const corePulse = 1 + Math.sin(t * 0.9) * 0.012;
            u.core.scale.setScalar(corePulse);
          }
          // Chromosphaere: minimale Phasenschwankung, leichtes Dehnen
          if (u.chromo) {
            u.chromo.rotation.y = -t * 0.06;
            u.chromo.material.opacity = 0.22 + (0.5 - 0.5 * Math.cos(t * 1.1)) * 0.14;
            const s = 1 + Math.sin(t * 0.75) * 0.01;
            u.chromo.scale.setScalar(s);
          }
          // Bloom-Layers: versetztes Atmen
          u.bloomLayers && u.bloomLayers.forEach((s, i) => {
            const ph = s.userData.phase;
            const baseS = s.userData.baseScale;
            const baseO = s.userData.baseOpacity;
            const p = 0.5 - 0.5 * Math.cos(t * (0.35 + i * 0.12) + ph);  // sinus 0-1
            const scl = R * baseS * (1 + p * 0.06);
            s.scale.set(scl, scl, 1);
            s.material.opacity = baseO * (0.82 + p * 0.35);
          });
          // Protuberanzen (1/3 kleiner): Flammenprofil, sinus-eased, verdreht
          u.flares && u.flares.forEach(pl => {
            const ph = pl.userData.phase;
            const sp = pl.userData.speed;
            const raw = 0.5 - 0.5 * Math.cos(t * sp + ph);  // 0..1 sinusweich
            // Laenge & Breite um ca. 33% reduziert
            const length = R * (0.47 + raw * 0.8);
            const width  = R * (0.09 + raw * 0.12);
            const dir = pl.userData.dir;
            __TMPV.copy(dir).multiplyScalar(R * 0.93 + length * 0.5);
            pl.position.copy(__TMPV);
            __TMPQ.setFromUnitVectors(__UPAX, dir);
            const twist = Math.sin(t * sp * 0.7 + pl.userData.twist) * 0.55;
            __TMPQ2.setFromAxisAngle(dir, twist);
            pl.quaternion.copy(__TMPQ2).multiply(__TMPQ);
            pl.scale.set(width, length, 1);
            pl.material.opacity = 0.22 + raw * 0.6;
          });
          // Funken: kurze, helle Lichtpunkte mit schnellem Lebenszyklus
          u.sparks && u.sparks.forEach(s => {
            s.userData.life += dt * s.userData.lifeSpeed;
            if (s.userData.life >= 1) {
              // Neu initialisieren an zufaelliger Position
              s.userData.life = 0;
              s.userData.dir.set(
                Math.random() * 2 - 1,
                Math.random() * 2 - 1,
                Math.random() * 2 - 1
              ).normalize();
              s.userData.dist = 1.05 + Math.random() * 0.4;
              s.userData.lifeSpeed = 0.6 + Math.random() * 1.2;
              const size = R * (0.04 + Math.random() * 0.06);
              s.userData.baseSize = size;
              s.material.color.setHSL(0.1 + Math.random() * 0.05, 1, 0.72);
            }
            const L = s.userData.life;  // 0..1
            // Parabel-Opacity (steigt, faellt)
            const op = Math.sin(L * Math.PI);
            s.material.opacity = op * 0.95;
            // Ausdriftende Bewegung
            const d = (1.02 + L * 0.3) * s.userData.dist * R;
            __TMPV.copy(s.userData.dir).multiplyScalar(d);
            s.position.copy(__TMPV);
            const sz = s.userData.baseSize * (0.6 + op * 0.9);
            s.scale.set(sz, sz, 1);
          });
          // Eruptionen: grosse Bursts — expandieren und verblassen
          u.bursts && u.bursts.forEach(s => {
            s.userData.life += dt * s.userData.lifeSpeed;
            if (s.userData.life >= 1) {
              s.userData.life = 0;
              s.userData.dir.set(
                Math.random() * 2 - 1,
                Math.random() * 2 - 1,
                Math.random() * 2 - 1
              ).normalize();
              s.userData.maxSize = R * (1.3 + Math.random() * 1.0);
              s.userData.lifeSpeed = 0.15 + Math.random() * 0.22;
              // Orange-Rot-Gelb: HSL-Hue 0.00 (Rot) .. 0.13 (Gelb),
              // volle Saettigung, sehr helle Lightness fuer knallige Peaks.
              s.material.color.setHSL(Math.random() * 0.13, 1, 0.78);
            }
            const L = s.userData.life;
            // Ease-out cubic fuer Expansion, ease-in fuer Fade-out
            const expand = easeSineOut(Math.min(1, L * 1.4));
            const fade = L < 0.3 ? easeSineIn(L / 0.3) : (1 - easeSineInOut((L - 0.3) / 0.7));
            const size = s.userData.maxSize * (0.2 + expand * 0.9);
            s.scale.set(size, size, 1);
            // Sehr hell: Peak ~2.4 (additives Blending → starker HDR-Flash)
            s.material.opacity = fade * 2.4;
            // Position nah an der Oberflaeche, driftet leicht nach aussen
            const d = R * (1.0 + L * 0.25);
            __TMPV.copy(s.userData.dir).multiplyScalar(d);
            s.position.copy(__TMPV);
          });
          // Kleine Explosionen: schnelle Mini-Bursts auf der Oberflaeche
          u.miniBursts && u.miniBursts.forEach(s => {
            s.userData.life += dt * s.userData.lifeSpeed;
            if (s.userData.life >= 1) {
              s.userData.life = 0;
              s.userData.dir.set(
                Math.random() * 2 - 1,
                Math.random() * 2 - 1,
                Math.random() * 2 - 1
              ).normalize();
              s.userData.maxSize = R * (0.32 + Math.random() * 0.32);
              s.userData.lifeSpeed = 0.4 + Math.random() * 0.6;
              s.material.color.setHSL(Math.random() * 0.13, 1, 0.72);
            }
            const L = s.userData.life;
            const expand = easeSineOut(Math.min(1, L * 1.6));
            const fade = L < 0.25 ? easeSineIn(L / 0.25) : (1 - easeSineInOut((L - 0.25) / 0.75));
            const size = s.userData.maxSize * (0.15 + expand * 0.95);
            s.scale.set(size, size, 1);
            // Hell, aber weniger als die grossen Bursts (Peak ~1.8)
            s.material.opacity = fade * 1.8;
            const d = R * (1.0 + L * 0.18);
            __TMPV.copy(s.userData.dir).multiplyScalar(d);
            s.position.copy(__TMPV);
          });
          return;  // Sonne hat kein Hover
        }
        // Label-Positionen immer an Kamera anpassen (Billboard oberhalb Bubble)
        if (u.updateLabelPos) u.updateLabelPos(forceGraph3d.camera());
        if (!u.mainSphere) return;
        // --- Retract-Animation: Knoten fliegt ins Parent-Zentrum + schrumpft ---
        // (Laeuft vor der regulaeren Hover/Spawn-Logik, um sie komplett zu uebersteuern.)
        if (u.retracting) {
          const prog = Math.min(1, (performance.now() - u.retractStartT) / 733);
          const e = easeSineIn(prog);
          const from = u.retractFrom, to = u.retractTo;
          if (from && to) {
            // Group-Position direkt setzen (force-graph's Sim-Position
            // wuerde sonst zurueckueberschrieben — wir setzen aber ZUSAETZLICH
            // fx/fy/fz am Sim-Knoten, damit es konsistent bleibt).
            const simNode = forceGraph3d.graphData().nodes.find(nn => nn.id === u.nodeId);
            const nx = from.x + (to.x - from.x) * e;
            const ny = from.y + (to.y - from.y) * e;
            const nz = from.z + (to.z - from.z) * e;
            if (simNode) { simNode.fx = nx; simNode.fy = ny; simNode.fz = nz; }
            obj.position.set(nx, ny, nz);
          }
          const shrink = 1 - e;
          obj.scale.setScalar(Math.max(0.001, shrink));
          // Opacity auch runter ziehen
          const retractOp = (u.baseOpacity || 0.97) * shrink;
          if (u.mainSphere && u.mainSphere.material) u.mainSphere.material.opacity = retractOp;
          if (u.bubbleSprite) u.bubbleSprite.material.opacity = retractOp;
          if (u.glowSphere) u.glowSphere.material.opacity = 0;
          if (u.labelSprite) u.labelSprite.material.opacity = (u.labelSprite.userData.targetOpacity || 0.97) * shrink;
          if (u.plusSprite) u.plusSprite.material.opacity = 0;
          return;
        }
        // --- Globaler Fade-In: jeder frisch erzeugte Knoten blendet
        //     sinus-eased ueber ~733ms ein. Multiplikativ auf alle Opacities.
        const SPAWN_DUR = 733;  // ms
        const spawnT = u.spawnT || 0;
        const rawAge = (performance.now() - spawnT) / SPAWN_DUR;
        const appear = easeSineInOut(Math.max(0, Math.min(1, rawAge)));
        // --- Bubble-Out: neue Kinder wachsen sinus-eased von Scale 0 auf 1 ---
        if (u.bubbleOut) {
          const BUBBLE_DUR = 1066;  // ms
          const bRaw = (performance.now() - spawnT) / BUBBLE_DUR;
          const bScale = easeSineOut(Math.max(0, Math.min(1, bRaw)));
          obj.scale.setScalar(Math.max(0.01, bScale));
          if (bRaw >= 1) { u.bubbleOut = false; obj.scale.setScalar(1); }
        }
        // --- Hover: time-based sinus ease-in-out ---
        const isHovered = hoveredId != null && u.nodeId === hoveredId;
        u.hoverLin = u.hoverLin || 0;
        const hTarget = isHovered ? 1 : 0;
        const hStep = dt / HOVER_DUR;
        if (u.hoverLin < hTarget)      u.hoverLin = Math.min(hTarget, u.hoverLin + hStep);
        else if (u.hoverLin > hTarget) u.hoverLin = Math.max(hTarget, u.hoverLin - hStep);
        const hEase = easeSineInOut(u.hoverLin);
        const ms = u.mainSphere, gl = u.glowSphere;
        const baseOp = u.baseOpacity || 0.97;
        // --- Gedankenblase: lebendige Cloud-Animation ---
        //   * leichte Atmung (breathe)  – sinus-skaliert den Hover-Container
        //   * sanfter Drift             – verschiebt Container um wenige Einheiten
        //   * Sprite-Wobble             – Cloud wirkt, als würde sie atmen
        //   * Alters-Fade vor 60 s      – weicher Übergang bevor Rebuild zur Kugel wechselt
        let cloudScale = 1;
        let cloudFade = 1;
        if (u.isThoughtBubble) {
          const ph = u.bubblePhase || 0;
          // Atmung + Drift
          cloudScale = 1 + Math.sin(t * 1.15 + ph) * 0.045;
          ms.position.x = Math.cos(t * 0.52 + ph * 1.3) * 0.35;
          ms.position.y = Math.sin(t * 0.71 + ph) * 0.55;
          ms.position.z = Math.sin(t * 0.43 + ph * 0.7) * 0.25;
          // Sprite-Wobble: x/y asymmetrisch, damit Cloud organisch „bläht"
          if (u.bubbleSprite && u.bubbleBaseW && u.bubbleBaseH) {
            const wobX = 1 + Math.sin(t * 1.8 + ph) * 0.025;
            const wobY = 1 + Math.cos(t * 1.5 + ph * 1.4) * 0.03;
            u.bubbleSprite.scale.set(u.bubbleBaseW * wobX, u.bubbleBaseH * wobY, 1);
          }
          // Alters-Fade: in den letzten 10 s vor 60-s-Cutoff weich ausblenden.
          //   aktive thinking-Blasen (status=='thinking') bleiben voll opak.
          if (u.bubbleStatus !== 'thinking' && u.bubbleTs) {
            const ageSec = Date.now() / 1000 - u.bubbleTs;
            if (ageSec > 50) {
              cloudFade = Math.max(0, 1 - (ageSec - 50) / 10);
            }
          }
          // Hover-Darken: Wolke tintet sich auf Hover abgedunkelt ein
          // (333 ms ease-in-out). Nutzt SpriteMaterial.color, das die Textur
          // multipliziert — Basis weiss (0xffffff), Hover ca. 55 % Helligkeit.
          if (u.bubbleSprite) {
            u.bubbleHoverLin = u.bubbleHoverLin || 0;
            const bhTarget = isHovered ? 1 : 0;
            const bhStep = dt / BUBBLE_HOVER_DUR;
            if (u.bubbleHoverLin < bhTarget)      u.bubbleHoverLin = Math.min(bhTarget, u.bubbleHoverLin + bhStep);
            else if (u.bubbleHoverLin > bhTarget) u.bubbleHoverLin = Math.max(bhTarget, u.bubbleHoverLin - bhStep);
            const bhEase = easeSineInOut(u.bubbleHoverLin);
            // 1.0 (voll) → 0.55 (abgedunkelt) linear lerpen via bhEase
            const tint = 1.0 - 0.45 * bhEase;
            u.bubbleSprite.material.color.setRGB(tint, tint, tint);
          }
        }
        const scl = (1 + hEase * 0.35) * cloudScale;
        ms.scale.set(scl, scl, scl);
        // Fade-In MULTIPLIKATIV auf Haupt-Sphaere/Glow/Label/Plus applizieren
        const opTarget = appear * cloudFade * (baseOp + hEase * Math.min(0.3, 1 - baseOp));
        if (ms.material) ms.material.opacity = opTarget;
        // Gedankenblase: Opacity auf den Sprite durchreichen (ms = Container).
        // Untere Grenze 0.222 — die Wolke ist schon beim Spawn lesbar sichtbar,
        // nicht unsichtbar (analog zum Label-Minimum).
        if (u.bubbleSprite) {
          u.bubbleSprite.material.opacity = u.isThoughtBubble
            ? Math.max(0.222, opTarget)
            : opTarget;
        }
        if (gl) gl.material.opacity = appear * hEase * 0.55;
        if (u.labelSprite) {
          const tgt = u.labelSprite.userData.targetOpacity || 0.97;
          u.labelSprite.material.opacity = appear * tgt;
        }
        // --- "+"-Indikator: time-based sinus-eased Fade-In/Out ---
        // WICHTIG: immer quadratisch (setScalar) damit nichts verzerrt,
        //          position (0,0,0) haelt es im Knoten-Zentrum.
        if (u.plusSprite) {
          const want = hidden ? hidden.has(u.nodeId) : false;
          u.plusLin = u.plusLin || 0;
          const pTarget = want ? 1 : 0;
          const pStep = dt / PLUS_DUR;
          if (u.plusLin < pTarget)      u.plusLin = Math.min(pTarget, u.plusLin + pStep);
          else if (u.plusLin > pTarget) u.plusLin = Math.max(pTarget, u.plusLin - pStep);
          const pEase = easeSineInOut(u.plusLin);
          u.plusSprite.material.opacity = appear * pEase;
          u.plusSprite.visible = (appear * pEase) > 0.002;
          const baseSize = u.plusSprite.userData.baseSize || (u.baseRadius * 1.6);
          const ps = baseSize * (0.7 + pEase * 0.3);
          u.plusSprite.scale.set(ps, ps, 1);
          u.plusSprite.position.set(0, 0, 0);  // immer zentriert
        }
      });
    }
    requestAnimationFrame(animLoop);
  })();
  // Standard-Orbit-Navigation (wie Blender/Figma/Three.js OrbitControls Default):
  //   LEFT  = Orbit / Rotate
  //   RIGHT = Pan / Move
  //   MIDDLE + Mausrad = Zoom
  // Werte entsprechen THREE.MOUSE: 0=ROTATE, 1=DOLLY, 2=PAN
  const controls = forceGraph3d.controls();
  if (controls) {
    if (controls.mouseButtons) {
      controls.mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
    }
    // TOUCH: ein Finger = Orbit, zwei Finger = Pan/Zoom
    if (controls.touches) {
      controls.touches = { ONE: 0, TWO: 2 };  // 0=ROTATE, 2=DOLLY_PAN
    }
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;  // Stronger damping → smoother, delayed easing after zoom/pan/rotate stops
    controls.zoomSpeed = 0.7;       // Gentler wheel zoom — cineastic statt "snap"
    controls.panSpeed = 1.0;
    controls.rotateSpeed = 0.8;
    if (controls.update) controls.update();
  }
  // Rechte Maustaste Kontextmenü deaktivieren im 3D-Canvas
  el.addEventListener('contextmenu', e => e.preventDefault());
  forceGraph3d.cameraPosition({ z: 520 });

  // Layout-Forces: kompakt, möglichst kurze Verbindungen, wenig Überschneidung
  const linkForce = forceGraph3d.d3Force('link');
  if (linkForce) {
    linkForce.distance(l => {
      const d = (typeof l.source === 'object' ? l.source.depth : 0);
      // Hauptast → Theme kurz; Theme → Tool noch kürzer
      return d === 0 ? 55 : d === 1 ? 28 : d === 2 ? 16 : 14;
    });
    linkForce.strength(l => {
      const d = (typeof l.source === 'object' ? l.source.depth : 0);
      // Tiefe Knoten: sehr starker Pull damit Cluster-Blätter eng am Parent
      // bleiben und nicht durch Geschwister-Abstoßung weggedrückt werden.
      return d === 0 ? 0.9 : d === 1 ? 1.2 : d === 2 ? 1.4 : 2.0;
    });
  }
  const chargeForce = forceGraph3d.d3Force('charge');
  if (chargeForce) {
    chargeForce.strength(d => {
      if (d.depth === 0) return -350;
      if (d.depth === 1) return -140;
      if (d.depth === 2) return -45;
      // Leaf-Abstossung praktisch abgeschaltet: bei vielen Cluster-Blaettern
      // summiert sich sonst kumulativ ein Druck der sie aus ihrem Parent-Pool
      // wegdrueckt und „frei fliegend" erscheinen laesst.
      return -2;
    });
    // Kürzere Reichweite, damit Abstoßung nur lokal wirkt → weniger Explosion
    chargeForce.distanceMax(180);
  }
  // Center-Attract stärker → Graph bleibt kompakt
  const centerForce = forceGraph3d.d3Force('center');
  if (centerForce && centerForce.strength) centerForce.strength(0.06);

  // Collide-Force ergänzen: begrenzt den minimalen Abstand zwischen Knoten,
  // damit sich Geschwister nicht so eng überlappen, dass die Link-Constraint
  // zerreisst. Kleine Radien fuer tiefe Ebenen erlauben dichtes Packen.
  if (window.d3 && d3.forceCollide) {
    forceGraph3d.d3Force('collide', d3.forceCollide(d => {
      if (d.depth === 0) return 40;
      if (d.depth === 1) return 18;
      if (d.depth === 2) return 10;
      return 5;  // Leaves
    }).strength(0.9).iterations(2));
  }

  update3D();
}

// Knoten fokussieren (Log-Click + andere Trigger) — zentriert Knoten im Viewport
function focusNodeById(thoughtId) {
  if (!thoughtId) return;
  const key = 't:' + thoughtId;
  if (settings.threeD && forceGraph3d) {
    const data = forceGraph3d.graphData();
    const n3d = data.nodes.find(n => n.id === key);
    if (!n3d || n3d.x == null) return;
    const distance = 140;
    const len = Math.hypot(n3d.x || 0.01, n3d.y || 0.01, n3d.z || 0.01);
    const distRatio = 1 + distance / Math.max(len, 10);
    forceGraph3d.cameraPosition(
      { x: n3d.x * distRatio, y: n3d.y * distRatio, z: n3d.z * distRatio },
      n3d,
      1300
    );
    return;
  }
  if (!root) return;
  const node = root.descendants().find(n => n.data._thoughtId === thoughtId);
  if (!node || node.x == null) return;
  const W = window.innerWidth, H = window.innerHeight;
  const scale = 1.25;
  const tx = W/2 - node.x * scale;
  const ty = H/2 - node.y * scale;
  svg.transition().duration(900).ease(d3.easeCubicInOut)
    .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  // Kurz hervorheben — CSS-Klasse direkt togglen, KEIN voller rebuild
  // (spart 2x buildTree + d3.hierarchy + update3D pro Log-Klick).
  selectedKey = keyOf(node);
  g.selectAll('g.node').classed('selected', d => keyOf(d) === selectedKey);
  setTimeout(() => {
    selectedKey = null;
    g.selectAll('g.node').classed('selected', false);
  }, 2000);
}

// ============ Blender-Style 3D-Gizmo ============
function drawGizmo() {
  const svg = document.getElementById('gizmo3d');
  if (!svg || !settings.threeD || !forceGraph3d) return;
  const cam = forceGraph3d.camera();
  if (!cam || !cam.matrixWorldInverse) return;
  const cx = 55, cy = 55, len = 36;
  const axes = [
    { dir: [1,0,0],  col: '#ff4d6d', lbl: 'X',  view: 'right' },
    { dir: [-1,0,0], col: '#7a2434', lbl: '',   view: 'left'  },
    { dir: [0,1,0],  col: '#4ade80', lbl: 'Y',  view: 'top'   },
    { dir: [0,-1,0], col: '#1f6633', lbl: '',   view: 'bottom' },
    { dir: [0,0,1],  col: '#3b82f6', lbl: 'Z',  view: 'front' },
    { dir: [0,0,-1], col: '#1e3a73', lbl: '',   view: 'back'  }
  ];
  const mat = cam.matrixWorldInverse.elements;
  const transform = v => {
    // v = axis direction (world). Transformiere nur Richtung (nicht Translation) → mat 3x3 rotation part
    return [
      mat[0]*v[0] + mat[4]*v[1] + mat[8]*v[2],
      mat[1]*v[0] + mat[5]*v[1] + mat[9]*v[2],
      mat[2]*v[0] + mat[6]*v[1] + mat[10]*v[2]
    ];
  };
  const projected = axes.map(a => {
    const v = transform(a.dir);
    return { ...a, sx: v[0], sy: -v[1], z: -v[2] };
  });
  projected.sort((a, b) => a.z - b.z);  // hintere zuerst zeichnen
  let html = `<circle class="axis-reset" cx="${cx}" cy="${cy}" r="10" onclick="event.stopPropagation();snap3DView('reset')"/>`;
  html += `<text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="9" fill="#fff" pointer-events="none">⟳</text>`;
  // X/Y/Z axis lines (from origin to positive tip)
  const pos = projected.filter(a => a.lbl);
  for (const a of pos) {
    const isFar = a.z > 0;
    const opacity = isFar ? 0.35 : 1;
    html += `<line x1="${cx}" y1="${cy}" x2="${cx+a.sx*len}" y2="${cy+a.sy*len}" stroke="${a.col}" stroke-width="2" opacity="${opacity}" pointer-events="none"/>`;
  }
  // Balls for all 6 directions
  for (const a of projected) {
    const isFar = a.z > 0;
    const r = a.lbl ? 10 : 7;
    const opacity = isFar ? 0.45 : 1;
    const fill = a.lbl ? a.col : 'transparent';
    const stroke = a.col;
    html += `<circle class="axis-ball" cx="${cx+a.sx*len}" cy="${cy+a.sy*len}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" opacity="${opacity}" onclick="event.stopPropagation();snap3DView('${a.view}')"/>`;
    if (a.lbl) {
      html += `<text x="${cx+a.sx*len}" y="${cy+a.sy*len+4}" text-anchor="middle" font-size="10" fill="#fff" opacity="${opacity}" pointer-events="none">${a.lbl}</text>`;
    }
  }
  svg.innerHTML = html;
}
// Gizmo + Overview-Viewport laufen ueber EINEN rAF-Loop mit Camera-Dirty-Check.
// Vorteil gegenueber setInterval(80/120): bei ruhender Kamera = 0 Renderarbeit,
// bei bewegter Kamera volle 60 fps statt getaktetes 12.5 fps-Polling.
// (Trackball-Pan/Zoom erzeugt keine d3-zoom-Events — daher kam vorher Polling.)
let __lastCamHash = 0;
function __camPerfLoop() {
  if (forceGraph3d) {
    const cam = forceGraph3d.camera && forceGraph3d.camera();
    const m = cam && cam.matrixWorld && cam.matrixWorld.elements;
    if (m) {
      // Cheap hash: einige Rotations- + skalierte Translations-Elemente.
      const h = m[0] + m[5] + m[10] + (m[12] + m[13] + m[14]) * 0.001;
      if (Math.abs(h - __lastCamHash) > 1e-4) {
        __lastCamHash = h;
        if (settings.threeD) drawGizmo();
        if (settings.overview && typeof updateOverviewViewport === 'function') {
          updateOverviewViewport();
        }
      }
    }
  }
  requestAnimationFrame(__camPerfLoop);
}
requestAnimationFrame(__camPerfLoop);

function snap3DView(axis) {
  if (!forceGraph3d) return;
  const d = 520;
  const positions = {
    front:  { x: 0, y: 0, z: d },
    back:   { x: 0, y: 0, z: -d },
    right:  { x: d, y: 0, z: 0 },
    left:   { x: -d, y: 0, z: 0 },
    top:    { x: 0, y: d, z: 0.1 },
    bottom: { x: 0, y: -d, z: 0.1 },
    reset:  { x: d*0.5, y: d*0.35, z: d*0.8 }
  };
  forceGraph3d.cameraPosition(positions[axis] || positions.reset, { x: 0, y: 0, z: 0 }, 900);
}
// Position-Cache (ueber Rebuilds hinweg), damit eingeklappte Sub-Knoten
// beim Wieder-Ausklappen an ihrer letzten bekannten Position erscheinen.
window.__nodePosCache = window.__nodePosCache || new Map();

function update3D(opts) {
  if (!forceGraph3d || !root) return;
  const fromToggle = opts && opts.fromToggle;

  // Aktuelle Positionen ALLER lebenden Knoten in den Cache schreiben,
  // bevor graphData ersetzt wird. Ermoeglicht exakte Restauration nach Toggle.
  try {
    const cur = forceGraph3d.graphData();
    cur.nodes.forEach(n => {
      if (typeof n.x === 'number') {
        window.__nodePosCache.set(n.id, { x: n.x, y: n.y, z: n.z || 0 });
      }
    });
  } catch (_) {}
  const tss = root.descendants().map(n => n.data._ts).filter(x => x);
  const tmax = tss.length ? Math.max(...tss) : 0;
  const tmin = tss.length ? Math.min(...tss) : 0;
  const span = Math.max(1, tmax - tmin);
  const ageF = ts => { if (!ts) return 0.5; return 1 - (tmax - ts) / span; };

  // Effektives Alter pro Knoten: eigenes _ts wenn vorhanden,
  // sonst = _ts des jüngsten (neuesten) Sub-Knotens (rekursiv MAX).
  const effectiveTs = new Map();
  function computeTs(n) {
    const own = n.data._ts || 0;
    let maxChild = 0;
    if (n.children) {
      for (const c of n.children) {
        const ct = computeTs(c);
        if (ct > maxChild) maxChild = ct;
      }
    }
    const eff = own || maxChild;  // eigene ts bevorzugt, sonst jüngster Sub
    effectiveTs.set(n, eff);
    return eff;
  }
  computeTs(root);
  // Aktiv (thinking) in Sub-Tree?
  const hasActive = new Map();
  function computeActive(n) {
    let a = n.data._status === 'thinking';
    if (n.children) for (const c of n.children) a = computeActive(c) || a;
    hasActive.set(n, a);
    return a;
  }
  computeActive(root);

  const nodes = [], links = [];
  root.descendants().forEach(n => {
    nodes.push({
      id: keyOf(n),
      name: n.data.name,
      color: colorOf(n),
      depth: n.depth,
      status: n.data._status,
      _ts: n.data._ts || 0,
      _ageFactor: ageF(n.data._ts),
      _kind: n.data._kind,
      _bubbleText: n.data._bubbleText
    });
  });
  root.links().forEach(l => {
    // Link folgt dem Kind (= target) — und zwar dem JÜNGSTEN Enkel im Target-Subtree
    const childTs = effectiveTs.get(l.target) || 0;
    links.push({
      source: keyOf(l.source), target: keyOf(l.target),
      color: colorOf(l.target),
      active: hasActive.get(l.target) || false,
      ageFactor: ageF(childTs)
    });
  });

  // Sanfte Positionierung:
  // — Bestehende Knoten starten an ihrer zuletzt bekannten Position
  //   (aus Cache), damit sie nicht springen. Physik darf sie dann
  //   organisch nachjustieren.
  // — Neue Knoten spawnen an ihrer Parent-Position + kleinem Jitter, sodass
  //   sie sichtbar aus dem Parent herauswachsen.
  // — Kein fx/fy/fz — der Force-Graph simuliert frei, so dass das Layout
  //   beim Ausklappen neuer Aeste organisch atmet.
  const parentOf = new Map();
  links.forEach(l => parentOf.set(l.target, l.source));
  const resolveSeed = (id, depth = 0) => {
    if (depth > 20) return null;
    const c = window.__nodePosCache.get(id);
    if (c) return c;
    const p = parentOf.get(id);
    return p ? resolveSeed(p, depth + 1) : null;
  };
  // Welche IDs waren im vorherigen Graph? → unterscheidet "Knoten bleibt"
  // von "Knoten wurde frisch hinzugefuegt / re-expandet".
  const prevIds = new Set();
  try {
    const prev = forceGraph3d.graphData();
    prev.nodes.forEach(p => prevIds.add(p.id));
  } catch (_) {}

  nodes.forEach(n => {
    // Vorheriges Freeze zuruecksetzen (falls aus frueherem Rebuild noch gesetzt)
    n.fx = null; n.fy = null; n.fz = null;
    const cached = window.__nodePosCache.get(n.id);
    const wasInGraph = prevIds.has(n.id);
    if (cached && wasInGraph) {
      // Bestand im Graph → exakt an letzter Position weitermachen, kein Sprung.
      n.x = cached.x; n.y = cached.y; n.z = cached.z;
    } else {
      // Neu im Graph (truly new ODER re-expand nach Collapse) → aus Parent
      // heraus bubbeln. Seed exakt an Parent-Position, Scale-Tween 0 → 1.
      const seed = resolveSeed(n.id);
      if (seed) {
        n.x = seed.x;
        n.y = seed.y;
        n.z = seed.z;
        n.vx = 0; n.vy = 0; n.vz = 0;
        n.__bubbleOut = true;
      }
    }
  });
  forceGraph3d.graphData({ nodes, links });
}

// Boot
applySettings();
renderLegend();
rebuild();
// SSE-Stream statt 500 ms-Polling: Server pusht Deltas, Frontend reagiert
// sofort und verbraucht idle = 0 Requests.
setupStream();

// Alternder Gedankenblasen-Swap: sobald ein Gedanke die 60-s-Marke (+Fade)
// überschreitet, soll er von der Cloud-Sprite zur normalen Kugel werden.
// Wir prüfen alle 8 s, ob der root-Baum einen solchen Knoten enthält und
// triggern dann einen günstigen Rebuild (der dann für jenen Knoten in
// nodeThreeObject die Sphere statt die Bubble erzeugt).
setInterval(() => {
  if (!root) return;
  const nowSec = Date.now() / 1000;
  const overdue = root.descendants().some(n => {
    const d = n.data;
    if (!d || !d._bubbleText) return false;
    if (d._status === 'thinking') return false;
    return d._ts && (nowSec - d._ts) > 61;
  });
  if (overdue) rebuild();
}, 8000);

// Canvas / 3D-Graph-Groesse bei Browser-Resize mitfuehren (debounced)
let __resizeRaf = null;
function __applyResize() {
  __resizeRaf = null;
  const W = window.innerWidth, H = window.innerHeight;
  if (sim) sim.force("center", d3.forceCenter(W / 2, H / 2)).alpha(0.3).restart();
  if (forceGraph3d) {
    if (forceGraph3d.width) forceGraph3d.width(W);
    if (forceGraph3d.height) forceGraph3d.height(H);
    const renderer = forceGraph3d.renderer && forceGraph3d.renderer();
    if (renderer && renderer.setSize) renderer.setSize(W, H, false);
    const cam = forceGraph3d.camera && forceGraph3d.camera();
    if (cam && 'aspect' in cam) { cam.aspect = W / H; cam.updateProjectionMatrix(); }
    if (forceGraph3d.refresh) forceGraph3d.refresh();
  }
  const svg = document.getElementById('map');
  if (svg) { svg.setAttribute('width', W); svg.setAttribute('height', H); }
}
window.addEventListener("resize", () => {
  if (__resizeRaf) return;
  __resizeRaf = requestAnimationFrame(__applyResize);
});
// Auch initial einmal anwenden falls Layout-Shifts beim Laden passieren
window.addEventListener('load', __applyResize);
