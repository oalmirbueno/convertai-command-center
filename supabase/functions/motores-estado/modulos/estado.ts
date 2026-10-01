/**
 * Estado dos motores (frente MTR, 30/09/2026): módulo PURO que transforma o
 * que a função motores-estado leu (filas, batidas dos workers, segredos
 * presentes, crédito do OpenRouter) no quadro que a tela mostra, motor por
 * motor: ligado ou não, o último sinal, a fila, o último erro legível e o que
 * falta (a ação do dono).
 *
 * Nada aqui fala com o banco nem com a rede: o vitest roda com os dados
 * reais de 30/09 (workers que nunca ligaram, OpenRouter no limite etc.).
 * Sem travessão nos textos.
 */

export type SituacaoDoMotor = "ok" | "atencao" | "parado" | "sem_uso";
export type IdDoMotor = "site" | "motion" | "edicao" | "imagem" | "video" | "ia";

export interface EstadoDoMotor {
  id: IdDoMotor;
  nome: string;
  situacao: SituacaoDoMotor;
  /** Uma linha: o que está acontecendo. */
  resumo: string;
  ultimo_sinal: string | null;
  fila: { esperando: number; rodando: number; desde: string | null };
  ultimo_erro: { em: string | null; texto: string } | null;
  /** O que o dono precisa fazer (vazio = nada). */
  falta: string[];
  /** Linhas de apoio (capacidades, chaves opcionais, avisos). */
  detalhes: string[];
  /**
   * Provedores (id de Configurações › Chaves e custos) cuja chave falta ou
   * pede atenção: a tela mostra o atalho "Chaves e custos" (frente CHV).
   */
  chaves?: string[];
}

export interface Executor {
  nome: string;
  visto_em: string | null;
  versao?: string | null;
  capacidades?: Record<string, unknown> | null;
  trabalho_id?: string | null;
  pedido_id?: string | null;
  iniciado_em?: string | null;
}

export interface EntradaDoEstado {
  agora: number;
  /** Nome do segredo do servidor -> presente (nunca o valor). */
  segredos: Record<string, boolean>;
  admin: boolean;
  openrouter: {
    chave: { limite: number | null; uso: number | null; restante: number | null } | null;
    creditos: { total: number; usado: number } | null;
    erro: string | null;
  } | null;
  site: {
    executores: Executor[];
    abertos: Array<{ estado: string; criado_em: string; modelo: string | null }>;
    ultimaFalha: { erro: string | null; em: string | null } | null;
    ultimoFeito: string | null;
  };
  render: {
    workers: Executor[];
    abertos: Array<{ tipo: string; estado: string; criado_em: string; atualizado_em: string | null }>;
    erros: Array<{ tipo: string; erro_codigo: string | null; erro_mensagem: string | null; em: string | null }>;
    prontos: Array<{ tipo: string; em: string | null }>;
  };
  imagem: {
    abertos: Array<{ status: string; criado_em: string }>;
    erros: Array<{ erro_codigo: string | null; erro_mensagem: string | null; em: string | null; cliente: string | null }>;
    feitas24h: number;
    ultimaFeita: string | null;
  };
  video: {
    abertos: Array<{ estado: string; criado_em: string }>;
    /** tipo "angulo" é troca de ângulo de FOTO (não é vídeo). */
    erros: Array<{ texto: string; em: string | null; tipo?: string | null }>;
    /** Pedidos de VÍDEO (sem as trocas de ângulo de foto) nos últimos 7 dias. */
    pedidos7d: number;
    /** Vídeos prontos (sem as trocas de ângulo) nos últimos 7 dias. */
    prontos7d: number;
    /** Trocas de ângulo de foto pela fal nos últimos 7 dias (mesmo motor, não é vídeo). */
    angulos7d: number;
    /** Último pedido pronto (vídeo ou ângulo): erro mais novo que ele sobe para atenção. */
    ultimoPronto: string | null;
  };
  carteirasBaixas: Array<{ cliente: string; saldo: number }>;
}

/** Worker sem batida há mais que isto está desligado (o mesmo prazo da tela das mesas). */
export const VIVO_MS = 90_000;
/** Pedido de render "rodando" com progresso recente prova worker vivo (worker antigo, sem a batida de 30 s). */
export const PROGRESSO_VIVO_MS = 12 * 60_000;
/** Pedido de render parado na fila por mais que isto expira quando o worker ligar. */
export const EXPIRA_NA_FILA_MS = 24 * 60 * 60_000;
/** Trabalho do site na fila por mais que isto é cancelado na próxima pegada (migration 20260930316000). */
export const EXPIRA_NA_FILA_DO_SITE_MS = 48 * 60 * 60_000;
/** Pedido de vídeo sem consulta há mais que isto: pedir para abrir a Mesa Vídeos. */
export const VIDEO_ESQUECIDO_MS = 30 * 60_000;

export const GUIA = "docs/motores/LIGAR-OS-MOTORES.md";
export const LIGAR_SITE = `Ligar o worker do motor de código nesta máquina: workers\\ligar\\ligar-motor-codigo.cmd (passo a passo em ${GUIA}).`;
export const LIGAR_RENDER = `Ligar o worker de render nesta máquina: workers\\ligar\\ligar-render.cmd (passo a passo em ${GUIA}).`;

const CHAVE_DO_PROVEDOR: Record<string, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" };
const TIPOS_DO_MOTION = ["cena_hf", "batidas"];
const TIPOS_DA_EDICAO = ["render_final", "amostra", "onda"];

// ------------------------------------------------------------------ texto

const ms = (iso: string | null | undefined): number => {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return isFinite(t) ? t : NaN;
};

/** "29/09 19:00" no horário de Brasília (UTC-3, sem horário de verão desde 2019). */
export function dataCurta(iso: string | null | undefined): string {
  const t = ms(iso);
  if (!isFinite(t)) return "data desconhecida";
  const d = new Date(t - 3 * 60 * 60_000);
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`;
}

export const dinheiro = (v: number) => `US$ ${(Math.round(v * 100) / 100).toFixed(2).replace(".", ",")}`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const curto = (s: string | null | undefined, max = 220) => String(s || "").replace(/\s+/g, " ").replace(/https?:\/\/\S+/g, "").trim().slice(0, max);
const maisNovo = (a: string | null | undefined, b: string | null | undefined) => (ms(a) || 0) > (ms(b) || 0);

function vistoRecente(e: Executor | undefined, agora: number): boolean {
  if (!e) return false;
  const t = ms(e.visto_em);
  return isFinite(t) && agora - t <= VIVO_MS;
}

function filaDe<T extends { criado_em: string }>(abertos: T[], esperando: (x: T) => boolean): EstadoDoMotor["fila"] {
  const esp = abertos.filter(esperando);
  const rod = abertos.filter((x) => !esperando(x));
  const desde = esp.map((x) => x.criado_em).filter((x) => isFinite(ms(x))).sort()[0] || null;
  return { esperando: esp.length, rodando: rod.length, desde };
}

function frasDaFila(f: EstadoDoMotor["fila"], um: string, varios: string): string {
  if (!f.esperando) return "";
  return ` ${plural(f.esperando, um, varios)} na fila desde ${dataCurta(f.desde)}.`;
}

/** Mensagem legível de um erro de provedor (403 de limite, 402, saldo da carteira). */
export function erroLegivel(codigo: string | null | undefined, mensagem: string | null | undefined, cliente?: string | null): string {
  const c = String(codigo || "");
  const m = String(mensagem || "");
  if (c === "saldo_insuficiente" || /saldo insuficiente/i.test(m)) return `Carteira de IA ${cliente ? `de ${cliente} ` : "do cliente "}sem saldo para gerar.`;
  if (/key limit exceeded/i.test(m)) return "A chave do OpenRouter chegou ao limite dela (Key limit exceeded).";
  if (c === "provedor_sem_credito" || c === "openrouter_sem_credito" || /\b402\b|insufficient credits|sem cr[eé]dito/i.test(m)) return "O provedor ficou sem crédito (OpenRouter 402).";
  if (/timeout|n[aã]o respondeu/i.test(m)) return `O provedor demorou demais: ${curto(m, 160)}`;
  return curto(m || c || "falha sem motivo registrado");
}

// ------------------------------------------------------------------ motores

function motorDoSite(e: EntradaDoEstado): EstadoDoMotor {
  const ex = e.site.executores[0];
  const vivo = vistoRecente(ex, e.agora);
  const fila = filaDe(e.site.abertos, (x) => x.estado === "na_fila");
  const falta: string[] = [];
  const detalhes: string[] = [];
  let situacao: SituacaoDoMotor;
  let resumo: string;
  if (!ex) {
    situacao = "parado";
    resumo = "O worker do motor de código nunca foi ligado.";
    falta.push(LIGAR_SITE);
    detalhes.push("A máquina do motor precisa de SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e da chave do modelo (OPENROUTER_API_KEY cobre todos os modelos do catálogo).");
  } else if (!vivo) {
    situacao = "parado";
    resumo = `Worker desligado desde ${dataCurta(ex.visto_em)}.`;
    falta.push(LIGAR_SITE);
  } else {
    situacao = "ok";
    resumo = ex.trabalho_id ? "Ligado, trabalhando num pedido." : "Ligado, esperando pedido.";
  }
  resumo += frasDaFila(fila, "trabalho", "trabalhos");
  if (fila.desde && e.agora - ms(fila.desde) > EXPIRA_NA_FILA_DO_SITE_MS) {
    detalhes.push("Há trabalhos com mais de 2 dias na fila: eles são cancelados (e soltam a reserva da carteira) quando o motor ligar. Peça de novo depois.");
  }
  const caps = (ex && ex.capacidades) || null;
  if (caps) {
    const provedores = Array.from(new Set(e.site.abertos.map((a) => String(a.modelo || "").split(":")[0]).filter((p) => p === "openai" || p === "anthropic")));
    provedores.forEach((p) => {
      if (caps[p] === true) return;
      if (caps.openrouter === true) detalhes.push(`A máquina não tem ${CHAVE_DO_PROVEDOR[p]}: o motor segue pelo mesmo modelo no OpenRouter.`);
      else falta.push(`Pôr ${CHAVE_DO_PROVEDOR[p]} (ou OPENROUTER_API_KEY) no ambiente da máquina do motor.`);
    });
    if (caps.openrouter === false && caps.openai !== true && caps.anthropic !== true) falta.push("Pôr OPENROUTER_API_KEY no ambiente da máquina do motor (sem ela nenhum modelo roda).");
    if (caps.tunel === false) detalhes.push("Prévia só nesta máquina: falta o cloudflared para o link público.");
    if (caps.uiux === false) detalhes.push("Busca da base de design desligada: falta Python 3.8 ou mais novo.");
    if (caps.vercel === false) detalhes.push("Publicação na Vercel desligada (sem VERCEL_TOKEN); o zip do site funciona.");
  }
  if (ex && ex.versao) detalhes.push(`Versão do worker: ${curto(ex.versao, 80)}.`);
  const ultimo_erro = e.site.ultimaFalha && e.site.ultimaFalha.erro ? { em: e.site.ultimaFalha.em, texto: erroLegivel(null, e.site.ultimaFalha.erro) } : null;
  if (situacao === "ok" && ultimo_erro && maisNovo(ultimo_erro.em, e.site.ultimoFeito)) situacao = "atencao";
  if (situacao === "ok" && falta.length) situacao = "atencao";
  return { id: "site", nome: "Motor do site (código)", situacao, resumo, ultimo_sinal: ex ? ex.visto_em : null, fila, ultimo_erro, falta, detalhes };
}

function motorDeRender(e: EntradaDoEstado, id: "motion" | "edicao"): EstadoDoMotor {
  const tipos = id === "motion" ? TIPOS_DO_MOTION : TIPOS_DA_EDICAO;
  const w = e.render.workers[0];
  // Worker antigo (sem a batida de 30 s) só bate ao olhar a fila: progresso recente de um pedido rodando também prova vida.
  const progressoRecente = e.render.abertos.some((p) => p.estado === "rodando" && isFinite(ms(p.atualizado_em)) && e.agora - ms(p.atualizado_em) <= PROGRESSO_VIVO_MS);
  const vivo = vistoRecente(w, e.agora) || progressoRecente;
  const abertos = e.render.abertos.filter((p) => tipos.indexOf(p.tipo) >= 0);
  const fila = filaDe(abertos, (x) => x.estado === "fila");
  const falta: string[] = [];
  const detalhes: string[] = [];
  let situacao: SituacaoDoMotor;
  let resumo: string;
  const um = id === "motion" ? "cena" : "pedido";
  const varios = id === "motion" ? "cenas" : "pedidos";
  if (!w && !progressoRecente) {
    situacao = "parado";
    resumo = "O worker de render nunca foi ligado.";
    falta.push(LIGAR_RENDER);
  } else if (!vivo) {
    situacao = "parado";
    resumo = `Worker de render desligado desde ${dataCurta(w ? w.visto_em : null)}.`;
    falta.push(LIGAR_RENDER);
  } else {
    situacao = "ok";
    resumo = w && w.pedido_id ? "Ligado, renderizando." : "Ligado, esperando pedido.";
  }
  resumo += frasDaFila(fila, um, varios);
  if (fila.desde && e.agora - ms(fila.desde) > EXPIRA_NA_FILA_MS) {
    detalhes.push("Há pedidos com mais de 24 h na fila: eles saem sozinhos quando o worker ligar (peça de novo depois).");
  }
  const caps = (w && w.capacidades) || null;
  const faltas = caps && Array.isArray(caps.faltas) ? (caps.faltas as unknown[]).map((x) => String(x)) : [];
  const daPeca = faltas.filter((f) => (id === "motion" ? /ffmpeg|HyperFrames|GSAP/i.test(f) : /ffmpeg|RENDER_CHROME/i.test(f)));
  daPeca.forEach((f) => falta.push(`Na máquina do render: ${f}.`));
  if (daPeca.length && situacao === "ok") situacao = "atencao";
  if (w && w.versao) detalhes.push(`Versão do worker: ${curto(w.versao, 60)}.`);
  if (w && !caps && vivo) detalhes.push("Worker antigo (sem a batida de 30 s): atualize o código da máquina para ver o que ela tem.");
  const erro = e.render.erros.find((x) => tipos.indexOf(x.tipo) >= 0);
  const pronto = e.render.prontos.find((x) => tipos.indexOf(x.tipo) >= 0);
  const ultimo_erro = erro ? { em: erro.em, texto: erroLegivel(erro.erro_codigo, erro.erro_mensagem) } : null;
  if (situacao === "ok" && ultimo_erro && maisNovo(ultimo_erro.em, pronto ? pronto.em : null)) situacao = "atencao";
  const nome = id === "motion" ? "Render do Motion (cenas HyperFrames)" : "Render da Mesa Edição (Remotion)";
  return { id, nome, situacao, resumo, ultimo_sinal: w ? w.visto_em : null, fila, ultimo_erro, falta, detalhes };
}

function creditoDoOpenrouter(e: EntradaDoEstado): { semCredito: boolean; chaveNoLimite: boolean; restante: number | null } {
  const o = e.openrouter;
  if (!o) return { semCredito: false, chaveNoLimite: false, restante: null };
  const restanteConta = o.creditos ? o.creditos.total - o.creditos.usado : null;
  const restanteChave = o.chave && o.chave.limite !== null && o.chave.restante !== null ? o.chave.restante : null;
  return {
    semCredito: restanteConta !== null && restanteConta <= 0.05,
    chaveNoLimite: restanteChave !== null && restanteChave <= 0.05,
    restante: restanteConta === null ? restanteChave : restanteChave === null ? restanteConta : Math.min(restanteConta, restanteChave),
  };
}

/** Onde o admin cadastra e testa as chaves (frente CHV, 01/10/2026). */
export const CHAVES_E_CUSTOS = "em Configurações › Chaves e custos";

/** Provedores sem chave, pelos segredos conferidos (id da tela Chaves e custos). */
function chavesQueFaltam(e: EntradaDoEstado, pares: Array<[string, string[]]>): string[] {
  return pares.filter(([, nomes]) => nomes.some((n) => !e.segredos[n])).map(([id]) => id);
}

function motorDeImagem(e: EntradaDoEstado): EstadoDoMotor {
  const fila = filaDe(e.imagem.abertos, (x) => x.status === "fila");
  const falta: string[] = [];
  const detalhes: string[] = [];
  const cr = creditoDoOpenrouter(e);
  let situacao: SituacaoDoMotor;
  let resumo: string;
  if (!e.segredos.OPENROUTER_API_KEY && !e.segredos.OPENAI_API_KEY) {
    situacao = "parado";
    resumo = "Sem chave de provedor de imagem no servidor.";
    falta.push(`Cadastrar a chave do OpenRouter (OPENROUTER_API_KEY) ${CHAVES_E_CUSTOS}.`);
  } else if (cr.semCredito) {
    situacao = "parado";
    resumo = "OpenRouter sem crédito: as imagens pelo OpenRouter param.";
    falta.push("Recarregar o crédito do OpenRouter (openrouter.ai, Credits).");
  } else if (cr.chaveNoLimite) {
    situacao = "parado";
    resumo = "A chave do OpenRouter chegou ao limite dela.";
    falta.push("Aumentar o limite da chave do OpenRouter (openrouter.ai, Keys) ou tirar o teto.");
  } else if (e.imagem.feitas24h > 0) {
    situacao = "ok";
    resumo = `${plural(e.imagem.feitas24h, "geração feita", "gerações feitas")} nas últimas 24 h (última às ${dataCurta(e.imagem.ultimaFeita)}).`;
  } else {
    situacao = "sem_uso";
    resumo = "Nenhuma imagem gerada nas últimas 24 h; o motor está pronto.";
  }
  resumo += frasDaFila(fila, "geração", "gerações");
  const erro = e.imagem.erros[0];
  const ultimo_erro = erro ? { em: erro.em, texto: erroLegivel(erro.erro_codigo, erro.erro_mensagem, erro.cliente) } : null;
  if (ultimo_erro && maisNovo(ultimo_erro.em, e.imagem.ultimaFeita)) {
    if (situacao === "ok" || situacao === "sem_uso") situacao = "atencao";
    if (erro && erro.erro_codigo === "saldo_insuficiente") falta.push(`Recarregar a carteira de IA ${erro.cliente ? `de ${erro.cliente}` : "do cliente"} (Financeiro, Carteira de IA).`);
  }
  if (!e.segredos.FAL_KEY) detalhes.push("Sem FAL_KEY: as ferramentas de foto da fal (tirar fundo, ampliar) ficam desligadas.");
  const chaves = chavesQueFaltam(e, [["fal", ["FAL_KEY"]]]);
  if ((!e.segredos.OPENROUTER_API_KEY && !e.segredos.OPENAI_API_KEY) || cr.semCredito || cr.chaveNoLimite) chaves.unshift("openrouter");
  return { id: "imagem", nome: "Geração de imagem (Estúdio e Mesa Foto)", situacao, resumo, ultimo_sinal: e.imagem.ultimaFeita, fila, ultimo_erro, falta, detalhes, chaves };
}

function motorDeVideo(e: EntradaDoEstado): EstadoDoMotor {
  const fila = filaDe(e.video.abertos, (x) => x.estado === "enviado");
  const falta: string[] = [];
  const detalhes: string[] = [];
  let situacao: SituacaoDoMotor;
  let resumo: string;
  if (!e.segredos.FAL_KEY) {
    situacao = "parado";
    resumo = "Sem FAL_KEY no servidor: os motores de vídeo da fal ficam desligados.";
    falta.push(`Cadastrar a chave do fal.ai (FAL_KEY) ${CHAVES_E_CUSTOS}.`);
  } else if (e.video.pedidos7d > 0) {
    situacao = "ok";
    resumo = `Ligado pela fal: ${plural(e.video.pedidos7d, "vídeo pedido", "vídeos pedidos")} em 7 dias, ${plural(e.video.prontos7d, "pronto", "prontos")}.`;
    if (e.video.angulos7d > 0) resumo += ` Mais ${plural(e.video.angulos7d, "troca de ângulo de foto", "trocas de ângulo de foto")}.`;
  } else if (e.video.angulos7d > 0) {
    // Frente MTR (rodada 2): troca de ângulo é FOTO; não prova que o vídeo funciona.
    situacao = "sem_uso";
    resumo = `Chave da fal no lugar, mas nenhum VÍDEO pedido em 7 dias (só ${plural(e.video.angulos7d, "troca de ângulo de foto", "trocas de ângulo de foto")}). O vídeo ainda não tem prova de uso.`;
    detalhes.push("Para provar o vídeo: na Mesa Vídeos, gere um clipe curto (Seedance Lite ou Wan, 5 s) e confira em Resultados.");
  } else {
    situacao = "sem_uso";
    resumo = "Chave da fal no lugar; nenhum vídeo pedido nos últimos 7 dias.";
  }
  const todos = e.video.abertos.map((x) => x.criado_em).filter((x) => isFinite(ms(x))).sort();
  if (todos.length && e.agora - ms(todos[0]) > VIDEO_ESQUECIDO_MS) {
    if (situacao === "ok" || situacao === "sem_uso") situacao = "atencao";
    detalhes.push(`${plural(todos.length, "vídeo espera", "vídeos esperam")} conferência desde ${dataCurta(todos[0])}: abra a Mesa Vídeos (Resultados) para buscar no provedor.`);
  } else if (todos.length) {
    resumo += ` ${plural(todos.length, "vídeo em andamento", "vídeos em andamento")}.`;
  }
  const semChave: string[] = [];
  if (!e.segredos.RUNWAYML_API_SECRET) semChave.push("Runway");
  if (!e.segredos.HIGGSFIELD_API_KEY || !e.segredos.HIGGSFIELD_API_SECRET) semChave.push("Higgsfield");
  if (!e.segredos.HEYGEN_API_KEY) semChave.push("HeyGen");
  if (semChave.length) detalhes.push(`Sem chave (esses motores ficam desligados no seletor): ${semChave.join(", ")}.`);
  const erro = e.video.erros[0];
  // Como os outros motores: erro mais novo que o último pronto sobe para atenção.
  if ((situacao === "ok" || situacao === "sem_uso") && erro && maisNovo(erro.em, e.video.ultimoPronto)) situacao = "atencao";
  const textoDoErro = erro ? `${erro.tipo === "angulo" ? "Troca de ângulo de foto: " : ""}${erroLegivel(null, erro.texto)}` : "";
  return {
    id: "video",
    nome: "Geração de vídeo (fal e outros)",
    situacao,
    resumo,
    ultimo_sinal: null,
    fila: { esperando: fila.esperando, rodando: fila.rodando, desde: fila.desde },
    ultimo_erro: erro ? { em: erro.em, texto: textoDoErro } : null,
    falta,
    detalhes,
    chaves: chavesQueFaltam(e, [["fal", ["FAL_KEY"]], ["runway", ["RUNWAYML_API_SECRET"]], ["higgsfield", ["HIGGSFIELD_API_KEY", "HIGGSFIELD_API_SECRET"]], ["heygen", ["HEYGEN_API_KEY"]]]),
  };
}

function motorDaIa(e: EntradaDoEstado): EstadoDoMotor {
  const falta: string[] = [];
  const detalhes: string[] = [];
  const cr = creditoDoOpenrouter(e);
  let situacao: SituacaoDoMotor = "ok";
  let resumo = "Chaves no lugar.";
  if (!e.segredos.OPENROUTER_API_KEY) {
    situacao = "parado";
    resumo = "Sem OPENROUTER_API_KEY no servidor: a maior parte dos modelos para.";
    falta.push(`Cadastrar a chave do OpenRouter (OPENROUTER_API_KEY) ${CHAVES_E_CUSTOS}.`);
  } else if (cr.semCredito) {
    situacao = "parado";
    resumo = "OpenRouter sem crédito.";
    falta.push("Recarregar o crédito do OpenRouter (openrouter.ai, Credits).");
  } else if (cr.chaveNoLimite) {
    situacao = "parado";
    resumo = "A chave do OpenRouter chegou ao limite dela.";
    falta.push("Aumentar o limite da chave do OpenRouter (openrouter.ai, Keys) ou tirar o teto.");
  } else if (cr.restante !== null && cr.restante < 2) {
    situacao = "atencao";
    // Valor em dólar só para o admin (frente MTR, rodada 2).
    resumo = e.admin ? `OpenRouter quase sem crédito: ${dinheiro(cr.restante)}.` : "OpenRouter quase sem crédito.";
    falta.push("Recarregar o crédito do OpenRouter antes que pare.");
  } else if (cr.restante !== null) {
    resumo = e.admin ? `OpenRouter com ${dinheiro(cr.restante)} disponíveis.` : "OpenRouter com crédito.";
  }
  const o = e.openrouter;
  if (o && e.admin) {
    if (o.creditos) detalhes.push(`Conta do OpenRouter: ${dinheiro(o.creditos.usado)} usados de ${dinheiro(o.creditos.total)}.`);
    if (o.chave && o.chave.limite !== null) detalhes.push(`Limite da chave: ${dinheiro(o.chave.restante || 0)} restantes de ${dinheiro(o.chave.limite)}.`);
  }
  if (o && o.erro) detalhes.push(`Não deu para ler o crédito do OpenRouter agora (${curto(o.erro, 120)}).`);
  if (!e.segredos.OPENAI_API_KEY) detalhes.push("Sem OPENAI_API_KEY: os modelos da OpenAI direta ficam desligados (pelo OpenRouter seguem).");
  if (!e.segredos.ANTHROPIC_API_KEY) detalhes.push("Sem ANTHROPIC_API_KEY: os modelos Claude vão pelo OpenRouter (a Anthropic direta fica desligada).");
  if (!e.segredos.TYPESAFE_API_KEY) {
    falta.push(`Cadastrar a chave da TypeSafe (TYPESAFE_API_KEY) ${CHAVES_E_CUSTOS}: o Jev julga e confere nas mesas.`);
    if (situacao === "ok") situacao = "atencao";
  }
  if (!e.segredos.ELEVENLABS_API_KEY) detalhes.push("Sem ELEVENLABS_API_KEY: a voz da ElevenLabs não roda pelas funções.");
  if (e.admin && e.carteirasBaixas.length) {
    detalhes.push(`Carteiras de IA quase vazias: ${e.carteirasBaixas.slice(0, 6).map((c) => `${c.cliente} (${dinheiro(c.saldo)})`).join(", ")}.`);
  }
  const chaves = chavesQueFaltam(e, [["openrouter", ["OPENROUTER_API_KEY"]], ["typesafe", ["TYPESAFE_API_KEY"]], ["openai", ["OPENAI_API_KEY"]], ["anthropic", ["ANTHROPIC_API_KEY"]], ["elevenlabs", ["ELEVENLABS_API_KEY"]]]);
  if (chaves.indexOf("openrouter") < 0 && (cr.semCredito || cr.chaveNoLimite || (cr.restante !== null && cr.restante < 2))) chaves.unshift("openrouter");
  return { id: "ia", nome: "Chaves e crédito da IA", situacao, resumo, ultimo_sinal: null, fila: { esperando: 0, rodando: 0, desde: null }, ultimo_erro: null, falta, detalhes, chaves };
}

/** O quadro inteiro, na ordem da tela. */
export function montarEstado(e: EntradaDoEstado): EstadoDoMotor[] {
  return [motorDoSite(e), motorDeRender(e, "motion"), motorDeRender(e, "edicao"), motorDeImagem(e), motorDeVideo(e), motorDaIa(e)];
}

/** Resumo de uma linha para o topo ("2 motores parados"). */
export function resumoGeral(motores: EstadoDoMotor[]): { parados: number; atencao: number; texto: string } {
  const parados = motores.filter((m) => m.situacao === "parado").length;
  const atencao = motores.filter((m) => m.situacao === "atencao").length;
  const partes: string[] = [];
  if (parados) partes.push(plural(parados, "motor parado", "motores parados"));
  if (atencao) partes.push(plural(atencao, "pede atenção", "pedem atenção"));
  return { parados, atencao, texto: partes.length ? partes.join(", ") : "Tudo ligado" };
}

// ------------------------------------------------------------------ leitura das respostas do OpenRouter (puras)

/** Teto de chave acima disto é "sem teto" na prática (a chave da agência vem com 999.999.999). */
export const TETO_DE_CHAVE_SEM_LIMITE = 1_000_000;

/** GET /api/v1/key -> { data: { limit, usage, limit_remaining } } (limit null = sem teto). */
export function lerChaveDoOpenrouter(corpo: unknown): { limite: number | null; uso: number | null; restante: number | null } | null {
  const d = corpo && typeof corpo === "object" ? (corpo as { data?: Record<string, unknown> }).data : null;
  if (!d || typeof d !== "object") return null;
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const bruto = n(d.limit);
  const limite = bruto !== null && bruto >= TETO_DE_CHAVE_SEM_LIMITE ? null : bruto;
  const uso = n(d.usage);
  let restante = n(d.limit_remaining);
  if (restante === null && limite !== null && uso !== null) restante = limite - uso;
  return { limite, uso, restante: limite === null ? null : restante };
}

/** GET /api/v1/credits -> { data: { total_credits, total_usage } }. */
export function lerCreditosDoOpenrouter(corpo: unknown): { total: number; usado: number } | null {
  const d = corpo && typeof corpo === "object" ? (corpo as { data?: Record<string, unknown> }).data : null;
  if (!d || typeof d !== "object") return null;
  const total = Number(d.total_credits);
  const usado = Number(d.total_usage);
  return isFinite(total) && isFinite(usado) ? { total, usado } : null;
}

/** O texto do erro de um pedido de vídeo (o motivo mora nos envios). */
export function erroDoPedidoDeVideo(resultado: unknown): string | null {
  const envios = resultado && typeof resultado === "object" ? (resultado as { envios?: Array<{ erro?: unknown }> }).envios : null;
  if (!Array.isArray(envios)) return null;
  const e = envios.find((x) => x && typeof x.erro === "string" && x.erro);
  return e ? String(e.erro) : null;
}

/** Segredos que a função confere (só a presença; o valor nunca sai do servidor). */
export const SEGREDOS_CONFERIDOS = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "FAL_KEY",
  "TYPESAFE_API_KEY",
  "ELEVENLABS_API_KEY",
  "RUNWAYML_API_SECRET",
  "HIGGSFIELD_API_KEY",
  "HIGGSFIELD_API_SECRET",
  "HEYGEN_API_KEY",
] as const;
