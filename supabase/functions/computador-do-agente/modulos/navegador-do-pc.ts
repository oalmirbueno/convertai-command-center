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

// ------------------------------------------------------------------ horário comercial do Ego (26/10/2026)
//
// Pedido do dono: "Todos os agentes rodam das 9h às 18h. Eles podem usar o Ego das 9h até as 18h. Quando
// passa esse horário eles não usam o Ego, mas fazem as coisas em nuvem e já deixam preparado." Fora da
// janela, o MCP aceita o pedido como agendado (executar_a_partir_de = próxima abertura) e o worker só
// anuncia o caso pc_ego dentro dela; a pegada no banco também não entrega pedido antes da hora.
// Configurável pelas variáveis EGO_HORARIO ("09:00-18:00"), EGO_DIAS ("1-5"; 0 = domingo, 6 = sábado)
// e EGO_FUSO ("America/Sao_Paulo"), lidas no MCP (secrets da função) e no worker (variáveis da máquina).

export interface JanelaDoEgo {
  /** Minuto do dia em que abre (9h = 540). */
  inicio_min: number;
  /** Minuto do dia em que fecha (18h = 1080); a janela é [inicio, fim). */
  fim_min: number;
  /** Dias da semana com Ego (0 = domingo … 6 = sábado). */
  dias: number[];
  fuso: string;
}

export const JANELA_PADRAO_DO_EGO: JanelaDoEgo = { inicio_min: 9 * 60, fim_min: 18 * 60, dias: [1, 2, 3, 4, 5], fuso: "America/Sao_Paulo" };
export const CODIGO_FORA_DO_HORARIO = "fora_do_horario_do_ego";
/** Prioridade do pedido agendado: menor roda antes ao abrir a janela. */
export const PRIORIDADES_DO_PC = { alta: 1, normal: 2, baixa: 3 } as const;
export type PrioridadeDoPc = keyof typeof PRIORIDADES_DO_PC;

const hhmm = (s: string): number | null => {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] || 0);
  return h <= 24 && mi < 60 && h * 60 + mi <= 1440 ? h * 60 + mi : null;
};

function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** Lê a janela das variáveis; valor inválido fica no padrão (9h–18h, seg–sex, São Paulo). */
export function lerJanelaDoEgo(ler: (nome: string) => string | undefined | null): JanelaDoEgo {
  const j: JanelaDoEgo = { ...JANELA_PADRAO_DO_EGO, dias: JANELA_PADRAO_DO_EGO.dias.slice() };
  const pegar = (n: string) => {
    try {
      return String(ler(n) ?? "").trim();
    } catch {
      return "";
    }
  };
  const horario = pegar("EGO_HORARIO");
  const partes = horario.split(/\s*[-–a]\s*/);
  if (partes.length === 2) {
    const ini = hhmm(partes[0]);
    const fim = hhmm(partes[1]);
    if (ini !== null && fim !== null && fim > ini) {
      j.inicio_min = ini;
      j.fim_min = fim;
    }
  }
  const dias = pegar("EGO_DIAS");
  if (dias) {
    const lista: number[] = [];
    for (const pedaco of dias.split(",")) {
      const m = /^\s*([0-6])\s*(?:-\s*([0-6]))?\s*$/.exec(pedaco);
      if (!m) {
        lista.length = 0;
        break;
      }
      const a = Number(m[1]);
      const b = m[2] === undefined ? a : Number(m[2]);
      for (let d = a; d <= b; d++) if (lista.indexOf(d) < 0) lista.push(d);
    }
    if (lista.length) j.dias = lista.sort();
  }
  const fuso = pegar("EGO_FUSO");
  if (fuso && fusoValido(fuso)) j.fuso = fuso;
  return j;
}

interface PartesLocais {
  ano: number;
  mes: number;
  dia: number;
  minuto_do_dia: number;
  dia_da_semana: number;
}

const formatadores = new Map<string, Intl.DateTimeFormat>();
function partesLocais(ms: number, fuso: string): PartesLocais {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatadores.set(fuso, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  const hora = p.hour === 24 ? 0 : p.hour;
  return { ano: p.year, mes: p.month, dia: p.day, minuto_do_dia: hora * 60 + p.minute, dia_da_semana: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}

/** Diferença (min) entre a hora local do fuso e o UTC naquele instante. */
function deslocamentoMin(ms: number, fuso: string): number {
  const l = partesLocais(ms, fuso);
  const comoUtc = Date.UTC(l.ano, l.mes - 1, l.dia, 0, l.minuto_do_dia);
  return Math.round((comoUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** Instante UTC (ms) de uma hora local do fuso (ano, mês 1–12, dia, minuto do dia). */
function instanteLocal(ano: number, mes: number, dia: number, minuto: number, fuso: string): number {
  const ingenuo = Date.UTC(ano, mes - 1, dia, 0, minuto);
  let ms = ingenuo - deslocamentoMin(ingenuo, fuso) * 60000;
  ms = ingenuo - deslocamentoMin(ms, fuso) * 60000;
  return ms;
}

/** O Ego pode ser usado neste instante? */
export function dentroDaJanelaDoEgo(ms: number, j: JanelaDoEgo = JANELA_PADRAO_DO_EGO): boolean {
  const l = partesLocais(ms, j.fuso);
  return j.dias.indexOf(l.dia_da_semana) >= 0 && l.minuto_do_dia >= j.inicio_min && l.minuto_do_dia < j.fim_min;
}

/** Quando a janela abre de novo (ms). Dentro da janela, devolve o próprio instante. */
export function proximaAberturaDoEgo(ms: number, j: JanelaDoEgo = JANELA_PADRAO_DO_EGO): number {
  if (dentroDaJanelaDoEgo(ms, j)) return ms;
  const l = partesLocais(ms, j.fuso);
  for (let k = 0; k <= 14; k++) {
    const d = new Date(Date.UTC(l.ano, l.mes - 1, l.dia + k));
    if (j.dias.indexOf(d.getUTCDay()) < 0) continue;
    const abre = instanteLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), j.inicio_min, j.fuso);
    if (abre > ms) return abre;
  }
  // Janela sem nenhum dia (não acontece com a leitura acima): amanhã no mesmo horário.
  return ms + 86_400_000;
}

/** Quando fecha a janela do dia (local) daquele instante (ms). */
export function fimDaJanelaDoDia(ms: number, j: JanelaDoEgo = JANELA_PADRAO_DO_EGO): number {
  const l = partesLocais(ms, j.fuso);
  return instanteLocal(l.ano, l.mes, l.dia, j.fim_min, j.fuso);
}

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dois = (n: number) => String(n).padStart(2, "0");
const horaDoMinuto = (m: number) => `${dois(Math.floor(m / 60))}:${dois(m % 60)}`;

/** "seg 27/10 às 09:00" no fuso da janela. */
export function rotuloLocal(ms: number, j: JanelaDoEgo = JANELA_PADRAO_DO_EGO): string {
  const l = partesLocais(ms, j.fuso);
  return `${DIAS_CURTOS[l.dia_da_semana]} ${dois(l.dia)}/${dois(l.mes)} às ${horaDoMinuto(l.minuto_do_dia)}`;
}

/** "09:00–18:00, seg a sex (America/Sao_Paulo)". */
export function descreverJanelaDoEgo(j: JanelaDoEgo = JANELA_PADRAO_DO_EGO): string {
  const dias = j.dias.join(",") === "1,2,3,4,5" ? "seg a sex" : j.dias.map((d) => DIAS_CURTOS[d]).join(", ");
  return `${horaDoMinuto(j.inicio_min)}–${horaDoMinuto(j.fim_min)}, ${dias} (${j.fuso})`;
}

/** Mensagem do pedido aceito fora da janela. */
export function mensagemAgendado(abreMs: number, j: JanelaDoEgo = JANELA_PADRAO_DO_EGO): string {
  return `Fora do horário do Ego (${descreverJanelaDoEgo(j)}). O pedido ficou agendado e roda ${rotuloLocal(abreMs, j)}, por ordem de prioridade; o resultado fica guardado no painel. Não repita nem fique consultando: siga com o trabalho de nuvem (leitura pelo painel e MCP, análise, rascunho, proposta com aprovação) e leia o resultado depois desse horário.`;
}

export const MENSAGEM_AGENDADO_NAO_RODOU =
  "O pedido agendado para o horário do Ego não rodou: o PC do dono não ficou ligado com o navegador da agência na janela. Não peça de novo sozinho: registre ao dono no painel (aceleriq_operator_request_approval ou insumo) o que precisa e por quê, ou encerre a tarefa com o motivo.";
