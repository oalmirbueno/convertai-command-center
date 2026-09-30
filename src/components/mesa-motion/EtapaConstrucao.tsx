import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Code2, Film, Loader2, Play, Sparkles } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { chamarMesaVideos } from "@/components/mesa-videos/videosApi";
import { pecaPorId } from "../../../supabase/functions/_shared/cena-hf";
import { TETO_PADRAO_DA_CENA_USD, type CenaDaLinha } from "../../../supabase/functions/_shared/motion-metodo";
import { ComFilme, ModeloDaAcao, useModeloDaAcao } from "./FilmeAberto";
import CenaNaFila from "./CenaNaFila";
import { chamarMotion, CHAVES, type Filme, uidDoClique, useFilaDoFilme, useGuardarFilme } from "./motionApi";
import { useAcoesDaCena } from "./useAcoesDaCena";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 6: construção. Cena em código (peça do kit ou escrita sob medida pelo
 * modelo escolhido, uma por vez, com teto e sem laço), amostra de 5 s e a
 * cena final com alfa em cada formato, pela fila da máquina da agência. No
 * filme da marca, o plano de vídeo é gerado pela Mesa Vídeos (custo por
 * plano e Confirmar) ou escolhido do acervo real do cliente.
 */

function EscreverCena({ filme, cena }: { filme: Filme; cena: CenaDaLinha }) {
  const { atualizarCusto } = useMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const { modelo } = useModeloDaAcao("cena");
  const [pedido, setPedido] = useState(cena.ideia || "");
  const [teto, setTeto] = useState(TETO_PADRAO_DA_CENA_USD);
  const [indo, setIndo] = useState(false);
  const [resultado, setResultado] = useState<{ custo: number; recusada: string[] | null } | null>(null);
  const escrever = async () => {
    setIndo(true);
    try {
      const d = await chamarMotion<{ filme: Filme; recusada: string[] | null; custo_usd: number }>("cena_escrever", { filme_id: filme.id, cena_id: cena.id, modelo_id: modelo ? modelo.id : undefined, pedido: pedido.trim() || undefined, teto_usd: teto });
      guardar(d.filme);
      setResultado({ custo: d.custo_usd, recusada: d.recusada });
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
      </div>
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

function Conteudo({ filme, links, irPara }: { filme: Filme; links: Record<string, string>; irPara: IrPara }) {
  const fila = useFilaDoFilme(filme.id);
  const a = useAcoesDaCena(filme);
  const insumos = useQuery({ queryKey: CHAVES.insumos(filme.id), queryFn: () => chamarMotion<{ videos: Video[] }>("insumos_ler", { filme_id: filme.id }), enabled: filme.tipo === "filme_marca", staleTime: 60_000 });
  const formato = filme.formatos[0] || "9:16";
  return (
    <div className="min-w-0 space-y-6">
      <Secao titulo="Construção" descricao={`${filme.cenas.length} cenas · formatos ${filme.formatos.join(", ")}`} ajuda="Amostra de 5 s em meia resolução para conferir o movimento; a final sai em WebM com alfa em cada formato e entra na linha do tempo da Mesa Edição. O worker roda lint e check do HyperFrames: erro volta como aviso, sem nova tentativa sozinha.">
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
                <button type="button" className={juntar(botao.primario, "mb-2")} onClick={() => void a.pedir(c.id, "final")} disabled={a.ocupado === `${c.id}:final`}>
                  <Film className="mr-1 h-3.5 w-3.5" />
                  Cena final ({filme.formatos.length} formato{filme.formatos.length > 1 ? "s" : ""})
                </button>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="min-w-0">
                  <span className={juntar(texto.rotulo, "mb-1 block")}>Amostra {formato}</span>
                  <CenaNaFila filme={filme} links={links} fila={fila.data} cena={c} modo="amostra" formato={formato} onCancelar={(id) => void a.cancelar(id)} />
                </div>
                {filme.formatos.map((f) => (
                  <div key={f} className="min-w-0">
                    <span className={juntar(texto.rotulo, "mb-1 block")}>Final {f}</span>
                    <CenaNaFila filme={filme} links={links} fila={fila.data} cena={c} modo="final" formato={f} onCancelar={(id) => void a.cancelar(id)} compacta />
                  </div>
                ))}
              </div>
              <Secao titulo="Escrever sob medida" nivel={3} recolher={`mesa-motion:escrever:${c.id}`} recolhidaDeInicio ajuda="O modelo escreve só o miolo (HTML, CSS e GSAP); o invólucro, as cores, as fontes e a logo são do código. A conferência recusa rede, relógio, sorteio e laço infinito.">
                <EscreverCena filme={filme} cena={c} />
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
  return <ComFilme>{(filme, links) => <Conteudo key={filme.id} filme={filme} links={links} irPara={irPara} />}</ComFilme>;
}
