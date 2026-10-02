import type { ArquivoDeVideo, PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import { takesNaOrdem, type EntradaDoPacote, type TakeDoPacote } from "../../../supabase/functions/mesa-videos/modulos/pacote-de-edicao";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { agruparVariantes } from "../../../supabase/functions/mesa-videos/modulos/organizador-da-entrada";

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

/** O que não é material de edição: amostra, still, render pronto, entrega e imagens do gerador. */
const FORA_DA_EDICAO = ["amostra", "still", "render", "entrega", "quadro", "elemento", "angulo"];

/**
 * Material da edição (02/10, "organizar no Editar também"): sem amostras,
 * stills e renders prontos, e cada cena do Motion uma vez só (a variante
 * principal, não as 3 a 5 de cada formato).
 */
export function materialDaEdicao(arquivos: ArquivoDeVideo[]): ArquivoDeVideo[] {
  const uteis = arquivos.filter((a) => FORA_DA_EDICAO.indexOf(a.tipo) < 0);
  const principais = new Set(agruparVariantes(uteis).map((g) => g.principal.id));
  return uteis.filter((a) => principais.has(a.id));
}

/** O tratado (sem legenda, melhorado) entra no lugar do antes, quando existe. */
export function trocarPeloTratado(escolhidos: ArquivoDeVideo[], todos: ArquivoDeVideo[]): ArquivoDeVideo[] {
  const ids = new Set(escolhidos.map((a) => a.id));
  return escolhidos.map((a) => {
    const depois = todos
      .filter((x) => x.origem && x.origem.tipo === "tratamento" && x.origem.de_arquivo_id === a.id && !ids.has(x.id))
      .sort((x, y) => (x.criado_em < y.criado_em ? 1 : -1))[0];
    return depois ? { ...depois, melhor: a.melhor, roteiro_id: a.roteiro_id, cena_ref: a.cena_ref } : a;
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
  const ativos = materialDaEdicao(p.arquivos.filter((a) => a.estado !== "arquivado" && (a.tipo !== "gerado" || !!a.edicao_desde)));
  const doRoteiro = p.roteiro ? ativos.filter((a) => a.roteiro_id === (p.roteiro as { id: string }).id) : ativos;
  const base = doRoteiro.length ? doRoteiro : ativos;
  const escolhidos = trocarPeloTratado(p.quais === "melhores" && base.some((a) => a.melhor) ? base.filter((a) => a.melhor) : base, ativos);
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
