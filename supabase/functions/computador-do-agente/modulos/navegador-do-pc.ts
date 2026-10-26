/**
 * Navegador do PC (26/10/2026): os agentes (Hermes e Paperclip) usam o navegador Ego Lite do PC do
 * dono, com os logins que ele já fez (gerenciador de anúncios da Meta, Instagram, Google), sem pedir
 * senha nem código. Decisão do dono: "pelo seu PC" — só funciona com o PC ligado.
 *
 * Caminho: o agente pede pelo MCP (aceleriq_navegador_do_pc) → tarefa caso "pc_ego" em
 * agente_computador_tarefas → o worker do navegador desta máquina (workers/computador) pega e roda no
 * Ego (`ego-browser nodejs`, perfil do dono) → resultado, texto lido e prints voltam na tarefa.
 *
 * Regras daqui valem no MCP (na entrada) e de novo no worker (antes de rodar e no clique):
 * - só sites da lista (plataformas de marketing); e-mail, conta Google, senhas, cobrança e pagamento não;
 * - nada de senha, código ou credencial digitada; página de login no meio = "sessão expirada", para;
 * - ler, navegar, capturar, rolar e esperar são livres; clique que publica, envia, paga, salva, apaga,
 *   ativa ou pausa e toda digitação fora de busca exigem aprovação aprovada (operator_approvals);
 * - PC desligado (worker sem sinal) = "navegador do PC indisponível", sem fila e sem repetir.
 *
 * Puro TypeScript, sem import de URL: roda no Deno (MCP) e no Node (worker).
 */

import { pareceCredencial } from "../../mesa-videos/modulos/computador-do-agente.ts";

export const CASO_DO_PC = "pc_ego";
export const ACOES_DO_PC = ["navegar", "ler", "capturar", "clicar", "digitar", "rolar", "esperar"] as const;
export type AcaoDoPc = (typeof ACOES_DO_PC)[number];
export const MAX_PASSOS_DO_PC = 12;
/** O worker manda sinal a cada ~20 s quando está livre; sem sinal há mais que isto, o PC conta como desligado. */
export const PC_ONLINE_S = 120;
/** Pedido que ninguém pegou neste tempo é cancelado como indisponível (o agente não fica esperando). */
export const ESPERA_NA_FILA_S = 180;
export const CODIGO_PC_INDISPONIVEL = "navegador_do_pc_indisponivel";
export const MENSAGEM_PC_INDISPONIVEL =
  "Navegador do PC indisponível: o computador do dono está desligado ou o navegador da agência não está rodando. Não tente de novo agora: siga com outra tarefa e, se isso travar o trabalho, avise o dono no diário.";

/** Sites em que o navegador do PC pode entrar (e os subdomínios deles). */
export const DOMINIOS_DO_PC = [
  "facebook.com",
  "instagram.com",
  "meta.com",
  "google.com",
  "youtube.com",
  "tiktok.com",
  "linkedin.com",
  "pinterest.com",
  "x.com",
  "threads.net",
];

/** Hosts da lista que ficam fora mesmo assim: e-mail, conta, senhas e pagamento do dono. */
export const HOSTS_PROIBIDOS_DO_PC = /^(mail|accounts|myaccount|passwords|pay|payments|wallet|takeout|contacts|messages)\.google\.com$|^(accountscenter|secure)\.(facebook|instagram|meta)\.com$/i;

/** Caminhos de login, senha, segurança, cobrança e pagamento. */
export const CAMINHO_PROIBIDO_DO_PC =
  /(^|[/._?&=-])(login|logon|signin|sign-in|signup|sign-up|password|senha|recover|recovery|checkpoint|two_factor|two-factor|2fa|security|seguranca|billing|billing_hub|payment|payments|pagamento|checkout|wallet|carteira|cobranca|payment_settings)([/._?&=-]|$)/i;

const PARAMETRO_DE_CREDENCIAL = /[?&#](token|access_token|api_?key|key|senha|password|sig|signature|code|session|nonce)=/i;

/** Clique que muda o mundo: publica, envia, paga, salva, apaga, ativa, pausa, aceita. */
export const ALVO_SENSIVEL_DO_PC =
  /\b(publicar|publique|postar|poste|compartilhar|enviar|envie|send|publish|post|pagar|pague|pagamento|comprar|compre|checkout|assinar|assine|excluir|exclua|apagar|apague|deletar|delete|remover|remove|ativar|desativar|activate|deactivate|pausar|pause|retomar|resume|impulsionar|turbinar|boost|transferir|confirmar|confirm|salvar|save|aplicar|apply|concluir|finalizar|duplicar|duplicate|criar|create|aceitar|accept|convidar|invite|seguir|follow|curtir|like|comentar|comment|responder|reply|desconectar|disconnect|sair|log ?out)\b/i;

/** Campo de busca ou filtro: digitar ali é leitura. */
export const CAMPO_DE_BUSCA = /(pesquis|busca|buscar|procur|search|filtr|filter|find)/i;

/** Sinais de que a sessão caiu (página de login). */
export const URL_DE_LOGIN = /(^|[/._?&=-])(login|logon|signin|sign-in|checkpoint|two_factor|2fa)([/._?&=-]|$)|accounts\.google\.com/i;

export interface PassoDoPc {
  acao: AcaoDoPc;
  url?: string;
  texto?: string;
  seletor?: string;
  campo?: string;
  valor?: string;
  enviar?: boolean;
  inteira?: boolean;
  dy?: number;
  ms?: number;
  /** Só o servidor marca: o passo sensível tem uma aprovação aprovada. */
  autorizado?: boolean;
}

export interface PedidoDoPc {
  passos: PassoDoPc[];
  url_inicial: string;
  dominios: string[];
  objetivo: string;
  /** Índices dos passos que só rodam com aprovação. */
  sensiveis: number[];
}

/** Host de uma URL https permitida no navegador do PC (null = recusada). */
export function hostPermitidoNoPc(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (HOSTS_PROIBIDOS_DO_PC.test(host)) return null;
  const dominio = DOMINIOS_DO_PC.find((d) => host === d || host.endsWith(`.${d}`));
  return dominio || null;
}

/** Motivo para recusar uma URL no navegador do PC (null = pode). */
export function motivoParaRecusarUrlNoPc(bruto: unknown): string | null {
  const texto = String(bruto ?? "").trim();
  if (!texto || texto.length > 2000) return "Endereço vazio ou longo demais.";
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    return "Endereço inválido.";
  }
  if (!hostPermitidoNoPc(u.toString())) {
    return `O navegador do PC só abre ${DOMINIOS_DO_PC.join(", ")} (https), e nunca e-mail, conta, senhas ou pagamento do dono.`;
  }
  if (CAMINHO_PROIBIDO_DO_PC.test(`${u.pathname}${u.search}`)) return "O navegador do PC não entra em login, senha, segurança, cobrança ou pagamento. Esse passo é do dono.";
  if (PARAMETRO_DE_CREDENCIAL.test(u.toString()) || pareceCredencial(u.toString())) return "O endereço leva token, chave ou código. Credencial nunca passa pelo navegador do PC.";
  return null;
}

/** O passo só roda com aprovação aprovada? (a checagem do alvo real é repetida no clique, dentro do Ego) */
export function passoPrecisaAprovacao(p: PassoDoPc): boolean {
  if (p.acao === "clicar") return ALVO_SENSIVEL_DO_PC.test(String(p.texto || "")) || ALVO_SENSIVEL_DO_PC.test(String(p.seletor || ""));
  if (p.acao === "digitar") return !CAMPO_DE_BUSCA.test(`${p.campo || ""} ${p.seletor || ""}`);
  return false;
}

const texto = (v: unknown, max: number) => (v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim().slice(0, max));

/** Confere e normaliza o pedido. `url` solta vira o primeiro passo (navegar). */
export function normalizarPedidoDoPc(bruto: unknown): { ok: true; pedido: PedidoDoPc } | { ok: false; erro: string } {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const lista: unknown[] = Array.isArray(o.passos) ? o.passos.slice() : [];
  if (o.url && !(lista[0] && (lista[0] as Record<string, unknown>).acao === "navegar")) lista.unshift({ acao: "navegar", url: o.url });
  if (!lista.length) return { ok: false, erro: "Mande os passos (o primeiro é navegar, com a url)." };
  if (lista.length > MAX_PASSOS_DO_PC) return { ok: false, erro: `No máximo ${MAX_PASSOS_DO_PC} passos por pedido.` };
  const passos: PassoDoPc[] = [];
  const dominios: string[] = [];
  const sensiveis: number[] = [];
  for (let i = 0; i < lista.length; i++) {
    const b = (lista[i] && typeof lista[i] === "object" ? lista[i] : {}) as Record<string, unknown>;
    const acao = String(b.acao || "") as AcaoDoPc;
    if ((ACOES_DO_PC as readonly string[]).indexOf(acao) < 0) return { ok: false, erro: `Passo ${i + 1}: ação desconhecida (${ACOES_DO_PC.join(", ")}).` };
    const p: PassoDoPc = { acao };
    if (acao === "navegar") {
      const url = texto(b.url, 2000);
      const motivo = motivoParaRecusarUrlNoPc(url);
      if (motivo) return { ok: false, erro: `Passo ${i + 1}: ${motivo}` };
      p.url = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).toString();
      const d = hostPermitidoNoPc(p.url) as string;
      if (dominios.indexOf(d) < 0) dominios.push(d);
    } else if (i === 0) {
      return { ok: false, erro: "O primeiro passo é navegar (com a url)." };
    }
    if (acao === "clicar") {
      p.texto = texto(b.texto, 160) || undefined;
      p.seletor = texto(b.seletor, 300) || undefined;
      if (!p.texto && !p.seletor) return { ok: false, erro: `Passo ${i + 1}: clicar precisa do texto visível ou do seletor.` };
    }
    if (acao === "digitar") {
      p.campo = texto(b.campo, 120) || undefined;
      p.seletor = texto(b.seletor, 300) || undefined;
      p.valor = String(b.valor ?? "").slice(0, 500);
      p.enviar = b.enviar === true;
      if (!p.campo && !p.seletor) return { ok: false, erro: `Passo ${i + 1}: digitar precisa do campo (rótulo) ou do seletor.` };
      if (!p.valor) return { ok: false, erro: `Passo ${i + 1}: digitar precisa do valor.` };
      if (pareceCredencial(p.valor) || /\S+@\S+\.\S+/.test(p.valor) || /senha|password|c[oó]digo/i.test(`${p.campo || ""} ${p.seletor || ""}`)) {
        return { ok: false, erro: `Passo ${i + 1}: senha, código, e-mail ou credencial nunca são digitados pelo agente. Login é do dono, no Ego.` };
      }
    }
    if (acao === "ler") p.inteira = b.inteira === true;
    if (acao === "rolar") p.dy = Math.max(-5000, Math.min(5000, Math.round(Number(b.dy) || 800)));
    if (acao === "esperar") p.ms = Math.max(200, Math.min(10_000, Math.round(Number(b.ms) || 1500)));
    if (passoPrecisaAprovacao(p)) sensiveis.push(i);
    passos.push(p);
  }
  return { ok: true, pedido: { passos, url_inicial: passos[0].url as string, dominios, objetivo: texto(o.objetivo, 500), sensiveis } };
}

export interface ExecutorVisto {
  nome: string;
  visto_em: string | null;
  casos: string[] | null;
}

/** Há um navegador do PC ligado com o Ego? (sinal recente ou uma tarefa do PC rodando com trava viva) */
export function pcDisponivel(executores: ExecutorVisto[], agora: number, rodandoAgora = false): { disponivel: boolean; executor: string | null; visto_ha_s: number | null } {
  let melhor: { nome: string; ha: number } | null = null;
  for (const e of executores || []) {
    if (!(e.casos || []).includes(CASO_DO_PC) || !e.visto_em) continue;
    const ha = Math.max(0, Math.round((agora - new Date(e.visto_em).getTime()) / 1000));
    if (!melhor || ha < melhor.ha) melhor = { nome: e.nome, ha };
  }
  const disponivel = rodandoAgora || (!!melhor && melhor.ha <= PC_ONLINE_S);
  return { disponivel, executor: melhor ? melhor.nome : null, visto_ha_s: melhor ? melhor.ha : null };
}

/** Teto de passos da tarefa no banco (cada print é um passo): folga para os prints do roteiro. */
export function tetoDePassosDoPc(passos: number): number {
  return Math.min(60, Math.max(4, passos * 2 + 2));
}
