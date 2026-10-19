import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArrowLeft, BookmarkPlus, Check, LayoutGrid, LayoutList, Loader2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Play, RefreshCw, Workflow } from "lucide-react";
import { Carregando, EstadoDeErro, JanelaCentral, MenuMais, botao, campo, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { supabase } from "@/integrations/supabase/client";
import { useModoFoco } from "@/lib/modoFoco";
import {
  acompanharNo,
  arquivarProjeto,
  blocosPorNo,
  chaveDosProjetos,
  custoAConfirmar,
  ehConflitoDeVersao,
  ehJaPedido,
  normalizarExecucao,
  escolherStoryboard,
  estimar,
  executarNo,
  lerExecucoes,
  lerProjeto,
  precisaAcompanhar,
  resolverBloco,
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
  atrasosDaConstrucao,
  canvasVazio,
  criarNo,
  desligar,
  ligar,
  mudarDados,
  organizar,
  podeLigar,
  removerNo,
  travaDoNoAr,
  type CanvasDoLab,
  type OperacaoDoAgente,
  type TipoDeNo,
} from "@/lib/laboratorio/nos";
import QuadroDoLab from "./QuadroDoLab";
import Paleta from "./Paleta";
import Inspetor from "./Inspetor";
import ModoListaDoLab from "./ModoListaDoLab";
import AgenteDoProjeto from "./AgenteDoProjeto";
import CanvasStudio, { type ResultadoDaConstrucao } from "./CanvasStudio";
import JanelaDeCusto, { type LinhaDeCusto } from "./JanelaDeCusto";
import { emAndamento } from "./ResultadoDoNo";
import type { ClienteDoLab } from "./Seletores";

/**
 * Editor de um projeto do Laboratório: o canvas de nós (paleta, quadro,
 * inspetor), o "Rodar" por nó e o "Rodar tudo" (sempre `estimar` antes e o
 * custo numa janela; só roda depois do confirmar), salvar automático com
 * trava otimista (conflito avisa e oferece recarregar), tela cheia (modo
 * foco), modo lista no celular e o agente do projeto ao lado.
 *
 * v2 (20/10/2026): o Canvas Studio fica fixo no topo do canvas (a caixa da
 * Início, com modelo, cliente e atalhos): o pedido vira operações que entram
 * no quadro com a animação de construção (coluna por coluna) e organizadas,
 * com Desfazer. O Filme escolhe o storyboard no próprio nó; a tela cheia
 * pode vir de fora (a página do Laboratório guarda o estado para todas as abas).
 */

type EstadoDoSalvar = "salvo" | "pendente" | "salvando" | "erro" | "conflito";
type Alvo = { tipo: "no"; id: string } | { tipo: "tudo" } | { tipo: "lista"; ids: string[]; titulo: string } | { tipo: "filme"; id: string; indice: number };

const ATRASO_DO_SALVAR_MS = 1500;
const VIGIA_MS = 3000;
/** Filme renderizando ou montando: no_acompanhar de tempo em tempo (um passo por chamada). */
const ACOMPANHAR_MS = 5000;
/** Esperam algo de fora (escolha, render, aprovação): quem vigia é o no_acompanhar, não o execucoes_ler. */
const ESPERAM_DE_FORA = ["filme", "por_no_ar"];

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

interface PropsDoEditor {
  projetoId: string;
  clientes: ClienteDoLab[];
  onVoltar: () => void;
  /** Tela cheia vinda da página (todas as abas); sem isso, o editor guarda a sua. */
  telaCheia?: boolean;
  onTelaCheia?: (v: boolean) => void;
}

function Editor({ projetoId, clientes, onVoltar, telaCheia, onTelaCheia }: PropsDoEditor) {
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
  const [cheiaPropria, setCheiaPropria] = useState(false);
  const cheia = telaCheia !== undefined ? telaCheia : cheiaPropria;
  const setCheia = useCallback((v: boolean) => (onTelaCheia ? onTelaCheia(v) : setCheiaPropria(v)), [onTelaCheia]);
  const [clienteDoProjeto, setClienteDoProjeto] = useState<string | null>(null);
  // Construção (Canvas Studio): atraso de entrada dos nós novos, ajuste da vista e o quadro de antes (Desfazer).
  const [revelar, setRevelar] = useState<Record<string, number> | null>(null);
  const [ajustarVista, setAjustarVista] = useState(0);
  const [antesDaConstrucao, setAntesDaConstrucao] = useState<CanvasDoLab | null>(null);
  const [registro, setRegistro] = useState<{ id: string; pedido: string; resposta: string } | null>(null);
  const [escolhendo, setEscolhendo] = useState<{ no: string; indice: number } | null>(null);
  const [lista, setLista] = useState<boolean>(() => typeof window !== "undefined" && (window.innerWidth || 1024) < 768);
  const [largo, setLargo] = useState<boolean>(() => typeof window === "undefined" || (window.innerWidth || 1024) >= 1024);
  const [agente, setAgente] = useState<boolean>(() => typeof window === "undefined" || (window.innerWidth || 1024) >= 1280);
  const [salvarComo, setSalvarComo] = useState<string | null>(null);

  const atual = useRef<CanvasDoLab>(canvas);
  const versao = useRef(1);
  const nomeAtual = useRef("");
  const salvando = useRef<Promise<boolean> | null>(null);
  const carregado = useRef(false);
  /** Cliente trocado no Canvas Studio: vai no próximo projeto_salvar (undefined = sem troca). */
  const clienteMudou = useRef<string | null | undefined>(undefined);

  useModoFoco("laboratorio-canvas", cheia);
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
    setClienteDoProjeto(p.client_id);
    clienteMudou.current = undefined;
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
    const cliente = clienteMudou.current;
    setSalvar({ estado: "salvando", erro: "" });
    const p = (async () => {
      try {
        const salvo = await salvarProjeto({ id: projetoId, nome: nomeAtual.current, canvas: enviar, versao: versao.current, ...(cliente !== undefined ? { client_id: cliente } : {}) });
        versao.current = salvo.versao;
        if (clienteMudou.current === cliente) clienteMudou.current = undefined;
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
  const tipoDoNo = useCallback((id: string, e?: ExecucaoDoLab) => (e && e.tipo) || ((atual.current.nos.find((n) => n.id === id) || { tipo: "" }).tipo as string), []);
  const algoRodando = useMemo(
    () => Object.keys(execucoes).some((k) => {
      const e = execucoes[k];
      if (e.status === "aguardando" && ESPERAM_DE_FORA.indexOf(tipoDoNo(k, e)) >= 0) return false;
      return emAndamento(e.status);
    }),
    [execucoes, tipoDoNo],
  );
  // Regra contra invenção (v3): cada Pôr no ar travado por bloco sem fonte antes dele (motivo por id).
  const travasDoNoAr = useMemo(() => {
    const blocos = blocosPorNo(execucoes);
    const saida: Record<string, ReturnType<typeof travaDoNoAr>> = {};
    canvas.nos.filter((n) => n.tipo === "por_no_ar").forEach((n) => {
      const t = travaDoNoAr(canvas, n.id, blocos);
      if (t.travado) saida[n.id] = t;
    });
    return saida;
  }, [canvas, execucoes]);
  const motivosDasTravas = useMemo(() => {
    const m: Record<string, string> = {};
    Object.keys(travasDoNoAr).forEach((k) => (m[k] = travasDoNoAr[k].motivo));
    return m;
  }, [travasDoNoAr]);
  const resolverOBloco = useCallback(
    async (noId: string, blocoId: string, modo: "fonte" | "editar", valor: string) => {
      const ex = await resolverBloco({ projetoId, noId, blocoId, modo, valor });
      if (ex) setExecucoes((a) => ({ ...a, [noId]: ex }));
      toast.success(modo === "fonte" ? "Fonte confirmada" : "Trecho editado", { description: "Sem bloco sem fonte antes dele, o Pôr no ar destrava." });
    },
    [projetoId],
  );
  const aAcompanhar = useMemo(() => Object.keys(execucoes).filter((k) => precisaAcompanhar(tipoDoNo(k, execucoes[k]), execucoes[k])).sort().join("|"), [execucoes, tipoDoNo]);
  useEffect(() => {
    if (!aAcompanhar) return;
    let vivo = true;
    const id = window.setInterval(() => {
      aAcompanhar.split("|").forEach((noId) => {
        acompanharNo(projetoId, noId)
          .then((ex) => {
            if (vivo && ex) setExecucoes((a) => ({ ...a, [noId]: ex }));
          })
          .catch(() => undefined);
      });
    }, ACOMPANHAR_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [aAcompanhar, projetoId]);

  // Realtime de lab_execucoes: o estado do Pôr no ar (aprovado, com o agente, feito) chega sozinho.
  useEffect(() => {
    const sb = supabase as any;
    if (!sb || typeof sb.channel !== "function") return;
    let canal: any = null;
    try {
      canal = sb
        .channel(`lab-execucoes:${projetoId}:${Date.now().toString(36)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "lab_execucoes", filter: `projeto_id=eq.${projetoId}` }, (msg: any) => {
          const ex = normalizarExecucao(msg && msg.new);
          if (!ex) return;
          setExecucoes((a) => {
            const velha = a[ex.no_id];
            if (velha && velha.id !== ex.id && (velha.created_at || "") > (ex.created_at || "")) return a;
            return { ...a, [ex.no_id]: ex };
          });
        })
        .subscribe();
    } catch {
      canal = null;
    }
    return () => {
      try {
        if (canal) sb.removeChannel(canal);
      } catch {
        /* canal já fechado */
      }
    };
  }, [projetoId]);
  useEffect(() => {
    if (!vigiar && !algoRodando) return;
    let vivo = true;
    const id = window.setInterval(() => {
      lerExecucoes(projetoId)
        .then((l) => {
          if (!vivo) return;
          const ultimas = ultimaPorNo(l);
          setExecucoes((antes) => ({ ...antes, ...ultimas }));
          if (!l.some((e) => emAndamento(e.status) && !(e.status === "aguardando" && ESPERAM_DE_FORA.indexOf(tipoDoNo(e.no_id, e)) >= 0))) setVigiar(false);
        })
        .catch(() => undefined);
    }, VIGIA_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [vigiar, algoRodando, projetoId, tipoDoNo]);

  // Esc sai da tela cheia.
  useEffect(() => {
    if (!cheia) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCheia(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cheia, setCheia]);

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
      if (alvo.tipo === "filme") {
        await escolherFilme(alvo.id, alvo.indice, true);
        setCusto(null);
        return;
      }
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
      } else if (e instanceof Error && (e as { codigo?: string }).codigo === "rascunho_sem_fonte") {
        setCusto(null);
        toast.warning("Pôr no ar travado", { description: e.message });
      } else if (ehJaPedido(e)) {
        setCusto(null);
        toast.info("Já pedido", { description: "Este Pôr no ar já tem um pedido aberto. Veja em Precisa de você (Execução)." });
      } else toast.error("Não deu para rodar", { description: textoDoErro(e) });
    } finally {
      setRodando(false);
    }
  };

  /**
   * Aplica as operações com a animação de construção: os nós novos entram
   * coluna por coluna; com `arrumar`, o quadro se organiza em colunas antes.
   * Guarda o quadro de antes para o Desfazer.
   */
  const construir = useCallback(
    (ops: OperacaoDoAgente[], arrumar: boolean, previsto?: CanvasDoLab | null) => {
      const antes = atual.current;
      const r = aplicarOperacoes(antes, ops);
      if (!r.feitas) return { ...r, novos: [] as string[] };
      // As posições do canvas_previsto da função (colunas por etapa) valem; sem ele, organiza aqui.
      const posicoes: Record<string, { x: number; y: number }> = {};
      if (previsto) previsto.nos.forEach((n) => (posicoes[n.id] = { x: n.x, y: n.y }));
      const casou = previsto ? r.canvas.nos.filter((n) => posicoes[n.id]).length : 0;
      const final = casou ? { ...r.canvas, nos: r.canvas.nos.map((n) => (posicoes[n.id] ? { ...n, x: posicoes[n.id].x, y: posicoes[n.id].y } : n)) } : arrumar ? organizar(r.canvas) : r.canvas;
      const novos = final.nos.filter((n) => !antes.nos.some((x) => x.id === n.id)).map((n) => n.id);
      mudar(() => final);
      setAntesDaConstrucao(antes);
      if (novos.length) {
        const atrasos = atrasosDaConstrucao(final, novos);
        setRevelar(atrasos);
        const fim = Math.max.apply(null, Object.keys(atrasos).map((k) => atrasos[k])) + 700;
        window.setTimeout(() => setRevelar((x) => (x === atrasos ? null : x)), fim);
      }
      setAjustarVista((v) => v + 1);
      return { ...r, canvas: final, novos };
    },
    [mudar],
  );

  const aplicarDoAgente = useCallback((ops: OperacaoDoAgente[]) => construir(ops, false), [construir]);

  const construirDoStudio = useCallback(
    (ops: OperacaoDoAgente[], completo: boolean, previsto: CanvasDoLab | null): ResultadoDaConstrucao => {
      // Projeto completo ou quadro que estava vazio: em colunas (as da função, por etapa, de Pesquisa a Pôr no ar).
      const r = construir(ops, completo || atual.current.nos.length === 0 || ops.filter((o) => o.op === "criar").length >= 3, previsto);
      return { feitas: r.feitas, falhas: r.falhas, novos: r.novos.length };
    },
    [construir],
  );

  const desfazerConstrucao = useCallback(() => {
    if (!antesDaConstrucao) return;
    const antes = antesDaConstrucao;
    mudar(() => antes);
    setAntesDaConstrucao(null);
    setRevelar(null);
    setAjustarVista((v) => v + 1);
    toast.success("Construção desfeita", { description: "O quadro voltou ao que era antes do pedido." });
  }, [antesDaConstrucao, mudar]);

  const mudarCliente = useCallback((id: string | null) => {
    setClienteDoProjeto(id);
    clienteMudou.current = id;
    setSalvar((s) => (s.estado === "conflito" ? s : { estado: "pendente", erro: "" }));
  }, []);

  /** Filme: escolhe o storyboard no nó; se a função pedir o custo do render, mostra antes. */
  const escolherFilme = useCallback(
    async (noId: string, indice: number, confirmado = false) => {
      setEscolhendo({ no: noId, indice });
      try {
        const ex = await escolherStoryboard(projetoId, noId, indice, confirmado);
        setExecucoes((a) => {
          if (ex) return { ...a, [noId]: ex };
          const velha = a[noId];
          return velha ? { ...a, [noId]: { ...velha, status: "rodando", saida: { ...velha.saida, storyboard_escolhido: indice } } } : a;
        });
        setVigiar(true);
        toast.success("Storyboard escolhido", { description: "O filme está renderizando; o vídeo aparece no nó." });
      } catch (e) {
        const pedido = custoAConfirmar(e);
        if (pedido && !confirmado) {
          setCusto({ alvo: { tipo: "filme", id: noId, indice }, titulo: "Renderizar o filme", linhas: [{ id: noId, nome: nomeDoNo(atual.current, noId), custo_usd: pedido.total_usd }], total: pedido.total_usd });
        } else toast.error("Não deu para escolher o storyboard", { description: textoDoErro(e) });
        if (confirmado) throw e;
      } finally {
        setEscolhendo(null);
      }
    },
    [projetoId],
  );
  const aoEscolherStoryboard = useCallback((noId: string, indice: number) => void escolherFilme(noId, indice).catch(() => undefined), [escolherFilme]);

  const rodarNo = useCallback((id: string) => void pedirCusto({ tipo: "no", id }), [pedirCusto]);

  if (q.isLoading && !projeto) return <Carregando forma="aba" rotulo="Abrindo o projeto" />;
  if (q.isError && !projeto) return <EstadoDeErro titulo="Não deu para abrir o projeto" descricao={textoDoErro(q.error)} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />;
  if (!projeto) return null;

  const noSel = selecionado ? canvas.nos.find((n) => n.id === selecionado) || null : null;
  // Cliente do projeto fora da lista (sem acesso à carteira, ou lista ainda lendo): continua visível pelo nome.
  const clientesDoSeletor = clienteDoProjeto && !clientes.some((c) => c.id === clienteDoProjeto) ? [{ id: clienteDoProjeto, nome: projeto.cliente_nome || "Cliente" }].concat(clientes) : clientes;
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
      onEscolherStoryboard={(i) => aoEscolherStoryboard(noSel.id, i)}
      escolhendo={escolhendo && escolhendo.no === noSel.id ? escolhendo.indice : null}
      trava={travasDoNoAr[noSel.id] || null}
      onResolverBloco={resolverOBloco}
    />
  ) : null;

  const painelDoAgente = (
    <AgenteDoProjeto
      projetoId={projetoId}
      antesDePlanejar={garantirSalvo}
      onAplicar={aplicarDoAgente}
      semMoldura={!largo}
      registro={registro}
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

      <CanvasStudio
        projetoId={projetoId}
        nosNoQuadro={canvas.nos.length}
        clienteId={clienteDoProjeto}
        clientes={clientesDoSeletor}
        onCliente={mudarCliente}
        antesDePlanejar={garantirSalvo}
        onConstruir={construirDoStudio}
        onDesfazer={antesDaConstrucao ? desfazerConstrucao : null}
        onConversa={(pedido, resposta) => setRegistro({ id: String(Date.now()), pedido, resposta })}
      />

      {lista ? (
        <ModoListaDoLab canvas={canvas} execucoes={execucoes} selecionado={selecionado} onSelecionar={setSelecionado} onPor={(t) => por(t)} inspetor={inspetor} travas={motivosDasTravas} />
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
              revelar={revelar}
              ajustarVista={ajustarVista}
              escolhendo={escolhendo}
              onEscolherStoryboard={aoEscolherStoryboard}
              travas={motivosDasTravas}
            />
            {!canvas.nos.length && (
              <p className={juntar(texto.auxiliar, "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center")}>Peça no Canvas Studio acima, toque num ícone da paleta ou fale com o agente do projeto.</p>
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

export default function EditorDoProjeto(props: PropsDoEditor) {
  return (
    <ReactFlowProvider>
      <Editor key={props.projetoId} {...props} />
    </ReactFlowProvider>
  );
}
