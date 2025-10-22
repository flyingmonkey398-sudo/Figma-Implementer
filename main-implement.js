(() => {
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
  const warn = (msg) => console.warn(`\u26A0\uFE0F ${msg}`);
  figma.showUI(
    `<html><body style="margin:8px;font:12px ui-monospace,monospace">
    <div id=out style="white-space:pre;max-width:460px;margin-bottom:6px"></div>
    <label for=txt style="display:block;margin-bottom:4px;font-weight:600;">Insert JSON:</label>
    <textarea id=txt rows=8 placeholder='{"meta": {...}, "variables": {...}, "nodes": [...] }'
      style="width:460px;max-width:460px;font:12px ui-monospace,monospace;white-space:pre"></textarea><br/>
    <div style="margin-top:6px;display:flex;gap:6px">
      <button id=apply>Apply JSON</button>
      <button id=retie>Re-tie page to variables</button>
    </div>

    <script>
      const out = document.getElementById('out');
      const txt = document.getElementById('txt');
      const btnApply = document.getElementById('apply');
      const btnRetie = document.getElementById('retie');
      const log = (m) => out.textContent += (m + "\\n");
      window.onmessage = (e) => { const m = e.data.pluginMessage; if (m && m.type === 'log') log(m.text); };

      btnApply.onclick = () => parent.postMessage({ pluginMessage:{ type:'apply-json', text: txt.value } }, '*');
      btnRetie.onclick  = () => parent.postMessage({ pluginMessage:{ type:'retie' } }, '*');
    <\/script>
  </body></html>`,
    { width: 500, height: 360 }
  );
  figma.ui.onmessage = async (msg) => {
    var _a;
    if ((msg == null ? void 0 : msg.type) === "retie") {
      await retiePageToVariables();
      return;
    }
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
  async function applyVariables(variables = { collections: [] }) {
    var _a;
    try {
      if (!figma.variables) {
        log("Variable API unavailable");
        return;
      }
      const cols = Array.isArray(variables == null ? void 0 : variables.collections) ? variables.collections : [];
      if (!cols.length) {
        log("No variable collections to apply");
        return;
      }
      const TYPE = {
        COLOR: "COLOR",
        FLOAT: "FLOAT",
        STRING: "STRING",
        BOOLEAN: "BOOLEAN",
        NUMBER: "FLOAT"
      };
      const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
      const collectionByName = new Map(localCollections.map((c) => [c.name, c]));
      for (const c of cols) {
        const name = String((c == null ? void 0 : c.name) || "").trim();
        if (!name) {
          log("Skip unnamed collection");
          continue;
        }
        let collection = collectionByName.get(name);
        if (!collection) {
          collection = figma.variables.createVariableCollection(name);
          collectionByName.set(name, collection);
          log(`Created collection: "${name}" (${collection.id})`);
        } else {
          log(`Collection exists: "${name}"`);
        }
        const wantModes = (Array.isArray(c == null ? void 0 : c.modes) ? c.modes : []).map((m) => String((m == null ? void 0 : m.name) || "").trim()).filter(Boolean);
        if (wantModes.length) {
          if (collection.modes.length === 1 && collection.modes[0].name !== wantModes[0]) {
            collection.renameMode(collection.modes[0].modeId, wantModes[0]);
            log(`  \u2022 renamed default mode \u2192 ${wantModes[0]}`);
          }
          for (const m of wantModes) {
            if (!collection.modes.find((x) => x.name === m)) {
              collection.addMode(m);
              log(`  \u2022 added mode: ${m}`);
            }
          }
        } else if (!collection.modes.length) {
          collection.addMode("Base");
        }
        const modeIdByName = new Map(collection.modes.map((m) => [m.name, m.modeId]));
        const wantVars = Array.isArray(c == null ? void 0 : c.variables) ? c.variables : [];
        if (!wantVars.length) {
          log(`  (no variables in "${name}")`);
          continue;
        }
        const localVars = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === collection.id);
        const varByName = new Map(localVars.map((v) => [v.name, v]));
        for (const v of wantVars) {
          const vName = String((v == null ? void 0 : v.name) || "").trim();
          if (!vName) {
            log("  - skip unnamed variable");
            continue;
          }
          const vType = (_a = TYPE[String((v == null ? void 0 : v.type) || "").toUpperCase()]) != null ? _a : "STRING";
          const valuesByMode = (v == null ? void 0 : v.valuesByMode) && typeof v.valuesByMode === "object" ? v.valuesByMode : {};
          let variable = varByName.get(vName);
          if (!variable) {
            variable = figma.variables.createVariable(vName, collection.id, vType);
            varByName.set(vName, variable);
            log(`  + var: ${vName} (${vType})`);
          } else if (variable.resolvedType !== vType) {
            log(`  ! type mismatch for ${vName} (have ${variable.resolvedType}, want ${vType}) \u2014 recreating`);
            variable.remove();
            variable = figma.variables.createVariable(vName, collection.id, vType);
            varByName.set(vName, variable);
          } else {
            log(`  = var: ${vName}`);
          }
          for (const [modeName, raw] of Object.entries(valuesByMode)) {
            const modeId = modeIdByName.get(modeName);
            if (!modeId) {
              log(`    \u2022 mode "${modeName}" not found in "${name}"`);
              continue;
            }
            try {
              let val = raw;
              if (vType === "COLOR") {
                const { r, g, b, a } = hexToRgb01(String(raw).trim());
                val = { r, g, b, a };
              } else if (vType === "FLOAT") {
                val = Number(raw);
              } else if (vType === "BOOLEAN") {
                val = Boolean(raw);
              } else {
                val = String(raw);
              }
              variable.setValueForMode(modeId, val);
              log(`    \u2022 set ${vName} @ ${modeName}`);
            } catch (e) {
              err(`    set ${vName} @ ${modeName}: ${String(e)}`);
            }
          }
        }
      }
    } catch (e) {
      err("applyVariables: " + String(e));
    }
  }
  function hexToRgb01(hex) {
    const h = hex.replace("#", "").trim();
    let r = 0, g = 0, b = 0, a = 1;
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else if (h.length === 6) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    } else if (h.length === 8) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
      a = parseInt(h.slice(6, 8), 16) / 255;
    }
    return { r: r / 255, g: g / 255, b: b / 255, a };
  }
  async function applyNodes(nodes) {
    let updatedCount = 0;
    if (!nodes) return log("No changes found");
    const arr = Array.isArray(nodes) ? nodes : [nodes];
    const nodeMap = /* @__PURE__ */ new Map();
    const componentMap = /* @__PURE__ */ new Map();
    async function createNode(spec, parent) {
      var _a, _b, _c, _d;
      const t = ((spec == null ? void 0 : spec.type) || (spec == null ? void 0 : spec.kind) || "").toUpperCase();
      if (spec.id) {
        const node2 = figma.getNodeById(spec.id);
        if (node2 && node2.type === "COMPONENT" && !node2.mainComponent) {
          log(`\u26D4 Skipping component master: ${node2.name}`);
          return null;
        }
      }
      let node = null;
      try {
        switch (t) {
          // ──────────────────────────── FRAME UPDATE ────────────────────────────
          case "FRAME":
          case "FRAME-SNAPSHOT": {
            const id = spec == null ? void 0 : spec.id;
            if (!id) {
              log("frame-snapshot missing id");
              break;
            }
            const existing = figma.getNodeById(id);
            if (existing.type !== "FRAME" && existing.type !== "INSTANCE") {
              log(`Node ${id} not a FRAME or INSTANCE \u2014 skipped`);
              break;
            }
            const f = existing;
            const p = spec.absPos, s = spec.size;
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
            if (Array.isArray(spec.children)) {
              for (const child of spec.children) {
                await createNode(child, f);
              }
            }
            break;
          }
          // ──────────────────────────── INSTANCE UPDATE ────────────────────────────
          // -------------------- Instance Update (for swatch palettes) --------------------
          case "INSTANCE-UPDATE": {
            const name = String((spec == null ? void 0 : spec.name) || "").trim();
            if (!name) {
              log("Instance-update missing name");
              break;
            }
            const inst = figma.currentPage.findOne(
              (n) => n.name === name && (n.type === "INSTANCE" || n.type === "FRAME")
            );
            if (!inst) {
              warn(`Instance "${name}" not found`);
              break;
            }
            if (inst.type === "COMPONENT") {
              log(`\u23ED\uFE0F Skipping master component: ${name}`);
              break;
            }
            let colorRect = null;
            try {
              colorRect = inst.findOne((n) => n.name === "ColorBox");
              if (colorRect) {
                if (spec.Hex) {
                  const { r, g, b, a } = hexToRgb01(spec.Hex);
                  colorRect.fills = [{ type: "SOLID", color: { r, g, b }, opacity: a }];
                  log(`\u{1F3A8} Updated fill color for ${name}`);
                }
                if (spec.variableAlias && colorRect) {
                  try {
                    const variable = figma.variables.getVariableById(spec.variableAlias);
                    if (variable) {
                      if (!colorRect.fills || colorRect.fills.length === 0) {
                        colorRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
                      }
                      colorRect.boundVariables = {
                        fills: { id: variable.id, type: "VARIABLE_ALIAS" }
                      };
                      log(`\u2705 Bound ${name} to variable: ${variable.name}`);
                    } else {
                      warn(`\u26A0\uFE0F Variable not found: ${spec.variableAlias}`);
                    }
                  } catch (e) {
                    err(`Failed to bind variable for ${name}: ${String(e)}`);
                  }
                }
              }
            } catch (e) {
              err(`Failed to recolor ${name}: ${String(e)}`);
            }
            try {
              const label = inst.findOne((n) => n.name === "Label");
              if (label && spec.Label) {
                await figma.loadFontAsync(label.fontName);
                label.characters = spec.Label;
              }
              const hexText = inst.findOne((n) => n.name === "Hex");
              if (hexText && spec.Hex) {
                await figma.loadFontAsync(hexText.fontName);
                hexText.characters = spec.Hex;
              }
              log(`\u{1F4DD} Updated text for ${name}`);
            } catch (e) {
              warn(`\u26A0\uFE0F Text update failed in ${name}: ${String(e)}`);
            }
            updatedCount++;
            break;
          }
          // ✅ properly closes INSTANCE-UPDATE
          // ──────────────────────────── INSTANCE CREATION ────────────────────────────
          case "INSTANCE": {
            try {
              const componentId = String((spec == null ? void 0 : spec.componentId) || "").trim();
              if (!componentId) {
                log("Instance missing componentId");
                break;
              }
              const comp = figma.getNodeById(componentId);
              if (!comp) {
                log(`Component not found for id: ${componentId}`);
                break;
              }
              const inst = comp.createInstance();
              if (spec.name) inst.name = spec.name;
              if (spec.absPos) {
                inst.x = spec.absPos.x || 0;
                inst.y = spec.absPos.y || 0;
              }
              if (spec.size) inst.resize(spec.size.w || inst.width, spec.size.h || inst.height);
              if (spec.autoLayout) {
                const f = inst;
                f.layoutMode = spec.autoLayout.direction === "VERTICAL" ? "VERTICAL" : "HORIZONTAL";
                f.itemSpacing = (_a = spec.autoLayout.spacing) != null ? _a : 8;
                f.paddingLeft = f.paddingRight = f.paddingTop = f.paddingBottom = (_b = spec.autoLayout.padding) != null ? _b : 0;
              }
              figma.currentPage.appendChild(inst);
              ok(`Created instance: ${inst.name}`);
            } catch (e) {
              err(`createInstance: ${String(e)}`);
            }
            break;
          }
          // ──────────────────────────── UNKNOWN / UNSUPPORTED ────────────────────────────
          default:
            err(`Unknown node type: ${t} \u2014 skipped (no fallback creation)`);
            break;
        }
        if (node && spec.name) node.name = spec.name;
        if (node && spec.size) node.resize(spec.size.w || node.width, spec.size.h || node.height);
        if (node && spec.absPos) {
          node.x = spec.absPos.x || 0;
          node.y = spec.absPos.y || 0;
        }
        if (node && spec.autoLayout) {
          const f = node;
          f.layoutMode = spec.autoLayout.direction === "VERTICAL" ? "VERTICAL" : "HORIZONTAL";
          f.itemSpacing = (_c = spec.autoLayout.spacing) != null ? _c : 8;
          f.paddingLeft = f.paddingRight = f.paddingTop = f.paddingBottom = (_d = spec.autoLayout.padding) != null ? _d : 0;
        }
        if (node && spec.fill) {
          const { r, g, b, a } = hexToRgb01(spec.fill);
          node.fills = [{ type: "SOLID", color: { r, g, b }, opacity: a }];
        }
        if (node && Array.isArray(spec.children)) {
          for (const child of spec.children) await createNode(child, node);
        }
        if (node && spec.id) nodeMap.set(spec.id, node);
        if (node && t === "COMPONENT" && spec.id) componentMap.set(spec.id, node);
        if (node) ok(`Created or updated ${t}: ${spec.name || "(unnamed)"}`);
        return node;
      } catch (e) {
        err(`createNode(${(spec == null ? void 0 : spec.name) || t}): ${String(e)}`);
        return null;
      }
    }
    for (const spec of arr) {
      if (spec.id) {
        const nodeById = figma.getNodeById(spec.id);
        if (nodeById && nodeById.type === "COMPONENT" && !nodeById.mainComponent) {
          log(`\u26D4 Skipping main component for id ${spec.id}`);
          continue;
        }
        if (nodeById && (nodeById.type === "INSTANCE" || nodeById.type === "FRAME")) {
          log(`Updating existing instance/frame by ID: ${nodeById.name}`);
          if (Array.isArray(spec.children)) {
            for (const c of spec.children) await createNode(c, nodeById);
          }
          continue;
        }
      }
      const target = figma.currentPage.findOne(
        (n) => n.name === spec.name && (n.type === "INSTANCE" || n.type === "FRAME")
      );
      if (target) {
        log(`Updating existing node by name: ${target.name}`);
        if (Array.isArray(spec.children)) {
          for (const c of spec.children) await createNode(c, target);
        }
        continue;
      }
      await createNode(spec, figma.currentPage);
    }
    ok(`Created or updated ${nodeMap.size} nodes total`);
  }
  async function retiePageToVariables() {
    if (!figma.variables) {
      log("Variables API unavailable");
      return;
    }
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    let vars = await figma.variables.getLocalVariablesAsync();
    if (!Array.isArray(vars)) vars = [];
    if (vars.length === 0) {
      for (const c of collections) {
        try {
          const got = await figma.variables.getVariablesInCollectionAsync(c.id);
          if (Array.isArray(got) && got.length) vars.push(...got);
        } catch (e) {
          log(`retie: getVariablesInCollectionAsync failed for "${c.name}": ${String(e)}`);
        }
      }
    }
    log(`retie: found ${collections.length} collections, ${vars.length} variables`);
    if (!collections.length || !vars.length) {
      ok("Re-tied 0 properties on this page");
      return;
    }
    const varById = new Map(vars.map((v) => [v.id, v]));
    const colorIdx = /* @__PURE__ */ new Map();
    const numIdx = /* @__PURE__ */ new Map();
    const strIdx = /* @__PURE__ */ new Map();
    const round255 = (x) => Math.round((x != null ? x : 1) * 255);
    const keyRGBA = (r, g, b, a) => `${round255(r)},${round255(g)},${round255(b)},${round255(a != null ? a : 1)}`;
    const getVal = (v, modeId) => {
      try {
        if (typeof v.getValueForMode === "function") return v.getValueForMode(modeId);
        if (typeof v.getValueForModeId === "function") return v.getValueForModeId(modeId);
      } catch (_) {
      }
      if (v.valuesByMode && typeof v.valuesByMode === "object") {
        const val = v.valuesByMode[modeId];
        if (val !== void 0) return val;
      }
      return void 0;
    };
    for (const v of vars) {
      const col = collections.find((c) => c.id === v.variableCollectionId);
      if (!col) continue;
      for (const m of col.modes) {
        const val = getVal(v, m.modeId);
        if (val == null) continue;
        if (v.resolvedType === "COLOR" && typeof val === "object" && "r" in val) {
          const { r, g, b, a } = val;
          colorIdx.set(keyRGBA(r, g, b, a), { id: v.id, name: v.name });
        } else if (v.resolvedType === "FLOAT") {
          const n = Number(val);
          if (Number.isFinite(n)) numIdx.set(n, { id: v.id, name: v.name });
        } else if (v.resolvedType === "STRING") {
          strIdx.set(String(val), { id: v.id, name: v.name });
        }
      }
    }
    log(`indexed ${colorIdx.size} colors, ${numIdx.size} numbers, ${strIdx.size} strings`);
    const solidRGBA = (p) => {
      const a = typeof p.opacity === "number" ? p.opacity : 1;
      return { r: p.color.r, g: p.color.g, b: p.color.b, a };
    };
    const nodes = figma.currentPage.findAll();
    let bound = 0;
    function bindPaintColor(node, prop, varId) {
      const variable = varById.get(varId);
      if (!variable) {
        log(`WARN paint: missing var ${varId}`);
        return false;
      }
      const paints = node[prop];
      if (!Array.isArray(paints) || paints.length === 0) return false;
      const p0 = paints[0];
      if (p0.type !== "SOLID") return false;
      const newPaint = Object.assign({}, p0);
      const existingBV = p0.boundVariables || {};
      const nextBV = Object.assign({}, existingBV, {
        // ✅ REQUIRED SHAPE
        color: { type: "VARIABLE_ALIAS", id: variable.id }
      });
      newPaint.boundVariables = nextBV;
      const next = paints.slice();
      next[0] = newPaint;
      try {
        node[prop] = next;
        return true;
      } catch (e) {
        log(`bind ${prop} color failed: ${String(e)}`);
        return false;
      }
    }
    const bind = (node, prop, varId) => {
      const variable = varById.get(varId);
      if (!variable) return;
      try {
        node.setBoundVariable(prop, variable);
        bound++;
      } catch (e) {
        log(`bind ${prop} failed: ${String(e)}`);
      }
    };
    for (const node of nodes) {
      if ("fills" in node) {
        const fs = node.fills;
        if (Array.isArray(fs) && fs.length && fs[0].type === "SOLID") {
          const { r, g, b, a } = solidRGBA(fs[0]);
          const m = colorIdx.get(keyRGBA(r, g, b, a));
          if (m && bindPaintColor(node, "fills", m.id)) {
            bound++;
            log(`bind fills \u2192 ${m.name}`);
          }
        }
      }
      if ("strokes" in node) {
        const st = node.strokes;
        if (Array.isArray(st) && st.length && st[0].type === "SOLID") {
          const { r, g, b, a } = solidRGBA(st[0]);
          const m = colorIdx.get(keyRGBA(r, g, b, a));
          if (m && bindPaintColor(node, "strokes", m.id)) {
            bound++;
            log(`bind strokes \u2192 ${m.name}`);
          }
        }
      }
      if (node.type === "TEXT") {
        const t = node;
        if (typeof t.fontSize === "number") {
          const m = numIdx.get(t.fontSize);
          if (m) {
            bind(t, "fontSize", m.id);
            log(`bind fontSize \u2192 ${m.name}`);
          }
        }
        const lh = t.lineHeight;
        if (lh && typeof lh === "object" && lh.unit === "PIXELS" && typeof lh.value === "number") {
          const m = numIdx.get(lh.value);
          if (m) {
            bind(t, "lineHeight", m.id);
            log(`bind lineHeight \u2192 ${m.name}`);
          }
        }
        const tf = t.fills;
        if (Array.isArray(t.fills) && t.fills.length && t.fills[0].type === "SOLID") {
          const { r, g, b, a } = solidRGBA(t.fills[0]);
          const m = colorIdx.get(keyRGBA(r, g, b, a));
          if (m && bindPaintColor(t, "fills", m.id)) {
            bound++;
            log(`bind text fill \u2192 ${m.name}`);
          }
        }
      }
      const n = node;
      const numericProps = ["itemSpacing", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "cornerRadius", "strokeWeight"];
      for (const prop of numericProps) {
        if (typeof n[prop] === "number") {
          const m = numIdx.get(n[prop]);
          if (m) {
            bind(node, prop, m.id);
            log(`bind ${prop} \u2192 ${m.name}`);
          }
        }
      }
    }
    ok(`Re-tied ${bound} properties on this page`);
  }
  log("YY Make Changes ready");
  figma.notify("YY Make Changes plugin ready");
})();
