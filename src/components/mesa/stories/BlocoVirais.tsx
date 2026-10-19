import { useState } from "react";
import { Flame, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import Secao from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, espaco, juntar, superficie, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "../MesaContexto";
import { avisarCustoReal } from "../Custo";
import { IconeDoAdesivo } from "./PreviaDoStory";
import { chamarStories, diaCurto, normalizarAdesivo, normalizarStory, ROTULO_DO_ADESIVO, type Molde, type Sequencia, type Story } from "./storiesApi";

/**
 * Bloco Virais: os moldes de story viral (do mapa mental "Uma novela
 * imperdível nos Stories"), cada um com o que é, quando usar, o roteiro de
 * exemplo e o adesivo. "Usar na sequência" pede ao agente para adaptar ao
 * nicho do cliente (adaptar_molde, não grava) e grava o story no fim da
 * sequência aberta (salvar_story).
 */
export default function BlocoVirais({
  clientId,
  moldes,
  sequencia,
  proximaOrdem,
  onInserido,
}: {
  clientId: string;
  moldes: Molde[];
  sequencia: Sequencia | null;
  proximaOrdem: number;
  onInserido: (s: Story) => void;
}) {
  const { atualizarCusto } = useMesa();
  const [usando, setUsando] = useState<string | null>(null);

  const usar = async (m: Molde) => {
    if (!sequencia) return;
    setUsando(m.chave);
    try {
      const r = await chamarStories<{ story: Record<string, unknown>; custo_usd?: number }>("adaptar_molde", clientId, { molde: m.chave });
      if (Number(r && r.custo_usd) > 0) avisarCustoReal("Agente dos stories", r, atualizarCusto);
      const rascunho = (r && r.story) || {};
      const adesivo = normalizarAdesivo(rascunho.adesivo || { tipo: m.adesivo });
      const salvo = await chamarStories<{ story: unknown }>("salvar_story", clientId, {
        story: {
          ...rascunho,
          id: undefined,
          papel: undefined,
          sequencia_id: sequencia.id,
          ordem: proximaOrdem,
          molde: m.chave,
          titulo: typeof rascunho.titulo === "string" && rascunho.titulo ? rascunho.titulo : m.nome,
          adesivo,
          caminho: adesivo.tipo !== "nenhum" ? "pelo_app" : "automatico",
        },
      });
      const story = normalizarStory(salvo && salvo.story);
      if (!story.id) throw new Error("O story não voltou gravado.");
      onInserido(story);
      toast.success(`${m.nome} entrou na sequência`, { description: `Story ${story.ordem} de ${diaCurto(sequencia.data)}.` });
    } catch (e) {
      toast.error("Não deu para usar o molde", { description: textoDoErro(e) });
    } finally {
      setUsando(null);
    }
  };

  if (!moldes.length) {
    return <EstadoVazio icone={<Flame className="h-5 w-5" />} titulo="Nenhum molde viral ainda" descricao="Os moldes chegam com a função dos stories" />;
  }

  return (
    <Secao
      data-bloco-dos-stories="virais"
      titulo="Moldes virais"
      recolher={`mesa:stories:virais:${clientId}`}
      descricao={sequencia ? `Entram na sequência de ${diaCurto(sequencia.data)}` : "Planeje uma sequência para usar"}
      ajuda="Regra da novela: um adesivo de interação a cada 3 ou 4 stories, texto curto na tela e um gancho para o dia seguinte. O agente adapta o molde ao nicho do cliente."
    >
      <ul className={juntar(espaco.grade, "sm:grid-cols-2 xl:grid-cols-3")} aria-label="Moldes de story viral">
        {moldes.map((m) => (
          <li key={m.chave} className={juntar(superficie.painel, "flex min-w-0 flex-col p-4")} data-molde={m.chave}>
            <div className="flex min-w-0 items-center">
              <span className="mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" title={ROTULO_DO_ADESIVO[m.adesivo]}>
                <IconeDoAdesivo tipo={m.adesivo} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className={juntar(texto.tituloSecao, "truncate")}>{m.nome}</h3>
                <p className={juntar(texto.auxiliar, "truncate")}>{ROTULO_DO_ADESIVO[m.adesivo]}</p>
              </div>
            </div>
            <p className={juntar(texto.corpo, "mt-3")}>{m.o_que_e}</p>
            {m.quando_usar ? (
              <p className={juntar(texto.auxiliar, "mt-2 leading-5")}>
                <span className="font-medium text-foreground">Quando usar: </span>
                {m.quando_usar}
              </p>
            ) : null}
            {m.exemplo.length ? (
              <ol className="mt-3 min-w-0 rounded-md bg-muted/50 px-3 py-2" aria-label={`Exemplo de ${m.nome}`}>
                {m.exemplo.map((e, i) => (
                  <li key={i} className={juntar(texto.corpo, "flex min-w-0 py-0.5")}>
                    <span className="mr-2 w-4 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1">{e}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="mt-auto flex justify-end pt-3">
              <button type="button" className={botao.secundario} onClick={() => void usar(m)} disabled={!sequencia || !!usando} title={sequencia ? undefined : "Planeje uma sequência antes"}>
                {usando === m.chave ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                Usar na sequência
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  );
}
