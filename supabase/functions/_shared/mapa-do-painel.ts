/**
 * Mapa do painel (frente AG, 26/09): o que cada área faz, onde fica (rota),
 * qual agente trabalha nela e o que ele já sabe FAZER.
 *
 * Pedido do dono: "deixar todos os agentes fazerem as coisas. Eu peço, ele já
 * vai fazendo. Ele já conhece todo o painel, tudo". Cada agente recebe o bloco
 * curto deste mapa no prompt de sistema (blocoDoMapaDoPainel) para:
 * 1. saber onde as coisas estão e sugerir o próximo passo com o nome certo;
 * 2. quando o pedido é de outra área, responder "Isso é na Mesa X. Abro para
 *    você?" citando a rota (a tela transforma a rota em link com o cliente),
 *    em vez de dizer que não sabe;
 * 3. nunca inventar área, rota ou ação.
 *
 * O bloco é compacto de propósito (custo por mensagem): uma linha por área.
 * "minimo" (só nome e rota) serve para quem roda em lote (Central, Ciclo).
 *
 * Sem import de Deno nem de npm e sem regex moderna: as funções (Deno), a tela
 * (Vite, Safari 11) e os testes (vitest) leem o mesmo arquivo. Sem travessão.
 */

export type ChaveDaArea =
  | "dashboard"
  | "central"
  | "ciclo"
  | "clientes"
  | "projetos"
  | "kanban"
  | "calendario"
  | "aprovacoes"
  | "execucao"
  | "pedidos"
  | "briefings"
  | "contratos"
  | "arquivos"
  | "workspace"
  | "metricas"
  | "anuncios"
  | "relatorios"
  | "comercial"
  | "mesa"
  | "mesa_ads"
  | "mesa_foto"
  | "mesa_publicidade"
  | "mesa_roteiros"
  | "mesa_videos"
  | "mesa_edicao"
  | "mesa_identidade" | "mesa_proposta" | "mesa_site" | "mesa_motion"
  | "financeiro"
  | "cofre"
  | "equipe";

export type AreaDoPainel = {
  chave: ChaveDaArea;
  nome: string;
  rota: string;
  /** Nome do parâmetro da etapa no endereço (Mesa usa "aba"; as outras mesas, "etapa"). */
  parametro?: "aba" | "etapa";
  etapas?: string[];
  /** A tela abre já com o cliente (?client=<id>). */
  comCliente: boolean;
  /** Nome do parâmetro do cliente quando a tela lê outro (Anúncios lê ?cliente=). Padrão: client. */
  parametroDoCliente?: string;
  /** O que se faz lá, em poucas palavras. */
  faz: string;
  /** Agente da área (chave de AGENTES_DO_PAINEL), quando há. */
  agente?: string;
  /** Área só de pessoa: agente nenhum mexe (financeiro, cofre, equipe). */
  soPessoa?: boolean;
  /** Palavras que puxam o pedido para esta área (roteamento sem IA, reserva do Jev). */
  palavras: string[];
};

export const AREAS_DO_PAINEL: AreaDoPainel[] = [
  { chave: "dashboard", nome: "Dashboard", rota: "/dashboard", comCliente: false, faz: "visão do dia", palavras: ["dashboard", "visao geral", "inicio"] },
  { chave: "central", nome: "Central", rota: "/central", comCliente: false, faz: "dossiê de todos e perguntas da semana", agente: "central", palavras: ["central", "atualizar todos", "dossie geral", "perguntas da semana"] },
  { chave: "ciclo", nome: "Ciclo", rota: "/ciclo", comCliente: true, faz: "semana, pendências e rituais (/ciclo/revisao)", agente: "ciclo", palavras: ["ciclo", "ritual", "semana do cliente", "revisao do ciclo", "pendencia"] },
  { chave: "clientes", nome: "Clientes", rota: "/clientes", comCliente: true, faz: "cadastro, dossiê e jornada", palavras: ["cadastro", "dossie", "jornada", "ficha do cliente", "dados do cliente"] },
  { chave: "projetos", nome: "Projetos", rota: "/projetos", comCliente: true, faz: "projetos, marcos e tarefas", agente: "aceleriq", palavras: ["projeto", "marco", "etapa do projeto", "escopo"] },
  { chave: "kanban", nome: "Kanban", rota: "/kanban", comCliente: true, faz: "quadro das tarefas", agente: "aceleriq", palavras: ["kanban", "quadro", "tarefa", "tarefas"] },
  { chave: "calendario", nome: "Agenda", rota: "/calendario", comCliente: true, faz: "posts agendados e publicação", palavras: ["agenda", "calendario editorial", "agendar post", "publicacao", "postar"] },
  { chave: "aprovacoes", nome: "Aprovações", rota: "/aprovacoes", comCliente: true, faz: "aprovado e ajustes do cliente", palavras: ["aprovacao", "aprovar", "ajuste do cliente", "reprovou"] },
  { chave: "execucao", nome: "Execução da equipe", rota: "/execucao", comCliente: false, faz: "quem está fazendo o quê", palavras: ["execucao", "quem esta fazendo", "operadores", "hermes"] },
  { chave: "pedidos", nome: "Pedidos", rota: "/pedidos", comCliente: true, faz: "pedidos dos clientes", palavras: ["pedido do cliente", "solicitacao"] },
  { chave: "briefings", nome: "Briefings", rota: "/briefings", comCliente: true, faz: "briefings", palavras: ["briefing"] },
  { chave: "contratos", nome: "Contratos", rota: "/contratos", comCliente: true, faz: "contratos por modelo, versões, assinatura", agente: "contratos", palavras: ["contrato", "assinatura", "clausula", "aditivo"] },
  { chave: "arquivos", nome: "Arquivos", rota: "/arquivos", comCliente: true, faz: "arquivos e versões", palavras: ["arquivos", "arquivo", "upload", "enviar arquivo"] },
  { chave: "workspace", nome: "Workspace", rota: "/workspace", comCliente: true, faz: "pastas e documentos", agente: "workspace", palavras: ["workspace", "pasta", "documento", "nota do workspace"] },
  { chave: "metricas", nome: "Métricas", rota: "/metricas", comCliente: true, faz: "números do Instagram", palavras: ["metrica", "seguidores", "alcance", "engajamento", "instagram numeros"] },
  { chave: "anuncios", nome: "Anúncios", rota: "/anuncios", comCliente: true, parametroDoCliente: "cliente", faz: "relatório de anúncios", palavras: ["relatorio de anuncio", "resultado dos anuncios"] },
  { chave: "relatorios", nome: "Relatórios", rota: "/relatorios", comCliente: true, faz: "relatórios do cliente", palavras: ["relatorio"] },
  { chave: "comercial", nome: "Comercial", rota: "/comercial", comCliente: false, faz: "CRM, leads e metas (/comercial/crm)", palavras: ["crm", "lead", "oportunidade", "comercial", "venda", "prospect"] },
  {
    chave: "mesa", nome: "Mesa", rota: "/mesa", parametro: "aba", etapas: ["contexto", "instagram", "mes", "campanhas", "estudio", "entrega"], comCliente: true,
    faz: "kit e contexto da marca, perfis do Instagram, aba Redes (Instagram e Facebook: bio, destaques, grade), plano do mês, Estúdio de artes, entrega",
    agente: "mes", palavras: ["mesa", "plano do mes", "calendario do mes", "estudio", "carrossel", "arte", "post", "lamina", "kit da marca", "contexto", "logo", "paleta", "perfis do instagram", "concorrente", "entrega", "bio", "destaque", "grade do perfil", "redes sociais", "pagina do facebook"],
  },
  {
    chave: "mesa_ads", nome: "Mesa Ads", rota: "/mesa-ads", parametro: "etapa", etapas: ["oferta", "referencias", "plano", "estudio", "conta", "resultados"], comCliente: true,
    faz: "oferta, plano, criativos, conta Meta", agente: "ads",
    palavras: ["ads", "anuncio", "campanha de anuncio", "trafego", "meta ads", "verba", "orcamento", "criativo", "publico", "pixel"],
  },
  {
    chave: "mesa_foto", nome: "Mesa Foto", rota: "/mesa-foto", parametro: "etapa", etapas: ["acervo", "kits", "criar", "ensaio", "campanha", "preparar", "revisar", "usar", "biblioteca", "modelos", "clones", "book", "canvas"], comCliente: true,
    faz: "fotos, ensaios, clones, books", agente: "foto",
    palavras: ["foto", "fotos", "ensaio", "acervo", "clone", "book", "canvas", "modelo sintetica", "fotografia"],
  },
  {
    chave: "mesa_publicidade", nome: "Mesa Publicidade", rota: "/mesa-publicidade", parametro: "etapa", etapas: ["campanha", "direcao", "tomadas", "revisao", "envio"], comCliente: true,
    faz: "campanha publicitária e tomadas", agente: "publicidade",
    palavras: ["publicidade", "territorio", "tomadas", "campanha publicitaria", "direcao de campanha"],
  },
  {
    chave: "mesa_roteiros", nome: "Mesa Roteiros", rota: "/mesa-roteiros", parametro: "etapa", etapas: ["agenda", "roteiro", "revisao", "pdf", "modelos"], comCliente: true,
    faz: "roteiros de vídeo e PDF", agente: "roteiros",
    palavras: ["roteiro", "roteiros", "gancho", "script", "fala do video"],
  },
  {
    chave: "mesa_videos", nome: "Mesa Vídeos", rota: "/mesa-videos", parametro: "etapa", etapas: ["base", "kit", "biblia", "roteiro", "gerar", "resultados"], comCliente: true,
    faz: "vídeo com IA", agente: "videos",
    palavras: ["video com ia", "gerar video", "biblia", "cena", "videos"],
  },
  {
    chave: "mesa_edicao", nome: "Mesa Edição", rota: "/mesa-edicao", parametro: "etapa", etapas: ["entrada", "organizar", "editar"], comCliente: true,
    faz: "edição de vídeo gravado", agente: "edicao",
    palavras: ["edicao", "editar video", "corte", "takes", "legenda"],
  },
  {
    chave: "mesa_identidade", nome: "Mesa Identidade", rota: "/mesa-identidade", parametro: "etapa", etapas: ["briefing", "pesquisa", "estrategia", "naming", "conceito", "sistema", "mockups", "guideline", "apresentacao", "entrega"], comCliente: true,
    faz: "marca, naming e brandbook", agente: "identidade",
    palavras: ["identidade visual", "brandbook", "brand book", "manual da marca", "naming", "nome da marca", "rebranding", "guideline", "estrategia de marca", "arquetipo", "tagline", "moodboard"],
  },
  // Frente PRO (30/09): proposta comercial do cliente (link público /proposta/:token).
  {
    chave: "mesa_proposta", nome: "Mesa Proposta", rota: "/mesa-proposta", parametro: "etapa", etapas: ["contexto", "rascunho", "revisao", "envio"], comCliente: true,
    faz: "proposta comercial com link", agente: "proposta",
    palavras: ["proposta", "proposta comercial", "aceite da proposta"],
  },
  // Frente SIT (30/09): criador de sites com o motor de código (prévia ao vivo, publicação com domínio).
  {
    chave: "mesa_site", nome: "Mesa Site", rota: "/mesa-site", parametro: "etapa", etapas: ["briefing", "referencias", "direcao", "conteudo", "imagens", "integracoes", "construcao", "revisao", "publicacao"], comCliente: true,
    faz: "sites", agente: "site",
    palavras: ["site", "landing", "pagina do site", "dominio", "hero", "secao do site", "mapa do site", "seo do site", "formulario do site"],
  },
  // Frente MOT (30/09): apresentação em motion e filme cinematográfico da marca (cenas HyperFrames pela fila).
  {
    chave: "mesa_motion", nome: "Mesa Motion", rota: "/mesa-motion", parametro: "etapa", etapas: ["insumos", "entrevista", "brand", "storyboards", "stills", "construcao", "critica", "som", "render"], comCliente: true,
    faz: "apresentação em motion e filme da marca", agente: "motion",
    palavras: ["motion", "apresentacao da empresa", "filme da marca", "video institucional", "logo animada", "vinheta", "portfolio"],
  },
  { chave: "financeiro", nome: "Financeiro", rota: "/financeiro", comCliente: false, faz: "cobrança e caixa", soPessoa: true, palavras: ["financeiro", "cobranca", "mensalidade", "pagamento", "fatura", "boleto", "caixa"] },
  { chave: "cofre", nome: "Cofre", rota: "/cofre", comCliente: false, faz: "senhas", soPessoa: true, palavras: ["senha", "cofre", "credencial", "acesso salvo"] },
  { chave: "equipe", nome: "Equipe", rota: "/equipe", comCliente: false, faz: "pessoas", soPessoa: true, palavras: ["equipe", "permissao", "papel da pessoa"] },
];

/** Agentes do painel: onde moram (função) e o que já sabem fazer com confirmação e Desfazer. */
export type AgenteDoPainel = { chave: string; nome: string; area: ChaveDaArea; funcao: string; faz: string };

export const AGENTES_DO_PAINEL: AgenteDoPainel[] = [
  { chave: "aceleriq", nome: "Aceleriq (lançador)", area: "projetos", funcao: "voice-assistant-agent", faz: "projeto do contrato, tarefa, lembrete, nota no cliente, abre áreas" },
  { chave: "central", nome: "agente da Central", area: "central", funcao: "agente-central", faz: "atualiza dossiês" },
  { chave: "ciclo", nome: "coach do Ciclo", area: "ciclo", funcao: "cycle-coach", faz: "próximo passo da semana" },
  { chave: "contexto", nome: "agente de contexto", area: "mesa", funcao: "agente-contexto", faz: "kit, contexto, logo, referências, workspace, plano do cliente" },
  { chave: "mes", nome: "agente do Mês", area: "mesa", funcao: "agente-calendario", faz: "plano do mês e agenda" },
  { chave: "estudio", nome: "diretor de arte do Estúdio", area: "mesa", funcao: "estudio-arte", faz: "artes e carrosséis" },
  { chave: "estilo", nome: "agente de estilo", area: "mesa", funcao: "agente-estilo", faz: "estilo de design" },
  { chave: "perfis", nome: "agente dos perfis do Instagram", area: "mesa", funcao: "perfis-instagram", faz: "posts ao estilo, pautas na agenda" },
  { chave: "instagram", nome: "agente das redes", area: "mesa", funcao: "mesa-instagram", faz: "bio, nome, destaques, grade e páginas do cliente" },
  { chave: "ads", nome: "estrategista de ads", area: "mesa_ads", funcao: "mesa-ads", faz: "plano, criativos, ações na conta" },
  { chave: "foto", nome: "diretor de fotografia", area: "mesa_foto", funcao: "mesa-foto", faz: "organiza e gera fotos, books" },
  { chave: "publicidade", nome: "diretor de campanha", area: "mesa_publicidade", funcao: "mesa-publicidade", faz: "campanha, territórios, tomadas, envio" },
  { chave: "roteiros", nome: "roteirista", area: "mesa_roteiros", funcao: "mesa-roteiros", faz: "gera, edita e aprova roteiros" },
  { chave: "videos", nome: "diretor de vídeo", area: "mesa_videos", funcao: "mesa-videos", faz: "gera vídeos" },
  { chave: "identidade", nome: "diretor de marca", area: "mesa_identidade", funcao: "mesa-identidade", faz: "nomes e brandbook" },
  { chave: "edicao", nome: "agente de edição", area: "mesa_edicao", funcao: "editor-video", faz: "takes e edição" },
  { chave: "proposta", nome: "estrategista comercial", area: "mesa_proposta", funcao: "mesa-proposta", faz: "escreve a proposta, pesquisa o mercado, itens e validade" },
  { chave: "site", nome: "diretor de site", area: "mesa_site", funcao: "mesa-site", faz: "constrói e ajusta o site" },
  { chave: "motion", nome: "diretor de motion", area: "mesa_motion", funcao: "mesa-motion", faz: "BRAND.md, storyboards, cenas em código, crítica, som e render do filme" },
  { chave: "workspace", nome: "agente do workspace", area: "workspace", funcao: "workspace-agent", faz: "documentos" },
  { chave: "contratos", nome: "agente de contratos", area: "contratos", funcao: "contratos", faz: "monta contrato por blocos, preenche variáveis, cláusula só com diferença e Confirmar" },
];

export const CHAVES_DAS_AREAS: ChaveDaArea[] = AREAS_DO_PAINEL.map((a) => a.chave);

export function areaPorChave(chave: unknown): AreaDoPainel | null {
  const c = String(chave == null ? "" : chave).trim().toLowerCase();
  for (const a of AREAS_DO_PAINEL) if (a.chave === c) return a;
  return null;
}

export function agentePorChave(chave: unknown): AgenteDoPainel | null {
  const c = String(chave == null ? "" : chave).trim().toLowerCase();
  for (const a of AGENTES_DO_PAINEL) if (a.chave === c) return a;
  return null;
}

/** A área de uma rota ("/mesa-ads?etapa=conta" -> mesa_ads). A mais específica ganha. */
export function areaDaRota(rota: unknown): AreaDoPainel | null {
  const s = String(rota == null ? "" : rota).trim();
  if (!s || s.charAt(0) !== "/") return null;
  const caminho = s.split("?")[0].split("#")[0].toLowerCase();
  let melhor: AreaDoPainel | null = null;
  for (const a of AREAS_DO_PAINEL) {
    if (caminho === a.rota || caminho.indexOf(`${a.rota}/`) === 0) {
      if (!melhor || a.rota.length > melhor.rota.length) melhor = a;
    }
  }
  return melhor;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Endereço da área, com o cliente (?client=) quando a área aceita e a etapa
 * quando existe na lista. Sempre caminho interno (começa com "/").
 */
export function linkDaArea(chave: unknown, opcoes: { clientId?: string | null; etapa?: string | null } = {}): string | null {
  const a = areaPorChave(chave);
  if (!a) return null;
  const partes: string[] = [];
  if (a.comCliente && opcoes.clientId && UUID.test(String(opcoes.clientId))) partes.push(`${a.parametroDoCliente || "client"}=${encodeURIComponent(String(opcoes.clientId))}`);
  const etapa = String(opcoes.etapa || "").trim().toLowerCase();
  if (a.parametro && etapa && a.etapas && a.etapas.indexOf(etapa) >= 0) partes.push(`${a.parametro}=${encodeURIComponent(etapa)}`);
  return partes.length ? `${a.rota}?${partes.join("&")}` : a.rota;
}

export type DestinoNoPainel = { area: ChaveDaArea; nome: string; link: string; etapa: string | null; soPessoa: boolean };

/**
 * Lê o destino que o modelo pediu (chave da área, "chave:etapa" ou a rota) e
 * devolve o link pronto. Área inventada: null.
 */
export function destinoDoPedido(bruto: unknown, clientId?: string | null): DestinoNoPainel | null {
  if (!bruto) return null;
  let chave = "";
  let etapa = "";
  if (typeof bruto === "object") {
    const o = bruto as Record<string, unknown>;
    chave = String(o.area || o.chave || "");
    etapa = String(o.etapa || "");
  } else {
    const s = String(bruto).trim();
    if (s.charAt(0) === "/") {
      const a = areaDaRota(s);
      if (!a) return null;
      chave = a.chave;
      const m = /[?&](?:etapa|aba)=([a-z_-]+)/i.exec(s);
      etapa = m ? m[1] : "";
    } else {
      const partes = s.split(":");
      chave = partes[0];
      etapa = partes[1] || "";
    }
  }
  const a = areaPorChave(chave);
  if (!a) return null;
  const e = etapa.trim().toLowerCase();
  const etapaValida = a.etapas && a.etapas.indexOf(e) >= 0 ? e : null;
  const link = linkDaArea(a.chave, { clientId, etapa: etapaValida });
  if (!link) return null;
  return { area: a.chave, nome: a.nome, link, etapa: etapaValida, soPessoa: !!a.soPessoa };
}

const semAcento = (s: string) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Roteamento sem IA (reserva quando o Jev não responde): a área cujas
 * palavras mais aparecem no pedido. Empate ou nada: null.
 */
export function areaPorPalavras(texto: unknown): { area: ChaveDaArea; pontos: number } | null {
  const t = ` ${semAcento(String(texto == null ? "" : texto)).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  if (t.trim().length < 3) return null;
  let melhor: { area: ChaveDaArea; pontos: number } | null = null;
  let empate = false;
  for (const a of AREAS_DO_PAINEL) {
    let pontos = 0;
    for (const p of a.palavras) {
      const alvo = ` ${semAcento(p)} `;
      if (t.indexOf(alvo) >= 0) pontos += p.indexOf(" ") >= 0 ? 2 : 1;
    }
    if (!pontos) continue;
    if (!melhor || pontos > melhor.pontos) {
      melhor = { area: a.chave, pontos };
      empate = false;
    } else if (pontos === melhor.pontos) {
      empate = true;
    }
  }
  return melhor && !empate ? melhor : null;
}

/** Rotas citadas num texto do agente, na ordem, sem repetir (a tela vira link; o servidor devolve ir_para). */
export function rotasNoTexto(texto: unknown): Array<{ rota: string; area: AreaDoPainel }> {
  const s = String(texto == null ? "" : texto);
  const re = /(^|[\s("'`])(\/[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?(?:\?[a-z0-9=&_-]+)?)/gi;
  const achadas: Array<{ rota: string; area: AreaDoPainel }> = [];
  const vistas: Record<string, boolean> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const rota = m[2].replace(/[.,;:!?]+$/, "");
    const area = areaDaRota(rota);
    if (!area || vistas[area.chave]) continue;
    vistas[area.chave] = true;
    achadas.push({ rota, area });
  }
  return achadas;
}

/** O primeiro destino citado na resposta do agente (para o botão "Abrir"). */
export function destinoNaResposta(texto: unknown, clientId?: string | null): DestinoNoPainel | null {
  const r = rotasNoTexto(texto);
  return r.length ? destinoDoPedido(r[0].rota, clientId) : null;
}

export type NivelDoMapa = "compacto" | "minimo";

/** Marca que o teste procura no prompt de cada agente. */
export const TITULO_DO_MAPA = "MAPA DO PAINEL";

/**
 * Bloco do prompt de sistema. `agente` é a chave em AGENTES_DO_PAINEL (marca
 * "você está aqui" e o que o próprio agente faz). Compacto: uma linha por área
 * (cerca de 2,5 mil caracteres). Mínimo: nome e rota (para lotes).
 */
export function blocoDoMapaDoPainel(agente: string, opcoes: { nivel?: NivelDoMapa; semRota?: boolean } = {}): string {
  const nivel = opcoes.nivel || "compacto";
  // semRota: o texto pode chegar ao cliente (dossiê, ritual). Só o nome da área, nunca o endereço.
  if (opcoes.semRota) {
    const eu0 = agentePorChave(agente);
    const nomes = AREAS_DO_PAINEL.filter((a) => !a.soPessoa).map((a) => a.nome).join(", ");
    return `${TITULO_DO_MAPA}${eu0 ? `. Você é o ${eu0.nome}` : ""}. Áreas: ${nomes}. Ao sugerir o próximo passo, cite a área pelo nome certo, sem endereço. Nunca invente área nem ação.`;
  }
  const eu = agentePorChave(agente);
  const aqui = eu ? areaPorChave(eu.area) : null;
  const cabecalho = `${TITULO_DO_MAPA}${eu ? `. Você é o ${eu.nome}, em ${aqui ? aqui.nome : eu.area}` : ""}.`;
  const regra = [
    "Use o mapa para sugerir o próximo passo com o nome certo da área.",
    "Pedido que é de outra área: não diga que não sabe; responda curto \"Isso é na <área>. Abro para você?\" e cite a rota (ex.: /mesa-ads). A tela vira link com o cliente.",
    "Pedido para fazer algo que você não tem na lista de ações: diga numa frase o que falta (qual área e qual botão de lá) e cite a rota; nunca diga que fez.",
    "Nunca invente área, rota nem ação. Financeiro, cofre e equipe são só de pessoa: agente não mexe.",
  ].join(" ");
  if (nivel === "minimo") {
    const linhas = AREAS_DO_PAINEL.map((a) => `${a.nome} ${a.rota}`).join("; ");
    return `${cabecalho}\n${linhas}.\n${regra}`;
  }
  const agentes: Record<string, AgenteDoPainel[]> = {};
  for (const g of AGENTES_DO_PAINEL) (agentes[g.area] = agentes[g.area] || []).push(g);
  const linhas = AREAS_DO_PAINEL.map((a) => {
    const etapas = a.etapas && a.parametro ? ` (${a.parametro}: ${a.etapas.join(", ")})` : "";
    const quem = (agentes[a.chave] || []).map((g) => `${g.nome} (${g.faz})`).join("; ");
    const marca = aqui && aqui.chave === a.chave ? " [você está aqui]" : "";
    return `- ${a.nome} ${a.rota}${etapas}${marca}: ${a.faz}${a.soPessoa ? " (só pessoa)" : ""}${quem ? `. Agente: ${quem}` : ""}.`;
  });
  return `${cabecalho}\n${linhas.join("\n")}\n${regra}`;
}

// ------------------------------------------------------------------ roteamento com o Jev

/** O próprio agente que recebeu o pedido resolve (não é outra área). */
export const OPCAO_AQUI = "aqui";
/** Conversa ou pergunta sem área nem ação. */
export const OPCAO_NENHUMA = "nenhuma";

type PerguntaDoRoteador =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

/**
 * Perguntas do Jev (uma chamada, três respostas em paralelo) sobre o mesmo
 * estado { pedido, agente, cliente, tela }:
 * - area (Choice): onde o pedido se resolve (aqui, uma área do mapa ou nenhuma);
 * - ordem (Noul): é uma ordem clara para fazer agora? (decide a execução direta);
 * - abrir (Noul): pede para abrir ou ir a uma tela? (decide navegar sozinho).
 * `aqui` descreve o que o próprio agente faz.
 */
export function perguntasDoRoteador(aqui: string): Record<"area" | "ordem" | "abrir", PerguntaDoRoteador> {
  const criteria: Record<string, string> = { [OPCAO_AQUI]: aqui };
  for (const a of AREAS_DO_PAINEL) criteria[a.chave] = `${a.nome}: ${a.faz}${a.soPessoa ? " (só a pessoa mexe)" : ""}`;
  criteria[OPCAO_NENHUMA] = "conversa, cumprimento ou pergunta geral que não pede área nem ação";
  return {
    area: {
      type: "choice",
      instructions: "Onde o `pedido` da equipe se resolve no painel da agência? `agente` é quem recebeu o pedido; escolha `aqui` quando ele mesmo faz. `cliente` é o cliente escolhido e `tela` a tela aberta.",
      criteria,
    },
    ordem: {
      type: "noul",
      instructions: "O `pedido` é uma ordem clara para fazer algo agora (criar, marcar, agendar, anotar, concluir, mudar, abrir), com o que fazer bem definido?",
      criteria: { true: "ordem clara e específica, dá para fazer sem perguntar", false: "pergunta, dúvida, sugestão, ideia ou pedido vago" },
    },
    abrir: {
      type: "noul",
      instructions: "O `pedido` pede para abrir, levar, mostrar ou ir para uma tela ou área do painel?",
    },
  };
}

export type Roteamento = {
  /** Área do mapa, "aqui", "nenhuma" ou null (sem certeza). */
  area: ChaveDaArea | typeof OPCAO_AQUI | typeof OPCAO_NENHUMA | null;
  probabilidade: number;
  ordem: number | null;
  abrir: number | null;
};

/** Lê as respostas do Jev. Área só vale com probabilidade >= limiar (padrão 0,5). */
export function lerRoteamento(answers: unknown, limiar = 0.5): Roteamento {
  const a = (answers && typeof answers === "object" ? answers : {}) as Record<string, { choice?: unknown; probabilities?: Record<string, number>; noul?: unknown }>;
  const r = a.area || {};
  const escolha = typeof r.choice === "string" ? r.choice : "";
  const prob = r.probabilities && typeof r.probabilities[escolha] === "number" ? r.probabilities[escolha] : 0;
  const valida = escolha === OPCAO_AQUI || escolha === OPCAO_NENHUMA || !!areaPorChave(escolha);
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  return {
    area: valida && prob >= limiar ? (escolha as Roteamento["area"]) : null,
    probabilidade: prob,
    ordem: num(a.ordem && a.ordem.noul),
    abrir: num(a.abrir && a.abrir.noul),
  };
}

/** Pedido para abrir ou ir a uma tela, sem o Jev (reserva). */
export function pedeParaAbrir(texto: unknown): boolean {
  const t = semAcento(String(texto == null ? "" : texto)).trim();
  return /^(por favor,?\s+)?(abr[ae]|abrir|me leva|leva|lev[ae]|vai para|va para|ir para|mostr[ae]|me mostra)\b/.test(t);
}

/**
 * "Faz e me leva" (dono, 27/09), sem o Jev (reserva): além de fazer, a pessoa
 * pede para ir à tela do resultado ("e me leva lá", "abre pra mim", "quero
 * ver"). Diferente de "leva isso para a Agenda", que é mover o item (ação):
 * aqui só conta quando o pedido é para a PESSOA ir. Na dúvida, não: o botão
 * "Ir para" continua lá.
 */
export function pedeParaLevar(texto: unknown): boolean {
  const t = ` ${semAcento(String(texto == null ? "" : texto)).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  return / (me leva|me leve|me levar|me mostra|me mostre|me manda la|abre pra mim|abre para mim|abra pra mim|abra para mim|e abre|e abra|ja abre|ja abra|abre la|abre ele|abre ela|quero ver|deixa aberto|e me leva) /.test(t);
}

/** Nome de parâmetro que pode ir no endereço (roteiro, trabalho, task...). */
const PARAMETRO_DO_ESTADO = /^[a-z][a-z_]{0,30}$/;

/**
 * Endereço da área com o estado da tela (dono, 27/09: "ele dá o caminho pra
 * mim apertar e ir e já fica tudo certinho"): cliente, etapa e o item aberto
 * (ex.: { roteiro: id }). Parâmetro com nome estranho, vazio ou longo fica de
 * fora; client e a etapa só pelos campos próprios. Sempre rota interna.
 */
export function linkComEstado(
  chave: unknown,
  opcoes: { clientId?: string | null; etapa?: string | null; estado?: Record<string, string | number | null | undefined> } = {},
): string | null {
  const a = areaPorChave(chave);
  const base = linkDaArea(chave, opcoes);
  if (!a || !base) return null;
  const extras: string[] = [];
  const estado = opcoes.estado || {};
  for (const k of Object.keys(estado)) {
    if (!PARAMETRO_DO_ESTADO.test(k) || k === "client" || k === a.parametroDoCliente || k === a.parametro) continue;
    const v = estado[k] === null || estado[k] === undefined ? "" : String(estado[k]).trim();
    if (!v || v.length > 200) continue;
    extras.push(`${k}=${encodeURIComponent(v)}`);
  }
  if (!extras.length) return base;
  return `${base}${base.indexOf("?") >= 0 ? "&" : "?"}${extras.join("&")}`;
}

/** O caminho pronto ({ rotulo, destino, abrir_sozinho? }) para uma área do mapa. Sem rótulo: "Abrir <área>". */
export function caminhoNaArea(
  chave: unknown,
  opcoes: { clientId?: string | null; etapa?: string | null; estado?: Record<string, string | number | null | undefined>; rotulo?: string; abrirSozinho?: boolean } = {},
): { rotulo: string; destino: string; abrir_sozinho?: boolean } | null {
  const a = areaPorChave(chave);
  const destino = linkComEstado(chave, opcoes);
  if (!a || !destino) return null;
  const rotulo = String(opcoes.rotulo || `Abrir ${a.nome}`).replace(/\s+/g, " ").trim().slice(0, 60);
  return opcoes.abrirSozinho ? { rotulo, destino, abrir_sozinho: true } : { rotulo, destino };
}

/**
 * O caminho de uma resposta sem ação: a primeira área que o agente citou
 * (com o cliente). Área só de pessoa também leva (a pessoa mexe lá).
 */
export function caminhoDaResposta(texto: unknown, clientId: string | null | undefined, opcoes: { abrirSozinho?: boolean } = {}): { rotulo: string; destino: string; abrir_sozinho?: boolean } | null {
  const d = destinoNaResposta(texto, clientId || null);
  if (!d) return null;
  const rotulo = `Abrir ${d.nome}`.slice(0, 60);
  return opcoes.abrirSozinho ? { rotulo, destino: d.link, abrir_sozinho: true } : { rotulo, destino: d.link };
}
