/**
 * "Organizar tudo" do workspace do cliente por tipo de arquivo (frente C).
 * Pedido do dono: "às vezes eu quero organizar os arquivos bagunçados".
 *
 * Sem IA: olha o nome e a extensão de cada arquivo solto (na raiz ou numa
 * pasta genérica como "Nova pasta") e propõe mover para a pasta do tipo
 * (Marca, Fotos, Vídeos, Documentos, Planilhas, Apresentações, Artes
 * editáveis, Áudios). A pasta que já existe na raiz com esse nome é
 * reaproveitada; a que falta nasce na hora ("nova: Fotos").
 *
 * Sai no mesmo formato que o modelo devolve em `acoes`, para passar pela
 * mesma normalização (normalizarAcoesDoContexto): as travas do workspace
 * valem igual e nada é apagado. Arquivo dentro de pasta com nome próprio,
 * na pasta que recebe arquivos do cliente ou em Arquivados fica onde está.
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import { alvosDoWorkspace, type NoDoWorkspace, PASTA_DE_ARQUIVADOS } from "../_shared/acoes-do-workspace.ts";

export const PASTAS_POR_TIPO: Array<{ pasta: string; nome?: RegExp; extensao?: RegExp }> = [
  { pasta: "Marca", nome: /(logo|marca|brand|manual|identidade|paleta)/i },
  { pasta: "Fotos", extensao: /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i },
  { pasta: "Vídeos", extensao: /\.(mp4|mov|avi|mkv|webm|m4v)$/i },
  { pasta: "Documentos", extensao: /\.(pdf|docx?|txt|odt|rtf|md)$/i },
  { pasta: "Planilhas", extensao: /\.(xlsx?|csv|ods)$/i },
  { pasta: "Apresentações", extensao: /\.(pptx?|key|odp)$/i },
  { pasta: "Artes editáveis", extensao: /\.(psd|ai|fig|svg|eps|indd|cdr|xd|sketch)$/i },
  { pasta: "Áudios", extensao: /\.(mp3|wav|m4a|ogg|aac|flac)$/i },
];

/** Pasta de nome genérico: o que está nela conta como solto. */
const PASTA_GENERICA = /^(nova pasta|nova pasta \(\d+\)|sem t[ií]tulo|sem nome|novos?|uploads?|diversos|bagun[cç]a|outros|geral|temp|tmp)$/i;

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Pasta de destino pelo nome do arquivo (marca vence a extensão); null quando não dá para saber. */
export function pastaDoTipo(nome: string): string | null {
  const marca = PASTAS_POR_TIPO[0];
  if (marca.nome && marca.nome.test(nome) && /\.(jpe?g|png|webp|svg|pdf|ai|eps|psd)$/i.test(nome)) return marca.pasta;
  for (const t of PASTAS_POR_TIPO) if (t.extensao && t.extensao.test(nome)) return t.pasta;
  return null;
}

export type ProjetoDeOrganizacao = { resumo: string; itens: Array<{ operacao: "mover"; ref: string; para: string }>; porPasta: Record<string, number> };

/** Os movimentos propostos (ainda com apelidos w#), no formato do campo `acoes`. */
export function organizarPorTipo(nos: NoDoWorkspace[]): ProjetoDeOrganizacao {
  const alvos = alvosDoWorkspace(nos, 150);
  const pastasNaRaiz = new Map<string, string>();
  for (const a of alvos) if (a.dados.kind === "folder" && !a.dados.parent_id) pastasNaRaiz.set(semAcento(a.titulo), a.ref);
  const inbox = alvos.filter((a) => a.dados.inbox).map((a) => (a.dados.caminho ? `${a.dados.caminho} / ${a.titulo}` : a.titulo));
  const itens: ProjetoDeOrganizacao["itens"] = [];
  const porPasta: Record<string, number> = {};
  for (const a of alvos) {
    if (a.dados.kind === "folder") continue;
    const caminho = a.dados.caminho;
    const topo = caminho.split(" / ")[0] || "";
    if (topo === PASTA_DE_ARQUIVADOS) continue;
    if (inbox.some((c) => caminho === c || caminho.indexOf(`${c} / `) === 0)) continue;
    // Solto: na raiz ou direto numa pasta genérica da raiz.
    const solto = !caminho || (caminho.indexOf(" / ") < 0 && PASTA_GENERICA.test(caminho));
    if (!solto) continue;
    const pasta = pastaDoTipo(a.titulo);
    if (!pasta) continue;
    if (caminho && semAcento(caminho) === semAcento(pasta)) continue;
    const existente = pastasNaRaiz.get(semAcento(pasta));
    itens.push({ operacao: "mover", ref: a.ref, para: existente || `nova: ${pasta}` });
    porPasta[pasta] = (porPasta[pasta] || 0) + 1;
  }
  const partes = Object.keys(porPasta).map((p) => `${porPasta[p]} para ${p}`);
  return { resumo: itens.length ? `Organizar os arquivos soltos por tipo: ${partes.join(", ")}.` : "Nada solto para organizar por tipo.", itens, porPasta };
}
