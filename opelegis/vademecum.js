/* =========================================================================
   Vade Mecum — OpeLegis
   Estante de leis por ramo (orelhas) + leitor da íntegra publicada no
   Planalto, com busca no texto, índice de artigos, conferência com o texto
   oficial e anotações integradas ao módulo Lei Comentada.

   Armazenamento (compartilhado com o restante da suíte):
     lc:disciplines      → ramos/disciplinas
     lc:laws             → leis cadastradas
     lc:page:<url>       → anotações por lei (formato do Lei Comentada)
     lc:vm:doc:<url>     → cache do texto oficial + hash de conferência
     lc:vm:settings      → preferências do módulo
   ========================================================================= */
(function () {
  "use strict";

  /* ======================================================================
     0. UTILIDADES
     ====================================================================== */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return window.LC ? LC.escapeHtml(s) : String(s == null ? "" : s); };
  var norm = function (u) { return window.LC ? LC.normalizeUrl(u) : u; };

  function sget(k) { return new Promise(function (r) { chrome.storage.local.get(k, r); }); }
  /* Lista as chaves SEM carregar os valores. O cache de leis pode ter dezenas
     de MB de HTML: um get(null) inocente traria tudo isso para a memória. */
  async function allKeys() {
    try {
      if (chrome.storage.local.getKeys) return await chrome.storage.local.getKeys();
    } catch (e) {}
    var all = await sget(null);
    return Object.keys(all);
  }
  function sset(o) { return new Promise(function (r) { chrome.storage.local.set(o, function () { r(); dirty(); }); }); }
  function sdel(k) { return new Promise(function (r) { chrome.storage.local.remove(k, r); }); }

  var dtm = null;
  function dirty() {
    clearTimeout(dtm);
    dtm = setTimeout(function () {
      try { chrome.runtime.sendMessage({ type: "DATA_DIRTY" }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    }, 1200);
  }

  var toastTm = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTm);
    toastTm = setTimeout(function () { t.classList.add("hidden"); }, 2800);
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    try { return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch (e) { return "—"; }
  }
  var RE_DIAC = new RegExp("[\\u0300-\\u036f]", "g");
  var RE_NBSP = new RegExp("[\\u00a0\\u2007\\u202f]", "g");
  function slug(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(RE_DIAC, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function uid() { return window.LC ? LC.uid() : ("lc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)); }

  /* ======================================================================
     1. ESTADO
     ====================================================================== */
  var disciplines = [];   // [{id,name,color,order,vmKey?,icon?}]
  var laws = [];          // [{id,title,url,notes,disciplineIds:[],orders:{},createdAt,updatedAt,vmKey?,tags?}]
  var pageCounts = {};    // urlNormalizada -> nº de anotações
  var cacheIndex = {};    // urlNormalizada -> timestamp do último download
  var settings = {};

  var ramoAtual = null;   // id da disciplina selecionada
  var busca = "";

  var cur = {             // leitura em curso
    law: null,
    doc: null,            // {url,title,html,text,hash,fetchedAt,articleCount}
    pageKey: "",
    pageData: null,       // {url,title,annotations:[],articleStars:{}}
    artIndex: [],
    structIndex: [],
    finds: [],
    findPos: -1
  };
  var pending = null;     // anotação recém-criada aguardando 1ª ação

  /* ======================================================================
     2. CARGA E SEMEADURA DO ACERVO
     ====================================================================== */
  async function loadAll() {
    var base = await sget(["lc:disciplines", "lc:laws", "lc:vm:settings", "lc:vm:cache"]);
    disciplines = Array.isArray(base["lc:disciplines"]) ? base["lc:disciplines"] : [];
    laws = Array.isArray(base["lc:laws"]) ? base["lc:laws"] : [];
    settings = base["lc:vm:settings"] || {};
    cacheIndex = base["lc:vm:cache"] || {};

    var keys = (await allKeys()).filter(function (k) { return k.indexOf("lc:page:") === 0; });
    pageCounts = {};
    if (keys.length) {
      var pages = await sget(keys);
      keys.forEach(function (k) {
        var d = pages[k] || {};
        pageCounts[k.slice("lc:page:".length)] = (d.annotations || []).length;
      });
    }
  }

  /* ------- reconhecimento do ramo pelo nome que o usuário já usa --------- */
  /* "Direito Civil" e "Civil" são o mesmo ramo; "Processual Civil" e
     "Processo Civil" também. Sem isto a semeadura cria colunas gêmeas. */
  var ALIAS = {
    constitucional: ["constitucional"],
    administrativo: ["administrativo"],
    civil: ["civil"],
    processocivil: ["processual civil", "processo civil", "proc civil"],
    penal: ["penal"],
    processopenal: ["processual penal", "processo penal", "proc penal"],
    empresarial: ["empresarial", "comercial"],
    tributario: ["tributario", "fiscal"],
    trabalho: ["trabalho", "trabalhista", "trabalho e processo do trabalho", "processo do trabalho"],
    previdenciario: ["previdenciario", "previdencia", "previdenciario e assistencia", "seguridade social"],
    consumidor: ["consumidor"],
    ambiental: ["ambiental", "ambiental e urbanistico", "urbanistico"],
    agrario: ["agrario"],
    eleitoral: ["eleitoral"],
    estatutos: ["estatutos", "estatutos e vulneraveis"],
    difusos: ["difusos", "difusos e coletivos", "coletivos"],
    humanos: ["humanos", "direitos humanos", "internacional e direitos humanos", "internacional"],
    registros: ["registros", "registros publicos", "registros publicos e notarial", "notarial"],
    financeiro: ["financeiro", "financeiro e economico", "economico"],
    militar: ["militar"],
    digital: ["digital", "digital e protecao de dados", "protecao de dados"],
    judiciaria: ["judiciaria", "organizacao judiciaria", "organizacao judiciaria e carreiras"]
  };
  function ramoSlug(name) {
    return slug(name).replace(/^direito\s+/, "").trim();
  }
  function ramoKeyOf(name) {
    var s = ramoSlug(name);
    if (!s) return null;
    var hit = null;
    Object.keys(ALIAS).forEach(function (k) {
      if (hit) return;
      if (ALIAS[k].indexOf(s) !== -1) hit = k;
    });
    return hit;
  }
  function findDiscFor(key) {
    var byKey = disciplines.filter(function (d) { return d.vmKey === key; })[0];
    if (byKey) return byKey;
    return disciplines.filter(function (d) { return ramoKeyOf(d.name) === key; })[0] || null;
  }

  /* Semeadura aditiva: acrescenta só o que faltar; nunca apaga nada. */
  async function seedCatalog(force) {
    if (!window.VMCAT) return { d: 0, l: 0 };
    var addedD = 0, addedL = 0;
    var maxOrder = disciplines.reduce(function (m, d) { return Math.max(m, d.order || 0); }, 0);

    VMCAT.RAMOS.forEach(function (r) {
      var found = findDiscFor(r.key);
      if (found) {
        // adota a coluna que o usuário já tinha, preservando o nome dele
        if (!found.vmKey) found.vmKey = r.key;
        if (!found.icon) found.icon = r.icon;
        if (!found.color) found.color = r.color;
        return;
      }
      maxOrder += 1;
      disciplines.push({ id: "vmd-" + r.key, name: r.name, color: r.color, order: maxOrder, vmKey: r.key, icon: r.icon });
      addedD++;
    });

    var byUrl = {};
    laws.forEach(function (l) { try { byUrl[norm(l.url)] = l; } catch (e) {} });

    VMCAT.LEIS.forEach(function (L) {
      var discIds = L.r.map(function (k) {
        var d = findDiscFor(k);
        return d ? d.id : null;
      }).filter(Boolean);

      var ex = byUrl[norm(L.u)] || laws.filter(function (x) { return x.vmKey === L.k; })[0];
      if (ex) {
        if (!ex.vmKey) ex.vmKey = L.k;
        if (!ex.tags) ex.tags = L.s || "";
        if (force) {
          discIds.forEach(function (id) {
            ex.disciplineIds = ex.disciplineIds || [];
            if (ex.disciplineIds.indexOf(id) === -1) ex.disciplineIds.push(id);
          });
        }
        return;
      }
      laws.push({
        id: "vml-" + L.k, title: L.t, url: L.u, notes: "",
        disciplineIds: discIds, orders: {}, tags: L.s || "", vmKey: L.k,
        createdAt: Date.now(), updatedAt: Date.now()
      });
      addedL++;
    });

    if (addedD || addedL || force) {
      await sset({ "lc:disciplines": disciplines, "lc:laws": laws });
    }
    return { d: addedD, l: addedL };
  }

  /* ======================================================================
     3. ESTANTE (orelhas + lista de leis)
     ====================================================================== */
  function ordered() {
    return disciplines.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  function lawsOf(discId) {
    return laws.filter(function (l) {
      return discId === "" ? !(l.disciplineIds || []).length : (l.disciplineIds || []).indexOf(discId) !== -1;
    }).sort(function (a, b) { return (a.title || "").localeCompare(b.title || "", "pt-BR"); });
  }
  function matches(l) {
    if (!busca) return true;
    var hay = slug((l.title || "") + " " + (l.tags || "") + " " + (l.url || "") + " " + (l.notes || ""));
    return slug(busca).split(" ").every(function (w) { return !w || hay.indexOf(w) !== -1; });
  }
  function countOf(l) { try { return pageCounts[norm(l.url)] || 0; } catch (e) { return 0; } }

  function renderShelf() {
    var nav = $("#orelhas");
    var keepScroll = nav.scrollTop;      // não perder o lugar na fileira de orelhas
    nav.innerHTML = "";
    var list = ordered();

    if (!ramoAtual || !list.filter(function (d) { return d.id === ramoAtual; }).length) {
      ramoAtual = list.length ? list[0].id : null;
    }

    list.forEach(function (d) {
      var n = lawsOf(d.id).filter(matches).length;
      var b = document.createElement("button");
      b.className = "orelha" + (d.id === ramoAtual ? " on" : "");
      b.style.background = d.color || "#475569";
      b.title = d.name + " — " + n + " lei(s)";
      b.innerHTML = esc(d.name) + ' <span class="n">' + n + "</span>";
      b.onclick = function () {
        ramoAtual = d.id;
        // grava na hora: o beforeunload não é confiável dentro do iframe da barra
        settings.lastRamo = d.id;
        sset({ "lc:vm:settings": settings });
        renderShelf();
        $("#pagina").scrollTop = 0;
      };
      nav.appendChild(b);
    });

    var semDisc = laws.filter(function (l) { return !(l.disciplineIds || []).length; });
    if (semDisc.length) {
      var b2 = document.createElement("button");
      b2.className = "orelha" + (ramoAtual === "" ? " on" : "");
      b2.style.background = "#8a8578";
      b2.innerHTML = "Sem ramo " + '<span class="n">' + semDisc.length + "</span>";
      b2.onclick = function () { ramoAtual = ""; renderShelf(); };
      nav.appendChild(b2);
    }

    nav.scrollTop = keepScroll;
    var on = nav.querySelector(".orelha.on");
    if (on && (on.offsetTop < nav.scrollTop || on.offsetTop + on.offsetHeight > nav.scrollTop + nav.clientHeight)) {
      on.scrollIntoView({ block: "nearest" });
    }
    renderPagina();
  }

  function renderPagina() {
    var d = disciplines.filter(function (x) { return x.id === ramoAtual; })[0] ||
            { name: "Sem ramo", color: "#8a8578" };
    var items = lawsOf(ramoAtual).filter(matches);

    $("#paginaHead").innerHTML =
      "<h2>" + esc(d.name) + "</h2>" +
      '<div class="sub">' + items.length + " diploma(s)" + (busca ? " · filtro: “" + esc(busca) + "”" : "") + "</div>" +
      '<div class="rule" style="background:' + (d.color || "#8a8578") + '"></div>';

    var box = $("#lawList");
    box.innerHTML = "";
    if (!items.length) {
      box.innerHTML = '<div class="empty">' +
        (busca ? "Nenhuma lei encontrada neste ramo." : "Nenhuma lei cadastrada aqui. Use ＋ para incluir.") +
        "</div>";
      return;
    }

    items.forEach(function (l) {
      var n = countOf(l);
      var card = document.createElement("div");
      card.className = "lawcard";
      card.style.borderLeftColor = d.color || "#b58b3a";
      card.innerHTML =
        '<div class="t">' + esc(l.title) + "</div>" +
        '<div class="m">' +
          '<span class="pill">' + esc(hostOf(l.url)) + "</span>" +
          (n ? '<span class="pill note">✍️ ' + n + "</span>" : "") +
          '<span class="pill cache" data-cache="' + esc(norm(l.url)) + '" hidden></span>' +
        "</div>" +
        '<button class="gear" title="Editar / remover">⋯</button>';
      card.onclick = function (e) {
        if (e.target.classList.contains("gear")) { e.stopPropagation(); lawMenu(l, e); return; }
        openLaw(l);
      };
      box.appendChild(card);
    });

    markCached();
  }

  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u || "—"; } }

  function markCached() {
    $$("[data-cache]").forEach(function (el) {
      var at = cacheIndex[el.getAttribute("data-cache")];
      if (at) { el.textContent = "⬇ " + fmtDate(at); el.hidden = false; }
    });
  }

  /* ======================================================================
     4. CRUD DE LEIS
     ====================================================================== */
  function lawMenu(l, ev) {
    openMenu(ev.clientX, ev.clientY, [
      { t: "✏️ Editar lei", f: function () { lawModal(l); } },
      { t: "🌐 Abrir no Portal da Legislação (nova aba)", f: function () { chrome.tabs.create({ url: LC.toPortalUrl ? LC.toPortalUrl(l.url) : l.url }); } },
      { t: "🏛 Abrir no layout clássico do Planalto", f: function () { chrome.tabs.create({ url: LC.toPlanaltoUrl ? LC.toPlanaltoUrl(l.url) : l.url }); } },
      { t: "🔄 Recarregar o texto oficial", f: function () { openLaw(l, true); } },
      { t: "🔊 Ouvir no Leitor em Voz", f: function () { openLaw(l).then(function () { setTimeout(speakFromView, 300); }); } },
      { hr: true },
      { t: "🗑️ Remover do vade mecum", f: function () { removeLaw(l); } }
    ]);
  }

  function lawModal(l) {
    var isNew = !l;
    l = l || { id: "", title: "", url: "", notes: "", disciplineIds: ramoAtual ? [ramoAtual] : [], tags: "" };
    var opts = ordered().map(function (d) {
      var on = (l.disciplineIds || []).indexOf(d.id) !== -1;
      return '<label class="chk"><input type="checkbox" value="' + d.id + '"' + (on ? " checked" : "") + ">" + esc(d.name) + "</label>";
    }).join("");

    showModal(isNew ? "Cadastrar lei" : "Editar lei",
      '<label>Título</label><input id="mTitle" type="text" value="' + esc(l.title) + '" placeholder="Ex.: Lei 14.133/2021 — Licitações">' +
      '<label>URL oficial (Planalto)</label><input id="mUrl" type="text" value="' + esc(l.url) + '" placeholder="https://www.planalto.gov.br/ccivil_03/...">' +
      '<label>Apelidos para busca</label><input id="mTags" type="text" value="' + esc(l.tags || "") + '" placeholder="CPC, processo civil, ...">' +
      '<label>Ramos</label><div id="mDiscs">' + opts + "</div>",
      [
        { t: "Cancelar", f: closeModal },
        { t: isNew ? "Cadastrar" : "Salvar", primary: true, f: async function () {
            var title = $("#mTitle").value.trim();
            var url = $("#mUrl").value.trim();
            if (!title || !url) { toast("Informe o título e a URL."); return; }
            if (!/^https?:\/\//i.test(url)) url = "https://" + url;
            var ids = $$("#mDiscs input:checked").map(function (i) { return i.value; });
            if (isNew) {
              laws.push({ id: uid(), title: title, url: url, notes: "", tags: $("#mTags").value.trim(),
                          disciplineIds: ids, orders: {}, createdAt: Date.now(), updatedAt: Date.now() });
            } else {
              var t = laws.filter(function (x) { return x.id === l.id; })[0];
              if (t) { t.title = title; t.url = url; t.tags = $("#mTags").value.trim(); t.disciplineIds = ids; t.updatedAt = Date.now(); }
            }
            await sset({ "lc:laws": laws });
            closeModal(); renderShelf(); toast(isNew ? "Lei cadastrada ✔" : "Lei atualizada ✔");
          } }
      ]);
    setTimeout(function () { var el = $("#mTitle"); if (el) el.focus(); }, 40);
  }

  function removeLaw(l) {
    showModal("Remover lei",
      '<div class="hint">Remover <b>' + esc(l.title) + '</b> do vade mecum?<br><br>' +
      "As anotações já feitas <b>não</b> serão apagadas — continuam guardadas e reaparecem se a lei for cadastrada de novo ou se você abrir a página no Planalto.</div>",
      [
        { t: "Cancelar", f: closeModal },
        { t: "Remover", danger: true, f: async function () {
            laws = laws.filter(function (x) { return x.id !== l.id; });
            // o texto baixado sai junto: senão, recadastrar a lei traria o
            // mesmo conteúdo velho de volta do cache
            var nu = norm(l.url);
            delete cacheIndex[nu];
            await sdel("lc:vm:doc:" + nu);
            await sset({ "lc:laws": laws, "lc:vm:cache": cacheIndex });
            closeModal(); renderShelf(); toast("Lei removida.");
          } }
      ]);
  }

  /* ======================================================================
     5. LEITOR — obtenção e extração do texto oficial
     ====================================================================== */
  function fetchRaw(url) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage({ type: "OG_FETCH_URL", url: url }, function (r) {
          void chrome.runtime.lastError;
          if (r && r.ok) resolve(r.text);
          else reject(new Error((r && r.error) || "sem resposta do serviço de rede"));
        });
      } catch (e) { reject(e); }
    });
  }

  var RE_ART = /\bArt(?:igo)?\.?\s*\d/gi;
  function artCount(el) { var m = (el.textContent || "").match(RE_ART); return m ? m.length : 0; }

  function extractDoc(rawHtml, baseUrl) {
    var doc = new DOMParser().parseFromString(rawHtml || "", "text/html");
    var kill = "script,style,noscript,iframe,object,embed,form,input,button,select,textarea,link,meta,svg,video,audio,map,area";
    doc.querySelectorAll(kill).forEach(function (e) { e.remove(); });
    var body = doc.body;
    if (!body) return null;

    /* Portal da Legislação (2026): o texto fica em <main id="conteudo">,
       ao lado de um <nav class="sumario"> que também cita artigos. */
    var portalMain = doc.querySelector("main#conteudo") || doc.querySelector("div.texto");
    if (portalMain) {
      portalMain.querySelectorAll("nav.sumario, .sumario, .barra-acessibilidade, header, footer").forEach(function (e) { e.remove(); });
      body = portalMain;
    }

    // escolhe o menor bloco que ainda contém praticamente todos os artigos
    // (no portal, fica o <main> inteiro: assim entram a epígrafe e a ementa)
    var total = artCount(body);
    var best = body, bestLen = (body.textContent || "").length;
    if (total >= 3 && !portalMain) {
      Array.prototype.forEach.call(body.querySelectorAll("div,td,table,article,section,main,center,blockquote"), function (el) {
        if (artCount(el) < total * 0.92) return;
        var len = (el.textContent || "").length;
        if (len < bestLen && len > 400) { best = el; bestLen = len; }
      });
    }

    // limpeza de atributos e links.
    // width/height só saem de elementos de LAYOUT (tabelas antigas do Planalto,
    // que travam a largura em 800px). Em <img> eles têm de ficar: o brasão vem
    // com width=74 height=82 e, sem isso, renderiza no tamanho natural (463px).
    best.querySelectorAll("*").forEach(function (el) {
      var isImg = el.tagName === "IMG";
      Array.prototype.slice.call(el.attributes).forEach(function (at) {
        var n = at.name.toLowerCase();
        if (n.indexOf("on") === 0) el.removeAttribute(at.name);
        if (n === "bgcolor" || n === "background") el.removeAttribute(at.name);
        if (!isImg && (n === "width" || n === "height")) el.removeAttribute(at.name);
      });
      if (el.style && !isImg) { el.style.width = ""; el.style.height = ""; el.style.position = ""; el.style.background = ""; }
    });
    best.querySelectorAll("[href]").forEach(function (a) {
      var h = a.getAttribute("href") || "";
      if (/^\s*javascript:/i.test(h)) { a.removeAttribute("href"); return; }
      if (h.charAt(0) === "#") { a.setAttribute("data-vm-anchor", h.slice(1)); a.removeAttribute("href"); return; }
      try { a.setAttribute("href", new URL(h, baseUrl).href); a.setAttribute("target", "_blank"); a.setAttribute("rel", "noreferrer noopener"); }
      catch (e) { a.removeAttribute("href"); }
    });
    best.querySelectorAll("[src]").forEach(function (im) {
      try { im.setAttribute("src", new URL(im.getAttribute("src"), baseUrl).href); } catch (e) { im.remove(); }
    });

    return { html: best.innerHTML, title: (doc.title || "").trim() };
  }

  function plainOf(html) {
    var d = new DOMParser().parseFromString(html || "", "text/html");
    return (d.body.textContent || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }
  async function sha256(s) {
    try {
      var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    } catch (e) { return ""; }
  }

  /* Versão do cache. Ao subir este número, todo texto guardado é rebaixado na
     próxima abertura — foi assim que os textos corrompidos em UTF-16 saíram do
     ar sem o usuário ter de limpar nada na mão. */
  var CACHE_V = 4;   // 3 = textos do Portal da Legislação; 4 = com epígrafe e ementa

  async function getDoc(url, force) {
    var key = "lc:vm:doc:" + norm(url);
    if (!force) {
      var o = await sget(key);
      if (o[key] && o[key].html && o[key].v === CACHE_V) return o[key];
    }
    /* Fonte preferida: Portal da Legislação. Se falhar (alguns endereços
       antigos não existem lá), tenta o layout clássico do Planalto. */
    var fontes = [];
    var portal = window.LC && LC.toPortalUrl ? LC.toPortalUrl(url) : url;
    fontes.push(portal);
    if (portal !== url) fontes.push(url);
    var classico = window.LC && LC.toPlanaltoUrl ? LC.toPlanaltoUrl(url) : url;
    if (fontes.indexOf(classico) === -1) fontes.push(classico);
    var raw = null, ex = null, fonte = url, ultimoErro = null;
    for (var fi = 0; fi < fontes.length; fi++) {
      try {
        raw = await fetchRaw(fontes[fi]);
        ex = extractDoc(raw, fontes[fi]);
        if (ex && ex.html && ex.html.length >= 200 && artCount(new DOMParser().parseFromString(ex.html, "text/html").body) > 0) { fonte = fontes[fi]; break; }
        if (ex && ex.html && ex.html.length >= 200 && fi === fontes.length - 1) { fonte = fontes[fi]; break; }
        ex = null;
      } catch (err) { ultimoErro = err; ex = null; }
    }
    if (!ex || !ex.html || ex.html.length < 200) throw (ultimoErro || new Error("não foi possível extrair o texto desta página"));
    var text = plainOf(ex.html);

    /* Rede de segurança contra codificação errada: se sobrou muito caractere
       de substituição, ou se o "texto" ainda é código-fonte, não guarda nada. */
    var lixo = (text.match(/�/g) || []).length;
    if (lixo > 20 || /<\s*�?\s*(html|head|body)\b/i.test(text.slice(0, 400))) {
      throw new Error("o site devolveu esta página com a codificação corrompida");
    }

    var doc = {
      v: CACHE_V,
      url: url, source: fonte, title: ex.title, html: ex.html, text: text,
      hash: await sha256(text), fetchedAt: Date.now(),
      articleCount: (text.match(RE_ART) || []).length
    };
    var prevO = await sget(key);
    var prev = prevO[key];
    cacheIndex[norm(url)] = doc.fetchedAt;
    var save = {}; save[key] = doc; save["lc:vm:cache"] = cacheIndex;
    await sset(save);

    // dados transitórios (não persistidos): servem só para o aviso de mudança
    var out = Object.assign({}, doc);
    out.prevHash = prev ? (prev.hash || "") : "";
    out.prevAt = prev ? (prev.fetchedAt || 0) : 0;
    out.justFetched = true;
    return out;
  }

  /* ------------------------ anotações da lei em foco -------------------- */
  function pageKeyCandidates(url) {
    var keys = ["lc:page:" + norm(url)];
    try {
      var u = new URL(url);
      var bare = u.hostname.replace(/^www\./, "");
      var hosts = [u.hostname, bare, "www." + bare];
      var paths = [u.pathname];
      if (/\/$/.test(u.pathname)) paths.push(u.pathname.replace(/\/+$/, "")); else paths.push(u.pathname + "/");
      ["https://", "http://"].forEach(function (pr) {
        hosts.forEach(function (h) { paths.forEach(function (p) { keys.push("lc:page:" + pr + h + p + (u.search || "")); }); });
      });
    } catch (e) {}
    return keys.filter(function (k, i) { return keys.indexOf(k) === i; });
  }

  async function loadPageData(law) {
    var PK = "lc:page:" + norm(law.url);
    var obj = await sget(pageKeyCandidates(law.url));
    var base = obj[PK] || { url: law.url, title: law.title, annotations: [] };
    var byId = {};
    (base.annotations || []).forEach(function (a) { byId[a.id] = a; });
    Object.keys(obj).forEach(function (k) {
      if (k === PK) return;
      var d = obj[k];
      if (d && d.annotations) d.annotations.forEach(function (a) {
        if (!byId[a.id] || (a.updatedAt || 0) > (byId[a.id].updatedAt || 0)) byId[a.id] = a;
      });
      if (d && d.articleStars && !base.articleStars) base.articleStars = d.articleStars;
    });
    base.annotations = Object.keys(byId).map(function (id) { return byId[id]; });
    if (!base.articleStars) base.articleStars = {};
    cur.pageKey = PK;
    return base;
  }

  async function savePage() {
    if (!cur.pageData || !cur.law) return;
    cur.pageData.updatedAt = Date.now();
    cur.pageData.url = cur.law.url;
    cur.pageData.title = cur.law.title;
    var o = {}; o[cur.pageKey] = cur.pageData;
    await sset(o);
    pageCounts[norm(cur.law.url)] = cur.pageData.annotations.length;
    // se a mesma lei estiver aberta numa aba, o Lei Comentada recarrega na hora
    try {
      chrome.runtime.sendMessage({ type: "OG_VM_SAVED", url: cur.law.url }, function () { void chrome.runtime.lastError; });
    } catch (e) {}
  }

  /* ------------------------------ abertura ------------------------------ */
  async function openLaw(law, force) {
    cur.law = law;
    cur.doc = null;
    cur.artIndex = [];
    cur.structIndex = [];
    pending = null;
    cur.finds = []; cur.findPos = -1;
    setView("reader");
    // estado limpo: nada da lei anterior pode sobrar na tela
    closeFind();
    $("#indexPane").hidden = true; $("#btnIndex").classList.remove("on");
    $("#notesPane").hidden = true; $("#btnNotes").classList.remove("on");
    hideAnnobar(); hidePopover();
    $("#crumb").textContent = law.title;
    $("#lawtext").innerHTML = "";
    $("#loading").hidden = false;
    status('<span class="warn">Abrindo…</span>');

    try {
      cur.pageData = await loadPageData(law);
      var doc = await getDoc(law.url, force);
      cur.doc = doc;

      $("#lawtext").innerHTML = doc.html;
      $("#loading").hidden = true;

      VMAnno.init({ container: $("#lawtext"), onDirty: dirty });
      cur.artIndex = VMAnno.buildArticleIndex();
      cur.structIndex = VMAnno.buildStructureIndex();
      indexMode = cur.structIndex.length ? "estrutura" : "artigos";
      tagArticles();
      var ok = VMAnno.restoreAll(cur.pageData.annotations);
      if (VMAnno.lastResolved) { savePage(); }
      wireReaderEvents();
      renderStatus(ok);
      $("#reader").scrollTop = 0;
    } catch (e) {
      $("#loading").hidden = true;
      $("#lawtext").innerHTML =
        '<p style="text-align:center;color:#8d2020"><b>Não foi possível carregar o texto oficial.</b><br>' +
        '<small>' + esc(String(e.message || e)) + "</small></p>" +
        '<p style="text-align:center">' +
          '<button class="btn" id="vmRetry">Tentar de novo</button> ' +
          '<button class="btn" id="vmFix">Corrigir a URL</button> ' +
          '<button class="btn" id="vmSearch">Procurar no Planalto</button>' +
        "</p>" +
        '<p style="text-align:center"><a href="' + esc(law.url) + '" target="_blank" rel="noreferrer noopener">' + esc(law.url) + "</a></p>";
      status('<span class="err">Falha ao carregar.</span>');
      $("#vmSearch").textContent = "Procurar no Portal da Legislação";
      $("#vmRetry").onclick = function () { openLaw(law, true); };
      $("#vmFix").onclick = function () { lawModal(law); };
      $("#vmSearch").onclick = function () {
        chrome.tabs.create({ url: "https://legislacao.presidencia.gov.br/" });
      };
    }
  }

  function tagArticles() {
    cur.artIndex.forEach(function (a) {
      if (a.el && !a.el.id) a.el.id = "vm-art-" + a.num;
      if (a.el) a.el.classList.add("vm-art-anchor");
    });
  }

  function status(html) { $("#statusbar").innerHTML = html; }

  function renderStatus(restored) {
    var d = cur.doc;
    var mudou = d.justFetched && d.prevHash && d.prevHash !== d.hash;
    var parts = [];
    parts.push(mudou
      ? '<span class="warn">⚠ o texto oficial mudou desde ' + fmtDate(d.prevAt) + "</span>"
      : '<span class="ok">✔ íntegra oficial</span>');
    parts.push(hostOf(d.source || d.url) + " · " + fmtDate(d.fetchedAt));
    parts.push(cur.artIndex.length + " art.");
    if (cur.structIndex.length) parts.push(cur.structIndex.length + " divisões");
    if (cur.pageData.annotations.length) {
      parts.push("✍️ " + restored + "/" + cur.pageData.annotations.length);
    }
    parts.push('<a id="lnkCheck">conferir agora</a>');
    status(parts.join(" · "));
    var lk = $("#lnkCheck");
    if (lk) lk.onclick = function () { openLaw(cur.law, true); };
  }

  /* ======================================================================
     6. NAVEGAÇÃO ENTRE AS DUAS TELAS
     ====================================================================== */
  function setView(v) {
    var reader = v === "reader";
    $("#viewShelf").hidden = reader;
    $("#viewReader").hidden = !reader;
    // no leitor, a marca some: a lei ocupa a linha inteira do cabeçalho
    $("#top").classList.toggle("reading", reader);
    $("#brand").classList.toggle("hidden", reader);
    $("#searchbar").classList.toggle("hidden", reader);
    $("#btnBack").classList.toggle("hidden", !reader);
    $("#btnFind").classList.toggle("hidden", !reader);
    $("#btnIndex").classList.toggle("hidden", !reader);
    $("#btnNotes").classList.toggle("hidden", !reader);
    $("#btnSpeak").classList.toggle("hidden", !reader);
    $("#btnAdd").classList.toggle("hidden", reader);
    if (!reader) {
      $("#crumb").textContent = "";
      closeFind(); $("#indexPane").hidden = true; $("#notesPane").hidden = true;
      hideAnnobar(); hidePopover();
      cur.law = null; cur.doc = null;
      renderShelf();
    }
  }

  /* ======================================================================
     7. BUSCA NO TEXTO (estilo Ctrl+F)
     ====================================================================== */
  function clearFinds() {
    var box = $("#lawtext");
    box.querySelectorAll("span.vm-find").forEach(function (sp) {
      var p = sp.parentNode; if (!p) return;
      while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
      p.removeChild(sp);
    });
    box.normalize();
    cur.finds = []; cur.findPos = -1;
    $("#fcount").textContent = "0/0";
  }

  function foldText(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(RE_DIAC, "");
  }

  function runFind(q) {
    clearFinds();
    q = (q || "").trim();
    if (q.length < 2) return;

    var jump = /^art(?:igo)?\.?\s*(\d+)/i.exec(q);
    if (jump) { gotoArticle(parseInt(jump[1], 10)); }

    var built = VMAnno.buildTextMap();
    var hay = foldText(built.full);
    var needle = foldText(q);
    if (!needle) return;

    var hits = [], i = hay.indexOf(needle);
    while (i !== -1 && hits.length < 500) { hits.push(i); i = hay.indexOf(needle, i + needle.length); }
    if (!hits.length) { $("#fcount").textContent = "0/0"; return; }

    // envolve de trás para frente: preserva os offsets ainda não processados
    var spansByHit = [];
    for (var h = hits.length - 1; h >= 0; h--) {
      var s = hits[h], e = s + needle.length;
      var segs = [];
      for (var m = 0; m < built.map.length; m++) {
        var en = built.map[m];
        if (en.end <= s) continue;
        if (en.start >= e) break;
        var a = Math.max(s, en.start) - en.start, b = Math.min(e, en.end) - en.start;
        if (b > a) segs.push({ node: en.node, s: a, e: b });
      }
      var made = [];
      for (var k = segs.length - 1; k >= 0; k--) {
        try {
          var r = document.createRange();
          r.setStart(segs[k].node, segs[k].s);
          r.setEnd(segs[k].node, segs[k].e);
          var sp = document.createElement("span");
          sp.className = "vm-find";
          r.surroundContents(sp);
          made.unshift(sp);
        } catch (err) {}
      }
      if (made.length) spansByHit.unshift(made[0]);
    }

    cur.finds = spansByHit;
    cur.findPos = -1;
    $("#fcount").textContent = cur.finds.length ? "0/" + cur.finds.length : "0/0";
    if (cur.finds.length) stepFind(1);
  }

  function stepFind(dir) {
    if (!cur.finds.length) return;
    if (cur.findPos >= 0 && cur.finds[cur.findPos]) cur.finds[cur.findPos].classList.remove("cur");
    cur.findPos = (cur.findPos + dir + cur.finds.length) % cur.finds.length;
    var el = cur.finds[cur.findPos];
    if (el) {
      el.classList.add("cur");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    $("#fcount").textContent = (cur.findPos + 1) + "/" + cur.finds.length;
  }

  function openFind() {
    $("#findbar").hidden = false;
    $("#btnFind").classList.add("on");
    var el = $("#fq"); el.focus(); el.select();
  }
  function closeFind() {
    $("#findbar").hidden = true;
    $("#btnFind").classList.remove("on");
    clearFinds();
  }

  /* ======================================================================
     8. ÍNDICE DE ARTIGOS
     ====================================================================== */
  function gotoArticle(num) {
    var a = cur.artIndex.filter(function (x) { return x.num === num; })[0];
    if (!a || !a.el) { toast("Art. " + num + " não localizado."); return; }
    a.el.scrollIntoView({ block: "start", behavior: "smooth" });
    a.el.style.transition = "background .2s";
    a.el.style.background = "#fff2a8";
    setTimeout(function () { a.el.style.background = ""; }, 1400);
  }

  var indexMode = "estrutura";     // "estrutura" | "artigos"

  function setIndexMode(m) {
    indexMode = m;
    $("#modeEstrutura").classList.toggle("on", m === "estrutura");
    $("#modeArtigos").classList.toggle("on", m === "artigos");
    $("#iq").placeholder = m === "artigos" ? "nº do artigo…" : "filtrar por título…";
    renderIndex();
  }

  function scrollToEl(el) {
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    var prev = el.style.background;
    el.style.transition = "background .2s";
    el.style.background = "#fff2a8";
    setTimeout(function () { el.style.background = prev || ""; }, 1400);
    $("#indexPane").hidden = true;
    $("#btnIndex").classList.remove("on");
  }

  function renderIndex() {
    if (indexMode === "estrutura" && !cur.structIndex.length) indexMode = "artigos";
    $("#modeEstrutura").disabled = !cur.structIndex.length;
    $("#modeEstrutura").classList.toggle("on", indexMode === "estrutura");
    $("#modeArtigos").classList.toggle("on", indexMode === "artigos");

    var box = $("#indexList");
    box.innerHTML = "";
    var f = slug($("#iq").value);

    /* ---------------------------- estrutura ---------------------------- */
    if (indexMode === "estrutura") {
      var nodes = cur.structIndex.filter(function (s) {
        return !f || slug(s.label + " " + s.title).indexOf(f) !== -1;
      });
      if (!nodes.length) {
        box.innerHTML = '<div class="empty">' +
          (cur.structIndex.length ? "Nada encontrado." : "Esta lei não tem divisão em livros ou capítulos.") + "</div>";
        return;
      }
      nodes.forEach(function (s) {
        var b = document.createElement("button");
        b.className = "idx-node lv" + s.level;
        b.innerHTML = '<span class="k">' + esc(s.label) + "</span>" +
                      (s.title ? '<span class="t">' + esc(s.title) + "</span>" : "");
        b.onclick = function () { scrollToEl(s.el); };
        box.appendChild(b);
      });
      return;
    }

    /* ----------------------------- artigos ------------------------------ */
    var stars = (cur.pageData && cur.pageData.articleStars) || {};
    var notesByArt = {};
    (cur.pageData ? cur.pageData.annotations : []).forEach(function (a) {
      var n = window.LC ? LC.articleNum(a.article) : 0;
      if (n) notesByArt[n] = (notesByArt[n] || 0) + 1;
    });

    var digits = f.replace(/\D/g, "");
    var list = cur.artIndex.filter(function (a) { return !digits || String(a.num).indexOf(digits) === 0; });
    if (!list.length) { box.innerHTML = '<div class="empty">Nada encontrado.</div>'; return; }

    list.forEach(function (a) {
      var b = document.createElement("button");
      b.className = "idx-item";
      b.innerHTML =
        '<span class="st" title="Marcar artigo">' + (stars[a.num] ? "★" : "☆") + "</span>" +
        "<span>" + esc(a.label) + "</span>" +
        (notesByArt[a.num] ? '<span class="c">✍️ ' + notesByArt[a.num] + "</span>" : "");
      b.onclick = function (e) {
        if (e.target.classList.contains("st")) {
          e.stopPropagation();
          if (stars[a.num]) delete stars[a.num]; else stars[a.num] = true;
          cur.pageData.articleStars = stars;
          savePage(); renderIndex();
          return;
        }
        scrollToEl(a.el);
      };
      box.appendChild(b);
    });
  }

  /* ======================================================================
     9. PAINEL DE ANOTAÇÕES
     ====================================================================== */
  function renderNotes() {
    var f = slug($("#nq").value);
    var box = $("#notesList");
    box.innerHTML = "";
    var list = (cur.pageData ? cur.pageData.annotations : []).filter(function (a) { return a && a.anchor; })
      .slice().sort(function (a, b) { return (a.anchor.start || 0) - (b.anchor.start || 0); });
    if (f) list = list.filter(function (a) {
      return slug((a.anchor.exact || "") + " " + (window.LC ? LC.stripHtml(a.comment) : "") + " " + (a.article || "") + " " + (a.tags || []).join(" ")).indexOf(f) !== -1;
    });
    if (!list.length) {
      box.innerHTML = '<div class="empty">Nenhuma anotação nesta lei ainda.<br>Selecione um trecho no texto para começar.</div>';
      return;
    }
    var total = list.length;
    list = list.slice(0, notasLim || 150);
    list.forEach(function (a) {
      var c = LC.cat(a.category);
      var d = document.createElement("div");
      d.className = "note-item";
      d.innerHTML =
        '<div class="h"><span class="badge" style="background:' + c.color + '">' + c.letter + "</span>" +
        "<span>" + esc(a.article || "—") + "</span>" +
        (a.importance ? "<span>" + "★".repeat(a.importance) + "</span>" : "") + "</div>" +
        '<div class="q">“' + esc(LC.truncate(a.anchor.exact || "", 160)) + "”</div>" +
        (VMAnno.hasComment(a) ? '<div class="c">' + LC.sanitizeHtml(a.comment) + "</div>" : "") +
        ((a.tags && a.tags.length && window.OGTags) ? '<div class="og-tags-view">' + OGTags.chipsHtml(a.tags) + "</div>" : "");
      d.onclick = function () {
        var sp = VMAnno.spansOf(a.id)[0];
        if (sp) { sp.scrollIntoView({ block: "center", behavior: "smooth" }); openPopover(a.id, sp, false); }
        else toast("Trecho não localizado no texto atual.");
      };
      box.appendChild(d);
    });
    if (total > list.length) {
      var mais = document.createElement("button");
      mais.className = "btn"; mais.style.margin = "8px auto"; mais.style.display = "block";
      mais.textContent = "Mostrar mais (" + (total - list.length) + " restantes)";
      mais.onclick = function () { notasLim = list.length + 300; renderNotes(); };
      box.appendChild(mais);
    }
  }
  var notasLim = 0;

  /* ======================================================================
     10. ANOTAÇÃO — barra flutuante e editor
     ====================================================================== */
  var HL = ["#ffe83d", "#b6f53a", "#52ef76", "#2fe9bf", "#37d6ff", "#5aa8ff", "#9d8cff", "#d182ff", "#ff77df", "#ff8a66", "#ffbe3d"];
  var FG = ["#e11d2e", "#ec5800", "#9a6a00", "#12a23a", "#009e8e", "#0a8fd6", "#1f5bff", "#5436e0", "#8b1fe0", "#c01b8f", "#1f2430"];

  /* Anotação recém-criada fica "pendente": aparece na tela, mas só entra no
     acervo quando você escolhe uma cor ou escreve um comentário. Sem isso,
     todo duplo-clique (que seleciona uma palavra) deixava para trás uma
     anotação sem cor e sem texto — invisível, mas contada. */
  function firmarPendente() {
    if (!pending) return;
    cur.pageData.annotations.push(pending);
    pending = null;
  }
  function descartarPendente() {
    if (!pending) return;
    VMAnno.unwrap(pending.id);
    pending = null;
  }
  function annoById(id) {
    if (pending && pending.id === id) return pending;
    return (cur.pageData.annotations || []).filter(function (a) { return a.id === id; })[0];
  }

  function showAnnobar(rect, anno) {
    var bar = $("#annobar");
    var h = HL.map(function (c) { return '<button class="sw" data-bg="' + c + '" style="background:' + c + '" title="Marca-texto"></button>'; }).join("");
    var f = FG.map(function (c) { return '<button class="sw" data-fg="' + c + '" style="background:' + c + '" title="Cor da fonte"></button>'; }).join("");
    bar.innerHTML =
      '<span class="lbl">Marca</span>' + h +
      '<button data-bg="" title="Sem marca">⌀</button>' +
      '<div class="sep"></div><span class="lbl">Caneta</span>' + f +
      '<button data-fg="" title="Cor padrão">⌀</button>' +
      '<div class="sep"></div>' +
      '<button data-tg="bold"><b>N</b></button>' +
      '<button data-tg="italic"><i>I</i></button>' +
      '<button data-tg="underline"><u>S</u></button>' +
      '<button data-act="comment" title="Comentar">💬</button>' +
      '<button data-act="del" title="Remover anotação">🗑️</button>';
    bar.classList.remove("hidden");

    var w = bar.offsetWidth, hh = bar.offsetHeight;
    var left = Math.max(6, Math.min(window.innerWidth - w - 6, rect.left + rect.width / 2 - w / 2));
    var top = rect.top - hh - 8;
    if (top < 6) top = Math.min(window.innerHeight - hh - 6, rect.bottom + 8);
    bar.style.left = left + "px";
    bar.style.top = top + "px";

    bar.onclick = function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      var a = annoById(anno.id);
      if (!a) return;
      if (b.getAttribute("data-act") === "comment") {
        firmarPendente();                       // comentar já vale como decisão
        $("#annobar").classList.add("hidden");
        openPopover(a.id, VMAnno.spansOf(a.id)[0], true);
        return;
      }
      if (b.getAttribute("data-act") === "del") { deleteAnno(a.id); hideAnnobar(); return; }
      if (b.hasAttribute("data-bg")) { a.bg = b.getAttribute("data-bg"); }
      else if (b.hasAttribute("data-fg")) { a.fg = b.getAttribute("data-fg"); }
      else if (b.hasAttribute("data-tg")) { var k = b.getAttribute("data-tg"); a[k] = !a[k]; }
      a.updatedAt = Date.now();
      firmarPendente();
      VMAnno.styleSpans(a);
      savePage();
    };
  }
  /* fechar sem escolher nada joga fora a anotação vazia */
  function hideAnnobar() {
    descartarPendente();
    $("#annobar").classList.add("hidden");
  }

  function deleteAnno(id) {
    if (pending && pending.id === id) { descartarPendente(); hidePopover(); return; }
    VMAnno.unwrap(id);
    cur.pageData.annotations = cur.pageData.annotations.filter(function (a) { return a.id !== id; });
    savePage();
    if (!$("#notesPane").hidden) renderNotes();
    hidePopover();
    toast("Anotação removida.");
  }

  /* 2.8: lista das anotações que dividem o mesmo trecho */
  function abrirGrupo(ids, anchorEl) {
    var pop = $("#popover");
    var as = ids.map(annoById).filter(Boolean).sort(function (a, b) { return (b.importance || 0) - (a.importance || 0); });
    pop.innerHTML = '<div class="quote">' + as.length + " anotações neste trecho" + (as[0] && as[0].article ? " — " + esc(as[0].article) : "") + "</div>" +
      '<div class="vm-grp-list">' + as.map(function (a) {
        var c = LC.cat(a.category);
        return '<div class="vm-grp-item" data-id="' + esc(a.id) + '"><span class="badge" style="background:' + c.color + '">' + c.letter + "</span> " +
          esc(c.label) + (a.importance ? " " + "★".repeat(a.importance) : "") + ((a.tags || [])[0] ? ' <small style="color:#6b7280">' + esc(a.tags[0]) + "</small>" : "") +
          '<div style="font-size:12.5px;color:#374151;margin-top:3px;text-align:justify">' + esc(LC.truncate(LC.stripHtml(a.comment || "").replace(/\s+/g, " ").trim(), 170)) + "</div></div>";
      }).join("") + "</div>" +
      '<div class="acts"><button class="btn" id="pClose">Fechar</button></div>';
    pop.classList.remove("hidden");
    var r = anchorEl && anchorEl.isConnected ? anchorEl.getBoundingClientRect() : { left: 20, top: 60, bottom: 80 };
    var w = pop.offsetWidth, hh = pop.offsetHeight;
    pop.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left)) + "px";
    var top = r.bottom + 8; if (top + hh > window.innerHeight - 6) top = Math.max(6, r.top - hh - 8);
    pop.style.top = top + "px";
    $("#pClose").onclick = hidePopover;
    pop.querySelectorAll(".vm-grp-item").forEach(function (it) { it.onclick = function () { openPopover(it.getAttribute("data-id"), anchorEl, false); }; });
  }
  function openPopover(id, anchorEl, editing) {
    var a = annoById(id);
    if (!a) return;
    var pop = $("#popover");
    var cats = LC.CATEGORIES.map(function (c) {
      return '<option value="' + c.key + '"' + (a.category === c.key ? " selected" : "") + ">" + esc(c.label) + "</option>";
    }).join("");

    pop.innerHTML =
      '<div class="quote">' + esc(a.article ? a.article + " — " : "") + "“" + esc(LC.truncate(a.anchor.exact || "", 180)) + "”</div>" +
      '<div class="row"><select id="pCat">' + cats + "</select>" +
        '<select id="pImp">' +
          [0, 1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + ((a.importance || 0) === n ? " selected" : "") + ">" + (n ? "★".repeat(n) : "sem estrela") + "</option>"; }).join("") +
        "</select></div>" +
      '<div class="row"><button class="btn" data-f="bold"><b>N</b></button><button class="btn" data-f="italic"><i>I</i></button>' +
        '<button class="btn" data-f="underline"><u>S</u></button><button class="btn" data-f="insertUnorderedList">•</button></div>' +
      '<div class="ed" id="pEd" contenteditable="true"></div>' +
      '<div class="acts"><button class="btn danger" id="pDel">Excluir</button>' +
        '<button class="btn" id="pClose">Fechar</button>' +
        '<button class="btn primary" id="pSave">Salvar</button></div>';
    pop.classList.remove("hidden");
    $("#pEd").innerHTML = LC.sanitizeHtml(a.comment || "");
    if (window.OGVoz) OGVoz.montar(pop, $("#pEd"), { antes: pop.querySelector(".row"), titulo: (a.article ? a.article + " — " : "") + (cur && cur.title || "Nota") });
    pop._ogPendingTags = null;
    if (window.OGTags) window.OGTags.attachUI(pop, a, { before: pop.querySelector(".acts") });

    var posicionar = function () {
      var r = anchorEl && anchorEl.isConnected ? anchorEl.getBoundingClientRect() : { left: 20, top: 60, bottom: 80, width: 0 };
      var w = pop.offsetWidth, hh = pop.offsetHeight;
      var left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left));
      var top = r.bottom + 8;
      if (top + hh > window.innerHeight - 6) top = Math.max(6, r.top - hh - 8);
      pop.style.left = left + "px";
      pop.style.top = top + "px";
    };
    if (window.OGDock && OGDock.estaEncaixado(pop)) OGDock.soltar(pop);
    /* Opções → Exibição das notas: barra lateral (quando o Vade Mecum está numa aba larga) */
    if (!(window.OGDock && OGDock.encaixar(pop, { minJanela: 760, aoSoltar: posicionar }))) posicionar();

    pop.querySelectorAll("[data-f]").forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); $("#pEd").focus(); document.execCommand(b.getAttribute("data-f"), false, null); };
    });
    $("#pClose").onclick = hidePopover;
    $("#pDel").onclick = function () { deleteAnno(id); };
    $("#pSave").onclick = function () {
      var t = annoById(id);
      if (!t) return;
      t.category = $("#pCat").value;
      t.importance = parseInt($("#pImp").value, 10) || 0;
      t.comment = LC.sanitizeHtml($("#pEd").innerHTML);
      if (window.OGTags) { var tg = window.OGTags.getPending(pop); if (tg) t.tags = tg; }
      t.updatedAt = Date.now();
      VMAnno.styleSpans(t);
      savePage();
      if (!$("#notesPane").hidden) renderNotes();
      hidePopover();
      toast("Anotação salva ✔");
    };
    if (editing) setTimeout(function () { var e = $("#pEd"); if (e) e.focus(); }, 40);
  }
  function hidePopover() {
    var pop = $("#popover");
    if (window.OGVoz) OGVoz.parar();
    if (window.OGDock && OGDock.estaEncaixado(pop)) OGDock.soltar(pop);
    pop.classList.add("hidden");
  }

  /* ------------------------- eventos do leitor -------------------------- */
  var wired = false;
  function wireReaderEvents() {
    var box = $("#lawtext");

    box.onmouseup = function () {
      setTimeout(function () {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        var range = sel.getRangeAt(0);
        if (!box.contains(range.commonAncestorContainer)) return;
        if (String(sel).trim().length < 2) return;
        // a medida e a criação usam o range VIVO: nada de mexer no DOM antes
        var rect = range.getBoundingClientRect();
        descartarPendente();                // some com a seleção anterior não usada
        var anno = VMAnno.createFromRange(range);
        if (!anno) return;
        sel.removeAllRanges();
        clearFinds();                       // só depois: normalize() invalidaria o range
        pending = anno;                     // ainda não entra no acervo
        showAnnobar(rect, anno);
      }, 10);
    };

    box.onclick = function (e) {
      var mk = e.target.closest(".lc-note-marker");
      var hl = e.target.closest("span.lc-hl");
      var an = e.target.closest("[data-vm-anchor]");
      if (an) {
        e.preventDefault();
        var name = an.getAttribute("data-vm-anchor") || "";
        var t = null;
        var safe = (window.CSS && CSS.escape) ? CSS.escape(name) : name.replace(/["\\\]]/g, "\\$&");
        try { t = box.querySelector('[name="' + safe + '"]') || box.querySelector("#" + safe); } catch (err) {}
        if (t) t.scrollIntoView({ block: "start", behavior: "smooth" });
        else toast("Âncora não encontrada nesta página.");
        return;
      }
      if (mk || hl) {
        var el0 = mk || hl;
        var ids = (el0.getAttribute("data-lc-ids") || "").split(" ").filter(function (x) { return x && annoById(x); });
        if (ids.length > 1) { abrirGrupo(ids, hl || mk); return; }
        openPopover(ids[0] || el0.getAttribute("data-lc-id"), hl || mk, false);
      }
    };

    if (wired) return;
    wired = true;
    document.addEventListener("mousedown", function (e) {
      if (!e.target.closest("#annobar")) hideAnnobar();
      if (!e.target.closest("#popover") && !e.target.closest("span.lc-hl") && !e.target.closest(".lc-note-marker") &&
          !(window.OGDock && OGDock.estaEncaixado($("#popover")))) hidePopover();
      if (!e.target.closest("#menu")) $("#menu").classList.add("hidden");
    });
  }

  /* ======================================================================
     11. CONFERÊNCIA COM O TEXTO OFICIAL
     ====================================================================== */
  function normCompare(s) {
    return String(s || "")
      .replace(/ /g, " ")
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐-―]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function conferirModal() {
    if (!cur.doc) { toast("Abra uma lei primeiro."); return; }
    showModal("Conferir trecho com o Planalto",
      '<div class="hint">Cole abaixo o texto que você está lendo (de apostila, PDF, site etc.). Comparo com a íntegra oficial de <b>' + esc(cur.law.title) + "</b> já carregada.</div>" +
      '<label>Trecho a conferir</label><textarea id="cfT" rows="6" style="resize:vertical"></textarea>' +
      '<div id="cfR" class="hint" style="margin-top:9px"></div>',
      [
        { t: "Fechar", f: closeModal },
        { t: "Conferir", primary: true, f: function () { conferir($("#cfT").value); } }
      ]);
    setTimeout(function () { var e = $("#cfT"); if (e) e.focus(); }, 40);
  }

  function conferir(trecho) {
    var out = $("#cfR");
    var q = normCompare(trecho);
    if (q.length < 12) { out.innerHTML = '<span style="color:#a35b00">Cole um trecho um pouco maior (ao menos 12 caracteres).</span>'; return; }
    var oficial = normCompare(cur.doc.text);

    if (oficial.indexOf(q) !== -1) {
      var pos = oficial.indexOf(q);
      var art = window.LC ? LC.detectArticleFromText(oficial, pos) : "";
      out.innerHTML = '<span style="color:#1d6b3a;font-weight:600">✔ Confere com o texto oficial.</span>' +
        (art ? "<br>Localizado em <b>" + esc(art) + "</b>." : "") +
        "<br><small>Fonte: planalto.gov.br · versão baixada em " + fmtDate(cur.doc.fetchedAt) + "</small>";
      return;
    }

    // tolerância a maiúsculas/acentos
    var oF = foldText(oficial), qF = foldText(q);
    if (oF.indexOf(qF) !== -1) {
      var p2 = oF.indexOf(qF);
      out.innerHTML = '<span style="color:#a35b00;font-weight:600">≈ Confere, com diferenças de acento/maiúsculas.</span>' +
        "<br><b>Texto oficial:</b><br><i>" + esc(oficial.substr(p2, q.length + 40)) + "…</i>";
      return;
    }

    // acha a melhor âncora pelas primeiras palavras e mostra onde diverge
    var words = qF.split(" ").filter(Boolean);
    var probe = words.slice(0, Math.min(8, words.length)).join(" ");
    var at = -1;
    while (probe.length > 12 && at === -1) {
      at = oF.indexOf(probe);
      if (at === -1) probe = probe.slice(0, probe.lastIndexOf(" "));
    }
    if (at === -1) {
      out.innerHTML = '<span style="color:#a32020;font-weight:600">✘ Trecho não encontrado nesta lei.</span>' +
        "<br><small>Verifique se é mesmo esta lei, ou se o texto foi parafraseado.</small>";
      return;
    }
    var oficialTrecho = oficial.substr(at, q.length + 80);
    var i = 0;
    while (i < q.length && i < oficialTrecho.length && foldText(q[i]) === foldText(oficialTrecho[i])) i++;
    out.innerHTML =
      '<span style="color:#a32020;font-weight:600">✘ Diverge do texto oficial.</span>' +
      "<br>Primeira diferença por volta do caractere <b>" + i + "</b>." +
      "<br><br><b>Você colou:</b><br><i>…" + esc(q.substr(Math.max(0, i - 40), 110)) + "…</i>" +
      "<br><br><b>Texto oficial:</b><br><i>…" + esc(oficialTrecho.substr(Math.max(0, i - 40), 110)) + "…</i>";
  }

  /* ======================================================================
     12. BACKUP / RESTAURAÇÃO
     ====================================================================== */
  function exportBackup() {
    toast("Montando o backup…");
    LC.montarBackup().then(function (b) {
      b.vademecum = { settings: settings, version: 1 };
      var name = "opelegis-vademecum-" + new Date().toISOString().slice(0, 10) + ".json";
      var blobUrl = URL.createObjectURL(LC.backupBlob(b));
      var a = document.createElement("a");
      a.href = blobUrl; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
      toast("Backup gerado ✔ (" + Object.keys(b.store).length + " itens)");
    }).catch(function (e) { toast("Não foi possível montar o backup: " + (e && e.message || e)); });
  }


  function importBackup() {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var data;
        try { data = JSON.parse(rd.result); }
        catch (e) { toast("Arquivo inválido."); return; }
        LC.importarBackup(data, async function (r) {
          void chrome.runtime.lastError;
          if (!r || !r.ok) { toast("Falha ao importar: " + ((r && r.error) || "?")); return; }
          if (data.vademecum && data.vademecum.settings) {
            settings = Object.assign({}, data.vademecum.settings, settings);
            await sset({ "lc:vm:settings": settings });
          }
          await loadAll();
          renderShelf();
          toast("Backup importado ✔ (" + (r.pages || 0) + " itens)");
        });
      };
      rd.readAsText(f);
    };
    inp.click();
  }

  /* Baixa de uma vez o texto de todas as leis do acervo, para que abram
     direto do armazenamento local, sem depender da rede. Pula as que já estão
     guardadas na versão atual do cache. Uma por vez, para não sobrecarregar o site. */
  var baixando = false;
  async function baixarOffline() {
    if (baixando) { toast("O download já está em andamento."); return; }
    var urls = [], vistos = {};
    laws.forEach(function (l) {
      if (!l || !l.url || !/^https?:/i.test(l.url)) return;
      var k = norm(l.url); if (vistos[k]) return; vistos[k] = 1; urls.push(l.url);
    });
    if (!urls.length) { toast("Nenhuma lei no acervo."); return; }
    var chaves = urls.map(function (u) { return "lc:vm:doc:" + norm(u); });
    var ja = await sget(chaves);
    var falta = urls.filter(function (u, i) { var d = ja[chaves[i]]; return !(d && d.html && d.v === CACHE_V); });
    if (!falta.length) { toast("Todas as " + urls.length + " leis já estão disponíveis offline."); return; }
    baixando = true;
    var ok = 0, erro = 0;
    for (var i = 0; i < falta.length; i++) {
      status("Baixando para uso offline: " + (i + 1) + " de " + falta.length + "…");
      try { await getDoc(falta[i]); ok++; } catch (e) { erro++; }
      await new Promise(function (r) { setTimeout(r, 300); });
    }
    baixando = false;
    status('<span class="ok">Uso offline: ' + (urls.length - falta.length + ok) + " de " + urls.length + " leis guardadas.</span>" +
           (erro ? ' <span class="warn">' + erro + " não puderam ser baixadas agora.</span>" : ""));
    toast("Download concluído: " + ok + " nova(s)" + (erro ? ", " + erro + " com falha" : "") + ".");
    renderShelf();
  }

  async function limparCache() {
    var keys = (await allKeys()).filter(function (k) { return k.indexOf("lc:vm:doc:") === 0; });
    if (!keys.length) { toast("Não há textos em cache."); return; }
    await sdel(keys);
    cacheIndex = {};
    await sset({ "lc:vm:cache": {} });
    toast(keys.length + " texto(s) removido(s) do cache.");
    renderShelf();
  }

  /* ====================== EXPORTAR PARA O IPAD ==========================
     Gera um pacote único com ramos, leis, o texto limpo de cada uma e todas
     as anotações. É esse arquivo que alimenta o app web do iPad — por isso o
     texto vai junto: no Safari uma página comum não consegue buscar o
     planalto.gov.br direto (bloqueio de origem cruzada).
     ====================================================================== */
  function fmtMB(bytes) { return (bytes / 1048576).toFixed(1) + " MB"; }

  var IPAD_URL = "https://robsonchiavon1984-coder.github.io/vade-vitalicio/opelegis/";
  function exportarIpadModal() {
    var ramos = ordered();
    var linhas = ramos.map(function (d) {
      var n = lawsOf(d.id).length;
      if (!n) return "";
      return '<label class="chk"><input type="checkbox" class="rm" value="' + d.id + '" checked> ' +
             esc(d.name) + " <span style=\"color:var(--tinta-sec)\">(" + n + ")</span></label>";
    }).join("");

    showModal("Exportar para o iPad",
      '<div class="hint">Gera o arquivo que alimenta o app <a href="' + IPAD_URL + '" target="_blank">OpeLegis no iPad</a> ' +
      "(abra esse endereço no Safari do iPad e adicione à Tela de Início). O texto de cada lei e todas as anotações vão dentro do arquivo, " +
      "para o iPad funcionar sem internet. Para levar todas as leis, use antes ⋯ → Baixar todas as leis para uso offline.</div>" +
      '<label class="chk" style="margin-top:9px"><input type="checkbox" id="soBaixadas" checked> ' +
      "Só as leis que já abri (rápido)</label>" +
      '<div class="hint" style="margin:2px 0 8px">Desmarcando, eu baixo do Planalto as que faltarem — pode levar vários minutos.</div>' +
      '<div style="max-height:190px;overflow:auto;border:1px solid var(--linha);border-radius:7px;padding:6px">' + linhas + "</div>" +
      '<div id="expBar" class="hint" style="margin-top:9px"></div>',
      [
        { t: "Cancelar", f: closeModal },
        { t: "Gerar arquivo", primary: true, f: function () {
            var ids = $$(".rm:checked").map(function (i) { return i.value; });
            exportarIpad(ids, $("#soBaixadas").checked);
          } }
      ]);
  }

  async function exportarIpad(discIds, soBaixadas) {
    var alvo = laws.filter(function (l) {
      return (l.disciplineIds || []).some(function (id) { return discIds.indexOf(id) !== -1; });
    });
    if (!alvo.length) { toast("Selecione ao menos um ramo."); return; }

    /* Formato em linhas (uma chave por linha): o iPad lê aos poucos, sem
       precisar carregar dezenas de MB de uma vez na memória. */
    var partes = [], bytes = 0, falhas = [], nLeis = 0, cacheSub = {};
    function linha(k, v) { var t = JSON.stringify({ k: k, v: v }) + "\n"; partes.push(t); bytes += t.length; }
    var st = (await sget("lc:settings"))["lc:settings"] || {};
    partes.push(JSON.stringify({ app: "opelegis", formato: "opelegis-linhas", versao: 1,
      exportedAt: new Date().toISOString(), clientId: st.clientId || "" }) + "\n");

    for (var i = 0; i < alvo.length; i++) {
      var bar = $("#expBar");
      if (!bar || $("#modal").classList.contains("hidden")) return;   // cancelado
      var l = alvo[i];
      var nu = norm(l.url);
      bar.innerHTML = "Preparando " + (i + 1) + " de " + alvo.length + " — " + esc(l.title) +
                      "<br><b>" + fmtMB(bytes) + "</b> até agora";
      try {
        if (soBaixadas && !cacheIndex[nu]) continue;
        await getDoc(l.url, false);
        var dk = "lc:vm:doc:" + nu, d = (await sget(dk))[dk];
        if (d && d.html) { linha(dk, d); nLeis++; cacheSub[nu] = d.fetchedAt || Date.now(); }
      } catch (e) {
        falhas.push(l.title);
      }
    }
    $("#expBar").innerHTML = "Juntando as anotações…";
    linha("lc:disciplines", disciplines);
    /* só as leis cujo texto vai junto: sem ele, a lei não abre no iPad */
    linha("lc:laws", alvo.filter(function (l) { return cacheSub[norm(l.url)]; }));
    linha("lc:vm:cache", cacheSub);

    var ks = (await allKeys()).filter(function (k) {
      return k.indexOf("lc:page:") === 0 || k === "og:tagindex" || k === "og:removidos" || k === "og:srs";
    });
    for (var c = 0; c < ks.length; c += 80) {
      var lote = await sget(ks.slice(c, c + 80));
      Object.keys(lote).forEach(function (k) { if (lote[k]) linha(k, lote[k]); });
    }

    var nome = "vademecum-ipad-" + new Date().toISOString().slice(0, 10) + ".json";
    try {
      var url = URL.createObjectURL(new Blob(partes, { type: "application/json" }));
      var a = document.createElement("a");
      a.href = url; a.download = nome;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    } catch (e) {
      toast("Falha ao gerar o arquivo: " + (e.message || e));
      return;
    }

    var bar2 = $("#expBar");
    if (bar2) {
      bar2.innerHTML = '<span style="color:#1d6b3a;font-weight:600">Pronto ✔</span> ' +
        nLeis + " lei(s) com texto, " + fmtMB(bytes) + "." +
        (falhas.length ? "<br><span style=\"color:#a35b00\">Sem texto: " + esc(falhas.slice(0, 6).join(", ")) +
          (falhas.length > 6 ? " e mais " + (falhas.length - 6) : "") + "</span>" : "") +
        "<br>Mande o arquivo para o iPad (Google Drive, iCloud ou AirDrop) e, no app " +
        '<a href="' + IPAD_URL + '" target="_blank">OpeLegis no iPad</a>, toque em ⋯ → Importar pacote.';
    }
  }

  /* ------------------- unificar ramos duplicados ------------------------ */
  /* Conserta o estrago de uma semeadura antiga: se existirem "Civil" e
     "Direito Civil", tudo vai para a coluna que o usuário já usava (a que
     NÃO foi criada pelo vade mecum), e a gêmea é removida. */
  function planoUnificacao() {
    var grupos = {};
    disciplines.forEach(function (d) {
      var k = d.vmKey || ramoKeyOf(d.name);
      if (!k) return;
      (grupos[k] = grupos[k] || []).push(d);
    });
    var planos = [];
    Object.keys(grupos).forEach(function (k) {
      var g = grupos[k];
      if (g.length < 2) return;
      var propria = g.filter(function (d) { return String(d.id).indexOf("vmd-") !== 0; });
      var principal = propria.length ? propria[0] : g[0];
      var outras = g.filter(function (d) { return d.id !== principal.id; });
      planos.push({ key: k, principal: principal, outras: outras });
    });
    return planos;
  }

  function aplicarUnificacao(planos) {
    var mapa = {};
    planos.forEach(function (p) {
      p.outras.forEach(function (o) { mapa[o.id] = p.principal.id; });
      if (!p.principal.vmKey) p.principal.vmKey = p.key;
    });
    laws.forEach(function (l) {
      var ids = (l.disciplineIds || []).map(function (id) { return mapa[id] || id; });
      l.disciplineIds = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
    });
    var remover = Object.keys(mapa);
    disciplines = disciplines.filter(function (d) { return remover.indexOf(d.id) === -1; });
    return remover.length;
  }

  /* Na abertura, junta sozinho as colunas gêmeas — mas SÓ apaga as que o
     próprio vade mecum criou (id "vmd-"). Coluna feita pelo usuário nunca
     some sem ele mandar. */
  async function unificarAuto() {
    var planos = planoUnificacao().filter(function (p) {
      return p.outras.every(function (o) { return String(o.id).indexOf("vmd-") === 0; });
    });
    if (!planos.length) return 0;
    var n = aplicarUnificacao(planos);
    await sset({ "lc:disciplines": disciplines, "lc:laws": laws });
    return n;
  }

  function unificarRamos() {
    var planos = planoUnificacao();
    if (!planos.length) {
      showModal("Unificar ramos", '<div class="hint">Nenhum ramo duplicado. Está tudo certo por aqui.</div>',
        [{ t: "Fechar", f: closeModal }]);
      return;
    }
    var resumo = planos.map(function (p) {
      return "• <b>" + esc(p.principal.name) + "</b> ← " +
        p.outras.map(function (o) { return esc(o.name) + " (" + lawsOf(o.id).length + ")"; }).join(", ");
    }).join("<br>");

    showModal("Unificar ramos duplicados",
      '<div class="hint">Encontrei ' + planos.length + " ramo(s) repetido(s). As leis vão para a coluna da esquerda e a repetida é apagada. " +
      "<b>Nenhuma lei e nenhuma anotação se perde.</b></div><div class=\"hint\" style=\"margin-top:8px\">" + resumo + "</div>",
      [
        { t: "Cancelar", f: closeModal },
        { t: "Unificar", primary: true, f: async function () {
            var n = aplicarUnificacao(planos);
            await sset({ "lc:disciplines": disciplines, "lc:laws": laws });
            closeModal();
            ramoAtual = null;
            renderShelf();
            toast(n + " ramo(s) duplicado(s) unificado(s) ✔");
          } }
      ]);
  }

  /* ---------------------- diagnóstico dos links ------------------------- */
  async function checarLinks() {
    var alvo = laws.slice();
    showModal("Verificar links do acervo",
      '<div class="hint">Vou pedir cada lei ao Planalto e conferir se o texto vem certinho. ' +
      "São <b>" + alvo.length + "</b> diplomas — leva alguns minutos. Pode fechar esta janela depois; o resultado fica listado aqui.</div>" +
      '<div id="ckBar" class="hint" style="margin-top:8px"></div><div id="ckOut" style="margin-top:8px"></div>',
      [{ t: "Fechar", f: closeModal }]);

    var ruins = [];
    for (var i = 0; i < alvo.length; i++) {
      var l = alvo[i];
      var bar = $("#ckBar");
      // modal fechado ou substituído por outro: interrompe a varredura
      if (!bar || $("#modal").classList.contains("hidden")) return;
      bar.innerHTML = "Conferindo " + (i + 1) + " de " + alvo.length + " — " + esc(l.title);
      try {
        var raw = await fetchRaw(l.url);
        var ex = extractDoc(raw, l.url);
        if (!ex || !ex.html || ex.html.length < 200) throw new Error("página sem texto de lei");
      } catch (err) {
        ruins.push({ law: l, msg: String(err.message || err) });
        var out = $("#ckOut");
        if (out) {
          out.innerHTML = "<b>Problemas encontrados (" + ruins.length + "):</b><br>" +
            ruins.map(function (r) { return "• " + esc(r.law.title) + " — <i>" + esc(r.msg) + "</i>"; }).join("<br>");
        }
      }
    }
    var bar2 = $("#ckBar");
    if (bar2) {
      bar2.innerHTML = ruins.length
        ? '<span style="color:#a35b00;font-weight:600">Concluído: ' + ruins.length + " link(s) com problema.</span> Use ⋯ no cartão da lei para corrigir a URL."
        : '<span style="color:#1d6b3a;font-weight:600">Concluído: todos os ' + alvo.length + " links responderam corretamente.</span>";
    }
  }

  /* ======================================================================
     13. MODAL E MENU GENÉRICOS
     ====================================================================== */
  function showModal(title, bodyHtml, buttons) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHtml;
    var foot = $("#modalFoot");
    foot.innerHTML = "";
    (buttons || []).forEach(function (b) {
      var el = document.createElement("button");
      el.className = "btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : "");
      el.textContent = b.t;
      el.onclick = b.f;
      foot.appendChild(el);
    });
    $("#modal").classList.remove("hidden");
  }
  function closeModal() { $("#modal").classList.add("hidden"); }

  function openMenu(x, y, items) {
    var m = $("#menu");
    m.innerHTML = "";
    items.forEach(function (it) {
      if (it.hr) { var h = document.createElement("div"); h.className = "hr"; m.appendChild(h); return; }
      var b = document.createElement("button");
      b.textContent = it.t;
      b.onclick = function () { m.classList.add("hidden"); it.f(); };
      m.appendChild(b);
    });
    m.classList.remove("hidden");
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, x - w + 20)) + "px";
    m.style.top = Math.max(6, Math.min(window.innerHeight - h - 6, y + 6)) + "px";
  }

  function mainMenu(ev) {
    var items = [
      { t: "📥 Exportar dados (backup .json)", f: exportBackup },
      { t: "📤 Importar dados (backup .json)", f: importBackup },
      { t: "📱 Exportar para o iPad", f: exportarIpadModal },
      { hr: true },
      { t: "⌨️ Configurar atalho de teclado", f: function () { chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); } },
      { t: "🧩 Unificar ramos duplicados", f: unificarRamos },
      { t: "🔄 Restaurar acervo padrão (só acrescenta)", f: async function () {
          var r = await seedCatalog(true);
          await loadAll(); renderShelf();
          toast("Acervo conferido: +" + r.d + " ramo(s), +" + r.l + " lei(s).");
        } },
      { t: "⬇️ Baixar todas as leis para uso offline", f: baixarOffline },
      { t: "🧹 Limpar cache de textos", f: limparCache },
      { t: "🩺 Verificar os links do acervo", f: checarLinks },
      { hr: true },
      { t: "✍️ Abrir painel de anotações na aba atual", f: function () { chrome.runtime.sendMessage({ type: "OG_LC_PANEL_ACTIVE" }); } },
      { t: "🗂️ Abrir vade mecum em quadro (kanban)", f: function () { chrome.runtime.sendMessage({ type: "OG_OPEN_APP" }); } }
    ];
    if (cur.doc) {
      items.unshift({ hr: true });
      items.unshift({ t: "🌐 Abrir esta lei no Planalto", f: function () { chrome.tabs.create({ url: cur.law.url }); } });
      items.unshift({ t: "🔎 Conferir trecho com o texto oficial", f: conferirModal });
    }
    if (window.IPAD && IPAD.menu) items = IPAD.menu(items);
    openMenu(ev.clientX, ev.clientY, items);
  }

  /* ======================================================================
     14. LIGAÇÕES DE INTERFACE
     ====================================================================== */
  $("#btnBack").onclick = function () { setView("shelf"); };
  $("#btnAdd").onclick = function () { lawModal(null); };
  $("#btnMenu").onclick = mainMenu;
  $("#modalX").onclick = closeModal;

  $("#btnFind").onclick = function () { if ($("#findbar").hidden) openFind(); else closeFind(); };
  $("#fclose").onclick = closeFind;
  $("#fnext").onclick = function () { stepFind(1); };
  $("#fprev").onclick = function () { stepFind(-1); };

  var fTm = null;
  $("#fq").addEventListener("input", function () {
    clearTimeout(fTm);
    var v = this.value;
    fTm = setTimeout(function () { runFind(v); }, 260);
  });
  $("#fq").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
    if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });

  $("#btnIndex").onclick = function () {
    var p = $("#indexPane");
    p.hidden = !p.hidden;
    $("#btnIndex").classList.toggle("on", !p.hidden);
    $("#notesPane").hidden = true; $("#btnNotes").classList.remove("on");
    if (!p.hidden) { $("#iq").value = ""; renderIndex(); }
  };
  $("#iclose").onclick = function () { $("#indexPane").hidden = true; $("#btnIndex").classList.remove("on"); };
  $("#iq").addEventListener("input", renderIndex);
  $("#modeEstrutura").onclick = function () { setIndexMode("estrutura"); };
  $("#modeArtigos").onclick = function () { setIndexMode("artigos"); };

  $("#btnNotes").onclick = function () {
    var p = $("#notesPane");
    p.hidden = !p.hidden;
    $("#btnNotes").classList.toggle("on", !p.hidden);
    $("#indexPane").hidden = true; $("#btnIndex").classList.remove("on");
    if (!p.hidden) { $("#nq").value = ""; renderNotes(); }
  };
  $("#nclose").onclick = function () { $("#notesPane").hidden = true; $("#btnNotes").classList.remove("on"); };
  $("#nq").addEventListener("input", renderNotes);

  var qTm = null;
  $("#q").addEventListener("input", function () {
    clearTimeout(qTm);
    var v = this.value;
    qTm = setTimeout(function () { busca = v; renderShelf(); }, 200);
  });

  document.addEventListener("keydown", function (e) {
    var reader = !$("#viewReader").hidden;
    var key = String(e.key || "");
    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "f") {
      e.preventDefault();
      if (reader) openFind(); else $("#q").focus();
      return;
    }
    if (key === "Escape") {
      if (!$("#modal").classList.contains("hidden")) { closeModal(); return; }
      if (!$("#popover").classList.contains("hidden")) { hidePopover(); return; }
      if (reader && !$("#findbar").hidden) { closeFind(); return; }
      if (reader) setView("shelf");
      return;
    }
    if (e.altKey && key === "ArrowLeft" && reader) { e.preventDefault(); setView("shelf"); }
  });

  /* recarrega contagens quando outra parte da suíte grava anotações */
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    var touched = Object.keys(changes).some(function (k) { return k.indexOf("lc:page:") === 0; });
    if (touched) {
      Object.keys(changes).forEach(function (k) {
        if (k.indexOf("lc:page:") !== 0) return;
        var v = changes[k].newValue;
        pageCounts[k.slice("lc:page:".length)] = v ? (v.annotations || []).length : 0;
      });
      if ($("#viewReader").hidden) renderPagina();
    }
    if (changes["lc:laws"] || changes["lc:disciplines"]) {
      if (changes["lc:laws"]) laws = changes["lc:laws"].newValue || [];
      if (changes["lc:disciplines"]) disciplines = changes["lc:disciplines"].newValue || [];
      if ($("#viewReader").hidden) renderShelf();
    }
  });

  /* ======================================================================
     15. INÍCIO
     ====================================================================== */
  (async function init() {
    await loadAll();
    var seeded = settings.seeded;
    if (!seeded) {
      var r = await seedCatalog(false);
      settings.seeded = true;
      settings.seededAt = Date.now();
      await sset({ "lc:vm:settings": settings });
      if (r.l) toast("Acervo carregado: " + r.l + " diplomas em " + r.d + " ramos.");
    }
    await loadAll();

    // conserta sozinho as gêmeas de semeaduras antigas ("Civil" x "Direito Civil")
    var juntou = await unificarAuto();
    ramoAtual = settings.lastRamo || null;
    renderShelf();
    if (juntou) toast(juntou + " ramo(s) duplicado(s) foram unificados.");
    else if (planoUnificacao().length) toast("Há ramos duplicados. Use ⋯ → Unificar ramos duplicados.");

    // abre direto uma lei, se pedido por outra parte da suíte
    var o = await sget("lc:vm:open");
    if (o["lc:vm:open"]) {
      var target = laws.filter(function (l) { return l.id === o["lc:vm:open"]; })[0];
      await sdel("lc:vm:open");
      if (target) openLaw(target);
    }
  })();

  /* ---------------- OpeLegis 2.0: ouvir a lei no Leitor em Voz ---------------- */
  /* Lê a partir do artigo que está no alto da tela (ou do início). */
  function speakFromView() {
    if (!cur.law || !cur.doc) { toast("Abra uma lei primeiro."); return; }
    var box = $("#lawtext"), reader = $("#reader");
    var topo = reader.getBoundingClientRect().top + 4;
    var inicio = null, rotulo = "";
    for (var i = 0; i < cur.artIndex.length; i++) {
      var a = cur.artIndex[i];
      if (a.el && a.el.getBoundingClientRect().bottom >= topo) { inicio = a.el; rotulo = a.label || ""; break; }
    }
    var texto = "";
    try {
      var rg = document.createRange();
      if (inicio) rg.setStartBefore(inicio); else rg.setStart(box, 0);
      rg.setEndAfter(box.lastChild || box);
      var frag = rg.cloneContents();
      var tmp = document.createElement("div");
      tmp.appendChild(frag);
      tmp.querySelectorAll(".lc-note-marker, .vm-ui, script, style").forEach(function (e) { e.remove(); });
      /* texto riscado (dispositivo revogado) não é lido */
      tmp.querySelectorAll("strike, s, del").forEach(function (e) { e.remove(); });
      tmp.querySelectorAll("p, div, br, li, tr, h1, h2, h3, h4, h5, h6").forEach(function (e) { e.appendChild(document.createTextNode("\n")); });
      texto = (tmp.textContent || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
    } catch (e) { texto = (box.innerText || "").trim(); }
    if (!texto) { toast("Não há texto para ler."); return; }
    try {
      chrome.runtime.sendMessage({
        type: "OG_LEITOR_TEXT", texto: texto,
        titulo: cur.law.title + (rotulo ? " — a partir do " + rotulo : ""),
        origem: cur.law.url
      }, function () { void chrome.runtime.lastError; });
      toast("Enviado ao Leitor em Voz 🔊");
    } catch (e) { toast("Não consegui abrir o Leitor."); }
  }
  $("#btnSpeak").onclick = speakFromView;

  /* ---------- OpeLegis 2.0: abrir lei/anotação a pedido do módulo Estudo ---------- */
  async function abrirPedido(req) {
    if (!req || !req.url) return;
    var alvo = laws.filter(function (l) { try { return norm(l.url) === norm(req.url); } catch (e) { return false; } })[0];
    if (!alvo) {
      var discId = null;
      if (req.disciplina) { var k = ramoKeyOf(req.disciplina); var d = k ? findDiscFor(k) : null; if (d) discId = d.id; }
      alvo = { id: uid(), title: req.title || req.url, url: req.url, notes: "", disciplineIds: discId ? [discId] : [],
        orders: {}, tags: "", createdAt: Date.now(), updatedAt: Date.now() };
      laws.push(alvo);
      await sset({ "lc:laws": laws });
      toast("Lei incluída no seu acervo.");
    }
    await openLaw(alvo);
    setTimeout(function () {
      if (req.annoId) {
        var sp = document.querySelector('#lawtext span.lc-hl[data-lc-id="' + (window.CSS && CSS.escape ? CSS.escape(req.annoId) : req.annoId) + '"]');
        if (sp) { scrollToEl(sp); openPopover(req.annoId, sp, false); return; }
      }
      if (req.art) { var n = parseInt(String(req.art).replace(/[^\d]/g, ""), 10); if (n) gotoArticle(n); }
    }, 250);
  }
  function lerPedido() {
    try {
      chrome.storage.session.get("og:vm:open", function (o) {
        var r = o && o["og:vm:open"];
        if (!r || Date.now() - (r.ts || 0) > 60000) return;
        chrome.storage.session.remove("og:vm:open");
        abrirPedido(r);
      });
    } catch (e) {}
  }
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === "session" && ch["og:vm:open"] && ch["og:vm:open"].newValue) lerPedido();
    });
  } catch (e) {}
  setTimeout(lerPedido, 900);

  window.__VM = { toast: toast, showModal: showModal, closeModal: closeModal, loadAll: loadAll, renderShelf: renderShelf,
    openLaw: openLaw, lendo: function () { return !$("#viewReader").hidden; } };

  /* guarda o último ramo visitado */
  window.addEventListener("beforeunload", function () {
    try { settings.lastRamo = ramoAtual; chrome.storage.local.set({ "lc:vm:settings": settings }); } catch (e) {}
  });
})();
