import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, FolderCheck, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TASK_DELIVERY_TYPE_LABELS, type TaskDeliveryType } from "@/lib/taskDeliveryTypes";
import {
  chamarFuncao,
  custoDaResposta,
  dataCurta,
  ErroDaMesa,
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
import { useMesa } from "./MesaContexto";
import { SeletorDeModelo, SeletorDeQualidade, TituloDeSecao } from "./Seletores";
import { ROTULO_DO_TRABALHO, ultimasVersoes, useItensDoMes, type ItemDoMes, type Trabalho } from "./useItensDoMes";

/**
 * Aba Estúdio (SPEC seção 5): abre um item da agenda, o diretor de arte
 * escreve a direção de cada card e o gerador faz a lâmina inteira, texto
 * incluído. Esta tela nunca desenha texto por cima da imagem: ela só mostra
 * o que o gerador devolveu e, ao lado, o texto exato para conferência.
 *
 * Ordem de cada card: gerar_card (volta com verificacao.pendente) e, logo
 * depois, conferir_card. "Gerar todos" repete isso card a card, um de cada
 * vez, esperando cada chamada terminar antes da próxima. Nunca em paralelo.
 */

const CODIGOS_QUE_NAO_PARAM_A_FILA = ["acao_desconhecida", "servico_indisponivel"];

function DetalheDoItem({ item, trabalho, onVoltar }: { item: ItemDoMes; trabalho: Trabalho | null; onVoltar: () => void }) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const avisarErro = useAvisarErro();
  const [modeloImagem, setModeloImagem] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [legenda, setLegenda] = useState("");
  const [salvandoLegenda, setSalvandoLegenda] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [fila, setFila] = useState<{ atual: number; total: number; ordem: number; fase: "gerando" | "conferindo" } | null>(null);
  const [conferindoOrdem, setConferindoOrdem] = useState<number | null>(null);
  const parar = useRef(false);

  useEffect(() => {
    setModeloImagem(trabalho?.modelo_imagem_id || padraoPara(catalogo, "imagem")?.id || "");
    setQualidade(((trabalho?.qualidade as Qualidade) || "alta"));
    setLegenda(trabalho?.legenda || "");
  }, [trabalho?.id, catalogo.length]);

  useEffect(() => { setLegenda(trabalho?.legenda || ""); }, [trabalho?.legenda]);

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "ajustes"] });
  };

  const diretor = padraoPara(catalogo, "diretor_arte");
  const leitor = padraoPara(catalogo, "leitura");

  // A escolha do modelo e da qualidade fica no trabalho deste cliente.
  const guardarEscolha = async (campos: { modelo_imagem_id?: string; qualidade?: string }) => {
    if (!trabalho) return;
    const { error } = await (supabase as any).from("estudio_trabalhos").update(campos).eq("id", trabalho.id);
    if (error) toast.error("Escolha não salva", { description: textoDoErro(error) });
    else atualizar();
  };

  const partesConferir = (): ParteDaEstimativa[] => [
    { modeloId: leitor?.id, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida },
  ];
  const partesGerar = (vezes = 1): ParteDaEstimativa[] => [
    { modeloId: modeloImagem, tipo: "imagem", imagens: 1, qualidade, vezes },
    { modeloId: leitor?.id, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida, vezes },
  ];
  const partesAjustar = (): ParteDaEstimativa[] => [
    { modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.ajuste.entrada, tokensSaida: TAMANHOS.ajuste.saida },
    ...partesGerar(1),
  ];

  /** Conferência de um card: ortografia pela leitura e identidade pelo Jev. */
  const conferir = async (trabalhoId: string, ordem: number) => {
    setConferindoOrdem(ordem);
    try {
      return await chamarFuncao<any>("estudio-arte", { acao: "conferir_card", trabalho_id: trabalhoId, ordem });
    } finally {
      setConferindoOrdem(null);
      atualizar();
    }
  };

  /**
   * Conferência logo depois de gerar ou ajustar. A conferência que ainda não
   * está no ar não derruba a geração: a versão fica "sem conferência" e dá
   * para conferir depois pelo botão do card.
   */
  const conferirDepois = async (trabalhoId: string, ordem: number): Promise<number> => {
    try {
      const c = await conferir(trabalhoId, ordem);
      return custoDaResposta(c) || 0;
    } catch (e) {
      if (e instanceof ErroDaMesa && CODIGOS_QUE_NAO_PARAM_A_FILA.indexOf(e.codigo) >= 0) return 0;
      throw e;
    }
  };

  /** Gera um card e, só quando a geração volta, confere esse mesmo card. */
  const gerarEConferir = async (trabalhoId: string, ordem: number, aoConferir?: () => void) => {
    const g = await chamarFuncao<any>("estudio-arte", {
      acao: "gerar_card",
      trabalho_id: trabalhoId,
      ordem,
      modelo_imagem_id: modeloImagem || undefined,
      qualidade,
    });
    atualizar();
    aoConferir?.();
    const custoConferencia = await conferirDepois(trabalhoId, ordem);
    return { custo_usd: (custoDaResposta(g) || 0) + custoConferencia };
  };

  const cardsDaDirecao = (trabalho?.direcao?.cards || []).slice().sort((a, b) => a.ordem - b.ordem);
  const ultimas = ultimasVersoes(trabalho?.cards || []);
  const semImagem = cardsDaDirecao.filter((c) => !ultimas.has(c.ordem));
  const filaDeGeracao = semImagem.length ? semImagem : cardsDaDirecao;
  const todosComImagem = cardsDaDirecao.length > 0 && semImagem.length === 0;
  const ocupado = fila !== null || entregando;

  /**
   * Gerar todos: um card por vez, na ordem. Cada volta do laço espera a
   * geração e a conferência terminarem antes de ir para o próximo card.
   */
  const gerarTodos = async () => {
    if (!trabalho) return { custo_usd: 0 };
    parar.current = false;
    const ordens = filaDeGeracao.map((c) => c.ordem);
    let total = 0;
    try {
      for (let i = 0; i < ordens.length; i++) {
        if (parar.current) break;
        const ordem = ordens[i];
        setFila({ atual: i + 1, total: ordens.length, ordem, fase: "gerando" });
        const r = await gerarEConferir(trabalho.id, ordem, () =>
          setFila({ atual: i + 1, total: ordens.length, ordem, fase: "conferindo" }),
        );
        total += r.custo_usd;
      }
    } finally {
      setFila(null);
      atualizar();
    }
    return { custo_usd: total, parado: parar.current };
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
      description: `Cria ${cardsDaDirecao.length > 1 ? "o carrossel" : "o post"} em Arquivos, ligado a este item da agenda, com a versão mais recente de cada card e a legenda.`,
      confirmLabel: "Entregar",
    });
    if (!ok) return;
    setEntregando(true);
    try {
      await chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: trabalho.id });
      toast.success("Entregue em Arquivos");
      atualizar();
    } catch (e) {
      avisarErro(e, "Não foi possível entregar");
    } finally {
      setEntregando(false);
    }
  };

  const formato = TASK_DELIVERY_TYPE_LABELS[item.delivery_type as TaskDeliveryType] || item.delivery_type;

  return (
    <div className="min-w-0 space-y-5">
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

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-3.5 sm:grid-cols-2">
        <SeletorDeModelo
          catalogo={catalogo}
          tipo="imagem"
          valor={modeloImagem}
          qualidade={qualidade}
          rotulo="Gerador de imagem"
          disabled={ocupado}
          onChange={(id) => { setModeloImagem(id); void guardarEscolha({ modelo_imagem_id: id }); }}
        />
        <SeletorDeQualidade valor={qualidade} disabled={ocupado} onChange={(q) => { setQualidade(q); void guardarEscolha({ qualidade: q }); }} />
      </section>

      {!trabalho || cardsDaDirecao.length === 0 ? (
        <section className="space-y-3 rounded-xl border border-dashed border-border p-5 text-center">
          <p className="text-[13px]">O diretor de arte lê o roteiro do item, o kit, as fontes, as referências e as artes anteriores, e escreve a direção de cada card.</p>
          <BotaoComCusto
            rotulo="Preparar direção"
            titulo="Preparar a direção de arte"
            descricao="Uma chamada ao diretor de arte. Nenhuma imagem é gerada ainda."
            partes={() => [{ modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada, tokensSaida: TAMANHOS.preparar.saida }]}
            executar={() => chamarFuncao("estudio-arte", { acao: "preparar", task_id: item.id, modelo_imagem_id: modeloImagem || undefined, qualidade })}
            aoConcluir={() => atualizar()}
          />
        </section>
      ) : (
        <>
          <section className="space-y-2">
            <TituloDeSecao
              acao={
                <BotaoComCusto
                  rotulo="Refazer direção"
                  titulo="Refazer a direção de arte"
                  descricao="O diretor escreve a direção de novo. As imagens já geradas continuam guardadas nas versões."
                  variant="ghost"
                  disabled={ocupado}
                  partes={() => [{ modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada, tokensSaida: TAMANHOS.preparar.saida }]}
                  executar={() => chamarFuncao("estudio-arte", { acao: "preparar", task_id: item.id, modelo_imagem_id: modeloImagem || undefined, qualidade })}
                  aoConcluir={() => atualizar()}
                />
              }
            >
              Direção
            </TituloDeSecao>
            {trabalho.direcao?.conceito && <p className="whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{trabalho.direcao.conceito}</p>}
            {trabalho.direcao?.carrossel_infinito && <p className="text-[11.5px] text-primary">Carrossel infinito: cada card continua no seguinte.</p>}
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 text-[12.5px]">
              {fila ? (
                <>
                  <p className="font-medium">
                    <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
                    {fila.fase === "gerando" ? "Gerando" : "Conferindo"} o card {fila.ordem} ({fila.atual} de {fila.total})
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(((fila.atual - (fila.fase === "gerando" ? 1 : 0.5)) / fila.total) * 100)}%` }} />
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {ultimas.size} de {cardsDaDirecao.length} card(s) com imagem.
                  {semImagem.length > 0 ? ` Faltam ${semImagem.length}.` : " Todos gerados."}
                </p>
              )}
            </div>
            {fila ? (
              <Button type="button" size="sm" variant="outline" onClick={() => { parar.current = true; }}>
                <Square className="mr-1.5 h-3.5 w-3.5" /> Parar depois deste card
              </Button>
            ) : (
              <BotaoComCusto
                rotulo={semImagem.length ? `Gerar todos (${semImagem.length})` : `Gerar todos de novo (${cardsDaDirecao.length})`}
                titulo={`Gerar ${filaDeGeracao.length} card(s)`}
                descricao="Um card por vez, na ordem: gera, confere e só então passa ao próximo. Dá para parar entre um card e outro."
                fecharAoConfirmar
                disabled={ocupado}
                partes={() => partesGerar(filaDeGeracao.length)}
                executar={gerarTodos}
                aoConcluir={(data) => {
                  toast.success(data?.parado ? "Geração parada" : "Cards gerados", { description: `Custo real: ${usd(custoDaResposta(data) || 0)}.` });
                }}
              />
            )}
          </section>

          <section className="space-y-3">
            {cardsDaDirecao.map((c) => (
              <CardDoEstudio
                key={c.ordem}
                conversaId={trabalho.conversa_id}
                direcao={c}
                versoes={(trabalho.cards || []).filter((v) => v.ordem === c.ordem)}
                ocupado={ocupado}
                conferindo={conferindoOrdem === c.ordem}
                partesGerar={() => partesGerar(1)}
                partesAjustar={partesAjustar}
                partesConferir={partesConferir}
                onGerar={() => gerarEConferir(trabalho.id, c.ordem)}
                onAjustar={async (instrucao) => {
                  const a = await chamarFuncao<any>("estudio-arte", { acao: "ajustar_card", trabalho_id: trabalho.id, ordem: c.ordem, instrucao });
                  atualizar();
                  const custoConferencia = await conferirDepois(trabalho.id, c.ordem);
                  return { custo_usd: (custoDaResposta(a) || 0) + custoConferencia };
                }}
                onConferir={() => conferir(trabalho.id, c.ordem)}
                onConcluido={atualizar}
              />
            ))}
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
            <Textarea value={legenda} onChange={(e) => setLegenda(e.target.value)} rows={6} placeholder="A legenda do post aparece aqui. Dá para editar à mão." />
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="outline" onClick={() => void salvarLegenda()} disabled={salvandoLegenda || legenda === (trabalho.legenda || "")}>
                {salvandoLegenda && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Salvar legenda
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
              {trabalho.status === "entregue"
                ? "Entregue em Arquivos. Uma nova entrega cria outra versão lá."
                : todosComImagem
                  ? "Tudo pronto para ir para Arquivos, ligado a este item da agenda."
                  : "Gere todos os cards para entregar."}
              {trabalho.status === "entregue" && (
                <>
                  {" "}
                  <Link to={`/arquivos?client=${clientId}`} className="text-primary underline-offset-2 hover:underline">Abrir Arquivos</Link>
                </>
              )}
            </p>
            <Button type="button" onClick={() => void entregar()} disabled={!todosComImagem || ocupado}>
              {entregando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FolderCheck className="mr-1.5 h-4 w-4" />}
              Entregar para Arquivos
            </Button>
          </section>
        </>
      )}
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
  const dados = useItensDoMes(clientId, mes, tarefaId);
  const itens = dados.data?.itens || [];
  const selecionado = itens.find((i) => i.id === tarefaId) || null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className={`min-w-0 space-y-3 ${selecionado ? "hidden lg:block" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onMes(somarMeses(mes, -1))} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="text-[13px] font-medium capitalize">{rotuloDoMes(mes)}</p>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onMes(somarMeses(mes, 1))} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {dados.isLoading && <p className="text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo a agenda…</p>}
        {dados.isError && <p className="rounded-lg bg-destructive/10 p-3 text-[12.5px]">{textoDoErro(dados.error)}</p>}
        {dados.data && itens.length === 0 && (
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Nenhum carrossel ou post estático na agenda deste mês. Grave a proposta na aba Mês ou crie o item no Calendário.
          </p>
        )}
        <ul className="space-y-1.5">
          {itens.map((i) => {
            const t = dados.data?.trabalhos.get(i.id);
            const ativo = i.id === tarefaId;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => onTarefa(i.id)}
                  className={`flex w-full min-w-0 items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    ativo ? "border-primary/50 bg-primary/[0.06]" : "border-border bg-card hover:border-primary/30"
                  }`}
                >
                  <span className="w-12 shrink-0 text-[11px] text-muted-foreground">{dataCurta(i.due_date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">{i.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {TASK_DELIVERY_TYPE_LABELS[i.delivery_type as TaskDeliveryType] || i.delivery_type} · {t ? ROTULO_DO_TRABALHO[t.status] || t.status : "sem arte"}
                    </span>
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
            trabalho={dados.data?.trabalhos.get(selecionado.id) || null}
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
