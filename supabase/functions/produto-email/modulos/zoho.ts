/**
 * Zoho Mail de cada cliente (uma conta Zoho por cliente, plano gratuito por padrão).
 * Só leitura pela API de administração: organização, usuários, apelidos e domínio (verificação e DKIM).
 * O refresh token do cliente vem do Vault; o client id e o secret do app OAuth da Aceleriq vêm dos
 * segredos da função (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET). Nada aqui cria, muda ou apaga no Zoho.
 *
 * Plano gratuito: sem IMAP, POP, ActiveSync nem encaminhamento (página de preços do Zoho, 18/11/2026).
 * A documentação da API não diz se o gratuito tem acesso à API: a conferência responde o que o Zoho
 * devolver, e um "sem permissão" vira aviso claro em vez de erro calado.
 * Sem import: roda na função (Deno) e no vitest.
 */

export const DATA_CENTERS = ["com", "eu", "in", "com.au", "jp", "ca", "sa"] as const;
export type DataCenter = (typeof DATA_CENTERS)[number];

export const dcValido = (dc: unknown): DataCenter => ((DATA_CENTERS as readonly string[]).indexOf(String(dc)) >= 0 ? (dc as DataCenter) : "com");
export const urlDeContas = (dc: DataCenter) => `https://accounts.zoho.${dc}`;
export const urlDoMail = (dc: DataCenter) => `https://mail.zoho.${dc}`;

/** Escopos só de leitura que o token do cliente precisa ter. */
export const ESCOPOS_DE_LEITURA = ["ZohoMail.organization.accounts.READ", "ZohoMail.organization.domains.READ", "ZohoMail.partner.organization.READ"];

export interface UsuarioDoZoho {
  zuid?: number | string;
  primaryEmailAddress?: string;
  mailboxAddress?: string;
  displayName?: string;
  role?: string;
  accountStatus?: string;
  emailAddress?: Array<{ mailId?: string; isAlias?: boolean; isPrimary?: boolean }>;
  usedStorage?: number | string;
  planStorage?: number | string;
}

export interface DominioDoZoho {
  domainName?: string;
  verificationStatus?: boolean | string;
  mxstatus?: string;
  spfstatus?: boolean | string;
  dkimstatus?: boolean | string;
  dkimDetailList?: Array<{ selector?: string; isVerified?: boolean; isDefault?: boolean }>;
}

export interface ResumoDoZoho {
  ok: boolean;
  org_id: string | null;
  plano: string | null;
  usuarios: number;
  limite_gratuito: number;
  caixas: Array<{ endereco: string; nome: string; apelidos: string[]; ativa: boolean; admin: boolean }>;
  dominio: { verificado: boolean; mx: string | null; spf: boolean; dkim: boolean; seletor: string | null } | null;
  avisos: string[];
  conferido_em: string;
}

const sim = (v: unknown) => v === true || v === "true" || v === "verified" || v === "enabled";

/** Monta o resumo a partir das respostas do Zoho. Só regra: o teste chama direto. */
export function resumirZoho(
  p: { orgId: string | null; plano?: string | null; usuarios: UsuarioDoZoho[]; dominio?: DominioDoZoho | null; nomeDoDominio: string; agora?: Date },
): ResumoDoZoho {
  const avisos: string[] = [];
  const caixas = p.usuarios.map((u) => {
    const endereco = String(u.primaryEmailAddress || u.mailboxAddress || "").toLowerCase();
    const apelidos = (u.emailAddress || []).filter((e) => e.isAlias && e.mailId).map((e) => String(e.mailId).toLowerCase());
    return { endereco, nome: String(u.displayName || ""), apelidos, ativa: !u.accountStatus || /active/i.test(String(u.accountStatus)), admin: /admin/i.test(String(u.role || "")) };
  }).filter((c) => c.endereco);
  const gratuito = !p.plano || /free|gratuit/i.test(p.plano);
  if (gratuito && caixas.length > 5) avisos.push(`O plano gratuito do Zoho aceita 5 usuários e há ${caixas.length}. Os excedentes têm que virar apelido.`);
  const foraDoDominio = caixas.filter((c) => !c.endereco.endsWith(`@${p.nomeDoDominio}`));
  if (foraDoDominio.length) avisos.push(`${foraDoDominio.length} caixa(s) fora de @${p.nomeDoDominio}.`);
  let dominio: ResumoDoZoho["dominio"] = null;
  if (p.dominio) {
    const padrao = (p.dominio.dkimDetailList || []).find((d) => d.isDefault) || (p.dominio.dkimDetailList || [])[0];
    dominio = {
      verificado: sim(p.dominio.verificationStatus),
      mx: p.dominio.mxstatus ? String(p.dominio.mxstatus) : null,
      spf: sim(p.dominio.spfstatus),
      dkim: sim(p.dominio.dkimstatus) || !!(padrao && padrao.isVerified),
      seletor: padrao && padrao.selector ? String(padrao.selector) : null,
    };
    if (!dominio.verificado) avisos.push("O domínio ainda não foi verificado no Zoho.");
    if (!dominio.dkim) avisos.push("O DKIM ainda não foi verificado no Zoho.");
  } else {
    avisos.push(`O domínio ${p.nomeDoDominio} não apareceu na organização do Zoho.`);
  }
  if (gratuito) avisos.push("Plano gratuito: sem IMAP, POP, ActiveSync nem encaminhamento. Webmail e aplicativo do Zoho.");
  return {
    ok: !!p.orgId && !!dominio && dominio.verificado,
    org_id: p.orgId,
    plano: p.plano || null,
    usuarios: caixas.length,
    limite_gratuito: 5,
    caixas,
    dominio,
    avisos,
    conferido_em: (p.agora || new Date()).toISOString(),
  };
}

type Busca = (url: string, init: RequestInit) => Promise<Response>;

export class SemPermissaoNoZoho extends Error {}

/** Troca o refresh token do cliente por um access token (vale 1 hora). Nunca devolve o refresh. */
export async function tokenDeAcesso(busca: Busca, p: { dc: DataCenter; clientId: string; clientSecret: string; refreshToken: string }): Promise<string> {
  const corpo = new URLSearchParams({ grant_type: "refresh_token", client_id: p.clientId, client_secret: p.clientSecret, refresh_token: p.refreshToken });
  const r = await busca(`${urlDeContas(p.dc)}/oauth/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo.toString() });
  const d = (await r.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!r.ok || !d || !d.access_token) throw new Error(`O Zoho recusou o token${d && d.error ? ` (${String(d.error).slice(0, 60)})` : ""}. Gere um novo e guarde de novo.`);
  return d.access_token;
}

async function lerDoMail<T>(busca: Busca, dc: DataCenter, acesso: string, caminho: string): Promise<T> {
  const r = await busca(`${urlDoMail(dc)}${caminho}`, { headers: { Authorization: `Zoho-oauthtoken ${acesso}`, Accept: "application/json" } });
  const d = (await r.json().catch(() => null)) as { status?: { code?: number; description?: string }; data?: T } | null;
  if (r.status === 401 || r.status === 403 || (d && d.status && (d.status.code === 401 || d.status.code === 403))) {
    throw new SemPermissaoNoZoho("O Zoho não liberou a API para esta conta ou o token não tem os escopos de leitura.");
  }
  if (!r.ok || !d) throw new Error(`O Zoho respondeu ${r.status}.`);
  return d.data as T;
}

/** Lê a organização do cliente, os usuários e o domínio. Só GET. */
export async function lerOrganizacao(
  busca: Busca,
  p: { dc: DataCenter; acesso: string; orgId?: string | null; dominio: string },
): Promise<{ orgId: string | null; plano: string | null; usuarios: UsuarioDoZoho[]; dominio: DominioDoZoho | null }> {
  let orgId = p.orgId || null;
  let plano: string | null = null;
  if (!orgId) {
    const org = await lerDoMail<{ zoid?: number | string; planType?: string; subscriptionPlan?: string } | Array<{ zoid?: number | string }>>(busca, p.dc, p.acesso, "/api/organization");
    const uma = Array.isArray(org) ? org[0] : org;
    orgId = uma && uma.zoid ? String(uma.zoid) : null;
    plano = uma && !Array.isArray(org) ? String((org as { subscriptionPlan?: string; planType?: string }).subscriptionPlan || (org as { planType?: string }).planType || "") || null : null;
  }
  if (!orgId) return { orgId: null, plano, usuarios: [], dominio: null };
  const usuarios = await lerDoMail<UsuarioDoZoho[]>(busca, p.dc, p.acesso, `/api/organization/${encodeURIComponent(orgId)}/accounts`);
  let dominio: DominioDoZoho | null = null;
  try {
    dominio = await lerDoMail<DominioDoZoho>(busca, p.dc, p.acesso, `/api/organization/${encodeURIComponent(orgId)}/domains/${encodeURIComponent(p.dominio)}`);
  } catch (e) {
    if (e instanceof SemPermissaoNoZoho) throw e;
    dominio = null;
  }
  return { orgId, plano, usuarios: usuarios || [], dominio };
}
