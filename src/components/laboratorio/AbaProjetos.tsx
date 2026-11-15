import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Copy, FolderOpen, Loader2, Plus, SearchX, Trash2, Workflow } from "lucide-react";
import { CampoDeBusca, Carregando, EstadoDeErro, SeletorCompacto, botao, espaco, juntar, texto, useEstadoDaTela, type OpcaoCompacta } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { arquivarProjeto, chaveDosProjetos, criarProjeto, listarProjetos, type ProjetoDoLab } from "@/lib/laboratorio/api";
import { duplicarProjeto } from "@/lib/laboratorio/duplicar";
import EditorDoProjeto from "./EditorDoProjeto";
import { CartaoDeProjeto } from "./CartaoDeProjeto";
import JanelaDeExcluirProjeto from "./JanelaDeExcluirProjeto";
import { nomeDoCliente, type ClienteDoLab } from "./Seletores";
import { ZonaVazia } from "./visual";

/**
 * Projetos do Laboratório. Tocar num projeto abre direto o canvas grande
 * (com o Canvas Studio no topo); "Novo projeto em branco" cria e já abre o
 * canvas vazio, pronto para o pedido.
 *
 * 21/10/2026 (pedido do dono): grade de cartões com a miniatura do canvas,
 * nome, cliente, data e número de nós; busca e filtro (Todos, Livres, por
 * cliente), lembrados por useEstadoDaTela; ações por cartão no "...": abrir,
 * duplicar, arquivar e excluir (com confirmação; os arquivos ficam).
 */

/** Filtro da lista: "todos", "livres" ou o id do cliente. */
export type FiltroDeProjetos = string;

/** Sem acento e em minúsculas (busca que acha "cafe" em "Café"). */
function simples(v: string): string {
  return (v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Ativos, do filtro e da busca (nome ou cliente), do mais recente para o mais antigo. */
export function filtrarProjetos(lista: ProjetoDoLab[], busca: string, filtro: FiltroDeProjetos, clientes: ClienteDoLab[] = []): ProjetoDoLab[] {
  const termo = simples(busca.trim());
  return lista
    .filter((p) => p.status === "ativo")
    .filter((p) => (filtro === "livres" ? !p.client_id : filtro && filtro !== "todos" ? p.client_id === filtro : true))
    .filter((p) => !termo || simples(`${p.nome} ${nomeDoCliente(clientes, p.client_id, p.cliente_nome || "Livre")}`).indexOf(termo) >= 0)
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

/** Opções do filtro: Todos, Livres e os clientes que têm projeto na lista. */
export function opcoesDoFiltro(lista: ProjetoDoLab[], clientes: ClienteDoLab[]): OpcaoCompacta[] {
  const ativos = lista.filter((p) => p.status === "ativo");
  const vistos: Record<string, string> = {};
  ativos.forEach((p) => {
    if (p.client_id && !vistos[p.client_id]) vistos[p.client_id] = nomeDoCliente(clientes, p.client_id, p.cliente_nome || "Cliente");
  });
  const porCliente = Object.keys(vistos)
    .map((id) => ({ valor: id, rotulo: vistos[id], contador: ativos.filter((p) => p.client_id === id).length }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo));
  return [
    { valor: "todos", rotulo: "Todos", contador: ativos.length },
    { valor: "livres", rotulo: "Livres", contador: ativos.filter((p) => !p.client_id).length },
  ].concat(porCliente);
}

export default function AbaProjetos({
  projetoAberto,
  onAbrir,
  clienteId,
  clientes,
  telaCheia,
  onTelaCheia,
  creditos,
}: {
  projetoAberto: string | null;
  onAbrir: (id: string | null) => void;
  clienteId: string | null;
  clientes: ClienteDoLab[];
  telaCheia?: boolean;
  onTelaCheia?: (v: boolean) => void;
  /** O chip de créditos do cabeçalho: com o projeto aberto ele mora na barra do editor. */
  creditos?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: chaveDosProjetos, queryFn: listarProjetos, enabled: !projetoAberto });
  const [criando, setCriando] = useState(false);
  const [busca, setBusca] = useEstadoDaTela<string>("laboratorio:projetos:busca", "", { validar: (v) => typeof v === "string" });
  const [filtro, setFiltro] = useEstadoDaTela<string>("laboratorio:projetos:filtro", "todos", { validar: (v) => typeof v === "string" });
  const [excluir, setExcluir] = useState<{ id: string; nome: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  if (projetoAberto) return <EditorDoProjeto projetoId={projetoAberto} clientes={clientes} onVoltar={() => onAbrir(null)} onAbrirOutro={(id) => onAbrir(id)} telaCheia={telaCheia} onTelaCheia={onTelaCheia} creditos={creditos} />;

  const novo = async () => {
    setCriando(true);
    try {
      const p = await criarProjeto({ nome: "Projeto novo", client_id: clienteId });
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
      onAbrir(p.id);
    } catch (e) {
      toast.error("Não deu para criar o projeto", { description: textoDoErro(e) });
    } finally {
      setCriando(false);
    }
  };

  const duplicar = async (p: ProjetoDoLab) => {
    setOcupado(p.id);
    try {
      const copia = await duplicarProjeto(p.id, p.client_id, "cópia");
      toast.success("Projeto duplicado", { description: `${copia.nome}: mesmo canvas, sem saídas nem mídias.` });
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
    } catch (e) {
      toast.error("Não deu para duplicar", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const arquivar = async (p: ProjetoDoLab) => {
    setOcupado(p.id);
    try {
      await arquivarProjeto(p.id);
      toast.success("Projeto arquivado");
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
    } catch (e) {
      toast.error("Não deu para arquivar", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const todos = q.data || [];
  const ativos = todos.filter((p) => p.status === "ativo");
  const opcoes = opcoesDoFiltro(todos, clientes);
  // Filtro guardado de um cliente que não tem mais projeto: volta para Todos.
  const filtroValido = opcoes.some((o) => o.valor === filtro) ? filtro : "todos";
  const visiveis = filtrarProjetos(todos, busca, filtroValido, clientes);

  return (
    <div className={espaco.pagina} data-aba-projetos="">
      {/*
        v4 (15/11/2026): título com o trio de números sem cartão (ativos, nós, clientes), a ação principal à
        direita, busca e filtro numa faixa branca em pílula, e a grade de cartões com capa de altura fixa.
        Os números ficam com o lugar reservado enquanto a lista carrega (nada empurra depois).
      */}
      <div className="flex min-w-0 flex-wrap items-center">
        <h2 className={juntar(texto.tituloSecao, "mr-6 shrink-0")}>Projetos</h2>
        <dl className="order-3 mt-3 flex w-full min-w-0 items-end sm:order-none sm:mt-0 sm:w-auto sm:flex-1" data-numeros-dos-projetos="">
          {[
            { rotulo: "Ativos", valor: ativos.length },
            { rotulo: "Nós", valor: ativos.reduce((soma, p) => soma + (p.total_nos || 0), 0) },
            { rotulo: "Clientes", valor: Object.keys(ativos.reduce((m: Record<string, true>, p) => (p.client_id ? { ...m, [p.client_id]: true } : m), {})).length },
          ].map((n) => (
            <div key={n.rotulo} className="mr-8 min-w-0 last:mr-0">
              <dt className={juntar(texto.etiqueta, "text-muted-foreground")}>{n.rotulo}</dt>
              <dd className="text-[24px] font-medium leading-7 tracking-[-0.02em] tabular-nums text-foreground">{q.isLoading || q.isError ? "–" : n.valor}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className={juntar(botao.primario, "ml-auto h-10 px-4")} onClick={() => void novo()} disabled={criando} aria-label="Novo projeto em branco" title={`Cria um projeto vazio (${nomeDoCliente(clientes, clienteId)}) e abre o canvas`} data-novo-projeto-em-branco="">
          {criando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Novo projeto<span className="hidden sm:inline">&nbsp;em branco</span>
        </button>
      </div>
      {q.isLoading ? (
        <Carregando forma="grade" rotulo="Lendo os projetos" />
      ) : q.isError ? (
        <EstadoDeErro titulo="Não deu para ler os projetos" descricao={textoDoErro(q.error)} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />
      ) : !ativos.length ? (
        <ZonaVazia icone={<Workflow className="h-5 w-5" />} titulo="Nenhum projeto ainda" descricao="Peça um na Início ou abra um canvas em branco." acao={<button type="button" className={botao.secundario} onClick={() => void novo()}>Abrir um canvas em branco</button>} className="py-16" />
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-center rounded-[22px] bg-card p-1.5 shadow-card sm:rounded-full" data-filtros-dos-projetos="">
            <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar por nome ou cliente" rotulo="Buscar projetos" className="w-full sm:mr-2 sm:w-[280px]" />
            <div className="mt-1.5 min-w-0 max-w-full sm:mt-0">
              <SeletorCompacto opcoes={opcoes} valor={filtroValido} onEscolher={setFiltro} rotulo="Filtrar projetos" listaQuandoNaoCabe />
            </div>
          </div>
          {!visiveis.length ? (
            <ZonaVazia
              icone={<SearchX className="h-5 w-5" />}
              titulo="Nenhum projeto com esse filtro"
              descricao="Troque a busca ou o filtro."
              acao={
                <button
                  type="button"
                  className={botao.secundario}
                  onClick={() => {
                    setBusca("");
                    setFiltro("todos");
                  }}
                >
                  Ver todos
                </button>
              }
            />
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-grade-de-projetos="">
              {visiveis.map((p) => (
                <CartaoDeProjeto
                  key={p.id}
                  projeto={p}
                  clientes={clientes}
                  onAbrir={() => onAbrir(p.id)}
                  acoes={[
                    { rotulo: "Abrir", icone: <FolderOpen className="h-4 w-4" />, aoEscolher: () => onAbrir(p.id) },
                    { rotulo: ocupado === p.id ? "Duplicando…" : "Duplicar", icone: <Copy className="h-4 w-4" />, aoEscolher: () => void duplicar(p) },
                    { rotulo: "Arquivar", icone: <Archive className="h-4 w-4" />, aoEscolher: () => void arquivar(p) },
                    { rotulo: "Excluir projeto", icone: <Trash2 className="h-4 w-4" />, perigo: true, aoEscolher: () => setExcluir({ id: p.id, nome: p.nome }) },
                  ]}
                />
              ))}
            </div>
          )}
        </>
      )}
      <JanelaDeExcluirProjeto projeto={excluir} onFechar={() => setExcluir(null)} />
    </div>
  );
}
