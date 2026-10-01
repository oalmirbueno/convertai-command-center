import { useState } from "react";
import { ArrowRight, Loader2, Scale } from "lucide-react";
import { EstadoVazio } from "@/components/sistema/Estados";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { CRITERIOS_DA_CRITICA } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { ComFilme } from "./FilmeAberto";
import CenaNaFila from "./CenaNaFila";
import { chamarMotion, type Filme, useFilaDoFilme, useGuardarFilme } from "./motionApi";
import { useAcoesDaCena } from "./useAcoesDaCena";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 7: crítica. Folha de contato de cada cena em tamanho de celular e
 * nota de 1 a 10 por critério (Jev, pelos fatos medidos: textos, palavras por
 * segundo, contraste, lint e layout do HyperFrames, provas com fonte). É só
 * aviso: nada é refeito sozinho (sem laço de correção).
 */

type CriticaDaCena = { notas: Record<string, number>; avisos: string[]; media: number | null; base: string };

function Conteudo({ filme, links, irPara }: { filme: Filme; links: Record<string, string>; irPara: IrPara }) {
  const { atualizarCusto } = useMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const fila = useFilaDoFilme(filme.id);
  const a = useAcoesDaCena(filme);
  const [indo, setIndo] = useState(false);
  const [custo, setCusto] = useState<number | null>(null);
  const formato = filme.formatos[0] || "9:16";
  const porCena = (filme.critica.por_cena || {}) as Record<string, CriticaDaCena>;

  const criticar = async () => {
    setIndo(true);
    try {
      const d = await chamarMotion<{ filme: Filme; custo_usd: number }>("critica_gerar", { filme_id: filme.id });
      guardar(d.filme);
      setCusto(d.custo_usd);
      atualizarCusto();
    } catch (e) {
      avisarErro(e, "A crítica não saiu");
    } finally {
      setIndo(false);
    }
  };

  if (!filme.cenas.length) return <EstadoVazio icone={<Scale className="h-5 w-5" />} titulo="Escolha um storyboard antes" acao={<button type="button" className={botao.secundario} onClick={() => irPara("storyboards")}>Abrir os storyboards</button>} />;
  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Crítica"
        descricao={filme.critica.em ? `Feita em ${new Date(String(filme.critica.em)).toLocaleString("pt-BR")}` : "Ainda não feita"}
        ajuda="Nota por critério: legível no celular, hierarquia, ritmo, fiel à marca e só fatos reais. Abaixo de 6 vira aviso. A equipe decide o que mudar."
        acao={
          <button type="button" className={botao.primario} onClick={() => void criticar()} disabled={indo || !filme.cenas.length} data-criticar="">
            {indo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Scale className="mr-1 h-3.5 w-3.5" />}
            {filme.critica.em ? "Criticar de novo" : "Criticar as cenas"}
          </button>
        }
      >
        {custo !== null && <p className={texto.auxiliar}>Custo: {usd(custo)} (Jev).</p>}
      </Secao>
      {filme.cenas
        .filter((c) => c.tipo_plano === "hf")
        .map((c) => {
          const cr = porCena[c.id];
          // O número da cena é o do filme (o mesmo das outras etapas), não o da lista filtrada.
          return (
            <Painel key={c.id} titulo={`${filme.cenas.indexOf(c) + 1}. ${c.titulo}`} descricao={cr && cr.media !== null ? `Média ${cr.media} · ${cr.base}` : "Sem nota"} recolher={`mesa-motion:critica:${c.id}`}>
              <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                <CenaNaFila filme={filme} links={links} fila={fila.data} cena={c} modo="final" formato={formato} onCancelar={(id) => void a.cancelar(id)} />
                {cr && (
                  <div className="min-w-0 space-y-2">
                    {CRITERIOS_DA_CRITICA.map((k) => (
                      <div key={k.chave} className="flex min-w-0 items-center">
                        <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{k.rotulo}</span>
                        <span className={juntar(texto.corpo, "tabular-nums", (cr.notas[k.chave] || 0) < 6 ? "text-warning" : "text-foreground")}>{cr.notas[k.chave] !== undefined ? cr.notas[k.chave] : "?"}</span>
                      </div>
                    ))}
                    {cr.avisos.map((x) => (
                      <p key={x} className={juntar(texto.auxiliar, "text-warning")}>
                        {x}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </Painel>
          );
        })}
      <button type="button" className={botao.primario} onClick={() => irPara("som")}>
        Seguir para o som
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function EtapaCritica({ irPara }: { irPara: IrPara }) {
  return <ComFilme irPara={irPara}>{(filme, links) => <Conteudo key={filme.id} filme={filme} links={links} irPara={irPara} />}</ComFilme>;
}
