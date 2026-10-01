import { useState } from "react";
import { Loader2, Palette, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { INGREDIENTES } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { ESTILOS_DA_VOZ, lerNarracao } from "../../../supabase/functions/mesa-motion/modulos/narracao";
import { ACABAMENTOS } from "../../../supabase/functions/mesa-motion/modulos/pecas-extras";
import { chamarMotion, type Filme, useGuardarFilme } from "./motionApi";

/**
 * Direção de arte pela marca (frente MOV): o acabamento das cenas em código
 * (limpo, grão de filme, grade técnica, luz da marca, cinema) aplicado em
 * todas de uma vez, com Desfazer; e a sugestão do Jev (acabamento, transição,
 * ritmo e estilo da voz) pelo estilo, tom e público da marca, que a equipe
 * aplica num clique. Trocar o acabamento deixa os stills e as finais
 * desatualizados (a cena mudou).
 */

type Escolha = { valor: string; confianca: number | null } | null;
type Sugestao = { acabamento: Escolha; transicao: Escolha; ritmo: Escolha; estilo_da_voz: Escolha };

const rotuloDe = (chave: string, valor: string) => {
  const ing = INGREDIENTES.find((i) => i.chave === chave);
  const o = ing ? ing.opcoes.find((x) => x.valor === valor) : null;
  return o ? o.rotulo : valor;
};

/** Aplica o acabamento em todas as cenas; devolve o Desfazer. */
export async function aplicarAcabamento(filme: Filme, acabamento: string) {
  return await chamarMotion<{ filme: Filme; anteriores: Record<string, string>; acabamento_anterior: string }>("acabamento_aplicar", { filme_id: filme.id, acabamento });
}

export default function DirecaoDeArte({ filme }: { filme: Filme }) {
  const { atualizarCusto } = useMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const atual = typeof filme.entrevista.acabamento === "string" ? filme.entrevista.acabamento : "limpo";
  const [escolhido, setEscolhido] = useState(atual);
  const [indo, setIndo] = useState<string | null>(null);
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const hf = filme.cenas.filter((c) => c.tipo_plano === "hf");
  const iguais = hf.every((c) => (c.acabamento || "limpo") === escolhido);

  const desfazer = async (anteriores: Record<string, string>, acabamentoAnterior: string) => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("acabamento_aplicar", { filme_id: filme.id, anteriores, acabamento_anterior: acabamentoAnterior });
      guardar(d.filme);
      setEscolhido(acabamentoAnterior);
      toast.success("O acabamento de antes voltou");
    } catch (e) {
      avisarErro(e, "Não deu para desfazer");
    }
  };

  const aplicar = async (valor: string) => {
    setIndo("aplicar");
    try {
      const d = await aplicarAcabamento(filme, valor);
      guardar(d.filme);
      setEscolhido(valor);
      toast.success(`Acabamento ${rotuloDe("acabamento", valor)} em ${hf.length} ${hf.length === 1 ? "cena" : "cenas"}`, { description: "Os stills saem de novo com o acabamento.", duration: 15000, action: { label: "Desfazer", onClick: () => void desfazer(d.anteriores, d.acabamento_anterior) } });
    } catch (e) {
      avisarErro(e, "O acabamento não foi aplicado");
    } finally {
      setIndo(null);
    }
  };

  const sugerir = async () => {
    setIndo("sugerir");
    try {
      const d = await chamarMotion<{ sugestao: Sugestao; custo_usd: number }>("direcao_sugerir", { filme_id: filme.id });
      setSugestao(d.sugestao);
      atualizarCusto();
      if (d.custo_usd) toast.success("Sugestão pronta", { description: `Custo real: ${usd(d.custo_usd)}.` });
    } catch (e) {
      avisarErro(e, "O Jev não sugeriu");
    } finally {
      setIndo(null);
    }
  };

  const aplicarSugestao = async () => {
    if (!sugestao) return;
    setIndo("sugestao");
    const antes = { entrevista: filme.entrevista, narracao: filme.som.narracao };
    try {
      const entrevista = { ...filme.entrevista } as Record<string, unknown>;
      if (sugestao.transicao) entrevista.transicao = sugestao.transicao.valor;
      if (sugestao.ritmo) entrevista.ritmo = sugestao.ritmo.valor;
      const d = await chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, entrevista, ...(sugestao.estilo_da_voz ? { som: { ...filme.som, narracao: lerNarracao({ ...filme.som.narracao, ajustes: { ...filme.som.narracao.ajustes, estilo: sugestao.estilo_da_voz.valor } }) } } : {}) });
      guardar(d.filme);
      let anteriores: Record<string, string> | null = null;
      let acabamentoAnterior = atual;
      if (sugestao.acabamento) {
        const a = await chamarMotion<{ filme: Filme; anteriores: Record<string, string>; acabamento_anterior: string }>("acabamento_aplicar", { filme_id: filme.id, acabamento: sugestao.acabamento.valor });
        guardar(a.filme);
        anteriores = a.anteriores;
        acabamentoAnterior = a.acabamento_anterior;
        setEscolhido(sugestao.acabamento.valor);
      }
      toast.success("Direção de arte aplicada", {
        duration: 15000,
        action: {
          label: "Desfazer",
          onClick: () =>
            void (async () => {
              try {
                const v = await chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, entrevista: antes.entrevista, som: { ...filme.som, narracao: antes.narracao } });
                guardar(v.filme);
                if (anteriores) await desfazer(anteriores, acabamentoAnterior);
              } catch (e) {
                avisarErro(e, "Não deu para desfazer");
              }
            })(),
        },
      });
      setSugestao(null);
    } catch (e) {
      avisarErro(e, "A direção de arte não foi aplicada");
    } finally {
      setIndo(null);
    }
  };

  return (
    <Secao
      titulo="Direção de arte"
      descricao={`Acabamento: ${rotuloDe("acabamento", atual)}`}
      recolher="mesa-motion:direcao"
      ajuda="O acabamento é uma camada nossa em volta de cada cena em código: textura de película, grade técnica, manchas de luz nas cores da marca ou faixas de cinema. O Jev lê o estilo, o tom e o público da marca e sugere acabamento, transição, ritmo e o estilo da voz; você aplica num clique e desfaz se não gostar."
      acao={
        <button type="button" className={botao.secundario} onClick={() => void sugerir()} disabled={!!indo} data-sugerir-direcao="">
          {indo === "sugerir" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
          Sugerir pela marca
        </button>
      }
      data-direcao-de-arte=""
    >
      <div className="flex min-w-0 flex-wrap items-end">
        <label className="mb-2 mr-2 min-w-0 flex-1 sm:max-w-[320px]">
          <span className={texto.rotulo}>Acabamento</span>
          <select className={campo} value={escolhido} onChange={(e) => setEscolhido(e.target.value)} aria-label="Acabamento das cenas">
            {ACABAMENTOS.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.rotulo}: {a.dica.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={juntar(botao.secundario, "mb-2")} onClick={() => void aplicar(escolhido)} disabled={!!indo || !hf.length || (iguais && escolhido === atual)} data-aplicar-acabamento="">
          {indo === "aplicar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Palette className="mr-1 h-3.5 w-3.5" />}
          Aplicar em todas as cenas
        </button>
      </div>
      {sugestao && (
        <div className="mt-2 min-w-0 rounded-lg bg-primary/[0.07] px-3 py-2.5" data-sugestao-da-direcao="">
          <p className={texto.corpo}>
            {[
              sugestao.acabamento ? `Acabamento ${rotuloDe("acabamento", sugestao.acabamento.valor)}` : null,
              sugestao.transicao ? `transição ${rotuloDe("transicao", sugestao.transicao.valor).toLowerCase()}` : null,
              sugestao.ritmo ? `ritmo ${rotuloDe("ritmo", sugestao.ritmo.valor).toLowerCase()}` : null,
              sugestao.estilo_da_voz ? `voz ${(ESTILOS_DA_VOZ.find((x) => x.valor === sugestao.estilo_da_voz!.valor) || { rotulo: sugestao.estilo_da_voz.valor }).rotulo.toLowerCase()}` : null,
            ]
              .filter(Boolean)
              .join(", ")}
            .
          </p>
          <div className="mt-2 flex min-w-0">
            <button type="button" className={juntar(botao.primario, "mr-2 h-8")} onClick={() => void aplicarSugestao()} disabled={!!indo} data-aplicar-sugestao="">
              {indo === "sugestao" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Aplicar a sugestão
            </button>
            <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setSugestao(null)}>
              Deixar como está
            </button>
          </div>
        </div>
      )}
    </Secao>
  );
}
