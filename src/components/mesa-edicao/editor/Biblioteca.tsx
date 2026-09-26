import { useMemo } from "react";
import { Film, Image as IconeImagem, Music, Plus, Wand2 } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { duracaoCurta, useArquivosDeVideo, usePedidos } from "@/components/mesa-videos/videosApi";
import { midiaDaFonte, type ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { chaveNoProjeto, midiasDoPedido, type ItemDaBiblioteca } from "@/lib/editor/biblioteca";

/**
 * Mídia do cliente no editor (frente V-B): vídeos enviados, gerados (mesmo os
 * que ainda não foram aprovados para a Edição, marcados como "gerado") e o que
 * as gerações do editor devolveram (ângulos, continuações, transições).
 */

type Filtro = "todos" | "enviados" | "gerados";

export default function Biblioteca({
  projeto,
  onInserir,
  onVirarClipe,
}: {
  projeto: ProjetoDeEdicao;
  onInserir: (item: ItemDaBiblioteca, onde: "fim" | "cursor") => void;
  onVirarClipe: (item: ItemDaBiblioteca) => void;
}) {
  const { clientId } = useMesa();
  const arquivosQ = useArquivosDeVideo(clientId);
  const pedidosQ = usePedidos(clientId);
  const [filtro, setFiltro] = useEstadoDaTela<Filtro>(`mesa-edicao:editor:biblioteca:${clientId}`, "todos", { validar: (v) => v === "todos" || v === "enviados" || v === "gerados" });

  const itens = useMemo(() => {
    const arquivos: ItemDaBiblioteca[] = ((arquivosQ.data && arquivosQ.data.arquivos) || [])
      .filter((a) => a.estado !== "arquivado")
      .map((a) => ({
        id: a.id,
        arquivo_id: a.so_no_storage ? null : a.id,
        nome: a.nome,
        tipo: a.tipo,
        storage_bucket: a.storage_bucket,
        storage_path: a.storage_path,
        duracao_s: a.duracao_s,
        largura: a.largura,
        altura: a.altura,
        origem: a.tipo === "gerado" || a.tipo === "angulo" || a.tipo === "quadro" ? "gerado" : "enviado",
      }));
    const dosPedidos = ((pedidosQ.data && pedidosQ.data.itens) || []).reduce((l, p) => l.concat(midiasDoPedido(p as never)), [] as ItemDaBiblioteca[]);
    const vistos: Record<string, boolean> = {};
    return arquivos.concat(dosPedidos).filter((i) => (vistos[i.storage_path] ? false : (vistos[i.storage_path] = true)));
  }, [arquivosQ.data, pedidosQ.data]);

  const lista = itens.filter((i) => filtro === "todos" || (filtro === "enviados" ? i.origem === "enviado" : i.origem !== "enviado"));

  return (
    <div className="space-y-2" data-biblioteca-do-editor="">
      <SeletorCompacto
        rotulo="Filtro da mídia"
        valor={filtro}
        onEscolher={(v) => setFiltro(v as Filtro)}
        opcoes={[
          { valor: "todos", rotulo: "Tudo", contador: itens.length },
          { valor: "enviados", rotulo: "Enviados" },
          { valor: "gerados", rotulo: "Gerados" },
        ]}
      />
      {arquivosQ.isLoading ? (
        <Carregando linhas={4} rotulo="Lendo a mídia" />
      ) : !lista.length ? (
        <EstadoVazio compacto titulo="Nada aqui ainda." descricao="Suba vídeos na Entrada ou gere na Mesa Vídeos." />
      ) : (
        <ul className="divide-y divide-border">
          {lista.map((i) => {
            const midia = midiaDaFonte(i.tipo, i.nome, i.storage_path);
            const noProjeto = !chaveNoProjeto(projeto, i).nova;
            const Icone = midia === "imagem" ? IconeImagem : midia === "audio" ? Music : Film;
            return (
              <li key={i.id} className="flex min-w-0 items-center py-1.5" data-item-da-biblioteca={i.id}>
                <Icone className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]" title={i.nome}>
                    {i.nome}
                  </span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>
                    {i.origem === "enviado" ? "Enviado" : "Gerado"}
                    {i.duracao_s ? ` · ${duracaoCurta(i.duracao_s)}` : midia === "imagem" ? " · imagem" : " · sem duração lida"}
                  </span>
                </span>
                {noProjeto && <span className={juntar(etiqueta, "mr-1 bg-primary/10 text-primary")}>no projeto</span>}
                {midia === "imagem" && (
                  <button type="button" className={botao.icone} onClick={() => onVirarClipe(i)} aria-label={`Virar clipe: ${i.nome}`} title="Virar clipe (gera vídeo a partir da imagem)">
                    <Wand2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button type="button" className={botao.icone} onClick={() => onInserir(i, "cursor")} aria-label={`Pôr no cursor: ${i.nome}`} title="Pôr no cursor (empurra o resto)">
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => onInserir(i, "fim")} aria-label={`Pôr no fim: ${i.nome}`}>
                  Fim
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
