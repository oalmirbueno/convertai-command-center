import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  FolderCheck,
  Hash,
  ImageOff,
  Layers,
  Loader2,
  MessageSquare,
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TASK_DELIVERY_TYPE_LABELS, type TaskDeliveryType } from "@/lib/taskDeliveryTypes";
import {
  chamarFuncao,
  custoDaResposta,
  dataCurta,
  dataEHora,
  ErroDaMesa,
  estimarLocal,
  inicioDoMes,
  padraoPara,
  rotuloDoMes,
  somarMeses,
  TAMANHOS,
  textoDoErro,
  usd,
  type ParteDaEstimativa,
  type Qualidade,
} from "@/lib/mesa/api";
import CardDoEstudio, { type OpcoesDoAjuste, type PainelDaLamina } from "./CardDoEstudio";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import PranchetaDoEstudio from "./PranchetaDoEstudio";
import ReferenciasDoEstudio, { type AlvoDasReferencias } from "./ReferenciasDoEstudio";
import { SeletorDeModelo } from "./Seletores";
import { copiarTexto, legendaParaCopiar, normalizarHashtags, useEstadoGuardado } from "./estudioUtil";
import {
  PROXIMOS_DIAS,
  ROTULO_DO_TRABALHO,
  ultimasVersoes,
  useItensDoMes,
  type ItemDoMes,
  type Trabalho,
} from "./useItensDoMes";

/**
 * Aba Estúdio, versão 3 (pedido do dono em 23/09).
 *
 * Coluna da esquerda: por padrão os próximos 60 dias (o seletor ainda deixa
 * escolher um mês), filtros A fazer, Com arte e Entregues, estrela nos itens
 * com roteiro do estrategista. Direita, em seções separadas e sólidas:
 * produção (qualidade, gerador, gerar todas), prancheta com as lâminas em
 * 4:5, painel da lâmina escolhida, conjunto (conceito e conversa com o
 * diretor), referências, legenda com hashtags e entrega.
 *
 * Nenhuma ação de IA abre janela: o BotaoComCusto mostra o preço ao lado e
 * executa no clique; o andamento aparece na própria lâmina (cronômetro), sem
 * travar o resto. "Gerar todas" roda até 3 lâminas ao mesmo tempo; no
 * carrossel contínuo, uma de cada vez, porque cada lâmina continua a
 * anterior. A conferência roda logo depois de cada lâmina.
 *
 * A tela nunca desenha texto por cima da arte: mostra o que o gerador
 * devolveu e, antes disso, o esqueleto do layout que o gerador recebe.
 */

const CODIGOS_QUE_NAO_PARAM_A_FILA = ["acao_desconhecida", "servico_indisponivel"];
const CODIGOS_QUE_PARAM_TUDO = ["saldo_insuficiente", "cota_da_chave_esgotada", "cliente_sem_chave", "provedor_sem_chave"];
const EM_PARALELO = 3;

const QUALIDADES_DO_ESTUDIO: { valor: Qualidade; rotulo: string; dica: string }[] = [
  { valor: "baixa", rotulo: "Rascunho", dica: "para testar ideia e layout" },
  { valor: "media", rotulo: "Padrão", dica: "texto nítido, o normal para postar" },
  { valor: "alta", rotulo: "Final", dica: "máximo detalhe, mais caro e mais lento" },
];

type Filtro = "a_fazer" | "com_arte" | "entregues";

const semOrdem = (g: Record<number, number>, ordem: number) => {
  const n = { ...g };
  delete n[ordem];
  return n;
};

function Pilula({ tom = "neutro", children }: { tom?: "neutro" | "primario" | "ok" | "alerta"; children: ReactNode }) {
  const cor =
    tom === "primario" ? "bg-primary/10 text-primary" : tom === "ok" ? "bg-success/10 text-success" : tom === "alerta" ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground";
  return <span className={`mb-1 mr-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cor}`}>{children}</span>;
}

function DetalheDoItem({
  item,
  trabalho,
  temRoteiro,
  onVoltar,
}: {
  item: ItemDoMes;
  trabalho: Trabalho | null;
  temRoteiro: boolean;
  onVoltar: () => void;
}) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const avisarErro = useAvisarErro();
  const chave = `mesa:estudio:${item.id}`;
  const [modeloImagem, setModeloImagem] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("media");
  const [legenda, setLegenda] = useState("");
  const [hashtagsTexto, setHashtagsTexto] = useState("");
  const [salvandoLegenda, setSalvandoLegenda] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [montando, setMontando] = useState(false);
  const [gerando, setGerando] = useState<Record<number, number>>({});
  const [fila, setFila] = useState<number[]>([]);
  const [emLote, setEmLote] = useState(false);
  const [conferindo, setConferindo] = useState<Record<number, boolean>>({});
  const [pedidoAoDiretor, setPedidoAoDiretor] = useState("");
  const [salvandoContinuo, setSalvandoContinuo] = useState(false);
  // Guardados na sessão: voltar de outra aba devolve a mesma lâmina e o mesmo painel.
  const [selecionado, setSelecionado] = useEstadoGuardado<number | null>(`${chave}:lamina`, null);
  const [painel, setPainel] = useEstadoGuardado<PainelDaLamina>(`${chave}:painel`, "direcao");
  const [refsAberto, setRefsAberto] = useEstadoGuardado<boolean>(`${chave}:refs`, false);
  const [refsAlvo, setRefsAlvo] = useEstadoGuardado<AlvoDasReferencias>(`${chave}:refs-alvo`, "conjunto");
  const [refsAba, setRefsAba] = useEstadoGuardado<"cliente" | "banco">(`${chave}:refs-aba`, "cliente");
  const [largura, setLargura] = useEstadoGuardado<number>("mesa:estudio:zoom", 200);
  const parar = useRef(false);

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
    void queryClient.invalidateQueries({ queryKey: ["mesa", "ajustes"] });
    mesa.atualizarCusto();
  };

  const diretor = padraoPara(catalogo, "diretor_arte");
  const leitor = padraoPara(catalogo, "leitura");

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
    return v === null ? "" : usd(v);
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

  /** Uma lâmina só (painel ou ação rápida da prancheta): gera e confere em seguida. */
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
  const ocupado = algoGerando || entregando || montando;
  const infinito = !!trabalho?.direcao?.carrossel_infinito;
  const laminaOcupada = (ordem: number) => gerando[ordem] !== undefined || fila.indexOf(ordem) >= 0 || montando || entregando;
  const progresso = cardsDaDirecao.length ? Math.round((ultimas.size / cardsDaDirecao.length) * 100) : 0;

  // Lâmina escolhida: a guardada na sessão, se ainda existir; senão a primeira.
  useEffect(() => {
    if (!cardsDaDirecao.length) return;
    if (selecionado === null || !cardsDaDirecao.some((c) => c.ordem === selecionado)) setSelecionado(cardsDaDirecao[0].ordem);
  }, [trabalho?.id, cardsDaDirecao.length]);

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

  const montarDoRoteiro = async () => {
    setMontando(true);
    try {
      await chamarFuncao("estudio-arte", { acao: "preparar", task_id: item.id, modo: "roteiro", modelo_imagem_id: modeloImagem || undefined, qualidade });
      toast.success("Direção montada do roteiro", { description: "Sem custo de IA. Confira as lâminas na prancheta e gere." });
      atualizar();
    } catch (e) {
      avisarErro(e, "Não foi possível montar a direção");
    } finally {
      setMontando(false);
    }
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

  const salvarLegenda = async () => {
    if (!trabalho) return;
    setSalvandoLegenda(true);
    const { error } = await (supabase as any)
      .from("estudio_trabalhos")
      .update({ legenda: legenda.trim() || null, hashtags })
      .eq("id", trabalho.id);
    setSalvandoLegenda(false);
    if (error) toast.error("Legenda não salva", { description: textoDoErro(error) });
    else {
      toast.success("Legenda salva");
      atualizar();
    }
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

  const entregar = async () => {
    if (!trabalho) return;
    const ok = await confirmar({
      title: "Entregar para Arquivos?",
      description: `Cria ${cardsDaDirecao.length > 1 ? "o carrossel" : "o post"} em Arquivos, ligado a este item da agenda, com a versão mais recente de cada lâmina e a legenda.`,
      confirmLabel: "Entregar",
    });
    if (!ok) return;
    setEntregando(true);
    try {
      await chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: trabalho.id });
      toast.success("Entregue em Arquivos", { description: "Envie para aprovação pela aba Entrega." });
      atualizar();
    } catch (e) {
      avisarErro(e, "Não foi possível entregar");
    } finally {
      setEntregando(false);
    }
  };

  const formato = TASK_DELIVERY_TYPE_LABELS[item.delivery_type as TaskDeliveryType] || item.delivery_type;
  const cardSelecionado = cardsDaDirecao.find((c) => c.ordem === selecionado) || null;
  const painelDaLamina = useRef<HTMLDivElement>(null);
  const abrirPainel = (ordem: number, p: PainelDaLamina) => {
    setSelecionado(ordem);
    setPainel(p);
    // Leva o painel da lâmina para a vista (Safari antigo aceita o booleano).
    window.setTimeout(() => {
      try { painelDaLamina.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { painelDaLamina.current?.scrollIntoView(true); }
    }, 60);
  };

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex items-start">
        <Button type="button" variant="ghost" size="icon" className="mr-2 h-9 w-9 shrink-0 lg:hidden" onClick={onVoltar} aria-label="Voltar aos itens">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground">
            {dataCurta(item.due_date)} · {formato}
          </p>
          <h2 className="mt-1 text-[20px] font-semibold leading-tight [overflow-wrap:anywhere]">{item.title}</h2>
          <div className="mt-2.5 flex flex-wrap">
            {trabalho && <Pilula tom={trabalho.status === "entregue" ? "ok" : "primario"}>{ROTULO_DO_TRABALHO[trabalho.status] || trabalho.status}</Pilula>}
            {temRoteiro && <Pilula tom="alerta"><Star className="mr-1 h-3 w-3" /> roteiro do estrategista</Pilula>}
            {trabalho && trabalho.custo_usd > 0 && <Pilula>gasto {usd(trabalho.custo_usd)}</Pilula>}
          </div>
        </div>
      </header>

      {!trabalho || cardsDaDirecao.length === 0 ? (
        <section className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-primary" />
          {temRoteiro ? (
            <>
              <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed">
                Este item tem roteiro do calendário. A direção de cada lâmina sai dele, no sistema visual da marca, sem custo de IA.
              </p>
              <div className="mt-5 flex flex-col items-center justify-center sm:flex-row">
                <Button type="button" className="mb-2 sm:mb-0 sm:mr-3" onClick={() => void montarDoRoteiro()} disabled={montando}>
                  {montando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                  Montar direção do roteiro
                </Button>
                <BotaoComCusto
                  rotulo="Dirigir com o diretor de arte"
                  titulo="Direção pelo diretor de arte"
                  descricao="O diretor relê o roteiro, a marca, as referências e a base de design e decide cada lâmina."
                  variant="outline"
                  disabled={montando}
                  partes={partesDiretor}
                  executar={() => chamarFuncao("estudio-arte", { acao: "preparar", task_id: item.id, modo: "diretor", modelo_imagem_id: modeloImagem || undefined, qualidade })}
                  aoConcluir={() => atualizar()}
                />
              </div>
            </>
          ) : (
            <>
              <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed">O diretor de arte lê o item, a marca, as referências e a base de design e decide cada lâmina.</p>
              <div className="mt-5">
                <BotaoComCusto
                  rotulo="Preparar direção"
                  titulo="Preparar a direção de arte"
                  descricao="Uma chamada ao diretor de arte. Nenhuma imagem é gerada ainda."
                  partes={partesDiretor}
                  executar={() => chamarFuncao("estudio-arte", { acao: "preparar", task_id: item.id, modo: "diretor", modelo_imagem_id: modeloImagem || undefined, qualidade })}
                  aoConcluir={() => atualizar()}
                />
              </div>
            </>
          )}
        </section>
      ) : (
        <>
          {/* Produção: qualidade, gerador e gerar todas */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,260px)]">
              <div className="min-w-0">
                <p className="text-[11.5px] font-medium text-muted-foreground">Qualidade da lâmina</p>
                <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-xl border border-border bg-background p-1">
                  {QUALIDADES_DO_ESTUDIO.map((q) => (
                    <button
                      key={q.valor}
                      type="button"
                      disabled={emLote}
                      title={q.dica}
                      onClick={() => { setQualidade(q.valor); void guardarEscolha({ qualidade: q.valor }); }}
                      className={`min-w-0 rounded-lg px-1.5 py-2 text-[12.5px] transition-colors ${
                        qualidade === q.valor ? "bg-primary font-medium text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      {q.rotulo}
                      <span className={`block text-[10.5px] ${qualidade === q.valor ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{precoPorLamina(q.valor)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <SeletorDeModelo
                  catalogo={catalogo}
                  tipo="imagem"
                  valor={modeloImagem}
                  qualidade={qualidade}
                  rotulo="Gerador de imagem"
                  disabled={emLote}
                  onChange={(id) => { setModeloImagem(id); void guardarEscolha({ modelo_imagem_id: id }); }}
                />
              </div>
            </div>
            <div className="mt-5 flex flex-col border-t border-border pt-4 sm:flex-row sm:items-center">
              <div className="mb-3 min-w-0 flex-1 sm:mb-0 sm:mr-4">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progresso}%` }} />
                </div>
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  {gerandoAgora > 0
                    ? `Gerando ${gerandoAgora} lâmina${gerandoAgora === 1 ? "" : "s"} agora. ${ultimas.size} de ${cardsDaDirecao.length} prontas.`
                    : `${ultimas.size} de ${cardsDaDirecao.length} lâmina${cardsDaDirecao.length === 1 ? "" : "s"} com arte.${semImagem.length ? ` Faltam ${semImagem.length}.` : ""}`}
                  {infinito ? " Carrossel contínuo: uma lâmina de cada vez." : ""}
                </p>
              </div>
              {emLote ? (
                <Button type="button" size="sm" variant="outline" onClick={() => { parar.current = true; }}>
                  <Square className="mr-1.5 h-3.5 w-3.5" /> Parar depois das que estão gerando
                </Button>
              ) : (
                <BotaoComCusto
                  rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" /> {semImagem.length ? `Gerar ${semImagem.length === cardsDaDirecao.length ? "todas" : "as que faltam"} (${semImagem.length})` : `Gerar todas de novo (${cardsDaDirecao.length})`}</>}
                  titulo={`Gerar ${filaDeGeracao.length} lâmina(s)`}
                  descricao={infinito
                    ? "Carrossel contínuo: uma lâmina de cada vez, porque cada uma continua a anterior. A conferência roda logo depois de cada uma."
                    : "Até 3 lâminas ao mesmo tempo. A conferência de ortografia e identidade roda logo depois de cada uma."}
                  fecharAoConfirmar
                  disabled={ocupado}
                  partes={() => partesGerar(filaDeGeracao.length)}
                  executar={() => gerarVarias(filaDeGeracao.map((c) => c.ordem))}
                  aoConcluir={(data) => {
                    toast.success(data?.parado ? "Geração parada" : "Lâminas geradas", { description: `Custo real: ${usd(custoDaResposta(data) || 0)}.` });
                  }}
                />
              )}
            </div>
          </section>

          {/* Prancheta */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center">
              <div className="mb-2 mr-4 min-w-0 flex-1">
                <p className="text-[14px] font-semibold">Prancheta</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {trabalho.direcao?.origem === "roteiro" ? "Direção montada do roteiro" : "Direção do diretor de arte"}
                  {infinito ? " · contínuo, em panorama" : ""}
                  {" · "}{cardsDaDirecao.length} lâmina{cardsDaDirecao.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="mb-2 flex w-44 items-center">
                <span className="mr-2 text-[11.5px] text-muted-foreground">Zoom</span>
                <Slider value={[largura]} min={130} max={320} step={10} onValueChange={(v) => setLargura(v[0] || 200)} aria-label="Tamanho das lâminas" />
              </div>
            </div>
            <PranchetaDoEstudio
              cards={cardsDaDirecao}
              ultimas={ultimas}
              selecionado={selecionado}
              onSelecionar={setSelecionado}
              gerando={gerando}
              fila={fila}
              infinito={infinito}
              largura={largura}
              podeReordenar={!ocupado && cardsDaDirecao.length > 1 && trabalho.status !== "entregue"}
              onReordenar={(ordens) => void reordenar(ordens)}
              acoes={(c, v) => (
                <>
                  <BotaoComCusto
                    rotulo={<><Wand2 className="h-3.5 w-3.5" /><span className="sr-only">{v ? "Refazer" : "Gerar"} a lâmina {c.ordem}</span></>}
                    titulo={`${v ? "Refazer" : "Gerar"} a lâmina ${c.ordem}`}
                    descricao={`${v ? "Refazer" : "Gerar"} a lâmina ${c.ordem}. A conferência roda logo depois.`}
                    variant="ghost"
                    className="h-7 px-1.5 text-[11px]"
                    disabled={laminaOcupada(c.ordem)}
                    partes={() => partesGerar(1)}
                    executar={() => gerarEConferir(c.ordem)}
                  />
                  {v && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5" title="Ajustar esta lâmina" aria-label={`Ajustar a lâmina ${c.ordem}`} onClick={() => abrirPainel(c.ordem, "livre")}>
                      <MessageSquare className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {v && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-[11px]" title="Ver as versões" aria-label={`Versões da lâmina ${c.ordem}`} onClick={() => abrirPainel(c.ordem, "versoes")}>
                      <Layers className="mr-0.5 h-3.5 w-3.5" />{v.versao}
                    </Button>
                  )}
                </>
              )}
            />
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              Passe o mouse numa lâmina (ou toque nela) para gerar, ajustar ou ver as versões.
              {cardsDaDirecao.length > 1 ? " Arraste pela alça para mudar a ordem." : ""}
            </p>
          </section>

          {/* Lâmina escolhida */}
          <div ref={painelDaLamina} className="scroll-mt-44">
          {cardSelecionado && (
            <CardDoEstudio
              key={cardSelecionado.ordem}
              conversaId={trabalho.conversa_id}
              direcao={cardSelecionado}
              versoes={(trabalho.cards || []).filter((v) => v.ordem === cardSelecionado.ordem)}
              ocupado={laminaOcupada(cardSelecionado.ordem)}
              conferindo={!!conferindo[cardSelecionado.ordem]}
              gerandoDesde={gerando[cardSelecionado.ordem]}
              painel={painel}
              onPainel={setPainel}
              partesGerar={() => partesGerar(1)}
              partesAjustar={partesAjustar}
              partesConferir={partesConferir}
              onGerar={() => gerarEConferir(cardSelecionado.ordem)}
              onAjustar={(instrucao, opcoes) => ajustar(cardSelecionado.ordem, instrucao, opcoes)}
              onConferir={() => conferir(trabalho.id, cardSelecionado.ordem)}
              onConfigurar={(card) => configurar({ card: { ordem: cardSelecionado.ordem, ...card } })}
              onConcluido={atualizar}
            />
          )}
          </div>

          {/* Conjunto: conceito e conversa com o diretor */}
          <section className="space-y-5 rounded-2xl border border-border bg-card p-5">
            <div>
              <p className="text-[14px] font-semibold">Conjunto</p>
              {trabalho.direcao?.conceito ? (
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{trabalho.direcao.conceito}</p>
              ) : (
                <p className="mt-2 text-[12.5px] text-muted-foreground">Sem conceito escrito nesta direção.</p>
              )}
            </div>

            {cardsDaDirecao.length > 1 && (
              <label className="flex items-start rounded-xl border border-border bg-background p-3.5">
                <Switch checked={infinito} onCheckedChange={(v) => void alternarContinuo(v)} disabled={salvandoContinuo || algoGerando} className="mr-3 mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium">Carrossel contínuo</span>
                  <span className="block text-[11.5px] leading-relaxed text-muted-foreground">
                    Cada lâmina continua a anterior, como um panorama. Gera uma de cada vez.
                  </span>
                </span>
              </label>
            )}

            <div className="space-y-2.5 rounded-xl border border-border bg-background p-4">
              <p className="text-[12.5px] font-semibold">Pedir ao diretor</p>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Peça uma mudança no conjunto (tom, cores, ordem das ideias, mais foto real). O diretor refaz a direção pelo pedido; as artes já geradas ficam nas versões.
              </p>
              <Textarea
                value={pedidoAoDiretor}
                onChange={(e) => setPedidoAoDiretor(e.target.value)}
                rows={3}
                placeholder="Ex.: deixe mais leve, com fotos reais do ambiente e menos texto por lâmina"
              />
              <div className="flex justify-end">
                <BotaoComCusto
                  rotulo={<><MessageSquare className="mr-1 h-3.5 w-3.5" /> {pedidoAoDiretor.trim() ? "Pedir ao diretor" : "Refazer a direção"}</>}
                  titulo="Pedir ao diretor"
                  descricao="O diretor relê a marca, as referências e o seu pedido e escreve a direção de novo, no mesmo trabalho."
                  variant={pedidoAoDiretor.trim() ? "default" : "outline"}
                  disabled={ocupado}
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
            </div>
          </section>

          <ReferenciasDoEstudio
            trabalho={trabalho}
            cardSelecionado={cardSelecionado}
            alvo={refsAlvo}
            onAlvo={setRefsAlvo}
            aba={refsAba}
            onAba={setRefsAba}
            aberto={refsAberto}
            onAberto={setRefsAberto}
            onAtualizar={atualizar}
          />

          {/* Legenda e hashtags */}
          <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center">
              <p className="mb-2 mr-3 flex-1 text-[14px] font-semibold">Legenda</p>
              <div className="mb-2">
                <BotaoComCusto
                  rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> {legenda ? "Reescrever legenda" : "Escrever legenda"}</>}
                  titulo="Escrever a legenda"
                  descricao="A legenda final sai do item da agenda e da arte pronta, com 4 ou 5 hashtags escolhidas entre as candidatas."
                  variant="outline"
                  partes={() => [{ modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida }]}
                  executar={() => chamarFuncao("estudio-arte", { acao: "legenda", trabalho_id: trabalho.id })}
                  aoConcluir={(data) => {
                    if (typeof data?.legenda === "string") setLegenda(data.legenda);
                    if (Array.isArray(data?.hashtags)) setHashtagsTexto(normalizarHashtags(data.hashtags).join(" "));
                    atualizar();
                  }}
                />
              </div>
            </div>
            <Textarea value={legenda} onChange={(e) => setLegenda(e.target.value)} rows={6} placeholder="A legenda do post aparece aqui. Dá para editar à mão." className="text-[13px] leading-relaxed" />
            <div className="space-y-2">
              <p className="flex items-center text-[11.5px] font-medium text-muted-foreground"><Hash className="mr-1 h-3.5 w-3.5" /> Hashtags</p>
              <Input value={hashtagsTexto} onChange={(e) => setHashtagsTexto(e.target.value)} placeholder="#exemplo #outra" className="h-9 text-[12.5px]" />
              {hashtags.length > 0 && (
                <div className="flex flex-wrap">
                  {hashtags.map((h) => (
                    <span key={h} className="mb-1 mr-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11.5px] text-primary [overflow-wrap:anywhere]">{h}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center border-t border-border pt-4">
              <Button type="button" size="sm" variant="outline" className="mb-2 mr-2" onClick={() => void copiar(legendaParaCopiar(legenda, hashtags), "Legenda copiada com as hashtags")}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar legenda
              </Button>
              <Button type="button" size="sm" variant="outline" className="mb-2 mr-2" onClick={() => void copiar(hashtags.join(" "), "Hashtags copiadas")}>
                <Hash className="mr-1.5 h-3.5 w-3.5" /> Copiar hashtags
              </Button>
              <span className="mb-2 flex-1" />
              <Button type="button" size="sm" className="mb-2" onClick={() => void salvarLegenda()} disabled={salvandoLegenda || !legendaMudou}>
                {salvandoLegenda && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Salvar legenda
              </Button>
            </div>
          </section>

          {trabalho.entrega_status === "reprovado" && trabalho.status !== "entregue" && (
            <section className="rounded-2xl border border-warning/50 bg-card p-5 text-[12.5px]">
              <p className="font-semibold text-warning">Pediram ajuste nesta arte</p>
              {trabalho.entrega_aviso && <p className="mt-1.5 [overflow-wrap:anywhere]">“{trabalho.entrega_aviso}”</p>}
              <p className="mt-1.5 leading-relaxed text-muted-foreground">
                Ajuste as lâminas aqui e entregue de novo. A nova entrega vira um arquivo novo em Arquivos e volta para a aprovação pela aba Entrega.
              </p>
            </section>
          )}

          {/* Entrega */}
          <section className="flex flex-col rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center">
            <p className="mb-3 min-w-0 flex-1 text-[12.5px] leading-relaxed text-muted-foreground sm:mb-0 sm:mr-4">
              {trabalho.status === "entregue"
                ? `Entregue em Arquivos. ${textoDaEntrega(trabalho)}`
                : todosComImagem
                  ? "Tudo pronto para ir para Arquivos, ligado a este item da agenda."
                  : "Gere todas as lâminas para entregar."}
              {trabalho.status === "entregue" && (
                <>
                  {" "}
                  <Link to={`/arquivos?client=${clientId}`} className="text-primary underline-offset-2 hover:underline">Abrir Arquivos</Link>
                </>
              )}
            </p>
            <Button type="button" onClick={() => void entregar()} disabled={!todosComImagem || ocupado || trabalho.status === "entregue"}>
              {entregando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FolderCheck className="mr-1.5 h-4 w-4" />}
              Entregar para Arquivos
            </Button>
          </section>
        </>
      )}
    </div>
  );
}

/** Uma frase sobre onde a arte entregue está no caminho até a Agenda. */
function textoDaEntrega(t: Trabalho): string {
  switch (t.entrega_status) {
    case "aguardando_agencia":
      return "Aguardando a revisão da agência.";
    case "aguardando_cliente":
      return "Aguardando a aprovação do cliente.";
    case "aprovado":
      return "Aprovado pelo cliente. Entra na Agenda em até um minuto.";
    case "agendado":
      return t.agendado_para ? `Na Agenda para ${dataEHora(t.agendado_para)}.` : "Na Agenda.";
    case "precisa_de_atencao":
      return t.entrega_aviso || "Aprovado, mas não entrou sozinho na Agenda.";
    default:
      return "Envie para aprovação pela aba Entrega.";
  }
}

function situacaoDoItem(t: Trabalho | null, temRoteiro: boolean): { rotulo: string; tom: "neutro" | "primario" | "ok" | "alerta" } {
  if (!t) return temRoteiro ? { rotulo: "roteiro pronto", tom: "primario" } : { rotulo: "sem direção", tom: "neutro" };
  if (t.entrega_status === "agendado") return { rotulo: "na agenda", tom: "ok" };
  if (t.status === "entregue") return { rotulo: "entregue", tom: "ok" };
  const feitas = ultimasVersoes(t.cards).size;
  const total = (t.direcao?.cards || []).length;
  if (!feitas) return { rotulo: "direção pronta", tom: "primario" };
  if (feitas < total) return { rotulo: `${feitas} de ${total} com arte`, tom: "alerta" };
  return { rotulo: ROTULO_DO_TRABALHO[t.status] || "arte pronta", tom: "ok" };
}

/** Meses para o seletor da coluna: 6 para trás e 6 para frente do atual. */
function mesesDoSeletor(mesAtual: string): string[] {
  const base = inicioDoMes();
  const lista: string[] = [];
  for (let i = -6; i <= 6; i++) lista.push(somarMeses(base, i));
  if (lista.indexOf(mesAtual) < 0) lista.push(mesAtual);
  return lista.sort();
}

const entregue = (t: Trabalho | null) => !!t && (t.status === "entregue" || t.entrega_status === "agendado");

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
  // A lista abre nos próximos 60 dias; escolher um mês muda para aquele mês (e a URL acompanha).
  const [modoDaLista, setModoDaLista] = useEstadoGuardado<"proximos" | "mes">(`mesa:estudio:lista:${clientId}`, "proximos");
  const [filtro, setFiltro] = useEstadoGuardado<Filtro>(`mesa:estudio:filtro:${clientId}`, "a_fazer");
  const janela = modoDaLista === "proximos" ? PROXIMOS_DIAS : mes;
  const dados = useItensDoMes(clientId, janela, tarefaId);
  const itens = dados.data?.itens || [];
  const selecionado = itens.find((i) => i.id === tarefaId) || null;
  const meses = useMemo(() => mesesDoSeletor(mes), [mes]);
  const filtroValido: Filtro = filtro === "com_arte" || filtro === "entregues" ? filtro : "a_fazer";

  const trabalhoDe = (i: ItemDoMes) => dados.data?.trabalhos.get(i.id) || null;
  const temArte = (i: ItemDoMes) => {
    const t = trabalhoDe(i);
    return !!t && ultimasVersoes(t.cards).size > 0;
  };
  const passa = (i: ItemDoMes, f: Filtro) => {
    const t = trabalhoDe(i);
    if (f === "entregues") return entregue(t);
    if (f === "com_arte") return temArte(i) && !entregue(t);
    return !entregue(t);
  };
  // O item aberto pela URL continua visível mesmo fora do filtro.
  const filtrados = itens.filter((i) => passa(i, filtroValido) || i.id === tarefaId);
  const contagem: Record<Filtro, number> = {
    a_fazer: itens.filter((i) => passa(i, "a_fazer")).length,
    com_arte: itens.filter((i) => passa(i, "com_arte")).length,
    entregues: itens.filter((i) => passa(i, "entregues")).length,
  };
  const FILTROS: { valor: Filtro; rotulo: string }[] = [
    { valor: "a_fazer", rotulo: "A fazer" },
    { valor: "com_arte", rotulo: "Com arte" },
    { valor: "entregues", rotulo: "Entregues / na agenda" },
  ];

  // Nos próximos 60 dias a lista vem separada por mês.
  const grupos: { mes: string; itens: ItemDoMes[] }[] = [];
  for (const i of filtrados) {
    const m = i.due_date ? `${i.due_date.slice(0, 7)}-01` : "";
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.mes === m) ultimo.itens.push(i);
    else grupos.push({ mes: m, itens: [i] });
  }
  const temEstrela = itens.some((i) => !!dados.data?.roteiros.has(i.id));

  const escolherJanela = (v: string) => {
    if (v === PROXIMOS_DIAS) {
      setModoDaLista("proximos");
      return;
    }
    setModoDaLista("mes");
    if (v !== mes) onMes(v);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={`min-w-0 ${selecionado ? "hidden lg:block" : ""}`}>
        <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <Select value={janela} onValueChange={escolherJanela}>
            <SelectTrigger className="h-10 w-full text-[13px] font-medium capitalize" aria-label="Período da lista">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PROXIMOS_DIAS}>Próximos 60 dias</SelectItem>
              {meses.map((m) => (
                <SelectItem key={m} value={m} className="capitalize">{rotuloDoMes(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-background p-1">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                onClick={() => setFiltro(f.valor)}
                aria-pressed={filtroValido === f.valor}
                className={`min-w-0 rounded-lg px-1 py-1.5 text-[11.5px] leading-tight transition-colors ${
                  filtroValido === f.valor ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <span className="block [overflow-wrap:anywhere]">{f.rotulo}</span>
                <span className={`block text-[10.5px] ${filtroValido === f.valor ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{contagem[f.valor]}</span>
              </button>
            ))}
          </div>

          {temEstrela && (
            <p className="flex items-start text-[11.5px] leading-relaxed text-muted-foreground">
              <Star className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
              <span>Roteiro escrito pelo estrategista: a direção sai dele, sem custo de IA.</span>
            </p>
          )}

          {dados.isLoading && <p className="text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo a agenda…</p>}
          {dados.isError && <p className="rounded-lg bg-destructive/10 p-3 text-[12.5px]">{textoDoErro(dados.error)}</p>}
          {dados.data && itens.length === 0 && (
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {modoDaLista === "proximos"
                ? "Nenhum carrossel ou post estático na agenda dos próximos 60 dias."
                : "Nenhum carrossel ou post estático na agenda deste mês."}{" "}
              Complete a agenda pela aba Mês ou crie o item no Calendário.
            </p>
          )}
          {dados.data && itens.length > 0 && filtrados.length === 0 && (
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">Nada neste filtro.</p>
          )}

          <div className="space-y-4 lg:max-h-[calc(100vh-340px)] lg:overflow-y-auto lg:pr-1">
            {grupos.map((g) => (
              <div key={g.mes || "sem-data"}>
                {modoDaLista === "proximos" && (
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.mes ? rotuloDoMes(g.mes) : "Sem data"}</p>
                )}
                <ul className="space-y-2">
                  {g.itens.map((i) => {
                    const t = trabalhoDe(i);
                    const capa = t ? ultimasVersoes(t.cards).get(1) || null : null;
                    const comRoteiro = !!dados.data?.roteiros.has(i.id);
                    const situacao = situacaoDoItem(t, comRoteiro);
                    const ativo = i.id === tarefaId;
                    return (
                      <li key={i.id}>
                        <button
                          type="button"
                          onClick={() => onTarefa(i.id)}
                          aria-current={ativo ? "true" : undefined}
                          className={`flex w-full min-w-0 items-center rounded-xl border px-3 py-2.5 text-left transition-all duration-150 ${
                            ativo ? "border-primary bg-background shadow-md" : "border-border bg-background hover:-translate-y-px hover:border-primary/50 hover:shadow-md"
                          }`}
                        >
                          {capa ? (
                            <ImagemDaMesa caminho={capa.storage_path} alt={i.title} className="h-[50px] w-10 shrink-0 rounded-md" />
                          ) : (
                            <span className="flex h-[50px] w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-secondary text-muted-foreground">
                              <ImageOff className="h-3.5 w-3.5" />
                            </span>
                          )}
                          <span className="ml-3 min-w-0 flex-1">
                            <span className="flex items-start">
                              <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">{i.title}</span>
                              {comRoteiro && <Star className="ml-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 fill-warning text-warning" aria-label="Roteiro do estrategista" />}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {dataCurta(i.due_date)} · {TASK_DELIVERY_TYPE_LABELS[i.delivery_type as TaskDeliveryType] || i.delivery_type}
                            </span>
                            <span className="mt-1 block">
                              <Pilula tom={situacao.tom}>{situacao.rotulo}</Pilula>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className={`min-w-0 ${selecionado ? "" : "hidden lg:block"}`}>
        {selecionado ? (
          <DetalheDoItem
            key={selecionado.id}
            item={selecionado}
            trabalho={trabalhoDe(selecionado)}
            temRoteiro={!!dados.data?.roteiros.has(selecionado.id)}
            onVoltar={() => onTarefa(null)}
          />
        ) : (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <Sparkles className="h-6 w-6 text-primary" />
            <p className="mt-3 text-[14px] font-medium">Escolha um item da agenda para abrir o estúdio.</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">A lista mostra os próximos 60 dias; troque para um mês no seletor.</p>
          </div>
        )}
      </div>
    </div>
  );
}
