import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { textoDoErro } from "@/lib/mesa/api";
import { dataCurta, hojeEmSaoPaulo, reais, ROTULO_DO_STATUS, statusEfetivo, type StatusDaProposta } from "../../../supabase/functions/_shared/proposta-modelo";
import { followupDaProposta, type Followup } from "../../../supabase/functions/_shared/proposta-comercial";
import { aplicarNaLista, CHAVES, chamarProposta, faltaAColunaNova, faltaATabela } from "@/components/mesa-proposta/propostaApi";
import { etapaPeloStatus } from "@/components/mesa-proposta/caminhoDaProposta";

/**
 * Propostas em Clientes (frente PRO3, 30/09/2026), pedido do dono: "a
 * proposta tem que estar em Clientes, e não onde seleciono as mesas". Aqui
 * mora a leitura da carteira de propostas (todas as que a pessoa pode ver,
 * pela RLS: admin e gestor com acesso ao cliente), os filtros, o endereço da
 * Mesa Proposta e a criação (cliente novo, lead do Comercial ou upsell).
 *
 * Toda escrita passa pela função mesa-proposta (ação criar); o banco não
 * aceita escrita direta. Criar é sem custo: faz na hora e o toast traz o
 * Desfazer (arquiva a proposta).
 */

export type LinhaDaCarteira = {
  id: string;
  client_id: string;
  lead_id: string | null;
  numero: string;
  titulo: string;
  status: StatusDaProposta;
  validade_ate: string | null;
  total_unico: number;
  total_mensal: number;
  enviada_em: string | null;
  vista_em: string | null;
  aceita_em: string | null;
  atualizado_em: string | null;
  ultimo_followup_em: string | null;
  upsell: boolean;
  followup: Followup | null;
};

const CAMPOS_BASE = "id, client_id, lead_id, numero, titulo, status, validade_ate, total_unico, total_mensal, enviada_em, vista_em, aceita_em, atualizado_em, upsell_em:contexto->upsell->>lido_em";
const CAMPOS = `${CAMPOS_BASE}, ultimo_followup_em`;

export const CHAVE_DA_CARTEIRA = ["clientes", "propostas"] as const;

/** Linha do banco em forma segura, com o status do dia (validade vencida vira expirada) e o follow-up. */
export function linhaDaCarteira(bruta: unknown, hoje: string = hojeEmSaoPaulo()): LinhaDaCarteira | null {
  if (!bruta || typeof bruta !== "object") return null;
  const o = bruta as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.client_id !== "string") return null;
  const validade = typeof o.validade_ate === "string" ? o.validade_ate.slice(0, 10) : null;
  const status = statusEfetivo(o.status, validade, hoje);
  const base = {
    status: String(o.status || "rascunho"),
    enviada_em: (o.enviada_em as string) || null,
    vista_em: (o.vista_em as string) || null,
    validade_ate: validade,
    ultimo_followup_em: (o.ultimo_followup_em as string) || null,
  };
  return {
    id: o.id,
    client_id: o.client_id,
    lead_id: (o.lead_id as string) || null,
    numero: String(o.numero || ""),
    titulo: String(o.titulo || "Proposta comercial"),
    status,
    validade_ate: validade,
    total_unico: Number(o.total_unico) || 0,
    total_mensal: Number(o.total_mensal) || 0,
    enviada_em: base.enviada_em,
    vista_em: base.vista_em,
    aceita_em: (o.aceita_em as string) || null,
    atualizado_em: (o.atualizado_em as string) || null,
    ultimo_followup_em: base.ultimo_followup_em,
    upsell: !!o.upsell_em || o.tipo === "upsell",
    followup: followupDaProposta(base, hoje),
  };
}

/** Valor em uma linha: "R$ 3.000,00 + R$ 1.500,00/mês" (sai dos totais gravados pelos itens). */
export function valorDaLinha(l: Pick<LinhaDaCarteira, "total_unico" | "total_mensal">): string {
  const partes: string[] = [];
  if (l.total_unico > 0) partes.push(reais(l.total_unico));
  if (l.total_mensal > 0) partes.push(`${reais(l.total_mensal)}/mês`);
  return partes.join(" + ") || "Sem valor";
}

/** "Vista em 12/09", "Aceita em 14/09", "Enviada em 10/09" ou "Rascunho". */
export function situacaoDaLinha(l: Pick<LinhaDaCarteira, "status" | "enviada_em" | "vista_em" | "aceita_em" | "validade_ate">): string {
  if (l.status === "aceita") return l.aceita_em ? `Aceita em ${dataCurta(l.aceita_em.slice(0, 10))}` : "Aceita";
  if (l.status === "vista") return l.vista_em ? `Vista em ${dataCurta(l.vista_em.slice(0, 10))}` : "Vista";
  if (l.status === "enviada") return l.enviada_em ? `Enviada em ${dataCurta(l.enviada_em.slice(0, 10))}, não aberta` : "Enviada";
  if (l.status === "expirada") return l.validade_ate ? `Venceu em ${dataCurta(l.validade_ate)}` : "Vencida";
  return ROTULO_DO_STATUS[l.status] || "Rascunho";
}

export type FiltroDaCarteira = "abertas" | "followup" | "aceitas" | "upsell" | "encerradas" | "todas";

export const FILTROS_DA_CARTEIRA: Array<{ valor: FiltroDaCarteira; rotulo: string }> = [
  { valor: "abertas", rotulo: "Em aberto" },
  { valor: "followup", rotulo: "Follow-up pendente" },
  { valor: "aceitas", rotulo: "Aceitas" },
  { valor: "upsell", rotulo: "Upsell" },
  { valor: "encerradas", rotulo: "Recusadas e vencidas" },
  { valor: "todas", rotulo: "Todas" },
];

export function filtrarCarteira(lista: LinhaDaCarteira[], filtro: FiltroDaCarteira): LinhaDaCarteira[] {
  switch (filtro) {
    case "abertas":
      return lista.filter((l) => l.status === "rascunho" || l.status === "enviada" || l.status === "vista");
    case "followup":
      return lista.filter((l) => !!l.followup);
    case "aceitas":
      return lista.filter((l) => l.status === "aceita");
    case "upsell":
      return lista.filter((l) => l.upsell);
    case "encerradas":
      return lista.filter((l) => l.status === "recusada" || l.status === "expirada");
    default:
      return lista;
  }
}

/**
 * Etapa em que a proposta abre (frente PRS, 30/09): rascunho na Conversa (o
 * começo do caminho); enviada, vista, aceita, recusada ou vencida no
 * Acompanhar, onde está o que fazer agora (follow-up, contrato, renovar).
 */
export function enderecoDaProposta(l: { id: string; client_id: string; status: string }): string {
  const etapa = etapaPeloStatus(l.status);
  return `/mesa-proposta?client=${encodeURIComponent(l.client_id)}&proposta=${encodeURIComponent(l.id)}&etapa=${etapa}`;
}

/** Todas as propostas vivas que a pessoa enxerga (as arquivadas ficam fora), as mais recentes antes. */
export function usePropostasDaCarteira(ativo = true) {
  return useQuery({
    queryKey: CHAVE_DA_CARTEIRA,
    enabled: ativo,
    staleTime: 30_000,
    queryFn: async (): Promise<{ lista: LinhaDaCarteira[]; semTabela: boolean }> => {
      const pedir = (campos: string) => (supabase as any).from("propostas").select(campos).is("arquivada_em", null).order("atualizado_em", { ascending: false }).limit(300);
      let { data, error } = await pedir(CAMPOS);
      if (error && faltaAColunaNova(error)) ({ data, error } = await pedir(CAMPOS_BASE));
      if (error) {
        if (faltaATabela(error)) return { lista: [], semTabela: true };
        throw error;
      }
      const hoje = hojeEmSaoPaulo();
      return { lista: ((data || []) as unknown[]).map((d) => linhaDaCarteira(d, hoje)).filter((l): l is LinhaDaCarteira => !!l), semTabela: false };
    },
  });
}

/** O histórico de propostas de um cliente (a seção Propostas da ficha). */
export function usePropostasDoCliente(clientId: string, ativo = true) {
  return useQuery({
    queryKey: [...CHAVE_DA_CARTEIRA, "cliente", clientId],
    enabled: ativo && !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<{ lista: LinhaDaCarteira[]; semTabela: boolean }> => {
      const pedir = (campos: string) => (supabase as any).from("propostas").select(campos).eq("client_id", clientId).is("arquivada_em", null).order("atualizado_em", { ascending: false }).limit(60);
      let { data, error } = await pedir(CAMPOS);
      if (error && faltaAColunaNova(error)) ({ data, error } = await pedir(CAMPOS_BASE));
      if (error) {
        if (faltaATabela(error)) return { lista: [], semTabela: true };
        throw error;
      }
      const hoje = hojeEmSaoPaulo();
      return { lista: ((data || []) as unknown[]).map((d) => linhaDaCarteira(d, hoje)).filter((l): l is LinhaDaCarteira => !!l), semTabela: false };
    },
  });
}

export type LeadParaProposta ={ id: string; nome: string; empresa: string | null; email: string | null; whatsapp: string | null; estagio: string; won_client_id: string | null };

/** Leads vivos do Comercial (sem os perdidos), com o contato para criar o cliente na hora. */
export function useLeadsParaProposta(ativo = true) {
  return useQuery({
    queryKey: ["clientes", "propostas", "leads"],
    enabled: ativo,
    staleTime: 60_000,
    queryFn: async (): Promise<LeadParaProposta[]> => {
      const { data, error } = await (supabase as any)
        .from("commercial_leads")
        .select("id, name, company, email, whatsapp, stage, won_client_id")
        .is("archived_at", null)
        .neq("stage", "perdido")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return ((data || []) as Array<Record<string, unknown>>).map((l) => ({
        id: String(l.id),
        nome: String(l.name || "Lead"),
        empresa: (l.company as string) || null,
        email: (l.email as string) || null,
        whatsapp: (l.whatsapp as string) || null,
        estagio: String(l.stage || ""),
        won_client_id: (l.won_client_id as string) || null,
      }));
    },
  });
}

export type PedidoDeProposta = {
  clientId: string;
  leadId?: string | null;
  tipo?: "nova" | "upsell";
  /** Nome do projeto (vira o título; vazio = o padrão do servidor). */
  titulo?: string;
  /** Modelo de proposta da agência (vazio = o padrão). */
  modeloId?: string | null;
  /** Marca aberta na mesa (a proposta nasce com a logo e as cores dela). */
  marcaId?: string | null;
};

/**
 * Cria a proposta (sem custo) e abre a Mesa Proposta nela. O toast traz o
 * Desfazer (arquiva). `abrir` troca a navegação (a ficha fecha antes).
 */
export function useCriarProposta(abrir?: (caminho: string) => void | Promise<void>) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [criando, setCriando] = useState<string | null>(null);
  const criar = async (p: PedidoDeProposta): Promise<string | null> => {
    if (criando) return null;
    const chave = `${p.clientId}:${p.tipo || "nova"}`;
    setCriando(chave);
    try {
      const d = await chamarProposta<any>("criar", {
        client_id: p.clientId,
        lead_id: p.leadId || undefined,
        tipo: p.tipo === "upsell" ? "upsell" : undefined,
        titulo: p.titulo && p.titulo.trim() ? p.titulo.trim() : undefined,
        modelo_id: p.modeloId || undefined,
        marca_id: p.marcaId || undefined,
      });
      const proposta = d && d.proposta;
      const id = proposta && typeof proposta.id === "string" ? proposta.id : "";
      if (!id) throw new Error("A proposta não voltou da função.");
      // PRS: a proposta entra na lista da mesa na hora (a mesa abre nela sem esperar a releitura).
      if (proposta && proposta.client_id) aplicarNaLista(qc, p.clientId, proposta);
      void qc.invalidateQueries({ queryKey: CHAVE_DA_CARTEIRA });
      void qc.invalidateQueries({ queryKey: CHAVES.propostas(p.clientId) });
      if (d && d.aviso_agencia) toast.info("Dados da agência incompletos", { description: "Quem somos e provas ficam de fora até a agência cadastrar." });
      const avisos: string[] = d && Array.isArray(d.avisos_upsell) ? d.avisos_upsell : [];
      toast.success(p.tipo === "upsell" ? `Proposta de upsell ${proposta.numero || ""} criada com o que o cliente já tem.` : `Proposta ${proposta.numero || ""} criada.`, {
        description: avisos.length ? avisos.join(" ") : undefined,
        duration: 10_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            chamarProposta("arquivar", { proposta_id: id, arquivar: true })
              .then(() => {
                void qc.invalidateQueries({ queryKey: CHAVE_DA_CARTEIRA });
                void qc.invalidateQueries({ queryKey: CHAVES.propostas(p.clientId) });
                toast.success("Proposta arquivada.");
              })
              .catch((e) => toast.error(textoDoErro(e, "Não foi possível desfazer.")));
          },
        },
      });
      const caminho = `/mesa-proposta?client=${encodeURIComponent(p.clientId)}&proposta=${encodeURIComponent(id)}&etapa=${p.tipo === "upsell" ? "rascunho" : "contexto"}${p.marcaId ? `&marca=${encodeURIComponent(p.marcaId)}` : ""}`;
      if (abrir) await abrir(caminho);
      else navigate(caminho);
      return id;
    } catch (e) {
      toast.error(textoDoErro(e, "A proposta não foi criada."));
      return null;
    } finally {
      setCriando(null);
    }
  };
  return { criar, criando };
}
