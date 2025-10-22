// ---------------------------------------------------------------------------
// Logging Utilities
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Debug-enabled Main Implement (Universal Plugin with Collapsible Debug)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Debug and Logging (UI + Console Unified)
// ---------------------------------------------------------------------------

const uiLog = (text: string) => {
    try {
        figma.ui.postMessage({ type: "log", text });
    } catch (_) {
        console.log("UI log fallback:", text);
    }
};
const log = (...a: any[]) => {
    console.log("[YY-Retie]", ...a);
    try { figma.ui.postMessage({ type: "log", text: a.map(String).join(" ") }); }
    catch (_) {}
};
const dbg = (...args) => {
    const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    console.log("🐞 [DEBUG]", msg);
    uiLog(msg);
};
const warn = (...args) => {
    const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    console.warn("⚠️ [WARN]", msg);
    uiLog(`⚠️ ${msg}`);
};
const ok = (...args) => {
    const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    figma.notify(`✅ ${msg}`);
    console.log("✅ [OK]", msg);
    uiLog(`✅ ${msg}`);
};


let defaultParent: BaseNode | null = null;

// ---------------------------------------------------------------------------
// Insert Path Helper
// ---------------------------------------------------------------------------
async function insertPath(pathString: string): Promise<FrameNode | null> {
    const segments = pathString.split("/").map(s => s.trim()).filter(Boolean);
    let parent: FrameNode | PageNode = figma.currentPage;

    for (const segment of segments) {
        let existing = parent.findOne(n => n.name === segment && "children" in n) as FrameNode | null;
        if (!existing) {
            const frame = figma.createFrame();
            frame.name = segment;
            parent.appendChild(frame);
            dbg(`📦 Created new frame in path: ${segment}`);
            parent = frame;
        } else {
            parent = existing;
            dbg(`↪ Found existing path segment: ${segment}`);
        }
    }

    return parent as FrameNode;
}

// ---------------------------------------------------------------------------
// Helper: Hex → RGB(A)
// ---------------------------------------------------------------------------
function hexToRgb01(hex: string) {
    let c = hex.replace('#', '').trim();
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c.substring(0, 6), 16);
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    let a = 1;
    if (c.length === 8) a = parseInt(c.substring(6, 8), 16) / 255;
    return { r, g, b, a };
}

// ---------------------------------------------------------------------------
// Helper: Safe Font Loader
// ---------------------------------------------------------------------------
async function safeLoadFont(font: FontName | null) {
    try {
        if (!font) font = { family: 'Inter', style: 'Regular' };
        await figma.loadFontAsync(font);
        dbg('Loaded font', font);
        return font;
    } catch (e) {
        warn(`Primary font load failed: ${e}. Falling back to Inter Regular.`);
        const fallback = { family: 'Inter', style: 'Regular' };
        try {
            await figma.loadFontAsync(fallback);
            dbg('Loaded fallback font');
            return fallback;
        } catch (fallbackError) {
            err(`Fallback font load failed: ${fallbackError}`);
            return null;
        }
    }
}

// ---------------------------------------------------------------------------
// Universal Helper: Apply Hex to Any Node or Children
// ---------------------------------------------------------------------------
function applyHexColorUniversal(node: SceneNode, hex: string) {
    try {
        if (!hex) return;
        const { r, g, b, a } = hexToRgb01(hex);
        dbg(`Applying ${hex} to node:`, node.name);

        if ('fills' in node && node.type !== 'TEXT') {
            (node as GeometryMixin).fills = [{ type: 'SOLID', color: { r, g, b }, opacity: a }];
        }

        if ('children' in node) {
            for (const child of node.children) {
                if (child.name.toLowerCase().includes('colorbox') || /[0-9]{2,3}/.test(child.name)) {
                    applyHexColorUniversal(child, hex);
                }
            }
        }
    } catch (error) {
        err(`Failed to apply hex ${hex} on ${node.name}: ${String(error)}`);
    }
}
function hexToRgb01(hex: string) {
    const clean = hex.replace(/^#/, "");
    const num = parseInt(clean, 16);
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    return { r, g, b, a: 1 };
}

// ---------------------------------------------------------------------------
// Universal JSON Handler (with Debug Logs)
// ---------------------------------------------------------------------------
async function handleUniversalJSON(spec: any) {
    try {
        if (spec?.meta?.insertPath) {
            const targetParent = await insertPath(spec.meta.insertPath);
            if (targetParent) {
                dbg(`✅ Insert path resolved: ${spec.meta.insertPath}`);
                // Set this as the default parent for new nodes
                defaultParent = targetParent;
            }
        }
        if (spec?.variables?.collections) {
            try {
                const collections = await figma.variables.getLocalVariableCollectionsAsync();
                const vars = await figma.variables.getLocalVariablesAsync();

                for (const collSpec of spec.variables.collections) {
                    // find or create collection
                    let coll = collections.find(c => c.name === collSpec.name);
                    if (!coll) {
                        coll = figma.variables.createVariableCollection(collSpec.name);
                        log(`🆕 Created collection: ${collSpec.name}`);
                    }

                    // ensure modes
                    const existingModeNames = new Set(coll.modes.map(m => m.name));
                    for (const modeSpec of collSpec.modes || [{ name: "Value" }]) {
                        if (!existingModeNames.has(modeSpec.name)) {
                            coll.addMode(modeSpec.name);
                            log(`➕ Added mode: ${modeSpec.name}`);
                        }
                    }

                    // create or update variables
                    for (const vSpec of collSpec.variables || []) {
                        let v = vars.find(x => x.name === vSpec.name && x.variableCollectionId === coll.id);
                        if (!v) {
                            v = figma.variables.createVariable(vSpec.name, coll.id, vSpec.type);
                            log(`🎨 Created variable: ${vSpec.name}`);
                        }

                        for (const [modeKey, val] of Object.entries(vSpec.valuesByMode || {})) {
                            const mode = coll.modes.find(m => m.name === modeKey || m.modeId === modeKey);
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

                ok("✅ Variable collections applied successfully.");
            } catch (e) {
                warn(`⚠️ Failed to apply variables: ${e}`);
            }
        }
        if (!spec?.nodes || spec.nodes.length === 0) {
            warn("⚠️ No nodes found in JSON.");
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

        ok("✅ JSON applied successfully.");
    } catch (e) {
        warn(`❌ Failed to apply JSON: ${e}`);
    }
}


// ---------------------------------------------------------------------------
// UI + Message Routing (Collapsible Debug)
// ---------------------------------------------------------------------------

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
  </script>
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


    // ---------------------------------------------------------------------------
    // VARIABLE COLLECTION HANDLER (with integrated mode detection)
    // ---------------------------------------------------------------------------

    function detectModeId(spec: any): string {
        try {
            const collections = spec.variables?.collections || [];
            for (const col of collections) {
                const modes = col.modes || [];
                if (Array.isArray(modes) && modes.length) {
                    const modeCandidate = modes[0].id || modes[0];
                    if (typeof modeCandidate === 'string' && modeCandidate.includes(':')) {
                        return modeCandidate;
                    }
                }
            }
            for (const col of collections) {
                for (const variable of col.variables || []) {
                    const keys = Object.keys(variable.valuesByMode || {});
                    if (keys.length) return keys[0];
                }
            }
            if (spec.meta?.modeId) return spec.meta.modeId;
        } catch (_) {}

        const knownFallbacks = ['33:0', '386:0', '502:0', '530:0'];
        for (const id of knownFallbacks) {
            const exists = figma.variables.getLocalVariableCollections().some(c =>
                c.modes.some(m => m.modeId === id)
            );
            if (exists) return id;
        }

        try {
            const defaultCollection = figma.variables.getLocalVariableCollections()[0];
            if (defaultCollection?.modes?.length) {
                return defaultCollection.modes[0].modeId;
            }
        } catch (_) {}

        return '33:0';
    }

    async function registerVariableCollection(collection: any, spec: any) {
        const modeId = detectModeId(spec);
        const colName = collection.name || 'Unnamed Collection';
        const variables = collection.variables || [];
        log(`🧭 Using mode ID: ${modeId} for collection: ${colName}`);

        for (const variable of variables) {
            const name = variable.name;
            const type = variable.type || 'STRING';
            const value = variable.valuesByMode?.[modeId];
            if (!name) continue;

            try {
                let v = figma.variables.getLocalVariableById(variable.id);
                if (!v) v = figma.variables.createVariable(name, modeId, type);
                v.valuesByMode = { [modeId]: value };
            } catch (e) {
                warn(`Skipped variable "${name}": ${e}`);
            }
        }
        log(`🎨 Registered variable collection: ${colName}`);
    }


    // ---------------------------------------------------------------------------
    // NODE CREATION + UNIVERSAL UPDATE SYSTEM (Unified but Distinct for Instances)
    // ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Node Finder and Creator Helpers
// ---------------------------------------------------------------------------
function findNode(root: BaseNode & ChildrenMixin, target: string): SceneNode | null {
    if (!root || !target) return null;
    const lowerTarget = target.toLowerCase();
    const node = root.findOne(
        n => n.name.toLowerCase() === lowerTarget || n.name.toLowerCase().includes(lowerTarget)
    ) as SceneNode | null;
    if (node) dbg(`Found node for target '${target}':`, node.name);
    else warn(`Could not find node for target: ${target}`);
    return node;
}

function createNode(type: string): BaseNode {
    switch (type) {
        case 'FRAME':
            return figma.createFrame();
        case 'COMPONENT':
            return figma.createComponent();
        case 'INSTANCE': {
            const master = figma.currentPage.findOne(
                n => n.name === 'palette' && n.type === 'COMPONENT'
            );
            if (!master) throw new Error('Missing master component "palette".');
            return (master as ComponentNode).createInstance();
        }
        case 'RECTANGLE':
            return figma.createRectangle();
        case 'TEXT':
            return figma.createText();
        default:
            throw new Error(`Unsupported node type: ${type}`);
    }
}
// ---------------------------------------------------------------------------
// Find or Create Instance (Universal-Safe)
// ---------------------------------------------------------------------------
async function findOrCreateInstance(spec: any) {
    if (!spec || !spec.name) {
        warn("❌ Invalid instance spec — missing name");
        return null;
    }

    let instance = figma.currentPage.findOne(
        n => n.name === spec.name && n.type === "INSTANCE"
    ) as InstanceNode | null;

    if (!instance) {
        const master = figma.currentPage.findOne(
            n => n.name === spec.masterComponent && n.type === "COMPONENT"
        ) as ComponentNode | null;

        if (!master) {
            warn(`⚠️ Master component not found: ${spec.masterComponent}`);
            return null;
        }

        instance = master.createInstance();
        instance.name = spec.name;
        figma.currentPage.appendChild(instance);
        dbg(`✅ Created instance from ${master.name} → ${instance.name}`);
    } else {
        dbg(`↪ Found existing instance: ${instance.name}`);
    }

    return instance;
}
    // ---------------------------------------------------------------------------
    // Build Node (Structure creation only)
    // ---------------------------------------------------------------------------
    async function buildNode(nodeDef: any, parent?: BaseNode) {
        const parentNode = parent || defaultParent || figma.currentPage;
        const type = nodeDef.type;
        const name = nodeDef.name || 'Unnamed Node';
        let node = figma.currentPage.findOne(n => n.name === name && n.type === type);

        (parentNode as ChildrenMixin).appendChild(node);

        if (!node) {
            node = createNode(type);
            node.name = name;
            (parent || figma.currentPage).appendChild(node);
            dbg(`Created new ${type}: ${name}`);
        }

        // Apply geometry and layout only
        if (nodeDef.size) node.resizeWithoutConstraints(nodeDef.size.w, nodeDef.size.h);
        if (nodeDef.absPos) {
            node.x = nodeDef.absPos.x;
            node.y = nodeDef.absPos.y;
        }
        if (nodeDef.autoLayout && 'layoutMode' in node) {
            const layout = nodeDef.autoLayout;
            node.layoutMode = layout.mode || 'NONE';
            if ('itemSpacing' in node && layout.gap != null) node.itemSpacing = layout.gap;
        }

        // Apply property definitions using the universal property walker
        if (nodeDef.props) await applyProps(node, nodeDef.props);

        // Recursively build child nodes
        if (nodeDef.children && Array.isArray(nodeDef.children)) {
            for (const child of nodeDef.children) {
                await buildNode(child, node);
            }
        }

        return node;
    }

    // ---------------------------------------------------------------------------
    // Property Walker — Generic Property Application (applies to all node types)
    // ---------------------------------------------------------------------------
    async function applyProps(node: SceneNode, props: Record<string, any>) {
        for (const [path, value] of Object.entries(props)) {
            const segments = path.split(".");
            await applyPath(node, segments, value);
        }
    }

    async function applyPath(target: SceneNode, segments: string[], value: any) {
        if (!segments.length) return;
        const [current, ...rest] = segments;

        if (rest.length === 0) {
            await applyProperty(target, current, value);
            return;
        }

        if ("findOne" in target) {
            const child = target.findOne(
                n => n.name.toLowerCase() === current.toLowerCase()
            ) as SceneNode | null;
            if (child) {
                await applyPath(child, rest, value);
            } else {
                warn(`Missing child "${current}" under ${target.name}`);
            }
        }
    }


    // ---------------------------------------------------------------------------
    // + Application Logic
    // ---------------------------------------------------------------------------
    // ---------------------------------------------------------------------------
    // Property Application Logic (Final Working Version)
    // ---------------------------------------------------------------------------
    async function applyProperty(node: SceneNode, prop: string, value: any) {
        switch (prop) {
            case 'fills.color': {
                const { r, g, b, a } = hexToRgb01(value);
                if ('fills' in node && Array.isArray(node.fills)) {
                    try {
                        node.fills = [{ type: 'SOLID', color: { r, g, b }, opacity: a }];
                        dbg(`🎨 Applied color ${value} to ${node.name}`);
                    } catch (e) {
                        warn(`❌ Failed to apply color ${value} on ${node.name}: ${e}`);
                    }
                } else {
                    warn(`⚠️ Node ${node.name} has no fills property.`);
                }
                break;
            }


            case 'characters': {
                try {
                    await safeLoadFont(node.fontName);
                    node.characters = value;
                    dbg(`📝 Updated text in ${node.name}: ${value}`);
                } catch (e) {
                    warn(`⚠️ Could not update text in ${node.name}: ${e}`);
                }
                break;
            }

            case 'visible': {
                node.visible = Boolean(value);
                dbg(`👁️ Visibility set to ${value} for ${node.name}`);
                break;
            }

            default:
                dbg(`❔ Unhandled property: ${prop} = ${value} on ${node.name}`);
        }
    }


// ---------------------------------------------------------------------------
    // Instance Updater — Specialized for Figma Component Instances
    // ---------------------------------------------------------------------------
    async function updateInstance(instance: InstanceNode, nodeSpec) {
        if (!instance || !nodeSpec) return;
        dbg(`Updating instance: ${instance.name}`);

        // Rename instance if needed
        if (nodeSpec.name && instance.name !== nodeSpec.name) {
            instance.name = nodeSpec.name;
            dbg(`Renamed instance to ${instance.name}`);
        }

        // Update children through overrides
        if (nodeSpec.children && nodeSpec.children.length > 0) {
            for (const childSpec of nodeSpec.children) {
                const match = findNode(instance, childSpec.target);
                if (!match) continue;

                if (childSpec.props?.name && match.name !== childSpec.props.name) {
                    match.name = childSpec.props.name;
                    dbg(`Renamed child: ${match.name}`);
                }

                if (childSpec.props) {
                    // Try applying props directly
                    await applyProps(match, childSpec.props);

                    // Fallback for nested ColorBox inside instances
                    if (childSpec.props['ColorBox.fills.color']) {
                        const color = childSpec.props['ColorBox.fills.color'];
                        const colorBox = match.findOne(n => n.name === 'ColorBox') as RectangleNode | null;
                        if (colorBox && 'fills' in colorBox) {
                            const { r, g, b, a } = hexToRgb01(color);
                            try {
                                colorBox.fills = [{ type: 'SOLID', color: { r, g, b }, opacity: a }];
                                dbg(`🎨 Forced color override for ColorBox in ${match.name}: ${color}`);
                            } catch (err) {
                                warn(`❌ Could not recolor ColorBox in ${match.name}: ${err}`);
                            }
                        } else {
                            warn(`⚠️ No ColorBox found under ${match.name}`);
                        }
                    }
                }

            }
        }

        dbg(`Finished updating instance: ${instance.name}`);
    }


// ---------------------------------------------------------------------------
// RETIE PAGE TO VARIABLES
// ---------------------------------------------------------------------------

// -------------------------------- Re-tie page to Variables --------------------------------
async function retiePageToVariables() {
    if (!figma.variables) { log("Variables API unavailable"); return; }

    // --- gather variables ---
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    let vars = await figma.variables.getLocalVariablesAsync();
    if (!Array.isArray(vars)) vars = [];

    if (!collections.length || !vars.length) {
        ok("No variables found on this page.");
        return;
    }

    // --- helper functions ---
    const round255 = (x: number) => Math.round((x ?? 1) * 255);
    const keyRGBA = (r:number,g:number,b:number,a:number) => `${round255(r)},${round255(g)},${round255(b)},${round255(a ?? 1)}`;

    const getVal = (v: any, modeId: string) => {
        try {
            if (typeof v.getValueForMode === "function") return v.getValueForMode(modeId);
            if (typeof v.getValueForModeId === "function") return v.getValueForModeId(modeId);
        } catch (_) {}
        if (v.valuesByMode && typeof v.valuesByMode === "object") {
            const val = Object.values(v.valuesByMode)[0];
            if (val !== undefined) return val;
        }
        return undefined;
    };

    const sameColor = (a:number,b:number) => Math.abs(a - b) < 0.002; // small tolerance

    // --- index colors ---
    const colorIdx = new Map<string, { id:string; name:string }>();
    for (const v of vars) {
        const coll = collections.find(c => c.id === v.variableCollectionId);
        if (!coll) continue;
        for (const m of coll.modes) {
            const val = getVal(v, m.modeId);
            if (val && typeof val === "object" && "r" in val) {
                const {r,g,b,a} = val as {r:number;g:number;b:number;a:number};
                colorIdx.set(keyRGBA(r,g,b,a), {id:v.id, name:v.name});
            }
        }
    }

    log(`Indexed ${colorIdx.size} color variables.`);

    // --- walk page nodes ---
    const nodes = figma.currentPage.findAll();
    let bound = 0;
    const boundNames: string[] = [];

    function bindPaintColor(node: any, prop: "fills" | "strokes", varId: string) {
        const paints = node[prop] as ReadonlyArray<Paint>;
        if (!paints?.length || paints[0].type !== "SOLID") return false;
        const newPaint = Object.assign({}, paints[0]);
        (newPaint as any).boundVariables = { color: { type: "VARIABLE_ALIAS", id: varId } };
        node[prop] = [newPaint];
        return true;
    }

    const solidRGBA = (p: SolidPaint) => ({
        r: p.color.r,
        g: p.color.g,
        b: p.color.b,
        a: typeof p.opacity === "number" ? p.opacity : 1
    });

    for (const node of nodes) {
        if ("fills" in node && Array.isArray(node.fills) && node.fills[0]?.type === "SOLID") {
            const { r,g,b,a } = solidRGBA(node.fills[0] as SolidPaint);
            let match = colorIdx.get(keyRGBA(r,g,b,a));

            // fallback: if no exact match, allow tiny tolerance match
            if (!match) {
                for (const [k,v] of colorIdx.entries()) {
                    const [R,G,B] = k.split(",").map(n=>Number(n)/255);
                    if (sameColor(R,r) && sameColor(G,g) && sameColor(B,b)) {
                        match = v; break;
                    }
                }
            }

            if (match && bindPaintColor(node, "fills", match.id)) {
                bound++;
                boundNames.push(match.name);
            }
        }
    }

    ok(`🔄 Re-tied ${bound} node${bound===1?"":"s"} to variables${bound>0?":":""} ${boundNames.join(", ")}`);
}

