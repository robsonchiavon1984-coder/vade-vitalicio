/* =========================================================================
   OpeLegis — palavras-chave e institutos jurídicos nas anotações
   Cada anotação (formato Lei Comentada, chave lc:page:<url>) ganha o campo
   opcional  tags: ["Prescrição intercorrente", "Boa-fé objetiva", ...].
   Este arquivo oferece, aos dois editores de comentário (o da página e o
   do Vade Mecum), o campo de etiquetas com sugestões, e os "chips" de
   exibição. A busca por etiqueta fica no módulo Estudo (estudo/).
   Índice de contagem mantido pelo background em chrome.storage.local
   ["og:tagindex"] = { "<chave normalizada>": { t: "Rótulo", n: 3 } }.
   Exposto em window.OGTags.
   ========================================================================= */
(function () {
  "use strict";
  if (window.OGTags) return;

  var IDX_KEY = "og:tagindex";

  /* Sugestões iniciais: institutos que mais aparecem nos três editais. */
  var SEMENTE = [
    "Prescrição", "Decadência", "Prescrição intercorrente", "Boa-fé objetiva", "Função social do contrato",
    "Desconsideração da personalidade jurídica", "Responsabilidade civil objetiva", "Dano moral", "Perda de uma chance",
    "Enriquecimento sem causa", "Vícios redibitórios", "Evicção", "Onerosidade excessiva", "Usucapião",
    "Direito de laje", "Alienação fiduciária", "Bem de família", "Alimentos", "União estável", "Multiparentalidade",
    "Regime de bens", "Sucessão legítima", "Herdeiro necessário", "Curatela", "Tomada de decisão apoiada",
    "Tutela de urgência", "Tutela de evidência", "Estabilização da tutela", "Negócio jurídico processual",
    "Coisa julgada", "Litisconsórcio", "Intervenção de terceiros", "Amicus curiae", "IRDR", "IAC",
    "Recurso repetitivo", "Repercussão geral", "Precedente vinculante", "Distinguishing", "Overruling",
    "Ação rescisória", "Reclamação", "Cumprimento de sentença", "Execução fiscal", "Embargos à execução",
    "Penhora", "Impenhorabilidade", "Fraude à execução", "Fraude contra credores", "Honorários advocatícios",
    "Gratuidade da justiça", "Remessa necessária", "Juizados Especiais", "Ação civil pública", "Ação popular",
    "Improbidade administrativa", "Mandado de segurança", "Controle de constitucionalidade", "Modulação de efeitos",
    "Súmula vinculante", "Competência da Justiça Federal", "Competência originária", "Federalismo",
    "Responsabilidade civil do Estado", "Poder de polícia", "Licitação", "Dispensa de licitação",
    "Inexigibilidade", "Contrato administrativo", "Concessão de serviço público", "Desapropriação",
    "Servidor público", "Estabilidade", "Processo administrativo disciplinar", "Princípio da legalidade",
    "Princípio da insignificância", "Dosimetria da pena", "Concurso de crimes", "Crime continuado",
    "Reincidência", "Prescrição penal", "Regime inicial", "Substituição da pena", "Sursis",
    "Livramento condicional", "Progressão de regime", "Remição", "Erro de tipo", "Erro de proibição",
    "Legítima defesa", "Estado de necessidade", "Tentativa", "Concurso de pessoas", "Crime hediondo",
    "Tráfico de drogas", "Lavagem de dinheiro", "Organização criminosa", "Colaboração premiada",
    "Acordo de não persecução penal", "Transação penal", "Suspensão condicional do processo",
    "Juiz das garantias", "Cadeia de custódia", "Prova ilícita", "Prisão preventiva", "Audiência de custódia",
    "Medidas protetivas de urgência", "Tribunal do Júri", "Nulidade absoluta", "Nulidade relativa",
    "Revisão criminal", "Habeas corpus", "Superendividamento", "Inversão do ônus da prova",
    "Responsabilidade pelo fato do produto", "Vício do produto", "Prática abusiva", "Publicidade enganosa",
    "Ato infracional", "Medida socioeducativa", "Adoção", "Poder familiar", "Guarda compartilhada",
    "Inelegibilidade", "Abuso de poder econômico", "Captação ilícita de sufrágio", "Recuperação judicial",
    "Falência", "Títulos de crédito", "Sociedade limitada", "Sociedade anônima", "Fato gerador",
    "Lançamento tributário", "Crédito tributário", "Imunidade tributária", "Repetição de indébito",
    "Responsabilidade tributária", "Dano ambiental", "Responsabilidade ambiental", "Licenciamento ambiental",
    "Área de preservação permanente", "Reserva legal", "Controle de convencionalidade",
    "Benefício de prestação continuada", "Qualidade de segurado", "Carência", "Aposentadoria especial",
    "Pensão por morte", "LGPD", "Pegadinha de prova"
  ];

  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function clean(s) {
    s = String(s || "").replace(/[#,;]+/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return "";
    if (s.length > 60) s = s.slice(0, 60).trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function uniq(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (t) {
      t = clean(t); var k = fold(t);
      if (!k || seen[k]) return; seen[k] = 1; out.push(t);
    });
    return out;
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  var _idx = null, _idxAt = 0;
  function loadIndex(cb) {
    if (_idx && Date.now() - _idxAt < 15000) { cb(_idx); return; }
    try {
      chrome.storage.local.get(IDX_KEY, function (o) {
        _idx = (o && o[IDX_KEY]) || {}; _idxAt = Date.now(); cb(_idx);
      });
    } catch (e) { cb({}); }
  }
  function suggestions(idx, q, exclude) {
    var ex = {}; (exclude || []).forEach(function (t) { ex[fold(t)] = 1; });
    var pool = {}, f = fold(q);
    Object.keys(idx || {}).forEach(function (k) { if (idx[k] && idx[k].n > 0) pool[k] = { t: idx[k].t, n: idx[k].n }; });
    SEMENTE.forEach(function (t) { var k = fold(t); if (!pool[k]) pool[k] = { t: t, n: 0 }; });
    return Object.keys(pool).filter(function (k) {
      return !ex[k] && (!f || k.indexOf(f) !== -1);
    }).map(function (k) { return pool[k]; }).sort(function (a, b) {
      var as = fold(a.t).indexOf(f) === 0 ? 0 : 1, bs = fold(b.t).indexOf(f) === 0 ? 0 : 1;
      return (as - bs) || (b.n - a.n) || a.t.localeCompare(b.t, "pt-BR");
    }).slice(0, 8);
  }

  /* -------------------- campo de etiquetas no editor -------------------- */
  function attachUI(popover, anno, opts) {
    if (!popover || popover.querySelector(".og-tags-field")) return;
    opts = opts || {};
    var pending = uniq((anno && anno.tags) || []);
    popover._ogPendingTags = pending;

    var field = el("div", "og-tags-field");
    var lab = el("div", "og-tags-label", "🏷️ Palavras-chave / institutos");
    var box = el("div", "og-tags-box");
    var input = el("input", "og-tags-input");
    input.type = "text";
    input.placeholder = "ex.: prescrição intercorrente — Enter para incluir";
    input.setAttribute("autocomplete", "off");
    var sug = el("div", "og-tags-sug");
    field.appendChild(lab); field.appendChild(box); field.appendChild(sug);

    function render() {
      box.innerHTML = "";
      pending.forEach(function (t, i) {
        var c = el("span", "og-tag-chip edit");
        c.appendChild(el("span", "og-tag-tx", t));
        var x = el("button", "og-tag-x", "✕"); x.type = "button"; x.title = "Remover";
        x.addEventListener("mousedown", function (e) { e.preventDefault(); });
        x.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); pending.splice(i, 1); render(); });
        c.appendChild(x); box.appendChild(c);
      });
      box.appendChild(input);
    }
    function add(t) {
      var merged = uniq(pending.concat([t]));
      pending.length = 0; Array.prototype.push.apply(pending, merged);
      input.value = ""; render(); showSug(); setTimeout(function () { input.focus(); }, 0);
    }
    function showSug() {
      loadIndex(function (idx) {
        var list = suggestions(idx, input.value, pending);
        sug.innerHTML = "";
        list.forEach(function (s) {
          var b = el("button", "og-tag-sug", s.t + (s.n ? " · " + s.n : ""));
          b.type = "button";
          b.addEventListener("mousedown", function (e) { e.preventDefault(); });
          b.addEventListener("click", function (e) { e.preventDefault(); add(s.t); });
          sug.appendChild(b);
        });
        sug.style.display = list.length ? "" : "none";
      });
    }
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
        if (input.value.trim()) { e.preventDefault(); add(input.value); }
      } else if (e.key === "Backspace" && !input.value && pending.length) {
        pending.pop(); render();
      }
    });
    input.addEventListener("input", showSug);
    input.addEventListener("focus", showSug);
    input.addEventListener("blur", function () {
      if (input.value.trim()) add(input.value);
      setTimeout(function () { sug.style.display = "none"; }, 150);
    });
    field.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    box.addEventListener("click", function () { input.focus(); });

    render();
    sug.style.display = "none";
    var before = opts.before || popover.querySelector(".lc-pop-actions, .acts");
    if (before && before.parentNode) before.parentNode.insertBefore(field, before);
    else popover.appendChild(field);
  }
  function getPending(popover) {
    if (!popover || !popover._ogPendingTags) return null;
    var input = popover.querySelector(".og-tags-input");
    var extra = input && input.value.trim() ? [input.value] : [];
    return uniq(popover._ogPendingTags.concat(extra));
  }

  /* ------------------------------ exibição ------------------------------ */
  function openSearch(tag) {
    try { chrome.runtime.sendMessage({ type: "OG_STUDY_SEARCH", tag: tag }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  }
  function chips(tags, opts) {
    opts = opts || {};
    var wrap = el("div", "og-tags-view");
    uniq(tags).forEach(function (t) {
      var c = el("span", "og-tag-chip", "🏷️ " + t);
      c.title = "Buscar todas as anotações com “" + t + "”";
      c.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); (opts.onClick || openSearch)(t); });
      wrap.appendChild(c);
    });
    return wrap;
  }
  function chipsHtml(tags) {
    return uniq(tags).map(function (t) {
      return '<span class="og-tag-chip ro">🏷️ ' + String(t).replace(/[&<>"']/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
      }) + "</span>";
    }).join("");
  }
  function viewChips(popover, anno, before) {
    if (!popover || !anno || !anno.tags || !anno.tags.length) return;
    var c = chips(anno.tags);
    var ref = before || popover.querySelector(".lc-pop-actions, .acts");
    if (ref && ref.parentNode) ref.parentNode.insertBefore(c, ref); else popover.appendChild(c);
  }

  window.OGTags = {
    attachUI: attachUI, getPending: getPending, chips: chips, chipsHtml: chipsHtml,
    viewChips: viewChips, fold: fold, clean: clean, uniq: uniq, SEMENTE: SEMENTE, IDX_KEY: IDX_KEY,
    openSearch: openSearch
  };
})();
