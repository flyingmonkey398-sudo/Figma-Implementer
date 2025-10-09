// main-implement.js

const uiLog = (text: string) => { try { figma.ui.postMessage({ type: "log", text }); } catch (_) { /* ignored */ } };
const log = (...a) => { console.log("[YY-MakeChanges]", ...a); uiLog(a.map(String).join(" ")); };
const ok = (m) => { figma.notify(`✅ ${m}`); uiLog(`✅ ${m}`); };
const err = (m) => { figma.notify(`⚠️ ${m}`); uiLog(`⚠️ ${m}`); };


// ------------- Show UI -------------

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
  </script></body></html>`,
    { width: 460, height: 300 }
);

// -------------------- Communications --------------------
figma.ui.onmessage = async (msg) => {
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
        await applyVariables(jsonfile.variables);
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

            async function applyVariables(variables: any = { collectionsCount: 0, collections: [] }) {
                try {
                    const list = Array.isArray(variables?.collections) ? variables.collections : [];
                    if (list.length === 0 || !figma.variables) { log("No variable collections to apply or API unavailable"); return; }

                    const existing = await figma.variables.getLocalVariableCollectionsAsync();
                    const byName = new Map(existing.map(c => [c.name, c]));
                    for (const c of list) {
                        const name = (c?.name ?? "").trim(); if (!name) { log("Skip unnamed collection"); continue; }
                        if (byName.has(name)) { log(`Collection exists: "${name}"`); continue; }
                        const created = figma.variables.createVariableCollection(name); // ← correct method
                        log(`Created collection: "${name}" (${created.id})`);
                        // (keep alpha scope: not creating variables/modes yet)
                    }
                } catch (e) { err("applyVariables: " + String(e)); }
            }

        // -------------------- Nodes --------------------
        async function applyNodes(nodes: any) {
            if (!nodes) return log("No changes found");
            const arr = Array.isArray(nodes) ? nodes : [nodes];

            for (const n of arr) {
                const t = n?.type || n?.kind; // tolerate either field
                switch (t) {
                    case "frame-snapshot":
                    case undefined: // allow minimal entries that just have id/size/absPos
                        // inline frame handler (replaces applyFrameSnapshot)
                    {
                        const id = n?.id; if (!id) { log("frame-snapshot missing id"); break; }
                        const node = figma.getNodeById(id); if (!node) { log(`Node ${id} not found`); break; }
                        if (node.type !== "FRAME") { log(`Node ${id} not a FRAME — skip`); break; }

                        try {
                            const f = node as FrameNode;
                            const p = n.absPos, s = n.size;
                            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { f.x = p.x; f.y = p.y; log(`pos → ${p.x},${p.y}`); }
                            if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) { f.resize(s.w, s.h); log(`size → ${s.w}×${s.h}`); }
                            ok(`Frame updated: ${f.name}`);
                        } catch (e) { err("frame update: " + String(e)); }
                    }
                        break;

                    // ready for later, still inline if you want minimal footprint:
                    case "text-style":
                        // TODO: apply text props directly here (font, size, lineHeight, fills, etc.)
                        log(`(todo) text-style change for ${n.id || n.name || "node"}`);
                        break;

                    case "prototype-link":
                        // TODO: set prototype interactions here (requires building Interaction/Navigation objects)
                        log(`(todo) prototype-link change for ${n.id || n.name || "node"}`);
                        break;

                    default:
                        log(`Unknown node type: ${t}`);
                }
    }
}

// ready
log("YY Make Changes ready");
figma.notify("YY Make Changes plugin ready");
