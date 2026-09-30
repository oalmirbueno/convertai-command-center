import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { CREDITO_DA_BASE } from "@/lib/uiux/carregar";
import { mapaDoSite } from "../../../supabase/functions/_shared/site-biblioteca";
import { graficoParaDados, lerSerieReal } from "../../../supabase/functions/_shared/uiux/consultas";
import { ROTULO_DO_GRAFICO } from "../../../supabase/functions/_shared/uiux/mapeamentos";
import { type LinhaDoSite, useSalvarSite } from "./siteApi";

const FORMAS = [
  { valor: "categoria", rotulo: "Comparar itens" },
  { valor: "tempo", rotulo: "Ao longo do tempo" },
  { valor: "parte", rotulo: "Parte do todo" },
];

/** "Rótulo: valor" por linha em pontos (número no jeito brasileiro: 1.200,5). */
export function pontosDoTexto(t: string): Array<{ rotulo: string; valor: number }> {
  return String(t || "")
    .split("\n")
    .map((l) => {
      const i = l.lastIndexOf(":");
      if (i <= 0) return null;
      const valor = Number(l.slice(i + 1).trim().replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
      const rotulo = l.slice(0, i).trim().slice(0, 40);
      return rotulo && isFinite(valor) ? { rotulo, valor } : null;
    })
    .filter((p): p is { rotulo: string; valor: number } => !!p)
    .slice(0, 12);
}

/**
 * A série real do gráfico da seção de números (frente UXM). Só aparece com a
 * seção "Números (só reais)" no mapa e só vale com a fonte (briefing, dossiê
 * ou arquivo do cliente): sem a fonte, sem gráfico. O motor desenha com o
 * src/lib/Grafico.tsx da casca (SVG próprio, tabela para leitor de tela); a
 * forma do dado escolhe linha, barras ou rosca.
 */
export default function SerieDoGrafico({ site }: { site: LinhaDoSite }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const salva = lerSerieReal(site.conteudo ? site.conteudo.serie_real : null);
  const [linhas, setLinhas] = useState("");
  const [fonte, setFonte] = useState("");
  const [forma, setForma] = useState("categoria");
  const [ocupado, setOcupado] = useState<string | null>(null);
  useEffect(() => {
    setLinhas(salva ? salva.pontos.map((p) => `${p.rotulo}: ${String(p.valor).replace(".", ",")}`).join("\n") : "");
    setFonte(salva ? salva.fonte : "");
    setForma(salva ? (salva.eixo === "tempo" ? "tempo" : salva.parte_do_todo ? "parte" : "categoria") : "categoria");
    // Ao abrir outro site ou quando a série salva muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, JSON.stringify(salva)]);

  const temNumeros = mapaDoSite(site).paginas.some((p) => p.secoes.some((s) => s.tipo === "numeros"));
  if (!temNumeros) return null;
  const serie = { pontos: pontosDoTexto(linhas), fonte: fonte.trim(), eixo: forma === "tempo" ? ("tempo" as const) : ("categoria" as const), parte_do_todo: forma === "parte" };
  const grafico = graficoParaDados(serie);

  const salvar = async (limpar: boolean) => {
    setOcupado(limpar ? "limpar" : "salvar");
    try {
      await salvarSite("serie_salvar", { site_id: site.id, serie: limpar ? null : serie });
    } catch (e) {
      avisarErro(e, "A série não foi salva");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Secao
      titulo="Gráfico dos números"
      descricao={salva ? `${salva.pontos.length} ponto(s) · fonte ${salva.fonte}` : "Sem série"}
      ajuda={`Gráfico só com números reais e com a fonte (briefing, dossiê ou arquivo do cliente). Um item por linha, no formato "rótulo: valor". A forma do dado escolhe o gráfico: no tempo vira linha, entre itens vira barras e parte do todo (até 5) vira rosca. ${CREDITO_DA_BASE}`}
      recolher="mesa-site:conteudo:grafico"
      acao={
        <>
          {salva && (
            <button type="button" className={juntar(botao.icone, "mr-2")} aria-label="Tirar a série" disabled={!!ocupado} onClick={() => void salvar(true)}>
              {ocupado === "limpar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          )}
          <button type="button" className={botao.primario} disabled={!!ocupado || !grafico} onClick={() => void salvar(false)} data-salvar-serie="">
            {ocupado === "salvar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Salvar a série
          </button>
        </>
      }
    >
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <label className="grid min-w-0">
          <span className={juntar(texto.rotulo, "mb-1.5")}>Números (rótulo: valor)</span>
          <textarea className={juntar(campoTexto, "min-h-[96px]")} value={linhas} onChange={(e) => setLinhas(e.target.value)} placeholder={"2023: 120\n2024: 180"} aria-label="Números da série" />
        </label>
        <div className="grid min-w-0 content-start gap-3">
          <label className="grid min-w-0">
            <span className={juntar(texto.rotulo, "mb-1.5")}>Fonte</span>
            <input className={campo} value={fonte} maxLength={200} onChange={(e) => setFonte(e.target.value)} placeholder="Ex.: briefing de 12/09" aria-label="Fonte dos números" />
          </label>
          <SeletorCompacto rotulo="Forma do dado" opcoes={FORMAS} valor={forma} onEscolher={setForma} />
          <p className={texto.auxiliar} data-grafico-escolhido={grafico ? grafico.tipo : ""}>
            {grafico ? `Gráfico de ${ROTULO_DO_GRAFICO[grafico.tipo]} (base ${`uupm:chart:${grafico.no}`})` : "Sem gráfico: faltam 2 números ou a fonte"}
          </p>
        </div>
      </div>
    </Secao>
  );
}
