import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clapperboard, Code2, Film, Loader2, Play, RotateCcw, Sparkles, Square } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { chamarMesaVideos } from "@/components/mesa-videos/videosApi";
import { causaDoRender, pecaPorId, pedidoComACausa, tokensDeEntradaDaCena, type FormatoDoMotion } from "../../../supabase/functions/mesa-motion/modulos/cena-hf";
import { ROTULO_DA_ETAPA, type EtapaDoRender } from "../../../supabase/functions/_shared/render-do-editor";
import { chaveDoPedido, renderDaCena, TAMANHOS_DO_MOTION, TETO_PADRAO_DA_CENA_USD, type CenaDaLinha } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { ComFilme, ModeloDaAcao, useModeloDaAcao } from "./FilmeAberto";
import CenaNaFila from "./CenaNaFila";
import EditorDaCena from "./EditorDaCena";
import { chamarMotion, CHAVES, erroDaChave, type FilaDoFilme, type Filme, finaisQueFaltam, pedidoAtivoDaChave, type PedidoDoMotion, resumoDasFinais, uidDoClique, useFilaDoFilme, useGuardarFilme } from "./motionApi";
import { useAcoesDaCena } from "./useAcoesDaCena";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 6: construção. Cena em código (peça do kit ou escrita sob medida pelo
 * modelo escolhido, uma por vez, com teto e sem laço), amostra de 5 s e a
 * cena final com alfa em cada formato, pela fila da máquina da agência. No
 * filme da marca, o plano de vídeo é gerado pela Mesa Vídeos (custo por
 * plano e Confirmar) ou escolhido do acervo real do cliente.
 */

type EscritaRecusada = { html: string; css: string; js: string };

/** A causa do último render desta cena, quando ele falhou no lint ou no check do worker. */
function causaDoUltimoRender(fila: FilaDoFilme | undefined, cenaId: string): string | null {
  if (!fila) return null;
  const ultimo = fila.pedidos.find((p) => p.tipo === "cena_hf" && p.entrada && p.entrada.cena_id === cenaId);
  return ultimo && ultimo.estado === "erro" ? causaDoRender(ultimo.erro_mensagem) : null;
}

function EscreverCena({ filme, cena, fila }: { filme: Filme; cena: CenaDaLinha; fila?: FilaDoFilme }) {
  const { atualizarCusto } = useMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const { modelo } = useModeloDaAcao("cena");
  const [pedido, setPedido] = useState(cena.ideia || "");
  const [teto, setTeto] = useState(TETO_PADRAO_DA_CENA_USD);
  const [indo, setIndo] = useState(false);
  const [resultado, setResultado] = useState<{ custo: number; recusada: string[] | null; escrita: EscritaRecusada | null } | null>(null);
  // SPM: reescrever com a causa (recusa da conferência ou lint do worker). Sob pedido e com o custo à vista; nunca em laço.
  // A escrita que falhou vai junto: a recusada volta da função e a do render já está guardada na cena.
  const causaDoLint = cena.modo === "sob_medida" ? causaDoUltimoRender(fila, cena.id) : null;
  const daRecusa = !!(resultado && resultado.recusada && resultado.recusada.length);
  const causas = daRecusa && resultado ? resultado.recusada : causaDoLint ? [causaDoLint] : null;
  const escrever = async (comCausa?: string[]) => {
    setIndo(true);
    try {
      const texto = comCausa ? pedidoComACausa(pedido, comCausa) : pedido.trim();
      const anterior = comCausa && daRecusa && resultado ? resultado.escrita : null;
      const d = await chamarMotion<{ filme: Filme; recusada: string[] | null; escrita_recusada?: EscritaRecusada | null; custo_usd: number }>("cena_escrever", {
        filme_id: filme.id,
        cena_id: cena.id,
        modelo_id: modelo ? modelo.id : undefined,
        pedido: texto || undefined,
        teto_usd: teto,
        ...(anterior ? { escrita_anterior: anterior } : {}),
      });
      guardar(d.filme);
      setResultado({ custo: d.custo_usd, recusada: d.recusada, escrita: d.escrita_recusada || null });
      atualizarCusto();
    } catch (e) {
      avisarErro(e, "A cena não foi escrita");
    } finally {
      setIndo(false);
    }
  };
  return (
    <div className="min-w-0 space-y-2" data-escrever-cena={cena.id}>
      <ModeloDaAcao chave="cena" alvo="cena" />
      <textarea className={juntar(campoTexto, "min-h-[72px]")} value={pedido} maxLength={900} onChange={(e) => setPedido(e.target.value)} placeholder="A ideia da cena com as suas palavras (o que aparece, como se move)" aria-label="Ideia da cena" />
      <div className="flex min-w-0 flex-wrap items-center">
        <label className="mb-2 mr-3 flex items-center">
          <span className={juntar(texto.rotulo, "mr-2")}>Teto US$</span>
          <input className={juntar(campo, "w-20")} type="number" min={0.05} max={2} step={0.05} value={teto} onChange={(e) => setTeto(Number(e.target.value))} aria-label="Teto de gasto da cena" />
        </label>
        <button type="button" className={juntar(botao.secundario, "mb-2")} onClick={() => void escrever()} disabled={indo}>
          {indo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Code2 className="mr-1 h-3.5 w-3.5" />}
          Escrever sob medida
        </button>
        {causas && (
          <button type="button" className={juntar(botao.secundario, "mb-2 ml-2")} onClick={() => void escrever(causas)} disabled={indo} title="Manda ao modelo a causa da falha e a escrita que falhou, para corrigir sem refazer do zero" data-reescrever-com-causa={cena.id}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Reescrever com a causa
          </button>
        )}
        {causas && modelo && (
          <span className="mb-2 ml-2" data-custo-da-reescrita={cena.id}>
            <EstimativaInline partes={[{ modeloId: modelo.id, tipo: "texto", tokensEntrada: tokensDeEntradaDaCena(TAMANHOS_DO_MOTION.cena.entrada, true), tokensSaida: TAMANHOS_DO_MOTION.cena.saida }]} />
          </span>
        )}
      </div>
      {causaDoLint && !(resultado && resultado.recusada) && <p className={juntar(texto.auxiliar, "text-warning")}>{`Último render falhou no ${causaDoLint}`}</p>}
      {resultado && <p className={texto.auxiliar}>Custo: {usd(resultado.custo)}.</p>}
      {resultado && resultado.recusada && (
        <ul className="space-y-1" role="alert">
          <li className={juntar(texto.auxiliar, "text-warning")}>A conferência recusou a escrita (nada foi trocado). Ajuste a ideia e peça de novo, ou fique com a peça do kit:</li>
          {resultado.recusada.map((p) => (
            <li key={p} className={juntar(texto.auxiliar, "text-warning")}>
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Video = { id: string; nome: string; storage_path: string; duracao_s: number | null; tipo: string };

function PlanoDeVideo({ filme, cena, videos }: { filme: Filme; cena: CenaDaLinha; videos: Video[] }) {
  const { clientId, atualizarCusto } = useMesa();
  const avisarErro = useAvisarErro();
  const a = useAcoesDaCena(filme);
  const [custo, setCusto] = useState<{ motor: string; custo: number } | null>(null);
  const [indo, setIndo] = useState(false);
  const formato = filme.formatos[0] || "16:9";
  const estimar = async () => {
    setIndo(true);
    try {
      const m = await chamarMesaVideos<{ sugestao?: { normal?: string } }>({ acao: "motores_estado", client_id: clientId });
      const motor = (m.sugestao && m.sugestao.normal) || "";
      if (!motor) throw new Error("Nenhum motor de vídeo disponível agora.");
      const c = await chamarMesaVideos<{ custo: number }>({ acao: "custo_estimar", client_id: clientId, motor, duracao_s: Math.round(cena.duracao_s) });
      setCusto({ motor, custo: Number(c.custo) || 0 });
    } catch (e) {
      avisarErro(e, "O custo do plano não saiu");
    } finally {
      setIndo(false);
    }
  };
  const gerar = async () => {
    if (!custo) return;
    setIndo(true);
    try {
      await chamarMesaVideos({ acao: "gerar_video", client_id: clientId, motor: custo.motor, modo: "texto", tipo: "gerar_livre", prompt: `${cena.prompt}${cena.camera ? ` Câmera: ${cena.camera}.` : ""}`, duracao_s: Math.round(cena.duracao_s), formato, titulo: `${filme.nome}: ${cena.titulo}`.slice(0, 120), uid: uidDoClique("plano"), custo_confirmado_usd: custo.custo });
      atualizarCusto();
      setCusto(null);
    } catch (e) {
      avisarErro(e, "O plano não foi pedido");
    } finally {
      setIndo(false);
    }
  };
  return (
    <div className="min-w-0 space-y-2">
      {cena.tipo_plano === "gerado" && <p className={texto.corpo}>{cena.prompt || "Sem prompt: escreva na etapa Stills."}</p>}
      {cena.tipo_plano === "gerado" && (
        <div className="flex min-w-0 flex-wrap items-center">
          {!custo ? (
            <button type="button" className={juntar(botao.secundario, "mb-2 mr-2")} onClick={() => void estimar()} disabled={indo || !cena.prompt}>
              {indo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              Ver o custo do plano
            </button>
          ) : (
            <button type="button" className={juntar(botao.primario, "mb-2 mr-2")} onClick={() => void gerar()} disabled={indo} data-gerar-plano="">
              {indo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Film className="mr-1 h-3.5 w-3.5" />}
              Gerar por {usd(custo.custo)}
            </button>
          )}
          <span className={texto.auxiliar}>O vídeo gerado chega ao acervo; escolha abaixo quando aparecer.</span>
        </div>
      )}
      <label className="block min-w-0">
        <span className={texto.rotulo}>Vídeo do plano</span>
        <select
          className={campo}
          value={cena.arquivo ? cena.arquivo.id : ""}
          onChange={(e) => {
            const v = videos.find((x) => x.id === e.target.value);
            void a.salvarCena({ id: cena.id, arquivo: v ? { id: v.id, path: v.storage_path, duracao_s: v.duracao_s } : null });
          }}
        >
          <option value="">Escolher do acervo</option>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.nome} {v.duracao_s ? `(${Math.round(v.duracao_s)} s)` : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const andamento = (p: PedidoDoMotion) => (p.estado === "fila" ? "na fila" : `${p.etapa ? ROTULO_DA_ETAPA[p.etapa as EtapaDoRender] || p.etapa : "renderizando"} ${Math.round((Number(p.progresso) || 0) * 100)}%`);

/** Estado curto de um formato da final: na fila, 40%, pronto, desatualizado, erro ou falta. */
function estadoDaFinal(filme: Filme, fila: FilaDoFilme | undefined, cena: CenaDaLinha, f: FormatoDoMotion): string {
  const chave = chaveDoPedido(cena.id, "final", f);
  const ativo = pedidoAtivoDaChave(fila, chave);
  if (ativo) return ativo.estado === "fila" ? "na fila" : `${Math.round((Number(ativo.progresso) || 0) * 100)}%`;
  const r = renderDaCena(filme, cena, "final", f);
  if (r && r.saida_path) return r.em_dia ? "pronto" : "desatualizado";
  return erroDaChave(fila, chave) ? "erro" : "falta";
}

function FinalDaCena({ filme, links, fila, cena, onCancelar }: { filme: Filme; links: Record<string, string>; fila: FilaDoFilme | undefined; cena: CenaDaLinha; onCancelar: (id: string) => void }) {
  const comRender = filme.formatos.find((f) => {
    const r = renderDaCena(filme, cena, "final", f);
    return !!(r && r.saida_path);
  });
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const formato = (escolhido && filme.formatos.indexOf(escolhido as FormatoDoMotion) >= 0 ? escolhido : comRender || filme.formatos[0] || "9:16") as FormatoDoMotion;
  return (
    <div className="min-w-0" data-final-da-cena={cena.id}>
      <span className={juntar(texto.rotulo, "mb-1 block")}>{filme.formatos.length > 1 ? "Cena final" : `Cena final ${formato} · ${estadoDaFinal(filme, fila, cena, formato)}`}</span>
      {filme.formatos.length > 1 && (
        <SeletorCompacto
          className="mb-2"
          rotulo="Formato da cena final"
          listaQuandoNaoCabe
          valor={formato}
          onEscolher={setEscolhido}
          opcoes={filme.formatos.map((f) => ({ valor: f, rotulo: `${f} ${estadoDaFinal(filme, fila, cena, f)}` }))}
        />
      )}
      <CenaNaFila filme={filme} links={links} fila={fila} cena={cena} modo="final" formato={formato} onCancelar={onCancelar} compacta />
      {filme.formatos
        .filter((f) => f !== formato)
        .map((f) => {
          const chave = chaveDoPedido(cena.id, "final", f);
          const ativo = pedidoAtivoDaChave(fila, chave);
          const erro = ativo ? null : erroDaChave(fila, chave);
          if (!ativo && !erro) return null;
          return (
            <p key={f} className={juntar(texto.auxiliar, "mt-1 flex items-center", erro ? "text-destructive" : "")} role={erro ? "alert" : undefined}>
              {ativo ? <Loader2 className="mr-1.5 h-3 w-3 shrink-0 animate-spin" /> : null}
              <span className="min-w-0 flex-1">
                {f}: {ativo ? andamento(ativo) : erro!.erro_mensagem || "Não saiu."}
              </span>
              {ativo && (
                <button type="button" className={juntar(botao.barra, "h-7")} onClick={() => onCancelar(ativo.id)}>
                  <Square className="mr-1 h-3 w-3" />
                  Cancelar
                </button>
              )}
            </p>
          );
        })}
    </div>
  );
}

function Conteudo({ filme, links, irPara }: { filme: Filme; links: Record<string, string>; irPara: IrPara }) {
  const fila = useFilaDoFilme(filme.id);
  const a = useAcoesDaCena(filme);
  const insumos = useQuery({ queryKey: CHAVES.insumos(filme.id), queryFn: () => chamarMotion<{ videos: Video[] }>("insumos_ler", { filme_id: filme.id }), enabled: filme.tipo === "filme_marca", staleTime: 60_000 });
  const [confirmar, setConfirmar] = useState(false);
  // O "Confirmar" do lote de finais volta a ser o botão comum depois de uns segundos.
  useEffect(() => {
    if (!confirmar) return;
    const t = window.setTimeout(() => setConfirmar(false), 6000);
    return () => window.clearTimeout(t);
  }, [confirmar]);
  const formato = filme.formatos[0] || "9:16";
  const prints = Array.isArray(filme.insumos.prints) ? (filme.insumos.prints as Array<{ path: string; nome: string }>) : [];
  const finais = finaisQueFaltam(filme, fila.data);
  const amostras = filme.cenas
    .map((c, i) => ({ c, numero: i + 1 }))
    .filter(({ c }) => {
      if (c.tipo_plano !== "hf" || pedidoAtivoDaChave(fila.data, chaveDoPedido(c.id, "amostra", formato))) return false;
      const r = renderDaCena(filme, c, "amostra", formato);
      return !r || !r.em_dia;
    });

  const pedirFinais = () => {
    if (!confirmar) return setConfirmar(true);
    setConfirmar(false);
    void a.pedirEmLote("finais", finais.map((x) => ({ cenaId: x.cena.id, modo: "final" as const, formatos: x.formatos, rotulo: `Cena ${x.numero}` })));
  };
  const pedirAmostras = () => void a.pedirEmLote("amostras", amostras.map((x) => ({ cenaId: x.c.id, modo: "amostra" as const, rotulo: `Cena ${x.numero}` })));

  if (!filme.cenas.length) return <EstadoVazio icone={<Clapperboard className="h-5 w-5" />} titulo="Escolha um storyboard antes" acao={<button type="button" className={botao.secundario} onClick={() => irPara("storyboards")}>Abrir os storyboards</button>} />;
  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Construção"
        descricao={`${filme.cenas.length} cenas · formatos ${filme.formatos.join(", ")}`}
        ajuda="Amostra de 5 s em meia resolução para conferir o movimento; a final sai em WebM com alfa em cada formato e entra na linha do tempo da Mesa Edição. O worker roda lint e check do HyperFrames: erro volta como aviso, sem nova tentativa sozinha. Dica: faça o Som (trilha e cortes na batida) antes das cenas finais, porque casar os cortes muda a duração e a final sai de novo."
        acao={
          <>
            <button type="button" className={botao.primario} onClick={pedirFinais} disabled={!finais.length || !!a.lote} data-pedir-finais={confirmar ? "confirmar" : ""}>
              {a.lote === "finais" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Film className="mr-1 h-3.5 w-3.5" />}
              {confirmar ? `Confirmar: ${resumoDasFinais(finais)}` : `Cenas finais que faltam (${finais.length ? resumoDasFinais(finais) : "0"})`}
            </button>
            <button type="button" className={botao.secundario} onClick={pedirAmostras} disabled={!amostras.length || !!a.lote} data-pedir-amostras="">
              {a.lote === "amostras" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Amostras que faltam ({amostras.length})
            </button>
          </>
        }
      >
        {fila.data && fila.data.worker.situacao !== "ligado" && <p className={juntar(texto.auxiliar, "text-warning")}>A máquina da agência (worker de render) não está ligada: os pedidos esperam na fila.</p>}
      </Secao>
      {filme.cenas.map((c, i) => (
        <Painel
          key={c.id}
          titulo={`${i + 1}. ${c.titulo}`}
          descricao={`${c.tipo_plano !== "hf" ? (c.tipo_plano === "gerado" ? "Plano gerado" : "Material real") : c.modo === "sob_medida" ? "Sob medida" : (pecaPorId(c.peca) || { rotulo: "" }).rotulo} · ${c.duracao_s} s${c.still_aprovado ? "" : " · still sem aprovação"}`}
          recolher={`mesa-motion:construcao:${c.id}`}
        >
          {c.tipo_plano !== "hf" ? (
            <PlanoDeVideo filme={filme} cena={c} videos={(insumos.data && insumos.data.videos) || []} />
          ) : (
            <div className="min-w-0 space-y-4">
              <div className="flex min-w-0 flex-wrap">
                <button type="button" className={juntar(botao.secundario, "mb-2 mr-2")} onClick={() => void a.pedir(c.id, "amostra")} disabled={a.ocupado === `${c.id}:amostra`}>
                  <Play className="mr-1 h-3.5 w-3.5" />
                  Amostra de 5 s
                </button>
                <button type="button" className={juntar(botao.secundario, "mb-2")} onClick={() => void a.pedir(c.id, "final")} disabled={a.ocupado === `${c.id}:final`}>
                  <Film className="mr-1 h-3.5 w-3.5" />
                  Cena final ({filme.formatos.length} formato{filme.formatos.length > 1 ? "s" : ""})
                </button>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="min-w-0">
                  <span className={juntar(texto.rotulo, "mb-1 block")}>Amostra {formato}</span>
                  <CenaNaFila filme={filme} links={links} fila={fila.data} cena={c} modo="amostra" formato={formato} onCancelar={(id) => void a.cancelar(id)} />
                </div>
                <FinalDaCena filme={filme} links={links} fila={fila.data} cena={c} onCancelar={(id) => void a.cancelar(id)} />
              </div>
              <Secao titulo="Textos da cena" nivel={3} recolher={`mesa-motion:cena:${c.id}`} recolhidaDeInicio>
                <EditorDaCena filme={filme} cena={c} prints={prints} links={links} />
              </Secao>
              <Secao titulo="Escrever sob medida" nivel={3} recolher={`mesa-motion:escrever:${c.id}`} recolhidaDeInicio ajuda="O modelo escreve só o miolo (HTML, CSS e GSAP); o invólucro, as cores, as fontes e a logo são do código. A conferência recusa rede, relógio, sorteio e laço infinito.">
                <EscreverCena filme={filme} cena={c} fila={fila.data} />
              </Secao>
            </div>
          )}
        </Painel>
      ))}
      <button type="button" className={botao.primario} onClick={() => irPara("critica")}>
        Seguir para a crítica
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function EtapaConstrucao({ irPara }: { irPara: IrPara }) {
  return <ComFilme irPara={irPara}>{(filme, links) => <Conteudo key={filme.id} filme={filme} links={links} irPara={irPara} />}</ComFilme>;
}
