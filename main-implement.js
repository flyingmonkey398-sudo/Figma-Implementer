const uiLog = (text) => {
  try {
    figma.ui.postMessage({ type: "log", text });
  } catch (_) {
  }
};
const log = (...a) => {
  console.log("[YY-MakeChanges]", ...a);
  uiLog(a.map(String).join(" "));
};
const ok = (m) => {
  figma.notify(`\u2705 ${m}`);
  uiLog(`\u2705 ${m}`);
};
const err = (m) => {
  figma.notify(`\u26A0\uFE0F ${m}`);
  uiLog(`\u26A0\uFE0F ${m}`);
};
figma.showUI(
  `<html><body style="margin:8px;font:12px ui-monospace,monospace">
  <div id=out style="white-space:pre;max-width:420px;margin-bottom:6px"></div>
  <label for=txt style="display:block;margin-bottom:4px;font-weight:500;">Insert JSON:</label>
  <textarea id=txt rows=8 placeholder='{"meta": {...}, "variables": {...}, "nodes": [...] }'
    style="width:420px;max-width:420px;font:12px ui-monospace,monospace;white-space:pre"></textarea><br/>
  <button id=apply style="margin-top:6px">Apply changes</button>

  <script>
    const out=document.getElementById('out'),
          txt=document.getElementById('txt'),
          btn=document.getElementById('apply');
    const log=(m)=>out.textContent+=(m+"\\n");
    window.onmessage=(e)=>{ const m=e.data.pluginMessage; if(m&&m.type==='log') log(m.text); };

    // send textarea content as JSON text
    btn.onclick=()=>parent.postMessage({
      pluginMessage:{ type:'apply-json', text: txt.value }
    }, '*');
  <\/script></body></html>`,
  { width: 460, height: 300 }
);
figma.ui.onmessage = async (msg) => {
  var _a;
  if ((msg == null ? void 0 : msg.type) !== "apply-json") return;
  try {
    const raw = msg.text;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const jsonfile = parseLoadedFile(parsed);
    applyMeta(jsonfile.meta);
    await applyVariables(jsonfile.variables);
    await applyNodes(jsonfile.nodes);
    ok("Changes applied");
  } catch (e) {
    err("apply-json failed: " + String((_a = e == null ? void 0 : e.message) != null ? _a : e));
  }
};
async function applyJSONFile(jsonfile) {
  applyMeta(jsonfile.meta);
  await applyVariables(jsonfile.variables);
  await applyNodes(jsonfile.nodes);
}
function parseLoadedFile(obj) {
  if (!obj || typeof obj !== "object") throw new Error("JSON must be an object");
  return {
    schema: obj["$schema"] || null,
    meta: obj.meta || {},
    variables: obj.variables || { collectionsCount: 0, collections: [] },
    nodes: obj.nodes || null
  };
}
function applyMeta(meta = {}) {
  try {
    if (meta.fileName) figma.root.setPluginData("yy_desiredFileName", String(meta.fileName));
    if (meta.scanId) figma.root.setPluginData("yy_scanId", String(meta.scanId));
    if (meta.pageName) figma.root.setPluginData("yy_pageName", String(meta.pageName));
    if (meta.author) figma.root.setPluginData("yy_author", String(meta.author));
    if (meta.version) figma.root.setPluginData("yy_version", String(meta.version));
    try {
      const NS = "yy";
      Object.entries(meta).forEach(([k, v]) => {
        if (v != null) figma.root.setSharedPluginData(NS, k, String(v));
      });
    } catch (e) {
    }
    const desired = figma.root.getPluginData("yy_desiredFileName");
    if (desired) ok(`Please rename this file to: ${desired} (plugins can\u2019t rename files)`);
    log("Meta saved: " + JSON.stringify({ fileName: meta.fileName, scanId: meta.scanId, pageName: meta.pageName, author: meta.author, version: meta.version }));
  } catch (e) {
    err("applyMeta: " + String(e));
  }
}
async function applyVariables(variables = { collectionsCount: 0, collections: [] }) {
  var _a;
  try {
    const list = Array.isArray(variables == null ? void 0 : variables.collections) ? variables.collections : [];
    if (list.length === 0 || !figma.variables) {
      log("No variable collections to apply or API unavailable");
      return;
    }
    const existing = await figma.variables.getLocalVariableCollectionsAsync();
    const byName = new Map(existing.map((c) => [c.name, c]));
    for (const c of list) {
      const name = ((_a = c == null ? void 0 : c.name) != null ? _a : "").trim();
      if (!name) {
        log("Skip unnamed collection");
        continue;
      }
      if (byName.has(name)) {
        log(`Collection exists: "${name}"`);
        continue;
      }
      const created = figma.variables.createVariableCollection(name);
      log(`Created collection: "${name}" (${created.id})`);
    }
  } catch (e) {
    err("applyVariables: " + String(e));
  }
}
async function applyNodes(nodes) {
  if (!nodes) return log("No changes found");
  const arr = Array.isArray(nodes) ? nodes : [nodes];
  for (const n of arr) {
    const t = (n == null ? void 0 : n.type) || (n == null ? void 0 : n.kind);
    switch (t) {
      case "frame-snapshot":
      case void 0:
        {
          const id = n == null ? void 0 : n.id;
          if (!id) {
            log("frame-snapshot missing id");
            break;
          }
          const node = figma.getNodeById(id);
          if (!node) {
            log(`Node ${id} not found`);
            break;
          }
          if (node.type !== "FRAME") {
            log(`Node ${id} not a FRAME \u2014 skip`);
            break;
          }
          try {
            const f = node;
            const p = n.absPos, s = n.size;
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
              f.x = p.x;
              f.y = p.y;
              log(`pos \u2192 ${p.x},${p.y}`);
            }
            if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) {
              f.resize(s.w, s.h);
              log(`size \u2192 ${s.w}\xD7${s.h}`);
            }
            ok(`Frame updated: ${f.name}`);
          } catch (e) {
            err("frame update: " + String(e));
          }
        }
        break;
      // ready for later, still inline if you want minimal footprint:
      case "text-style":
        log(`(todo) text-style change for ${n.id || n.name || "node"}`);
        break;
      case "prototype-link":
        log(`(todo) prototype-link change for ${n.id || n.name || "node"}`);
        break;
      default:
        log(`Unknown node type: ${t}`);
    }
  }
}
log("YY Make Changes ready");
figma.notify("YY Make Changes plugin ready");
