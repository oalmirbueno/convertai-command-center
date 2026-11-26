import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizeGrantCall,
  cachePrincipalFor,
  filterToolsForGrant,
  findForgedIdentity,
  isApprovedFile,
  isSensitiveFile,
  isProjectOnlyTool,
  projectEntrar,
  PROJECT_ONLY_TOOLS,
  listProjectFiles,
  hasOnlyProjectMarker,
  isProjectScopedKey,
  PROJECT_GRANT_SCOPES,
  projectIdentity,
  readProjectSummary,
  parseProjectGrantRow,
  PROJECT_GRANT_ALLOWED_TOOLS,
  PROJECT_GRANT_WRITE_TOOLS,
  projectGrantAllowsTool,
  projectAllowedForVideo,
  videoProjectAllowlist,
  ProjectAccessError,
  readApprovedFile,
  readProjectTasks,
  type FileRow,
  type ProjectGrant,
  type ProjectPorts,
  type TaskRow,
} from "../../supabase/functions/_shared/mcp-project-access.ts";
import { dataScopeAllowsTool, isRestrictedApiKeyIdentityScope } from "../../supabase/functions/_shared/mcp-security.ts";
import { CredencialEmCache } from "../../supabase/functions/mcp-server/modulos/credencial-em-cache.ts";
import { CacheCurto } from "../../supabase/functions/mcp-server/modulos/leitura-enxuta.ts";
import { executarFerramenta } from "../../supabase/functions/mcp-server/modulos/executar-ferramenta.ts";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENTE_A = U(1), CLIENTE_B = U(2);
const PROJ_A1 = U(11), PROJ_A2 = U(12), PROJ_B1 = U(21);
const OPERADOR = "vertice", OUTRO_OPERADOR = "registro";
const grant: ProjectGrant = { projectId: PROJ_A1, clientId: CLIENTE_A, operatorSlug: OPERADOR };

const tarefa = (n: number, project_id: string): TaskRow => ({ id: U(300 + n), title: `t${n}`, status: "backlog", priority: "medium", due_date: null, updated_at: null, project_id });
const arquivo = (n: number, extra: Partial<FileRow> = {}): FileRow => ({
  id: U(400 + n), project_id: PROJ_A1, client_id: CLIENTE_A, file_name: `f${n}.mp4`, file_type: "video", folder: "entregas",
  mime_type: "video/mp4", extension: "mp4", status: "ready", approval_status: "approved", agency_approval_status: "approved",
  locked_at: "2026-11-01T00:00:00Z", created_at: null, archived_at: null, parent_file_id: null,
  storage_bucket: "files", storage_path: `${CLIENTE_A}/${U(400 + n)}/v1/f.mp4`, ...extra,
});

/** Porta falsa que IGNORA o filtro de propósito: prova a defesa em profundidade do núcleo. */
function portas(tasks: TaskRow[], files: FileRow[], urls: string[] = [], donos?: Array<{ id: string; project_id: string | null; client_id: string }>): ProjectPorts {
  return {
    project: async ({ projectId, clientId }) => ({ id: projectId, client_id: clientId, name: "Projeto sintético", status: "active", description: "d", objectives: "o", scope: "s", deadline: null, deleted_at: null }),
    tasks: async () => tasks,
    files: async () => files,
    // Por padrão o registro canônico concorda com a linha lida (um único dono).
    objectOwners: async (b, p) => donos ?? files.filter((f) => f.storage_bucket === b && f.storage_path === p).map((f) => ({ id: f.id, project_id: f.project_id, client_id: f.client_id })),
    signedUrl: async (b, p, ttl) => { urls.push(`${b}/${p}?ttl=${ttl}`); return `https://signed.invalid/${p}?t=${ttl}`; },
  };
}

describe("concessão de projeto: autorização central", () => {
  it("só a lista preparada passa; escrita de MP4 e tools legadas ficam negadas por padrão", () => {
    expect(PROJECT_GRANT_ALLOWED_TOOLS.every((nome) => projectGrantAllowsTool(nome))).toBe(true);
    for (const nome of [
      ...PROJECT_GRANT_WRITE_TOOLS, "aceleriq_create_task", "aceleriq_delete_task", "aceleriq_list_clients",
      "aceleriq_capabilities", "aceleriq_guia", "memory_fetch", "aceleriq_arquivos_enviar_para_aprovacao", "ferramenta_nova_qualquer",
    ]) {
      expect(projectGrantAllowsTool(nome), nome).toBe(false);
      const d = authorizeGrantCall(grant, nome, {});
      expect(d.ok).toBe(false);
    }
  });

  it("tools/list da concessão mostra só as tools de leitura do projeto", () => {
    const catalogo = [...PROJECT_GRANT_ALLOWED_TOOLS, "aceleriq_list_clients", "aceleriq_create_task", "aceleriq_capabilities"].map((name) => ({ name }));
    expect(filterToolsForGrant(catalogo).map((t) => t.name)).toEqual([...PROJECT_GRANT_ALLOWED_TOOLS]);
  });

  it("falsificação de operador, projeto e cliente é recusada", () => {
    for (const args of [
      { operator: "outro-operador" }, { operator_slug: OUTRO_OPERADOR }, { operator_user_id: OUTRO_OPERADOR }, { user_id: OUTRO_OPERADOR },
      { created_by: OUTRO_OPERADOR }, { OPERATOR: "x" }, { filtro: { aninhado: { operator: "x" } } },
      { project_id: PROJ_A2 }, { project_id: PROJ_B1 }, { client_id: CLIENTE_B }, { itens: [{ project_id: PROJ_B1 }] },
    ]) {
      const d = authorizeGrantCall(grant, "aceleriq_projeto_tarefas", args);
      expect(d.ok, JSON.stringify(args)).toBe(false);
    }
    // Mesmo operador declarado também é recusado: a identidade não é argumento.
    expect(findForgedIdentity({ operator_slug: OPERADOR }, grant)).not.toBeNull();
    // Projeto/cliente iguais à concessão são inofensivos.
    expect(authorizeGrantCall(grant, "aceleriq_projeto_tarefas", { project_id: PROJ_A1, client_id: CLIENTE_A }).ok).toBe(true);
  });

  it("só a chave com EXATAMENTE o marcador mcp:project é project-scoped; legado/admin nunca vira concessão", () => {
    expect(hasOnlyProjectMarker(["mcp:project"])).toBe(true);
    for (const s of [["mcp:project", "admin"], ["mcp:project", "tasks:read"], ["mcp:project", "aceleriq:read"], []]) {
      expect(hasOnlyProjectMarker(s), s.join()).toBe(false);
    }
    // Chaves antigas (sem marcador) não entram no caminho de concessão.
    for (const s of [["admin"], ["tasks:read", "files:read"], ["aceleriq:read"], []]) expect(isProjectScopedKey(s)).toBe(false);
    // Escopos efetivos vêm da concessão: leitura apenas, nunca admin.
    expect([...PROJECT_GRANT_SCOPES]).toEqual(["tasks:read", "files:read"]);
  });

  it("linha de concessão inválida falha fechada; operador é slug, não UUID humano", () => {
    expect(parseProjectGrantRow({ project_id: "x", client_id: CLIENTE_A, operator_slug: OPERADOR })).toBeNull();
    expect(parseProjectGrantRow(null)).toBeNull();
    expect(parseProjectGrantRow({ project_id: PROJ_A1, client_id: CLIENTE_A, operator_user_id: U(100) })).toBeNull();
    expect(parseProjectGrantRow({ project_id: PROJ_A1, client_id: CLIENTE_A, operator_slug: "Com Espaço" })).toBeNull();
    expect(parseProjectGrantRow({ project_id: PROJ_A1, client_id: CLIENTE_A, operator_slug: OPERADOR })).toEqual(grant);
  });

  it("identidade mínima não expõe organograma", () => {
    const id = projectIdentity(grant);
    expect(Object.keys(id).sort()).toEqual(["acesso", "cliente_id", "operador", "projeto_id"]);
  });

  it("resumo do projeto: só o projeto e o cliente da concessão, e nunca apagado", async () => {
    const p = portas([], []);
    expect((await readProjectSummary(p, grant)).projeto_id).toBe(PROJ_A1);
    const outro = { ...p, project: async () => ({ id: PROJ_A2, client_id: CLIENTE_A, name: "x", status: null, description: null, objectives: null, scope: null, deadline: null, deleted_at: null }) };
    await expect(readProjectSummary(outro, grant)).rejects.toMatchObject({ code: "not_found" });
    const apagado = { ...p, project: async () => ({ id: PROJ_A1, client_id: CLIENTE_A, name: "x", status: null, description: null, objectives: null, scope: null, deadline: null, deleted_at: "2026-11-01T00:00:00Z" }) };
    await expect(readProjectSummary(apagado, grant)).rejects.toMatchObject({ code: "not_found" });
  });

  it("tarefa apagada (deleted_at) nunca é devolvida", async () => {
    const r = await readProjectTasks(portas([{ ...tarefa(1, PROJ_A1), deleted_at: "2026-11-01T00:00:00Z" }, tarefa(2, PROJ_A1)], []), grant, {});
    expect(r.tarefas.map((t) => t.id)).toEqual([U(302)]);
    await expect(readProjectTasks(portas([{ ...tarefa(1, PROJ_A1), deleted_at: "2026-11-01T00:00:00Z" }], []), grant, { task_id: U(301) })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("outra tarefa/projeto do mesmo cliente", () => {
  it("tarefa de outro projeto do MESMO cliente parece inexistente", async () => {
    const p = portas([tarefa(1, PROJ_A2)], []);
    await expect(readProjectTasks(p, grant, { task_id: U(301) })).rejects.toMatchObject({ code: "not_found" });
  });

  it("a lista nunca devolve tarefa de outro projeto, mesmo se a porta errar o filtro", async () => {
    const r = await readProjectTasks(portas([tarefa(1, PROJ_A1), tarefa(2, PROJ_A2), tarefa(3, PROJ_B1)], []), grant, {});
    expect(r.tarefas.map((t) => t.id)).toEqual([U(301)]);
  });

  it("arquivos de outro projeto ou de outro cliente nunca aparecem nem são lidos", async () => {
    const mesmoClienteOutroProjeto = arquivo(2, { project_id: PROJ_A2 });
    const outroCliente = arquivo(3, { client_id: CLIENTE_B, project_id: PROJ_B1, storage_path: `${CLIENTE_B}/x/v1/f.mp4` });
    const semProjeto = arquivo(4, { project_id: null });
    const p = portas([], [arquivo(1), mesmoClienteOutroProjeto, outroCliente, semProjeto]);
    const lista = await listProjectFiles(p, grant, {});
    expect(lista.arquivos.map((f) => f.id)).toEqual([U(401)]);
    for (const f of [mesmoClienteOutroProjeto, outroCliente, semProjeto]) {
      await expect(readApprovedFile(portas([], [f]), grant, { file_id: f.id })).rejects.toMatchObject({ code: "not_found" });
    }
  });
});

describe("visibilidade e URL assinada", () => {
  it("metadados não expõem caminho de armazenamento, bucket nem URL", async () => {
    const lista = await listProjectFiles(portas([], [arquivo(1)]), grant, {});
    const texto = JSON.stringify(lista);
    expect(texto).not.toContain("storage");
    expect(texto).not.toContain(CLIENTE_A + "/");
    expect(lista.arquivos[0].aprovado).toBe(true);
  });

  it("só arquivo com Double-Gate completo e não arquivado gera URL", async () => {
    const naoAprovados = [
      arquivo(1, { approval_status: "none" }), arquivo(2, { agency_approval_status: "not_requested" }),
      arquivo(3, { approval_status: "pending" }), arquivo(4, { archived_at: "2026-11-02T00:00:00Z" }),
      arquivo(5, { status: "processing" }), arquivo(6, { status: null }),
    ];
    for (const f of naoAprovados) {
      if (f.status === "ready") expect(isApprovedFile(f)).toBe(false);
      await expect(readApprovedFile(portas([], [f]), grant, { file_id: f.id })).rejects.toMatchObject({ code: "not_approved" });
    }
  });

  it("URL assinada dura 60 s e sai do bucket/caminho do cliente da concessão", async () => {
    const urls: string[] = [];
    const r = await readApprovedFile(portas([], [arquivo(1)], urls), grant, { file_id: U(401) });
    expect(r.expira_em_segundos).toBe(60);
    expect(urls).toEqual([`files/${CLIENTE_A}/${U(401)}/v1/f.mp4?ttl=60`]);
    expect(r.url_assinada).toContain("ttl=60".replace("ttl", "t"));
  });

  it("objeto com mais de um dono, dono divergente ou falha na leitura do registro nega a URL; um dono devolve normal", async () => {
    const f = arquivo(1);
    const eu = { id: f.id, project_id: PROJ_A1, client_id: CLIENTE_A };
    const casos: Array<Array<{ id: string; project_id: string | null; client_id: string }>> = [
      [eu, { id: U(499), project_id: PROJ_A2, client_id: CLIENTE_A }], // bucket+caminho com 2 donos
      [{ ...eu, project_id: PROJ_A2 }], // projeto divergente
      [{ ...eu, client_id: CLIENTE_B }], // cliente divergente
      [{ ...eu, id: U(499) }], // outra linha é a dona
      [], // sem registro canônico
    ];
    for (const donos of casos) {
      const urls: string[] = [];
      await expect(readApprovedFile(portas([], [f], urls, donos), grant, { file_id: f.id })).rejects.toMatchObject({ code: "storage_denied" });
      expect(urls).toEqual([]);
    }
    const falha = { ...portas([], [f]), objectOwners: async () => { throw new Error("db"); } };
    await expect(readApprovedFile(falha, grant, { file_id: f.id })).rejects.toMatchObject({ code: "storage_denied" });
    const urls: string[] = [];
    expect((await readApprovedFile(portas([], [f], urls, [eu]), grant, { file_id: f.id })).expira_em_segundos).toBe(60);
    expect(urls).toHaveLength(1);
  });

  it("projeto arquivado, cancelado ou de outro cliente não é vivo", async () => {
    for (const status of ["archived", "cancelled", "canceled", "deleted", "ARCHIVED"]) {
      const arq = { ...portas([], []), project: async () => ({ id: PROJ_A1, client_id: CLIENTE_A, name: "x", status, description: null, objectives: null, scope: null, deadline: null, deleted_at: null }) };
      await expect(readProjectSummary(arq, grant)).rejects.toMatchObject({ code: "not_found" });
    }
    const outroCliente = { ...portas([], []), project: async () => ({ id: PROJ_A1, client_id: CLIENTE_B, name: "x", status: "active", description: null, objectives: null, scope: null, deadline: null, deleted_at: null }) };
    await expect(readProjectSummary(outroCliente, grant)).rejects.toMatchObject({ code: "not_found" });
  });

  it("linha adulterada (caminho de outro cliente, bucket estranho, '..') não gera URL", async () => {
    for (const extra of [
      { storage_path: `${CLIENTE_B}/x/v1/f.mp4` }, { storage_bucket: "privado" }, { storage_bucket: null },
      { storage_path: `${CLIENTE_A}/../${CLIENTE_B}/f.mp4` }, { storage_path: null },
    ] as Partial<FileRow>[]) {
      const urls: string[] = [];
      await expect(readApprovedFile(portas([], [arquivo(1, extra)], urls), grant, { file_id: U(401) })).rejects.toBeInstanceOf(ProjectAccessError);
      expect(urls).toEqual([]);
    }
  });
});

describe("cache", () => {
  it("o principal do cache muda com projeto e operador (religar a chave não reaproveita resposta)", () => {
    const a = cachePrincipalFor("k", grant);
    expect(a).not.toBe(cachePrincipalFor("k", { ...grant, projectId: PROJ_A2 }));
    expect(a).not.toBe(cachePrincipalFor("k", { ...grant, operatorSlug: OUTRO_OPERADOR }));
    expect(cachePrincipalFor("k", undefined)).toBe("k");
  });

  it("executarFerramenta: mesma chave e mesmos argumentos em projetos diferentes não compartilham cache", async () => {
    const cache = new CacheCurto();
    let chamadas = 0;
    const tool = { name: "aceleriq_leitura_teste", inputSchema: { type: "object" }, annotations: { readOnlyHint: true }, cacheSeg: 30, handler: async (_i: unknown, c: { cachePrincipal?: string }) => ({ de: c.cachePrincipal, n: ++chamadas }) };
    const deps = { auditar: async () => {}, ehForaDoEscopo: () => false, cache };
    const base = { keyId: "k", origin: null, scopes: ["tasks:read"] };
    const run = (g: ProjectGrant) => executarFerramenta(tool, {}, { ...base, cachePrincipal: cachePrincipalFor("k", g) }, deps);
    const r1 = await run(grant);
    const r2 = await run(grant);
    const r3 = await run({ ...grant, projectId: PROJ_A2 });
    expect(chamadas).toBe(2);
    expect((r2 as any).result._meta["aceleriq/de_cache"]).toBe(true);
    expect((r3 as any).result._meta["aceleriq/de_cache"]).toBe(false);
    expect((r1 as any).result.structuredContent.de).not.toBe((r3 as any).result.structuredContent.de);
  });

  it("credencial com concessão nunca fica no cache de 45 s; a legada continua", async () => {
    let conferencias = 0;
    const legado = { ok: true as const, ctx: {} as { projectGrant?: ProjectGrant } };
    const presa = { ok: true as const, ctx: { projectGrant: grant } };
    const cache = new CredencialEmCache<typeof legado>(undefined, undefined, (r) => Boolean(r.ctx.projectGrant));
    const req = () => new Request("https://x.invalid", { headers: { authorization: "Bearer mcp_live_teste" } });
    await cache.autenticar(req(), async () => { conferencias++; return presa; });
    await cache.autenticar(req(), async () => { conferencias++; return presa; });
    expect(conferencias).toBe(2);
    expect(cache.tamanho).toBe(0);
    await cache.autenticar(req(), async () => { conferencias++; return legado; });
    await cache.autenticar(req(), async () => { conferencias++; return legado; });
    expect(conferencias).toBe(3);
    expect(cache.tamanho).toBe(1);
  });
});

describe("ligação no servidor (texto-fonte)", () => {
  const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  const index = ler("supabase/functions/mcp-server/index.ts");

  it("tools/list e tools/call usam a autorização central antes do handler", () => {
    expect(index).toContain("catalogoDe(auth.ctx).filter((t) => authorizeTool(auth.ctx, t))");
    const posGrant = index.indexOf("authorizeGrantCall(ctx.projectGrant");
    expect(posGrant).toBeGreaterThan(0);
    expect(posGrant).toBeLessThan(index.indexOf("if (!canInvoke(ctx, tool))"));
    expect(posGrant).toBeLessThan(index.indexOf("executarFerramenta(tool, autoria.args"));
    expect(index).toContain("!ctx.projectGrant && !canUseToolWithDataScope");
  });

  it("a conferência da credencial presa nunca é guardada", () => {
    expect(index).toContain("Boolean(r.ctx.projectGrant)");
  });

  it("autenticação: marcador exclusivo, concessão obrigatória, revalidação por chamada; legada sem lookup", () => {
    const auth = ler("supabase/functions/_shared/mcp-auth.ts");
    const marcada = auth.indexOf("if (isProjectScopedKey(scopes))");
    const legada = auth.indexOf("let dataScope: ClientDataScope;");
    expect(marcada).toBeGreaterThan(0);
    // O lookup da concessão só roda dentro do ramo marcado, antes do caminho legado.
    expect(auth.indexOf("loadProjectGrant(row.id)")).toBeGreaterThan(marcada);
    expect(auth.indexOf("loadProjectGrant(row.id)")).toBeLessThan(legada);
    expect(auth.split("loadProjectGrant(row.id)").length - 1).toBe(1);
    expect(auth).toContain("if (!hasOnlyProjectMarker(scopes))");
    expect(auth).toContain("scopes: grantScopes(grant)");
    expect(auth).toContain("effectiveVideoWrite(record.allowVideoUpload, Deno.env.get('MCP_PROJECT_VIDEO_WRITE'))");
    // Falha, linha ausente, revogada, tabela ausente => nega a chave (não cai em legado).
    expect(auth).toContain("if (!grant) return { ok: false, error: { kind: 'invalid' } };");
    expect(auth).not.toContain("42P01");
    // Operador interno ativo; projeto do mesmo cliente, ambos não apagados.
    expect(auth).toContain(".from('internal_operators')");
    expect(auth).toMatch(/\.from\('projects'\)[^\n]*\.eq\('client_id', grant\.clientId\)[^\n]*\.is\('deleted_at', null\)/);
    expect(auth).toMatch(/\.from\('profiles'\)[^\n]*\.is\('deleted_at', null\)/);
    expect(auth).not.toContain("dataScopeForUser(grant");
  });

  it("a chave com concessão perde a Central de Skills", () => {
    expect(ler("supabase/functions/central-skills/index.ts")).toContain("if (r.ctx.projectGrant) return null;");
  });

  it("escrita de MP4: só RPC dedicada e URL assinada sem upsert; nada de cache, upload direto ou log", () => {
    const tools = ler("supabase/functions/mcp-server/modulos/projeto-restrito.ts");
    const codigo = tools.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    expect(codigo).not.toMatch(/\.upload\(|upsert|console\.|\.from\('files'\)\.(insert|update)|\.from\('task_attachments'\)/);
    // O envio só passa pelas RPCs dedicadas (o banco decide projeto/cliente/autoria/caminho).
    for (const rpc of ["mcp_project_video_prepare", "mcp_project_video_open", "mcp_project_video_finalize", "mcp_project_video_request_review"]) {
      expect(tools).toContain(`'${rpc}'`);
    }
    expect(tools).toContain(".createSignedUploadUrl(storagePath);");
    // A mensagem do banco nunca é repassada.
    expect(tools).toContain("throw videoErrorFromDb(error.message)");
    // Só a DECLARAÇÃO da propriedade conta (um comentário citando cacheSeg é legítimo): `cacheSeg:`, `cacheSeg :`, `'cacheSeg':`, `["cacheSeg"]:`.
    const semComentarios = tools.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    expect(semComentarios).not.toMatch(/["'\[]?\bcacheSeg\b["'\]]?\s*[:=]/);
    // O próprio detector pega a declaração e ignora o comentário.
    const detecta = (src: string) => /["'\[]?\bcacheSeg\b["'\]]?\s*[:=]/.test(src);
    expect(detecta("{ name: 'x', cacheSeg: 30 }")).toBe(true);
    expect(detecta("{ 'cacheSeg' : 30 }")).toBe(true);
    expect(detecta("// Sem cacheSeg de propósito")).toBe(false);
  });

  it("catálogo restrito separado do legado: fora de RAW_TOOLS/TOOLS, roteável só com concessão", () => {
    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    const registro = tools.slice(tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["), tools.indexOf("export const TOOLS: readonly ToolDefinition[]"));
    expect(registro).not.toContain("FERRAMENTAS_DO_PROJETO_RESTRITO");
    expect(tools).toContain("export const PROJECT_TOOLS: readonly ToolDefinition[] = FERRAMENTAS_DO_PROJETO_RESTRITO;");
    // Sem concessão: só TOOL_MAP (legado). Com concessão: mapa restrito primeiro.
    expect(tools).toContain("ctx.projectGrant ? (PROJECT_TOOL_MAP.get(name) ?? TOOL_MAP.get(name)) : TOOL_MAP.get(name)");
    expect(tools).toContain("return ctx.projectGrant ? PROJECT_TOOLS : TOOLS;");
    // capabilities (lista visível) usa o catálogo da credencial; as contagens continuam sobre TOOLS (legado).
    expect(tools).toContain("const visible = catalogoDe(ctx)");
    expect(tools).toContain("total: TOOLS.length,");
    // Initialize e discovery seguem o legado (TOOLS): nada de PROJECT_TOOLS nas contagens.
    const index = ler("supabase/functions/mcp-server/index.ts");
    expect(index).toContain("este servidor expoe ${TOOLS.length} tools nesta versao");
    expect(index).toContain("toolCount: TOOLS.length");
    expect(index).not.toMatch(/PROJECT_TOOLS\.length/);
    expect(index).toContain("const tool = toolFor(ctx, name);");
    expect(index).toContain("catalogoDe(auth.ctx).filter((t) => authorizeTool(auth.ctx, t))");
    expect(index).toMatch(/: TOOLS;/);
    // Contrato legado: a contagem fixa é do mcp_test.ts (dona da main); aqui só garante que ela existe e nenhuma restrita entra.
    expect(ler("supabase/functions/mcp-server/mcp_test.ts")).toMatch(/assertEquals\(TOOLS\.length, \d+\);/);
    // As cinco tools do módulo são exatamente a lista preparada.
    const nomes = [...ler("supabase/functions/mcp-server/modulos/projeto-restrito.ts").matchAll(/^\s+name: '([a-z_]+)',$/gm)].map((m) => m[1]);
    expect(nomes.sort()).toEqual([...PROJECT_GRANT_ALLOWED_TOOLS, ...PROJECT_GRANT_WRITE_TOOLS].sort());
  });

  it("arquivo sensível (confidential/restricted/desconhecido) não é listado nem assinado; null conta como normal", async () => {
    for (const sensitivity of ["confidential", "restricted", "secreto"]) {
      const urls: string[] = [];
      const f = arquivo(1, { sensitivity });
      expect(isSensitiveFile(f)).toBe(true);
      expect((await listProjectFiles(portas([], [f, arquivo(2)]), grant, {})).arquivos.map((x) => x.id)).toEqual([U(402)]);
      await expect(readApprovedFile(portas([], [f], urls), grant, { file_id: f.id })).rejects.toMatchObject({ code: "not_found" });
      expect(urls).toEqual([]);
    }
    for (const sensitivity of ["normal", null, undefined]) {
      const f = arquivo(1, { sensitivity });
      expect(isSensitiveFile(f)).toBe(false);
      expect((await listProjectFiles(portas([], [f]), grant, {})).arquivos).toHaveLength(1);
      expect((await readApprovedFile(portas([], [f]), grant, { file_id: f.id })).url_assinada).toBeTruthy();
    }
    // A concessão nunca tem o escopo sensível e a consulta já filtra no banco.
    expect(PROJECT_GRANT_SCOPES as readonly string[]).not.toContain("files:sensitive:read");
    const consulta = ler("supabase/functions/mcp-server/modulos/projeto-restrito.ts");
    expect(consulta).toContain("storage_path,sensitivity");
    expect(consulta).toContain(".or('sensitivity.is.null,sensitivity.eq.normal')");
  });

  it("migration: marcador mcp:project imutável em api_keys.scopes, só a criação nova entra", () => {
    const sql = ler("supabase/migrations/20261125202100_mcp_project_grants.sql");
    expect(sql).toContain("CREATE TRIGGER api_keys_project_marker_guard");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF scopes, audience, is_active, revoked_at ON public.api_keys");
    // Recusa mudança de escopos que entre, saia ou altere chave marcada (independe de concessão/revogação).
    expect(sql).toContain("NEW.scopes IS DISTINCT FROM OLD.scopes");
    expect(sql).toContain("'mcp:project' = ANY (COALESCE(OLD.scopes");
    expect(sql).toContain("novo_marcado");
    // INSERT com marcador só como escopo único.
    expect(sql).toContain("NEW.scopes IS DISTINCT FROM ARRAY['mcp:project']::text[]");
    // Sem corrida: a conferência da chave na concessão trava a linha.
    expect(sql).toMatch(/k\.scopes = ARRAY\['mcp:project'\]::text\[\]\s+AND k\.audience = 'mcp' AND k\.is_active = true AND k\.revoked_at IS NULL\s+FOR SHARE/);
    // Não habilita emissão de chave nem upload; não escreve em api_keys.
    const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(codigo).not.toMatch(/\b(INSERT INTO|UPDATE)\s+public\.api_keys/i);
    expect(codigo).toContain("CHECK (allow_video_upload = false)");
  });

  it("a migration é aditiva, fecha o RLS e não toca nas tabelas existentes", () => {
    const sql = ler("supabase/migrations/20261125202100_mcp_project_grants.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/REVOKE ALL ON public\.mcp_project_grants FROM PUBLIC, anon, authenticated/);
    expect(sql).toContain("AND revoked_at IS NULL");
    // Revogação automática: sem catch que engole, cobre exclusão/arquivamento e troca de client_id.
    const revoga = sql.slice(sql.indexOf("FUNCTION public.mcp_project_grants_revoke_on_project_change"), sql.indexOf("DROP TRIGGER IF EXISTS mcp_project_grants_revoke_on_project_change"));
    const corpoDaRevogacao = revoga.split("$$")[1] ?? "";
    expect(corpoDaRevogacao).toContain("UPDATE public.mcp_project_grants");
    expect(corpoDaRevogacao).not.toMatch(/^\s*(EXCEPTION|WHEN OTHERS|RAISE WARNING)\b/im);
    expect(revoga).toContain("NEW.client_id IS DISTINCT FROM OLD.client_id");
    expect(sql).toContain("AFTER UPDATE OF deleted_at, status, client_id OR DELETE ON public.projects");
    // Concessão serializa com o projeto vivo (FOR SHARE), sem travar o cliente.
    expect(sql).toMatch(/FROM public\.projects p[\s\S]*?FOR SHARE OF p;/);
    expect(sql).not.toMatch(/FROM public\.profiles[^;]*FOR (SHARE|UPDATE)/);
    // Operador interno por slug; nada de profiles.id humano; sem cascade que faça a concessão sumir.
    expect(sql).toContain("REFERENCES public.internal_operators(slug)");
    expect(sql).not.toMatch(/operator_user_id/);
    expect(sql).not.toMatch(/ON DELETE CASCADE/i);
    // Chave só com o marcador; rollback desativa a chave, sem remover a concessão.
    expect(sql).toContain("ARRAY['mcp:project']");
    expect(sql).toContain("UPDATE public.api_keys SET is_active = false");
    expect(sql).toContain("BEFORE DELETE ON public.mcp_project_grants");
    const semComentarios = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(semComentarios).not.toMatch(/\b(DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE public\.(api_keys|files|tasks|projects))\b/i);
  });
});

describe("aceleriq_escritorio_entrar: variante restrita x legado", () => {
  const ENTRAR = "aceleriq_escritorio_entrar";
  const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("com concessão: operator omitido ou igual passa; devolve ok:true e voce.slug fixos da concessão", () => {
    for (const args of [undefined, null, {}, { operator: OPERADOR }]) {
      expect(authorizeGrantCall(grant, ENTRAR, args).ok, JSON.stringify(args)).toBe(true);
      expect(projectEntrar(grant, args)).toMatchObject({ ok: true, voce: { slug: OPERADOR, projeto_id: PROJ_A1, cliente_id: CLIENTE_A } });
    }
    expect(projectGrantAllowsTool(ENTRAR)).toBe(true);
    expect(filterToolsForGrant([{ name: ENTRAR }, { name: "aceleriq_list_clients" }]).map((t) => t.name)).toEqual([ENTRAR]);
  });

  it("operador divergente, quase igual, tipo errado e campos extras são recusados", () => {
    for (const args of [
      { operator: OUTRO_OPERADOR }, { operator: OPERADOR.toUpperCase() }, { operator: " " + OPERADOR }, { operator: OPERADOR + " " },
      { operator: "" }, { operator: null }, { operator: 1 }, { operator: [OPERADOR] }, { operator: { slug: OPERADOR } },
      { operator_slug: OPERADOR }, { operador: OPERADOR }, { user_id: OPERADOR }, { operator: OPERADOR, project_id: PROJ_A1 },
      { operator: OPERADOR, extra: true }, [OPERADOR], OPERADOR,
    ]) {
      const d = authorizeGrantCall(grant, ENTRAR, args);
      expect(d.ok, JSON.stringify(args)).toBe(false);
      if (d.ok === false) expect(d.code).toBe("grant_identity_forged");
      expect(() => projectEntrar(grant, args), JSON.stringify(args)).toThrow(ProjectAccessError);
    }
  });

  it("variante restrita não lê caixa/equipe/regras nem grava presença", () => {
    const r = projectEntrar(grant, {}) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["ok", "voce"]);
    for (const k of ["equipe", "responde_a", "organograma", "regras_da_casa", "salas", "nao_lidas"]) {
      expect(JSON.stringify(r)).not.toContain(k);
    }
    const src = ler("supabase/functions/mcp-server/modulos/projeto-restrito.ts");
    const bloco = src.slice(src.indexOf("name: 'aceleriq_escritorio_entrar'"), src.indexOf("name: 'aceleriq_projeto_identidade'"));
    expect(bloco).toContain("projectEntrar(grantDe(ctx), input ?? {})");
    expect(bloco).toContain("scopes: ['tasks:read']");
    expect(bloco).not.toMatch(/escritorio\.ts|porta|db\(\)|presenca|caixa/i);
  });

  it("sem concessão: o nome não é tool só-de-projeto (legado intacto) e o gate segue fechado para as outras", () => {
    expect(isProjectOnlyTool(ENTRAR)).toBe(false);
    for (const nome of PROJECT_ONLY_TOOLS) expect(isProjectOnlyTool(nome), nome).toBe(true);
    expect(PROJECT_GRANT_ALLOWED_TOOLS).toContain(ENTRAR);

    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    expect(tools).toContain("if (isProjectOnlyTool(tool.name)) return false;");
    expect(tools).not.toContain("if (projectGrantAllowsTool(tool.name)) return false;");
    const index = ler("supabase/functions/mcp-server/index.ts");
    expect(index).toContain("} else if (isProjectOnlyTool(name)) {");
    expect(index).not.toContain("} else if (projectGrantAllowsTool(name)) {");
    // Variante restrita fora do registro legado; legado segue registrado com escopo e handler de antes.
    const registro = tools.slice(tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["), tools.indexOf("export const TOOLS: readonly ToolDefinition[]"));
    expect(registro).not.toContain("FERRAMENTAS_DO_PROJETO_RESTRITO");
    expect(registro).toContain("FERRAMENTAS_DO_ESCRITORIO");
    const legado = ler("supabase/functions/mcp-server/modulos/escritorio.ts");
    const defLegada = legado.slice(legado.indexOf("name: 'aceleriq_escritorio_entrar'"), legado.indexOf("name: 'aceleriq_escritorio_diretorio'"));
    // #171 acrescentou escritorio:identity (OR) sem tirar aceleriq:read: a lista é exatamente essa, nada mais.
    const escoposLegados = [...defLegada.matchAll(/^\s+scopes: \[([^\]]*)\],$/gm)];
    expect(escoposLegados).toHaveLength(1);
    expect(escoposLegados[0][1].split(",").map((s) => s.trim())).toEqual(["'aceleriq:read'", "'escritorio:identity'"]);
    expect(defLegada).toContain("handler: (input, ctx) => escritorioEntrar(input, ctx)");
    // Efeito do escopo novo no escopo de dados: só a própria entrada, só chave API restrita com dono e cliente.
    const restrita = { source: "api_key", unrestricted: false, principalUserId: U(900), clientIds: [CLIENTE_A] };
    expect(isRestrictedApiKeyIdentityScope(restrita)).toBe(true);
    expect(dataScopeAllowsTool(restrita, ENTRAR)).toBe(true);
    for (const nome of ["aceleriq_escritorio_caixa", "aceleriq_escritorio_diretorio", "aceleriq_escritorio_enviar", "aceleriq_escritorio_presenca"]) {
      expect(dataScopeAllowsTool(restrita, nome), nome).toBe(false);
    }
    for (const negado of [
      null, undefined, {}, { ...restrita, source: "oauth" }, { ...restrita, unrestricted: undefined }, { ...restrita, unrestricted: "false" },
      { ...restrita, principalUserId: "" }, { ...restrita, principalUserId: " " }, { ...restrita, principalUserId: null },
      { ...restrita, clientIds: [] }, { ...restrita, clientIds: CLIENTE_A },
    ]) {
      expect(isRestrictedApiKeyIdentityScope(negado), JSON.stringify(negado)).toBe(false);
      expect(dataScopeAllowsTool(negado, ENTRAR), JSON.stringify(negado)).toBe(false);
    }
    // Legado intacto: escopo irrestrito segue abrindo a entrada.
    expect(dataScopeAllowsTool({ ...restrita, unrestricted: true }, ENTRAR)).toBe(true);
    // Nenhuma tool restrita (leitura ou escrita) é definida nos módulos do registro legado.
    for (const nome of [...PROJECT_GRANT_ALLOWED_TOOLS, ...PROJECT_GRANT_WRITE_TOOLS].filter((n) => n !== "aceleriq_escritorio_entrar")) {
      expect(registro, nome).not.toContain(`'${nome}'`);
      expect(legado, nome).not.toContain(`name: '${nome}'`);
    }
    expect(ler("supabase/functions/mcp-server/mcp_test.ts")).toMatch(/assertEquals\(TOOLS\.length, \d+\);/);
  });

  it("allowlist de projetos do envio de MP4: plural explícito, singular legado, falha fechada", () => {
    const A = "11111111-1111-4111-8111-111111111111";
    const B = "22222222-2222-4222-8222-222222222222";
    const C = "33333333-3333-4333-8333-333333333333";
    // Ausente/vazio: ninguém.
    expect(videoProjectAllowlist(undefined, undefined).size).toBe(0);
    expect(projectAllowedForVideo(A, "", "")).toBe(false);
    expect(projectAllowedForVideo(A, " , ,", null)).toBe(false);
    // Singular legado continua valendo sozinho.
    expect(projectAllowedForVideo(A, undefined, A)).toBe(true);
    expect(projectAllowedForVideo(B, undefined, A)).toBe(false);
    // Plural: só os listados; espaços e maiúsculas normalizados; união com o singular.
    expect(projectAllowedForVideo(B, ` ${A} ,${B.toUpperCase()} `, undefined)).toBe(true);
    expect(projectAllowedForVideo(C, `${A},${B}`, undefined)).toBe(false);
    expect([...videoProjectAllowlist(A, C)].sort()).toEqual([A, C]);
    // Qualquer item inválido (inclusive curinga) derruba a lista inteira.
    for (const ruim of [`${A},*`, `${A},projeto`, "*", `${A};${B}`]) {
      expect(projectAllowedForVideo(A, ruim, undefined), ruim).toBe(false);
    }
    expect(projectAllowedForVideo(A, `${B}`, "nao-uuid")).toBe(false);
    // projectId inválido nunca casa.
    expect(projectAllowedForVideo("", A, A)).toBe(false);
  });

  it("autenticação usa a allowlist junto com operador corte, opt-in da concessão e kill switch", () => {
    const auth = ler("supabase/functions/_shared/mcp-auth.ts");
    expect(auth).toContain("record.operatorSlug === 'corte'");
    expect(auth).toContain("projectAllowedForVideo(record.projectId, Deno.env.get('MCP_PROJECT_VIDEO_PROJECT_IDS'), Deno.env.get('MCP_PROJECT_VIDEO_PROJECT_ID'))");
    expect(auth).toContain("effectiveVideoWrite(record.allowVideoUpload, Deno.env.get('MCP_PROJECT_VIDEO_WRITE'))");
    expect(auth).not.toContain("record.projectId === Deno.env.get(");
  });

  it("internal_operators: service_role lê só slug/status; nenhuma permissão nova para anon/authenticated", () => {
    const sql = ler("supabase/migrations/20261125202100_mcp_project_grants.sql");
    expect(sql).toContain("GRANT SELECT (slug, status) ON public.internal_operators TO service_role;");
    const sobreOperadores = sql.replace(/--[^\n]*/g, "").split(";")
      .filter((s) => /internal_operators/.test(s) && /\b(GRANT|REVOKE|POLICY|ROW LEVEL SECURITY)\b/i.test(s));
    expect(sobreOperadores.map((s) => s.trim())).toEqual([
      "GRANT SELECT (slug, status) ON public.internal_operators TO service_role",
    ]);
    // A leitura do caminho Corte cabe nessas colunas.
    const auth = ler("supabase/functions/_shared/mcp-auth.ts");
    const leituras = [...auth.matchAll(/from\('internal_operators'\)\.select\('([^']*)'\)((?:\.[a-zA-Z]+\([^)]*\))*)/g)];
    expect(leituras.length).toBeGreaterThan(0);
    for (const [, colunas, filtros] of leituras) {
      for (const c of colunas.split(",").map((x) => x.trim())) expect(["slug", "status"]).toContain(c);
      for (const [, f] of filtros.matchAll(/\.(?:eq|is|in)\('([a-z_]+)'/g)) expect(["slug", "status"]).toContain(f);
    }
  });

  it("sem escopos legados: a concessão segue só com tasks:read/files:read; as demais tools do escritório continuam negadas", () => {
    expect([...PROJECT_GRANT_SCOPES]).toEqual(["tasks:read", "files:read"]);
    for (const nome of ["aceleriq_escritorio_enviar", "aceleriq_escritorio_caixa", "aceleriq_escritorio_presenca", "aceleriq_escritorio_diretorio"]) {
      expect(authorizeGrantCall(grant, nome, {}).ok, nome).toBe(false);
    }
  });
});
