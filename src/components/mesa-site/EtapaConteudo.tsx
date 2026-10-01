import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import Secao, { CabecalhoDeSecao } from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { modeloDoPapel, nomeDoModelo, parteDaConferenciaDoJev, usd } from "@/lib/mesa/api";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { rotuloDaSecao, type OpcaoDeCopy } from "../../../supabase/functions/_shared/site-metodo";
import { chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";
import CopyPorSecao from "./CopyPorSecao";
import { NotaDaCopy } from "@/components/sistema/OpcoesDaCopy";
import SerieDoGrafico from "./SerieDoGrafico";
import { useBarraDaEtapa } from "./BarraDaEtapa";

/**
 * Etapa 4: conteúdo pelas fórmulas de copy. Gera 3 opções de conceitos
 * diferentes (gerar a mais e escolher, sem laço de correção), com SEO; a
 * escolhida vai para o motor de código. SIT2: as seções seguem o mapa (e a
 * fórmula de cada uma na biblioteca) e a copy por seção edita a escolhida.
 * UXS 30/09: com uma opção escolhida, as 3 opções recolhem ("Opção N
 * escolhida · Trocar") e a copy por seção sobe; o Redator e o pedido extra
 * ficam em "Mais opções" (o redator à vista no resumo). O Seguir mora na barra.
 */
export default function EtapaConteudo({ site }: { site: LinhaDoSite; onIrPara?: (etapa: string) => void }) {
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
  // Opções recolhidas só com uma escolhida; a chave é do site (não vaza entre sites). Sem escolhida, sempre abertas.
  const [opcoesRecolhidas, setOpcoesRecolhidas] = useRecolhido(`mesa-site:conteudo:opcoes:${site.id}`, true);
  const recolhidas = escolhida !== null && opcoesRecolhidas;
  const [maisRecolhido, setMaisRecolhido] = useRecolhido("mesa-site:conteudo:mais", true);

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

  useBarraDaEtapa({
    estado: gerando ? "Gerando as opções" : escolhida !== null ? `Opção ${escolhida + 1} escolhida` : null,
    motivo: escolhida === null ? (opcoes.length ? "Escolha uma das 3 opções" : "Gere as 3 opções e escolha uma") : null,
    pendente: escolhida === null,
  });

  const opcoesNaTela = opcoes.length > 0 && (
    <section className="min-w-0" data-recolhido={recolhidas ? "sim" : "nao"} data-opcoes-de-conteudo="">
      <CabecalhoDeSecao
        className={recolhidas ? "" : "mb-3"}
        titulo="Opções"
        descricao={escolhida !== null ? `Opção ${escolhida + 1} escolhida` : `${opcoes.length} opções`}
        recolher={
          escolhida !== null
            ? {
                recolhido: recolhidas,
                onAlternar: () => setOpcoesRecolhidas(!opcoesRecolhidas),
                modo: "titulo",
                resumo: (
                  <>
                    Opção {escolhida + 1} escolhida ·{" "}
                    <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setOpcoesRecolhidas(false)} data-trocar-opcao="">
                      Trocar
                    </button>
                  </>
                ),
              }
            : undefined
        }
      />
      {!recolhidas && (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3" data-grade-de-opcoes="">
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
                {o.conferencia && <NotaDaCopy nota={o.conferencia.nota} alerta={o.conferencia.alerta} avisos={o.conferencia.avisos} />}
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
    </section>
  );

  return (
    <div className="min-w-0 space-y-6" data-etapa-conteudo="">
      <Secao
        titulo="Conteúdo"
        descricao={opcoes.length ? `${opcoes.length} opções${escolhida !== null ? " · 1 escolhida" : ""}` : "Nenhuma opção ainda"}
        ajuda="Headline de resultado com até 8 palavras, subtítulo que explica, CTA com ação e benefício, uma seção por item da Direção, FAQ que responde objeções e SEO (título até 60 e descrição até 155). Nada de número ou depoimento inventado. O Redator e o pedido extra ficam em Mais opções."
        acao={
          <>
            {modelo && (
              <span className="mr-2 inline-flex min-w-0">
                <EstimativaInline partes={[{ modeloId: modelo.id, tipo: "texto", tokensEntrada: 7000, tokensSaida: 7500 }, parteDaConferenciaDoJev()]} />
              </span>
            )}
            <button type="button" className={escolhida !== null ? botao.secundario : botao.primario} disabled={gerando} onClick={() => void gerar()} data-gerar-conteudo="">
              {gerando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {opcoes.length ? "Gerar outras 3" : "Gerar 3 opções"}
            </button>
          </>
        }
      >
        <div className="min-w-0" data-mais-opcoes-do-conteudo="">
          <TituloRecolhivel titulo="Mais opções" recolhido={maisRecolhido} onAlternar={() => setMaisRecolhido(!maisRecolhido)} resumo={modelo ? `Redator: ${nomeDoModelo(modelo)}` : "Redator padrão"} />
          {!maisRecolhido && (
            <div className="mt-2 grid min-w-0 grid-cols-1 items-end gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
              <input value={pedido} onChange={(e) => setPedido(e.target.value)} maxLength={600} placeholder="Pedido extra (opcional): mais direto, falar de prazo..." className={campo} aria-label="Pedido extra para o conteúdo" />
              <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modelo ? modelo.id : ""} onChange={setModeloId} rotulo="Redator" />
            </div>
          )}
        </div>
        {custo !== null && <p className={juntar(texto.auxiliar, "mt-2")}>Custo desta geração: {usd(custo)}</p>}
        {!opcoes.length && !gerando && <EstadoVazio compacto className="mt-3" icone={<Sparkles className="h-5 w-5" />} titulo="Gere as 3 opções e escolha uma." />}
      </Secao>

      {/* Com a escolhida, a copy por seção vem antes das opções (é o que se edita no dia a dia). */}
      {escolhida !== null ? (
        <>
          <CopyPorSecao site={site} modeloId={modelo ? modelo.id : null} />
          <SerieDoGrafico site={site} />
          {opcoesNaTela}
        </>
      ) : (
        <>
          {opcoesNaTela}
          <CopyPorSecao site={site} modeloId={modelo ? modelo.id : null} />
          <SerieDoGrafico site={site} />
        </>
      )}
    </div>
  );
}
