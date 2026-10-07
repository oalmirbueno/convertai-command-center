/** Interface estrutural para o backend Deno e testes Node usarem o mesmo código. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BancoDeMateriais = { from: (tabela: string) => any; storage: { from: (bucket: string) => any } };
import type { ImagemEntrada } from "../../_shared/ia-motor.ts";
import { normalizarArquivos, blocoDosArquivos, resumoDosArquivos } from "../../agente-calendario/agente-mes-v2.ts";
import { limparSegredos } from "../../_shared/pacote-externo.ts";
import { reduzidaSemTransformacao } from "../../_shared/imagem-reduzida.ts";
import { mimeDaImagem } from "../../_shared/imagem-cabecalho.ts";

export function caminhosDoCliente(clientId: string, bruto: unknown): string[] {
  return [...new Set((Array.isArray(bruto) ? bruto : []).filter((p): p is string =>
    typeof p === "string" && p.startsWith(`${clientId}/pedidos/`) && !/[\\%?#]|\.\./.test(p)))].slice(0, 6);
}

export function documentosDoPlano(bruto: unknown) {
  const arquivos = normalizarArquivos(bruto);
  let restante = 90_000;
  const lidos = arquivos.lidos.map(a => {
    const limpo = limparSegredos(a.texto);
    const texto = limpo.slice(0, Math.max(0, restante));
    restante -= texto.length;
    if (texto.length < limpo.length && !arquivos.cortados.includes(a.nome)) arquivos.cortados.push(a.nome);
    return { ...a, texto, caracteres: texto.length };
  }).filter(a => a.texto);
  return { ...arquivos, lidos };
}

/** Arquiva leitura e imagens por cliente. Originais de documentos não são simulados. */
export async function materiaisDoPlano(db: BancoDeMateriais, clientId: string, userId: string, corpo: Record<string, unknown>) {
  const arquivos = documentosDoPlano(corpo.arquivos);
  const avisos: string[] = arquivos.nao_lidos.map(a => `${a.nome}: ${a.motivo}`);
  if (arquivos.cortados.length) avisos.push(`Leitura parcial: ${arquivos.cortados.join(", ")}. Envie os trechos restantes em outro pedido.`);
  const imagens: ImagemEntrada[] = [];
  const caminhos = caminhosDoCliente(clientId, corpo.anexos);
  let bytes = 0;
  for (const caminho of caminhos) {
    try {
      const r = await reduzidaSemTransformacao(db as Parameters<typeof reduzidaSemTransformacao>[0], "mesa", caminho, 2048, 2048, { maxBytes: 12 * 1024 * 1024, pedirCopia: true, maxPixels: 6_000_000 });
      const mime = r?.cabe ? mimeDaImagem(r.bytes) : null;
      if (!r || !mime || bytes + r.bytes.length > 16 * 1024 * 1024) throw new Error("imagem indisponível ou acima do limite de leitura");
      bytes += r.bytes.length;
      imagens.push({ bytes: r.bytes, mime, nome: caminho.split("/").pop() });
    } catch {
      avisos.push(`Imagem ${caminhos.indexOf(caminho) + 1} não lida. Reenvie em tamanho menor.`);
    }
  }
  let caminhoTexto: string | null = null;
  if (arquivos.lidos.length) {
    const caminho = `${clientId}/pedidos/contexto-leitura-${crypto.randomUUID()}.json`;
    const { error } = await db.storage.from("mesa").upload(caminho, new Blob([JSON.stringify({ lidos: arquivos.lidos })], { type: "application/json" }));
    if (!error) caminhoTexto = caminho;
    else avisos.push("Os documentos foram lidos neste pedido, mas a cópia para continuar a conversa não foi salva.");
  }
  const anexos: unknown[] = caminhos.map(caminho => ({ caminho }));
  if (arquivos.lidos.length || arquivos.nao_lidos.length) anexos.push(resumoDosArquivos(arquivos.lidos, arquivos.nao_lidos, caminhoTexto));
  return { arquivos, imagens, caminhos, anexos, avisos, texto: blocoDosArquivos(arquivos.lidos), userId };
}

/** Recupera somente leituras desta conversa e deste cliente, com teto explícito. */
export async function recuperarMateriais(db: BancoDeMateriais, clientId: string, linhas: Array<{ anexos?: unknown }>): Promise<string> {
  const caminhos = linhas.flatMap(l => Array.isArray(l.anexos) ? l.anexos : [])
    .filter(a => a?.tipo === "arquivos_lidos" && typeof a.caminho_texto === "string")
    .map(a => String(a.caminho_texto)).filter(c => c.startsWith(`${clientId}/pedidos/contexto-leitura-`) && !/[\\%?#]|\.\./.test(c));
  const partes: string[] = [];
  for (const c of [...new Set(caminhos)].slice(-3)) {
    try {
      const { data, error } = await db.storage.from("mesa").download(c);
      if (error || !data || data.size > 2_000_000) throw new Error("indisponível");
      partes.push(blocoDosArquivos(documentosDoPlano(JSON.parse(await data.text())).lidos, "MATERIAL ANTERIOR DA CONVERSA"));
    } catch { partes.push("Um documento anterior não pôde ser relido. Não presumir seu conteúdo."); }
  }
  const todo = partes.join("\n\n");
  return todo.slice(0, 60_000) + (todo.length > 60_000 ? "\n[Material anterior parcial por limite de leitura.]" : "");
}

/** Cópias identificadas por hash: reenviar o mesmo documento não multiplica arquivos. */
export async function arquivarMateriais(db: BancoDeMateriais, clientId: string, userId: string, materiais: Awaited<ReturnType<typeof materiaisDoPlano>>) {
  const avisos: string[] = [];
  let guardados = 0;
  const pasta = async (name: string, parent: string | null): Promise<string> => {
    let q = db.from("workspace_nodes").select("id").eq("scope", "client").eq("client_id", clientId).eq("kind", "folder").eq("name", name);
    q = parent ? q.eq("parent_id", parent) : q.is("parent_id", null);
    const r = await q.limit(1);
    if (r.error) throw new Error("Não foi possível ler a pasta do cliente.");
    if (r.data?.[0]) return r.data[0].id;
    const n = await db.from("workspace_nodes").insert({ scope: "client", client_id: clientId, parent_id: parent, name, kind: "folder", created_by: userId }).select("id").single();
    if (n.error || !n.data) throw new Error("Não foi possível criar a pasta do cliente.");
    return n.data.id;
  };
  if (!materiais.arquivos.lidos.length && !materiais.caminhos.length) return { guardados, avisos };
  try {
    const raiz = await pasta("Contexto do cliente", null);
    const salvar = async (nome: string, corpo: Blob, categoria: string, ext: string) => {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await corpo.arrayBuffer()))).map(n => n.toString(16).padStart(2, "0")).join("");
      const path = `client/${clientId}/contexto/${hash}.${ext}`;
      const existe = await db.from("workspace_nodes").select("id").eq("client_id", clientId).eq("scope", "client").eq("storage_path", path).limit(1);
      if (existe.error) throw new Error("Não foi possível conferir os materiais já guardados.");
      if (existe.data?.length) { guardados++; return; }
      const parent = await pasta(categoria, raiz);
      const upload = await db.storage.from("workspace").upload(path, corpo, { upsert: true, contentType: corpo.type });
      if (upload.error) throw new Error("Não foi possível salvar o material no Workspace.");
      const r = await db.from("workspace_nodes").insert({ scope: "client", client_id: clientId, parent_id: parent, name: nome.slice(0, 200), kind: "file", storage_path: path, mime: corpo.type, size_bytes: corpo.size, created_by: userId }).select("id").single();
      if (r.error || !r.data) throw new Error("Não foi possível registrar o material no Workspace.");
      guardados++;
    };
    for (const a of materiais.arquivos.lidos) {
      try { await salvar(`${a.nome} — texto extraído.txt`, new Blob([`Fonte: ${a.nome}\n${a.origem ? `Origem: ${a.origem}\n` : ""}Cópia do texto extraído no painel; não substitui o arquivo original.\n\n${a.texto}`], { type: "text/plain" }), "Documentos", "txt"); }
      catch { avisos.push(`${a.nome}: não arquivado no Workspace.`); }
    }
    for (const c of materiais.caminhos) {
      try {
        const { data, error } = await db.storage.from("mesa").download(c);
        if (error || !data || data.size > 12 * 1024 * 1024) throw new Error("imagem indisponível");
        await salvar(c.split("/").pop() || "Imagem", data, "Imagens", /\.webp$/i.test(c) ? "webp" : /\.png$/i.test(c) ? "png" : "jpg");
      } catch { avisos.push("Uma imagem não foi arquivada no Workspace."); }
    }
  } catch { avisos.push("Não foi possível organizar as pastas de contexto no Workspace."); }
  return { guardados, avisos };
}
