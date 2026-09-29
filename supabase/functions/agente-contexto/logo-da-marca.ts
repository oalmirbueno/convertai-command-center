/**
 * Logo da marca achada no que já existe (frente MC, 29/09).
 *
 * Dono: "no CME aparece 'tem que procurar a logo' sabendo que a logo já está
 * ali". A logo da CME estava no Workspace, na pasta "CME - Conselho da Mulher
 * Empresaria / CME Logo", com o nome "ChatGPT Image ...png": o antigo
 * candidatosALogo só olhava "logo" no NOME do arquivo e nunca a achava.
 *
 * Aqui a busca olha o caminho inteiro (pastas + nome) e o projeto do arquivo:
 * - candidato = imagem (PNG, JPG, WEBP) com "logo" no caminho;
 * - de outra marca (projeto de outra marca, ou caminho que cita outra marca e
 *   não esta) nunca entra;
 * - para a marca que não é a principal, só entra o que é dela (projeto dela
 *   ou caminho que cita o nome dela);
 * - um candidato só: é ele. Mais de um: o Jev escolhe (Choice com "nenhum");
 *   confiança baixa volta sem escolha e a tela mostra a lista.
 *
 * Sem import de Deno no topo das regras puras: o vitest lê este arquivo.
 */

import { projetoDaMarcaAberta, type MarcaComProjeto } from "../_shared/heranca-da-marca.ts";

export type NoDoWorkspaceLeve = { id: string; parent_id: string | null; name: string; kind: string; mime: string | null };
export type ArquivoLeve = { id: string; file_name: string; folder: string | null; mime_type: string | null; project_id: string | null };
export type MarcaParaLogo = MarcaComProjeto & { nome: string };

export type CandidatoDaMarca = {
  origem: "arquivo" | "workspace";
  id: string;
  nome: string;
  /** Pastas e nome, como a equipe vê ("CME - Conselho... / CME Logo / arquivo.png"). */
  caminho: string;
  /** O caminho cita o nome desta marca. */
  cita_a_marca: boolean;
  /** Arquivo do projeto da marca. */
  do_projeto: boolean;
};

const IMAGEM_MIME = /^image\/(png|jpe?g|webp)$/i;
const IMAGEM_NOME = /\.(png|jpe?g|webp)$/i;

/** Minúsculo e sem acento, para comparar nomes de pasta. */
export function normalizarTexto(v: string): string {
  return String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** O texto cita o nome (palavra inteira, sem acento): "CME Logo" cita "CME"; "acmeria" não. */
export function citaNome(texto: string, nome: string): boolean {
  const t = ` ${normalizarTexto(texto).replace(/[^a-z0-9]+/g, " ")} `;
  const n = normalizarTexto(nome).replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return false;
  return t.indexOf(` ${n} `) >= 0;
}

const temLogo = (texto: string) => /logo|logotipo|logomarca/.test(normalizarTexto(texto));
const ehImagem = (mime: string | null, nome: string) => IMAGEM_MIME.test(mime || "") || (!mime && IMAGEM_NOME.test(nome)) || IMAGEM_NOME.test(nome);

/** Caminho de cada nó (pastas até a raiz + nome). */
export function caminhosDosNos(nos: NoDoWorkspaceLeve[]): Record<string, string> {
  const porId: Record<string, NoDoWorkspaceLeve> = {};
  for (const n of nos) porId[n.id] = n;
  const saida: Record<string, string> = {};
  for (const n of nos) {
    const partes: string[] = [];
    let atual: NoDoWorkspaceLeve | undefined = n;
    let passos = 0;
    while (atual && passos < 20) {
      partes.unshift(atual.name);
      atual = atual.parent_id ? porId[atual.parent_id] : undefined;
      passos += 1;
    }
    saida[n.id] = partes.join(" / ");
  }
  return saida;
}

/**
 * Candidatos a logo da marca (regras no topo do arquivo). Sem marca: todos
 * os de "logo" no caminho. Ordem: os do projeto e os que citam a marca
 * primeiro.
 */
export function candidatosDaMarca(
  arquivos: ArquivoLeve[],
  nos: NoDoWorkspaceLeve[],
  marca: MarcaParaLogo | null,
  marcas: MarcaParaLogo[],
): CandidatoDaMarca[] {
  const outras = marca ? marcas.filter((m) => m.id !== marca.id) : [];
  const deOutra = (caminho: string) => outras.some((m) => citaNome(caminho, m.nome));
  const saida: CandidatoDaMarca[] = [];

  for (const f of arquivos) {
    const caminho = [f.folder || "", f.file_name].filter(Boolean).join(" / ");
    if (!ehImagem(f.mime_type, f.file_name) || !temLogo(caminho)) continue;
    if (/svg/i.test(f.mime_type || "") || /\.svg$/i.test(f.file_name)) continue;
    if (marca && !projetoDaMarcaAberta(f.project_id, marca, marcas)) continue;
    const cita = marca ? citaNome(caminho, marca.nome) : false;
    const doProjeto = !!marca && !!marca.project_id && f.project_id === marca.project_id;
    if (marca && !marca.principal && !doProjeto && !cita) continue;
    if (marca && deOutra(caminho) && !cita) continue;
    saida.push({ origem: "arquivo", id: f.id, nome: f.file_name, caminho, cita_a_marca: cita, do_projeto: doProjeto });
  }

  const caminhos = caminhosDosNos(nos);
  for (const n of nos) {
    if (n.kind !== "file") continue;
    const caminho = caminhos[n.id] || n.name;
    if (!ehImagem(n.mime, n.name) || !temLogo(caminho)) continue;
    const cita = marca ? citaNome(caminho, marca.nome) : false;
    if (marca && !marca.principal && !cita) continue;
    if (marca && deOutra(caminho) && !cita) continue;
    saida.push({ origem: "workspace", id: n.id, nome: n.name, caminho, cita_a_marca: cita, do_projeto: false });
  }

  const peso = (c: CandidatoDaMarca) => (c.cita_a_marca ? 2 : 0) + (c.do_projeto ? 1 : 0);
  return saida.sort((a, b) => peso(b) - peso(a)).slice(0, 12);
}

/** Pergunta do Jev: qual dos candidatos é a logo oficial desta marca (ou nenhum). */
export function perguntaDaLogo(marca: MarcaParaLogo, outras: string[], candidatos: CandidatoDaMarca[]) {
  const criteria: Record<string, string> = {};
  candidatos.forEach((c, i) => {
    criteria[`c${i + 1}`] = `O arquivo em \`candidatos[${i}]\` (${c.caminho}) é a logo oficial da marca ${marca.nome}.`;
  });
  criteria.nenhum = `Nenhum dos arquivos é a logo oficial da marca ${marca.nome} (são artes, fotos, a logo de outra marca ou só parecido).`;
  return {
    state: {
      marca: marca.nome,
      outras_marcas_do_mesmo_cliente: outras,
      candidatos: candidatos.map((c) => ({ caminho: c.caminho, origem: c.origem === "arquivo" ? "Arquivos do painel" : "Workspace", do_projeto_da_marca: c.do_projeto })),
    },
    questions: {
      logo: {
        type: "choice" as const,
        instructions:
          "Pelo caminho das pastas e pelo nome, qual arquivo é a logo oficial desta marca? Pasta chamada 'Logo' com o nome da marca é forte sinal. Arte de post, foto, carrossel ou a logo de outra marca não contam.",
        criteria,
      },
    },
  };
}

/** Lê a resposta do Jev: o candidato escolhido, só com confiança suficiente. */
export function escolhaDaLogo(candidatos: CandidatoDaMarca[], resposta: { choice?: string; confidence?: number } | undefined, minimo = 0.5): CandidatoDaMarca | null {
  if (!resposta || typeof resposta.choice !== "string" || resposta.choice === "nenhum") return null;
  if (typeof resposta.confidence === "number" && resposta.confidence < minimo) return null;
  const n = Number(resposta.choice.replace(/^c/, ""));
  return Number.isInteger(n) && n >= 1 && n <= candidatos.length ? candidatos[n - 1] : null;
}
