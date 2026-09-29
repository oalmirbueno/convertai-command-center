/**
 * Cronômetro por cliente (frente CR, 28/09). Pedido do dono: "quando estou
 * trabalhando num cliente, conta o tempo daquele cliente; ao sair trava; ao ir
 * para outro começa o outro, sem misturar; ao voltar retoma".
 *
 * Este arquivo é só a lógica (sem React, sem Supabase): o relógio, o
 * armazenamento do navegador e o envio entram por fora (`DependenciasDoMotor`),
 * o que deixa o teste andar o tempo na mão.
 *
 * Regras:
 * - Conta só quando: pessoa da equipe, rota de trabalho de cliente, cliente em
 *   foco, aba visível, alguém mexeu nos últimos OCIOSIDADE_MS e esta aba é a
 *   que conta (várias abas contam uma vez só).
 * - Um trecho por sessão contínua, cortado na hora cheia (o mês, o dia e o
 *   período do dia viram soma simples no banco). Trocar de cliente, parar por
 *   ociosidade, esconder a aba ou outra aba assumir fecha o trecho.
 * - Ociosidade: o tempo parado não conta. Ao perceber os 5 min sem interação,
 *   o trecho volta até a última interação.
 * - Envio ao banco no máximo a cada ENVIO_A_CADA_MS por trecho, e na hora que
 *   o trecho fecha. Falhou? Fica na fila do navegador e vai na próxima janela
 *   de envio (nunca em laço).
 */

/** Sem mouse, teclado, rolagem ou toque por este tempo: pausa. Mude aqui. */
export const OCIOSIDADE_MS = 5 * 60_000;
/** Intervalo mínimo entre dois envios do mesmo trecho aberto. */
export const ENVIO_A_CADA_MS = 60_000;
/** Batida do relógio. */
export const BATIDA_MS = 1000;
/** Passo maior que isto entre duas batidas (computador dormiu): não conta. */
export const MAIOR_PASSO_MS = 5000;
/** Quanto vale a posse da contagem de uma aba sem renovar. */
export const LIDER_VALE_MS = 10_000;
/** De quanto em quanto tempo a aba que conta renova a posse (e guarda o trecho aberto). */
export const RENOVAR_A_CADA_MS = 3000;
/** Fila de trechos que não subiram: teto e validade (o banco recusa mais de 7 dias). */
export const FILA_MAXIMA = 60;
export const FILA_VALE_MS = 6 * 24 * 3600_000;

const HORA_MS = 3600_000;
/** São Paulo é UTC-3 fixo desde 2019 (sem horário de verão). */
const FUSO_SP_MS = 3 * HORA_MS;

export type MotivoDaPausa = "contando" | "sem-cliente" | "fora-de-area" | "escondida" | "ociosa" | "outra-aba" | "desligado";

export interface Trecho {
  id: string;
  cliente: string;
  area: string;
  /** ms desde a época. */
  inicio: number;
  fim: number;
  /** Tempo contado (ms): pode ser menor que fim - inicio (passo grande não conta). */
  contadoMs: number;
  versao: number;
  /** Quando foi enviado pela última vez (0 = nunca). */
  enviadoEm: number;
  /** Versão que o banco já confirmou (0 = nenhuma). */
  versaoEnviada: number;
}

/** O que vai para o banco (tempo_de_trabalho_registrar). */
export interface TrechoParaEnvio {
  id: string;
  client_id: string;
  rota: string;
  inicio: string;
  fim: string;
  segundos: number;
  versao: number;
}

export type ResultadoDoEnvio = "ok" | "recusado" | "falhou";

export interface Armazenamento {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

export interface DependenciasDoMotor {
  agora: () => number;
  armazenamento: Armazenamento | null;
  enviar: (trecho: TrechoParaEnvio, urgente: boolean) => Promise<ResultadoDoEnvio>;
  gerarId: () => string;
  /** Identificador desta aba (muda a cada carga). */
  aba: string;
  /** Usuário: as chaves do navegador são por pessoa. */
  usuario: string;
}

export interface Contexto {
  /** Pessoa da equipe (cliente nunca conta). */
  ativo: boolean;
  cliente: string | null;
  area: string | null;
}

export interface Instantaneo {
  ativo: boolean;
  cliente: string | null;
  area: string | null;
  contando: boolean;
  motivo: MotivoDaPausa;
  /** Mês de São Paulo (AAAA-MM-01) a que o total se refere. */
  mes: string;
  /** Total do mês do cliente em foco (base do banco + o que esta aba contou). */
  segundosDoMes: number;
  /** A base do banco já chegou para este cliente e mês. */
  baseConhecida: boolean;
}

// ------------------------------------------------------------------ datas

/** Mês de São Paulo (AAAA-MM-01) de um instante. */
export function mesDeSaoPaulo(ms: number): string {
  const d = new Date(ms - FUSO_SP_MS);
  const m = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}-${m < 10 ? "0" : ""}${m}-01`;
}

/** Instante do começo do mês de São Paulo. */
export function inicioDoMesEmSaoPaulo(ms: number): number {
  const d = new Date(ms - FUSO_SP_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + FUSO_SP_MS;
}

/** Hora cheia (o fuso de São Paulo é hora inteira, então a hora cheia é a mesma do UTC). */
export const horaCheia = (ms: number) => Math.floor(ms / HORA_MS);
export const proximaHoraCheia = (ms: number) => (horaCheia(ms) + 1) * HORA_MS;

// ------------------------------------------------------------------ rotas

/**
 * Área de trabalho de cliente por rota. Rota fora desta lista nunca conta
 * (Dashboard, Financeiro, Comercial, Config, Equipe, a própria central...).
 */
const AREAS: Record<string, string> = {
  "/mesa": "mesa",
  "/mesa-ads": "mesa-ads",
  "/mesa-foto": "mesa-foto",
  "/mesa-videos": "mesa-videos",
  "/mesa-edicao": "mesa-edicao",
  "/mesa-publicidade": "mesa-publicidade",
  "/mesa-roteiros": "mesa-roteiros",
  "/mesa-identidade": "mesa-identidade",
  "/mesa-proposta": "mesa-proposta",
  "/mesa-site": "mesa-site",
  "/central": "central",
  "/ciclo": "ciclo",
  "/ciclo/revisao": "ciclo",
  "/ciclo-antigo": "ciclo",
  "/workspace": "workspace",
  "/arquivos": "arquivos",
  "/calendario": "agenda",
  "/clientes": "clientes",
  "/kanban": "kanban",
  "/projetos": "projetos",
  "/metricas": "metricas",
  "/anuncios": "anuncios",
  "/aprovacoes": "aprovacoes",
  "/pedidos": "pedidos",
  "/briefings": "briefings",
  "/relatorios": "relatorios",
  "/relatorios/novo": "relatorios",
  "/contratos": "contratos",
  "/timeline": "timeline",
  "/execucao": "execucao",
};

export const ROTULOS_DAS_AREAS: Record<string, string> = {
  mesa: "Mesa",
  "mesa-ads": "Mesa Ads",
  "mesa-foto": "Mesa Foto",
  "mesa-videos": "Mesa Vídeos",
  "mesa-edicao": "Mesa Edição",
  "mesa-publicidade": "Mesa Publicidade",
  "mesa-roteiros": "Mesa Roteiros",
  "mesa-identidade": "Mesa Identidade",
  "mesa-proposta": "Mesa Proposta",
  "mesa-site": "Mesa Site",
  central: "Central",
  ciclo: "Ciclo",
  workspace: "Workspace",
  arquivos: "Arquivos",
  agenda: "Agenda",
  clientes: "Ficha do cliente",
  kanban: "Kanban",
  projetos: "Projetos",
  metricas: "Métricas",
  anuncios: "Anúncios",
  aprovacoes: "Aprovações",
  pedidos: "Pedidos",
  briefings: "Briefings",
  relatorios: "Relatórios",
  contratos: "Contratos",
  timeline: "Timeline",
  execucao: "Execução",
};

export function areaDaRota(pathname: string): string | null {
  const limpo = (pathname || "").replace(/\/+$/, "") || "/";
  if (Object.prototype.hasOwnProperty.call(AREAS, limpo)) return AREAS[limpo];
  // Ficha por endereço (/clientes/<id>) e relatório aberto (/relatorios/<id>).
  if (limpo.indexOf("/clientes/") === 0) return "clientes";
  if (limpo.indexOf("/relatorios/") === 0) return "relatorios";
  return null;
}

// ------------------------------------------------------------------ várias abas

export const chaveDoLider = (usuario: string) => `aceleriq:cronometro:v1:${usuario}:lider`;
export const chaveDaFila = (usuario: string) => `aceleriq:cronometro:v1:${usuario}:fila`;
export const chaveDoAberto = (usuario: string) => `aceleriq:cronometro:v1:${usuario}:aberto`;

interface Posse {
  aba: string;
  ate: number;
}

function lerJson<T>(arm: Armazenamento | null, chave: string): T | null {
  if (!arm) return null;
  try {
    const bruto = arm.getItem(chave);
    return bruto ? (JSON.parse(bruto) as T) : null;
  } catch {
    return null;
  }
}

function gravarJson(arm: Armazenamento | null, chave: string, valor: unknown) {
  if (!arm) return;
  try {
    arm.setItem(chave, JSON.stringify(valor));
  } catch {
    /* navegador sem espaço ou privado: segue sem guardar */
  }
}

function apagar(arm: Armazenamento | null, chave: string) {
  if (!arm) return;
  try {
    arm.removeItem(chave);
  } catch {
    /* idem */
  }
}

// ------------------------------------------------------------------ o motor

export const paraEnvio = (t: Trecho): TrechoParaEnvio => ({
  id: t.id,
  client_id: t.cliente,
  rota: t.area,
  inicio: new Date(t.inicio).toISOString(),
  fim: new Date(Math.max(t.fim, t.inicio)).toISOString(),
  segundos: Math.max(0, Math.min(Math.round(t.contadoMs / 1000), Math.ceil((t.fim - t.inicio) / 1000))),
  versao: t.versao,
});

const chaveDaBase = (cliente: string, mes: string) => `${cliente}|${mes}`;

export class MotorDoCronometro {
  private d: DependenciasDoMotor;
  private ctx: Contexto = { ativo: false, cliente: null, area: null };
  private visivel = true;
  private ultimaInteracao: number;
  private ultimaBatida: number;
  private ultimaRenovacao = 0;
  private ultimaReivindicacao = 0;
  private ultimoEnvioDaFila = 0;
  private ultimaGravacaoDoAberto = 0;
  private trecho: Trecho | null = null;
  /** Base do banco por cliente|mês (sem o trecho aberto) + trechos fechados depois dela. */
  private bases: Record<string, number> = {};
  /** Muda a cada trecho fechado: pedido de base que atravessou um fechamento é descartado. */
  private geracao = 0;
  private enviosPendentes: Promise<unknown>[] = [];
  private ouvintes: Array<() => void> = [];
  private ultimo: Instantaneo | null = null;

  constructor(d: DependenciasDoMotor) {
    this.d = d;
    const agora = d.agora();
    this.ultimaInteracao = agora;
    this.ultimaBatida = agora;
    this.recuperarTrechoPerdido(agora);
  }

  // ---------------- entradas

  definirContexto(ctx: Contexto) {
    const mudou = ctx.ativo !== this.ctx.ativo || ctx.cliente !== this.ctx.cliente || ctx.area !== this.ctx.area;
    this.ctx = { ativo: ctx.ativo, cliente: ctx.cliente || null, area: ctx.area || null };
    if (mudou) this.batida();
  }

  /** Mouse, teclado, rolagem, toque, foco. */
  interacao() {
    const agora = this.d.agora();
    const estavaOciosa = agora - this.ultimaInteracao >= OCIOSIDADE_MS;
    this.ultimaInteracao = agora;
    // Quem mexe é a aba que conta (com um respiro para não gravar a cada movimento).
    if (this.visivel && agora - this.ultimaReivindicacao >= 2000) {
      this.reivindicar(agora);
    }
    if (estavaOciosa) this.batida();
  }

  definirVisibilidade(visivel: boolean) {
    if (visivel === this.visivel) return;
    this.visivel = visivel;
    const agora = this.d.agora();
    if (visivel) {
      // Voltar para a aba é interação: retoma na hora.
      this.ultimaInteracao = agora;
      this.ultimaBatida = agora;
      this.reivindicar(agora);
      this.batida();
    } else {
      this.batida();
      this.largar();
    }
  }

  /** A página vai fechar (pagehide): fecha o trecho e manda com pressa. */
  sair() {
    this.fecharTrecho(true);
    this.largar();
  }

  /** Relógio: a cada BATIDA_MS o provedor chama. */
  batida() {
    const agora = this.d.agora();
    const passo = agora - this.ultimaBatida;
    this.ultimaBatida = agora;

    const lider = this.visivel && this.souLider(agora);
    const renovou = lider && agora - this.ultimaRenovacao >= RENOVAR_A_CADA_MS;
    if (renovou) this.reivindicar(agora);

    const motivo = this.motivo(agora, lider);
    const t = this.trecho;

    if (t) {
      const mesmo = motivo === "contando" && t.cliente === this.ctx.cliente && t.area === this.ctx.area;
      if (!mesmo) {
        if (motivo === "ociosa") this.aparar(t, this.ultimaInteracao);
        else if (passo > 0 && passo <= MAIOR_PASSO_MS && t.fim < agora && motivo !== "escondida" && motivo !== "outra-aba") this.somar(t, agora);
        // Aba escondida pode estar fechando: vai com pressa (keepalive).
        this.fecharTrecho(motivo === "escondida");
      } else if (passo > MAIOR_PASSO_MS) {
        // Computador dormiu com a aba aberta: o buraco não conta; recomeça.
        this.fecharTrecho(false);
      } else if (horaCheia(agora) !== horaCheia(t.inicio)) {
        // Corte na hora cheia (e, com ele, na virada do dia e do mês).
        const corte = proximaHoraCheia(t.inicio);
        this.somar(t, corte);
        this.fecharTrecho(false);
        const novo = this.abrirTrecho(corte);
        this.somar(novo, agora);
      } else {
        this.somar(t, agora);
      }
    }

    if (!this.trecho && motivo === "contando") this.abrirTrecho(agora);

    const aberto = this.trecho;
    if (aberto && agora - aberto.enviadoEm >= ENVIO_A_CADA_MS) this.enviarTrecho(aberto, false);
    // Guarda o trecho aberto (a cada poucos segundos) para não perder se a aba cair sem avisar.
    if (lider && aberto && agora - this.ultimaGravacaoDoAberto >= RENOVAR_A_CADA_MS) {
      this.ultimaGravacaoDoAberto = agora;
      gravarJson(this.d.armazenamento, chaveDoAberto(this.d.usuario), { aba: this.d.aba, trecho: aberto });
    }
    if (lider && agora - this.ultimoEnvioDaFila >= ENVIO_A_CADA_MS) this.esvaziarFila(agora);

    this.avisar();
  }

  // ---------------- base do banco (total do mês do cliente)

  /** O que pedir ao banco agora: cliente, mês e o trecho aberto (que a conta local já soma). */
  pedidoDeBase(): { cliente: string; mes: string; desde: number; excluir: string | null; geracao: number } | null {
    const cliente = this.ctx.cliente;
    if (!this.ctx.ativo || !cliente) return null;
    const agora = this.d.agora();
    const t = this.trecho && this.trecho.cliente === cliente ? this.trecho : null;
    return { cliente, mes: mesDeSaoPaulo(agora), desde: inicioDoMesEmSaoPaulo(agora), excluir: t ? t.id : null, geracao: this.geracao };
  }

  /** Resposta do banco. Falso = um trecho fechou no meio do caminho: peça de novo. */
  definirBase(pedido: { cliente: string; mes: string; excluir: string | null; geracao: number }, segundos: number): boolean {
    if (pedido.geracao !== this.geracao) return false;
    const t = this.trecho;
    // O trecho aberto mudou depois do pedido: a base pode ter contado parte dele.
    if (t && t.cliente === pedido.cliente && t.id !== pedido.excluir) return false;
    this.bases[chaveDaBase(pedido.cliente, pedido.mes)] = Math.max(0, Math.floor(segundos || 0));
    this.avisar();
    return true;
  }

  baseConhecida(cliente: string, mes: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.bases, chaveDaBase(cliente, mes));
  }

  /** Espera os envios em andamento (antes de pedir a base, para ela já trazer o que fechou). */
  aguardarEnvios(): Promise<void> {
    const lista = this.enviosPendentes.slice();
    return Promise.all(lista.map((p) => p.catch(() => undefined))).then(() => undefined);
  }

  // ---------------- leitura

  instantaneo(): Instantaneo {
    const agora = this.d.agora();
    const lider = this.visivel && this.souLider(agora);
    const motivo = this.motivo(agora, lider);
    const cliente = this.ctx.ativo ? this.ctx.cliente : null;
    const mes = mesDeSaoPaulo(agora);
    let segundos = 0;
    let conhecida = false;
    if (cliente) {
      const k = chaveDaBase(cliente, mes);
      conhecida = Object.prototype.hasOwnProperty.call(this.bases, k);
      segundos = conhecida ? this.bases[k] : 0;
      const t = this.trecho;
      if (t && t.cliente === cliente && mesDeSaoPaulo(t.inicio) === mes) segundos += Math.round(t.contadoMs / 1000);
    }
    return {
      ativo: this.ctx.ativo,
      cliente,
      area: this.ctx.ativo ? this.ctx.area : null,
      contando: motivo === "contando" && !!this.trecho,
      motivo,
      mes,
      segundosDoMes: segundos,
      baseConhecida: conhecida,
    };
  }

  trechoAberto(): Trecho | null {
    return this.trecho ? { ...this.trecho } : null;
  }

  assinar(ouvinte: () => void): () => void {
    this.ouvintes.push(ouvinte);
    return () => {
      this.ouvintes = this.ouvintes.filter((o) => o !== ouvinte);
    };
  }

  /** Para os testes e o provedor: o instantâneo muda só quando algo visível muda. */
  instantaneoEstavel(): Instantaneo {
    const novo = this.instantaneo();
    const u = this.ultimo;
    if (
      u &&
      u.ativo === novo.ativo &&
      u.cliente === novo.cliente &&
      u.area === novo.area &&
      u.contando === novo.contando &&
      u.motivo === novo.motivo &&
      u.mes === novo.mes &&
      u.segundosDoMes === novo.segundosDoMes &&
      u.baseConhecida === novo.baseConhecida
    )
      return u;
    this.ultimo = novo;
    return novo;
  }

  // ---------------- por dentro

  private motivo(agora: number, lider: boolean): MotivoDaPausa {
    if (!this.ctx.ativo) return "desligado";
    if (!this.ctx.area) return "fora-de-area";
    if (!this.ctx.cliente) return "sem-cliente";
    if (!this.visivel) return "escondida";
    if (agora - this.ultimaInteracao >= OCIOSIDADE_MS) return "ociosa";
    if (!lider) return "outra-aba";
    return "contando";
  }

  private souLider(agora: number): boolean {
    const posse = lerJson<Posse>(this.d.armazenamento, chaveDoLider(this.d.usuario));
    if (!posse || typeof posse.aba !== "string" || !(posse.ate >= agora)) return true;
    return posse.aba === this.d.aba;
  }

  private reivindicar(agora: number) {
    this.ultimaRenovacao = agora;
    this.ultimaReivindicacao = agora;
    gravarJson(this.d.armazenamento, chaveDoLider(this.d.usuario), { aba: this.d.aba, ate: agora + LIDER_VALE_MS });
  }

  private largar() {
    const posse = lerJson<Posse>(this.d.armazenamento, chaveDoLider(this.d.usuario));
    if (posse && posse.aba === this.d.aba) apagar(this.d.armazenamento, chaveDoLider(this.d.usuario));
  }

  private somar(t: Trecho, ate: number) {
    if (ate > t.fim) {
      t.contadoMs += ate - t.fim;
      t.fim = ate;
      t.versao += 1;
    }
  }

  /** Ociosidade: o que passou da última interação não conta. */
  private aparar(t: Trecho, ate: number) {
    if (t.fim <= ate) return;
    const limite = Math.max(ate, t.inicio);
    t.contadoMs = Math.max(0, t.contadoMs - (t.fim - limite));
    t.fim = limite;
    t.versao += 1;
  }

  private abrirTrecho(inicio: number): Trecho {
    const t: Trecho = {
      id: this.d.gerarId(),
      cliente: this.ctx.cliente as string,
      area: this.ctx.area as string,
      inicio,
      fim: inicio,
      contadoMs: 0,
      versao: 1,
      enviadoEm: inicio,
      versaoEnviada: 0,
    };
    // O primeiro envio sai depois de ENVIO_A_CADA_MS (trecho curto demais não vai).
    this.trecho = t;
    return t;
  }

  private fecharTrecho(urgente: boolean) {
    const t = this.trecho;
    if (!t) return;
    this.trecho = null;
    this.geracao += 1;
    apagar(this.d.armazenamento, chaveDoAberto(this.d.usuario));
    const segundos = Math.round(t.contadoMs / 1000);
    // O total do mês na tela passa a incluir o trecho fechado.
    const k = chaveDaBase(t.cliente, mesDeSaoPaulo(t.inicio));
    if (Object.prototype.hasOwnProperty.call(this.bases, k)) this.bases[k] += segundos;
    // Nunca enviado e sem nada contado: não existe no banco, não vai.
    if (t.versaoEnviada === 0 && segundos < 1) return;
    if (t.versaoEnviada >= t.versao) return;
    this.enviarTrecho(t, urgente, true);
  }

  private enviarTrecho(t: Trecho, urgente: boolean, fechado = false) {
    const agora = this.d.agora();
    t.enviadoEm = agora;
    const carga = paraEnvio(t);
    if (carga.segundos < 1 && t.versaoEnviada === 0) return;
    let envio: Promise<ResultadoDoEnvio>;
    try {
      envio = this.d.enviar(carga, urgente);
    } catch {
      envio = Promise.resolve("falhou" as ResultadoDoEnvio);
    }
    // Com pressa (a página pode morrer antes da resposta): o trecho já fica na fila
    // e sai dela quando o banco confirma. Reenviar é inofensivo (vale a versão maior).
    if (urgente) this.guardarNaFila(carga);
    const p = envio.then(
      (r) => {
        if (r === "ok") t.versaoEnviada = Math.max(t.versaoEnviada, carga.versao);
        if (r === "falhou" && fechado) this.guardarNaFila(carga);
        else if (urgente) this.tirarDaFila(carga.id);
        return r;
      },
      () => {
        if (fechado) this.guardarNaFila(carga);
        return "falhou" as ResultadoDoEnvio;
      },
    );
    this.enviosPendentes.push(p);
    p.then(() => {
      this.enviosPendentes = this.enviosPendentes.filter((x) => x !== p);
    });
  }

  private lerFila(): TrechoParaEnvio[] {
    const fila = lerJson<TrechoParaEnvio[]>(this.d.armazenamento, chaveDaFila(this.d.usuario));
    return Array.isArray(fila) ? fila.filter((x) => x && typeof x.id === "string") : [];
  }

  private guardarNaFila(carga: TrechoParaEnvio) {
    const agora = this.d.agora();
    const fila = this.lerFila().filter((x) => x.id !== carga.id && agora - Date.parse(x.inicio) < FILA_VALE_MS);
    fila.push(carga);
    gravarJson(this.d.armazenamento, chaveDaFila(this.d.usuario), fila.slice(-FILA_MAXIMA));
  }

  private tirarDaFila(id: string) {
    const fila = this.lerFila();
    const resto = fila.filter((x) => x.id !== id);
    if (resto.length === fila.length) return;
    if (resto.length) gravarJson(this.d.armazenamento, chaveDaFila(this.d.usuario), resto);
    else apagar(this.d.armazenamento, chaveDaFila(this.d.usuario));
  }

  /** Um envio por item da fila, no máximo uma vez por janela de envio. */
  private esvaziarFila(agora: number) {
    this.ultimoEnvioDaFila = agora;
    const fila = this.lerFila().filter((x) => agora - Date.parse(x.inicio) < FILA_VALE_MS);
    if (!fila.length) return;
    apagar(this.d.armazenamento, chaveDaFila(this.d.usuario));
    for (const carga of fila) {
      let envio: Promise<ResultadoDoEnvio>;
      try {
        envio = this.d.enviar(carga, false);
      } catch {
        envio = Promise.resolve("falhou" as ResultadoDoEnvio);
      }
      const p = envio.then(
        (r) => {
          if (r === "falhou") this.guardarNaFila(carga);
          return r;
        },
        () => {
          this.guardarNaFila(carga);
          return "falhou" as ResultadoDoEnvio;
        },
      );
      this.enviosPendentes.push(p);
      p.then(() => {
        this.enviosPendentes = this.enviosPendentes.filter((x) => x !== p);
      });
    }
  }

  /** Trecho que ficou aberto numa aba que fechou sem avisar (queda, bateria): vai para a fila. */
  private recuperarTrechoPerdido(agora: number) {
    const arm = this.d.armazenamento;
    const aberto = lerJson<{ aba: string; trecho: Trecho }>(arm, chaveDoAberto(this.d.usuario));
    if (!aberto || !aberto.trecho || typeof aberto.trecho.id !== "string") return;
    const posse = lerJson<Posse>(arm, chaveDoLider(this.d.usuario));
    const donoVivo = posse && posse.aba === aberto.aba && posse.ate >= agora;
    if (donoVivo) return;
    apagar(arm, chaveDoAberto(this.d.usuario));
    const carga = paraEnvio(aberto.trecho);
    if (carga.segundos >= 1) this.guardarNaFila(carga);
  }

  private avisar() {
    for (const o of this.ouvintes.slice()) {
      try {
        o();
      } catch {
        /* ouvinte com erro não para o relógio */
      }
    }
  }
}
