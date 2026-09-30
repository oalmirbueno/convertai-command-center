import { useState, type ReactNode } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useKitDaMesa } from "@/components/mesa/kitDaMesa";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { CREDITO_DA_BASE } from "@/lib/uiux/carregar";
import EscolhaDoProduto from "@/components/uiux/EscolhaDoProduto";
import { normalizarEstilo, PRESETS_DE_ESTILO } from "../../../supabase/functions/_shared/site-biblioteca";
import { rotuloDoAtributo } from "../../../supabase/functions/_shared/site-metodo";
import { lerBaseDeDesign } from "../../../supabase/functions/_shared/uiux/consultas";
import { TOKENS_DA_BASE, TOKENS_DO_RERANK } from "../../../supabase/functions/_shared/uiux/jev-da-base";
import { chamarSite, type LinhaDoSite, useSalvarSite } from "./siteApi";
import { destaqueDaMarca, PreviaDoPreset } from "./PreviaDoPreset";
import EstilosDaBase from "./EstilosDaBase";
import SugestaoDaBase, { type EscolhasDaSugestao, type RespostaDaSugestao } from "./SugestaoDaBase";

export { PreviaDoPreset } from "./PreviaDoPreset";

/** Jev da base: as listas completas (~18 mil tokens) e o refino (~3,5 mil) a US$ 0,042 por milhão. */
export const CUSTO_DA_BASE = ((TOKENS_DA_BASE + TOKENS_DO_RERANK) * 0.042) / 1e6;

const ABAS = [
  { valor: "casa", rotulo: "Presets da casa" },
  { valor: "base", rotulo: "Estilos da base" },
];

/**
 * Estilo do site (SIT2 + UXM). Duas abas: os 11 presets da casa (intocados:
 * trocam o DNA e mostram a prévia na cor de destaque da marca) e os 50
 * estilos da base UI UX Pro Max (carregados sob demanda). Escolher um estilo
 * da base grava base_de_design.estilo e aplica o preset da casa ligado a ele;
 * dá para trocar o preset depois sem perder o estilo da base. A linha "Tipo de
 * produto" mostra o produto da marca (do Jev ou da equipe) e troca pela lista
 * com busca. "Sugerir" pede ao Jev produto, estilo, padrão, par e preset numa
 * ida só, com a prévia antes de aplicar e o Desfazer depois.
 *
 * UXS 30/09: o preset da casa é da etapa Direção (valor e onPreset), que grava
 * mapa, estilo e direção juntos no Salvar e no Seguir da barra; os presets de
 * movimento foram para o grupo "Movimento" do Ajuste fino (children). O que a
 * base aplica (produto, estilo da base, sugestão) continua gravando na hora,
 * com o Desfazer.
 */
export default function PresetsDeEstilo({ site, preset, onPreset, mudou = false, children }: { site: LinhaDoSite; preset: string | null; onPreset: (id: string | null) => void; mudou?: boolean; children?: ReactNode }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const kit = useKitDaMesa();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const base = lerBaseDeDesign(site.direcao ? site.direcao.base_de_design : null);
  const setPreset = onPreset;
  const [aba, setAba] = useEstadoDaTela<string>(`mesa-site:estilo:aba:${clientId}`, "casa", { validar: (v): v is string => v === "casa" || v === "base" });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [produtoAberto, setProdutoAberto] = useState(false);
  const [sugestao, setSugestao] = useState<RespostaDaSugestao | null>(null);
  const [janela, setJanela] = useState(false);
  const reserva = site.dna && Array.isArray(site.dna.cores_das_referencias) && site.dna.cores_das_referencias[0] ? String(site.dna.cores_das_referencias[0]) : "#00D52B";
  const destaque = destaqueDaMarca((kit.data && (kit.data as { paleta?: Array<{ hex?: string; papel?: string }> }).paleta) || (marca ? marca.paleta : null), reserva);
  const nome = (marca && marca.nome) || site.nome;


  /** Grava na base com o Desfazer (volta base, estilo e DNA de antes). */
  const gravarNaBase = async (corpo: Record<string, unknown>, frase: string, depois?: () => Promise<unknown>) => {
    const d = await salvarSite<{ site?: LinhaDoSite; anterior?: Record<string, unknown> }>("base_salvar", { site_id: site.id, ...corpo });
    if (depois) await depois();
    const anterior = d && d.anterior;
    toast.success(frase, {
      duration: 10_000,
      action: anterior
        ? {
            label: "Desfazer",
            onClick: () => {
              salvarSite("base_salvar", { site_id: site.id, restaurar: anterior }).catch((e) => avisarErro(e, "Não foi possível desfazer"));
            },
          }
        : undefined,
    });
  };

  const sugerir = async () => {
    setOcupado("jev");
    setSugestao(null);
    setJanela(true);
    try {
      const d = await chamarSite<RespostaDaSugestao>("base_sugerir", { site_id: site.id });
      setSugestao(d);
    } catch (e) {
      setJanela(false);
      avisarErro(e, "O Jev não sugeriu");
    } finally {
      setOcupado(null);
    }
  };

  const recalcular = async (produto: string) => {
    setOcupado("recalcular");
    try {
      const d = await chamarSite<RespostaDaSugestao>("base_recalcular", { site_id: site.id, produto, probabilidades: sugestao ? sugestao.probabilidades || {} : {} });
      setSugestao((s) => ({ ...(s || {}), ...d, probabilidades: s ? s.probabilidades : {}, aviso: s ? s.aviso : null, custo_usd: s ? s.custo_usd : 0 }) as RespostaDaSugestao);
    } catch (e) {
      avisarErro(e, "A sugestão não foi refeita");
    } finally {
      setOcupado(null);
    }
  };

  const aplicarSugestao = async (e: EscolhasDaSugestao, marcados: Record<keyof EscolhasDaSugestao, boolean>) => {
    setOcupado("aplicar");
    try {
      const corpo: Record<string, unknown> = { origem: sugestao && !sugestao.sem_jev ? "jev" : "equipe", aplicar_preset: !marcados.preset, sugestao: { probabilidades: sugestao ? sugestao.probabilidades || {} : {} } };
      if (marcados.produto && e.produto) corpo.produto = e.produto;
      if (marcados.estilo && e.estilo) corpo.estilo = e.estilo;
      if (marcados.padrao && e.padrao) corpo.padrao = e.padrao;
      if (marcados.par && e.par) corpo.par = e.par;
      const presetDoJev = marcados.preset && e.preset ? e.preset : null;
      await gravarNaBase(corpo, "Base de design aplicada", presetDoJev ? () => salvarSite("estilo_salvar", { site_id: site.id, preset: presetDoJev, motion: normalizarEstilo(site.estilo || {}).motion, aplicar_dna: true }) : undefined);
      setJanela(false);
      setSugestao(null);
    } catch (err) {
      avisarErro(err, "A base não foi aplicada");
    } finally {
      setOcupado(null);
    }
  };

  const escolherProduto = async (no: string) => {
    setProdutoAberto(false);
    if (janela) {
      await recalcular(no);
      return;
    }
    setOcupado("produto");
    try {
      await gravarNaBase({ produto: no, origem: "equipe" }, "Tipo de produto trocado");
    } catch (e) {
      avisarErro(e, "O tipo de produto não foi salvo");
    } finally {
      setOcupado(null);
    }
  };

  const escolherEstiloDaBase = async (id: string) => {
    setOcupado("estilo-base");
    try {
      await gravarNaBase({ estilo: id, origem: "equipe", aplicar_preset: true }, "Estilo da base aplicado (com o preset da casa ligado)");
    } catch (e) {
      avisarErro(e, "O estilo da base não foi salvo");
    } finally {
      setOcupado(null);
    }
  };

  const escolhido = PRESETS_DE_ESTILO.find((p) => p.id === preset) || null;
  const produtoRotulo = base.produto ? base.produto.rotulo || `produto ${base.produto.id}` : null;
  const resumo = [escolhido ? escolhido.rotulo : "Sem preset", base.estilo ? `base: ${base.estilo.rotulo || base.estilo.id}` : "", mudou ? "não salvo" : ""].filter(Boolean).join(" · ");

  return (
    <Secao
      titulo="Estilo"
      descricao={resumo}
      ajuda={`Duas fontes de estilo: os 11 presets da casa (DNA, movimento e nível, com prévia na cor de destaque da marca) e os 50 estilos da base UI UX Pro Max. O estilo da base aplica o preset da casa mais próximo; a paleta, as fontes e a logo são sempre as da marca. Sugerir pede ao Jev tipo de produto, estilo, padrão de página, par de fontes e preset numa ida só. O Ajuste fino mostra e muda o DNA, o movimento (os presets de movimento usam só o kit livre e respeitam o movimento reduzido; até 3) e a referência de nível. O preset da casa grava no Salvar ou no Seguir do pé da etapa; o que vem da base grava na hora, com Desfazer. ${CREDITO_DA_BASE}`}
      recolher="mesa-site:direcao:estilo"
      acao={
        <button type="button" className={botao.secundario} disabled={!!ocupado} onClick={() => void sugerir()} title={`Custo do Jev: ~${usd(CUSTO_DA_BASE)}`} data-sugerir-base="">
          {ocupado === "jev" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
          Sugerir
        </button>
      }
    >
      <div className="flex min-w-0 flex-wrap items-center" data-tipo-de-produto={base.produto ? base.produto.id : ""}>
        <span className={juntar(texto.rotulo, "mr-2")}>Tipo de produto</span>
        <span className={juntar(texto.corpo, "mr-2 min-w-0 truncate")}>{produtoRotulo || "não escolhido"}</span>
        {base.produto && <span className={juntar(etiqueta, "mr-2 bg-muted")}>{base.produto.origem === "jev" ? "do Jev" : "da equipe"}</span>}
        <button type="button" className={botao.discreto} disabled={!!ocupado} onClick={() => setProdutoAberto(true)} data-trocar-produto="">
          {ocupado === "produto" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          {base.produto ? "Trocar" : "Escolher"}
        </button>
      </div>
      <SeletorCompacto rotulo="Fonte do estilo" opcoes={ABAS} valor={aba} onEscolher={setAba} />
      {aba === "base" ? (
        <EstilosDaBase destaque={destaque} nome={nome} produtoNo={base.produto ? base.produto.id : null} escolhido={base.estilo ? base.estilo.id : null} ocupado={ocupado === "estilo-base"} onEscolher={(id) => void escolherEstiloDaBase(id)} />
      ) : (
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" role="radiogroup" aria-label="Presets de estilo" data-presets-de-estilo="">
          {PRESETS_DE_ESTILO.map((p) => {
            const ligado = p.id === preset;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={ligado}
                onClick={() => setPreset(ligado ? null : p.id)}
                title={`${p.descricao}. DNA: ${p.atributos.map(rotuloDoAtributo).join(", ")}`}
                className={juntar("min-w-0 rounded-md p-1 text-left transition-colors", ligado ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-muted")}
                data-preset={p.id}
              >
                <PreviaDoPreset p={p} destaque={destaque} nome={nome} />
                <span className="mt-1.5 flex min-w-0 items-center px-1">
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{p.rotulo}</span>
                  {ligado ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /> : <span className={juntar(etiqueta, "bg-muted")}>{p.modo}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {children}
      <EscolhaDoProduto
        aberta={produtoAberto}
        onFechar={() => setProdutoAberto(false)}
        atual={base.produto ? base.produto.id : null}
        sugeridos={sugestao ? sugestao.sugestao.produto.top : []}
        onEscolher={(no) => void escolherProduto(no)}
      />
      <SugestaoDaBase
        aberta={janela}
        onFechar={() => {
          setJanela(false);
          setSugestao(null);
        }}
        resposta={sugestao}
        aplicando={ocupado === "aplicar"}
        recalculando={ocupado === "recalcular"}
        onTrocarProduto={() => setProdutoAberto(true)}
        onAplicar={(e, m) => void aplicarSugestao(e, m)}
      />
    </Secao>
  );
}
