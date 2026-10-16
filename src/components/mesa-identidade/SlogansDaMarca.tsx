import { useState } from "react";
import { Check, Loader2, Quote } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { TIPOS_DE_SLOGAN, type SloganDaMarca } from "../../../supabase/functions/mesa-identidade/modulos/naming";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha, partesDoCusto, RotuloComModelo, useModeloDaAcao, useProjetoDaMesa } from "./Comuns";

const rotuloDoTipo = (t: string) => (TIPOS_DE_SLOGAN.filter((x) => x.valor === t)[0] || { rotulo: t }).rotulo;

/**
 * Slogan e tagline (IDV2): frases a partir da estratégia (IA, custo antes),
 * ranqueadas pelo Jev contra o posicionamento e o tom. A escolhida vira o
 * slogan do brandbook; dá para escrever a própria. UXS 30/09: o modelo é o do
 * cabeçalho da etapa (o botão mostra o nome) e o pedido opcional fica dentro
 * da seção, não na linha do título.
 */
export default function SlogansDaMarca() {
  const mesa = useMesa();
  const { projeto, guardar } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const [modeloId] = useModeloDaAcao("naming");
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
          {/* 16/10/2026: só ícone; o nome (e o modelo) vão para o leitor de tela e o title; o preço fica ao lado. */}
          <BotaoComCusto
            rotulo={
              <>
                {/* Aspas, não a varinha: a varinha é o "Gerar nomes" do estúdio logo acima. */}
                <Quote className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">
                  <RotuloComModelo rotulo={slogans.length ? "Gerar de novo" : "Gerar frases"} papel="naming" modeloId={modeloId} />
                </span>
              </>
            }
            titulo="Slogans e taglines"
            descricao={slogans.length ? "Gerar de novo as frases" : "Gerar frases (slogan e tagline)"}
            partes={() => partesDoCusto(mesa.catalogo, "slogans", modeloId)}
            executar={() => chamarIdentidade<{ projeto: ProjetoDeIdentidade; aviso_jev: string | null }>("slogans_gerar", { projeto_id: projeto.id, modelo_id: modeloId || undefined, pedido: pedido.trim() || undefined })}
            aoConcluir={(d) => {
              if (d) guardar(d.projeto);
              if (d && d.aviso_jev) toast.warning(d.aviso_jev);
            }}
            className="m-1 h-8 gap-1 px-2"
          />
        </>
      }
    >
      <input className={juntar(campo, "mb-3")} value={pedido} maxLength={400} placeholder="Pedido para as frases (opcional)" onChange={(e) => setPedido(e.target.value)} aria-label="Pedido para as frases" />
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
                {/* 16/10/2026: só ícone (nome no aria-label e no title); o escolhido fica verde. */}
                <button type="button" className={juntar(escolhido ? juntar(botao.primario, "h-8 w-8 px-0") : botao.icone, "ml-2 shrink-0")} disabled={!!escolhendo || escolhido} onClick={() => void escolher({ slogan_id: s.id }, s.id)} aria-label={escolhido ? "Escolhido" : "Escolher"} title={escolhido ? "Escolhido" : "Escolher"}>
                  {escolhendo === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
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
