/* =========================================================================
   Vade Mecum — motor de anotação compatível com o módulo "Lei Comentada".

   Grava exatamente no MESMO formato e nas MESMAS chaves do content script
   (lc:page:<urlNormalizada>), com âncora {exact, prefix, suffix, start, end}.
   Assim, uma anotação feita aqui no leitor da barra lateral reaparece quando
   você abrir a página real do Planalto numa aba — e vice-versa. Os offsets
   diferem entre os dois contextos, mas a relocalização por texto
   (exact + prefix + sufixo) é a mesma dos dois lados.
   ========================================================================= */
(function (root) {
  "use strict";

  var CTX = 50;                 // idêntico ao content script
  var container = null;         // elemento que contém o texto da lei
  var onDirty = function () {};

  /* ---------------------------- utilidades ------------------------------ */
  function isUI(node) {
    var el = (node && node.nodeType === 3) ? node.parentNode : node;
    while (el && el.nodeType === 1) {
      if (el.classList && (el.classList.contains("lc-note-marker") || el.classList.contains("vm-ui"))) return true;
      el = el.parentNode;
    }
    return false;
  }
  function cssEsc(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\\]]/g, "\\$&");
  }
  function stripHtml(html) {   /* 2.8: sem DOMParser */
    return String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&[a-z#0-9]+;/gi, "x");
  }

  /* ---------------------------- mapa de texto --------------------------- */
  function buildTextMap() {
    var map = [], full = "";
    if (!container) return { full: "", map: [] };
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") return NodeFilter.FILTER_REJECT;
        if (isUI(n)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var start = full.length;
      full += node.nodeValue;
      map.push({ node: node, start: start, end: full.length });
    }
    return { full: full, map: map };
  }

  function collectRangeSegments(range) {
    var out = [];
    if (!range || range.collapsed) return out;
    var r = range.commonAncestorContainer;
    if (r.nodeType === 3) r = r.parentNode;
    if (!container.contains(r)) return out;
    var walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue) continue;
      var tag = n.parentNode ? n.parentNode.nodeName : "";
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") continue;
      if (isUI(n)) continue;
      if (!range.intersectsNode(n)) continue;
      var s = (n === range.startContainer) ? range.startOffset : 0;
      var e = (n === range.endContainer) ? range.endOffset : n.nodeValue.length;
      if (s >= e) continue;
      out.push({ node: n, startOffset: s, endOffset: e });
    }
    return out;
  }

  function offsetsToSegments(map, start, end) {
    var segs = [];
    for (var i = 0; i < map.length; i++) {
      var en = map[i];
      if (en.end <= start) continue;
      if (en.start >= end) break;
      var s = Math.max(start, en.start) - en.start;
      var e = Math.min(end, en.end) - en.start;
      if (e > s) segs.push({ node: en.node, startOffset: s, endOffset: e });
    }
    return segs;
  }

  function wrapSegment(seg, annoId) {
    var r = document.createRange();
    r.setStart(seg.node, seg.startOffset);
    r.setEnd(seg.node, seg.endOffset);
    var span = document.createElement("span");
    span.className = "lc-hl";
    span.setAttribute("data-lc-id", annoId);
    try { r.surroundContents(span); }
    catch (err) { var frag = r.extractContents(); span.appendChild(frag); r.insertNode(span); }
    return span;
  }

  /* ------------------------- relocalização por texto -------------------- */
  function commonPrefixLen(a, b) { var n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; }
  function commonSuffixLen(a, b) { var n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; }

  function relocate(full, a) {
    var exact = a.exact;
    if (!exact) return null;
    var idxs = [], i = full.indexOf(exact);
    while (i !== -1) { idxs.push(i); i = full.indexOf(exact, i + 1); if (idxs.length > 800) break; }
    if (!idxs.length) return null;
    var best = idxs[0], bestScore = -Infinity;
    for (var k = 0; k < idxs.length; k++) {
      var idx = idxs[k];
      var pre = full.slice(Math.max(0, idx - (a.prefix ? a.prefix.length : 0)), idx);
      var suf = full.slice(idx + exact.length, idx + exact.length + (a.suffix ? a.suffix.length : 0));
      var score = commonSuffixLen(a.prefix || "", pre) + commonPrefixLen(a.suffix || "", suf);
      score += Math.max(0, 25 - Math.abs(idx - (a.start || 0)) / 60);
      if (score > bestScore) { bestScore = score; best = idx; }
    }
    return { start: best, end: best + exact.length };
  }

  /* ------------------------------- estilo ------------------------------- */
  function spansOf(id) {
    if (!container) return [];
    var e = cssEsc(id);
    return Array.prototype.slice.call(container.querySelectorAll('span.lc-hl[data-lc-id="' + e + '"],span.lc-hl[data-lc-ids~="' + e + '"]'));
  }
  function idsOfSpan(sp) {
    var s = sp.getAttribute("data-lc-ids");
    return s ? s.split(" ").filter(Boolean) : [sp.getAttribute("data-lc-id")];
  }
  function hasComment(anno) { return !!(anno && anno.comment && /\S/.test(stripHtml(anno.comment))); }

  function styleSpans(anno) {
    spansOf(anno.id).forEach(function (sp) {
      sp.style.backgroundColor = anno.bg || "";
      sp.style.color = anno.fg || "";
      sp.style.fontWeight = anno.bold ? "700" : "";
      sp.style.fontStyle = anno.italic ? "italic" : "";
      sp.style.textDecoration = anno.underline ? "underline" : "";
      sp.classList.toggle("lc-has-comment", hasComment(anno));
      sp.setAttribute("title", hasComment(anno) ? "Comentário — clique para ver" : "");
    });
    updateMarker(anno);
  }

  function updateMarker(anno) {
    if (!container) return;
    var sp0 = spansOf(anno.id);
    if (sp0.length && sp0[0].hasAttribute("data-lc-ids")) return;   /* grifo compartilhado: marcador do grupo */
    container.querySelectorAll('.lc-note-marker[data-lc-id="' + cssEsc(anno.id) + '"]').forEach(function (m) { m.remove(); });
    if (!hasComment(anno)) return;
    var spans = spansOf(anno.id);
    if (!spans.length) return;
    var c = window.LC ? LC.cat(anno.category) : { letter: "N", color: "#475569", label: "Nota" };
    var m = document.createElement("span");
    m.className = "lc-note-marker";
    m.setAttribute("data-lc-id", anno.id);
    m.textContent = c.letter;
    m.style.background = c.color;
    m.setAttribute("title", c.label + " — clique para ver o comentário");
    spans[spans.length - 1].after(m);
  }

  function unwrap(id) {
    if (!container) return;
    var grp = spansOf(id).filter(function (sp) { return idsOfSpan(sp).length > 1; });
    if (grp.length) {
      grp.forEach(function (sp) {
        var rest = idsOfSpan(sp).filter(function (x) { return x !== id; });
        sp.setAttribute("data-lc-id", rest[0]);
        if (rest.length > 1) sp.setAttribute("data-lc-ids", rest.join(" ")); else sp.removeAttribute("data-lc-ids");
      });
      container.querySelectorAll(".lc-note-marker").forEach(function (m) {
        var mi = (m.getAttribute("data-lc-ids") || m.getAttribute("data-lc-id") || "").split(" ");
        if (mi.indexOf(id) !== -1) {
          var resto = mi.filter(function (x) { return x !== id; });
          if (resto.length > 1) { m.setAttribute("data-lc-ids", resto.join(" ")); m.setAttribute("data-lc-id", resto[0]); m.textContent = String(resto.length); }
          else m.remove();
        }
      });
      return;
    }
    container.querySelectorAll('.lc-note-marker[data-lc-id="' + cssEsc(id) + '"]').forEach(function (m) { m.remove(); });
    spansOf(id).forEach(function (sp) {
      var parent = sp.parentNode;
      if (!parent) return;
      while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
      parent.removeChild(sp);
      parent.normalize();
    });
  }

  function unwrapAll() {
    if (!container) return;
    container.querySelectorAll(".lc-note-marker").forEach(function (m) { m.remove(); });
    var spans = Array.prototype.slice.call(container.querySelectorAll("span.lc-hl"));
    spans.forEach(function (sp) {
      var parent = sp.parentNode;
      if (!parent) return;
      while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
      parent.removeChild(sp);
    });
    container.normalize();
  }

  /* ------------------------- criar / restaurar -------------------------- */
  function createFromRange(range) {
    var segs = collectRangeSegments(range);
    if (!segs.length) return null;
    var built = buildTextMap();
    var map = built.map, full = built.full;
    var first = null, last = null;
    for (var i = 0; i < map.length; i++) {
      if (map[i].node === segs[0].node) first = map[i];
      if (map[i].node === segs[segs.length - 1].node) last = map[i];
    }
    if (!first || !last) return null;
    var start = first.start + segs[0].startOffset;
    var end = last.start + segs[segs.length - 1].endOffset;
    if (end <= start) return null;
    var anno = {
      id: window.LC ? LC.uid() : ("lc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      bg: "", fg: "", bold: false, italic: false, underline: false,
      comment: "", category: "nota", importance: 0, maps: [],
      article: window.LC ? LC.detectArticleFromText(full, start) : "",
      anchor: {
        exact: full.slice(start, end),
        prefix: full.slice(Math.max(0, start - CTX), start),
        suffix: full.slice(end, end + CTX),
        start: start, end: end
      },
      createdAt: Date.now(), updatedAt: Date.now()
    };
    segs.forEach(function (seg) { wrapSegment(seg, anno.id); });
    return anno;
  }

  function restore(anno) {
    var built = buildTextMap();
    var full = built.full, map = built.map;
    var start = anno.anchor ? anno.anchor.start : 0;
    var end = anno.anchor ? anno.anchor.end : 0;
    var exact = anno.anchor ? anno.anchor.exact : "";
    if (!exact) return false;
    if (full.slice(start, end) !== exact) {
      var loc = relocate(full, anno.anchor);
      if (!loc) return false;
      start = loc.start; end = loc.end;
    }
    var segs = offsetsToSegments(map, start, end);
    if (!segs.length) return false;
    segs.forEach(function (seg) { wrapSegment(seg, anno.id); });
    styleSpans(anno);
    return true;
  }

  function restoreAll(list) {
    var ok = 0;
    VMAnno.lastResolved = 0;
    try {
      if (container && window.LC && LC.resolvePendingAnchors) VMAnno.lastResolved = LC.resolvePendingAnchors(container, list || [], buildTextMap);
    } catch (e) {}
    try { ok = restoreBatch(list || []); }
    catch (e) { (list || []).forEach(function (a) { try { if (restore(a)) ok++; } catch (x) {} }); }
    return ok;
  }
  /* OpeLegis 2.8: restauração em lote (mapa de texto uma única vez) e grifo
     único para as anotações que caem no mesmo trecho */
  function restoreBatch(list) {
    var built = buildTextMap(), full = built.full, map = built.map;
    var grupos = new Map();
    list.forEach(function (a) {
      if (!a || !a.anchor || !a.anchor.exact) return;
      var s = a.anchor.start, e = a.anchor.end;
      if (full.slice(s, e) !== a.anchor.exact) { var loc = relocate(full, a.anchor); if (!loc) return; s = loc.start; e = loc.end; }
      if (e <= s) return;
      var k = s + ":" + e, g = grupos.get(k);
      if (!g) { g = { s: s, e: e, annos: [], spans: [] }; grupos.set(k, g); }
      g.annos.push(a);
    });
    if (!grupos.size) return 0;
    var starts = map.map(function (m) { return m.start; });
    function at(pos) {
      var lo = 0, hi = map.length - 1, r = -1;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (starts[mid] <= pos) { r = mid; lo = mid + 1; } else hi = mid - 1; }
      return (r >= 0 && pos < map[r].end) ? r : -1;
    }
    var cortes = new Map();
    grupos.forEach(function (g) {
      [g.s, g.e].forEach(function (p) {
        var i = at(p); if (i < 0) return;
        var off = p - map[i].start;
        if (off > 0 && off < map[i].end - map[i].start) { if (!cortes.has(i)) cortes.set(i, new Set()); cortes.get(i).add(off); }
      });
    });
    var ped = [];
    map.forEach(function (en, i) {
      var cs = cortes.get(i);
      if (!cs) { ped.push({ node: en.node, start: en.start, end: en.end }); return; }
      var offs = Array.from(cs).sort(function (a, b) { return a - b; }), node = en.node, prev = 0;
      offs.forEach(function (off) { var resto = node.splitText(off - prev); ped.push({ node: node, start: en.start + prev, end: en.start + off }); node = resto; prev = off; });
      ped.push({ node: node, start: en.start + prev, end: en.end });
    });
    var pst = ped.map(function (p) { return p.start; });
    var lista = Array.from(grupos.values()).sort(function (a, b) { return (b.e - b.s) - (a.e - a.s) || a.s - b.s; });
    var ok = 0;
    lista.forEach(function (g) {
      var lo = 0, hi = pst.length - 1, i0 = pst.length;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (pst[mid] >= g.s) { i0 = mid; hi = mid - 1; } else lo = mid + 1; }
      var ids = g.annos.map(function (a) { return a.id; });
      for (var i = i0; i < ped.length && ped[i].start < g.e; i++) {
        var pc = ped[i];
        if (pc.end > g.e) break;
        if (!/\S/.test(pc.node.nodeValue || "") && !g.spans.length) continue;
        var par = pc.node.parentNode;
        if (!par || /^(TABLE|TBODY|THEAD|TR|SELECT|OPTION)$/.test(par.nodeName)) continue;
        var sp = document.createElement("span");
        sp.className = "lc-hl"; sp.setAttribute("data-lc-id", ids[0]);
        if (ids.length > 1) sp.setAttribute("data-lc-ids", ids.join(" "));
        par.insertBefore(sp, pc.node); sp.appendChild(pc.node);
        g.spans.push(sp);
      }
      if (!g.spans.length) return;
      ok += g.annos.length;
      var est = g.annos.filter(function (a) { return a.bg || a.fg || a.bold || a.italic || a.underline; })[0];
      var algum = g.annos.some(hasComment);
      g.spans.forEach(function (sp) {
        if (est) { sp.style.backgroundColor = est.bg || ""; sp.style.color = est.fg || ""; sp.style.fontWeight = est.bold ? "700" : ""; sp.style.fontStyle = est.italic ? "italic" : ""; sp.style.textDecoration = est.underline ? "underline" : ""; }
        if (algum) { sp.classList.add("lc-has-comment"); sp.setAttribute("title", g.annos.length > 1 ? g.annos.length + " anotações — clique para ver" : "Comentário — clique para ver"); }
      });
    });
    lista.forEach(function (g) {
      if (!g.spans.length) return;
      var com = g.annos.filter(hasComment);
      if (!com.length) return;
      var m = document.createElement("span");
      m.className = "lc-note-marker";
      if (com.length === 1) {
        var c = window.LC ? LC.cat(com[0].category) : { letter: "N", color: "#475569", label: "Nota" };
        m.setAttribute("data-lc-id", com[0].id); m.textContent = c.letter; m.style.background = c.color;
        m.setAttribute("title", c.label + " — clique para ver o comentário");
      } else {
        m.classList.add("lc-grp");
        m.setAttribute("data-lc-id", com[0].id); m.setAttribute("data-lc-ids", com.map(function (a) { return a.id; }).join(" "));
        m.textContent = String(com.length); m.setAttribute("title", com.length + " anotações neste trecho — clique para ver a lista");
      }
      g.spans[g.spans.length - 1].after(m);
    });
    return ok;
  }

  /* -------------------------- índice de artigos -------------------------
     A regra antiga ("pule o elemento se um filho repete o número") perdia a
     maioria dos artigos: no Planalto o "Art. 1º" costuma estar dentro de um
     <a name="art1">, o <p> era descartado por causa do filho e o <a> nem
     entrava na varredura. Resultado: 35 artigos num código de 2.046.

     Agora junto TODOS os candidatos por número e escolho um só: o menor bloco
     que ainda carregue o texto do artigo (>= MIN_TXT), preferindo o que não
     está riscado (o Planalto mantém a redação revogada em <strike>).
     ---------------------------------------------------------------------- */
  var SEL_BLOCK = "p,li,div,h1,h2,h3,h4,h5,h6,article,section,dt,dd,td,blockquote,span,a,font,b,strong,i,em,center";
  var MIN_TXT = 24;
  var NUM_RE = "(\\d{1,3}(?:[.\\u00a0 ]\\d{3})+|\\d+)";   // aceita "1.629"

  function isStruck(el) {
    var n = el;
    while (n && n !== container && n.nodeType === 1) {
      var t = n.tagName;
      if (t === "STRIKE" || t === "S" || t === "DEL") return true;
      n = n.parentNode;
    }
    return false;
  }

  function buildArticleIndex() {
    if (!container || !window.LC) return [];
    var groups = {}, order = [];
    Array.prototype.forEach.call(container.querySelectorAll(SEL_BLOCK), function (el) {
      var num = LC.startsWithArt(el.textContent);
      if (!num) return;
      var n = LC.artNum(num);
      if (!n) return;
      if (!groups[n]) { groups[n] = []; order.push(n); }
      groups[n].push({ el: el, label: "Art. " + num, len: (el.textContent || "").length, struck: isStruck(el) });
    });

    var out = [], temNum = {};
    order.forEach(function (n) {
      var c = groups[n];
      var vivos = c.filter(function (x) { return !x.struck; });
      var pool = vivos.length ? vivos : c;
      // menor bloco com conteúdo suficiente; se nenhum tiver, o maior que houver
      var comTexto = pool.filter(function (x) { return x.len >= MIN_TXT; });
      var pick;
      if (comTexto.length) {
        pick = comTexto.reduce(function (a, b) { return b.len < a.len ? b : a; });
      } else {
        pick = pool.reduce(function (a, b) { return b.len > a.len ? b : a; });
      }
      temNum[n] = true;
      out.push({ num: n, label: pick.label, el: pick.el });
    });

    /* Faixas revogadas em bloco: "Arts. 1.621 a 1.629. (Revogados)". Sem isto
       esses artigos sumiriam do índice. Cada número aponta para o mesmo bloco. */
    var RE_FAIXA = new RegExp("^\\s*Arts?\\.?\\s*" + NUM_RE + "\\s*(?:a|at[ée]|e)\\s*" + NUM_RE, "i");
    Array.prototype.forEach.call(container.querySelectorAll("p,div,td,li,span"), function (el) {
      var m = RE_FAIXA.exec((el.textContent || "").replace(/\s+/g, " "));
      if (!m) return;
      var ini = LC.artNum(m[1]), fim = LC.artNum(m[2]);
      if (!ini || !fim || fim < ini || fim - ini > 300) return;
      for (var i = ini; i <= fim; i++) {
        if (temNum[i]) continue;
        temNum[i] = true;
        out.push({ num: i, label: "Art. " + i, el: el });
      }
    });

    out.sort(function (a, b) { return a.num - b.num; });
    return out;
  }

  /* --------------------- índice estrutural (livros/títulos) --------------
     Reconhece PARTE / LIVRO / TÍTULO / CAPÍTULO / SEÇÃO / SUBSEÇÃO. No
     Planalto o nome costuma vir no parágrafo seguinte ("LIVRO I" e, abaixo,
     "DAS PESSOAS"), então junto os dois num rótulo só.
     ---------------------------------------------------------------------- */
  var NIVEL = { parte: 0, livro: 1, titulo: 2, capitulo: 3, secao: 4, subsecao: 5 };
  /* O algarismo romano precisa terminar em fronteira: sem o lookahead,
     "LIVRO COMPLEMENTAR" vira "LIVRO C" + "OMPLEMENTAR". */
  var RE_STRUCT = /^\s*(PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SUBSE[ÇC][ÃA]O|SE[ÇC][ÃA]O)\s*([IVXLCDM]+(?![A-Za-zÀ-ÿ]))?\s*[-–—.:]?\s*([\s\S]*)$/i;
  var RE_ART_ANY = /\bArt(?:igo)?\.?\s*\d/i;

  function chaveNivel(kw) {
    var k = kw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (k.indexOf("subsec") === 0) return "subsecao";
    if (k.indexOf("sec") === 0) return "secao";
    if (k.indexOf("cap") === 0) return "capitulo";
    if (k.indexOf("tit") === 0) return "titulo";
    if (k.indexOf("livro") === 0) return "livro";
    return "parte";
  }
  function txt(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }

  /* "P A R T E   G E R A L" (o Planalto espaça letra a letra) → "PARTEGERAL" */
  function letraEspacada(t) {
    return /^(?:\S\s)+\S$/.test(t) ? t.replace(/\s+/g, "") : null;
  }

  /* Tabelas de sumário: muitos cabeçalhos e nenhum artigo. O Código Civil traz
     uma, e sem excluí-la a árvore sai duplicada (18 livros em vez de 9). */
  function tabelasSumario() {
    var out = [];
    Array.prototype.forEach.call(container.querySelectorAll("table"), function (tb) {
      if (RE_ART_ANY.test(tb.textContent || "")) return;
      var n = 0;
      Array.prototype.forEach.call(tb.querySelectorAll("p,div,td,li,center"), function (e) {
        var s = txt(e);
        if (s && s.length <= 110 && RE_STRUCT.test(s)) n++;
      });
      if (n >= 4) out.push(tb);
    });
    return out;
  }

  function buildStructureIndex() {
    if (!container) return [];
    var out = [], vistos = [];
    var sumarios = tabelasSumario();
    var blocos = container.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,center,td,li");
    Array.prototype.forEach.call(blocos, function (el) {
      var t = txt(el);
      if (!t || t.length > 110) return;
      if (RE_ART_ANY.test(t)) return;                        // é artigo, não cabeçalho
      if (isStruck(el)) return;
      if (sumarios.some(function (tb) { return tb.contains(el); })) return;

      var m = RE_STRUCT.exec(t);
      if (!m) { var c = letraEspacada(t); if (c) m = RE_STRUCT.exec(c); }
      if (!m) return;
      // descarta se um filho já casou (fica sempre o bloco mais externo curto)
      if (vistos.some(function (v) { return v.contains(el) || el.contains(v); })) return;

      var nivel = chaveNivel(m[1]);
      var ord = m[2] ? m[2].toUpperCase() : "";
      var titulo = (m[3] || "").trim();
      // ordinais por extenso: "LIVRO COMPLEMENTAR", "TÍTULO ÚNICO"
      if (!ord) {
        var mo = /^(COMPLEMENTAR|[ÚU]NIC[OA]|PRELIMINAR|FINAL|TRANSIT[ÓO]RI[OA])\b[\s.:-]*/i.exec(titulo);
        if (mo) { ord = mo[1].toUpperCase(); titulo = titulo.slice(mo[0].length).trim(); }
      }
      if (!titulo) {
        // o nome está no bloco seguinte ("LIVRO I" → "DAS PESSOAS")
        var nx = el.nextElementSibling, saltos = 0;
        while (nx && saltos < 3) {
          var tn = txt(nx);
          if (tn && tn.length <= 140 && !RE_ART_ANY.test(tn) && !RE_STRUCT.test(tn)) {
            titulo = letraEspacada(tn) || tn; break;
          }
          if (tn) break;
          nx = nx.nextElementSibling; saltos++;
        }
      }
      vistos.push(el);
      out.push({
        level: NIVEL[nivel],
        kw: m[1].toUpperCase(),
        ord: ord,
        title: titulo,
        label: (m[1].toUpperCase() + (ord ? " " + ord : "")).trim(),
        el: el
      });
    });
    return out;
  }

  /* --------------------------------- API -------------------------------- */
  var VMAnno = {
    init: function (opts) {
      container = opts.container;
      onDirty = opts.onDirty || function () {};
      return VMAnno;
    },
    get container() { return container; },
    buildTextMap: buildTextMap,
    createFromRange: createFromRange,
    restore: restore,
    restoreAll: restoreAll,
    styleSpans: styleSpans,
    updateMarker: updateMarker,
    spansOf: spansOf,
    idsOfSpan: idsOfSpan,
    unwrap: unwrap,
    unwrapAll: unwrapAll,
    hasComment: hasComment,
    buildArticleIndex: buildArticleIndex,
    buildStructureIndex: buildStructureIndex,
    relocate: relocate,
    notifyDirty: function () { onDirty(); }
  };

  if (root) root.VMAnno = VMAnno;
})(typeof window !== "undefined" ? window : null);
