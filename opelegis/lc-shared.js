/* =========================================================================
   Lei Comentada — núcleo compartilhado (content script, app e background)
   Categorias, detecção de artigos, índice de artigos e utilidades comuns.
   Exporta em window.LC (navegador) e module.exports (Node, para testes).
   ========================================================================= */
(function (root) {
  "use strict";

  var CATEGORIES = [
    { key: "sumula",         label: "Súmula",         letter: "S", color: "#b45309", badgeBg: "#fef3c7", badgeFg: "#92400e" },
    { key: "jurisprudencia", label: "Jurisprudência", letter: "J", color: "#4338ca", badgeBg: "#e0e7ff", badgeFg: "#3730a3" },
    { key: "doutrina",       label: "Doutrina",       letter: "D", color: "#047857", badgeBg: "#d1fae5", badgeFg: "#065f46" },
    { key: "enunciado",      label: "Enunciado",      letter: "E", color: "#be185d", badgeBg: "#fce7f3", badgeFg: "#9d174b" },
    { key: "legislacao",     label: "Legislação correlata", letter: "L", color: "#0e7490", badgeBg: "#cffafe", badgeFg: "#155e75" },
    { key: "nota",           label: "Nota",           letter: "N", color: "#475569", badgeBg: "#f1f5f9", badgeFg: "#334155" }
  ];
  var CAT_MAP = {};
  CATEGORIES.forEach(function (c) { CAT_MAP[c.key] = c; });
  function cat(key) { return CAT_MAP[key] || CAT_MAP.nota; }

  /* ----------------------------- utilidades ----------------------------- */
  function uid() { return "lc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function truncate(s, n) { s = s || ""; return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  /* Planalto → Portal da Legislação (OpeLegis 2.0). As duas formas da
     mesma lei dividem a MESMA chave de anotações: o host do portal é
     tratado como planalto.gov.br e o caminho vai para minúsculas (o portal
     só aceita nomes de arquivo em minúsculas). */
  var PORTAL_HOSTS = { "portaldalegislacao.presidencia.gov.br": 1, "portaldalegislacao-classico.presidencia.gov.br": 1 };
  function normalizeUrl(href) {
    try {
      var u = new URL(href);
      var host = u.hostname.replace(/^www\./, "");
      var path = u.pathname.replace(/\/+$/, "");
      if (PORTAL_HOSTS[host]) host = "planalto.gov.br";
      if (host === "planalto.gov.br") path = path.toLowerCase();
      return host + path + (u.search || "");
    } catch (e) { return href; }
  }
  /* Endereço no Portal da Legislação para uma URL do Planalto (ou já do
     portal). Outros sites voltam inalterados. */
  function toPortalUrl(href) {
    try {
      var u = new URL(href);
      var host = u.hostname.replace(/^www\./, "");
      if (host !== "planalto.gov.br" && !PORTAL_HOSTS[host]) return href;
      var path = u.pathname.replace(/[^\/]+$/, function (f) { return f.toLowerCase(); });
      return "https://portaldalegislacao.presidencia.gov.br" + path + (u.search || "") + (u.hash || "");
    } catch (e) { return href; }
  }
  function toPlanaltoUrl(href) {
    try {
      var u = new URL(href);
      var host = u.hostname.replace(/^www\./, "");
      if (!PORTAL_HOSTS[host]) return href;
      return "https://www.planalto.gov.br" + u.pathname + (u.search || "") + (u.hash || "");
    } catch (e) { return href; }
  }
  var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  function stripHtml(html) {   /* 2.8: sem DOMParser (rápido para milhares de notas) */
    return String(html || "").replace(/<(br|\/p|\/li|\/div|\/h\d|\/tr)\b[^>]*>/gi, " ").replace(/<[^>]*>/g, "")
      .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, function (m, e) {
        if (e[0] === "#") { var n = (e[1] === "x" || e[1] === "X") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n ? String.fromCharCode(n) : m; }
        var v = ENT[e.toLowerCase()]; return v !== undefined ? v : m;
      });
  }
  function sanitizeHtml(html) {
    if (typeof DOMParser === "undefined") return String(html || "");
    var doc = new DOMParser().parseFromString(html || "", "text/html");
    doc.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,svg").forEach(function (e) { e.remove(); });
    doc.querySelectorAll("*").forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (at) {
        var n = at.name.toLowerCase();
        if (n.indexOf("on") === 0) el.removeAttribute(at.name);
        if ((n === "href" || n === "src") && /^\s*javascript:/i.test(at.value)) el.removeAttribute(at.name);
      });
    });
    return doc.body.innerHTML;
  }
  function cssEsc(s) {
    return (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\\]]/g, "\\$&");
  }

  /* --------------------------- artigos (texto) -------------------------- */
  /* Numeração de artigo aceitando separador de milhar: "Art. 1.723" precisa
     valer 1723, e não 1. Sem isto, o índice do Código Civil pára no art. 999
     (todos os seguintes colidem na chave "1"). NUM_SRC captura o número com
     os pontos; artNum() converte para inteiro. */
  var NUM_SRC = "(\\d{1,3}(?:[.\\u00a0 ]\\d{3})+|\\d+)";
  function artNum(s) {
    var d = String(s == null ? "" : s).replace(/[^\d]/g, "");
    return d ? parseInt(d, 10) : 0;
  }

  // nº do artigo imediatamente anterior à posição `pos` no texto `full`.
  function detectArticleFromText(full, pos) {
    if (!full) return "";
    var from = Math.max(0, pos - 6000);
    var slice = full.slice(from, pos + 1);
    var re = new RegExp("\\bArt(?:igo)?\\.?\\s*" + NUM_SRC, "gi");
    var m, last = null;
    while ((m = re.exec(slice))) last = m;
    return last ? "Art. " + last[1] : "";
  }
  // índice de artigos a partir de um texto com quebras de parágrafo (\n).
  function buildArticleIndexFromText(full) {
    var out = [], seen = {};
    var re = new RegExp("(^|\\n)([ \\t]*)Art(?:igo)?\\.?\\s*" + NUM_SRC, "gi");
    var m;
    while ((m = re.exec(full))) {
      var num = artNum(m[3]);
      if (!num || seen[num]) continue;
      seen[num] = true;
      var idx = m.index + m[1].length + m[2].length;
      out.push({ num: num, label: "Art. " + m[3], index: idx });
    }
    return out;
  }

  /* ----------------------------- artigos (DOM) -------------------------- */
  function startsWithArt(text) {
    var m = new RegExp("^\\s*Art(?:igo)?\\.?\\s*" + NUM_SRC, "i").exec(text || "");
    return m ? m[1] : null;   // devolve com os pontos: "1.723"
  }
  // índice de artigos varrendo blocos do DOM; pega o elemento mais específico.
  function buildArticleIndexFromDOM(rootEl) {
    var els = rootEl.querySelectorAll("p,li,div,h1,h2,h3,h4,h5,h6,article,section,dt,dd,td,blockquote,span");
    var out = [], seen = {};
    Array.prototype.forEach.call(els, function (el) {
      var num = startsWithArt(el.textContent);
      if (!num) return;
      var childSame = false;
      Array.prototype.forEach.call(el.children || [], function (c) {
        if (startsWithArt(c.textContent) === num) childSame = true;
      });
      if (childSame) return;        // existe filho mais específico
      if (seen[num]) return;        // mantém a 1ª ocorrência (cabeçalho)
      seen[num] = true;
      out.push({ num: artNum(num), label: "Art. " + num, el: el });
    });
    return out;
  }
  // nº do artigo que contém / antecede um nó (ex.: o span da anotação).
  function detectArticleForNode(rootEl, node) {
    var idx = buildArticleIndexFromDOM(rootEl), best = "";
    for (var i = 0; i < idx.length; i++) {
      var pos = idx[i].el.compareDocumentPosition(node);
      var precedes = (pos & 4) || (pos & 16) || idx[i].el === node; // FOLLOWING ou CONTAINED_BY
      if (precedes) best = idx[i].label; else break;
    }
    return best;
  }
  function articleNum(label) {
    var m = new RegExp(NUM_SRC).exec(label || "");
    return m ? artNum(m[1]) : 0;
  }


  /* ---------------- âncoras "pendentes" (OpeLegis 2.0) ----------------
     Anotações importadas de material externo (ex.: JusLegis) chegam sem o
     trecho exato: trazem só { pending: {t:"art", n:9, s:"A"} } ou
     { pending: {t:"titulo"} }. Na primeira vez em que a lei é aberta (no
     Vade Mecum ou na própria página), o artigo é localizado no DOM e a
     âncora vira uma âncora comum (exact + prefixo + sufixo).            */
  var RE_ART_REF = /^\s*Art(?:igo)?\.?\s*(\d{1,3}(?:[.  ]\d{3})+|\d+)\s*(?:º|°|o)?(?:\s*[-–]([A-Z])(?![A-Za-zÀ-ÿ]))?/;
  var RE_TITULO = /^\s*(LEI|DECRETO|EMENDA|MEDIDA\s+PROVIS|CONSTITUI)[^\n]{0,60}?N[º°o.]?\s*\d/i;
  var SEL_ART = "p,li,div,h1,h2,h3,h4,h5,h6,dt,dd,td,blockquote,span,a,font,b,strong,center";
  function ehUI(el) {
    return !!(el.closest && el.closest("#lc-ui-root,#opelegis-sidebar-host,.vm-ui,.lc-note-marker"));
  }
  function riscado(el, root) {
    var n = el;
    while (n && n !== root && n.nodeType === 1) {
      if (n.tagName === "STRIKE" || n.tagName === "S" || n.tagName === "DEL") return true;
      n = n.parentNode;
    }
    return false;
  }
  function indiceArtigos(root) {
    var grupos = {};
    Array.prototype.forEach.call(root.querySelectorAll(SEL_ART), function (el) {
      if (ehUI(el)) return;
      var t = el.textContent || "";
      var m = RE_ART_REF.exec(t);
      if (!m) return;
      /* o suffixo só vale quando colado ao número: "9º-A", "9-A" */
      var suf = "";
      var m2 = /^\s*Art(?:igo)?\.?\s*(?:\d{1,3}(?:[.  ]\d{3})+|\d+)\s*(?:(?:º|°|o)?[-–]|(?=[A-Z]))([A-Z])(?![A-Za-zÀ-ÿ])/.exec(t);
      if (m2) suf = m2[1];
      var k = artNum(m[1]) + (suf ? "-" + suf : "");
      (grupos[k] = grupos[k] || []).push({ el: el, len: t.length, struck: riscado(el, root) });
    });
    var out = {};
    Object.keys(grupos).forEach(function (k) {
      var c = grupos[k];
      var vivos = c.filter(function (x) { return !x.struck; });
      var pool = vivos.length ? vivos : c;
      var com = pool.filter(function (x) { return x.len >= 24; });
      out[k] = (com.length ? com.reduce(function (a, b) { return b.len < a.len ? b : a; })
                           : pool.reduce(function (a, b) { return b.len > a.len ? b : a; })).el;
    });
    return out;
  }
  function elementoTitulo(root) {
    var cands = Array.prototype.filter.call(root.querySelectorAll("h1,h2,h3,h4,p,font,span,b,strong,div,td,center,a"), function (el) {
      if (ehUI(el)) return false;
      var t = el.textContent || "";
      return t.length < 260 && RE_TITULO.test(t);
    });
    if (!cands.length) return null;
    /* o mais interno (menor texto) entre os primeiros do documento */
    var primeiro = cands[0];
    var dentro = cands.filter(function (el) { return primeiro.contains(el); });
    return dentro.reduce(function (a, b) { return (b.textContent || "").length < (a.textContent || "").length ? b : a; }, primeiro);
  }
  function resolvePendingAnchors(root, annotations, buildTextMap) {
    if (!root || !annotations || !annotations.length) return 0;
    var pend = annotations.filter(function (a) { return a && a.anchor && a.anchor.pending && !a.anchor.exact; });
    if (!pend.length) return 0;
    var idx = null, tit;
    var built = buildTextMap();
    var full = built.full, porNo = new Map();
    built.map.forEach(function (e) { porNo.set(e.node, e); });
    var n = 0;
    pend.forEach(function (a) {
      var ref = a.anchor.pending, el = null;
      if (ref.t === "titulo") {
        if (tit === undefined) tit = elementoTitulo(root);
        el = tit;
        if (!el) { if (!idx) idx = indiceArtigos(root); el = idx["1"] || null; }
      } else {
        if (!idx) idx = indiceArtigos(root);
        el = idx[String(ref.n) + (ref.s ? "-" + ref.s : "")] || null;
      }
      if (!el) return;
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), no, ini = -1, fim = -1;
      while ((no = w.nextNode())) {
        var e = porNo.get(no);
        if (!e) continue;
        if (ini < 0) {
          var off = (no.nodeValue || "").search(/\S/);
          if (off < 0) continue;
          ini = e.start + off;
        }
        fim = e.end;
      }
      if (ini < 0 || fim <= ini) return;
      /* trecho curto (o rótulo do artigo e as primeiras palavras), cortado
         em fim de palavra, para o grifo não atravessar a linha inteira */
      var len = Math.min(40, fim - ini);
      var exact = full.slice(ini, ini + len);
      if (fim - ini > len) { var sp = exact.lastIndexOf(" "); if (sp > 10) exact = exact.slice(0, sp); }
      exact = exact.replace(/\s+$/, "");
      if (exact.length < 3) return;
      a.anchor = {
        exact: exact,
        prefix: full.slice(Math.max(0, ini - 50), ini),
        suffix: full.slice(ini + exact.length, ini + exact.length + 50),
        start: ini, end: ini + exact.length
      };
      n++;
    });
    return n;
  }

  /* ---------------- backup completo montado no próprio contexto ---------
     Com os pacotes, o backup completo passa de 40 MB. O Chrome não entrega
     mensagens desse tamanho entre o service worker e a página (a resposta
     chegava vazia e aparecia "Falha ao gerar backup"). Por isso a página lê o
     armazenamento diretamente e monta o arquivo ela mesma. */
  function chaveDeBackup(k) {
    return k.indexOf("lc:page:") === 0 || k.indexOf("lc:doc:") === 0 ||
      k === "lc:doclist" || k === "lc:laws" || k === "lc:disciplines" ||
      k === "lc:vm:settings" || k === "og:srs";
  }
  function montarBackup() {
    return new Promise(function (resolve, reject) {
      try {
        var st = chrome.storage.local;
        var ler = function (keys) {
          st.get(keys, function (store) {
            if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
            var limpo = {};
            Object.keys(store || {}).forEach(function (k) { if (chaveDeBackup(k)) limpo[k] = store[k]; });
            resolve({ app: "lei-comentada", version: 2, exportedAt: new Date().toISOString(), modo: "completo", store: limpo });
          });
        };
        if (st.getKeys) st.getKeys().then(function (ks) { ler(ks.filter(chaveDeBackup)); }, function () { ler(null); });
        else ler(null);
      } catch (e) { reject(e); }
    });
  }
  /* devolve o backup em Blob (sem indentação: o arquivo fica bem menor) */
  function backupBlob(obj) {
    return new Blob([JSON.stringify(obj)], { type: "application/json" });
  }

  /* importa em partes de ~8 MB: um backup completo inteiro não cabe numa
     única mensagem para o service worker */
  function importarBackup(data, cb) {
    var store = (data && (data.store || data.pages)) || null;
    if (!store || typeof store !== "object") { cb({ ok: false, error: "Arquivo de backup inválido." }); return; }
    var partes = [], atual = {}, tam = 0;
    Object.keys(store).forEach(function (k) {
      var n = 0; try { n = JSON.stringify(store[k]).length; } catch (e) {}
      if (tam && tam + n > 8e6) { partes.push(atual); atual = {}; tam = 0; }
      atual[k] = store[k]; tam += n;
    });
    if (Object.keys(atual).length || !partes.length) partes.push(atual);
    var total = 0, i = 0;
    (function prox() {
      chrome.runtime.sendMessage({ type: "MERGE_BACKUP", data: { store: partes[i] }, semAviso: i < partes.length - 1 }, function (r) {
        void chrome.runtime.lastError;
        if (!r || !r.ok) { cb({ ok: false, error: (r && r.error) || "falha na parte " + (i + 1) + " de " + partes.length }); return; }
        total += r.pages || 0; i++;
        if (i < partes.length) prox(); else cb({ ok: true, pages: total });
      });
    })();
  }

  var LC = {
    CATEGORIES: CATEGORIES, cat: cat,
    uid: uid, escapeHtml: escapeHtml, truncate: truncate, normalizeUrl: normalizeUrl,
    toPortalUrl: toPortalUrl, toPlanaltoUrl: toPlanaltoUrl,
    resolvePendingAnchors: resolvePendingAnchors, articleElementIndex: indiceArtigos,
    stripHtml: stripHtml, sanitizeHtml: sanitizeHtml, cssEsc: cssEsc,
    detectArticleFromText: detectArticleFromText,
    buildArticleIndexFromText: buildArticleIndexFromText,
    buildArticleIndexFromDOM: buildArticleIndexFromDOM,
    detectArticleForNode: detectArticleForNode,
    startsWithArt: startsWithArt, articleNum: articleNum, artNum: artNum,
    montarBackup: montarBackup, backupBlob: backupBlob, importarBackup: importarBackup
  };

  if (typeof module !== "undefined" && module.exports) module.exports = LC;
  if (root) root.LC = LC;
})(typeof window !== "undefined" ? window : null);
