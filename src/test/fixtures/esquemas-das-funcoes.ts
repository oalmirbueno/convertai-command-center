/**
 * Coleta, do código das Edge Functions, cada esquema JSON que vai ao motor
 * (esquemaJson em chamarTexto). ESQ 30/09/2026: o teste de contrato confere
 * que a conversão para a Anthropic deixa CADA um dentro das regras.
 *
 * Como: lê o arquivo com o compilador do TypeScript, acha cada propriedade
 * esquemaJson e avalia a expressão com as declarações de topo do próprio
 * arquivo e dos arquivos que ele importa (./ e ../) e com as const locais
 * que ela alcança, sob demanda (os tipos saem pelo transpile do TypeScript). Nada roda além
 * do que o esquema usa. Variável que vem de parâmetro ou de await ganha valor
 * de teste em VARIANTES_DAS_FUNCOES; sem isso, sai como "dinamico".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

export const RAIZ_DAS_FUNCOES = resolve(__dirname, "../../../supabase/functions");

type Importado = { de: string; nome: string } | { externo: true };
type Modulo = {
  arquivo: string;
  fonte: ts.SourceFile;
  decls: Map<string, ts.Statement>;
  imports: Map<string, Importado>;
  reexporta: Array<{ de: string; nomes: Map<string, string> | null }>;
  valores: Map<string, unknown>;
  avaliando: Set<string>;
  escopo: object;
};

const MODULOS = new Map<string, Modulo>();

function resolverCaminho(de: string, especificador: string): string {
  return resolve(dirname(de), especificador);
}

function carregar(arquivo: string): Modulo {
  const ja = MODULOS.get(arquivo);
  if (ja) return ja;
  const texto = readFileSync(arquivo, "utf8");
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.ES2020, true, arquivo.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const m: Modulo = { arquivo, fonte, decls: new Map(), imports: new Map(), reexporta: [], valores: new Map(), avaliando: new Set(), escopo: {} };
  for (const st of fonte.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) m.decls.set(d.name.text, st);
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) {
      m.decls.set(st.name.text, st);
    } else if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause && !st.importClause.isTypeOnly) {
      const esp = st.moduleSpecifier.text;
      const relativo = esp.startsWith(".");
      const de = relativo ? resolverCaminho(arquivo, esp) : "";
      const c = st.importClause;
      if (c.name) m.imports.set(c.name.text, relativo ? { de, nome: "default" } : { externo: true });
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) m.imports.set(c.namedBindings.name.text, relativo ? { de, nome: "*" } : { externo: true });
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        for (const el of c.namedBindings.elements) {
          if (el.isTypeOnly) continue;
          m.imports.set(el.name.text, relativo ? { de, nome: (el.propertyName || el.name).text } : { externo: true });
        }
      }
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.startsWith(".")) {
      const de = resolverCaminho(arquivo, st.moduleSpecifier.text);
      if (!st.exportClause) m.reexporta.push({ de, nomes: null });
      else if (ts.isNamedExports(st.exportClause)) {
        const nomes = new Map<string, string>();
        for (const el of st.exportClause.elements) nomes.set(el.name.text, (el.propertyName || el.name).text);
        m.reexporta.push({ de, nomes });
      }
    }
  }
  m.escopo = new Proxy(
    {},
    {
      has: (_, k) => typeof k === "string" && (m.decls.has(k) || m.imports.has(k)),
      get: (_, k) => (typeof k === "string" ? obter(m, k) : undefined),
    },
  );
  MODULOS.set(arquivo, m);
  return m;
}

function exportado(m: Modulo, nome: string): unknown {
  if (nome === "*") {
    return new Proxy({}, { get: (_, k) => (typeof k === "string" ? exportado(m, k) : undefined) });
  }
  if (m.decls.has(nome) || m.imports.has(nome)) return obter(m, nome);
  for (const r of m.reexporta) {
    if (r.nomes && r.nomes.has(nome)) return exportado(carregar(r.de), r.nomes.get(nome) as string);
    if (!r.nomes) {
      const alvo = carregar(r.de);
      if (alvo.decls.has(nome) || alvo.imports.has(nome)) return exportado(alvo, nome);
    }
  }
  throw new Error(`${relative(RAIZ_DAS_FUNCOES, m.arquivo)} não exporta ${nome}`);
}

const TRANSPILADOS = new Map<string, string>();
function transpilar(texto: string): string {
  const ja = TRANSPILADOS.get(texto);
  if (ja !== undefined) return ja;
  const sem = texto.replace(/^\s*export\s+(default\s+)?/, "");
  const r = ts.transpileModule(sem, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  TRANSPILADOS.set(texto, r);
  return r;
}

function executar(m: Modulo, js: string, retorno: string): unknown {
  const f = new Function("__escopo", `with (__escopo) {\n${js}\n;return (${retorno});\n}`);
  return f(m.escopo);
}

function obter(m: Modulo, nome: string): unknown {
  if (m.valores.has(nome)) return m.valores.get(nome);
  const imp = m.imports.get(nome);
  if (imp) {
    const v = "externo" in imp ? undefined : exportado(carregar(imp.de), imp.nome);
    m.valores.set(nome, v);
    return v;
  }
  const st = m.decls.get(nome);
  if (!st) return undefined;
  if (m.avaliando.has(nome)) throw new Error(`ciclo em ${nome}`);
  m.avaliando.add(nome);
  try {
    const v = executar(m, transpilar(st.getText(m.fonte)), nome);
    m.valores.set(nome, v);
    return v;
  } finally {
    m.avaliando.delete(nome);
  }
}

/** Avalia uma expressão no escopo de topo do arquivo (lança se ela usa variável local). */
export function avaliarNoArquivo(arquivo: string, expressao: string): unknown {
  const m = carregar(arquivo);
  return executar(m, "", transpilar(`(${expressao})`).replace(/;\s*$/, ""));
}

/** const local visível do nó (blocos que envolvem o uso, antes dele), com inicializador sem await. */
function declaracaoLocal(uso: ts.Node, nome: string, fonte: ts.SourceFile): ts.VariableDeclaration | null {
  for (let p: ts.Node | undefined = uso.parent; p && !ts.isSourceFile(p); p = p.parent) {
    const statements = ts.isBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p) ? p.statements : null;
    if (!statements) continue;
    for (const st of statements) {
      if (st.getStart(fonte) > uso.getStart(fonte)) break;
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === nome && d.initializer && !/\bawait\b/.test(d.initializer.getText(fonte))) return d;
      }
    }
  }
  return null;
}

/**
 * Avalia a expressão do uso com as const locais que ela alcança (resolvidas
 * sob demanda) e os valores de teste da variante (expressões no escopo do
 * arquivo, para variável que vem de parâmetro ou de await).
 */
function avaliarNoUso(arquivo: string, uso: ts.Node, expressao: string, variante: Variante): unknown {
  const m = carregar(arquivo);
  const cache = new Map<string, unknown>();
  const emCurso = new Set<string>();
  const achados = new Map<string, ts.VariableDeclaration | null>();
  const local = (k: string) => {
    if (!achados.has(k)) achados.set(k, declaracaoLocal(uso, k, m.fonte));
    return achados.get(k) as ts.VariableDeclaration | null;
  };
  const locais: object = new Proxy(
    {},
    {
      has: (_, k) => typeof k === "string" && (k in variante || !!local(k)),
      get: (_, k) => {
        if (typeof k !== "string") return undefined;
        if (cache.has(k)) return cache.get(k);
        if (emCurso.has(k)) throw new Error(`ciclo em ${k}`);
        emCurso.add(k);
        try {
          let v: unknown;
          if (k in variante) {
            const x = variante[k];
            v = typeof x === "string" ? executarComLocais(m, x, locais) : avaliarNoArquivo(resolve(RAIZ_DAS_FUNCOES, x.arquivo), x.expressao);
          } else {
            const d = local(k) as ts.VariableDeclaration;
            v = executarComLocais(m, (d.initializer as ts.Expression).getText(m.fonte), locais);
          }
          cache.set(k, v);
          return v;
        } finally {
          emCurso.delete(k);
        }
      },
    },
  );
  return executarComLocais(m, expressao, locais);
}

function executarComLocais(m: Modulo, expressao: string, locais: object): unknown {
  const js = transpilar(`(${expressao})`).replace(/;\s*$/, "");
  const f = new Function("__escopo", "__locais", `with (__escopo) { with (__locais) { return (${js}); } }`);
  return f(m.escopo, locais);
}

/**
 * Valores de teste por arquivo (rel. a supabase/functions): cada variante é
 * { variável: expressão no escopo do arquivo } ou, quando o valor mora em
 * outro arquivo, { variável: { arquivo, expressao } }.
 */
export type Variante = Record<string, string | { arquivo: string; expressao: string }>;
export type VariantesDeTeste = Record<string, Variante[]>;

export type EsquemaColetado = {
  funcao: string;
  arquivo: string;
  linha: number;
  expressao: string;
  /** Rótulo único: arquivo:linha e a expressão (com o ramo, quando é um ternário). */
  rotulo: string;
  esquema: unknown;
  dinamico: boolean;
  erro?: string;
};

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = resolve(dir, nome);
    const s = statSync(p);
    if (s.isDirectory()) saida.push(...arquivosTs(p));
    else if (/\.tsx?$/.test(nome) && !/\.d\.ts$/.test(nome)) saida.push(p);
  }
  return saida;
}

function desembrulhar(e: ts.Expression): ts.Expression {
  let x = e;
  for (;;) {
    if (ts.isAsExpression(x) || ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
    else if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.BarBarToken || x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) x = x.left;
    else return x;
  }
}

/** Cada esquemaJson do código das funções (menos o próprio motor), já avaliado quando dá. */
export function coletarEsquemasDasFuncoes(variantes: VariantesDeTeste = {}): EsquemaColetado[] {
  const saida: EsquemaColetado[] = [];
  for (const arquivo of arquivosTs(RAIZ_DAS_FUNCOES)) {
    const texto = readFileSync(arquivo, "utf8");
    if (texto.indexOf("esquemaJson") < 0) continue;
    const rel = relative(RAIZ_DAS_FUNCOES, arquivo).replace(/\\/g, "/");
    if (rel === "_shared/ia-motor.ts") continue;
    const fonte = carregar(arquivo).fonte;
    const visitar = (no: ts.Node) => {
      const abreviado = ts.isShorthandPropertyAssignment(no) && no.name.text === "esquemaJson";
      if ((ts.isPropertyAssignment(no) && ts.isIdentifier(no.name) && no.name.text === "esquemaJson") || abreviado) {
        const linha = fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1;
        const expr = desembrulhar(ts.isPropertyAssignment(no) ? no.initializer : (no as ts.ShorthandPropertyAssignment).name);
        const ramos = ts.isConditionalExpression(expr) ? [desembrulhar(expr.whenTrue), desembrulhar(expr.whenFalse)] : [expr];
        for (const r of ramos) {
          const expressao = r.getText(fonte);
          const base = { funcao: rel.split("/")[0], arquivo: rel, linha, expressao };
          const vistos: string[] = [];
          let erro = "";
          for (const variante of [{} as Variante].concat(variantes[rel] || [])) {
            try {
              const esquema = avaliarNoUso(arquivo, r, expressao, variante);
              if (esquema === undefined) throw new Error("esquema indefinido");
              const txt = JSON.stringify(esquema);
              if (vistos.indexOf(txt) >= 0) continue;
              vistos.push(txt);
              const valorDe = (x: Variante[string]) => (typeof x === "string" ? x : `${x.arquivo}:${x.expressao}`);
              const nomeDaVariante = Object.keys(variante).length ? ` [${Object.keys(variante).map((k) => `${k}=${valorDe(variante[k])}`).join(", ").slice(0, 90)}]` : "";
              saida.push({ ...base, rotulo: `${rel}:${linha} ${expressao}${nomeDaVariante}`, esquema, dinamico: false });
              // Sem variante resolveu: o esquema não depende de valor de teste.
              if (!Object.keys(variante).length) break;
            } catch (e) {
              erro = e instanceof Error ? e.message : String(e);
            }
          }
          if (!vistos.length) saida.push({ ...base, rotulo: `${rel}:${linha} ${expressao}`, esquema: undefined, dinamico: true, erro });
        }
      }
      ts.forEachChild(no, visitar);
    };
    visitar(fonte);
  }
  return saida;
}

/** 80 campos (o máximo do Preencher com IA), todos os tipos: o pior caso do esquema dos campos. */
const CAMPOS_DE_TESTE = `Array.from({ length: 80 }, (_, i) => { const tipo = ["texto", "texto_longo", "lista", "numero", "escolha", "objeto"][i % 6]; return { chave: "k" + i, rotulo: "Campo " + i, tipo, opcoes: tipo === "escolha" ? ["a", "b"] : undefined, valorAtual: tipo === "objeto" ? { a: "", b: [], c: 0 } : undefined }; })`;
const CRITERIOS_DE_TESTE = `["formato e silhueta do produto", "cor e acabamento do produto", "rosto igual ao da persona", "luz coerente entre assunto e cenário", "sem texto ou marca inventados"]`;

/**
 * Valores de teste dos esquemas montados com variável local que vem de
 * parâmetro ou de await (o resto o coletor resolve sozinho).
 */
export const VARIANTES_DAS_FUNCOES: VariantesDeTeste = {
  "briefing-agente/preencher.ts": [{ pedido: `pedidoDoPreenchimento({ titulo: "Briefing" }, ${CAMPOS_DE_TESTE}, [], false)` }],
  "preencher-ia/index.ts": [{ esquema: `montarPedido({ papel: "site", fontes: [], campos: ${CAMPOS_DE_TESTE} }).esquema` }],
  "conselho/index.ts": ["ESQUEMA_DA_PROPOSTA", "ESQUEMA_DA_CRITICA", "ESQUEMA_DA_REVISAO", "ESQUEMA_DO_MODERADOR"].map((nome) => ({
    p: { arquivo: "conselho/modulos/conselho.ts", expressao: `({ esquema: ${nome} })` },
  })),
  "mesa-foto/canvas.ts": [{ criterios: CRITERIOS_DE_TESTE }],
  "mesa-foto/index.ts": [{ criterios: CRITERIOS_DE_TESTE }],
  "mesa-motion/index.ts": [{ f: `({ tipo: "apresentacao" })` }, { f: `({ tipo: "filme_marca" })` }],
  "mesa-proposta/evolucao.ts": [{ campos: `[{ chave: "capa.headline", tipo: "texto" }, { chave: "solucao.frentes", tipo: "lista" }, { chave: "solucao.passos", tipo: "lista" }]` }],
};
