/**
 * Editor de código no navegador (Gravyx, 19/10/2026: "Arquivos da página"):
 * a equipe abre os arquivos do site, edita e salva. Salvar vira um trabalho
 * do motor sem IA (tipo "textos", o mesmo da troca de texto no código): o
 * worker escreve no RASCUNHO, recompila e confere no computador e no celular.
 * O rascunho segue o Salvar versão e o Descartar de sempre (RascunhoDoSite).
 *
 * Regras puras que a tela, a função mesa-site e o worker dividem:
 * - caminho seguro e arquivo de texto;
 * - arquivos protegidos: o que o motor gera (.aceleriq/, marca.css), a casca
 *   da casa (o worker repõe), dependências e locks, .env e chave;
 * - limites por arquivo, por vez e no total;
 * - nada de segredo no conteúdo;
 * - trava de concorrência: cada arquivo leva o sha256 de quando foi lido; se
 *   o arquivo mudou no projeto (o motor ou outra edição), o worker recusa
 *   ("o arquivo mudou em outra edição") e nada é escrito.
 *
 * Puro: sem Deno, sem npm e sem banco. Sem lookbehind, classe de propriedade Unicode ou grupo nomeado.
 */
import { ehTexto, normalizarCaminho, segredoNoTexto, segredoPeloNome } from "./importacao-do-site.ts";

export const LIMITES_DO_EDITOR = {
  /** Arquivo que abre no editor (maior que isso, só leitura). */
  arquivoBytes: 400 * 1024,
  /** Arquivos num Salvar. */
  porVez: 20,
  /** Soma do que vai num Salvar (vai no pedido do trabalho). */
  totalBytes: 1024 * 1024,
} as const;

export type ArquivoEditado = { caminho: string; conteudo: string; sha_antes: string | null };
export type EdicaoDeCodigo = { arquivos: ArquivoEditado[]; de: string | null };

/** Fora do editor sempre (o motor gera, instala ou guarda segredo). */
const SEMPRE_PROTEGIDO = /^(\.aceleriq\/|\.git\/|node_modules\/|dist\/|\.opencode\/|opencode\.jsonc?$|package\.json$|package-lock\.json$|npm-shrinkwrap\.json$|src\/marca\.css$|AGENTS\.md$)/;

const SHA = /^[0-9a-f]{64}$/;

const bytesDe = (s: string) => {
  // UTF-8 sem TextEncoder (Safari 11 tem, mas a função e o worker também usam isto): conta os bytes à mão.
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
};
export const tamanhoEmBytes = bytesDe;

/** Por que este arquivo não se edita aqui (null = edita). `casca` = os arquivos da casca da casa do projeto. */
export function motivoDeProtecao(caminho: string, casca: string[] = []): string | null {
  const c = normalizarCaminho(caminho);
  if (!c) return "caminho inseguro";
  if (SEMPRE_PROTEGIDO.test(c)) return "arquivo do motor (gerado, instalação ou configuração): peça ao diretor de site";
  if (segredoPeloNome(c)) return "arquivo de segredo: chave e senha nunca passam pelo painel";
  if (casca.indexOf(c) >= 0) return "casca da casa (o motor repõe o original): peça ao diretor de site";
  if (!ehTexto(c)) return "arquivo binário (imagem, fonte ou vídeo)";
  return null;
}

/** As regras do Salvar (tela, função e worker): recusa com o motivo, nada pela metade. */
/** O resultado do Salvar conferido (os dois lados com os mesmos campos: lê sem depender do modo estrito do tsc). */
export type ValidacaoDaEdicao = { ok: true; edicao: EdicaoDeCodigo; codigo?: undefined; motivo?: undefined } | { ok: false; codigo: string; motivo: string; edicao?: undefined };

export function validarEdicaoDeCodigo(bruto: unknown, casca: string[] = []): ValidacaoDaEdicao {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const lista = Array.isArray(o.arquivos) ? o.arquivos : [];
  if (!lista.length) return { ok: false, codigo: "nada_mudou", motivo: "Nenhum arquivo mudou." };
  if (lista.length > LIMITES_DO_EDITOR.porVez) return { ok: false, codigo: "arquivos_demais", motivo: `Até ${LIMITES_DO_EDITOR.porVez} arquivos por Salvar.` };
  const arquivos: ArquivoEditado[] = [];
  let total = 0;
  for (const x of lista) {
    const a = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const caminho = normalizarCaminho(a.caminho);
    if (!caminho) return { ok: false, codigo: "caminho_invalido", motivo: "Caminho de arquivo inseguro." };
    if (arquivos.some((y) => y.caminho === caminho)) return { ok: false, codigo: "repetido", motivo: `O arquivo ${caminho} veio duas vezes.` };
    const protegido = motivoDeProtecao(caminho, casca);
    if (protegido) return { ok: false, codigo: "protegido", motivo: `${caminho}: ${protegido}.` };
    if (typeof a.conteudo !== "string") return { ok: false, codigo: "conteudo_invalido", motivo: `${caminho}: o conteúdo precisa ser texto.` };
    const tam = bytesDe(a.conteudo);
    if (tam > LIMITES_DO_EDITOR.arquivoBytes) return { ok: false, codigo: "arquivo_grande", motivo: `${caminho} passa de ${Math.round(LIMITES_DO_EDITOR.arquivoBytes / 1024)} KB.` };
    total += tam;
    const segredo = segredoNoTexto(a.conteudo);
    if (segredo) return { ok: false, codigo: "segredo", motivo: `${caminho}: achei ${segredo}. Chave e senha nunca vão para o código do site.` };
    const sha = typeof a.sha_antes === "string" && SHA.test(a.sha_antes) ? a.sha_antes : null;
    if (a.sha_antes != null && !sha) return { ok: false, codigo: "sha_invalido", motivo: `${caminho}: a marca da leitura veio inválida. Abra o arquivo de novo.` };
    arquivos.push({ caminho, conteudo: a.conteudo, sha_antes: sha });
  }
  if (total > LIMITES_DO_EDITOR.totalBytes) return { ok: false, codigo: "grande_demais", motivo: `O Salvar passa de ${Math.round(LIMITES_DO_EDITOR.totalBytes / 1024)} KB. Salve em partes.` };
  const de = typeof o.de === "string" && /^[0-9a-f]{7,40}$/i.test(o.de) ? o.de : null;
  return { ok: true, edicao: { arquivos, de } };
}

/** A instrução do trabalho (aparece na lista do motor). */
export function instrucaoDaEdicao(e: EdicaoDeCodigo): string {
  const nomes = e.arquivos.map((a) => a.caminho);
  return `Editar o código: ${nomes.slice(0, 4).join(", ")}${nomes.length > 4 ? ` e mais ${nomes.length - 4}` : ""}`.slice(0, 300);
}

/** Um arquivo na hora de escrever: o sha256 de agora (null = não existe) contra o da leitura. */
export function conflitoDoArquivo(a: ArquivoEditado, shaAgora: string | null): string | null {
  if (a.sha_antes === null && shaAgora !== null) return `${a.caminho} já existe no projeto (alguém criou depois da leitura). Abra de novo.`;
  if (a.sha_antes !== null && shaAgora === null) return `${a.caminho} não existe mais no projeto. Abra de novo.`;
  if (a.sha_antes !== null && shaAgora !== a.sha_antes) return `${a.caminho} mudou em outra edição (o motor ou outra pessoa) depois que você abriu. Abra de novo e refaça a troca.`;
  return null;
}

// ------------------------------------------------------------------ árvore (a tela)

export type NoDaArvore = { nome: string; caminho: string; pasta: boolean; filhos: NoDaArvore[] };

/** A árvore dos caminhos (pastas primeiro, por nome). */
export function arvoreDosArquivos(caminhos: string[]): NoDaArvore[] {
  const raiz: NoDaArvore = { nome: "", caminho: "", pasta: true, filhos: [] };
  for (const c of caminhos) {
    const partes = c.split("/");
    let atual = raiz;
    for (let i = 0; i < partes.length; i++) {
      const pasta = i < partes.length - 1;
      const caminho = partes.slice(0, i + 1).join("/");
      let no = atual.filhos.find((f) => f.nome === partes[i] && f.pasta === pasta);
      if (!no) {
        no = { nome: partes[i], caminho, pasta, filhos: [] };
        atual.filhos.push(no);
      }
      atual = no;
    }
  }
  const ordenar = (nos: NoDaArvore[]) => {
    nos.sort((a, b) => (a.pasta === b.pasta ? a.nome.localeCompare(b.nome) : a.pasta ? -1 : 1));
    nos.forEach((n) => ordenar(n.filhos));
  };
  ordenar(raiz.filhos);
  return raiz.filhos;
}

export type AchadoNaBusca = { caminho: string; linha: number; trecho: string };

/** Buscar nos arquivos (sem regex: o que a pessoa digitou, sem diferença de maiúscula). Até 200 achados. */
export function buscarNosArquivos(arquivos: Array<{ caminho: string; conteudo: string }>, termo: string): AchadoNaBusca[] {
  const t = String(termo || "").toLowerCase();
  if (t.length < 2) return [];
  const achados: AchadoNaBusca[] = [];
  for (const a of arquivos) {
    const linhas = a.conteudo.split("\n");
    for (let i = 0; i < linhas.length; i++) {
      if (linhas[i].toLowerCase().indexOf(t) < 0) continue;
      achados.push({ caminho: a.caminho, linha: i + 1, trecho: linhas[i].trim().slice(0, 160) });
      if (achados.length >= 200) return achados;
    }
  }
  return achados;
}
