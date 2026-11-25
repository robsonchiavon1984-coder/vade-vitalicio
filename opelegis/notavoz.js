/* =========================================================================
   OpeLegis — ouvir a nota (OGVoz)
   Barra de áudio para o conteúdo de uma anotação: tocar/pausar, voltar e
   avançar frase a frase, barra de posição e velocidade (guardada em
   chrome.storage.local["og:ui"].vozVel). Usa a voz em português do
   sistema (Web Speech); o botão 🎧 manda a nota para o Leitor em Voz.
   ========================================================================= */
(function () {
  "use strict";
  if (window.OGVoz) return;
  var synth = window.speechSynthesis;
  var VELS = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5];
  var vel = 1.15, voz = null;
  var atual = null;      // sessão em reprodução {frases, i, ui, tocando}

  try {
    chrome.storage.local.get("og:ui", function (o) { var v = o && o["og:ui"] && o["og:ui"].vozVel; if (v) vel = v; sincronizarVel(); });
  } catch (e) {}
  function salvarVel() {
    try {
      chrome.storage.local.get("og:ui", function (o) {
        var p = Object.assign({}, (o && o["og:ui"]) || {}); p.vozVel = vel;
        chrome.storage.local.set({ "og:ui": p });
      });
    } catch (e) {}
  }
  function escolherVoz() {
    if (!synth) return null;
    var vs = synth.getVoices().filter(function (v) { return /^pt(-|_)?BR/i.test(v.lang) || /portugu[eê]s.*brasil/i.test(v.name); });
    if (!vs.length) vs = synth.getVoices().filter(function (v) { return /^pt/i.test(v.lang); });
    var pref = vs.find(function (v) { return /natural|online|neural/i.test(v.name); }) ||
               vs.find(function (v) { return /google/i.test(v.name); }) || vs[0];
    return pref || null;
  }
  if (synth) { voz = escolherVoz(); synth.onvoiceschanged = function () { voz = escolherVoz(); }; }

  /* ---------------- texto → frases faladas ---------------- */
  var ABREV = /\b(arts?|Rel|Min|Des|Dr|Dra|Sr|Sra|inc|incs|al|n|nº|p|pp|fl|fls|ed|v|cf|ss|c\/c|Proc|Res|Rec|Info|Ag|Emb|Decl|Resp|Apel|Rcl|Esp|Extr|j|DJe|Coord|Prof|Profa)\.$/i;
  function falarAbreviacoes(t) {
    return t
      .replace(/§§/g, " parágrafos ").replace(/§/g, " parágrafo ")
      .replace(/\barts\.\s*/gi, "artigos ").replace(/\bart\.\s*/gi, "artigo ")
      .replace(/\bn[º°]\s*/gi, "número ").replace(/\bRel\.\s*/g, "Relator ").replace(/\bMin\.\s*/g, "Ministro ")
      .replace(/\bDes\.\s*/g, "Desembargador ").replace(/\binc\.\s*/gi, "inciso ").replace(/\bj\.\s*(?=\d)/g, "julgado em ")
      .replace(/\bc\/c\b/gi, "combinado com").replace(/\bCF\/88\b/g, "Constituição Federal").replace(/\bCF\b/g, "Constituição Federal")
      .replace(/(\d)º/g, "$1º").replace(/[★☆]/g, "").replace(/[📊📝📌📋⚠◉✎◆◈↪🏷️]/gu, " ")
      .replace(/\s+/g, " ").trim();
  }
  function frasesDe(el) {
    var blocos = [];
    var walk = function (n) {
      if (n.nodeType === 3) { blocos.length || blocos.push(""); blocos[blocos.length - 1] += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (/^(SCRIPT|STYLE|BUTTON|SELECT|INPUT)$/.test(n.tagName) || n.classList.contains("og-voz")) return;
      var bloco = /^(P|LI|DIV|H\d|BLOCKQUOTE|TR|DETAILS|SUMMARY|UL|OL|PRE|BR)$/.test(n.tagName);
      if (bloco) blocos.push("");
      if (n.tagName === "BR") return;
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (bloco) blocos.push("");
    };
    walk(el);
    var out = [];
    blocos.forEach(function (b) {
      b = b.replace(/\s+/g, " ").trim(); if (!b) return;
      var partes = b.replace(/([.!?;:])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ"“(\d])/g, "$1\u0001").split("\u0001");
      var acc = "";
      partes.forEach(function (p) {
        acc = acc ? acc + " " + p : p;
        if (ABREV.test(acc) || acc.length < 25) return;   // não corta em "art." / "Rel."
        out.push(acc); acc = "";
      });
      if (acc) out.push(acc);
    });
    // frases muito longas: corta em vírgulas para o sintetizador não travar
    var fin = [];
    out.forEach(function (f) {
      if (f.length <= 320) { fin.push(f); return; }
      var cur = "";
      f.replace(/,\s+/g, ",\u0001").split("\u0001").forEach(function (p) { if ((cur + " " + p).length > 300 && cur) { fin.push(cur); cur = p; } else cur = cur ? cur + " " + p : p; });
      if (cur) fin.push(cur);
    });
    return fin;
  }

  /* ---------------- reprodução ---------------- */
  function parar() {
    if (atual) { atual.tocando = false; atual.gen++; marcar(atual); }
    if (synth) synth.cancel();
  }
  function falar(s) {
    if (!synth) return;
    if (!s.ui.isConnected) { parar(); atual = null; return; }
    if (s.i >= s.frases.length) { s.tocando = false; s.i = 0; marcar(s); return; }
    var gen = ++s.gen;
    var u = new SpeechSynthesisUtterance(falarAbreviacoes(s.frases[s.i]));
    u.lang = "pt-BR"; if (voz) u.voice = voz; u.rate = vel;
    u.onend = function () { if (gen !== s.gen || !s.tocando) return; s.i++; marcar(s); falar(s); };
    u.onerror = function (e) { if (gen !== s.gen) return; if (e.error === "interrupted" || e.error === "canceled") return; s.tocando = false; marcar(s); };
    synth.cancel();
    synth.speak(u);
    marcar(s);
  }
  function marcar(s) {
    var ui = s.ui; if (!ui) return;
    ui.querySelector('[data-v="play"]').textContent = s.tocando ? "⏸" : "▶";
    ui.querySelector('[data-v="play"]').title = s.tocando ? "Pausar" : "Ouvir a nota";
    var r = ui.querySelector(".og-voz-pos"); r.max = Math.max(0, s.frases.length - 1); r.value = Math.min(s.i, s.frases.length - 1);
    ui.querySelector(".og-voz-n").textContent = s.frases.length ? (Math.min(s.i + 1, s.frases.length) + "/" + s.frases.length) : "—";
  }
  function sincronizarVel() {
    document.querySelectorAll(".og-voz-vel").forEach(function (s) { s.value = String(vel); });
  }

  /* montar(container, alvo): container recebe a barra; alvo = elemento cujo texto é lido
     (ou função que devolve o elemento, para editores que mudam de conteúdo). */
  function montar(container, alvo, opts) {
    opts = opts || {};
    var ui = document.createElement("div");
    ui.className = "og-voz";
    ui.innerHTML =
      '<button type="button" data-v="prev" title="Voltar uma frase">⏮</button>' +
      '<button type="button" data-v="play" class="og-voz-play" title="Ouvir a nota">▶</button>' +
      '<button type="button" data-v="next" title="Avançar uma frase">⏭</button>' +
      '<button type="button" data-v="stop" title="Parar e voltar ao início">⏹</button>' +
      '<input type="range" class="og-voz-pos" min="0" max="0" value="0" title="Posição na nota">' +
      '<span class="og-voz-n">—</span>' +
      '<select class="og-voz-vel" title="Velocidade">' + VELS.map(function (v) { return '<option value="' + v + '">' + String(v).replace(".", ",") + "×</option>"; }).join("") + "</select>" +
      (opts.leitor === false ? "" : '<button type="button" data-v="leitor" title="Mandar a nota para o Leitor em Voz (voz Faber, MP3)">🎧</button>');
    if (opts.antes) container.insertBefore(ui, opts.antes); else container.appendChild(ui);
    ui.querySelector(".og-voz-vel").value = String(vel);
    if (!synth) { ui.querySelectorAll("button:not([data-v=leitor]),input").forEach(function (b) { b.disabled = true; }); ui.title = "Este navegador não oferece voz sintetizada."; }

    var s = { frases: [], i: 0, ui: ui, tocando: false, gen: 0 };
    var el = function () { return typeof alvo === "function" ? alvo() : alvo; };
    var preparar = function () { var e = el(); s.frases = e ? frasesDe(e) : []; if (s.i >= s.frases.length) s.i = 0; marcar(s); };
    preparar();
    ui.addEventListener("mousedown", function (e) { if (e.target.tagName !== "SELECT" && e.target.tagName !== "INPUT") e.preventDefault(); e.stopPropagation(); });
    ui.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var v = b.dataset.v;
      if (v === "leitor") {
        var e2 = el(); var txt = e2 ? frasesDe(e2).join("\n") : "";
        try { chrome.runtime.sendMessage({ type: "OG_LEITOR_TEXT", texto: txt, titulo: opts.titulo || "Nota", origem: location.href }); } catch (er) {}
        return;
      }
      if (atual && atual !== s) parar();
      atual = s;
      if (v === "play") {
        if (s.tocando) { s.tocando = false; s.gen++; synth.cancel(); marcar(s); return; }
        preparar(); s.tocando = true; falar(s); return;
      }
      if (v === "stop") { parar(); s.i = 0; marcar(s); return; }
      if (!s.frases.length) preparar();
      s.i = Math.max(0, Math.min(s.frases.length - 1, s.i + (v === "next" ? 1 : -1)));
      if (s.tocando) falar(s); else marcar(s);
    });
    ui.querySelector(".og-voz-pos").addEventListener("input", function (e) {
      if (atual && atual !== s) parar();
      atual = s; s.i = parseInt(e.target.value, 10) || 0;
      if (s.tocando) falar(s); else marcar(s);
    });
    ui.querySelector(".og-voz-vel").addEventListener("change", function (e) {
      vel = parseFloat(e.target.value) || 1; salvarVel(); sincronizarVel();
      if (atual === s && s.tocando) falar(s);   // reinicia a frase atual na nova velocidade
    });
    return ui;
  }

  window.OGVoz = { montar: montar, parar: parar, frasesDe: frasesDe };
  window.addEventListener("pagehide", parar);
})();
