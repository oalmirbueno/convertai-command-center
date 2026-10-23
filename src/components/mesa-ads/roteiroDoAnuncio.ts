import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarRoteiros } from "@/components/mesa-roteiros/roteirosApi";
import { parteDaConferenciaDoJev, type ParteDaEstimativa } from "@/lib/mesa/api";
import { normalizarLinhaDoRoteiro, versaoPorNumero, type LinhaDoRoteiro, type Roteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import {
  BUSCAS_WEB_DO_ANUNCIO,
  TAMANHO_DO_ANUNCIO,
  type DuracaoDoAnuncio,
  type FormatoDoAnuncio,
  type IdDaEstrutura,
  type ModoDoAnuncio,
} from "../../../supabase/functions/mesa-roteiros/modulos/roteiro-de-anuncio";

/**
 * "Gravar nós mesmos" (Mesa Ads > Estúdio > Vídeo, 23/10/2026): a ponte com a
 * Mesa Roteiros. O roteiro nasce na função mesa-roteiros (anuncio_gerar), fica
 * na tabela roteiros ligado ao criativo (ads_criativo_id) e é lido aqui pela
 * RLS da equipe. Sem a coluna (migração pendente), a tela lê pelo id que
 * guardou ao gerar. Nada de geração de vídeo aqui: o Higgsfield segue igual.
 */

export interface OpcoesDaGravacao {
  modo: ModoDoAnuncio;
  formato: FormatoDoAnuncio;
  duracao: DuracaoDoAnuncio;
  estrutura: IdDaEstrutura | "auto";
  web: boolean;
  /** Id do roteiro gerado aqui (lembrado para reabrir mesmo sem o vínculo no banco). */
  roteiroId: string | null;
  /** O porquê da escolha do Jev e as referências da web da última geração. */
  porque: string | null;
  estruturaNome: string | null;
  referencias: Array<{ titulo: string; url: string }>;
}

export const OPCOES_PADRAO: OpcoesDaGravacao = { modo: "completo", formato: "9:16", duracao: 30, estrutura: "auto", web: true, roteiroId: null, porque: null, estruturaNome: null, referencias: [] };

export const chaveDoRoteiroDoCriativo = (clientId: string, criativoId: string, lembrado: string | null) => ["mesa-ads", "roteiro-do-criativo", clientId, criativoId, lembrado || ""] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O roteiro vivo do criativo: pelo vínculo no banco; sem ele, pelo id lembrado. */
export async function lerRoteiroDoCriativo(clientId: string, criativoId: string, lembrado: string | null): Promise<LinhaDoRoteiro | null> {
  const db = supabase as any;
  const { data, error } = await db.from("roteiros").select("*").eq("client_id", clientId).eq("ads_criativo_id", criativoId).is("arquivado_em", null).order("atualizado_em", { ascending: false }).limit(1);
  const pelaLigacao = !error ? normalizarLinhaDoRoteiro(((data || []) as unknown[])[0]) : null;
  if (pelaLigacao) return pelaLigacao;
  if (!lembrado || !UUID.test(lembrado)) return null;
  const r = await db.from("roteiros").select("*").eq("id", lembrado).eq("client_id", clientId).maybeSingle();
  if (r.error) throw r.error;
  const linha = normalizarLinhaDoRoteiro(r.data);
  return linha && !linha.arquivado_em ? linha : null;
}

export function useRoteiroDoCriativo(clientId: string, criativoId: string, lembrado: string | null) {
  return useQuery({
    queryKey: chaveDoRoteiroDoCriativo(clientId, criativoId, lembrado),
    enabled: !!clientId && !!criativoId,
    staleTime: 30_000,
    queryFn: () => lerRoteiroDoCriativo(clientId, criativoId, lembrado),
  });
}

/** O conteúdo da versão atual (o que a tela mostra e o PDF exporta). */
export function conteudoAtual(linha: LinhaDoRoteiro | null): { roteiro: Roteiro; versao: number } | null {
  if (!linha) return null;
  const v = versaoPorNumero(linha.versoes, linha.versao_atual);
  return v ? { roteiro: v.conteudo, versao: v.numero } : null;
}

/** Custo antes (padrão da casa): a geração com 2 versões, a busca na web e o Jev. */
export function partesDaGravacao(modeloId: string, o: Pick<OpcoesDaGravacao, "modo" | "web">): ParteDaEstimativa[] {
  return [
    { modeloId, tipo: "texto", ...TAMANHO_DO_ANUNCIO[o.modo], buscasWeb: o.web ? BUSCAS_WEB_DO_ANUNCIO : 0 },
    parteDaConferenciaDoJev(),
  ];
}

export interface RespostaDoAnuncio {
  roteiro: LinhaDoRoteiro | null;
  versao?: { numero: number; conteudo: Roteiro };
  escolha?: { indice: number; como: string; porque: string; estrutura: IdDaEstrutura; notas: Array<Record<string, number | null>> };
  referencias?: Array<{ titulo: string; url: string }>;
  vinculo?: { ads_criativo_id: string; ads_oferta_id: string | null; gravado: boolean; aviso: string | null };
  web?: { pedida: boolean; usada: boolean };
  aviso_banco?: string | null;
  custo_usd?: number;
  saldo_usd?: number;
}

export function corpoDaGravacao(clientId: string, criativoId: string, o: OpcoesDaGravacao, modeloId: string) {
  return {
    client_id: clientId,
    ads_criativo_id: criativoId,
    modo: o.modo,
    formato: o.formato,
    duracao_s: o.duracao,
    estrutura: o.estrutura,
    web: o.web,
    modelo_id: modeloId || undefined,
  };
}

export const gerarRoteiroDoAnuncio = (corpo: ReturnType<typeof corpoDaGravacao>) => chamarRoteiros<RespostaDoAnuncio>("anuncio_gerar", corpo as unknown as Record<string, unknown>);

/** Endereço da Mesa Roteiros com o roteiro aberto (para editar lá). */
export const linkDaMesaRoteiros = (clientId: string, roteiroId: string) =>
  `/mesa-roteiros?client=${encodeURIComponent(clientId)}&etapa=roteiro&roteiro=${encodeURIComponent(roteiroId)}`;
