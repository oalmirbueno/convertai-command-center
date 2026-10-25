import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArrowLeft, BookmarkPlus, Check, CircleStop, Copy, Fullscreen, LayoutGrid, LayoutList, Loader2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, PanelTopOpen, Play, RefreshCw, Trash2, Workflow } from "lucide-react";
import { Carregando, EstadoDeErro, JanelaCentral, MenuMais, botao, campo, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { supabase } from "@/integrations/supabase/client";
import { useModoFoco } from "@/lib/modoFoco";
import { useSemRolagemDaPagina } from "@/lib/laboratorio/semRolagemDaPagina";
import {
  acompanharNo,
  arquivarProjeto,
  blocosPorNo,
  cancelarRodada,
  chaveDosProjetos,
  custoAConfirmar,
  ehConflitoDeVersao,
  ehJaPedido,
  ehEscolhaDaMarca,
  normalizarExecucao,
  escolherStoryboard,
  estimar,
  executarNo,
  executarNoAutomatico,
  lerExecucoes,
  lerProjeto,
  precisaAcompanhar,
  precisaLerExecucao,
  resolverBloco,
  rodarTudo,
  salvarProjeto,
  salvarTemplate,
  ultimaPorNo,
  type ExecucaoDoLab,
  type ImagemDoLab,
  type ProjetoDoLab,
} from "@/lib/laboratorio/api";
import {
  TIPOS_DE_NO,
  alvosDaBase,
  ancestraisDe,
  aplicarOperacoes,
  atrasosDaConstrucao,
  canvasVazio,
  criarNo,
  definirGatilho,
  desligar,
  ligar,
  mudarDados,
  normalizarCanvas,
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
import { nomeDoCliente, type ClienteDoLab } from "./Seletores";
import { duplicarProjeto, nomeDaCopia as nomeDaCopiaNaTela } from "@/lib/laboratorio/duplicar";
import JanelaDeExcluirProjeto from "./JanelaDeExcluirProjeto";
import ExportarProjeto from "./ExportarProjeto";
import ProvedorDasPrevias from "./ContextoDasPrevias";
import { alvosDoPedido, temCartoesSobrepostos } from "@/lib/laboratorio/execucaoDoPedido";
import { dadosDasMidias } from "./no/MidiaDoNo";
import { LARGURA_DO_NO } from "./no/montar";
import FaixaDaCampanha from "./FaixaDaCampanha";
import { canvasDiferente, mesclarCanvas } from "@/lib/laboratorio/sincronia";
import { chavesDaPonte } from "@/lib/ponte/ponteApi";
import "./telaCheiaDoLab.css";

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
 *
 * v4 (21/10/2026, pedido do dono):
 * - altura do canvas medida sempre (ResizeObserver + resize; recalcula quando
 *   o Studio abre, fecha ou cresce), com piso de 70% da janela: nunca pequeno;
 * - perguntas primeiro: com a etapa das perguntas (ou o "pesquisando") aberta
 *   no Canvas Studio, o quadro sai e a etapa ocupa o lugar dele;
 * - Canvas Studio recolhível (lembrado por useEstadoDaTela);
 * - tela cheia de verdade: cobre a janela inteira, sem borda e acima da casca
 *   do painel em qualquer largura (telaCheiaDoLab.css), com a área segura do
 *   iPhone; e "canvas em tela cheia": só o quadro, de ponta a ponta, com uma
 *   mini barra flutuante (sair, abrir o Studio, Rodar tudo). Esc sai (primeiro
 *   do canvas em tela cheia; com janela aberta, o Esc é dela);
 * - Excluir projeto no menu, com confirmação (JanelaDeExcluirProjeto).
 */

type EstadoDoSalvar = "salvo" | "pendente" | "salvando" | "erro" | "conflito";

/** Tela cheia: a área segura do iPhone (entalhe e barra de baixo) fica de fora do conteúdo. */
const AREA_SEGURA = {
  paddingTop: "env(safe-area-inset-top)",
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
};
type Alvo = { tipo: "no"; id: string } | { tipo: "tudo" } | { tipo: "lista"; ids: string[]; titulo: string } | { tipo: "filme"; id: string; indice: number };

const ATRASO_DO_SALVAR_MS = 1500;
const VIGIA_MS = 3000;
/** Filme renderizando ou montando: no_acompanhar de tempo em tempo (um passo por chamada). */
const ACOMPANHAR_MS = 5000;
/** Esperam algo de fora (escolha, render, aprovação): quem vigia é o no_acompanhar, não o execucoes_ler. */
// 21/10: Resultado e Carrossel no motor da casa (estudio_arte) também esperam: quem avança é o no_acompanhar.

/** Piso da altura do canvas: a janela inteira, menos o respiro de baixo (21/10, dono: "de verdade 100%"; nunca menos de 420 px). */
export function alturaMinimaDoCanvas(alturaDaJanela: number): number {
  return Math.max(420, Math.round(alturaDaJanela - 16));
}

/**
 * Altura do canvas fora da tela cheia: do topo dele até o pé da janela, com o
 * piso de 70% da janela. O topo é medido como se a página estivesse no alto
 * (soma a rolagem dos pais), então rolar não muda a altura. Mede de novo no
 * resize, quando o que fica acima muda de tamanho (barra, Studio abrindo,
 * fechando ou crescendo: ResizeObserver) e quando `gatilho` muda. Sem
 * ResizeObserver (Safari antigo), fica o resize e o gatilho.
 */
function useAlturaDoEditor(ativo: boolean, acima: RefObject<HTMLElement>, gatilho: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number>(() => alturaMinimaDoCanvas(typeof window === "undefined" ? 800 : window.innerHeight || 800));
  useLayoutEffect(() => {
    if (!ativo) return;
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      const janela = window.innerHeight || 800;
      let topo = el.getBoundingClientRect().top;
      for (let p = el.parentElement; p; p = p.parentElement) topo += p.scrollTop || 0;
      setAltura(Math.max(alturaMinimaDoCanvas(janela), Math.round(janela - topo - 16)));
    };
    medir();
    window.addEventListener("resize", medir);
    let obs: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      obs = new ResizeObserver(() => medir());
      if (acima.current) obs.observe(acima.current);
      if (ref.current && ref.current.parentElement) obs.observe(ref.current.parentElement);
    }
    return () => {
      window.removeEventListener("resize", medir);
      if (obs) obs.disconnect();
    };
  }, [ativo, acima, gatilho]);
  return { ref, altura };
}

/** Há uma janela (dialog) aberta: o Esc é dela, não da tela cheia. */
function temJanelaAberta(): boolean {
  try {
    return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
  } catch {
    return false;
  }
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
  /** Abre outro projeto no lugar deste (o duplicado para outro cliente). */
  onAbrirOutro?: (id: string) => void;
  /** Tela cheia vinda da página (todas as abas); sem isso, o editor guarda a sua. */
  telaCheia?: boolean;
  onTelaCheia?: (v: boolean) => void;
}

function Editor({ projetoId, clientes, onVoltar, onAbrirOutro, telaCheia, onTelaCheia }: PropsDoEditor) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["laboratorio", "projeto", projetoId], queryFn: () => lerProjeto(projetoId), staleTime: 0, gcTime: 0 });

  const [projeto, setProjeto] = useState<ProjetoDoLab | null>(null);
  const [canvas, setCanvas] = useState<CanvasDoLab>(canvasVazio);
  const [nome, setNome] = useState("");
  const [salvar, setSalvar] = useState<{ estado: EstadoDoSalvar; erro: string }>({ estado: "salvo", erro: "" });
  const [execucoes, setExecucoes] = useState<Record<string, ExecucaoDoLab>>({});
  const [selecionado, setSelecionado] = useState<string | null>(null);
  /** Inspetor aberto no quadro: só pelo "Abrir detalhes" do nó (os campos já ficam no próprio nó). */
  const [detalhes, setDetalhes] = useState(false);
  const [avisoDoQuadro, setAvisoDoQuadro] = useState<string | null>(null);
  const [custo, setCusto] = useState<{ alvo: Alvo; titulo: string; linhas: LinhaDeCusto[]; total: number } | null>(null);
  const [estimando, setEstimando] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const rodadasPendentes = useMemo(() => [...new Set(Object.values(execucoes)
    .filter((e) => e.status === "aguardando" && e.saida.aguardando_dependencias && e.rodada_id)
    .map((e) => e.rodada_id!))], [execucoes]);
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
  /** Janela "Duplicar para outro cliente": null fechada; "" é Livre; senão o id do cliente. */
  const [duplicarPara, setDuplicarPara] = useState<string | null>(null);
  const [duplicando, setDuplicando] = useState(false);
  const [excluir, setExcluir] = useState(false);
  /** Canvas em tela cheia: só o quadro, de ponta a ponta (barra e Studio somem). */
  const [soCanvas, setSoCanvas] = useState(false);
  /** Etapa grande do Canvas Studio (pesquisando ou perguntas) no lugar do quadro. */
  const [etapa, setEtapa] = useState(false);
  const [studioRecolhido, setStudioRecolhido] = useEstadoDaTela<boolean>("laboratorio:studio-recolhido", false, { validar: (v) => typeof v === "boolean" });
  const refDoTopo = useRef<HTMLDivElement>(null);

  const atual = useRef<CanvasDoLab>(canvas);
  /** O último canvas que o servidor tem (o carregado ou o último salvo): a base da mescla com a ponte. */
  const base = useRef<CanvasDoLab>(canvas);
  const versao = useRef(1);
  const nomeAtual = useRef("");
  const salvando = useRef<Promise<boolean> | null>(null);
  const carregado = useRef(false);
  /** Cliente trocado no Canvas Studio: vai no próximo projeto_salvar (undefined = sem troca). */
  const clienteMudou = useRef<string | null | undefined>(undefined);

  // Cobre a janela inteira: tela cheia ou só o canvas. A altura mede de novo quando o projeto
  // chega (antes era só o "Abrindo"; medir uma vez só deixava o canvas com a altura inicial).
  const cobre = cheia || soCanvas;
  useModoFoco("laboratorio-canvas", cobre);
  useSemRolagemDaPagina(cobre);
  const { ref: refDoCorpo, altura } = useAlturaDoEditor(!lista && !cobre && !etapa, refDoTopo, `${!!projeto}|${studioRecolhido}|${etapa}|${lista}`);
  // A etapa das perguntas precisa aparecer: sai do "só o canvas".
  useEffect(() => {
    if (etapa) setSoCanvas(false);
  }, [etapa]);

  useEffect(() => {
    const medir = () => setLargo((window.innerWidth || 1024) >= 1024);
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  const carregar = useCallback((p: ProjetoDoLab, execs: ExecucaoDoLab[]) => {
    const quadro = temCartoesSobrepostos(p.canvas) ? organizar(p.canvas) : p.canvas;
    setProjeto(p);
    setCanvas(quadro);
    atual.current = quadro;
    base.current = p.canvas;
    if (quadro !== p.canvas) setAjustarVista((v) => v + 1);
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
        let enviado = enviar;
        let salvo: ProjetoDoLab;
        try {
          salvo = await salvarProjeto({ id: projetoId, nome: nomeAtual.current, canvas: enviar, versao: versao.current, ...(cliente !== undefined ? { client_id: cliente } : {}) });
        } catch (e) {
          if (!ehConflitoDeVersao(e)) throw e;
          // 25/10 (ponte com a campanha): a outra ponta gravou antes. Mescla uma vez (o que é da pessoa fica, o que
          // veio da campanha vem do servidor, o novo dos dois lados entra) e salva de novo, sem cair no conflito.
          const lido = await lerProjeto(projetoId);
          const mescla = mesclarCanvas(base.current, atual.current, lido.projeto.canvas);
          atual.current = mescla;
          setCanvas(mescla);
          base.current = lido.projeto.canvas;
          versao.current = lido.projeto.versao;
          enviado = mescla;
          salvo = await salvarProjeto({ id: projetoId, nome: nomeAtual.current, canvas: mescla, versao: versao.current, ...(cliente !== undefined ? { client_id: cliente } : {}) });
        }
        versao.current = salvo.versao;
        base.current = enviado;
        if (clienteMudou.current === cliente) clienteMudou.current = undefined;
        setSalvar({ estado: atual.current !== enviado ? "pendente" : "salvo", erro: "" });
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

  /**
   * O servidor tem um canvas mais novo (a ponte com a campanha escreveu, ou outra aba): sem mudança local, troca
   * sem piscar (a vista e a seleção ficam); com mudança local, mescla e deixa salvar com a versão nova.
   */
  const aplicarRemoto = useCallback((bruto: unknown, versaoRemota: number) => {
    if (!carregado.current || !(versaoRemota > versao.current)) return;
    const remoto = normalizarCanvas(bruto);
    const vista = atual.current.viewport;
    if (!canvasDiferente(remoto, atual.current)) {
      versao.current = versaoRemota;
      base.current = remoto;
      return;
    }
    const temLocal = canvasDiferente(atual.current, base.current);
    const novo = temLocal ? mesclarCanvas(base.current, atual.current, remoto) : { ...remoto, viewport: vista };
    versao.current = versaoRemota;
    base.current = remoto;
    atual.current = novo;
    setCanvas(novo);
    setProjeto((p) => (p ? { ...p, versao: versaoRemota } : p));
    setSalvar((st) => (temLocal ? { estado: "pendente", erro: "" } : st.estado === "conflito" ? { estado: "salvo", erro: "" } : st));
  }, []);

  /** A ponte mudou o canvas (ligar, montar, sugestão aceita, sincronizar): relê e aplica pela mesma regra. */
  const recarregarDaPonte = useCallback(async () => {
    try {
      const r = await lerProjeto(projetoId);
      aplicarRemoto(r.projeto.canvas, r.projeto.versao);
    } catch {
      /* o tempo real traz de qualquer jeito */
    }
  }, [projetoId, aplicarRemoto]);

  // Tempo real da linha do projeto: a ponte (ou outra aba) gravou um canvas novo, ou a ligação com a campanha mudou.
  useEffect(() => {
    const sb = supabase as any;
    if (!sb || typeof sb.channel !== "function") return;
    let canal: any = null;
    try {
      canal = sb
        .channel(`lab-projeto:${projetoId}:${Date.now().toString(36)}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lab_projetos", filter: `id=eq.${projetoId}` }, (msg: any) => {
          const novo = msg && msg.new;
          if (!novo) return;
          const velho = msg.old || {};
          if (Object.prototype.hasOwnProperty.call(novo, "campanha_id") && novo.campanha_id !== velho.campanha_id) {
            void queryClient.invalidateQueries({ queryKey: chavesDaPonte.porProjeto(projetoId) });
          }
          if (novo.canvas && typeof novo.versao === "number") aplicarRemoto(novo.canvas, novo.versao);
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
  }, [projetoId, aplicarRemoto, queryClient]);

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
    () => Object.values(execucoes).some((e) => precisaLerExecucao(tipoDoNo(e.no_id, e), e)),
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
  const cancelarEtapasRestantes = async () => {
    if (cancelando) return;
    setCancelando(true);
    try {
      for (const rodada of rodadasPendentes) await cancelarRodada(projetoId, rodada);
      setExecucoes(ultimaPorNo(await lerExecucoes(projetoId)));
      toast.success("Etapas restantes canceladas", { description: "O que já ficou pronto foi preservado. A reserva das etapas canceladas foi devolvida." });
    } catch (e) {
      toast.error("Não foi possível cancelar todas as etapas", { description: textoDoErro(e) });
    } finally {
      setCancelando(false);
    }
  };
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
          if (!l.some((e) => precisaLerExecucao(tipoDoNo(e.no_id, e), e))) setVigiar(false);
        })
        .catch(() => undefined);
    }, VIGIA_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [vigiar, algoRodando, projetoId, tipoDoNo]);

  // Esc sai: primeiro do "só o canvas", depois da tela cheia. Com janela aberta, o Esc é dela.
  // Na captura, antes da página (que também sai da tela cheia dela no Esc, se ninguém usou).
  useEffect(() => {
    if (!cobre) return;
    const tecla = (e: KeyboardEvent) => {
      if ((e.key !== "Escape" && e.key !== "Esc") || e.defaultPrevented || temJanelaAberta()) return;
      e.preventDefault();
      if (soCanvas) setSoCanvas(false);
      else setCheia(false);
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [cobre, soCanvas, setCheia]);

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

  const aoNovaExecucao = useCallback((id: string, ex: ExecucaoDoLab) => {
    setExecucoes((atuais) => ({ ...atuais, [id]: ex }));
    setVigiar(true);
  }, []);

  const usarImagemComoReferencia = useCallback((noId: string, imagem: ImagemDoLab) => {
    const c = atual.current;
    const destino = c.nos.find((n) => n.id === noId);
    if (!destino) return;
    const entradas = c.ligacoes.filter((l) => l.para === noId).length;
    const criada = criarNo(c, "midia", { x: destino.x - LARGURA_DO_NO - 80, y: destino.y + entradas * 60 }, dadosDasMidias([{ id: imagem.path || imagem.url, tipo: "imagem", url: imagem.url, path: imagem.path, nome: "Referência" }]));
    if (!criada.no) { toast.warning("O quadro está cheio", { description: criada.erro }); return; }
    const novaId = criada.no.id;
    const permitida = podeLigar(criada.canvas, novaId, noId);
    if (!permitida.ok) { toast.warning("Não foi possível ligar a referência", { description: permitida.motivo }); return; }
    mudar(() => ligar(criada.canvas, novaId, noId));
    setSelecionado(novaId);
  }, [mudar]);

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
        const est = await estimar(projetoId, ids, alvo.tipo === "lista" ? { rodada: true } : undefined);
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
      } else if (ehEscolhaDaMarca(e)) {
        // Cliente com duas marcas: o motor pede qual vale (o nó Marca grava marca_id).
        setCusto(null);
        toast.warning("Escolha a marca no nó Marca", { description: "Este cliente tem mais de uma marca: ligue um nó Marca e escolha qual vale." });
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
      const distribuido = casou ? { ...r.canvas, nos: r.canvas.nos.map((n) => (posicoes[n.id] ? { ...n, x: posicoes[n.id].x, y: posicoes[n.id].y } : n)) } : r.canvas;
      const final = arrumar || temCartoesSobrepostos(distribuido) ? organizar(distribuido) : distribuido;
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
      const antes = atual.current;
      // Projeto completo ou quadro que estava vazio: em colunas (as da função, por etapa, de Pesquisa a Pôr no ar).
      const r = construir(ops, completo || atual.current.nos.length === 0 || ops.filter((o) => o.op === "criar").length >= 3, previsto);
      return { feitas: r.feitas, falhas: r.falhas, novos: r.novos.length, idsParaGerar: alvosDoPedido(antes, atual.current) };
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
  /** Automático: no_executar { automatico: true }; a função decide pelo teto do projeto e, acima dele (409), vem a janela de custo de sempre. */
  const rodarAutomatico = useCallback(
    async (id: string) => {
      try {
        await garantirSalvo();
        const ex = await executarNoAutomatico(projetoId, id);
        setExecucoes((a) => ({ ...a, [id]: ex }));
        setVigiar(true);
      } catch (e) {
        const pedido = custoAConfirmar(e);
        const c = atual.current;
        if (pedido) setCusto({ alvo: { tipo: "no", id }, titulo: `Rodar ${nomeDoNo(c, id)} (automático)`, linhas: pedido.por_no.length ? pedido.por_no.map((n) => ({ id: n.no_id, nome: nomeDoNo(c, n.no_id), custo_usd: n.custo_usd })) : [{ id, nome: nomeDoNo(c, id), custo_usd: pedido.total_usd }], total: pedido.total_usd });
        else toast.error(`Não deu para rodar ${nomeDoNo(c, id)} sozinho`, { description: textoDoErro(e) });
      }
    },
    [garantirSalvo, projetoId],
  );
  /** Sincronizar: roda de novo o nó e os executáveis antes dele (o rodar_tudo com alvo faz o mesmo), sempre pelo custo antes. */
  const sincronizarNo = useCallback(
    (id: string) => {
      const c = atual.current;
      const antes = ancestraisDe(c, id).filter((x) => {
        const n = c.nos.find((y) => y.id === x);
        return !!n && TIPOS_DE_NO[n.tipo].roda;
      });
      void pedirCusto({ tipo: "lista", ids: antes.concat(id), titulo: `Sincronizar ${nomeDoNo(c, id)}` });
    },
    [pedirCusto],
  );
  const abrirDetalhes = useCallback((id: string) => {
    setSelecionado(id);
    setDetalhes(true);
  }, []);
  useEffect(() => {
    if (!selecionado) setDetalhes(false);
  }, [selecionado]);

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
      clienteId={clienteDoProjeto}
      clientes={clientesDoSeletor}
      antesDeChamar={garantirSalvo}
      canvas={canvas}
      no={noSel}
      projetoId={projetoId}
      execucao={execucoes[noSel.id]}
      rodando={estimando === noSel.id || rodando}
      onMudarDados={(d) => mudar((c) => mudarDados(c, noSel.id, d))}
      onLigar={(de, para) => tentarLigar(de, para, false)}
      onDesligar={(id) => mudar((c) => desligar(c, id))}
      onMudarGatilho={(id, g) => mudar((c) => definirGatilho(c, id, g))}
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
      onFechar={lista ? undefined : () => setDetalhes(false)}
      avisoDeLigacao={null}
      onEscolherStoryboard={(i) => aoEscolherStoryboard(noSel.id, i)}
      escolhendo={escolhendo && escolhendo.no === noSel.id ? escolhendo.indice : null}
      trava={travasDoNoAr[noSel.id] || null}
      onResolverBloco={resolverOBloco}
      acoesDasImagens={{
        projetoId,
        clienteId: clienteDoProjeto,
        antesDeChamar: garantirSalvo,
        mudarDados: (id, dados) => mudar((c) => mudarDados(c, id, dados)),
        novaExecucao: aoNovaExecucao,
        usarComoReferencia: usarImagemComoReferencia,
      }}
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

  const sairDoSoCanvas = () => setSoCanvas(false);
  const abrirStudio = () => {
    setStudioRecolhido(false);
    setSoCanvas(false);
  };

  return (
    // !m-0: a página põe espaço entre os blocos (space-y) e o margin-top empurrava a tela cheia
    // 24 px para baixo, com o cabeçalho do Laboratório aparecendo por cima ("uma bordinha").
    <ProvedorDasPrevias canvas={canvas} execucoes={Object.values(execucoes)}>
    <div
      className={juntar("min-w-0", cobre && "fixed inset-0 z-40 !m-0 flex flex-col bg-background")}
      style={cobre ? AREA_SEGURA : undefined}
      data-editor-do-projeto={projetoId}
      data-tela-cheia-do-editor={cheia ? "" : undefined}
      data-so-canvas={soCanvas ? "" : undefined}
    >
      {/* Topo: a barra e o Canvas Studio (a altura do canvas acompanha o tamanho daqui). Some no "só o canvas". */}
      <div ref={refDoTopo} className={juntar("min-w-0", soCanvas && "hidden", cheia && "px-3 pt-2", cobre && etapa && "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3")} data-topo-do-editor="">
      <div className="mb-2 flex min-w-0 flex-wrap items-center" data-barra-do-editor="">
        <button type="button" className={juntar(botao.icone, "mr-1")} onClick={onVoltar} aria-label="Voltar aos projetos" title="Voltar aos projetos">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          aria-label="Nome do projeto"
          title={nome}
          className={juntar(campo, "mr-2 h-8 w-auto min-w-[96px] max-w-[260px] flex-1 truncate border-transparent bg-transparent px-1.5 text-[15px] font-semibold hover:border-input")}
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            nomeAtual.current = e.target.value;
            setSalvar((s) => (s.estado === "conflito" ? s : { estado: "pendente", erro: "" }));
          }}
        />
        {/* Celular (< 640): "Salvo"/"Salvando" só no ícone (nome no title); aviso de erro ou conflito continua com texto. */}
        <span role="status" className={juntar(texto.auxiliar, "mr-2 inline-flex shrink-0 items-center", (salvar.estado === "erro" || salvar.estado === "conflito") && "text-warning")} data-estado-do-salvar={salvar.estado} title={salvar.erro || rotuloDoSalvar}>
          {salvar.estado === "salvando" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : salvar.estado === "salvo" ? <Check className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
          <span className={salvar.estado === "salvo" || salvar.estado === "salvando" ? "sr-only sm:not-sr-only" : undefined}>{rotuloDoSalvar}</span>
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
        {/* No celular o nome ocupa a sobra (sem espaçador); de 640 para cima o espaçador empurra as ações. */}
        <span className="hidden flex-1 sm:block" />
        {projeto ? <ExportarProjeto projeto={{ ...projeto, nome, client_id: clienteDoProjeto }} canvas={canvas} execucoes={Object.values(execucoes)} clienteNome={nomeDoCliente(clientes, clienteDoProjeto)} disabled={rodando} /> : null}
        {/* Celular (< 640): só ícone, nome no title; o nome do projeto fica visível ao lado. */}
        <button type="button" className={juntar(botao.primario, "h-8 w-8 shrink-0 px-0 sm:w-auto sm:px-3")} onClick={() => void pedirCusto({ tipo: "tudo" })} disabled={!!estimando || rodando || !canvas.nos.length} aria-label="Rodar tudo" title="Rodar tudo (mostra o custo antes)" data-rodar-tudo="">
          {estimando === "tudo" ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />}
          <span className="hidden sm:inline">Rodar tudo</span>
        </button>
        <button type="button" className={juntar(botao.icone, "ml-1", agente && "text-primary")} onClick={() => setAgente(!agente)} aria-label={agente ? "Fechar o agente do projeto" : "Abrir o agente do projeto"} title="Agente do projeto" aria-pressed={agente}>
          {agente ? <PanelRightClose className="h-4 w-4" aria-hidden="true" /> : <PanelRightOpen className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button type="button" className={botao.icone} onClick={() => setLista(!lista)} aria-label={lista ? "Ver o quadro" : "Modo lista"} title={lista ? "Ver o quadro" : "Modo lista"}>
          {lista ? <Workflow className="h-4 w-4" aria-hidden="true" /> : <LayoutList className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button type="button" className={botao.icone} onClick={() => setCheia(!cheia)} aria-label={cheia ? "Sair da tela cheia" : "Tela cheia"} title={cheia ? "Sair da tela cheia (Esc)" : "Tela cheia"} aria-pressed={cheia}>
          {cheia ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
        </button>
        {!lista && !etapa ? (
          <button type="button" className={botao.icone} onClick={() => setSoCanvas(true)} aria-label="Canvas em tela cheia" title="Canvas em tela cheia: só o quadro, de ponta a ponta (Esc sai)" data-botao-so-canvas="">
            <Fullscreen className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        <MenuMais
          rotulo="Mais ações do projeto"
          itens={[
            { rotulo: "Organizar o quadro", icone: <LayoutGrid className="h-4 w-4" />, aoEscolher: () => mudar(organizar) },
            rodadasPendentes.length > 0 && { rotulo: cancelando ? "Cancelando etapas…" : "Cancelar etapas restantes", icone: <CircleStop className="h-4 w-4" />, desativado: cancelando, dica: "Cancela só o que ainda está esperando. As peças em geração ou prontas são preservadas.", aoEscolher: () => void cancelarEtapasRestantes() },
            { rotulo: "Salvar como fluxo pessoal", icone: <BookmarkPlus className="h-4 w-4" />, aoEscolher: () => setSalvarComo(nome) },
            { rotulo: "Duplicar para outro cliente", icone: <Copy className="h-4 w-4" />, aoEscolher: () => setDuplicarPara("") },
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
            { rotulo: "Excluir projeto", icone: <Trash2 className="h-4 w-4" />, perigo: true, aoEscolher: () => setExcluir(true) },
          ]}
        />
      </div>

      <FaixaDaCampanha projetoId={projetoId} clienteId={clienteDoProjeto} antesDeChamar={garantirSalvo} aoMudarCanvas={() => void recarregarDaPonte()} />

      <CanvasStudio
        projetoId={projetoId}
        nosNoQuadro={canvas.nos.length}
        clienteId={clienteDoProjeto}
        clientes={clientesDoSeletor}
        onCliente={mudarCliente}
        antesDePlanejar={garantirSalvo}
        onConstruir={construirDoStudio}
        onGerar={async (ids) => {
          if (!ids.length) { toast.info("Quadro atualizado", { description: "Os conteúdos prontos foram preservados. Use Gerar no nó para criar uma nova versão." }); return; }
          await pedirCusto({ tipo: "lista", ids, titulo: "Gerar os conteúdos do pedido" });
        }}
        onDesfazer={antesDaConstrucao ? desfazerConstrucao : null}
        onConversa={(pedido, resposta) => setRegistro({ id: String(Date.now()), pedido, resposta })}
        recolhido={studioRecolhido}
        onRecolher={setStudioRecolhido}
        onEtapa={setEtapa}
      />
      </div>

      {/* Perguntas primeiro: com a etapa aberta no Studio, o quadro sai (nada de canvas espremido embaixo). */}
      {etapa ? null : lista ? (
        <ModoListaDoLab canvas={canvas} execucoes={execucoes} selecionado={selecionado} onSelecionar={setSelecionado} onPor={(t) => por(t)} inspetor={inspetor} travas={motivosDasTravas} />
      ) : (
        <div ref={refDoCorpo} className={juntar("relative flex min-w-0", cobre && "min-h-0 flex-1", cheia && !soCanvas && "px-3 pb-3")} style={cobre ? undefined : { height: altura }} data-corpo-do-editor="">
          {soCanvas ? null : (
            <div className="mr-2 flex shrink-0 flex-col border-r border-border pr-1">
              <Paleta onPor={(t) => por(t)} />
            </div>
          )}
          <div className={juntar("relative min-w-0 flex-1 overflow-hidden", !soCanvas && "rounded-md border border-border")} data-area-do-quadro="">
            <QuadroDoLab
              canvas={canvas}
              execucoes={execucoes}
              selecionado={selecionado}
              rodandoNo={estimando && estimando !== "tudo" ? estimando : null}
              semTeclas={!!custo || salvarComo !== null || duplicarPara !== null || excluir}
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
              projetoId={projetoId}
              clienteId={clienteDoProjeto}
              onSincronizar={sincronizarNo}
              onAbrirDetalhes={abrirDetalhes}
              onMudarGatilho={(id, g) => mudar((c) => definirGatilho(c, id, g))}
              antesDeChamar={garantirSalvo}
              clientes={clientesDoSeletor}
              soCanvas={soCanvas}
              onSoCanvas={() => setSoCanvas(!soCanvas)}
              onRodarAutomatico={rodarAutomatico}
              onNovaExecucao={aoNovaExecucao}
            />
            {!canvas.nos.length && (
              <p className={juntar(texto.auxiliar, "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center")}>Peça no Canvas Studio acima, toque num ícone da paleta ou fale com o agente do projeto.</p>
            )}
            {avisoDoQuadro && (
              <p role="alert" className={juntar(texto.corpo, "absolute bottom-3 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-md border border-warning/40 bg-background px-3 py-2 text-warning")} data-aviso-do-quadro="">
                {avisoDoQuadro}
              </p>
            )}
            {inspetor && detalhes && (
              <div className="nowheel nodrag nopan absolute bottom-2 right-2 top-2 z-10 w-[300px] max-w-[85%] overflow-y-auto overscroll-contain rounded-md border border-border bg-background p-3 shadow-sm" data-painel-do-inspetor="">
                {inspetor}
              </div>
            )}
            {soCanvas && (
              // Mini barra flutuante do "só o canvas": sair, abrir o Studio e Rodar tudo.
              <div className="nowheel nodrag nopan absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center rounded-lg border border-border bg-background p-1 shadow-sm" role="toolbar" aria-label="Barra do canvas em tela cheia" data-mini-barra-do-canvas="">
                <button type="button" className={botao.icone} onClick={sairDoSoCanvas} aria-label="Sair do canvas em tela cheia" title="Sair do canvas em tela cheia (Esc)">
                  <Minimize2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" className={botao.icone} onClick={abrirStudio} aria-label="Abrir o Canvas Studio" title="Abrir o Canvas Studio (sai do canvas em tela cheia)">
                  <PanelTopOpen className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" className={juntar(botao.primario, "ml-1 h-8 w-8 px-0")} onClick={() => void pedirCusto({ tipo: "tudo" })} disabled={!!estimando || rodando || !canvas.nos.length} aria-label="Rodar tudo" title="Rodar tudo (mostra o custo antes)">
                  {estimando === "tudo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              </div>
            )}
          </div>
          {agente && largo && !soCanvas && <div className="ml-3 w-[340px] shrink-0">{painelDoAgente}</div>}
        </div>
      )}

      {agente && !largo && !soCanvas && (
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

      {/* Duplicar para outro cliente: o mesmo canvas num projeto novo, sem saídas nem mídias (src/lib/laboratorio/duplicar.ts). */}
      <JanelaCentral
        aberta={duplicarPara !== null}
        onFechar={() => (duplicando ? undefined : setDuplicarPara(null))}
        titulo="Duplicar para outro cliente"
        icone={<Copy className="h-4 w-4" />}
        largura="sm"
        rodape={
          <>
            <button type="button" className={botao.discreto} onClick={() => setDuplicarPara(null)} disabled={duplicando}>Cancelar</button>
            <button
              type="button"
              className={botao.primario}
              disabled={duplicando}
              data-confirmar-duplicar=""
              onClick={() => {
                const cid = duplicarPara || null;
                setDuplicando(true);
                garantirSalvo()
                  .then(() => duplicarProjeto(projetoId, cid, nomeDoCliente(clientes, cid)))
                  .then((novo) => {
                    toast.success("Projeto duplicado", { description: `${novo.nome}: mesmo canvas, sem saídas nem mídias.` });
                    void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
                    setDuplicarPara(null);
                    if (onAbrirOutro) onAbrirOutro(novo.id);
                  })
                  .catch((e) => toast.error("Não deu para duplicar", { description: textoDoErro(e) }))
                  .finally(() => setDuplicando(false));
              }}
            >
              {duplicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Duplicar
            </button>
          </>
        }
      >
        <label className={juntar(texto.rotulo, "mb-1 block")} htmlFor="duplicar-para">Cliente do projeto novo</label>
        <select id="duplicar-para" className={campo} value={duplicarPara || ""} onChange={(e) => setDuplicarPara(e.target.value)}>
          <option value="">Livre</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
        <p className={juntar(texto.auxiliar, "mt-2")}>Nome: {nomeDaCopiaNaTela(nome, nomeDoCliente(clientes, duplicarPara || null))}</p>
      </JanelaCentral>

      <JanelaDeExcluirProjeto
        projeto={excluir ? { id: projetoId, nome: nome || projeto.nome } : null}
        onFechar={() => setExcluir(false)}
        onExcluido={() => {
          setCheia(false);
          onVoltar();
        }}
      />
    </div>
    </ProvedorDasPrevias>
  );
}

export default function EditorDoProjeto(props: PropsDoEditor) {
  return (
    <ReactFlowProvider>
      <Editor key={props.projetoId} {...props} />
    </ReactFlowProvider>
  );
}
