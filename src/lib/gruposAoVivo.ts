/**
 * Grupos dos clientes ao vivo (18/11/2026). Dono: "quero ver os grupos sempre
 * atualizados, numa tela no painel; entender o que eu envio e como eu respondo".
 *
 * A leitura vem de `public.grupos_ao_vivo()` (só equipe): o n8n lê os grupos de
 * WhatsApp, transcreve áudio, descreve imagem e vídeo e escreve o resumo do dia.
 * Aqui ficam só as contas e os rótulos da tela (puros, testados em
 * src/test/grupos-ao-vivo.test.ts).
 */

export type PapelNoGrupo = "cliente" | "agencia" | "automatico" | "outro";

export interface MensagemDoGrupo {
  id: string;
  quando: string;
  papel: PapelNoGrupo;
  nome: string | null;
  tipo: string;
  texto: string | null;
  /** O que havia na imagem ou no vídeo (leitura automática). */
  descricao: string | null;
  ruido: boolean;
  guardada: boolean;
}

export type TipoDeItem = "pedido_cliente" | "decisao" | "feito_agencia" | "pendencia_agencia" | "pendencia_cliente" | "informacao";

export interface ItemDoResumo {
  tipo: TipoDeItem;
  texto: string;
  veioDeAudio: boolean;
}

export interface ResumoDoGrupo {
  dia: string;
  geradoEm: string | null;
  noDossie: boolean;
  resumo: string | null;
  itens: ItemDoResumo[];
  sugestoes: string[];
}

export interface GrupoDoCliente {
  clientId: string;
  cliente: string;
  conversas: number;
  respondidas: number;
  medianaRespostaMin: number | null;
  esperandoDesde: string | null;
  esperandoMensagens: number;
  esperandoTexto: string | null;
  esperandoQuem: string | null;
  ultimaDoCliente: string | null;
  ultimaDaAgencia: string | null;
  mensagensHoje: number;
  tarefasAbertas: number;
  resumo: ResumoDoGrupo | null;
  resumoFalhouHoje: boolean;
  mensagens: MensagemDoGrupo[];
}

export interface SaudeDosGrupos {
  ultimaMensagem: string | null;
  ultimoResumo: string | null;
  resumosComFalha: number;
  midias24h: number;
  midiasEntendidas24h: number;
}

export interface GruposAoVivo {
  disponivel: boolean;
  geradoEm: string | null;
  saude: SaudeDosGrupos;
  clientes: GrupoDoCliente[];
}

type Solto = Record<string, unknown>;
const obj = (v: unknown): Solto => (v && typeof v === "object" && !Array.isArray(v) ? (v as Solto) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) > 0 ? Number(v) : 0);

const TIPOS: TipoDeItem[] = ["pedido_cliente", "decisao", "feito_agencia", "pendencia_agencia", "pendencia_cliente", "informacao"];

/** O papel que o banco grava (cliente_equipe, cliente_decisor, agencia, bot) vira o que a tela mostra. */
export function papelNoGrupo(papel: unknown): PapelNoGrupo {
  const p = String(papel || "");
  if (p.startsWith("cliente")) return "cliente";
  if (p === "agencia") return "agencia";
  if (p === "bot") return "automatico";
  return "outro";
}

function normalizarResumo(v: unknown): ResumoDoGrupo | null {
  const r = obj(v);
  const dia = txt(r.dia);
  if (!dia) return null;
  return {
    dia,
    geradoEm: txt(r.gerado_em),
    noDossie: r.no_dossie === true,
    resumo: txt(r.resumo),
    itens: lista(r.itens)
      .map(obj)
      .filter((i) => TIPOS.includes(i.tipo as TipoDeItem) && txt(i.texto))
      .map((i) => ({ tipo: i.tipo as TipoDeItem, texto: String(i.texto), veioDeAudio: i.veio_de_audio === true })),
    sugestoes: lista(r.sugestoes).map(txt).filter((s): s is string => !!s),
  };
}

/** Aceita qualquer coisa que o banco devolver e nunca quebra a tela por campo ausente. */
export function normalizarGrupos(bruto: unknown): GruposAoVivo {
  const b = obj(bruto);
  const s = obj(b.saude);
  return {
    disponivel: b.disponivel === true,
    geradoEm: txt(b.gerado_em),
    saude: {
      ultimaMensagem: txt(s.ultima_mensagem),
      ultimoResumo: txt(s.ultimo_resumo),
      resumosComFalha: num(s.resumos_com_falha),
      midias24h: num(s.midias_24h),
      midiasEntendidas24h: num(s.midias_entendidas_24h),
    },
    clientes: lista(b.clientes)
      .map(obj)
      .filter((c) => txt(c.client_id) && txt(c.cliente))
      .map((c) => ({
        clientId: String(c.client_id),
        cliente: String(c.cliente),
        conversas: num(c.conversas),
        respondidas: num(c.respondidas),
        medianaRespostaMin: typeof c.mediana_resposta_min === "number" ? c.mediana_resposta_min : null,
        esperandoDesde: txt(c.esperando_desde),
        esperandoMensagens: num(c.esperando_mensagens),
        esperandoTexto: txt(c.esperando_texto),
        esperandoQuem: txt(c.esperando_quem),
        ultimaDoCliente: txt(c.ultima_do_cliente),
        ultimaDaAgencia: txt(c.ultima_da_agencia),
        mensagensHoje: num(c.mensagens_hoje),
        tarefasAbertas: num(c.tarefas_abertas),
        resumo: normalizarResumo(c.resumo),
        resumoFalhouHoje: c.resumo_falhou_hoje === true,
        mensagens: lista(c.mensagens)
          .map(obj)
          .filter((m) => txt(m.id) && txt(m.quando))
          .map((m) => ({
            id: String(m.id),
            quando: String(m.quando),
            papel: papelNoGrupo(m.papel),
            nome: txt(m.nome),
            tipo: String(m.tipo || "texto"),
            texto: txt(m.texto),
            descricao: txt(m.descricao),
            ruido: m.ruido === true,
            guardada: m.guardada === true,
          })),
      })),
  };
}

/** "há 12 min", "há 3 h", "há 2 d". Usado na espera e na última mensagem. */
export function haQuanto(iso: string | null, agoraMs: number): string {
  if (!iso) return "";
  const ms = agoraMs - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} d`;
}

/** Tempo de resposta em palavras: 7 → "7 min", 95 → "1 h 35", 1500 → "1 d". */
export function duracao(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return "-";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  }
  return `${Math.round(min / 1440)} d`;
}

export type TomDaEspera = "calmo" | "atencao" | "urgente";

/**
 * A espera pesa pelo relógio da agência: até 1 hora é conversa normal; passou
 * de 3 horas (ou virou o dia) pede resposta. Sem espera, calmo.
 */
export function tomDaEspera(esperandoDesde: string | null, agoraMs: number): TomDaEspera {
  if (!esperandoDesde) return "calmo";
  const min = (agoraMs - new Date(esperandoDesde).getTime()) / 60000;
  if (!Number.isFinite(min) || min < 60) return "calmo";
  return min >= 180 ? "urgente" : "atencao";
}

export interface NumerosDosGrupos {
  esperando: number;
  mensagensHoje: number;
  /** Mediana das medianas dos clientes que tiveram conversa na semana. */
  respostaMin: number | null;
  conversas: number;
  respondidas: number;
}

export function numerosDosGrupos(clientes: GrupoDoCliente[]): NumerosDosGrupos {
  const medianas = clientes.map((c) => c.medianaRespostaMin).filter((m): m is number => m !== null).sort((a, b) => a - b);
  const meio = Math.floor(medianas.length / 2);
  return {
    esperando: clientes.filter((c) => c.esperandoDesde).length,
    mensagensHoje: clientes.reduce((t, c) => t + c.mensagensHoje, 0),
    respostaMin: medianas.length ? (medianas.length % 2 ? medianas[meio] : Math.round((medianas[meio - 1] + medianas[meio]) / 2)) : null,
    conversas: clientes.reduce((t, c) => t + c.conversas, 0),
    respondidas: clientes.reduce((t, c) => t + c.respondidas, 0),
  };
}

/** Quem espera resposta vem primeiro (o que espera há mais tempo no topo); depois, quem falou por último. */
export function ordenarGrupos(clientes: GrupoDoCliente[]): GrupoDoCliente[] {
  const t = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
  return [...clientes].sort((a, b) => {
    if (!!a.esperandoDesde !== !!b.esperandoDesde) return a.esperandoDesde ? -1 : 1;
    if (a.esperandoDesde && b.esperandoDesde) return t(a.esperandoDesde) - t(b.esperandoDesde);
    const ua = Math.max(t(a.ultimaDoCliente), t(a.ultimaDaAgencia));
    const ub = Math.max(t(b.ultimaDoCliente), t(b.ultimaDaAgencia));
    return ub - ua || a.cliente.localeCompare(b.cliente, "pt-BR");
  });
}

export const ROTULO_DO_ITEM: Record<TipoDeItem, string> = {
  pedido_cliente: "Pedidos do cliente",
  pendencia_agencia: "Prometemos",
  pendencia_cliente: "Esperamos do cliente",
  decisao: "Decisões",
  feito_agencia: "Fizemos",
  informacao: "Vale lembrar",
};

/** A ordem em que o resumo é lido: primeiro o que pede ação. */
export const ORDEM_DOS_ITENS: TipoDeItem[] = ["pedido_cliente", "pendencia_agencia", "pendencia_cliente", "decisao", "feito_agencia", "informacao"];

export function itensPorTipo(itens: ItemDoResumo[]): Array<{ tipo: TipoDeItem; itens: ItemDoResumo[] }> {
  return ORDEM_DOS_ITENS.map((tipo) => ({ tipo, itens: itens.filter((i) => i.tipo === tipo) })).filter((g) => g.itens.length > 0);
}

/** Uma linha para a lista: o que a mensagem diz, ou o que havia no arquivo. */
export function linhaDaMensagem(m: MensagemDoGrupo): string {
  if (m.texto) return m.texto;
  if (m.descricao) return m.descricao;
  if (m.tipo === "audio") return "Áudio sem transcrição";
  if (m.tipo === "imagem") return "Imagem";
  if (m.tipo === "video") return "Vídeo";
  if (m.tipo === "documento") return "Documento";
  return "Mensagem";
}

export const ROTULO_DO_PAPEL: Record<PapelNoGrupo, string> = { cliente: "Cliente", agencia: "Aceleriq", automatico: "Aviso automático", outro: "Grupo" };
