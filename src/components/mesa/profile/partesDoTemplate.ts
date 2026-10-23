import type { ParteDaEstimativa } from "@/lib/mesa/api";

/** Partes da estimativa do Template: uma chamada do redator do Estúdio; uma foto do gerador do trabalho. */
export const partesDoTextoDoTemplate = (diretorId: string | null | undefined): ParteDaEstimativa[] => [{ modeloId: diretorId, tipo: "texto", tokensEntrada: 9_000, tokensSaida: 3_000 }];
export const partesDaFotoDoTemplate = (modeloImagemId: string | null | undefined, qualidade: string | null | undefined, vezes = 1): ParteDaEstimativa[] => [
  { modeloId: modeloImagemId, tipo: "imagem", imagens: 1, qualidade: (qualidade === "baixa" || qualidade === "alta" ? qualidade : "media"), tokensEntrada: 1_500, vezes },
];
