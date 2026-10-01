import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { pecaPorId } from "../../../supabase/functions/mesa-motion/modulos/cena-hf";
import { duracaoTotal } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { ComFilme, ModeloDaAcao, useModeloDaAcao } from "./FilmeAberto";
import { chamarMotion, type Filme, type ResumoDaTroca, textoDaTroca, useGuardarFilme } from "./motionApi";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 4: 3 storyboards de conceitos diferentes (gerar a mais e escolher,
 * sem laço de correção). No filme da marca, cada storyboard é um roteiro de
 * 6 a 10 planos (gerado, real ou tipografia em código).
 * Com cenas feitas, "Trocar para este" troca num clique e o aviso diz o que
 * saiu, com Desfazer (o servidor guarda a cópia). "Gerar outros 3" também
 * tem Desfazer: os storyboards pagos de antes voltam.
 */

function Conteudo({ filme, irPara }: { filme: Filme; irPara: IrPara }) {
  const { atualizarCusto } = useMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const { modelo } = useModeloDaAcao("storyboards");
  const [pedido, setPedido] = useState("");
  const [gerando, setGerando] = useState(false);
  const [custo, setCusto] = useState<number | null>(null);

  const desfazer = async (qual: "troca" | "geracao") => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("storyboard_desfazer", { filme_id: filme.id, qual });
      guardar(d.filme);
      toast.success(qual === "troca" ? "As cenas de antes voltaram" : "Os storyboards de antes voltaram");
    } catch (e) {
      avisarErro(e, "Não deu para desfazer");
    }
  };

  const gerar = async () => {
    setGerando(true);
    try {
      const d = await chamarMotion<{ filme: Filme; custo_usd: number; anterior?: { pode_desfazer?: boolean } }>("storyboards_gerar", { filme_id: filme.id, modelo_id: modelo ? modelo.id : undefined, pedido: pedido.trim() || undefined });
      guardar(d.filme);
      setCusto(d.custo_usd);
      atualizarCusto();
      if (d.anterior && d.anterior.pode_desfazer) toast.success("3 storyboards novos", { description: "O custo da geração não volta.", duration: 15000, action: { label: "Desfazer", onClick: () => void desfazer("geracao") } });
    } catch (e) {
      avisarErro(e, "Os storyboards não foram gerados");
    } finally {
      setGerando(false);
    }
  };

  const [escolhendo, setEscolhendo] = useState<number | null>(null);
  const escolher = async (i: number) => {
    const antes: ResumoDaTroca = { cenas: filme.cenas.length, stills_aprovados: filme.cenas.filter((c) => c.still_aprovado).length, sob_medida: filme.cenas.filter((c) => c.modo === "sob_medida").length };
    setEscolhendo(i);
    try {
      const d = await chamarMotion<{ filme: Filme; anterior?: ResumoDaTroca }>("storyboard_escolher", { filme_id: filme.id, indice: i });
      guardar(d.filme);
      const saiu = d.anterior && typeof d.anterior.cenas === "number" ? d.anterior : antes;
      // O aviso fica uns 15 s e continua à vista depois de ir para os Stills.
      if (saiu.cenas > 0) toast.success(`Cenas trocadas: ${textoDaTroca(saiu)}`, { duration: 15000, action: { label: "Desfazer", onClick: () => void desfazer("troca") } });
      irPara("stills");
    } catch (e) {
      avisarErro(e, "A escolha não foi salva");
    } finally {
      setEscolhendo(null);
    }
  };

  const rotuloDaCena = (c: Filme["cenas"][number]) =>
    c.tipo_plano === "gerado" ? "Plano gerado" : c.tipo_plano === "real" ? "Material real" : c.modo === "sob_medida" ? "Sob medida" : (pecaPorId(c.peca) || { rotulo: "Peça" }).rotulo;

  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Storyboards"
        descricao={filme.storyboards.length ? `${filme.storyboards.length} caminhos${filme.storyboard_escolhido !== null ? " · 1 escolhido" : ""}` : "Nenhum ainda"}
        ajuda={filme.tipo === "filme_marca" ? "Roteiros de 30 a 60 s em 6 a 10 planos: gerado (Mesa Vídeos, custo por plano), real (acervo do cliente) ou tipografia e logo em código." : "Três conceitos para o mesmo filme, cada cena com a peça do kit ou sob medida."}
        acao={
          <button type="button" className={filme.storyboards.length ? botao.secundario : botao.primario} onClick={() => void gerar()} disabled={gerando || !filme.brand.essencia} data-gerar-storyboards="">
            {gerando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            {filme.storyboards.length ? "Gerar outros 3" : "Gerar 3 storyboards"}
          </button>
        }
      >
        <ModeloDaAcao chave="storyboards" alvo="storyboards" />
        <input value={pedido} onChange={(e) => setPedido(e.target.value)} maxLength={600} placeholder="Pedido extra (opcional): começar pela pergunta, mais cenas de prova..." className={juntar(campo, "mt-2")} aria-label="Pedido extra para os storyboards" />
        {custo !== null && <p className={juntar(texto.auxiliar, "mt-2")}>Custo desta geração: {usd(custo)}</p>}
        {!filme.brand.essencia && <EstadoVazio compacto className="mt-2" titulo="Gere o BRAND.md antes" acao={<button type="button" className={botao.secundario} onClick={() => irPara("brand")}>Abrir o BRAND.md</button>} />}
        {!filme.storyboards.length && !gerando && filme.brand.essencia && <EstadoVazio compacto icone={<Sparkles className="h-5 w-5" />} titulo="Gere os 3 storyboards e escolha um." />}
      </Secao>

      {filme.storyboards.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3" data-storyboards="">
          {filme.storyboards.map((sb, i) => (
            <Painel
              key={i}
              recolher={false}
              titulo={`Storyboard ${i + 1}`}
              descricao={`${sb.cenas.length} cenas · ${Math.round(duracaoTotal(sb.cenas))} s`}
              acao={
                filme.storyboard_escolhido === i ? (
                  <span className="inline-flex items-center text-[12px] text-primary">
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Escolhido
                  </span>
                ) : (
                  <button type="button" className={botao.secundario} onClick={() => void escolher(i)} disabled={escolhendo !== null}>
                    {escolhendo === i ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    {filme.cenas.length > 0 ? "Trocar para este" : "Escolher"}
                  </button>
                )
              }
            >
              <div className="min-w-0 space-y-3">
                <p className={texto.tituloSecao}>{sb.conceito}</p>
                <p className={texto.auxiliar}>{sb.resumo}</p>
                <ol className="space-y-2 border-t border-border pt-3">
                  {sb.cenas.map((c, j) => (
                    <li key={j} className="min-w-0">
                      <span className={juntar(texto.rotulo, "block")}>
                        {j + 1}. {rotuloDaCena(c)} · {c.duracao_s} s
                      </span>
                      <span className={juntar(texto.corpo, "block")}>{c.titulo}</span>
                      {c.ideia && <span className={juntar(texto.auxiliar, "block")}>{c.ideia}</span>}
                    </li>
                  ))}
                </ol>
                {sb.avisos.length > 0 && (
                  <ul className="space-y-1 border-t border-border pt-2">
                    {sb.avisos.map((a) => (
                      <li key={a} className={juntar(texto.auxiliar, "text-warning")}>
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Painel>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EtapaStoryboards({ irPara }: { irPara: IrPara }) {
  return <ComFilme irPara={irPara}>{(filme) => <Conteudo key={filme.id} filme={filme} irPara={irPara} />}</ComFilme>;
}
