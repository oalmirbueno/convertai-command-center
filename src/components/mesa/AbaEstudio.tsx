import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FolderCheck, ImageOff, Loader2, Sparkles, Square, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
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
import CardDoEstudio from "./CardDoEstudio";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import PranchetaDoEstudio from "./PranchetaDoEstudio";
import { SeletorDeModelo, TituloDeSecao } from "./Seletores";
import { ROTULO_DO_TRABALHO, ultimasVersoes, useItensDoMes, type ItemDoMes, type Trabalho } from "./useItensDoMes";

/**
 * Aba Estúdio. Coluna da esquerda: os itens do mês (seletor de mês dentro da
 * coluna, filtro por situação e rolagem própria). Direita: a prancheta com
 * todas as lâminas do item em 4:5, lado a lado, e o painel da lâmina
 * escolhida.
 *
 * Item que veio do calendário com roteiro já chega com a direção pronta (ou
 * monta a direção do roteiro sem custo). "Gerar todas" roda até 3 lâminas ao
 * mesmo tempo; no carrossel contínuo, uma de cada vez, porque cada lâmina
 * continua a anterior. A conferência (ortografia e identidade) roda logo
 * depois de cada lâmina, sem segurar a próxima.
 *
 * A tela nunca desenha texto por cima da arte: mostra o que o gerador devolveu
 * e, antes disso, o esqueleto do layout que o gerador recebe.
 */

const CODIGOS_QUE_NAO_PARAM_A_FILA = ["acao_desconhecida", "servico_indisponivel"];
const CODIGOS_QUE_PARAM_TUDO = ["saldo_insuficiente", "cota_da_chave_esgotada", "cliente_sem_chave", "provedor_sem_chave"];
const EM_PARALELO = 3;

const QUALIDADES_DO_ESTUDIO: { valor: Qualidade; rotulo: string; dica: string }[] = [
  { valor: "baixa", rotulo: "Rascunho", dica: "para testar ideia e layout" },
  { valor: "media", rotulo: "Padrão", dica: "texto nítido, o normal para postar" },
  { valor: "alta", rotulo: "Final", dica: "máximo detalhe, mais caro e mais lento" },
];

type Filtro = "todos" | "sem_arte" | "com_arte" | "entregues";

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
  const [modeloImagem, setModeloImagem] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("media");
  const [legenda, setLegenda] = useState("");
  const [salvandoLegenda, setSalvandoLegenda] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [montando, setMontando] = useState(false);
  const [gerando, setGerando] = useState<Record<number, number>>({});
  const [emLote, setEmLote] = useState(false);
  const [conferindoOrdem, setConferindoOrdem] = useState<number | null>(null);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [largura, setLargura] = useState(200);
  const parar = useRef(false);

  useEffect(() => {
    setModeloImagem(trabalho?.modelo_imagem_id || padraoPara(catalogo, "imagem")?.id || "");
    setQualidade((trabalho?.qualidade as Qualidade) || "media");
    setLegenda(trabalho?.legenda || "");
  }, [trabalho?.id, catalogo.length]);

  useEffect(() => { setLegenda(trabalho?.legenda || ""); }, [trabalho?.legenda]);

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
  const precoPorLamina = (q: Qualidade) => {
    const v = modeloImagem ? estimarLocal(partesGerar(1, q), catalogo) : null;
    return v === null ? "" : usd(v);
  };

  const conferir = async (trabalhoId: string, ordem: number) => {
    setConferindoOrdem(ordem);
    try {
      return await chamarFuncao<any>("estudio-arte", { acao: "conferir_card", trabalho_id: trabalhoId, ordem });
    } finally {
      setConferindoOrdem(null);
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
    setGerando((g) => ({ ...g, [ordem]: Date.now() }));
    try {
      const g = await chamarFuncao<any>("estudio-arte", { acao: "gerar_card", trabalho_id: trabalhoId, ordem });
      atualizar();
      return custoDaResposta(g) || 0;
    } finally {
      setGerando((g) => {
        const n = { ...g };
        delete n[ordem];
        return n;
      });
    }
  };

  const cardsDaDirecao = (trabalho?.direcao?.cards || []).slice().sort((a, b) => a.ordem - b.ordem);
  const ultimas = ultimasVersoes(trabalho?.cards || []);
  const semImagem = cardsDaDirecao.filter((c) => !ultimas.has(c.ordem));
  const filaDeGeracao = semImagem.length ? semImagem : cardsDaDirecao;
  const todosComImagem = cardsDaDirecao.length > 0 && semImagem.length === 0;
  const gerandoAgora = Object.keys(gerando).length;
  const ocupado = emLote || gerandoAgora > 0 || entregando || montando;
  const infinito = !!trabalho?.direcao?.carrossel_infinito;

  useEffect(() => {
    if (!cardsDaDirecao.length) setSelecionado(null);
    else if (selecionado === null || !cardsDaDirecao.some((c) => c.ordem === selecionado)) setSelecionado(cardsDaDirecao[0].ordem);
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

  const salvarLegenda = async () => {
    if (!trabalho) return;
    setSalvandoLegenda(true);
    const { error } = await (supabase as any).from("estudio_trabalhos").update({ legenda: legenda.trim() || null }).eq("id", trabalho.id);
    setSalvandoLegenda(false);
    if (error) toast.error("Legenda não salva", { description: textoDoErro(error) });
    else {
      toast.success("Legenda salva");
      atualizar();
    }
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
  const partesDiretor = (): ParteDaEstimativa[] => [
    { modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada, tokensSaida: TAMANHOS.preparar.saida },
  ];

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-start gap-2">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 lg:hidden" onClick={onVoltar} aria-label="Voltar aos itens">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold leading-tight [overflow-wrap:anywhere]">{item.title}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {dataCurta(item.due_date)} · {formato}
            {trabalho ? ` · ${ROTULO_DO_TRABALHO[trabalho.status] || trabalho.status}` : ""}
            {trabalho && trabalho.custo_usd > 0 ? ` · gasto ${usd(trabalho.custo_usd)}` : ""}
          </p>
        </div>
      </div>

      {!trabalho || cardsDaDirecao.length === 0 ? (
        <section className="space-y-3 rounded-xl border border-dashed border-border p-5 text-center">
          {temRoteiro ? (
            <>
              <p className="text-[13px]">Este item tem roteiro do calendário. A direção de cada lâmina sai dele, no sistema visual da marca, sem custo de IA.</p>
              <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
                <Button type="button" onClick={() => void montarDoRoteiro()} disabled={montando}>
                  {montando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                  Montar direção do roteiro
                </Button>
                <BotaoComCusto
                  rotulo="Dirigir com o diretor de arte"
                  titulo="Direção pelo diretor de arte"
                  descricao="O diretor relê o roteiro, a marca, as referências e a base de design e decide cada lâmina."
                  variant="outline"
                  partes={partesDiretor}
                  executar={() => chamarFuncao("estudio-arte", { acao: "preparar", task_id: item.id, modo: "diretor", modelo_imagem_id: modeloImagem || undefined, qualidade })}
                  aoConcluir={() => atualizar()}
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px]">O diretor de arte lê o item, a marca, as referências e a base de design e decide cada lâmina.</p>
              <BotaoComCusto
                rotulo="Preparar direção"
                titulo="Preparar a direção de arte"
                descricao="Uma chamada ao diretor de arte. Nenhuma imagem é gerada ainda."
                partes={partesDiretor}
                executar={() => chamarFuncao("estudio-arte", { acao: "preparar", task_id: item.id, modo: "diretor", modelo_imagem_id: modeloImagem || undefined, qualidade })}
                aoConcluir={() => atualizar()}
              />
            </>
          )}
        </section>
      ) : (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-3.5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Qualidade da lâmina</p>
                <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-secondary/50 p-1">
                  {QUALIDADES_DO_ESTUDIO.map((q) => (
                    <button
                      key={q.valor}
                      type="button"
                      disabled={ocupado}
                      title={q.dica}
                      onClick={() => { setQualidade(q.valor); void guardarEscolha({ qualidade: q.valor }); }}
                      className={`min-w-0 rounded-md px-1.5 py-1.5 text-[12px] transition-colors ${qualidade === q.valor ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {q.rotulo}
                      <span className="block text-[10.5px] text-muted-foreground">{precoPorLamina(q.valor)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0 lg:w-[260px]">
                <SeletorDeModelo
                  catalogo={catalogo}
                  tipo="imagem"
                  valor={modeloImagem}
                  qualidade={qualidade}
                  rotulo="Gerador de imagem"
                  disabled={ocupado}
                  onChange={(id) => { setModeloImagem(id); void guardarEscolha({ modelo_imagem_id: id }); }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
                {gerandoAgora > 0
                  ? `Gerando ${gerandoAgora} lâmina${gerandoAgora === 1 ? "" : "s"} agora. ${ultimas.size} de ${cardsDaDirecao.length} prontas.`
                  : `${ultimas.size} de ${cardsDaDirecao.length} lâmina${cardsDaDirecao.length === 1 ? "" : "s"} com arte.${semImagem.length ? ` Faltam ${semImagem.length}.` : ""}`}
                {infinito ? " Carrossel contínuo: uma lâmina de cada vez." : ""}
              </p>
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

          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[12px] font-medium">Prancheta</p>
              <span className="text-[11px] text-muted-foreground">
                {trabalho.direcao?.origem === "roteiro" ? "direção montada do roteiro" : "direção do diretor de arte"}
                {infinito ? " · contínuo" : ""}
              </span>
              <div className="ml-auto flex w-40 items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Zoom</span>
                <Slider value={[largura]} min={130} max={320} step={10} onValueChange={(v) => setLargura(v[0] || 200)} aria-label="Tamanho das lâminas" />
              </div>
            </div>
            <PranchetaDoEstudio
              cards={cardsDaDirecao}
              ultimas={ultimas}
              selecionado={selecionado}
              onSelecionar={setSelecionado}
              gerando={gerando}
              infinito={infinito}
              largura={largura}
              podeReordenar={!ocupado && cardsDaDirecao.length > 1 && trabalho.status !== "entregue"}
              onReordenar={(ordens) => void reordenar(ordens)}
            />
          </section>

          {cardSelecionado && (
            <CardDoEstudio
              key={cardSelecionado.ordem}
              conversaId={trabalho.conversa_id}
              direcao={cardSelecionado}
              versoes={(trabalho.cards || []).filter((v) => v.ordem === cardSelecionado.ordem)}
              ocupado={ocupado}
              conferindo={conferindoOrdem === cardSelecionado.ordem}
              partesGerar={() => partesGerar(1)}
              partesAjustar={partesAjustar}
              partesConferir={partesConferir}
              onGerar={async () => {
                const custo = await gerarUma(trabalho.id, cardSelecionado.ordem);
                const custoConferencia = await conferirDepois(trabalho.id, cardSelecionado.ordem);
                return { custo_usd: custo + custoConferencia };
              }}
              onAjustar={async (instrucao) => {
                setGerando((g) => ({ ...g, [cardSelecionado.ordem]: Date.now() }));
                try {
                  const a = await chamarFuncao<any>("estudio-arte", { acao: "ajustar_card", trabalho_id: trabalho.id, ordem: cardSelecionado.ordem, instrucao });
                  atualizar();
                  const custoConferencia = await conferirDepois(trabalho.id, cardSelecionado.ordem);
                  return { custo_usd: (custoDaResposta(a) || 0) + custoConferencia };
                } finally {
                  setGerando((g) => {
                    const n = { ...g };
                    delete n[cardSelecionado.ordem];
                    return n;
                  });
                }
              }}
              onConferir={() => conferir(trabalho.id, cardSelecionado.ordem)}
              onConcluido={atualizar}
            />
          )}

          <section className="space-y-2">
            <TituloDeSecao
              acao={
                <BotaoComCusto
                  rotulo="Refazer com o diretor"
                  titulo="Refazer a direção de arte"
                  descricao="O diretor escreve a direção de novo, com a base de design e a marca. As artes já geradas ficam guardadas nas versões."
                  variant="ghost"
                  disabled={ocupado}
                  partes={partesDiretor}
                  executar={() => chamarFuncao("estudio-arte", { acao: "preparar", task_id: item.id, modo: "diretor", modelo_imagem_id: modeloImagem || undefined, qualidade })}
                  aoConcluir={() => atualizar()}
                />
              }
            >
              Conceito
            </TituloDeSecao>
            {trabalho.direcao?.conceito && <p className="whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{trabalho.direcao.conceito}</p>}
          </section>

          <section className="space-y-2 rounded-xl border border-border bg-card p-3.5">
            <TituloDeSecao
              acao={
                <BotaoComCusto
                  rotulo={legenda ? "Reescrever legenda" : "Escrever legenda"}
                  titulo="Escrever a legenda"
                  descricao="A legenda final sai do item da agenda e da arte pronta."
                  variant="ghost"
                  disabled={ocupado}
                  partes={() => [{ modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida }]}
                  executar={() => chamarFuncao("estudio-arte", { acao: "legenda", trabalho_id: trabalho.id })}
                  aoConcluir={(data) => {
                    if (typeof data?.legenda === "string") setLegenda(data.legenda);
                    atualizar();
                  }}
                />
              }
            >
              Legenda
            </TituloDeSecao>
            <Textarea value={legenda} onChange={(e) => setLegenda(e.target.value)} rows={5} placeholder="A legenda do post aparece aqui. Dá para editar à mão." />
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="outline" onClick={() => void salvarLegenda()} disabled={salvandoLegenda || legenda === (trabalho.legenda || "")}>
                {salvandoLegenda && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Salvar legenda
              </Button>
            </div>
          </section>

          {trabalho.entrega_status === "reprovado" && trabalho.status !== "entregue" && (
            <section className="rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-[12.5px]">
              <p className="font-medium">Pediram ajuste nesta arte</p>
              {trabalho.entrega_aviso && <p className="mt-1 [overflow-wrap:anywhere]">“{trabalho.entrega_aviso}”</p>}
              <p className="mt-1 text-muted-foreground">
                Ajuste as lâminas aqui e entregue de novo. A nova entrega vira um arquivo novo em Arquivos e volta para a aprovação pela aba Entrega.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
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

function situacaoDoItem(t: Trabalho | null, temRoteiro: boolean): { rotulo: string; tom: string } {
  if (!t) return temRoteiro ? { rotulo: "roteiro pronto", tom: "text-primary" } : { rotulo: "sem direção", tom: "text-muted-foreground" };
  if (t.status === "entregue") return { rotulo: "entregue", tom: "text-success" };
  const feitas = ultimasVersoes(t.cards).size;
  const total = (t.direcao?.cards || []).length;
  if (!feitas) return { rotulo: "direção pronta, sem arte", tom: "text-primary" };
  if (feitas < total) return { rotulo: `${feitas}/${total} com arte`, tom: "text-warning" };
  return { rotulo: ROTULO_DO_TRABALHO[t.status] || "arte pronta", tom: "text-success" };
}

/** Meses para o seletor da coluna: 6 para trás e 6 para frente do atual. */
function mesesDoSeletor(mesAtual: string): string[] {
  const base = inicioDoMes();
  const lista: string[] = [];
  for (let i = -6; i <= 6; i++) lista.push(somarMeses(base, i));
  if (lista.indexOf(mesAtual) < 0) lista.push(mesAtual);
  return lista.sort();
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
  const dados = useItensDoMes(clientId, mes, tarefaId);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const itens = dados.data?.itens || [];
  const selecionado = itens.find((i) => i.id === tarefaId) || null;
  const meses = useMemo(() => mesesDoSeletor(mes), [mes]);

  const trabalhoDe = (i: ItemDoMes) => dados.data?.trabalhos.get(i.id) || null;
  const temArte = (i: ItemDoMes) => {
    const t = trabalhoDe(i);
    return !!t && ultimasVersoes(t.cards).size > 0;
  };
  const filtrados = itens.filter((i) => {
    if (filtro === "sem_arte") return !temArte(i);
    if (filtro === "com_arte") return temArte(i) && trabalhoDe(i)?.status !== "entregue";
    if (filtro === "entregues") return trabalhoDe(i)?.status === "entregue";
    return true;
  });
  const contagem = {
    todos: itens.length,
    sem_arte: itens.filter((i) => !temArte(i)).length,
    com_arte: itens.filter((i) => temArte(i) && trabalhoDe(i)?.status !== "entregue").length,
    entregues: itens.filter((i) => trabalhoDe(i)?.status === "entregue").length,
  };
  const FILTROS: { valor: Filtro; rotulo: string }[] = [
    { valor: "todos", rotulo: "Todos" },
    { valor: "sem_arte", rotulo: "Sem arte" },
    { valor: "com_arte", rotulo: "Com arte" },
    { valor: "entregues", rotulo: "Entregues" },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
      <aside className={`min-w-0 space-y-3 ${selecionado ? "hidden lg:block" : ""}`}>
        <Select value={mes} onValueChange={onMes}>
          <SelectTrigger className="h-9 w-full text-[13px] capitalize" aria-label="Mês">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {meses.map((m) => (
              <SelectItem key={m} value={m} className="capitalize">{rotuloDoMes(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setFiltro(f.valor)}
              className={`mb-1 mr-1 rounded-full border px-2.5 py-1 text-[11.5px] ${filtro === f.valor ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {f.rotulo} <span className="opacity-70">{contagem[f.valor]}</span>
            </button>
          ))}
        </div>
        {dados.isLoading && <p className="text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo a agenda…</p>}
        {dados.isError && <p className="rounded-lg bg-destructive/10 p-3 text-[12.5px]">{textoDoErro(dados.error)}</p>}
        {dados.data && itens.length === 0 && (
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Nenhum carrossel ou post estático na agenda deste mês. Complete a agenda pela aba Mês ou crie o item no Calendário.
          </p>
        )}
        <ul className="space-y-1.5 lg:max-h-[calc(100vh-300px)] lg:overflow-y-auto lg:pr-1">
          {filtrados.map((i) => {
            const t = trabalhoDe(i);
            const capa = t ? ultimasVersoes(t.cards).get(1) || null : null;
            const situacao = situacaoDoItem(t, !!dados.data?.roteiros.has(i.id));
            const ativo = i.id === tarefaId;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => onTarefa(i.id)}
                  className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    ativo ? "border-primary/50 bg-primary/[0.06]" : "border-border bg-card hover:border-primary/30"
                  }`}
                >
                  {capa ? (
                    <ImagemDaMesa caminho={capa.storage_path} alt={i.title} className="h-12 w-[38px] shrink-0 rounded" />
                  ) : (
                    <span className="flex h-12 w-[38px] shrink-0 items-center justify-center rounded border border-dashed border-border text-muted-foreground">
                      <ImageOff className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">{i.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {dataCurta(i.due_date)} · {TASK_DELIVERY_TYPE_LABELS[i.delivery_type as TaskDeliveryType] || i.delivery_type}
                    </span>
                    <span className={`block text-[11px] ${situacao.tom}`}>{situacao.rotulo}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
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
          <div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
            Escolha um item da agenda para abrir o estúdio.
          </div>
        )}
      </div>
    </div>
  );
}
