import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, FileDown, FileText, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { padraoPara, parteDaConferenciaDoJev, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { botao, juntar, superficie, texto } from "@/components/sistema";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import type { Campanha, ItemProposto } from "./mesaV4Api";
import { linhaDaCampanha } from "./CampanhaLinhaDoTempo";
import { indiceDaFase } from "./areasDaCampanha";
import { atualizarNoCache, estimarGeracao, gerarRoteiro, useRoteiros, type PedidoDeGeracao, type RespostaDoRoteiro } from "@/components/mesa-roteiros/roteirosApi";
import { SeloDoStatus } from "@/components/mesa-roteiros/Comuns";
import {
  modoDoTipo,
  normalizarRoteiro,
  TAMANHO_DA_GERACAO,
  versaoPorNumero,
  type LinhaDoRoteiro,
  type Roteiro,
  type TipoDeRoteiro,
} from "../../../supabase/functions/_shared/roteiro-modelo";
import { normalizarRoteiroDeVideo, type RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";

/**
 * Vídeo da campanha, caminho GRAVAR (22/10/2026, dono: "no vídeo, gerar ou gravar: ele monta o roteiro, já
 * puxa para gerar o roteiro e já vem com o documento do roteiro para baixar com base no tema da campanha,
 * usando o motor de roteiros que já tem"). A pessoa vai gravar: o motor de roteiros (mesa-roteiros, ação
 * gerar) escreve o roteiro completo da peça com a campanha (briefing, fase da linha do tempo e o que a peça
 * já tem na série), a tela mostra o roteiro para ler e o documento sai em PDF ou Word.
 *
 * Interface (CampanhaVideos.tsx liga este componente em cada peça de vídeo):
 *
 *   <GravarVideoDaCampanha clientId={clientId} campanha={campanha} propostaId={campanha.proposta_id} item={peca} aoAtualizar={(linha) => ...} />
 *
 * - clientId: o cliente da Mesa.
 * - campanha: a campanha (mesaV4Api.Campanha). Usa id, nome, objetivo e o briefing (linha do tempo).
 * - propostaId (opcional): a série da campanha; sem ele, campanha.proposta_id. Ajuda a achar o roteiro já feito.
 * - item: a peça de vídeo da série (ItemProposto): tema_id, tema, data, etapa, task_id, gancho, resumo, cta e
 *   roteiro_video (o roteiro curto do agente da campanha, quando houver).
 * - aoAtualizar (opcional): chamado com a linha do roteiro gravada depois de gerar.
 *
 * Precisa estar dentro do MesaProvider (o BotaoComCusto lê saldo e catálogo), do QueryClientProvider e de um
 * Router (o link "Abrir no Roteiros").
 *
 * Ligação peça e roteiro: a tabela roteiros guarda task_id, proposta_id e campanha_id. Peça na agenda:
 * o roteiro é o da tarefa (um por tarefa). Fora da agenda: o roteiro da campanha (ou da série) com o
 * título igual ao tema da peça (o servidor dá ao roteiro avulso o título do tema). Reabrir acha o roteiro
 * na lista do cliente e não gera de novo.
 *
 * Custo antes: a ação estimar do motor (sem IA) devolve o valor e o modelo; o botão mostra esse valor mais
 * a conferência do Jev, e a geração usa o mesmo modelo.
 */

export interface PropsDoGravarVideo {
  clientId: string;
  campanha: Campanha;
  propostaId?: string | null;
  item: ItemProposto;
  aoAtualizar?: (linha: LinhaDoRoteiro | null) => void;
}

const TIPOS_PARA_GRAVAR: { valor: TipoDeRoteiro; rotulo: string }[] = [
  { valor: "fala_camera", rotulo: "Fala para a câmera" },
  { valor: "ugc", rotulo: "UGC" },
  { valor: "tutorial", rotulo: "Tutorial" },
];

const roteiroDaSerie = (item: ItemProposto): RoteiroDeVideo | null => normalizarRoteiroDeVideo((item as ItemProposto & { roteiro_video?: unknown }).roteiro_video);

/** O roteiro já feito desta peça: o da tarefa da agenda; fora dela, o da campanha (ou da série) com o título do tema. */
export function roteiroDaPecaDaCampanha(lista: LinhaDoRoteiro[], p: { campanhaId: string; propostaId?: string | null; item: ItemProposto }): LinhaDoRoteiro | null {
  const vivos = lista.filter((r) => !r.arquivado_em);
  if (p.item.task_id) {
    const daTarefa = vivos.filter((r) => r.task_id === p.item.task_id)[0];
    if (daTarefa) return daTarefa;
  }
  const tema = String(p.item.tema || "").trim();
  if (!tema) return null;
  return vivos.filter((r) => r.titulo.trim() === tema && (r.campanha_id === p.campanhaId || (!!p.propostaId && r.proposta_id === p.propostaId)))[0] || null;
}

/** O pedido ao roteirista com o que a peça já tem: fase, gancho, resumo, cenas e CTA do roteiro da série. */
export function pedidoDaPecaDaCampanha(campanha: Campanha, item: ItemProposto): string {
  const linha = linhaDaCampanha(campanha);
  const k = linha ? indiceDaFase(linha.fases, item) : -1;
  const fase = linha && k >= 0 ? linha.fases[k] : null;
  const rv = roteiroDaSerie(item);
  const cenas = rv
    ? rv.cenas.map((c, i) => `${i + 1}) ${c.descricao}${c.fala ? ` | fala: ${c.fala}` : ""}${c.texto_na_tela ? ` | na tela: ${c.texto_na_tela}` : ""} (${c.segundos} s)`).join("; ")
    : "";
  const cta = (rv && rv.cta) || item.cta || "";
  return [
    `Peça de vídeo da campanha "${campanha.nome}" para a pessoa gravar.`,
    fase ? `Fase da linha do tempo: ${fase.nome} (${fase.inicio} a ${fase.fim}), ${fase.papel}.` : item.etapa ? `Fase: ${item.etapa}.` : "",
    item.gancho ? `Gancho da série: ${item.gancho}` : "",
    item.resumo ? `Resumo da peça: ${item.resumo}` : "",
    rv && rv.gancho && rv.gancho !== item.gancho ? `Gancho do roteiro da série: ${rv.gancho}` : "",
    cenas ? `Cenas do roteiro da série: ${cenas}` : "",
    cta ? `CTA: ${cta}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

/** O corpo da ação gerar do motor de roteiros para esta peça. */
export function corpoDoRoteiroDaPeca(p: { clientId: string; campanha: Campanha; item: ItemProposto; tipo: TipoDeRoteiro; modeloId?: string | null }): PedidoDeGeracao {
  const rv = roteiroDaSerie(p.item);
  return {
    client_id: p.clientId,
    task_id: p.item.task_id || null,
    tipo: p.tipo,
    duracao_s: rv && rv.duracao ? rv.duracao : 30,
    objetivo: String(p.item.objetivo || p.campanha.objetivo || "").slice(0, 300) || undefined,
    pedido: pedidoDaPecaDaCampanha(p.campanha, p.item),
    tema: String(p.item.tema || p.item.titulo || "Vídeo da campanha").slice(0, 300),
    modelo_id: p.modeloId || null,
    campanha_id: p.campanha.id,
    tema_id: p.item.tema_id || null,
  };
}

/** O roteiro em texto com títulos (# e ##), para o documento Word. */
export function textoDoRoteiro(r: Roteiro): string {
  const linhas: string[] = [`# ${r.titulo || "Roteiro"}`];
  if (r.subtitulo) linhas.push(r.subtitulo);
  linhas.push(`${modoDoTipo(r.tipo).rotulo} · ${r.duracao_alvo_s} s${r.objetivo ? ` · ${r.objetivo}` : ""}`, "");
  if (r.ganchos.length) {
    linhas.push("## Ganchos");
    r.ganchos.forEach((g, i) => linhas.push(`${i + 1}. ${g.texto}${i === r.gancho_escolhido ? " (escolhido)" : ""}`));
    linhas.push("");
  }
  linhas.push("## Roteiro");
  r.blocos.forEach((b, i) => {
    linhas.push(`### ${i + 1}. ${b.funcao || "Bloco"} (${b.segundos} s)`);
    if (b.fala) linhas.push(`Fala: ${b.fala}`);
    if (b.visual) linhas.push(`Visual: ${b.visual}`);
    if (b.texto_na_tela) linhas.push(`Texto na tela: ${b.texto_na_tela}`);
    if (b.broll) linhas.push(`B-roll: ${b.broll}`);
  });
  linhas.push("");
  const d = r.direcao;
  const direcao = ([["Enquadramento", d.enquadramento], ["Ambiente", d.ambiente], ["Figurino", d.figurino], ["Objetos", d.objetos], ["Luz", d.luz], ["Câmera", d.camera]] as const).filter(([, v]) => !!v);
  if (direcao.length || d.orientacoes.length) {
    linhas.push("## Direção de gravação", ...direcao.map(([k, v]) => `${k}: ${v}`), ...d.orientacoes.map((o) => `- ${o}`), "");
  }
  if (r.broll.length) linhas.push("## B-roll", ...r.broll.map((b) => `- ${b}`), "");
  if (r.cta) linhas.push("## CTA", r.cta, "");
  if (r.legenda) linhas.push("## Legenda", ...r.legenda.split("\n"), "");
  if (r.hashtags.length) linhas.push("## Hashtags", r.hashtags.join(" "), "");
  if (r.pendencias.length) linhas.push("## Confirmar antes de gravar", ...r.pendencias.map((p) => `- ${p}`), "");
  return linhas.join("\n");
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  if (!valor) return null;
  return (
    <p className={juntar(texto.corpo, "min-w-0 whitespace-pre-line")}>
      <span className={texto.rotulo}>{rotulo}: </span>
      {valor}
    </p>
  );
}

function Lista({ titulo, itens }: { titulo: string; itens: string[] }) {
  if (!itens.length) return null;
  return (
    <section className="min-w-0" aria-label={titulo}>
      <h4 className={juntar(texto.rotulo, "mb-1 truncate")}>{titulo}</h4>
      <ul className="min-w-0 list-disc space-y-0.5 pl-5">
        {itens.map((x, i) => (
          <li key={i} className={texto.corpo}>{x}</li>
        ))}
      </ul>
    </section>
  );
}

/** O roteiro para ler antes de gravar: ganchos, blocos (fala, visual, texto na tela e b-roll), direção, CTA, legenda e hashtags. */
export function RoteiroParaGravar({ roteiro: r }: { roteiro: Roteiro }) {
  const d = r.direcao;
  return (
    <div className="mt-2 min-w-0 space-y-3" data-roteiro-para-gravar="">
      {r.ganchos.length > 0 && (
        <section className="min-w-0" aria-label="Ganchos">
          <h4 className={juntar(texto.rotulo, "mb-1 truncate")}>Ganchos</h4>
          <ol className="min-w-0 space-y-1">
            {r.ganchos.map((g, i) => (
              <li key={i} className={juntar(texto.corpo, "min-w-0")} data-gancho-escolhido={i === r.gancho_escolhido ? "" : undefined}>
                <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                {g.texto}
                {i === r.gancho_escolhido && <span className={juntar(texto.etiqueta, "ml-2 text-primary")}>escolhido</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="min-w-0" aria-label="Blocos do roteiro">
        <h4 className={juntar(texto.rotulo, "mb-1 truncate")}>Roteiro</h4>
        <ol className="min-w-0 space-y-2">
          {r.blocos.map((b, i) => (
            <li key={b.id || i} className={juntar(superficie.poco, "min-w-0 space-y-0.5 p-2")} data-bloco={i + 1}>
              <p className={juntar(texto.etiqueta, "truncate text-muted-foreground")}>
                {i + 1}. {b.funcao || "Bloco"} · {b.segundos} s
              </p>
              <Campo rotulo="Fala" valor={b.fala} />
              <Campo rotulo="Visual" valor={b.visual} />
              <Campo rotulo="Texto na tela" valor={b.texto_na_tela} />
              <Campo rotulo="B-roll" valor={b.broll} />
            </li>
          ))}
        </ol>
      </section>
      {(d.enquadramento || d.ambiente || d.figurino || d.objetos || d.luz || d.camera || d.orientacoes.length > 0) && (
        <section className="min-w-0 space-y-0.5" aria-label="Direção de gravação">
          <h4 className={juntar(texto.rotulo, "mb-1 truncate")}>Direção de gravação</h4>
          <Campo rotulo="Enquadramento" valor={d.enquadramento} />
          <Campo rotulo="Ambiente" valor={d.ambiente} />
          <Campo rotulo="Figurino" valor={d.figurino} />
          <Campo rotulo="Objetos" valor={d.objetos} />
          <Campo rotulo="Luz" valor={d.luz} />
          <Campo rotulo="Câmera" valor={d.camera} />
          {d.orientacoes.length > 0 && (
            <ul className="min-w-0 list-disc space-y-0.5 pl-5">
              {d.orientacoes.map((o, i) => (
                <li key={i} className={texto.corpo}>{o}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <Lista titulo="B-roll" itens={r.broll} />
      {(r.cta || r.legenda || r.hashtags.length > 0) && (
        <section className="min-w-0 space-y-0.5" aria-label="CTA e legenda">
          <Campo rotulo="CTA" valor={r.cta} />
          <Campo rotulo="Legenda" valor={r.legenda} />
          <Campo rotulo="Hashtags" valor={r.hashtags.join(" ")} />
        </section>
      )}
      <Lista titulo="Confirmar antes de gravar" itens={r.pendencias} />
    </div>
  );
}

export default function GravarVideoDaCampanha({ clientId, campanha, propostaId, item, aoAtualizar }: PropsDoGravarVideo) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<TipoDeRoteiro>("fala_camera");
  // Banco sem a tabela: o roteiro volta sem guardar e fica só nesta tela.
  const [solto, setSolto] = useState<Roteiro | null>(null);
  const [baixando, setBaixando] = useState<"pdf" | "docx" | null>(null);
  const [recolhido, setRecolhido] = useRecolhido(`campanha-gravar:${clientId}:${item.tema_id || item.tema || ""}`, false);
  const roteiros = useRoteiros(clientId);
  const serie = propostaId || campanha.proposta_id || null;
  const linha = roteiros.data ? roteiroDaPecaDaCampanha(roteiros.data.lista, { campanhaId: campanha.id, propostaId: serie, item }) : null;
  const versao = linha ? versaoPorNumero(linha.versoes, linha.versao_atual) : null;
  const roteiro = versao ? versao.conteudo : solto;
  const estimativa = useQuery({
    queryKey: ["mesa-roteiros", "estimar", "gerar", clientId],
    enabled: !!clientId && !roteiro,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => estimarGeracao(clientId),
  });
  const padrao = padraoPara(mesa.catalogo, "estrategista");
  const modeloId = estimativa.data && estimativa.data.modelo_id ? estimativa.data.modelo_id : padrao ? padrao.id : "";
  const partes = (): ParteDaEstimativa[] => {
    if (estimativa.data && typeof estimativa.data.estimativa_usd === "number") return [{ modeloId, tipo: "texto", fixoUsd: estimativa.data.estimativa_usd }, parteDaConferenciaDoJev()];
    // O motor não respondeu a estimativa: a mesma conta da Mesa Roteiros, pelo catálogo.
    return modeloId ? [{ modeloId, tipo: "texto", tokensEntrada: TAMANHO_DA_GERACAO.entrada, tokensSaida: TAMANHO_DA_GERACAO.saida }, parteDaConferenciaDoJev()] : [];
  };

  const nomeDoCliente = mesa.clientName || "Cliente";
  const baixarPdf = async () => {
    if (!roteiro) return;
    setBaixando("pdf");
    try {
      const { baixarBytes, itemDoPdf, itemSolto, montarPdf } = await import("@/components/mesa-roteiros/pdfNoNavegador");
      const doc = (linha && itemDoPdf(linha, false)) || itemSolto(roteiro);
      const { bytes, nome } = montarPdf(nomeDoCliente, [doc]);
      baixarBytes(bytes, nome);
    } catch (e) {
      toast.error("PDF não gerado", { description: textoDoErro(e) });
    } finally {
      setBaixando(null);
    }
  };
  const baixarWord = async () => {
    if (!roteiro) return;
    setBaixando("docx");
    try {
      const { baixarDocumentoDoLab, docxDoProjeto } = await import("@/lib/laboratorio/exportar");
      const markdown = textoDoRoteiro(roteiro);
      const nome = `roteiro-${String(roteiro.titulo || item.tema || "video").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video"}`;
      const blob = await docxDoProjeto({ nome, titulo: roteiro.titulo || "Roteiro", markdown, json: "", totalNos: 0, totalExecucoes: 0, pendencias: [] });
      baixarDocumentoDoLab(blob, `${nome}.docx`);
    } catch (e) {
      toast.error("Word não gerado", { description: textoDoErro(e) });
    } finally {
      setBaixando(null);
    }
  };

  const tema = item.tema || "o vídeo";
  const estado = linha ? "pronto" : solto ? "solto" : "falta";
  const resumo = roteiro ? `${modoDoTipo(roteiro.tipo).rotulo} · ${roteiro.duracao_alvo_s} s · ${roteiro.blocos.length} blocos` : null;

  return (
    <div className="min-w-0" data-gravar-video={item.tema_id || ""} data-estado-do-roteiro-para-gravar={estado}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {roteiro ? (
          <>
            <TituloRecolhivel titulo="Roteiro para gravar" recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={resumo} className="mr-auto" />
            {linha && <SeloDoStatus status={linha.status} />}
            {linha && (
              <Link
                to={`/mesa-roteiros?client=${clientId}&etapa=roteiro&roteiro=${linha.id}`}
                className={juntar(botao.icone, "text-primary hover:text-primary")}
                aria-label={`Abrir o roteiro de ${tema} no Roteiros`}
                title="Abrir no Roteiros (editar, aprovar, versões)"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            <button type="button" className={botao.barra} onClick={() => void baixarPdf()} disabled={baixando !== null} aria-label={`Baixar o roteiro de ${tema} em PDF`} title="Baixar roteiro (PDF)">
              {baixando === "pdf" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
              PDF
            </button>
            <button type="button" className={botao.barra} onClick={() => void baixarWord()} disabled={baixando !== null} aria-label={`Baixar o roteiro de ${tema} em Word`} title="Baixar (Word)">
              {baixando === "docx" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileText className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
              Word
            </button>
          </>
        ) : (
          <>
            <span className={juntar(texto.rotulo, "mr-auto truncate")}>Roteiro para gravar</span>
            <SeletorCompacto rotulo="Tipo do roteiro" opcoes={TIPOS_PARA_GRAVAR} valor={tipo} onEscolher={(v) => setTipo(v as TipoDeRoteiro)} />
            <BotaoComCusto
              rotulo={
                <>
                  <Wand2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Gerar roteiro
                </>
              }
              titulo="Roteiro para gravar"
              descricao="Roteiro completo pelo motor de roteiros, com a campanha: ganchos, falas com tempo, direção de gravação, texto na tela, b-roll, CTA e legenda"
              disabled={roteiros.isLoading || estimativa.isLoading || !modeloId}
              partes={partes}
              executar={() => gerarRoteiro(corpoDoRoteiroDaPeca({ clientId, campanha, item, tipo, modeloId }))}
              aoConcluir={(data: RespostaDoRoteiro) => {
                if (data && data.roteiro) {
                  atualizarNoCache(qc, clientId, data.roteiro);
                  aoAtualizar?.(data.roteiro);
                } else if (data && data.versao) {
                  toast.warning("Roteiro gerado sem guardar", { description: data.aviso_banco || "O banco ainda não guarda roteiros." });
                  setSolto(normalizarRoteiro(data.versao.conteudo));
                  aoAtualizar?.(null);
                }
              }}
              variant="ghost"
              className="h-8 px-2"
            />
          </>
        )}
      </div>
      {roteiros.isError && !roteiro && <p className={juntar(texto.auxiliar, "mt-1 text-destructive")}>Roteiros não lidos: {textoDoErro(roteiros.error)}</p>}
      {roteiro && !recolhido && <RoteiroParaGravar roteiro={roteiro} />}
    </div>
  );
}
