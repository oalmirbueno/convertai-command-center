import { useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, Save } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { useFontesGoogle } from "@/lib/identidade/fontesGoogle";
import { normalizarHex } from "../../../supabase/functions/_shared/cores-da-marca";
import { normalizarEstrategia } from "../../../supabase/functions/_shared/estrategia-de-marca";
import { estilosDaPersonalidade, fonteDoCatalogo, hierarquiaDoPar, linkDaFamilia, paresParaEstilos, pilhaDaFonte } from "../../../supabase/functions/_shared/tipografia-da-marca";
import { dataUrlDoSvg, descricaoDoPadrao, svgDoPadrao, TIPOS_DE_PADRAO, type TipoDePadrao } from "../../../supabase/functions/mesa-identidade/modulos/grafismos-da-marca";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha, partesDoCusto, SeletorDoModelo, useModeloDaAcao, useProjetoDaMesa } from "./Comuns";
import { enviarFeitoNaTela, pngDoSvg } from "./arquivosDaMarca";

export type TipoDoSistema = { familia: string; uso: "titulo" | "texto" | "apoio"; pesos: string; licenca: string; alternativa: string };

const POR_PAGINA = 6;

/** Um par com a prévia real (a fonte só baixa quando o par aparece na tela). */
export function PrevisaoDoPar({ titulo, texto: familiaTexto, pesoTitulo = 700, nome, marca, ativo }: { titulo: string; texto: string; pesoTitulo?: number; nome: string; marca: string; ativo: boolean }) {
  const pronto = useFontesGoogle([{ familia: titulo, pesos: [pesoTitulo] }, { familia: familiaTexto, pesos: [400, 600] }], ativo);
  return (
    <span className="block min-w-0" data-par-carregado={pronto ? "sim" : "nao"}>
      <span className="block truncate text-[24px] leading-8" style={{ fontFamily: pilhaDaFonte(titulo), fontWeight: pesoTitulo }}>
        {marca || nome}
      </span>
      <span className="block text-[14px] leading-5 text-muted-foreground" style={{ fontFamily: pilhaDaFonte(familiaTexto) }}>
        O texto corrido precisa ser fácil de ler em qualquer tela, do celular ao cartaz.
      </span>
    </span>
  );
}

/**
 * Tipografia (IDV2): combinações do Google Fonts escolhidas pela
 * personalidade da estratégia (regra fixa, sem custo), com a prévia real
 * carregada sob demanda, e os pares sugeridos pelo diretor (IA, custo antes).
 * "Usar" troca as famílias do sistema.
 */
export function TipografiaDaMarca({ tipos, onUsar }: { tipos: TipoDoSistema[]; onUsar: (novos: TipoDoSistema[], origem: string) => void }) {
  const mesa = useMesa();
  const { projeto, guardar } = useProjetoDaMesa();
  const [modeloId, setModeloId] = useModeloDaAcao("identidade");
  const [pagina, setPagina] = useState(1);
  const est = normalizarEstrategia(projeto.dados.estrategia);
  const estilos = useMemo(() => estilosDaPersonalidade({ arquetipo: est.arquetipo.principal, eixos: est.personalidade.eixos }), [JSON.stringify(est.arquetipo), JSON.stringify(est.personalidade.eixos)]);
  const pares = useMemo(() => paresParaEstilos(estilos), [estilos.join(",")]);
  const marca = (projeto.dados.naming && projeto.dados.naming.nome) || "";
  const propostas = (((projeto.dados.sistema || {}) as Record<string, any>).propostas_de_fonte || []) as Array<{ titulo: string; texto: string; porque: string; conferida: boolean }>;
  const titulo = tipos.filter((t) => t.uso === "titulo")[0] || tipos[0];
  const corpo = tipos.filter((t) => t.uso === "texto")[0] || titulo;
  const hierarquia = titulo ? hierarquiaDoPar({ titulo: titulo.familia, texto: corpo ? corpo.familia : titulo.familia, pesoTitulo: 700 }) : [];
  const prontas = useFontesGoogle(titulo ? [{ familia: titulo.familia, pesos: [700] }, { familia: corpo ? corpo.familia : titulo.familia, pesos: [400, 600] }] : [], !!titulo);
  const usar = (t: string, x: string, origem: string) => {
    const lic = (f: string) => (fonteDoCatalogo(f) ? "Google Fonts (OFL)" : "Confirmar a licença");
    const novos: TipoDoSistema[] = [{ familia: t, uso: "titulo", pesos: "", licenca: lic(t), alternativa: "" }];
    if (x && x !== t) novos.push({ familia: x, uso: "texto", pesos: "", licenca: lic(x), alternativa: "" });
    onUsar(novos.concat(tipos.filter((y) => y.uso === "apoio")), origem);
  };
  return (
    <div className="mt-6 min-w-0 border-t border-border pt-5" data-tipografia-da-marca="">
      {titulo && (
        <div className="mb-6 min-w-0" data-hierarquia={prontas ? "carregada" : "reserva"}>
          <p className={juntar(texto.rotulo, "mb-2")}>Hierarquia com as famílias do sistema</p>
          {hierarquia.map((h) => (
            <div key={h.nivel} className="flex min-w-0 items-baseline border-b border-border/50 py-1.5">
              <span className={juntar(texto.etiqueta, "w-24 shrink-0 text-muted-foreground")}>{h.nivel}</span>
              <span className="min-w-0 truncate" style={{ fontFamily: pilhaDaFonte(h.familia), fontSize: Math.min(h.tamanho, 32), fontWeight: h.peso, lineHeight: 1.25 }}>
                {h.exemplo}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mb-2 flex min-w-0 flex-wrap items-center">
        <span className={juntar(texto.rotulo, "m-1 min-w-0 flex-1")}>Combinações para esta personalidade{estilos.length ? `: ${estilos.slice(0, 4).join(", ")}` : ""}</span>
        <SeletorDoModelo papel="identidade" valor={modeloId} onEscolher={setModeloId} />
        <BotaoComCusto
          rotulo="Sugerir pares com IA"
          titulo="Pares de fonte"
          partes={() => partesDoCusto(mesa.catalogo, "fontes", modeloId)}
          executar={() => chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("fontes_propor", { projeto_id: projeto.id, modelo_id: modeloId || undefined })}
          aoConcluir={(d) => guardar(d && d.projeto)}
          variant="outline"
          className="m-1 h-8"
        />
      </div>
      {propostas.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria, "mb-4")} aria-label="Pares sugeridos pelo diretor">
          {propostas.map((p) => (
            <li key={`${p.titulo}-${p.texto}`} className={juntar(lista.linha, "items-start")}>
              <span className="min-w-0 flex-1">
                <PrevisaoDoPar titulo={p.titulo} texto={p.texto} nome={`${p.titulo} + ${p.texto}`} marca={marca} ativo />
                <span className={juntar(texto.auxiliar, "mt-1 block")}>
                  {p.titulo} + {p.texto}. {p.porque}
                </span>
                {!p.conferida && <Pastilha tom="alerta">fora do catálogo: confira no Google Fonts</Pastilha>}
              </span>
              <button type="button" className={juntar(botao.discreto, "ml-2 h-8 shrink-0")} onClick={() => usar(p.titulo, p.texto, "sugestão do diretor")}>
                <Check className="mr-1.5 h-3.5 w-3.5" /> Usar
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Combinações do Google Fonts">
        {pares.slice(0, pagina * POR_PAGINA).map((p) => (
          <li key={p.id} className={juntar(lista.linha, "items-start")} data-par={p.id}>
            <span className="min-w-0 flex-1">
              <PrevisaoDoPar titulo={p.titulo} texto={p.texto} pesoTitulo={p.pesoTitulo} nome={p.nome} marca={marca} ativo />
              <span className="mt-1 flex min-w-0 flex-wrap items-center">
                <span className={juntar(texto.auxiliar, "mr-2")}>
                  {p.nome}: {p.titulo} + {p.texto}
                </span>
                {p.encaixe > 0 && <Pastilha tom="bom">combina</Pastilha>}
                <a className={juntar(texto.etiqueta, "ml-2 inline-flex items-center text-muted-foreground hover:text-foreground")} href={linkDaFamilia(p.titulo)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-0.5 h-3 w-3" /> Google Fonts
                </a>
              </span>
            </span>
            <button type="button" className={juntar(botao.discreto, "ml-2 h-8 shrink-0")} onClick={() => usar(p.titulo, p.texto, p.nome)} title={p.porque}>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Usar
            </button>
          </li>
        ))}
      </ul>
      {pagina * POR_PAGINA < pares.length && (
        <button type="button" className={juntar(botao.discreto, "mt-2")} onClick={() => setPagina(pagina + 1)}>
          Mais combinações
        </button>
      )}
    </div>
  );
}

/**
 * Padrões gerados por código (IDV2): SVG com as cores da marca, sem gerador
 * de imagem. "Guardar" envia o SVG (vetor, para o pacote) e um PNG (para o
 * PDF e a página) e põe o padrão nos ativos do sistema.
 */
export function GrafismosGerados({ cores, familia, nome, onGuardar }: { cores: string[]; familia: string; nome: string; onGuardar: (g: { tipo: "pattern"; descricao: string; imagem: string; svg: string | null }) => Promise<void> }) {
  const { clientId } = useMesa();
  const { projeto } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const validas = cores.map((c) => normalizarHex(c)).filter((c): c is string => !!c);
  const lista3 = validas.length ? validas : ["#F4F6F4", "#151B17", "#157330"];
  const [tipo, setTipo] = useState<TipoDePadrao>("pontos");
  const [fundo, setFundo] = useState(0);
  const [forma, setForma] = useState(Math.min(1, lista3.length - 1));
  const [apoio, setApoio] = useState(Math.min(2, lista3.length - 1));
  const [escala, setEscala] = useState(48);
  const [peso, setPeso] = useState(0.4);
  const [giro, setGiro] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const opcoes = { tipo, fundo: lista3[fundo % lista3.length], forma: lista3[forma % lista3.length], apoio: lista3[apoio % lista3.length], escala, peso, giro, letra: (nome || "A").charAt(0).toUpperCase(), familia };
  const previa = useMemo(() => dataUrlDoSvg(svgDoPadrao({ ...opcoes, largura: 640, altura: 360, escala: Math.round(escala * 0.6) })), [JSON.stringify(opcoes)]);
  const guardar = async () => {
    setGuardando(true);
    try {
      const svg = svgDoPadrao({ ...opcoes, largura: 1600, altura: 1200 });
      const png = await pngDoSvg(svg, 1600, 1200);
      const r = await enviarFeitoNaTela(clientId, projeto.id, "grafismos", `padrao-${tipo}`, png, svg);
      await onGuardar({ tipo: "pattern", descricao: descricaoDoPadrao(opcoes), imagem: r.png, svg: r.svg });
    } catch (e) {
      avisarErro(e, "O padrão não foi guardado");
    } finally {
      setGuardando(false);
    }
  };
  const seletorDeCor = (rotulo: string, valor: number, mudar: (i: number) => void) => (
    <div role="group" aria-label={rotulo} className="m-1 grid min-w-0">
      <span className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</span>
      <span className="flex flex-wrap">
        {lista3.map((c, i) => (
          <button key={`${c}-${i}`} type="button" aria-pressed={valor === i} aria-label={`${rotulo}: ${c}`} onClick={() => mudar(i)} className={juntar("toque-compacto mb-1 mr-1.5 h-7 w-7 rounded-full border border-border", valor === i && "ring-2 ring-primary ring-offset-2 ring-offset-background")} style={{ backgroundColor: c }} />
        ))}
      </span>
    </div>
  );
  return (
    <div className="mt-6 min-w-0 border-t border-border pt-5" data-grafismos-gerados="">
      <p className={juntar(texto.rotulo, "mb-2")}>Gerar padrão com as cores da marca</p>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="-m-1 flex min-w-0 flex-wrap content-start items-end">
          <label className="m-1 grid min-w-0">
            <span className={juntar(texto.rotulo, "mb-1.5")}>Padrão</span>
            <select className={juntar(campo, "w-44")} value={tipo} onChange={(e) => setTipo(e.target.value as TipoDePadrao)}>
              {TIPOS_DE_PADRAO.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </label>
          {seletorDeCor("Fundo", fundo, setFundo)}
          {seletorDeCor("Forma", forma, setForma)}
          {seletorDeCor("Apoio", apoio, setApoio)}
          <label className="m-1 grid w-40 min-w-0">
            <span className={juntar(texto.rotulo, "mb-1.5")}>Tamanho</span>
            <input type="range" min={16} max={140} step={4} value={escala} onChange={(e) => setEscala(Number(e.target.value))} />
          </label>
          <label className="m-1 grid w-40 min-w-0">
            <span className={juntar(texto.rotulo, "mb-1.5")}>Peso</span>
            <input type="range" min={0.1} max={0.9} step={0.05} value={peso} onChange={(e) => setPeso(Number(e.target.value))} />
          </label>
          <label className="m-1 grid w-40 min-w-0">
            <span className={juntar(texto.rotulo, "mb-1.5")}>Giro</span>
            <input type="range" min={0} max={180} step={15} value={giro} onChange={(e) => setGiro(Number(e.target.value))} />
          </label>
          <button type="button" className={juntar(botao.secundario, "m-1")} disabled={guardando} onClick={() => void guardar()}>
            {guardando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Guardar nos ativos
          </button>
        </div>
        <span className="relative block w-full overflow-hidden rounded-md border border-border" style={{ paddingBottom: "56.25%" }}>
          <img src={previa} alt={`Prévia do padrão ${tipo}`} className="absolute inset-0 h-full w-full object-cover" />
        </span>
      </div>
    </div>
  );
}
