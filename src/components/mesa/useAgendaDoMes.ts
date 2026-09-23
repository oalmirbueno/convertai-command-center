import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { somarMeses } from "@/lib/mesa/api";
import type { EntregaStatus } from "./useItensDoMes";

/**
 * Agenda do mês na aba Mês: o mesmo calendário da Agenda do painel para o
 * cliente aberto. Junta os itens da agenda (tarefas dos projetos do cliente),
 * os posts agendados ou publicados no mês, o roteiro gravado de cada item e o
 * trabalho mais recente do estúdio de cada um. Só leitura, pela RLS da equipe.
 */

/** Formatos que o estúdio de arte produz (igual ao agente do calendário). */
export const FORMATOS_DO_ESTUDIO = ["carousel", "static", "design"];

export const ehFormatoDeArte = (tipo?: string | null) => FORMATOS_DO_ESTUDIO.indexOf(String(tipo || "")) >= 0;

export interface ItemDaAgenda {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  delivery_type: string;
  status: string;
  project_id: string;
}

export interface CardDoRoteiroDaAgenda {
  ordem: number;
  funcao?: string;
  texto?: string;
  ilustracao?: string;
  estilo?: string;
}

/** Item do roteiro gravado (calendario_propostas.itens[] com task_id igual). */
export interface RoteiroDoItem {
  propostaId: string;
  gancho?: string;
  copy?: string;
  legenda?: string;
  resumo?: string;
  tema?: string;
  cta?: string;
  cards: CardDoRoteiroDaAgenda[];
  /** Falso quando a proposta cita o item mas não guardou o roteiro dele. */
  detalhado: boolean;
}

export interface TrabalhoDaAgenda {
  id: string;
  task_id: string;
  status: "rascunho" | "dirigido" | "gerando" | "pronto" | "entregue" | "erro";
  cards: unknown[];
  direcao: { cards?: unknown[] } | null;
  entrega_status: EntregaStatus | null;
  atualizado_em: string;
}

export interface PostDaAgenda {
  post_id: string;
  titulo: string;
  content_type: string | null;
  status: string;
  scheduled_at: string;
  /** Dia local (AAAA-MM-DD) em que o post sai. */
  dia: string;
  task_id: string | null;
}

export interface AgendaDoMes {
  itens: ItemDaAgenda[];
  posts: PostDaAgenda[];
  roteiros: Map<string, RoteiroDoItem>;
  trabalhos: Map<string, TrabalhoDaAgenda>;
}

/** Dia local de uma data ISO, em AAAA-MM-DD. */
export function diaLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Início do mês no fuso do navegador, em ISO (para filtrar timestamptz). */
function inicioLocalIso(mes: string): string {
  const partes = mes.split("-").map(Number);
  return new Date(partes[0], (partes[1] || 1) - 1, 1).toISOString();
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

export function useAgendaDoMes(clientId: string, mes: string) {
  return useQuery({
    queryKey: ["mesa", "agenda-do-mes", clientId, mes],
    enabled: !!clientId,
    queryFn: async (): Promise<AgendaDoMes> => {
      const proximo = somarMeses(mes, 1);

      // 1. Itens da agenda: tarefas dos projetos do cliente com data no mês.
      const { data: projetos, error: erroProjetos } = await (supabase as any)
        .from("projects")
        .select("id")
        .eq("client_id", clientId)
        .is("deleted_at", null);
      if (erroProjetos) throw erroProjetos;
      const idsProjetos = ((projetos || []) as { id: string }[]).map((p) => p.id);
      let itens: ItemDaAgenda[] = [];
      if (idsProjetos.length) {
        const { data, error } = await (supabase as any)
          .from("tasks")
          .select("id, title, description, due_date, delivery_type, status, project_id")
          .in("project_id", idsProjetos)
          .is("deleted_at", null)
          .gte("due_date", mes)
          .lt("due_date", proximo)
          .order("due_date", { ascending: true });
        if (error) throw error;
        itens = (data || []) as ItemDaAgenda[];
      }
      const idsItens = itens.map((i) => i.id);

      // 2. Posts agendados ou publicados no mês (uma pílula por post).
      const { data: publicacoes, error: erroPub } = await (supabase as any)
        .from("editorial_publications")
        .select("post_id, scheduled_at, status")
        .eq("client_id", clientId)
        .neq("status", "cancelled")
        .gte("scheduled_at", inicioLocalIso(mes))
        .lt("scheduled_at", inicioLocalIso(proximo))
        .order("scheduled_at", { ascending: true });
      if (erroPub) throw erroPub;
      const primeiraPorPost = new Map<string, { post_id: string; scheduled_at: string; status: string }>();
      for (const p of (publicacoes || []) as { post_id: string; scheduled_at: string | null; status: string }[]) {
        if (!p.scheduled_at || primeiraPorPost.has(p.post_id)) continue;
        primeiraPorPost.set(p.post_id, { post_id: p.post_id, scheduled_at: p.scheduled_at, status: p.status });
      }
      const idsPosts = Array.from(primeiraPorPost.keys());
      const titulos = new Map<string, { title: string; content_type: string | null }>();
      const tarefaDoPost = new Map<string, string>();
      if (idsPosts.length) {
        const [postsRes, internosRes] = await Promise.all([
          (supabase as any).from("editorial_posts").select("id, title, content_type").in("id", idsPosts),
          (supabase as any).from("editorial_post_internal").select("post_id, task_id").in("post_id", idsPosts),
        ]);
        if (postsRes.error) throw postsRes.error;
        for (const p of (postsRes.data || []) as { id: string; title: string; content_type: string | null }[]) {
          titulos.set(p.id, { title: p.title, content_type: p.content_type });
        }
        // A ligação com o item é um extra: sem ela o post aparece do mesmo jeito.
        for (const r of (internosRes.data || []) as { post_id: string; task_id: string | null }[]) {
          if (r.task_id) tarefaDoPost.set(r.post_id, r.task_id);
        }
      }
      const posts: PostDaAgenda[] = idsPosts.map((id) => {
        const p = primeiraPorPost.get(id)!;
        const t = titulos.get(id);
        return {
          post_id: id,
          titulo: t ? t.title : "Post sem título",
          content_type: t ? t.content_type : null,
          status: p.status,
          scheduled_at: p.scheduled_at,
          dia: diaLocal(p.scheduled_at),
          task_id: tarefaDoPost.get(id) || null,
        };
      });

      // 3. Roteiro gravado: proposta gravada cujo task_ids contém o item.
      const roteiros = new Map<string, RoteiroDoItem>();
      if (idsItens.length) {
        const { data, error } = await (supabase as any)
          .from("calendario_propostas")
          .select("id, task_ids, itens, criado_em")
          .eq("client_id", clientId)
          .eq("status", "gravada")
          .overlaps("task_ids", idsItens)
          .order("criado_em", { ascending: false });
        if (error) throw error;
        const doMes = new Set(idsItens);
        // Da mais recente para a mais antiga: vale o roteiro mais novo de cada item.
        for (const p of (data || []) as { id: string; task_ids: string[] | null; itens: any[] | null }[]) {
          const itensDaProposta = Array.isArray(p.itens) ? p.itens : [];
          for (const taskId of p.task_ids || []) {
            if (!doMes.has(taskId)) continue;
            const atual = roteiros.get(taskId);
            if (atual && atual.detalhado) continue;
            const it = itensDaProposta.find((x) => x && x.task_id === taskId);
            if (!it) {
              if (!atual) roteiros.set(taskId, { propostaId: p.id, cards: [], detalhado: false });
              continue;
            }
            const cards = (Array.isArray(it.cards) ? it.cards : [])
              .filter((c: any) => c && typeof c === "object")
              .map((c: any) => ({
                ordem: Number(c.ordem) || 0,
                funcao: texto(c.funcao),
                texto: texto(c.texto),
                ilustracao: texto(c.ilustracao),
                estilo: texto(c.estilo),
              }))
              .sort((a: CardDoRoteiroDaAgenda, b: CardDoRoteiroDaAgenda) => a.ordem - b.ordem);
            roteiros.set(taskId, {
              propostaId: p.id,
              gancho: texto(it.gancho),
              copy: texto(it.copy),
              legenda: texto(it.legenda),
              resumo: texto(it.resumo),
              tema: texto(it.tema),
              cta: texto(it.cta),
              cards,
              detalhado: true,
            });
          }
        }
      }

      // 4. Trabalho mais recente do estúdio de cada item.
      const trabalhos = new Map<string, TrabalhoDaAgenda>();
      if (idsItens.length) {
        const { data, error } = await (supabase as any)
          .from("estudio_trabalhos")
          .select("id, task_id, status, cards, direcao, entrega_status, atualizado_em")
          .eq("client_id", clientId)
          .in("task_id", idsItens)
          .order("atualizado_em", { ascending: false });
        if (error) throw error;
        for (const t of (data || []) as TrabalhoDaAgenda[]) {
          if (t.task_id && !trabalhos.has(t.task_id)) trabalhos.set(t.task_id, t);
        }
      }

      return { itens, posts, roteiros, trabalhos };
    },
  });
}

// ------------------------------------------------------------------ selo

export type TomDoSelo = "neutro" | "roteiro" | "direcao" | "producao" | "pronto" | "entregue" | "alerta";

export interface Selo {
  rotulo: string;
  tom: TomDoSelo;
}

const ROTULO_DA_ENTREGA: Record<string, Selo> = {
  aguardando_agencia: { rotulo: "revisão da agência", tom: "entregue" },
  aguardando_cliente: { rotulo: "aguardando cliente", tom: "entregue" },
  aprovado: { rotulo: "aprovado", tom: "entregue" },
  agendado: { rotulo: "agendado", tom: "entregue" },
  reprovado: { rotulo: "reprovado", tom: "alerta" },
  precisa_de_atencao: { rotulo: "precisa de atenção", tom: "alerta" },
};

/** Estado do item para o selo: do roteiro até a entrega. */
export function seloDoItem(item: ItemDaAgenda, roteiro: RoteiroDoItem | undefined, trabalho: TrabalhoDaAgenda | undefined): Selo {
  if (!ehFormatoDeArte(item.delivery_type)) {
    return roteiro ? { rotulo: "roteiro pronto", tom: "roteiro" } : { rotulo: "fora do estúdio", tom: "neutro" };
  }
  if (trabalho) {
    if (trabalho.entrega_status && Object.prototype.hasOwnProperty.call(ROTULO_DA_ENTREGA, trabalho.entrega_status)) {
      return ROTULO_DA_ENTREGA[trabalho.entrega_status];
    }
    const gerados = Array.isArray(trabalho.cards) ? trabalho.cards.length : 0;
    switch (trabalho.status) {
      case "entregue":
        return { rotulo: "entregue", tom: "entregue" };
      case "pronto":
        return { rotulo: "arte pronta", tom: "pronto" };
      case "gerando":
        return { rotulo: "arte em produção", tom: "producao" };
      case "dirigido":
        return gerados > 0 ? { rotulo: "arte em produção", tom: "producao" } : { rotulo: "direção pronta", tom: "direcao" };
      case "erro":
        return { rotulo: "com erro no estúdio", tom: "alerta" };
      default:
        break;
    }
  }
  return roteiro ? { rotulo: "roteiro pronto", tom: "roteiro" } : { rotulo: "sem roteiro", tom: "neutro" };
}

export const CLASSE_DO_TOM: Record<TomDoSelo, string> = {
  neutro: "bg-secondary text-muted-foreground",
  roteiro: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  direcao: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  producao: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  pronto: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  entregue: "bg-success/15 text-foreground",
  alerta: "bg-destructive/10 text-destructive",
};

const ROTULO_DA_PUBLICACAO: Record<string, string> = {
  scheduled: "agendado",
  published: "publicado",
  partially_published: "publicado em parte",
  publishing: "publicando",
  failed: "falhou",
  draft: "rascunho",
};

export const rotuloDaPublicacao = (status: string) =>
  Object.prototype.hasOwnProperty.call(ROTULO_DA_PUBLICACAO, status) ? ROTULO_DA_PUBLICACAO[status] : status;
