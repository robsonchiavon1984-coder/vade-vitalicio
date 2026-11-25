/* =========================================================================
   OpeLegis — exibição das notas (OGDock)
   Preferências em chrome.storage.local["og:ui"]:
     notaModo:    "popup" (janela flutuante junto ao trecho) | "direita" | "esquerda"
     notaLargura: largura da barra lateral em px (ajustável arrastando a borda)
     empurrar:    true = a página encolhe para a barra não cobrir o texto da lei
     abaLateral:  true = mostra a aba "Lei Comentada" na borda da página
   ========================================================================= */
(function () {
  "use strict";
  if (window.OGDock) return;
  var PADRAO = { notaModo: "popup", notaLargura: 460, empurrar: true, abaLateral: false };
  var prefs = Object.assign({}, PADRAO);
  var ouvintes = [];
  var MIN = 280;

  function avisar() { ouvintes.forEach(function (f) { try { f(prefs); } catch (e) {} }); }
  function aplicar(v) { prefs = Object.assign({}, PADRAO, v || {}); avisar(); }
  try {
    chrome.storage.local.get("og:ui", function (o) { aplicar(o && o["og:ui"]); });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === "local" && ch["og:ui"]) {
        var antes = lado();
        aplicar(ch["og:ui"].newValue);
        if (atual && atual.isConnected && antes !== lado()) {          // troca de modo com a nota aberta
          var el = atual; desencaixar(el);
          if (lado()) encaixar(el, ultimoOpts); else { soltarPagina(); if (ultimoOpts && ultimoOpts.aoSoltar) ultimoOpts.aoSoltar(el); }
        }
      }
    });
  } catch (e) {}

  function lado() { return prefs.notaModo === "direita" ? "right" : prefs.notaModo === "esquerda" ? "left" : null; }
  function maxW() { return Math.max(MIN, Math.round(window.innerWidth * 0.9)); }
  function limitar(w) { return Math.max(MIN, Math.min(maxW(), Math.round(w || PADRAO.notaLargura))); }
  function salvar(mudanca) {
    var novo = Object.assign({}, prefs, mudanca);
    try { chrome.storage.local.set({ "og:ui": novo }); } catch (e) {}
    prefs = novo;
  }

  /* ---- a página "encolhe" para a barra não cobrir o texto ---- */
  var empurrada = null;   // {lado, antigo}
  function empurrarPagina(s, w) {
    if (!prefs.empurrar) { soltarPagina(); return; }
    var h = document.documentElement;
    if (!empurrada) empurrada = { right: h.style.getPropertyValue("margin-right"), left: h.style.getPropertyValue("margin-left") };
    h.style.setProperty(s === "right" ? "margin-right" : "margin-left", w + "px", "important");
    h.style.setProperty(s === "right" ? "margin-left" : "margin-right", empurrada[s === "right" ? "left" : "right"] || "");
    h.classList.add("og-dock-pushed");
  }
  function soltarPagina() {
    if (!empurrada) return;
    var h = document.documentElement;
    h.style.removeProperty("margin-right"); h.style.removeProperty("margin-left");
    if (empurrada.right) h.style.setProperty("margin-right", empurrada.right);
    if (empurrada.left) h.style.setProperty("margin-left", empurrada.left);
    h.classList.remove("og-dock-pushed");
    empurrada = null;
  }

  var atual = null, ultimoOpts = null;
  function desencaixar(el) {
    el.classList.remove("og-docked", "og-dock-right", "og-dock-left");
    el.style.width = "";
    var g = el.querySelector(":scope > .og-dock-grip"); if (g) g.remove();
    el.querySelectorAll(".og-dock-tools").forEach(function (b) { b.remove(); });
  }

  /* Encaixa o elemento (já inserido no DOM) como barra lateral.
     Devolve false quando o modo escolhido é a janela flutuante.        */
  function encaixar(el, opts) {
    var s = lado();
    if (!s || (opts && opts.minJanela && window.innerWidth < opts.minJanela)) return false;
    ultimoOpts = opts || {};
    atual = el;
    el.classList.add("og-docked", "og-dock-" + s);
    el.style.top = ""; el.style.left = ""; el.style.right = ""; el.style.bottom = "";
    var w = limitar(prefs.notaLargura);
    el.style.width = w + "px";
    empurrarPagina(s, w);

    var grip = document.createElement("div");
    grip.className = "og-dock-grip";
    grip.title = "Arraste para ampliar ou reduzir (duplo clique: largura padrão)";
    el.appendChild(grip);

    var tools = document.createElement("div");
    tools.className = "og-dock-tools";
    tools.innerHTML =
      '<button type="button" data-d="-80" title="Reduzir a barra">−</button>' +
      '<button type="button" data-d="80" title="Ampliar a barra">+</button>' +
      '<button type="button" data-lado="1" title="Passar para o outro lado">' + (s === "right" ? "⇤" : "⇥") + "</button>";
    var ondeTools = opts && opts.ferramentas ? el.querySelector(opts.ferramentas) : null;
    if (ondeTools) { tools.classList.add("og-inline"); ondeTools.insertBefore(tools, ondeTools.lastElementChild); }
    else el.appendChild(tools);
    tools.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
    tools.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (b.dataset.lado) { salvar({ notaModo: s === "right" ? "esquerda" : "direita" }); desencaixar(el); encaixar(el, ultimoOpts); return; }
        var nw = limitar(el.getBoundingClientRect().width + parseInt(b.dataset.d, 10));
        el.style.width = nw + "px"; empurrarPagina(s, nw); salvar({ notaLargura: nw });
      });
    });

    grip.addEventListener("dblclick", function (e) {
      e.preventDefault(); e.stopPropagation();
      var nw = limitar(PADRAO.notaLargura); el.style.width = nw + "px"; empurrarPagina(s, nw); salvar({ notaLargura: nw });
    });
    grip.addEventListener("mousedown", function (e) {
      e.preventDefault(); e.stopPropagation();
      grip.classList.add("on");
      document.documentElement.classList.add("og-dock-resizing");
      var mover = function (ev) {
        var nw = limitar(s === "right" ? window.innerWidth - ev.clientX : ev.clientX);
        el.style.width = nw + "px"; empurrarPagina(s, nw);
      };
      var soltar = function () {
        document.removeEventListener("mousemove", mover, true);
        document.removeEventListener("mouseup", soltar, true);
        grip.classList.remove("on");
        document.documentElement.classList.remove("og-dock-resizing");
        salvar({ notaLargura: limitar(el.getBoundingClientRect().width) });
      };
      document.addEventListener("mousemove", mover, true);
      document.addEventListener("mouseup", soltar, true);
    });
    return true;
  }

  /* Chamar depois de fechar a nota: se nenhuma outra abriu em seguida
     (troca de nota = fecha e abre no mesmo instante), devolve a página. */
  function liberar(estaAberta) {
    setTimeout(function () {
      if (estaAberta && estaAberta()) return;
      atual = null; soltarPagina();
    }, 0);
  }

  window.OGDock = {
    prefs: function () { return prefs; },
    lado: lado,
    encaixar: encaixar,
    liberar: liberar,
    salvar: salvar,
    aoMudar: function (f) { ouvintes.push(f); f(prefs); },
    soltar: function (el) { if (el) desencaixar(el); atual = null; soltarPagina(); },
    estaEncaixado: function (el) { return !!(el && el.classList && el.classList.contains("og-docked")); }
  };
})();
