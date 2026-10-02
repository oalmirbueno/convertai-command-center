import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Film, Image as IconeImagem, Music, Plus, Wand2 } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { duracaoCurta, useArquivosDeVideo, usePedidos } from "@/components/mesa-videos/videosApi";
import { midiaDaFonte, type ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { assinaturasDosArquivos, itensDaBiblioteca, type ItemDaBiblioteca } from "@/lib/editor/biblioteca";
import { filtrarMidia, origemDoArquivo, usadosNaLinha } from "@/lib/editor/busca";
import BuscaComFiltros from "./BuscaComFiltros";
import { useBuscaDoEditor } from "./buscaDoEditor";

/**
 * Mídia do cliente no editor (frente V-B): vídeos enviados, gerados (mesmo os
 * que ainda não foram aprovados para a Edição, marcados como "gerado") e o que
 * as gerações do editor devolveram (ângulos, continuações, transições).
 *
 * 02/10: busca com filtros (tipo, origem, uso, duração, só repetidos), o mesmo
 * filtro da linha do tempo e do agente. Lista longa abre em blocos de 60 (a
 * tela não desenha centenas de linhas de uma vez).
 */

const BLOCO = 60;
const ROTULO_DA_ORIGEM = { bruto: "Bruto", gerado: "Gerado", acervo: "Acervo" } as const;

const LinhaDaMidia = memo(function LinhaDaMidia({ i, noProjeto, onInserir, onVirarClipe }: { i: ItemDaBiblioteca; noProjeto: boolean; onInserir: (item: ItemDaBiblioteca, onde: "fim" | "cursor") => void; onVirarClipe: (item: ItemDaBiblioteca) => void }) {
  const midia = midiaDaFonte(i.tipo, i.nome, i.storage_path);
  const Icone = midia === "imagem" ? IconeImagem : midia === "audio" ? Music : Film;
  return (
    <li className="flex min-w-0 items-center py-1.5" data-item-da-biblioteca={i.id}>
      <Icone className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px]" title={i.nome}>
          {i.nome}
        </span>
        <span className={juntar(texto.auxiliar, "block truncate")}>
          {ROTULO_DA_ORIGEM[origemDoArquivo(i.tipo, i.storage_path, i.origem)]}
          {i.duracao_s ? ` · ${duracaoCurta(i.duracao_s)}` : midia === "imagem" ? " · imagem" : " · sem duração lida"}
        </span>
      </span>
      {noProjeto && <span className={juntar(etiqueta, "mr-1 bg-primary/10 text-primary")}>na linha</span>}
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
});

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
  const busca = useBuscaDoEditor(clientId);
  const [mostrar, setMostrar] = useState(BLOCO);
  // As linhas são memo: as ações vão por ref (o pai passa função nova a cada desenho).
  const acoes = useRef({ onInserir, onVirarClipe });
  acoes.current = { onInserir, onVirarClipe };
  const inserirItem = useCallback((i: ItemDaBiblioteca, onde: "fim" | "cursor") => acoes.current.onInserir(i, onde), []);
  const virarClipe = useCallback((i: ItemDaBiblioteca) => acoes.current.onVirarClipe(i), []);

  const arquivos = arquivosQ.data && arquivosQ.data.arquivos;
  const pedidos = pedidosQ.data && pedidosQ.data.itens;
  const itens = useMemo(() => itensDaBiblioteca(arquivos || [], (pedidos || []) as never[]), [arquivos, pedidos]);
  const assinaturas = useMemo(() => assinaturasDosArquivos(arquivos || []), [arquivos]);
  const lista = useMemo(() => filtrarMidia(itens, projeto, busca.filtro, assinaturas), [itens, projeto, busca.filtro, assinaturas]);
  const usados = useMemo(() => usadosNaLinha(projeto), [projeto]);

  return (
    <div className="space-y-2" data-biblioteca-do-editor="">
      <BuscaComFiltros filtro={busca.filtro} mudar={busca.mudar} limpar={busca.limpar} rotulo="Buscar na mídia" contagem={`${lista.length} de ${itens.length}`} />
      {arquivosQ.isLoading ? (
        <Carregando linhas={4} rotulo="Lendo a mídia" />
      ) : !itens.length ? (
        <EstadoVazio compacto titulo="Nada aqui ainda." descricao="Suba vídeos na Entrada ou gere na Mesa Vídeos." />
      ) : !lista.length ? (
        <p className={juntar(texto.auxiliar, "py-2")}>Nada bate com a busca.</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {lista.slice(0, mostrar).map((i) => (
              <LinhaDaMidia key={i.id} i={i} noProjeto={(!!i.arquivo_id && usados.arquivos.has(i.arquivo_id)) || usados.caminhos.has(i.storage_path)} onInserir={inserirItem} onVirarClipe={virarClipe} />
            ))}
          </ul>
          {lista.length > mostrar && (
            <button type="button" className={juntar(botao.discreto, "h-8 w-full text-[12px]")} onClick={() => setMostrar((n) => n + BLOCO)}>
              Mostrar mais {Math.min(BLOCO, lista.length - mostrar)} de {lista.length - mostrar}
            </button>
          )}
        </>
      )}
    </div>
  );
}
