import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { gravarEstadoDaTela, lerEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { chamarMesaVideos, novoIdDoArquivo, tabelaAusente } from "@/components/mesa-videos/videosApi";
import {
  catalogoEmUso,
  custoDoMotor,
  type CustoDoMotor,
  type EstadoDoMotor,
  type LinhaDoCatalogoDeVideo,
  type MotorDeVideo,
  MOTORES_DE_VIDEO,
  type NivelDoMotor,
  nivelDoMotor,
} from "../../../supabase/functions/_shared/modelos-de-video";
import { normalizarProjetoDoDiretor, projetoVazio, type ProjetoDoDiretor, type TemplateDeVideo } from "../../../supabase/functions/_shared/diretor-de-video";
import type { AvatarDaHeygen, VozDaHeygen } from "../../../supabase/functions/_shared/video-provedor-heygen";

/**
 * Leituras e estado do gerador da Mesa Vídeos (frente V-A, 26/09/2026).
 * - Motores: o catálogo em código mais o estado que só o servidor sabe
 *   (chave existe? motor desligado?). Sem a função publicada, a tela mostra o
 *   catálogo com "a conferir" e não deixa gerar.
 * - Projeto do diretor (bíblia e roteiro): um só por cliente, guardado no
 *   navegador (sair e voltar mantém) e no banco quando o SQL V-01 existir.
 *   Etapas e o painel do diretor leem o MESMO projeto (loja única).
 * Nada aqui gasta: gerar sempre passa pela confirmação do custo na tela.
 */

export interface MotorNaTela {
  motor: MotorDeVideo;
  estado: EstadoDoMotor | "a_conferir";
  estado_rotulo: string;
  nivel: NivelDoMotor;
  novo: boolean;
  chave: string | null;
}

interface RespostaDosMotores {
  motores: { id: string; estado: EstadoDoMotor; estado_rotulo: string; nivel: NivelDoMotor; novo: boolean; chave: string | null }[];
}

export const chaveDosMotores = ["mesa-videos", "motores"];

/** Catálogo com o estado do servidor. Lê uma vez (10 min) e nunca repete sozinho. */
export function useMotoresDaMesa() {
  const q = useQuery({
    queryKey: chaveDosMotores,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: () => chamarMesaVideos<RespostaDosMotores>({ acao: "motores_estado" }),
  });
  const banco = useQuery({
    queryKey: ["mesa-videos", "motores-banco"],
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<LinhaDoCatalogoDeVideo[]> => {
      const { data, error } = await (supabase as any).from("video_motores").select("id, linha, versao, rotulo, endpoints, preco, novo, disponivel, ativo").limit(500);
      if (error) {
        if (tabelaAusente(error)) return [];
        throw error;
      }
      return (data || []) as LinhaDoCatalogoDeVideo[];
    },
  });
  const catalogo = catalogoEmUso(banco.data || []);
  const doServidor = (q.data && q.data.motores) || [];
  const lista: MotorNaTela[] = catalogo.motores.map((m) => {
    const s = doServidor.find((x) => x.id === m.id);
    return {
      motor: m,
      estado: s ? s.estado : m.situacao || "a_conferir",
      estado_rotulo: s ? s.estado_rotulo : m.situacao === "encerrado" ? "Encerrado" : m.situacao === "a_integrar" ? "A integrar" : "A conferir",
      nivel: s ? s.nivel : nivelDoMotor(m, catalogo.motores),
      novo: s ? s.novo : !!m.novo,
      chave: s ? s.chave : null,
    };
  });
  return { lista, motores: catalogo.motores, carregando: q.isLoading, semFuncao: q.isError, recarregar: () => void q.refetch() };
}

export const motoresProntos = (lista: MotorNaTela[]) => lista.filter((x) => x.estado === "pronto").map((x) => x.motor.id);

export function custoNaTela(m: MotorDeVideo | null, e: { duracao_s?: number; resolucao?: string | null; audio?: boolean; variacoes?: number; referencias?: number }): CustoDoMotor {
  if (!m) return { usd: null, detalhe: "escolha o motor", incerto: true };
  return custoDoMotor(m, e);
}

/** Id de um clique de gerar (o servidor não gera duas vezes com o mesmo). */
export const novoUid = () => novoIdDoArquivo();

// ------------------------------------------------------------------ projeto do diretor (loja única por cliente)

const chaveDoProjeto = (clientId: string) => `mesa-videos:diretor:projeto:${clientId}`;
const memoria: Record<string, { atual: ProjetoDoDiretor; anterior: ProjetoDoDiretor | null }> = {};
const ouvintes: Record<string, Array<() => void>> = {};

function lerProjeto(clientId: string) {
  if (!memoria[clientId]) {
    const bruto = lerEstadoDaTela<unknown>(chaveDoProjeto(clientId), null, (v) => !!v && typeof v === "object", "/mesa-videos");
    memoria[clientId] = { atual: normalizarProjetoDoDiretor(bruto) || projetoVazio(), anterior: null };
  }
  return memoria[clientId];
}

function avisar(clientId: string) {
  (ouvintes[clientId] || []).slice().forEach((f) => f());
}

/** Troca o projeto (guardando o anterior para Desfazer). */
export function gravarProjetoDoDiretor(clientId: string, novo: ProjetoDoDiretor, guardarAnterior = true) {
  const m = lerProjeto(clientId);
  memoria[clientId] = { atual: novo, anterior: guardarAnterior ? m.atual : m.anterior };
  gravarEstadoDaTela(chaveDoProjeto(clientId), novo, "/mesa-videos");
  avisar(clientId);
}

export function desfazerProjetoDoDiretor(clientId: string): boolean {
  const m = lerProjeto(clientId);
  if (!m.anterior) return false;
  memoria[clientId] = { atual: m.anterior, anterior: null };
  gravarEstadoDaTela(chaveDoProjeto(clientId), m.anterior, "/mesa-videos");
  avisar(clientId);
  return true;
}

export function useProjetoDoDiretor(clientId: string): { projeto: ProjetoDoDiretor; podeDesfazer: boolean; mudar: (fn: (p: ProjetoDoDiretor) => ProjetoDoDiretor, guardarAnterior?: boolean) => void; trocar: (p: ProjetoDoDiretor) => void; desfazer: () => boolean } {
  const [, setVersao] = useState(0);
  useEffect(() => {
    const f = () => setVersao((v) => v + 1);
    ouvintes[clientId] = (ouvintes[clientId] || []).concat([f]);
    return () => {
      ouvintes[clientId] = (ouvintes[clientId] || []).filter((x) => x !== f);
    };
  }, [clientId]);
  const m = lerProjeto(clientId);
  return {
    projeto: m.atual,
    podeDesfazer: !!m.anterior,
    mudar: (fn, guardarAnterior = false) => gravarProjetoDoDiretor(clientId, fn(lerProjeto(clientId).atual), guardarAnterior),
    trocar: (p) => gravarProjetoDoDiretor(clientId, p, true),
    desfazer: () => desfazerProjetoDoDiretor(clientId),
  };
}

/** Só para os testes. */
export function __zerarProjetosDoDiretor() {
  Object.keys(memoria).forEach((k) => delete memoria[k]);
}

// ------------------------------------------------------------------ templates e projetos salvos

export function useTemplatesDeVideo(clientId: string) {
  return useQuery({
    queryKey: ["mesa-videos", "templates", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<{ itens: (TemplateDeVideo & { estado: string })[]; disponivel: boolean }> => {
      const { data, error } = await (supabase as any)
        .from("video_templates")
        .select("id, nome, client_id, kit_id, estrutura, estado")
        .or(`client_id.is.null,client_id.eq.${clientId}`)
        .eq("estado", "ativo")
        .order("atualizado_em", { ascending: false })
        .limit(100);
      if (error) {
        if (tabelaAusente(error)) return { itens: [], disponivel: false };
        throw error;
      }
      return { itens: (data || []) as (TemplateDeVideo & { estado: string })[], disponivel: true };
    },
  });
}

export function useProjetosSalvos(clientId: string) {
  return useQuery({
    queryKey: ["mesa-videos", "projetos-do-diretor", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<{ itens: ProjetoDoDiretor[]; disponivel: boolean }> => {
      const { data, error } = await (supabase as any)
        .from("video_diretor_projetos")
        .select("id, titulo, kit_id, template_id, fase, briefing, biblia, roteiro, versao, atualizado_em")
        .eq("client_id", clientId)
        .eq("estado", "ativo")
        .order("atualizado_em", { ascending: false })
        .limit(30);
      if (error) {
        if (tabelaAusente(error)) return { itens: [], disponivel: false };
        throw error;
      }
      return { itens: ((data || []) as unknown[]).map((x) => normalizarProjetoDoDiretor(x)).filter((x): x is ProjetoDoDiretor => !!x), disponivel: true };
    },
  });
}

// ------------------------------------------------------------------ HeyGen: avatares de estoque e vozes (frente V-C)

export type { AvatarDaHeygen, VozDaHeygen };

/**
 * Lista da HeyGen (grátis): avatares de estoque ou vozes em português. Lê uma
 * vez por hora e nunca repete sozinha; sem a chave, o erro traz o nome do
 * segredo que falta (motor_precisa_chave).
 */
export function useCatalogoDaHeygen<T extends "avatares" | "vozes">(tipo: T, ligado: boolean) {
  return useQuery({
    queryKey: ["mesa-videos", "heygen", tipo],
    enabled: ligado,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: () => chamarMesaVideos<{ itens: T extends "vozes" ? VozDaHeygen[] : AvatarDaHeygen[]; proximo: string | null }>({ acao: "heygen_catalogo", tipo }),
  });
}

/** Tipos de pedido do gerador (frente V-A). */
export const TIPOS_DO_GERADOR = ["gerar_livre", "gerar_plano", "angulo", "continuar_video", "transicao"];
export const ESTADOS_EM_ANDAMENTO = ["enviado", "gerando", "baixando", "parcial"];

export { MOTORES_DE_VIDEO };
