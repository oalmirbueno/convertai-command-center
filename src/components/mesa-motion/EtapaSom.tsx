import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, AudioLines, Loader2, Timer } from "lucide-react";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { duracaoTotal, INGREDIENTES, type SomDoFilme } from "../../../supabase/functions/_shared/motion-metodo";
import { ComFilme } from "./FilmeAberto";
import { chamarMotion, CHAVES, type Filme, uidDoClique, useFilaDoFilme, useGuardarFilme } from "./motionApi";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 8: som. Trilha por clima (música do cliente com licença registrada),
 * mapa de batidas medido no worker (andamento, compassos e drop), cortes
 * casados na batida e efeitos CC0 com o pico no quadro do movimento. O arquivo
 * final sai em -14 LUFS.
 */

type Musica = { id: string; nome: string; storage_path: string; duracao_s: number | null };

function Energia({ valores, drop, duracao }: { valores: number[]; drop: number | null; duracao: number }) {
  if (!valores.length) return null;
  const l = 600;
  const h = 48;
  const passo = l / valores.length;
  return (
    <svg viewBox={`0 0 ${l} ${h}`} className="block h-12 w-full max-w-[600px]" role="img" aria-label="Energia da trilha por segundo">
      {valores.map((v, i) => (
        <rect key={i} x={i * passo + 1} y={h - Math.max(2, v * h)} width={Math.max(1, passo - 2)} height={Math.max(2, v * h)} className="fill-primary/60" />
      ))}
      {drop !== null && duracao > 0 && <line x1={(drop / duracao) * l} x2={(drop / duracao) * l} y1={0} y2={h} className="stroke-warning" strokeWidth={2} />}
    </svg>
  );
}

function Conteudo({ filme, irPara }: { filme: Filme; irPara: IrPara }) {
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const fila = useFilaDoFilme(filme.id);
  const [indo, setIndo] = useState<string | null>(null);
  const q = useQuery({ queryKey: CHAVES.insumos(filme.id), queryFn: () => chamarMotion<{ musicas: Musica[] }>("insumos_ler", { filme_id: filme.id }), staleTime: 60_000 });
  const som = filme.som;
  const clima = typeof filme.entrevista.clima === "string" ? filme.entrevista.clima : null;
  const rotuloDoClima = clima ? (INGREDIENTES.find((i) => i.chave === "clima")!.opcoes.find((o) => o.valor === clima) || { rotulo: clima }).rotulo : null;
  const medindo = !!(fila.data && fila.data.pedidos.some((p) => p.tipo === "batidas" && (p.estado === "fila" || p.estado === "rodando")));

  const salvar = async (novo: Partial<SomDoFilme>) => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, som: { ...som, ...novo } });
      guardar(d.filme);
    } catch (e) {
      avisarErro(e, "O som não foi salvo");
    }
  };

  const medir = async () => {
    setIndo("medir");
    try {
      await chamarMotion("batidas_pedir", { filme_id: filme.id, uid: uidDoClique("batidas") });
      void fila.refetch();
    } catch (e) {
      avisarErro(e, "As batidas não foram pedidas");
    } finally {
      setIndo(null);
    }
  };

  const casar = async () => {
    setIndo("casar");
    try {
      const d = await chamarMotion<{ filme: Filme }>("ritmo_casar", { filme_id: filme.id });
      guardar(d.filme);
    } catch (e) {
      avisarErro(e, "Os cortes não foram casados");
    } finally {
      setIndo(null);
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <Secao titulo="Trilha" descricao={som.trilha ? som.trilha.nome : rotuloDoClima ? `Clima pedido: ${rotuloDoClima}` : "Nenhuma escolhida"} ajuda="Música da Mídia do cliente (tipo áudio) com licença comercial registrada. Sem trilha, o filme sai só com os efeitos.">
        <select
          className={juntar(campo, "max-w-[480px]")}
          value={som.trilha ? som.trilha.path : ""}
          onChange={(e) => {
            const m = ((q.data && q.data.musicas) || []).find((x) => x.storage_path === e.target.value);
            void salvar({ trilha: m ? { arquivo_id: m.id, path: m.storage_path, nome: m.nome, duracao_s: m.duracao_s } : null, clima });
          }}
          aria-label="Trilha do filme"
        >
          <option value="">Sem trilha</option>
          {((q.data && q.data.musicas) || []).map((m) => (
            <option key={m.id} value={m.storage_path}>
              {m.nome} {m.duracao_s ? `(${Math.round(m.duracao_s)} s)` : ""}
            </option>
          ))}
        </select>
      </Secao>

      <Secao
        titulo="Batidas"
        descricao={som.batidas ? `${som.batidas.bpm} BPM · ${som.batidas.batidas.length} batidas${som.batidas.drop_s !== null ? ` · drop em ${som.batidas.drop_s} s` : ""}` : "Ainda não medidas"}
        ajuda="Medidas no worker (energia e autocorrelação). O corte de cada cena vai para a batida mais perto (o compasso quando dá), sem cena abaixo de 2 s."
        acao={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => void medir()} disabled={!som.trilha || indo === "medir" || medindo}>
              {indo === "medir" || medindo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <AudioLines className="mr-1 h-3.5 w-3.5" />}
              {medindo ? "Medindo" : "Medir as batidas"}
            </button>
            <button type="button" className={botao.primario} onClick={() => void casar()} disabled={!som.batidas || indo === "casar"}>
              {indo === "casar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Timer className="mr-1 h-3.5 w-3.5" />}
              Casar os cortes
            </button>
          </>
        }
      >
        {som.batidas && <Energia valores={som.batidas.energia} drop={som.batidas.drop_s} duracao={som.batidas.duracao_s} />}
        <p className={juntar(texto.auxiliar, "mt-2")}>Cenas: {filme.cenas.map((c) => `${c.duracao_s} s`).join(" + ") || "nenhuma"} = {duracaoTotal(filme.cenas)} s</p>
      </Secao>

      <Secao titulo="Efeitos e volume" ajuda="Sons CC0 da biblioteca do editor: o pico de cada som cai no quadro do auge do movimento da cena, com 0,65 s entre eles. Volume final -14 LUFS.">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="min-w-0">
            <span className={texto.rotulo}>Efeitos</span>
            <select className={campo} value={som.efeitos} onChange={(e) => void salvar({ efeitos: e.target.value as SomDoFilme["efeitos"] })}>
              <option value="casados">No pico de cada movimento</option>
              <option value="poucos">Poucos (um a cada 2 s)</option>
              <option value="nenhum">Nenhum</option>
            </select>
          </label>
          <label className="min-w-0">
            <span className={texto.rotulo}>Música ({Math.round(som.volume_musica * 100)}%)</span>
            <input type="range" min={0} max={1.2} step={0.05} value={som.volume_musica} onChange={(e) => void salvar({ volume_musica: Number(e.target.value) })} className="w-full" />
          </label>
          <label className="min-w-0">
            <span className={texto.rotulo}>Efeitos ({Math.round(som.volume_efeitos * 100)}%)</span>
            <input type="range" min={0} max={1.2} step={0.05} value={som.volume_efeitos} onChange={(e) => void salvar({ volume_efeitos: Number(e.target.value) })} className="w-full" />
          </label>
        </div>
      </Secao>
      <button type="button" className={botao.primario} onClick={() => irPara("render")}>
        Seguir para o render
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function EtapaSom({ irPara }: { irPara: IrPara }) {
  return <ComFilme>{(filme) => <Conteudo key={filme.id} filme={filme} irPara={irPara} />}</ComFilme>;
}
