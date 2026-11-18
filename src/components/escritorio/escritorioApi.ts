/**
 * Escritório dos agentes (18/11/2026): leituras e escritas da tela.
 * A equipe lê tudo; quem escreve é o dono (admin), pelos RPCs do banco ou,
 * nas salas e no dono da automação, direto na tabela (a política deixa).
 * Contrato: supabase/migrations/20261118200000_escritorio_dos_agentes.sql.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  AgenteDoEscritorio,
  Automacao,
  Bloqueio,
  ChaveMcp,
  Conversa,
  Leitura,
  MembroDaSala,
  Mensagem,
  PapelNaSala,
  Presenca,
  Sala,
  VinculoDeCredencial,
} from "@/lib/escritorio/tipos";
import { DONO } from "@/lib/escritorio/tipos";

// As tabelas do Escritório ainda não estão nos tipos gerados do Supabase.
const banco = supabase as any;

export const CHAVES = {
  agentes: ["escritorio", "agentes"],
  presenca: ["escritorio", "presenca"],
  salas: ["escritorio", "salas"],
  conversas: ["escritorio", "conversas"],
  conversa: (id: string | null) => ["escritorio", "conversa", id],
  automacoes: ["escritorio", "automacoes"],
  acessos: ["escritorio", "acessos"],
} as const;

const COLUNAS_DA_MENSAGEM = "id, conversa_id, de_slug, de_tipo, para_slug, grupo_id, corpo, responde_a, created_at";
/** As leituras do dono vêm embutidas em cada mensagem (o filtro `leituras.leitor_slug` corta só o que vem embutido). */
const COM_LEITURAS_DO_DONO = `${COLUNAS_DA_MENSAGEM}, leituras:escritorio_leituras(leitor_slug)`;

/** A mensagem vem com as leituras do dono embutidas; aqui elas viram a lista que as contas esperam. */
function separarLeituras(linhas: any[]): { mensagens: Mensagem[]; leituras: Leitura[] } {
  const mensagens: Mensagem[] = [];
  const leituras: Leitura[] = [];
  for (const linha of linhas) {
    const { leituras: lidas, ...mensagem } = linha;
    mensagens.push(mensagem as Mensagem);
    for (const l of Array.isArray(lidas) ? lidas : []) leituras.push({ mensagem_id: mensagem.id, leitor_slug: l.leitor_slug });
  }
  return { mensagens, leituras };
}

export function useAgentes() {
  return useQuery({
    queryKey: CHAVES.agentes,
    queryFn: async (): Promise<AgenteDoEscritorio[]> => {
      const { data, error } = await banco
        .from("internal_operators")
        .select("id, slug, display_name, role, status, scope, is_coordinator, last_run_at, area, parent_slug, origem, display_order, grau, hermes_profile_ref")
        .order("display_order", { ascending: true })
        .order("display_name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []) as AgenteDoEscritorio[];
    },
  });
}

export function usePresenca() {
  return useQuery({
    queryKey: CHAVES.presenca,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Presenca[]> => {
      const { data, error } = await banco.from("escritorio_presenca").select("operator_slug, batimento_em, fazendo, plataforma");
      if (error) throw new Error(error.message);
      return (data || []) as Presenca[];
    },
  });
}

export function useSalas() {
  return useQuery({
    queryKey: CHAVES.salas,
    queryFn: async (): Promise<{ salas: Sala[]; membros: MembroDaSala[] }> => {
      const [salas, membros] = await Promise.all([
        banco.from("escritorio_grupos").select("id, slug, nome, area, descricao, ativo").order("nome", { ascending: true }),
        banco.from("escritorio_grupo_membros").select("grupo_id, operator_slug, papel").order("created_at", { ascending: true }),
      ]);
      if (salas.error) throw new Error(salas.error.message);
      if (membros.error) throw new Error(membros.error.message);
      return { salas: (salas.data || []) as Sala[], membros: (membros.data || []) as MembroDaSala[] };
    },
  });
}

/** As 100 conversas mais recentes e os últimos 400 recados delas (para o último recado e as não lidas). */
export function useConversas() {
  return useQuery({
    queryKey: CHAVES.conversas,
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ conversas: Conversa[]; mensagens: Mensagem[]; leituras: Leitura[] }> => {
      const [conversas, mensagens] = await Promise.all([
        banco.from("escritorio_conversas").select("id, tipo, grupo_id, assunto, client_id, task_id, criada_por, created_at, ultima_em").order("ultima_em", { ascending: false }).limit(100),
        banco.from("escritorio_mensagens").select(COM_LEITURAS_DO_DONO).eq("leituras.leitor_slug", DONO).order("created_at", { ascending: false }).limit(400),
      ]);
      if (conversas.error) throw new Error(conversas.error.message);
      if (mensagens.error) throw new Error(mensagens.error.message);
      return { conversas: (conversas.data || []) as Conversa[], ...separarLeituras(mensagens.data || []) };
    },
  });
}

/** A conversa aberta: os últimos 300 recados, do mais antigo ao mais novo. */
export function useConversa(id: string | null) {
  return useQuery({
    queryKey: CHAVES.conversa(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<Mensagem[]> => {
      const { data, error } = await banco.from("escritorio_mensagens").select(COLUNAS_DA_MENSAGEM).eq("conversa_id", id).order("created_at", { ascending: false }).limit(300);
      if (error) throw new Error(error.message);
      return ((data || []) as Mensagem[]).reverse();
    },
  });
}

export function useAutomacoes() {
  return useQuery({
    queryKey: CHAVES.automacoes,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Automacao[]> => {
      const { data, error } = await banco
        .from("escritorio_automacoes")
        .select("id, plataforma, ref, nome, o_que_faz, dono_slug, ativo, ultima_execucao_em, ultimo_status, ultimo_erro, ultimo_erro_em, execucoes, erros, atualizado_em")
        .order("nome", { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []) as Automacao[];
    },
  });
}

/**
 * Bloqueios, vínculos de credencial e as chaves (só nome e prévia; o segredo
 * nunca sai do banco). Quem não é admin pode não enxergar as chaves: a tela
 * mostra o vínculo mesmo assim.
 */
export function useAcessos() {
  return useQuery({
    queryKey: CHAVES.acessos,
    queryFn: async (): Promise<{ bloqueios: Bloqueio[]; vinculos: VinculoDeCredencial[]; chaves: ChaveMcp[] }> => {
      const [bloqueios, vinculos, chaves] = await Promise.all([
        banco.from("escritorio_bloqueios").select("operator_slug, motivo, bloqueado_em, desfeito_em").is("desfeito_em", null),
        banco.from("operator_key_bindings").select("principal, operator_slug, padrao, rotulo"),
        banco.from("api_keys").select("id, name, key_preview, audience, is_active"),
      ]);
      if (bloqueios.error) throw new Error(bloqueios.error.message);
      if (vinculos.error) throw new Error(vinculos.error.message);
      return {
        bloqueios: (bloqueios.data || []) as Bloqueio[],
        vinculos: (vinculos.data || []) as VinculoDeCredencial[],
        chaves: chaves.error ? [] : ((chaves.data || []) as ChaveMcp[]),
      };
    },
  });
}

/** Mensagem nova e batimento chegam ao vivo: a tela relê sem ninguém apertar nada. */
export function useEscritorioAoVivo() {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof banco.channel !== "function") return;
    let canal: any = null;
    try {
      canal = banco
        .channel(`escritorio:${Date.now().toString(36)}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "escritorio_mensagens" }, () => {
          void qc.invalidateQueries({ queryKey: CHAVES.conversas });
          void qc.invalidateQueries({ queryKey: ["escritorio", "conversa"] });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "escritorio_presenca" }, () => {
          void qc.invalidateQueries({ queryKey: CHAVES.presenca });
        })
        .subscribe();
    } catch {
      canal = null;
    }
    return () => {
      try {
        if (canal) banco.removeChannel(canal);
      } catch {
        /* canal já fechado */
      }
    };
  }, [qc]);
}

/** O relógio da tela: "agora" e "há 12 min" andam sem esperar a próxima leitura. */
export function useAgora() {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

// ------------------------------------------------------------------ escritas (só o dono)

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await banco.rpc(nome, args);
  if (error) throw error;
  return data as T;
}

/** O dono escreve para um agente (`para`), para uma sala (`grupo`) ou numa conversa que já existe. */
export function donoEnviar(p: { corpo: string; para?: string | null; grupo?: string | null; conversaId?: string | null; assunto?: string | null }) {
  return rpc<{ ok: boolean; mensagem_id: string; conversa_id: string }>("escritorio_dono_enviar", {
    _corpo: p.corpo,
    _para: p.para ?? null,
    _grupo: p.grupo ?? null,
    _conversa_id: p.conversaId ?? null,
    _assunto: p.assunto ?? null,
    _client_id: null,
    _task_id: null,
  });
}

export const donoMarcarLidas = (conversaId: string) => rpc<number>("escritorio_dono_marcar_lidas", { _conversa_id: conversaId });

export const bloquearAgente = (slug: string, motivo: string | null) =>
  rpc<{ ok: boolean; chaves_desligadas: number; vinculos_retirados: number }>("escritorio_bloquear_agente", { _slug: slug, _motivo: motivo });

export const desbloquearAgente = (slug: string) =>
  rpc<{ ok: boolean; vinculos_devolvidos: number; chaves_que_nao_voltam: number }>("escritorio_desbloquear_agente", { _slug: slug });

export const ligarCredencial = (keyId: string, slug: string, padrao: boolean) =>
  rpc<{ ok: boolean }>("escritorio_ligar_credencial", { _key_id: keyId, _slug: slug, _padrao: padrao });

/** O grau vai pelo mesmo caminho da janela de editar agente: direto em internal_operators (o banco só deixa o admin). */
export async function mudarGrau(id: string, grau: string) {
  const { error } = await banco.from("internal_operators").update({ grau }).eq("id", id);
  if (error) throw error;
}

export async function entrarNaSala(grupoId: string, slug: string) {
  const { error } = await banco.from("escritorio_grupo_membros").insert({ grupo_id: grupoId, operator_slug: slug, papel: "membro" });
  if (error) throw error;
}

export async function sairDaSala(grupoId: string, slug: string) {
  const { error } = await banco.from("escritorio_grupo_membros").delete().eq("grupo_id", grupoId).eq("operator_slug", slug);
  if (error) throw error;
}

export async function mudarPapelNaSala(grupoId: string, slug: string, papel: PapelNaSala) {
  const { error } = await banco.from("escritorio_grupo_membros").update({ papel }).eq("grupo_id", grupoId).eq("operator_slug", slug);
  if (error) throw error;
}

export async function mudarDonoDaAutomacao(id: string, donoSlug: string | null) {
  const { error } = await banco.from("escritorio_automacoes").update({ dono_slug: donoSlug }).eq("id", id);
  if (error) throw error;
}
