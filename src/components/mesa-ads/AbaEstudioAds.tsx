import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ImageIcon, Clapperboard, Filter, Link2, Loader2, MoreHorizontal, PackageCheck, Send, Sparkles, Star, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import { chamarFuncao, textoDoErro, type Qualidade } from "@/lib/mesa/api";
import { repetirEntregaEmPartes } from "@/lib/mesa/entregaEmPartes";
import {
  chamarAds,
  chavesAds,
  ehOMelhor,
  formatoDe,
  irmaosDoCriativo,
  lerAnunciosDoCliente,
  lerCriativos,
  lerPlanos,
  lerTrabalhos,
  melhoresDoAngulo,
  mudarCriativo,
  nomeDoAnuncio,
  notaCurta,
  partesDaArte,
  parteDeTexto,
  porqueDoCriativo,
  STATUS_DO_CRIATIVO,
  TAMANHOS_ADS,
  type CriativoAds,
  type PlanoAds,
  type StatusDoCriativo,
} from "./adsApi";
const VideoDoCriativo = lazy(() => import("./VideoDoCriativo"));
import "./adsStudio.css";
import ArteDoCriativo, { capaDoTrabalho } from "./ArteDoCriativo";
import { ImportarPacote } from "./PacoteDeOtimizacao";
import ResultadoDoCriativo from "./ResultadoDoCriativo";
import { Andamento, useAndamento } from "./Comuns";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, juntar } from "@/components/sistema/estilos";
import { useAlturaQueCabe } from "@/components/sistema/AreaDeTrabalho";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import {
  arteDoPlanoPedida,
  laminasSemArte,
  pegarArteDoPlano,
  produzirLamina,
  situacaoDe,
  situacaoDoTrabalho,
  SITUACOES,
  type AndamentoDoLote,
  type EtapaDoLote,
  type SituacaoDoCriativo,
} from "./loteDoEstudio";
import { useModeloDaCopy } from "./ModeloDaCopy";
import ProgressoComParada from "./ProgressoComParada";
import PainelDaCopy from "./PainelDaCopy";
import PosicionamentosDoAnuncio from "./PosicionamentosDoAnuncio";
import type { CopyDoAnuncio } from "./adsApi";
import { EnvioAoGestor } from "./PacoteDaCopy";
import KitDeRecepcao from "./KitDeRecepcao";
import AcervoDoEstudio, { estaNaConta, podeIrParaAConta } from "./AcervoDoEstudio";
import BotaoDoEstilo from "@/components/estilo/BotaoDoEstilo";

/**
 * Etapa 4, Estúdio Ads: os criativos por plano e ângulo, cada um com a
 * situação clara (sem arte, gerando, conferindo, corrigindo, pronto,
 * entregue). Em lote: "Gerar todos" (gera, confere e corrige sozinho antes de
 * dar como pronto) e "Entregar ao cliente" (o cliente vê em Documentos >
 * Criativos de anúncio, sem aprovação). Ao abrir um criativo: a arte no
 * motor do Estúdio (ArteDoCriativo) em largura cheia e a copy com o pacote
 * completo ao lado (telas largas) ou embaixo.
 *
 * Frente CR (27/09, pedido do dono): lista por ângulo na ordem de teste, a
 * melhor variação primeiro (marcada) e o resto recolhido; cada criativo diz
 * em uma linha por que foi escolhido (estilo com o dado real ou padrão do
 * nicho, e a nota do Jev). O lote mostra o andamento (lâmina X de Y, custo
 * até agora) e tem Parar: o que já saiu fica, o resto não gera nem cobra.
 * "Criar criativos" do Plano de teste deixa o pedido de arte e o lote começa
 * sozinho ao abrir esta etapa.
 *
 * Frente AD4 (28/09, dono: "mais limpo, sem caixa, rolar menos"): o topo é
 * uma seção aberta (título, uma linha de estado com o selo "todos entregues"
 * quando é o caso, um primário e o "..."); o filtro só aparece quando há
 * situações diferentes. Resultado, kit, configuração da arte, pacote de copy
 * e prévias recolhem sem caixa, recolhidos por padrão, com uma linha de
 * resumo. A vista "Acervo" organiza criativos e copies por ângulo e formato,
 * com o kit de recepção e o "Enviar para a conta" (o agente sênior enxerga e
 * o Otimizar troca o anúncio ruim pelo melhor daqui, com Confirmar).
 */

export const AVISO_DA_ENTREGA = "O cliente vê em Documentos > Criativos de anúncio.";
export const AVISO_DA_CONTA = "O agente sênior de tráfego enxerga: no Otimizar, ele troca o anúncio ruim pelo melhor candidato daqui, com o seu Confirmar.";

/** O selo da linha de estado quando todos estão na mesma situação ("todos entregues"). */
export const TODOS_NA_SITUACAO: Record<SituacaoDoCriativo, string> = {
  sem_arte: "Todos sem arte",
  gerando: "Todos gerando",
  conferindo: "Todos conferindo",
  corrigindo: "Todos corrigindo",
  pronto: "Todos prontos",
  entregue: "Todos entregues",
};

export function SeloDoStatus({ status }: { status: StatusDoCriativo }) {
  const s = STATUS_DO_CRIATIVO.find((x) => x.valor === status) || STATUS_DO_CRIATIVO[0];
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium ${s.tom}`}>{s.rotulo}</span>;
}

export function SeloDaSituacao({ situacao }: { situacao: SituacaoDoCriativo }) {
  const s = situacaoDe(situacao);
  const andando = situacao === "gerando" || situacao === "conferindo" || situacao === "corrigindo";
  return (
    <span data-situacao={situacao} className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium ${s.tom}`}>
      {andando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {s.rotulo}
    </span>
  );
}

/** Nome do criativo: o dado, senão o ângulo do plano e o formato. */
export function nomeDoCriativo(c: CriativoAds, planos: PlanoAds[]): string {
  if (c.nome) return c.nome;
  const plano = planos.find((p) => p.id === c.plano_id);
  const angulo = plano ? plano.angulos.find((a) => a.id === c.angulo_id) : null;
  return `${angulo ? angulo.nome : "Criativo"} · ${formatoDe(c.formato).curto}`;
}

interface Grupo {
  chave: string;
  plano: string;
  angulo: string;
  criativos: CriativoAds[];
  /** Frente CR: posição do plano na lista e do ângulo no plano (ordem de teste). */
  ordemDoPlano: number;
  ordemDoAngulo: number;
}

/** Criativos por plano e ângulo, na ordem de teste do plano (o primeiro a testar em cima). */
export function agrupar(criativos: CriativoAds[], planos: PlanoAds[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const c of criativos) {
    const iPlano = planos.findIndex((p) => p.id === c.plano_id);
    const plano = iPlano >= 0 ? planos[iPlano] : null;
    const iAngulo = plano ? plano.angulos.findIndex((a) => a.id === c.angulo_id) : -1;
    const angulo = plano && iAngulo >= 0 ? plano.angulos[iAngulo] : null;
    const chave = `${c.plano_id || "-"}:${c.angulo_id || "-"}`;
    let g = grupos.find((x) => x.chave === chave);
    if (!g) {
      g = {
        chave,
        plano: plano ? plano.nome : "Sem plano",
        angulo: angulo ? angulo.nome : "Sem ângulo",
        criativos: [],
        ordemDoPlano: iPlano >= 0 ? iPlano : 999,
        ordemDoAngulo: angulo && typeof angulo.ordem_teste === "number" ? angulo.ordem_teste : iAngulo >= 0 ? 100 + iAngulo : 999,
      };
      grupos.push(g);
    }
    g.criativos.push(c);
  }
  return grupos.sort((a, b) => a.ordemDoPlano - b.ordemDoPlano || a.ordemDoAngulo - b.ordemDoAngulo);
}

/** Tela de 1800 px ou mais (a copy vira a terceira coluna). addListener: Safari 11 não tem addEventListener no MediaQueryList. */
function useTelaGrande(): boolean {
  const consulta = "(min-width: 1800px)";
  const [grande, setGrande] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(consulta).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(consulta);
    const mudou = () => setGrande(m.matches);
    mudou();
    m.addListener(mudou);
    return () => m.removeListener(mudou);
  }, []);
  return grande;
}

export default function AbaEstudioAds({
  criativoId,
  onCriativo,
  planoId,
  onVerTodos,
  onImportado,
}: {
  criativoId: string | null;
  onCriativo: (id: string | null) => void;
  /** Plano em foco (vindo de "Produzir criativos"): a lista mostra só ele. */
  planoId: string | null;
  onVerTodos?: () => void;
  /** v5: plano criado pelo "Importar pacote" (retorno do agente externo). */
  onImportado?: (planoId: string) => void;
}) {
  const mesa = useMesa();
  const { clientId, catalogo, clientName } = mesa;
  // Copy ao vivo do painel, para as prévias de posicionamento na faixa de baixo.
  const [copyAoVivo, setCopyAoVivo] = useState<{ id: string; copy: CopyDoAnuncio } | null>(null);
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const criativos = useQuery({ queryKey: chavesAds.criativos(clientId), queryFn: () => lerCriativos(clientId) });
  const planos = useQuery({ queryKey: chavesAds.planos(clientId), queryFn: () => lerPlanos(clientId) });
  const anuncios = useQuery({ queryKey: chavesAds.anuncios(clientId), queryFn: () => lerAnunciosDoCliente(clientId) });
  const [etapas, setEtapas] = useState<Record<string, EtapaDoLote>>({});
  // Filtro por situação lembrado por cliente (sair e voltar mantém).
  const [filtro, setFiltro] = useEstadoDaTela<SituacaoDoCriativo | "">(`mesa-ads:estudio:situacao:${clientId}`, "", { validar: (v) => typeof v === "string", esperaMs: 0 });
  const [entregando, setEntregando] = useState<string[]>([]);
  const [armado, setArmado] = useState<string | null>(null);
  const [desdeLote, rodarLote] = useAndamento();
  const [desdePacote, rodarPacote] = useAndamento();
  // Frente CR: andamento do lote à vista e o Parar (vale antes da próxima lâmina).
  const [lote, setLote] = useState<AndamentoDoLote | null>(null);
  const pararLote = useRef(false);
  // Grupos de ângulo com as outras variações abertas (a melhor fica sempre à vista).
  const [abertosOutros, setAbertosOutros] = useState<string[]>([]);
  const modeloDaCopy = useModeloDaCopy();
  // Frente AD4: o que ver (criativos ou acervo) lembrado por cliente; os "..." e as prévias recolhidas.
  const [midia, setMidia] = useEstadoDaTela<"arte" | "video">(`ads:midia:${clientId}`, "arte");
  const [vista, setVista] = useEstadoDaTela<"criativos" | "acervo">(`mesa-ads:estudio:vista:${clientId}`, "criativos", { validar: (v) => v === "criativos" || v === "acervo", esperaMs: 0 });
  const [maisAberto, setMaisAberto] = useState(false);
  const [maisDoCriativo, setMaisDoCriativo] = useState(false);
  const [naConta, setNaConta] = useState<string[]>([]);
  const [posicionamentosRecolhidos, setPosicionamentosRecolhidos] = useRecolhido(`mesa-ads:estudio:posicionamentos:${clientId}`, true);
  // A grade ocupa a altura que cabe (de onde começa até o fim da janela); mede de novo quando o topo muda.
  const { ref: refDaGrade, altura: alturaDaGrade, medir: medirAGrade } = useAlturaQueCabe(vista === "criativos");
  const telaGrande = useTelaGrande();
  const listaDePlanos = planos.data || [];
  const todos = criativos.data || [];
  const doPlano = planoId ? todos.filter((c) => c.plano_id === planoId) : todos;
  const visiveis = doPlano.length ? doPlano : todos;
  const idsDosTrabalhos = useMemo(() => visiveis.map((c) => c.trabalho_id).filter(Boolean).sort() as string[], [visiveis]);
  const temTrabalhos = visiveis.some((c) => !!c.trabalho_id);
  const trabalhos = useQuery({
    queryKey: chavesAds.trabalhos(clientId).concat([idsDosTrabalhos.join(",")]),
    enabled: idsDosTrabalhos.length > 0,
    queryFn: () => lerTrabalhos(idsDosTrabalhos),
    // Direção montando ou arte gerando: relê até assentar.
    refetchInterval: (q) => {
      const dados = (q.state.data || []) as any[];
      const montando = dados.some((t) => !(t.direcao && Array.isArray(t.direcao.cards) && t.direcao.cards.length));
      const gerando = dados.some((t) => t.status === "gerando");
      return temTrabalhos && (montando || gerando) ? 8000 : false;
    },
  });
  const trabalhoDe = (c: CriativoAds): Trabalho | null =>
    c.trabalho_id ? (((trabalhos.data || []) as any[]).find((t) => t.id === c.trabalho_id) as Trabalho) || null : null;
  const situacao = (c: CriativoAds): SituacaoDoCriativo => situacaoDoTrabalho(trabalhoDe(c), c.trabalho_id ? etapas[c.trabalho_id] : null);

  const contagem = (s: SituacaoDoCriativo) => visiveis.filter((c) => situacao(c) === s).length;
  // Todos na mesma situação: o filtro some (vira o selo "todos entregues") e não esconde nada.
  const presentes = SITUACOES.filter((s) => contagem(s.valor) > 0);
  const unica = presentes.length === 1 ? presentes[0] : null;
  const filtroEfetivo: SituacaoDoCriativo | "" = unica ? "" : filtro;
  const filtrados = filtroEfetivo ? visiveis.filter((c) => situacao(c) === filtroEfetivo) : visiveis;
  const aberto = visiveis.find((c) => c.id === criativoId) || filtrados[0] || visiveis[0] || null;
  const trabalho = aberto ? trabalhoDe(aberto) : null;
  const grupos = agrupar(filtrados, listaDePlanos);
  const planoEmFoco = planoId && doPlano.length ? planoId : visiveis.length && visiveis.every((c) => c.plano_id === visiveis[0].plano_id) ? visiveis[0].plano_id : null;

  const semArte = visiveis.filter((c) => {
    const t = trabalhoDe(c);
    return !!t && laminasSemArte(t).length > 0 && !(c.trabalho_id && etapas[c.trabalho_id]);
  });
  const laminasPendentes = semArte.reduce((n, c) => n + laminasSemArte(trabalhoDe(c)).length, 0);
  const prontos = visiveis.filter((c) => situacao(c) === "pronto" && !!c.trabalho_id);
  const primeiroDoLote = semArte.length ? trabalhoDe(semArte[0]) : null;
  const qualidadeDoLote = ((primeiroDoLote && primeiroDoLote.qualidade) as Qualidade) || "media";
  const modeloDoLote = primeiroDoLote ? primeiroDoLote.modelo_imagem_id : null;

  const atualizarTrabalhos = () => {
    void queryClient.invalidateQueries({ queryKey: chavesAds.trabalhos(clientId) });
  };

  const marcar = (trabalhoId: string, e: EtapaDoLote | null) =>
    setEtapas((atual) => {
      const n = { ...atual };
      if (e) n[trabalhoId] = e;
      else delete n[trabalhoId];
      return n;
    });

  /**
   * Gera, confere e (uma vez, só texto e logo) corrige cada lâmina sem arte dos
   * criativos da fila. Frente CR: andamento à vista e Parar; parado, o que já
   * saiu fica e o resto não é gerado nem cobrado.
   */
  const gerarLote = async (alvo: CriativoAds[]) => {
    const fila = alvo.map((c) => ({ c, t: trabalhoDe(c) })).filter((x): x is { c: CriativoAds; t: Trabalho } => !!x.t && laminasSemArte(x.t).length > 0);
    const totalDeLaminas = fila.reduce((n, x) => n + laminasSemArte(x.t).length, 0);
    fila.forEach(({ t }) => marcar(t.id, "fila"));
    pararLote.current = false;
    setLote({ feitas: 0, total: totalDeLaminas, custo_usd: 0, atual: fila.length ? nomeDoCriativo(fila[0].c, listaDePlanos) : "", parando: false });
    let total = 0;
    let feitas = 0;
    let pendentes = 0;
    try {
      for (const { c, t } of fila) {
        if (pararLote.current) break;
        setLote((l) => (l ? { ...l, atual: nomeDoCriativo(c, listaDePlanos) } : l));
        for (const ordem of laminasSemArte(t)) {
          if (pararLote.current) break;
          const r = await produzirLamina((corpo) => chamarFuncao<any>("estudio-arte", corpo), t.id, ordem, (e) => marcar(t.id, e), 1, () => pararLote.current);
          total += r.custo_usd;
          feitas += 1;
          if (r.pendencias && r.pendencias.length) pendentes += 1;
          setLote((l) => (l ? { ...l, feitas, custo_usd: total } : l));
          atualizarTrabalhos();
        }
        marcar(t.id, null);
      }
    } finally {
      fila.forEach(({ t }) => marcar(t.id, null));
      const parado = pararLote.current;
      pararLote.current = false;
      setLote(null);
      atualizarTrabalhos();
      mesa.atualizarCusto();
      if (parado) toast.info("Lote parado", { description: `${feitas} de ${totalDeLaminas} lâmina(s) prontas. O resto não foi gerado nem cobrado.` });
    }
    if (pendentes) toast.warning("Arte com ponto a revisar", { description: `${pendentes} lâmina(s) seguem com aviso da conferência. Abra o criativo e use Corrigir de novo.` });
    return { custo_usd: total };
  };
  const gerarTodos = () => gerarLote(semArte);

  // "Criar criativos" do Plano de teste: as artes começam sozinhas quando os trabalhos chegam (custo já confirmado lá).
  const pedidoDeArte = arteDoPlanoPedida(planoId);
  const trabalhosProntos = !!trabalhos.data && !trabalhos.isFetching;
  // O topo da grade desce quando o "..." abre, o andamento do lote aparece ou a linha de estado muda: mede de novo.
  useEffect(() => {
    const t = window.setTimeout(medirAGrade, 30);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maisAberto, !!lote, !!pedidoDeArte, vista, desdePacote !== null, criativos.isLoading]);

  useEffect(() => {
    if (!planoId || !pedidoDeArte || !trabalhosProntos || desdeLote !== null) return;
    const alvo = todos.filter((c) => pedidoDeArte.indexOf(c.id) >= 0);
    // Espera os criativos novos chegarem na lista e os trabalhos deles carregarem.
    if (alvo.length < pedidoDeArte.length || alvo.some((c) => !trabalhoDe(c))) return;
    pegarArteDoPlano(planoId);
    void rodarLote(() => gerarLote(alvo)).catch((e) => avisarErro(e, "As artes não foram geradas"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planoId, pedidoDeArte ? pedidoDeArte.join(",") : "", trabalhosProntos, todos.length, (trabalhos.data || []).length]);

  const entregar = async (lista: CriativoAds[]) => {
    const ids = lista.map((c) => c.id);
    setEntregando((e) => e.concat(ids));
    let ok = 0;
    const falhas: unknown[] = [];
    for (const c of lista) {
      try {
        // AB2: entrega em partes (limite de CPU) continua sozinha.
        await repetirEntregaEmPartes(() => chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: c.trabalho_id, nome: nomeDoCriativo(c, listaDePlanos) }));
        ok += 1;
      } catch (e) {
        falhas.push(e);
      }
    }
    setEntregando((e) => e.filter((x) => ids.indexOf(x) < 0));
    atualizarTrabalhos();
    if (ok) toast.success(ok === 1 ? "Criativo entregue" : `${ok} criativos entregues`, { description: AVISO_DA_ENTREGA });
    if (falhas.length) avisarErro(falhas[0], falhas.length === 1 ? "Um criativo não foi entregue" : `${falhas.length} criativos não foram entregues`);
  };

  /** Entregar pede um segundo clique (o cliente passa a ver). */
  const armarOuEntregar = (chave: string, lista: CriativoAds[]) => {
    if (armado !== chave) {
      setArmado(chave);
      window.setTimeout(() => setArmado((a) => (a === chave ? null : a)), 6000);
      return;
    }
    setArmado(null);
    void entregar(lista);
  };

  const mudar = async (c: CriativoAds, campos: { status?: StatusDoCriativo; ad_id?: string | null }, aviso: string) => {
    const chave = chavesAds.criativos(clientId);
    const antes = queryClient.getQueryData<CriativoAds[]>(chave);
    queryClient.setQueryData<CriativoAds[]>(chave, (l) => (l || []).map((x) => (x.id === c.id ? { ...x, ...campos } : x)));
    try {
      await mudarCriativo(c.id, campos);
      toast.success(aviso);
    } catch (e) {
      queryClient.setQueryData(chave, antes);
      toast.error("Não foi possível salvar", { description: textoDoErro(e) });
    }
  };

  // Frente AD4 (28/09): "enviar para a conta" = status "pronto" (na conta); o agente sênior enxerga e o
  // Otimizar usa como candidato. Tirar da conta volta a rascunho (nada é apagado).
  const mudarStatusEmLote = async (lista: CriativoAds[], status: StatusDoCriativo) => {
    const ids = lista.map((c) => c.id);
    const chave = chavesAds.criativos(clientId);
    const antes = queryClient.getQueryData<CriativoAds[]>(chave);
    setNaConta((o) => o.concat(ids));
    queryClient.setQueryData<CriativoAds[]>(chave, (l) => (l || []).map((x) => (ids.indexOf(x.id) >= 0 ? { ...x, status } : x)));
    let ok = 0;
    const falhas: unknown[] = [];
    for (const c of lista) {
      try {
        await mudarCriativo(c.id, { status });
        ok += 1;
      } catch (e) {
        falhas.push(e);
      }
    }
    setNaConta((o) => o.filter((x) => ids.indexOf(x) < 0));
    if (falhas.length) {
      queryClient.setQueryData(chave, antes);
      void queryClient.invalidateQueries({ queryKey: chave });
      avisarErro(falhas[0], status === "pronto" ? "Nem todos foram para a conta" : "Nem todos saíram da conta");
    }
    if (ok && status === "pronto") toast.success(ok === 1 ? "Criativo na conta" : `${ok} criativos na conta`, { description: AVISO_DA_CONTA });
    if (ok && status === "rascunho") toast.info(ok === 1 ? "Criativo fora da conta" : `${ok} criativos fora da conta`, { description: "O agente sênior deixa de usar como candidato. Nada foi apagado." });
  };
  const enviarParaConta = (lista: CriativoAds[]) => mudarStatusEmLote(lista, "pronto");
  const tirarDaConta = (lista: CriativoAds[]) => mudarStatusEmLote(lista, "rascunho");
  /** Enviar para a conta pede um segundo clique, como o entregar. */
  const armarOuEnviarConta = (chave: string, lista: CriativoAds[]) => {
    if (armado !== chave) {
      setArmado(chave);
      window.setTimeout(() => setArmado((a) => (a === chave ? null : a)), 6000);
      return;
    }
    setArmado(null);
    void enviarParaConta(lista);
  };

  if (criativos.isLoading) return <Carregando forma="aba" rotulo="Lendo os criativos" />;
  if (criativos.isError) return <AvisoDeErro erro={criativos.error} />;
  if (!todos.length) {
    return (
      <EstadoVazio
        icone={<Clapperboard className="h-5 w-5" />}
        titulo="Nenhum criativo produzido ainda"
        descricao={'No Plano de teste, escolha os ângulos e os formatos e use "Produzir criativos".'}
      />
    );
  }

  const listaDeAnuncios = anuncios.data || [];
  // v3: formatos irmãos do criativo aberto (mesmo ângulo e variação) e o ângulo com a meta.
  const irmaos = aberto ? irmaosDoCriativo(aberto, todos).map((c) => ({ criativo: c, trabalho: trabalhoDe(c) })) : [];
  const planoAberto = aberto ? listaDePlanos.find((p) => p.id === aberto.plano_id) || null : null;
  const anguloAberto = aberto && planoAberto ? planoAberto.angulos.find((a) => a.id === aberto.angulo_id) || null : null;
  const anuncioLigado = aberto && aberto.ad_id ? listaDeAnuncios.find((a) => a.ad_id === aberto.ad_id) : null;
  const situacaoAberta = aberto ? situacao(aberto) : "sem_arte";

  // 28/09 (frente AD4, dono): "Todos entregues" vira um selo na linha de estado, sem o filtro gigante.
  const naContaN = visiveis.filter(estaNaConta).length;
  const aptosParaConta = visiveis.filter((c) => podeIrParaAConta(c, situacao(c)));
  const porFocoParcial = planoId && doPlano.length > 0 && doPlano.length < todos.length;
  const selo = unica ? (visiveis.length > 1 ? TODOS_NA_SITUACAO[unica.valor] : unica.rotulo) : null;

  // Um primário por área: gerar o que falta, senão entregar o pronto, senão mandar o entregue para a conta.
  const botaoGerar = (primario: boolean) => (
    <BotaoComCusto
      rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Gerar todos{laminasPendentes ? ` (${laminasPendentes})` : ""}</>}
      titulo="Gerar todas as artes"
      descricao="Gera cada lâmina sem arte e confere antes de dar como pronta (texto ou logo errados: uma correção só na área deles). Com andamento e Parar."
      variant={primario ? "default" : "outline"}
      className="h-8"
      disabled={!laminasPendentes || desdeLote !== null}
      partes={() => partesDaArte(catalogo, laminasPendentes, qualidadeDoLote, modeloDoLote)}
      executar={() => rodarLote(gerarTodos)}
    />
  );
  const botaoEntregar = (primario: boolean) => (
    <Button
      type="button"
      size="sm"
      variant={primario || armado === "lote" ? "default" : "outline"}
      className="h-8"
      disabled={!prontos.length || entregando.length > 0}
      onClick={() => armarOuEntregar("lote", prontos)}
      title={`Entrega os criativos prontos sem aprovação. ${AVISO_DA_ENTREGA}`}
      aria-label={armado === "lote" ? `Confirmar entrega de ${prontos.length}` : `Entregar ao cliente${prontos.length ? ` (${prontos.length})` : ""}`}
    >
      {entregando.length > 0 ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="mr-1 h-3.5 w-3.5" />}
      {armado === "lote" ? (
        `Confirmar entrega de ${prontos.length}`
      ) : (
        <>
          Entregar<span className="hidden sm:inline"> ao cliente</span>
          {prontos.length ? ` (${prontos.length})` : ""}
        </>
      )}
    </Button>
  );
  const botaoConta = (primario: boolean) => (
    <Button
      type="button"
      size="sm"
      variant={primario || armado === "conta" ? "default" : "outline"}
      className="h-8"
      disabled={!aptosParaConta.length || naConta.length > 0}
      onClick={() => armarOuEnviarConta("conta", aptosParaConta)}
      title={AVISO_DA_CONTA}
      aria-label={armado === "conta" ? `Confirmar: ${aptosParaConta.length} para a conta` : `Enviar para a conta (${aptosParaConta.length})`}
    >
      {naConta.length > 0 ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
      {armado === "conta" ? (
        `Confirmar: ${aptosParaConta.length} para a conta`
      ) : (
        <>
          <span className="hidden sm:inline">Enviar para a conta</span>
          <span className="sm:hidden">Conta</span>
          {` (${aptosParaConta.length})`}
        </>
      )}
    </Button>
  );
  const primario = laminasPendentes ? "gerar" : prontos.length ? "entregar" : aptosParaConta.length ? "conta" : null;
  // A copy: terceira coluna (região própria) na tela grande; embaixo da arte no notebook e no celular.
  const colunaDaCopy = aberto ? (
    <div className={juntar("min-w-0", telaGrande && "h-full overflow-y-auto overscroll-contain")} data-coluna-da-copy="">
      <PainelDaCopy key={aberto.id} criativo={aberto} caminhoDaArte={capaDoTrabalho(trabalho)} nome={nomeDoCriativo(aberto, listaDePlanos)} aoMudarCopy={(c) => setCopyAoVivo({ id: aberto.id, copy: c })} />
    </div>
  ) : null;

  return (
    <div className="min-w-0 space-y-4">
      <section className="min-w-0" aria-label="Produção em lote">
        <CabecalhoDeSecao
          titulo="Estúdio Ads"
          ajuda={
            <>
              A arte só aparece depois de conferida; texto ou logo errados são corrigidos uma vez, só na área deles. Gerar todos gera e confere cada lâmina sem arte, com o andamento e o Parar. Em cada ângulo a melhor variação vem primeiro, com o porquê. Entregar ao cliente pede um segundo clique: {AVISO_DA_ENTREGA} Enviar para a conta deixa o criativo à mão do agente sênior de tráfego (no Otimizar, ele troca o anúncio ruim pelo melhor do acervo, com o seu Confirmar).
            </>
          }
          descricao={
            <span data-linha-de-estado="">
              {visiveis.length} criativo{visiveis.length === 1 ? "" : "s"}
              {porFocoParcial ? ` do plano em foco (de ${todos.length})` : ""}
              {porFocoParcial && onVerTodos && (
                <>
                  {" "}
                  <button type="button" className="text-primary hover:underline" onClick={onVerTodos}>
                    Ver todos
                  </button>
                </>
              )}
              {selo && (
                <span className={juntar("ml-1.5 inline-flex h-5 items-center rounded-full px-2 align-middle text-[10.5px] font-medium", unica ? unica.tom : "")} data-selo-da-situacao={unica ? unica.valor : ""}>
                  {selo}
                </span>
              )}
              {naContaN > 0 && <span className="ml-1.5">· {naContaN} na conta</span>}
            </span>
          }
          acao={
            <>
              {midia === "arte" && primario === "gerar" && botaoGerar(true)}
              {midia === "arte" && primario === "entregar" && botaoEntregar(true)}
              {midia === "arte" && primario === "conta" && botaoConta(true)}
              <button
                type="button"
                className={botao.icone}
                hidden={midia === "video"}
                aria-label="Mais ações do Estúdio Ads"
                aria-expanded={maisAberto}
                title="Mais ações"
                onClick={() => setMaisAberto(!maisAberto)}
                data-mais-do-estudio=""
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </>
          }
        />
        {/* Linha 2: o que ver (criativos ou acervo) e, só quando há situações diferentes, o filtro. */}
        <div className="mt-2 flex min-w-0 flex-wrap items-center" data-controles-do-estudio="">
          <SeletorCompacto
            rotulo="O que ver"
            className="mb-1 mr-2"
            opcoes={[
              { valor: "criativos", rotulo: "Criativos" },
              { valor: "acervo", rotulo: naContaN ? `Acervo · ${naContaN} na conta` : "Acervo" },
            ]}
            valor={vista}
            onEscolher={(v) => setVista(v === "acervo" ? "acervo" : "criativos")}
          />
          {vista === "criativos" && <div className="mb-1 mr-2 inline-flex rounded-lg border bg-secondary/40 p-1" role="group" aria-label="Formato do estúdio">
            {([['arte', 'Arte', ImageIcon], ['video', 'Vídeo', Clapperboard]] as const).map(([id, nome, Icone]) => <button key={id} type="button" aria-pressed={midia === id} title={nome} onClick={() => setMidia(id)} className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs ${midia === id ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}><Icone className="mr-1.5 h-3.5 w-3.5" />{nome}</button>)}
          </div>}
          {vista === "criativos" && !unica && (
            <SeletorCompacto
              rotulo="Filtrar por situação"
              className="mb-1"
              icone={<Filter className="h-3.5 w-3.5" />}
              opcoes={[{ valor: "", rotulo: `Todos (${visiveis.length})` }].concat(
                SITUACOES.filter((s) => contagem(s.valor) > 0 || filtro === s.valor).map((s) => ({ valor: s.valor, rotulo: `${s.rotulo} (${contagem(s.valor)})` })),
              )}
              valor={filtroEfetivo}
              onEscolher={(v) => setFiltro(v as SituacaoDoCriativo | "")}
            />
          )}
        </div>
        {/* O "...": o secundário num lugar só (estilo, importar, copy do plano e o que não é o primário agora). */}
        {midia === "arte" && maisAberto && (
          <div className="mt-2 flex min-w-0 flex-wrap items-center border-t border-border pt-2" hidden={midia === "video"}
                aria-label="Mais ações do Estúdio Ads" role="group" data-menu-mais="">
            {primario !== "gerar" && laminasPendentes > 0 && <span className="mb-1 mr-2 inline-flex items-center">{botaoGerar(false)}</span>}
            {primario !== "entregar" && prontos.length > 0 && <span className="mb-1 mr-2 inline-flex items-center">{botaoEntregar(false)}</span>}
            {primario !== "conta" && aptosParaConta.length > 0 && <span className="mb-1 mr-2 inline-flex items-center">{botaoConta(false)}</span>}
            <BotaoDoEstilo trabalhoIds={idsDosTrabalhos} modeloImagemId={modeloDoLote} className="mb-1 mr-2" />
            <ImportarPacote onImportado={onImportado} className="mb-1 mr-2" />
            {planoEmFoco && (
              <span className="mb-1 flex min-w-0 flex-wrap items-center">
                <span className="mb-1 mr-2 text-[11.5px] text-muted-foreground">Copy do plano:</span>
                <span className="mb-1 mr-2 inline-flex items-center">
                  <BotaoComCusto
                    rotulo="Pacote de copy de todos"
                    titulo="Pacote de copy do plano"
                    descricao="Gera o pacote completo de copy de cada criativo do plano (até o tempo da função acabar; o que faltar fica pendente)."
                    variant="outline"
                    className="h-8"
                    disabled={desdePacote !== null}
                    partes={() => [parteDeTexto(modeloDaCopy, TAMANHOS_ADS.pacotePorCriativo.entrada + 2000, TAMANHOS_ADS.pacotePorCriativo.saida, Math.max(1, doPlano.length || visiveis.length))]}
                    executar={() => rodarPacote(() => chamarAds<any>("copy_pacote", { plano_id: planoEmFoco, ...modeloDaCopy.corpo }))}
                    aoConcluir={(data) => {
                      void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
                      const pend = data && Array.isArray(data.pendentes) ? data.pendentes.length : 0;
                      if (pend) toast.info("Parte do pacote ficou para depois", { description: `${pend} criativo(s) pendentes. Clique de novo para continuar.` });
                    }}
                  />
                </span>
                <EnvioAoGestor corpo={() => ({ plano_id: planoEmFoco })} rotulo="Enviar pacote do plano ao gestor" />
              </span>
            )}
          </div>
        )}
        <Andamento desde={desdePacote} rotulo="Escrevendo os pacotes" />
        {lote ? (
          <ProgressoComParada
            className="mt-2"
            rotulo="Gerando e conferindo as artes"
            unidade={lote.total === 1 ? "lâmina" : "lâminas"}
            feitas={lote.feitas}
            total={lote.total}
            atual={lote.atual}
            custo={lote.custo_usd}
            parando={lote.parando}
            onParar={() => {
              pararLote.current = true;
              setLote((l) => (l ? { ...l, parando: true } : l));
            }}
          />
        ) : pedidoDeArte && desdeLote === null ? (
          <p className="mt-2 text-[12px] text-muted-foreground" role="status">Preparando as artes dos criativos novos…</p>
        ) : null}
      </section>

      {vista === "acervo" ? (
        <AcervoDoEstudio
          criativos={visiveis}
          planos={listaDePlanos}
          trabalhoDe={trabalhoDe}
          situacao={situacao}
          onAbrir={(id) => {
            setVista("criativos");
            onCriativo(id);
          }}
          onEnviar={enviarParaConta}
          onTirar={tirarDaConta}
          ocupados={naConta}
        />
      ) : (
      /* Notebook (até 1799 px): lista ao lado e, na coluna larga, a arte, a copy e
          os posicionamentos um embaixo do outro. Tela grande (1800 px ou mais): a
          copy vira terceira coluna e os posicionamentos ficam logo abaixo da arte.
          Antes a copy ia para a lateral já em 1536 px (o notebook com zoom de 125%)
          e sobrava um buraco enorme embaixo da arte (dono, 25/09).
          28/09 (frente AD4, dono: "nenhum espaço sobrando embaixo e nada cortado,
          nem na tela cheia"): a grade ocupa a altura medida de onde ela começa até o
          fim da janela (useAlturaQueCabe), e não mais 100vh menos um número fixo;
          cada coluna é uma região com a própria rolagem, e a página não rola junto.
          No celular a página rola e as colunas vão uma embaixo da outra. */
      <div
        ref={refDaGrade}
        style={alturaDaGrade ? { height: `${alturaDaGrade}px` } : undefined}
        className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)] min-[1800px]:grid-cols-[260px_minmax(0,1fr)_400px]"
        data-estudio-ads-grade=""
      >
        <aside className="min-w-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain" aria-label="Criativos">
          {grupos.length === 0 && <p className="px-1 text-[12px] text-muted-foreground">Nenhum criativo nessa situação.</p>}
          {grupos.map((g) => {
            // Frente CR: a melhor variação do ângulo à vista (marcada); as outras recolhidas.
            const { melhores, outros } = melhoresDoAngulo(g.criativos);
            const outrosAbertos = abertosOutros.indexOf(g.chave) >= 0 || (!!aberto && outros.some((c) => c.id === aberto.id));
            const item = (c: CriativoAds) => {
              const ativo = aberto && aberto.id === c.id;
              const capa = capaDoTrabalho(trabalhoDe(c));
              const nota = notaCurta(c.copy.escolha ? c.copy.escolha.nota : null);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onCriativo(c.id)}
                    aria-current={ativo ? "true" : undefined}
                    className={`flex w-full min-w-0 items-center rounded-lg border p-1.5 text-left transition-colors ${ativo ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}
                  >
                    <span className="mr-2 block h-12 w-10 shrink-0 overflow-hidden rounded-md bg-secondary">{capa ? <ImagemDaMesa caminho={capa} alt="" className="h-full w-full" /> : null}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center text-[12px] font-medium">
                        <span className="min-w-0 truncate">{formatoDe(c.formato).rotulo}</span>
                        {ehOMelhor(c) && (
                          <span className="ml-1 inline-flex shrink-0 items-center text-[10.5px] font-medium text-primary" title="Melhor variação do ângulo pela conferência do Jev">
                            <Star className="mr-0.5 h-3 w-3" /> melhor
                          </span>
                        )}
                        {nota && <span className="ml-1 shrink-0 text-[10.5px] tabular-nums text-muted-foreground" title="Nota do Jev da copy">{nota}</span>}
                      </span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center">
                        <SeloDaSituacao situacao={situacao(c)} />
                        {estaNaConta(c) && <span className="ml-1 text-[10.5px] font-medium text-primary" title="Na conta: o agente sênior enxerga">na conta</span>}
                        {c.ad_id && <Link2 className="ml-1 h-3 w-3 text-success" aria-label="ligado a um anúncio" />}
                      </span>
                    </span>
                  </button>
                </li>
              );
            };
            return (
              <div key={g.chave} className="mb-3" data-grupo-do-angulo={g.chave}>
                <p className="truncate px-1 text-[10px] uppercase tracking-wider text-muted-foreground" title={g.plano}>
                  {g.plano}
                </p>
                <p className="mb-1.5 truncate px-1 text-[12px] font-semibold" title={g.angulo}>
                  {g.angulo}
                </p>
                <ul className="space-y-1">{melhores.map(item)}</ul>
                {outros.length > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={outrosAbertos}
                      onClick={() => setAbertosOutros((l) => (l.indexOf(g.chave) >= 0 ? l.filter((x) => x !== g.chave) : l.concat([g.chave])))}
                      className="mt-1 flex w-full min-w-0 items-center rounded px-1 py-0.5 text-left text-[11.5px] text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className={`mr-1 h-3.5 w-3.5 shrink-0 transition-transform ${outrosAbertos ? "rotate-180" : ""}`} />
                      <span className="min-w-0 truncate">Outras variações ({outros.length})</span>
                    </button>
                    {outrosAbertos && <ul className="mt-1 space-y-1">{outros.map(item)}</ul>}
                  </>
                )}
              </div>
            );
          })}
        </aside>

        {aberto && (
          <div className="ads-studio-area min-w-0 space-y-3 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pr-1" data-coluna-principal="">
            {/* 28/09 (frente AD4): o cabeçalho do criativo sem caixa; Status e Anúncio no "...". */}
            <div className="min-w-0" data-cabecalho-do-criativo="">
              <div className="flex min-w-0 flex-wrap items-start">
                <div className="mb-1 mr-3 min-w-0 flex-1">
                  <div className="flex min-w-0 items-center">
                    <h2 className="min-w-0 truncate text-[15px] font-semibold" title={nomeDoCriativo(aberto, listaDePlanos)}>
                      {nomeDoCriativo(aberto, listaDePlanos)}
                    </h2>
                    <span className="ml-2 inline-flex shrink-0" title={situacaoAberta === "entregue" ? AVISO_DA_ENTREGA : undefined}>
                      <SeloDaSituacao situacao={situacaoAberta} />
                    </span>
                    {estaNaConta(aberto) && <span className="ml-1.5 inline-flex h-5 shrink-0 items-center rounded-full bg-primary/15 px-2 text-[10.5px] font-medium text-primary">{aberto.status === "no_ar" ? "No ar" : "Na conta"}</span>}
                  </div>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {formatoDe(aberto.formato).rotulo}
                    {anuncioLigado ? ` · no Meta: ${nomeDoAnuncio(anuncioLigado)}` : aberto.ad_id ? ` · no Meta: ${aberto.ad_id}` : " · sem anúncio ligado"}
                  </p>
                  {/* Frente CR: por que este criativo, em uma linha (estilo com o dado real ou padrão do nicho, e o Jev). */}
                  {porqueDoCriativo(aberto, anguloAberto) && (
                    <p className="truncate text-[12px] leading-snug" data-porque-do-criativo="" title={porqueDoCriativo(aberto, anguloAberto)}>
                      <span className="font-medium">Por que este: </span>
                      <span className="text-muted-foreground">{porqueDoCriativo(aberto, anguloAberto)}</span>
                    </p>
                  )}
                </div>
                <div className="mb-1 flex shrink-0 items-center">
                  {midia === "arte" && situacaoAberta === "pronto" && aberto.trabalho_id && (
                    <Button
                      type="button"
                      size="sm"
                      className="mr-1 h-8"
                      disabled={entregando.indexOf(aberto.id) >= 0}
                      onClick={() => armarOuEntregar(aberto.id, [aberto])}
                      title={AVISO_DA_ENTREGA}
                    >
                      {entregando.indexOf(aberto.id) >= 0 ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="mr-1 h-3.5 w-3.5" />}
                      {armado === aberto.id ? "Confirmar entrega" : "Entregar ao cliente"}
                    </Button>
                  )}
                  {midia === "arte" && situacaoAberta === "entregue" && !estaNaConta(aberto) && (
                    <Button
                      type="button"
                      size="sm"
                      variant={armado === `conta:${aberto.id}` ? "default" : "outline"}
                      className="mr-1 h-8"
                      disabled={naConta.indexOf(aberto.id) >= 0}
                      onClick={() => armarOuEnviarConta(`conta:${aberto.id}`, [aberto])}
                      title={AVISO_DA_CONTA}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" />
                      {armado === `conta:${aberto.id}` ? "Confirmar: para a conta" : "Enviar para a conta"}
                    </Button>
                  )}
                  <button
                    type="button"
                    className={botao.icone}
                    hidden={midia === "video"}
                    aria-label="Mais do criativo"
                    aria-expanded={maisDoCriativo}
                    title="Status, anúncio ligado e conta"
                    onClick={() => setMaisDoCriativo(!maisDoCriativo)}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {midia === "arte" && maisDoCriativo && (
                <div className="mt-1 flex min-w-0 flex-wrap items-center" role="group" hidden={midia === "video"}
                    aria-label="Mais do criativo">
                  <label className="mb-1 mr-3 flex items-center text-[11.5px] text-muted-foreground">
                    <span className="mr-1.5">Status</span>
                    <select
                      aria-label="Status do criativo"
                      value={aberto.status}
                      onChange={(e) => void mudar(aberto, { status: e.target.value as StatusDoCriativo }, "Status salvo")}
                      className="h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground"
                    >
                      {STATUS_DO_CRIATIVO.map((s) => (
                        <option key={s.valor} value={s.valor}>
                          {s.valor === "pronto" ? "Na conta (pronto para subir)" : s.rotulo}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mb-1 mr-3 flex min-w-0 items-center text-[11.5px] text-muted-foreground">
                    <span className="mr-1.5 shrink-0">Anúncio</span>
                    <select
                      aria-label="Anúncio no Meta"
                      value={aberto.ad_id || ""}
                      disabled={anuncios.isLoading}
                      onChange={(e) => void mudar(aberto, { ad_id: e.target.value || null }, e.target.value ? "Criativo ligado ao anúncio" : "Vínculo desfeito")}
                      className="h-8 min-w-0 max-w-[220px] rounded-md border border-input bg-background px-2 text-[12px] text-foreground"
                    >
                      <option value="">{anuncios.isLoading ? "Carregando…" : listaDeAnuncios.length ? "Ligar a um anúncio" : "Sem anúncios importados"}</option>
                      {listaDeAnuncios.map((a) => (
                        <option key={a.ad_id} value={a.ad_id}>
                          {nomeDoAnuncio(a)}
                          {a.effective_status ? ` (${a.effective_status.toLowerCase()})` : ""}
                        </option>
                      ))}
                      {aberto.ad_id && !anuncioLigado && <option value={aberto.ad_id}>{aberto.ad_id}</option>}
                    </select>
                  </label>
                  {aberto.status === "pronto" && (
                    <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" disabled={naConta.indexOf(aberto.id) >= 0} onClick={() => void tirarDaConta([aberto])}>
                      <Undo2 className="mr-1 h-3.5 w-3.5" /> Tirar da conta
                    </Button>
                  )}
                </div>
              )}
            </div>

            {midia === "video" ? <Suspense fallback={<p role="status">Abrindo estúdio de vídeo…</p>}><VideoDoCriativo key={aberto.id} criativo={aberto} referencia={trabalho ? capaDoTrabalho(trabalho) : null} /></Suspense> : trabalho ? (
              <ArteDoCriativo key={aberto.id} criativo={aberto} trabalho={trabalho} onAtualizar={atualizarTrabalhos} irmaos={irmaos} />
            ) : aberto.trabalho_id && (trabalhos.isLoading || trabalhos.isFetching) ? (
              <div className="h-[50vh] animate-pulse rounded-lg bg-muted/70" />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <p className="text-[13.5px] font-medium">Sem trabalho de arte ligado</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">Produza este ângulo de novo pelo Plano de teste para o diretor montar a direção.</p>
              </div>
            )}
            {/* Resultado e kit recolhidos por padrão, sem caixa: uma linha de resumo cada. */}
            <div className="min-w-0 divide-y divide-border border-y border-border [&>*]:py-3">
              <ResultadoDoCriativo criativo={aberto} angulo={anguloAberto} />
              {/* 25/09: o que recebe quem clica neste anúncio (post de recepção e roteiro de vendas do ângulo). */}
              {planoAberto && anguloAberto && <KitDeRecepcao key={`${planoAberto.id}:${anguloAberto.id}`} plano={planoAberto} angulo={anguloAberto} compacto />}
            </div>

            {!telaGrande && colunaDaCopy}

            {/* Posicionamentos na coluna da arte, lado a lado, em tamanho de celular. Recolhidos por padrão, sem caixa. */}
            <div className="min-w-0" data-posicionamentos="">
              <CabecalhoDeSecao
                nivel={3}
                titulo="Prévias nos posicionamentos"
                recolher={{ recolhido: posicionamentosRecolhidos, onAlternar: () => setPosicionamentosRecolhidos(!posicionamentosRecolhidos), resumo: "Feed, Stories e Reels em tamanho de celular" }}
              />
              {!posicionamentosRecolhidos && (
                <div className="mt-2 min-w-0">
                  <PosicionamentosDoAnuncio
                    copy={copyAoVivo && copyAoVivo.id === aberto.id ? copyAoVivo.copy : aberto.copy}
                    caminho={capaDoTrabalho(trabalho)}
                    formato={aberto.formato}
                    nome={clientName}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {aberto && telaGrande && colunaDaCopy}
      </div>
      )}
    </div>
  );
}
