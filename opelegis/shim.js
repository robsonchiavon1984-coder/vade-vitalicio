/* =========================================================================
   OpeLegis no iPad — substitui as APIs do Chrome usadas pelo Vade Mecum.

   chrome.storage.local  → IndexedDB (banco "opelegis", tabela "kv")
   chrome.storage.session→ memória
   chrome.runtime        → respostas locais (mescla de backup, leitura em voz)
   chrome.tabs.create    → nova aba do Safari

   Além disso, registra o que foi CRIADO, EDITADO ou APAGADO no iPad
   ("ipad:autoria" e "og:removidos"), para a sincronização pelo Google Drive
   mandar ao computador só o que nasceu aqui.
   ========================================================================= */
(function () {
  "use strict";
  if (window.chrome && window.chrome.storage && window.chrome.storage.local && !window.__OG_SHIM) return;
  window.__OG_SHIM = true;

  var DB_NAME = "opelegis", STORE = "kv";
  var dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function rq(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function done(t) { return new Promise(function (res, rej) { t.oncomplete = function () { res(); }; t.onerror = t.onabort = function () { rej(t.error || new Error("falha ao gravar no iPad")); }; }); }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  var listeners = [];
  function emit(changes, area) {
    if (!Object.keys(changes).length) return;
    listeners.slice().forEach(function (fn) { try { fn(changes, area); } catch (e) { console.error(e); } });
  }

  /* -------- primeira abertura: sem semear o acervo padrão (as leis vêm
     do pacote do computador, com o texto) -------- */
  var ready = db().then(async function (d) {
    var st = d.transaction(STORE, "readonly").objectStore(STORE);
    var s = await rq(st.get("lc:vm:settings"));
    if (!s) {
      var t = d.transaction(STORE, "readwrite");
      t.objectStore(STORE).put({ seeded: true, seededAt: Date.now(), ipad: true }, "lc:vm:settings");
      await done(t);
    }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  });

  async function kget(keys) {
    await ready;
    var d = await db();
    var st = d.transaction(STORE, "readonly").objectStore(STORE);
    var out = {};
    if (keys == null) {
      var ks = await rq(st.getAllKeys()), vs = await rq(d.transaction(STORE, "readonly").objectStore(STORE).getAll());
      ks.forEach(function (k, i) { out[k] = vs[i]; });
      return out;
    }
    var defs = null;
    if (typeof keys === "string") keys = [keys];
    else if (!Array.isArray(keys)) { defs = keys; keys = Object.keys(keys); }
    var vals = await Promise.all(keys.map(function (k) { return rq(st.get(k)); }));
    keys.forEach(function (k, i) {
      if (vals[i] !== undefined) out[k] = vals[i];
      else if (defs && defs[k] !== undefined) out[k] = defs[k];
    });
    return out;
  }
  async function kkeys() { await ready; var d = await db(); return rq(d.transaction(STORE, "readonly").objectStore(STORE).getAllKeys()); }

  /* grava; "interno" = mescla vinda do computador/Drive (não conta como autoria) */
  async function kset(obj, interno) {
    await ready;
    var d = await db();
    var keys = Object.keys(obj || {});
    if (!keys.length) return;
    var st = d.transaction(STORE, "readonly").objectStore(STORE);
    var olds = await Promise.all(keys.map(function (k) { return rq(st.get(k)); }));
    var t2 = d.transaction(STORE, "readwrite"), st2 = t2.objectStore(STORE);
    var changes = {};
    keys.forEach(function (k, i) {
      var v = clone(obj[k]);
      st2.put(v, k);
      changes[k] = { oldValue: olds[i], newValue: v };
    });
    await done(t2);
    if (!interno) await registrarAutoria(changes);
    emit(changes, "local");
  }
  async function kdel(keys) {
    await ready;
    if (typeof keys === "string") keys = [keys];
    var d = await db();
    var t = d.transaction(STORE, "readwrite"), st = t.objectStore(STORE);
    var changes = {};
    keys.forEach(function (k) { st.delete(k); changes[k] = { oldValue: undefined, newValue: undefined }; });
    await done(t);
    emit(changes, "local");
  }
  async function kclear() { var d = await db(); var t = d.transaction(STORE, "readwrite"); t.objectStore(STORE).clear(); await done(t); }

  /* ------------------ autoria e exclusões feitas no iPad ------------------ */
  async function registrarAutoria(changes) {
    var agora = Date.now(), aut = null, rem = null;
    for (var k in changes) {
      if (k.indexOf("lc:page:") !== 0) continue;
      var velho = {}, novo = {};
      ((changes[k].oldValue || {}).annotations || []).forEach(function (a) { velho[a.id] = a; });
      ((changes[k].newValue || {}).annotations || []).forEach(function (a) { novo[a.id] = a; });
      for (var id in novo) {
        var a = novo[id], o = velho[id];
        var mexida = !o || (a.updatedAt || 0) !== (o.updatedAt || 0);
        /* anotações que só "vieram junto" de outra chave da mesma lei têm data antiga */
        if (mexida && (a.updatedAt || a.createdAt || 0) > agora - 10 * 60000) {
          if (!aut) { aut = (await kget("ipad:autoria"))["ipad:autoria"] || {}; }
          aut[id] = { k: k, at: agora };
          if (rem && rem[id]) delete rem[id];
        }
      }
      if (!changes[k].newValue) continue;
      for (var id2 in velho) {
        if (novo[id2]) continue;
        if (!rem) { rem = (await kget("og:removidos"))["og:removidos"] || {}; }
        if (!aut) { aut = (await kget("ipad:autoria"))["ipad:autoria"] || {}; }
        rem[id2] = { k: k, at: agora };
        delete aut[id2];
      }
    }
    var o2 = {};
    if (aut) o2["ipad:autoria"] = aut;
    if (rem) o2["og:removidos"] = rem;
    if (Object.keys(o2).length) await kset(o2, true);
  }

  /* --------------- mescla de backup (mesma regra da extensão) -------------- */
  function mergeArrayById(existing, incoming) {
    var byId = {}, out = [];
    (existing || []).forEach(function (x) { if (x && x.id) { byId[x.id] = x; out.push(x); } });
    (incoming || []).forEach(function (x) {
      if (!x || !x.id) return;
      var cur = byId[x.id];
      if (!cur) { byId[x.id] = x; out.push(x); }
      else if ((x.updatedAt || 0) >= (cur.updatedAt || 0)) { out[out.indexOf(cur)] = x; byId[x.id] = x; }
    });
    return out;
  }
  function mergePage(existing, incoming) {
    var byId = {};
    (existing.annotations || []).forEach(function (a) { byId[a.id] = a; });
    (incoming.remover || []).forEach(function (id) {
      var cur = byId[id];
      if (cur && cur.source && (cur.updatedAt || 0) <= (incoming.removerAte || 0)) delete byId[id];
    });
    (incoming.annotations || []).forEach(function (a) {
      var cur = byId[a.id];
      if (!cur || (a.updatedAt || 0) >= (cur.updatedAt || 0)) {
        if (cur && a.anchor && a.anchor.pending && cur.anchor && cur.anchor.exact) a = Object.assign({}, a, { anchor: cur.anchor });
        byId[a.id] = a;
      }
    });
    var out = Object.assign({}, existing, incoming, { annotations: Object.keys(byId).map(function (id) { return byId[id]; }) });
    delete out.remover; delete out.removerAte;
    return out;
  }
  /* aplica exclusões vindas do outro aparelho: só apaga se a anotação não
     foi editada depois da exclusão */
  async function aplicarRemovidos(inc) {
    if (!inc || typeof inc !== "object") return 0;
    var local = (await kget("og:removidos"))["og:removidos"] || {};
    var porChave = {};
    Object.keys(inc).forEach(function (id) {
      var r = inc[id]; if (!r || !r.k) return;
      if (!local[id] || (r.at || 0) > (local[id].at || 0)) local[id] = r;
      (porChave[r.k] = porChave[r.k] || []).push(id);
    });
    var ks = Object.keys(porChave), pages = ks.length ? await kget(ks) : {}, gravar = {}, n = 0;
    ks.forEach(function (k) {
      var p = pages[k]; if (!p || !p.annotations) return;
      var antes = p.annotations.length;
      p.annotations = p.annotations.filter(function (a) {
        var r = inc[a.id];
        return !(r && porChave[k].indexOf(a.id) !== -1 && (a.updatedAt || 0) <= (r.at || 0));
      });
      if (p.annotations.length !== antes) { gravar[k] = p; n += antes - p.annotations.length; }
    });
    gravar["og:removidos"] = podar(local);
    await kset(gravar, true);
    return n;
  }
  function podar(rem) {
    var lim = Date.now() - 400 * 86400000;
    var ids = Object.keys(rem).filter(function (id) { return (rem[id].at || 0) >= lim; });
    ids.sort(function (a, b) { return (rem[b].at || 0) - (rem[a].at || 0); });
    var out = {}; ids.slice(0, 20000).forEach(function (id) { out[id] = rem[id]; });
    return out;
  }
  async function mergeBackup(data) {
    var store = (data && (data.store || data.pages)) || null;
    if (!store || typeof store !== "object") throw new Error("Arquivo de backup inválido.");
    var keys = Object.keys(store).filter(function (k) { return k !== "og:removidos"; });
    var all = keys.length ? await kget(keys) : {};
    var toSet = {}, count = 0;
    keys.forEach(function (k) {
      var inc = store[k]; if (!inc) return;
      var ex = all[k];
      if (k === "lc:doclist" || k === "lc:laws" || k === "lc:disciplines") toSet[k] = mergeArrayById(ex, inc);
      else if (k.indexOf("lc:page:") === 0) { toSet[k] = mergePage(ex || { annotations: [] }, inc); count++; }
      else if (k.indexOf("lc:doc:") === 0) { if (!ex || (inc.updatedAt || 0) >= (ex.updatedAt || 0)) toSet[k] = inc; count++; }
      else if (k === "lc:vm:settings") toSet[k] = Object.assign({}, inc, ex || {});
      else if (k === "og:srs") {
        var s = Object.assign({}, ex || {});
        Object.keys(inc || {}).forEach(function (id) { var a = inc[id], b = s[id]; if (!b || (a.last || 0) >= (b.last || 0)) s[id] = a; });
        toSet[k] = s;
      }
    });
    if (Object.keys(toSet).length) await kset(toSet, true);
    if (store["og:removidos"]) await aplicarRemovidos(store["og:removidos"]);
    return count;
  }

  /* ----------------------- leitura da lei em voz ------------------------ */
  var falando = false;
  function falar(texto) {
    var ss = window.speechSynthesis;
    if (!ss) return false;
    if (falando || ss.speaking) { ss.cancel(); falando = false; return "parou"; }
    var vozes = ss.getVoices().filter(function (v) { return /^pt(-|_)?BR/i.test(v.lang); });
    var partes = [], buf = "";
    String(texto).replace(/([.;:!?])\s+/g, "$1\n").split(/\n+/).forEach(function (f) {
      if ((buf + " " + f).length > 220 && buf) { partes.push(buf); buf = f; } else buf = buf ? buf + " " + f : f;
    });
    if (buf) partes.push(buf);
    falando = true;
    var vel = 1;
    try { vel = parseFloat(localStorage.getItem("ipad:vozVel")) || 1; } catch (e) {}
    partes.forEach(function (p, i) {
      var u = new SpeechSynthesisUtterance(p);
      u.lang = "pt-BR"; u.rate = vel;
      if (vozes[0]) u.voice = vozes[0];
      if (i === partes.length - 1) u.onend = function () { falando = false; };
      ss.speak(u);
    });
    return true;
  }

  /* ---------------------------- mensagens ------------------------------- */
  var handlers = {};
  function sendMessage(msg, cb) {
    var p;
    var t = msg && msg.type;
    if (handlers[t]) p = Promise.resolve().then(function () { return handlers[t](msg); });
    else if (t === "MERGE_BACKUP") p = mergeBackup(msg.data).then(function (n) { return { ok: true, pages: n }; }, function (e) { return { ok: false, error: String(e.message || e) }; });
    else if (t === "OG_FETCH_URL") p = Promise.resolve({ ok: false, error: "o texto desta lei não veio no pacote do iPad. No computador, abra a lei no Vade Mecum (ou use ⋯ → Baixar todas as leis para uso offline) e gere o pacote de novo." });
    else if (t === "OG_LEITOR_TEXT" || t === "OG_LEITOR_NOTA") {
      var r = falar(msg.texto || "");
      p = Promise.resolve({ ok: !!r });
      if (window.__VM && window.__VM.toast) setTimeout(function () { window.__VM.toast(r === "parou" ? "Leitura interrompida." : r ? "Lendo em voz alta… (toque 🔊 de novo para parar)" : "Este aparelho não tem leitura em voz."); }, 300);
    }
    else p = Promise.resolve({ ok: true });
    p.then(function (r) { if (typeof cb === "function") try { cb(r); } catch (e) { console.error(e); } });
    return p;
  }

  var sessao = {};
  function areaSessao() {
    return {
      get: function (k, cb) {
        var out = {};
        (typeof k === "string" ? [k] : Array.isArray(k) ? k : Object.keys(sessao)).forEach(function (x) { if (x in sessao) out[x] = sessao[x]; });
        var p = Promise.resolve(out); if (cb) p.then(cb); return p;
      },
      set: function (o, cb) {
        var ch = {}; Object.keys(o).forEach(function (k) { ch[k] = { oldValue: sessao[k], newValue: o[k] }; sessao[k] = o[k]; });
        emit(ch, "session"); var p = Promise.resolve(); if (cb) p.then(cb); return p;
      },
      remove: function (k, cb) { (typeof k === "string" ? [k] : k).forEach(function (x) { delete sessao[x]; }); var p = Promise.resolve(); if (cb) p.then(cb); return p; }
    };
  }
  function cbify(p, cb) {
    if (typeof cb === "function") p.then(cb, function (e) { console.error(e); window.__ogErro = e; try { cb(undefined); } catch (x) {} });
    return p;
  }

  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: {
      get: function (k, cb) { return cbify(kget(k), cb); },
      set: function (o, cb) { return cbify(kset(o, false), cb); },
      remove: function (k, cb) { return cbify(kdel(k), cb); },
      getKeys: function () { return kkeys(); },
      clear: function (cb) { return cbify(kclear(), cb); }
    },
    session: areaSessao(),
    onChanged: { addListener: function (fn) { listeners.push(fn); }, removeListener: function (fn) { listeners = listeners.filter(function (x) { return x !== fn; }); } }
  };
  window.chrome.runtime = {
    id: "ipad",
    lastError: undefined,
    sendMessage: sendMessage,
    getURL: function (p) { return p; },
    onMessage: { addListener: function () {} }
  };
  window.chrome.tabs = { create: function (o) { try { window.open(o.url, "_blank", "noopener"); } catch (e) {} } };

  /* usado pelo ipad.js */
  window.OGStore = {
    get: kget, set: kset, del: kdel, keys: kkeys, clear: kclear,
    mergeBackup: mergeBackup, mergePage: mergePage, mergeArrayById: mergeArrayById,
    aplicarRemovidos: aplicarRemovidos, on: function (t, fn) { handlers[t] = fn; }, ready: ready
  };
})();
