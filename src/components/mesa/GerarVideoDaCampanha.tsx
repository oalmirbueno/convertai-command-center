/**
 * Gerar o vídeo de uma peça da campanha por IA (22/10/2026, dono: "no vídeo coloque gerar, e no gerar
 * vídeo coloque a opção de narração e trilhas com ElevenLabs para juntar no vídeo, e roteiros e cenas").
 * Rota 2 enxuta, um passo por vez, com o custo antes de cada um:
 *   1. Roteiro: o roteiro_video da peça, cada cena editável (o que aparece, fala, texto na tela, segundos);
 *      sem roteiro, "Gerar o roteiro" (frente B, 23/10: mesa-roteiros peca_cenas_gerar, 2 versões com os
 *      ganchos virais do nicho e o Jev escolhe; a escolhida vai para a peça pelo editar_item).
 *   2. Cenas: cada cena vira um vídeo 9:16 pela Mesa Vídeos (gerar_video, modo texto, Seedance 2.0 Mini
 *      por padrão; sem áudio do motor quando o roteiro tem fala), o 409 confirmar_custo de todas as cenas
 *      somado antes; a fila é conferida até cada cena ficar pronta; dá para refazer uma cena.
 *   3. Narração: a voz da marca ou da conta da ElevenLabs e as falas numa chamada só (campanha_narracao).
 *   4. Trilha: a trilha escolhida da campanha (briefing.trilha); sem ela, a aba Trilha e efeitos ali mesmo.
 *   5. Montar: o projeto da Mesa Edição (montagemDoVideoDaCampanha.ts: cenas em sequência no tempo da
 *      fala, voz com papel "voz", música com papel "trilha", texto na tela), versao_registrar na
 *      mesa-videos e render_pedir (render_final) na editor-video; pronto, "Baixar vídeo" e "Abrir na Edição".
 * O que cada passo produz fica na peça (roteiro_video.cenas[].video, .narracao e .montagem): sair e voltar
 * não perde nada.
 *
 * Interface (quem liga é o CampanhaVideos, junto do caminho Gravar):
 *   <GerarVideoDaCampanha clientId campanha propostaId item aoAtualizar? />
 *   - clientId: o cliente aberto na Mesa (precisa estar dentro do MesaProvider);
 *   - campanha: a campanha (Campanha de mesaV4Api; briefing.trilha é a trilha usada);
 *   - propostaId: a série da campanha (campanha.proposta_id); a resposta de cada passo atualiza o cache
 *     chaves.proposta(propostaId);
 *   - item: a peça de vídeo (ItemProposto com formato "video" e tema_id);
 *   - aoAtualizar?: ({ item?, proposta? }) => void, chamado quando a peça muda no servidor.
 * Sem travessão.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, ExternalLink, Loader2, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { botao, campo, campoTexto, Etapas, juntar, lista, texto, useEstadoDaTela } from "@/components/sistema";
import { ErroDaMesa, textoDoErro, usd } from "@/lib/mesa/api";
import { BotaoComCusto } from "./Custo";
import { useMesa, useUrlDaMesa } from "./MesaContexto";
import { chaves, editarItemDaProposta, type Campanha, type ItemProposto } from "./mesaV4Api";
import { abrirParteDaCampanha } from "./passosDaCampanha";
import { SeletorDoModeloDoEscopo, useModeloDoEscopo } from "./ModeloDaCopyDoConteudo";
import { gerarEGuardarCenasDaPeca, partesDasCenasDaPeca } from "@/components/mesa-roteiros/cenasDaPeca";
import { chaveDaTrilha, lerTrilhaDaCampanha, trilhaSugeridaDaCampanha, type EstadoDaTrilha } from "./trilhaDaCampanhaApi";
import { chaveDasVozes, gerarNarracaoDaPeca, lerVozesDaNarracao, registrarNaPeca, type RespostaDaPeca } from "./narracaoDaCampanhaApi";
import { projetoDoVideoDaCampanha, type ClipeDaCena } from "./montagemDoVideoDaCampanha";
import { chamarMesaVideos, chaveDasVersoes, chaveDosArquivos, chaveDosPedidos, useArquivosDeVideo, usePedidos, type ArquivoDeVideo, type PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import { custoNaTela, novoUid, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { chamarEditorVideo } from "@/lib/editor/api";
import { pedirRender, rotuloDoPedido, uidDoClique, useFilaDeRender } from "@/lib/editor/render";
import { atende, duracaoNoMotor, type MotorDeVideo } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { MAX_CENAS, MAX_SEGUNDOS_DA_CENA, normalizarRoteiroDeVideo, type CenaDoRoteiro, type RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import { assinaturaDaCena, duracoesDasCenas, falasDaNarracao, pedidoDaNarracao, situacaoDaNarracao } from "../../../supabase/functions/agente-calendario/modulos/narracao-da-campanha-regras";
import { MODELO_DE_VOZ_PADRAO, MODELOS_DE_VOZ } from "../../../supabase/functions/mesa-motion/modulos/narracao";

const CampanhaTrilha = lazy(() => import("./CampanhaTrilha"));

export interface PropsDoGerarVideo {
  clientId: string;
  campanha: Campanha;
  propostaId: string;
  item: ItemProposto;
  aoAtualizar?: (r: RespostaDaPeca) => void;
}

type Passo = "roteiro" | "cenas" | "narracao" | "trilha" | "montar";
const PASSOS: Array<{ valor: Passo; rotulo: string }> = [
  { valor: "roteiro", rotulo: "Roteiro e cenas" },
  { valor: "cenas", rotulo: "Cenas em vídeo" },
  { valor: "narracao", rotulo: "Narração" },
  { valor: "trilha", rotulo: "Trilha" },
  { valor: "montar", rotulo: "Montar" },
];

/** Motor padrão das cenas: o Seedance mais barato que faz vídeo pelo texto (o Fast só anima foto). */
export const MOTOR_PADRAO_DAS_CENAS = "seedance-2.0-mini";
const CONFERIR_A_CADA_MS = 20_000;
const EM_ANDAMENTO = ["enviado", "gerando", "baixando"];
const ROTULO_DO_PEDIDO: Record<string, string> = { enviado: "na fila do motor", gerando: "gerando", baixando: "guardando", pronto: "pronta", parcial: "pronta", erro: "não saiu" };

type EstadoDaCena =
  | { tipo: "sem_video" }
  | { tipo: "gerando"; rotulo: string; pedidoId: string }
  | { tipo: "pronta"; arquivo: ArquivoDeVideo | null; arquivoId: string; pedido: PedidoDeVideo }
  | { tipo: "erro"; motivo: string };

function estadoDaCena(c: CenaDoRoteiro, pedidos: PedidoDeVideo[], arquivos: ArquivoDeVideo[]): EstadoDaCena {
  if (!c.video) return { tipo: "sem_video" };
  const p = pedidos.find((x) => x.id === c.video!.pedido_id);
  if (!p) return { tipo: "gerando", rotulo: "enviada", pedidoId: c.video.pedido_id };
  const estado = String(p.estado);
  const envios = (p.resultado && p.resultado.envios) || [];
  const arquivoId = envios.map((e) => e && e.arquivo_id).filter((x): x is string => !!x)[0];
  if ((estado === "pronto" || estado === "parcial") && arquivoId) return { tipo: "pronta", arquivoId, arquivo: arquivos.find((a) => a.id === arquivoId) || null, pedido: p };
  if (estado === "erro" || estado === "parcial" || estado === "cancelado") {
    const motivo = (envios as Array<{ erro?: string | null }>).map((e) => e && e.erro).filter(Boolean)[0];
    return { tipo: "erro", motivo: motivo ? String(motivo) : "O motor não entregou esta cena." };
  }
  return { tipo: "gerando", rotulo: ROTULO_DO_PEDIDO[estado] || estado, pedidoId: p.id };
}

const cenaMudou = (c: CenaDoRoteiro) => !!c.video && !!c.video.assinatura && c.video.assinatura !== assinaturaDaCena(c);

function promptDaCena(c: CenaDoRoteiro, total: number, campanha: Campanha) {
  return `Cena ${c.ordem} de ${total} de um Reels vertical (9:16) da campanha "${campanha.nome}". ${c.descricao || c.texto_na_tela || c.fala}. Imagem realista, luz natural, movimento de câmera suave. Sem texto, legenda ou logotipo na imagem.`.slice(0, 2400);
}

/** Linha de confirmação do custo (o valor que o servidor devolveu no 409). */
function ConfirmarCusto({ mensagem, custo, ocupado, onConfirmar, onCancelar }: { mensagem: string; custo: number; ocupado: boolean; onConfirmar: () => void; onCancelar: () => void }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center border-y border-border py-2" role="alertdialog" aria-label="Confirmar o custo">
      <span className={juntar(texto.corpo, "mr-3 min-w-0")}>{mensagem}</span>
      <span className="ml-auto flex shrink-0 items-center">
        <button type="button" className={juntar(botao.discreto, "mr-1")} onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </button>
        <button type="button" className={botao.primario} onClick={onConfirmar} disabled={ocupado}>
          {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Confirmar {usd(custo)}
        </button>
      </span>
    </div>
  );
}

function VideoDaCena({ arquivo }: { arquivo: ArquivoDeVideo }) {
  const url = useUrlDaMesa(arquivo.storage_path, arquivo.storage_bucket);
  if (!url.data) return null;
  return <video className="mt-2 block h-40 w-auto rounded-md bg-muted" src={url.data} controls muted playsInline preload="metadata" aria-label={`Vídeo de ${arquivo.nome}`} />;
}

function AudioDoMesa({ caminho, rotulo }: { caminho: string; rotulo: string }) {
  const url = useUrlDaMesa(caminho, "mesa");
  if (!url.data) return null;
  return <audio className="mt-2 block w-full" controls src={url.data} preload="none" aria-label={rotulo} />;
}

// ------------------------------------------------------------------ 1. roteiro e cenas

const cenaVazia = (ordem: number): CenaDoRoteiro => ({ ordem, descricao: "", fala: "", texto_na_tela: "", segundos: 4 });

function PassoRoteiro({ campanha, propostaId, item, roteiro, aplicar }: { campanha: Campanha; propostaId: string; item: ItemProposto; roteiro: RoteiroDeVideo | null; aplicar: (r: RespostaDaPeca) => void }) {
  const { clientId, catalogo } = useMesa();
  const modelo = useModeloDoEscopo("roteiro");
  const [rascunho, setRascunho] = useState<RoteiroDeVideo | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Frente B (23/10): o porquê do Jev entre as duas versões de cenas (some ao sair do passo).
  const [porque, setPorque] = useState<string | null>(null);
  const r = rascunho || roteiro;
  if (!r) {
    return (
      <div className="min-w-0" data-passo-do-gerar="roteiro">
        <div className="flex min-w-0 flex-wrap items-center">
          <span className={juntar(texto.auxiliar, "mr-3")}>Sem roteiro ainda.</span>
          <BotaoComCusto
            rotulo="Gerar o roteiro"
            titulo="Roteiro do vídeo"
            descricao="2 versões de cenas com os ganchos virais do nicho e a fase da campanha; o Jev escolhe a mais forte"
            partes={() => partesDasCenasDaPeca(catalogo, modelo.modeloId)}
            executar={async () => {
              const res = await gerarEGuardarCenasDaPeca({ clientId, campanhaId: campanha.id, propostaId, temaId: item.tema_id || "", modeloId: modelo.modeloId || null });
              setPorque(res.escolha && res.escolha.porque ? res.escolha.porque : null);
              if (res.item) aplicar({ item: res.item, proposta: res.proposta });
              else {
                // Gerado e não salvo: as cenas ficam na tela com o Salvar (sem gerar de novo).
                setRascunho(res.roteiro);
                toast.warning("Cenas geradas, mas não salvas na peça", { description: `${res.erro_ao_salvar || ""} Clique em Salvar o roteiro.`.trim() });
              }
              return res;
            }}
            className="h-8 px-2"
          />
        </div>
        <div className="mt-2 min-w-0 max-w-md">
          <SeletorDoModeloDoEscopo estado={modelo} />
        </div>
      </div>
    );
  }
  const mudar = (m: Partial<RoteiroDeVideo>) => setRascunho((x) => ({ ...((x || roteiro) as RoteiroDeVideo), ...m }));
  const mudarCena = (k: number, m: Partial<CenaDoRoteiro>) => mudar({ cenas: r.cenas.map((c, i) => (i === k ? { ...c, ...m } : c)) });
  const salvar = async () => {
    if (!rascunho) return;
    setSalvando(true);
    try {
      const data = await editarItemDaProposta(propostaId, item.tema_id || "", { roteiro_video: rascunho });
      aplicar({ item: data && data.item, proposta: data && data.proposta });
      setRascunho(null);
      toast.success("Roteiro salvo");
    } catch (e) {
      toast.error("Roteiro não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  const total = r.cenas.reduce((s, c) => s + (Number(c.segundos) || 0), 0);
  return (
    <div className="min-w-0 space-y-3" data-passo-do-gerar="roteiro">
      {porque && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")} data-escolha-do-jev="">Jev: {porque}</p>}
      <label className={juntar(texto.rotulo, "block")}>
        Gancho
        <input className={juntar(campo, "mt-1")} value={r.gancho} onChange={(e) => mudar({ gancho: e.target.value })} aria-label="Gancho do vídeo" />
      </label>
      <ol className="min-w-0 space-y-3" aria-label="Cenas do roteiro">
        {r.cenas.map((c, k) => (
          <li key={k} className="min-w-0 border-t border-border pt-3 first:border-t-0 first:pt-0" data-cena-do-roteiro={k + 1}>
            <div className="flex min-w-0 items-center">
              <span className={juntar(texto.rotulo, "mr-2")}>Cena {k + 1}</span>
              <input
                type="number"
                min={1}
                max={MAX_SEGUNDOS_DA_CENA}
                value={c.segundos}
                onChange={(e) => mudarCena(k, { segundos: Math.max(1, Math.min(MAX_SEGUNDOS_DA_CENA, Number(e.target.value) || 1)) })}
                className={juntar(campo, "h-8 w-16 px-2")}
                aria-label={`Segundos da cena ${k + 1}`}
              />
              <span className={juntar(texto.auxiliar, "ml-1")}>s</span>
              <button type="button" className={juntar(botao.icone, "ml-auto")} onClick={() => mudar({ cenas: r.cenas.filter((_x, i) => i !== k) })} disabled={r.cenas.length <= 1} aria-label={`Tirar a cena ${k + 1}`} title={`Tirar a cena ${k + 1}`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <textarea className={juntar(campoTexto, "mt-2 min-h-[56px]")} rows={2} value={c.descricao} onChange={(e) => mudarCena(k, { descricao: e.target.value })} placeholder="O que aparece" aria-label={`O que aparece na cena ${k + 1}`} />
            <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              <input className={campo} value={c.fala} onChange={(e) => mudarCena(k, { fala: e.target.value })} placeholder="Fala" aria-label={`Fala da cena ${k + 1}`} />
              <input className={campo} value={c.texto_na_tela} onChange={(e) => mudarCena(k, { texto_na_tela: e.target.value })} placeholder="Texto na tela" aria-label={`Texto na tela da cena ${k + 1}`} />
            </div>
          </li>
        ))}
      </ol>
      <div className="flex min-w-0 items-center">
        <button type="button" className={botao.icone} onClick={() => mudar({ cenas: r.cenas.concat([cenaVazia(r.cenas.length + 1)]).slice(0, MAX_CENAS) })} disabled={r.cenas.length >= MAX_CENAS} aria-label="Acrescentar cena" title="Acrescentar cena">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className={juntar(texto.auxiliar, "ml-2 mr-auto tabular-nums")}>{r.cenas.length} cenas · {total} s</span>
        {rascunho && (
          <>
            <button type="button" className={juntar(botao.discreto, "mr-1")} onClick={() => setRascunho(null)} disabled={salvando}>
              Desfazer
            </button>
            <button type="button" className={botao.secundario} onClick={() => void salvar()} disabled={salvando}>
              {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Salvar o roteiro
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 2. cenas em vídeo

type PedidoPendente = { cenas: Array<{ ordem: number; corpo: Record<string, unknown>; usd: number }>; total: number; mensagem: string };

function PassoCenas({ campanha, item, roteiro, estados, aplicar }: { campanha: Campanha; item: ItemProposto; roteiro: RoteiroDeVideo; estados: EstadoDaCena[]; aplicar: (r: RespostaDaPeca) => void }) {
  const { clientId, atualizarCusto } = useMesa();
  const qc = useQueryClient();
  const motores = useMotoresDaMesa();
  const [motorId, setMotorId] = useEstadoDaTela<string>(`mesa:gerar-video:motor:${clientId}`, MOTOR_PADRAO_DAS_CENAS);
  const [pendente, setPendente] = useState<PedidoPendente | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const opcoes = motores.lista.filter((x) => x.motor.familia === "video" && !x.motor.escolha_manual && atende(x.motor, { modo: "texto", formato: "9:16" }));
  const escolhida = opcoes.find((x) => x.motor.id === motorId) || opcoes.find((x) => x.motor.id === MOTOR_PADRAO_DAS_CENAS) || opcoes[0];
  const motor: MotorDeVideo | null = escolhida ? escolhida.motor : null;
  const comFala = falasDaNarracao(roteiro).length > 0;
  const tempos = duracoesDasCenas(roteiro);
  const faltam = roteiro.cenas.filter((c, k) => estados[k].tipo === "sem_video" || estados[k].tipo === "erro" || cenaMudou(c)).map((c) => c.ordem);

  const corpoDa = (ordem: number) => {
    const c = roteiro.cenas.find((x) => x.ordem === ordem) as CenaDoRoteiro;
    const alvo = (tempos.find((t) => t.ordem === ordem) || { duracao_s: c.segundos }).duracao_s;
    const m = motor as MotorDeVideo;
    return {
      acao: "gerar_video",
      tipo: "gerar_livre",
      client_id: clientId,
      motor: m.id,
      modo: "texto",
      prompt: promptDaCena(c, roteiro.cenas.length, campanha),
      duracao_s: duracaoNoMotor(m, Math.ceil(alvo)),
      formato: "9:16",
      resolucao: m.resolucao_padrao,
      // Com narração, o som é a voz e a trilha: o motor não põe áudio.
      audio: !comFala && !!m.cap.audio,
      variacoes: 1,
      titulo: `${campanha.nome} · ${item.tema || "Vídeo"} · cena ${ordem}`.slice(0, 120),
    } as Record<string, unknown>;
  };
  const estimativaLocal = (ordens: number[]) => (motor ? ordens.reduce((s, o) => s + (Number(custoNaTela(motor, { duracao_s: Number(corpoDa(o).duracao_s), resolucao: motor.resolucao_padrao, audio: !!corpoDa(o).audio, variacoes: 1 }).usd) || 0), 0) : 0);

  async function pedirCusto(ordens: number[]) {
    if (!motor || !ordens.length) return;
    setOcupado(true);
    try {
      const cenas = await Promise.all(
        ordens.map(async (ordem) => {
          const corpo = { ...corpoDa(ordem), uid: novoUid() };
          try {
            await chamarMesaVideos(corpo);
          } catch (e) {
            if (e instanceof ErroDaMesa && e.codigo === "confirmar_custo") {
              const c = (e.detalhes || {}).custo_estimado as { usd?: unknown } | undefined;
              return { ordem, corpo, usd: Number(c && c.usd) || 0 };
            }
            throw e;
          }
          throw new Error("O servidor não pediu a confirmação do custo.");
        }),
      );
      const total = Math.round(cenas.reduce((s, c) => s + c.usd, 0) * 10000) / 10000;
      setPendente({ cenas, total, mensagem: `${cenas.length === 1 ? "A cena" : `${cenas.length} cenas`} em vídeo (${motor.rotulo}) custam cerca de ${usd(total)}.` });
    } catch (e) {
      toast.error("Não deu para calcular o custo", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function gerar(p: PedidoPendente) {
    setOcupado(true);
    const feitos: Array<{ ordem: number; pedido_id: string; motor: string }> = [];
    const falhas: string[] = [];
    try {
      for (const c of p.cenas) {
        try {
          const r = await chamarMesaVideos<{ pedido_id?: string }>({ ...c.corpo, custo_confirmado_usd: c.usd });
          if (r && r.pedido_id) feitos.push({ ordem: c.ordem, pedido_id: r.pedido_id, motor: String(c.corpo.motor) });
          else falhas.push(`Cena ${c.ordem}: o servidor não confirmou o pedido.`);
        } catch (e) {
          falhas.push(`Cena ${c.ordem}: ${textoDoErro(e)}`);
        }
      }
      if (feitos.length) aplicar(await registrarNaPeca(campanha.id, item.tema_id || "", { cenas: feitos }));
      setPendente(null);
      atualizarCusto();
      void qc.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
      if (falhas.length) toast.warning("Parte das cenas não foi pedida", { description: falhas.join(" ") });
      else toast.success(feitos.length === 1 ? "Cena pedida ao motor" : `${feitos.length} cenas pedidas ao motor`);
    } catch (e) {
      toast.error("As cenas não foram registradas na peça", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3" data-passo-do-gerar="cenas">
      <div className="flex min-w-0 flex-wrap items-center">
        <select className={juntar(campo, "mb-2 mr-2 w-auto")} value={motor ? motor.id : ""} onChange={(e) => setMotorId(e.target.value)} aria-label="Motor das cenas" title="Motor das cenas">
          {opcoes.map((x) => (
            <option key={x.motor.id} value={x.motor.id}>
              {x.motor.rotulo}
              {x.estado !== "pronto" ? ` (${x.estado_rotulo.toLowerCase()})` : ""}
            </option>
          ))}
        </select>
        <button type="button" className={juntar(botao.primario, "mb-2 ml-auto")} disabled={!motor || !faltam.length || ocupado || !!pendente} onClick={() => void pedirCusto(faltam)}>
          {ocupado && !pendente ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {faltam.length ? `Gerar ${faltam.length === 1 ? "1 cena" : `${faltam.length} cenas`} · ~${usd(estimativaLocal(faltam))}` : "Cenas geradas"}
        </button>
      </div>
      {pendente && <ConfirmarCusto mensagem={pendente.mensagem} custo={pendente.total} ocupado={ocupado} onCancelar={() => setPendente(null)} onConfirmar={() => void gerar(pendente)} />}
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Cenas em vídeo">
        {roteiro.cenas.map((c, k) => {
          const e = estados[k];
          const mudou = cenaMudou(c);
          const situacao = e.tipo === "sem_video" ? "sem vídeo" : e.tipo === "gerando" ? e.rotulo : e.tipo === "erro" ? "não saiu" : mudou ? "a cena mudou" : "pronta";
          return (
            <li key={c.ordem} className={juntar(lista.linha, "block")} data-cena-em-video={c.ordem} data-estado-da-cena={e.tipo}>
              <div className="flex min-w-0 items-center">
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")} title={c.descricao}>
                  Cena {c.ordem} · {c.descricao || c.texto_na_tela || "sem descrição"}
                </span>
                <span className={juntar(texto.auxiliar, "ml-2 shrink-0", (e.tipo === "erro" || mudou) && "text-warning")} title={e.tipo === "erro" ? e.motivo : undefined}>
                  {e.tipo === "gerando" ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                  {situacao}
                </span>
                {(e.tipo === "pronta" || e.tipo === "erro") && (
                  <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => void pedirCusto([c.ordem])} disabled={!motor || ocupado || !!pendente} aria-label={`Refazer a cena ${c.ordem}`} title="Refazer esta cena">
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {e.tipo === "pronta" && e.arquivo && <VideoDaCena arquivo={e.arquivo} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ 3. narração

function PassoNarracao({ campanha, item, roteiro, aplicar }: { campanha: Campanha; item: ItemProposto; roteiro: RoteiroDeVideo; aplicar: (r: RespostaDaPeca) => void }) {
  const { clientId, atualizarCusto } = useMesa();
  const situacao = situacaoDaNarracao(roteiro);
  const vozes = useQuery({ queryKey: chaveDasVozes(campanha.id), queryFn: () => lerVozesDaNarracao(campanha.id), enabled: situacao !== "sem_falas", staleTime: 10 * 60_000, retry: false });
  const [vozId, setVozId] = useEstadoDaTela<string>(`mesa:gerar-video:voz:${clientId}`, roteiro.narracao ? roteiro.narracao.voz.voice_id : "");
  const [modelo, setModelo] = useEstadoDaTela<string>(`mesa:gerar-video:modelo-da-voz:${clientId}`, MODELO_DE_VOZ_PADRAO);
  const [pendente, setPendente] = useState<{ mensagem: string; custo: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (situacao === "sem_falas") return <p className={texto.auxiliar} data-passo-do-gerar="narracao">Sem falas no roteiro: o vídeo sai sem narração.</p>;
  const lista_ = (vozes.data && vozes.data.vozes) || [];
  const voz = lista_.find((v) => v.voice_id === vozId) || lista_.find((v) => v.padrao) || lista_[0] || null;
  const estimativa = pedidoDaNarracao(roteiro, modelo);

  async function pedir(confirmado: boolean) {
    if (!voz) return;
    setOcupado(true);
    try {
      const r = await gerarNarracaoDaPeca({ campanhaId: campanha.id, temaId: item.tema_id || "", vozId: voz.voice_id, vozNome: voz.nome, modelo, confirmado });
      if (r.situacao === "confirmar_custo") {
        setPendente({ mensagem: r.mensagem, custo: r.custo_estimado_usd });
        return;
      }
      setPendente(null);
      aplicar({ item: r.item, proposta: r.proposta });
      atualizarCusto();
      if (r.avisos.length) toast.warning("Narração pronta", { description: r.avisos.join(" ") });
      else toast.success("Narração pronta", { description: usd(r.custo_usd) });
    } catch (e) {
      toast.error("A narração não saiu", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3" data-passo-do-gerar="narracao" data-situacao-da-narracao={situacao}>
      {vozes.data && !vozes.data.tem_chave && (
        <p className={juntar(texto.auxiliar, "text-destructive")} role="alert">
          {vozes.data.aviso_chave || "Falta a chave da ElevenLabs no servidor."}
        </p>
      )}
      {vozes.isError && <p className={juntar(texto.auxiliar, "text-destructive")} role="alert">{textoDoErro(vozes.error)}</p>}
      <div className="flex min-w-0 flex-wrap items-center">
        <select className={juntar(campo, "mb-2 mr-2 w-auto min-w-[180px]")} value={voz ? voz.voice_id : ""} onChange={(e) => setVozId(e.target.value)} aria-label="Voz da narração" disabled={!lista_.length}>
          {!lista_.length && <option value="">{vozes.isLoading ? "Lendo as vozes…" : "Nenhuma voz"}</option>}
          {lista_.map((v) => (
            <option key={v.voice_id} value={v.voice_id}>
              {v.nome}
              {v.da_marca ? " · da marca" : ""}
            </option>
          ))}
        </select>
        <select className={juntar(campo, "mb-2 mr-2 w-auto")} value={modelo} onChange={(e) => setModelo(e.target.value)} aria-label="Modelo da voz">
          {MODELOS_DE_VOZ.map((m) => (
            <option key={m.id} value={m.id}>
              {m.rotulo}
            </option>
          ))}
        </select>
        <button type="button" className={juntar(botao.primario, "mb-2 ml-auto")} disabled={!voz || ocupado || !!pendente} onClick={() => void pedir(false)}>
          {ocupado && !pendente ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {roteiro.narracao ? "Gerar de novo" : "Gerar narração"} · ~{usd(estimativa.custo_usd)}
        </button>
      </div>
      {voz && voz.previa_url && <audio className="block w-full" controls src={voz.previa_url} preload="none" aria-label={`Prévia da voz ${voz.nome}`} />}
      {pendente && <ConfirmarCusto mensagem={pendente.mensagem} custo={pendente.custo} ocupado={ocupado} onCancelar={() => setPendente(null)} onConfirmar={() => void pedir(true)} />}
      {roteiro.narracao && (
        <div className="min-w-0" data-narracao-da-peca={situacao}>
          <span className={juntar(texto.auxiliar, situacao === "desatualizada" && "text-warning")}>
            {roteiro.narracao.voz.nome} · {Math.round(roteiro.narracao.duracao_s)} s · {situacao === "em_dia" ? "em dia com as falas" : "as falas mudaram: gere de novo"}
          </span>
          <AudioDoMesa caminho={roteiro.narracao.arquivo} rotulo="Ouvir a narração" />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 4. trilha

function PassoTrilha({ campanha, trilha, usar, setUsar }: { campanha: Campanha; trilha: ReturnType<typeof trilhaSugeridaDaCampanha>; usar: boolean; setUsar: (v: boolean) => void }) {
  const [trocando, setTrocando] = useState(false);
  return (
    <div className="min-w-0 space-y-3" data-passo-do-gerar="trilha">
      {trilha ? (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center">
            <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")} title={trilha.titulo}>
              {trilha.titulo}
            </span>
            <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{Math.round(trilha.duracao)} s</span>
            <label className={juntar(texto.auxiliar, "ml-3 flex shrink-0 items-center")}>
              <input type="checkbox" className="mr-1.5" checked={usar} onChange={(e) => setUsar(e.target.checked)} />
              Usar no vídeo
            </label>
            <button type="button" className={juntar(botao.discreto, "ml-1")} onClick={() => setTrocando((v) => !v)}>
              {trocando ? "Fechar" : "Trocar"}
            </button>
          </div>
          <AudioDoMesa caminho={trilha.arquivo} rotulo="Ouvir a trilha da campanha" />
        </div>
      ) : (
        <div className="flex min-w-0 items-center">
          <span className={juntar(texto.auxiliar, "mr-auto")}>Sem trilha escolhida na campanha.</span>
          <button type="button" className={botao.discreto} onClick={() => abrirParteDaCampanha(campanha.id, "trilha")}>
            Abrir Trilha e efeitos
          </button>
        </div>
      )}
      {(!trilha || trocando) && (
        <Suspense fallback={<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Abrindo a trilha" />}>
          <CampanhaTrilha campanha={campanha} />
        </Suspense>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 5. montar

function PassoMontar({ campanha, item, roteiro, estados, trilha, aplicar }: { campanha: Campanha; item: ItemProposto; roteiro: RoteiroDeVideo; estados: EstadoDaCena[]; trilha: ReturnType<typeof trilhaSugeridaDaCampanha>; aplicar: (r: RespostaDaPeca) => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [versaoLocal, setVersaoLocal] = useState<string | null>(null);
  const versaoId = versaoLocal || (roteiro.montagem ? roteiro.montagem.versao_id : null);
  const fila = useFilaDeRender(clientId, versaoId, chamarEditorVideo, undefined, true);
  const pedido = fila.pedidos[0];
  const estadoDoRender = pedido ? pedido.estado : null;
  useEffect(() => {
    if (estadoDoRender === "pronto") {
      void qc.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      void qc.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
    }
  }, [estadoDoRender, clientId, qc]);
  const faltando = roteiro.cenas.filter((_c, k) => estados[k].tipo !== "pronta" || !(estados[k] as { arquivo?: ArquivoDeVideo | null }).arquivo).map((c) => c.ordem);
  const situacao = situacaoDaNarracao(roteiro);
  const rodando = !!pedido && (pedido.estado === "fila" || pedido.estado === "rodando");
  const motivo = faltando.length ? `Falta o vídeo ${faltando.length === 1 ? "da cena" : "das cenas"} ${faltando.join(", ")}.` : situacao === "desatualizada" ? "As falas mudaram: gere a narração de novo." : null;

  async function montar() {
    setOcupado(true);
    try {
      const clipes: ClipeDaCena[] = roteiro.cenas.map((c, k) => {
        const e = estados[k] as Extract<EstadoDaCena, { tipo: "pronta" }>;
        const a = e.arquivo as ArquivoDeVideo;
        const pedida = Number(e.pedido.parametros && e.pedido.parametros.duracao_s) || 0;
        return { ordem: c.ordem, arquivo_id: a.id, nome: a.nome, tipo: a.tipo, storage_bucket: a.storage_bucket, storage_path: a.storage_path, duracao_s: Number(a.duracao_s) || pedida, largura: a.largura, altura: a.altura };
      });
      const { projeto, avisos } = projetoDoVideoDaCampanha({ clientId, titulo: `${campanha.nome} · ${item.tema || "Vídeo"}`.slice(0, 120), roteiro, clipes, trilha, agora: new Date().toISOString() });
      const r = await chamarMesaVideos<{ versao?: { id: string; projeto?: { revisao?: number } } }>({ acao: "versao_registrar", client_id: clientId, titulo: projeto.titulo, estado: "rascunho", projeto, nota: `Vídeo gerado da campanha ${campanha.nome}, peça ${item.tema || ""}`.slice(0, 300) });
      if (!r || !r.versao || !r.versao.id) throw new Error("Não foi possível confirmar a versão.");
      const novaVersao = r.versao.id;
      setVersaoLocal(novaVersao);
      try {
        aplicar(await registrarNaPeca(campanha.id, item.tema_id || "", { montagem: { versao_id: novaVersao } }));
      } catch (e) {
        toast.warning("A versão não ficou marcada na peça", { description: textoDoErro(e) });
      }
      await pedirRender(chamarEditorVideo, { clientId, versaoId: novaVersao, tipo: "render_final", uid: uidDoClique(), revisao: r.versao.projeto && typeof r.versao.projeto.revisao === "number" ? r.versao.projeto.revisao : null });
      void qc.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
      if (avisos.length) toast.warning("Vídeo na fila do render", { description: avisos.join(" ") });
      else toast.success("Vídeo na fila do render");
    } catch (e) {
      toast.error("O vídeo não foi montado", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3" data-passo-do-gerar="montar">
      <div className="flex min-w-0 flex-wrap items-center">
        <span className={juntar(texto.auxiliar, "mb-2 mr-auto", motivo && "text-warning")}>
          {motivo || `${roteiro.cenas.length} cenas${situacao === "em_dia" ? " · narração" : ""}${trilha ? " · trilha" : ""} · sem custo de IA`}
        </span>
        <button type="button" className={juntar(botao.primario, "mb-2")} disabled={!!motivo || ocupado || rodando} onClick={() => void montar()}>
          {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {versaoId ? "Montar de novo" : "Montar o vídeo"}
        </button>
      </div>
      {pedido && (
        <p role="status" className={texto.auxiliar} data-render-do-gerar={pedido.estado}>
          {rotuloDoPedido(pedido, Date.now(), fila.worker)}
        </p>
      )}
      {fila.erro && (
        <p role="alert" className={juntar(texto.auxiliar, "text-destructive")}>
          {fila.erro}
        </p>
      )}
      {pedido && pedido.estado === "pronto" && versaoId && (
        <div className="flex min-w-0 flex-wrap items-center">
          {pedido.url && (
            <a className={juntar(botao.secundario, "mb-2 mr-2")} href={pedido.url} download={`${campanha.nome}-${item.tema || "video"}.mp4`} target="_blank" rel="noreferrer">
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Baixar vídeo
            </a>
          )}
          <Link className={juntar(botao.discreto, "mb-2")} to={`/mesa-edicao?client=${clientId}&etapa=editar&versao=${versaoId}`}>
            <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Abrir na Edição
          </Link>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ o componente

export default function GerarVideoDaCampanha({ clientId, campanha, propostaId, item, aoAtualizar }: PropsDoGerarVideo) {
  const qc = useQueryClient();
  const temaId = item.tema_id || "";
  // O item que voltou do servidor vale até o pai mandar outro (a série relida).
  const [local, setLocal] = useState<{ base: ItemProposto; item: ItemProposto } | null>(null);
  const atual = local && local.base === item ? local.item : item;
  const roteiro = normalizarRoteiroDeVideo((atual as ItemProposto & { roteiro_video?: unknown }).roteiro_video);
  const [passo, setPasso] = useEstadoDaTela<Passo>(`mesa:gerar-video:${clientId}:${campanha.id}:${temaId}`, "roteiro", { validar: (v) => PASSOS.some((p) => p.valor === v) });
  const [usarTrilha, setUsarTrilha] = useEstadoDaTela<boolean>(`mesa:gerar-video:usar-trilha:${clientId}:${campanha.id}`, true);
  const pedidos = usePedidos(clientId);
  const arquivos = useArquivosDeVideo(clientId);
  const daAba = useQuery<EstadoDaTrilha>({ queryKey: chaveDaTrilha(campanha.id), queryFn: () => lerTrilhaDaCampanha(campanha.id), enabled: false });
  const trilhaDaCampanha = daAba.data ? daAba.data.escolhida : trilhaSugeridaDaCampanha(campanha.briefing);
  const trilha = usarTrilha ? trilhaDaCampanha : null;
  const listaDePedidos = (pedidos.data && pedidos.data.itens) || [];
  const listaDeArquivos = (arquivos.data && arquivos.data.arquivos) || [];
  const estados = roteiro ? roteiro.cenas.map((c) => estadoDaCena(c, listaDePedidos, listaDeArquivos)) : [];

  const aplicar = (r: RespostaDaPeca) => {
    if (r && r.proposta && propostaId) qc.setQueryData(chaves.proposta(propostaId), r.proposta);
    if (r && r.item) setLocal({ base: item, item: r.item });
    if (aoAtualizar) aoAtualizar(r);
  };

  // Cena pronta sem o arquivo na lista: relê o acervo uma vez.
  const semArquivo = estados.some((e) => e.tipo === "pronta" && !e.arquivo);
  useEffect(() => {
    if (semArquivo) void qc.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
  }, [semArquivo, clientId, qc]);

  // Cenas na fila do motor: confere a cada 20 s com a aba à vista (o servidor também coleta a cada minuto).
  const emAndamento = estados.filter((e): e is Extract<EstadoDaCena, { tipo: "gerando" }> => e.tipo === "gerando").map((e) => e.pedidoId);
  const assinatura = emAndamento.join("|");
  const [rodada, setRodada] = useState(0);
  useEffect(() => {
    if (!emAndamento.length) return;
    let vivo = true;
    const t = window.setTimeout(async () => {
      if (typeof document === "undefined" || !document.hidden) {
        await Promise.allSettled(emAndamento.map((id) => chamarMesaVideos({ acao: "gerar_status", pedido_id: id })));
        if (!vivo) return;
        void qc.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
        void qc.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      }
      if (vivo) setRodada((x) => x + 1);
    }, CONFERIR_A_CADA_MS);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, rodada, clientId]);

  const situacao = situacaoDaNarracao(roteiro);
  const feitas: Record<Passo, boolean> = {
    roteiro: !!roteiro,
    cenas: !!roteiro && estados.length > 0 && estados.every((e, k) => e.tipo === "pronta" && !cenaMudou(roteiro.cenas[k])),
    narracao: !!roteiro && (situacao === "em_dia" || situacao === "sem_falas"),
    trilha: !!trilhaDaCampanha,
    montar: !!roteiro && !!roteiro.montagem,
  };
  const aberto: Passo = !roteiro ? "roteiro" : passo;

  return (
    <div className="min-w-0 space-y-4" data-gerar-video-da-peca={temaId}>
      <Etapas
        rotulo="Passos do vídeo gerado"
        numerar
        valor={aberto}
        onEscolher={(v) => {
          if (!roteiro && v !== "roteiro") {
            toast.message("Primeiro o roteiro", { description: "As cenas, a narração e a montagem saem dele." });
            return;
          }
          setPasso(v as Passo);
        }}
        itens={PASSOS.map((p) => ({ valor: p.valor, rotulo: p.rotulo, feita: feitas[p.valor], fechada: !roteiro && p.valor !== "roteiro" }))}
      />
      {aberto === "roteiro" && <PassoRoteiro key={temaId} campanha={campanha} propostaId={propostaId} item={atual} roteiro={roteiro} aplicar={aplicar} />}
      {roteiro && aberto === "cenas" && <PassoCenas campanha={campanha} item={atual} roteiro={roteiro} estados={estados} aplicar={aplicar} />}
      {roteiro && aberto === "narracao" && <PassoNarracao campanha={campanha} item={atual} roteiro={roteiro} aplicar={aplicar} />}
      {roteiro && aberto === "trilha" && <PassoTrilha campanha={campanha} trilha={trilhaDaCampanha} usar={usarTrilha} setUsar={setUsarTrilha} />}
      {roteiro && aberto === "montar" && <PassoMontar campanha={campanha} item={atual} roteiro={roteiro} estados={estados} trilha={trilha} aplicar={aplicar} />}
    </div>
  );
}
