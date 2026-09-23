import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { somarMeses } from "@/lib/mesa/api";
import type { BlocoTexto, LayoutLamina } from "@/lib/mesa/layout";

/** Item editorial da agenda (tarefa com entrega de arte) e o trabalho do estúdio dele. */
export interface ItemDoMes {
  id: string;
  title: string;
  due_date: string | null;
  delivery_type: string;
  status: string;
  project_id: string;
}

export interface Verificacao {
  pendente?: boolean;
  texto_lido?: string | null;
  ortografia_ok?: boolean | null;
  faltando?: string[];
  sobrando?: string[];
  logo_presente?: boolean | null;
  logo_ok?: boolean | null;
  identidade?: number | { score?: number; nota?: number | null; escala_max?: number; nivel?: string | null; motivo?: string } | { erro: string } | null;
  erro?: string;
  conferido_em?: string;
}

export interface CardGerado {
  ordem: number;
  versao: number;
  storage_path: string;
  origem?: "gerar" | "ajuste";
  instrucao?: string | null;
  verificacao?: Verificacao | null;
  criado_em?: string;
}

export interface CardDaDirecao {
  ordem: number;
  funcao?: string;
  texto_exato?: string;
  composicao?: string;
  ilustracao?: string;
  prompt_imagem?: string;
  /** Direção estruturada (diretor ou roteiro): texto por papel e layout da lâmina. */
  blocos?: BlocoTexto[];
  layout?: LayoutLamina;
  evitar?: string;
  /** Fotos reais do acervo (cliente_imagens) usadas como base desta lâmina. */
  imagens_ids?: string[];
  /** Referências só desta lâmina: sobrepõem as do conjunto ("g:" = banco da agência). */
  referencias_ids?: string[];
  /** Descrição da imagem da lâmina anterior (carrossel contínuo). */
  imagem_anterior?: string;
}

export interface Trabalho {
  id: string;
  task_id: string | null;
  status: "rascunho" | "dirigido" | "gerando" | "pronto" | "entregue" | "erro";
  direcao: {
    conceito?: string;
    carrossel_infinito?: boolean;
    cards?: CardDaDirecao[];
    origem?: "diretor" | "roteiro";
    /** Referências escolhidas para o conjunto (ids de cliente_referencias; "g:" + id para o banco da agência). */
    referencias_ids?: string[];
  };
  modelo_imagem_id: string | null;
  qualidade: string | null;
  cards: CardGerado[];
  legenda: string | null;
  hashtags?: string[] | null;
  file_ids: string[];
  custo_usd: number;
  conversa_id: string | null;
  atualizado_em: string;
  /** Entrega (etapa 3): o banco acompanha a aprovação e o agendamento. */
  entrega_status?: EntregaStatus | null;
  entrega_aviso?: string | null;
  entrega_rodada?: number | null;
  enviado_em?: string | null;
  aprovado_em?: string | null;
  post_id?: string | null;
  agendado_para?: string | null;
}

export type EntregaStatus =
  | "aguardando_agencia"
  | "aguardando_cliente"
  | "reprovado"
  | "aprovado"
  | "agendado"
  | "precisa_de_atencao";

/** Publicação do post criado na Agenda a partir da arte aprovada. */
export interface PublicacaoDoPost {
  post_id: string;
  status: string;
  scheduled_at: string | null;
  delivery_mode: string | null;
  published_at: string | null;
  permalink: string | null;
}

export const ROTULO_DO_TRABALHO: Record<string, string> = {
  rascunho: "rascunho",
  dirigido: "direção pronta",
  gerando: "gerando",
  pronto: "arte pronta",
  entregue: "entregue em Arquivos",
  erro: "com erro",
};

export const FORMATOS_DE_ARTE = ["carousel", "static", "design"];

/** Modo da lista do Estúdio: de hoje até 60 dias para frente, sem olhar o mês. */
export const PROXIMOS_DIAS = "proximos";
export const DIAS_A_FRENTE = 60;

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Data local em AAAA-MM-DD (sem passar por UTC). */
export function dataLocal(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/**
 * Janela de datas da lista: um mês (início incluído, fim excluído) ou, no modo
 * "proximos", de hoje até hoje + 60 dias (fim excluído, então o 60º dia entra).
 */
export function janelaDaLista(mes: string, agora = new Date()): { inicio: string; fimExclusivo: string } {
  if (mes === PROXIMOS_DIAS) {
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + DIAS_A_FRENTE + 1);
    return { inicio: dataLocal(hoje), fimExclusivo: dataLocal(fim) };
  }
  return { inicio: mes, fimExclusivo: somarMeses(mes, 1) };
}

/**
 * Itens da agenda com arte (carrossel e estático) dos projetos do cliente,
 * mais o trabalho mais recente do estúdio de cada um. `mes` é o primeiro dia
 * do mês (AAAA-MM-01) ou "proximos" (hoje até 60 dias). Um item pedido pela
 * URL entra na lista mesmo se estiver fora da janela.
 */
export function useItensDoMes(clientId: string, mes: string, tarefaExtra?: string | null) {
  return useQuery({
    queryKey: ["mesa", "itens-do-mes", clientId, mes, tarefaExtra || ""],
    queryFn: async (): Promise<{
      itens: ItemDoMes[];
      trabalhos: Map<string, Trabalho>;
      publicacoes: Map<string, PublicacaoDoPost>;
      /** Itens com roteiro do estrategista (proposta gravada): a direção sai do roteiro, sem custo. */
      roteiros: Set<string>;
    }> => {
      const { data: projetos, error: erroProjetos } = await (supabase as any)
        .from("projects")
        .select("id")
        .eq("client_id", clientId)
        .is("deleted_at", null);
      if (erroProjetos) throw erroProjetos;
      const ids = ((projetos || []) as { id: string }[]).map((p) => p.id);
      let itens: ItemDoMes[] = [];
      const janela = janelaDaLista(mes);
      if (ids.length) {
        const { data, error } = await (supabase as any)
          .from("tasks")
          .select("id, title, due_date, delivery_type, status, project_id")
          .in("project_id", ids)
          .in("delivery_type", FORMATOS_DE_ARTE)
          .is("deleted_at", null)
          .gte("due_date", janela.inicio)
          .lt("due_date", janela.fimExclusivo)
          .order("due_date", { ascending: true });
        if (error) throw error;
        itens = data || [];
      }
      if (tarefaExtra && !itens.some((i) => i.id === tarefaExtra)) {
        const { data } = await (supabase as any)
          .from("tasks")
          .select("id, title, due_date, delivery_type, status, project_id")
          .eq("id", tarefaExtra)
          .is("deleted_at", null)
          .maybeSingle();
        if (data && ids.indexOf(data.project_id) >= 0) itens = [data as ItemDoMes].concat(itens);
      }
      const trabalhos = new Map<string, Trabalho>();
      if (itens.length) {
        const { data, error } = await (supabase as any)
          .from("estudio_trabalhos")
          .select("*")
          .eq("client_id", clientId)
          .in("task_id", itens.map((i) => i.id))
          .order("criado_em", { ascending: false });
        if (error) throw error;
        for (const t of (data || []) as Trabalho[]) {
          if (t.task_id && !trabalhos.has(t.task_id)) trabalhos.set(t.task_id, t);
        }
      }
      // Estado da publicação na Agenda (agendado, publicado, falhou) dos
      // posts que nasceram das artes aprovadas.
      const publicacoes = new Map<string, PublicacaoDoPost>();
      const postIds = Array.from(trabalhos.values()).map((t) => t.post_id).filter((id): id is string => !!id);
      if (postIds.length) {
        const { data } = await (supabase as any)
          .from("editorial_publications")
          .select("post_id, status, scheduled_at, delivery_mode, published_at, permalink")
          .in("post_id", postIds)
          .neq("status", "cancelled")
          .order("scheduled_at", { ascending: true });
        for (const p of (data || []) as PublicacaoDoPost[]) {
          if (!publicacoes.has(p.post_id)) publicacoes.set(p.post_id, p);
        }
      }
      const roteiros = new Set<string>();
      if (itens.length) {
        const { data } = await (supabase as any)
          .from("calendario_propostas")
          .select("task_ids")
          .eq("client_id", clientId)
          .eq("status", "gravada")
          .overlaps("task_ids", itens.map((i) => i.id));
        for (const p of (data || []) as { task_ids: string[] | null }[]) {
          for (const id of p.task_ids || []) roteiros.add(id);
        }
      }
      return { itens, trabalhos, publicacoes, roteiros };
    },
  });
}

/** Versão mais recente de cada card, na ordem. */
export function ultimasVersoes(cards: CardGerado[] = []): Map<number, CardGerado> {
  const m = new Map<number, CardGerado>();
  for (const c of cards) {
    const atual = m.get(c.ordem);
    if (!atual || c.versao > atual.versao) m.set(c.ordem, c);
  }
  return m;
}
