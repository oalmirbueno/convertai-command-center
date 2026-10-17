import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pedidos de acesso dos agentes (17/10/2026, pedido do dono): quando o
 * Paperclip, o Hermes ou outro agente esbarra num login, ele abre um pedido
 * (senha, código, conectar ou outro) com o print da tela. O painel mostra os
 * abertos em "Precisa de você" e responde pelas RPCs do banco; o agente lê a
 * resposta pelo MCP.
 *
 * Segurança: a coluna `codigo` não é legível pelo front, por isso a consulta
 * nomeia as colunas (nunca `*`). A senha nunca passa por aqui fora da chamada
 * da RPC: nada de cache, estado global ou console.
 *
 * Os tipos gerados do Supabase ainda não têm a tabela nem as RPCs: os nomes
 * vão como `any` e os tipos ficam aqui.
 */

export type TipoDoPedido = "senha" | "codigo" | "conectar" | "outro";
export type StatusDoPedido = "aberto" | "respondido" | "usado" | "cancelado" | "expirado";

export interface PedidoDeAcesso {
  id: string;
  created_at: string;
  operador_slug: string | null;
  client_id: string | null;
  kanban_task_id: string | null;
  tipo: TipoDoPedido;
  site: string | null;
  url: string | null;
  conta: string | null;
  mensagem: string | null;
  link_para_conectar: string | null;
  print_path: string | null;
  status: StatusDoPedido;
  vault_item_id: string | null;
  expira_em: string | null;
  respondido_por: string | null;
  respondido_em: string | null;
  usado_em: string | null;
}

/** Colunas lidas (sem `codigo`, que o front não pode ler). */
export const COLUNAS_DO_PEDIDO =
  "id, created_at, operador_slug, client_id, kanban_task_id, tipo, site, url, conta, mensagem, link_para_conectar, print_path, status, vault_item_id, expira_em, respondido_por, respondido_em, usado_em";

export const CHAVE_DOS_PEDIDOS = ["pedidos-de-acesso", "abertos"] as const;
export const BUCKET_DOS_PRINTS = "pedidos-de-acesso";

const db = supabase as any;

/** Aberto e ainda dentro do prazo (sem prazo = vale até alguém responder). */
export function pedidoEmAberto(p: Pick<PedidoDeAcesso, "status" | "expira_em">, agora = Date.now()): boolean {
  if (p.status !== "aberto") return false;
  if (!p.expira_em) return true;
  const fim = Date.parse(p.expira_em);
  return !Number.isFinite(fim) || fim > agora;
}

async function lerAbertos(): Promise<PedidoDeAcesso[]> {
  const { data, error } = await db
    .from("pedidos_de_acesso")
    .select(COLUNAS_DO_PEDIDO)
    .eq("status", "aberto")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data || []) as PedidoDeAcesso[]).filter((p) => pedidoEmAberto(p));
}

export async function lerPedido(id: string): Promise<PedidoDeAcesso | null> {
  const { data, error } = await db.from("pedidos_de_acesso").select(COLUNAS_DO_PEDIDO).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as PedidoDeAcesso | null) || null;
}

/** Nome de cada agente pelo slug (internal_operators.display_name), como a Execução mostra. */
export function useNomesDosAgentes(habilitado = true) {
  return useQuery({
    queryKey: ["pedidos-de-acesso", "nomes-dos-agentes"],
    enabled: habilitado,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("internal_operators").select("slug, display_name");
      if (error) throw error;
      const nomes: Record<string, string> = {};
      ((data || []) as Array<{ slug: string; display_name: string | null }>).forEach((o) => {
        if (o.slug) nomes[o.slug] = o.display_name || o.slug;
      });
      return nomes;
    },
  });
}

/** "Hermes" a partir do slug; sem nome conhecido, o slug com a primeira letra maiúscula. */
export function nomeDoAgente(slug: string | null | undefined, nomes?: Record<string, string>): string {
  if (!slug) return "agente";
  if (nomes && nomes[slug]) return nomes[slug];
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Escuta a tabela (INSERT/UPDATE) e relê a lista: um canal por tela que usa o hook. */
function usePedidosAoVivo(habilitado: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!habilitado) return;
    let canal: ReturnType<typeof supabase.channel> | null = null;
    let espera: ReturnType<typeof setTimeout> | null = null;
    const reler = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => {
        espera = null;
        void qc.invalidateQueries({ queryKey: ["pedidos-de-acesso"] });
      }, 300);
    };
    try {
      canal = supabase
        .channel(`pedidos-de-acesso:${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "pedidos_de_acesso" }, reler)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos_de_acesso" }, reler)
        .subscribe();
    } catch {
      canal = null;
    }
    return () => {
      if (espera) clearTimeout(espera);
      if (canal) {
        try {
          void supabase.removeChannel(canal);
        } catch {
          /* canal já fechado */
        }
      }
    };
  }, [habilitado, qc]);
}

/** Pedidos abertos (não expirados), ao vivo. */
export function usePedidosDeAcesso(habilitado = true) {
  usePedidosAoVivo(habilitado);
  return useQuery({
    queryKey: CHAVE_DOS_PEDIDOS,
    enabled: habilitado,
    queryFn: lerAbertos,
    // Rede de segurança caso o canal caia; o prazo também vence sozinho.
    refetchInterval: 60_000,
  });
}

/** Um pedido pelo id (a janela aberta por ?acesso=). */
export function usePedidoDeAcesso(id: string | null) {
  return useQuery({
    queryKey: ["pedidos-de-acesso", "um", id],
    enabled: !!id,
    queryFn: () => lerPedido(id as string),
  });
}

/** Endereço assinado do print (bucket privado), válido por 10 minutos. */
export function usePrintDoPedido(caminho: string | null | undefined) {
  return useQuery({
    queryKey: ["pedidos-de-acesso", "print", caminho],
    enabled: !!caminho,
    staleTime: 8 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET_DOS_PRINTS).createSignedUrl(caminho as string, 600);
      if (error) throw error;
      return data?.signedUrl || null;
    },
  });
}

async function chamar<T>(rpc: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(rpc, args);
  if (error) throw error;
  return data as T;
}

export interface RespostaDeSenha {
  pedido: string;
  clientId: string;
  titulo: string;
  usuario: string;
  senha: string;
  lembrar: boolean;
}

/** Responde com e-mail/usuário e senha; com `lembrar`, o item fica no cofre e o agente pode usar sempre. Devolve o id do item do cofre. */
export function responderComSenha(r: RespostaDeSenha): Promise<string | null> {
  return chamar<string | null>("pedido_acesso_responder_senha", {
    p_pedido: r.pedido,
    p_client_id: r.clientId,
    p_titulo: r.titulo,
    p_usuario: r.usuario,
    p_senha: r.senha,
    p_lembrar: r.lembrar,
  });
}

export function responderComCodigo(pedido: string, codigo: string): Promise<unknown> {
  return chamar("pedido_acesso_responder_codigo", { p_pedido: pedido, p_codigo: codigo });
}

export function marcarPedidoFeito(pedido: string): Promise<unknown> {
  return chamar("pedido_acesso_marcar_feito", { p_pedido: pedido });
}

export function cancelarPedido(pedido: string): Promise<unknown> {
  return chamar("pedido_acesso_cancelar", { p_pedido: pedido });
}

export function agentesPodemUsar(item: string, pode: boolean): Promise<unknown> {
  return chamar("cofre_agentes_podem_usar", { p_item: item, p_pode: pode });
}
