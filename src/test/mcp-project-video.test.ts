import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizeGrantCall,
  effectiveVideoWrite,
  filterToolsForGrant,
  finalizeProjectVideo,
  grantScopes,
  isMp4Header,
  isProjectOnlyTool,
  prepareProjectVideo,
  PROJECT_GRANT_ALLOWED_TOOLS,
  PROJECT_GRANT_WRITE_TOOLS,
  projectGrantAllowsTool,
  ProjectAccessError,
  requestProjectVideoReview,
  resolveGrantRows,
  VIDEO_MAX_BYTES,
  videoErrorFromDb,
  type ProjectGrant,
  type VideoPorts,
  type VideoSession,
} from "../../supabase/functions/_shared/mcp-project-access.ts";
import { executarFerramenta, type EntradaDaAuditoria } from "../../supabase/functions/mcp-server/modulos/executar-ferramenta.ts";
import { CacheCurto } from "../../supabase/functions/mcp-server/modulos/leitura-enxuta.ts";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENTE = U(1), PROJETO = U(11), OUTRO_PROJETO = U(12), TAREFA = U(301), OUTRA_TAREFA = U(302);
const leitura: ProjectGrant = { projectId: PROJETO, clientId: CLIENTE, operatorSlug: "corte" };
const escrita: ProjectGrant = { ...leitura, videoWrite: true };

/** MP4 sintético: caixa ftyp isom + bytes de enchimento (nenhum vídeo real). */
function mp4(tamanho = 4096, marca = "isom"): Uint8Array {
  const b = new Uint8Array(tamanho);
  b.set([0, 0, 0, 24], 0);
  b.set([..."ftyp"].map((c) => c.charCodeAt(0)), 4);
  b.set([...marca].map((c) => c.charCodeAt(0)), 8);
  for (let i = 24; i < tamanho; i++) b[i] = i % 251;
  return b;
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * Banco falso com a MESMA semântica das RPCs (sessão por chave+idempotency_key, objeto único, uma linha
 * de files e uma de task_attachments por sessão, pedido de revisão uma vez). `negar` simula a conferência
 * viva do banco (revogação, tarefa movida, autoria) devolvendo o erro com o código do RAISE.
 */
function bancoFalso() {
  const sessoes = new Map<string, VideoSession & { key: string; task: string }>();
  const objetos = new Map<string, Uint8Array>();
  const files: Array<{ id: string; path: string; agency: string }> = [{ id: U(900), path: "humano.mp4", agency: "not_requested" }];
  const anexos: Array<{ id: string; task: string; path: string }> = [{ id: U(901), task: TAREFA, path: "humano.mp4" }];
  const chamadas: string[] = [];
  const urls: string[] = [];
  let negar: string | null = null;
  let n = 0;
  const conferir = () => { if (negar) throw videoErrorFromDb(`ERROR: mcp_video:${negar}`); };
  const ports: VideoPorts = {
    async prepare({ taskId, sizeBytes, sha256, idempotencyKey }) {
      chamadas.push("prepare"); conferir();
      if (taskId !== TAREFA) throw videoErrorFromDb("mcp_video:tarefa");
      const existente = [...sessoes.entries()].find(([, s]) => s.key === idempotencyKey);
      if (existente) {
        const [id, s] = existente;
        if (s.task !== taskId || s.size_bytes !== sizeBytes || s.sha256 !== sha256) throw videoErrorFromDb("mcp_video:conflito");
        return { upload_id: id, status: s.status, storage_path: s.status === "prepared" ? s.storage_path : null, expires_at: "2026-11-23T23:00:00Z", reused: true };
      }
      const id = U(500 + ++n);
      const storage_path = `${CLIENTE}/mcp-project-video/${id}.mp4`;
      sessoes.set(id, { key: idempotencyKey, task: taskId, status: "prepared", storage_path, size_bytes: sizeBytes, sha256, file_id: null, attachment_id: null, object_bytes: null, object_id: null, object_version: null });
      return { upload_id: id, status: "prepared", storage_path, expires_at: "2026-11-23T23:00:00Z", reused: false };
    },
    async signedUploadUrl(path) {
      chamadas.push("signedUploadUrl");
      const url = `https://storage.invalid/upload/sign/mcp-files/${path}?token=segredo-${urls.length}`;
      urls.push(url);
      return url;
    },
    async open({ uploadId, idempotencyKey }) {
      chamadas.push("open"); conferir();
      const s = sessoes.get(uploadId);
      if (!s || s.key !== idempotencyKey) throw videoErrorFromDb("mcp_video:nao_encontrado");
      const bytes = objetos.get(s.storage_path);
      return { ...s, object_bytes: bytes?.byteLength ?? null, object_id: bytes ? U(650) : null, object_version: bytes ? sha(bytes) : null };
    },
    async inspect(path) {
      chamadas.push("inspect");
      const b = objetos.get(path);
      return b ? { size: b.byteLength, sha256: sha(b), head: b.subarray(0, 64) } : null;
    },
    async finalize({ uploadId, idempotencyKey, sizeBytes, sha256, headerOk, objectId, objectVersion }) {
      chamadas.push("finalize"); conferir();
      const s = sessoes.get(uploadId);
      if (!s || s.key !== idempotencyKey) throw videoErrorFromDb("mcp_video:nao_encontrado");
      if (s.status !== "prepared") return { status: s.status, file_id: s.file_id!, attachment_id: s.attachment_id!, reused: true };
      if (!headerOk || sizeBytes !== s.size_bytes || sha256 !== s.sha256 || objectId !== U(650) || objectVersion !== sha(objetos.get(s.storage_path)!)) throw videoErrorFromDb("mcp_video:objeto");
      const file = { id: U(700 + files.length), path: s.storage_path, agency: "not_requested" };
      const anexo = { id: U(800 + anexos.length), task: s.task, path: s.storage_path };
      files.push(file); anexos.push(anexo);
      Object.assign(s, { status: "finalized", file_id: file.id, attachment_id: anexo.id });
      return { status: "finalized", file_id: file.id, attachment_id: anexo.id, reused: false };
    },
    async requestReview({ uploadId, idempotencyKey }) {
      chamadas.push("requestReview"); conferir();
      const s = sessoes.get(uploadId);
      if (!s || s.key !== idempotencyKey) throw videoErrorFromDb("mcp_video:nao_encontrado");
      const f = files.find((x) => x.id === s.file_id);
      if (s.status === "review_requested") return { status: s.status, file_id: f!.id, agency_approval_status: f!.agency, reused: true };
      if (s.status !== "finalized" || !f || f.agency !== "not_requested") throw videoErrorFromDb("mcp_video:estado");
      f.agency = "pending"; s.status = "review_requested";
      return { status: "review_requested", file_id: f.id, agency_approval_status: "pending", reused: false };
    },
  };
  return {
    ports, sessoes, objetos, files, anexos, chamadas, urls,
    negarCom: (c: string | null) => { negar = c; },
    enviar: (uploadId: string, b: Uint8Array) => {
      const s = sessoes.get(uploadId)!;
      if (objetos.has(s.storage_path)) return false; // sem upsert: o segundo PUT não sobrescreve
      objetos.set(s.storage_path, b); return true;
    },
  };
}

const preparar = (b: Uint8Array, extra: Record<string, unknown> = {}) =>
  ({ task_id: TAREFA, tamanho_bytes: b.byteLength, sha256: sha(b), idempotency_key: "reel-skyfleet-01", confirmar: true as const, ...extra });
const sessao = (upload_id: string, extra: Record<string, unknown> = {}) =>
  ({ upload_id, idempotency_key: "reel-skyfleet-01", confirmar: true as const, ...extra });

describe("gate da escrita: fechado por padrão", () => {
  it("tools de escrita só existem com videoWrite; legado e leitura nunca as veem", () => {
    for (const nome of PROJECT_GRANT_WRITE_TOOLS) {
      expect(projectGrantAllowsTool(nome), nome).toBe(false);
      expect(projectGrantAllowsTool(nome, leitura), nome).toBe(false);
      expect(projectGrantAllowsTool(nome, { videoWrite: false }), nome).toBe(false);
      expect(projectGrantAllowsTool(nome, escrita), nome).toBe(true);
      expect(isProjectOnlyTool(nome), nome).toBe(true); // sem concessão: indisponível
      expect(authorizeGrantCall(leitura, nome, {}).ok).toBe(false);
    }
    const catalogo = [...PROJECT_GRANT_ALLOWED_TOOLS, ...PROJECT_GRANT_WRITE_TOOLS, "aceleriq_arquivos_enviar_para_aprovacao"].map((name) => ({ name }));
    expect(filterToolsForGrant(catalogo, leitura).map((t) => t.name)).toEqual([...PROJECT_GRANT_ALLOWED_TOOLS]);
    expect(filterToolsForGrant(catalogo, escrita).map((t) => t.name)).toEqual([...PROJECT_GRANT_ALLOWED_TOOLS, ...PROJECT_GRANT_WRITE_TOOLS]);
    // Escrita legada (Mesa/arquivos) continua negada mesmo com escrita de vídeo aberta.
    for (const nome of ["aceleriq_arquivos_enviar_para_aprovacao", "aceleriq_files_upload_prepare", "aceleriq_create_task"]) {
      expect(authorizeGrantCall(escrita, nome, {}).ok, nome).toBe(false);
    }
  });

  it("videoWrite exige opt-in da concessão E MCP_PROJECT_VIDEO_WRITE=true exatamente", () => {
    expect(effectiveVideoWrite(true, "true")).toBe(true);
    for (const [allow, flag] of [[false, "true"], [true, undefined], [true, ""], [true, "TRUE"], [true, "1"], [true, null], [false, undefined]] as const) {
      expect(effectiveVideoWrite(allow, flag), `${allow}/${flag}`).toBe(false);
    }
    expect(grantScopes(leitura)).toEqual(["tasks:read", "files:read"]);
    expect(grantScopes(escrita)).toEqual(["tasks:read", "files:read", "files:write"]);
  });

  it("allow_video_upload precisa ser booleano; qualquer outra coisa nega a chave", () => {
    const linha = (v: unknown) => [{ api_key_id: U(50), project_id: PROJETO, client_id: CLIENTE, operator_slug: "corte", allow_video_upload: v, created_by: U(60), created_at: "2026-11-23T10:00:00Z", revoked_at: null }];
    expect(resolveGrantRows(linha(true), U(50))?.allowVideoUpload).toBe(true);
    expect(resolveGrantRows(linha(false), U(50))?.allowVideoUpload).toBe(false);
    for (const v of ["true", 1, null, undefined]) expect(resolveGrantRows(linha(v), U(50)), String(v)).toBeNull();
  });

  it("destino, autoria e identidade nunca vêm do chamador", () => {
    for (const extra of [
      { bucket: "files" }, { storage_bucket: "mcp-files" }, { storage_path: `${CLIENTE}/x.mp4` }, { path: "x" }, { file_url: "mcp-files://x" },
      { upload_url: "https://x" }, { url: "https://x" }, { profile_id: U(2) }, { author_profile_id: U(2) }, { uploaded_by: U(2) },
      { operator: "corte" }, { operator_slug: "corte" }, { project_id: OUTRO_PROJETO }, { client_id: U(2) }, { api_key_id: U(3) }, { grant_id: U(4) },
    ]) {
      for (const nome of PROJECT_GRANT_WRITE_TOOLS) {
        const d = authorizeGrantCall(escrita, nome, { task_id: TAREFA, ...extra });
        expect(d.ok, `${nome} ${JSON.stringify(extra)}`).toBe(false);
      }
    }
    expect(authorizeGrantCall(escrita, "aceleriq_projeto_video_preparar", preparar(mp4())).ok).toBe(true);
  });
});

describe("formato MP4", () => {
  it("aceita ftyp de MP4 e recusa QuickTime, outro formato e cabeçalho curto/inválido", () => {
    for (const marca of ["isom", "mp42", "avc1", "iso5"]) expect(isMp4Header(mp4(64, marca)), marca).toBe(true);
    expect(isMp4Header(mp4(64, "qt  "))).toBe(false);
    expect(isMp4Header(mp4(64, "heic"))).toBe(false);
    expect(isMp4Header(new Uint8Array(8))).toBe(false);
    const semFtyp = mp4(64); semFtyp.set([..."moov"].map((c) => c.charCodeAt(0)), 4);
    expect(isMp4Header(semFtyp)).toBe(false);
    const caixaGigante = mp4(64); caixaGigante.set([0, 1, 0, 0], 0);
    expect(isMp4Header(caixaGigante)).toBe(false);
  });
});

describe("fluxo: preparar → PUT → finalizar → pedir revisão", () => {
  it("caminho feliz, sem efeito duplicado em nenhum retry", async () => {
    const db = bancoFalso();
    const video = mp4();
    const p1 = await prepareProjectVideo(db.ports, escrita, preparar(video));
    expect(p1).toMatchObject({ status: "prepared", metodo: "PUT", reaproveitado: false, cabecalhos: { "content-type": "video/mp4" } });
    expect(p1).not.toHaveProperty("storage_path"); // o caminho só aparece dentro da URL assinada
    const p2 = await prepareProjectVideo(db.ports, escrita, preparar(video));
    expect(p2.upload_id).toBe(p1.upload_id);
    expect(p2.reaproveitado).toBe(true);
    expect(db.sessoes.size).toBe(1);

    expect(db.enviar(p1.upload_id, video)).toBe(true);
    expect(db.enviar(p1.upload_id, mp4(4096, "mp42"))).toBe(false); // segundo PUT não troca o objeto

    const f1 = await finalizeProjectVideo(db.ports, escrita, sessao(p1.upload_id));
    expect(f1).toMatchObject({ status: "finalized", reaproveitado: false });
    const inspecoes = db.chamadas.filter((c) => c === "inspect").length;
    const f2 = await finalizeProjectVideo(db.ports, escrita, sessao(p1.upload_id));
    expect(f2).toMatchObject({ file_id: f1.file_id, anexo_id: f1.anexo_id, reaproveitado: true });
    expect(db.chamadas.filter((c) => c === "inspect").length).toBe(inspecoes); // retry não baixa de novo
    expect(db.files.filter((f) => f.path.includes(p1.upload_id))).toHaveLength(1);
    expect(db.anexos.filter((a) => a.path.includes(p1.upload_id))).toHaveLength(1);
    // Registro canônico e anexo apontam para o mesmo objeto.
    expect(db.files.find((f) => f.id === f1.file_id)!.path).toBe(db.anexos.find((a) => a.id === f1.anexo_id)!.path);

    const r1 = await requestProjectVideoReview(db.ports, escrita, sessao(p1.upload_id));
    expect(r1).toMatchObject({ status: "review_requested", revisao_agencia: "pending", reaproveitado: false });
    expect(r1.aviso).toMatch(/Nada foi aprovado/);
    const r2 = await requestProjectVideoReview(db.ports, escrita, sessao(p1.upload_id));
    expect(r2.reaproveitado).toBe(true);
    // Só o alvo: o anexo humano da mesma tarefa não entrou em revisão.
    expect(db.files.find((f) => f.id === U(900))!.agency).toBe("not_requested");
    expect(db.files.filter((f) => f.agency === "pending").map((f) => f.id)).toEqual([f1.file_id]);
  });

  it("objeto ausente, tamanho, sha256 ou formato divergente: nada é registrado", async () => {
    const naoMp4 = mp4(4096, "qt  ");
    const alterado = mp4(); alterado[100] ^= 1;
    // [caso, declarado no preparo, objeto enviado, baixa o objeto?]
    const casos: Array<[string, Uint8Array, Uint8Array | null, boolean]> = [
      ["ausente", mp4(), null, false],
      ["tamanho", mp4(), mp4(8192), false], // o tamanho registrado pelo Storage já reprova, sem baixar
      ["sha256", mp4(), alterado, true],
      ["formato", naoMp4, naoMp4, true], // tamanho e sha256 conferem; só o cabeçalho reprova
    ];
    for (const [nome, declarado, objeto, baixa] of casos) {
      const db = bancoFalso();
      const p = await prepareProjectVideo(db.ports, escrita, preparar(declarado));
      if (objeto) db.enviar(p.upload_id, objeto);
      await expect(finalizeProjectVideo(db.ports, escrita, sessao(p.upload_id)), nome).rejects.toMatchObject({ code: "invalid_object" });
      expect(db.chamadas, nome).not.toContain("finalize");
      expect(db.chamadas.includes("inspect"), nome).toBe(baixa);
      expect(db.files, nome).toHaveLength(1);
      expect(db.anexos, nome).toHaveLength(1);
    }
  });

  it("idempotency_key repetida com outros dados é conflito; confirmar e chave são obrigatórios", async () => {
    const db = bancoFalso();
    await prepareProjectVideo(db.ports, escrita, preparar(mp4()));
    await expect(prepareProjectVideo(db.ports, escrita, preparar(mp4(), { sha256: "b".repeat(64) }))).rejects.toMatchObject({ code: "conflict" });
    const antes = db.chamadas.length;
    for (const ruim of [{ confirmar: false }, { confirmar: undefined }, { idempotency_key: "curta" }, { idempotency_key: "com espaço!" }]) {
      await expect(prepareProjectVideo(db.ports, escrita, preparar(mp4(), ruim) as never), JSON.stringify(ruim)).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(prepareProjectVideo(db.ports, escrita, preparar(mp4(), { tamanho_bytes: VIDEO_MAX_BYTES + 1 }))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(prepareProjectVideo(db.ports, escrita, preparar(mp4(), { sha256: "A".repeat(64) }))).rejects.toMatchObject({ code: "invalid_input" });
    expect(db.chamadas.length).toBe(antes); // entrada ruim não chega ao banco
  });

  it("sem videoWrite nada chega ao banco nem ao Storage", async () => {
    const db = bancoFalso();
    await expect(prepareProjectVideo(db.ports, leitura, preparar(mp4()))).rejects.toMatchObject({ code: "denied" });
    await expect(finalizeProjectVideo(db.ports, leitura, sessao(U(501)))).rejects.toMatchObject({ code: "denied" });
    await expect(requestProjectVideoReview(db.ports, leitura, sessao(U(501)))).rejects.toMatchObject({ code: "denied" });
    expect(db.chamadas).toEqual([]);
  });

  it("revogação, tarefa movida e autoria alterada depois do preparo negam finalizar e pedir revisão", async () => {
    for (const [codigo, esperado] of [["negado", "denied"], ["tarefa", "task"], ["autoria", "author"]] as const) {
      const db = bancoFalso();
      const video = mp4();
      const p = await prepareProjectVideo(db.ports, escrita, preparar(video));
      db.enviar(p.upload_id, video);
      db.negarCom(codigo);
      await expect(finalizeProjectVideo(db.ports, escrita, sessao(p.upload_id)), codigo).rejects.toMatchObject({ code: esperado });
      expect(db.files).toHaveLength(1);
      db.negarCom(null);
      await finalizeProjectVideo(db.ports, escrita, sessao(p.upload_id));
      db.negarCom(codigo);
      await expect(requestProjectVideoReview(db.ports, escrita, sessao(p.upload_id)), codigo).rejects.toMatchObject({ code: esperado });
      expect(db.files.filter((f) => f.agency === "pending")).toHaveLength(0);
    }
  });

  it("tarefa de outro projeto e sessão de outra credencial/idempotency_key não servem", async () => {
    const db = bancoFalso();
    await expect(prepareProjectVideo(db.ports, escrita, preparar(mp4(), { task_id: OUTRA_TAREFA }))).rejects.toMatchObject({ code: "task" });
    const p = await prepareProjectVideo(db.ports, escrita, preparar(mp4()));
    await expect(finalizeProjectVideo(db.ports, escrita, sessao(p.upload_id, { idempotency_key: "outra-chave-123" }))).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("erros e trilha sem URL", () => {
  it("erro do banco vira código claro; a mensagem crua nunca passa", () => {
    const e = videoErrorFromDb('ERROR: mcp_video:negado CONTEXT: PL/pgSQL function ... https://x.invalid/token=abc');
    expect(e).toBeInstanceOf(ProjectAccessError);
    expect(e.code).toBe("denied");
    expect(e.message).not.toMatch(/https|token|PL\/pgSQL/);
    const desconhecido = videoErrorFromDb("duplicate key value violates unique constraint files_idempotency_key_uidx");
    expect(desconhecido.code).toBe("unavailable");
    expect(desconhecido.message).not.toContain("files_idempotency_key_uidx");
  });

  it("executarFerramenta: a URL assinada só vai na resposta; auditoria e cache não a guardam", async () => {
    const db = bancoFalso();
    const auditoria: EntradaDaAuditoria[] = [];
    const cache = new CacheCurto();
    const tool = {
      name: "aceleriq_projeto_video_preparar",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: false, idempotentHint: true },
      handler: (input: unknown) => prepareProjectVideo(db.ports, escrita, input as never),
    };
    const out = await executarFerramenta(tool, preparar(mp4()), { keyId: U(50), origin: null, scopes: ["files:write"], cachePrincipal: "k#p#corte" }, {
      auditar: async (e) => { auditoria.push(e); },
      ehForaDoEscopo: () => false,
      cache,
    });
    expect(out.tipo).toBe("ok");
    expect(JSON.stringify(out)).toContain(db.urls[0]);
    expect(JSON.stringify(auditoria)).not.toContain("storage.invalid");
    expect(JSON.stringify(auditoria)).not.toContain("token=");
    expect(auditoria).toHaveLength(1);
  });
});

describe("migration (texto): contrato do banco", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261123130000_mcp_project_video_upload.sql"), "utf8");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const corpo = (nome: string) => {
    const i = codigo.indexOf(`FUNCTION public.${nome}(`);
    return codigo.slice(i, codigo.indexOf("$$;", i));
  };

  it("RPCs definidoras, search_path vazio, só service_role executa", () => {
    for (const f of ["mcp_project_video_prepare", "mcp_project_video_open", "mcp_project_video_finalize", "mcp_project_video_request_review", "mcp_project_video_contexto", "mcp_project_video_sessao"]) {
      expect(corpo(f), f).toContain("SECURITY DEFINER");
      expect(corpo(f), f).toContain("SET search_path = ''");
    }
    expect(codigo).toMatch(/REVOKE ALL ON FUNCTION public\.mcp_project_video_contexto\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
    expect(codigo).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.mcp_project_video_(prepare|open|finalize|request_review)\([^)]*\) TO [^;]*\b(anon|authenticated)\b/);
    expect(codigo).toMatch(/GRANT SELECT ON public\.mcp_project_video_uploads TO service_role;/);
    expect(codigo).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*mcp_project_video_uploads/);
  });

  it("conferência viva na mesma transação: chave, concessão com opt-in, operador, projeto, autoria e carteira", () => {
    const ctx = corpo("mcp_project_video_contexto");
    expect(ctx).toContain("k.scopes = ARRAY['mcp:project']::text[]");
    expect(ctx).toContain("_g.allow_video_upload IS NOT TRUE");
    expect(ctx).toContain("_g.revoked_at IS NOT NULL");
    expect(ctx).toContain("o.status = 'active' FOR SHARE");
    expect(ctx).toContain("FOR SHARE OF p");
    expect(ctx).toContain("public.mcp_author_profile_is_dedicated(_b.profile_id)");
    expect(ctx).toContain("public.team_client_assignments");
    const sessao = corpo("mcp_project_video_sessao");
    expect(sessao).toContain("FOR UPDATE");
    expect(sessao).toContain("_t.project_id IS DISTINCT FROM _s.project_id");
    expect(sessao).toContain("_t.status IS DISTINCT FROM _s.task_status");
    expect(sessao).toContain("_t.assigned_to IS DISTINCT FROM _s.task_assigned_to");
    for (const f of ["mcp_project_video_open", "mcp_project_video_finalize", "mcp_project_video_request_review"]) {
      expect(corpo(f), f).toContain("public.mcp_project_video_sessao(p_api_key_id, p_upload_id, p_idempotency_key)");
    }
  });

  it("autoria: perfil dedicado não-admin; nunca cliente, admin, manager ou o próprio configurador", () => {
    const d = corpo("mcp_author_profile_is_dedicated");
    expect(d).toContain("'admin'::public.app_role, 'manager'::public.app_role, 'client'::public.app_role");
    expect(d).toContain("NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.client_id = p_profile_id)");
    expect(codigo).toContain("CHECK (profile_id <> configured_by)");
    expect(codigo).toContain("r.role = 'admin'::public.app_role");
    expect(codigo).toContain("ON public.mcp_operator_author_profiles (profile_id)");
    expect(codigo).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i); // nenhum UUID fixo
  });

  it("gate: reaproveita request_file_agency_review e nunca aprova, libera, agenda, publica ou notifica", () => {
    const r = corpo("mcp_project_video_request_review");
    expect(r).toContain("PERFORM public.request_file_agency_review(_s.file_id);");
    expect(codigo).not.toMatch(/review_file_agency|release_file_to_client|decide_file_approval|aprovar_pelo_cliente|admin_release_file|editorial_publications|notifications|avisar_equipe|net\.http|pg_net/);
    expect(codigo).not.toMatch(/INSERT INTO public\.file_approval_events|UPDATE public\.files/);
    // Identidade emprestada só durante a chamada e restaurada depois.
    expect(r.indexOf("set_config('request.jwt.claim.sub', _s.author_profile_id::text, true)")).toBeLessThan(r.indexOf("request_file_agency_review"));
    expect(r.indexOf("set_config('request.jwt.claim.sub', coalesce(_sub, ''), true)")).toBeGreaterThan(r.indexOf("request_file_agency_review"));
  });

  it("finalização: objeto do Storage conferido, um files + um anexo, mesmo objeto, sem URL no banco", () => {
    const f = corpo("mcp_project_video_finalize");
    expect(f).toContain("FROM storage.objects o");
    expect(f).toContain("lower(coalesce(o.metadata ->> 'mimetype', '')) = 'video/mp4'");
    expect(f).toContain("(o.metadata ->> 'size')::bigint = _s.size_bytes");
    expect(f).toContain("INSERT INTO public.files");
    expect(f).toContain("INSERT INTO public.task_attachments");
    expect(f).toContain("_url := 'mcp-files://' || _s.storage_path;");
    expect(f).toContain("'mcp-project-video:' || _s.id::text");
    expect(codigo).not.toMatch(/signed_?url|upload_url|\btoken\b|https?:\/\//i);
    expect(codigo).toContain("CHECK (size_bytes BETWEEN 1024 AND 104857600)");
    expect(VIDEO_MAX_BYTES).toBe(104857600);
  });

  it("aditiva: não altera tabelas existentes além de tirar o CHECK = false da concessão", () => {
    expect(codigo).not.toMatch(/ALTER TABLE public\.(files|tasks|task_attachments|projects|profiles|api_keys|file_approval_events)\b/);
    expect(codigo).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|DISABLE ROW LEVEL SECURITY/);
    expect(codigo).toMatch(/ALTER TABLE public\.mcp_project_grants DROP CONSTRAINT/);
  });
});
