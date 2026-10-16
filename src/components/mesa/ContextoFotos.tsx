import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Folder, FolderSync, Images, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { chamarFuncao, rotuloDaCategoria } from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { AvisoDeErro, useAvisarErro } from "./Custo";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useMesa } from "./MesaContexto";
import { Quadrado } from "./NavegadorDePastas";
import { invalidarAcervo, useAcervo } from "./contextoDoCliente";
import { botao, juntar } from "@/components/sistema/estilos";
import { montarArvore, pastaDaFoto, pastasDoAcervo, RAIZ, trilhaAte, useArvoreDoWorkspace } from "@/lib/mesa/pastas";

/**
 * Fotos reais do cliente (acervo) em galeria compacta no Contexto: as
 * primeiras fotos ativas, cada uma abre maior com a descrição. As pastas de
 * cima espelham o Workspace do cliente (mesma organização de lá) e filtram a
 * galeria. Organizar e editar continua no editor de Imagens (Detalhes).
 *
 * 16/10 (dono: "Fotos reais fica rodando esse loop infinito"): a galeria
 * mora numa aba própria do Contexto. "Ver todas" e "Organizar" trocam para a
 * aba Editar em detalhe (Imagens) em vez de rolar a página até lá: o rolar
 * suave até o fim da coluna brigava com a memória da rolagem, que a cada
 * miniatura que chegava (o DOM muda) devolvia a página para a posição
 * guardada, e a mesma coleção aparecia duas vezes na mesma página (aqui e no
 * editor de Imagens) carregando as mesmas miniaturas. Ações só em ícone, sem
 * bordas.
 */

export function legendaDaFoto(i: { descricao: string | null; categoria: string | null; pasta: string | null }): string {
  const partes = [i.descricao && i.descricao.trim() ? i.descricao.trim() : "Sem descrição ainda."];
  const onde = [i.categoria ? rotuloDaCategoria(i.categoria) : null, i.pasta ? `pasta ${i.pasta}` : null].filter(Boolean).join(" · ");
  if (onde) partes.push(onde);
  return partes.join(" ");
}

export default function FotosDoCliente({ colunas = 6, onOrganizar }: { colunas?: 4 | 6; onOrganizar?: () => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const acervo = useAcervo(clientId);
  const [aberta, setAberta] = useState<number | null>(null);
  const [buscando, setBuscando] = useState(false);

  const arvoreDoWorkspace = useArvoreDoWorkspace(clientId);
  const [pasta, setPasta] = useState(RAIZ);

  const todasAtivas = useMemo(() => (acervo.data || []).filter((i) => i.ativa), [acervo.data]);
  const semDescricao = todasAtivas.filter((i) => !(i.descricao && i.descricao.trim())).length;

  // Pastas do primeiro nível, com as fotos de toda a subárvore.
  const espelho = useMemo(() => {
    const { pastas, pastaDoNo } = pastasDoAcervo(arvoreDoWorkspace.data || [], todasAtivas);
    const pastaDe: Record<string, string> = {};
    const diretos: Record<string, number> = {};
    for (const i of todasAtivas) {
      const p = pastaDaFoto(i, pastaDoNo);
      pastaDe[i.id] = p;
      diretos[p] = (diretos[p] || 0) + 1;
    }
    const arvore = montarArvore(pastas, diretos);
    const topo = (arvore.filhos[RAIZ] || []).filter((p) => (arvore.total[p.id] || 0) > 0).map((p) => ({ id: p.id, nome: p.nome, total: arvore.total[p.id] || 0 }));
    const dentro = (fotoId: string, alvo: string) => trilhaAte(arvore, pastaDe[fotoId] || RAIZ).some((p) => p.id === alvo);
    return { topo, dentro };
  }, [arvoreDoWorkspace.data, todasAtivas]);

  // Pasta escolhida que sumiu (outra marca, acervo relido): volta para Todas.
  const pastaValida = pasta === RAIZ || espelho.topo.some((p) => p.id === pasta) ? pasta : RAIZ;
  const ativas = useMemo(
    () => (pastaValida === RAIZ ? todasAtivas : todasAtivas.filter((i) => espelho.dentro(i.id, pastaValida))),
    [pastaValida, todasAtivas, espelho],
  );
  const naTela = colunas === 6 ? 11 : 7;
  const visiveis = ativas.slice(0, naTela);
  const resto = ativas.length - visiveis.length;

  const ampliaveis: ImagemAmpliavel[] = useMemo(
    () =>
      ativas.map((i) => ({
        caminho: i.storage_path,
        bucket: i.storage_bucket || "mesa",
        titulo: i.nome,
        legenda: legendaDaFoto(i),
      })),
    [ativas],
  );

  const buscar = async () => {
    setBuscando(true);
    try {
      const data = await chamarFuncao<{ novas?: number; total?: number }>("agente-contexto", { acao: "acervo_sincronizar", client_id: clientId });
      const novas = Number((data && data.novas) || 0);
      toast.success(novas ? `${novas} ${novas === 1 ? "imagem nova" : "imagens novas"} no acervo` : "O acervo já estava em dia");
      invalidarAcervo(queryClient, clientId);
    } catch (e) {
      avisarErro(e, "Imagens não buscadas");
    } finally {
      setBuscando(false);
    }
  };

  const grade = colunas === 6 ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-4";

  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center">
        <p className="mr-2 min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {acervo.isLoading
            ? "Lendo o acervo..."
            : todasAtivas.length
              ? `${todasAtivas.length} ${todasAtivas.length === 1 ? "foto ativa" : "fotos ativas"}${semDescricao ? `, ${semDescricao} sem descrição` : ", todas organizadas"}`
              : "Nenhuma foto real no acervo ainda."}
        </p>
        <button
          type="button"
          onClick={() => void buscar()}
          disabled={buscando}
          className={botao.icone}
          aria-label="Buscar nas pastas"
          title="Buscar nas pastas do Workspace e de Arquivos"
        >
          {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSync className="h-4 w-4" />}
        </button>
        {onOrganizar && (
          <button type="button" onClick={onOrganizar} className={juntar(botao.icone, "ml-0.5")} aria-label="Organizar" title="Organizar todas as fotos (Editar em detalhe)">
            <Images className="h-4 w-4" />
          </button>
        )}
      </div>

      {acervo.isError && <AvisoDeErro erro={acervo.error} />}

      {espelho.topo.length > 1 && (
        <div role="group" aria-label="Pastas do Workspace" className="scrollbar-hidden -mx-0.5 mb-2 flex min-w-0 overflow-x-auto overscroll-x-contain">
          {[{ id: RAIZ, nome: "Todas", total: todasAtivas.length }].concat(espelho.topo).map((p) => (
            <button
              key={p.id || "todas"}
              type="button"
              onClick={() => setPasta(p.id)}
              aria-pressed={pastaValida === p.id}
              title={p.nome}
              className={`mx-0.5 inline-flex max-w-[11rem] shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                pastaValida === p.id ? "bg-primary/10 font-medium text-primary" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.id !== RAIZ && <Folder className="mr-1 h-3 w-3 shrink-0" />}
              <span className="min-w-0 truncate">{p.nome}</span>
              <span className="ml-1 shrink-0 tabular-nums opacity-70">{p.total}</span>
            </button>
          ))}
        </div>
      )}

      {acervo.isLoading ? (
        <div className={`grid gap-2 ${grade}`}>
          {Array.from({ length: colunas === 6 ? 6 : 4 }).map((_, i) => (
            <Quadrado key={i}>
              <span className="block h-full w-full animate-pulse bg-muted" />
            </Quadrado>
          ))}
        </div>
      ) : todasAtivas.length === 0 ? (
        <p className="rounded-lg bg-muted/50 px-4 py-5 text-center text-[12px] text-muted-foreground">
          Use o botão de buscar nas pastas para trazer as fotos do Workspace e de Arquivos.
        </p>
      ) : (
        <ul className={`grid gap-2 ${grade}`}>
          {visiveis.map((i, n) => (
            <li key={i.id} className="min-w-0">
              <button
                type="button"
                onClick={() => setAberta(n)}
                title={i.descricao || i.nome}
                aria-label={`Ver maior: ${i.nome}`}
                className="block w-full rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Quadrado>
                  <MiniaturaDoStorage bucket={i.storage_bucket || "mesa"} caminho={i.storage_path} alt={i.nome} className="h-full w-full" />
                </Quadrado>
              </button>
            </li>
          ))}
          {resto > 0 && (
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => (onOrganizar ? onOrganizar() : setAberta(visiveis.length))}
                className="block w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Ver as outras ${resto} fotos`}
              >
                <Quadrado>
                  <span className="flex h-full w-full items-center justify-center bg-muted text-[15px] font-semibold text-foreground" title="Ver todas">
                    +{resto}
                  </span>
                </Quadrado>
              </button>
            </li>
          )}
        </ul>
      )}

      <Ampliar imagens={ampliaveis} indice={aberta} onFechar={() => setAberta(null)} />
    </div>
  );
}
