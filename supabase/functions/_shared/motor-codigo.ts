/**
 * Motor de código (frente SIT, 30/09/2026): as regras puras da fila.
 *
 * Um motor só para as mesas que geram projeto de código (a Mesa Site primeiro;
 * Motion e Apresentação depois). O painel nunca roda o agente: a função
 * `motor-codigo` valida, estima, reserva na carteira e grava o pedido na fila
 * `motor_trabalhos`; o worker (workers/motor-codigo/, fora da Edge Function)
 * pega o trabalho, roda o opencode com o modelo escolhido, grava eventos
 * resumidos (no máximo 1 por segundo), faz commit por passo e registra o custo
 * real na carteira. Desenho em plano/p4-motores.md §10.
 *
 * Puro: sem Deno, sem npm e sem banco. A função, a tela, o worker (Node 24
 * com tipos removidos) e os testes (vitest) importam o mesmo arquivo.
 */

export const ESTADOS_DO_TRABALHO = ["na_fila", "executando", "parando", "feito", "falhou", "parado", "cancelado"] as const;
export type EstadoDoTrabalho = (typeof ESTADOS_DO_TRABALHO)[number];

export const ESTADOS_ABERTOS: EstadoDoTrabalho[] = ["na_fila", "executando", "parando"];
export const ESTADOS_FINAIS: EstadoDoTrabalho[] = ["feito", "falhou", "parado", "cancelado"];

export const ROTULO_DO_ESTADO: Record<EstadoDoTrabalho, string> = {
  na_fila: "Na fila",
  executando: "Construindo",
  parando: "Parando",
  feito: "Pronto",
  falhou: "Não deu certo",
  parado: "Parado",
  cancelado: "Cancelado",
};

/** O que o trabalho faz. Só construir e ajustar gastam modelo; o resto é máquina. */
export const TIPOS_DE_TRABALHO = ["construir", "ajustar", "desfazer", "revisar", "publicar", "zip"] as const;
export type TipoDeTrabalho = (typeof TIPOS_DE_TRABALHO)[number];

export const ROTULO_DO_TIPO: Record<TipoDeTrabalho, string> = {
  construir: "Construir o site",
  ajustar: "Ajustar uma seção",
  desfazer: "Desfazer",
  revisar: "Revisar (acessibilidade, celular e SEO)",
  publicar: "Publicar",
  zip: "Guardar o código (zip)",
};

export const TIPOS_QUE_GASTAM: TipoDeTrabalho[] = ["construir", "ajustar"];

export const MESAS_DO_MOTOR = ["site", "motion", "apresentacao"] as const;
export type MesaDoMotor = (typeof MESAS_DO_MOTOR)[number];

/** Tipos de evento resumido que a tela mostra. */
export const TIPOS_DE_EVENTO = ["estado", "passo", "arquivo", "comando", "custo", "previa", "commit", "aviso", "erro", "fim"] as const;
export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];

/** Teto máximo de um trabalho (US$): acima disso, é outro pedido. */
export const TETO_MAXIMO_USD = 20;
/** Teto mínimo quando o trabalho gasta modelo. */
export const TETO_MINIMO_USD = 0.05;
/** Tamanho previsto de uma seção (tokens): medido no piloto de 30/09 e arredondado para cima. */
export const TOKENS_POR_SECAO = { entrada: 260_000, saida: 14_000, cacheFracao: 0.8 };
/** Um ajuste pontual numa seção pesa menos que construí-la. */
export const TOKENS_POR_AJUSTE = { entrada: 140_000, saida: 7_000, cacheFracao: 0.8 };
/** Base de todo trabalho que gasta: ler o AGENTS.md, o pacote e o projeto. */
export const TOKENS_DA_BASE = { entrada: 40_000, saida: 2_000, cacheFracao: 0.5 };
/**
 * A skill ui-ux-pro-max em cada passada (frente UIM, 30/09). TOKENS_POR_SECAO
 * foi medido antes dela e com o bash desligado. Agora, em cada seção (uma
 * sessão por seção), o SKILL.md entra no contexto quando o agente carrega a
 * skill e volta em todas as chamadas seguintes; somam-se o MASTER.md, as
 * buscas (1 a 4, cortadas em 12.000 caracteres), a prova de UX e a saída do
 * `npm run checar`, que passou a rodar. Esta parcela soma por passada (seção
 * ou ajuste). O teste uim-skills-do-motor liga BYTES_DO_SKILL_MD ao arquivo.
 */
export const BYTES_DO_SKILL_MD = 28_066;
/** Bytes por token do SKILL.md (Markdown técnico em inglês; a conta erra para mais). */
export const BYTES_POR_TOKEN = 4;
/**
 * Chamadas ao modelo numa seção com a skill. Medido em 30/09 na etapa C do
 * provar-skills (deepseek-v4-flash, hero e serviços): 29 chamadas nas duas
 * seções e 18 num hero sozinho; vale o maior.
 */
export const CHAMADAS_POR_SECAO = 18;
/**
 * O resto que a skill traz de volta a cada chamada (MASTER.md, saída das
 * buscas, prova de UX, saída do build e as voltas a mais). Medido na mesma
 * prova: 926.544 tokens de entrada em 2 seções (443 mil por seção, 92% em
 * cache) e 610 mil num hero sozinho; com 260 mil de TOKENS_POR_SECAO, a
 * parcela da skill ficou entre 180 e 310 mil por seção.
 */
export const TOKENS_DAS_BUSCAS = 200_000;
export const TOKENS_DA_SKILL = { entrada: Math.ceil(BYTES_DO_SKILL_MD / BYTES_POR_TOKEN) * CHAMADAS_POR_SECAO + TOKENS_DAS_BUSCAS, saida: 4_000, cacheFracao: 0.85 };
export const MAX_SECOES = 12;
export const MAX_INSTRUCAO = 4000;
/** Intervalo mínimo entre dois eventos gravados de um trabalho. */
export const INTERVALO_DOS_EVENTOS_MS = 1000;

const arred = (v: number) => Math.round(v * 1e6) / 1e6;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const ehEstado = (v: unknown): v is EstadoDoTrabalho => typeof v === "string" && (ESTADOS_DO_TRABALHO as readonly string[]).indexOf(v) >= 0;
export const ehTipo = (v: unknown): v is TipoDeTrabalho => typeof v === "string" && (TIPOS_DE_TRABALHO as readonly string[]).indexOf(v) >= 0;
export const ehAberto = (e: EstadoDoTrabalho) => ESTADOS_ABERTOS.indexOf(e) >= 0;
export const gasta = (t: TipoDeTrabalho) => TIPOS_QUE_GASTAM.indexOf(t) >= 0;

// ------------------------------------------------------------------ transições

const TRANSICOES: Record<EstadoDoTrabalho, EstadoDoTrabalho[]> = {
  na_fila: ["executando", "cancelado"],
  executando: ["parando", "feito", "falhou"],
  parando: ["parado", "feito", "falhou"],
  feito: [],
  falhou: [],
  parado: [],
  cancelado: [],
};

export function transicaoValida(de: EstadoDoTrabalho, para: EstadoDoTrabalho): boolean {
  return TRANSICOES[de].indexOf(para) >= 0;
}

/** O que o Parar faz em cada estado (null: nada a parar). */
export function efeitoDoParar(estado: EstadoDoTrabalho): EstadoDoTrabalho | null {
  if (estado === "na_fila") return "cancelado";
  if (estado === "executando") return "parando";
  return null;
}

// ------------------------------------------------------------------ modelo e custo

/** O mínimo do catálogo (ia_modelos) que o motor precisa. */
export type ModeloDoMotor = {
  id: string;
  provedor: string;
  modelo_api: string;
  preco_entrada_1m: number | null;
  preco_saida_1m: number | null;
  preco_cache_1m?: number | null;
  contexto_tokens?: number | null;
};

/** Como o opencode chama o modelo: provedor e id dele (o preço vai junto para o custo sair pela tabela). */
export function modeloParaOpencode(m: ModeloDoMotor): { providerID: string; modelID: string; entrada1m: number; saida1m: number; cache1m: number | null } {
  const provedor = m.provedor === "anthropic" || m.provedor === "openai" ? m.provedor : "openrouter";
  return {
    providerID: provedor,
    modelID: m.modelo_api,
    entrada1m: num(m.preco_entrada_1m),
    saida1m: num(m.preco_saida_1m),
    cache1m: m.preco_cache_1m == null ? null : num(m.preco_cache_1m),
  };
}

/** Serve de motor de código? Precisa de preço (para o teto valer) e de contexto grande. */
export function modeloServeParaCodigo(m: Partial<ModeloDoMotor> & { tipo?: string; ativo?: boolean }): boolean {
  if (m.tipo && m.tipo !== "texto") return false;
  if (m.ativo === false) return false;
  if (!(num(m.preco_entrada_1m) > 0) || !(num(m.preco_saida_1m) > 0)) return false;
  if (m.contexto_tokens != null && num(m.contexto_tokens) < 64_000) return false;
  return true;
}

function custoDosTokens(m: ModeloDoMotor, t: { entrada: number; saida: number; cacheFracao: number }): number {
  const pe = num(m.preco_entrada_1m);
  const ps = num(m.preco_saida_1m);
  const pc = m.preco_cache_1m == null ? pe : num(m.preco_cache_1m);
  const cache = t.entrada * t.cacheFracao;
  return ((t.entrada - cache) * pe + cache * pc + t.saida * ps) / 1_000_000;
}

export type EstimativaDoTrabalho = { estimativa_usd: number; teto_sugerido_usd: number; passos: number };

/**
 * Estimativa pela tabela do catálogo, sem chamar nada. Construir: uma sessão
 * por seção; ajustar: uma passada; o resto é máquina (zero). O teto sugerido é
 * o dobro, arredondado para cima em 5 centavos (margem para o agente errar e
 * corrigir), e nunca passa do máximo.
 */
export function estimarTrabalho(m: ModeloDoMotor | null, tipo: TipoDeTrabalho, secoes = 1): EstimativaDoTrabalho {
  if (!gasta(tipo) || !m) return { estimativa_usd: 0, teto_sugerido_usd: 0, passos: tipo === "construir" ? Math.max(1, secoes) : 1 };
  const n = tipo === "construir" ? Math.min(MAX_SECOES, Math.max(1, Math.round(secoes))) : 1;
  const porPasso = tipo === "construir" ? TOKENS_POR_SECAO : TOKENS_POR_AJUSTE;
  // UIM: cada passada (seção ou ajuste) carrega a skill ui-ux-pro-max e roda as buscas e o build.
  const bruto = custoDosTokens(m, TOKENS_DA_BASE) + n * (custoDosTokens(m, porPasso) + custoDosTokens(m, TOKENS_DA_SKILL));
  const estimativa = arred(bruto);
  const teto = Math.min(TETO_MAXIMO_USD, Math.max(TETO_MINIMO_USD, Math.ceil(estimativa * 2 * 20) / 20));
  return { estimativa_usd: estimativa, teto_sugerido_usd: arred(teto), passos: n };
}

/** Quanto da carteira já está reservado pelos trabalhos abertos (teto menos o que já gastaram). */
export function reservaAberta(trabalhos: Array<{ estado: string; teto_usd: unknown; custo_usd: unknown }>): number {
  return arred(
    trabalhos
      .filter((t) => ehEstado(t.estado) && ehAberto(t.estado))
      .reduce((s, t) => s + Math.max(0, num(t.teto_usd) - num(t.custo_usd)), 0),
  );
}

export const saldoLivre = (saldo: number, reserva: number) => arred(num(saldo) - num(reserva));

/** Texto que parece credencial: o pedido é recusado (a mesma trava do computador do agente). */
export function pareceCredencialNoPedido(texto: string): boolean {
  const t = String(texto || "").toLowerCase();
  if (/(senha|password|passwd|token|api[\s_-]?key|chave de api|secret|segredo)\s*[:=]/.test(t)) return true;
  if (/\bsk-[a-z0-9-]{16,}/.test(t) || /\beyj[a-z0-9_-]{20,}\./.test(t)) return true;
  return false;
}

export type PedidoDoMotor = {
  tipo: TipoDeTrabalho;
  instrucao: string;
  secoes: string[];
  secao: string | null;
  teto_usd: number;
  alvo_trabalho_id: string | null;
  /** SIT2: desfazer = "voltar para a versão do trabalho alvo" (reverte tudo o que veio depois dele). */
  voltar_para: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Lê o pedido da tela (ou do agente) sem confiar em nada. */
export function normalizarPedido(bruto: unknown): PedidoDoMotor {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const tipo = ehTipo(o.tipo) ? o.tipo : "construir";
  const secoes = (Array.isArray(o.secoes) ? o.secoes : [])
    .map((s) => umaLinha(s, 60).toLowerCase().replace(/[^a-z0-9_-]/g, ""))
    .filter(Boolean)
    .filter((s, i, l) => l.indexOf(s) === i)
    .slice(0, MAX_SECOES);
  const secao = umaLinha(o.secao, 60).toLowerCase().replace(/[^a-z0-9_-]/g, "") || null;
  const alvo = typeof o.alvo_trabalho_id === "string" && UUID.test(o.alvo_trabalho_id) ? o.alvo_trabalho_id : null;
  return {
    tipo,
    instrucao: String(o.instrucao ?? "").trim().slice(0, MAX_INSTRUCAO),
    secoes,
    secao,
    teto_usd: Math.max(0, Math.min(TETO_MAXIMO_USD, arred(num(o.teto_usd)))),
    alvo_trabalho_id: alvo,
    voltar_para: tipo === "desfazer" && o.voltar_para === true,
  };
}

/**
 * Motivo para recusar o pedido antes da fila (null = pode entrar). A ordem é a
 * da tela: primeiro o que a pessoa corrige no campo, depois o dinheiro.
 */
export function motivoParaRecusar(p: PedidoDoMotor, c: { estimativaUsd: number; saldoLivreUsd: number; temModelo: boolean }): { codigo: string; mensagem: string } | null {
  if (p.tipo === "ajustar" && !p.instrucao) return { codigo: "instrucao_vazia", mensagem: "Diga o que mudar na seção." };
  if (p.tipo === "ajustar" && !p.secao) return { codigo: "secao_vazia", mensagem: "Escolha a seção que vai mudar." };
  if (p.tipo === "construir" && !p.secoes.length) return { codigo: "secoes_vazias", mensagem: "Escolha ao menos uma seção para construir." };
  if (p.tipo === "desfazer" && !p.alvo_trabalho_id) return { codigo: "alvo_vazio", mensagem: "Diga qual trabalho desfazer." };
  if (pareceCredencialNoPedido(p.instrucao)) return { codigo: "credencial_no_pedido", mensagem: "O pedido tem senha, token ou chave. Credencial nunca passa pelo painel." };
  if (!gasta(p.tipo)) return null;
  if (!c.temModelo) return { codigo: "sem_modelo", mensagem: "Nenhum modelo de código ativo. Um admin liga um em Modelos de IA." };
  if (p.teto_usd < TETO_MINIMO_USD) return { codigo: "teto_baixo", mensagem: `O teto mínimo é US$ ${TETO_MINIMO_USD.toFixed(2)}.` };
  if (p.teto_usd < c.estimativaUsd) return { codigo: "teto_abaixo_da_estimativa", mensagem: "O teto está abaixo da estimativa. Suba o teto ou peça menos seções." };
  if (p.teto_usd > c.saldoLivreUsd) {
    return { codigo: "saldo_insuficiente", mensagem: "A carteira não cobre o teto deste trabalho junto com o que já está reservado na fila." };
  }
  return null;
}

// ------------------------------------------------------------------ projeto

/** Nome do diretório e do projeto de um site: minúsculas, sem acento, com o começo do id (único). */
export function nomeDoProjeto(nome: string, id: string): string {
  const base = String(nome || "site")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "site";
  const sufixo = String(id || "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "novo";
  return `${base}-${sufixo}`.replace(/^-+/, "");
}

export const PROJETO_VALIDO = /^[a-z0-9][a-z0-9-]{2,62}$/;

// ------------------------------------------------------------------ custo da sessão

/**
 * Custo de uma sessão do opencode: soma do custo da última versão de cada
 * mensagem do assistente (o opencode reenvia a mesma mensagem várias vezes
 * enquanto ela cresce). O preço é o do catálogo (o worker manda o preço ao
 * opencode), então o custo sai "pela tabela", como no ia-motor.
 */
export function criarContadorDeCusto() {
  const porMensagem = new Map<string, { custo: number; entrada: number; saida: number; cache: number }>();
  return {
    registrar(info: { id?: unknown; role?: unknown; cost?: unknown; tokens?: { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } } }) {
      if (!info || info.role !== "assistant" || typeof info.id !== "string") return;
      const t = info.tokens || {};
      const atual = { custo: num(info.cost), entrada: num(t.input), saida: num(t.output) + num(t.reasoning), cache: num(t.cache && t.cache.read) };
      const antes = porMensagem.get(info.id);
      // Mensagem que volta zerada (evento de início) não apaga o que já contou.
      if (antes && atual.custo < antes.custo) return;
      porMensagem.set(info.id, atual);
    },
    total() {
      let custo = 0;
      let entrada = 0;
      let saida = 0;
      let cache = 0;
      porMensagem.forEach((v) => {
        custo += v.custo;
        entrada += v.entrada;
        saida += v.saida;
        cache += v.cache;
      });
      return { custo_usd: arred(custo), tokens_entrada: entrada + cache, tokens_saida: saida, tokens_cache: cache };
    },
  };
}

export const passouDoTeto = (custo: number, teto: number) => teto > 0 && num(custo) >= num(teto);
export const pertoDoTeto = (custo: number, teto: number) => teto > 0 && num(custo) >= num(teto) * 0.8;

// ------------------------------------------------------------------ eventos

export type EventoResumido = { tipo: TipoDeEvento; resumo: string; dados?: Record<string, unknown> };

const nomeCurto = (caminho: unknown) => {
  const s = String(caminho || "").split(/[\\/]/).filter(Boolean);
  const i = s.lastIndexOf("src");
  const parte = i >= 0 ? s.slice(i) : s.slice(-2);
  return parte.join("/").slice(0, 120);
};

/**
 * Traduz um evento do opencode (SSE `/event`) num evento curto para a tela,
 * ou null quando é ruído (texto sendo digitado, leitura de arquivo, batida).
 */
export function resumirEventoDoOpencode(e: unknown): EventoResumido | null {
  if (!e || typeof e !== "object") return null;
  const ev = e as { type?: string; properties?: Record<string, unknown> };
  const p = ev.properties || {};
  if (ev.type === "session.error") {
    const erro = p.error as { name?: string; data?: { message?: string } } | undefined;
    return { tipo: "erro", resumo: umaLinha(`O agente parou com erro: ${(erro && erro.data && erro.data.message) || (erro && erro.name) || "sem detalhe"}`, 280) };
  }
  if (ev.type !== "message.part.updated") return null;
  const part = p.part as { type?: string; tool?: string; state?: { status?: string; title?: string; input?: Record<string, unknown>; error?: string } } | undefined;
  if (!part || part.type !== "tool" || !part.state) return null;
  const st = part.state;
  const entrada = st.input || {};
  if (st.status === "error") return { tipo: "aviso", resumo: umaLinha(`Tentativa que falhou (${part.tool}): ${st.error || ""}`, 280) };
  if (st.status !== "completed") return null;
  if (part.tool === "write" || part.tool === "edit" || part.tool === "patch" || part.tool === "multiedit") {
    const arquivo = nomeCurto(entrada.filePath || entrada.path || st.title);
    return { tipo: "arquivo", resumo: `${part.tool === "write" ? "Escreveu" : "Alterou"} ${arquivo}`, dados: { arquivo } };
  }
  if (part.tool === "bash") return { tipo: "comando", resumo: umaLinha(`Rodou: ${entrada.command || st.title || "comando"}`, 200) };
  if (part.tool === "todowrite") return { tipo: "passo", resumo: "Organizou os próximos passos" };
  return null;
}

/**
 * Junta os eventos para gravar no máximo um por intervalo (1 s). O worker
 * chama `adicionar` a cada evento e `soltar` num relógio de 1 s: sai um evento
 * só, com o que chegou no intervalo ("Escreveu 3 arquivos: ..."), e o custo
 * parcial mais recente em `dados.custo_usd`.
 */
export function criarLimitador(intervaloMs = INTERVALO_DOS_EVENTOS_MS) {
  let pendentes: EventoResumido[] = [];
  let ultimoEm = -Infinity;
  let custo: number | null = null;
  return {
    adicionar(ev: EventoResumido | null) {
      if (ev) pendentes.push(ev);
    },
    custo(v: number) {
      custo = arred(v);
    },
    /** Devolve o evento a gravar agora (ou null: nada novo, ou ainda dentro do intervalo). */
    soltar(agora: number): EventoResumido | null {
      if (!pendentes.length) return null;
      if (agora - ultimoEm < intervaloMs) return null;
      const lote = pendentes;
      pendentes = [];
      ultimoEm = agora;
      const ev = juntarEventos(lote);
      if (custo !== null) ev.dados = { ...(ev.dados || {}), custo_usd: custo };
      return ev;
    },
    get pendentes() {
      return pendentes.length;
    },
  };
}

/** Um evento a partir de vários: o mais grave manda no tipo; arquivos viram lista curta. */
export function juntarEventos(lote: EventoResumido[]): EventoResumido {
  if (lote.length === 1) return { ...lote[0] };
  const erro = lote.filter((e) => e.tipo === "erro");
  if (erro.length) return { ...erro[erro.length - 1] };
  const arquivos = lote.filter((e) => e.tipo === "arquivo").map((e) => String((e.dados && e.dados.arquivo) || e.resumo.replace(/^(Escreveu|Alterou)\s+/, "")));
  const unicos = arquivos.filter((a, i, l) => l.indexOf(a) === i);
  const outros = lote.filter((e) => e.tipo !== "arquivo");
  const partes: string[] = [];
  if (unicos.length === 1) partes.push(`Mexeu em ${unicos[0]}`);
  else if (unicos.length > 1) partes.push(`Mexeu em ${unicos.length} arquivos: ${unicos.slice(0, 3).join(", ")}${unicos.length > 3 ? "..." : ""}`);
  // Passos, commits e comandos do intervalo: os dois últimos diferentes (nada importante some calado).
  const frases = outros.map((e) => e.resumo).filter((r, i, l) => l.indexOf(r) === i);
  if (frases.length) partes.push(frases.slice(-2).join("; "));
  const tipo: TipoDeEvento = unicos.length ? "arquivo" : outros[outros.length - 1].tipo;
  return { tipo, resumo: umaLinha(partes.join("; "), 300), dados: unicos.length ? { arquivos: unicos.slice(0, 12) } : undefined };
}

// ------------------------------------------------------------------ linha para a tela

export type TrabalhoDoMotor = {
  id: string;
  client_id: string;
  marca_id: string | null;
  mesa: string;
  projeto: string;
  referencia_id: string | null;
  tipo: TipoDeTrabalho;
  estado: EstadoDoTrabalho;
  modelo: string | null;
  instrucao: string;
  teto_usd: number;
  estimativa_usd: number | null;
  custo_usd: number;
  preview_url: string | null;
  commit: string | null;
  commit_anterior: string | null;
  zip_path: string | null;
  resultado: Record<string, unknown>;
  erro: string | null;
  criado_em: string;
  terminado_em: string | null;
};

export function normalizarTrabalho(b: unknown): TrabalhoDoMotor | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.client_id !== "string") return null;
  return {
    id: o.id,
    client_id: o.client_id,
    marca_id: typeof o.marca_id === "string" ? o.marca_id : null,
    mesa: String(o.mesa || "site"),
    projeto: String(o.projeto || ""),
    referencia_id: typeof o.referencia_id === "string" ? o.referencia_id : null,
    tipo: ehTipo(o.tipo) ? o.tipo : "construir",
    estado: ehEstado(o.estado) ? o.estado : "falhou",
    modelo: typeof o.modelo === "string" ? o.modelo : null,
    instrucao: String(o.instrucao || ""),
    teto_usd: num(o.teto_usd),
    estimativa_usd: o.estimativa_usd == null ? null : num(o.estimativa_usd),
    custo_usd: num(o.custo_usd),
    preview_url: typeof o.preview_url === "string" && /^https?:\/\//.test(o.preview_url) ? o.preview_url : null,
    commit: typeof o.commit === "string" ? o.commit : null,
    commit_anterior: typeof o.commit_anterior === "string" ? o.commit_anterior : null,
    zip_path: typeof o.zip_path === "string" ? o.zip_path : null,
    resultado: o.resultado && typeof o.resultado === "object" ? (o.resultado as Record<string, unknown>) : {},
    erro: typeof o.erro === "string" ? o.erro : null,
    criado_em: String(o.criado_em || ""),
    terminado_em: typeof o.terminado_em === "string" ? o.terminado_em : null,
  };
}

/** Pode desfazer? Só trabalho de código terminado (feito ou parado no meio) com commit. */
export function podeDesfazer(t: Pick<TrabalhoDoMotor, "estado" | "tipo" | "commit" | "commit_anterior">): boolean {
  return (t.estado === "feito" || t.estado === "parado") && (t.tipo === "construir" || t.tipo === "ajustar") && !!t.commit && !!t.commit_anterior && t.commit !== t.commit_anterior;
}

/** Pode voltar para a versão deste trabalho? Qualquer trabalho terminado que deixou commit. */
export function podeVoltarPara(t: Pick<TrabalhoDoMotor, "estado" | "commit">): boolean {
  return (t.estado === "feito" || t.estado === "parado") && !!t.commit;
}

/** O executor está vivo? (batida nos últimos 90 s) */
export const executorVivo = (vistoEm: string | null | undefined, agora = Date.now()) => !!vistoEm && agora - Date.parse(vistoEm) < 90_000;
