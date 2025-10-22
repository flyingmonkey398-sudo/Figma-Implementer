// main-implement.js

const uiLog = (text: string) => { try { figma.ui.postMessage({ type: "log", text }); } catch (_) { /* ignored */ } };
const log = (...a) => { console.log("[YY-MakeChanges]", ...a); uiLog(a.map(String).join(" ")); };
const ok = (m) => { figma.notify(`✅ ${m}`); uiLog(`✅ ${m}`); };
const err = (m) => { figma.notify(`⚠️ ${m}`); uiLog(`⚠️ ${m}`); };
const warn = msg => console.warn(`⚠️ ${msg}`);

// ------------- Show UI -------------

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
    </script>
  </body></html>`,
    { width: 500, height: 360 }
);

// -------------------- Communications --------------------
figma.ui.onmessage = async (msg) => {
    if (msg?.type === "retie") {
        await retiePageToVariables();
        return;
    }
    if (msg?.type !== "apply-json") return;

    try {
        const raw = msg.text;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        const jsonfile = parseLoadedFile(parsed);

        applyMeta(jsonfile.meta);
        await applyVariables(jsonfile.variables);
        await applyNodes(jsonfile.nodes);

        ok("Changes applied");
    } catch (e) {
        err("apply-json failed: " + String((e as any)?.message ?? e));
    }
};


// -------------------- Pipeline --------------------

    async function applyJSONFile(jsonfile: { schema:any; meta:any; variables:any; nodes:any; }) {
        applyMeta(jsonfile.meta);
        await applyVariables(jsonfile.variables, jsonfile.meta?.renameCollections); // ← pass map
        await applyNodes(jsonfile.nodes);
    }


// -------------------- Parsing / Normalization --------------------

    function parseLoadedFile(obj: any) {
        if (!obj || typeof obj !== "object") throw new Error("JSON must be an object");
        return {
            schema: obj["$schema"] || null,
            meta: obj.meta || {},
            variables: obj.variables || { collectionsCount: 0, collections: [] },
            nodes: obj.nodes || null
        };
    }

        // -------------------- Meta --------------------

        function applyMeta(meta: any = {}) {
            try {
                // store what we can at document scope
                if (meta.fileName) figma.root.setPluginData("yy_desiredFileName", String(meta.fileName)); // cannot actually rename file
                if (meta.scanId)   figma.root.setPluginData("yy_scanId",       String(meta.scanId));
                if (meta.pageName) figma.root.setPluginData("yy_pageName",     String(meta.pageName));
                if (meta.author)   figma.root.setPluginData("yy_author",       String(meta.author));
                if (meta.version)  figma.root.setPluginData("yy_version",      String(meta.version));

                // optional shared plugin data (namespaced) for team-wide visibility
                try {
                    const NS = "yy";
                    Object.entries(meta).forEach(([k,v]) => { if (v != null) figma.root.setSharedPluginData(NS, k, String(v)); });
                } catch {}

                const desired = figma.root.getPluginData("yy_desiredFileName");
                if (desired) ok(`Please rename this file to: ${desired} (plugins can’t rename files)`);
                log("Meta saved: " + JSON.stringify({ fileName: meta.fileName, scanId: meta.scanId, pageName: meta.pageName, author: meta.author, version: meta.version }));
            } catch (e) { err("applyMeta: " + String(e)); }
        }

        // -------------------- Variables (collections only, correct API) --------------------
        // Note: variable APIs differ between plugin runtime versions. We feature-detect and keep things safe.

        async function applyVariables(variables: any = { collections: [] }) {
            try {
                if (!figma.variables) { log("Variable API unavailable"); return; }
                const cols = Array.isArray(variables?.collections) ? variables.collections : [];
                if (!cols.length) { log("No variable collections to apply"); return; }

                const TYPE: Record<string, VariableResolvedDataType> = {
                    COLOR: "COLOR", FLOAT: "FLOAT", STRING: "STRING", BOOLEAN: "BOOLEAN", NUMBER: "FLOAT"
                };

                const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
                const collectionByName = new Map(localCollections.map(c => [c.name, c]));

                for (const c of cols) {
                    const name = String(c?.name || "").trim();
                    if (!name) { log("Skip unnamed collection"); continue; }

                    // 1) ensure collection
                    let collection = collectionByName.get(name);
                    // Handle renames first
                    if (!collection) {
                        collection = figma.variables.createVariableCollection(name);
                        collectionByName.set(name, collection);
                        log(`Created collection: "${name}" (${collection.id})`);
                    } else {
                        log(`Collection exists: "${name}"`);
                    }

                    // 2) ensure modes (on the collection)
                    const wantModes = (Array.isArray(c?.modes) ? c.modes : []).map((m:any)=>String(m?.name||"").trim()).filter(Boolean);
                    if (wantModes.length) {
                        // if collection has a single default mode, rename it to the first desired mode
                        if (collection.modes.length === 1 && collection.modes[0].name !== wantModes[0]) {
                            collection.renameMode(collection.modes[0].modeId, wantModes[0]);
                            log(`  • renamed default mode → ${wantModes[0]}`);
                        }
                        // add any missing modes
                        for (const m of wantModes) {
                            if (!collection.modes.find(x => x.name === m)) {
                                collection.addMode(m);
                                log(`  • added mode: ${m}`);
                            }
                        }
                    } else if (!collection.modes.length) {
                        collection.addMode("Base");
                    }

                    // refresh mode map
                    const modeIdByName = new Map(collection.modes.map(m => [m.name, m.modeId]));

                    // 3) variables
                    const wantVars = Array.isArray(c?.variables) ? c.variables : [];
                    if (!wantVars.length) { log(`  (no variables in "${name}")`); continue; }

                    const localVars = (await figma.variables.getLocalVariablesAsync())
                        .filter(v => v.variableCollectionId === collection.id);
                    const varByName = new Map(localVars.map(v => [v.name, v]));

                    for (const v of wantVars) {
                        const vName = String(v?.name || "").trim(); if (!vName) { log("  - skip unnamed variable"); continue; }
                        const vType = TYPE[String(v?.type || "").toUpperCase()] ?? "STRING";
                        const valuesByMode = (v?.valuesByMode && typeof v.valuesByMode === "object") ? v.valuesByMode : {};

                        // create or recreate if type mismatch
                        let variable = varByName.get(vName);
                        if (!variable) {
                            variable = figma.variables.createVariable(vName, collection.id, vType);
                            varByName.set(vName, variable);
                            log(`  + var: ${vName} (${vType})`);
                        } else if (variable.resolvedType !== vType) {
                            log(`  ! type mismatch for ${vName} (have ${variable.resolvedType}, want ${vType}) — recreating`);
                            variable.remove();
                            variable = figma.variables.createVariable(vName, collection.id, vType);
                            varByName.set(vName, variable);
                        } else {
                            log(`  = var: ${vName}`);
                        }

                        // set values per mode
                        for (const [modeName, raw] of Object.entries(valuesByMode)) {
                            const modeId = modeIdByName.get(modeName);
                            if (!modeId) { log(`    • mode "${modeName}" not found in "${name}"`); continue; }

                            try {
                                let val: any = raw;
                                if (vType === "COLOR") {
                                    const { r, g, b, a } = hexToRgb01(String(raw).trim());
                                    val = { r, g, b, a }; // RGBA in 0–1 (what Variables expect)
                                } else if (vType === "FLOAT") {
                                    val = Number(raw);
                                } else if (vType === "BOOLEAN") {
                                    val = Boolean(raw);
                                } else {
                                    val = String(raw);
                                }
                                variable.setValueForMode(modeId, val);
                                log(`    • set ${vName} @ ${modeName}`);
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

        // helper
        function hexToRgb01(hex: string){ const h=hex.replace("#","").trim();
            let r=0,g=0,b=0,a=1; if(h.length===3){r=parseInt(h[0]+h[0],16);g=parseInt(h[1]+h[1],16);b=parseInt(h[2]+h[2],16);}
            else if(h.length===6){r=parseInt(h.slice(0,2),16);g=parseInt(h.slice(2,4),16);b=parseInt(h.slice(4,6),16);}
            else if(h.length===8){r=parseInt(h.slice(0,2),16);g=parseInt(h.slice(2,4),16);b=parseInt(h.slice(4,6),16);a=parseInt(h.slice(6,8),16)/255;}
            return { r:r/255,g:g/255,b:b/255,a };
        }



        // -------------------- Nodes --------------------
        async function applyNodes(nodes: any) {
            let updatedCount = 0;
            if (!nodes) return log("No changes found");

            const arr = Array.isArray(nodes) ? nodes : [nodes];
            const nodeMap = new Map<string, SceneNode>();
            const componentMap = new Map<string, ComponentNode>();

            async function createNode(spec: any, parent?: BaseNode & ChildrenMixin): Promise<BaseNode | null> {
                const t = (spec?.type || spec?.kind || "").toUpperCase();
                // --- SAFETY: never edit component masters directly ---
                if (spec.id) {
                    const node = figma.getNodeById(spec.id);
                    if (node && node.type === "COMPONENT" && !node.mainComponent) {
                        log(`⛔ Skipping component master: ${node.name}`);
                        return null;
                    }
                    }

                let node: SceneNode | null = null;

                try {
                    switch (t) {

                        // ──────────────────────────── FRAME UPDATE ────────────────────────────
                        case "FRAME":
                        case "FRAME-SNAPSHOT": {
                            const id = spec?.id;
                            if (!id) { log("frame-snapshot missing id"); break; }

                            const existing = figma.getNodeById(id);
                            if (existing.type !== "FRAME" && existing.type !== "INSTANCE") {
                                log(`Node ${id} not a FRAME or INSTANCE — skipped`);
                                break;
                            }

                            const f = existing as FrameNode;
                            const p = spec.absPos, s = spec.size;

                            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
                                f.x = p.x; f.y = p.y;
                                log(`pos → ${p.x},${p.y}`);
                            }
                            if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) {
                                f.resize(s.w, s.h);
                                log(`size → ${s.w}×${s.h}`);
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
                            const name = String(spec?.name || "").trim();
                            if (!name) { log("Instance-update missing name"); break; }

                            // Find the instance node by name
                            const inst = figma.currentPage.findOne(
                                n => n.name === name && (n.type === "INSTANCE" || n.type === "FRAME")
                            ) as InstanceNode | FrameNode | null;

                            if (!inst) { warn(`Instance "${name}" not found`); break; }

                            // --- Skip master components to avoid overwriting them ---
                            if (inst.type === "COMPONENT") {
                                log(`⏭️ Skipping master component: ${name}`);
                                break;
                            }

                            // --- Update the color rectangle fill ---
                            let colorRect: RectangleNode | null = null;
                            try {
                                colorRect = inst.findOne(n => n.name === "ColorBox") as RectangleNode | null;
                                if (colorRect) {
                                    // Apply solid color if Hex provided
                                    if (spec.Hex) {
                                        const { r, g, b, a } = hexToRgb01(spec.Hex);
                                        colorRect.fills = [{ type: "SOLID", color: { r, g, b }, opacity: a }];
                                        log(`🎨 Updated fill color for ${name}`);
                                    }

                                    // --- Bind Variable if specified ---
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
                                                log(`✅ Bound ${name} to variable: ${variable.name}`);
                                            } else {
                                                warn(`⚠️ Variable not found: ${spec.variableAlias}`);
                                            }
                                        } catch (e) {
                                            err(`Failed to bind variable for ${name}: ${String(e)}`);
                                        }
                                    }
                                }
                            } catch (e) {
                                err(`Failed to recolor ${name}: ${String(e)}`);
                            }

                            // --- Update text layers (Label + Hex) ---
                            try {
                                const label = inst.findOne(n => n.name === "Label") as TextNode | null;
                                if (label && spec.Label) {
                                    await figma.loadFontAsync(label.fontName as FontName);
                                    label.characters = spec.Label;
                                }

                                const hexText = inst.findOne(n => n.name === "Hex") as TextNode | null;
                                if (hexText && spec.Hex) {
                                    await figma.loadFontAsync(hexText.fontName as FontName);
                                    hexText.characters = spec.Hex;
                                }

                                log(`📝 Updated text for ${name}`);
                            } catch (e) {
                                warn(`⚠️ Text update failed in ${name}: ${String(e)}`);
                            }

                            updatedCount++;
                            break;
                        } // ✅ properly closes INSTANCE-UPDATE



                        // ──────────────────────────── INSTANCE CREATION ────────────────────────────
                        case "INSTANCE": {
                            try {
                                const componentId = String(spec?.componentId || "").trim();
                                if (!componentId) { log("Instance missing componentId"); break; }

                                // Find the component in the document
                                const comp = figma.getNodeById(componentId) as ComponentNode | null;
                                if (!comp) { log(`Component not found for id: ${componentId}`); break; }

                                // Create the instance
                                const inst = comp.createInstance();
                                if (spec.name) inst.name = spec.name;

                                // Optional positioning
                                if (spec.absPos) { inst.x = spec.absPos.x || 0; inst.y = spec.absPos.y || 0; }
                                if (spec.size) inst.resize(spec.size.w || inst.width, spec.size.h || inst.height);

                                // Optional auto layout configuration
                                if (spec.autoLayout) {
                                    const f = inst as FrameNode;
                                    f.layoutMode = spec.autoLayout.direction === "VERTICAL" ? "VERTICAL" : "HORIZONTAL";
                                    f.itemSpacing = spec.autoLayout.spacing ?? 8;
                                    f.paddingLeft = f.paddingRight = f.paddingTop = f.paddingBottom = spec.autoLayout.padding ?? 0;
                                }

                                // Attach to current page
                                figma.currentPage.appendChild(inst);

                                ok(`Created instance: ${inst.name}`);
                            } catch (e) {
                                err(`createInstance: ${String(e)}`);
                            }
                            break;
                        }

                        // ──────────────────────────── UNKNOWN / UNSUPPORTED ────────────────────────────
                        default:
                            err(`Unknown node type: ${t} — skipped (no fallback creation)`);
                            break;
                    }

                    // shared property updates (for newly created or updated nodes)
                    if (node && spec.name) node.name = spec.name;
                    if (node && spec.size) node.resize(spec.size.w || node.width, spec.size.h || node.height);
                    if (node && spec.absPos) { node.x = spec.absPos.x || 0; node.y = spec.absPos.y || 0; }

                    // auto layout
                    if (node && spec.autoLayout) {
                        const f = node as FrameNode | ComponentNode;
                        f.layoutMode = spec.autoLayout.direction === "VERTICAL" ? "VERTICAL" : "HORIZONTAL";
                        f.itemSpacing = spec.autoLayout.spacing ?? 8;
                        f.paddingLeft = f.paddingRight = f.paddingTop = f.paddingBottom = spec.autoLayout.padding ?? 0;
                    }

                    // solid fill (if explicitly given)
                    if (node && spec.fill) {
                        const { r, g, b, a } = hexToRgb01(spec.fill);
                        (node as GeometryMixin).fills = [{ type: "SOLID", color: { r, g, b }, opacity: a }];
                    }

                    // recurse into children
                    if (node && Array.isArray(spec.children)) {
                        for (const child of spec.children) await createNode(child, node as BaseNode & ChildrenMixin);
                    }

                    // store references
                    if (node && spec.id) nodeMap.set(spec.id, node);
                    if (node && t === "COMPONENT" && spec.id) componentMap.set(spec.id, node as ComponentNode);

                    if (node) ok(`Created or updated ${t}: ${spec.name || "(unnamed)"}`);
                    return node;

                } catch (e) {
                    err(`createNode(${spec?.name || t}): ${String(e)}`);
                    return null;
                }
            }

            // ──────────────────────────── Main Loop ────────────────────────────
            for (const spec of arr) {
                // 🔒 Skip master components even if the JSON includes their ID
                if (spec.id) {
                    const nodeById = figma.getNodeById(spec.id);
                    if (nodeById && nodeById.type === "COMPONENT" && !nodeById.mainComponent) {
                        log(`⛔ Skipping main component for id ${spec.id}`);
                        continue;
                    }

                    // ✅ Safe path for instances or frames
                    if (nodeById && (nodeById.type === "INSTANCE" || nodeById.type === "FRAME")) {
                        log(`Updating existing instance/frame by ID: ${nodeById.name}`);
                        if (Array.isArray(spec.children)) {
                            for (const c of spec.children) await createNode(c, nodeById);
                        }
                        continue;
                    }
                }

                // Fallback by name if ID not found
                const target = figma.currentPage.findOne(
                    n => n.name === spec.name && (n.type === "INSTANCE" || n.type === "FRAME")
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



// -------------------------------- Re-tie page to Variables --------------------------------
async function retiePageToVariables() {
    if (!figma.variables) { log("Variables API unavailable"); return; }

    // --- setup ---
    // 1) collections (local only)
    const collections = await figma.variables.getLocalVariableCollectionsAsync();

    // 2) variables: try local first, then per-collection fallback
    let vars: Variable[] = await figma.variables.getLocalVariablesAsync();  // single declaration
    if (!Array.isArray(vars)) vars = [];
    if (vars.length === 0) {
        // fallback: gather variables from each local collection
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

    // quick exits to avoid doing work if truly empty
    if (!collections.length || !vars.length) {
        ok("Re-tied 0 properties on this page");
        return;
    }

    // lookups (for binding)
    const varById     = new Map(vars.map(v => [v.id, v]));

    // indexes must exist here so both indexer + binder can see them
    const colorIdx = new Map<string, { id:string; name:string }>();
    const numIdx   = new Map<number, { id:string; name:string }>();
    const strIdx   = new Map<string, { id:string; name:string }>();

    // tolerant color key
    const round255 = (x: number) => Math.round((x ?? 1) * 255);
    const keyRGBA  = (r:number,g:number,b:number,a:number) =>
        `${round255(r)},${round255(g)},${round255(b)},${round255(a ?? 1)}`;

    // API compatibility: old vs new
    const getVal = (v: any, modeId: string) => {
        try {
            if (typeof v.getValueForMode === "function") return v.getValueForMode(modeId);
            if (typeof v.getValueForModeId === "function") return v.getValueForModeId(modeId);
        } catch (_) { /* ignore */ }

        // 🔧 fallback: read from valuesByMode object (some builds require this)
        if (v.valuesByMode && typeof v.valuesByMode === "object") {
            const val = v.valuesByMode[modeId];
            if (val !== undefined) return val;
        }

        return undefined;
    };

    // Index every variable for all modes in its collection
    for (const v of vars) {
        const col = collections.find(c => c.id === v.variableCollectionId);
        if (!col) continue;
        for (const m of col.modes) {
            const val = getVal(v, m.modeId);
            if (val == null) continue;
            if (v.resolvedType === "COLOR" && typeof val === "object" && "r" in val) {
                const {r,g,b,a} = val as {r:number;g:number;b:number;a:number};
                colorIdx.set(keyRGBA(r,g,b,a), {id:v.id, name:v.name});
            } else if (v.resolvedType === "FLOAT") {
                const n = Number(val);
                if (Number.isFinite(n)) numIdx.set(n, {id:v.id, name:v.name});
            } else if (v.resolvedType === "STRING") {
                strIdx.set(String(val), {id:v.id, name:v.name});
            }
        }
    }

    log(`indexed ${colorIdx.size} colors, ${numIdx.size} numbers, ${strIdx.size} strings`);

    // --- walk nodes + bind ---
    const solidRGBA = (p: SolidPaint) => {
        const a = typeof p.opacity === "number" ? p.opacity : 1;
        return {r:p.color.r, g:p.color.g, b:p.color.b, a};
    };
    const nodes = figma.currentPage.findAll();
    let bound = 0;

    function bindPaintColor(node: any, prop: "fills" | "strokes", varId: string) {
        const variable = varById.get(varId);
        if (!variable) { log(`WARN paint: missing var ${varId}`); return false; }

        const paints = node[prop] as ReadonlyArray<Paint>;
        if (!Array.isArray(paints) || paints.length === 0) return false;

        const p0 = paints[0];
        if (p0.type !== "SOLID") return false;

        // clone paint without spread
        const newPaint: SolidPaint = Object.assign({}, p0) as SolidPaint;

        // keep existing boundVariables (if any) without spread
        const existingBV: any = (p0 as any).boundVariables || {};
        const nextBV: any = Object.assign({}, existingBV, {
            // ✅ REQUIRED SHAPE
            color: { type: "VARIABLE_ALIAS", id: variable.id }
        });

        (newPaint as any).boundVariables = nextBV;

        // write back paints (replace index 0) without spread
        const next = paints.slice();
        next[0] = newPaint;

        try {
            (node as any)[prop] = next;
            return true;
        } catch (e) {
            log(`bind ${prop} color failed: ${String(e)}`);
            return false;
        }
    }

    const bind = (node:any, prop:string, varId:string) => {
        const variable = varById.get(varId);
        if (!variable) return;
        try { node.setBoundVariable(prop, variable); bound++; }
        catch(e){ log(`bind ${prop} failed: ${String(e)}`); }
    };

    for (const node of nodes) {
        // fills
        if ("fills" in node) {
            const fs = (node as GeometryMixin).fills;
            if (Array.isArray(fs) && fs.length && fs[0].type === "SOLID") {   // ← changed
                const { r,g,b,a } = solidRGBA(fs[0] as SolidPaint);
                const m = colorIdx.get(keyRGBA(r,g,b,a));
                if (m && bindPaintColor(node, "fills", m.id)) { bound++; log(`bind fills → ${m.name}`); }
            }
        }

        // strokes
        if ("strokes" in node) {
            const st = (node as GeometryMixin).strokes;
            if (Array.isArray(st) && st.length && st[0].type === "SOLID") {   // ← changed
                const { r,g,b,a } = solidRGBA(st[0] as SolidPaint);
                const m = colorIdx.get(keyRGBA(r,g,b,a));
                if (m && bindPaintColor(node, "strokes", m.id)) { bound++; log(`bind strokes → ${m.name}`); }
            }
        }

        // text
        if (node.type === "TEXT") {
            const t = node as TextNode;
            if (typeof t.fontSize === "number") {
                const m = numIdx.get(t.fontSize); if (m) { bind(t, "fontSize", m.id); log(`bind fontSize → ${m.name}`); }
            }
            const lh: any = t.lineHeight;
            if (lh && typeof lh === "object" && lh.unit === "PIXELS" && typeof lh.value === "number") {
                const m = numIdx.get(lh.value); if (m) { bind(t, "lineHeight", m.id); log(`bind lineHeight → ${m.name}`); }
            }
            const tf = t.fills as ReadonlyArray<Paint>;
            if (Array.isArray(t.fills) && t.fills.length && t.fills[0].type === "SOLID") {
                const { r,g,b,a } = solidRGBA(t.fills[0] as SolidPaint);
                const m = colorIdx.get(keyRGBA(r,g,b,a));
                if (m && bindPaintColor(t, "fills", m.id)) { bound++; log(`bind text fill → ${m.name}`); }
            }
        }
        // layout numerics
        const n:any = node;
        const numericProps = ["itemSpacing","paddingLeft","paddingRight","paddingTop","paddingBottom","cornerRadius","strokeWeight"];
        for (const prop of numericProps) {
            if (typeof n[prop] === "number") {
                const m = numIdx.get(n[prop]); if (m) { bind(node, prop, m.id); log(`bind ${prop} → ${m.name}`); }
            }
        }
    }

    ok(`Re-tied ${bound} properties on this page`);
}





// ready

log("YY Make Changes ready");
figma.notify("YY Make Changes plugin ready");
