import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { PreencherComIA } from "@/components/sistema";
import { botao, campo, campoTexto, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { modeloDoPapel } from "@/lib/mesa/api";
import { acharNoMapa, mapaDoSite, secaoDaBiblioteca, secoesDoMapa } from "../../../supabase/functions/_shared/site-biblioteca";
import { rotuloDaSecao, type OpcaoDeCopy } from "../../../supabase/functions/_shared/site-metodo";
import { type LinhaDoSite, useSalvarSite } from "./siteApi";
import { listaDoValor, textoDoValor } from "./CampoComIA";

type Campos = { titulo: string; texto: string; itens: string };
type OpcaoDaSecao = { titulo: string; texto: string; itens: string[]; cta: string };

/**
 * Copy por seção (SIT2): depois de escolher uma das 3 opções, cada seção do
 * mapa pode ser editada à mão, preenchida com o ✨ (pela fórmula da seção na
 * biblioteca) ou ganhar 3 opções só dela para escolher. A abertura (headline,
 * subtítulo e CTA) também. Salvar guarda a versão anterior.
 */
export default function CopyPorSecao({ site, modeloId }: { site: LinhaDoSite; modeloId?: string | null }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const opcoes: OpcaoDeCopy[] = Array.isArray(site.conteudo.opcoes) ? site.conteudo.opcoes : [];
  const i = typeof site.conteudo.escolhida === "number" ? site.conteudo.escolhida : null;
  const escolhida = i !== null && opcoes[i] ? opcoes[i] : null;
  const porSecao = (site.conteudo.por_secao || {}) as Record<string, { opcoes: OpcaoDaSecao[] }>;
  const mapa = useMemo(() => mapaDoSite(site), [site]);
  const uids = secoesDoMapa(mapa);
  const [aberta, setAberta] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Campos>({ titulo: "", texto: "", itens: "" });
  const [abertura, setAbertura] = useState({ headline: "", subtitulo: "", cta: "" });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const modelo = modeloDoPapel(catalogo, "site", modeloId || site.modelo);

  const atual = (uid: string): Campos => {
    const s = escolhida ? escolhida.secoes.find((x) => x.id === uid) : null;
    return { titulo: s ? s.titulo : "", texto: s ? s.texto : "", itens: s ? s.itens.join("\n") : "" };
  };

  useEffect(() => {
    if (aberta) setRascunho(atual(aberta));
    // Ao abrir outra seção ou quando a copy salva muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, JSON.stringify(escolhida || null)]);
  useEffect(() => {
    setAbertura({ headline: escolhida ? escolhida.headline : "", subtitulo: escolhida ? escolhida.subtitulo : "", cta: escolhida ? escolhida.cta : "" });
  }, [JSON.stringify(escolhida ? [escolhida.headline, escolhida.subtitulo, escolhida.cta] : null)]);

  if (!escolhida) return null;

  const salvarSecao = async (uid: string, campos: Record<string, unknown>) => {
    await salvarSite("conteudo_editar", { site_id: site.id, secao: uid, campos });
  };

  const rodar = async (rotulo: string, fn: () => Promise<void>) => {
    setOcupado(rotulo);
    try {
      await fn();
    } catch (e) {
      avisarErro(e, rotulo);
    } finally {
      setOcupado(null);
    }
  };

  const gerar3 = (uid: string) =>
    rodar("As opções da seção não saíram", async () => {
      await salvarSite("secao_copy_gerar", { site_id: site.id, secao: uid, modelo_id: modelo ? modelo.id : undefined });
      atualizarCusto();
    });

  const camposDaSecao = (uid: string) => {
    const onde = acharNoMapa(mapa, uid);
    const lib = onde ? secaoDaBiblioteca(onde.tipo) : null;
    const c = atual(uid);
    const formula = lib ? lib.formula : "";
    return [
      { chave: `${uid}.titulo`, rotulo: "Título", tipo: "texto" as const, valorAtual: c.titulo, dica: `${formula} Título com até ${lib ? lib.max_palavras_titulo : 8} palavras.`, maximo: 140 },
      { chave: `${uid}.texto`, rotulo: "Texto", tipo: "texto_longo" as const, valorAtual: c.texto, dica: `${formula} De 1 a 3 frases.`, maximo: 700 },
      ...(lib && lib.itens ? [{ chave: `${uid}.itens`, rotulo: lib.itens.rotulo.charAt(0).toUpperCase() + lib.itens.rotulo.slice(1), tipo: "lista" as const, valorAtual: c.itens ? c.itens.split("\n") : [], dica: `${formula}${lib.so_real ? " Só com dado real das fontes." : ""}`, maximo: lib.itens.max }] : []),
    ];
  };

  const aplicarNaSecao = (uid: string) => async (v: Record<string, unknown>) => {
    const campos: Record<string, unknown> = {};
    if (v[`${uid}.titulo`] !== undefined) campos.titulo = textoDoValor(v[`${uid}.titulo`]);
    if (v[`${uid}.texto`] !== undefined) campos.texto = textoDoValor(v[`${uid}.texto`]);
    if (v[`${uid}.itens`] !== undefined) campos.itens = listaDoValor(v[`${uid}.itens`]);
    await salvarSecao(uid, campos);
  };

  // Os mesmos nomes da tela (Título, Subtítulo e Botão) na prévia do ✨.
  const camposDaAbertura = [
    { chave: "abertura.headline", rotulo: "Título", tipo: "texto" as const, valorAtual: abertura.headline, dica: "a headline: resultado para o público em até 8 palavras", maximo: 80 },
    { chave: "abertura.subtitulo", rotulo: "Subtítulo", tipo: "texto_longo" as const, valorAtual: abertura.subtitulo, dica: "o que é e para quem, em 1 ou 2 frases", maximo: 240 },
    { chave: "abertura.cta", rotulo: "Botão", tipo: "texto" as const, valorAtual: abertura.cta, dica: "o CTA: ação com benefício em até 5 palavras", maximo: 40 },
  ];
  const aberturaMudou = !!escolhida && (abertura.headline !== escolhida.headline || abertura.subtitulo !== escolhida.subtitulo || abertura.cta !== escolhida.cta);
  const aplicarNaAbertura = async (v: Record<string, unknown>) => {
    const campos: Record<string, unknown> = {};
    ["headline", "subtitulo", "cta"].forEach((k) => {
      if (v[`abertura.${k}`] !== undefined) campos[k] = textoDoValor(v[`abertura.${k}`]);
    });
    await salvarSite("conteudo_editar", { site_id: site.id, campos });
  };

  return (
    <Secao
      titulo="Copy por seção"
      descricao={`${uids.length} seção(ões) no mapa`}
      ajuda="A copy escolhida, seção por seção. Edite à mão, use o ✨ (pela fórmula da seção: PAS no problema, passos com verbo no processo, objeções no FAQ, preço só real no pricing) ou gere 3 opções só da seção e escolha. Salvar guarda a versão anterior."
      recolher="mesa-site:conteudo:por-secao"
    >
      <div className="min-w-0 space-y-3 border-b border-border pb-4" data-abertura="">
        <div className="flex min-w-0 items-center">
          <span className={juntar(texto.rotulo, "min-w-0 flex-1")}>Abertura</span>
          <PreencherComIA papel="site" clientId={clientId} marcaId={marca ? marca.id : null} campos={camposDaAbertura} rotulo="Preencher a abertura" onAplicar={aplicarNaAbertura} onDesfazer={aplicarNaAbertura} />
        </div>
        {/* UXS 30/09: os três campos com nome à vista (antes eram três caixas vazias só com aria-label). */}
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
          <CampoDeFormulario rotulo="Título">
            <input value={abertura.headline} onChange={(e) => setAbertura((a) => ({ ...a, headline: e.target.value }))} maxLength={80} className={campo} aria-label="Título da abertura" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Subtítulo">
            <input value={abertura.subtitulo} onChange={(e) => setAbertura((a) => ({ ...a, subtitulo: e.target.value }))} maxLength={240} className={campo} aria-label="Subtítulo da abertura" />
          </CampoDeFormulario>
          <div className="flex min-w-0 items-end">
            <CampoDeFormulario rotulo="Botão" className="mr-2 flex-1">
              <input value={abertura.cta} onChange={(e) => setAbertura((a) => ({ ...a, cta: e.target.value }))} maxLength={40} className={campo} aria-label="Botão da abertura" />
            </CampoDeFormulario>
            <button type="button" className={botao.secundario} disabled={!!ocupado || !aberturaMudou} onClick={() => void rodar("A abertura não foi salva", () => salvarSite("conteudo_editar", { site_id: site.id, campos: abertura }).then(() => undefined))} data-salvar-abertura="">
              Salvar
            </button>
          </div>
        </div>
      </div>
      <ul className={juntar(lista.aberta, lista.divisoria)}>
        {uids.map((uid) => {
          const onde = acharNoMapa(mapa, uid);
          const lib = onde ? secaoDaBiblioteca(onde.tipo) : null;
          const c = atual(uid);
          const vazia = !c.titulo && !c.texto;
          const aqui = aberta === uid;
          const geradas = porSecao[uid] && Array.isArray(porSecao[uid].opcoes) ? porSecao[uid].opcoes : [];
          return (
            <li key={uid} className="min-w-0 py-1" data-copy-da-secao={uid}>
              <div className="flex min-w-0 items-center">
                <button type="button" className={juntar(lista.linha, "min-w-0 flex-1 text-left")} onClick={() => setAberta(aqui ? null : uid)} aria-expanded={aqui}>
                  {aqui ? <ChevronDown className="mr-1.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mr-1.5 h-4 w-4 shrink-0" />}
                  <span className="mr-2 min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{rotuloDaSecao(uid)}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>{c.titulo || (onde && onde.pagina ? onde.pagina.titulo : "sem texto ainda")}</span>
                  </span>
                  {vazia && <span className={juntar(etiqueta, "bg-muted")}>vazia</span>}
                  {lib && lib.so_real && <span className={juntar(etiqueta, "ml-1 bg-muted")}>só foto real</span>}
                </button>
                {/* A fórmula da seção no "?", fora do botão que abre a seção. */}
                {aqui && lib && lib.formula && (
                  <AjudaRecolhida className="ml-1 shrink-0" rotulo="Fórmula da seção">
                    {lib.formula}
                  </AjudaRecolhida>
                )}
              </div>
              {aqui && (
                <div className="min-w-0 space-y-3 px-2 pb-3 pt-1">
                  <input value={rascunho.titulo} onChange={(e) => setRascunho((r) => ({ ...r, titulo: e.target.value }))} maxLength={140} className={campo} aria-label={`Título de ${rotuloDaSecao(uid)}`} placeholder="Título" />
                  <textarea value={rascunho.texto} onChange={(e) => setRascunho((r) => ({ ...r, texto: e.target.value }))} rows={3} maxLength={900} className={campoTexto} aria-label={`Texto de ${rotuloDaSecao(uid)}`} placeholder="Texto" />
                  {lib && lib.itens && (
                    <textarea value={rascunho.itens} onChange={(e) => setRascunho((r) => ({ ...r, itens: e.target.value }))} rows={4} className={campoTexto} aria-label={`${lib.itens.rotulo} de ${rotuloDaSecao(uid)}`} placeholder={`${lib.itens.rotulo}, um por linha`} />
                  )}
                  <div className="flex min-w-0 flex-wrap items-center">
                    <span className="mb-2 mr-2 inline-flex">
                      <PreencherComIA papel="site" clientId={clientId} marcaId={marca ? marca.id : null} campos={camposDaSecao(uid)} rotulo="Preencher a seção" onAplicar={aplicarNaSecao(uid)} onDesfazer={aplicarNaSecao(uid)} />
                    </span>
                    <button type="button" className={juntar(botao.secundario, "mb-2 mr-2")} disabled={!!ocupado} onClick={() => void gerar3(uid)} data-gerar-3-secao={uid}>
                      {ocupado === "As opções da seção não saíram" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                      Gerar 3 para a seção
                    </button>
                    <span className="mb-2 mr-2">{modelo && <EstimativaInline partes={[{ modeloId: modelo.id, tipo: "texto", tokensEntrada: 4500, tokensSaida: 2200 }]} />}</span>
                    <button type="button" className={juntar(botao.primario, "mb-2")} disabled={!!ocupado} onClick={() => void rodar("A seção não foi salva", () => salvarSecao(uid, { titulo: rascunho.titulo, texto: rascunho.texto, itens: rascunho.itens.split("\n") }))}>
                      Salvar a seção
                    </button>
                  </div>
                  {geradas.length > 0 && (
                    <ul className="min-w-0 space-y-2 border-t border-border pt-2">
                      {geradas.map((o, n) => (
                        <li key={n} className="flex min-w-0 items-start">
                          <span className="mr-2 min-w-0 flex-1">
                            <span className={juntar(texto.corpo, "block font-medium")}>{o.titulo}</span>
                            <span className={juntar(texto.auxiliar, "block whitespace-normal")}>{o.texto}</span>
                            {o.itens.length > 0 && <span className={juntar(texto.auxiliar, "block truncate")}>{o.itens.join(" · ")}</span>}
                          </span>
                          <button type="button" className={botao.secundario} disabled={!!ocupado} onClick={() => void rodar("A opção não entrou", () => salvarSecao(uid, { titulo: o.titulo, texto: o.texto, itens: o.itens, ...(o.cta ? { cta: o.cta } : {}) }))}>
                            Usar
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}
