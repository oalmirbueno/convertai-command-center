import { supabase } from "@/integrations/supabase/client";

/**
 * Lembrete de aprovação e régua de cobrança (27/10/2026).
 *
 * O painel prepara; o dono aprova; o Hermes envia no grupo do cliente e registra
 * (o painel não envia WhatsApp). As regras moram no banco
 * (supabase/migrations/20261027100000_lembrete_de_aprovacao_e_regua_de_cobranca.sql):
 * - lembrete: peça esperando o cliente há mais de 48 h, 1 por cliente por dia,
 *   só em dia útil das 9h às 18h, e só depois que o dono aprova o modelo;
 * - cobrança: D+1, D+5 e D+10 após o vencimento, cada uma esperando o dono (um
 *   toque, ou a régua inteira do cliente); pagou, para.
 * Aqui ficam a leitura da tela, as ações e as mesmas contas (janela, etapa,
 * texto) para a prévia do modelo.
 */

export type TipoDeModelo = "lembrete_aprovacao" | "cobranca_d1" | "cobranca_d5" | "cobranca_d10";
export type SituacaoDaMensagemAutomatica = "pendente" | "aprovado" | "rejeitado" | "expirado" | "cancelado";

export interface ModeloDeMensagem {
  tipo: TipoDeModelo;
  texto: string;
  aprovadoTexto: string | null;
  aprovadoEm: string | null;
  aprovadoPor: string | null;
}

export interface ItemDoLembrete { fileId: string; titulo: string; dias: number }
export interface ItemDaCobranca { billingId: string; descricao: string; valor: number; vencimento: string; dias: number; etapa: number | null; marco: boolean }

export interface MensagemAutomatica {
  id: string;
  tipo: "lembrete_aprovacao" | "cobranca";
  clientId: string;
  cliente: string;
  dia: string;
  etapa: number | null;
  itensDoLembrete: ItemDoLembrete[];
  itensDaCobranca: ItemDaCobranca[];
  mensagem: string;
  grupo: string | null;
  grupoConhecido: string | null;
  hash: string;
  status: SituacaoDaMensagemAutomatica;
  aprovadoVia: "modelo" | "dono" | "regua" | null;
  validaAte: string | null;
  enviadaEm: string | null;
  evidencia: string | null;
  motivoDeParar: string | null;
  criadaEm: string;
}

export interface ClienteEsperando { clientId: string; cliente: string; itens: ItemDoLembrete[]; grupo: string | null }

export interface PainelDasMensagens {
  janelaAberta: boolean;
  temPix: boolean;
  modelos: ModeloDeMensagem[];
  mensagens: MensagemAutomatica[];
  esperandoCliente: ClienteEsperando[];
  reguas: string[];
}

type Cru = Record<string, unknown>;
const obj = (v: unknown): Cru => (v && typeof v === "object" && !Array.isArray(v) ? (v as Cru) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const num = (v: unknown, padrao = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : padrao;
};

const itemDoLembrete = (x: unknown): ItemDoLembrete => {
  const i = obj(x);
  return { fileId: txt(i.file_id) || "", titulo: txt(i.titulo) || "Peça", dias: num(i.dias) };
};
const itemDaCobranca = (x: unknown): ItemDaCobranca => {
  const i = obj(x);
  return { billingId: txt(i.billing_id) || "", descricao: txt(i.descricao) || "Cobrança", valor: num(i.valor), vencimento: txt(i.vencimento) || "", dias: num(i.dias), etapa: i.etapa == null ? null : num(i.etapa), marco: i.marco === true };
};

const SITUACOES: SituacaoDaMensagemAutomatica[] = ["pendente", "aprovado", "rejeitado", "expirado", "cancelado"];

/** A RPC mensagens_automaticas_painel, lida de forma tolerante (campo ausente vira vazio). */
export function normalizarPainel(cru: unknown): PainelDasMensagens {
  const p = obj(cru);
  return {
    janelaAberta: p.janela_aberta === true,
    temPix: p.tem_pix === true,
    modelos: arr(p.modelos).map((x) => {
      const m = obj(x);
      return { tipo: String(m.tipo) as TipoDeModelo, texto: txt(m.texto) || "", aprovadoTexto: txt(m.aprovado_texto), aprovadoEm: txt(m.aprovado_em), aprovadoPor: txt(m.aprovado_por) };
    }),
    mensagens: arr(p.mensagens).map((x) => {
      const m = obj(x);
      const tipo = m.tipo === "cobranca" ? "cobranca" : "lembrete_aprovacao";
      const status = String(m.status) as SituacaoDaMensagemAutomatica;
      const via = txt(m.aprovado_via);
      return {
        id: txt(m.id) || "",
        tipo,
        clientId: txt(m.client_id) || "",
        cliente: txt(m.cliente) || "Cliente",
        dia: txt(m.dia) || "",
        etapa: m.etapa == null ? null : num(m.etapa),
        itensDoLembrete: tipo === "lembrete_aprovacao" ? arr(m.itens).map(itemDoLembrete) : [],
        itensDaCobranca: tipo === "cobranca" ? arr(m.itens).map(itemDaCobranca) : [],
        mensagem: txt(m.mensagem) || "",
        grupo: txt(obj(m.destino).recipient),
        grupoConhecido: txt(m.grupo_conhecido),
        hash: txt(m.payload_hash) || "",
        status: SITUACOES.indexOf(status) >= 0 ? status : "expirado",
        aprovadoVia: via === "modelo" || via === "dono" || via === "regua" ? via : null,
        validaAte: txt(m.valid_until),
        enviadaEm: txt(m.executed_at),
        evidencia: txt(m.execution_evidence),
        motivoDeParar: txt(m.cancelado_motivo),
        criadaEm: txt(m.created_at) || "",
      } as MensagemAutomatica;
    }).filter((m) => m.id),
    esperandoCliente: arr(p.esperando_cliente).map((x) => {
      const c = obj(x);
      return { clientId: txt(c.client_id) || "", cliente: txt(c.cliente) || "Cliente", itens: arr(c.itens).map(itemDoLembrete), grupo: txt(c.grupo) };
    }).filter((c) => c.clientId),
    reguas: arr(p.reguas).map((x) => String(x)),
  };
}

// ─── As mesmas contas do banco (para a prévia e para os testes) ───────────

/** Dia útil das 9h às 18h em São Paulo (UTC-3, sem horário de verão). */
export function janelaAberta(quando: Date): boolean {
  const sp = new Date(quando.getTime() - 3 * 3_600_000);
  const dia = sp.getUTCDay();
  const minutos = sp.getUTCHours() * 60 + sp.getUTCMinutes();
  return dia >= 1 && dia <= 5 && minutos >= 9 * 60 && minutos < 18 * 60;
}

/** Etapa da régua pelos dias de atraso: 1, 5 ou 10 (a maior já alcançada). */
export function etapaDaCobranca(diasDeAtraso: number): 1 | 5 | 10 | null {
  if (diasDeAtraso >= 10) return 10;
  if (diasDeAtraso >= 5) return 5;
  if (diasDeAtraso >= 1) return 1;
  return null;
}

/** Peça esperando há mais de 48 h (e pedida há no máximo 30 dias) entra no lembrete. */
export function pecaEntraNoLembrete(pedidaEm: Date, agora: Date): boolean {
  const horas = (agora.getTime() - pedidaEm.getTime()) / 3_600_000;
  return horas >= 48 && horas < 30 * 24;
}

export function brl(valor: number): string {
  const [inteiro, centavos] = Math.abs(valor).toFixed(2).split(".");
  return `R$ ${valor < 0 ? "-" : ""}${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

/** Troca {chave} pelo valor; chave sem valor some (nunca sai "{pix}" para o cliente). */
export function preencherModelo(texto: string, vars: Record<string, string>): string {
  let saida = texto || "";
  for (const k of Object.keys(vars)) saida = saida.split(`{${k}}`).join(vars[k] ?? "");
  return saida.replace(/\{[a-z_]+\}/g, "").trim();
}

const ddmm = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

export const LINK_DAS_APROVACOES = "https://aceleriq.online/aprovacoes";
export const LINK_DO_FINANCEIRO = "https://aceleriq.online/financeiro";

export function textoDoLembrete(modelo: string, cliente: string, itens: ItemDoLembrete[]): string {
  const linhas = itens.slice(0, 5).map((i) => `• ${i.titulo}${i.dias >= 1 ? ` (há ${i.dias} ${i.dias === 1 ? "dia" : "dias"})` : ""}`);
  if (itens.length > 5) linhas.push(`• e mais ${itens.length - 5}`);
  return preencherModelo(modelo, {
    cliente,
    pecas: `${itens.length} ${itens.length === 1 ? "peça" : "peças"}`,
    lista: linhas.join("\n"),
    link: LINK_DAS_APROVACOES,
  });
}

export function textoDaCobranca(modelo: string, cliente: string, itens: ItemDaCobranca[], pix: string | null): string {
  const ordem = itens.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  return preencherModelo(modelo, {
    cliente,
    itens: ordem.map((i) => `• ${i.descricao}: ${brl(i.valor)}, venceu em ${ddmm(i.vencimento)}`).join("\n"),
    total: brl(ordem.reduce((s, i) => s + i.valor, 0)),
    pix: pix || "a chave está no link abaixo",
    link: LINK_DO_FINANCEIRO,
  });
}

/** O total em aberto de uma cobrança e o vencimento mais antigo. */
export function resumoDaCobranca(m: MensagemAutomatica): { total: number; desde: string } {
  const total = m.itensDaCobranca.reduce((s, i) => s + i.valor, 0);
  const desde = m.itensDaCobranca.map((i) => i.vencimento).sort()[0] || "";
  return { total, desde: ddmm(desde) };
}

export const MOTIVO_DE_PARAR: Record<string, string> = {
  cliente_decidiu: "o cliente decidiu no painel",
  aprovado_por_fora: "aprovado por fora (registrado pela equipe)",
  pagou: "o cliente pagou",
  pagou_parte: "pagou parte; a próxima sai com o que falta",
  modelo_pausado: "lembretes pausados",
  cliente_removido: "cliente removido",
};

// ─── Leitura e ações ─────────────────────────────────────────────────────

/** As RPCs novas ainda não estão nos tipos gerados do banco. */
type RpcSolta = (nome: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpcSolta: RpcSolta = (nome, args) => (supabase.rpc as unknown as RpcSolta).call(supabase, nome, args);

async function chamar<T = unknown>(nome: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpcSolta(nome, args);
  if (error) throw new Error(error.message || `Falhou: ${nome}`);
  return data as T;
}

export async function lerPainelDasMensagens(): Promise<PainelDasMensagens> {
  return normalizarPainel(await chamar("mensagens_automaticas_painel"));
}

const chave = (partes: unknown[]) => {
  const base = JSON.stringify(partes);
  let h = 0;
  for (let i = 0; i < base.length; i += 1) h = (h * 31 + base.charCodeAt(i)) | 0;
  return `msg-auto-${(h >>> 0).toString(36)}-${base.length}`;
};

export interface ResultadoDaDecisao { status: SituacaoDaMensagemAutomatica; parou: string | null }

/** Aprovar (com texto e grupo opcionais) ou pular uma mensagem pendente. */
export async function decidirMensagem(m: MensagemAutomatica, decisao: "aprovado" | "rejeitado", extra: { texto?: string; grupo?: string } = {}): Promise<ResultadoDaDecisao> {
  const texto = (extra.texto ?? "").trim();
  const grupo = (extra.grupo ?? "").trim();
  const r = obj(await chamar("mensagem_automatica_decidir", {
    _id: m.id,
    _hash: m.hash,
    _decisao: decisao,
    _mensagem: texto && texto !== m.mensagem.trim() ? texto : null,
    _recipient: grupo || null,
    _nota: null,
    _key: chave([decisao, m.id, m.hash, texto, grupo]),
  }));
  return { status: (String(r.status) as SituacaoDaMensagemAutomatica) || "pendente", parou: txt(r.parou) };
}

export async function aprovarReguaDoCliente(clientId: string, grupo?: string): Promise<{ aprovadasAgora: number; semGrupo: boolean }> {
  const r = obj(await chamar("cobranca_regua_aprovar", { _client_id: clientId, _recipient: (grupo || "").trim() || null, _key: chave(["regua", clientId, Date.now()]) }));
  return { aprovadasAgora: num(r.aprovadas_agora), semGrupo: r.sem_grupo === true };
}

export async function revogarReguaDoCliente(clientId: string): Promise<void> {
  await chamar("cobranca_regua_revogar", { _client_id: clientId });
}

export async function definirGrupoDoCliente(clientId: string, grupo: string): Promise<void> {
  await chamar("cliente_grupo_whatsapp_definir", { _client_id: clientId, _recipient: grupo.trim() });
}

export async function salvarModelo(tipo: TipoDeModelo, texto: string): Promise<void> {
  await chamar("mensagem_modelo_salvar", { _tipo: tipo, _texto: texto });
}

export async function aprovarModelo(tipo: TipoDeModelo, texto: string): Promise<void> {
  await chamar("mensagem_modelo_aprovar", { _tipo: tipo, _texto: texto });
}

export async function pausarModelo(tipo: TipoDeModelo): Promise<void> {
  await chamar("mensagem_modelo_pausar", { _tipo: tipo });
}

/** Itens do "Precisa de você" (tela Hoje) vindos daqui; RPC ausente = nada. */
export async function lerDecisoesDasMensagens(): Promise<unknown[]> {
  const { data, error } = await rpcSolta("mensagens_automaticas_decisoes");
  if (error) return [];
  return Array.isArray(data) ? data : [];
}
