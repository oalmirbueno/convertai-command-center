import { projetoDosTakes } from "../../_shared/projeto-de-edicao.ts";
/** Single full clip for captions only. Sources and audio remain intact. */
export function baseDoVideoRapido(a: { id: string; client_id: string; nome: string; tipo: string; storage_bucket: string; storage_path: string; duracao_s: number | null; largura?: number | null; altura?: number | null }) {
  if (!a.duracao_s || !Number.isFinite(a.duracao_s) || a.duracao_s <= 0) throw new Error("A duração do vídeo ainda não foi medida.");
  if (a.storage_bucket !== "mesa" || !a.storage_path.startsWith(`${a.client_id}/`) || a.tipo !== "gerado") throw new Error("Este arquivo não pode receber uma versão legendada.");
  const largura = a.largura || 1080; const altura = a.altura || 1920;
  const formato = largura === altura ? "1:1" : largura > altura ? "16:9" : largura / altura > .7 ? "4:5" : "9:16";
  const p = projetoDosTakes({ titulo: a.nome, formato, takes: [{ ...a, largura, altura, cena_ref: null, melhor: true }] });
  return { ...p, largura, altura };
}
