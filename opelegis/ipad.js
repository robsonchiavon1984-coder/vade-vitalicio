/* =========================================================================
   OpeLegis no iPad — importação do pacote, sincronização com o Google
   Drive, seleção de texto por toque e ajustes de menu.
   ========================================================================= */
(function () {
  "use strict";

  var APP_URL = location.origin + location.pathname.replace(/index\.html$/, "");
  var SCOPE = "https://www.googleapis.com/auth/drive.file";
  var ARQ_PC = "lei-comentada-backup.json";
  var ARQ_IPAD = "opelegis-ipad.json";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function VM() { return window.__VM || {}; }
  function toast(m) { if (VM().toast) VM().toast(m); else console.log(m); }
  function modal(t, html, bts) { if (VM().showModal) VM().showModal(t, html, bts || [{ t: "Fechar", f: fechar }]); }
  function fechar() { if (VM().closeModal) VM().closeModal(); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function fmtMB(b) { return (b / 1048576).toFixed(1) + " MB"; }
  function quando(ts) { if (!ts) return "nunca"; var d = new Date(ts); return d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }

  /* ====================== 1. IMPORTAR O PACOTE ========================== */
  var inp = document.createElement("input");
  inp.type = "file"; inp.style.display = "none";
  document.body.appendChild(inp);

  function escolherArquivo() {
    inp.value = "";
    inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) importar(f); };
    inp.click();
  }

  async function aplicarLote(lote, acumulado) {
    var keys = Object.keys(lote);
    if (!keys.length) return;
    var mesclar = keys.filter(function (k) { return k.indexOf("lc:page:") === 0 || k === "lc:laws" || k === "lc:disciplines" || k === "lc:doclist" || k === "lc:vm:cache"; });
    var atuais = mesclar.length ? await OGStore.get(mesclar) : {};
    var out = {};
    keys.forEach(function (k) {
      var v = lote[k], ex = atuais[k];
      if (k === "og:removidos") { acumulado.removidos = Object.assign(acumulado.removidos || {}, v); return; }
      if (k.indexOf("lc:page:") === 0) { out[k] = ex ? OGStore.mergePage(ex, v) : v; acumulado.paginas++; acumulado.notas += (v.annotations || []).length; }
      else if (k === "lc:laws" || k === "lc:disciplines" || k === "lc:doclist") out[k] = OGStore.mergeArrayById(ex, v);
      else if (k === "lc:vm:cache") out[k] = Object.assign({}, ex || {}, v);
      else { out[k] = v; if (k.indexOf("lc:vm:doc:") === 0) acumulado.leis++; }
    });
    await OGStore.set(out, true);
  }

  async function importarLinhas(file, meta, prog) {
    var CH = 4 * 1048576, pos = 0, resto = "", dec = new TextDecoder("utf-8");
    var lote = {}, tam = 0, primeira = true;
    var acc = { paginas: 0, notas: 0, leis: 0, removidos: null };
    while (pos < file.size) {
      var buf = await file.slice(pos, pos + CH).arrayBuffer();
      pos += CH;
      resto += dec.decode(buf, { stream: pos < file.size });
      var linhas = resto.split("\n");
      resto = linhas.pop();
      for (var i = 0; i < linhas.length; i++) {
        var l = linhas[i];
        if (!l) continue;
        if (primeira) { primeira = false; continue; }      // cabeçalho
        var o = JSON.parse(l);
        lote[o.k] = o.v; tam += l.length;
        if (tam > 6e6) { await aplicarLote(lote, acc); lote = {}; tam = 0; }
      }
      prog(Math.min(1, pos / file.size));
    }
    if (resto.trim() && !primeira) { var o2 = JSON.parse(resto); lote[o2.k] = o2.v; }
    await aplicarLote(lote, acc);
    if (acc.removidos) await OGStore.aplicarRemovidos(acc.removidos);
    if (meta.clientId) { var c = lsGet("ipad:cfg", {}); if (!c.clientId) { c.clientId = meta.clientId; lsSet("ipad:cfg", c); } }
    await OGStore.set({ "ipad:pacote": { at: Date.now(), exportedAt: meta.exportedAt || "", leis: acc.leis, notas: acc.notas } }, true);
    return acc;
  }

  /* pacote antigo (JSON único, versão 2.7) */
  async function importarPacoteAntigo(d) {
    var acc = { paginas: 0, notas: 0, leis: 0 };
    var lote = {};
    if (d.disciplines) lote["lc:disciplines"] = d.disciplines;
    if (d.laws) lote["lc:laws"] = d.laws;
    var cache = {};
    Object.keys(d.docs || {}).forEach(function (nu) {
      var x = d.docs[nu];
      lote["lc:vm:doc:" + nu] = Object.assign({ url: nu, source: nu, text: "" }, x);
      cache[nu] = x.fetchedAt || Date.now();
    });
    lote["lc:vm:cache"] = cache;
    await aplicarLote(lote, acc);
    var st = d.store || d.pages || {}, ks = Object.keys(st), b = {};
    for (var i = 0; i < ks.length; i++) { b[ks[i]] = st[ks[i]]; if (i % 60 === 59) { await aplicarLote(b, acc); b = {}; } }
    await aplicarLote(b, acc);
    return acc;
  }

  async function importar(file) {
    modal("Importando", '<div class="hint">Lendo <b>' + esc(file.name) + "</b> (" + fmtMB(file.size) + ")…</div>" +
      '<div class="ip-barra"><i id="ipBar"></i></div><div id="ipMsg" class="hint"></div>', []);
    var bar = function (f) { var b = $("#ipBar"); if (b) b.style.width = Math.round(f * 100) + "%"; };
    try {
      var cab = await file.slice(0, 4096).text();
      var meta = null;
      try { meta = JSON.parse(cab.split("\n")[0]); } catch (e) {}
      var acc;
      if (meta && meta.formato === "opelegis-linhas") acc = await importarLinhas(file, meta, bar);
      else {
        if (file.size > 150 * 1048576) throw new Error("arquivo grande demais para o formato antigo. Gere o pacote de novo na versão 2.8 da extensão.");
        var d = JSON.parse(await file.text());
        bar(0.5);
        if (d.target === "ipad" && d.docs) acc = await importarPacoteAntigo(d);
        else { var n = await OGStore.mergeBackup(d); acc = { paginas: n, notas: 0, leis: 0 }; }
      }
      bar(1);
      $("#ipMsg").innerHTML = '<span class="ok">Pronto ✔</span> ' + (acc.leis ? acc.leis + " lei(s) com texto, " : "") +
        acc.paginas + " página(s) de anotações. Reabrindo…";
      setTimeout(function () { location.reload(); }, 1200);
    } catch (e) {
      var m = $("#ipMsg");
      if (m) m.innerHTML = '<span class="err">Falhou: ' + esc(e.message || e) + "</span>";
      modal("Importação", '<div class="hint err">Não consegui importar: ' + esc(e.message || e) + "</div>");
    }
  }

  /* ================== 2. O QUE FOI FEITO NO IPAD ======================= */
  async function montarDoIpad() {
    var aut = (await OGStore.get("ipad:autoria"))["ipad:autoria"] || {};
    var rem = (await OGStore.get("og:removidos"))["og:removidos"] || {};
    var porChave = {};
    Object.keys(aut).forEach(function (id) { var k = aut[id].k; (porChave[k] = porChave[k] || []).push(id); });
    var ks = Object.keys(porChave), pages = ks.length ? await OGStore.get(ks) : {}, store = {}, n = 0;
    ks.forEach(function (k) {
      var p = pages[k]; if (!p) return;
      var anns = (p.annotations || []).filter(function (a) { return porChave[k].indexOf(a.id) !== -1; });
      if (!anns.length) return;
      n += anns.length;
      store[k] = { url: p.url, title: p.title, annotations: anns };
    });
    if (Object.keys(rem).length) store["og:removidos"] = rem;
    return { backup: { app: "lei-comentada", version: 2, modo: "ipad", exportedAt: new Date().toISOString(), store: store }, notas: n, removidas: Object.keys(rem).length };
  }

  async function exportarDoIpad() {
    var r = await montarDoIpad();
    if (!r.notas && !r.removidas) { toast("Nenhuma anotação feita no iPad ainda."); return; }
    var nome = "opelegis-ipad-anotacoes-" + new Date().toISOString().slice(0, 10) + ".json";
    var url = URL.createObjectURL(new Blob([JSON.stringify(r.backup)], { type: "application/json" }));
    var a = document.createElement("a"); a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    toast(r.notas + " anotação(ões) do iPad exportada(s). No computador: Vade Mecum → ⋯ → Importar dados.");
  }

  /* ======================= 3. GOOGLE DRIVE ============================== */
  function cfg() { return lsGet("ipad:cfg", {}); }
  function token() { var t = lsGet("ipad:tok", null); return t && t.exp > Date.now() + 60000 ? t.t : null; }

  function entrar(estado, silencioso) {
    var c = cfg();
    if (!c.clientId) { configurarDrive(); return; }
    lsSet("ipad:volta", { estado: estado || "", at: Date.now() });
    location.href = "https://accounts.google.com/o/oauth2/v2/auth?client_id=" + encodeURIComponent(c.clientId) +
      "&response_type=token&redirect_uri=" + encodeURIComponent(APP_URL) +
      "&scope=" + encodeURIComponent(SCOPE) + "&include_granted_scopes=true" +
      (silencioso ? "&prompt=none" : "") + "&state=" + encodeURIComponent(estado || "ok");
  }

  /* volta do Google: #access_token=...&state=... */
  var voltaDoGoogle = null;
  (function lerRetorno() {
    var h = location.hash || "";
    if (!/access_token=|error=/.test(h)) return;
    var p = {};
    h.replace(/^#/, "").split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    history.replaceState(null, "", APP_URL);
    if (p.access_token) {
      lsSet("ipad:tok", { t: p.access_token, exp: Date.now() + (parseInt(p.expires_in, 10) || 3600) * 1000 });
      voltaDoGoogle = { ok: true, estado: p.state || "" };
    } else voltaDoGoogle = { ok: false, erro: p.error || "erro" };
  })();

  async function gfetch(url, op) {
    var t = token();
    if (!t) { var e0 = new Error("login"); e0.login = true; throw e0; }
    op = op || {};
    op.headers = Object.assign({ Authorization: "Bearer " + t }, op.headers || {});
    var r = await fetch(url, op);
    if (r.status === 401) { localStorage.removeItem("ipad:tok"); var e = new Error("login"); e.login = true; throw e; }
    if (!r.ok) throw new Error("Google Drive respondeu " + r.status);
    return r;
  }
  async function acharArquivo(nome) {
    var q = encodeURIComponent("name='" + nome + "' and trashed=false");
    var r = await gfetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&spaces=drive&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime,size)&pageSize=5");
    var j = await r.json();
    return (j.files && j.files[0]) || null;
  }
  async function baixarArquivo(id) { return (await gfetch("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media")).text(); }
  async function enviarArquivo(nome, conteudo, id) {
    if (id) {
      return (await gfetch("https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media&fields=id,modifiedTime",
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: conteudo })).json();
    }
    var b = "ogipad" + Date.now();
    var meta = { name: nome, mimeType: "application/json", description: "Anotações feitas no iPad (OpeLegis)" };
    var corpo = "--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
      "\r\n--" + b + "\r\nContent-Type: application/json\r\n\r\n" + conteudo + "\r\n--" + b + "--";
    return (await gfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime",
      { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body: corpo })).json();
  }

  var sincronizando = false;
  async function sincronizar(silencioso) {
    if (sincronizando) return;
    if (!cfg().clientId) { if (!silencioso) configurarDrive(); return; }
    if (!token()) { if (!silencioso) entrar("sync", false); return; }
    sincronizando = true;
    if (!silencioso) toast("Sincronizando com o Google Drive…");
    try {
      var recebidas = 0;
      var pc = await acharArquivo(ARQ_PC);
      if (pc) {
        var ult = lsGet("ipad:sync", {});
        if (pc.modifiedTime !== ult.pcMod) {
          var dados = JSON.parse(await baixarArquivo(pc.id));
          recebidas = await OGStore.mergeBackup(dados);
        }
      }
      var meu = await montarDoIpad();
      var existente = await acharArquivo(ARQ_IPAD);
      var env = await enviarArquivo(ARQ_IPAD, JSON.stringify(meu.backup), existente ? existente.id : null);
      lsSet("ipad:sync", { at: Date.now(), pcMod: pc ? pc.modifiedTime : "", pcAchado: !!pc, enviadas: meu.notas, recebidas: recebidas, ipadMod: env.modifiedTime || "" });
      if (recebidas && VM().loadAll) { await VM().loadAll(); if (VM().renderShelf && !VM().lendo()) VM().renderShelf(); }
      if (!silencioso || recebidas) {
        toast("Drive ✔ " + (pc ? (recebidas ? recebidas + " página(s) atualizada(s) do computador" : "nada novo do computador") : "backup do computador ainda não existe no Drive") +
          " · " + meu.notas + " nota(s) do iPad enviada(s)" + (recebidas && VM().lendo() ? " · reabra a lei para ver" : ""));
      }
    } catch (e) {
      if (e.login) { if (!silencioso) entrar("sync", false); }
      else if (!silencioso) modal("Google Drive", '<div class="hint err">' + esc(e.message || e) + "</div>" +
        (/403|400/.test(String(e.message)) ? '<div class="hint">Confira, no Google Cloud, se o endereço deste app está autorizado (⋯ → Google Drive: configurar).</div>' : ""));
    } finally { sincronizando = false; }
  }

  var autoTm = null;
  OGStore.on("DATA_DIRTY", function () {
    clearTimeout(autoTm);
    autoTm = setTimeout(function () { if (token()) sincronizar(true); }, 15000);
    return { ok: true };
  });

  function configurarDrive() {
    var c = cfg(), s = lsGet("ipad:sync", {});
    var origem = location.origin, redir = APP_URL;
    modal("Google Drive",
      '<div class="hint">A sincronização usa o mesmo projeto do Google que a extensão já usa no computador (Opções → Google Drive). ' +
      "O iPad lê o backup do computador (<i>" + ARQ_PC + "</i>) e grava as notas feitas aqui em <i>" + ARQ_IPAD + "</i>; a extensão junta esse arquivo ao seu acervo.</div>" +
      '<label class="hint" style="display:block;margin-top:8px">ID do cliente OAuth (vem no pacote; se vier vazio, copie das Opções da extensão)</label>' +
      '<input id="ipCid" type="text" autocomplete="off" value="' + esc(c.clientId || "") + '">' +
      '<div class="hint" style="margin-top:10px">Uma vez só, no <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud → Credenciais</a>, abra esse mesmo ID do cliente e acrescente:<br>' +
      "• Origens JavaScript autorizadas: <code>" + esc(origem) + "</code><br>" +
      "• URIs de redirecionamento autorizados: <code>" + esc(redir) + "</code></div>" +
      '<div class="hint" style="margin-top:10px">Última sincronização: ' + quando(s.at) + (s.at ? " · " + (s.enviadas || 0) + " nota(s) do iPad no Drive" : "") +
      (token() ? " · conectado" : "") + "</div>",
      [
        { t: "Desconectar", f: function () { localStorage.removeItem("ipad:tok"); toast("Desconectado do Google."); fechar(); } },
        { t: "Salvar e sincronizar", primary: true, f: function () {
            var v = ($("#ipCid").value || "").trim();
            var c2 = cfg(); c2.clientId = v; lsSet("ipad:cfg", c2);
            fechar();
            if (v) sincronizar(false); else toast("Informe o ID do cliente.");
          } }
      ]);
  }

  /* ========================= 4. SOBRE / ESPAÇO =========================== */
  async function sobre() {
    var est = null, pers = null;
    try { est = await navigator.storage.estimate(); } catch (e) {}
    try { pers = await navigator.storage.persisted(); } catch (e) {}
    var pac = (await OGStore.get("ipad:pacote"))["ipad:pacote"];
    var ks = await OGStore.keys();
    var leis = ks.filter(function (k) { return k.indexOf("lc:vm:doc:") === 0; }).length;
    var pags = ks.filter(function (k) { return k.indexOf("lc:page:") === 0; }).length;
    var aut = Object.keys((await OGStore.get("ipad:autoria"))["ipad:autoria"] || {}).length;
    var inst = window.navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    modal("OpeLegis no iPad",
      '<div class="hint">' + leis + " lei(s) com texto guardado · " + pags + " página(s) com anotações · " + aut + " anotação(ões) feitas no iPad<br>" +
      "Pacote importado: " + (pac ? quando(pac.at) + (pac.exportedAt ? " (gerado em " + quando(Date.parse(pac.exportedAt)) + ")" : "") : "nenhum") + "<br>" +
      (est ? "Espaço usado: " + fmtMB(est.usage || 0) + "<br>" : "") +
      (inst ? '<span class="ok">Instalado na Tela de Início ✔</span>' : '<span class="warn">Aberto como aba do Safari: instale (Compartilhar → Adicionar à Tela de Início) para o iPad não apagar os dados.</span>') +
      (pers === false && inst ? "<br>Armazenamento persistente ainda não concedido." : "") + "</div>",
      [
        { t: "Apagar tudo do iPad", danger: true, f: function () {
            modal("Apagar tudo?", '<div class="hint">Remove as leis, as anotações e os ajustes guardados neste iPad. Anotações feitas aqui e ainda não sincronizadas ou exportadas se perdem.</div>',
              [{ t: "Cancelar", f: fechar }, { t: "Apagar", danger: true, f: async function () { await OGStore.clear(); localStorage.clear(); location.reload(); } }]);
          } },
        { t: "Fechar", primary: true, f: fechar }
      ]);
  }

  function boasVindas() {
    modal("Bem-vindo ao OpeLegis no iPad",
      '<div class="hint">Para começar, traga o pacote do computador:<br><br>' +
      "1. No Chrome do computador, abra o Vade Mecum → ⋯ → <b>⬇️ Baixar todas as leis para uso offline</b> (uma vez).<br>" +
      "2. Depois, ⋯ → <b>📱 Exportar para o iPad</b>. Sai um arquivo <i>vademecum-ipad-….json</i>.<br>" +
      "3. Mande o arquivo para o iPad (Google Drive, iCloud Drive ou AirDrop) e toque em <b>Importar pacote</b> abaixo.<br><br>" +
      "Dica: instale este app na Tela de Início (Compartilhar → Adicionar à Tela de Início). Assim ele abre em tela cheia, funciona sem internet e o iPad não apaga os dados.</div>",
      [{ t: "Depois", f: fechar }, { t: "Importar pacote", primary: true, f: function () { fechar(); escolherArquivo(); } }]);
  }

  /* ========================== 5. MENU ⋯ =============================== */
  var FORA = ["Exportar dados", "Importar dados", "Exportar para o iPad", "atalho de teclado", "Restaurar acervo padrão",
    "Limpar cache", "Verificar os links", "painel de anotações na aba", "quadro (kanban)", "Baixar todas as leis"];
  window.IPAD = {
    menu: function (items) {
      var s = lsGet("ipad:sync", {});
      var meus = [
        { t: "📥 Importar pacote do computador", f: escolherArquivo },
        { t: "☁️ Sincronizar com o Google Drive" + (s.at ? " (última: " + quando(s.at) + ")" : ""), f: function () { sincronizar(false); } },
        { t: "⚙️ Google Drive: configurar", f: configurarDrive },
        { t: "📤 Exportar anotações feitas no iPad (.json)", f: exportarDoIpad },
        { t: "ℹ️ Sobre e espaço usado", f: sobre },
        { hr: true }
      ];
      var resto = items.filter(function (it) { return it.hr || !FORA.some(function (f) { return (it.t || "").indexOf(f) !== -1; }); });
      while (resto.length && resto[resto.length - 1].hr) resto.pop();
      for (var i = resto.length - 1; i > 0; i--) if (resto[i].hr && resto[i - 1].hr) resto.splice(i, 1);
      return meus.concat(resto);
    }
  };

  /* =================== 6. SELEÇÃO DE TEXTO POR TOQUE ==================== */
  /* No iPad, selecionar com o dedo não gera "mouseup": espera a seleção
     parar de mudar (dedo fora da tela) e chama o mesmo tratador do PC. */
  var tocando = false, selTm = null;
  document.addEventListener("touchstart", function () { tocando = true; }, { passive: true });
  document.addEventListener("touchend", function () { tocando = false; agendarSel(); }, { passive: true });
  document.addEventListener("touchcancel", function () { tocando = false; }, { passive: true });
  document.addEventListener("selectionchange", agendarSel);
  function agendarSel() {
    clearTimeout(selTm);
    selTm = setTimeout(function () {
      if (tocando) return;
      var box = $("#lawtext"), sel = window.getSelection();
      if (!box || !sel || sel.isCollapsed || !sel.rangeCount) return;
      if (!box.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      if (String(sel).trim().length < 2) return;
      if (typeof box.onmouseup === "function") box.onmouseup();
    }, 750);
  }

  /* Safari não dispara "beforeunload" ao fechar o app */
  window.addEventListener("pagehide", function () { try { window.dispatchEvent(new Event("beforeunload")); } catch (e) {} });

  /* ============================ 7. INÍCIO =============================== */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  window.addEventListener("load", function () {
    setTimeout(async function () {
      if (voltaDoGoogle) {
        if (!voltaDoGoogle.ok) {
          modal("Google Drive", '<div class="hint err">O Google recusou a conexão (' + esc(voltaDoGoogle.erro) + ").</div>" +
            '<div class="hint">Se aparecer "redirect_uri_mismatch", falta autorizar o endereço deste app no Google Cloud (⋯ → Google Drive: configurar).</div>');
        } else sincronizar(false);
        return;
      }
      var leis = (await OGStore.get("lc:laws"))["lc:laws"] || [];
      if (!leis.length) { boasVindas(); return; }
      var s = lsGet("ipad:sync", {});
      if (token() && Date.now() - (s.at || 0) > 10 * 60000) sincronizar(true);
    }, 700);
  });
})();
