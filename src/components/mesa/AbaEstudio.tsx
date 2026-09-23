import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  Hash,
  ListChecks,
  Loader2,
  MessageSquare,
  PanelLeft,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Star,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  chamarFuncao,
  custoDaResposta,
  dataCurta,
  ErroDaMesa,
  estimarLocal,
  inicioDoMes,
  modelosAtivos,
  nomeDoModelo,
  padraoPara,
  precoDoModelo,
  somarMeses,
  TAMANHOS,
  textoDoErro,
  usd,
  type ParteDaEstimativa,
  type Qualidade,
} from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import CardDoEstudio, { type OpcoesDoAjuste, type PainelDaLamina } from "./CardDoEstudio";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { emColunas, encaixarNaJanela, rolarAte, useAlturaDaEsteira, useFaixa } from "./EstudioAltura";
import EstudioArteDaAgenda, { InspetorDaArte } from "./EstudioArteDaAgenda";
import EstudioEntrega from "./EstudioEntrega";
import EstudioLaminaGrande from "./EstudioLaminaGrande";
import EstudioLista, { DICA_DO_ROTEIRO, formatoDoItem, SeloDoItem, type FontesDaLista } from "./EstudioLista";
import EstudioPreparar from "./EstudioPreparar";
import {
  contarFiltros,
  ETAPAS_DA_ESTEIRA,
  etapaDoItem,
  faltaEnviar,
  filtroValido,
  linkDaAgenda,
  passaNoFiltro,
  situacaoDoItem,
  type FiltroDoEstudio,
} from "./EstudioSituacao";
import { useMesa } from "./MesaContexto";
import PranchetaDoEstudio from "./PranchetaDoEstudio";
import ReferenciasDoEstudio, { type AlvoDasReferencias } from "./ReferenciasDoEstudio";
import {
  copiarTexto,
  corpoDoPreparar,
  enviarUmParaAprovacao,
  legendaParaCopiar,
  normalizarHashtags,
  useEstadoGuardado,
  type Area,
  type EscolhasDoPreparo,
} from "./estudioUtil";
import {
  FORMATOS_POST_UNICO,
  PROXIMOS_DIAS,
  ultimasVersoes,
  useItemAvulso,
  useItensDoMes,
  type ArteNaAgenda,
  type InfoDoRoteiro,
  type ItemDoMes,
  type PublicacaoDoPost,
  type Trabalho,
} from "./useItensDoMes";

/**
 * Aba Estúdio como esteira de produção (pedido do dono em 23/09: "está meio
 * confuso", "tem que ser como uma esteira de produção", "a sensação de que
 * precisa ficar rolando lá infinito", "apertar menos botões").
 *
 * No computador a aba ocupa a altura da janela abaixo do cabeçalho fixo da
 * Mesa, em três colunas com rolagem própria: as pautas (esquerda), a
 * produção (centro: barra do item, barra de ação, prancheta e a lâmina
 * escolhida grande) e o inspetor em abas (Lâmina, Conjunto, Referências,
 * Legenda, Entrega). Entre 1024 e 1279 px as pautas viram gaveta; abaixo de
 * 1024 a página rola numa coluna só, com o inspetor embaixo.
 *
 * A esteira: sem direção, o centro mostra o cartão "Preparar" (roteiro ou
 * diretor, quantidade de lâminas, contínuo e pedido, tudo antes da direção).
 * Item que já tem arte na Agenda aparece como "Na agenda", com as lâminas
 * que existem, e só refaz se pedir. Depois de entregar, o próprio inspetor
 * oferece o envio para aprovação.
 *
 * Nenhuma ação de IA abre janela: o BotaoComCusto mostra o preço ao lado e
 * executa no clique; o andamento aparece na própria lâmina (cronômetro), sem
 * travar o resto. "Gerar as que faltam" roda até 3 lâminas ao mesmo tempo; no
 * carrossel contínuo, uma de cada vez, porque cada lâmina continua a
 * anterior. A conferência roda logo depois de cada lâmina. A tela nunca
 * desenha texto por cima da arte.
 */

const CODIGOS_QUE_NAO_PARAM_A_FILA = ["acao_desconhecida", "servico_indisponivel"];
const CODIGOS_QUE_PARAM_TUDO = ["saldo_insuficiente", "cota_da_chave_esgotada", "cliente_sem_chave", "provedor_sem_chave"];
const EM_PARALELO = 3;
/** Largura das lâminas na prancheta (px); a altura é 1,25 vez. */
const LARGURA_NA_PRANCHETA = 128;

const QUALIDADES_DO_ESTUDIO: { valor: Qualidade; rotulo: string; dica: string }[] = [
  { valor: "baixa", rotulo: "Rascunho", dica: "para testar ideia e layout" },
  { valor: "media", rotulo: "Padrão", dica: "texto nítido, o normal para postar" },
  { valor: "alta", rotulo: "Final", dica: "máximo detalhe, mais caro e mais lento" },
];

type Filtro = FiltroDoEstudio;
type AbaDoInspetor = "lamina" | "conjunto" | "referencias" | "legenda" | "entrega";

const ABAS_DO_INSPETOR: { valor: AbaDoInspetor; rotulo: string }[] = [
  { valor: "lamina", rotulo: "Lâmina" },
  { valor: "conjunto", rotulo: "Conjunto" },
  { valor: "referencias", rotulo: "Referências" },
  { valor: "legenda", rotulo: "Legenda" },
  { valor: "entrega", rotulo: "Entrega" },
];

const semOrdem = (g: Record<number, number>, ordem: number) => {
  const n = { ...g };
  delete n[ordem];
  return n;
};

function Rotulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-1.5 flex min-h-7 items-center">
      <p className="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</p>
      {acao}
    </div>
  );
}

/** As cinco etapas da esteira, com a etapa do item em destaque. */
function EtapasDaEsteira({ atual }: { atual: number }) {
  return (
    <ol className="space-y-2.5" aria-label="Etapas da esteira">
      {ETAPAS_DA_ESTEIRA.map((e, i) => (
        <li key={e.chave} className="flex items-start">
          <span
            className={`mr-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
              i < atual ? "border-success bg-success/10 text-success" : i === atual ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {i < atual ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className={`block text-[12.5px] font-medium leading-tight ${i === atual ? "text-foreground" : "text-muted-foreground"}`}>{e.rotulo}</span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{e.dica}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function DetalheDoItem({
  item,
  trabalho,
  arte,
  roteiro,
  temRoteiro,
  publicacaoDe,
  modo,
  navegacao,
}: {
  item: ItemDoMes;
  trabalho: Trabalho | null;
  arte: ArteNaAgenda | null;
  roteiro: InfoDoRoteiro | null;
  temRoteiro: boolean;
  publicacaoDe: (postId: string) => PublicacaoDoPost | null;
  /** "colunas": altura fixa e rolagem por coluna; "pilha": a página rola. */
  modo: "colunas" | "pilha";
  /** Botão à esquerda da barra do item (voltar ou abrir as pautas). */
  navegacao: ReactNode;
}) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const avisarErro = useAvisarErro();
  const chave = `mesa:estudio:${item.id}`;
  const colunas = modo === "colunas";
  const ehDesign = !mesa.podeRecarregar;
  const [modeloImagem, setModeloImagem] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("media");
  const [legenda, setLegenda] = useState("");
  const [hashtagsTexto, setHashtagsTexto] = useState("");
  const [salvandoLegenda, setSalvandoLegenda] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null);
  const [gerando, setGerando] = useState<Record<number, number>>({});
  const [fila, setFila] = useState<number[]>([]);
  const [emLote, setEmLote] = useState(false);
  const [conferindo, setConferindo] = useState<Record<number, boolean>>({});
  const [pedidoAoDiretor, setPedidoAoDiretor] = useState("");
  const [salvandoContinuo, setSalvandoContinuo] = useState(false);
  const [versaoVista, setVersaoVista] = useState<number | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [refazendo, setRefazendo] = useState(false);
  // Guardados na sessão: voltar de outra aba devolve a mesma lâmina, o mesmo painel e a mesma aba do inspetor.
  const [selecionado, setSelecionado] = useEstadoGuardado<number | null>(`${chave}:lamina`, null);
  const [painel, setPainel] = useEstadoGuardado<PainelDaLamina>(`${chave}:painel`, "direcao");
  const [abaDoInspetor, setAbaDoInspetor] = useEstadoGuardado<AbaDoInspetor>(`${chave}:aba`, "lamina");
  const [refsAlvo, setRefsAlvo] = useEstadoGuardado<AlvoDasReferencias>(`${chave}:refs-alvo`, "conjunto");
  const [refsAba, setRefsAba] = useEstadoGuardado<"cliente" | "banco">(`${chave}:refs-aba`, "cliente");
  const parar = useRef(false);
  const inspetor = useRef<HTMLElement>(null);

  useEffect(() => {
    setModeloImagem(trabalho?.modelo_imagem_id || padraoPara(catalogo, "imagem")?.id || "");
    setQualidade((trabalho?.qualidade as Qualidade) || "media");
    setLegenda(trabalho?.legenda || "");
    setHashtagsTexto(normalizarHashtags(trabalho?.hashtags || []).join(" "));
  }, [trabalho?.id, catalogo.length]);

  useEffect(() => { setLegenda(trabalho?.legenda || ""); }, [trabalho?.legenda]);
  useEffect(() => { setHashtagsTexto(normalizarHashtags(trabalho?.hashtags || []).join(" ")); }, [(trabalho?.hashtags || []).join(" ")]);

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "item-avulso", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "ajustes"] });
    mesa.atualizarCusto();
  };

  const diretor = padraoPara(catalogo, "diretor_arte");
  const leitor = padraoPara(catalogo, "leitura");
  const postUnico = FORMATOS_POST_UNICO.indexOf(item.delivery_type) >= 0;

  const guardarEscolha = async (campos: { modelo_imagem_id?: string; qualidade?: string }) => {
    if (!trabalho) return;
    const { error } = await (supabase as any).from("estudio_trabalhos").update(campos).eq("id", trabalho.id);
    if (error) toast.error("Escolha não salva", { description: textoDoErro(error) });
    else atualizar();
  };

  const partesConferir = (): ParteDaEstimativa[] => [
    { modeloId: leitor?.id, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida },
  ];
  const partesGerar = (vezes = 1, q: Qualidade = qualidade): ParteDaEstimativa[] => [
    { modeloId: modeloImagem, tipo: "imagem", imagens: 1, qualidade: q, tokensEntrada: TAMANHOS.imagemAnexos.entrada, vezes },
    { modeloId: leitor?.id, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida, vezes },
  ];
  const partesAjustar = (): ParteDaEstimativa[] => [
    { modeloId: leitor?.id, tipo: "texto", tokensEntrada: TAMANHOS.ajuste.entrada, tokensSaida: TAMANHOS.ajuste.saida },
    ...partesGerar(1),
  ];
  const partesDiretor = (): ParteDaEstimativa[] => [
    { modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada, tokensSaida: TAMANHOS.preparar.saida },
  ];
  const precoPorLamina = (q: Qualidade) => {
    const v = modeloImagem ? estimarLocal(partesGerar(1, q), catalogo) : null;
    return v === null ? "" : `, cerca de ${usd(v)} por lâmina`;
  };

  const conferir = async (trabalhoId: string, ordem: number) => {
    setConferindo((c) => ({ ...c, [ordem]: true }));
    try {
      return await chamarFuncao<any>("estudio-arte", { acao: "conferir_card", trabalho_id: trabalhoId, ordem });
    } finally {
      setConferindo((c) => {
        const n = { ...c };
        delete n[ordem];
        return n;
      });
      atualizar();
    }
  };

  /** Conferência depois de gerar ou ajustar; se não estiver no ar, a versão fica "sem conferência". */
  const conferirDepois = async (trabalhoId: string, ordem: number): Promise<number> => {
    try {
      const c = await conferir(trabalhoId, ordem);
      return custoDaResposta(c) || 0;
    } catch (e) {
      if (e instanceof ErroDaMesa && CODIGOS_QUE_NAO_PARAM_A_FILA.indexOf(e.codigo) >= 0) return 0;
      throw e;
    }
  };

  const gerarUma = async (trabalhoId: string, ordem: number): Promise<number> => {
    setFila((f) => f.filter((o) => o !== ordem));
    setGerando((g) => ({ ...g, [ordem]: Date.now() }));
    try {
      const g = await chamarFuncao<any>("estudio-arte", { acao: "gerar_card", trabalho_id: trabalhoId, ordem });
      atualizar();
      return custoDaResposta(g) || 0;
    } finally {
      setGerando((g) => semOrdem(g, ordem));
    }
  };

  /** Uma lâmina só (inspetor ou barrinha da prancheta): gera e confere em seguida. */
  const gerarEConferir = async (ordem: number) => {
    if (!trabalho) return { custo_usd: 0 };
    const custo = await gerarUma(trabalho.id, ordem);
    const custoConferencia = await conferirDepois(trabalho.id, ordem);
    return { custo_usd: custo + custoConferencia };
  };

  const cardsDaDirecao = (trabalho?.direcao?.cards || []).slice().sort((a, b) => a.ordem - b.ordem);
  const ultimas = ultimasVersoes(trabalho?.cards || []);
  const semImagem = cardsDaDirecao.filter((c) => !ultimas.has(c.ordem));
  const filaDeGeracao = semImagem.length ? semImagem : cardsDaDirecao;
  const todosComImagem = cardsDaDirecao.length > 0 && semImagem.length === 0;
  const gerandoAgora = Object.keys(gerando).length;
  const algoGerando = emLote || gerandoAgora > 0;
  const ocupado = algoGerando || entregando;
  const infinito = !!trabalho?.direcao?.carrossel_infinito;
  const laminaOcupada = (ordem: number) => gerando[ordem] !== undefined || fila.indexOf(ordem) >= 0 || entregando;
  const progresso = cardsDaDirecao.length ? Math.round((ultimas.size / cardsDaDirecao.length) * 100) : 0;
  const entregue = !!trabalho && (trabalho.status === "entregue" || trabalho.entrega_status === "agendado");
  const estado: "producao" | "agenda" | "preparar" = cardsDaDirecao.length > 0 ? "producao" : arte && !refazendo ? "agenda" : "preparar";

  // Lâmina escolhida: a guardada na sessão, se ainda existir; senão a primeira.
  useEffect(() => {
    if (!cardsDaDirecao.length) return;
    if (selecionado === null || !cardsDaDirecao.some((c) => c.ordem === selecionado)) setSelecionado(cardsDaDirecao[0].ordem);
  }, [trabalho?.id, cardsDaDirecao.length]);

  const cardSelecionado = cardsDaDirecao.find((c) => c.ordem === selecionado) || null;
  const ultimaDaEscolhida = cardSelecionado ? ultimas.get(cardSelecionado.ordem) : undefined;
  // Outra lâmina ou versão nova: a lâmina grande volta para a mais recente e as áreas somem.
  useEffect(() => { setVersaoVista(null); setAreas([]); }, [selecionado]);
  useEffect(() => { setVersaoVista(null); }, [ultimaDaEscolhida?.versao]);

  /**
   * Gerar várias: até 3 ao mesmo tempo (uma de cada vez no carrossel
   * contínuo). A conferência de cada lâmina roda em seguida, sem segurar a
   * próxima geração. Saldo, cota ou chave param tudo.
   */
  const gerarVarias = async (ordens: number[]) => {
    if (!trabalho) return { custo_usd: 0 };
    parar.current = false;
    setEmLote(true);
    setFila(ordens.slice());
    const limite = infinito ? 1 : EM_PARALELO;
    let proximo = 0;
    let total = 0;
    const falhas: unknown[] = [];
    const conferencias: Promise<number>[] = [];
    const trabalhador = async () => {
      while (proximo < ordens.length && !parar.current) {
        const ordem = ordens[proximo++];
        try {
          total += await gerarUma(trabalho.id, ordem);
          conferencias.push(conferirDepois(trabalho.id, ordem).catch(() => 0));
        } catch (e) {
          falhas.push(e);
          if (e instanceof ErroDaMesa && CODIGOS_QUE_PARAM_TUDO.indexOf(e.codigo) >= 0) parar.current = true;
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(limite, ordens.length) }, trabalhador));
      const custosConferencia = await Promise.all(conferencias);
      total += custosConferencia.reduce((s, v) => s + v, 0);
    } finally {
      setEmLote(false);
      setFila([]);
      atualizar();
    }
    if (falhas.length) {
      avisarErro(falhas[0], falhas.length === 1 ? "Uma lâmina não foi gerada" : `${falhas.length} lâminas não foram geradas`);
    }
    return { custo_usd: total, parado: parar.current };
  };

  /** Primeiro posto: a direção com as escolhas feitas antes (modo, quantidade, contínuo e pedido). */
  const preparar = async (escolhas: EscolhasDoPreparo) => {
    const r = await chamarFuncao<any>(
      "estudio-arte",
      corpoDoPreparar(item.id, escolhas, { postUnico, modeloImagemId: modeloImagem || undefined, qualidade }),
    );
    if (escolhas.modo === "roteiro") toast.success("Direção montada do roteiro", { description: "Sem custo de IA. Confira as lâminas na prancheta e gere." });
    return r;
  };
  const aoPreparar = () => {
    setRefazendo(false);
    setAbaDoInspetor("lamina");
    setPainel("direcao");
    atualizar();
  };

  /** Ajuste da lâmina: livre, por áreas (frações 0 a 1) ou só o fundo. */
  const ajustar = async (ordem: number, instrucao: string, opcoes: OpcoesDoAjuste = {}) => {
    if (!trabalho) return { custo_usd: 0 };
    setGerando((g) => ({ ...g, [ordem]: Date.now() }));
    try {
      const a = await chamarFuncao<any>("estudio-arte", {
        acao: "ajustar_card",
        trabalho_id: trabalho.id,
        ordem,
        instrucao,
        areas: opcoes.areas && opcoes.areas.length ? opcoes.areas : undefined,
        tipo: opcoes.tipo,
        imagem_id: opcoes.imagem_id,
      });
      atualizar();
      const custoConferencia = await conferirDepois(trabalho.id, ordem);
      return { custo_usd: (custoDaResposta(a) || 0) + custoConferencia };
    } finally {
      setGerando((g) => semOrdem(g, ordem));
    }
  };

  /** Grava escolhas sem custo no trabalho (referências, foto real, texto, contínuo). */
  const configurar = async (corpo: Record<string, unknown>) => {
    if (!trabalho) return;
    await chamarFuncao("estudio-arte", { acao: "configurar", trabalho_id: trabalho.id, ...corpo });
    atualizar();
  };

  const alternarContinuo = async (valor: boolean) => {
    setSalvandoContinuo(true);
    try {
      await configurar({ conjunto: { carrossel_infinito: valor } });
      toast.success(valor ? "Carrossel contínuo ligado" : "Carrossel contínuo desligado", {
        description: ultimas.size ? "Gere as lâminas de novo para a arte seguir a nova forma." : undefined,
      });
    } catch (e) {
      avisarErro(e, "Não foi possível mudar");
    } finally {
      setSalvandoContinuo(false);
    }
  };

  /** Nova ordem das lâminas: renumera a direção e as versões já geradas juntas. */
  const reordenar = async (novas: number[]) => {
    if (!trabalho) return;
    const ok = await confirmar({
      title: "Mudar a ordem das lâminas?",
      description: "A primeira vira capa e a última vira o fechamento. As artes já geradas acompanham a lâmina.",
      confirmLabel: "Mudar ordem",
    });
    if (!ok) return;
    const mapa: Record<number, number> = {};
    novas.forEach((antiga, i) => { mapa[antiga] = i + 1; });
    const total = novas.length;
    const cards = cardsDaDirecao
      .map((c) => {
        const ordem = mapa[c.ordem];
        const funcao = ordem === 1 ? "capa" : ordem === total && total > 1 ? "cta" : "conteudo";
        return { ...c, ordem, funcao };
      })
      .sort((a, b) => a.ordem - b.ordem);
    const versoes = (trabalho.cards || []).map((v) => ({ ...v, ordem: mapa[v.ordem] || v.ordem }));
    const { error } = await (supabase as any)
      .from("estudio_trabalhos")
      .update({ direcao: { ...trabalho.direcao, cards }, cards: versoes })
      .eq("id", trabalho.id)
      .eq("atualizado_em", trabalho.atualizado_em);
    if (error) toast.error("Ordem não salva", { description: textoDoErro(error) });
    else {
      if (selecionado !== null && mapa[selecionado]) setSelecionado(mapa[selecionado]);
      atualizar();
    }
  };

  const hashtags = normalizarHashtags(hashtagsTexto.replace(/[,\n]/g, " ").split(" "));
  const hashtagsSalvas = normalizarHashtags(trabalho?.hashtags || []);
  const legendaMudou = legenda !== (trabalho?.legenda || "") || hashtags.join(" ") !== hashtagsSalvas.join(" ");

  /** Grava legenda e hashtags. Ao sair do campo grava sozinha, sem aviso. */
  const salvarLegenda = async (silencioso = false) => {
    if (!trabalho) return;
    setSalvandoLegenda(true);
    const { error } = await (supabase as any)
      .from("estudio_trabalhos")
      .update({ legenda: legenda.trim() || null, hashtags })
      .eq("id", trabalho.id);
    setSalvandoLegenda(false);
    if (error) toast.error("Legenda não salva", { description: textoDoErro(error) });
    else {
      if (!silencioso) toast.success("Legenda salva");
      atualizar();
    }
  };
  const salvarAoSair = () => {
    if (legendaMudou && !salvandoLegenda && !entregue) void salvarLegenda(true);
  };

  const copiar = async (texto: string, rotulo: string) => {
    if (!texto.trim()) {
      toast.error("Nada para copiar ainda");
      return;
    }
    const ok = await copiarTexto(texto);
    if (ok) toast.success(rotulo);
    else toast.error("Não foi possível copiar", { description: "Selecione o texto e copie à mão." });
  };

  /** Entrega em Arquivos e, se pedido, já envia para aprovação (mesmo caminho da aba Entrega). */
  const entregar = async (tambemEnviar: boolean) => {
    if (!trabalho) return;
    setEntregando(true);
    setErroDoEnvio(null);
    try {
      if (legendaMudou) await salvarLegenda(true);
      await chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: trabalho.id });
      if (tambemEnviar) {
        try {
          await enviarUmParaAprovacao(trabalho.id);
          toast.success(ehDesign ? "Entregue e enviado para a revisão da agência" : "Entregue e enviado para aprovação");
        } catch (e) {
          setErroDoEnvio(textoDoErro(e));
          toast.error("Entregue em Arquivos, mas o envio para aprovação falhou", { description: textoDoErro(e) });
        }
      } else {
        toast.success("Entregue em Arquivos", { description: "O envio para aprovação fica aqui mesmo, na aba Entrega." });
      }
      atualizar();
      void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
    } catch (e) {
      avisarErro(e, "Não foi possível entregar");
    } finally {
      setEntregando(false);
    }
  };

  /** Depois de entregar: o envio para aprovação, no mesmo lugar. */
  const enviarAgora = async () => {
    if (!trabalho) return;
    setEnviando(true);
    setErroDoEnvio(null);
    try {
      await enviarUmParaAprovacao(trabalho.id);
      toast.success(ehDesign ? "Revisão da agência pedida" : "Enviado para aprovação");
      atualizar();
      void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
    } catch (e) {
      setErroDoEnvio(textoDoErro(e));
      toast.error("Não foi possível enviar", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  /** Troca a aba do inspetor; na pilha (celular), o inspetor fica embaixo e a tela desce até ele. */
  const irParaAba = (a: AbaDoInspetor) => {
    setAbaDoInspetor(a);
    if (!colunas) window.setTimeout(() => rolarAte(inspetor.current, "start"), 60);
  };

  const abrirPainel = (ordem: number, p: PainelDaLamina) => {
    setSelecionado(ordem);
    setPainel(p);
    irParaAba("lamina");
  };

  /**
   * Clique simples na prancheta: só escolhe a lâmina. O ajuste livre e as
   * versões voltam ao topo do inspetor (sem rolar sozinho a cada clique); a
   * marcação de área e a troca de fundo continuam, para seguir lâmina a lâmina.
   */
  const escolherLamina = (ordem: number) => {
    setSelecionado(ordem);
    if (painel === "livre" || painel === "versoes") setPainel("direcao");
  };

  // Ver grande: todas as lâminas com arte; a escolhida na versão que está na tela.
  const paraAmpliar: { ordem: number; imagem: ImagemAmpliavel }[] = cardsDaDirecao
    .filter((c) => ultimas.has(c.ordem))
    .map((c) => {
      const lista = (trabalho?.cards || []).filter((v) => v.ordem === c.ordem);
      const vista = c.ordem === selecionado && versaoVista !== null ? lista.find((v) => v.versao === versaoVista) || ultimas.get(c.ordem)! : ultimas.get(c.ordem)!;
      return { ordem: c.ordem, imagem: { caminho: vista.storage_path, titulo: `Lâmina ${c.ordem} · v${vista.versao}` } };
    });
  const ampliarLamina = (ordem: number) => {
    const i = paraAmpliar.findIndex((a) => a.ordem === ordem);
    if (i >= 0) setAmpliada(i);
  };

  const situacao = situacaoDoItem(trabalho, arte, temRoteiro);
  const publicacao = trabalho?.post_id ? publicacaoDe(trabalho.post_id) : arte ? publicacaoDe(arte.post_id) : null;
  const linkAgendaDoItem = trabalho?.post_id
    ? linkDaAgenda(clientId, trabalho.post_id, publicacao?.scheduled_at || trabalho.agendado_para)
    : arte
      ? linkDaAgenda(clientId, arte.post_id, publicacao?.scheduled_at)
      : null;
  const desenhandoAreas = estado === "producao" && abaDoInspetor === "lamina" && painel === "areas" && !!ultimaDaEscolhida;
  const prontoParaEntregar = todosComImagem && !entregue;
  const opcoesDeImagem = modelosAtivos(catalogo, "imagem");

  // ---------------------------------------------------------------- centro

  const barraDoItem = (
    <div className="flex h-12 min-w-0 shrink-0 items-center border-b border-border px-3">
      {navegacao}
      {temRoteiro && (
        <span title={DICA_DO_ROTEIRO} className="mr-1.5 shrink-0">
          <Star className="h-4 w-4 fill-warning text-warning" aria-label={DICA_DO_ROTEIRO} />
        </span>
      )}
      <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={item.title}>{item.title}</h2>
      <span className="ml-2 hidden shrink-0 text-[11.5px] text-muted-foreground sm:inline">{dataCurta(item.due_date)} · {formatoDoItem(item)}</span>
      <SeloDoItem tom={situacao.tom} className="ml-2 shrink-0">{situacao.rotulo}</SeloDoItem>
      {trabalho && trabalho.custo_usd > 0 && (
        <span className="ml-2 shrink-0 text-[11.5px] tabular-nums text-muted-foreground" title="Gasto de IA neste item">{usd(trabalho.custo_usd)}</span>
      )}
    </div>
  );

  const barraDeAcao = (
    <div className="shrink-0 border-b border-border">
      <div className="flex min-w-0 flex-wrap items-center px-3 py-2">
        <div className="mb-1 mr-2 mt-1 grid shrink-0 grid-cols-3 gap-0.5 rounded-lg border border-border bg-background p-0.5" role="radiogroup" aria-label="Qualidade da lâmina">
          {QUALIDADES_DO_ESTUDIO.map((q) => (
            <button
              key={q.valor}
              type="button"
              role="radio"
              aria-checked={qualidade === q.valor}
              disabled={emLote}
              title={`${q.rotulo}: ${q.dica}${precoPorLamina(q.valor)}`}
              onClick={() => { setQualidade(q.valor); void guardarEscolha({ qualidade: q.valor }); }}
              className={`h-7 rounded-md px-2 text-[11.5px] transition-colors ${
                qualidade === q.valor ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {q.rotulo}
            </button>
          ))}
        </div>
        <div className="mb-1 mr-2 mt-1 w-[136px] min-w-0 shrink-0">
          <Select value={modeloImagem || ""} onValueChange={(id) => { setModeloImagem(id); void guardarEscolha({ modelo_imagem_id: id }); }} disabled={emLote || opcoesDeImagem.length === 0}>
            <SelectTrigger className="h-8 min-w-0 text-[12px]" aria-label="Gerador de imagem" title="Gerador de imagem">
              <SelectValue placeholder={opcoesDeImagem.length ? "Gerador" : "Sem gerador"} />
            </SelectTrigger>
            <SelectContent>
              {opcoesDeImagem.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {nomeDoModelo(m)} <span className="text-muted-foreground">· {precoDoModelo(m, qualidade)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mb-1 ml-auto mt-1 flex shrink-0 items-center">
          {emLote ? (
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => { parar.current = true; }} title="Para depois das lâminas que já estão gerando">
              <Square className="mr-1 h-3.5 w-3.5" /> Parar
            </Button>
          ) : (
            <BotaoComCusto
              rotulo={
                <>
                  {semImagem.length ? <Wand2 className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {semImagem.length
                    ? semImagem.length === cardsDaDirecao.length
                      ? `Gerar todas (${semImagem.length})`
                      : `Gerar as que faltam (${semImagem.length})`
                    : "Refazer todas"}
                </>
              }
              titulo={`Gerar ${filaDeGeracao.length} lâmina(s)`}
              descricao={infinito
                ? "Carrossel contínuo: uma lâmina de cada vez, porque cada uma continua a anterior. A conferência roda logo depois de cada uma."
                : "Até 3 lâminas ao mesmo tempo. A conferência de ortografia e identidade roda logo depois de cada uma."}
              fecharAoConfirmar
              variant={semImagem.length ? "default" : "outline"}
              className="h-8 gap-1 px-2.5 text-[12px]"
              disabled={ocupado || entregue}
              partes={() => partesGerar(filaDeGeracao.length)}
              executar={() => gerarVarias(filaDeGeracao.map((c) => c.ordem))}
              aoConcluir={(data) => {
                toast.success(data?.parado ? "Geração parada" : "Lâminas geradas", { description: `Custo real: ${usd(custoDaResposta(data) || 0)}.` });
              }}
            />
          )}
          {prontoParaEntregar && !emLote && (
            <Button type="button" size="sm" className="ml-2 h-8 gap-1 px-2.5 text-[12px]" onClick={() => irParaAba("entrega")} title="Abre a entrega no inspetor">
              <Send className="h-3.5 w-3.5" /> Entregar
            </Button>
          )}
        </div>
      </div>
      <div className="h-0.5 w-full bg-secondary" aria-hidden="true">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progresso}%` }} />
      </div>
    </div>
  );

  const centroDaProducao = (
    <>
      {barraDeAcao}
      <div className={colunas ? "flex min-h-0 flex-1 flex-col overflow-y-auto" : "flex flex-col"}>
        {trabalho?.entrega_status === "reprovado" && trabalho.status !== "entregue" && (
          <button
            type="button"
            onClick={() => irParaAba("entrega")}
            className="mx-3 mt-3 rounded-lg border border-warning/50 bg-background px-3 py-2 text-left text-[12px] leading-snug [overflow-wrap:anywhere]"
          >
            <span className="font-semibold text-warning">Pediram ajuste</span>
            {trabalho.entrega_aviso ? `: “${trabalho.entrega_aviso}”` : ". Ajuste as lâminas e entregue de novo."}
          </button>
        )}
        <div className="shrink-0 px-3 pt-3">
          <p className="mb-2 flex min-w-0 items-center text-[11px] text-muted-foreground">
            <span className="mr-2 shrink-0 font-medium uppercase tracking-wider">Prancheta</span>
            <span className="min-w-0 truncate">
              {trabalho?.direcao?.origem === "roteiro" ? "do roteiro" : "do diretor"} · {ultimas.size} de {cardsDaDirecao.length} com arte
              {infinito ? " · contínuo" : ""}
              {gerandoAgora > 0 ? ` · gerando ${gerandoAgora}` : ""}
            </span>
          </p>
          <PranchetaDoEstudio
            cards={cardsDaDirecao}
            ultimas={ultimas}
            selecionado={selecionado}
            onSelecionar={escolherLamina}
            onAmpliar={ampliarLamina}
            gerando={gerando}
            fila={fila}
            infinito={infinito}
            largura={LARGURA_NA_PRANCHETA}
            podeReordenar={!ocupado && cardsDaDirecao.length > 1 && !entregue}
            onReordenar={(ordens) => void reordenar(ordens)}
            onVersoes={(ordem) => abrirPainel(ordem, "versoes")}
            onAjustar={(ordem) => abrirPainel(ordem, "livre")}
            acoes={(c, v) => (
              <BotaoComCusto
                rotulo={<><Wand2 className="h-3.5 w-3.5" /><span className="sr-only">{v ? "Refazer" : "Gerar"} a lâmina {c.ordem}</span></>}
                titulo={`${v ? "Refazer" : "Gerar"} a lâmina ${c.ordem}`}
                descricao={`${v ? "Refazer" : "Gerar"} a lâmina ${c.ordem}. A conferência roda logo depois.`}
                variant={v ? "outline" : "default"}
                className="h-8 w-full gap-1 px-2 text-[11px]"
                disabled={laminaOcupada(c.ordem) || entregue}
                partes={() => partesGerar(1)}
                executar={() => gerarEConferir(c.ordem)}
              />
            )}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col px-3 pb-3 pt-2">
          {cardSelecionado && (
            <EstudioLaminaGrande
              card={cardSelecionado}
              total={cardsDaDirecao.length}
              versoes={(trabalho?.cards || []).filter((v) => v.ordem === cardSelecionado.ordem)}
              versaoVista={versaoVista}
              onVersaoVista={setVersaoVista}
              gerandoDesde={gerando[cardSelecionado.ordem]}
              desenhandoAreas={desenhandoAreas}
              areas={areas}
              onAreas={setAreas}
              ocupado={laminaOcupada(cardSelecionado.ordem)}
              onAmpliar={() => ampliarLamina(cardSelecionado.ordem)}
              soPelaLargura={!colunas}
            />
          )}
        </div>
      </div>
      <Ampliar imagens={paraAmpliar.map((a) => a.imagem)} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </>
  );

  const centro = (
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card ${colunas ? "min-h-0" : ""}`} aria-label="Produção">
      {barraDoItem}
      {estado === "producao" && centroDaProducao}
      {estado === "agenda" && arte && (
        <div className={colunas ? "flex min-h-0 flex-1 flex-col overflow-y-auto p-3" : "flex flex-col p-3"}>
          <EstudioArteDaAgenda arte={arte} linkAgenda={linkAgendaDoItem || `/calendario?client=${clientId}`} onRefazer={() => setRefazendo(true)} soPelaLargura={!colunas} />
        </div>
      )}
      {estado === "preparar" && (
        <div className={colunas ? "min-h-0 flex-1 overflow-y-auto p-3 sm:p-5" : "p-3"}>
          <EstudioPreparar
            roteiro={roteiro}
            postUnico={postUnico}
            partesDiretor={partesDiretor}
            onPreparar={preparar}
            onConcluido={aoPreparar}
            aviso={
              refazendo && arte ? (
                <p className="text-[12px] leading-snug text-muted-foreground">
                  Refazendo: a arte atual continua na Agenda até a nova ser entregue.{" "}
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setRefazendo(false)}>
                    Voltar para a arte atual
                  </button>
                </p>
              ) : trabalho && trabalho.status === "erro" ? (
                <p className="text-[12px] text-destructive">A última tentativa terminou com erro. Prepare de novo.</p>
              ) : null
            }
          />
        </div>
      )}
    </section>
  );

  // ---------------------------------------------------------------- inspetor

  const abaLamina = cardSelecionado && trabalho ? (
    <CardDoEstudio
      key={cardSelecionado.ordem}
      conversaId={trabalho.conversa_id}
      direcao={cardSelecionado}
      versoes={(trabalho.cards || []).filter((v) => v.ordem === cardSelecionado.ordem)}
      ocupado={laminaOcupada(cardSelecionado.ordem) || entregue}
      conferindo={!!conferindo[cardSelecionado.ordem]}
      gerandoDesde={gerando[cardSelecionado.ordem]}
      painel={painel}
      onPainel={setPainel}
      versaoVista={versaoVista}
      onVersaoVista={setVersaoVista}
      areas={areas}
      onAreas={setAreas}
      partesGerar={() => partesGerar(1)}
      partesAjustar={partesAjustar}
      partesConferir={partesConferir}
      onGerar={() => gerarEConferir(cardSelecionado.ordem)}
      onAjustar={(instrucao, opcoes) => ajustar(cardSelecionado.ordem, instrucao, opcoes)}
      onConferir={() => conferir(trabalho.id, cardSelecionado.ordem)}
      onConfigurar={(card) => configurar({ card: { ordem: cardSelecionado.ordem, ...card } })}
      onConcluido={atualizar}
    />
  ) : (
    <p className="text-[12.5px] text-muted-foreground">Escolha uma lâmina na prancheta.</p>
  );

  const abaConjunto = trabalho ? (
    <div className="space-y-4">
      <section>
        <Rotulo>Conceito</Rotulo>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">
          {trabalho.direcao?.conceito || <span className="text-muted-foreground">Sem conceito escrito nesta direção.</span>}
        </p>
      </section>
      {trabalho.direcao?.fio_visual && (
        <section>
          <Rotulo>Fio visual</Rotulo>
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]" title="O que se repete em todas as lâminas">
            {trabalho.direcao.fio_visual}
          </p>
        </section>
      )}
      <p className="text-[11.5px] text-muted-foreground">
        {trabalho.direcao?.origem === "roteiro" ? "Direção montada do roteiro" : "Direção do diretor de arte"} · {cardsDaDirecao.length} lâmina{cardsDaDirecao.length === 1 ? "" : "s"}
      </p>

      {cardsDaDirecao.length > 1 && (
        <label className="flex cursor-pointer items-start rounded-lg border border-border bg-background px-3 py-2.5">
          <Switch checked={infinito} onCheckedChange={(v) => void alternarContinuo(v)} disabled={salvandoContinuo || algoGerando || entregue} className="mr-3 mt-0.5 shrink-0" aria-label="Carrossel contínuo" />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium">Carrossel contínuo</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">A cena atravessa as lâminas, como um panorama. Gera uma de cada vez.</span>
          </span>
        </label>
      )}

      <section className="space-y-2">
        <Rotulo>Pedir ao diretor</Rotulo>
        <Textarea
          value={pedidoAoDiretor}
          onChange={(e) => setPedidoAoDiretor(e.target.value)}
          rows={3}
          placeholder="Ex.: mais leve, com fotos reais do ambiente e menos texto por lâmina"
          className="text-[13px]"
          disabled={entregue}
          title="O diretor refaz a direção pelo pedido; as artes já geradas ficam nas versões"
        />
        <div className="flex justify-end">
          <BotaoComCusto
            rotulo={<><MessageSquare className="mr-1 h-3.5 w-3.5" /> {pedidoAoDiretor.trim() ? "Pedir ao diretor" : "Refazer a direção"}</>}
            titulo="Pedir ao diretor"
            descricao="O diretor relê a marca, as referências e o seu pedido e escreve a direção de novo, no mesmo trabalho."
            variant={pedidoAoDiretor.trim() ? "default" : "outline"}
            disabled={ocupado || entregue}
            partes={partesDiretor}
            executar={() =>
              chamarFuncao("estudio-arte", {
                acao: "preparar",
                task_id: item.id,
                modo: "diretor",
                instrucao: pedidoAoDiretor.trim() || undefined,
                trabalho_id: trabalho.id,
                modelo_imagem_id: modeloImagem || undefined,
                qualidade,
              })
            }
            aoConcluir={() => {
              setPedidoAoDiretor("");
              atualizar();
            }}
          />
        </div>
        {entregue && <p className="text-[11.5px] text-muted-foreground">Arte já entregue: a direção não muda mais neste trabalho.</p>}
      </section>
    </div>
  ) : null;

  const abaLegenda = trabalho ? (
    <div className="space-y-3">
      <div className="flex min-w-0 items-center">
        <p className="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Legenda</p>
        <BotaoComCusto
          rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> {legenda ? "Reescrever" : "Escrever"}</>}
          titulo="Escrever a legenda"
          descricao="A legenda final sai do item da agenda e da arte pronta, com 4 ou 5 hashtags escolhidas entre as candidatas."
          variant="outline"
          className="h-8 gap-1 px-2.5 text-[12px]"
          disabled={entregue}
          partes={() => [{ modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida }]}
          executar={() => chamarFuncao("estudio-arte", { acao: "legenda", trabalho_id: trabalho.id })}
          aoConcluir={(data) => {
            if (typeof data?.legenda === "string") setLegenda(data.legenda);
            if (Array.isArray(data?.hashtags)) setHashtagsTexto(normalizarHashtags(data.hashtags).join(" "));
            atualizar();
          }}
        />
      </div>
      <Textarea
        value={legenda}
        onChange={(e) => setLegenda(e.target.value)}
        onBlur={salvarAoSair}
        rows={9}
        placeholder="A legenda do post aparece aqui. Dá para editar à mão; grava sozinha ao sair do campo."
        className="text-[13px] leading-relaxed"
        disabled={entregue}
      />
      <div className="space-y-2">
        <p className="flex items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><Hash className="mr-1 h-3.5 w-3.5" /> Hashtags</p>
        <Input value={hashtagsTexto} onChange={(e) => setHashtagsTexto(e.target.value)} onBlur={salvarAoSair} placeholder="#exemplo #outra" className="h-9 text-[12.5px]" disabled={entregue} />
        {hashtags.length > 0 && (
          <div className="flex flex-wrap">
            {hashtags.map((h) => (
              <span key={h} className="mb-1 mr-1.5 max-w-full truncate rounded-full bg-primary/10 px-2.5 py-0.5 text-[11.5px] text-primary">{h}</span>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" variant="outline" className="h-9 min-w-0" onClick={() => void copiar(legendaParaCopiar(legenda, hashtags), "Legenda copiada com as hashtags")}>
          <Copy className="mr-1.5 h-3.5 w-3.5" /> <span className="truncate">Copiar legenda</span>
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-9 min-w-0" onClick={() => void copiar(hashtags.join(" "), "Hashtags copiadas")}>
          <Hash className="mr-1.5 h-3.5 w-3.5" /> <span className="truncate">Copiar hashtags</span>
        </Button>
      </div>
      <div className="flex min-h-9 items-center justify-end">
        {salvandoLegenda ? (
          <span className="inline-flex items-center text-[11.5px] text-muted-foreground"><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> salvando</span>
        ) : legendaMudou ? (
          <Button type="button" size="sm" onClick={() => void salvarLegenda()} disabled={entregue}>Salvar legenda</Button>
        ) : (
          <span className="inline-flex items-center text-[11.5px] text-muted-foreground"><Check className="mr-1 h-3.5 w-3.5 text-success" /> salva</span>
        )}
      </div>
    </div>
  ) : null;

  const abaEntrega = trabalho ? (
    <EstudioEntrega
      trabalho={trabalho}
      laminasFeitas={ultimas.size}
      laminasTotal={cardsDaDirecao.length}
      legendaEscrita={!!legenda.trim()}
      ehDesign={ehDesign}
      entregando={entregando}
      enviando={enviando}
      ocupado={algoGerando}
      erroDoEnvio={erroDoEnvio}
      linkArquivos={`/arquivos?client=${clientId}`}
      linkAgenda={linkAgendaDoItem}
      onEntregar={(tambemEnviar) => void entregar(tambemEnviar)}
      onEnviar={() => void enviarAgora()}
    />
  ) : null;

  const marcaNaAba = (a: AbaDoInspetor) =>
    (a === "entrega" && (prontoParaEntregar || faltaEnviar(trabalho))) || (a === "legenda" && todosComImagem && !legenda.trim() && !entregue);

  const corpoDoInspetor = colunas ? "min-h-0 flex-1 overflow-y-auto p-4 pb-16" : "p-4";

  const inspetorDaProducao = (
    <>
      <div className={`flex shrink-0 border-b border-border ${colunas ? "" : "overflow-x-auto"}`} role="tablist" aria-label="Inspetor">
        {ABAS_DO_INSPETOR.map((a) => {
          const ativa = abaDoInspetor === a.valor;
          return (
            <button
              key={a.valor}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => setAbaDoInspetor(a.valor)}
              className={`relative -mb-px flex h-11 min-w-0 flex-1 items-center justify-center border-b-2 px-1 text-[12px] transition-colors ${colunas ? "" : "min-w-[76px]"} ${
                ativa ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="truncate">{a.rotulo}</span>
              {marcaNaAba(a.valor) && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="pede atenção" />}
            </button>
          );
        })}
      </div>
      <div className={corpoDoInspetor} role="tabpanel">
        {abaDoInspetor === "lamina" && abaLamina}
        {abaDoInspetor === "conjunto" && abaConjunto}
        {abaDoInspetor === "referencias" && trabalho && (
          <ReferenciasDoEstudio
            trabalho={trabalho}
            cardSelecionado={cardSelecionado}
            alvo={refsAlvo}
            onAlvo={setRefsAlvo}
            aba={refsAba}
            onAba={setRefsAba}
            onAtualizar={atualizar}
          />
        )}
        {abaDoInspetor === "legenda" && abaLegenda}
        {abaDoInspetor === "entrega" && abaEntrega}
      </div>
    </>
  );

  const inspetorDaPauta = (
    <div className={corpoDoInspetor}>
      <div className="space-y-5">
        <div>
          <Rotulo>Pauta</Rotulo>
          <p className="text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]">{item.title}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{dataCurta(item.due_date)} · {formatoDoItem(item)}</p>
          {temRoteiro && roteiro && (
            <p className="mt-2 flex items-start text-[12px] leading-snug text-muted-foreground">
              <Star className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
              <span>Roteiro do estrategista com {roteiro.laminas} lâmina{roteiro.laminas === 1 ? "" : "s"}: a direção sai dele, sem custo de IA.</span>
            </p>
          )}
        </div>
        <div>
          <Rotulo>Esteira</Rotulo>
          <EtapasDaEsteira atual={etapaDoItem(trabalho, refazendo ? null : arte)} />
        </div>
      </div>
    </div>
  );

  const inspetorDaArte = arte ? (
    <div className={corpoDoInspetor}>
      <InspetorDaArte arte={arte} publicacao={publicacao} linkAgenda={linkAgendaDoItem || `/calendario?client=${clientId}`} />
    </div>
  ) : null;

  const lateral = (
    <aside ref={inspetor} className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card ${colunas ? "min-h-0" : ""}`} aria-label="Inspetor">
      {estado === "producao" ? inspetorDaProducao : estado === "agenda" ? inspetorDaArte : inspetorDaPauta}
    </aside>
  );

  if (colunas) {
    return (
      <>
        {centro}
        {lateral}
      </>
    );
  }
  return (
    <div className="min-w-0 space-y-3">
      {centro}
      {lateral}
    </div>
  );
}

/** Meses para o seletor da coluna: 6 para trás e 6 para frente do atual. */
function mesesDoSeletor(mesAtual: string): string[] {
  const base = inicioDoMes();
  const lista: string[] = [];
  for (let i = -6; i <= 6; i++) lista.push(somarMeses(base, i));
  if (lista.indexOf(mesAtual) < 0) lista.push(mesAtual);
  return lista.sort();
}

/** Centro e inspetor antes de escolher uma pauta: o resumo e a próxima a fazer. */
function SemPauta({ contagem, proxima, onEscolher, acaoDaLista }: { contagem: Record<FiltroDoEstudio, number>; proxima: ItemDoMes | null; onEscolher: (id: string) => void; acaoDaLista?: ReactNode }) {
  return (
    <div className="col-span-2 flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-border bg-card p-8 text-center">
      <ListChecks className="h-6 w-6 text-primary" />
      <p className="mt-3 text-[15px] font-semibold">Escolha uma pauta para abrir a esteira</p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        {contagem.a_fazer} a fazer · {contagem.com_arte} com arte · {contagem.na_agenda} na agenda
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center">
        {proxima && (
          <Button type="button" className="mb-2 mr-2 h-10" onClick={() => onEscolher(proxima.id)}>
            <Sparkles className="mr-1.5 h-4 w-4" /> Abrir a próxima a fazer
          </Button>
        )}
        {acaoDaLista}
      </div>
      {proxima && <p className="mt-1 max-w-sm truncate text-[12px] text-muted-foreground" title={proxima.title}>{dataCurta(proxima.due_date)} · {proxima.title}</p>}
    </div>
  );
}

export default function AbaEstudio({
  mes,
  onMes,
  tarefaId,
  onTarefa,
}: {
  mes: string;
  onMes: (mes: string) => void;
  tarefaId: string | null;
  onTarefa: (id: string | null) => void;
}) {
  const { clientId } = useMesa();
  const faixa = useFaixa();
  const colunas = emColunas(faixa);
  const altura = useAlturaDaEsteira(colunas);
  const raiz = useRef<HTMLDivElement>(null);
  const [gaveta, setGaveta] = useState(false);
  // A lista abre nos próximos 60 dias; escolher um mês muda para aquele mês (e a URL acompanha).
  const [modoDaLista, setModoDaLista] = useEstadoGuardado<"proximos" | "mes">(`mesa:estudio:lista:${clientId}`, "proximos");
  const [filtroGuardado, setFiltro] = useEstadoGuardado<Filtro>(`mesa:estudio:filtro:${clientId}`, "a_fazer");
  const filtro = filtroValido(filtroGuardado);
  const janela = modoDaLista === "proximos" ? PROXIMOS_DIAS : mes;
  const dados = useItensDoMes(clientId, janela);
  const itens = dados.data?.itens || [];
  const naLista = tarefaId ? itens.find((i) => i.id === tarefaId) || null : null;
  // Item aberto fora da janela: consulta pequena à parte, só depois que a lista certa chegou.
  const listaPronta = !!dados.data && !dados.isPlaceholderData;
  const avulso = useItemAvulso(clientId, tarefaId, !!tarefaId && listaPronta && !naLista);
  const itemFora = !naLista && tarefaId && avulso.data ? avulso.data.itens.find((i) => i.id === tarefaId) || null : null;
  const selecionado = naLista || itemFora;
  const meses = useMemo(() => mesesDoSeletor(mes), [mes]);

  const fontes: FontesDaLista = {
    trabalhoDe: (i) => dados.data?.trabalhos.get(i.id) || avulso.data?.trabalhos.get(i.id) || null,
    arteDe: (i) => dados.data?.artes.get(i.id) || avulso.data?.artes.get(i.id) || null,
    temRoteiro: (i) => !!(dados.data?.roteiros.has(i.id) || avulso.data?.roteiros.has(i.id)),
  };
  const roteiroDe = (i: ItemDoMes) => dados.data?.infoDoRoteiro.get(i.id) || avulso.data?.infoDoRoteiro.get(i.id) || null;
  const publicacaoDe = (postId: string) => dados.data?.publicacoes.get(postId) || avulso.data?.publicacoes.get(postId) || null;
  const contagem = contarFiltros(itens, fontes.trabalhoDe, fontes.arteDe);
  const proxima = itens.find((i) => passaNoFiltro("a_fazer", fontes.trabalhoDe(i), fontes.arteDe(i))) || null;

  const escolherJanela = (v: string) => {
    if (v === PROXIMOS_DIAS) {
      setModoDaLista("proximos");
      return;
    }
    setModoDaLista("mes");
    if (v !== mes) onMes(v);
  };

  const escolher = (id: string) => {
    onTarefa(id);
    setGaveta(false);
    // No computador, a esteira encaixa na janela (o cabeçalho da Mesa gruda no topo).
    if (colunas) encaixarNaJanela(raiz.current);
  };

  const lista = (emColuna: boolean) => (
    <EstudioLista
      janela={janela}
      meses={meses}
      onJanela={escolherJanela}
      filtro={filtro}
      onFiltro={setFiltro}
      itens={itens}
      itemFora={itemFora}
      fontes={fontes}
      carregando={dados.isLoading}
      atualizando={dados.isPlaceholderData}
      erro={dados.isError ? dados.error : null}
      tarefaId={tarefaId}
      onEscolher={escolher}
      emColuna={emColuna}
    />
  );

  const navegacao =
    faixa === "mesa" ? null : faixa === "compacto" ? (
      <Button type="button" variant="ghost" size="sm" className="mr-2 h-9 shrink-0 px-2" onClick={() => setGaveta(true)} title="Abrir a lista de pautas">
        <PanelLeft className="mr-1 h-4 w-4" /> Pautas
      </Button>
    ) : (
      <Button type="button" variant="ghost" size="icon" className="mr-1 h-10 w-10 shrink-0" onClick={() => onTarefa(null)} aria-label="Voltar às pautas">
        <ArrowLeft className="h-4 w-4" />
      </Button>
    );

  const detalhe = selecionado ? (
    <DetalheDoItem
      key={selecionado.id}
      item={selecionado}
      trabalho={fontes.trabalhoDe(selecionado)}
      arte={fontes.arteDe(selecionado)}
      roteiro={roteiroDe(selecionado)}
      temRoteiro={fontes.temRoteiro(selecionado)}
      publicacaoDe={publicacaoDe}
      modo={colunas ? "colunas" : "pilha"}
      navegacao={navegacao}
    />
  ) : null;

  const carregandoItem = !!tarefaId && !selecionado && (dados.isLoading || avulso.isLoading || avulso.isFetching);

  if (faixa === "mesa") {
    return (
      <div
        ref={raiz}
        className="grid min-w-0 grid-cols-[280px_minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)] gap-4"
        style={altura ? { height: altura } : undefined}
      >
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="Pautas">
          {lista(true)}
        </aside>
        {detalhe ||
          (carregandoItem ? (
            <div className="col-span-2 flex items-center justify-center rounded-xl border border-border bg-card text-[12.5px] text-muted-foreground">
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Abrindo a pauta…
            </div>
          ) : (
            <SemPauta contagem={contagem} proxima={proxima} onEscolher={escolher} />
          ))}
      </div>
    );
  }

  if (faixa === "compacto") {
    return (
      <>
        <div
          ref={raiz}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)] gap-4"
          style={altura ? { height: altura } : undefined}
        >
          {detalhe || (
            <SemPauta
              contagem={contagem}
              proxima={proxima}
              onEscolher={escolher}
              acaoDaLista={
                <Button type="button" variant="outline" className="mb-2 h-10" onClick={() => setGaveta(true)}>
                  <PanelLeft className="mr-1.5 h-4 w-4" /> Ver as pautas
                </Button>
              }
            />
          )}
        </div>
        <Sheet open={gaveta} onOpenChange={setGaveta}>
          <SheetContent side="left" className="flex w-[320px] flex-col gap-0 p-0 sm:max-w-[320px]">
            <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
              <SheetTitle className="text-[14px] font-semibold">Pautas</SheetTitle>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{lista(true)}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Celular e tablet em pé: uma coluna; a lista e a pauta aberta se revezam.
  return (
    <div ref={raiz} className="min-w-0">
      {detalhe || (
        <div className="rounded-xl border border-border bg-card p-3">
          {carregandoItem && <p className="mb-2 text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Abrindo a pauta…</p>}
          {lista(false)}
        </div>
      )}
    </div>
  );
}
