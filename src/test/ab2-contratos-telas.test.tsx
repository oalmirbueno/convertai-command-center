import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Anti-bug 26/09, 2a rodada (frente AB2-CONTRATOS): contrato entre telas e
 * Edge Functions.
 * 1. o cartão "Servidor MCP" mostrava "HTTP 405" (GET sem descoberta);
 * 2. a ponte Ops aposentada gravava sync_error em todo registro salvo;
 * 3. e-mail malformado no quiz falhava sem motivo;
 * 4. foto HEIC no OCR do Estúdio era recusada sem dizer o que fazer;
 * 5. o Dashboard mostrava à equipe ações que o servidor só deixa o admin fazer (403);
 * 6. Origin estrito quebrava localhost e a prévia do Lovable;
 * 7. o agente contava todos os documentos, não os que foram ao modelo.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mock.invoke }, from: mock.from, rpc: vi.fn() },
}));

import { decidirGet, descobertaDoMcp, getPedeStream } from "../../supabase/functions/_shared/mcp-descoberta";
import { respostaDePonteAposentada } from "../../supabase/functions/_shared/ponte-ops-aposentada";
import { comOrigemDoPainel, origemDoPainelPermitida, origensDoPainel } from "../../supabase/functions/_shared/origem-do-painel";
import { emailDoLeadValido as emailNoServidor, ERRO_EMAIL_INVALIDO } from "../../supabase/functions/submit-quiz/email-do-lead";
import { conferirImagemDoOcr, FRASE_HEIC as FRASE_HEIC_SERVIDOR } from "../../supabase/functions/workspace-ocr/formato-da-imagem";
import { montarBlocosDeDocumentos } from "../../supabase/functions/voice-assistant-agent/documentos-enviados";
import { notifyOpsDelete, notifyOpsProject, ponteOpsLigada } from "@/lib/opsSync";
import { notifyOpsTaskDeleted, notifyOpsTaskUpdated } from "@/lib/opsTaskSync";
import { emailDoLeadValido, FRASE_EMAIL_INVALIDO, motivoDoErroDoQuiz } from "@/lib/emailDoLead";
import { ehHeic, FRASE_HEIC, imagemParaOcr, pareceImagem } from "@/lib/imagemParaOcr";
import { acoesRapidasDoPapel } from "@/lib/acoesRapidasDoPapel";
import QuizPublicPage from "@/pages/QuizPublicPage";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mock.invoke.mockReset();
  mock.from.mockReset();
});

describe("AB2: contratos entre telas e funções", () => {
  it("1. mcp-server: o GET do painel recebe a descoberta; sem Bearer segue o desafio OAuth e pedindo stream segue 405", () => {
    // O painel (MCPManager) faz GET com Bearer e o Accept padrão do fetch (*/*).
    const painel = ler("src/components/admin/MCPManager.tsx");
    expect(painel).toContain('fetch(MCP_URL, { method: "GET", headers })');
    expect(decidirGet({ authorization: "Bearer sessao", accept: "*/*" })).toBe("descoberta");
    expect(decidirGet({ authorization: "Bearer mcp-status-probe", accept: null })).toBe("descoberta");
    // O que a spec pede (Accept com text/event-stream) continua 405; sem Bearer, 401 do OAuth.
    expect(decidirGet({ authorization: "Bearer x", accept: "text/event-stream" })).toBe("sem_stream");
    expect(decidirGet({ authorization: "", accept: "application/json" })).toBe("desafio_oauth");
    expect(getPedeStream("text/*")).toBe(false);

    // Os campos que o cartão lê existem, e o Segundo Cérebro sai só como "configurado ou não".
    const d = descobertaDoMcp({
      servidor: { name: "aceleriq-mcp", title: "Aceleriq OS MCP", version: "2.3.0" },
      protocolVersion: "2025-06-18",
      toolCount: 120,
      segundoCerebroConfigurado: true,
      agora: new Date("2026-09-26T10:00:00Z"),
    });
    expect(d).toMatchObject({ name: "aceleriq-mcp", version: "2.3.0", status: "ok", protocolVersion: "2025-06-18", toolCount: 120, serverTime: "2026-09-26T10:00:00.000Z" });
    expect(d.secondBrain).toEqual({ configured: true });

    // O servidor usa a decisão no GET, antes do POST, e o POST não mudou.
    const servidor = ler("supabase/functions/mcp-server/index.ts");
    const get = servidor.indexOf('if (req.method === "GET") {');
    expect(get).toBeGreaterThan(0);
    expect(servidor.indexOf("decidirGet({", get)).toBeGreaterThan(get);
    expect(servidor.indexOf("descobertaDoMcp({", get)).toBeLessThan(servidor.indexOf('if (req.method !== "POST")'));
    expect(servidor).toContain('Allow: "POST, OPTIONS"');
    expect(servidor).toContain("const auth = await authenticate(req);");
  });

  it("2. ponte Ops aposentada: o painel não chama nem grava sync_error, e a função responde 200 aposentada", async () => {
    const fetchEspiao = vi.fn(() => Promise.resolve(new Response("{}", { status: 503 })));
    vi.stubGlobal("fetch", fetchEspiao);
    expect(ponteOpsLigada()).toBe(false);
    notifyOpsProject({ id: "p1", name: "Projeto" });
    notifyOpsDelete("project", "p1");
    notifyOpsTaskUpdated("t1");
    notifyOpsTaskDeleted("t1", null);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchEspiao).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled(); // nem "pendente", nem sync_error

    // Religar é explícito (mesma chave do servidor, no painel).
    vi.stubEnv("VITE_OPS_LEGACY_BRIDGE_ENABLED", "true");
    expect(ponteOpsLigada()).toBe(true);

    // Bundle antigo em cache: 200 sem ok:false vira "synced", nunca sync_error.
    const r = respostaDePonteAposentada({ "Access-Control-Allow-Origin": "*" });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ aposentada: true, enviado: false, code: "ops_bridge_retired" });
    expect(r.ok && corpo.ok !== false).toBe(true); // a regra do opsSync antigo

    for (const funcao of ["notify-ops", "portal-to-ops"]) {
      const codigo = ler(`supabase/functions/${funcao}/index.ts`);
      expect(codigo).toContain("respostaDePonteAposentada(");
      expect(codigo).not.toContain("opsBridgeRetiredResponse(");
    }
  });

  it("3. submit-quiz: e-mail malformado volta 400 com código e frase; a tela confere antes e mostra o motivo", async () => {
    for (const [email, valido] of [
      ["", true], ["nome@empresa.com.br", true], [" nome@empresa.com ", true],
      ["joao@gmail", false], ["joao gmail.com", false], ["a@@b.com", false], ["joao@ gmail.com", false],
    ] as const) {
      expect(emailNoServidor(email), email).toBe(valido);
      expect(emailDoLeadValido(email), email).toBe(valido); // mesma régua dos dois lados
    }
    expect(ERRO_EMAIL_INVALIDO).toMatchObject({ code: "email_invalido", field: "lead_email" });
    expect(ERRO_EMAIL_INVALIDO.message).toBe(FRASE_EMAIL_INVALIDO);
    const funcao = ler("supabase/functions/submit-quiz/index.ts");
    expect(funcao).toContain("return json(ERRO_EMAIL_INVALIDO, 400);");
    expect(funcao).toContain('throw new Error("invalid_email");');

    // O motivo sai do corpo do erro do SDK.
    const erroDoSdk = { message: "Edge Function returned a non-2xx status code", context: { json: () => Promise.resolve(ERRO_EMAIL_INVALIDO) } };
    expect(await motivoDoErroDoQuiz(erroDoSdk)).toEqual({ code: "email_invalido", message: FRASE_EMAIL_INVALIDO });
    expect(await motivoDoErroDoQuiz(new Error("rede"))).toEqual({ code: null, message: null });

    // Na tela: com e-mail pela metade, o aviso aparece ao sair do campo e o botão não deixa seguir.
    mock.invoke.mockResolvedValue({ data: { data: { status: "draft", lead_name: "" } }, error: null });
    render(
      <MemoryRouter initialEntries={["/quiz/abc"]}>
        <Routes><Route path="/quiz/:token" element={<QuizPublicPage />} /></Routes>
      </MemoryRouter>,
    );
    const email = await screen.findByPlaceholderText("voce@empresa.com");
    fireEvent.change(screen.getByPlaceholderText("Como podemos te chamar?"), { target: { value: "João" } });
    fireEvent.change(email, { target: { value: "joao@gmail" } });
    fireEvent.blur(email);
    expect(await screen.findByText(FRASE_EMAIL_INVALIDO)).toBeInTheDocument();
    const comecar = screen.getByRole("button", { name: /Começar diagnóstico/ });
    expect(comecar).toBeDisabled();
    fireEvent.change(email, { target: { value: "joao@gmail.com" } });
    await waitFor(() => expect(screen.queryByText(FRASE_EMAIL_INVALIDO)).not.toBeInTheDocument());
    expect(comecar).not.toBeDisabled();
    // O salvamento automático nunca manda o e-mail pela metade (o servidor recusaria tudo).
    await waitFor(() => expect(mock.invoke.mock.calls.some(([, o]) => o?.body?.action === "save_progress")).toBe(true), { timeout: 2000 });
    for (const [, opcoes] of mock.invoke.mock.calls) {
      if (opcoes?.body?.action === "save_progress") expect(emailDoLeadValido(opcoes.body.lead_email)).toBe(true);
    }
  });

  it("4. workspace-ocr: HEIC é convertido no navegador quando dá; se não dá, a frase diz o que fazer (e o servidor também)", async () => {
    // Servidor: código e frase por caso, antes de gastar a cota.
    expect(conferirImagemDoOcr("data:image/heic;base64,AAAA")).toMatchObject({ ok: false, status: 415, code: "formato_heic", error: FRASE_HEIC_SERVIDOR });
    expect(conferirImagemDoOcr("data:image/bmp;base64,AAAA")).toMatchObject({ ok: false, status: 415, code: "formato_nao_suportado" });
    expect(conferirImagemDoOcr(undefined)).toMatchObject({ ok: false, status: 400, code: "imagem_ausente" });
    expect(conferirImagemDoOcr("data:image/jpeg;base64,AAAA")).toEqual({ ok: true });
    expect(FRASE_HEIC).toBe(FRASE_HEIC_SERVIDOR);
    const funcao = ler("supabase/functions/workspace-ocr/index.ts");
    expect(funcao.indexOf("conferirImagemDoOcr(image)")).toBeLessThan(funcao.indexOf('caller.rpc("claim_ai_usage"'));

    // Navegador: HEIC sem tipo (Windows) ainda é reconhecido pelo nome.
    const heic = new File([new Uint8Array([0, 1, 2])], "IMG_0001.HEIC", { type: "" });
    expect(ehHeic(heic)).toBe(true);
    expect(pareceImagem(heic)).toBe(true);
    await expect(imagemParaOcr(heic, () => Promise.reject(new Error("não abre")))).rejects.toThrow(FRASE_HEIC);
    await expect(imagemParaOcr(heic, () => Promise.resolve("data:image/jpeg;base64,/9j/"))).resolves.toBe("data:image/jpeg;base64,/9j/");
    // Formato aceito vai como está, sem conversão.
    const png = new File([new Uint8Array([137, 80, 78, 71])], "print.png", { type: "image/png" });
    const conversor = vi.fn();
    expect(await imagemParaOcr(png, conversor)).toMatch(/^data:image\/png;base64,/);
    expect(conversor).not.toHaveBeenCalled();
    // A tela usa a conversão e mostra o motivo que o servidor mandou.
    const estudio = ler("src/components/workspace/StudioPanel.tsx");
    expect(estudio).toContain("const dataUrl = await imagemParaOcr(file);");
    expect(estudio).toContain('throw new Error(await mensagemDaFuncao(error, "OCR falhou"))');
    // Sem API que o Safari 11 não tem.
    expect(ler("src/lib/imagemParaOcr.ts")).not.toContain("createImageBitmap(");
  });

  it("5. Dashboard: a equipe não vê o que o servidor só deixa o admin fazer", () => {
    const acoes = [
      { label: "Novo Projeto", soAdmin: true },
      { label: "Novo Cliente", soAdmin: true },
      { label: "Nova Ata de Reunião", soAdmin: true },
      { label: "Gerar Link Briefing" },
      { label: "Gerar link de quiz" },
      { label: "Upload" },
    ];
    expect(acoesRapidasDoPapel(false, acoes).map((a) => a.label)).toEqual(["Gerar Link Briefing", "Gerar link de quiz", "Upload"]);
    expect(acoesRapidasDoPapel(true, acoes)).toHaveLength(6);

    const tela = ler("src/pages/AdminDashboard.tsx");
    for (const rotulo of ["Novo Projeto", "Novo Cliente", "Nova Ata de Reunião"]) {
      const linha = tela.split("\n").find((l) => l.includes(`label: "${rotulo}"`)) || "";
      expect(linha, rotulo).toContain("soAdmin: true");
    }
    expect(tela).toContain("const quickActions = acoesRapidasDoPapel(isAdmin, [");
    // O "..." do projeto (editar, status, progresso, excluir: RLS só admin) some para a equipe.
    const botaoDoMenu = tela.indexOf('aria-label="Ações do projeto"');
    expect(tela.lastIndexOf("{isAdmin && (", botaoDoMenu)).toBeGreaterThan(tela.lastIndexOf("<PipelineBar", botaoDoMenu));
    expect(tela).toContain("{isAdmin && showMenu && (");
    expect(tela).toContain('else toast.info("Só o administrador edita projetos.");');
    // O papel vem do mesmo lugar das outras telas.
    expect(tela).toContain('const isAdmin = profile?.role === "admin";');
  });

  it("6. Origin: painel, www, prévia do Lovable e localhost passam; qualquer outra origem leva 403", async () => {
    const lista = origensDoPainel("https://aceleriq.online");
    for (const ok of [
      "https://aceleriq.online",
      "https://www.aceleriq.online",
      "https://96b08aa1-81bd-4fdc-b0a4-69d220daf3fe.lovableproject.com",
      "https://id-preview--96b08aa1-81bd-4fdc-b0a4-69d220daf3fe.lovable.app",
      "https://orbital-command-hq.lovable.app",
      "https://preview--orbital-command-hq.lovable.app",
      "http://localhost:8080",
      "http://127.0.0.1:5173",
    ]) expect(origemDoPainelPermitida(ok, lista), ok).toBe(true);
    for (const nao of [
      "https://evil.example",
      "https://aceleriq.online.evil.example",
      "https://outro-projeto.lovable.app",
      "https://preview--outro.lovable.app",
      "http://aceleriq.online",
      "null",
      "",
    ]) expect(origemDoPainelPermitida(nao, lista), nao).toBe(false);
    // Sem Origin (servidor chamando servidor) passa, como antes.
    expect(origemDoPainelPermitida(null, lista)).toBe(true);

    const handler = vi.fn(() => new Response("{}", { headers: { "Access-Control-Allow-Origin": "https://aceleriq.online" } }));
    const servir = comOrigemDoPainel("https://aceleriq.online", handler);
    const local = await servir(new Request("https://fn.example/submit-quiz", { method: "POST", headers: { Origin: "http://localhost:8080" } }));
    expect(local.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8080");
    expect(local.headers.get("Vary")).toContain("Origin");
    const estranho = await servir(new Request("https://fn.example/submit-quiz", { method: "POST", headers: { Origin: "https://evil.example" } }));
    expect(estranho.status).toBe(403);
    expect(await estranho.json()).toMatchObject({ code: "origem_nao_permitida" });
    expect(handler).toHaveBeenCalledTimes(1);

    for (const funcao of ["client-first-access", "notify-admin", "submit-quiz"]) {
      const codigo = ler(`supabase/functions/${funcao}/index.ts`);
      expect(codigo, funcao).toContain("serve(comOrigemDoPainel(APP_ORIGIN, async (req) => {");
      expect(codigo, funcao).not.toContain("origin !== APP_ORIGIN");
    }
  });

  it("7. agente: _documentsCount conta só os documentos que foram ao modelo", () => {
    const docs = Array.from({ length: 7 }, (_, i) => ({ fileName: `doc-${i}.pdf`, text: "x".repeat(12000), source: "anexo" }));
    const r = montarBlocosDeDocumentos(docs);
    expect(r.enviados).toBe(5); // 5 x 12.000 = 60.000, o teto
    expect(r.deFora).toBe(2);
    expect(r.blocos).toHaveLength(5);
    expect(montarBlocosDeDocumentos(docs.slice(0, 2)).enviados).toBe(2);

    const servidor = ler("supabase/functions/voice-assistant-agent/index.ts");
    expect(servidor).toContain("parsed._documentsCount = documentosDoPedido.enviados;");
    expect(servidor).not.toContain("parsed._documentsCount = allDocs.length;");
    expect(servidor).toContain("const docBlocks = documentosDoPedido.blocos;");
  });
});
