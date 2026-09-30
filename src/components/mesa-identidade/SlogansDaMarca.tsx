import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { TIPOS_DE_SLOGAN, type SloganDaMarca } from "../../../supabase/functions/_shared/naming";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha, partesDoCusto, SeletorDoModelo, useModeloDaAcao, useProjetoDaMesa } from "./Comuns";

const rotuloDoTipo = (t: string) => (TIPOS_DE_SLOGAN.filter((x) => x.valor === t)[0] || { rotulo: t }).rotulo;

/**
 * Slogan e tagline (IDV2): frases a partir da estratégia (IA, custo antes),
 * ranqueadas pelo Jev contra o posicionamento e o tom. A escolhida vira o
 * slogan do brandbook; dá para escrever a própria.
 */
export default function SlogansDaMarca() {
  const mesa = useMesa();
  const { projeto, guardar } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const [modeloId, setModeloId] = useModeloDaAcao("naming");
  const naming = (projeto.dados.naming || {}) as { slogans?: SloganDaMarca[]; slogan?: string | null; aviso_slogans?: string | null };
  const slogans = Array.isArray(naming.slogans) ? naming.slogans : [];
  const [pedido, setPedido] = useState("");
  const [proprio, setProprio] = useState(naming.slogan || "");
  const [escolhendo, setEscolhendo] = useState<string | null>(null);

  const escolher = async (corpo: { slogan_id?: string; texto?: string }, chave: string) => {
    setEscolhendo(chave);
    try {
      const r = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("slogan_escolher", { projeto_id: projeto.id, ...corpo });
      guardar(r.projeto);
      toast.success("Slogan escolhido");
    } catch (e) {
      avisarErro(e, "O slogan não foi escolhido");
    } finally {
      setEscolhendo(null);
    }
  };

  return (
    <Secao
      titulo="Slogan e tagline"
      divisoria
      descricao={naming.slogan ? `Escolhido: ${naming.slogan.slice(0, 40)}` : `${slogans.length} frases`}
      recolher={`mesa-identidade:${projeto.id}:naming:slogans`}
      ajuda="As frases saem da estratégia (posicionamento, tom e arquétipo). O ranking é do Jev, só como aviso: quem escolhe é a equipe. A escolhida entra no brandbook e na apresentação."
      acao={
        <>
          <input className={juntar(campo, "m-1 h-8 w-56 text-[12px]")} value={pedido} maxLength={400} placeholder="Pedido (opcional)" onChange={(e) => setPedido(e.target.value)} aria-label="Pedido para as frases" />
          <SeletorDoModelo papel="naming" valor={modeloId} onEscolher={setModeloId} />
          <BotaoComCusto
            rotulo={slogans.length ? "Gerar de novo" : "Gerar frases"}
            titulo="Slogans e taglines"
            partes={() => partesDoCusto(mesa.catalogo, "slogans", modeloId)}
            executar={() => chamarIdentidade<{ projeto: ProjetoDeIdentidade; aviso_jev: string | null }>("slogans_gerar", { projeto_id: projeto.id, modelo_id: modeloId || undefined, pedido: pedido.trim() || undefined })}
            aoConcluir={(d) => {
              if (d) guardar(d.projeto);
              if (d && d.aviso_jev) toast.warning(d.aviso_jev);
            }}
            className="m-1 h-8"
          />
        </>
      }
    >
      {naming.aviso_slogans && <p className={juntar(texto.auxiliar, "mb-2 text-warning")}>{naming.aviso_slogans}</p>}
      {slogans.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Frases da marca">
          {slogans.map((s) => {
            const escolhido = naming.slogan === s.texto;
            return (
              <li key={s.id} className={juntar(lista.linha, "items-start", escolhido && lista.destaque)} data-slogan={s.id}>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center">
                    <span className={juntar(texto.tituloSecao, "mr-2 min-w-0")}>{s.texto}</span>
                    <Pastilha>{rotuloDoTipo(s.tipo)}</Pastilha>
                    <span className={juntar(texto.etiqueta, "ml-1.5 tabular-nums text-muted-foreground")} title="Nota do Jev contra a estratégia">
                      {s.nota === null ? "sem nota" : `nota ${Math.round(s.nota * 100)}`}
                    </span>
                  </span>
                  {s.por_que && <span className={juntar(texto.auxiliar, "mt-0.5 block")}>{s.por_que}</span>}
                </span>
                <button type="button" className={juntar(escolhido ? botao.primario : botao.discreto, "ml-2 h-8 shrink-0")} disabled={!!escolhendo || escolhido} onClick={() => void escolher({ slogan_id: s.id }, s.id)}>
                  {escolhendo === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                  {escolhido ? "Escolhido" : "Escolher"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input className={campo} value={proprio} maxLength={140} placeholder="Ou escreva o slogan da equipe" onChange={(e) => setProprio(e.target.value)} aria-label="Slogan da equipe" />
        <button type="button" className={botao.secundario} disabled={!proprio.trim() || proprio.trim() === naming.slogan || !!escolhendo} onClick={() => void escolher({ texto: proprio.trim() }, "proprio")}>
          Usar este
        </button>
      </div>
    </Secao>
  );
}
