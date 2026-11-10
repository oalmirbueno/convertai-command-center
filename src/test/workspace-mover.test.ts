import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planejarPerfis } from "../../supabase/functions/mcp-server/modulos/perfis-gravar";
import {
  BUCKET_ARQUIVOS,
  BUCKET_WORKSPACE,
  ErroDeMovimento,
  caminhoNoWorkspace,
  classificarDestino,
  executarMovimento,
  type ArquivoDeOrigem,
  type NoDeWorkspace,
  type PortasDoMovimento,
} from "../../supabase/functions/mcp-server/modulos/workspace-mover";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const ARQUIVO = "399600b4-688f-491e-8a84-5609117de30d";
const PASTA = "23860082-ad44-4b32-a625-2ee99299a576";

function arquivo(parcial: Partial<ArquivoDeOrigem> = {}): ArquivoDeOrigem {
  return {
    id: ARQUIVO,
    client_id: CLIENTE,
    file_name: "REFERENCIA-ESTILO_NAO-PUBLICAR_vivideo-concorrentes-e-design_2026-11-09.md",
    folder: "materiais",
    storage_bucket: BUCKET_ARQUIVOS,
    storage_path: `${CLIENTE}/referencias/estilo.md`,
    mime_type: "text/markdown",
    size_bytes: 1200,
    parent_file_id: null,
    tem_filhos: false,
    ...parcial,
  };
}

function pasta(): NoDeWorkspace {
  return {
    id: PASTA,
    parent_id: null,
    scope: "client",
    client_id: CLIENTE,
    kind: "folder",
    name: "Referência de design Vivideo",
    mime: null,
    size_bytes: null,
    storage_path: null,
    sent_for_approval_file_id: null,
  };
}

function portas(opcoes: {
  arquivo?: ArquivoDeOrigem | null;
  nos?: NoDeWorkspace[];
  falharCriar?: boolean;
  falharRetirar?: boolean;
  falharCopiar?: boolean;
} = {}) {
  const chamadas: string[] = [];
  const nos = [...(opcoes.nos || [pasta()])];
  const base: PortasDoMovimento = {
    async lerArquivo(id) {
      chamadas.push(`lerArquivo:${id}`);
      const row = opcoes.arquivo === undefined ? arquivo() : opcoes.arquivo;
      return row && row.id === id ? row : null;
    },
    async lerNo(id) {
      chamadas.push(`lerNo:${id}`);
      return nos.find((n) => n.id === id) || null;
    },
    async noDoArquivo(arquivoId) {
      chamadas.push(`noDoArquivo:${arquivoId}`);
      return nos.find((n) => n.sent_for_approval_file_id === arquivoId) || null;
    },
    async copiar(deBucket, dePath, paraBucket, paraPath) {
      chamadas.push(`copiar:${deBucket}:${dePath}->${paraBucket}:${paraPath}`);
      if (opcoes.falharCopiar) throw new ErroDeMovimento("cópia falhou");
    },
    async apagarBlob(bucket, path) {
      chamadas.push(`apagarBlob:${bucket}:${path}`);
    },
    async criarNo(linha) {
      chamadas.push(`criarNo:${linha.parent_id}:${linha.storage_path}`);
      if (opcoes.falharCriar) throw new ErroDeMovimento("insert falhou");
      const criado: NoDeWorkspace = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        parent_id: linha.parent_id,
        scope: "client",
        client_id: linha.client_id,
        kind: "file",
        name: linha.name,
        mime: linha.mime,
        size_bytes: linha.size_bytes,
        storage_path: linha.storage_path,
        sent_for_approval_file_id: linha.sent_for_approval_file_id,
      };
      nos.push(criado);
      return { id: criado.id };
    },
    async moverNo(id, parentId) {
      chamadas.push(`moverNo:${id}:${parentId}`);
      const no = nos.find((n) => n.id === id);
      if (!no) throw new ErroDeMovimento("nó sumiu");
      no.parent_id = parentId;
    },
    async apagarNo(id) {
      chamadas.push(`apagarNo:${id}`);
      const i = nos.findIndex((n) => n.id === id);
      if (i < 0) throw new ErroDeMovimento("nó sumiu");
      nos.splice(i, 1);
    },
    async retirarArquivo(arquivoId, destino) {
      chamadas.push(`retirarArquivo:${arquivoId}:${destino.bucket}:${destino.path}`);
      if (opcoes.falharRetirar) throw new ErroDeMovimento("origem presa");
    },
    async definirPasta(arquivoId, nome) {
      chamadas.push(`definirPasta:${arquivoId}:${nome}`);
    },
    async criarArquivo(linha) {
      chamadas.push(`criarArquivo:${linha.folder}:${linha.storage_path}`);
      return { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    },
    async definirPastaDoArquivo(arquivoId, nome) {
      chamadas.push(`definirPastaDoArquivo:${arquivoId}:${nome}`);
    },
  };
  return { chamadas, nos, portas: base };
}

const pedidoVirtual = {
  virtual: true,
  kind: "file" as const,
  id: `virt:file:${ARQUIVO}`,
  fileId: ARQUIVO,
  clientId: CLIENTE,
  userId: "22222222-2222-4222-8222-222222222222",
  scope: "client" as const,
  nome: arquivo().file_name,
  mime: "text/markdown",
  sizeBytes: 1200,
  storagePath: null,
  targetParentId: PASTA,
  parentIdAtual: null,
  ehDescendente: () => false,
};

describe("mover de Em Arquivos para uma pasta do Workspace", () => {
  it("copia o blob, grava o nó e só então tira o arquivo da origem", async () => {
    const ctx = portas();
    const r = await executarMovimento(pedidoVirtual, ctx.portas);
    expect(r.mudou).toBe(true);
    const copia = ctx.chamadas.findIndex((c) => c.startsWith("copiar:"));
    const cria = ctx.chamadas.findIndex((c) => c.startsWith("criarNo:"));
    const retira = ctx.chamadas.findIndex((c) => c.startsWith("retirarArquivo:"));
    expect(copia).toBeGreaterThanOrEqual(0);
    expect(cria).toBeGreaterThan(copia);
    expect(retira).toBeGreaterThan(cria);
    expect(ctx.chamadas[copia]).toContain(caminhoNoWorkspace(CLIENTE, ARQUIVO, arquivo().file_name));
    expect(ctx.chamadas[copia]).toContain(`${BUCKET_ARQUIVOS}:`);
    expect(ctx.chamadas[copia]).toContain(`->${BUCKET_WORKSPACE}:`);
    expect(ctx.chamadas.some((c) => c.startsWith("definirPasta:"))).toBe(false);
  });

  it("não diz que moveu e não mexe na origem se a pasta não gravou o nó", async () => {
    const ctx = portas({ falharCriar: true });
    await expect(executarMovimento(pedidoVirtual, ctx.portas)).rejects.toMatchObject({ destinoGravado: false });
    expect(ctx.chamadas.some((c) => c.startsWith("retirarArquivo:"))).toBe(false);
    expect(ctx.chamadas.some((c) => c.startsWith("apagarBlob:workspace:"))).toBe(true);
    expect(ctx.chamadas.some((c) => c.startsWith(`apagarBlob:${BUCKET_ARQUIVOS}:`))).toBe(false);
  });

  it("não apaga o blob de origem se a linha de files não saiu", async () => {
    const ctx = portas({ falharRetirar: true });
    await expect(executarMovimento(pedidoVirtual, ctx.portas)).rejects.toMatchObject({ destinoGravado: true });
    expect(ctx.chamadas.some((c) => c.startsWith(`apagarBlob:${BUCKET_ARQUIVOS}:`))).toBe(false);
  });

  it("não copia de novo quando o nó da tentativa anterior já existe", async () => {
    const caminho = caminhoNoWorkspace(CLIENTE, ARQUIVO, arquivo().file_name);
    const ctx = portas({
      nos: [pasta(), {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        parent_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        scope: "client",
        client_id: CLIENTE,
        kind: "file",
        name: arquivo().file_name,
        mime: "text/markdown",
        size_bytes: 1200,
        storage_path: caminho,
        sent_for_approval_file_id: ARQUIVO,
      }],
    });
    await executarMovimento(pedidoVirtual, ctx.portas);
    expect(ctx.chamadas.some((c) => c.startsWith("copiar:"))).toBe(false);
    expect(ctx.chamadas.some((c) => c.startsWith("criarNo:"))).toBe(false);
    expect(ctx.chamadas).toContain(`moverNo:cccccccc-cccc-4ccc-8ccc-cccccccccccc:${PASTA}`);
    expect(ctx.chamadas.some((c) => c.startsWith("retirarArquivo:"))).toBe(true);
  });
});

describe("as duas direções oferecidas na árvore", () => {
  it("arquivo do Workspace solto numa pasta de Em Arquivos copia para mcp-files antes de apagar o nó", async () => {
    const no: NoDeWorkspace = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      parent_id: PASTA,
      scope: "client",
      client_id: CLIENTE,
      kind: "file",
      name: "peca.png",
      mime: "image/png",
      size_bytes: 10,
      storage_path: `client/${CLIENTE}/abc.png`,
      sent_for_approval_file_id: null,
    };
    const ctx = portas({ nos: [pasta(), no] });
    const r = await executarMovimento({
      ...pedidoVirtual,
      virtual: false,
      id: no.id,
      fileId: null,
      nome: no.name,
      storagePath: no.storage_path,
      targetParentId: "virt:folder:materiais",
      parentIdAtual: PASTA,
    }, ctx.portas);
    expect(r.mudou).toBe(true);
    const copia = ctx.chamadas.findIndex((c) => c.startsWith("copiar:"));
    const cria = ctx.chamadas.findIndex((c) => c.startsWith("criarArquivo:materiais:"));
    const apaga = ctx.chamadas.findIndex((c) => c.startsWith(`apagarNo:${no.id}`));
    expect(cria).toBeGreaterThan(copia);
    expect(apaga).toBeGreaterThan(cria);
  });

  it("dentro do mesmo modelo só atualiza a pasta e exige a confirmação da escrita", async () => {
    const ctx = portas();
    await executarMovimento({
      ...pedidoVirtual,
      targetParentId: "virt:folder:entregas",
    }, ctx.portas);
    expect(ctx.chamadas).toEqual([`definirPasta:${ARQUIVO}:entregas`]);

    const noId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const ctx2 = portas({
      nos: [{
        id: noId,
        parent_id: null,
        scope: "client",
        client_id: CLIENTE,
        kind: "file",
        name: "a.md",
        mime: null,
        size_bytes: 1,
        storage_path: `client/${CLIENTE}/a.md`,
        sent_for_approval_file_id: null,
      }, pasta()],
    });
    await executarMovimento({
      ...pedidoVirtual,
      virtual: false,
      id: noId,
      fileId: null,
      parentIdAtual: null,
      targetParentId: PASTA,
    }, ctx2.portas);
    expect(ctx2.chamadas.filter((c) => c.startsWith("copiar:"))).toEqual([]);
    expect(ctx2.chamadas).toContain(`moverNo:${noId}:${PASTA}`);
  });

  it("recusa pasta virtual e destino que não é uuid nem pasta de arquivos", () => {
    expect(() => classificarDestino("virt:section:root:Estáticos")).toThrow(ErroDeMovimento);
    expect(classificarDestino(null)).toEqual({ tipo: "raiz" });
    expect(classificarDestino(PASTA)).toEqual({ tipo: "pasta_workspace", id: PASTA });
  });

  it("o painel só diz Movido depois que o destino confirma", () => {
    const src = readFileSync(resolve(process.cwd(), "src/pages/Workspace.tsx"), "utf8");
    const move = src.slice(src.indexOf("async function moveNode"), src.indexOf("async function createFolderAndMove"));
    expect(move).toContain("moverPeloPainel");
    expect(move).not.toContain("update({ folder: newFolder })");
    expect(move.indexOf("moverPeloPainel")).toBeLessThan(move.indexOf('title: "Movido"'));
  });
});

describe("perfis do Instagram pelo MCP", () => {
  const seis = ["a", "b", "c", "d", "e", "f"].map((handle) => ({ handle, papel: "referencia" }));

  it("aceita @ e link, não duplica e recusa o sétimo", () => {
    const plano = planejarPerfis(
      [{ handle: "vivideo", papel: "referencia" }],
      [
        { papel: "referencia", bruto: "@Vivideo" },
        { papel: "concorrente", bruto: "https://instagram.com/outra.marca/" },
      ],
    );
    expect(plano).toEqual({
      ok: true,
      criar: [{ papel: "concorrente", handle: "outra.marca" }],
      ja: [{ papel: "referencia", handle: "vivideo" }],
    });
    const cheio = planejarPerfis(seis, [{ papel: "referencia", bruto: "@nova" }]);
    expect(cheio.ok).toBe(false);
    const invalido = planejarPerfis([], [{ papel: "concorrente", bruto: "não é @" }]);
    expect(invalido.ok).toBe(false);
  });
});
