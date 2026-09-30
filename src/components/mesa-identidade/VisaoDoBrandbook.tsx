import type { CSSProperties, ReactNode } from "react";
import { arquivosEntregues, coresDoBrandbook, estadoDoModelo, SLOTS_DE_LOGO, type DadosDoBrandbook, type LogoDoBrandbook, type ModeloDoBrandbook, type TemaDoBrandbook } from "../../../supabase/functions/mesa-identidade/modulos/brandbook";
import { contraste, luminanciaRelativa, PERFIS, ROTULO_DO_PAPEL_DA_COR, textoCmyk, textoRgb, type FichaDaCor } from "../../../supabase/functions/_shared/cores-da-marca";

/**
 * O brandbook desenhado em HTML (a prévia da etapa Guideline e a página
 * pública por link). É um DOCUMENTO, não interface: os tamanhos e as cores
 * saem da marca (estilo inline), como no PDF. A logo é sempre a imagem real
 * enviada (urlDe resolve o caminho em URL assinada ou data URL).
 */

type UrlDe = (caminho: string | null | undefined) => string | null;

const PADRAO_ESCURO = "#151B17";
const PADRAO_CLARO = "#F4F6F4";

/**
 * As cores do documento pelo tema visual (IDV2): clássico (capa escura,
 * páginas claras), editorial (acento escuro e títulos leves), escuro (tudo
 * em fundo escuro), minimal (preto e branco; a cor fica nas amostras) e
 * vibrante (capa e faixas na primária).
 */
function temaDa(cores: FichaDaCor[], tema: TemaDoBrandbook = "classico") {
  const ordenadas = cores.slice().sort((a, b) => luminanciaRelativa(a.hex) - luminanciaRelativa(b.hex));
  const escura = ordenadas[0] && luminanciaRelativa(ordenadas[0].hex) < 0.06 ? ordenadas[0].hex : PADRAO_ESCURO;
  const clara = ordenadas.length && luminanciaRelativa(ordenadas[ordenadas.length - 1].hex) > 0.8 ? ordenadas[ordenadas.length - 1].hex : PADRAO_CLARO;
  const acento = (fundo: string) => {
    const boas = cores.filter((c) => contraste(c.hex, fundo) >= 2.2);
    const prim = boas.filter((c) => c.papel === "primaria")[0] || boas.filter((c) => c.papel === "destaque")[0] || boas[0];
    return prim ? prim.hex : luminanciaRelativa(fundo) < 0.2 ? "#FFFFFF" : "#157330";
  };
  const primaria = (cores.filter((c) => c.papel === "primaria")[0] || cores[0] || { hex: escura }).hex;
  const base = { escura, clara, acentoClaro: acento("#FFFFFF"), acentoEscuro: acento(escura), pagina: "#FFFFFF", tinta: "#151B17", cinza: "#626D66", linha: "#DFE5DF", capa: escura, pesoDoTitulo: 800, faixa: 4 };
  if (tema === "editorial") return { ...base, acentoClaro: escura, acentoEscuro: "#FFFFFF", pesoDoTitulo: 500, capa: clara === PADRAO_CLARO ? "#F7F5F0" : clara };
  if (tema === "escuro") return { ...base, acentoClaro: acento(escura), pagina: escura, tinta: "#FFFFFF", cinza: "#B8C0B9", linha: "#3A4148" };
  if (tema === "minimal") return { ...base, acentoClaro: "#151B17", acentoEscuro: "#FFFFFF", capa: "#FFFFFF", pesoDoTitulo: 600 };
  if (tema === "vibrante") return { ...base, capa: contraste(primaria, "#FFFFFF") >= 3 ? primaria : escura, faixa: 12 };
  return base;
}

function Logo({ logo, urlDe, fundo, altura, rotulo }: { logo: LogoDoBrandbook | null; urlDe: UrlDe; fundo: string; altura: number; rotulo: string }) {
  const url = logo ? urlDe(logo.previa_png || logo.caminho) : null;
  const escuro = luminanciaRelativa(fundo) < 0.2;
  return (
    <div style={{ background: fundo, height: altura, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", padding: 14, overflow: "hidden" }}>
      {url ? <img src={url} alt={rotulo} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 12, color: escuro ? "#FFFFFF99" : "#626D66" }}>{logo ? "Logo em arquivo" : "Falta a logo"}</span>}
    </div>
  );
}

function Amostra({ c, alta }: { c: FichaDaCor; alta: boolean }) {
  return (
    <div style={{ background: c.hex, color: c.texto, borderRadius: 10, padding: 14, minHeight: alta ? 220 : 104, display: "flex", flexDirection: "column", justifyContent: "space-between", border: luminanciaRelativa(c.hex) > 0.9 ? "1px solid #DFE5DF" : undefined }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.15 }}>{c.nome.toUpperCase()}</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>{ROTULO_DO_PAPEL_DA_COR[c.papel]}</div>
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.6, fontVariantNumeric: "tabular-nums" }}>
        <div>CMYK {textoCmyk(c.cmyk).replace(/C |M |Y |K /g, "")}</div>
        <div>{textoRgb(c.rgb)}</div>
        <div>HEX {c.hex}</div>
      </div>
    </div>
  );
}

const grade = (colunas: string, espaco = 12): CSSProperties => ({ display: "grid", gridTemplateColumns: colunas, gridGap: espaco });

/** A prancha-resumo vertical (a estrutura do modelo recebido). */
function Prancha({ dados, urlDe }: { dados: DadosDoBrandbook; urlDe: UrlDe }) {
  const cores = coresDoBrandbook(dados);
  const t = temaDa(cores, dados.tema);
  const titulo = dados.tipografia.filter((x) => x.uso === "titulo")[0] || dados.tipografia[0];
  const familia = titulo ? `"${titulo.familia}", Helvetica, Arial, sans-serif` : "Helvetica, Arial, sans-serif";
  const cartao: CSSProperties = { border: "1px solid #3A4148", borderRadius: 12, padding: 16, minWidth: 0 };
  const rotulo = (s: string): ReactNode => <div style={{ color: t.acentoEscuro, fontWeight: 700, fontSize: 13, textAlign: "center", marginBottom: 12 }}>{s.toUpperCase()}</div>;
  const cartoes: Array<{ titulo: string; logo: LogoDoBrandbook | null; uso: string }> = [
    { titulo: SLOTS_DE_LOGO[0].rotulo, logo: dados.logos.principal, uso: SLOTS_DE_LOGO[0].uso },
    { titulo: SLOTS_DE_LOGO[1].rotulo, logo: dados.logos.secundario || dados.logos.principal, uso: SLOTS_DE_LOGO[1].uso },
    { titulo: SLOTS_DE_LOGO[2].rotulo, logo: dados.logos.alternativas[0] || null, uso: SLOTS_DE_LOGO[2].uso },
    { titulo: SLOTS_DE_LOGO[3].rotulo, logo: dados.logos.icone[0] || null, uso: SLOTS_DE_LOGO[3].uso },
  ];
  return (
    <div style={{ background: dados.tema === "vibrante" || dados.tema === "editorial" || dados.tema === "minimal" ? t.capa : t.escura, color: luminanciaRelativa(dados.tema === "vibrante" || dados.tema === "editorial" || dados.tema === "minimal" ? t.capa : t.escura) > 0.5 ? "#151B17" : "#FFFFFF", padding: "40px 28px", borderRadius: 12, fontFamily: familia }} data-prancha="" data-tema={dados.tema}>
      <div style={{ textAlign: "center", color: t.acentoEscuro, fontWeight: 800, fontSize: 40, letterSpacing: -0.5 }}>MANUAL DA MARCA</div>
      {dados.marca.nome && <div style={{ textAlign: "center", fontSize: 14, opacity: 0.8, marginTop: 4 }}>{dados.marca.nome}</div>}
      <div style={{ ...grade("repeat(auto-fit, minmax(180px, 1fr))"), marginTop: 28 }}>
        {cartoes.map((c) => (
          <div key={c.titulo} style={cartao}>
            {rotulo(c.titulo)}
            <Logo logo={c.logo} urlDe={urlDe} fundo={t.escura} altura={90} rotulo={c.titulo} />
            <div style={{ height: 8 }} />
            <Logo logo={c.logo} urlDe={urlDe} fundo={t.clara} altura={90} rotulo={c.titulo} />
            <div style={{ fontSize: 11, lineHeight: 1.5, opacity: 0.85, marginTop: 10 }}>{c.uso}</div>
          </div>
        ))}
      </div>
      <div style={{ ...cartao, marginTop: 16 }}>
        <div style={{ color: t.acentoEscuro, fontWeight: 700, fontSize: 18, marginBottom: 12 }}>PALETA DE CORES</div>
        <div style={grade("repeat(auto-fit, minmax(130px, 1fr))")}>
          {cores.slice(0, 6).map((c, i) => (
            <Amostra key={c.hex} c={c} alta={i < 2} />
          ))}
        </div>
      </div>
      <div style={{ ...cartao, marginTop: 16 }}>
        <div style={{ color: t.acentoEscuro, fontWeight: 700, fontSize: 18, marginBottom: 12 }}>ATIVOS DA MARCA</div>
        <div style={grade("repeat(auto-fit, minmax(160px, 1fr))")}>
          {(dados.grafismos.length ? dados.grafismos : [{ tipo: "outro", descricao: "Ativo da marca", imagem: null }]).slice(0, 4).map((g, i) => {
            const url = urlDe(g.imagem);
            return (
              <div key={i} style={{ background: "#2A3036", borderRadius: 10, height: 150, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {url ? <img src={url} alt={g.descricao || "Ativo"} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 12, opacity: 0.7 }}>{g.descricao || "Ativo"}</span>}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ ...cartao, marginTop: 16 }}>
        <div style={{ color: t.acentoEscuro, fontWeight: 700, fontSize: 18, marginBottom: 12 }}>TIPOGRAFIA</div>
        <div style={grade("repeat(auto-fit, minmax(240px, 1fr))")}>
          <div style={{ background: "#2A3036", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 11, opacity: 0.8 }}>FAMÍLIA TIPOGRÁFICA</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{titulo ? titulo.familia : "A definir"}</div>
            <div style={{ fontSize: 64, fontWeight: 600, lineHeight: 1 }}>Aa</div>
            <div style={{ fontSize: 12, letterSpacing: 2, marginTop: 8, wordBreak: "break-all" }}>ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</div>
          </div>
          <div style={{ background: "#2A3036", borderRadius: 10, padding: 16 }}>
            {[
              ["Um exemplo de título", 26, 700],
              ["Um exemplo de título 2", 20, 700],
              ["Um exemplo de subtítulo", 16, 500],
              ["Um exemplo de texto", 13, 400],
              ["Um exemplo de texto complementar", 11, 400],
            ].map(([s, tam, peso]) => (
              <div key={String(s)} style={{ fontSize: Number(tam), fontWeight: Number(peso), marginBottom: 8 }}>
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ ...grade("1fr 1fr", 0), marginTop: 16, borderRadius: 12, overflow: "hidden" }}>
        {[0, 1, 2].map((i) => {
          const m = dados.mockups[i];
          const url = m ? urlDe(m.imagem) : null;
          return (
            <div key={i} style={{ gridColumn: i === 2 ? "1 / span 2" : undefined, height: i === 2 ? 320 : 220, background: i === 1 ? "#2A3036" : "#20262B", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {url ? <img src={url} alt={m!.titulo || "Mockup"} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 14, fontWeight: 700, color: "#5B646C" }}>MOCKUP</span>}
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: "right", fontSize: 12, opacity: 0.8, marginTop: 14 }}>feito pela Aceleriq</div>
    </div>
  );
}

/** Uma página do brandbook de 24 (proporção A4 deitado, sem aspect-ratio: Safari 11). */
type TemaDaVisao = ReturnType<typeof temaDa>;

function Pagina({ n, titulo, marca, acento, pronta, tema, children }: { n: number; titulo: string; marca: string; acento: string; pronta: boolean; tema: TemaDaVisao; children: ReactNode }) {
  return (
    <div style={{ position: "relative", width: "100%", paddingTop: "70.7%", background: tema.pagina, borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} data-pagina-do-brandbook={n}>
      <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, padding: "4.5% 5.5%", color: tema.tinta, display: "flex", flexDirection: "column" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: tema.faixa, background: acento }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, borderBottom: `1px solid ${tema.linha}`, paddingBottom: 6 }}>
          <span>
            <span style={{ color: acento }}>{n < 10 ? `0${n}` : n}</span> {titulo.toUpperCase()}
          </span>
          <span style={{ color: tema.cinza, fontWeight: 400 }}>{marca.toUpperCase()}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", paddingTop: 12 }}>{children}</div>
        {!pronta && <div style={{ position: "absolute", right: 10, bottom: 8, fontSize: 10, background: "#FFF4D6", color: "#8A5A00", padding: "2px 6px", borderRadius: 6 }}>falta preencher</div>}
      </div>
    </div>
  );
}

function Paginado({ dados, urlDe }: { dados: DadosDoBrandbook; urlDe: UrlDe }) {
  const cores = coresDoBrandbook(dados);
  const t = temaDa(cores, dados.tema);
  const marca = dados.marca.nome || "Marca";
  const estado = estadoDoModelo("paginado", dados);
  const txt = (s: string, falta = "A preencher.") => <div style={{ fontSize: 12, lineHeight: 1.5, color: s ? t.tinta : t.cinza }}>{s || falta}</div>;
  const rot = (s: string) => <div style={{ fontSize: 10, fontWeight: 700, color: t.acentoClaro, marginBottom: 4 }}>{s.toUpperCase()}</div>;
  const itens = (l: string[]) => (l.length ? <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.5 }}>{l.map((x) => <li key={x}>{x}</li>)}</ul> : txt(""));
  const conteudo = (id: string): ReactNode => {
    switch (id) {
      case "capa":
        return (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: t.capa, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: luminanciaRelativa(t.capa) > 0.5 ? "#151B17" : "#FFFFFF" }}>
            <div style={{ width: "45%" }}>
              <Logo logo={dados.logos.principal} urlDe={urlDe} fundo={t.capa} altura={120} rotulo="Logo" />
            </div>
            <div style={{ fontSize: 26, fontWeight: t.pesoDoTitulo, marginTop: 12 }}>MANUAL DA MARCA</div>
            {dados.marca.slogan && <div style={{ fontSize: 13, opacity: 0.85 }}>{dados.marca.slogan}</div>}
          </div>
        );
      case "sumario":
        return <div style={{ columns: 2, fontSize: 11, lineHeight: 1.7 }}>{estado.map((p) => <div key={p.id}>{p.n < 10 ? `0${p.n}` : p.n} {p.titulo}</div>)}</div>;
      case "apresentacao":
        return <div style={grade("1fr 1fr", 16)}><div>{rot("Propósito")}{txt(dados.plataforma.proposito)}{rot("Para quem")}{txt(dados.plataforma.publico)}</div><div>{rot("A ideia da marca")}{txt(dados.conceito.resumo)}{dados.plataforma.promessa ? <>{rot("Promessa")}{txt(dados.plataforma.promessa)}</> : null}</div></div>;
      case "plataforma":
        return (
          <div>
            <div style={grade("1fr 1fr 1fr", 16)}>
              <div>{rot("Missão")}{txt(dados.plataforma.missao)}</div>
              <div>{rot("Visão")}{txt(dados.plataforma.visao)}</div>
              <div>{rot("Valores")}{itens(dados.plataforma.valores)}{rot("Personalidade")}{itens(dados.plataforma.personalidade)}</div>
            </div>
            {(dados.plataforma.posicionamento || dados.plataforma.arquetipo) && (
              <div style={{ ...grade("1fr 1fr", 16), marginTop: 10 }}>
                <div>{rot("Posicionamento")}{txt(dados.plataforma.posicionamento)}</div>
                <div>{rot("Arquétipo")}{txt([dados.plataforma.arquetipo, dados.plataforma.arquetipo_justificativa].filter(Boolean).join(". "))}</div>
              </div>
            )}
          </div>
        );
      case "tom":
        return (
          <div>
            <div style={grade("1fr 1fr", 16)}><div>{rot("Como fala")}{itens(dados.tom.como_fala)}</div><div>{rot("Como não fala")}{itens(dados.tom.como_nao_fala)}</div></div>
            {dados.tom.exemplos.length > 0 && <div style={{ marginTop: 10 }}>{rot("Exemplos")}{dados.tom.exemplos.slice(0, 3).map((x, i) => <div key={i} style={{ fontSize: 11, lineHeight: 1.5 }}><span style={{ color: t.acentoClaro }}>Assim:</span> {x.certo} <span style={{ color: t.cinza }}>/ não: {x.errado}</span></div>)}</div>}
          </div>
        );
      case "conceito":
        return <div style={grade("1fr 1fr", 16)}><div>{rot("Significado")}{txt(dados.conceito.significado_do_logo)}</div><Logo logo={dados.logos.principal} urlDe={urlDe} fundo={PADRAO_CLARO} altura={150} rotulo="Logo" /></div>;
      case "logo_principal":
      case "grid":
      case "protecao":
      case "incorretos":
        return (
          <div style={grade("1fr 1fr", 12)}>
            <Logo logo={dados.logos.principal} urlDe={urlDe} fundo={PADRAO_CLARO} altura={150} rotulo="Logo sobre claro" />
            {id === "logo_principal" ? <Logo logo={dados.logos.principal} urlDe={urlDe} fundo={t.escura} altura={150} rotulo="Logo sobre escuro" /> : id === "protecao" ? txt(`Área de proteção: ${Math.round(dados.regras.protecao_fator * 100)}% da altura da logo em volta. Redução mínima: ${dados.regras.reducao_minima_px} px no digital e ${dados.regras.reducao_minima_mm} mm no impresso.`) : id === "incorretos" ? itens(dados.regras.usos_incorretos) : txt("A malha divide a caixa da logo em módulos iguais para alinhar a logo a textos e imagens.")}
          </div>
        );
      case "versoes":
        return <div style={grade("repeat(auto-fit, minmax(120px, 1fr))", 10)}>{[dados.logos.secundario].concat(dados.logos.alternativas).filter(Boolean).slice(0, 4).map((l, i) => <Logo key={i} logo={l} urlDe={urlDe} fundo={PADRAO_CLARO} altura={120} rotulo="Versão" />)}</div>;
      case "cromaticas":
        return <div style={grade("1fr 1fr 1fr", 8)}>{["#FFFFFF", t.escura].concat(cores.slice(0, 4).map((c) => c.hex)).slice(0, 6).map((f) => <Logo key={f} logo={dados.logos.principal} urlDe={urlDe} fundo={f} altura={70} rotulo="Logo sobre cor" />)}</div>;
      case "icone":
        return <div style={grade("140px 1fr", 16)}><Logo logo={dados.logos.icone[0] || dados.logos.principal} urlDe={urlDe} fundo={t.acentoClaro} altura={140} rotulo="Ícone" />{txt(SLOTS_DE_LOGO[3].uso)}</div>;
      case "cores":
      case "proporcao":
        return (
          <div>
            <div style={grade("repeat(auto-fit, minmax(90px, 1fr))", 8)}>{cores.slice(0, 6).map((c, i) => <Amostra key={c.hex} c={c} alta={i < 2 && id === "cores"} />)}</div>
            <div style={{ fontSize: 10, color: "#626D66", marginTop: 8 }}>CMYK por código: {PERFIS[dados.perfil_cmyk].nome}. Confirme a prova com a gráfica.</div>
          </div>
        );
      case "tipografia":
        return <div>{dados.tipografia.length ? dados.tipografia.map((f) => <div key={f.familia} style={{ fontFamily: `"${f.familia}", Helvetica, Arial, sans-serif`, marginBottom: 10 }}><div style={{ fontSize: 22, fontWeight: 700 }}>{f.familia}</div><div style={{ fontSize: 11, color: "#626D66" }}>{f.uso} · {f.pesos.join(", ") || "pesos a definir"} · {f.licenca || "licença a confirmar"}</div></div>) : txt("")}</div>;
      case "grafismos":
      case "ilustracao":
      case "mockups":
      case "redes":
      case "papelaria": {
        const lista = id === "mockups" ? dados.mockups.map((m) => ({ imagem: m.imagem, titulo: m.titulo })) : id === "grafismos" || id === "ilustracao" ? dados.grafismos.map((g) => ({ imagem: g.imagem, titulo: g.descricao })) : dados.aplicacoes.map((a) => ({ imagem: a.imagem, titulo: a.tipo }));
        if (!lista.length) return txt("", "Nada nesta versão.");
        return <div style={grade("repeat(auto-fit, minmax(120px, 1fr))", 8)}>{lista.slice(0, 3).map((x, i) => { const url = urlDe(x.imagem); return <div key={i} style={{ height: 140, background: PADRAO_CLARO, borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>{url ? <img src={url} alt={x.titulo} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "#626D66" }}>{x.titulo}</span>}</div>; })}</div>;
      }
      case "fotografia":
        return <div style={grade("1fr 1fr", 16)}><div>{rot("Coloração")}{txt(dados.fotografia.coloracao)}{rot("Composição")}{txt(dados.fotografia.composicao)}</div><div>{rot("Evitar")}{txt(dados.fotografia.evitar)}{rot("Imagem de IA")}{txt(dados.fotografia.ia)}</div></div>;
      case "arquivos":
        return <div style={{ fontSize: 11, lineHeight: 1.6 }}>{arquivosEntregues(dados).slice(0, 10).map((a) => <div key={a.nome} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #DFE5DF" }}><span>{a.nome}</span><span style={{ color: "#626D66" }}>{a.formato}</span></div>)}</div>;
      case "creditos":
        return <div style={{ textAlign: "center", paddingTop: "8%" }}><div style={{ fontSize: 24, fontWeight: 700 }}>Obrigado.</div><div style={{ fontSize: 12, color: "#626D66" }}>feito pela Aceleriq</div></div>;
    }
    return null;
  };
  return (
    <div style={grade("repeat(auto-fill, minmax(260px, 1fr))", 14)} data-paginado="">
      {estado.map((p) => (
        <Pagina key={p.id} n={p.n} titulo={p.titulo} marca={marca} acento={t.acentoClaro} pronta={p.pronta} tema={t}>
          {conteudo(p.id)}
        </Pagina>
      ))}
    </div>
  );
}

export default function VisaoDoBrandbook({ dados, modelo, urlDe }: { dados: DadosDoBrandbook; modelo: ModeloDoBrandbook; urlDe: UrlDe }) {
  return modelo === "prancha" ? <Prancha dados={dados} urlDe={urlDe} /> : <Paginado dados={dados} urlDe={urlDe} />;
}
