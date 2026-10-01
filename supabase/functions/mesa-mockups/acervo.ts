/**
 * acervo_guardar da mesa-mockups, em função pura (frente MCK, rodada 2): o mockup já enviado para
 * Arquivos entra no acervo de imagens do cliente (cliente_imagens). O banco entra por uma interface
 * pequena, para o teste exercitar as regras sem Supabase:
 * - arquivo de outro cliente (ou que não existe) = 404;
 * - arquivo que não é mockup do estúdio (sem a etiqueta "mockup") = 400;
 * - marca de outro cliente = 400;
 * - o mesmo arquivo não entra duas vezes (segunda chamada = ja_existia), nem na corrida em que o
 *   índice único segura a segunda inserção;
 * - etiqueta da marca (marca:<id>) só para a marca que NÃO é a principal, como no resto do sistema
 *   (ContextoImagens e o gatilho cliente_imagens_etiqueta_da_marca): a principal fica sem etiqueta.
 * Sem import de npm: o vitest importa este arquivo direto.
 */
import { etiquetaDaMarca } from "../_shared/heranca-da-marca.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ArquivoDoAcervo {
  id: string;
  client_id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  file_name: string | null;
  tags: unknown;
}

export interface MarcaDoAcervo {
  id: string;
  client_id: string;
  principal: boolean | null;
}

/** O que a regra precisa do banco (a função passa a chave de serviço; o teste, um falso). */
export interface BancoDoAcervo {
  /** null = não existe; lança quando o banco falha. */
  lerArquivo(fileId: string): Promise<ArquivoDoAcervo | null>;
  lerMarca(marcaId: string): Promise<MarcaDoAcervo | null>;
  /** id da imagem que já aponta para este arquivo, ou null. */
  acharImagem(clientId: string, fileId: string): Promise<string | null>;
  /** Insere e devolve o id; lança quando o banco recusa (ex.: índice único na corrida). */
  inserirImagem(linha: Record<string, unknown>): Promise<string>;
}

export class ErroDoAcervo extends Error {
  status: number;
  codigo: string;
  causa: unknown;
  constructor(status: number, codigo: string, mensagem: string, causa: unknown = null) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.causa = causa;
  }
}

export interface PedidoDoAcervo {
  clientId: string;
  fileId: unknown;
  marcaId?: unknown;
  nome?: unknown;
}

export interface ResultadoDoAcervo {
  imagem_id: string;
  ja_existia: boolean;
}

export async function guardarMockupNoAcervo(banco: BancoDoAcervo, p: PedidoDoAcervo): Promise<ResultadoDoAcervo> {
  const fileId = String(p.fileId ?? "");
  if (!UUID.test(fileId)) throw new ErroDoAcervo(400, "file_id_invalido", "file_id precisa ser um UUID.");
  let arq: ArquivoDoAcervo | null;
  try {
    arq = await banco.lerArquivo(fileId);
  } catch (e) {
    throw new ErroDoAcervo(503, "arquivo_indisponivel", "Não foi possível ler o arquivo agora.", e);
  }
  if (!arq || arq.client_id !== p.clientId || !arq.storage_path) throw new ErroDoAcervo(404, "arquivo_de_outro_cliente", "Arquivo não encontrado neste cliente.");
  const tags = Array.isArray(arq.tags) ? (arq.tags as unknown[]).map(String) : [];
  if (tags.indexOf("mockup") < 0) throw new ErroDoAcervo(400, "nao_e_mockup", "Só mockups do estúdio entram no acervo por aqui.");

  let marcaTag: string | null = null;
  if (typeof p.marcaId === "string" && p.marcaId) {
    if (!UUID.test(p.marcaId)) throw new ErroDoAcervo(400, "marca_invalida", "marca_id precisa ser um UUID.");
    const marca = await banco.lerMarca(p.marcaId);
    if (!marca || marca.client_id !== p.clientId) throw new ErroDoAcervo(400, "marca_de_outro_cliente", "Esta marca não é deste cliente.");
    // A principal fica sem etiqueta (é onde o acervo sempre esteve); outra marca leva marca:<id>.
    if (!marca.principal) marcaTag = etiquetaDaMarca(marca.id);
  }

  const ja = await banco.acharImagem(p.clientId, fileId);
  if (ja) return { imagem_id: ja, ja_existia: true };
  const nome = (typeof p.nome === "string" && p.nome.trim() ? p.nome.trim() : String(arq.file_name || "Mockup")).slice(0, 160);
  try {
    const id = await banco.inserirImagem({
      client_id: p.clientId,
      origem: "arquivo",
      file_id: fileId,
      storage_bucket: arq.storage_bucket || "files",
      storage_path: arq.storage_path,
      nome,
      pasta: "Identidade / Mockups",
      categoria: "mockup",
      tags: ["mockup", "mesa_identidade", "gerada"].concat(marcaTag ? [marcaTag] : []),
      descricao: "Mockup da identidade visual montado no estúdio de mockups (a logo entrou pelo código).",
      gerada: true,
      aprovada: false,
    });
    return { imagem_id: id, ja_existia: false };
  } catch (e) {
    // Corrida com outro envio do mesmo arquivo: o índice único segura, e vale o que já entrou.
    const outro = await banco.acharImagem(p.clientId, fileId).catch(() => null);
    if (outro) return { imagem_id: outro, ja_existia: true };
    throw new ErroDoAcervo(503, "acervo_indisponivel", "O mockup não entrou no acervo agora. Tente de novo.", e);
  }
}
