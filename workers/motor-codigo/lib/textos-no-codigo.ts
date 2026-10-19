/**
 * Edição no clique para texto escrito direto no código (Gravyx, 19/10/2026):
 * o texto que a equipe trocou na prévia e que não é da copy do pacote. O
 * worker acha o texto EXATO no código (busca literal; só os espaços podem
 * variar, como no JSX quebrado em linhas) e troca sem gastar IA; depois o
 * motor recompila e confere.
 *
 * Recusa com motivo (a tela oferece "pedir ao motor, com IA"):
 *  - não achou o texto (vem de conta, de dado ou está quebrado em partes);
 *  - o texto se repete em mais de um lugar;
 *  - vem de um componente usado em vários lugares (a troca valeria para todos)
 *    ou de dentro de uma lista que repete;
 *  - o código usa o texto na lógica (comparação, filtro, chave, endereço);
 *  - a troca poria código ou link no texto.
 *
 * O plano é puro (recebe os arquivos); só `lerArquivosDoCodigo` e
 * `aplicarTrocasNoProjeto` tocam o disco.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type TrocaDeTexto = { antes: string; depois: string; secao?: string | null };
export type ArquivoDoCodigo = { caminho: string; conteudo: string };
export type ContextoDoTexto = "jsx" | "texto" | "atributo" | "codigo";
export type AchadoDoTexto = { arquivo: string; inicio: number; fim: number; linha: number; contexto: ContextoDoTexto; aspas: string | null };
export type PlanoDaTroca =
  | { ok: true; arquivo: string; linha: number; conteudo: string; antes: string; depois: string }
  | { ok: false; codigo: string; motivo: string; antes: string };

export const MAX_TEXTO_NO_CODIGO = 600;
const EXTENSOES = /\.(tsx|jsx|ts|js|mjs|html)$/i;

/** Atributo de JSX que é texto que a pessoa lê (pode trocar). */
const ATRIBUTOS_DE_TEXTO = ["alt", "title", "aria-label", "placeholder", "label", "aria-description"];
/** Campo de objeto que é técnico (endereço, chave, tipo): o texto ali é lógica. */
const CAMPOS_TECNICOS = ["id", "key", "href", "src", "slug", "tipo", "type", "icone", "icon", "rota", "to", "url", "name", "value", "className", "classe", "variant", "variante", "secao"];
/** Uso do texto na lógica, na mesma linha. */
const NA_LOGICA = /===|!==|[^=!<>]==[^=]|!=[^=]|\bcase\s|\bswitch\b|\.includes\(|\.indexOf\(|\.startsWith\(|\.endsWith\(|\.match\(|\.test\(|\.filter\(|\.find\(|\.some\(|\.every\(|localeCompare|\.split\(|\.replace\(/;

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizar = (s: string) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

/** O padrão que acha o texto com qualquer quebra de espaço (o resto é literal). */
export function padraoDoTexto(texto: string): RegExp | null {
  const t = normalizar(texto);
  if (!t) return null;
  return new RegExp(t.split(" ").map(escaparRegex).join("\\s+"), "g");
}

const linhaDe = (conteudo: string, pos: number) => conteudo.slice(0, pos).split("\n").length;

/** Em que pedaço do código o achado está (texto do JSX, string, atributo ou código). */
export function contextoDoAchado(conteudo: string, inicio: number, fim: number): { contexto: ContextoDoTexto; aspas: string | null } {
  const comecoDaLinha = conteudo.lastIndexOf("\n", inicio - 1) + 1;
  const antesNaLinha = conteudo.slice(comecoDaLinha, inicio);
  // Dentro de uma string? Conta as aspas sem escape antes do achado, na mesma linha.
  for (const q of ['"', "'", "`"]) {
    let n = 0;
    for (let i = 0; i < antesNaLinha.length; i++) if (antesNaLinha.charAt(i) === q && antesNaLinha.charAt(i - 1) !== "\\") n += 1;
    if (n % 2 === 1) {
      const abre = antesNaLinha.lastIndexOf(q);
      const prefixo = antesNaLinha.slice(0, abre).replace(/\s+$/, "");
      // Apóstrofo no meio de palavra ("Don't") não abre string.
      if (/[A-Za-z0-9\u00c0-\u024f]$/.test(antesNaLinha.slice(0, abre))) continue;
      const declaracao = /\b(const|let|var)\s+[\w$]+\s*=$/.test(prefixo);
      if (!declaracao && /[A-Za-z][\w-]*\s*=\s*\{?$/.test(prefixo)) return { contexto: "atributo", aspas: q };
      return { contexto: "texto", aspas: q };
    }
  }
  // Texto do JSX: o caractere estrutural mais perto para trás é ">" ou "}" e para a frente é "<" ou "{".
  let i = inicio - 1;
  while (i >= 0 && "<>{};()=".indexOf(conteudo.charAt(i)) < 0) i -= 1;
  let j = fim;
  while (j < conteudo.length && "<>{};()=".indexOf(conteudo.charAt(j)) < 0) j += 1;
  const atras = i >= 0 ? conteudo.charAt(i) : "";
  const frente = j < conteudo.length ? conteudo.charAt(j) : "";
  if ((atras === ">" || atras === "}") && (frente === "<" || frente === "{")) return { contexto: "jsx", aspas: null };
  return { contexto: "codigo", aspas: null };
}

/** Todos os lugares onde o texto aparece nos arquivos. */
export function localizarTexto(arquivos: ArquivoDoCodigo[], antes: string): AchadoDoTexto[] {
  const re = padraoDoTexto(antes);
  if (!re) return [];
  const achados: AchadoDoTexto[] = [];
  for (const a of arquivos) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(a.conteudo))) {
      const inicio = m.index;
      const fim = inicio + m[0].length;
      // Pedaço de uma palavra maior não conta ("Café" dentro de "Cafeteria" não é o texto).
      const antesCh = a.conteudo.charAt(inicio - 1);
      const depoisCh = a.conteudo.charAt(fim);
      const letra = /[A-Za-z0-9À-ɏ]/;
      if ((letra.test(antesCh) && letra.test(a.conteudo.charAt(inicio))) || (letra.test(depoisCh) && letra.test(a.conteudo.charAt(fim - 1)))) continue;
      const c = contextoDoAchado(a.conteudo, inicio, fim);
      achados.push({ arquivo: a.caminho, inicio, fim, linha: linhaDe(a.conteudo, inicio), ...c });
      if (achados.length > 20) return achados;
    }
  }
  return achados;
}

/** O nome do componente (função com inicial maiúscula) que contém a posição. */
export function componenteEm(conteudo: string, pos: number): string | null {
  const re = /(?:function\s+([A-Z][A-Za-z0-9_]*)\s*\(|(?:const|let)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\([^)]*\)|[a-z_][\w]*)\s*=>)/g;
  let nome: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(conteudo)) && m.index < pos) nome = m[1] || m[2] || null;
  return nome;
}

/** Quantas vezes o componente é usado como tag em todos os arquivos. */
export function usosDoComponente(arquivos: ArquivoDoCodigo[], nome: string): number {
  const re = new RegExp(`<${escaparRegex(nome)}(?=[\\s/>])`, "g");
  return arquivos.reduce((n, a) => n + (a.conteudo.match(re) || []).length, 0);
}

/** O achado está dentro do callback de um .map( (lista que repete)? */
export function dentroDeLista(conteudo: string, pos: number): boolean {
  const janela = conteudo.slice(Math.max(0, pos - 1500), pos);
  let k = janela.lastIndexOf(".map(");
  while (k >= 0) {
    let saldo = 0;
    for (let i = k + 4; i < janela.length; i++) {
      const ch = janela.charAt(i);
      if (ch === "(") saldo += 1;
      else if (ch === ")") saldo -= 1;
    }
    if (saldo > 0) return true;
    k = janela.lastIndexOf(".map(", k - 1);
  }
  return false;
}

/** A troca poria código, link ou nada no lugar do texto? (motivo ou null) */
export function recusaDoTextoNovo(depois: string): string | null {
  const t = String(depois == null ? "" : depois);
  if (!normalizar(t)) return "Para tirar o texto, peça ao motor (com IA): tirar pode deixar um bloco vazio.";
  if (t.length > MAX_TEXTO_NO_CODIGO) return `O texto novo passa de ${MAX_TEXTO_NO_CODIGO} caracteres.`;
  if (/[<>{}`]/.test(t) || t.indexOf("${") >= 0) return "A troca poria código no texto (<, >, { } ou crase).";
  if (/\bon[a-z]+\s*=/i.test(t) || /javascript:|data:|vbscript:/i.test(t)) return "A troca poria código no texto.";
  if (/https?:\/\/|www\./i.test(t)) return "A troca poria um link no texto: link se troca pelo motor ou nas integrações.";
  return null;
}

const escaparNaString = (t: string, q: string) => t.split("\\").join("\\\\").split(q).join(`\\${q}`);

/**
 * O plano de uma troca: acha, confere as recusas e devolve o arquivo novo.
 * `arquivos` já vem sem a casca da casa (o motor repõe a casca).
 */
export function planejarTrocaDeTexto(arquivos: ArquivoDoCodigo[], troca: TrocaDeTexto): PlanoDaTroca {
  const antes = normalizar(troca.antes);
  const depois = normalizar(troca.depois);
  const recusa = (codigo: string, motivo: string): PlanoDaTroca => ({ ok: false, codigo, motivo, antes });
  if (!antes) return recusa("sem_texto", "Não veio o texto de antes.");
  if (antes === depois) return recusa("igual", "O texto não mudou.");
  const doNovo = recusaDoTextoNovo(depois);
  if (doNovo) return recusa("texto_novo", doNovo);
  const achados = localizarTexto(arquivos, antes);
  if (!achados.length) return recusa("nao_achou", "Não achei este texto escrito no código: ele pode vir de uma conta, de um dado ou estar quebrado em partes.");
  if (achados.length > 1) {
    const onde = achados.map((a) => a.arquivo).filter((x, i, l) => l.indexOf(x) === i);
    return recusa("repetido", `O texto aparece em ${achados.length > 20 ? "mais de 20" : achados.length} lugares (${onde.slice(0, 3).join(", ")}${onde.length > 3 ? "..." : ""}): trocar um só mudaria o lugar errado.`);
  }
  const a = achados[0];
  const arq = arquivos.find((x) => x.caminho === a.arquivo)!;
  if (a.contexto === "codigo") return recusa("no_codigo", "O texto aparece no meio do código, não como texto da página.");
  const comecoDaLinha = arq.conteudo.lastIndexOf("\n", a.inicio - 1) + 1;
  const fimDaLinha = arq.conteudo.indexOf("\n", a.fim);
  const linha = arq.conteudo.slice(comecoDaLinha, fimDaLinha < 0 ? arq.conteudo.length : fimDaLinha);
  if (a.contexto === "atributo") {
    const nome = /([A-Za-z][\w-]*)\s*=\s*\{?\s*["'`][^"'`]*$/.exec(arq.conteudo.slice(comecoDaLinha, a.inicio));
    if (!nome || ATRIBUTOS_DE_TEXTO.indexOf(nome[1]) < 0) return recusa("na_logica", `O texto é o valor de um atributo técnico${nome ? ` (${nome[1]})` : ""}: o código usa, não é só para ler.`);
  }
  if (a.contexto === "texto") {
    if (NA_LOGICA.test(linha)) return recusa("na_logica", "O código usa este texto na lógica (comparação, filtro ou busca): trocar quebraria o site.");
    const campo = /([A-Za-z_$][\w$]*)\s*:\s*$/.exec(arq.conteudo.slice(comecoDaLinha, a.inicio).replace(/["'`][^"'`]*$/, "").replace(/\s+$/, ""));
    if (campo && CAMPOS_TECNICOS.indexOf(campo[1]) >= 0) return recusa("na_logica", `O texto é o campo técnico "${campo[1]}": o código usa, não é só para ler.`);
    const constante = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]/.exec(linha);
    if (constante) {
      const nome = escaparRegex(constante[1]);
      const usoNaLogica = new RegExp(`(===|!==|==|!=)\\s*${nome}\\b|\\b${nome}\\s*(===|!==|==|!=)|case\\s+${nome}\\b|\\(\\s*${nome}\\s*[,)]`);
      if (arquivos.some((x) => usoNaLogica.test(x.conteudo))) return recusa("na_logica", `O código usa este texto na lógica (a constante ${constante[1]}).`);
    }
  }
  if (dentroDeLista(arq.conteudo, a.inicio)) return recusa("lista", "O texto está dentro de uma lista que se repete: a troca valeria para todos os itens.");
  const comp = componenteEm(arq.conteudo, a.inicio);
  if (comp) {
    const usos = usosDoComponente(arquivos, comp);
    if (usos >= 2) return recusa("componente", `O texto vem do componente ${comp}, usado em ${usos} lugares: a troca valeria para todos.`);
  }
  const novo = a.aspas ? escaparNaString(depois, a.aspas) : depois;
  const conteudo = arq.conteudo.slice(0, a.inicio) + novo + arq.conteudo.slice(a.fim);
  return { ok: true, arquivo: a.arquivo, linha: a.linha, conteudo, antes, depois };
}

/** Várias trocas, uma depois da outra; a primeira recusa para tudo (nada é escrito pela metade). */
export function planejarTrocas(arquivos: ArquivoDoCodigo[], trocas: TrocaDeTexto[]): { ok: boolean; arquivos: ArquivoDoCodigo[]; feitas: Array<{ antes: string; depois: string; arquivo: string; linha: number }>; recusa: { antes: string; codigo: string; motivo: string } | null } {
  let atuais = arquivos.slice();
  const feitas: Array<{ antes: string; depois: string; arquivo: string; linha: number }> = [];
  for (const t of trocas.slice(0, 10)) {
    const plano = planejarTrocaDeTexto(atuais, t);
    if (plano.ok === false) {
      const r = plano as Extract<PlanoDaTroca, { ok: false }>;
      return { ok: false, arquivos, feitas: [], recusa: { antes: r.antes, codigo: r.codigo, motivo: r.motivo } };
    }
    const p = plano as Extract<PlanoDaTroca, { ok: true }>;
    atuais = atuais.map((x) => (x.caminho === p.arquivo ? { caminho: x.caminho, conteudo: p.conteudo } : x));
    feitas.push({ antes: p.antes, depois: p.depois, arquivo: p.arquivo, linha: p.linha });
  }
  return { ok: true, arquivos: atuais, feitas, recusa: null };
}

/** Os arquivos de src/ do projeto, fora a casca da casa (o motor repõe a casca). */
export function lerArquivosDoCodigo(pasta: string, casca: string[] = []): ArquivoDoCodigo[] {
  const raiz = join(pasta, "src");
  const saida: ArquivoDoCodigo[] = [];
  if (!existsSync(raiz)) return saida;
  (function andar(d: string) {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n.charAt(0) === ".") continue;
      const c = join(d, n);
      const st = statSync(c);
      if (st.isDirectory()) andar(c);
      else if (EXTENSOES.test(n) && st.size < 400_000) {
        const rel = relative(pasta, c).split(sep).join("/");
        if (casca.indexOf(rel) >= 0) continue;
        saida.push({ caminho: rel, conteudo: readFileSync(c, "utf8") });
      }
    }
  })(raiz);
  return saida;
}

/** Aplica as trocas no projeto (só escreve quando todas passam). */
export function aplicarTrocasNoProjeto(pasta: string, trocas: TrocaDeTexto[], casca: string[] = []) {
  const arquivos = lerArquivosDoCodigo(pasta, casca);
  const r = planejarTrocas(arquivos, trocas);
  if (r.ok) {
    for (const a of r.arquivos) {
      const antes = arquivos.find((x) => x.caminho === a.caminho);
      if (antes && antes.conteudo !== a.conteudo) writeFileSync(join(pasta, a.caminho), a.conteudo);
    }
  }
  return r;
}

/** As trocas de texto do pedido "textos" (vêm em pedido.pacote.trocas), sem confiar em nada. */
export function trocasDoPedido(v: unknown): TrocaDeTexto[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ antes: String(x.antes ?? "").slice(0, 600), depois: String(x.depois ?? "").slice(0, 600), secao: typeof x.secao === "string" ? x.secao : null }))
    .filter((x) => x.antes.trim())
    .slice(0, 10);
}
