import type { ArquivoDeVideo, PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import { takesNaOrdem, type EntradaDoPacote, type TakeDoPacote } from "../../../supabase/functions/_shared/pacote-de-edicao";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Entrada do "Pacote para editar" e do projeto de edição a partir do que a
 * tela escolheu (Mesa Edição, frente E2; antes em mesa-videos/EtapaEdicao).
 * O projeto (projeto-de-edicao.ts) é a montagem que a área do editor mostra e
 * de onde saem o edl.json e o projeto.json do pacote.
 */

/** Projeto da primeira montagem: os melhores na ordem das cenas (ou todos, se nenhum foi marcado). */
export function projetoDaEntrada(e: Pick<EntradaDoPacote, "titulo" | "formato" | "fps" | "roteiro" | "direcao" | "takes" | "gerado_em">): ProjetoDeEdicao {
  const ordem = takesNaOrdem(e.takes || [], e.roteiro || null).filter((t) => t.tipo !== "audio");
  const melhores = ordem.filter((t) => t.melhor);
  return projetoDosTakes({
    titulo: e.titulo,
    formato: e.formato || null,
    fps: e.fps || null,
    roteiro_id: e.roteiro ? e.roteiro.id : null,
    direcao: e.direcao || null,
    takes: melhores.length ? melhores : ordem,
    agora: e.gerado_em,
  });
}

export function entradaDoPacote(p: {
  clienteId: string;
  clienteNome: string;
  titulo: string;
  arquivos: ArquivoDeVideo[];
  quais: "melhores" | "todos";
  roteiro: EntradaDoPacote["roteiro"];
  historia: EntradaDoPacote["historia"];
  pedidos: PedidoDeVideo[];
  destino: "editor" | "remotion";
  fps: number | null;
  formato: string;
  direcao: string;
  urls?: Record<string, string>;
  agora: string;
}): EntradaDoPacote {
  const ativos = p.arquivos.filter((a) => a.estado !== "arquivado" && (a.tipo !== "gerado" || !!a.edicao_desde));
  const doRoteiro = p.roteiro ? ativos.filter((a) => a.roteiro_id === (p.roteiro as { id: string }).id) : ativos;
  const base = doRoteiro.length ? doRoteiro : ativos;
  const escolhidos = p.quais === "melhores" && base.some((a) => a.melhor) ? base.filter((a) => a.melhor) : base;
  const takes: TakeDoPacote[] = escolhidos.map((a) => ({ ...a, url: p.urls ? p.urls[a.storage_path] || null : null }));
  const entrada: EntradaDoPacote = {
    cliente: { id: p.clienteId, nome: p.clienteNome || "Cliente" },
    titulo: p.titulo,
    formato: p.formato || null,
    fps: p.fps,
    destino: p.destino,
    roteiro: p.roteiro,
    historia: p.historia,
    takes,
    legendas: p.pedidos
      .filter((x) => (x.tipo === "transcrever" || x.tipo === "legendar") && x.estado !== "cancelado" && x.alvo && x.alvo.arquivo_id)
      .map((x) => {
        const r = (x as unknown as { resultado?: { srt?: unknown } | null }).resultado;
        return { arquivo_id: String(x.alvo.arquivo_id), estado: x.estado, srt: r && typeof r.srt === "string" ? r.srt : null };
      }),
    referencias: [],
    direcao: p.direcao,
    gerado_em: p.agora,
  };
  entrada.projeto = projetoDaEntrada(entrada);
  return entrada;
}
