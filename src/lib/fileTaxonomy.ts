/**
 * A organização única dos arquivos - a mesma para equipe, admin e cliente.
 *
 * O problema: existiam TRÊS listas de pastas diferentes no sistema (tela da
 * equipe com 7, tela do cliente com 4, integração com 6). O cliente não via
 * pastas inteiras, e dentro de "Materiais gráficos" tudo era um monte só, sem
 * separar carrossel, post e story. Aqui fica a única definição do sistema.
 *
 * Como funciona, sem mexer em uma linha do banco:
 * - `files.folder` continua sendo a PASTA (os mesmos valores de sempre, para
 *   nenhum arquivo existente mudar de lugar), com duas novas: identidade e base.
 * - `files.file_type` passa a ser o TIPO dentro da pasta (carrossel, post,
 *   story, video...), que é o que faltava para separar material gráfico.
 *
 * Regra de ouro: nada é apagado nem escondido. Arquivo antigo sem tipo é
 * classificado sozinho pelo nome; na dúvida vai para "Outros", sempre visível.
 */

export type FolderId =
  | "materiais"
  | "criativos"
  | "identidade"
  | "base"
  | "entregas"
  | "estrategicos"
  | "operacionais"
  | "relatorios"
  | "contratos";

export type FileKindId =
  | "carrossel"
  | "post"
  | "story"
  | "video"
  | "logo"
  | "foto"
  | "documento"
  | "contrato"
  | "relatorio"
  | "estrategico"
  | "briefing"
  | "outro";

export interface FileKind {
  id: FileKindId;
  label: string;
}

export interface FolderDefinition {
  id: FolderId;
  label: string;
  /** Explicação curta, em linguagem de cliente: o que entra aqui. */
  hint: string;
  /** Tipos oferecidos no filtro e no upload desta pasta. */
  kinds: FileKindId[];
  /** Tipo sugerido quando a pessoa sobe um arquivo nesta pasta. */
  defaultKind: FileKindId;
  /** Aparece para o cliente? (contratos tem tela própria) */
  clientVisible: boolean;
}

export const FILE_KINDS: Record<FileKindId, FileKind> = {
  carrossel: { id: "carrossel", label: "Carrossel" },
  post: { id: "post", label: "Post" },
  story: { id: "story", label: "Story" },
  video: { id: "video", label: "Vídeo e Reels" },
  logo: { id: "logo", label: "Logo e marca" },
  foto: { id: "foto", label: "Fotos" },
  documento: { id: "documento", label: "Documento" },
  contrato: { id: "contrato", label: "Contrato" },
  relatorio: { id: "relatorio", label: "Relatório" },
  estrategico: { id: "estrategico", label: "Estratégico" },
  briefing: { id: "briefing", label: "Briefing" },
  outro: { id: "outro", label: "Outros" },
};

const GRAPHIC_KINDS: FileKindId[] = ["carrossel", "post", "story", "video", "outro"];

export const FILE_FOLDER_DEFINITIONS: FolderDefinition[] = [
  {
    id: "materiais",
    label: "Materiais gráficos",
    hint: "As artes produzidas para as suas redes.",
    kinds: GRAPHIC_KINDS,
    defaultKind: "post",
    clientVisible: true,
  },
  {
    id: "criativos",
    label: "Criativos de anúncio",
    hint: "As peças que vão para os anúncios pagos.",
    kinds: GRAPHIC_KINDS,
    defaultKind: "post",
    clientVisible: true,
  },
  {
    id: "identidade",
    label: "Identidade visual",
    hint: "Logo, cores, fontes e o manual da marca.",
    kinds: ["logo", "documento", "foto", "outro"],
    defaultKind: "logo",
    clientVisible: true,
  },
  {
    id: "base",
    label: "Base do cliente",
    hint: "O material bruto que você nos envia: fotos, vídeos e produtos.",
    kinds: ["foto", "video", "documento", "outro"],
    defaultKind: "foto",
    clientVisible: true,
  },
  {
    id: "entregas",
    label: "Entregas",
    hint: "O que já foi finalizado e entregue.",
    kinds: ["carrossel", "post", "story", "video", "documento", "outro"],
    defaultKind: "outro",
    clientVisible: true,
  },
  {
    id: "estrategicos",
    label: "Documentos estratégicos",
    hint: "Onde queremos chegar: planejamento, público e linha de conteúdo.",
    kinds: ["estrategico", "documento", "outro"],
    defaultKind: "estrategico",
    clientVisible: true,
  },
  {
    id: "operacionais",
    label: "Documentos operacionais",
    hint: "O dia a dia do trabalho: briefings, acessos e processos.",
    kinds: ["briefing", "documento", "outro"],
    defaultKind: "documento",
    clientVisible: true,
  },
  {
    id: "relatorios",
    label: "Relatórios",
    hint: "Os números do trabalho, período a período.",
    kinds: ["relatorio", "documento"],
    defaultKind: "relatorio",
    clientVisible: true,
  },
  {
    id: "contratos",
    label: "Contratos e propostas",
    hint: "Contratos, propostas e documentos assinados.",
    kinds: ["contrato", "documento"],
    defaultKind: "contrato",
    clientVisible: true,
  },
];

export const DEFAULT_FOLDER: FolderId = "materiais";

const FOLDER_BY_ID = new Map<string, FolderDefinition>(
  FILE_FOLDER_DEFINITIONS.map((folder) => [folder.id, folder]),
);

export function folderDefinition(folder: string | null | undefined): FolderDefinition {
  return FOLDER_BY_ID.get((folder || "").trim()) || FOLDER_BY_ID.get("estrategicos")!;
}

export function folderLabel(folder: string | null | undefined): string {
  return folderDefinition(folder).label;
}

export function clientFolders(): FolderDefinition[] {
  return FILE_FOLDER_DEFINITIONS.filter((folder) => folder.clientVisible);
}

function normalize(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Valores herdados de `file_type` viraram uma bagunça com o tempo: tem coisa em
 * inglês ("creative", "strategic"), tem acento, tem termo antigo. Aqui tudo é
 * traduzido para o mesmo vocabulário, sem precisar corrigir o banco.
 */
const KIND_ALIASES: [RegExp, FileKindId][] = [
  [/^carrossel|^carousel|^carrocel/, "carrossel"],
  [/^story|^stories|^storie/, "story"],
  [/^video|^reels?$|^reel|^v[ií]deo/, "video"],
  [/^post$|^feed/, "post"],
  [/^logo|^marca|^identidade|^brand/, "logo"],
  [/^foto|^imagem|^photo/, "foto"],
  [/^contrato|^contract|^proposta/, "contrato"],
  [/^relat[óo]rio|^report/, "relatorio"],
  [/^estrat[ée]gico|^strategic|^estrategia/, "estrategico"],
  [/^briefing|^brief/, "briefing"],
  [/^criativo|^creative|^ads?$|^anuncio/, "post"],
  [/^documento|^document|^doc$|^pdf/, "documento"],
];

function kindFromStoredType(rawType: string | null | undefined): FileKindId | null {
  const value = normalize(rawType).trim();
  if (!value) return null;
  if (value in FILE_KINDS) return value as FileKindId;
  for (const [pattern, kind] of KIND_ALIASES) {
    if (pattern.test(value)) return kind;
  }
  return null;
}

/** Leitura do nome do arquivo, para o material antigo que nunca recebeu tipo. */
function kindFromName(text: string): FileKindId | null {
  const value = normalize(text);
  if (!value.trim()) return null;
  const rules: [RegExp, FileKindId][] = [
    [/carrossel|carousel|carrocel|slide/, "carrossel"],
    [/\bstor(y|ies)\b|storie/, "story"],
    [/reels?\b|\btiktok\b|\.mp4|\.mov|\bvsl\b|\bcorte\b/, "video"],
    [/\bpost\b|\bfeed\b|publicacao/, "post"],
    [/\blogo|logotipo|manual da marca|brandbook|identidade visual/, "logo"],
    [/contrato|proposta|aditivo|assinad/, "contrato"],
    [/relatorio|report|resultado do mes|metricas/, "relatorio"],
    [/briefing|\bbrief\b|roteiro/, "briefing"],
    [/planejamento|estrategia|diagnostico|persona|posicionamento/, "estrategico"],
    // Só palavra escrita: extensão de imagem sozinha não diz nada, toda arte é
    // .png e viraria "foto do cliente" por engano.
    [/\bfotos?\b|ensaio|banco de imagen|material bruto/, "foto"],
  ];
  for (const [pattern, kind] of rules) {
    if (pattern.test(value)) return kind;
  }
  return null;
}

export interface ClassifiableFile {
  file_name?: string | null;
  file_type?: string | null;
  folder?: string | null;
  mime_type?: string | null;
  description?: string | null;
  carousel_text?: string | null;
  parent_file_id?: string | null;
}

/** A pasta do arquivo. Nunca inventa: só completa quem está sem pasta. */
export function resolveFolder(file: ClassifiableFile): FolderId {
  const stored = normalize(file.folder).trim();
  if (FOLDER_BY_ID.has(stored)) return stored as FolderId;

  const kind = resolveKind(file);
  if (kind === "contrato") return "contratos";
  if (kind === "relatorio") return "relatorios";
  if (kind === "estrategico") return "estrategicos";
  if (kind === "briefing") return "operacionais";
  if (kind === "logo") return "identidade";
  if (kind === "foto") return "base";
  if (kind === "carrossel" || kind === "post" || kind === "story" || kind === "video") {
    return "materiais";
  }
  return "estrategicos";
}

/** O tipo do arquivo dentro da pasta. */
export function resolveKind(file: ClassifiableFile): FileKindId {
  const stored = kindFromStoredType(file.file_type);
  // "documento" e "outro" são genéricos demais: se o nome disser algo melhor,
  // o nome ganha. Assim carrossel antigo salvo como "criativo" é reconhecido.
  if (stored && stored !== "documento" && stored !== "outro") return stored;

  if (file.carousel_text || file.parent_file_id) return "carrossel";

  const guessed =
    kindFromName(file.file_name || "") || kindFromName(file.description || "");
  if (guessed) return guessed;

  if (stored) return stored;

  const mime = normalize(file.mime_type);
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "post";
  if (mime.includes("pdf") || mime.includes("word") || mime.includes("presentation")) {
    return "documento";
  }
  return "outro";
}

export function kindLabel(kind: FileKindId): string {
  return FILE_KINDS[kind]?.label || FILE_KINDS.outro.label;
}

/** Rótulo pronto para a tela: "Materiais gráficos · Carrossel". */
export function fileLocationLabel(file: ClassifiableFile): string {
  return `${folderLabel(resolveFolder(file))} · ${kindLabel(resolveKind(file))}`;
}

export interface FolderSummary {
  folder: FolderDefinition;
  total: number;
  byKind: { kind: FileKind; total: number }[];
}

/**
 * Quantos arquivos em cada pasta e, dentro dela, de cada tipo. É o que alimenta
 * os filtros do topo: a pessoa já vê o que tem antes de clicar.
 */
export function summarizeFiles(files: ClassifiableFile[]): FolderSummary[] {
  const totals = new Map<FolderId, Map<FileKindId, number>>();
  for (const file of files) {
    const folder = resolveFolder(file);
    const kind = resolveKind(file);
    if (!totals.has(folder)) totals.set(folder, new Map());
    const byKind = totals.get(folder)!;
    byKind.set(kind, (byKind.get(kind) || 0) + 1);
  }

  return FILE_FOLDER_DEFINITIONS.map((folder) => {
    const byKind = totals.get(folder.id) || new Map<FileKindId, number>();
    let total = 0;
    for (const value of byKind.values()) total += value;
    // Mostra os tipos previstos da pasta e também qualquer tipo real que tenha
    // aparecido nela, para nenhum arquivo ficar sem filtro que o alcance.
    const kindIds = [...new Set<FileKindId>([...folder.kinds, ...byKind.keys()])];
    return {
      folder,
      total,
      byKind: kindIds
        .map((kind) => ({ kind: FILE_KINDS[kind], total: byKind.get(kind) || 0 }))
        .filter((entry) => entry.kind && entry.total > 0),
    };
  });
}

export function matchesFolderFilter(
  file: ClassifiableFile,
  folderId: FolderId | "todos",
  kindId?: FileKindId | null,
): boolean {
  if (folderId !== "todos" && resolveFolder(file) !== folderId) return false;
  if (kindId && resolveKind(file) !== kindId) return false;
  return true;
}
