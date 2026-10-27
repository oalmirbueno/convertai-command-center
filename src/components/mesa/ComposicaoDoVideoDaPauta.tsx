import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCircle2, CircleAlert, Clapperboard, Loader2, Plus, RotateCcw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { useFotos } from "@/components/mesa-foto/fotoApi";
import { motoresProntos, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { BotaoDeGerar } from "@/components/mesa-videos/PecasDoGerador";
import { chamarMesaVideos, chaveDasVersoes, chaveDosArquivos, chaveDosPedidos, type ArquivoDeVideo, type PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import { chamarEditorVideo } from "@/lib/editor/api";
import { pedirRender, rotuloDoPedido, useFilaDeRender } from "@/lib/editor/render";
import { ESTILOS_DE_VIDEO_DA_PAUTA } from "../../../supabase/functions/_shared/video-da-pauta";
import type { MidiaDaPeca } from "../../../supabase/functions/agente-calendario/modulos/midia-da-peca-regras";
import { motorPorId, type NivelDoMotor } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { BotaoComCusto } from "./Custo";
import { SelecaoDaBancada } from "./BancadaDaPauta";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useMesa } from "./MesaContexto";
import { partesDaMidia } from "./mesaV4Api";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import { projetoDoVideoDaCampanha, type ClipeDaCena } from "./montagemDoVideoDaCampanha";
import { imagemParaAMesa } from "./imagemParaAMesa";
import ReferenciasDoVideo from "./ReferenciasDoVideo";
import ReferenciasVirais from "./ReferenciasVirais";
import { situacaoDoPedido } from "./estadoDaGeracao";
import {
  acrescentarCena,
  assinaturaDaMontagem,
  cenasQueFaltam,
  comReferencias,
  composicaoDaReferenciaViral,
  DURACOES_DA_CENA,
  estadoDasCenas,
  imagemNaMesa,
  montarComposicao,
  moverCena,
  MOVIMENTOS_DA_CENA,
  mudarCena,
  pedidosDaComposicao,
  rodadasPedidas,
  roteiroDaComposicao,
  tentativasDasCenas,
  tirarCena,
  todasProntas,
  trocarImagem,
  type ComposicaoDoVideo,
  type EstadoDaCenaNaComposicao,
  type MovimentoDaCena,
} from "./composicaoDoVideo";
import type { ItemDoMes } from "./useItensDoMes";

const SeletorDeFotos = lazy(() => import("@/components/mesa-foto/SeletorDeFotos"));

/**
 * Gerar vídeo com IA da pauta em poucos cliques (27/10/2026). Dono: "puxar o contexto e gerar a base, puxar
 * automaticamente as imagens, criar a composição do vídeo e criar; aí tem a opção de referências, antes e
 * depois etc. Deixar mais simples de mexer e mais fácil com cliques".
 *
 * 1. Montar pelo contexto: com a mídia já pensada, monta na hora (sem custo); sem ela, pensa a mídia pelo nicho
 *    (fotos reais do acervo pelo Jev, uma por cena, e o roteiro com gancho viral; custo antes) e monta.
 * 2. Ajustar com cliques: trocar a imagem (foto do acervo ou base da IA), mover, tirar e acrescentar cena,
 *    movimento, segundos, texto na tela e estilo. Referências com papel e "Buscar virais" mudam as cenas.
 * 3. Gerar: cada cena vira um pedido da Mesa Vídeos (custo total antes; o duplo clique não gera duas vezes).
 * 4. Pronto: com todas as cenas prontas, junta sozinho na Mesa Edição (render, sem custo de IA) e o vídeo
 *    final entra na peça (Pronto) e segue para legendar, legenda do post e Agenda. Cena que falha: Tentar de
 *    novo ou Refazer, com o custo antes.
 */

const NIVEIS: Array<{ valor: NivelDoMotor; rotulo: string }> = [
  { valor: "normal", rotulo: "Normal" },
  { valor: "top", rotulo: "Top" },
  { valor: "rapido", rotulo: "Rápido" },
];

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

const valida = (v: unknown): v is ComposicaoDoVideo | null =>
  v === null || (!!v && typeof v === "object" && Array.isArray((v as ComposicaoDoVideo).cenas) && typeof (v as ComposicaoDoVideo).id === "string");

/** O "Pensar a mídia" com uma foto por cena (até 4), para a composição. */
const pensarMidiaParaComposicao = (clientId: string, taskId: string) =>
  chamarFuncao<{ midia: unknown; avisos?: string[]; custo_usd?: number }>("agente-calendario", { acao: "midia_da_peca", client_id: clientId, task_id: taskId, tipo: "video", max_fotos: 4 });

function LinhaDoEstado({ e, agora }: { e: EstadoDaCenaNaComposicao; agora: number }) {
  if (e.tipo === "sem_pedido") return <span className={texto.auxiliar}>Ainda não gerada</span>;
  if (e.tipo === "pronta") return <span className="flex items-center text-[12px] text-success"><CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Pronta</span>;
  if (e.tipo === "falhou") return <span className="flex min-w-0 items-start text-[12px] text-destructive" role="alert"><CircleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{situacaoDoPedido(e.pedido, agora).detalhe}</span></span>;
  const l = situacaoDoPedido(e.pedido, agora, motorPorId(String((e.pedido.alvo as { motor?: string }).motor || e.pedido.executor)));
  return (
    <span className={juntar("flex min-w-0 items-center text-[12px]", l.atrasado ? "text-warning" : "text-muted-foreground")} role="status">
      <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <span className="min-w-0 truncate">{l.rotulo} · {l.detalhe}</span>
    </span>
  );
}

export default function ComposicaoDoVideoDaPauta({ item, pedidos, arquivos, fotoReal = [] }: { item: ItemDoMes; pedidos: PedidoDeVideo[]; arquivos: ArquivoDeVideo[]; fotoReal?: string[] }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const qc = useQueryClient();
  const chave = (parte: string) => chaveDoEstudioDaPauta(clientId, item.id, parte);
  const [c, setC] = useEstadoDaTela<ComposicaoDoVideo | null>(chave("composicao"), null, { validar: valida, esperaMs: 300 });
  const [nivel, setNivel] = useEstadoDaTela<NivelDoMotor>(`mesa:composicao:nivel:${clientId}`, "normal", { validar: (v) => v === "normal" || v === "top" || v === "rapido" });
  const [motorId, setMotorId] = useEstadoDaTela<string>(`mesa:composicao:motor:${clientId}`, "");
  const [trocando, setTrocando] = useState<string | null>(null);
  const [montandoAgora, setMontandoAgora] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const fotosQ = useFotos(clientId);
  const fotos = fotosQ.data || [];
  const motores = useMotoresDaMesa();
  const prontos = motores.carregando || motores.semFuncao ? undefined : motoresProntos(motores.lista);
  const tema = item.title;

  const estados = c ? estadoDasCenas(c, pedidos, arquivos) : [];
  const andando = estados.some((e) => e.tipo === "andando");
  useEffect(() => {
    if (!andando) return;
    const t = window.setInterval(() => setAgora(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, [andando]);

  const montarDoItem = (midia: MidiaDaPeca | null | undefined) => {
    const nova = montarComposicao({ item: { ...item, midia: midia === undefined ? item.midia : midia }, clientId, fotos, fotoReal, referencias: c ? c.referencias : [], estilo: c ? c.estilo : undefined });
    setC(nova);
    const reais = nova.cenas.filter((x) => x.imagem && x.imagem.origem === "acervo").length;
    toast.success("Composição montada", { description: `${nova.cenas.length} cenas · ${reais ? `${reais} com foto real do acervo` : "a IA cria a base de cada cena"}. Ajuste com cliques e gere.` });
  };

  const pensarEMontar = async () => {
    try {
      const r = await pensarMidiaParaComposicao(clientId, item.id);
      await qc.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
      await qc.invalidateQueries({ queryKey: ["mesa", "item-avulso", clientId] });
      if (r.avisos && r.avisos.length) toast.warning("Contexto pensado com aviso", { description: r.avisos.join(" ") });
      montarDoItem((r.midia as MidiaDaPeca) || null);
      return r;
    } catch (e) {
      // Peça travada ou modelo fora: monta com o que a pauta já tem (direção, estilo e foto real), sem parar.
      montarDoItem(item.midia || null);
      toast.warning("Montei com o que a pauta já tinha", { description: textoDoErro(e) });
      return { custo_usd: 0 };
    }
  };

  // ---------------------------------------------------------------- gerar
  const faltam = c ? cenasQueFaltam(c, estados, rodadasPedidas(c, pedidos)) : [];
  const plano = c ? pedidosDaComposicao(c, { clientId, tema, motores: motores.motores, prontos, nivel, motorId: motorId || null, cenas: faltam, tentativas: tentativasDasCenas(c, pedidos) }) : null;

  const gerar = async () => {
    if (!c || !plano) return;
    // 1. Imagens fora da Mesa (Workspace, Arquivos) vão para a pasta do cliente antes do pedido.
    let atual = c;
    for (const cena of atual.cenas.filter((x) => faltam.indexOf(x.id) >= 0)) {
      const m: Partial<typeof cena> = {};
      if (cena.imagem && !imagemNaMesa(cena.imagem, clientId)) m.imagem = { ...cena.imagem, bucket: "mesa", caminho: await imagemParaAMesa(clientId, cena.imagem) };
      if (cena.final && !imagemNaMesa(cena.final, clientId)) m.final = { ...cena.final, bucket: "mesa", caminho: await imagemParaAMesa(clientId, cena.final) };
      if (Object.keys(m).length) atual = mudarCena(atual, cena.id, m);
    }
    if (atual !== c) setC(atual);
    // 2. Um pedido por cena, cada um com o custo dele (o total foi confirmado no botão).
    const p = pedidosDaComposicao(atual, { clientId, tema, motores: motores.motores, prontos, nivel, motorId: motorId || null, cenas: faltam, tentativas: tentativasDasCenas(atual, pedidos) });
    const falhas: string[] = [];
    let feitos = 0;
    for (const x of p.itens) {
      try {
        const r = await chamarMesaVideos<{ pedido_id?: string }>({ ...x.corpo, custo_confirmado_usd: x.custo.usd });
        if (r && r.pedido_id) feitos++;
        else falhas.push(`Cena ${x.ordem}: o servidor não confirmou.`);
      } catch (e) {
        falhas.push(`Cena ${x.ordem}: ${textoDoErro(e)}`);
      }
    }
    void qc.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    if (!feitos) throw new Error(falhas.join(" ") || "Nenhuma cena foi pedida.");
    if (falhas.length) toast.warning(`${feitos} de ${p.itens.length} cenas pedidas`, { description: falhas.join(" ") });
    else toast.success(feitos === 1 ? "Cena pedida ao motor" : `${feitos} cenas pedidas ao motor`, { description: "Acompanhe aqui. Quando todas ficarem prontas, o vídeo é montado sozinho e entra na peça." });
  };

  // ---------------------------------------------------------------- montar quando todas ficam prontas
  const assinatura = assinaturaDaMontagem(estados);
  const prontas = todasProntas(estados);
  const versaoId = c && c.montagem ? c.montagem.versao_id : null;
  const fila = useFilaDeRender(clientId, versaoId, chamarEditorVideo, undefined, true);
  const render = fila.pedidos[0] || null;
  const montouPara = useRef<string>("");
  const montar = async (forcar = false) => {
    if (!c || !prontas) return;
    if (!forcar && montouPara.current === assinatura) return;
    montouPara.current = assinatura;
    setMontandoAgora(true);
    try {
      const clipes: ClipeDaCena[] = c.cenas.map((_cena, k) => {
        const e = estados[k] as Extract<EstadoDaCenaNaComposicao, { tipo: "pronta" }>;
        const a = e.arquivo as ArquivoDeVideo;
        return { ordem: k + 1, arquivo_id: a.id, nome: a.nome, tipo: a.tipo, storage_bucket: a.storage_bucket, storage_path: a.storage_path, duracao_s: Number(a.duracao_s) || Number(e.pedido.parametros && e.pedido.parametros.duracao_s) || 5, largura: a.largura, altura: a.altura };
      });
      const { projeto, avisos } = projetoDoVideoDaCampanha({ clientId, titulo: `${tema} · vídeo de IA`.slice(0, 120), roteiro: roteiroDaComposicao(c, estados), clipes, trilha: null, agora: new Date().toISOString() });
      const r = await chamarMesaVideos<{ versao?: { id: string; projeto?: { revisao?: number } } }>({ acao: "versao_registrar", client_id: clientId, titulo: projeto.titulo, estado: "rascunho", projeto, nota: `Composição do vídeo da pauta ${tema}`.slice(0, 300) });
      if (!r || !r.versao || !r.versao.id) throw new Error("A versão não foi confirmada.");
      setC((x) => (x ? { ...x, montagem: { versao_id: r.versao!.id, assinatura } } : x));
      await pedirRender(chamarEditorVideo, { clientId, versaoId: r.versao.id, tipo: "render_final", uid: `comp-${c.id}-${fnv(assinatura)}${forcar ? `-${Date.now().toString(36)}` : ""}`.slice(0, 64), revisao: r.versao.projeto && typeof r.versao.projeto.revisao === "number" ? r.versao.projeto.revisao : null });
      void qc.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
      if (avisos.length) toast.warning("Juntando as cenas", { description: avisos.join(" ") });
    } catch (e) {
      toast.error("As cenas não foram juntadas", { description: textoDoErro(e) });
    } finally {
      setMontandoAgora(false);
    }
  };
  useEffect(() => {
    if (c && prontas && (!c.montagem || c.montagem.assinatura !== assinatura)) void montar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prontas, assinatura, c && c.id]);
  const estadoDoRender = render ? render.estado : null;
  useEffect(() => {
    if (estadoDoRender === "pronto") {
      void qc.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      void qc.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
    }
  }, [estadoDoRender, clientId, qc]);

  // ---------------------------------------------------------------- tela
  const temMidia = !!(item.midia && item.midia.gerada_em);
  const montarBotao = temMidia ? (
    <button type="button" className={juntar(c ? botao.secundario : botao.primario, "h-8 px-3 text-[12px]")} onClick={() => montarDoItem(undefined)} title="Montar pelo contexto: cenas, fotos reais e gancho da mídia já pensada (sem custo)" data-montar-pelo-contexto="">
      <Wand2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      {c ? "Montar de novo" : "Montar pelo contexto"}
    </button>
  ) : null;

  const cenaTrocando = c && trocando ? c.cenas.find((x) => x.id === trocando) || null : null;

  return (
    <div className="min-w-0 space-y-4" data-composicao-do-video={c ? c.cenas.length : "vazia"}>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {montarBotao}
        <BotaoComCusto
          rotulo={temMidia ? <RotateCcw className="h-4 w-4" aria-label="Pensar o contexto de novo" /> : <><Wand2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Montar pelo contexto</>}
          titulo={temMidia ? "Pensar o contexto de novo" : "Montar pelo contexto"}
          descricao="Lê a pauta, o nicho e a marca, escolhe as fotos reais do acervo pelo Jev (uma por cena) e escreve as cenas com gancho viral (2 versões, o Jev escolhe). Depois monta a composição. Não gera vídeo."
          partes={() => partesDaMidia(catalogo, 1)}
          executar={pensarEMontar}
          variant={temMidia ? "ghost" : "default"}
          className="h-8 px-2"
        />
        {c && <span className={juntar(texto.auxiliar, "ml-auto")}>{c.cenas.length} cenas · {c.cenas.reduce((s, x) => s + x.duracao_s, 0)} s{c.viral ? " · estrutura viral" : ""}</span>}
      </div>

      {!c && (
        <div className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed border-border p-4 text-center" data-composicao-vazia="">
          <Clapperboard className="mb-2 h-6 w-6 text-primary" aria-hidden="true" />
          <p className={juntar(texto.corpo, "font-medium")}>Monte o vídeo pelo contexto da pauta</p>
          <p className={juntar(texto.auxiliar, "mt-1 max-w-xs")}>Foto real primeiro, uma por cena; sem foto, a IA cria a base.</p>
        </div>
      )}

      {c && (
        <>
          <label className={juntar(texto.rotulo, "block")}>
            Gancho
            <input className={juntar(campo, "mt-1")} value={c.gancho} maxLength={120} onChange={(e) => setC({ ...c, gancho: e.target.value, cenas: c.cenas.map((x, k) => (k === 0 && (x.texto === c.gancho || !x.texto) ? { ...x, texto: e.target.value } : x)) })} aria-label="Gancho do vídeo" />
          </label>

          <ol className="min-w-0 divide-y divide-border" aria-label="Cenas da composição">
            {c.cenas.map((cena, k) => {
              const e = estados[k] || { tipo: "sem_pedido" as const };
              const ocupada = e.tipo === "andando";
              return (
                <li key={cena.id} className="min-w-0 py-3" data-cena-da-composicao={k + 1} data-estado-da-cena={e.tipo}>
                  <div className="flex min-w-0 items-start gap-2">
                    <button
                      type="button"
                      className="relative flex h-[76px] w-[56px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => setTrocando(cena.id)}
                      aria-label={`Trocar a imagem da cena ${k + 1}`}
                      title={cena.imagem ? `Imagem de partida: ${cena.imagem.nome}. Clique para trocar.` : "A IA cria a base desta cena pelo texto. Clique para usar uma foto."}
                      disabled={!!cena.transformacao}
                    >
                      {cena.imagem ? <MiniaturaDoStorage bucket={cena.imagem.bucket} caminho={cena.imagem.caminho} alt="" largura={120} className="absolute inset-0 h-full w-full" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                      {cena.final && <span className="absolute bottom-0 right-0 rounded-tl bg-card/90 px-1 text-[11px] text-foreground">2</span>}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <span className={juntar(texto.rotulo, "mr-1")}>Cena {k + 1}{cena.transformacao ? " · antes e depois" : ""}</span>
                        <select aria-label={`Movimento da cena ${k + 1}`} className={juntar(campo, "h-8 w-auto max-w-[170px] px-2 text-[12px]")} value={cena.movimento} onChange={(ev) => setC(mudarCena(c, cena.id, { movimento: ev.target.value as MovimentoDaCena }))}>
                          {MOVIMENTOS_DA_CENA.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <select aria-label={`Segundos da cena ${k + 1}`} className={juntar(campo, "h-8 w-auto px-2 text-[12px]")} value={cena.duracao_s} onChange={(ev) => setC(mudarCena(c, cena.id, { duracao_s: Number(ev.target.value) }))}>
                          {DURACOES_DA_CENA.map((d) => <option key={d} value={d}>{d} s</option>)}
                        </select>
                        <span className="ml-auto flex shrink-0 items-center">
                          <button type="button" className={botao.icone} disabled={!k} onClick={() => setC(moverCena(c, cena.id, -1))} aria-label={`Subir a cena ${k + 1}`} title="Subir"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></button>
                          <button type="button" className={botao.icone} disabled={k === c.cenas.length - 1} onClick={() => setC(moverCena(c, cena.id, 1))} aria-label={`Descer a cena ${k + 1}`} title="Descer"><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
                          {e.tipo === "pronta" && (
                            <button type="button" className={botao.icone} onClick={() => setC(mudarCena(c, cena.id, { rodada: cena.rodada + 1 }))} aria-label={`Refazer a cena ${k + 1}`} title="Refazer esta cena (entra no próximo Gerar, com o custo antes)"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /></button>
                          )}
                          <button type="button" className={botao.icone} disabled={c.cenas.length <= 1 || ocupada} onClick={() => setC(tirarCena(c, cena.id))} aria-label={`Tirar a cena ${k + 1}`} title="Tirar a cena"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                        </span>
                      </div>
                      <textarea aria-label={`O que aparece na cena ${k + 1}`} className={juntar(campo, "mt-1 h-auto min-h-[52px] py-1.5 leading-5")} rows={2} maxLength={240} value={cena.descricao} onChange={(ev) => setC(mudarCena(c, cena.id, { descricao: ev.target.value }))} />
                      <input aria-label={`Texto na tela da cena ${k + 1}`} className={juntar(campo, "mt-1 h-8 text-[12px]")} maxLength={90} placeholder="Texto na tela (opcional)" value={cena.texto} onChange={(ev) => setC(mudarCena(c, cena.id, { texto: ev.target.value }))} />
                      <div className="mt-1 min-w-0"><LinhaDoEstado e={cena.rodada > (rodadasPedidas(c, pedidos)[cena.id] ?? cena.rodada) ? { tipo: "sem_pedido" } : e} agora={agora} /></div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <button type="button" className={botao.icone} onClick={() => setC(acrescentarCena(c, tema))} disabled={c.cenas.length >= 6} aria-label="Acrescentar cena" title="Acrescentar cena"><Plus className="h-4 w-4" aria-hidden="true" /></button>
            <select aria-label="Estilo do vídeo" title="Estilo do vídeo" className={juntar(campo, "ml-auto h-8 w-auto max-w-[200px] px-2 text-[12px]")} value={c.estilo} onChange={(ev) => setC({ ...c, estilo: ev.target.value })}>
              {ESTILOS_DE_VIDEO_DA_PAUTA.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </div>

          <Secao divisoria nivel={3} titulo="Referências" descricao={c.referencias.length ? `${c.referencias.length} com papel` : "antes, depois, movimento, produto"} recolher={`mesa:composicao:referencias:${clientId}`} ajuda="Antes e depois viram a cena de transformação (primeiro e último quadro, mesmo ponto de vista). Produto entra na cena sem imagem. Estilo de movimento (imagem ou vídeo) vai no pedido de cada cena. Tudo chega ao motor com o papel marcado.">
            <ReferenciasDoVideo clientId={clientId} referencias={c.referencias} fotos={fotos} onMudar={(r) => setC(comReferencias(c, r))} />
          </Secao>

          <Secao divisoria nivel={3} titulo="Referências virais" descricao={c.viral ? `Em uso: ${c.viral.titulo}` : "IA e satisfatórios do nicho"} recolher={`mesa:composicao:virais:${clientId}`} recolhidaDeInicio ajuda="Vídeos curtos reais que viralizaram, feitos com IA ou satisfatórios, do universo do cliente. Usar como referência copia a estrutura (cenas, movimento e tempo), nunca o conteúdo: as imagens e o assunto continuam os do cliente.">
            <ReferenciasVirais taskId={item.id} emUso={c.viral ? c.viral.link : null} onUsar={(r) => { setC(composicaoDaReferenciaViral(c, r, tema)); toast.success("Estrutura aplicada", { description: `${r.estrutura.length} cenas no ritmo de "${r.titulo}", com as imagens do cliente.` }); }} />
          </Secao>

          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <SeletorCompacto rotulo="Nível do motor" opcoes={NIVEIS} valor={nivel} onEscolher={(v) => { setNivel(v as NivelDoMotor); setMotorId(""); }} />
              <select aria-label="Motor de vídeo" title="Motor de vídeo (automático escolhe pelo nível e pela cena)" className={juntar(campo, "ml-auto h-8 w-auto max-w-[180px] px-2 text-[12px]")} value={motorId} onChange={(ev) => setMotorId(ev.target.value)}>
                <option value="">Automático</option>
                {motores.lista.filter((x) => x.motor.familia === "video" && !x.motor.situacao && x.estado === "pronto").map((x) => <option key={x.motor.id} value={x.motor.id}>{x.motor.rotulo}</option>)}
              </select>
            </div>
            {plano && (
              <BotaoDeGerar
                custo={plano.custo}
                motivo={plano.itens.length ? plano.motivo : plano.motivo || "Nada a gerar."}
                rotulo={faltam.length === c.cenas.length ? "Gerar vídeo" : `Gerar ${faltam.length === 1 ? "1 cena" : `${faltam.length} cenas`}`}
                onConfirmar={gerar}
                icone={<Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                extra={plano.custo.detalhe}
              />
            )}
          </div>

          {(prontas || versaoId) && (
            <div className="flex min-w-0 flex-wrap items-center gap-1 border-t border-border pt-3" data-montagem-da-composicao={render ? render.estado : montandoAgora ? "montando" : "pronta"}>
              {render && render.estado === "pronto" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" /> : render && render.estado === "erro" ? <CircleAlert className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
              <span className={juntar(texto.auxiliar, "min-w-0 flex-1")} role="status">
                {render && render.estado === "pronto" ? "Vídeo pronto: entrou na peça. Siga para legendar e para a legenda do post." : render ? `Juntando as cenas: ${rotuloDoPedido(render, Date.now(), fila.worker)}` : montandoAgora ? "Juntando as cenas na Edição…" : "Todas as cenas prontas: juntando."}
              </span>
              {prontas && !montandoAgora && (!render || render.estado === "erro" || render.estado === "pronto") && (
                <button type="button" className={botao.icone} onClick={() => void montar(true)} aria-label="Juntar de novo" title="Juntar as cenas de novo (sem custo de IA)"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /></button>
              )}
              {fila.erro && <span className="w-full text-[12px] text-destructive" role="alert">{fila.erro}</span>}
            </div>
          )}
        </>
      )}

      {cenaTrocando && c && (
        <SelecaoDaBancada>
          <div className="min-w-0">
            <div className="mb-2 flex min-w-0 items-center gap-1">
              <p className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>Imagem da cena {c.cenas.indexOf(cenaTrocando) + 1}</p>
              <button type="button" className={botao.icone} onClick={() => { setC(trocarImagem(c, cenaTrocando.id, null)); setTrocando(null); }} aria-label="A IA cria a base" title="Sem foto: a IA cria a base da cena pelo texto">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <Suspense fallback={<p role="status">Lendo as fotos…</p>}>
              <SeletorDeFotos
                fotos={fotos.filter((f) => !f.referencia_web)}
                titulo="Fotos do cliente"
                multiplas={false}
                onFechar={() => setTrocando(null)}
                onUsar={(ids) => {
                  const f = fotos.find((x) => x.id === ids[0] && x.client_id === clientId);
                  if (f) setC(trocarImagem(c, cenaTrocando.id, { origem: "acervo", id: f.id, nome: f.nome, bucket: f.storage_bucket || "mesa", caminho: f.storage_path }));
                  setTrocando(null);
                }}
              />
            </Suspense>
          </div>
        </SelecaoDaBancada>
      )}
    </div>
  );
}
