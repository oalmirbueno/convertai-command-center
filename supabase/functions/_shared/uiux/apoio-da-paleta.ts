/**
 * Apoio da paleta (frente UXM, 30/09/2026): a marca manda, a base apoia.
 *
 * 1. Entra a paleta da marca (kit ou dados.sistema.cores) e, se houver, a
 *    paleta de referência do setor (colors.csv, 16 papéis).
 * 2. Primária, secundária e destaque da MARCA ficam como estão. Nunca trocam.
 * 3. Da base só entram os papéis que a marca não define: fundo, texto,
 *    cartão, texto do cartão, suave, texto suave, borda, erro, texto sobre o
 *    erro e anel de foco. Os neutros são retingidos no matiz da marca (como as
 *    neutras da casa em neutrasDaMarca).
 * 4. Conferência por código (contraste e nivelDoContraste da Identidade):
 *    texto sobre fundo AA; texto sobre o destaque AA ou vira textoSobre; se o
 *    destaque falha como texto pequeno no fundo, nasce `destaque_texto` com o
 *    passo da escalaDaCor mais perto que passa AA (só para link e texto
 *    pequeno: botão e bloco continuam com o destaque real).
 * 5. Papel que não passa sai com aviso ("a borda da base some no fundo").
 *
 * Sem IA, sem Deno, sem banco. O worker (cssDaMarca), a função e a tela usam o
 * mesmo arquivo. Sem travessão.
 */

import { contraste, luminanciaRelativa, nivelDoContraste, normalizarHex, textoSobre } from "../cores-da-marca.ts";
import { escalaDaCor, hexParaHsl, hslParaHex } from "../escala-da-cor.ts";

export type PapelDoApoio =
  | "primaria"
  | "secundaria"
  | "destaque"
  | "sobre_destaque"
  | "destaque_texto"
  | "fundo"
  | "texto"
  | "cartao"
  | "texto_do_cartao"
  | "suave"
  | "texto_suave"
  | "borda"
  | "erro"
  | "sobre_erro"
  | "anel";

export const ROTULO_DO_PAPEL_DO_APOIO: Record<PapelDoApoio, string> = {
  primaria: "Primária",
  secundaria: "Secundária",
  destaque: "Destaque",
  sobre_destaque: "Texto sobre o destaque",
  destaque_texto: "Destaque para texto e link",
  fundo: "Fundo",
  texto: "Texto",
  cartao: "Cartão",
  texto_do_cartao: "Texto do cartão",
  suave: "Suave",
  texto_suave: "Texto suave",
  borda: "Borda",
  erro: "Erro",
  sobre_erro: "Texto sobre o erro",
  anel: "Anel de foco",
};

export type CorDoApoio = { papel: PapelDoApoio; hex: string; origem: string };
/**
 * `destaque` é a cor sobre a qual sobre_destaque, destaque_texto e anel foram
 * calculados: no site, a MESMA do --cor-destaque (coresDoSite); na Identidade,
 * o destaque da marca (ou a primária).
 */
export type ApoioDaPaleta = { papeis: CorDoApoio[]; avisos: string[]; citacao: string | null; destaque?: string | null };

/** Paleta do setor (colors.csv) com os nomes das colunas geradas. */
export type PaletaDoSetorParaApoio = {
  no: string;
  fundo: string;
  texto: string;
  cartao: string;
  textoDoCartao: string;
  suave: string;
  textoSuave: string;
  borda: string;
  erro: string;
  sobreErro: string;
  anel: string;
};

export type CorDaMarcaParaApoio = { hex?: string | null; papel?: string | null; nome?: string | null };

/** Contraste mínimo de cada conferência (WCAG): texto 4,5; foco e erro como peça de interface 3; borda visível 1,15. */
export const MINIMO = { texto: 4.5, interface: 3, borda: 1.15 } as const;

const papelDe = (p: unknown) =>
  String(p == null ? "" : p)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** As cores que a marca define, pelo papel escrito no kit ou na Identidade. */
export function coresDaMarca(paleta: CorDaMarcaParaApoio[]): Partial<Record<"primaria" | "secundaria" | "destaque" | "fundo" | "texto", string>> {
  const validas = (paleta || []).map((c) => ({ hex: normalizarHex(c.hex), papel: papelDe(c.papel) })).filter((c): c is { hex: string; papel: string } => !!c.hex);
  const achar = (re: RegExp) => (validas.filter((c) => re.test(c.papel))[0] || { hex: undefined }).hex;
  const saida: Partial<Record<"primaria" | "secundaria" | "destaque" | "fundo" | "texto", string>> = {};
  const primaria = achar(/prim/) || (validas[0] ? validas[0].hex : undefined);
  if (primaria) saida.primaria = primaria;
  const secundaria = achar(/secund/);
  if (secundaria && secundaria !== primaria) saida.secundaria = secundaria;
  const destaque = achar(/destaque|acento|accent/);
  if (destaque) saida.destaque = destaque;
  const fundo = achar(/fundo|background/);
  if (fundo) saida.fundo = fundo;
  const texto = validas.filter((c) => /texto|foreground/.test(c.papel) && !/sobre/.test(c.papel))[0];
  if (texto) saida.texto = texto.hex;
  return saida;
}

/**
 * Retinge um neutro no matiz da marca: cor de croma baixo (quase branco,
 * quase preto ou cinza, como o slate da base) vira o cinza da marca na mesma
 * luz; cor viva não mexe.
 */
export function retingir(hex: string, marca: string): string {
  const c = hexParaHsl(hex);
  const m = hexParaHsl(marca);
  const croma = (1 - Math.abs((2 * c.l) / 100 - 1)) * (c.s / 100);
  if (croma >= 0.12) return hex.toUpperCase();
  return hslParaHex({ h: m.h, s: m.s < 5 ? 0 : Math.min(Math.max(c.s, 6), 14), l: c.l }).toUpperCase();
}

/** O passo da escala da cor, mais perto da cor original, que passa o mínimo sobre o fundo (null quando nenhum passa). */
export function tomQuePassa(hex: string, fundo: string, minimo: number): string | null {
  if (contraste(hex, fundo) >= minimo) return hex.toUpperCase();
  const alvo = luminanciaRelativa(hex);
  const bons = escalaDaCor(hex)
    .map((p) => p.hex.toUpperCase())
    .filter((h) => contraste(h, fundo) >= minimo)
    .sort((a, b) => Math.abs(luminanciaRelativa(a) - alvo) - Math.abs(luminanciaRelativa(b) - alvo));
  return bons[0] || null;
}

const razao = (a: string, b: string) => contraste(a, b).toFixed(2).replace(".", ",");

/**
 * Os papéis que dependem do destaque (uma regra só, usada pelo apoio inteiro e
 * pelo worker quando reaproveita o apoio do pacote): texto sobre o destaque,
 * destaque para texto e link (o tom da escala mais perto que passa AA no
 * fundo, só quando o destaque não passa) e o anel de foco (o destaque no tom
 * que passa 3:1; sem tom, a cor do texto).
 */
export function papeisDoDestaque(destaque: string | null, fundo: string, texto: string, tom: string): { sobre: CorDoApoio | null; destaqueTexto: CorDoApoio | null; anel: CorDoApoio; avisos: string[] } {
  const avisos: string[] = [];
  let sobre: CorDoApoio | null = null;
  let destaqueTexto: CorDoApoio | null = null;
  if (destaque) {
    const s = textoSobre(destaque);
    sobre = { papel: "sobre_destaque", hex: s.toUpperCase(), origem: "ajuste" };
    if (contraste(s, destaque) < MINIMO.texto) avisos.push(`Texto sobre o destaque ${destaque} fica em ${razao(s, destaque)}:1 (${nivelDoContraste(contraste(s, destaque))}): use texto grande e forte no botão.`);
    if (contraste(destaque, fundo) < MINIMO.texto) {
      const passo = tomQuePassa(destaque, fundo, MINIMO.texto);
      if (passo) destaqueTexto = { papel: "destaque_texto", hex: passo.toUpperCase(), origem: "ajuste" };
      else avisos.push(`Nenhum tom do destaque ${destaque} passa AA como texto sobre ${fundo}: link e texto pequeno ficam na cor do texto.`);
    }
  }
  // Anel de foco: a cor da marca (nunca o azul da base), no tom que passa 3:1 no fundo.
  const tomDoAnel = tomQuePassa(destaque || tom, fundo, MINIMO.interface);
  const anel: CorDoApoio = { papel: "anel", hex: (tomDoAnel || texto).toUpperCase(), origem: "ajuste" };
  if (!tomDoAnel) avisos.push("A cor da marca não passa 3:1 no fundo: o anel de foco fica na cor do texto.");
  return { sobre, destaqueTexto, anel, avisos };
}

/**
 * Refaz os papéis do destaque de um apoio já pronto para o destaque do site
 * (o worker usa quando o apoio veio no pacote). Os outros papéis ficam.
 */
export function ajustarAoDestaque(a: ApoioDaPaleta, destaque: string, fundo: string, texto: string): ApoioDaPaleta {
  const d = normalizarHex(destaque);
  if (!d) return a;
  if (a.destaque && normalizarHex(a.destaque) === d) return a;
  const r = papeisDoDestaque(d, fundo, texto, d);
  const fora: PapelDoApoio[] = ["sobre_destaque", "destaque_texto", "anel"];
  const papeis = a.papeis.filter((x) => fora.indexOf(x.papel) < 0);
  const depoisDoTexto = papeis.map((x) => x.papel).lastIndexOf("texto") + 1;
  const novos = [r.sobre, r.destaqueTexto].filter((x): x is CorDoApoio => !!x);
  return { ...a, papeis: papeis.slice(0, depoisDoTexto).concat(novos, papeis.slice(depoisDoTexto), [r.anel]), avisos: a.avisos.concat(r.avisos), destaque: d.toUpperCase() };
}

/**
 * O apoio da paleta. `fundo` e `texto` forçados vêm do site (o modo claro ou
 * escuro já foi decidido pelo preset); sem eles, vale o da marca ou o da base.
 * `destaque` forçado é o destaque do SITE (coresDoSite, o mesmo do
 * --cor-destaque): texto sobre o destaque, destaque para texto e anel saem
 * dele. Sem ele, vale o destaque da marca ou a primária (Identidade).
 * Base de fundo claro num site escuro não entra nos neutros (a escala da
 * marca faz o papel).
 */
export function apoioDaPaleta(p: { marca: CorDaMarcaParaApoio[]; setor?: PaletaDoSetorParaApoio | null; fundo?: string | null; texto?: string | null; destaque?: string | null }): ApoioDaPaleta {
  const avisos: string[] = [];
  const marca = coresDaMarca(p.marca);
  const primaria = marca.primaria || null;
  const destaque = normalizarHex(p.destaque || "") || marca.destaque || primaria;
  const setor = p.setor || null;
  const citacao = setor ? `uupm:color:${setor.no}` : null;
  const daBase = citacao || "ajuste";
  const papeis: CorDoApoio[] = [];
  const por = (papel: PapelDoApoio, hex: string, origem: string) => papeis.push({ papel, hex: hex.toUpperCase(), origem });

  if (primaria) por("primaria", primaria, "marca");
  if (marca.secundaria) por("secundaria", marca.secundaria, "marca");
  if (marca.destaque) por("destaque", marca.destaque, "marca");
  const tom = primaria || destaque || "#111111";

  // Fundo e texto: forçados pelo site > os da marca > os da base retingidos > neutros da escala.
  const baseHex = (v: string | undefined) => (v ? normalizarHex(v) : null);
  let fundo = normalizarHex(p.fundo || "") || marca.fundo || null;
  let origemDoFundo = p.fundo ? "ajuste" : marca.fundo ? "marca" : daBase;
  if (!fundo) fundo = setor && baseHex(setor.fundo) ? retingir(baseHex(setor.fundo)!, tom) : "#FAFAF7";
  if (!setor && !p.fundo && !marca.fundo) origemDoFundo = "ajuste";
  const escuro = luminanciaRelativa(fundo) < 0.2;
  // A base (quase sempre clara) só empresta os neutros quando o fundo do site tem a mesma polaridade.
  const setorCombina = !!setor && baseHex(setor.fundo) !== null && (luminanciaRelativa(baseHex(setor.fundo)!) < 0.2) === escuro;
  por("fundo", fundo, origemDoFundo);

  let texto = normalizarHex(p.texto || "") || marca.texto || (setorCombina && baseHex(setor!.texto) ? retingir(baseHex(setor!.texto)!, tom) : textoSobre(fundo));
  let origemDoTexto = p.texto ? "ajuste" : marca.texto ? "marca" : setorCombina ? daBase : "ajuste";
  if (contraste(texto, fundo) < MINIMO.texto) {
    avisos.push(`O texto ${texto} sobre o fundo ${fundo} fica em ${razao(texto, fundo)}:1; troquei por ${textoSobre(fundo)}.`);
    texto = textoSobre(fundo);
    origemDoTexto = "ajuste";
  }
  por("texto", texto, origemDoTexto);

  const doDestaque = papeisDoDestaque(destaque, fundo, texto, tom);
  if (doDestaque.sobre) papeis.push(doDestaque.sobre);
  if (doDestaque.destaqueTexto) papeis.push(doDestaque.destaqueTexto);
  for (const x of doDestaque.avisos) if (!/anel de foco/.test(x)) avisos.push(x);

  // Neutros e estados: da base retingidos quando combina; senão, cinzas no matiz da marca (saturação baixa, como as neutras da casa).
  const neutro = (v: string | undefined, reserva: string) => (setorCombina && baseHex(v) ? retingir(baseHex(v)!, tom) : reserva);
  const matiz = hexParaHsl(tom);
  const cinza = (l: number) => hslParaHex({ h: matiz.h, s: matiz.s < 5 ? 0 : 10, l }).toUpperCase();
  const origemNeutra = setorCombina ? daBase : "ajuste";

  const cartao = neutro(setor ? setor.cartao : undefined, escuro ? cinza(12) : "#FFFFFF");
  por("cartao", cartao, origemNeutra);
  let textoDoCartao = neutro(setor ? setor.textoDoCartao : undefined, texto);
  if (contraste(textoDoCartao, cartao) < MINIMO.texto) textoDoCartao = textoSobre(cartao);
  por("texto_do_cartao", textoDoCartao, origemNeutra);

  por("suave", neutro(setor ? setor.suave : undefined, escuro ? cinza(16) : cinza(96)), origemNeutra);
  const textoSuave = tomQuePassa(neutro(setor ? setor.textoSuave : undefined, escuro ? "#A3A3A3" : "#5C5C5C"), fundo, MINIMO.texto);
  if (textoSuave) por("texto_suave", textoSuave, origemNeutra);
  else avisos.push("O texto suave da base não passa AA no fundo da marca: use a cor do texto.");

  const borda = neutro(setor ? setor.borda : undefined, escuro ? cinza(26) : cinza(86));
  if (contraste(borda, fundo) >= MINIMO.borda) por("borda", borda, origemNeutra);
  else {
    const outra = tomQuePassa(borda, fundo, MINIMO.borda);
    if (outra && outra !== borda.toUpperCase()) {
      por("borda", outra, "ajuste");
      avisos.push(`A borda da base some no fundo da marca (${razao(borda, fundo)}:1); ajustei para ${outra}.`);
    } else avisos.push("A borda da base some no fundo da marca: ficou de fora.");
  }

  const erroBruto = (setor && baseHex(setor.erro)) || "#DC2626";
  const erro = tomQuePassa(erroBruto, fundo, MINIMO.texto) || tomQuePassa(erroBruto, fundo, MINIMO.interface);
  if (erro) {
    por("erro", erro, erro === erroBruto.toUpperCase() ? daBase : "ajuste");
    let sobreErro = (setor && baseHex(setor.sobreErro)) || textoSobre(erro);
    if (contraste(sobreErro, erro) < MINIMO.texto) sobreErro = textoSobre(erro);
    por("sobre_erro", sobreErro, sobreErro === ((setor && baseHex(setor.sobreErro)) || "") ? daBase : "ajuste");
  } else avisos.push("O vermelho de erro não passa no fundo da marca: a mensagem de erro fica na cor do texto, com ícone.");

  papeis.push(doDestaque.anel);
  for (const x of doDestaque.avisos) if (/anel de foco/.test(x)) avisos.push(x);
  return { papeis, avisos, citacao, destaque: destaque ? destaque.toUpperCase() : null };
}

/**
 * Destaque, fundo e texto do site (a mesma regra que o src/marca.css sempre
 * usou, agora com a luminância da Identidade): destaque = a cor de papel
 * primário ou destaque (ou a primeira); fundo escuro pelo preset ou pelo DNA
 * quase preto, senão claro; texto pelo contraste do fundo.
 */
export function coresDoSite(p: { paleta?: unknown; dna?: unknown; estilo?: unknown }): { destaque: string; fundo: string; texto: string; escuro: boolean } {
  const paleta = (Array.isArray(p.paleta) ? p.paleta : []) as Array<{ hex?: string; papel?: string }>;
  const cores = paleta
    .map((c) => ({ hex: normalizarHex(c && c.hex), papel: String((c && c.papel) || "").toLowerCase() }))
    .filter((c): c is { hex: string; papel: string } => !!c.hex)
    .map((c) => ({ hex: c.hex.toLowerCase(), papel: c.papel }));
  const dna = p.dna && typeof p.dna === "object" ? (((p.dna as { atributos?: Array<{ id: string }> }).atributos || []).map((a) => a.id)) : [];
  const modo = p.estilo && typeof p.estilo === "object" ? (p.estilo as { modo?: unknown }).modo : null;
  const lum = (h: string) => luminanciaRelativa(h);
  const escuro = modo === "escuro" || (modo !== "claro" && (dna.indexOf("quase_preto") >= 0 || (dna.indexOf("claro_editorial") < 0 && cores.some((c) => /fundo/.test(c.papel) && lum(c.hex) < 0.2))));
  const destaque = (cores.filter((c) => /prim|destaque/.test(c.papel))[0] || cores[0] || { hex: "#00d52b" }).hex;
  const ordenadas = cores.slice().sort((a, b) => lum(a.hex) - lum(b.hex));
  const fundo = escuro
    ? ordenadas[0] && lum(ordenadas[0].hex) < 0.2 ? ordenadas[0].hex : "#0b0b0c"
    : ordenadas.length && lum(ordenadas[ordenadas.length - 1].hex) > 0.8 ? ordenadas[ordenadas.length - 1].hex : "#fafaf7";
  const texto = lum(fundo) > 0.4 ? "#111111" : "#f5f5f3";
  return { destaque, fundo, texto, escuro };
}

export const corDoPapel = (a: ApoioDaPaleta | null | undefined, papel: PapelDoApoio): string | null => {
  if (!a) return null;
  const c = a.papeis.filter((x) => x.papel === papel)[0];
  return c ? c.hex : null;
};

/** As variáveis de CSS que o apoio acrescenta ao src/marca.css do site. */
export function variaveisDoApoio(a: ApoioDaPaleta): Record<string, string> {
  const v: Record<string, string> = {};
  const par: Array<[PapelDoApoio, string]> = [
    ["borda", "--cor-borda"],
    ["anel", "--cor-anel"],
    ["erro", "--cor-erro"],
    ["sobre_erro", "--cor-sobre-erro"],
    ["sobre_destaque", "--cor-sobre-destaque"],
    ["destaque_texto", "--cor-destaque-texto"],
    ["texto_suave", "--cor-texto-suave"],
    ["cartao", "--cor-cartao"],
  ];
  for (const [papel, nome] of par) {
    const hex = corDoPapel(a, papel);
    if (hex) v[nome] = hex.toLowerCase();
  }
  if (!v["--cor-destaque-texto"]) {
    // O destaque passa AA como texto: link e texto pequeno usam ele mesmo (o do site, quando o apoio foi feito para o site).
    const d = a.destaque || corDoPapel(a, "destaque") || corDoPapel(a, "primaria");
    if (d) v["--cor-destaque-texto"] = d.toLowerCase();
  }
  return v;
}
