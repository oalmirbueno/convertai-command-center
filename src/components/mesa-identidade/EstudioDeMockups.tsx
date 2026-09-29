import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, ImageOff, Loader2, Send, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { botao, Carregando, EstadoDeErro, EstadoVazio, Etapas, JanelaDoCelular, juntar, Secao, texto, useEstadoDaTela } from "@/components/sistema";
import { type KitDoContexto } from "@/components/mesa/contextoDoCliente";
import { useKitDaMarca } from "@/components/mesa/kitDaMesa";
import { textoDoErro } from "@/lib/mesa/api";
import { CATEGORIAS, candidatosDaSugestao, rotuloDaCategoria, type MockupDoCatalogo, type TexturaDoCatalogo } from "@/lib/mockups/catalogo";
import { arquivarAplicacao, carregarImagem, copiaParaBrandbook, enviarParaArquivos, lerAplicacoes, lerCatalogoDeMockups, lerTexturas, salvarAplicacao, sugerirMockups, urlAssinada, type SugestaoDoJev } from "@/lib/mockups/api";
import type { Ponto } from "@/lib/mockups/homografia";
import { ESCALA_POR_PAPEL, type EscolhasDoDesign, type LogoCarregada } from "@/lib/mockups/designDoSlot";
import { carregarLogos, comporCena, paraBlob, renderizarMockup } from "@/lib/mockups/renderizar";
import EditorDeCena from "./EditorDeCena";

/**
 * Estúdio de mockups da Mesa Identidade Visual (frente MCK, 29/09).
 *
 * Sequência: categorias -> sugestão do Jev para o segmento -> aplicar a marca em lote ->
 * cenas com IA (fachada, redes) -> escolher e enviar para Arquivos, aprovação e brandbook.
 * A composição é no navegador (WebGL ou reserva em canvas); a logo entra pelo código.
 */

type Etapa = "categorias" | "sugestao" | "aplicar" | "cenas" | "enviar";
const ETAPAS: Etapa[] = ["categorias", "sugestao", "aplicar", "cenas", "enviar"];

interface Pronto {
  url: string;
  chave: string;
}

interface Escolhido {
  /** id do mockup (catálogo) ou da aplicação (cena). */
  id: string;
  nome: string;
  origem: "catalogo" | "cena";
  aplicacaoId?: string | null;
  imagem?: Blob | null;
  /** Cena guardada: refeita no envio a partir da imagem e dos cantos. */
  cena?: { caminho: string; cantos: Ponto[]; luz: number } | null;
  noBrandbook: boolean;
  enviado?: boolean;
}

const COR_PADRAO = "#1a1a1a";

function coresDoKit(kit: KitDoContexto | null | undefined): string[] {
  const paleta = kit && Array.isArray(kit.paleta) ? kit.paleta : [];
  const hex = paleta.map((c) => String((c && c.hex) || "")).filter((h) => /^#?[0-9a-fA-F]{6}$/.test(h)).map((h) => (h.charAt(0) === "#" ? h : `#${h}`));
  // O verso, o timbrado e o envelope pedem uma segunda cor: sem ela no kit, branco.
  if (!hex.length) return [COR_PADRAO, "#ffffff"];
  return hex.length === 1 ? hex.concat(["#ffffff"]) : hex;
}

/** Mockup que entra no brandbook: título e caminho no bucket mesa (o formato de idv_projetos.dados.mockups). */
export interface MockupParaBrandbook {
  titulo: string;
  imagem: string;
}

export default function EstudioDeMockups({
  clientId,
  marcaId: marcaDada,
  onEnviados,
}: {
  clientId: string;
  marcaId?: string | null;
  /** Os enviados marcados "Brandbook" (a Etapa Mockups da Mesa Identidade guarda em dados.mockups). */
  onEnviados?: (itens: MockupParaBrandbook[]) => void;
}) {
  const marcaId: string | null = marcaDada || null;
  const qc = useQueryClient();
  const chave = `mesa-identidade:mockups:${clientId}:${marcaId || "cliente"}`;
  const [etapa, setEtapa] = useEstadoDaTela<Etapa>(`${chave}:etapa`, "categorias", { validar: (v) => ETAPAS.indexOf(v as Etapa) >= 0 });
  const [categorias, setCategorias] = useEstadoDaTela<string[]>(`${chave}:categorias`, ["papelaria", "cartao", "dispositivo", "caneca"], { validar: Array.isArray });
  const [aplicar, setAplicar] = useEstadoDaTela<string[]>(`${chave}:aplicar`, [], { validar: Array.isArray });
  const [ajustes, setAjustes] = useEstadoDaTela<{ fundo: number; segunda: number; textura: string; opacidade: number; desgaste: number; escala: number }>(
    `${chave}:ajustes`,
    { fundo: 0, segunda: 1, textura: "", opacidade: 0.3, desgaste: 0, escala: 0 },
    { validar: (v) => !!v && typeof v === "object" },
  );
  const [escolhidos, setEscolhidos] = useState<Escolhido[]>([]);
  const [sugestoes, setSugestoes] = useState<SugestaoDoJev[] | null>(null);
  const [avisoJev, setAvisoJev] = useState<string | null>(null);
  const [sugerindo, setSugerindo] = useState(false);
  const [prontos, setProntos] = useState<Record<string, Pronto>>({});
  const [renderizando, setRenderizando] = useState(false);
  const [aberto, setAberto] = useState<MockupDoCatalogo | null>(null);
  const [enviando, setEnviando] = useState(false);

  const catalogo = useQuery({ queryKey: ["mockups", "catalogo"], queryFn: lerCatalogoDeMockups, staleTime: 30 * 60_000 });
  const texturas = useQuery({ queryKey: ["mockups", "texturas"], queryFn: lerTexturas, staleTime: 30 * 60_000 });
  const aplicacoes = useQuery({ queryKey: ["mockups", "aplicacoes", clientId, marcaId], queryFn: () => lerAplicacoes(clientId, marcaId), enabled: !!clientId });

  // Kit da marca aberta (a marca que não é a principal nunca herda da outra).
  const { kit } = useKitDaMarca(clientId, marcaId);
  const cores = useMemo(() => coresDoKit(kit), [kit]);

  const logos = useQuery({
    queryKey: ["mockups", "logos", clientId, marcaId, kit && kit.logo_path, kit && kit.logo_file_id, kit && kit.logo_alt_path, kit && kit.logo_alt_file_id],
    enabled: !!kit,
    staleTime: 10 * 60_000,
    queryFn: () =>
      carregarLogos([
        { id: "principal", path: kit && kit.logo_path, fileId: kit && kit.logo_file_id, tom: kit && kit.logo_tom },
        { id: "alternativa", path: kit && kit.logo_alt_path, fileId: kit && kit.logo_alt_file_id, tom: kit && kit.logo_alt_tom },
      ]),
  });

  const texturaEscolhida: TexturaDoCatalogo | null = useMemo(() => (texturas.data || []).find((t) => t.id === ajustes.textura) || null, [texturas.data, ajustes.textura]);
  const texturaImg = useQuery({
    queryKey: ["mockups", "textura", texturaEscolhida && texturaEscolhida.caminho],
    enabled: !!texturaEscolhida,
    staleTime: Infinity,
    queryFn: () => carregarImagem((texturaEscolhida as TexturaDoCatalogo).caminho),
  });

  const escolhas: EscolhasDoDesign = useMemo(
    () => ({
      fundo: cores[ajustes.fundo % cores.length] || COR_PADRAO,
      segunda: cores[ajustes.segunda % cores.length] || "#ffffff",
      escala: ajustes.escala,
      textura: texturaImg.data ? { imagem: texturaImg.data, largura: texturaImg.data.naturalWidth, altura: texturaImg.data.naturalHeight } : null,
      opacidadeTextura: ajustes.opacidade,
      desgaste: ajustes.desgaste,
    }),
    [cores, ajustes, texturaImg.data],
  );

  const itens = catalogo.data ? catalogo.data.itens : [];
  const porId = useMemo(() => {
    const m: Record<string, MockupDoCatalogo> = {};
    itens.forEach((i) => (m[i.id] = i));
    return m;
  }, [itens]);
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    itens.forEach((i) => (c[i.categoria] = (c[i.categoria] || 0) + 1));
    return c;
  }, [itens]);

  // ------------------------------------------------------------------ aplicar em lote

  const listaParaAplicar = useMemo(() => aplicar.filter((id) => !!porId[id]), [aplicar, porId]);
  const versao = useRef(0);
  const logosProntas: LogoCarregada[] = logos.data || [];
  useEffect(() => {
    if (etapa !== "aplicar" || !listaParaAplicar.length || logos.isLoading) return;
    const minha = ++versao.current;
    const t = setTimeout(async () => {
      setRenderizando(true);
      for (const id of listaParaAplicar) {
        if (versao.current !== minha) return;
        const m = porId[id];
        try {
          const r = await renderizarMockup(m, "trabalho", logosProntas, escolhas);
          const blob = await paraBlob(r.canvas, "image/jpeg", 0.86);
          if (versao.current !== minha) return;
          const url = URL.createObjectURL(blob);
          setProntos((atual) => {
            const velho = atual[id];
            if (velho) URL.revokeObjectURL(velho.url);
            return { ...atual, [id]: { url, chave: String(minha) } };
          });
        } catch (e) {
          toast.error(`${m.nome}: ${textoDoErro(e, "não foi possível montar o mockup.")}`);
        }
      }
      if (versao.current === minha) setRenderizando(false);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa, listaParaAplicar.join(","), escolhas, logosProntas]);

  useEffect(
    () => () => {
      Object.keys(prontos).forEach((k) => URL.revokeObjectURL(prontos[k].url));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ------------------------------------------------------------------ ações

  const sugerir = async () => {
    const candidatos = candidatosDaSugestao(itens, categorias);
    if (!candidatos.length) {
      toast.error("Nenhum mockup nas categorias escolhidas.");
      return;
    }
    setEtapa("sugestao");
    setSugerindo(true);
    setAvisoJev(null);
    try {
      const r = await sugerirMockups({ clientId, marcaId, candidatos, quantos: Math.min(8, candidatos.length) });
      setSugestoes(r.sugestoes);
      setAvisoJev(r.aviso);
      setAplicar(r.sugestoes.map((s) => s.mockup_id));
    } catch (e) {
      // A sugestão falhou: segue com a ordem da sequência e diz o motivo.
      const lista = candidatos.slice(0, 8);
      setSugestoes(lista.map((m) => ({ mockup_id: m.id, nota: 0, confianca: null })));
      setAplicar(lista.map((m) => m.id));
      setAvisoJev(`Sem sugestão agora: ${textoDoErro(e)}. A lista segue a sequência; escolha à mão.`);
    } finally {
      setSugerindo(false);
    }
  };

  const configAtual = () => ({ fundo: escolhas.fundo, segunda: escolhas.segunda, escala: escolhas.escala, textura: ajustes.textura || null, opacidade: ajustes.opacidade, desgaste: ajustes.desgaste });

  /** Escolher grava na hora em mockup_aplicacoes; tirar arquiva (nada é apagado). */
  const alternarEscolha = (m: MockupDoCatalogo) => {
    const ja = escolhidos.find((e) => e.id === m.id && e.origem === "catalogo");
    if (ja) {
      setEscolhidos((atual) => atual.filter((e) => e !== ja));
      if (ja.aplicacaoId && !ja.enviado) arquivarAplicacao(ja.aplicacaoId).catch((e) => toast.error(`${m.nome}: ${textoDoErro(e, "a escolha não foi desfeita no banco.")}`));
      return;
    }
    const novo: Escolhido = { id: m.id, nome: m.nome, origem: "catalogo", noBrandbook: true };
    setEscolhidos((atual) => atual.concat([novo]));
    salvarAplicacao({ clientId, marcaId, origem: "catalogo", mockupId: m.id, config: configAtual() })
      .then((ap) => setEscolhidos((atual) => atual.map((e) => (e.id === m.id && e.origem === "catalogo" ? { ...e, aplicacaoId: ap.id } : e))))
      .catch((e) => toast.error(`${m.nome}: ${textoDoErro(e, "a escolha não foi guardada.")}`));
  };

  // Escolhas de uma visita anterior voltam (as ainda não enviadas).
  const restaurado = useRef(false);
  useEffect(() => {
    if (restaurado.current || !aplicacoes.data || !itens.length) return;
    restaurado.current = true;
    const salvos: Escolhido[] = aplicacoes.data
      .filter((a) => a.status === "escolhido")
      .map((a): Escolhido | null => {
        const cfg = (a.config || {}) as Record<string, unknown>;
        if (a.origem === "catalogo") {
          const m = a.mockup_id ? porId[a.mockup_id] : null;
          return m ? { id: m.id, nome: m.nome, origem: "catalogo" as const, aplicacaoId: a.id, noBrandbook: a.no_brandbook !== false } : null;
        }
        const cantos = Array.isArray(cfg.cantos) ? (cfg.cantos as Ponto[]) : null;
        if (!a.cena_caminho || !cantos || cantos.length !== 4) return null;
        return {
          id: a.id,
          nome: cfg.tipo === "social" ? "Redes sociais" : "Fachada",
          origem: "cena" as const,
          aplicacaoId: a.id,
          cena: { caminho: a.cena_caminho, cantos, luz: typeof cfg.luz === "number" ? cfg.luz : 0.6 },
          noBrandbook: true,
        };
      })
      .filter((e): e is Escolhido => !!e);
    if (salvos.length) setEscolhidos((atual) => salvos.filter((s) => !atual.some((e) => e.aplicacaoId === s.aplicacaoId)).concat(atual));
  }, [aplicacoes.data, itens.length, porId]);

  const baixar = async (m: MockupDoCatalogo) => {
    try {
      const r = await renderizarMockup(m, "alta", logosProntas, escolhas);
      const blob = await paraBlob(r.canvas, "image/png");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${m.id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível exportar o PNG."));
    }
  };

  const enviar = async () => {
    const fila = escolhidos.filter((e) => !e.enviado);
    if (!fila.length) return;
    setEnviando(true);
    let feitos = 0;
    const paraBrandbook: MockupParaBrandbook[] = [];
    for (const e of fila) {
      try {
        let png: Blob;
        if (e.origem === "catalogo") {
          const m = porId[e.id];
          if (!m) throw new Error("Mockup fora do catálogo");
          png = await paraBlob((await renderizarMockup(m, "alta", logosProntas, escolhas)).canvas, "image/png");
        } else if (e.imagem) {
          png = e.imagem;
        } else if (e.cena) {
          const img = await carregarImagem(e.cena.caminho, "mesa");
          const pronta = comporCena(img, e.cena.cantos, logosProntas, escolhas, e.cena.luz, 1);
          if (!pronta) throw new Error("Cena indisponível");
          png = await paraBlob(pronta, "image/png");
        } else {
          throw new Error("Cena sem imagem");
        }
        const cfg: Record<string, unknown> = configAtual();
        const chaveDoEnvio = `mesa-mockups:${clientId}:${marcaId || "cliente"}:${e.origem}:${e.id}:${JSON.stringify(cfg)}`.slice(0, 480);
        const envio = await enviarParaArquivos({ clientId, nome: `Mockup ${e.nome}`, png, chave: chaveDoEnvio, descricao: `Mockup da identidade visual (${e.nome}) montado no estúdio de mockups.` });
        if (e.noBrandbook) {
          // Cópia leve (JPEG até 1600 px) no bucket mesa, onde o brandbook busca as imagens.
          try {
            const caminho = await copiaParaBrandbook(clientId, envio.fileId, png);
            cfg.brandbook_imagem = caminho;
            paraBrandbook.push({ titulo: e.nome, imagem: caminho });
          } catch (err) {
            toast.warning(`${e.nome}: foi para Arquivos, mas a cópia do brandbook falhou (${textoDoErro(err)}).`);
          }
        }
        await salvarAplicacao({
          clientId,
          marcaId,
          origem: e.origem,
          mockupId: e.origem === "catalogo" ? e.id : null,
          cenaCaminho: null,
          config: cfg,
          fileId: envio.fileId,
          noBrandbook: e.noBrandbook,
          id: e.aplicacaoId || null,
        });
        if (envio.aviso) toast.warning(envio.aviso);
        feitos++;
        setEscolhidos((atual) => atual.map((x) => (x === e ? { ...x, enviado: true } : x)));
      } catch (err) {
        toast.error(`${e.nome}: ${textoDoErro(err, "não foi enviado.")}`);
      }
    }
    setEnviando(false);
    if (paraBrandbook.length && onEnviados) onEnviados(paraBrandbook);
    if (feitos) {
      toast.success(`${feitos} mockup${feitos > 1 ? "s" : ""} em Arquivos > Identidade visual, aguardando a revisão da agência.`);
      void qc.invalidateQueries({ queryKey: ["mockups", "aplicacoes", clientId, marcaId] });
      void qc.invalidateQueries({ queryKey: ["all-files"] });
      void qc.invalidateQueries({ queryKey: ["files"] });
    }
  };

  // ------------------------------------------------------------------ tela

  if (catalogo.isLoading) return <Carregando rotulo="Abrindo o catálogo de mockups" />;
  if (catalogo.isError) return <EstadoDeErro titulo="O catálogo não abriu" acao={<button className={botao.secundario} onClick={() => void catalogo.refetch()}>Tentar de novo</button>} />;
  if (catalogo.data && catalogo.data.semBanco) {
    return <EstadoVazio icone={<ImageOff className="h-5 w-5" />} titulo="O catálogo de mockups ainda não foi ativado" descricao="Falta aplicar a migration do estúdio e subir o primeiro lote." />;
  }
  if (!itens.length) return <EstadoVazio icone={<ImageOff className="h-5 w-5" />} titulo="Nenhum mockup no catálogo ainda" />;

  const semLogo = !logos.isLoading && !logosProntas.length;
  const enviadas = (aplicacoes.data || []).filter((a) => a.status === "enviado").length;

  return (
    <div className="grid min-w-0 gap-6">
      <Etapas
        rotulo="Etapas do estúdio de mockups"
        numerar
        valor={etapa}
        onEscolher={(v) => setEtapa(v as Etapa)}
        itens={[
          { valor: "categorias", rotulo: "Categorias", contador: categorias.length || null },
          { valor: "sugestao", rotulo: "Sugestão" },
          { valor: "aplicar", rotulo: "Aplicar", contador: listaParaAplicar.length || null },
          { valor: "cenas", rotulo: "Fachada e redes" },
          { valor: "enviar", rotulo: "Enviar", contador: escolhidos.length || null, destaque: escolhidos.length > 0 && etapa !== "enviar" },
        ]}
      />

      {semLogo ? (
        <p className={texto.auxiliar} role="status">
          O kit desta marca está sem logo: os mockups saem só com as cores.
        </p>
      ) : null}

      {etapa === "categorias" ? (
        <Secao
          titulo="Onde mostrar a marca"
          descricao={`${itens.length} mockups no catálogo`}
          recolher={false}
          ajuda="Escolha as categorias. O Jev ordena os mockups dessas categorias pelo que mais combina com o negócio do cliente; depois a marca é aplicada em todos de uma vez."
          acao={
            <span className="inline-flex items-center">
              <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => { setAplicar(candidatosDaSugestao(itens, categorias, 12).map((m) => m.id)); setEtapa("aplicar"); }}>
                Escolher à mão
              </button>
              <button type="button" className={botao.primario} disabled={!categorias.length || sugerindo} onClick={() => void sugerir()}>
                <Sparkles className="mr-1.5 h-4 w-4" aria-hidden /> Sugerir mockups
              </button>
            </span>
          }
        >
          <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {["Papelaria", "Digital", "Produto", "Exterior"].map((grupo) => (
              <div key={grupo} role="group" aria-label={grupo} className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-2")}>{grupo}</p>
                <div className="flex flex-wrap">
                  {CATEGORIAS.filter((c) => c.grupo === grupo).map((c) => {
                    const ligado = categorias.indexOf(c.id) >= 0;
                    const n = contagem[c.id] || 0;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={ligado}
                        disabled={!n}
                        onClick={() => setCategorias((atual) => (ligado ? atual.filter((x) => x !== c.id) : atual.concat([c.id])))}
                        className={juntar(botao.secundario, "mb-2 mr-2 h-8 px-3 text-[12px]", ligado && "border-primary bg-primary/10 text-foreground")}
                      >
                        {ligado ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> : null}
                        {c.rotulo}
                        <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">{n}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Secao>
      ) : null}

      {etapa === "sugestao" ? (
        <Secao
          titulo="Sugestão para o segmento"
          descricao={sugerindo ? "O Jev está comparando os mockups" : sugestoes ? `${aplicar.length} marcados` : undefined}
          recolher={false}
          ajuda="Nota do Jev (Score): quanto cada mockup combina com o negócio e o público do cliente. Os mais altos já vêm marcados; marque ou desmarque à vontade."
          acao={
            <button type="button" className={botao.primario} disabled={!aplicar.length || sugerindo} onClick={() => setEtapa("aplicar")}>
              <Wand2 className="mr-1.5 h-4 w-4" aria-hidden /> Aplicar a marca em {aplicar.length}
            </button>
          }
        >
          {avisoJev ? <p className={juntar(texto.auxiliar, "mb-3")} role="status">{avisoJev}</p> : null}
          {sugerindo ? (
            <Carregando forma="grade" rotulo="Comparando os mockups" />
          ) : (
            <GradeDeMockups
              itens={((sugestoes || []).map((s) => porId[s.mockup_id]).filter(Boolean) as MockupDoCatalogo[]).concat(
                candidatosDaSugestao(itens, categorias).filter((m) => !(sugestoes || []).some((s) => s.mockup_id === m.id)),
              )}
              notas={(sugestoes || []).reduce((t, s) => ({ ...t, [s.mockup_id]: s.nota }), {} as Record<string, number>)}
              marcados={aplicar}
              onAlternar={(id) => setAplicar((atual) => (atual.indexOf(id) >= 0 ? atual.filter((x) => x !== id) : atual.concat([id])))}
            />
          )}
        </Secao>
      ) : null}

      {etapa === "aplicar" ? (
        <Secao
          titulo="A marca aplicada"
          descricao={renderizando ? "Montando" : `${escolhidos.filter((e) => e.origem === "catalogo").length} escolhidos`}
          recolher={false}
          ajuda="Toque no mockup para escolher. A cor, a textura e o tamanho da logo valem para todos. A versão da logo (do kit, branca ou preta) sai pelo contraste com a superfície."
          acao={
            <button type="button" className={botao.primario} disabled={!escolhidos.length} onClick={() => setEtapa("enviar")}>
              Revisar e enviar
            </button>
          }
        >
          <div className="mb-4 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SeletorDeCor rotulo="Cor de fundo" cores={cores} valor={ajustes.fundo} onEscolher={(i) => setAjustes((a) => ({ ...a, fundo: i }))} />
            <SeletorDeCor rotulo="Segunda cor" cores={cores} valor={ajustes.segunda} onEscolher={(i) => setAjustes((a) => ({ ...a, segunda: i }))} />
            <label className="grid min-w-0">
              <span className={juntar(texto.rotulo, "mb-1.5")}>Textura</span>
              <select className="block h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px]" value={ajustes.textura} onChange={(e) => setAjustes((a) => ({ ...a, textura: e.target.value }))}>
                <option value="">Sem textura</option>
                {(texturas.data || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0">
              <span className={juntar(texto.rotulo, "mb-1.5")}>Tamanho da logo</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={ajustes.escala}
                aria-label="Tamanho da logo (0 = automático)"
                onChange={(e) => setAjustes((a) => ({ ...a, escala: Number(e.target.value) }))}
              />
              <span className={texto.auxiliar}>{ajustes.escala === 0 ? `Automático (${Math.round(ESCALA_POR_PAPEL.arte * 100)}%)` : `${Math.round(ajustes.escala * 100)}%`}</span>
            </label>
            {texturaEscolhida ? (
              <>
                <label className="grid min-w-0">
                  <span className={juntar(texto.rotulo, "mb-1.5")}>Força da textura</span>
                  <input type="range" min={0} max={0.8} step={0.05} value={ajustes.opacidade} onChange={(e) => setAjustes((a) => ({ ...a, opacidade: Number(e.target.value) }))} />
                </label>
                <label className="grid min-w-0">
                  <span className={juntar(texto.rotulo, "mb-1.5")}>Desgaste da logo</span>
                  <input type="range" min={0} max={0.8} step={0.05} value={ajustes.desgaste} onChange={(e) => setAjustes((a) => ({ ...a, desgaste: Number(e.target.value) }))} />
                </label>
              </>
            ) : null}
          </div>
          {!listaParaAplicar.length ? (
            <EstadoVazio titulo="Nenhum mockup marcado" acao={<button className={botao.secundario} onClick={() => setEtapa("categorias")}>Escolher categorias</button>} />
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 desk:grid-cols-4">
              {listaParaAplicar.map((id) => {
                const m = porId[id];
                const p = prontos[id];
                const marcado = escolhidos.some((e) => e.id === id && e.origem === "catalogo");
                return (
                  <figure key={id} className="min-w-0">
                    <button
                      type="button"
                      aria-pressed={marcado}
                      aria-label={`${marcado ? "Tirar" : "Escolher"} ${m.nome}`}
                      onClick={() => alternarEscolha(m)}
                      className={juntar("relative block w-full overflow-hidden rounded-md bg-muted", marcado && "ring-2 ring-primary")}
                      style={{ paddingBottom: `${(m.alturaTrabalho / m.larguraTrabalho) * 100}%` }}
                    >
                      {p ? (
                        <img src={p.url} alt={m.nome} className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300" />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                        </span>
                      )}
                      {marcado ? (
                        <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-4 w-4" aria-hidden />
                        </span>
                      ) : null}
                    </button>
                    <figcaption className="mt-1.5 flex min-w-0 items-center">
                      <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{m.nome}</span>
                      <button type="button" className={botao.icone} aria-label={`Ver ${m.nome} grande`} onClick={() => setAberto(m)}>
                        <Sparkles className="h-4 w-4" aria-hidden />
                      </button>
                      <button type="button" className={botao.icone} aria-label={`Baixar ${m.nome} em PNG`} onClick={() => void baixar(m)}>
                        <Download className="h-4 w-4" aria-hidden />
                      </button>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}
        </Secao>
      ) : null}

      {etapa === "cenas" ? (
        <Secao
          titulo="Fachada e redes sociais"
          recolher={false}
          ajuda="A IA desenha só a cena, com uma placa ou tela lisa. A marca entra pelo código nos 4 cantos da área (achados sozinhos; arraste para ajustar). A IA nunca desenha a logo."
        >
          <EditorDeCena
            clientId={clientId}
            marcaId={marcaId}
            logos={logosProntas}
            escolhas={escolhas}
            onUsar={(r) => {
              setEscolhidos((atual) => atual.concat([{ id: r.aplicacaoId, nome: r.nome, origem: "cena", aplicacaoId: r.aplicacaoId, imagem: r.imagem, cena: { caminho: r.caminho, cantos: r.cantos, luz: r.luz }, noBrandbook: true }]));
              void qc.invalidateQueries({ queryKey: ["mockups", "aplicacoes", clientId, marcaId] });
            }}
          />
        </Secao>
      ) : null}

      {etapa === "enviar" ? (
        <Secao
          titulo="Escolhidos"
          descricao={enviadas ? `${enviadas} já enviados antes` : undefined}
          recolher={false}
          ajuda="Cada mockup vai em alta resolução para Arquivos > Identidade visual e entra na revisão da agência. Marcados com Brandbook entram no manual da marca. Nada vai para o cliente sem a aprovação."
          acao={
            <button type="button" className={botao.primario} disabled={enviando || !escolhidos.some((e) => !e.enviado)} onClick={() => void enviar()}>
              {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-1.5 h-4 w-4" aria-hidden />}
              Enviar para Arquivos e aprovação
            </button>
          }
        >
          {!escolhidos.length ? (
            <EstadoVazio titulo="Nada escolhido ainda" acao={<button className={botao.secundario} onClick={() => setEtapa("aplicar")}>Voltar para Aplicar</button>} />
          ) : (
            <ul className="-mx-2 min-w-0 divide-y divide-border/50">
              {escolhidos.map((e) => (
                <li key={`${e.origem}:${e.id}`} className="flex min-w-0 items-center rounded-lg px-2 py-2.5">
                  <span className="mr-3 inline-block h-12 w-16 shrink-0 overflow-hidden rounded bg-muted">
                    {e.origem === "catalogo" && prontos[e.id] ? <img src={prontos[e.id].url} alt="" className="h-full w-full object-cover" /> : null}
                  </span>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{e.nome}</span>
                  <label className={juntar(texto.auxiliar, "mr-3 inline-flex items-center")}>
                    <input
                      type="checkbox"
                      className="mr-1.5"
                      checked={e.noBrandbook}
                      disabled={e.enviado}
                      onChange={(ev) => setEscolhidos((atual) => atual.map((x) => (x === e ? { ...x, noBrandbook: ev.target.checked } : x)))}
                    />
                    Brandbook
                  </label>
                  {e.enviado ? (
                    <span className={juntar(texto.etiqueta, "text-primary")}>Enviado</span>
                  ) : (
                    <button
                      type="button"
                      className={botao.discreto}
                      onClick={() => {
                        setEscolhidos((atual) => atual.filter((x) => x !== e));
                        if (e.aplicacaoId) arquivarAplicacao(e.aplicacaoId).catch((err) => toast.error(`${e.nome}: ${textoDoErro(err, "a escolha não foi desfeita no banco.")}`));
                      }}
                    >
                      Tirar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Secao>
      ) : null}

      <JanelaDoCelular aberta={!!aberto} larga titulo={aberto ? aberto.nome : ""} onFechar={() => setAberto(null)}
        rodape={aberto ? (
          <span className="inline-flex">
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => aberto && void baixar(aberto)}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden /> PNG em alta
            </button>
            <button type="button" className={botao.primario} onClick={() => { if (aberto) alternarEscolha(aberto); setAberto(null); }}>
              {aberto && escolhidos.some((e) => e.id === aberto.id) ? "Tirar da escolha" : "Escolher"}
            </button>
          </span>
        ) : null}
      >
        {aberto && prontos[aberto.id] ? <img src={prontos[aberto.id].url} alt={aberto.nome} className="block h-auto w-full rounded-md" /> : null}
      </JanelaDoCelular>
    </div>
  );
}

function SeletorDeCor({ rotulo, cores, valor, onEscolher }: { rotulo: string; cores: string[]; valor: number; onEscolher: (i: number) => void }) {
  return (
    <div role="group" aria-label={rotulo} className="grid min-w-0">
      <span className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</span>
      <div className="flex flex-wrap">
        {cores.map((c, i) => (
          <button
            key={`${c}-${i}`}
            type="button"
            aria-pressed={valor % cores.length === i}
            aria-label={`${rotulo}: ${c}`}
            onClick={() => onEscolher(i)}
            className={juntar("toque-compacto mb-1 mr-1.5 h-7 w-7 rounded-full border border-border", valor % cores.length === i && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

function GradeDeMockups({ itens, notas, marcados, onAlternar }: { itens: MockupDoCatalogo[]; notas: Record<string, number>; marcados: string[]; onAlternar: (id: string) => void }) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 desk:grid-cols-6">
      {itens.map((m) => {
        const marcado = marcados.indexOf(m.id) >= 0;
        const nota = notas[m.id];
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={marcado}
            onClick={() => onAlternar(m.id)}
            className={juntar("min-w-0 rounded-md text-left", marcado ? "opacity-100" : "opacity-60 hover:opacity-100")}
          >
            <MiniaturaDoMockup m={m} marcado={marcado} />
            <span className={juntar(texto.auxiliar, "mt-1.5 block truncate")}>{m.nome}</span>
            <span className={juntar(texto.etiqueta, "block text-muted-foreground")}>
              {rotuloDaCategoria(m.categoria)}
              {typeof nota === "number" && nota > 0 ? ` · nota ${(nota + 1).toFixed(1)} de 4` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MiniaturaDoMockup({ m, marcado }: { m: MockupDoCatalogo; marcado: boolean }) {
  const url = useQuery({ queryKey: ["mockups", "thumb", m.caminhos.thumb], staleTime: 45 * 60_000, queryFn: () => urlAssinada(m.caminhos.thumb) });
  return (
    <span className={juntar("relative block w-full overflow-hidden rounded-md bg-muted", marcado && "ring-2 ring-primary")} style={{ paddingBottom: `${(m.altura / m.largura) * 100}%` }}>
      {url.data ? <img src={url.data} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : null}
    </span>
  );
}

export { EstudioDeMockups };
