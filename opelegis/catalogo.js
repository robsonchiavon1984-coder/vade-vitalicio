/* =========================================================================
   Vade Mecum — catálogo padrão (acervo de concursos da magistratura
   estadual e federal). Cada ramo vira uma "orelha"; cada diploma vira um
   cartão que abre a íntegra publicada no site do Planalto.

   Este arquivo é apenas a SEMENTE. O acervo real do usuário vive em
   chrome.storage.local nas chaves "lc:disciplines" e "lc:laws" — as mesmas
   usadas pelo Vade Mecum (kanban) do módulo Lei Comentada. A semeadura é
   sempre aditiva: nunca apaga nem sobrescreve o que o usuário já tem.
   ========================================================================= */
(function (root) {
  "use strict";

  var P = "https://www.planalto.gov.br/ccivil_03/";

  /* --------------------------------- ramos ------------------------------ */
  var RAMOS = [
    { key: "constitucional", name: "Constitucional",              color: "#1d4ed8", icon: "⚖" },
    { key: "administrativo", name: "Administrativo",              color: "#0f766e", icon: "🏛" },
    { key: "civil",          name: "Civil",                       color: "#b45309", icon: "📘" },
    { key: "processocivil",  name: "Processual Civil",            color: "#c2410c", icon: "📑" },
    { key: "penal",          name: "Penal",                       color: "#b91c1c", icon: "⛓" },
    { key: "processopenal",  name: "Processual Penal",            color: "#9f1239", icon: "🔎" },
    { key: "empresarial",    name: "Empresarial",                 color: "#7c3aed", icon: "🏢" },
    { key: "tributario",     name: "Tributário",                  color: "#065f46", icon: "💰" },
    { key: "trabalho",       name: "Trabalho e Processo do Trabalho", color: "#0369a1", icon: "🔧" },
    { key: "previdenciario", name: "Previdenciário e Assistência", color: "#4d7c0f", icon: "🧓" },
    { key: "consumidor",     name: "Consumidor",                  color: "#be185d", icon: "🛒" },
    { key: "ambiental",      name: "Ambiental e Urbanístico",     color: "#15803d", icon: "🌳" },
    { key: "agrario",        name: "Agrário",                     color: "#65a30d", icon: "🌾" },
    { key: "eleitoral",      name: "Eleitoral",                   color: "#7e22ce", icon: "🗳" },
    { key: "estatutos",      name: "Estatutos e Vulneráveis",     color: "#db2777", icon: "🧒" },
    { key: "difusos",        name: "Difusos e Coletivos",         color: "#0891b2", icon: "👥" },
    { key: "humanos",        name: "Internacional e Direitos Humanos", color: "#4338ca", icon: "🌎" },
    { key: "registros",      name: "Registros Públicos e Notarial", color: "#a16207", icon: "🖋" },
    { key: "financeiro",     name: "Financeiro e Econômico",      color: "#334155", icon: "📊" },
    { key: "militar",        name: "Militar",                     color: "#3f6212", icon: "🎖" },
    { key: "digital",        name: "Digital e Proteção de Dados", color: "#0d9488", icon: "💻" },
    { key: "judiciaria",     name: "Organização Judiciária e Carreiras", color: "#475569", icon: "🏛" }
  ];

  /* ------------------------------- diplomas ----------------------------- */
  /* k = chave estável (id vira "vml-" + k) | r = ramos | t = título |
     u = URL oficial no Planalto | s = apelidos para a busca            */
  var LEIS = [
    /* ---------------------------- CONSTITUCIONAL ---------------------------- */
    { k: "cf1988",  r: ["constitucional"], t: "Constituição Federal de 1988 (com ADCT)", u: P + "constituicao/constituicao.htm", s: "CF CRFB carta magna ADCT" },
    { k: "ec103",   r: ["constitucional", "previdenciario"], t: "EC 103/2019 — Reforma da Previdência", u: P + "constituicao/emendas/emc/emc103.htm", s: "emenda constitucional previdencia" },
    { k: "lc95",    r: ["constitucional"], t: "LC 95/1998 — Elaboração e redação das leis", u: P + "leis/lcp/lcp95.htm", s: "tecnica legislativa" },
    { k: "l9868",   r: ["constitucional"], t: "Lei 9.868/1999 — ADI e ADC", u: P + "leis/l9868.htm", s: "controle concentrado acao direta inconstitucionalidade" },
    { k: "l9882",   r: ["constitucional"], t: "Lei 9.882/1999 — ADPF", u: P + "leis/l9882.htm", s: "arguicao descumprimento preceito fundamental" },
    { k: "l12016",  r: ["constitucional", "processocivil"], t: "Lei 12.016/2009 — Mandado de Segurança", u: P + "_ato2007-2010/2009/lei/l12016.htm", s: "MS mandado seguranca coletivo" },
    { k: "l9507",   r: ["constitucional"], t: "Lei 9.507/1997 — Habeas Data", u: P + "leis/l9507.htm", s: "habeas data" },
    { k: "l13300",  r: ["constitucional"], t: "Lei 13.300/2016 — Mandado de Injunção", u: P + "_ato2015-2018/2016/lei/l13300.htm", s: "mandado injuncao" },
    { k: "l1079",   r: ["constitucional"], t: "Lei 1.079/1950 — Crimes de responsabilidade", u: P + "leis/l1079.htm", s: "impeachment crime responsabilidade" },
    { k: "l11417",  r: ["constitucional", "processocivil"], t: "Lei 11.417/2006 — Súmula vinculante", u: P + "_ato2004-2006/2006/lei/l11417.htm", s: "sumula vinculante STF" },
    { k: "l8038",   r: ["constitucional", "processocivil", "processopenal"], t: "Lei 8.038/1990 — Processos nos tribunais superiores (competência originária)", u: P + "leis/l8038.htm", s: "STF STJ recurso competencia originaria acao penal" },
    { k: "l12527",  r: ["constitucional", "administrativo"], t: "Lei 12.527/2011 — Acesso à Informação (LAI)", u: P + "_ato2011-2014/2011/lei/l12527.htm", s: "LAI transparencia" },

    /* ---------------------------- ADMINISTRATIVO ---------------------------- */
    { k: "l8112",   r: ["administrativo"], t: "Lei 8.112/1990 — Regime jurídico dos servidores federais", u: P + "leis/l8112cons.htm", s: "servidor publico estatuto RJU" },
    { k: "l9784",   r: ["administrativo"], t: "Lei 9.784/1999 — Processo administrativo federal", u: P + "leis/l9784.htm", s: "processo administrativo" },
    { k: "l14133",  r: ["administrativo"], t: "Lei 14.133/2021 — Licitações e Contratos", u: P + "_ato2019-2022/2021/lei/l14133.htm", s: "nova lei licitacoes contratos" },
    { k: "l8666",   r: ["administrativo"], t: "Lei 8.666/1993 — Licitações (revogada, referência)", u: P + "leis/l8666cons.htm", s: "licitacao antiga" },
    { k: "l8429",   r: ["administrativo", "difusos"], t: "Lei 8.429/1992 — Improbidade Administrativa", u: P + "leis/l8429.htm", s: "improbidade LIA 14230" },
    { k: "l8987",   r: ["administrativo"], t: "Lei 8.987/1995 — Concessões e permissões", u: P + "leis/l8987cons.htm", s: "concessao servico publico" },
    { k: "l11079",  r: ["administrativo"], t: "Lei 11.079/2004 — Parcerias Público-Privadas", u: P + "_ato2004-2006/2004/lei/l11079.htm", s: "PPP parceria" },
    { k: "l13303",  r: ["administrativo", "empresarial"], t: "Lei 13.303/2016 — Estatuto das estatais", u: P + "_ato2015-2018/2016/lei/l13303.htm", s: "empresa publica sociedade economia mista" },
    { k: "l12846",  r: ["administrativo"], t: "Lei 12.846/2013 — Anticorrupção", u: P + "_ato2011-2014/2013/lei/l12846.htm", s: "lei anticorrupcao empresa limpa" },
    { k: "dl3365",  r: ["administrativo"], t: "DL 3.365/1941 — Desapropriação por utilidade pública", u: P + "decreto-lei/del3365.htm", s: "desapropriacao" },
    { k: "l4132",   r: ["administrativo"], t: "Lei 4.132/1962 — Desapropriação por interesse social", u: P + "leis/l4132.htm", s: "desapropriacao interesse social" },
    { k: "dl200",   r: ["administrativo"], t: "DL 200/1967 — Organização da Administração Federal", u: P + "decreto-lei/del0200.htm", s: "administracao indireta autarquia" },
    { k: "l11107",  r: ["administrativo"], t: "Lei 11.107/2005 — Consórcios públicos", u: P + "_ato2004-2006/2005/lei/l11107.htm", s: "consorcio publico" },
    { k: "l13460",  r: ["administrativo", "consumidor"], t: "Lei 13.460/2017 — Defesa do usuário de serviços públicos", u: P + "_ato2015-2018/2017/lei/l13460.htm", s: "usuario servico publico ouvidoria" },
    { k: "l13869",  r: ["administrativo", "penal"], t: "Lei 13.869/2019 — Abuso de autoridade", u: P + "_ato2019-2022/2019/lei/L13869.htm", s: "abuso autoridade" },
    { k: "l9873",   r: ["administrativo"], t: "Lei 9.873/1999 — Prescrição da ação punitiva da Administração", u: P + "leis/l9873.htm", s: "prescricao administrativa" },
    { k: "d9830",   r: ["administrativo"], t: "Decreto 9.830/2019 — Regulamento dos arts. 20 a 30 da LINDB", u: P + "_ato2019-2022/2019/decreto/D9830.htm", s: "LINDB consequencialismo" },

    /* -------------------------------- CIVIL --------------------------------- */
    { k: "cc2002",  r: ["civil"], t: "Código Civil — Lei 10.406/2002", u: P + "leis/2002/l10406compilada.htm", s: "CC codigo civil" },
    { k: "lindb",   r: ["civil", "constitucional"], t: "LINDB — DL 4.657/1942", u: P + "decreto-lei/del4657compilado.htm", s: "lei introducao normas direito brasileiro LICC" },
    { k: "l8245",   r: ["civil"], t: "Lei 8.245/1991 — Locações de imóveis urbanos", u: P + "leis/l8245.htm", s: "lei do inquilinato locacao" },
    { k: "l4591",   r: ["civil"], t: "Lei 4.591/1964 — Condomínio e incorporações", u: P + "leis/l4591.htm", s: "condominio incorporacao imobiliaria" },
    { k: "l9514",   r: ["civil"], t: "Lei 9.514/1997 — Alienação fiduciária de imóvel / SFI", u: P + "leis/l9514.htm", s: "alienacao fiduciaria imovel" },
    { k: "l5478",   r: ["civil", "processocivil"], t: "Lei 5.478/1968 — Ação de alimentos", u: P + "leis/l5478.htm", s: "alimentos" },
    { k: "l11804",  r: ["civil"], t: "Lei 11.804/2008 — Alimentos gravídicos", u: P + "_ato2007-2010/2008/lei/l11804.htm", s: "alimentos gravidicos gestante" },
    { k: "l9278",   r: ["civil"], t: "Lei 9.278/1996 — União estável", u: P + "leis/l9278.htm", s: "uniao estavel companheiro" },
    { k: "l8560",   r: ["civil"], t: "Lei 8.560/1992 — Investigação de paternidade", u: P + "leis/l8560.htm", s: "paternidade reconhecimento filho" },
    { k: "l12318",  r: ["civil", "estatutos"], t: "Lei 12.318/2010 — Alienação parental", u: P + "_ato2007-2010/2010/lei/l12318.htm", s: "alienacao parental" },
    { k: "l13058",  r: ["civil"], t: "Lei 13.058/2014 — Guarda compartilhada", u: P + "_ato2011-2014/2014/lei/l13058.htm", s: "guarda compartilhada" },
    { k: "l9307",   r: ["civil", "processocivil"], t: "Lei 9.307/1996 — Arbitragem", u: P + "leis/l9307.htm", s: "arbitragem juizo arbitral" },
    { k: "l13874",  r: ["civil", "empresarial"], t: "Lei 13.874/2019 — Liberdade Econômica", u: P + "_ato2019-2022/2019/lei/L13874.htm", s: "liberdade economica declaracao direitos" },
    { k: "l6194",   r: ["civil"], t: "Lei 6.194/1974 — Seguro DPVAT", u: P + "leis/l6194.htm", s: "DPVAT seguro obrigatorio" },

    /* --------------------------- PROCESSUAL CIVIL --------------------------- */
    { k: "cpc2015", r: ["processocivil"], t: "Código de Processo Civil — Lei 13.105/2015", u: P + "_ato2015-2018/2015/lei/l13105.htm", s: "CPC novo codigo processo civil" },
    { k: "l9099",   r: ["processocivil", "processopenal"], t: "Lei 9.099/1995 — Juizados Especiais Cíveis e Criminais", u: P + "leis/l9099.htm", s: "JEC juizado especial" },
    { k: "l10259",  r: ["processocivil"], t: "Lei 10.259/2001 — Juizados Especiais Federais", u: P + "leis/leis_2001/l10259.htm", s: "JEF juizado federal" },
    { k: "l12153",  r: ["processocivil"], t: "Lei 12.153/2009 — Juizados da Fazenda Pública", u: P + "_ato2007-2010/2009/lei/l12153.htm", s: "juizado fazenda publica estadual" },
    { k: "l11419",  r: ["processocivil", "digital"], t: "Lei 11.419/2006 — Informatização do processo judicial", u: P + "_ato2004-2006/2006/lei/l11419.htm", s: "processo eletronico" },
    { k: "l13140",  r: ["processocivil"], t: "Lei 13.140/2015 — Mediação", u: P + "_ato2015-2018/2015/lei/l13140.htm", s: "mediacao autocomposicao" },
    { k: "l6830",   r: ["processocivil", "tributario"], t: "Lei 6.830/1980 — Execução Fiscal (LEF)", u: P + "leis/l6830.htm", s: "LEF execucao fiscal" },
    { k: "l8397",   r: ["processocivil", "tributario"], t: "Lei 8.397/1992 — Medida cautelar fiscal", u: P + "leis/l8397.htm", s: "cautelar fiscal" },
    { k: "l1060",   r: ["processocivil"], t: "Lei 1.060/1950 — Assistência judiciária gratuita", u: P + "leis/l1060compilada.htm", s: "justica gratuita assistencia judiciaria" },

    /* -------------------------------- PENAL --------------------------------- */
    { k: "cp1940",  r: ["penal"], t: "Código Penal — DL 2.848/1940", u: P + "decreto-lei/del2848compilado.htm", s: "CP codigo penal" },
    { k: "lcp1941", r: ["penal"], t: "Lei das Contravenções Penais — DL 3.688/1941", u: P + "decreto-lei/del3688.htm", s: "contravencao penal LCP" },
    { k: "l7210",   r: ["penal"], t: "Lei 7.210/1984 — Execução Penal (LEP)", u: P + "leis/l7210.htm", s: "LEP execucao penal" },
    { k: "l8072",   r: ["penal"], t: "Lei 8.072/1990 — Crimes Hediondos", u: P + "leis/l8072.htm", s: "hediondo" },
    { k: "l11343",  r: ["penal"], t: "Lei 11.343/2006 — Drogas", u: P + "_ato2004-2006/2006/lei/l11343.htm", s: "lei de drogas trafico" },
    { k: "l12850",  r: ["penal", "processopenal"], t: "Lei 12.850/2013 — Organizações Criminosas", u: P + "_ato2011-2014/2013/lei/l12850.htm", s: "orcrim colaboracao premiada" },
    { k: "l9613",   r: ["penal"], t: "Lei 9.613/1998 — Lavagem de dinheiro", u: P + "leis/l9613.htm", s: "lavagem capitais COAF" },
    { k: "l8137",   r: ["penal", "tributario"], t: "Lei 8.137/1990 — Crimes contra a ordem tributária e econômica", u: P + "leis/l8137.htm", s: "crime tributario sonegacao" },
    { k: "l7492",   r: ["penal", "financeiro"], t: "Lei 7.492/1986 — Crimes contra o Sistema Financeiro", u: P + "leis/l7492.htm", s: "colarinho branco SFN" },
    { k: "l4729",   r: ["penal", "tributario"], t: "Lei 4.729/1965 — Crime de sonegação fiscal", u: P + "leis/1950-1969/l4729.htm", s: "sonegacao fiscal" },
    { k: "l10826",  r: ["penal"], t: "Lei 10.826/2003 — Estatuto do Desarmamento", u: P + "leis/2003/l10.826.htm", s: "arma de fogo desarmamento" },
    { k: "l9503",   r: ["penal", "administrativo"], t: "Código de Trânsito Brasileiro — Lei 9.503/1997", u: P + "leis/l9503compilado.htm", s: "CTB transito" },
    { k: "l7716",   r: ["penal", "humanos"], t: "Lei 7.716/1989 — Crimes de racismo", u: P + "leis/l7716.htm", s: "racismo injuria racial" },
    { k: "l9455",   r: ["penal", "humanos"], t: "Lei 9.455/1997 — Tortura", u: P + "leis/l9455.htm", s: "tortura" },
    { k: "l2889",   r: ["penal", "humanos"], t: "Lei 2.889/1956 — Genocídio", u: P + "leis/l2889.htm", s: "genocidio" },
    { k: "l13260",  r: ["penal"], t: "Lei 13.260/2016 — Terrorismo", u: P + "_ato2015-2018/2016/lei/l13260.htm", s: "terrorismo" },
    { k: "l14197",  r: ["penal"], t: "Lei 14.197/2021 — Crimes contra o Estado Democrático de Direito", u: P + "_ato2019-2022/2021/lei/L14197.htm", s: "estado democratico crimes" },

    /* ---------------------------- PROCESSUAL PENAL -------------------------- */
    { k: "cpp1941", r: ["processopenal"], t: "Código de Processo Penal — DL 3.689/1941", u: P + "decreto-lei/del3689compilado.htm", s: "CPP codigo processo penal" },
    { k: "l9296",   r: ["processopenal"], t: "Lei 9.296/1996 — Interceptação telefônica", u: P + "leis/l9296.htm", s: "interceptacao escuta telefonica" },
    { k: "l12037",  r: ["processopenal"], t: "Lei 12.037/2009 — Identificação criminal", u: P + "_ato2007-2010/2009/lei/l12037.htm", s: "identificacao criminal perfil genetico" },
    { k: "l12654",  r: ["processopenal"], t: "Lei 12.654/2012 — Perfil genético", u: P + "_ato2011-2014/2012/lei/l12654.htm", s: "DNA perfil genetico banco" },
    { k: "l13964",  r: ["processopenal", "penal"], t: "Lei 13.964/2019 — Pacote Anticrime", u: P + "_ato2019-2022/2019/lei/L13964.htm", s: "pacote anticrime juiz garantias" },
    { k: "l7960",   r: ["processopenal"], t: "Lei 7.960/1989 — Prisão temporária", u: P + "leis/l7960.htm", s: "prisao temporaria" },
    { k: "l13245",  r: ["processopenal"], t: "Lei 13.245/2016 — Prerrogativas do advogado no inquérito", u: P + "_ato2015-2018/2016/lei/l13245.htm", s: "advogado inquerito prerrogativa" },
    { k: "l13431",  r: ["processopenal", "estatutos"], t: "Lei 13.431/2017 — Escuta especializada e depoimento especial", u: P + "_ato2015-2018/2017/lei/L13431.htm", s: "depoimento especial crianca vitima" },

    /* ------------------------------ EMPRESARIAL ----------------------------- */
    { k: "l11101",  r: ["empresarial"], t: "Lei 11.101/2005 — Recuperação judicial e Falência", u: P + "_ato2004-2006/2005/lei/l11101.htm", s: "falencia recuperacao judicial" },
    { k: "l6404",   r: ["empresarial"], t: "Lei 6.404/1976 — Sociedades por Ações", u: P + "leis/l6404compilada.htm", s: "SA sociedade anonima LSA" },
    { k: "l9279",   r: ["empresarial"], t: "Lei 9.279/1996 — Propriedade Industrial", u: P + "leis/l9279.htm", s: "marca patente LPI" },
    { k: "l9610",   r: ["empresarial", "civil"], t: "Lei 9.610/1998 — Direitos Autorais", u: P + "leis/l9610.htm", s: "direito autoral" },
    { k: "l9609",   r: ["empresarial", "digital"], t: "Lei 9.609/1998 — Programa de computador (software)", u: P + "leis/l9609.htm", s: "software programa computador" },
    { k: "l5474",   r: ["empresarial"], t: "Lei 5.474/1968 — Duplicatas", u: P + "leis/l5474.htm", s: "duplicata titulo credito" },
    { k: "l7357",   r: ["empresarial"], t: "Lei 7.357/1985 — Cheque", u: P + "leis/l7357.htm", s: "cheque" },
    { k: "d57663",  r: ["empresarial"], t: "Decreto 57.663/1966 — Lei Uniforme de Genebra (letra de câmbio e nota promissória)", u: P + "decreto/1950-1969/d57663.htm", s: "LUG letra cambio nota promissoria" },
    { k: "d2044",   r: ["empresarial"], t: "Decreto 2.044/1908 — Letra de câmbio e nota promissória", u: P + "decreto/1900-1909/d2044.htm", s: "letra cambio" },
    { k: "l12529",  r: ["empresarial", "financeiro"], t: "Lei 12.529/2011 — Defesa da Concorrência (CADE)", u: P + "_ato2011-2014/2011/lei/l12529.htm", s: "CADE concorrencia antitruste" },
    { k: "lc123",   r: ["empresarial", "tributario"], t: "LC 123/2006 — Estatuto da Microempresa e Simples Nacional", u: P + "leis/lcp/lcp123.htm", s: "simples nacional ME EPP MEI" },
    { k: "l8934",   r: ["empresarial", "registros"], t: "Lei 8.934/1994 — Registro Público de Empresas Mercantis", u: P + "leis/l8934.htm", s: "junta comercial registro empresa" },

    /* ------------------------------- TRIBUTÁRIO ----------------------------- */
    { k: "ctn",     r: ["tributario"], t: "Código Tributário Nacional — Lei 5.172/1966", u: P + "leis/l5172compilado.htm", s: "CTN codigo tributario" },
    { k: "lc87",    r: ["tributario"], t: "LC 87/1996 — ICMS (Lei Kandir)", u: P + "leis/lcp/lcp87.htm", s: "ICMS kandir" },
    { k: "lc116",   r: ["tributario"], t: "LC 116/2003 — ISS", u: P + "leis/lcp/lcp116.htm", s: "ISS servicos" },
    { k: "lc24",    r: ["tributario"], t: "LC 24/1975 — Convênios de ICMS", u: P + "leis/lcp/lcp24.htm", s: "convenio ICMS CONFAZ" },
    { k: "lc105",   r: ["tributario", "financeiro"], t: "LC 105/2001 — Sigilo das operações financeiras", u: P + "leis/lcp/lcp105.htm", s: "sigilo bancario" },
    { k: "l9430",   r: ["tributario"], t: "Lei 9.430/1996 — Legislação tributária federal", u: P + "leis/l9430.htm", s: "processo administrativo fiscal" },
    { k: "d70235",  r: ["tributario"], t: "Decreto 70.235/1972 — Processo administrativo fiscal", u: P + "decreto/D70235cons.htm", s: "PAF CARF" },
    { k: "lc214",   r: ["tributario"], t: "LC 214/2025 — Reforma tributária do consumo (IBS/CBS)", u: P + "leis/lcp/Lcp214.htm", s: "IBS CBS reforma tributaria IVA" },
    { k: "ec132",   r: ["tributario", "constitucional"], t: "EC 132/2023 — Reforma Tributária", u: P + "constituicao/emendas/emc/emc132.htm", s: "emenda reforma tributaria" },

    /* -------------------------------- TRABALHO ------------------------------ */
    { k: "clt",     r: ["trabalho"], t: "CLT — DL 5.452/1943", u: P + "decreto-lei/del5452compilado.htm", s: "CLT consolidacao leis trabalho" },
    { k: "l605",    r: ["trabalho"], t: "Lei 605/1949 — Repouso semanal remunerado", u: P + "leis/l0605.htm", s: "RSR repouso semanal" },
    { k: "l8036",   r: ["trabalho"], t: "Lei 8.036/1990 — FGTS", u: P + "leis/l8036consol.htm", s: "FGTS fundo garantia" },
    { k: "l7783",   r: ["trabalho"], t: "Lei 7.783/1989 — Greve", u: P + "leis/l7783.htm", s: "greve" },
    { k: "l5889",   r: ["trabalho", "agrario"], t: "Lei 5.889/1973 — Trabalho rural", u: P + "leis/l5889.htm", s: "trabalhador rural" },
    { k: "lc150",   r: ["trabalho"], t: "LC 150/2015 — Empregado doméstico", u: P + "leis/lcp/lcp150.htm", s: "domestico" },
    { k: "l6019",   r: ["trabalho"], t: "Lei 6.019/1974 — Trabalho temporário e terceirização", u: P + "leis/l6019.htm", s: "terceirizacao trabalho temporario" },

    /* ----------------------------- PREVIDENCIÁRIO --------------------------- */
    { k: "l8213",   r: ["previdenciario"], t: "Lei 8.213/1991 — Planos de Benefícios da Previdência Social", u: P + "leis/l8213cons.htm", s: "beneficios INSS aposentadoria" },
    { k: "l8212",   r: ["previdenciario", "tributario"], t: "Lei 8.212/1991 — Custeio da Seguridade Social", u: P + "leis/l8212cons.htm", s: "custeio contribuicao previdenciaria" },
    { k: "d3048",   r: ["previdenciario"], t: "Decreto 3.048/1999 — Regulamento da Previdência Social", u: P + "decreto/d3048.htm", s: "RPS regulamento previdencia" },
    { k: "l8742",   r: ["previdenciario"], t: "Lei 8.742/1993 — LOAS / Assistência Social", u: P + "leis/l8742.htm", s: "LOAS BPC assistencia social" },
    { k: "lc109",   r: ["previdenciario"], t: "LC 109/2001 — Previdência complementar privada", u: P + "leis/lcp/lcp109.htm", s: "previdencia complementar fundo pensao" },
    { k: "lc108",   r: ["previdenciario"], t: "LC 108/2001 — Entidades fechadas patrocinadas pelo poder público", u: P + "leis/lcp/lcp108.htm", s: "previdencia complementar publica" },
    { k: "l9717",   r: ["previdenciario", "administrativo"], t: "Lei 9.717/1998 — Regimes próprios de previdência (RPPS)", u: P + "leis/l9717.htm", s: "RPPS servidor previdencia" },
    { k: "l8080",   r: ["previdenciario", "administrativo"], t: "Lei 8.080/1990 — Sistema Único de Saúde (SUS)", u: P + "leis/l8080.htm", s: "SUS saude" },

    /* ------------------------------- CONSUMIDOR ----------------------------- */
    { k: "cdc",     r: ["consumidor", "difusos"], t: "Código de Defesa do Consumidor — Lei 8.078/1990", u: P + "leis/l8078compilado.htm", s: "CDC consumidor" },
    { k: "d2181",   r: ["consumidor"], t: "Decreto 2.181/1997 — Sistema Nacional de Defesa do Consumidor", u: P + "decreto/d2181.htm", s: "SNDC PROCON sancoes administrativas" },
    { k: "l14181",  r: ["consumidor"], t: "Lei 14.181/2021 — Superendividamento", u: P + "_ato2019-2022/2021/lei/L14181.htm", s: "superendividamento credito" },

    /* ------------------------- AMBIENTAL E URBANÍSTICO ---------------------- */
    { k: "l6938",   r: ["ambiental"], t: "Lei 6.938/1981 — Política Nacional do Meio Ambiente", u: P + "leis/l6938.htm", s: "PNMA SISNAMA licenciamento" },
    { k: "l9605",   r: ["ambiental", "penal"], t: "Lei 9.605/1998 — Crimes ambientais", u: P + "leis/l9605.htm", s: "crime ambiental infracao" },
    { k: "l12651",  r: ["ambiental"], t: "Lei 12.651/2012 — Código Florestal", u: P + "_ato2011-2014/2012/lei/l12651.htm", s: "codigo florestal APP reserva legal" },
    { k: "l9985",   r: ["ambiental"], t: "Lei 9.985/2000 — SNUC (unidades de conservação)", u: P + "leis/l9985.htm", s: "SNUC unidade conservacao" },
    { k: "l12305",  r: ["ambiental"], t: "Lei 12.305/2010 — Política Nacional de Resíduos Sólidos", u: P + "_ato2007-2010/2010/lei/l12305.htm", s: "PNRS residuos solidos" },
    { k: "l9433",   r: ["ambiental"], t: "Lei 9.433/1997 — Política Nacional de Recursos Hídricos", u: P + "leis/l9433.htm", s: "agua recursos hidricos" },
    { k: "l11445",  r: ["ambiental", "administrativo"], t: "Lei 11.445/2007 — Saneamento básico", u: P + "_ato2007-2010/2007/lei/l11445.htm", s: "saneamento marco legal" },
    { k: "l10257",  r: ["ambiental"], t: "Lei 10.257/2001 — Estatuto da Cidade", u: P + "leis/leis_2001/l10257.htm", s: "estatuto cidade plano diretor urbanistico" },
    { k: "l6766",   r: ["ambiental", "registros"], t: "Lei 6.766/1979 — Parcelamento do solo urbano", u: P + "leis/l6766.htm", s: "loteamento parcelamento solo" },
    { k: "l13465",  r: ["ambiental", "registros"], t: "Lei 13.465/2017 — Regularização fundiária (REURB)", u: P + "_ato2015-2018/2017/lei/l13465.htm", s: "REURB regularizacao fundiaria" },

    /* --------------------------------- AGRÁRIO ------------------------------ */
    { k: "l4504",   r: ["agrario"], t: "Lei 4.504/1964 — Estatuto da Terra", u: P + "leis/l4504.htm", s: "estatuto terra" },
    { k: "l8629",   r: ["agrario"], t: "Lei 8.629/1993 — Reforma agrária", u: P + "leis/l8629.htm", s: "reforma agraria desapropriacao rural" },
    { k: "lc76",    r: ["agrario", "processocivil"], t: "LC 76/1993 — Rito da desapropriação para reforma agrária", u: P + "leis/lcp/lcp76.htm", s: "rito sumario desapropriacao" },

    /* -------------------------------- ELEITORAL ----------------------------- */
    { k: "l4737",   r: ["eleitoral"], t: "Código Eleitoral — Lei 4.737/1965", u: P + "leis/l4737compilado.htm", s: "codigo eleitoral" },
    { k: "l9504",   r: ["eleitoral"], t: "Lei 9.504/1997 — Lei das Eleições", u: P + "leis/l9504.htm", s: "lei eleicoes campanha" },
    { k: "l9096",   r: ["eleitoral"], t: "Lei 9.096/1995 — Partidos Políticos", u: P + "leis/l9096.htm", s: "partido politico" },
    { k: "lc64",    r: ["eleitoral"], t: "LC 64/1990 — Inelegibilidades (Ficha Limpa)", u: P + "leis/lcp/lcp64.htm", s: "inelegibilidade ficha limpa" },

    /* -------------------------- ESTATUTOS E VULNERÁVEIS --------------------- */
    { k: "eca",     r: ["estatutos", "difusos"], t: "Estatuto da Criança e do Adolescente — Lei 8.069/1990", u: P + "leis/l8069.htm", s: "ECA crianca adolescente" },
    { k: "l12594",  r: ["estatutos"], t: "Lei 12.594/2012 — SINASE", u: P + "_ato2011-2014/2012/lei/l12594.htm", s: "SINASE medida socioeducativa" },
    { k: "l10741",  r: ["estatutos"], t: "Estatuto da Pessoa Idosa — Lei 10.741/2003", u: P + "leis/2003/l10.741.htm", s: "idoso estatuto" },
    { k: "l13146",  r: ["estatutos"], t: "Estatuto da Pessoa com Deficiência — Lei 13.146/2015", u: P + "_ato2015-2018/2015/lei/l13146.htm", s: "LBI deficiencia inclusao" },
    { k: "l11340",  r: ["estatutos", "penal"], t: "Lei 11.340/2006 — Maria da Penha", u: P + "_ato2004-2006/2006/lei/l11340.htm", s: "maria da penha violencia domestica" },
    { k: "l14344",  r: ["estatutos", "penal"], t: "Lei 14.344/2022 — Henry Borel (violência contra criança)", u: P + "_ato2019-2022/2022/lei/L14344.htm", s: "henry borel violencia domestica crianca" },
    { k: "l12288",  r: ["estatutos", "humanos"], t: "Lei 12.288/2010 — Estatuto da Igualdade Racial", u: P + "_ato2007-2010/2010/lei/l12288.htm", s: "igualdade racial" },
    { k: "l6001",   r: ["estatutos", "humanos"], t: "Lei 6.001/1973 — Estatuto do Índio", u: P + "leis/l6001.htm", s: "indigena indio" },

    /* --------------------------- DIFUSOS E COLETIVOS ------------------------ */
    { k: "l7347",   r: ["difusos"], t: "Lei 7.347/1985 — Ação Civil Pública", u: P + "leis/l7347compilada.htm", s: "ACP acao civil publica" },
    { k: "l4717",   r: ["difusos", "administrativo"], t: "Lei 4.717/1965 — Ação Popular", u: P + "leis/l4717.htm", s: "acao popular" },
    { k: "l8625",   r: ["difusos", "judiciaria"], t: "Lei 8.625/1993 — Lei Orgânica Nacional do MP", u: P + "leis/l8625.htm", s: "LONMP ministerio publico" },
    { k: "lc75",    r: ["difusos", "judiciaria"], t: "LC 75/1993 — Estatuto do Ministério Público da União", u: P + "leis/lcp/lcp75.htm", s: "MPU MPF ministerio publico uniao" },
    { k: "l7853",   r: ["difusos", "estatutos"], t: "Lei 7.853/1989 — Apoio às pessoas com deficiência e tutela coletiva", u: P + "leis/l7853.htm", s: "deficiencia tutela coletiva" },

    /* --------------------- INTERNACIONAL E DIREITOS HUMANOS ----------------- */
    { k: "d678",    r: ["humanos"], t: "Decreto 678/1992 — Convenção Americana (Pacto de São José)", u: P + "decreto/d0678.htm", s: "pacto sao jose convencao americana CADH" },
    { k: "d592",    r: ["humanos"], t: "Decreto 592/1992 — Pacto Internacional de Direitos Civis e Políticos", u: P + "decreto/1990-1994/d0592.htm", s: "PIDCP" },
    { k: "d591",    r: ["humanos"], t: "Decreto 591/1992 — Pacto Internacional de Direitos Econômicos, Sociais e Culturais", u: P + "decreto/1990-1994/d0591.htm", s: "PIDESC" },
    { k: "d4388",   r: ["humanos", "penal"], t: "Decreto 4.388/2002 — Estatuto de Roma do TPI", u: P + "decreto/2002/d4388.htm", s: "TPI estatuto roma" },
    { k: "d6949",   r: ["humanos", "estatutos"], t: "Decreto 6.949/2009 — Convenção sobre os Direitos das Pessoas com Deficiência", u: P + "_ato2007-2010/2009/decreto/d6949.htm", s: "convencao nova york deficiencia" },
    { k: "l13445",  r: ["humanos"], t: "Lei 13.445/2017 — Lei de Migração", u: P + "_ato2015-2018/2017/lei/l13445.htm", s: "migracao estrangeiro extradicao" },
    { k: "l9474",   r: ["humanos"], t: "Lei 9.474/1997 — Estatuto dos Refugiados", u: P + "leis/l9474.htm", s: "refugiado CONARE" },
    { k: "d9081",   r: ["humanos", "civil"], t: "Decreto 3.087/1999 — Convenção de Haia (adoção internacional)", u: P + "decreto/d3087.htm", s: "haia adocao internacional" },

    /* --------------------- REGISTROS PÚBLICOS E NOTARIAL -------------------- */
    { k: "l6015",   r: ["registros"], t: "Lei 6.015/1973 — Registros Públicos", u: P + "leis/l6015compilada.htm", s: "LRP registros publicos cartorio" },
    { k: "l8935",   r: ["registros"], t: "Lei 8.935/1994 — Notários e Registradores", u: P + "leis/l8935.htm", s: "cartorio notario registrador tabeliao" },
    { k: "l9492",   r: ["registros", "empresarial"], t: "Lei 9.492/1997 — Protesto de títulos", u: P + "leis/l9492.htm", s: "protesto titulo" },
    { k: "l11441",  r: ["registros", "processocivil"], t: "Lei 11.441/2007 — Inventário, partilha e divórcio extrajudiciais", u: P + "_ato2007-2010/2007/lei/l11441.htm", s: "inventario extrajudicial divorcio cartorio" },
    { k: "l10169",  r: ["registros"], t: "Lei 10.169/2000 — Emolumentos dos serviços notariais e de registro", u: P + "leis/l10169.htm", s: "emolumentos custas cartorio" },

    /* ------------------------- FINANCEIRO E ECONÔMICO ----------------------- */
    { k: "l4320",   r: ["financeiro"], t: "Lei 4.320/1964 — Normas gerais de direito financeiro", u: P + "leis/l4320compilado.htm", s: "orcamento direito financeiro" },
    { k: "lc101",   r: ["financeiro", "administrativo"], t: "LC 101/2000 — Responsabilidade Fiscal (LRF)", u: P + "leis/lcp/lcp101.htm", s: "LRF responsabilidade fiscal" },
    { k: "l8443",   r: ["financeiro", "administrativo"], t: "Lei 8.443/1992 — Lei Orgânica do TCU", u: P + "leis/l8443.htm", s: "TCU tribunal contas" },
    { k: "l4595",   r: ["financeiro"], t: "Lei 4.595/1964 — Sistema Financeiro Nacional", u: P + "leis/l4595.htm", s: "SFN banco central CMN" },
    { k: "l6385",   r: ["financeiro", "empresarial"], t: "Lei 6.385/1976 — Mercado de valores mobiliários e CVM", u: P + "leis/l6385.htm", s: "CVM mercado capitais" },

    /* -------------------------------- MILITAR ------------------------------- */
    { k: "cpm",     r: ["militar", "penal"], t: "Código Penal Militar — DL 1.001/1969", u: P + "decreto-lei/del1001compilado.htm", s: "CPM penal militar" },
    { k: "cppm",    r: ["militar", "processopenal"], t: "Código de Processo Penal Militar — DL 1.002/1969", u: P + "decreto-lei/del1002compilado.htm", s: "CPPM processo penal militar" },
    { k: "l8457",   r: ["militar", "judiciaria"], t: "Lei 8.457/1992 — Organização da Justiça Militar da União", u: P + "leis/l8457.htm", s: "justica militar organizacao" },

    /* --------------------- DIGITAL E PROTEÇÃO DE DADOS ---------------------- */
    { k: "l13709",  r: ["digital"], t: "Lei 13.709/2018 — LGPD", u: P + "_ato2015-2018/2018/lei/L13709.htm", s: "LGPD dados pessoais ANPD" },
    { k: "l12965",  r: ["digital"], t: "Lei 12.965/2014 — Marco Civil da Internet", u: P + "_ato2011-2014/2014/lei/l12965.htm", s: "marco civil internet" },
    { k: "l12737",  r: ["digital", "penal"], t: "Lei 12.737/2012 — Crimes informáticos (Carolina Dieckmann)", u: P + "_ato2011-2014/2012/lei/l12737.htm", s: "crime informatico invasao dispositivo" },
    { k: "l14063",  r: ["digital", "administrativo"], t: "Lei 14.063/2020 — Assinaturas eletrônicas", u: P + "_ato2019-2022/2020/lei/L14063.htm", s: "assinatura eletronica digital" },

    /* ------------------ ORGANIZAÇÃO JUDICIÁRIA E CARREIRAS ------------------ */
    { k: "lc35",    r: ["judiciaria"], t: "LC 35/1979 — LOMAN (Lei Orgânica da Magistratura)", u: P + "leis/lcp/lcp35.htm", s: "LOMAN magistratura juiz" },
    { k: "l8906",   r: ["judiciaria"], t: "Lei 8.906/1994 — Estatuto da OAB", u: P + "leis/l8906.htm", s: "OAB advogado estatuto" },
    { k: "lc80",    r: ["judiciaria"], t: "LC 80/1994 — Defensoria Pública", u: P + "leis/lcp/lcp80.htm", s: "defensoria publica defensor" },
    { k: "l11697",  r: ["judiciaria"], t: "Lei 11.697/2008 — Organização Judiciária do DF e Territórios", u: P + "_ato2007-2010/2008/lei/l11697.htm", s: "TJDFT organizacao judiciaria" },
    { k: "l5010",   r: ["judiciaria", "processocivil"], t: "Lei 5.010/1966 — Organização da Justiça Federal de 1ª instância", u: P + "leis/l5010.htm", s: "justica federal secao judiciaria organizacao" }
  ];

  var VMCAT = { RAMOS: RAMOS, LEIS: LEIS, PLANALTO: P };

  if (typeof module !== "undefined" && module.exports) module.exports = VMCAT;
  if (root) root.VMCAT = VMCAT;
})(typeof window !== "undefined" ? window : null);
