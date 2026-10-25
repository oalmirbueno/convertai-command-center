import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, History, Lightbulb, Loader2, Sparkles, Star, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { padraoPara, parteDaConferenciaDoJev, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { useModeloDoEscopo } from "./ModeloDaCopyDoConteudo";
import type { Campanha, ItemProposto } from "./mesaV4Api";
import { SeloDoStatus } from "@/components/mesa-roteiros/Comuns";
import AgenteDoRoteiroDaPeca from "@/components/mesa-roteiros/AgenteDoRoteiroDaPeca";
import { atualizarNoCache, estimarDaPeca, gerarRoteiroDaPeca, importarRoteiroDaPeca, restaurarVersao, type PedidoDeGeracao, type RespostaDaPeca } from "@/components/mesa-roteiros/roteirosApi";
import { modoDoTipo, motivoParaNaoEditar, type Roteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import {
  CONFERENCIAS_DO_JEV_DA_PECA,
  CRIATIVIDADES_DO_ROTEIRO,
  DURACOES_DA_PECA,
  ESTILOS_DO_ROTEIRO,
  rotuloDaDuracao,
  tamanhoDasDuasVersoes,
  type CriatividadeDoRoteiro,
  type EstiloDoRoteiro,
} from "../../../supabase/functions/mesa-roteiros/modulos/roteiro-da-peca";
import { corpoDoRoteiroDaPeca, escolhaDaVersao, type DirecaoDoCriar, type EstadoDoRoteiroDaPeca } from "./roteiroDaPeca";

/**
 * O roteiro da peça de vídeo com o agente ao lado, um só (agente unificado, 23/10/2026; dono: "pode juntar os
 * dois em um só ... um único agente de roteiro, agêntico e inteligente, onde eu converso, peço ideias, e o
 * agente altera o roteiro de verdade conforme pedido; escolha de modelo; Gerar ou Gravar").
 *
 * - Esquerda, sempre à vista: o roteiro da peça (tabela roteiros, mesa-roteiros), a escolha do Jev entre as duas
 *   versões com "Usar a outra", as versões guardadas (ver e usar qualquer uma, sem custo) e o texto do roteiro.
 *   Peça que só tinha roteiro no item aparece igual (migração na leitura) e entra na tabela na primeira ação.
 * - Direita: o agente. Sem roteiro (ou em Novo roteiro): a ideia, a duração (até 5 min), o estilo e a
 *   criatividade; "Criar roteiro" (custo antes) escreve duas versões completas com os ganchos virais do nicho
 *   e o Jev escolhe (peca_gerar). Com roteiro: a conversa que muda o roteiro com Confirmar e Desfazer.
 * Os caminhos Gravar e Gerar (CampanhaVideos) usam este mesmo roteiro. A peça de vídeo do Mês (GravarDaPauta)
 * usa o mesmo componente sem campanha: o roteiro é o da tarefa e o corpo do criar vem de montarCorpo.
 */

/** O corpo do peca_gerar fora da campanha (a peça do Mês): a tela diz a tarefa, o tema e o pedido. */
export type MontarCorpoDoCriar = (p: { direcao: DirecaoDoCriar; modeloId: string; roteiroId: string | null }) => PedidoDeGeracao;

export interface PropsDoRoteiroDaPeca {
  /** A campanha da peça; null na peça do Mês (aí montarCorpo é obrigatório). */
  campanha: Campanha | null;
  propostaId?: string;
  item: ItemProposto;
  estado: EstadoDoRoteiroDaPeca;
  montarCorpo?: MontarCorpoDoCriar;
  /**
   * 24/10/2026 (print do dono: roteiro espremido numa coluna de 1 letra no painel lateral "Gravar com roteiro"):
   * painel estreito. Uma coluna só: o roteiro (falas, o completo fica no miolo da peça) e o agente embaixo,
   * recolhível, sem rolagem própria. Sem este campo, roteiro e agente lado a lado em tela larga.
   */
  empilhado?: boolean;
}

function Opcao({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={juntar(botao.barra, "border", ativo ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border")}
    >
      {children}
    </button>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  if (!valor) return null;
  return (
    <p className={juntar(texto.corpo, "min-w-0 whitespace-pre-line [overflow-wrap:anywhere]")}>
      <span className={texto.rotulo}>{rotulo}: </span>
      {valor}
    </p>
  );
}

/** O texto do roteiro: ganchos, blocos (fala, visual, texto na tela e B-roll), CTA, legenda e hashtags. */
export function TextoDoRoteiro({ roteiro: r, compacto }: { roteiro: Roteiro; compacto?: boolean }) {
  return (
    <div className="min-w-0 space-y-3" data-texto-do-roteiro="">
      {r.subtitulo && !compacto && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>{r.subtitulo}</p>}
      {r.ganchos.length > 0 && (
        <section className="min-w-0" aria-label="Ganchos">
          <h5 className={juntar(texto.rotulo, "mb-1 truncate")}>Ganchos</h5>
          <ol className="min-w-0 space-y-1">
            {r.ganchos.map((g, i) => (
              <li key={i} className={juntar(texto.corpo, "min-w-0 [overflow-wrap:anywhere]")} data-gancho-escolhido={i === r.gancho_escolhido ? "" : undefined}>
                <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                {g.texto}
                {i === r.gancho_escolhido && <span className={juntar(texto.etiqueta, "ml-2 text-primary")}>escolhido</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="min-w-0" aria-label="Blocos do roteiro">
        <h5 className={juntar(texto.rotulo, "mb-1 truncate")}>Roteiro</h5>
        <ol className="min-w-0">
          {r.blocos.map((b, i) => (
            <li key={b.id || i} className="min-w-0 space-y-0.5 border-t border-border py-2 first:border-t-0 first:pt-0" data-bloco={i + 1}>
              <p className={juntar(texto.etiqueta, "truncate text-muted-foreground")}>
                {i + 1}. {b.funcao || "Bloco"} · {b.segundos} s
              </p>
              <Campo rotulo="Fala" valor={b.fala} />
              {!compacto && <Campo rotulo="Visual" valor={b.visual} />}
              {!compacto && <Campo rotulo="Texto na tela" valor={b.texto_na_tela} />}
              {!compacto && <Campo rotulo="B-roll" valor={b.broll} />}
            </li>
          ))}
        </ol>
      </section>
      {!compacto && (r.cta || r.legenda || r.hashtags.length > 0) && (
        <section className="min-w-0 space-y-0.5" aria-label="CTA e legenda">
          <Campo rotulo="CTA" valor={r.cta} />
          <Campo rotulo="Legenda" valor={r.legenda} />
          <Campo rotulo="Hashtags" valor={r.hashtags.join(" ")} />
        </section>
      )}
    </div>
  );
}

/** O criar: a ideia, a duração, o estilo e a criatividade; duas versões e o Jev escolhe. */
function CriarRoteiro({ campanha, item, estado, roteiroId, montarCorpo, aoCancelar, aoCriar }: { campanha: Campanha | null; item: ItemProposto; estado: EstadoDoRoteiroDaPeca; roteiroId: string | null; montarCorpo?: MontarCorpoDoCriar; aoCancelar?: () => void; aoCriar: () => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const modelo = useModeloDoEscopo("roteiro");
  const inicial = estado.roteiro ? Math.max(15, Math.min(300, estado.roteiro.duracao_alvo_s)) : 30;
  const maisPerto = DURACOES_DA_PECA.reduce((m, d) => (Math.abs(d.segundos - inicial) < Math.abs(m - inicial) ? d.segundos : m), DURACOES_DA_PECA[1].segundos);
  const [d, setD] = useState<DirecaoDoCriar>({ ideia: "", duracao: maisPerto, estilo: "viral", criatividade: "ultra" });
  const mudar = (m: Partial<DirecaoDoCriar>) => setD((x) => ({ ...x, ...m }));
  const tema = item.tema || "o vídeo";
  // O preço das duas versões com o modelo do roteiro e a duração escolhida, antes de criar.
  const estimativa = useQuery({
    queryKey: ["mesa-roteiros", "estimar", "peca", mesa.clientId, modelo.modeloId, d.duracao],
    enabled: !!mesa.clientId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => estimarDaPeca(mesa.clientId, "peca", modelo.modeloId || null, d.duracao),
  });
  const padrao = padraoPara(mesa.catalogo, "estrategista");
  const modeloId = estimativa.data && estimativa.data.modelo_id ? estimativa.data.modelo_id : modelo.modeloId || (padrao ? padrao.id : "");
  const partes = (): ParteDaEstimativa[] => {
    const jev = Array.from({ length: CONFERENCIAS_DO_JEV_DA_PECA }, () => parteDaConferenciaDoJev());
    if (estimativa.data && typeof estimativa.data.estimativa_usd === "number") return [{ modeloId, tipo: "texto", fixoUsd: estimativa.data.estimativa_usd } as ParteDaEstimativa].concat(jev);
    // O motor não respondeu a estimativa: a mesma conta do servidor, pelo catálogo.
    const t = tamanhoDasDuasVersoes(d.duracao);
    return modeloId ? [{ modeloId, tipo: "texto", tokensEntrada: t.entrada, tokensSaida: t.saida } as ParteDaEstimativa].concat(jev) : [];
  };
  const aoGerar = (data: RespostaDaPeca) => {
    if (data && data.roteiro) {
      atualizarNoCache(qc, mesa.clientId, data.roteiro);
      aoCriar();
    } else if (data && data.versao) {
      toast.warning("Roteiro gerado sem guardar", { description: data.aviso_banco || "O banco ainda não guarda roteiros." });
    }
  };
  return (
    <div className="min-w-0 space-y-2" data-criar-roteiro-da-peca="">
      <Textarea
        value={d.ideia}
        onChange={(e) => mudar({ ideia: e.target.value })}
        rows={3}
        placeholder="Sua ideia, do jeito que vier. Ex.: o técnico abre um PC que parece novo e acha uma floresta de poeira"
        className="text-[13px]"
        aria-label={`Ideia do roteiro de ${tema}`}
      />
      <div className="min-w-0">
        <span className={texto.rotulo}>Duração</span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Duração do vídeo">
          {DURACOES_DA_PECA.map((x) => (
            <Opcao key={x.segundos} ativo={d.duracao === x.segundos} onClick={() => mudar({ duracao: x.segundos })}>{x.rotulo}</Opcao>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <span className={texto.rotulo}>Estilo</span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Estilo do roteiro">
          {ESTILOS_DO_ROTEIRO.map((e) => (
            <Opcao key={e.id} ativo={d.estilo === e.id} onClick={() => mudar({ estilo: e.id as EstiloDoRoteiro })}>{e.rotulo}</Opcao>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <span className={texto.rotulo}>Criatividade</span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Criatividade do agente">
          {CRIATIVIDADES_DO_ROTEIRO.map((c) => (
            <Opcao key={c.id} ativo={d.criatividade === c.id} onClick={() => mudar({ criatividade: c.id as CriatividadeDoRoteiro })}>
              {c.id === "ultra" && <Lightbulb className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
              {c.rotulo}
            </Opcao>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {aoCancelar && (
          <button type="button" className="text-[12px] text-muted-foreground hover:underline" onClick={aoCancelar}>
            Cancelar
          </button>
        )}
        <BotaoComCusto
          rotulo={
            <>
              <Wand2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Criar roteiro
            </>
          }
          titulo="Agente de roteiro"
          descricao={`Duas versões completas de ${rotuloDaDuracao(d.duracao)} com os ganchos virais do nicho e a campanha; o Jev escolhe a mais forte e a outra fica nas versões`}
          partes={partes}
          disabled={estimativa.isLoading || !modeloId || (!campanha && !montarCorpo)}
          executar={() => gerarRoteiroDaPeca(campanha ? corpoDoRoteiroDaPeca({ clientId: mesa.clientId, campanha, item, modeloId, roteiroId, direcao: d }) : (montarCorpo as MontarCorpoDoCriar)({ direcao: d, modeloId, roteiroId }))}
          aoConcluir={aoGerar}
          className="h-8 px-3"
        />
      </div>
    </div>
  );
}

export default function RoteiroDaPecaDeVideo({ campanha, item, estado, montarCorpo, empilhado = false }: PropsDoRoteiroDaPeca) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const { linha, versao, roteiro, antigas } = estado;
  const temaId = item.tema_id || "";
  const tema = item.tema || "o vídeo";
  const [novo, setNovo] = useState(false);
  const [verVersoes, setVerVersoes] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);
  const [usando, setUsando] = useState<number | null>(null);
  const [recolhido, setRecolhido] = useRecolhido(`campanha-roteiro:${clientId}:${temaId || tema}`, false);
  const [agenteRecolhido, setAgenteRecolhido] = useRecolhido(`roteiro-agente:${clientId}:${item.task_id || temaId || tema}`, false);
  const travado = linha ? motivoParaNaoEditar(linha.status, !!linha.arquivado_em) : null;
  const escolha = escolhaDaVersao(linha);
  const doItem = !linha && antigas.length > 0;
  const criando = !roteiro || novo;

  // O roteiro antigo do item entra na tabela (sem IA) na primeira ação: conversar ou usar uma versão dele.
  const garantirRoteiro = async (usar: number | null = null): Promise<string> => {
    if (linha && usar == null) return linha.id;
    if (!campanha) throw new Error("Esta peça ainda não tem roteiro. Crie com o agente.");
    const r = await importarRoteiroDaPeca({ client_id: clientId, campanha_id: campanha.id, tema_id: temaId, usar });
    if (!r.roteiro) throw new Error("Esta peça ainda não tem roteiro. Crie com o agente.");
    atualizarNoCache(qc, clientId, r.roteiro);
    return r.roteiro.id;
  };

  const usarVersao = async (numero: number) => {
    if (!linha) return;
    setUsando(numero);
    try {
      const r = await restaurarVersao(linha.id, numero);
      atualizarNoCache(qc, clientId, r.roteiro);
      toast.success(`Versão ${numero} em uso`, { description: "Ficou como a versão atual; a anterior continua nas versões." });
    } catch (e) {
      toast.error("Versão não trocada", { description: textoDoErro(e) });
    } finally {
      setUsando(null);
    }
  };

  const usarDoItem = async (opcao: number) => {
    setUsando(opcao + 1);
    try {
      await garantirRoteiro(opcao);
      toast.success("Roteiro escolhido", { description: "Ficou como a versão atual da peça." });
    } catch (e) {
      toast.error("Roteiro não escolhido", { description: textoDoErro(e) });
    } finally {
      setUsando(null);
    }
  };

  // As versões guardadas: as da tabela (mais nova primeiro) ou as do item.
  type Linha = { chave: number; numero: number | null; nota: string; conteudo: Roteiro; atual: boolean; jev: boolean; usar: (() => void) | null };
  const listaDeVersoes: Linha[] = linha
    ? linha.versoes.slice().reverse().map((v) => ({
      chave: v.numero,
      numero: v.numero,
      nota: v.nota || (v.origem === "agente" ? "Pedido ao agente" : "Versão"),
      conteudo: v.conteudo,
      atual: v.numero === linha.versao_atual,
      jev: (v.nota || "").indexOf("Escolhida pelo Jev.") === 0 || (v.nota || "").indexOf("recomendada pelo Jev") >= 0,
      usar: v.numero === linha.versao_atual || travado ? null : () => void usarVersao(v.numero),
    }))
    : antigas.slice().reverse().map((v, k) => ({
      chave: 1000 + k,
      numero: v.opcao == null ? null : v.opcao + 1,
      nota: v.nota,
      conteudo: v.conteudo,
      atual: k === 0,
      jev: v.recomendada,
      usar: k === 0 || v.opcao == null ? null : () => void usarDoItem(v.opcao as number),
    }));

  const resumo = roteiro ? `${modoDoTipo(roteiro.tipo).rotulo} · ${rotuloDaDuracao(roteiro.duracao_alvo_s)} · ${roteiro.blocos.length} blocos${versao ? ` · v${versao.numero}` : ""}` : null;

  return (
    <div
      className={juntar("mt-2 min-w-0", empilhado ? "flex flex-col gap-5" : "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]")}
      data-roteiro-da-peca={temaId}
      data-fonte-do-roteiro={linha ? "tabela" : doItem ? "item" : "nenhum"}
      data-disposicao={empilhado ? "empilhado" : "lado-a-lado"}
    >
      <section className="w-full min-w-0" aria-label={`Roteiro de ${tema}`} data-bloco-do-roteiro="">
        {roteiro ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <TituloRecolhivel titulo="Roteiro" recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={resumo} className="mr-auto min-w-0 flex-1" />
              {linha && <span className="shrink-0"><SeloDoStatus status={linha.status} /></span>}
              {listaDeVersoes.length > 1 && (
                <button
                  type="button"
                  className={juntar(botao.icone, verVersoes ? "text-primary hover:text-primary" : "")}
                  onClick={() => setVerVersoes(!verVersoes)}
                  aria-expanded={verVersoes}
                  aria-label={`Versões do roteiro de ${tema} (${listaDeVersoes.length})`}
                  title={`Versões (${listaDeVersoes.length}): ver e usar qualquer uma, sem custo`}
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
            {escolha && (
              <p className={juntar(texto.auxiliar, "mt-1 flex min-w-0 items-start [overflow-wrap:anywhere]")} data-escolha-do-jev="">
                <Sparkles className="mr-1.5 mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  Jev: {escolha.porque}
                  {escolha.outra ? ` A outra é a v${escolha.outra}.` : ""}
                  {escolha.outra && !travado && (
                    <button type="button" className="ml-1 underline underline-offset-2 hover:text-foreground" onClick={() => void usarVersao(escolha.outra as number)} disabled={usando !== null}>
                      Usar a outra
                    </button>
                  )}
                </span>
              </p>
            )}
            {doItem && <p className={juntar(texto.auxiliar, "mt-1")} data-roteiro-do-item="">Roteiro guardado na peça: entra nas versões na primeira mudança.</p>}
            {travado && <p className={juntar(texto.auxiliar, "mt-1")}>{travado}</p>}
            {verVersoes && (
              <ol className="mt-2 min-w-0" aria-label={`Versões do roteiro de ${tema}`} data-versoes-do-roteiro={listaDeVersoes.length}>
                {listaDeVersoes.map((v) => (
                  <li key={v.chave} className="min-w-0 border-t border-border py-2 first:border-t-0" data-versao={v.numero == null ? "item" : v.numero} data-atual={v.atual ? "sim" : "nao"}>
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1 text-[12px] font-medium">
                          {linha && <span className="shrink-0">v{v.numero}</span>}
                          <span className="truncate">{v.conteudo.ganchos[v.conteudo.gancho_escolhido] ? v.conteudo.ganchos[v.conteudo.gancho_escolhido].texto : v.conteudo.titulo}</span>
                          {v.jev && <Star className="h-3 w-3 shrink-0 text-primary" aria-label="Recomendada pelo Jev" />}
                          {v.atual && <span className={juntar(texto.etiqueta, "shrink-0 text-primary")}>atual</span>}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground" title={v.nota}>
                          {rotuloDaDuracao(v.conteudo.duracao_alvo_s)} · {v.conteudo.blocos.length} blocos · {v.nota}
                        </span>
                      </span>
                      <button type="button" className={botao.icone} onClick={() => setAberta(aberta === v.chave ? null : v.chave)} aria-expanded={aberta === v.chave} aria-label={`${aberta === v.chave ? "Fechar" : "Ver"} a versão ${v.numero == null ? "da peça" : v.numero}`} title="Ver o roteiro desta versão">
                        {aberta === v.chave ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                      </button>
                      {v.usar && (
                        <button type="button" className={juntar(botao.secundario, "h-8 shrink-0 px-3 text-[12px]")} onClick={v.usar} disabled={usando !== null} aria-label={`Usar a versão ${v.numero}`}>
                          {usando === v.numero ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : "Usar esta"}
                        </button>
                      )}
                    </div>
                    {aberta === v.chave && (
                      <div className="mt-2 min-w-0">
                        <TextoDoRoteiro roteiro={v.conteudo} compacto />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {!recolhido && (
              <div className="mt-2 min-w-0">
                <TextoDoRoteiro roteiro={roteiro} compacto={empilhado} />
              </div>
            )}
          </>
        ) : (
          <>
            <h4 className={juntar(texto.rotulo, "truncate")}>Roteiro</h4>
            {estado.carregando ? (
              <p className={juntar(texto.auxiliar, "mt-1")}>
                <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Lendo o roteiro…
              </p>
            ) : (
              <p className={juntar(texto.auxiliar, "mt-1")}>Sem roteiro ainda: dê a ideia ao agente.</p>
            )}
            {!!estado.erro && <p className={juntar(texto.auxiliar, "mt-1 text-destructive")}>Roteiros não lidos: {textoDoErro(estado.erro)}</p>}
            {estado.indisponivel && <p className={juntar(texto.auxiliar, "mt-1 text-warning")}>O banco ainda não guarda roteiros: o que for gerado não fica salvo.</p>}
          </>
        )}
      </section>
      <div className={juntar("w-full min-w-0 border-t border-border pt-4", empilhado ? "" : "lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0")} data-lugar-do-agente={empilhado ? "abaixo" : "ao-lado"}>
        <AgenteDoRoteiroDaPeca
          {...(empilhado ? { recolhido: agenteRecolhido, aoRecolher: setAgenteRecolhido, semRolagemPropria: true } : {})}
          roteiroId={linha ? linha.id : null}
          titulo={tema}
          sugestoes={roteiro && roteiro.sugestoes ? roteiro.sugestoes : []}
          garantirRoteiro={doItem ? () => garantirRoteiro(null) : undefined}
          acoes={
            roteiro && !travado ? (
              <button
                type="button"
                className={juntar(botao.icone, novo ? "text-primary hover:text-primary" : "")}
                onClick={() => setNovo(!novo)}
                aria-pressed={novo}
                aria-label={novo ? "Voltar à conversa" : "Novo roteiro (2 versões)"}
                title={novo ? "Voltar à conversa" : "Novo roteiro: ideia, duração, estilo e criatividade; 2 versões e o Jev escolhe"}
              >
                {novo ? <X className="h-4 w-4" aria-hidden="true" /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}
              </button>
            ) : null
          }
          formulario={
            criando ? (
              <CriarRoteiro
                campanha={campanha}
                item={item}
                estado={estado}
                roteiroId={linha ? linha.id : null}
                montarCorpo={montarCorpo}
                aoCancelar={roteiro ? () => setNovo(false) : undefined}
                aoCriar={() => {
                  setNovo(false);
                  setRecolhido(false);
                }}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}
