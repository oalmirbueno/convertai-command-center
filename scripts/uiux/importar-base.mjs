#!/usr/bin/env node
// Importa a base UI UX Pro Max 2.15.0 para arquivos TS tipados. A fonte é a
// MESMA cópia que o motor de código usa (workers/motor-codigo/vendor/ui-ux-pro-max,
// instalada e conferida pelo instalar-ui-ux-pro-max.mjs): uma cópia só no
// repositório. Node puro, sem dependência, com o seu próprio leitor de CSV (o
// teste usa OUTRO leitor, _shared/uiux/csv.ts, e os dois precisam dar o mesmo
// resultado).
//
// Peso (30/09): tudo o que fica em supabase/functions fora das pastas de função
// sobe junto com o App MCP do Lovable, que recusa acima de ~4,4 MB (teste de
// guarda em 4 MB). Por isso as funções levam SÓ as colunas que o servidor usa
// (o resto fica na skill do motor) e o índice leve da tela mora em src/.
//
//   node scripts/uiux/importar-base.mjs            escreve os arquivos
//   node scripts/uiux/importar-base.mjs --conferir gera em memória e compara com o disco (sai 1 se diferir)
//
// Regras: fim de linha LF no hash; texto fora do ASCII vira \uXXXX (Safari 11 e
// nada de travessão literal no código); regras de decisão da base ficam como
// TEXTO (nunca avaliadas).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RAIZ_PADRAO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PASTA_DA_BASE = "workers/motor-codigo/vendor/ui-ux-pro-max/data";
export const PASTA_DOS_DADOS = "supabase/functions/_shared/uiux/dados";
/** O índice leve é só da tela: fica em src/ (não pesa nas funções). */
export const ARQUIVO_DO_INDICE_LEVE = "src/lib/uiux/dados/indice-leve.ts";

export const PACOTE = {
  pacote: "ui-ux-pro-max-cli",
  versao: "2.15.0",
  integridade: "sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==",
  gitHead: "a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5",
  clone: "09170ee",
  licenca: "MIT",
  autor: "Next Level Builder",
  repositorio: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
};

const CABECALHO = "Gerado por scripts/uiux/importar-base.mjs a partir de UI UX Pro Max 2.15.0 (MIT, Next Level Builder, github.com/nextlevelbuilder/ui-ux-pro-max-skill). Não edite à mão.";

/**
 * As bases: arquivo, constante, tipo e o mapa de colunas (chave nossa -> coluna
 * do CSV). Só as colunas que o servidor, o worker ou a tela usam: o tipo gerado
 * sai destas chaves, então usar uma coluna que ficou de fora quebra o tsc.
 */
export const BASES = [
  {
    arquivo: "estilos.ts",
    csv: "styles.csv",
    constante: "ESTILOS_DA_BASE",
    tipo: "EstiloDaBase",
    colunas: {
      no: "No", nome: "Style Category", tipo: "Type", palavras: "Keywords", coresPrimarias: "Primary Colors",
      efeitos: "Effects & Animation", melhorPara: "Best For", naoUsarPara: "Do Not Use For", modoClaro: "Light Mode ✓", modoEscuro: "Dark Mode ✓",
      checklist: "Implementation Checklist", variaveis: "Design System Variables", id: "Style ID", apelidos: "Aliases", status: "Status", pai: "Parent Style ID",
      substitutoDominio: "Replacement Domain", substituto: "Replacement ID", modoPreferido: "Preferred Mode",
    },
  },
  {
    arquivo: "produtos.ts",
    csv: "products.csv",
    constante: "PRODUTOS_DA_BASE",
    tipo: "ProdutoDaBase",
    colunas: { no: "No", nome: "Product Type", palavras: "Keywords", estiloPrincipal: "Primary Style Recommendation", estilosSecundarios: "Secondary Styles", padrao: "Landing Page Pattern" },
  },
  {
    arquivo: "paletas.ts",
    csv: "colors.csv",
    constante: "PALETAS_DA_BASE",
    tipo: "PaletaDaBase",
    colunas: {
      no: "No", nome: "Product Type", primaria: "Primary", secundaria: "Secondary", destaque: "Accent",
      fundo: "Background", texto: "Foreground", cartao: "Card", textoDoCartao: "Card Foreground", suave: "Muted", textoSuave: "Muted Foreground", borda: "Border", erro: "Destructive",
      sobreErro: "On Destructive", anel: "Ring",
    },
  },
  {
    arquivo: "raciocinio.ts",
    csv: "ui-reasoning.csv",
    constante: "RACIOCINIO_DA_BASE",
    tipo: "RaciocinioDaBase",
    // Decision_Rules (JSON) não entra: nada do painel avalia regra da base, e ela é a coluna mais pesada.
    colunas: { no: "No", categoria: "UI_Category", padrao: "Recommended_Pattern", estilos: "Style_Priority", humorDeCor: "Color_Mood", humorDeTipo: "Typography_Mood", antipadroes: "Anti_Patterns", severidade: "Severity" },
  },
  {
    arquivo: "pares.ts",
    csv: "typography.csv",
    constante: "PARES_DA_BASE",
    tipo: "ParDaBase",
    colunas: { no: "No", nome: "Font Pairing Name", categoria: "Category", titulo: "Heading Font", texto: "Body Font", humor: "Mood/Style Keywords", melhorPara: "Best For", url: "Google Fonts URL", notas: "Notes" },
  },
  {
    arquivo: "landing.ts",
    csv: "landing.csv",
    constante: "PADROES_DA_BASE",
    tipo: "PadraoDaBase",
    colunas: { no: "No", nome: "Pattern Name", palavras: "Keywords", ordem: "Section Order", cta: "Primary CTA Placement", id: "Pattern ID", apelidos: "Aliases" },
  },
  {
    arquivo: "ux.ts",
    csv: "ux-guidelines.csv",
    constante: "REGRAS_DE_UX_DA_BASE",
    tipo: "RegraDeUxDaBase",
    colunas: { no: "No", categoria: "Category", problema: "Issue", plataforma: "Platform", codigoBom: "Code Example Good", severidade: "Severity" },
  },
  {
    arquivo: "graficos.ts",
    csv: "charts.csv",
    constante: "GRAFICOS_DA_BASE",
    tipo: "GraficoDaBase",
    // Só o que identifica a linha citada (uupm:chart:<No>): a orientação completa o agente lê na skill.
    colunas: { no: "No", tipoDeDado: "Data Type", melhor: "Best Chart Type", alternativaA11y: "A11y Fallback" },
  },
];

// ------------------------------------------------------------------ leitor de CSV (máquina de estados por caractere)

/** Lê CSV (RFC 4180): aspas, aspas dobradas, vírgula e quebra de linha dentro do campo, BOM. Devolve linhas de campos. */
export function lerCsvBruto(texto) {
  let t = String(texto);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const linhas = [];
  let linha = [];
  let campo = "";
  let dentro = false;
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (dentro) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        dentro = false;
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }
    if (c === '"') {
      dentro = true;
      i++;
      continue;
    }
    if (c === ",") {
      linha.push(campo);
      campo = "";
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      linha.push(campo);
      campo = "";
      linhas.push(linha);
      linha = [];
      if (c === "\r" && t[i + 1] === "\n") i++;
      i++;
      continue;
    }
    campo += c;
    i++;
  }
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => !(l.length === 1 && l[0] === ""));
}

/** Linhas como objetos pelo cabeçalho; coluna que falta no cabeçalho é erro. */
export function lerCsvComCabecalho(texto, colunasPedidas) {
  const [cabecalho, ...linhas] = lerCsvBruto(texto);
  const indice = {};
  cabecalho.forEach((c, i) => (indice[c] = i));
  for (const c of colunasPedidas) if (indice[c] === undefined) throw new Error(`coluna ausente: ${c}`);
  return linhas.map((l, n) => {
    if (l.length !== cabecalho.length) throw new Error(`linha ${n + 2} com ${l.length} campos (esperado ${cabecalho.length})`);
    const o = {};
    for (const c of colunasPedidas) o[c] = l[indice[c]];
    return o;
  });
}

// ------------------------------------------------------------------ escrita

/** JSON com todo caractere fora do ASCII como \uXXXX (e as quebras U+2028/2029 também). */
export function jsonAscii(valor) {
  return JSON.stringify(valor).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

const lf = (s) => String(s).replace(/\r\n?/g, "\n");
export const sha256 = (s) => createHash("sha256").update(lf(s), "utf8").digest("hex");

function linhasDoArray(lista) {
  return lista.map((o) => `  ${jsonAscii(o)},`).join("\n");
}

function arquivoDaBase(base, linhas, hash) {
  const chaves = Object.keys(base.colunas);
  return [
    "/**",
    ` * ${CABECALHO}`,
    ` * Fonte: ${PASTA_DA_BASE}/${base.csv} (SHA-256 ${hash}), ${linhas.length} linhas.`,
    " */",
    "",
    `/** Chave nossa -> coluna de ${base.csv} (o teste de igualdade usa o mesmo mapa). */`,
    `export const COLUNAS = ${jsonAscii(base.colunas)} as const;`,
    "",
    `export type ${base.tipo} = { ${chaves.map((k) => `${k}: string`).join("; ")} };`,
    "",
    // As linhas vão como listas de valores (sem repetir o nome das chaves em
    // cada linha: o arquivo cai perto da metade) e viram objetos na carga.
    "const LINHAS: string[][] = [",
    linhas.map((o) => `  ${jsonAscii(chaves.map((k) => o[k]))},`).join("\n"),
    "];",
    "",
    `export const ${base.constante}: ${base.tipo}[] = LINHAS.map((l) => ({ ${chaves.map((k, i) => `${k}: l[${i}]`).join(", ")} }));`,
    "",
  ].join("\n");
}

/** Linhas da base na forma do arquivo gerado (chave nossa, texto cru do CSV). */
export function linhasDaBase(base, textoCsv) {
  const colunas = Object.values(base.colunas);
  const chaves = Object.keys(base.colunas);
  return lerCsvComCabecalho(textoCsv, colunas).map((o) => {
    const saida = {};
    chaves.forEach((k, i) => (saida[k] = o[colunas[i]]));
    return saida;
  });
}

const LICENCAS = { OFL: "OFL", APACHE2: "Apache" };

/**
 * As famílias dos pares (na ordem em que aparecem: título, depois texto), com a
 * categoria e os pesos do google-fonts.csv, a licença do google-font-licenses.json
 * e se têm o subconjunto latin. Família sem licença OFL ou Apache é erro.
 */
export function fontesDosPares(pares, textoGoogleFonts, textoLicencas) {
  const gf = {};
  for (const l of lerCsvComCabecalho(textoGoogleFonts, ["Family", "Category", "Styles", "Subsets"])) gf[l.Family] = l;
  const lic = {};
  for (const f of JSON.parse(textoLicencas).families) lic[f.name] = f.license;
  const familias = [];
  for (const p of pares) for (const f of [p.titulo, p.texto]) if (familias.indexOf(f) < 0) familias.push(f);
  return familias.map((familia) => {
    const g = gf[familia];
    if (!g) throw new Error(`família fora do google-fonts.csv: ${familia}`);
    const licenca = LICENCAS[lic[familia]];
    if (!licenca) throw new Error(`família sem licença OFL ou Apache: ${familia} (${lic[familia]})`);
    const estilos = g.Styles.split("|").map((s) => s.trim()).filter(Boolean);
    const pesos = estilos.filter((s) => /^\d+$/.test(s)).map(Number).sort((a, b) => a - b);
    return {
      familia,
      categoria: g.Category,
      pesos,
      italico: estilos.some((s) => /^\d+i$/.test(s)),
      licenca,
      latin: g.Subsets.split("|").map((s) => s.trim()).indexOf("latin") >= 0,
    };
  });
}

function arquivoDasFontes(fontes, hashes) {
  return [
    "/**",
    ` * ${CABECALHO}`,
    ` * Fonte: as famílias dos pares de ${PASTA_DA_BASE}/typography.csv, com google-fonts.csv (SHA-256 ${hashes.gf}) e google-font-licenses.json (SHA-256 ${hashes.lic}).`,
    " */",
    "",
    "export type FonteDaBase = { familia: string; categoria: string; pesos: number[]; italico: boolean; licenca: \"OFL\" | \"Apache\"; latin: boolean };",
    "",
    "export const FONTES_DA_BASE: FonteDaBase[] = [",
    linhasDoArray(fontes),
    "];",
    "",
  ].join("\n");
}

function arquivoDaVersao(versao) {
  return [
    "/**",
    ` * ${CABECALHO}`,
    " * Versão fixa da base, os SHA-256 dos arquivos (conteúdo em LF) e as contagens.",
    " */",
    "",
    `export const VERSAO_DA_BASE = ${JSON.stringify(versao, null, 2)} as const;`,
    "",
    "/** Rótulo curto para a tela e para as citações. */",
    `export const ROTULO_DA_BASE = "UI UX Pro Max ${versao.versao} (MIT, Next Level Builder)";`,
    "",
  ].join("\n");
}

/**
 * O índice leve que a TELA carrega sob demanda (import dinâmico): só os campos
 * que as consultas e os cartões usam. Projeção exata das bases completas (o
 * teste confere). As funções continuam no servidor com a base inteira.
 */
export const LEVES = [
  { constante: "ESTILOS_LEVES", de: "ESTILOS_DA_BASE", tipo: "EstiloDaBase", campos: ["id", "nome", "tipo", "palavras", "coresPrimarias", "melhorPara", "naoUsarPara", "modoClaro", "modoEscuro", "modoPreferido", "apelidos", "status", "pai", "substitutoDominio", "substituto"] },
  { constante: "PRODUTOS_LEVES", de: "PRODUTOS_DA_BASE", tipo: "ProdutoDaBase", campos: ["no", "nome", "estiloPrincipal", "estilosSecundarios", "padrao"] },
  { constante: "RACIOCINIO_LEVE", de: "RACIOCINIO_DA_BASE", tipo: "RaciocinioDaBase", campos: ["no", "categoria", "padrao", "humorDeTipo"] },
  { constante: "PADROES_LEVES", de: "PADROES_DA_BASE", tipo: "PadraoDaBase", campos: ["no", "id", "nome", "apelidos", "ordem", "cta"] },
  { constante: "REGRAS_DE_UX_LEVES", de: "REGRAS_DE_UX_DA_BASE", tipo: "RegraDeUxDaBase", campos: ["no", "categoria", "problema", "plataforma", "severidade", "codigoBom"], so: (r) => r.plataforma === "Web" || r.plataforma === "All" },
];

const MODULO_DA_CONSTANTE = { ESTILOS_DA_BASE: "estilos", PRODUTOS_DA_BASE: "produtos", RACIOCINIO_DA_BASE: "raciocinio", PADROES_DA_BASE: "landing", REGRAS_DE_UX_DA_BASE: "ux" };

export function projecaoLeve(leve, linhas) {
  return linhas.filter((r) => (leve.so ? leve.so(r) : true)).map((r) => {
    const o = {};
    for (const c of leve.campos) o[c] = r[c];
    return o;
  });
}

function arquivoDoIndiceLeve(dados) {
  const importes = LEVES.map((l) => `import type { ${l.tipo} } from "../../../../${PASTA_DOS_DADOS}/${MODULO_DA_CONSTANTE[l.de]}";`);
  const blocos = LEVES.map((l) => {
    const campos = l.campos.map((c) => JSON.stringify(c)).join(" | ");
    return [`export const ${l.constante}: Array<Pick<${l.tipo}, ${campos}>> = [`, linhasDoArray(projecaoLeve(l, dados[l.de])), "];", ""].join("\n");
  });
  return [
    "/**",
    ` * ${CABECALHO}`,
    " * Índice leve para a tela (carregado sob demanda por src/lib/uiux/carregar.ts): projeção exata das bases completas.",
    " */",
    "",
    ...importes,
    "",
    ...blocos,
  ].join("\n");
}

/** Gera em memória: { caminho relativo: conteúdo }. */
export function gerarArquivos(raiz = RAIZ_PADRAO) {
  const ler = (nome) => lf(readFileSync(join(raiz, PASTA_DA_BASE, nome), "utf8"));
  const saida = {};
  const hashes = {};
  const contagens = {};
  const dados = {};
  for (const base of BASES) {
    const texto = ler(base.csv);
    hashes[base.csv] = sha256(texto);
    const linhas = linhasDaBase(base, texto);
    dados[base.constante] = linhas;
    saida[`${PASTA_DOS_DADOS}/${base.arquivo}`] = arquivoDaBase(base, linhas, hashes[base.csv]);
  }
  const gf = ler("google-fonts.csv");
  const lic = ler("google-font-licenses.json");
  hashes["google-fonts.csv"] = sha256(gf);
  hashes["google-font-licenses.json"] = sha256(lic);
  const fontes = fontesDosPares(dados.PARES_DA_BASE, gf, lic);
  saida[`${PASTA_DOS_DADOS}/fontes.ts`] = arquivoDasFontes(fontes, { gf: hashes["google-fonts.csv"], lic: hashes["google-font-licenses.json"] });
  const estilos = dados.ESTILOS_DA_BASE;
  const ux = dados.REGRAS_DE_UX_DA_BASE;
  Object.assign(contagens, {
    estilos: estilos.length,
    estilosAtivos: estilos.filter((e) => e.status === "active").length,
    produtos: dados.PRODUTOS_DA_BASE.length,
    paletas: dados.PALETAS_DA_BASE.length,
    raciocinio: dados.RACIOCINIO_DA_BASE.length,
    pares: dados.PARES_DA_BASE.length,
    fontes: fontes.length,
    padroes: dados.PADROES_DA_BASE.length,
    ux: ux.length,
    uxWeb: ux.filter((r) => r.plataforma === "Web" || r.plataforma === "All").length,
    graficos: dados.GRAFICOS_DA_BASE.length,
  });
  saida[`${PASTA_DOS_DADOS}/versao.ts`] = arquivoDaVersao({ ...PACOTE, sha256: hashes, contagens });
  saida[ARQUIVO_DO_INDICE_LEVE] = arquivoDoIndiceLeve(dados);
  return saida;
}

/** Compara o que seria gerado com o disco. Devolve os caminhos que diferem (vazio = igual). */
export function conferir(raiz = RAIZ_PADRAO) {
  const diferentes = [];
  const arquivos = gerarArquivos(raiz);
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(raiz, caminho);
    if (!existsSync(alvo) || lf(readFileSync(alvo, "utf8")) !== conteudo) diferentes.push(caminho);
  }
  return diferentes;
}

function principal() {
  const raiz = RAIZ_PADRAO;
  if (process.argv.indexOf("--conferir") >= 0) {
    const d = conferir(raiz);
    if (d.length) {
      console.error(`Diferente do que o gerador produz: ${d.join(", ")}. Rode node scripts/uiux/importar-base.mjs.`);
      process.exit(1);
    }
    console.log("Base UI UX Pro Max: arquivos gerados iguais ao disco.");
    return;
  }
  const arquivos = gerarArquivos(raiz);
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }
  console.log(`Base UI UX Pro Max: ${Object.keys(arquivos).length} arquivos em ${PASTA_DOS_DADOS} e ${ARQUIVO_DO_INDICE_LEVE}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) principal();
