import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, CornerDownRight, Eye, FilePlus2, FileText, FolderInput, Handshake, Lock, MessageSquareText, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, ShieldQuestion, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Carregando, EstadoDeErro, EstadoVazio, JanelaCentral, MenuMais, botao, campo, foco, juntar, lista, superficie, texto, useEstadoDaTela, type ItemDoMenu } from "@/components/sistema";
import type { EstadoDoProduto } from "@/lib/produto/api";
import { nomesDasEtapas } from "@/lib/produto/nichos";
import {
  AJUDA_DE_QUEM_VE,
  ErroDoEspaco,
  LIMITE_DO_TITULO,
  MODELOS,
  ROTULO_DE_QUEM_VE,
  abrirPagina,
  achatarArvore,
  arquivarPagina,
  chaveDoEspaco,
  criarDoModelo,
  criarPagina,
  destinosParaMover,
  estaArquivada,
  excluirPagina,
  fraseDoErroDoEspaco,
  listarPaginas,
  montarArvore,
  moverPagina,
  paginasArquivadas,
  podeEditar,
  proximaOrdem,
  restaurarPagina,
  salvarPagina,
  tituloDaPagina,
  trilhaDaPagina,
  visibilidadesPermitidas,
  type ContextoDoModelo,
  type DocDoEditor,
  type ModeloDePagina,
  type ModeloId,
  type MudancasDaPagina,
  type NoDaArvore,
  type PaginaCompleta,
  type PaginaDoEspaco,
  type QuemOlha,
  type VisivelPara,
} from "@/lib/produto/espaco";
import "./espaco.css";

/**
 * Espaço: as páginas da empresa (playbook de vendas, roteiros, treinamento,
 * atas), no estilo de um caderno compartilhado.
 *
 * - À esquerda a árvore de páginas; à direita a página aberta. No celular a
 *   árvore é uma lista e a página abre por cima dela (com o voltar).
 * - A página aberta mora no endereço (`?pagina=<id>`): dá para mandar o link.
 * - O editor (TipTap) só é baixado quando uma página abre.
 * - Tudo grava sozinho; "Salvo" aparece ao lado do caminho da página.
 *
 * As regras (quem vê, quem edita, limite) são do banco; a tela só não oferece
 * o que ele vai negar. Funções puras e modelos: src/lib/produto/espaco.ts.
 */

const EditorDaPagina = lazy(() => import("./EditorDaPagina"));

const SEM_PAGINAS: PaginaDoEspaco[] = [];

/** Ícones que a pessoa pode dar à página (escolha dela; o texto fixo da tela não usa). */
const ICONES = ["📘", "📗", "📙", "📕", "📒", "📝", "📋", "📌", "📎", "📣", "📞", "💬", "🎯", "🚀", "⭐", "🔥", "💡", "🧭", "🗺️", "🏁", "🤝", "👋", "🙋", "🎓", "🏆", "💰", "📈", "📊", "🗓️", "⏰", "✅", "❓", "⚠️", "🔒", "🏠", "🚗", "🩺", "🛠️", "🛒", "🏢"];

const ICONE_DO_MODELO: Record<ModeloId, ReactNode> = {
  playbook: <BookOpen className="h-5 w-5" aria-hidden="true" />,
  roteiro: <MessageSquareText className="h-5 w-5" aria-hidden="true" />,
  objecoes: <ShieldQuestion className="h-5 w-5" aria-hidden="true" />,
  boas_vindas: <Handshake className="h-5 w-5" aria-hidden="true" />,
};

function IconeDaPagina({ icone, grande = false }: { icone: string | null; grande?: boolean }) {
  if (icone) return <span className={juntar("flex shrink-0 items-center justify-center leading-none", grande ? "h-8 w-8 text-[24px]" : "h-5 w-5 text-[14px]")} aria-hidden="true">{icone}</span>;
  return <FileText className={juntar("shrink-0 text-muted-foreground", grande ? "h-6 w-6" : "h-4 w-4")} aria-hidden="true" />;
}

function quando(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${dia} às ${hora}`;
}

export default function EspacoDaConta({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta;
  const contaId = conta ? conta.id : "";
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const paginaId = params.get("pagina");

  const quem: QuemOlha = useMemo(() => ({ userId: user ? user.id : null, papel: estado.eu ? estado.eu.papel : null }), [user, estado.eu]);
  const contexto: ContextoDoModelo = useMemo(
    () => (conta ? { empresa: conta.nome, nicho: conta.perfil.nicho || null, etapas: nomesDasEtapas(conta.perfil) } : {}),
    [conta],
  );

  const chave = useMemo(() => chaveDoEspaco(contaId), [contaId]);
  const consulta = useQuery<PaginaDoEspaco[]>({ queryKey: chave, queryFn: listarPaginas, enabled: !!contaId, staleTime: 30_000 });
  const paginas = consulta.data || SEM_PAGINAS;
  const arvore = useMemo(() => montarArvore(paginas), [paginas]);
  const arquivadas = useMemo(() => paginasArquivadas(paginas), [paginas]);

  const [recolhidas, setRecolhidas] = useEstadoDaTela<string[]>(`espaco:recolhidas:${contaId}`, [], { validar: (v) => Array.isArray(v) });
  const [listaRecolhida, setListaRecolhida] = useEstadoDaTela<boolean>(`espaco:lista:${contaId}`, false, { validar: (v) => typeof v === "boolean" });
  const linhas = useMemo(() => achatarArvore(arvore, recolhidas), [arvore, recolhidas]);

  const [ocupado, setOcupado] = useState(false);
  const [renomeando, setRenomeando] = useState<PaginaDoEspaco | null>(null);
  const [movendo, setMovendo] = useState<PaginaDoEspaco | null>(null);
  const [vendoArquivadas, setVendoArquivadas] = useState(false);
  const [pedidoDeTitulo, setPedidoDeTitulo] = useState(0);
  /** A versão que ESTA tela gravou por fora do editor (mover, arquivar): o salvamento da página aberta segue dela. */
  const versoesMinhas = useRef<Record<string, number>>({});

  const abrir = useCallback(
    (id: string | null, substituir = false) => {
      setParams(
        (antes) => {
          const novos = new URLSearchParams(antes);
          if (id) novos.set("pagina", id);
          else novos.delete("pagina");
          return novos;
        },
        { replace: substituir },
      );
    },
    [setParams],
  );

  /** Põe na lista a página que acabou de ser gravada (sem reler tudo). */
  const trocarNaLista = useCallback(
    (nova: PaginaDoEspaco) => {
      qc.setQueryData<PaginaDoEspaco[]>(chave, (antes) => {
        const atual = antes || [];
        return atual.some((p) => p.id === nova.id) ? atual.map((p) => (p.id === nova.id ? nova : p)) : atual.concat([nova]);
      });
    },
    [qc, chave],
  );
  const gravadaPorFora = useCallback(
    (nova: PaginaDoEspaco) => {
      versoesMinhas.current[nova.id] = nova.versao;
      trocarNaLista(nova);
    },
    [trocarNaLista],
  );

  const mostrarFilhos = (id: string | null) => {
    if (id) setRecolhidas((antes) => antes.filter((x) => x !== id));
  };

  const fazer = async (acao: () => Promise<void>, falha: string) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      await acao();
    } catch (e) {
      toast.error(fraseDoErroDoEspaco(e, falha));
    } finally {
      setOcupado(false);
    }
  };

  const novaPagina = (paiId: string | null) =>
    fazer(async () => {
      const nova = await criarPagina({ pai_id: paiId, ordem: proximaOrdem(paginas, paiId) });
      trocarNaLista(nova);
      mostrarFilhos(paiId);
      abrir(nova.id);
    }, "Não foi possível criar a página.");

  const usarModelo = (modelo: ModeloDePagina) =>
    fazer(async () => {
      const nova = await criarDoModelo(modelo, contexto, { ordem: proximaOrdem(paginas, null) });
      trocarNaLista(nova);
      abrir(nova.id);
    }, "Não foi possível criar a página do modelo.");

  const restaurar = (pagina: PaginaDoEspaco) =>
    fazer(async () => {
      gravadaPorFora(await restaurarPagina(pagina.id));
      toast.success("Página restaurada.");
    }, "Não foi possível restaurar a página.");

  const arquivar = (pagina: PaginaDoEspaco) =>
    fazer(async () => {
      gravadaPorFora(await arquivarPagina(pagina.id));
      if (paginaId && (paginaId === pagina.id || trilhaDaPagina(paginas, paginaId).some((p) => p.id === pagina.id))) abrir(null, true);
      toast.success("Página arquivada.", { action: { label: "Desfazer", onClick: () => void restaurar(pagina) } });
    }, "Não foi possível arquivar a página.");

  const excluir = (pagina: PaginaDoEspaco) =>
    fazer(async () => {
      await excluirPagina(pagina.id);
      if (paginaId === pagina.id) abrir(null, true);
      await qc.invalidateQueries({ queryKey: chave });
      toast.success("Página excluída.");
    }, "Não foi possível excluir a página.");

  const mover = (pagina: PaginaDoEspaco, destino: string | null) =>
    fazer(async () => {
      gravadaPorFora(await moverPagina(pagina.id, destino, proximaOrdem(paginas, destino)));
      mostrarFilhos(destino);
      setMovendo(null);
    }, "Não foi possível mover a página.");

  const renomear = (pagina: PaginaDoEspaco, titulo: string) =>
    fazer(async () => {
      gravadaPorFora(await salvarPagina(pagina.id, { titulo: titulo.trim() }));
      setRenomeando(null);
    }, "Não foi possível renomear a página.");

  const itensDaPagina = (p: PaginaDoEspaco): ItemDoMenu[] => {
    const edita = podeEditar(p, quem);
    const itens: ItemDoMenu[] = [{ rotulo: "Nova página dentro", icone: <CornerDownRight className="h-4 w-4" />, aoEscolher: () => void novaPagina(p.id) }];
    if (edita) {
      itens.push({
        rotulo: "Renomear",
        icone: <Pencil className="h-4 w-4" />,
        // A página aberta renomeia no próprio título (uma gravação só, sem disputar com o salvamento automático).
        aoEscolher: () => (p.id === paginaId ? setPedidoDeTitulo((n) => n + 1) : setRenomeando(p)),
      });
      itens.push({ rotulo: "Mover para", icone: <FolderInput className="h-4 w-4" />, aoEscolher: () => setMovendo(p) });
      itens.push({ rotulo: "Arquivar", icone: <Archive className="h-4 w-4" />, aoEscolher: () => void arquivar(p), separadorAntes: true });
    }
    return itens;
  };

  if (!conta) return null;

  if (consulta.isLoading) return <Carregando forma="lista" linhas={6} rotulo="Carregando as páginas" />;
  if (consulta.isError && !consulta.data) {
    return (
      <EstadoDeErro
        titulo="Não foi possível carregar as páginas."
        acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void consulta.refetch()}>Tentar de novo</button>}
      />
    );
  }

  const itensDoTopo: ItemDoMenu[] = MODELOS.map((m) => ({ rotulo: `Modelo: ${m.titulo}`, icone: <FilePlus2 className="h-4 w-4" />, aoEscolher: () => void usarModelo(m), desativado: ocupado }));
  itensDoTopo.push({ rotulo: arquivadas.length ? `Arquivadas (${arquivadas.length})` : "Arquivadas", icone: <Archive className="h-4 w-4" />, aoEscolher: () => setVendoArquivadas(true), separadorAntes: true });

  const janelas = (
    <>
      <JanelaDeRenomear pagina={renomeando} ocupado={ocupado} onFechar={() => setRenomeando(null)} aoSalvar={(t) => renomeando && void renomear(renomeando, t)} />
      <JanelaDeMover pagina={movendo} paginas={paginas} ocupado={ocupado} onFechar={() => setMovendo(null)} aoEscolher={(destino) => movendo && void mover(movendo, destino)} />
      <JanelaDasArquivadas
        aberta={vendoArquivadas}
        arquivadas={arquivadas}
        quem={quem}
        ocupado={ocupado}
        onFechar={() => setVendoArquivadas(false)}
        aoRestaurar={(p) => void restaurar(p)}
        aoExcluir={(p) => void excluir(p)}
      />
    </>
  );

  // Empresa sem página nenhuma: os quatro modelos, de um clique.
  if (arvore.length === 0 && !paginaId) {
    return (
      <div className="min-w-0" data-espaco-da-conta="" data-espaco-vazio="">
        <div className="mx-auto min-w-0 max-w-[880px] py-6 sm:py-10">
          <h2 className={texto.tituloPagina}>O Espaço da equipe começa aqui</h2>
          <p className={juntar(texto.auxiliar, "mt-1 leading-5")}>Escolha um modelo pronto e ajuste com as suas palavras.</p>
          <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            {MODELOS.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={ocupado}
                onClick={() => void usarModelo(m)}
                className={juntar(superficie.painel, foco, "flex min-w-0 items-start p-4 text-left transition-colors hover:border-primary/50 disabled:opacity-60")}
                data-modelo={m.id}
              >
                <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-primary">{ICONE_DO_MODELO[m.id]}</span>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.tituloSecao, "block truncate")}>{m.titulo}</span>
                  <span className={juntar(texto.auxiliar, "mt-0.5 block leading-5")}>{m.resumo}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex min-w-0 flex-wrap items-center">
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={ocupado} onClick={() => void novaPagina(null)} data-pagina-em-branco="">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Página em branco
            </button>
            {arquivadas.length > 0 && (
              <button type="button" className={botao.discreto} onClick={() => setVendoArquivadas(true)}>Arquivadas ({arquivadas.length})</button>
            )}
          </div>
        </div>
        {janelas}
      </div>
    );
  }

  return (
    <div className={juntar("min-w-0", !listaRecolhida && "lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-x-8")} data-espaco-da-conta="">
      {/* Árvore: no celular é a tela inteira até abrir uma página. */}
      <aside className={juntar("min-w-0", paginaId ? "hidden" : "block", listaRecolhida ? "lg:hidden" : "lg:block")} aria-label="Páginas do Espaço" data-arvore-do-espaco="">
        <div className="mb-2 flex min-w-0 items-center">
          <h2 className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>Páginas</h2>
          <button type="button" className={botao.icone} aria-label="Nova página" title="Nova página" disabled={ocupado} onClick={() => void novaPagina(null)} data-nova-pagina="">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <MenuMais rotulo="Modelos e arquivadas" itens={itensDoTopo} />
          <button type="button" className={juntar(botao.icone, "hidden lg:inline-flex")} aria-label="Recolher a lista de páginas" title="Recolher a lista de páginas" onClick={() => setListaRecolhida(true)}>
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {linhas.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhuma página ativa." acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void novaPagina(null)}>Nova página</button>} />
        ) : (
          <ul className="-mx-1 min-w-0" data-lista-de-paginas="">
            {linhas.map((no) => (
              <LinhaDaArvore
                key={no.pagina.id}
                no={no}
                ativa={no.pagina.id === paginaId}
                recolhida={recolhidas.indexOf(no.pagina.id) >= 0}
                aoAbrir={() => abrir(no.pagina.id)}
                aoAlternar={() => setRecolhidas((antes) => (antes.indexOf(no.pagina.id) >= 0 ? antes.filter((x) => x !== no.pagina.id) : antes.concat([no.pagina.id])))}
                itens={itensDaPagina(no.pagina)}
              />
            ))}
          </ul>
        )}
      </aside>

      {/* Página: no celular abre por cima da lista. */}
      <section className={juntar("min-w-0", paginaId ? "block" : "hidden lg:block")} aria-label="Página" data-pagina-do-espaco="">
        {paginaId ? (
          <PaginaAberta
            key={paginaId}
            id={paginaId}
            paginas={paginas}
            quem={quem}
            estado={estado}
            versoesMinhas={versoesMinhas}
            pedidoDeTitulo={pedidoDeTitulo}
            listaRecolhida={listaRecolhida}
            aoMostrarLista={() => setListaRecolhida(false)}
            aoSalvar={trocarNaLista}
            aoVoltar={() => abrir(null)}
            aoAbrir={(id) => abrir(id)}
            aoRestaurar={(p) => void restaurar(p)}
            itensDaPagina={itensDaPagina}
          />
        ) : (
          <div className="min-w-0">
            {listaRecolhida && (
              <button type="button" className={botao.icone} aria-label="Mostrar a lista de páginas" title="Mostrar a lista de páginas" onClick={() => setListaRecolhida(false)}>
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <EstadoVazio icone={<FileText className="h-5 w-5" />} titulo="Escolha uma página" descricao="Ou crie uma nova na lista ao lado." />
          </div>
        )}
      </section>
      {janelas}
    </div>
  );
}

// --------------------------------------------------------------------------
// Árvore
// --------------------------------------------------------------------------

function LinhaDaArvore({ no, ativa, recolhida, aoAbrir, aoAlternar, itens }: { no: NoDaArvore; ativa: boolean; recolhida: boolean; aoAbrir: () => void; aoAlternar: () => void; itens: ItemDoMenu[] }) {
  const p = no.pagina;
  const titulo = tituloDaPagina(p);
  return (
    <li className="min-w-0" data-pagina={p.id} data-nivel={no.nivel}>
      <div className={juntar("flex min-w-0 items-center rounded-md pr-0.5 transition-colors", ativa ? "bg-muted" : "hover:bg-muted/50")} style={{ paddingLeft: Math.min(no.nivel, 6) * 14 }}>
        {no.filhos.length > 0 ? (
          <button
            type="button"
            data-compacto=""
            aria-expanded={!recolhida}
            aria-label={recolhida ? `Mostrar as páginas de ${titulo}` : `Recolher as páginas de ${titulo}`}
            onClick={aoAlternar}
            className={juntar("flex h-7 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground", foco)}
          >
            {recolhida ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}
        <button type="button" onClick={aoAbrir} aria-current={ativa ? "page" : undefined} className={juntar("flex min-w-0 flex-1 items-center rounded-md py-1.5 pr-1 text-left text-[13px] leading-5 text-foreground", foco, ativa && "font-medium")}>
          <IconeDaPagina icone={p.icone} />
          <span className="ml-2 min-w-0 flex-1 truncate">{titulo}</span>
          {p.visivel_para !== "todos" && (
            <span className="ml-1.5 shrink-0 text-muted-foreground" title={ROTULO_DE_QUEM_VE[p.visivel_para]}>
              <Lock className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{ROTULO_DE_QUEM_VE[p.visivel_para]}</span>
            </span>
          )}
        </button>
        <MenuMais itens={itens} rotulo={`Ações de ${titulo}`} className="h-7 w-7" />
      </div>
    </li>
  );
}

// --------------------------------------------------------------------------
// Página aberta
// --------------------------------------------------------------------------

interface PropsDaPagina {
  id: string;
  paginas: PaginaDoEspaco[];
  quem: QuemOlha;
  estado: EstadoDoProduto;
  versoesMinhas: MutableRefObject<Record<string, number>>;
  pedidoDeTitulo: number;
  listaRecolhida: boolean;
  aoMostrarLista: () => void;
  aoSalvar: (p: PaginaDoEspaco) => void;
  aoVoltar: () => void;
  aoAbrir: (id: string) => void;
  aoRestaurar: (p: PaginaDoEspaco) => void;
  itensDaPagina: (p: PaginaDoEspaco) => ItemDoMenu[];
}

type Carga = { estado: "carregando" } | { estado: "erro"; frase: string } | { estado: "sumiu" } | { estado: "pronta"; pagina: PaginaCompleta };

/** Busca a página (com o conteúdo) e entrega ao editor. Recarregar monta tudo de novo. */
function PaginaAberta(props: PropsDaPagina) {
  const { id, aoVoltar, listaRecolhida, aoMostrarLista } = props;
  const [carga, setCarga] = useState<Carga>({ estado: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCarga({ estado: "carregando" });
    abrirPagina(id)
      .then((p) => {
        if (vivo) setCarga(p ? { estado: "pronta", pagina: p } : { estado: "sumiu" });
      })
      .catch((e) => {
        if (vivo) setCarga({ estado: "erro", frase: fraseDoErroDoEspaco(e, "Não foi possível abrir a página.") });
      });
    return () => {
      vivo = false;
    };
  }, [id, tentativa]);

  if (carga.estado === "pronta") return <PaginaPronta key={`${id}:${tentativa}`} {...props} pagina={carga.pagina} aoRecarregar={() => setTentativa((n) => n + 1)} />;

  return (
    <div className="min-w-0">
      <div className="mb-4 flex min-w-0 items-center">
        <button type="button" className={juntar(botao.icone, "mr-1 lg:hidden")} aria-label="Voltar para as páginas" onClick={aoVoltar}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        {listaRecolhida && (
          <button type="button" className={juntar(botao.icone, "mr-1 hidden lg:inline-flex")} aria-label="Mostrar a lista de páginas" onClick={aoMostrarLista}>
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {carga.estado === "carregando" && <Carregando forma="lista" linhas={5} rotulo="Abrindo a página" className="mx-auto max-w-[760px]" />}
      {carga.estado === "erro" && (
        <EstadoDeErro titulo={carga.frase} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button>} />
      )}
      {carga.estado === "sumiu" && (
        <EstadoVazio
          icone={<FileText className="h-5 w-5" />}
          titulo="Página não encontrada"
          descricao="Ela pode ter sido excluída, ou você não tem acesso a ela."
          acao={<button type="button" className={botao.secundario} onClick={aoVoltar}>Ver as páginas</button>}
        />
      )}
    </div>
  );
}

type Situacao = "salvo" | "pendente" | "salvando" | "erro" | "conflito";

function PaginaPronta({
  id,
  pagina,
  paginas,
  quem,
  estado,
  versoesMinhas,
  pedidoDeTitulo,
  listaRecolhida,
  aoMostrarLista,
  aoSalvar,
  aoVoltar,
  aoAbrir,
  aoRestaurar,
  aoRecarregar,
  itensDaPagina,
}: PropsDaPagina & { pagina: PaginaCompleta; aoRecarregar: () => void }) {
  // O que a lista sabe da página agora (movida, arquivada); o conteúdo é o que foi aberto.
  const daLista = paginas.filter((p) => p.id === id)[0] || pagina;
  const arquivada = estaArquivada(paginas, id) || !!daLista.arquivada_em;
  const editavel = podeEditar(pagina, quem) && !arquivada;

  const [titulo, setTitulo] = useState(pagina.titulo);
  const [icone, setIcone] = useState<string | null>(pagina.icone);
  const [visivel, setVisivel] = useState<VisivelPara>(pagina.visivel_para);
  const [situacao, setSituacao] = useState<Situacao>("salvo");
  const [fraseDoErro, setFraseDoErro] = useState("");
  const [atualizada, setAtualizada] = useState({ em: pagina.atualizado_em, por: pagina.atualizado_por });
  const [escolhendoIcone, setEscolhendoIcone] = useState(false);
  const [focoNoTexto, setFocoNoTexto] = useState(0);

  // --- salvamento automático: junta as mudanças, espera a pessoa parar e grava uma de cada vez.
  const versao = useRef(pagina.versao);
  const pendente = useRef<MudancasDaPagina>({});
  const relogio = useRef<number | null>(null);
  const gravando = useRef(false);
  const parado = useRef(false);
  const montado = useRef(true);
  const aoSalvarAtual = useRef(aoSalvar);
  aoSalvarAtual.current = aoSalvar;

  const gravar = useCallback(
    async (porCima = false) => {
      if (relogio.current !== null) {
        window.clearTimeout(relogio.current);
        relogio.current = null;
      }
      if (gravando.current || (parado.current && !porCima)) return;
      const mudancas = pendente.current;
      if (Object.keys(mudancas).length === 0) return;
      pendente.current = {};
      gravando.current = true;
      if (montado.current) setSituacao("salvando");
      const minha = versoesMinhas.current[id] || 0;
      if (minha > versao.current) versao.current = minha;
      const tentar = (v: number | undefined) => salvarPagina(id, mudancas, v);
      try {
        let nova: PaginaDoEspaco;
        try {
          nova = await tentar(porCima ? undefined : versao.current);
        } catch (e) {
          // Esta mesma tela moveu ou arquivou a página enquanto o texto era gravado: segue da versão dela.
          const depois = versoesMinhas.current[id] || 0;
          if (e instanceof ErroDoEspaco && e.codigo === "conflito" && depois > versao.current) {
            versao.current = depois;
            nova = await tentar(depois);
          } else throw e;
        }
        versao.current = nova.versao;
        parado.current = false;
        gravando.current = false;
        aoSalvarAtual.current(nova);
        if (!montado.current) return;
        setAtualizada({ em: nova.atualizado_em, por: nova.atualizado_por });
        if (Object.keys(pendente.current).length > 0) {
          relogio.current = window.setTimeout(() => void gravar(), 600);
        } else setSituacao("salvo");
      } catch (e) {
        gravando.current = false;
        // O que não foi gravado volta para a fila (o que veio depois vale por cima).
        pendente.current = { ...mudancas, ...pendente.current };
        const conflito = e instanceof ErroDoEspaco && e.codigo === "conflito";
        if (conflito || (e instanceof ErroDoEspaco && e.codigo === "sem_permissao")) parado.current = true;
        if (!montado.current) return;
        setFraseDoErro(fraseDoErroDoEspaco(e, "Não foi possível salvar. Confira a conexão."));
        setSituacao(conflito ? "conflito" : "erro");
      }
    },
    [id, versoesMinhas],
  );

  const mudar = useCallback(
    (mudancas: MudancasDaPagina, espera = 900) => {
      pendente.current = { ...pendente.current, ...mudancas };
      if (parado.current) return;
      setSituacao((s) => (s === "salvando" ? s : "pendente"));
      if (relogio.current !== null) window.clearTimeout(relogio.current);
      relogio.current = window.setTimeout(() => void gravar(), espera);
    },
    [gravar],
  );

  // Sair da página, trocar de aba ou fechar: grava o que faltava.
  useEffect(() => {
    montado.current = true;
    const aoEsconder = () => {
      if (document.visibilityState === "hidden") void gravar();
    };
    const aoSair = (e: BeforeUnloadEvent) => {
      if (Object.keys(pendente.current).length > 0 || gravando.current) {
        void gravar();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", aoEsconder);
    window.addEventListener("beforeunload", aoSair);
    return () => {
      montado.current = false;
      document.removeEventListener("visibilitychange", aoEsconder);
      window.removeEventListener("beforeunload", aoSair);
      void gravar();
    };
  }, [gravar]);

  // --- título
  const campoDoTitulo = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = campoDoTitulo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [titulo, editavel]);
  const primeiroPedido = useRef(pedidoDeTitulo);
  useEffect(() => {
    const el = campoDoTitulo.current;
    if (!el) return;
    // Página nova nasce com o cursor no título; "Renomear" na árvore traz o cursor para cá.
    if (pedidoDeTitulo !== primeiroPedido.current || (!pagina.titulo && editavel)) {
      el.focus();
      if (pedidoDeTitulo !== primeiroPedido.current) el.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoDeTitulo]);

  const trilha = useMemo(() => trilhaDaPagina(paginas, id), [paginas, id]);
  const acima = trilha.slice(0, -1);
  const filhas = useMemo(() => achatarArvore(montarArvore(paginas)).filter((n) => n.pagina.pai_id === id), [paginas, id]);
  const opcoes = visibilidadesPermitidas(pagina, quem);
  const autor = estado.equipe.filter((m) => m.user_id && m.user_id === atualizada.por)[0];
  const itens = arquivada ? [] : itensDaPagina({ ...daLista, titulo, icone, visivel_para: visivel }).filter((i) => i.rotulo !== "Renomear");

  return (
    <article className="min-w-0" data-pagina-aberta={id} data-editavel={editavel ? "sim" : "nao"}>
      <div className="mb-4 flex min-w-0 items-center">
        <button type="button" className={juntar(botao.icone, "mr-1 lg:hidden")} aria-label="Voltar para as páginas" onClick={aoVoltar}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        {listaRecolhida && (
          <button type="button" className={juntar(botao.icone, "mr-1 hidden lg:inline-flex")} aria-label="Mostrar a lista de páginas" title="Mostrar a lista de páginas" onClick={aoMostrarLista}>
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <nav aria-label="Caminho da página" className="min-w-0 flex-1" data-trilha="">
          <ol className="flex min-w-0 items-center text-[12px] leading-4 text-muted-foreground">
            <li className="hidden shrink-0 sm:block">
              <button type="button" data-compacto="" className={juntar("rounded px-1 py-0.5 hover:text-foreground", foco)} onClick={aoVoltar}>Espaço</button>
            </li>
            {acima.map((p) => (
              <li key={p.id} className="hidden min-w-0 items-center sm:flex">
                <span className="mx-0.5 shrink-0" aria-hidden="true">/</span>
                <button type="button" data-compacto="" className={juntar("max-w-[160px] truncate rounded px-1 py-0.5 hover:text-foreground", foco)} onClick={() => aoAbrir(p.id)}>{tituloDaPagina(p)}</button>
              </li>
            ))}
            <li className="flex min-w-0 items-center" aria-current="page">
              <span className="mx-0.5 hidden shrink-0 sm:inline" aria-hidden="true">/</span>
              <span className="min-w-0 truncate px-1 text-foreground">{tituloDaPagina({ titulo })}</span>
            </li>
          </ol>
        </nav>
        <span role="status" aria-live="polite" className="ml-3 flex shrink-0 items-center text-[12px] leading-4 text-muted-foreground" data-situacao={editavel ? situacao : "leitura"}>
          {!editavel ? (
            <>
              <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Só leitura
            </>
          ) : situacao === "salvo" ? (
            <>
              <Check className="mr-1 h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Salvo
            </>
          ) : situacao === "erro" ? (
            <button type="button" data-compacto="" className={juntar("rounded px-1 py-0.5 text-destructive underline underline-offset-2", foco)} title={fraseDoErro} onClick={() => void gravar()}>Não salvou. Tentar de novo</button>
          ) : situacao === "conflito" ? (
            "Não salvo"
          ) : (
            "Salvando..."
          )}
        </span>
        <MenuMais itens={itens} rotulo="Ações da página" className="ml-1" />
      </div>

      <div className="mx-auto min-w-0 max-w-[760px]">
        {arquivada && (
          <div className={juntar(superficie.poco, "mb-4 flex min-w-0 items-center px-3 py-2")} data-aviso-arquivada="">
            <p className={juntar(texto.corpo, "mr-3 min-w-0 flex-1")}>Esta página está arquivada.</p>
            {podeEditar(pagina, quem) && !!daLista.arquivada_em && (
              <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => aoRestaurar(daLista)}>Restaurar</button>
            )}
          </div>
        )}
        {situacao === "erro" && fraseDoErro && (
          <p role="alert" className="mb-3 text-[12px] leading-4 text-destructive" data-aviso-de-erro="">{fraseDoErro}</p>
        )}
        {situacao === "conflito" && (
          <div role="alert" className="mb-4 flex min-w-0 flex-wrap items-center rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2" data-aviso-conflito="">
            <p className={juntar(texto.corpo, "mr-3 min-w-0 flex-1")}>Outra pessoa alterou esta página enquanto você escrevia.</p>
            <button type="button" className={juntar(botao.secundario, "mr-2 h-8")} onClick={aoRecarregar}>Ver a versão nova</button>
            <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => void gravar(true)}>Manter a minha</button>
          </div>
        )}

        <div className="flex min-w-0 items-start">
          {editavel ? (
            <Popover open={escolhendoIcone} onOpenChange={setEscolhendoIcone}>
              <PopoverTrigger asChild>
                <button type="button" data-compacto="" aria-label="Escolher o ícone da página" title="Ícone da página" className={juntar("mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted", foco)} data-icone-da-pagina="">
                  <IconeDaPagina icone={icone} grande />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[308px] p-2">
                <div className="grid grid-cols-8 gap-1" role="group" aria-label="Ícones">
                  {ICONES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      data-compacto=""
                      aria-label={`Ícone ${e}`}
                      aria-pressed={icone === e}
                      className={juntar("flex h-8 w-8 items-center justify-center rounded-md text-[20px] leading-none hover:bg-muted", foco, icone === e && "bg-muted")}
                      onClick={() => {
                        setIcone(e);
                        mudar({ icone: e }, 200);
                        setEscolhendoIcone(false);
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                {icone && (
                  <button
                    type="button"
                    className={juntar(botao.discreto, "mt-1 h-8 w-full")}
                    onClick={() => {
                      setIcone(null);
                      mudar({ icone: null }, 200);
                      setEscolhendoIcone(false);
                    }}
                  >
                    Sem ícone
                  </button>
                )}
              </PopoverContent>
            </Popover>
          ) : (
            icone && <span className="mr-2 shrink-0"><IconeDaPagina icone={icone} grande /></span>
          )}
          {editavel ? (
            <textarea
              ref={campoDoTitulo}
              rows={1}
              value={titulo}
              maxLength={LIMITE_DO_TITULO}
              placeholder="Sem título"
              aria-label="Título da página"
              spellCheck
              onChange={(e) => {
                const v = e.target.value.replace(/[\r\n]+/g, " ");
                setTitulo(v);
                mudar({ titulo: v });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || (e.key === "ArrowDown" && e.currentTarget.selectionStart === titulo.length)) {
                  e.preventDefault();
                  setFocoNoTexto((n) => n + 1);
                }
              }}
              className="espaco-titulo block min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 text-[24px] font-semibold leading-8 tracking-[-0.01em] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0"
              data-titulo-da-pagina=""
            />
          ) : (
            <h2 className="espaco-titulo min-w-0 flex-1 text-[24px] font-semibold leading-8 tracking-[-0.01em] text-foreground" data-titulo-da-pagina="">{tituloDaPagina({ titulo })}</h2>
          )}
        </div>

        <div className="mb-5 mt-2 flex min-w-0 flex-wrap items-center text-[12px] leading-4 text-muted-foreground">
          {editavel && opcoes.length > 1 ? (
            <label className="mr-3 flex shrink-0 items-center">
              <span className="mr-1.5">Quem vê</span>
              <select
                value={visivel}
                title={AJUDA_DE_QUEM_VE[visivel]}
                onChange={(e) => {
                  const v = e.target.value as VisivelPara;
                  setVisivel(v);
                  mudar({ visivel_para: v }, 200);
                }}
                className={juntar("h-7 rounded-md border border-border bg-background px-1.5 text-[12px] text-foreground", foco)}
                data-quem-ve=""
              >
                {(opcoes.indexOf(visivel) >= 0 ? opcoes : opcoes.concat([visivel])).map((o) => (
                  <option key={o} value={o}>{ROTULO_DE_QUEM_VE[o]}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="mr-3 flex shrink-0 items-center" title={AJUDA_DE_QUEM_VE[visivel]} data-quem-ve="">
              {visivel !== "todos" && <Lock className="mr-1 h-3 w-3" aria-hidden="true" />}
              {ROTULO_DE_QUEM_VE[visivel]}
            </span>
          )}
          {atualizada.em && (
            <span className="min-w-0 truncate">
              Atualizada em {quando(atualizada.em)}
              {autor ? ` por ${autor.nome}` : ""}
            </span>
          )}
        </div>

        <Suspense fallback={<Carregando forma="lista" linhas={4} rotulo="Abrindo o editor" />}>
          <EditorDaPagina conteudo={pagina.conteudo} editavel={editavel} aoMudar={(doc: DocDoEditor) => mudar({ conteudo: doc })} pedidoDeFoco={focoNoTexto} />
        </Suspense>

        {filhas.length > 0 && (
          <nav aria-label="Páginas dentro desta" className="mt-2 border-t border-border pt-4" data-paginas-de-dentro="">
            <p className={juntar(texto.rotulo, "mb-1")}>Páginas dentro desta</p>
            <ul className={lista.aberta}>
              {filhas.map((n) => (
                <li key={n.pagina.id} className="min-w-0">
                  <button type="button" className={juntar(lista.linha, foco, "w-full text-left text-[13px] text-foreground")} onClick={() => aoAbrir(n.pagina.id)}>
                    <IconeDaPagina icone={n.pagina.icone} />
                    <span className="ml-2 min-w-0 flex-1 truncate">{tituloDaPagina(n.pagina)}</span>
                    <ChevronRight className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </article>
  );
}

// --------------------------------------------------------------------------
// Janelas
// --------------------------------------------------------------------------

function JanelaDeRenomear({ pagina, ocupado, onFechar, aoSalvar }: { pagina: PaginaDoEspaco | null; ocupado: boolean; onFechar: () => void; aoSalvar: (titulo: string) => void }) {
  const [titulo, setTitulo] = useState("");
  useEffect(() => {
    if (pagina) setTitulo(pagina.titulo);
  }, [pagina]);
  return (
    <JanelaCentral
      aberta={!!pagina}
      onFechar={onFechar}
      largura="sm"
      titulo="Renomear página"
      rodape={
        <>
          <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={onFechar}>Cancelar</button>
          <button type="submit" form="espaco-renomear" className={botao.primario} disabled={ocupado}>{ocupado ? "Salvando..." : "Salvar"}</button>
        </>
      }
    >
      <form
        id="espaco-renomear"
        onSubmit={(e) => {
          e.preventDefault();
          aoSalvar(titulo);
        }}
      >
        <label htmlFor="espaco-renomear-titulo" className={texto.rotulo}>Título</label>
        <input id="espaco-renomear-titulo" className={juntar(campo, "mt-1.5")} value={titulo} maxLength={LIMITE_DO_TITULO} onChange={(e) => setTitulo(e.target.value)} placeholder="Sem título" autoComplete="off" />
      </form>
    </JanelaCentral>
  );
}

function JanelaDeMover({ pagina, paginas, ocupado, onFechar, aoEscolher }: { pagina: PaginaDoEspaco | null; paginas: PaginaDoEspaco[]; ocupado: boolean; onFechar: () => void; aoEscolher: (destino: string | null) => void }) {
  const destinos = useMemo(() => (pagina ? destinosParaMover(paginas, pagina.id) : []), [pagina, paginas]);
  const paiAtual = pagina ? pagina.pai_id : null;
  const linha = (chave: string, destino: string | null, nivel: number, conteudo: ReactNode) => {
    const aqui = (destino || null) === (paiAtual || null);
    return (
      <li key={chave} className="min-w-0">
        <button
          type="button"
          disabled={ocupado || aqui}
          onClick={() => aoEscolher(destino)}
          className={juntar(lista.linha, foco, "w-full text-left text-[13px] text-foreground disabled:opacity-60")}
          style={{ paddingLeft: 8 + Math.min(nivel, 6) * 14 }}
          data-destino={destino || "topo"}
        >
          {conteudo}
          {aqui && <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>Está aqui</span>}
        </button>
      </li>
    );
  };
  return (
    <JanelaCentral aberta={!!pagina} onFechar={onFechar} largura="sm" titulo={pagina ? `Mover ${tituloDaPagina(pagina)} para` : "Mover para"}>
      <ul className="min-w-0" data-destinos="">
        {linha("topo", null, 0, <span className="min-w-0 flex-1 truncate font-medium">Topo do Espaço</span>)}
        {destinos.map((n) =>
          linha(
            n.pagina.id,
            n.pagina.id,
            n.nivel,
            <>
              <IconeDaPagina icone={n.pagina.icone} />
              <span className="ml-2 min-w-0 flex-1 truncate">{tituloDaPagina(n.pagina)}</span>
            </>,
          ),
        )}
      </ul>
    </JanelaCentral>
  );
}

function JanelaDasArquivadas({
  aberta,
  arquivadas,
  quem,
  ocupado,
  onFechar,
  aoRestaurar,
  aoExcluir,
}: {
  aberta: boolean;
  arquivadas: PaginaDoEspaco[];
  quem: QuemOlha;
  ocupado: boolean;
  onFechar: () => void;
  aoRestaurar: (p: PaginaDoEspaco) => void;
  aoExcluir: (p: PaginaDoEspaco) => void;
}) {
  const [confirmando, setConfirmando] = useState<string | null>(null);
  useEffect(() => {
    if (!aberta) setConfirmando(null);
  }, [aberta]);
  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      largura="md"
      titulo="Páginas arquivadas"
      ajuda="Restaurar traz a página de volta para a lista, com as páginas que estão dentro dela. Excluir apaga de vez a página e tudo o que está dentro, inclusive páginas de outras pessoas."
    >
      {arquivadas.length === 0 ? (
        <EstadoVazio icone={<Archive className="h-5 w-5" />} titulo="Nenhuma página arquivada" />
      ) : (
        <ul className={juntar(lista.divisoria, "min-w-0")} data-arquivadas="">
          {arquivadas.map((p) => {
            const edita = podeEditar(p, quem);
            return (
              <li key={p.id} className="flex min-w-0 flex-wrap items-center py-2.5">
                <IconeDaPagina icone={p.icone} />
                <div className="ml-2 mr-3 min-w-0 flex-1">
                  <p className={juntar(texto.corpo, "truncate")}>{tituloDaPagina(p)}</p>
                  <p className={texto.auxiliar}>{confirmando === p.id ? "Excluir de vez, com as páginas de dentro?" : `Arquivada em ${quando(p.arquivada_em || "")}`}</p>
                </div>
                {edita && confirmando !== p.id && (
                  <>
                    <button type="button" className={juntar(botao.secundario, "mr-1 h-8")} disabled={ocupado} onClick={() => aoRestaurar(p)}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Restaurar
                    </button>
                    <button type="button" className={botao.icone} aria-label={`Excluir ${tituloDaPagina(p)}`} title="Excluir de vez" disabled={ocupado} onClick={() => setConfirmando(p.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                )}
                {edita && confirmando === p.id && (
                  <>
                    <button type="button" className={juntar(botao.secundario, "mr-1 h-8")} onClick={() => setConfirmando(null)}>Manter</button>
                    <button type="button" className={juntar(botao.perigo, "h-8")} disabled={ocupado} onClick={() => aoExcluir(p)}>Excluir</button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </JanelaCentral>
  );
}
