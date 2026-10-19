import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArrowLeft, BookmarkPlus, Check, LayoutGrid, LayoutList, Loader2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Play, RefreshCw, Workflow } from "lucide-react";
import { Carregando, EstadoDeErro, JanelaCentral, MenuMais, botao, campo, etiqueta, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { useModoFoco } from "@/lib/modoFoco";
import {
  arquivarProjeto,
  chaveDosProjetos,
  custoAConfirmar,
  ehConflitoDeVersao,
  estimar,
  executarNo,
  lerExecucoes,
  lerProjeto,
  rodarTudo,
  salvarProjeto,
  salvarTemplate,
  ultimaPorNo,
  type ExecucaoDoLab,
  type ProjetoDoLab,
} from "@/lib/laboratorio/api";
import {
  TIPOS_DE_NO,
  alvosDaBase,
  aplicarOperacoes,
  canvasVazio,
  criarNo,
  desligar,
  ligar,
  mudarDados,
  organizar,
  podeLigar,
  removerNo,
  type CanvasDoLab,
  type OperacaoDoAgente,
  type TipoDeNo,
} from "@/lib/laboratorio/nos";
import QuadroDoLab from "./QuadroDoLab";
import Paleta from "./Paleta";
import Inspetor from "./Inspetor";
import ModoListaDoLab from "./ModoListaDoLab";
import AgenteDoProjeto from "./AgenteDoProjeto";
import JanelaDeCusto, { type LinhaDeCusto } from "./JanelaDeCusto";
import { emAndamento } from "./ResultadoDoNo";
import { nomeDoCliente, type ClienteDoLab } from "./Seletores";

/**
 * Editor de um projeto do Laboratório: o canvas de nós (paleta, quadro,
 * inspetor), o "Rodar" por nó e o "Rodar tudo" (sempre `estimar` antes e o
 * custo numa janela; só roda depois do confirmar), salvar automático com
 * trava otimista (conflito avisa e oferece recarregar), tela cheia (modo
 * foco), modo lista no celular e o agente do projeto ao lado.
 */

type EstadoDoSalvar = "salvo" | "pendente" | "salvando" | "erro" | "conflito";
type Alvo = { tipo: "no"; id: string } | { tipo: "tudo" } | { tipo: "lista"; ids: string[]; titulo: string };

const ATRASO_DO_SALVAR_MS = 1500;
const VIGIA_MS = 3000;

function useAlturaDoEditor(ativo: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number>(600);
  useLayoutEffect(() => {
    if (!ativo) return;
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      const largura = window.innerWidth || 1024;
      if (largura < 1024) {
        setAltura(600);
        return;
      }
      const topo = el.getBoundingClientRect().top;
      setAltura(Math.max(480, Math.round((window.innerHeight || 800) - topo - 16)));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [ativo]);
  return { ref, altura };
}

function nomeDoNo(canvas: CanvasDoLab, id: string) {
  const n = canvas.nos.find((x) => x.id === id);
  if (!n) return "Nó";
  return `${TIPOS_DE_NO[n.tipo].rotulo} ${canvas.nos.filter((x) => x.tipo === n.tipo).indexOf(n) + 1}`;
}

function Editor({ projetoId, clientes, onVoltar }: { projetoId: string; clientes: ClienteDoLab[]; onVoltar: () => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["laboratorio", "projeto", projetoId], queryFn: () => lerProjeto(projetoId), staleTime: 0, gcTime: 0 });

  const [projeto, setProjeto] = useState<ProjetoDoLab | null>(null);
  const [canvas, setCanvas] = useState<CanvasDoLab>(canvasVazio);
  const [nome, setNome] = useState("");
  const [salvar, setSalvar] = useState<{ estado: EstadoDoSalvar; erro: string }>({ estado: "salvo", erro: "" });
  const [execucoes, setExecucoes] = useState<Record<string, ExecucaoDoLab>>({});
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [avisoDoQuadro, setAvisoDoQuadro] = useState<string | null>(null);
  const [custo, setCusto] = useState<{ alvo: Alvo; titulo: string; linhas: LinhaDeCusto[]; total: number } | null>(null);
  const [estimando, setEstimando] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [vigiar, setVigiar] = useState(false);
  const [cheia, setCheia] = useState(false);
  const [lista, setLista] = useState<boolean>(() => typeof window !== "undefined" && (window.innerWidth || 1024) < 768);
  const [largo, setLargo] = useState<boolean>(() => typeof window === "undefined" || (window.innerWidth || 1024) >= 1024);
  const [agente, setAgente] = useState<boolean>(() => typeof window === "undefined" || (window.innerWidth || 1024) >= 1280);
  const [salvarComo, setSalvarComo] = useState<string | null>(null);

  const atual = useRef<CanvasDoLab>(canvas);
  const versao = useRef(1);
  const nomeAtual = useRef("");
  const salvando = useRef<Promise<boolean> | null>(null);
  const carregado = useRef(false);

  useModoFoco("laboratorio", cheia);
  const { ref: refDoCorpo, altura } = useAlturaDoEditor(!lista && !cheia);

  useEffect(() => {
    const medir = () => setLargo((window.innerWidth || 1024) >= 1024);
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  const carregar = useCallback((p: ProjetoDoLab, execs: ExecucaoDoLab[]) => {
    setProjeto(p);
    setCanvas(p.canvas);
    atual.current = p.canvas;
    versao.current = p.versao;
    setNome(p.nome);
    nomeAtual.current = p.nome;
    setExecucoes(ultimaPorNo(execs));
    setSalvar({ estado: "salvo", erro: "" });
    if (execs.some((e) => emAndamento(e.status))) setVigiar(true);
  }, []);

  useEffect(() => {
    if (q.data && !carregado.current) {
      carregado.current = true;
      carregar(q.data.projeto, q.data.execucoes);
    }
  }, [q.data, carregar]);

  const mudar = useCallback((fn: (c: CanvasDoLab) => CanvasDoLab) => {
    const novo = fn(atual.current);
    if (novo === atual.current) return;
    atual.current = novo;
    setCanvas(novo);
    setSalvar((s) => (s.estado === "conflito" ? s : { estado: "pendente", erro: "" }));
  }, []);

  const salvarAgora = useCallback(async (): Promise<boolean> => {
    if (salvando.current) return salvando.current;
    const enviar = atual.current;
    setSalvar({ estado: "salvando", erro: "" });
    const p = (async () => {
      try {
        const salvo = await salvarProjeto({ id: projetoId, nome: nomeAtual.current, canvas: enviar, versao: versao.current });
        versao.current = salvo.versao;
        setSalvar({ estado: atual.current !== enviar ? "pendente" : "salvo", erro: "" });
        void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
        return true;
      } catch (e) {
        if (ehConflitoDeVersao(e)) {
          setSalvar({ estado: "conflito", erro: "O projeto mudou em outra aba." });
          toast.warning("O projeto mudou em outra aba", { description: "Recarregue para ver a versão salva. O que você mudou aqui não foi gravado." });
        } else setSalvar({ estado: "erro", erro: textoDoErro(e) });
        throw e;
      } finally {
        salvando.current = null;
      }
    })();
    salvando.current = p;
    return p;
  }, [projetoId, queryClient]);

  // Salvar automático 1,5 s depois da última mudança.
  useEffect(() => {
    if (salvar.estado !== "pendente" || !projeto) return;
    const id = window.setTimeout(() => {
      salvarAgora().catch(() => undefined);
    }, ATRASO_DO_SALVAR_MS);
    return () => window.clearTimeout(id);
  }, [canvas, nome, salvar.estado, salvarAgora, projeto]);

  const garantirSalvo = useCallback(async () => {
    if (salvar.estado === "conflito") throw new Error("O projeto mudou em outra aba. Recarregue antes de rodar.");
    if (salvar.estado === "salvo" && !salvando.current) return;
    await salvarAgora();
  }, [salvar.estado, salvarAgora]);

  const recarregar = async () => {
    const r = await q.refetch();
    if (r.data) {
      carregar(r.data.projeto, r.data.execucoes);
      toast.success("Projeto recarregado", { description: "Esta é a versão salva por último." });
    }
  };

  // Vigia das execuções: enquanto algo roda, lê o progresso a cada 3 s.
  const algoRodando = useMemo(() => Object.keys(execucoes).some((k) => emAndamento(execucoes[k].status)), [execucoes]);
  useEffect(() => {
    if (!vigiar && !algoRodando) return;
    let vivo = true;
    const id = window.setInterval(() => {
      lerExecucoes(projetoId)
        .then((l) => {
          if (!vivo) return;
          const ultimas = ultimaPorNo(l);
          setExecucoes((antes) => ({ ...antes, ...ultimas }));
          if (!l.some((e) => emAndamento(e.status))) setVigiar(false);
        })
        .catch(() => undefined);
    }, VIGIA_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [vigiar, algoRodando, projetoId]);

  // Esc sai da tela cheia.
  useEffect(() => {
    if (!cheia) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCheia(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cheia]);

  const por = useCallback(
    (tipo: TipoDeNo, pos?: { x: number; y: number }) => {
      const r = criarNo(atual.current, tipo, pos);
      if (!r.no) {
        toast.warning("O quadro está cheio", { description: r.erro });
        return;
      }
      mudar(() => r.canvas);
      setSelecionado(r.no.id);
    },
    [mudar],
  );

  const tentarLigar = useCallback(
    (de: string, para: string, doQuadro: boolean): string | null => {
      const v = podeLigar(atual.current, de, para);
      if (!v.ok) {
        if (doQuadro) setAvisoDoQuadro(v.motivo);
        return v.motivo;
      }
      mudar((c) => ligar(c, de, para));
      setAvisoDoQuadro(null);
      return null;
    },
    [mudar],
  );

  useEffect(() => {
    if (!avisoDoQuadro) return;
    const id = window.setTimeout(() => setAvisoDoQuadro(null), 7000);
    return () => window.clearTimeout(id);
  }, [avisoDoQuadro]);

  const pedirCusto = useCallback(
    async (alvo: Alvo) => {
      const chave = alvo.tipo === "no" ? alvo.id : alvo.tipo;
      setEstimando(chave);
      try {
        await garantirSalvo();
        const ids = alvo.tipo === "no" ? [alvo.id] : alvo.tipo === "lista" ? alvo.ids : undefined;
        const est = await estimar(projetoId, ids);
        const c = atual.current;
        const linhas = est.nos.map((x) => ({ id: x.no_id, nome: nomeDoNo(c, x.no_id), custo_usd: x.custo_usd }));
        const titulo = alvo.tipo === "no" ? `Rodar ${nomeDoNo(c, alvo.id)}` : alvo.tipo === "lista" ? alvo.titulo : "Rodar tudo";
        setCusto({ alvo, titulo, linhas, total: est.total_usd });
      } catch (e) {
        toast.error("Não deu para estimar o custo", { description: textoDoErro(e) });
      } finally {
        setEstimando(null);
      }
    },
    [garantirSalvo, projetoId],
  );

  const confirmar = async () => {
    if (!custo) return;
    setRodando(true);
    try {
      const alvo = custo.alvo;
      if (alvo.tipo === "no") {
        const ex = await executarNo(projetoId, alvo.id);
        setExecucoes((a) => ({ ...a, [alvo.id]: ex }));
      } else {
        const r = await rodarTudo(projetoId, alvo.tipo === "lista" ? alvo.ids : undefined);
        if (r.execucoes.length) setExecucoes((a) => ({ ...a, ...ultimaPorNo(r.execucoes) }));
      }
      setVigiar(true);
      setCusto(null);
      toast.success("Rodando", { description: "O estado aparece em cada nó. Falha não cobra." });
    } catch (e) {
      // A função pediu confirmação de novo (custo mudou ou faltou o confirmado): mostra o custo dela.
      const pedido = custoAConfirmar(e);
      if (pedido) {
        const c = atual.current;
        setCusto((x) => (x ? { ...x, linhas: pedido.por_no.map((n) => ({ id: n.no_id, nome: nomeDoNo(c, n.no_id), custo_usd: n.custo_usd })), total: pedido.total_usd } : x));
      } else toast.error("Não deu para rodar", { description: textoDoErro(e) });
    } finally {
      setRodando(false);
    }
  };

  const aplicarDoAgente = useCallback(
    (ops: OperacaoDoAgente[]) => {
      const r = aplicarOperacoes(atual.current, ops);
      mudar(() => r.canvas);
      return r;
    },
    [mudar],
  );

  const rodarNo = useCallback((id: string) => void pedirCusto({ tipo: "no", id }), [pedirCusto]);

  if (q.isLoading && !projeto) return <Carregando forma="aba" rotulo="Abrindo o projeto" />;
  if (q.isError && !projeto) return <EstadoDeErro titulo="Não deu para abrir o projeto" descricao={textoDoErro(q.error)} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />;
  if (!projeto) return null;

  const noSel = selecionado ? canvas.nos.find((n) => n.id === selecionado) || null : null;
  const rotuloDoSalvar = { salvo: "Salvo", salvando: "Salvando", pendente: "Alterações não salvas", erro: "Não salvou", conflito: "Mudou em outra aba" }[salvar.estado];

  const inspetor = noSel ? (
    <Inspetor
      key={noSel.id}
      canvas={canvas}
      no={noSel}
      projetoId={projetoId}
      execucao={execucoes[noSel.id]}
      rodando={estimando === noSel.id || rodando}
      onMudarDados={(d) => mudar((c) => mudarDados(c, noSel.id, d))}
      onLigar={(de, para) => tentarLigar(de, para, false)}
      onDesligar={(id) => mudar((c) => desligar(c, id))}
      onRemover={() => {
        mudar((c) => removerNo(c, noSel.id));
        setSelecionado(null);
      }}
      onRodar={() => rodarNo(noSel.id)}
      onGerarTudoDaBase={() => {
        const ids = alvosDaBase(atual.current, noSel.id);
        if (!ids.length) {
          toast.info("Nada ligado à Base comum", { description: "Ligue Resultados, Carrossel ou Logo nela para gerar tudo de uma vez." });
          return;
        }
        void pedirCusto({ tipo: "lista", ids, titulo: "Gerar tudo da Base comum" });
      }}
      onFechar={lista ? undefined : () => setSelecionado(null)}
      avisoDeLigacao={null}
    />
  ) : null;

  const painelDoAgente = (
    <AgenteDoProjeto
      projetoId={projetoId}
      antesDePlanejar={garantirSalvo}
      onAplicar={aplicarDoAgente}
      semMoldura={!largo}
    />
  );

  return (
    <div className={juntar("min-w-0", cheia && "fixed inset-0 z-40 flex flex-col bg-background p-3")} data-editor-do-projeto={projetoId}>
      <div className="mb-2 flex min-w-0 flex-wrap items-center" data-barra-do-editor="">
        <button type="button" className={juntar(botao.icone, "mr-1")} onClick={onVoltar} aria-label="Voltar aos projetos" title="Voltar aos projetos">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          aria-label="Nome do projeto"
          className={juntar(campo, "mr-2 h-8 w-auto min-w-0 max-w-[260px] flex-1 border-transparent bg-transparent px-1.5 text-[15px] font-semibold hover:border-input")}
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            nomeAtual.current = e.target.value;
            setSalvar((s) => (s.estado === "conflito" ? s : { estado: "pendente", erro: "" }));
          }}
        />
        <span className={juntar(etiqueta, "mr-2 bg-muted text-muted-foreground")}>{nomeDoCliente(clientes, projeto.client_id, projeto.cliente_nome || "Livre")}</span>
        <span role="status" className={juntar(texto.auxiliar, "mr-2 inline-flex items-center", (salvar.estado === "erro" || salvar.estado === "conflito") && "text-warning")} data-estado-do-salvar={salvar.estado} title={salvar.erro || undefined}>
          {salvar.estado === "salvando" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : salvar.estado === "salvo" ? <Check className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
          {rotuloDoSalvar}
        </span>
        {salvar.estado === "conflito" && (
          <button type="button" className={juntar(botao.secundario, "mr-2 h-8")} onClick={() => void recarregar()} data-recarregar-projeto="">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Recarregar
          </button>
        )}
        {salvar.estado === "erro" && (
          <button type="button" className={juntar(botao.discreto, "mr-2 h-8")} onClick={() => salvarAgora().catch(() => undefined)}>
            Tentar salvar
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className={juntar(botao.primario, "h-8 px-3")} onClick={() => void pedirCusto({ tipo: "tudo" })} disabled={!!estimando || rodando || !canvas.nos.length} data-rodar-tudo="">
          {estimando === "tudo" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          Rodar tudo
        </button>
        <button type="button" className={juntar(botao.icone, "ml-1", agente && "text-primary")} onClick={() => setAgente(!agente)} aria-label={agente ? "Fechar o agente do projeto" : "Abrir o agente do projeto"} title="Agente do projeto" aria-pressed={agente}>
          {agente ? <PanelRightClose className="h-4 w-4" aria-hidden="true" /> : <PanelRightOpen className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button type="button" className={botao.icone} onClick={() => setLista(!lista)} aria-label={lista ? "Ver o quadro" : "Modo lista"} title={lista ? "Ver o quadro" : "Modo lista"}>
          {lista ? <Workflow className="h-4 w-4" aria-hidden="true" /> : <LayoutList className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button type="button" className={botao.icone} onClick={() => setCheia(!cheia)} aria-label={cheia ? "Sair da tela cheia" : "Tela cheia"} title={cheia ? "Sair da tela cheia (Esc)" : "Tela cheia"}>
          {cheia ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
        </button>
        <MenuMais
          rotulo="Mais ações do projeto"
          itens={[
            { rotulo: "Organizar o quadro", icone: <LayoutGrid className="h-4 w-4" />, aoEscolher: () => mudar(organizar) },
            { rotulo: "Salvar como fluxo pessoal", icone: <BookmarkPlus className="h-4 w-4" />, aoEscolher: () => setSalvarComo(nome) },
            {
              rotulo: "Arquivar o projeto",
              icone: <Archive className="h-4 w-4" />,
              perigo: true,
              aoEscolher: () => {
                arquivarProjeto(projetoId)
                  .then(() => {
                    toast.success("Projeto arquivado");
                    void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
                    onVoltar();
                  })
                  .catch((e) => toast.error("Não deu para arquivar", { description: textoDoErro(e) }));
              },
            },
          ]}
        />
      </div>

      {lista ? (
        <ModoListaDoLab canvas={canvas} execucoes={execucoes} selecionado={selecionado} onSelecionar={setSelecionado} onPor={(t) => por(t)} inspetor={inspetor} />
      ) : (
        <div ref={refDoCorpo} className={juntar("relative flex min-w-0", cheia && "min-h-0 flex-1")} style={cheia ? undefined : { height: altura }}>
          <div className="mr-2 shrink-0 border-r border-border pr-1">
            <Paleta onPor={(t) => por(t)} />
          </div>
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-border">
            <QuadroDoLab
              canvas={canvas}
              execucoes={execucoes}
              selecionado={selecionado}
              rodandoNo={estimando && estimando !== "tudo" ? estimando : null}
              semTeclas={!!custo || salvarComo !== null}
              onSelecionar={setSelecionado}
              onMudarCanvas={mudar}
              onTentarLigar={(de, para) => tentarLigar(de, para, true)}
              onRodar={rodarNo}
              onSoltar={(t, pos) => por(t, pos)}
              onViewport={(v) => {
                atual.current = { ...atual.current, viewport: { x: v.x, y: v.y, zoom: v.zoom } };
              }}
            />
            {!canvas.nos.length && (
              <p className={juntar(texto.auxiliar, "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center")}>Toque num ícone da paleta ou peça ao agente do projeto.</p>
            )}
            {avisoDoQuadro && (
              <p role="alert" className={juntar(texto.corpo, "absolute bottom-3 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-md border border-warning/40 bg-background px-3 py-2 text-warning")} data-aviso-do-quadro="">
                {avisoDoQuadro}
              </p>
            )}
            {inspetor && (
              <div className="nowheel nodrag nopan absolute bottom-2 right-2 top-2 z-10 w-[300px] max-w-[85%] overflow-y-auto overscroll-contain rounded-md border border-border bg-background p-3 shadow-sm" data-painel-do-inspetor="">
                {inspetor}
              </div>
            )}
          </div>
          {agente && largo && <div className="ml-3 w-[340px] shrink-0">{painelDoAgente}</div>}
        </div>
      )}

      {agente && !largo && (
        <JanelaCentral aberta onFechar={() => setAgente(false)} titulo="Agente do projeto" corpo="fixo" semEspaco largura="md">
          {painelDoAgente}
        </JanelaCentral>
      )}

      <JanelaDeCusto
        aberta={!!custo}
        titulo={custo ? custo.titulo : ""}
        linhas={custo ? custo.linhas : []}
        total={custo ? custo.total : 0}
        rodando={rodando}
        onConfirmar={() => void confirmar()}
        onFechar={() => setCusto(null)}
      />

      <JanelaCentral
        aberta={salvarComo !== null}
        onFechar={() => setSalvarComo(null)}
        titulo="Salvar como fluxo pessoal"
        icone={<BookmarkPlus className="h-4 w-4" />}
        largura="sm"
        rodape={
          <>
            <button type="button" className={botao.discreto} onClick={() => setSalvarComo(null)}>Cancelar</button>
            <button
              type="button"
              className={botao.primario}
              disabled={!salvarComo || !salvarComo.trim()}
              onClick={() => {
                const n = (salvarComo || "").trim();
                garantirSalvo()
                  .then(() => salvarTemplate(projetoId, n))
                  .then(() => {
                    toast.success("Fluxo salvo", { description: "Ele aparece em Início › Fluxos, com Usar fluxo." });
                    void queryClient.invalidateQueries({ queryKey: ["laboratorio", "templates"] });
                    setSalvarComo(null);
                  })
                  .catch((e) => toast.error("Não deu para salvar o fluxo", { description: textoDoErro(e) }));
              }}
            >
              Salvar
            </button>
          </>
        }
      >
        <label className={juntar(texto.rotulo, "mb-1 block")} htmlFor="nome-do-fluxo">Nome do fluxo</label>
        <input id="nome-do-fluxo" className={campo} value={salvarComo || ""} onChange={(e) => setSalvarComo(e.target.value)} />
      </JanelaCentral>
    </div>
  );
}

export default function EditorDoProjeto(props: { projetoId: string; clientes: ClienteDoLab[]; onVoltar: () => void }) {
  return (
    <ReactFlowProvider>
      <Editor key={props.projetoId} {...props} />
    </ReactFlowProvider>
  );
}
