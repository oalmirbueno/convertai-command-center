/**
 * O lead do formulário também pela Conversions API da Meta (25/10/2026):
 * quando o site tem pixel, a equipe ligou o servidor na Mesa Site (Pixel e
 * eventos) e o visitante ACEITOU os cookies, o navegador manda o event_id do
 * fbq('track', 'Lead') e os cookies _fbp e _fbc; aqui o servidor repete o
 * Lead com o MESMO event_id (a Meta deduplica) e com e-mail, telefone e nome
 * em hash SHA-256. O token é o do cofre do cliente (nunca vai ao site).
 * Falha aqui nunca derruba o lead: vai para o log.
 *
 * Sem travessão.
 */
import { corpoDaCapi, enviarParaCapi, eventoParaCapi, lerMetaDoEnvio, type MetaDoEnvio, normalizarMedicao } from "../../mesa-site/modulos/medicao-do-site.ts";
import { normalizarPixel } from "../../_shared/site-lancamento.ts";

export type SiteDoFormulario = { client_id: string; integracoes: unknown; direcao: unknown };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Decide sem rede: pixel no site, servidor ligado na jornada e consentimento com event_id no envio. */
export function pedidoDaCapi(site: SiteDoFormulario | null, corpo: unknown): { pixel: string; meta: MetaDoEnvio } | null {
  if (!site) return null;
  const pixel = normalizarPixel(obj(obj(site.integracoes).pixel_meta).id);
  const medicao = normalizarMedicao(obj(obj(site.direcao).jornada).medicao);
  const meta = lerMetaDoEnvio(obj(corpo).meta);
  return pixel && medicao.capi && meta ? { pixel, meta } : null;
}

export type DependenciasDaCapi = {
  token: (clientId: string) => Promise<string | null>;
  buscar: Parameters<typeof enviarParaCapi>[3];
  sha256: (s: string) => Promise<string>;
};

export async function leadNaMeta(
  dep: DependenciasDaCapi,
  site: SiteDoFormulario | null,
  corpo: unknown,
  pessoa: { nome: string | null; email: string | null; whatsapp: string | null },
  visita: { ip: string | null; user_agent: string | null; pagina: string | null; origem: string | null },
): Promise<{ enviado: boolean; motivo: string | null }> {
  const pedido = pedidoDaCapi(site, corpo);
  if (!pedido || !site) return { enviado: false, motivo: null };
  const token = await dep.token(site.client_id);
  if (!token) return { enviado: false, motivo: "sem token da Meta no cofre" };
  const url = pedido.meta.url || (visita.origem ? `${visita.origem}${visita.pagina || "/"}` : "");
  const ev = await eventoParaCapi(
    { evento: "Lead", event_id: pedido.meta.event_id, url, ip: visita.ip, user_agent: visita.user_agent, fbp: pedido.meta.fbp, fbc: pedido.meta.fbc, email: pessoa.email, telefone: pessoa.whatsapp, nome: pessoa.nome },
    dep.sha256,
  );
  if (!ev) return { enviado: false, motivo: "sem dado para casar o evento" };
  const r = await enviarParaCapi(pedido.pixel, token, corpoDaCapi([ev]), dep.buscar);
  return r.ok ? { enviado: true, motivo: null } : { enviado: false, motivo: r.mensagem };
}
