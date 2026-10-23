import { normalizarRoteiro, type Roteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import type { CenaDoRoteiro, RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";

/**
 * O roteiro da peça de vídeo da campanha no formato do motor de roteiros (23/10/2026), para sair no mesmo
 * PDF e no mesmo Word da Mesa Roteiros. Cada cena vira um bloco (fala, visual com a câmera, texto na tela e
 * o som no B-roll). O documento tem até 14 blocos: roteiro longo junta cenas vizinhas no mesmo bloco.
 */

const MAX_BLOCOS = 14;

function blocoDasCenas(cenas: CenaDoRoteiro[]) {
  const primeira = cenas[0];
  const ultima = cenas[cenas.length - 1];
  const junta = (f: (c: CenaDoRoteiro) => string) => cenas.map(f).filter(Boolean).join(" / ");
  return {
    funcao: cenas.length > 1 ? `Cenas ${primeira.ordem} a ${ultima.ordem}` : `Cena ${primeira.ordem}`,
    fala: junta((c) => c.fala),
    segundos: cenas.reduce((s, c) => s + c.segundos, 0),
    visual: junta((c) => [c.descricao, c.plano ? `Câmera: ${c.plano}` : ""].filter(Boolean).join(". ")),
    texto_na_tela: junta((c) => c.texto_na_tela),
    broll: junta((c) => (c.som ? `Som: ${c.som}` : "")),
  };
}

export function roteiroDoDocumento(r: RoteiroDeVideo, tema: string): Roteiro {
  const porBloco = Math.max(1, Math.ceil(r.cenas.length / MAX_BLOCOS));
  const grupos: CenaDoRoteiro[][] = [];
  for (let i = 0; i < r.cenas.length; i += porBloco) grupos.push(r.cenas.slice(i, i + porBloco));
  return normalizarRoteiro(
    {
      titulo: r.titulo || tema || "Roteiro do vídeo",
      subtitulo: r.conceito || r.ideia || "",
      tipo: "cinema",
      formato: "9:16",
      duracao_alvo_s: r.duracao,
      ganchos: r.gancho ? [{ texto: r.gancho }] : [],
      blocos: grupos.map(blocoDasCenas),
      cta: r.cta,
      broll: r.trilha ? [`Trilha: ${r.trilha}`] : [],
      logline: r.conceito || "",
    },
    { titulo: tema, tipo: "cinema", duracao_s: r.duracao },
  );
}

/** O nome do arquivo (sem extensão) a partir do título. */
export function nomeDoArquivoDoRoteiro(titulo: string): string {
  const base = String(titulo || "video")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `roteiro-${base || "video"}`;
}
