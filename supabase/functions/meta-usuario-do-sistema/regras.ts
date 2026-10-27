/**
 * Regras puras do usuário do sistema da Meta (27/10/2026).
 *
 * Sem rede, sem banco e sem Deno: o vitest testa daqui (src/test/
 * meta-usuario-do-sistema.test.ts) e a função de borda usa o mesmo código.
 * Nenhuma função daqui devolve token: o token de página só circula dentro de
 * `PaginaDoToken.token`, que a função de borda manda direto para o banco.
 */

/** O que o login já exige (social_meta_oauth_store_resources). Sem isso, não aplica. */
export const ESCOPOS_OBRIGATORIOS = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
] as const;

/**
 * Pedidos para o resto do painel funcionar igual ao login de hoje: métricas
 * (instagram_manage_insights), páginas da BM (business_management) e
 * comentários (instagram_manage_comments). Faltar um deles não bloqueia,
 * mas a conferência avisa.
 */
export const ESCOPOS_RECOMENDADOS = [
  "instagram_manage_insights",
  "business_management",
  "instagram_manage_comments",
] as const;

export const BM_ACELERIQ = "888502683024626";

export type OrigemDaConcessao = "oauth_usuario" | "usuario_do_sistema";

type Registro = Record<string, unknown>;

const registro = (v: unknown): Registro | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Registro) : null;

const textoLimpo = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

const idNumerico = (v: unknown): string | null => {
  const s = textoLimpo(v, 64);
  return s && /^\d{1,64}$/.test(s) ? s : null;
};

/** Unix (segundos) da Meta para ISO. 0, ausente ou inválido = sem prazo. */
export function prazoDaMeta(valor: unknown): string | null {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && /^\d+$/.test(valor) ? Number(valor) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface ConferenciaDoToken {
  valido: boolean;
  tipo: string | null;
  usuarioDoSistema: boolean;
  appId: string | null;
  appConfere: boolean;
  metaUserId: string | null;
  /** null = não vence (o "Nunca" da BM). */
  expiraEm: string | null;
  acessoAosDadosExpiraEm: string | null;
  nuncaVence: boolean;
  escopos: string[];
  faltando: string[];
  recomendadosFaltando: string[];
  /** Pode guardar e aplicar: válido, do nosso app, usuário do sistema, sem prazo e com os escopos. */
  aprovado: boolean;
  problemas: string[];
}

/**
 * Lê o `data` do GET /debug_token. O token tem de ser do mesmo app
 * (META_APP_ID): o painel assina toda chamada com appsecret_proof desse app,
 * e o token de página derivado de outro app seria recusado.
 */
export function conferirDebugToken(data: unknown, appIdEsperado: string): ConferenciaDoToken {
  const d = registro(data) ?? {};
  const tipo = textoLimpo(d.type, 40);
  const appId = idNumerico(d.app_id);
  const metaUserId = idNumerico(d.user_id);
  const escopos = Array.isArray(d.scopes)
    ? [...new Set(d.scopes.map((s) => textoLimpo(s, 80)).filter((s): s is string => !!s))].sort()
    : [];
  const expiraEm = prazoDaMeta(d.expires_at);
  const acessoAosDadosExpiraEm = prazoDaMeta(d.data_access_expires_at);
  const valido = d.is_valid === true;
  const usuarioDoSistema = (tipo || "").toUpperCase() === "SYSTEM_USER";
  const appConfere = !!appId && appId === String(appIdEsperado || "").trim();
  const faltando = ESCOPOS_OBRIGATORIOS.filter((e) => !escopos.includes(e));
  const recomendadosFaltando = ESCOPOS_RECOMENDADOS.filter((e) => !escopos.includes(e));
  const nuncaVence = expiraEm === null && acessoAosDadosExpiraEm === null;

  const problemas: string[] = [];
  if (!valido) problemas.push("A Meta diz que o token não é válido.");
  if (valido && !appConfere) problemas.push("O token foi gerado para outro app. Gere de novo escolhendo o app do painel.");
  if (valido && !usuarioDoSistema) problemas.push("Este token não é de usuário do sistema.");
  if (valido && !nuncaVence) problemas.push("O token tem prazo. Gere de novo com validade \"Nunca\".");
  if (valido && faltando.length) problemas.push(`Faltam permissões: ${faltando.join(", ")}.`);
  if (valido && !metaUserId) problemas.push("A Meta não informou o usuário do token.");

  return {
    valido,
    tipo,
    usuarioDoSistema,
    appId,
    appConfere,
    metaUserId,
    expiraEm,
    acessoAosDadosExpiraEm,
    nuncaVence,
    escopos,
    faltando,
    recomendadosFaltando,
    aprovado: problemas.length === 0,
    problemas,
  };
}

export type OrigemDaPagina = "me_accounts" | "owned_pages" | "client_pages";

export interface PaginaDoToken {
  pageId: string;
  nome: string;
  /** Token de página. Nunca sai da função de borda a não ser para o banco. */
  token: string | null;
  instagram: { id: string; username: string | null; nome: string | null } | null;
  origens: OrigemDaPagina[];
}

/** Junta as páginas das três listas da Graph sem repetir e sem perder token nem Instagram. */
export function juntarPaginas(listas: Array<{ origem: OrigemDaPagina; paginas: unknown[] }>): PaginaDoToken[] {
  const porId = new Map<string, PaginaDoToken>();
  for (const { origem, paginas } of listas) {
    for (const bruta of (paginas || []).slice(0, 1000)) {
      const p = registro(bruta);
      if (!p) continue;
      const pageId = idNumerico(p.id);
      if (!pageId) continue;
      const nome = textoLimpo(p.name) || pageId;
      const token = typeof p.access_token === "string" && p.access_token.length >= 16 && p.access_token.length <= 8192
        ? p.access_token
        : null;
      const ig = registro(p.instagram_business_account);
      const igId = ig ? idNumerico(ig.id) : null;
      const instagram = igId
        ? { id: igId, username: textoLimpo(ig?.username, 100), nome: textoLimpo(ig?.name) }
        : null;
      const atual = porId.get(pageId);
      if (!atual) {
        porId.set(pageId, { pageId, nome, token, instagram, origens: [origem] });
        continue;
      }
      if (!atual.token && token) atual.token = token;
      if (!atual.instagram && instagram) atual.instagram = instagram;
      if (atual.nome === pageId && nome !== pageId) atual.nome = nome;
      if (!atual.origens.includes(origem)) atual.origens.push(origem);
    }
  }
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.pageId.localeCompare(b.pageId));
}

/** Página como a tela vê (sem token). */
export function paginaSemToken(p: PaginaDoToken) {
  return {
    page_id: p.pageId,
    nome: p.nome,
    tem_token_de_pagina: !!p.token,
    instagram: p.instagram ? { id: p.instagram.id, username: p.instagram.username } : null,
    origens: p.origens,
  };
}

export interface ConcessaoResumo {
  origem?: string | null;
  status?: string | null;
  access_token_expires_at?: string | null;
  data_access_expires_at?: string | null;
}

export interface ValidadeDaConcessao {
  valida: boolean;
  origem: OrigemDaConcessao;
  /** Prazo mais curto entre o token e o acesso aos dados; null = não vence. */
  venceEm: string | null;
  diasParaVencer: number | null;
  vencida: boolean;
  /** Avisar o dono: só concessão de login com prazo perto (ou passado). Usuário do sistema nunca avisa. */
  avisar: boolean;
}

const DIA_MS = 24 * 60 * 60 * 1000;
export const AVISAR_COM_DIAS = 14;

function menorPrazo(...prazos: Array<string | null | undefined>): string | null {
  const ms = prazos
    .map((p) => (p ? Date.parse(p) : NaN))
    .filter((n) => Number.isFinite(n));
  return ms.length ? new Date(Math.min(...ms)).toISOString() : null;
}

/**
 * Validade de uma concessão. Prazo nulo conta como válido (é o que o
 * publicador já faz em autopublish_assert_dispatch). A do usuário do sistema
 * não gera aviso de vencimento.
 */
export function validadeDaConcessao(c: ConcessaoResumo | null | undefined, agora: Date = new Date()): ValidadeDaConcessao {
  const origem: OrigemDaConcessao = c?.origem === "usuario_do_sistema" ? "usuario_do_sistema" : "oauth_usuario";
  if (!c) return { valida: false, origem, venceEm: null, diasParaVencer: null, vencida: false, avisar: false };
  const venceEm = menorPrazo(c.access_token_expires_at, c.data_access_expires_at);
  const restante = venceEm ? Date.parse(venceEm) - agora.getTime() : null;
  const vencida = restante !== null && restante <= 0;
  const ativa = (c.status ?? "active") === "active";
  const diasParaVencer = restante === null ? null : Math.max(0, Math.floor(restante / DIA_MS));
  return {
    valida: ativa && !vencida,
    origem,
    venceEm,
    diasParaVencer,
    vencida,
    avisar: origem !== "usuario_do_sistema" && ativa && restante !== null && restante <= AVISAR_COM_DIAS * DIA_MS,
  };
}

/**
 * Escolhe a concessão que deve servir uma conta: válida antes de vencida,
 * usuário do sistema antes de login, e entre logins a que vence mais tarde.
 */
export function escolherConcessao<T extends ConcessaoResumo>(concessoes: T[], agora: Date = new Date()): T | null {
  const validas = concessoes
    .map((c) => ({ c, v: validadeDaConcessao(c, agora) }))
    .filter((x) => x.v.valida);
  if (!validas.length) return null;
  validas.sort((a, b) => {
    const sistema = Number(b.v.origem === "usuario_do_sistema") - Number(a.v.origem === "usuario_do_sistema");
    if (sistema) return sistema;
    const fimA = a.v.venceEm ? Date.parse(a.v.venceEm) : Number.POSITIVE_INFINITY;
    const fimB = b.v.venceEm ? Date.parse(b.v.venceEm) : Number.POSITIVE_INFINITY;
    return fimB - fimA;
  });
  return validas[0].c;
}

export interface ContaDoPainel {
  external_account_id: string;
  client_id: string;
  cliente: string | null;
  platform: string;
  external_id: string | null;
  handle: string | null;
  display_name: string | null;
  connection_status: string | null;
  expires_at: string | null;
  data_access_expires_at: string | null;
  concessao: (ConcessaoResumo & { id?: string }) | null;
  tem_projeto: boolean;
}

export type MotivoDoCasamento =
  | "casa"
  | "nao_encontrada"
  | "sem_token_de_pagina"
  | "ja_no_usuario_do_sistema"
  | "sem_projeto";

export interface ItemDoCasamento {
  external_account_id: string;
  client_id: string;
  cliente: string | null;
  plataforma: "facebook" | "instagram";
  perfil: string;
  external_id: string | null;
  encontrada: boolean;
  page_id: string | null;
  concessao_atual: {
    origem: OrigemDaConcessao | null;
    vence_em: string | null;
    dias_para_vencer: number | null;
    vencida: boolean;
  };
  pode_aplicar: boolean;
  motivo: MotivoDoCasamento;
}

/**
 * Cruza as páginas que o token enxerga com as contas do painel: página do
 * Facebook pelo id da página, Instagram pelo id da conta profissional ligada
 * à página (instagram_business_account). Nada de casar por nome.
 */
export function casarContas(paginas: PaginaDoToken[], contas: ContaDoPainel[], agora: Date = new Date()): ItemDoCasamento[] {
  const porPagina = new Map(paginas.map((p) => [p.pageId, p]));
  const porInstagram = new Map(
    paginas.filter((p) => p.instagram).map((p) => [p.instagram!.id, p]),
  );
  const itens: ItemDoCasamento[] = [];
  for (const conta of contas) {
    if (conta.platform !== "facebook" && conta.platform !== "instagram") continue;
    const externo = conta.external_id ? String(conta.external_id).trim() : null;
    const pagina = externo
      ? conta.platform === "facebook" ? porPagina.get(externo) : porInstagram.get(externo)
      : undefined;
    const validade = conta.concessao ? validadeDaConcessao(conta.concessao, agora) : null;
    const prazoDaConexao = menorPrazo(conta.expires_at, conta.data_access_expires_at);
    const venceEm = validade?.venceEm ?? prazoDaConexao;
    const restante = venceEm ? Date.parse(venceEm) - agora.getTime() : null;
    const jaNoSistema = validade?.origem === "usuario_do_sistema" && validade.valida;

    let motivo: MotivoDoCasamento;
    if (!pagina) motivo = "nao_encontrada";
    else if (jaNoSistema) motivo = "ja_no_usuario_do_sistema";
    else if (!pagina.token) motivo = "sem_token_de_pagina";
    else if (!conta.tem_projeto) motivo = "sem_projeto";
    else motivo = "casa";

    const perfil = conta.platform === "instagram"
      ? (conta.handle ? (conta.handle.startsWith("@") ? conta.handle : `@${conta.handle}`) : conta.display_name || externo || "")
      : conta.display_name || pagina?.nome || externo || "";

    itens.push({
      external_account_id: conta.external_account_id,
      client_id: conta.client_id,
      cliente: conta.cliente,
      plataforma: conta.platform as "facebook" | "instagram",
      perfil,
      external_id: externo,
      encontrada: !!pagina,
      page_id: pagina?.pageId ?? null,
      concessao_atual: {
        origem: validade?.origem ?? null,
        vence_em: venceEm,
        dias_para_vencer: restante === null ? null : Math.max(0, Math.floor(restante / DIA_MS)),
        vencida: restante !== null && restante <= 0,
      },
      pode_aplicar: motivo === "casa",
      motivo,
    });
  }
  // Quem vence primeiro aparece primeiro.
  return itens.sort((a, b) => {
    const fa = a.concessao_atual.vence_em ? Date.parse(a.concessao_atual.vence_em) : Number.POSITIVE_INFINITY;
    const fb = b.concessao_atual.vence_em ? Date.parse(b.concessao_atual.vence_em) : Number.POSITIVE_INFINITY;
    return fa - fb || String(a.cliente || "").localeCompare(String(b.cliente || ""), "pt-BR") || a.plataforma.localeCompare(b.plataforma);
  });
}

/** Itens que vão para o banco no aplicar, com o token de página. Só as casadas (e as escolhidas, se houver escolha). */
export function contasParaAplicar(
  itens: ItemDoCasamento[],
  paginas: PaginaDoToken[],
  contas: ContaDoPainel[],
  escolhidas?: string[] | null,
): Array<{ external_account_id: string; page_id: string; instagram_user_id: string | null; display_name: string | null; handle: string | null; page_access_token: string }> {
  const filtro = escolhidas && escolhidas.length ? new Set(escolhidas) : null;
  const porPagina = new Map(paginas.map((p) => [p.pageId, p]));
  const contaPorId = new Map(contas.map((c) => [c.external_account_id, c]));
  const saida = [];
  for (const item of itens) {
    if (!item.pode_aplicar || !item.page_id) continue;
    if (filtro && !filtro.has(item.external_account_id)) continue;
    const pagina = porPagina.get(item.page_id);
    const conta = contaPorId.get(item.external_account_id);
    if (!pagina?.token || !conta) continue;
    saida.push({
      external_account_id: item.external_account_id,
      page_id: pagina.pageId,
      instagram_user_id: item.plataforma === "instagram" ? pagina.instagram?.id ?? null : null,
      display_name: item.plataforma === "instagram" ? pagina.instagram?.nome || pagina.instagram?.username || pagina.nome : pagina.nome,
      handle: item.plataforma === "instagram" ? pagina.instagram?.username ?? null : null,
      page_access_token: pagina.token,
    });
  }
  return saida;
}

/** Token colado: só o formato (nunca devolve nem registra o valor). */
export function formatoDoToken(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  if (t.length < 32 || t.length > 8192 || /\s/.test(t)) return null;
  if (!/^[A-Za-z0-9._\-|]+$/.test(t)) return null;
  return t;
}
