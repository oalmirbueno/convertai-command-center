import { projetoDosTakes, type FonteDoProjeto } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { Montador } from "@/lib/editor/skills/tipos";
import { porTrilha } from "@/lib/editor/motion/aplicar";
import type { ArquivoDeVideo } from "@/components/mesa-videos/videosApi";

export function videoComTrilha(video: ArquivoDeVideo, musica: ArquivoDeVideo, abaixoDb = 22) {
  if (!video.client_id || video.client_id !== musica.client_id) throw new Error("A trilha precisa pertencer ao mesmo cliente do vídeo.");
  if (video.estado === "arquivado" || musica.estado === "arquivado") throw new Error("Escolha arquivos ativos.");
  if (!video.duracao_s || video.duracao_s <= 0 || !Number.isFinite(video.duracao_s)) throw new Error("A duração do vídeo ainda não foi medida.");
  if (!(musica.tipo === "audio" || musica.mime?.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(musica.storage_path))) throw new Error("Escolha um arquivo de áudio para a trilha.");
  for (const f of [video, musica]) if (f.storage_bucket !== "mesa" || !f.storage_path.startsWith(`${video.client_id}/`)) throw new Error("Arquivo fora do acervo deste cliente.");
  const largura = video.largura || 1080, altura = video.altura || 1920;
  const formato = largura === altura ? "1:1" : largura > altura ? "16:9" : largura / altura > .7 ? "4:5" : "9:16";
  const p = projetoDosTakes({ titulo: `${video.nome} · com trilha`, formato, takes: [{ ...video, largura, altura, cena_ref: null, melhor: true }] });
  const m = new Montador({ ...p, largura, altura });
  const fonte: FonteDoProjeto = { chave: `musica-${musica.id}`, arquivo_id: musica.id, nome: musica.nome, tipo: "audio", storage_bucket: musica.storage_bucket, storage_path: musica.storage_path, duracao_s: musica.duracao_s, largura: null, altura: null, midia: "audio" };
  m.aplicar({ op: "fonte", fonte }); porTrilha(m, fonte.chave, abaixoDb);
  return m.projeto;
}
