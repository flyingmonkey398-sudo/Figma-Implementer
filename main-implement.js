(() => {
  const uiLog = (text) => {
    try {
      figma.ui.postMessage({ type: "log", text });
    } catch (_) {
      console.log("UI log fallback:", text);
    }
  };
  const log = (...a) => {
    console.log("[YY-Retie]", ...a);
    try {
      figma.ui.postMessage({ type: "log", text: a.map(String).join(" ") });
    } catch (_) {
    }
  };
  const dbg = (...args) => {
    const msg = args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    console.log("\u{1F41E} [DEBUG]", msg);
    uiLog(msg);
  };
  const warn = (...args) => {
    const msg = args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    console.warn("\u26A0\uFE0F [WARN]", msg);
    uiLog(`\u26A0\uFE0F ${msg}`);
  };
  const ok = (...args) => {
    const msg = args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    figma.notify(`\u2705 ${msg}`);
    console.log("\u2705 [OK]", msg);
    uiLog(`\u2705 ${msg}`);
  };
  let defaultParent = null;
  async function insertPath(pathString) {
    const segments = pathString.split("/").map((s) => s.trim()).filter(Boolean);
    let parent = figma.currentPage;
    for (const segment of segments) {
      let existing = parent.findOne((n) => n.name === segment && "children" in n);
      if (!existing) {
        const frame = figma.createFrame();
        frame.name = segment;
        parent.appendChild(frame);
        dbg(`\u{1F4E6} Created new frame in path: ${segment}`);
        parent = frame;
      } else {
        parent = existing;
        dbg(`\u21AA Found existing path segment: ${segment}`);
      }
    }
    return parent;
  }
  function hexToRgb01(hex) {
    let c = hex.replace("#", "").trim();
    if (c.length === 3) c = c.split("").map((x) => x + x).join("");
    const num = parseInt(c.substring(0, 6), 16);
    const r = (num >> 16 & 255) / 255;
    const g = (num >> 8 & 255) / 255;
    const b = (num & 255) / 255;
    let a = 1;
    if (c.length === 8) a = parseInt(c.substring(6, 8), 16) / 255;
    return { r, g, b, a };
  }
  async function safeLoadFont(font) {
    try {
      if (!font) font = { family: "Inter", style: "Regular" };
      await figma.loadFontAsync(font);
      dbg("Loaded font", font);
      return font;
    } catch (e) {
      warn(`Primary font load failed: ${e}. Falling back to Inter Regular.`);
      const fallback = { family: "Inter", style: "Regular" };
      try {
        await figma.loadFontAsync(fallback);
        dbg("Loaded fallback font");
        return fallback;
      } catch (fallbackError) {
        err(`Fallback font load failed: ${fallbackError}`);
        return null;
      }
    }
  }
  function hexToRgb01(hex) {
    const clean = hex.replace(/^#/, "");
    const num = parseInt(clean, 16);
    const r = (num >> 16 & 255) / 255;
    const g = (num >> 8 & 255) / 255;
    const b = (num & 255) / 255;
    return { r, g, b, a: 1 };
  }
  async function handleUniversalJSON(spec) {
    var _a, _b;
    try {
      if ((_a = spec == null ? void 0 : spec.meta) == null ? void 0 : _a.insertPath) {
        const targetParent = await insertPath(spec.meta.insertPath);
        if (targetParent) {
          dbg(`\u2705 Insert path resolved: ${spec.meta.insertPath}`);
          defaultParent = targetParent;
        }
      }
      if ((_b = spec == null ? void 0 : spec.variables) == null ? void 0 : _b.collections) {
        try {
          const collections = await figma.variables.getLocalVariableCollectionsAsync();
          const vars = await figma.variables.getLocalVariablesAsync();
          for (const collSpec of spec.variables.collections) {
            let coll = collections.find((c) => c.name === collSpec.name);
            if (!coll) {
              coll = figma.variables.createVariableCollection(collSpec.name);
              log(`\u{1F195} Created collection: ${collSpec.name}`);
            }
            const existingModeNames = new Set(coll.modes.map((m) => m.name));
            for (const modeSpec of collSpec.modes || [{ name: "Value" }]) {
              if (!existingModeNames.has(modeSpec.name)) {
                coll.addMode(modeSpec.name);
                log(`\u2795 Added mode: ${modeSpec.name}`);
              }
            }
            for (const vSpec of collSpec.variables || []) {
              let v = vars.find((x) => x.name === vSpec.name && x.variableCollectionId === coll.id);
              if (!v) {
                v = figma.variables.createVariable(vSpec.name, coll.id, vSpec.type);
                log(`\u{1F3A8} Created variable: ${vSpec.name}`);
              }
              for (const [modeKey, val] of Object.entries(vSpec.valuesByMode || {})) {
                const mode = coll.modes.find((m) => m.name === modeKey || m.modeId === modeKey);
                if (!mode) continue;
                if (vSpec.type === "COLOR") {
                  const color = typeof val === "string" ? hexToRgb01(val) : val;
                  v.setValueForMode(mode.modeId, color);
                } else if (vSpec.type === "FLOAT") {
                  v.setValueForMode(mode.modeId, Number(val));
                } else if (vSpec.type === "STRING") {
                  v.setValueForMode(mode.modeId, String(val));
                }
              }
            }
          }
          ok("\u2705 Variable collections applied successfully.");
        } catch (e) {
          warn(`\u26A0\uFE0F Failed to apply variables: ${e}`);
        }
      }
      if (!(spec == null ? void 0 : spec.nodes) || spec.nodes.length === 0) {
        warn("\u26A0\uFE0F No nodes found in JSON.");
        return;
      }
      for (const nodeDef of spec.nodes) {
        if (nodeDef.type === "INSTANCE") {
          const instance = await findOrCreateInstance(nodeDef);
          if (instance) await updateInstance(instance, nodeDef);
        } else {
          await buildNode(nodeDef);
        }
      }
      ok("\u2705 JSON applied successfully.");
    } catch (e) {
      warn(`\u274C Failed to apply JSON: ${e}`);
    }
  }
  figma.showUI(
    `<html><body style="margin:8px;font:12px ui-monospace,monospace">
  <details id="debugWrap" open><summary style="cursor:pointer;font-weight:bold">Debug Output</summary>
    <div id=out style="white-space:pre;max-width:460px;margin-bottom:6px;height:160px;overflow:auto;border:1px solid #ddd;padding:4px"></div>
  </details>
  <label for=txt style="display:block;margin-top:8px;margin-bottom:4px;font-weight:600;">Insert JSON:</label>
  <textarea id=txt rows=10 placeholder='Insert JSON here' style="width:460px;max-width:460px;font:12px ui-monospace,monospace;white-space:pre"></textarea><br/>
  <div style="margin-top:6px;display:flex;gap:6px">
    <button id=apply>Apply JSON</button>
    <button id=retie>Re-tie page to variables</button>
    <button id=debug>Toggle Debug</button>
  </div>
  <script>
    const out = document.getElementById('out');
    const txt = document.getElementById('txt');
    const log = (m) => { out.textContent += (m + "\\n"); out.scrollTop = out.scrollHeight; };
    window.onmessage = (e) => { const m = e.data.pluginMessage; if (m && m.type === 'log') log(m.text); };
    document.getElementById('apply').onclick = () => parent.postMessage({ pluginMessage:{ type:'apply-json', text: txt.value } }, '*');
    document.getElementById('retie').onclick  = () => parent.postMessage({ pluginMessage:{ type:'retie' } }, '*');
    document.getElementById('debug').onclick  = () => parent.postMessage({ pluginMessage:{ type:'toggle-debug' } }, '*');
  <\/script>
</body></html>`,
    { width: 540, height: 500 }
  );
  figma.ui.onmessage = async (msg) => {
    if (msg.type === "apply-json") {
      let data;
      try {
        data = JSON.parse(msg.text);
      } catch (e) {
        warn("Invalid JSON format.");
        return;
      }
      await handleUniversalJSON(data);
    }
    if (msg.type === "retie") {
      await retiePageToVariables();
    }
  };
  function findNode(root, target) {
    if (!root || !target) return null;
    const lowerTarget = target.toLowerCase();
    const node = root.findOne(
      (n) => n.name.toLowerCase() === lowerTarget || n.name.toLowerCase().includes(lowerTarget)
    );
    if (node) dbg(`Found node for target '${target}':`, node.name);
    else warn(`Could not find node for target: ${target}`);
    return node;
  }
  function createNode(type) {
    switch (type) {
      case "FRAME":
        return figma.createFrame();
      case "COMPONENT":
        return figma.createComponent();
      case "INSTANCE": {
        const master = figma.currentPage.findOne(
          (n) => n.name === "palette" && n.type === "COMPONENT"
        );
        if (!master) throw new Error('Missing master component "palette".');
        return master.createInstance();
      }
      case "RECTANGLE":
        return figma.createRectangle();
      case "TEXT":
        return figma.createText();
      default:
        throw new Error(`Unsupported node type: ${type}`);
    }
  }
  async function findOrCreateInstance(spec) {
    if (!spec || !spec.name) {
      warn("\u274C Invalid instance spec \u2014 missing name");
      return null;
    }
    let instance = figma.currentPage.findOne(
      (n) => n.name === spec.name && n.type === "INSTANCE"
    );
    if (!instance) {
      const master = figma.currentPage.findOne(
        (n) => n.name === spec.masterComponent && n.type === "COMPONENT"
      );
      if (!master) {
        warn(`\u26A0\uFE0F Master component not found: ${spec.masterComponent}`);
        return null;
      }
      instance = master.createInstance();
      instance.name = spec.name;
      figma.currentPage.appendChild(instance);
      dbg(`\u2705 Created instance from ${master.name} \u2192 ${instance.name}`);
    } else {
      dbg(`\u21AA Found existing instance: ${instance.name}`);
    }
    return instance;
  }
  async function buildNode(nodeDef, parent) {
    const parentNode = parent || defaultParent || figma.currentPage;
    const type = nodeDef.type;
    const name = nodeDef.name || "Unnamed Node";
    let node = figma.currentPage.findOne((n) => n.name === name && n.type === type);
    parentNode.appendChild(node);
    if (!node) {
      node = createNode(type);
      node.name = name;
      (parent || figma.currentPage).appendChild(node);
      dbg(`Created new ${type}: ${name}`);
    }
    if (nodeDef.size) node.resizeWithoutConstraints(nodeDef.size.w, nodeDef.size.h);
    if (nodeDef.absPos) {
      node.x = nodeDef.absPos.x;
      node.y = nodeDef.absPos.y;
    }
    if (nodeDef.autoLayout && "layoutMode" in node) {
      const layout = nodeDef.autoLayout;
      node.layoutMode = layout.mode || "NONE";
      if ("itemSpacing" in node && layout.gap != null) node.itemSpacing = layout.gap;
    }
    if (nodeDef.props) await applyProps(node, nodeDef.props);
    if (nodeDef.children && Array.isArray(nodeDef.children)) {
      for (const child of nodeDef.children) {
        await buildNode(child, node);
      }
    }
    return node;
  }
  async function applyProps(node, props) {
    for (const [path, value] of Object.entries(props)) {
      const segments = path.split(".");
      await applyPath(node, segments, value);
    }
  }
  async function applyPath(target, segments, value) {
    if (!segments.length) return;
    const [current, ...rest] = segments;
    if (rest.length === 0) {
      await applyProperty(target, current, value);
      return;
    }
    if ("findOne" in target) {
      const child = target.findOne(
        (n) => n.name.toLowerCase() === current.toLowerCase()
      );
      if (child) {
        await applyPath(child, rest, value);
      } else {
        warn(`Missing child "${current}" under ${target.name}`);
      }
    }
  }
  async function applyProperty(node, prop, value) {
    switch (prop) {
      case "fills.color": {
        const { r, g, b, a } = hexToRgb01(value);
        if ("fills" in node && Array.isArray(node.fills)) {
          try {
            node.fills = [{ type: "SOLID", color: { r, g, b }, opacity: a }];
            dbg(`\u{1F3A8} Applied color ${value} to ${node.name}`);
          } catch (e) {
            warn(`\u274C Failed to apply color ${value} on ${node.name}: ${e}`);
          }
        } else {
          warn(`\u26A0\uFE0F Node ${node.name} has no fills property.`);
        }
        break;
      }
      case "characters": {
        try {
          await safeLoadFont(node.fontName);
          node.characters = value;
          dbg(`\u{1F4DD} Updated text in ${node.name}: ${value}`);
        } catch (e) {
          warn(`\u26A0\uFE0F Could not update text in ${node.name}: ${e}`);
        }
        break;
      }
      case "visible": {
        node.visible = Boolean(value);
        dbg(`\u{1F441}\uFE0F Visibility set to ${value} for ${node.name}`);
        break;
      }
      default:
        dbg(`\u2754 Unhandled property: ${prop} = ${value} on ${node.name}`);
    }
  }
  async function updateInstance(instance, nodeSpec) {
    var _a;
    if (!instance || !nodeSpec) return;
    dbg(`Updating instance: ${instance.name}`);
    if (nodeSpec.name && instance.name !== nodeSpec.name) {
      instance.name = nodeSpec.name;
      dbg(`Renamed instance to ${instance.name}`);
    }
    if (nodeSpec.children && nodeSpec.children.length > 0) {
      for (const childSpec of nodeSpec.children) {
        const match = findNode(instance, childSpec.target);
        if (!match) continue;
        if (((_a = childSpec.props) == null ? void 0 : _a.name) && match.name !== childSpec.props.name) {
          match.name = childSpec.props.name;
          dbg(`Renamed child: ${match.name}`);
        }
        if (childSpec.props) {
          await applyProps(match, childSpec.props);
          if (childSpec.props["ColorBox.fills.color"]) {
            const color = childSpec.props["ColorBox.fills.color"];
            const colorBox = match.findOne((n) => n.name === "ColorBox");
            if (colorBox && "fills" in colorBox) {
              const { r, g, b, a } = hexToRgb01(color);
              try {
                colorBox.fills = [{ type: "SOLID", color: { r, g, b }, opacity: a }];
                dbg(`\u{1F3A8} Forced color override for ColorBox in ${match.name}: ${color}`);
              } catch (err2) {
                warn(`\u274C Could not recolor ColorBox in ${match.name}: ${err2}`);
              }
            } else {
              warn(`\u26A0\uFE0F No ColorBox found under ${match.name}`);
            }
          }
        }
      }
    }
    dbg(`Finished updating instance: ${instance.name}`);
  }
  async function retiePageToVariables() {
    var _a;
    if (!figma.variables) {
      log("Variables API unavailable");
      return;
    }
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    let vars = await figma.variables.getLocalVariablesAsync();
    if (!Array.isArray(vars)) vars = [];
    if (!collections.length || !vars.length) {
      ok("No variables found on this page.");
      return;
    }
    const round255 = (x) => Math.round((x != null ? x : 1) * 255);
    const keyRGBA = (r, g, b, a) => `${round255(r)},${round255(g)},${round255(b)},${round255(a != null ? a : 1)}`;
    const getVal = (v, modeId) => {
      try {
        if (typeof v.getValueForMode === "function") return v.getValueForMode(modeId);
        if (typeof v.getValueForModeId === "function") return v.getValueForModeId(modeId);
      } catch (_) {
      }
      if (v.valuesByMode && typeof v.valuesByMode === "object") {
        const val = Object.values(v.valuesByMode)[0];
        if (val !== void 0) return val;
      }
      return void 0;
    };
    const sameColor = (a, b) => Math.abs(a - b) < 2e-3;
    const colorIdx = /* @__PURE__ */ new Map();
    for (const v of vars) {
      const coll = collections.find((c) => c.id === v.variableCollectionId);
      if (!coll) continue;
      for (const m of coll.modes) {
        const val = getVal(v, m.modeId);
        if (val && typeof val === "object" && "r" in val) {
          const { r, g, b, a } = val;
          colorIdx.set(keyRGBA(r, g, b, a), { id: v.id, name: v.name });
        }
      }
    }
    log(`Indexed ${colorIdx.size} color variables.`);
    const nodes = figma.currentPage.findAll();
    let bound = 0;
    const boundNames = [];
    function bindPaintColor(node, prop, varId) {
      const paints = node[prop];
      if (!(paints == null ? void 0 : paints.length) || paints[0].type !== "SOLID") return false;
      const newPaint = Object.assign({}, paints[0]);
      newPaint.boundVariables = { color: { type: "VARIABLE_ALIAS", id: varId } };
      node[prop] = [newPaint];
      return true;
    }
    const solidRGBA = (p) => ({
      r: p.color.r,
      g: p.color.g,
      b: p.color.b,
      a: typeof p.opacity === "number" ? p.opacity : 1
    });
    for (const node of nodes) {
      if ("fills" in node && Array.isArray(node.fills) && ((_a = node.fills[0]) == null ? void 0 : _a.type) === "SOLID") {
        const { r, g, b, a } = solidRGBA(node.fills[0]);
        let match = colorIdx.get(keyRGBA(r, g, b, a));
        if (!match) {
          for (const [k, v] of colorIdx.entries()) {
            const [R, G, B] = k.split(",").map((n) => Number(n) / 255);
            if (sameColor(R, r) && sameColor(G, g) && sameColor(B, b)) {
              match = v;
              break;
            }
          }
        }
        if (match && bindPaintColor(node, "fills", match.id)) {
          bound++;
          boundNames.push(match.name);
        }
      }
    }
    ok(`\u{1F504} Re-tied ${bound} node${bound === 1 ? "" : "s"} to variables${bound > 0 ? ":" : ""} ${boundNames.join(", ")}`);
  }
})();
