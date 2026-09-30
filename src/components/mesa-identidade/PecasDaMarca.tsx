import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookmarkPlus, Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { copiarTexto } from "@/components/mesa/ContextoPaleta";
import Secao from "@/components/sistema/Secao";
import { PreencherComIA } from "@/components/sistema";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, foco, juntar, texto } from "@/components/sistema/estilos";
import { carregarImagem } from "@/lib/mockups/api";
import { useFontesGoogle } from "@/lib/identidade/fontesGoogle";
import { dataUrlDoBucket, desenharLayout } from "@/lib/identidade/desenharPeca";
import { assinaturaDeEmail, layoutDaPeca, PECAS_DA_MARCA, svgDoLayout, type PecaDaMarca } from "../../../supabase/functions/mesa-identidade/modulos/aplicacoes-da-marca";
import { contextoParaPreencher, useProjetoDaMesa } from "./Comuns";
import { useValorSalvo } from "./gravacao";
import { blobDoCanvas, enviarFeitoNaTela } from "./arquivosDaMarca";
import { salvarArquivo } from "./exportarNoNavegador";

type Assinatura = { pessoa: string; cargo: string; telefone: string; email: string; site: string; instagram: string; logo_url: string };
const ASSINATURA_VAZIA: Assinatura = { pessoa: "", cargo: "", telefone: "", email: "", site: "", instagram: "", logo_url: "" };
const CAMPOS_DA_ASSINATURA: Array<{ chave: keyof Assinatura; rotulo: string }> = [
  { chave: "pessoa", rotulo: "Nome da pessoa" },
  { chave: "cargo", rotulo: "Cargo" },
  { chave: "telefone", rotulo: "Telefone" },
  { chave: "email", rotulo: "E-mail" },
  { chave: "site", rotulo: "Site" },
  { chave: "instagram", rotulo: "Instagram" },
  { chave: "logo_url", rotulo: "Logo pública (https)" },
];

/** Uma peça desenhada no canvas (prévia pequena; o PNG sai no tamanho real). */
function Peca({ peca, dados, imagens, pronta, onGuardar, guardando }: { peca: (typeof PECAS_DA_MARCA)[number]; dados: Parameters<typeof layoutDaPeca>[1]; imagens: { logo?: HTMLImageElement | null; padrao?: HTMLImageElement | null }; pronta: boolean; onGuardar: (png: Blob, svg: string) => void; guardando: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const layout = useMemo(() => layoutDaPeca(peca.valor, dados), [peca.valor, JSON.stringify(dados)]);
  useEffect(() => {
    if (ref.current) desenharLayout(layout, imagens, Math.min(1, 360 / Math.max(layout.largura, layout.altura)), ref.current);
  }, [layout, imagens.logo, imagens.padrao, pronta]);
  const exportar = async (formato: "png" | "svg") => {
    if (formato === "png") {
      const c = desenharLayout(layout, imagens, 1);
      salvarArquivo(await blobDoCanvas(c, "image/png"), `${peca.valor}.png`, "image/png");
      return;
    }
    const svg = svgDoLayout(layout, { logo: dados.temLogo ? await hrefDaLogo() : null, padrao: dados.temPadrao ? await hrefDoPadrao() : null });
    salvarArquivo(new Blob([svg], { type: "image/svg+xml" }), `${peca.valor}.svg`, "image/svg+xml");
  };
  const hrefDaLogo = () => Promise.resolve((imagens.logo && imagens.logo.getAttribute("data-href")) || null);
  const hrefDoPadrao = () => Promise.resolve((imagens.padrao && imagens.padrao.getAttribute("data-href")) || null);
  return (
    <figure className="min-w-0" data-peca-da-marca={peca.valor}>
      <span className="flex min-w-0 items-center justify-center overflow-hidden rounded-md bg-muted p-3" style={{ minHeight: 160 }}>
        <canvas ref={ref} className="max-h-[360px] max-w-full" aria-label={`Prévia: ${peca.rotulo}`} />
      </span>
      <figcaption className="mt-1.5 flex min-w-0 items-center">
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{peca.rotulo}</span>
        <button type="button" className={botao.icone} aria-label={`Baixar ${peca.rotulo} em PNG`} title="PNG" onClick={() => void exportar("png")}>
          <Download className="h-4 w-4" />
        </button>
        <button type="button" className={juntar(botao.barra, "text-[11px]")} aria-label={`Baixar ${peca.rotulo} em SVG`} onClick={() => void exportar("svg")}>
          SVG
        </button>
        <button
          type="button"
          className={botao.icone}
          aria-label={`Guardar ${peca.rotulo} no brandbook`}
          title="Guardar no brandbook"
          disabled={guardando}
          onClick={() => void (async () => onGuardar(await blobDoCanvas(desenharLayout(layout, imagens, 1), "image/png"), svgDoLayout(layout, { logo: await hrefDaLogo(), padrao: await hrefDoPadrao() })))()}
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />}
        </button>
      </figcaption>
    </figure>
  );
}

/** Imagem do bucket mesa pronta para o canvas, com o data URL guardado (o SVG leva a imagem dentro). */
async function imagemComHref(caminho: string): Promise<HTMLImageElement | null> {
  try {
    const img = await carregarImagem(caminho, "mesa");
    const href = await dataUrlDoBucket(caminho);
    if (href && href.length < 2_500_000) img.setAttribute("data-href", href);
    return img;
  } catch {
    return null;
  }
}

/**
 * Peças da marca (IDV2): redes sociais, papelaria e assinatura de e-mail,
 * montadas por código com a logo real, as cores e a tipografia do sistema.
 * PNG no tamanho real e SVG (vetor) para baixar; "Guardar" leva a peça ao
 * brandbook (páginas Redes e Papelaria).
 */
export default function PecasDaMarca() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const d = projeto.dados || {};
  const sistema = (d.sistema || {}) as Record<string, any>;
  const aplicacoes = (d.aplicacoes || {}) as { itens?: Array<{ tipo: string; descricao: string; imagem: string | null }>; assinatura?: Partial<Assinatura> };
  const [grupo, setGrupo] = useState<"redes" | "papelaria">("redes");
  // UXS 30/09: o contato grava sozinho (sem o Salvar), e a releitura não passa por cima do que está sendo digitado.
  const pAss = useValorSalvo<Assinatura>({
    id: "aplicacoes:assinatura",
    servidor: { ...ASSINATURA_VAZIA, ...(aplicacoes.assinatura || {}) },
    paraSalvar: (a) => a,
    gravar: (n) => salvarParte("aplicacoes", { assinatura: n }),
  });
  const ass = pAss.valor;
  const [guardando, setGuardando] = useState<string | null>(null);
  const nome = String((d.naming && d.naming.nome) || (marca && !marca.principal ? marca.nome : mesa.clientName) || "Marca");
  const slogan = String((d.naming && d.naming.slogan) || "");
  const cores = (Array.isArray(sistema.cores) ? sistema.cores : []) as Array<{ hex: string; papel: string }>;
  const tipos = (Array.isArray(sistema.tipografia) ? sistema.tipografia : []) as Array<{ familia: string; uso: string }>;
  const titulo = (tipos.filter((t) => t.uso === "titulo")[0] || tipos[0] || { familia: "" }).familia;
  const corpo = (tipos.filter((t) => t.uso === "texto")[0] || { familia: titulo }).familia;
  const pronta = useFontesGoogle(titulo ? [{ familia: titulo, pesos: [700] }, { familia: corpo || titulo, pesos: [400] }] : [], !!titulo);
  const logoCaminho = sistema.logos && sistema.logos.principal ? sistema.logos.principal.previa_png || null : null;
  const padraoCaminho = (Array.isArray(sistema.grafismos) ? (sistema.grafismos as Array<{ tipo: string; imagem: string | null }>) : []).filter((g) => g.tipo === "pattern" && g.imagem)[0];
  const imagens = useQuery({
    queryKey: ["mesa-identidade", "pecas", logoCaminho, padraoCaminho ? padraoCaminho.imagem : null],
    staleTime: 10 * 60_000,
    queryFn: async () => ({ logo: logoCaminho ? await imagemComHref(logoCaminho) : null, padrao: padraoCaminho && padraoCaminho.imagem ? await imagemComHref(padraoCaminho.imagem) : null }),
  });
  const contato = [ass.telefone, ass.email, ass.site.replace(/^https?:\/\//i, ""), ass.instagram ? `@${ass.instagram.replace(/^@/, "")}` : ""].filter(Boolean);
  const dados = { nome, slogan, contato, pessoa: { nome: ass.pessoa, cargo: ass.cargo }, cores, tituloFamilia: titulo, textoFamilia: corpo, temLogo: !!(imagens.data && imagens.data.logo), temPadrao: !!(imagens.data && imagens.data.padrao) };
  const html = useMemo(() => assinaturaDeEmail({ nome: ass.pessoa || nome, cargo: ass.cargo, empresa: nome, telefone: ass.telefone, email: ass.email, site: ass.site, instagram: ass.instagram, logoUrl: ass.logo_url || null, cores, familia: corpo }), [JSON.stringify(ass), nome, JSON.stringify(cores), corpo]);
  const marcaId = projeto.marca_id || (marca && !marca.principal ? marca.id : null);

  /** Troca e grava já (Preencher com IA e o Desfazer dele). Lança para a peça mostrar o erro. */
  const salvarAssinatura = async (nova: Assinatura) => {
    try {
      await pAss.trocarESalvar(nova);
    } catch (e) {
      avisarErro(e, "Os dados de contato não foram salvos");
      throw e;
    }
  };

  const guardar = async (peca: (typeof PECAS_DA_MARCA)[number], png: Blob, svg: string) => {
    setGuardando(peca.valor);
    try {
      const r = await enviarFeitoNaTela(mesa.clientId, projeto.id, "aplicacoes", peca.valor, png, svg);
      const itens = (aplicacoes.itens || []).filter((i) => i.tipo !== peca.rotulo).concat([{ tipo: peca.rotulo, descricao: `${peca.grupo === "redes" ? "Rede social" : "Papelaria"}: ${peca.rotulo}, montada com a logo e as cores do sistema.`, imagem: r.png }]);
      await salvarParte("aplicacoes", { itens: itens.slice(-8) });
      toast.success(`${peca.rotulo} no brandbook`);
    } catch (e) {
      avisarErro(e, "A peça não foi guardada");
    } finally {
      setGuardando(null);
    }
  };

  return (
    <>
      <Secao
        titulo="Peças da marca"
        descricao={`${(aplicacoes.itens || []).length} no brandbook`}
        recolher={`mesa-identidade:${projeto.id}:aplicacoes:pecas`}
        ajuda="Montadas por código com a logo real (prévia PNG do Sistema), as cores e a tipografia escolhidas. Baixe em PNG (tamanho real) ou SVG (vetor; as fontes precisam estar instaladas para abrir igual). Guardar leva a peça ao brandbook."
        acao={
          <span className="m-1 inline-flex overflow-hidden rounded-md border border-border" role="tablist" aria-label="Grupo de peças">
            {(["redes", "papelaria"] as const).map((g) => (
              <button key={g} type="button" role="tab" aria-selected={grupo === g} onClick={() => setGrupo(g)} className={juntar("h-8 px-3 text-[12px]", grupo === g ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted", foco)}>
                {g === "redes" ? "Redes sociais" : "Papelaria"}
              </button>
            ))}
          </span>
        }
      >
        {!logoCaminho && <p className={juntar(texto.auxiliar, "mb-3 text-warning")}>Sem a logo principal no Sistema, as peças saem com o nome da marca em texto.</p>}
        {!cores.length && <p className={juntar(texto.auxiliar, "mb-3 text-warning")}>Sem paleta no Sistema, as peças usam cores neutras.</p>}
        <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" data-grupo-de-pecas={grupo}>
          {PECAS_DA_MARCA.filter((p) => p.grupo === grupo).map((p) => (
            <Peca key={p.valor} peca={p} dados={dados} imagens={imagens.data || {}} pronta={pronta} guardando={guardando === p.valor} onGuardar={(png, svg) => void guardar(p, png, svg)} />
          ))}
        </div>
      </Secao>

      <Secao
        titulo="Contato e assinatura de e-mail"
        divisoria
        descricao={`${ass.email || ass.telefone ? "Preenchido" : "Em aberto"}${pAss.pendente ? " · não salvo" : ""}`}
        recolher={`mesa-identidade:${projeto.id}:aplicacoes:assinatura`}
        ajuda="Os dados entram no cartão, no timbrado e na assinatura. Para a logo aparecer no e-mail, use um endereço público (https) da logo, como o do site: link assinado do painel expira."
        acao={
          <>
            <PreencherComIA
              papel="identidade"
              clientId={mesa.clientId}
              marcaId={marcaId}
              campos={CAMPOS_DA_ASSINATURA.filter((c) => c.chave !== "pessoa" && c.chave !== "cargo" && c.chave !== "logo_url").map((c) => ({ chave: c.chave, rotulo: c.rotulo, tipo: "texto" as const, valorAtual: ass[c.chave], dica: "Só o que está nas fontes do cliente; nunca inventar telefone, e-mail ou endereço.", maximo: 120 }))}
              contexto={contextoParaPreencher(projeto)}
              onAplicar={async (v) => {
                const nova = { ...ass };
                for (const k of Object.keys(v)) if ((nova as Record<string, string>)[k] !== undefined) (nova as Record<string, string>)[k] = String(v[k] || "");
                await salvarAssinatura(nova);
              }}
              onDesfazer={async (a) => {
                const nova = { ...ass };
                for (const k of Object.keys(a)) if ((nova as Record<string, string>)[k] !== undefined) (nova as Record<string, string>)[k] = String(a[k] || "");
                await salvarAssinatura(nova);
              }}
            />
          </>
        }
      >
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            {CAMPOS_DA_ASSINATURA.map((c) => (
              <CampoDeFormulario key={c.chave} rotulo={c.rotulo}>
                <input className={campo} value={ass[c.chave]} maxLength={c.chave === "logo_url" ? 600 : 120} onChange={(e) => pAss.mudar({ ...ass, [c.chave]: e.target.value })} onBlur={() => void pAss.salvarAgora().catch(() => undefined)} />
              </CampoDeFormulario>
            ))}
          </div>
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-2")}>Prévia da assinatura</p>
            {/* HTML montado aqui com todo texto escapado e link só http(s), mailto e tel (aplicacoes-da-marca.ts). */}
            <div className="min-w-0 overflow-x-auto rounded-md bg-white p-4" data-assinatura-html="" dangerouslySetInnerHTML={{ __html: html }} />
            <div className="-m-1 mt-2 flex flex-wrap">
              <button type="button" className={juntar(botao.discreto, "m-1")} onClick={() => void copiarTexto(html).then((ok) => (ok ? toast.success("HTML copiado") : toast.error("Não deu para copiar")))}>
                <Copy className="mr-1.5 h-4 w-4" /> Copiar HTML
              </button>
              <button type="button" className={juntar(botao.discreto, "m-1")} onClick={() => salvarArquivo(new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>Assinatura</title></head><body>${html}</body></html>`], { type: "text/html" }), "assinatura-de-email.html", "text/html")}>
                <Download className="mr-1.5 h-4 w-4" /> Baixar .html
              </button>
            </div>
          </div>
        </div>
      </Secao>
    </>
  );
}
