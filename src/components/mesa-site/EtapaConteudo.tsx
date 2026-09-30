import { useState } from "react";
import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { modeloDoPapel, usd } from "@/lib/mesa/api";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { rotuloDaSecao, type OpcaoDeCopy } from "../../../supabase/functions/_shared/site-metodo";
import { chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";
import CopyPorSecao from "./CopyPorSecao";
import SerieDoGrafico from "./SerieDoGrafico";

/**
 * Etapa 4: conteúdo pelas fórmulas de copy. Gera 3 opções de conceitos
 * diferentes (gerar a mais e escolher, sem laço de correção), com SEO; a
 * escolhida vai para o motor de código. SIT2: as seções seguem o mapa (e a
 * fórmula de cada uma na biblioteca) e a copy por seção edita a escolhida.
 */
export default function EtapaConteudo({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const [pedido, setPedido] = useState("");
  const [gerando, setGerando] = useState(false);
  const [custo, setCusto] = useState<number | null>(null);
  const opcoes: OpcaoDeCopy[] = Array.isArray(site.conteudo.opcoes) ? site.conteudo.opcoes : [];
  const escolhida = typeof site.conteudo.escolhida === "number" ? site.conteudo.escolhida : null;
  // Modelo na hora (SIT2): o padrão do papel site, trocável por qualquer modelo de texto do catálogo.
  const [modeloId, setModeloId] = useState<string>(() => {
    const m = modeloDoPapel(catalogo, "site", site.modelo);
    return m ? m.id : "";
  });
  const modelo = modeloDoPapel(catalogo, "site", modeloId || null);

  const gerar = async () => {
    setGerando(true);
    try {
      const d = await chamarSite<{ site: LinhaDoSite; custo_usd: number }>("conteudo_gerar", { site_id: site.id, pedido: pedido.trim() || undefined, modelo_id: modelo ? modelo.id : undefined });
      guardar(d.site);
      setCusto(d.custo_usd);
      atualizarCusto();
    } catch (e) {
      avisarErro(e, "O conteúdo não foi gerado");
    } finally {
      setGerando(false);
    }
  };

  const escolher = async (i: number) => {
    try {
      const d = await chamarSite<{ site: LinhaDoSite }>("site_salvar", { site_id: site.id, conteudo_escolhida: i });
      guardar(d.site);
    } catch (e) {
      avisarErro(e, "A escolha não foi salva");
    }
  };

  return (
    <div className="min-w-0 space-y-6" data-etapa-conteudo="">
      <Secao
        titulo="Conteúdo"
        descricao={opcoes.length ? `${opcoes.length} opções${escolhida !== null ? " · 1 escolhida" : ""}` : "Nenhuma opção ainda"}
        ajuda="Headline de resultado com até 8 palavras, subtítulo que explica, CTA com ação e benefício, uma seção por item da Direção, FAQ que responde objeções e SEO (título até 60 e descrição até 155). Nada de número ou depoimento inventado."
        acao={
          <>
            <button type="button" className={escolhida !== null ? juntar(botao.secundario, "mr-2") : botao.primario} disabled={gerando} onClick={() => void gerar()} data-gerar-conteudo="">
              {gerando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {opcoes.length ? "Gerar outras 3" : "Gerar 3 opções"}
            </button>
            {escolhida !== null && (
              <button type="button" className={botao.primario} onClick={() => onIrPara("imagens")}>
                Seguir
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </button>
            )}
          </>
        }
      >
        <div className="grid min-w-0 grid-cols-1 items-end gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <input value={pedido} onChange={(e) => setPedido(e.target.value)} maxLength={600} placeholder="Pedido extra (opcional): mais direto, falar de prazo..." className={campo} aria-label="Pedido extra para o conteúdo" />
          <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modelo ? modelo.id : ""} onChange={setModeloId} rotulo="Redator" />
        </div>
        <div className="min-w-0 truncate">{modelo && <EstimativaInline partes={[{ modeloId: modelo.id, tipo: "texto", tokensEntrada: 7000, tokensSaida: 7500 }]} />}</div>
        {custo !== null && <p className={texto.auxiliar}>Custo desta geração: {usd(custo)}</p>}
        {!opcoes.length && !gerando && <EstadoVazio compacto icone={<Sparkles className="h-5 w-5" />} titulo="Gere as 3 opções e escolha uma." />}
      </Secao>

      {opcoes.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3" data-opcoes-de-conteudo="">
          {opcoes.map((o, i) => (
            <Painel
              key={i}
              recolher={false}
              titulo={`Opção ${i + 1}`}
              descricao={i === escolhida ? "Escolhida" : undefined}
              acao={
                i === escolhida ? (
                  <span className="inline-flex items-center text-[12px] text-primary">
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Escolhida
                  </span>
                ) : (
                  <button type="button" className={botao.secundario} onClick={() => void escolher(i)}>
                    Escolher
                  </button>
                )
              }
            >
              <div className="min-w-0 space-y-3">
                <p className={texto.auxiliar}>{o.conceito}</p>
                <p className={texto.tituloSecao}>{o.headline}</p>
                <p className={texto.corpo}>{o.subtitulo}</p>
                <p className={juntar(texto.rotulo, "text-primary")}>CTA: {o.cta}</p>
                <ul className="space-y-1.5 border-t border-border pt-3">
                  {o.secoes.slice(0, 10).map((s) => (
                    <li key={s.id} className="min-w-0">
                      <span className={juntar(texto.rotulo, "block")}>{rotuloDaSecao(s.id)}</span>
                      <span className={juntar(texto.corpo, "block")}>{s.titulo}</span>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-border pt-3">
                  <span className={juntar(texto.rotulo, "block")}>SEO</span>
                  <span className={juntar(texto.corpo, "block")}>{o.seo.titulo}</span>
                  <span className={juntar(texto.auxiliar, "block whitespace-normal")}>{o.seo.descricao}</span>
                </div>
              </div>
            </Painel>
          ))}
        </div>
      )}

      <CopyPorSecao site={site} modeloId={modelo ? modelo.id : null} />
      <SerieDoGrafico site={site} />
    </div>
  );
}
