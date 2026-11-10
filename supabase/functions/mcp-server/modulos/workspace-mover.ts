/**
 * Mover entre "Em Arquivos" (public.files, bucket mcp-files) e pastas do
 * Workspace (public.workspace_nodes, bucket workspace).
 *
 * O painel antigo fazia PATCH em files.folder e dizia "Movido" mesmo quando
 * o destino era uma pasta de workspace_nodes. A listagem da pasta lê
 * parent_id, então o arquivo sumia da origem e não aparecia no destino.
 *
 * Ordem que não deixa órfão:
 * 1. copiar o blob para o bucket do destino;
 * 2. gravar a linha que a listagem do destino lê;
 * 3. só então tirar o arquivo da origem.
 * Se o passo 2 falha, o blob novo é apagado e a origem não muda.
 * Se o passo 3 falha, o destino fica gravado e a origem também: duplicado,
 * não órfão. Nesse caso não se diz "Movido".
 *
 * Puro: sem Deno, sem supabase. O painel e o MCP passam as portas.
 */

export const BUCKET_ARQUIVOS = "mcp-files";
export const BUCKET_WORKSPACE = "workspace";
export const PREFIXO_VIRTUAL = "virt:";
export const PREFIXO_PASTA_ARQUIVOS = "virt:folder:";

export class ErroDeMovimento extends Error {
  destinoGravado: boolean;
  constructor(message: string, destinoGravado = false) {
    super(message);
    this.name = "ErroDeMovimento";
    this.destinoGravado = destinoGravado;
  }
}

export type DestinoDoMovimento =
  | { tipo: "raiz" }
  | { tipo: "pasta_arquivos"; nome: string }
  | { tipo: "pasta_workspace"; id: string };

export function classificarDestino(targetParentId: string | null): DestinoDoMovimento {
  if (!targetParentId) return { tipo: "raiz" };
  if (targetParentId.startsWith(PREFIXO_PASTA_ARQUIVOS)) {
    const nome = targetParentId.slice(PREFIXO_PASTA_ARQUIVOS.length).trim();
    if (!nome || nome.length > 80) {
      throw new ErroDeMovimento("A pasta de Arquivos de destino não é válida.");
    }
    return { tipo: "pasta_arquivos", nome };
  }
  if (targetParentId.startsWith(PREFIXO_VIRTUAL)) {
    throw new ErroDeMovimento("Esse destino não é uma pasta.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetParentId)) {
    throw new ErroDeMovimento("A pasta de destino não é válida.");
  }
  return { tipo: "pasta_workspace", id: targetParentId };
}

export function extensaoDe(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  const ext = ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

/** Caminho estável: repetir o movimento não cria outro objeto. */
export function caminhoNoWorkspace(clientId: string, arquivoId: string, nome: string): string {
  return `client/${clientId}/de-arquivo-${arquivoId}.${extensaoDe(nome)}`;
}

export function caminhoEmArquivos(clientId: string, nodeId: string, nome: string): string {
  return `${clientId}/de-workspace-${nodeId}.${extensaoDe(nome)}`;
}

export type ArquivoDeOrigem = {
  id: string;
  client_id: string;
  file_name: string;
  folder: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  parent_file_id: string | null;
  tem_filhos: boolean;
};

export type NoDeWorkspace = {
  id: string;
  parent_id: string | null;
  scope: "global" | "client";
  client_id: string | null;
  kind: "folder" | "file";
  name: string;
  mime: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  sent_for_approval_file_id: string | null;
};

export type LinhaDeNo = {
  name: string;
  kind: "file";
  scope: "client";
  client_id: string;
  parent_id: string;
  mime: string | null;
  size_bytes: number | null;
  storage_path: string;
  created_by: string | null;
  sent_for_approval_file_id: string;
};

export type LinhaDeArquivo = {
  client_id: string;
  uploaded_by: string | null;
  file_name: string;
  file_url: string;
  file_type: string;
  folder: string;
  mime_type: string | null;
  extension: string | null;
  storage_bucket: typeof BUCKET_ARQUIVOS;
  storage_path: string;
  size_bytes: number;
  source: "workspace";
  idempotency_key: string;
  visibility: "internal";
};

export type PortasDoMovimento = {
  lerArquivo(id: string): Promise<ArquivoDeOrigem | null>;
  lerNo(id: string): Promise<NoDeWorkspace | null>;
  noDoArquivo(arquivoId: string): Promise<NoDeWorkspace | null>;
  copiar(deBucket: string, dePath: string, paraBucket: string, paraPath: string): Promise<void>;
  apagarBlob(bucket: string, path: string): Promise<void>;
  criarNo(linha: LinhaDeNo): Promise<{ id: string }>;
  moverNo(id: string, parentId: string | null): Promise<void>;
  apagarNo(id: string): Promise<void>;
  /** Só depois que o nó de destino existe. Apaga a linha ou a esconde da listagem. */
  retirarArquivo(arquivoId: string, destino: { bucket: string; path: string }): Promise<void>;
  definirPasta(arquivoId: string, pasta: string | null): Promise<void>;
  criarArquivo(linha: LinhaDeArquivo): Promise<{ id: string }>;
  definirPastaDoArquivo(arquivoId: string, pasta: string): Promise<void>;
};

export type PedidoDeMovimento = {
  virtual: boolean;
  kind: "folder" | "file";
  id: string;
  fileId: string | null;
  clientId: string | null;
  userId: string | null;
  scope: "global" | "client";
  nome: string;
  mime: string | null;
  sizeBytes: number | null;
  storagePath: string | null;
  targetParentId: string | null;
  parentIdAtual: string | null;
  ehDescendente(origemId: string, destinoId: string | null): boolean;
};

export type ResultadoDoMovimento = { mudou: boolean };

function mesmoPai(atual: string | null, destino: string | null): boolean {
  return (atual || null) === (destino || null);
}

async function apagarBlobSeMudou(
  portas: PortasDoMovimento,
  bucket: string | null,
  path: string | null,
  novoBucket: string,
  novoPath: string,
) {
  if (!bucket || !path) return;
  if (bucket === novoBucket && path === novoPath) return;
  try {
    await portas.apagarBlob(bucket, path);
  } catch {
    // O arquivo já está no destino. Blob antigo sem dono não volta a origem.
  }
}

export async function promoverArquivoParaPasta(
  arquivo: ArquivoDeOrigem,
  pasta: NoDeWorkspace,
  userId: string | null,
  portas: PortasDoMovimento,
): Promise<ResultadoDoMovimento> {
  if (arquivo.parent_file_id || arquivo.tem_filhos) {
    throw new ErroDeMovimento("Mova o arquivo raiz. Slides de carrossel acompanham o arquivo principal, e este lote não os separa.");
  }
  if (pasta.kind !== "folder" || pasta.scope !== "client" || !pasta.client_id) {
    throw new ErroDeMovimento("A pasta de destino não é uma pasta do Workspace deste cliente.");
  }
  if (arquivo.client_id !== pasta.client_id) {
    throw new ErroDeMovimento("O arquivo e a pasta são de clientes diferentes.");
  }
  if (!arquivo.storage_bucket || !arquivo.storage_path) {
    throw new ErroDeMovimento("Este arquivo não tem blob para copiar. Nada foi alterado.");
  }

  const existente = await portas.noDoArquivo(arquivo.id);
  const caminho = existente?.storage_path || caminhoNoWorkspace(arquivo.client_id, arquivo.id, arquivo.file_name);

  if (!existente) {
    await portas.copiar(arquivo.storage_bucket, arquivo.storage_path, BUCKET_WORKSPACE, caminho);
    try {
      await portas.criarNo({
        name: arquivo.file_name,
        kind: "file",
        scope: "client",
        client_id: arquivo.client_id,
        parent_id: pasta.id,
        mime: arquivo.mime_type,
        size_bytes: arquivo.size_bytes,
        storage_path: caminho,
        created_by: userId,
        sent_for_approval_file_id: arquivo.id,
      });
    } catch (erro) {
      await apagarBlobSeMudou(portas, BUCKET_WORKSPACE, caminho, arquivo.storage_bucket, arquivo.storage_path);
      throw erro instanceof ErroDeMovimento
        ? erro
        : new ErroDeMovimento(erro instanceof Error ? erro.message : "Não foi possível gravar o arquivo na pasta.");
    }
  } else if (existente.parent_id !== pasta.id) {
    await portas.moverNo(existente.id, pasta.id);
  }

  try {
    await portas.retirarArquivo(arquivo.id, { bucket: BUCKET_WORKSPACE, path: caminho });
  } catch (erro) {
    throw new ErroDeMovimento(
      erro instanceof Error ? erro.message : "O arquivo entrou na pasta, mas continua em Arquivos.",
      true,
    );
  }

  await apagarBlobSeMudou(portas, arquivo.storage_bucket, arquivo.storage_path, BUCKET_WORKSPACE, caminho);
  return { mudou: true };
}

export async function promoverNoParaArquivos(
  no: NoDeWorkspace,
  nomeDaPasta: string,
  userId: string | null,
  portas: PortasDoMovimento,
): Promise<ResultadoDoMovimento> {
  if (no.kind !== "file" || !no.storage_path || no.scope !== "client" || !no.client_id) {
    throw new ErroDeMovimento("Só um arquivo do Workspace do cliente pode ir para Em Arquivos.");
  }
  const pasta = nomeDaPasta.trim();
  if (!pasta) throw new ErroDeMovimento("A pasta de Arquivos de destino não é válida.");

  if (no.sent_for_approval_file_id) {
    await portas.definirPastaDoArquivo(no.sent_for_approval_file_id, pasta);
    try {
      await portas.apagarNo(no.id);
    } catch (erro) {
      throw new ErroDeMovimento(
        erro instanceof Error ? erro.message : "O arquivo foi para a pasta de Arquivos, mas continua no Workspace.",
        true,
      );
    }
    return { mudou: true };
  }

  const caminho = caminhoEmArquivos(no.client_id, no.id, no.name);
  await portas.copiar(BUCKET_WORKSPACE, no.storage_path, BUCKET_ARQUIVOS, caminho);
  try {
    await portas.criarArquivo({
      client_id: no.client_id,
      uploaded_by: userId,
      file_name: no.name,
      file_url: `${BUCKET_ARQUIVOS}://${caminho}`,
      file_type: no.mime && no.mime.indexOf("/") >= 0 ? no.mime : "outro",
      folder: pasta,
      mime_type: no.mime,
      extension: extensaoDe(no.name) === "bin" ? null : extensaoDe(no.name),
      storage_bucket: BUCKET_ARQUIVOS,
      storage_path: caminho,
      size_bytes: no.size_bytes || 0,
      source: "workspace",
      idempotency_key: `workspace-node:${no.id}`,
      visibility: "internal",
    });
  } catch (erro) {
    await apagarBlobSeMudou(portas, BUCKET_ARQUIVOS, caminho, BUCKET_WORKSPACE, no.storage_path);
    throw erro instanceof ErroDeMovimento
      ? erro
      : new ErroDeMovimento(erro instanceof Error ? erro.message : "Não foi possível gravar o arquivo em Arquivos.");
  }

  try {
    await portas.apagarNo(no.id);
  } catch (erro) {
    throw new ErroDeMovimento(
      erro instanceof Error ? erro.message : "O arquivo foi para a pasta de Arquivos, mas continua no Workspace.",
      true,
    );
  }
  await apagarBlobSeMudou(portas, BUCKET_WORKSPACE, no.storage_path, BUCKET_ARQUIVOS, caminho);
  return { mudou: true };
}

export async function executarMovimento(
  pedido: PedidoDeMovimento,
  portas: PortasDoMovimento,
): Promise<ResultadoDoMovimento> {
  const destino = classificarDestino(pedido.targetParentId);

  if (pedido.virtual) {
    if (pedido.kind !== "file" || !pedido.fileId) {
      throw new ErroDeMovimento("Pastas de Arquivos não podem ser movidas.");
    }
    if (destino.tipo === "pasta_arquivos") {
      await portas.definirPasta(pedido.fileId, destino.nome);
      return { mudou: true };
    }
    if (destino.tipo === "raiz") {
      await portas.definirPasta(pedido.fileId, null);
      return { mudou: true };
    }
    if (pedido.scope !== "client" || !pedido.clientId) {
      throw new ErroDeMovimento("Escolha o cliente antes de mover o arquivo.");
    }
    const arquivo = await portas.lerArquivo(pedido.fileId);
    if (!arquivo || arquivo.client_id !== pedido.clientId) {
      throw new ErroDeMovimento("O arquivo não está mais em Arquivos deste cliente.");
    }
    const pasta = await portas.lerNo(destino.id);
    if (!pasta) throw new ErroDeMovimento("A pasta de destino não existe mais.");
    return promoverArquivoParaPasta(arquivo, pasta, pedido.userId, portas);
  }

  if (destino.tipo === "pasta_arquivos") {
    if (pedido.kind !== "file") {
      throw new ErroDeMovimento("Só arquivos podem ir para Em Arquivos. Pastas do Workspace ficam no Workspace.");
    }
    const no = await portas.lerNo(pedido.id);
    if (!no) throw new ErroDeMovimento("O arquivo não está mais no Workspace.");
    return promoverNoParaArquivos(no, destino.nome, pedido.userId, portas);
  }

  const parentId = destino.tipo === "raiz" ? null : destino.id;
  if (pedido.kind === "folder" && pedido.ehDescendente(pedido.id, parentId)) {
    throw new ErroDeMovimento("Não pode mover uma pasta para dentro dela mesma.");
  }
  if (mesmoPai(pedido.parentIdAtual, parentId)) return { mudou: false };
  if (parentId) {
    const pasta = await portas.lerNo(parentId);
    if (!pasta || pasta.kind !== "folder") {
      throw new ErroDeMovimento("A pasta de destino não existe mais.");
    }
    if (pedido.scope === "client" && pasta.client_id !== pedido.clientId) {
      throw new ErroDeMovimento("A pasta de destino é de outro cliente.");
    }
  }
  await portas.moverNo(pedido.id, parentId);
  return { mudou: true };
}
