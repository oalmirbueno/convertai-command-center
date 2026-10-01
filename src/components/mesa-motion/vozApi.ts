import { useQuery, useQueryClient } from "@tanstack/react-query";
import { renderDaCena } from "../../../supabase/functions/_shared/motion-metodo";
import { casarComANarracao, faltasDaNarracao, semTags } from "../../../supabase/functions/mesa-motion/modulos/narracao";
import { chamarMotion, type Filme } from "./motionApi";

/**
 * Ponte da voz da Mesa Motion (frente MOV): situação da chave da ElevenLabs
 * no servidor, as vozes da marca aberta e a biblioteca. Nenhuma chave passa
 * por aqui: a tela só manda ordens e toca as prévias (links de 1 h ou o
 * endereço público da prévia da ElevenLabs).
 */

export interface VozSalva {
  id: string;
  voice_id: string;
  nome: string;
  descricao: string | null;
  origem: "biblioteca" | "desenhada" | "clonada";
  padrao: boolean;
  previa_url: string | null;
  previa_link?: string | null;
}

export interface SituacaoDaVoz {
  tem_chave: boolean;
  aviso_chave: string | null;
  vozes: VozSalva[];
  padrao: VozSalva | null;
  indisponivel: boolean;
  aviso: string | null;
}

export interface VozDaBiblioteca {
  voice_id: string;
  nome: string;
  categoria: string;
  descricao: string;
  previa_url: string | null;
  previa_pt: string | null;
  idiomas: string[];
  rotulos: Record<string, string>;
  /** Só nas vozes da Voice Library pública (entram na conta ao escolher). */
  public_owner_id?: string;
  sotaque?: string;
  locale?: string | null;
}

export const chaveDaVoz = (clientId: string, marcaId: string | null) => ["mesa-motion", "voz", clientId, marcaId || "principal"];

export function useSituacaoDaVoz(clientId: string, marcaId: string | null, ativo = true) {
  return useQuery({
    queryKey: chaveDaVoz(clientId, marcaId),
    enabled: !!clientId && ativo,
    queryFn: () => chamarMotion<SituacaoDaVoz>("voz_situacao", { client_id: clientId, marca_id: marcaId || undefined }),
    staleTime: 60_000,
  });
}

/** Troca as vozes da marca no cache (as ações de voz devolvem a lista nova). */
export function useGuardarVozes(clientId: string, marcaId: string | null) {
  const qc = useQueryClient();
  return (vozes: VozSalva[] | undefined) => {
    if (!Array.isArray(vozes)) return;
    qc.setQueryData(chaveDaVoz(clientId, marcaId), (d: SituacaoDaVoz | undefined) => (d ? { ...d, vozes, padrao: vozes.find((v) => v.padrao) || null } : d));
  };
}

/** Link tocável de uma voz salva: a prévia guardada no Storage ou a da ElevenLabs. */
export const previaDaVoz = (v: Pick<VozSalva, "previa_link" | "previa_url">) => v.previa_link || v.previa_url || null;

/** Trecho do áudio da cena (fragmento de mídia: o navegador toca só de `de` até `ate`). */
export const trechoDoAudio = (url: string, de: number, ate: number) => `${url}#t=${Math.max(0, de).toFixed(2)},${Math.max(de + 0.1, ate).toFixed(2)}`;

/**
 * O que já está feito no filme (vem desmarcado e é pulado):
 * - direção de arte: o acabamento já foi escolhido (entrevista ou Direção de arte);
 * - encaixe: toda cena com fala tem narração em dia e já dura o tempo da fala;
 * - stills: toda cena em código tem o still aprovado ou um still em dia.
 */
export function passosFeitos(filme: Filme): { direcao: boolean; encaixar: boolean; stills: boolean; cenasSemStill: string[] } {
  const n = filme.som.narracao;
  const direcao = typeof filme.entrevista.acabamento === "string" && !!filme.entrevista.acabamento;
  const comFala = filme.cenas.filter((c) => semTags(n.falas[c.id] || ""));
  let encaixar = false;
  if (comFala.length && !faltasDaNarracao({ ...n, ligada: true }, filme.cenas).length) {
    const r = casarComANarracao(filme.cenas, n, filme.som.batidas);
    encaixar = r.cenas.every((c, i) => c.duracao_s === filme.cenas[i].duracao_s);
  }
  const formato = filme.formatos[0] || "9:16";
  const cenasSemStill = filme.cenas
    .filter((c) => c.tipo_plano === "hf")
    .filter((c) => {
      if (c.still_aprovado) return false;
      const r = renderDaCena(filme, c, "still", formato);
      return !(r && r.em_dia);
    })
    .map((c) => c.id);
  const temHf = filme.cenas.some((c) => c.tipo_plano === "hf");
  return { direcao, encaixar, stills: temHf && !cenasSemStill.length, cenasSemStill };
}
