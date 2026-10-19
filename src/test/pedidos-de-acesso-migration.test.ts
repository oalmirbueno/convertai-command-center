import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_VERSION } from "../../supabase/functions/_shared/mcp-release";

/**
 * Pedidos de acesso dos agentes (17/10/2026, MCP 2.13.0). Confere o contrato do banco que a tela e o MCP usam:
 * RLS só para admin/gestor, a coluna `codigo` fora do alcance do front, o aviso ao dono sem senha nem código,
 * as RPCs com os nomes combinados e a migration declarada no manifesto e na baseline de produção.
 */
const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const NOME = "20261017190000_pedidos_de_acesso.sql";
const CAMINHO = `supabase/migrations/${NOME}`;
const sql = ler(CAMINHO);
const semComentario = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

function funcao(nome: string): string {
  const inicio = semComentario.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  expect(inicio, `${nome} ausente`).toBeGreaterThanOrEqual(0);
  const fim = semComentario.indexOf("$function$;", inicio);
  return semComentario.slice(inicio, fim > 0 ? fim : undefined);
}

describe("pedidos_de_acesso: tabela e RLS", () => {
  it("cria a tabela com as colunas do contrato e liga RLS", () => {
    for (const coluna of [
      "operador_slug text NOT NULL", "client_id uuid", "kanban_task_id uuid",
      "tipo text NOT NULL CHECK (tipo IN ('senha', 'codigo', 'conectar', 'outro'))",
      "site text NOT NULL", "mensagem text NOT NULL", "link_para_conectar text", "print_path text",
      "status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'respondido', 'usado', 'cancelado', 'expirado'))",
      "vault_item_id uuid REFERENCES public.client_vault(id) ON DELETE SET NULL",
      "codigo text", "expira_em timestamptz", "respondido_por uuid", "respondido_em timestamptz", "usado_em timestamptz",
    ]) {
      expect(semComentario).toContain(coluna);
    }
    expect(semComentario).toContain("ALTER TABLE public.pedidos_de_acesso ENABLE ROW LEVEL SECURITY;");
    expect(semComentario).toContain("ADD COLUMN IF NOT EXISTS agentes_podem_usar boolean NOT NULL DEFAULT false");
  });

  it("só admin e gestor leem; ninguém escreve direto", () => {
    const politica = semComentario.slice(semComentario.indexOf("CREATE POLICY pedidos_de_acesso_select"));
    expect(politica).toMatch(/FOR SELECT TO authenticated/);
    expect(politica).toContain("'admin'::public.app_role");
    expect(politica).toContain("'manager'::public.app_role");
    expect(semComentario).not.toMatch(/CREATE POLICY[^;]*ON public\.pedidos_de_acesso\s+FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(semComentario).toContain("REVOKE ALL ON public.pedidos_de_acesso FROM PUBLIC, anon, authenticated;");
  });

  it("a coluna codigo não tem SELECT para authenticated", () => {
    const grant = /GRANT SELECT \(([^)]*)\) ON public\.pedidos_de_acesso TO authenticated;/.exec(semComentario);
    expect(grant).not.toBeNull();
    const colunas = grant![1].split(",").map((c) => c.trim());
    expect(colunas).not.toContain("codigo");
    for (const c of ["id", "status", "tipo", "site", "print_path", "vault_item_id", "expira_em", "usado_em"]) {
      expect(colunas).toContain(c);
    }
    expect(semComentario).not.toMatch(/GRANT SELECT ON public\.pedidos_de_acesso TO authenticated/);
  });

  it("bucket privado dos prints, leitura só admin e gestor", () => {
    expect(semComentario).toContain("VALUES ('pedidos-de-acesso', 'pedidos-de-acesso', false,");
    const politica = semComentario.slice(semComentario.indexOf('CREATE POLICY "pedidos-de-acesso: admin e gestor leem"'));
    expect(politica).toContain("FOR SELECT");
    expect(politica).toContain("storage.objects.bucket_id = 'pedidos-de-acesso'");
  });
});

describe("pedidos_de_acesso: RPCs", () => {
  it("as cinco RPCs da tela existem com as assinaturas combinadas, security definer e search_path fixo", () => {
    const assinaturas: Record<string, string> = {
      "public.pedido_acesso_responder_senha": "p_pedido uuid,\n  p_client_id uuid,\n  p_titulo text,\n  p_usuario text,\n  p_senha text,\n  p_lembrar boolean\n)\nRETURNS uuid",
      "public.pedido_acesso_responder_codigo": "p_pedido uuid, p_codigo text)\nRETURNS void",
      "public.pedido_acesso_marcar_feito": "p_pedido uuid)\nRETURNS void",
      "public.pedido_acesso_cancelar": "p_pedido uuid)\nRETURNS void",
      "public.cofre_agentes_podem_usar": "p_item uuid, p_pode boolean)\nRETURNS void",
    };
    for (const [nome, assinatura] of Object.entries(assinaturas)) {
      const corpo = funcao(nome);
      expect(corpo, nome).toContain(assinatura);
      expect(corpo, nome).toContain("SECURITY DEFINER");
      expect(corpo, nome).toContain("SET search_path TO 'public'");
      expect(corpo, nome).toContain("app_private.pedido_acesso_exigir_equipe()");
    }
    const exigir = semComentario.slice(semComentario.indexOf("FUNCTION app_private.pedido_acesso_exigir_equipe()"));
    expect(exigir).toContain("'admin'::public.app_role");
    expect(exigir).toContain("'manager'::public.app_role");
  });

  it("responder senha grava no cofre como 'acesso' com agentes_podem_usar = lembrar e liga ao pedido", () => {
    const corpo = funcao("public.pedido_acesso_responder_senha");
    expect(corpo).toContain("'acesso'");
    expect(corpo).toContain("agentes_podem_usar = COALESCE(p_lembrar, false)");
    expect(corpo).toContain("vault_item_id = _item");
    expect(corpo).toContain("_cliente := COALESCE(_pedido.client_id, p_client_id);");
  });

  it("código vale 10 minutos e sai uma vez só, pela chave de serviço", () => {
    expect(funcao("public.pedido_acesso_responder_codigo")).toContain("expira_em = now() + interval '10 minutes'");
    const retirar = funcao("public.pedido_acesso_retirar_codigo");
    expect(retirar).toContain("FOR UPDATE");
    expect(retirar).toMatch(/codigo = NULL,\s*status = 'usado',\s*usado_em = now\(\)/);
    expect(semComentario).toContain("REVOKE ALL ON FUNCTION public.pedido_acesso_retirar_codigo(uuid, text) FROM PUBLIC, anon, authenticated;");
    expect(semComentario).toContain("GRANT EXECUTE ON FUNCTION public.pedido_acesso_retirar_codigo(uuid, text) TO service_role;");
  });
});

describe("pedidos_de_acesso: aviso ao dono", () => {
  it("gatilho AFTER INSERT avisa os admins com link /execucao?acesso=<id>, sem senha nem código", () => {
    expect(semComentario).toMatch(/CREATE TRIGGER trg_pedido_acesso_avisar\s+AFTER INSERT ON public\.pedidos_de_acesso/);
    const corpo = funcao("public.pedido_acesso_avisar");
    expect(corpo).toContain("INSERT INTO public.notifications");
    expect(corpo).toContain("ur.role = 'admin'");
    expect(corpo).toContain("'/execucao?acesso=' || NEW.id::text");
    for (const frase of [" precisa da senha de ", " precisa do código de ", " precisa que você conecte ", " precisa de você em "]) {
      expect(corpo).toContain(frase);
    }
    expect(corpo).not.toMatch(/NEW\.codigo|password|p_senha|NEW\.mensagem|client_vault/i);
  });

  it("o aviso de acesso também sai por e-mail", () => {
    expect(funcao("public.notificacao_merece_email")).toContain("'acesso_pedido'");
  });
});

describe("pedidos_de_acesso: manifesto, baseline e MCP", () => {
  it("a migration está no manifesto e na baseline de produção", () => {
    expect(ler("supabase/migration-manifest.sha256")).toContain(`  ${CAMINHO}`);
    const baseline = JSON.parse(ler("supabase/production-migration-baseline.json"));
    const entrada = baseline.forward_migrations.find((m: { path: string }) => m.path === CAMINHO);
    expect(entrada).toBeTruthy();
    expect(entrada.remote_name).toBe("pedidos_de_acesso");
  });

  it("MCP 2.13.0 registra as três ferramentas e ensina o caminho nas instruções", () => {
    expect(MCP_VERSION).toBe("2.16.0");
    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    for (const nome of ["aceleriq_acesso_pedir", "aceleriq_acesso_estado", "aceleriq_acesso_usar"]) {
      expect(tools).toContain(`name: '${nome}'`);
    }
    expect(tools).toContain("  acessoPedirTool,\n  acessoEstadoTool,\n  acessoUsarTool,\n");
    expect(ler("supabase/functions/mcp-server/index.ts")).toContain("COMO_PEDIR_ACESSO");
    const regras = ler("supabase/functions/mcp-server/modulos/acesso-regras.ts");
    expect(regras).toContain("NUNCA escreva senha ou código em diário, comentário, tarefa, relatório ou mensagem");
  });

  it("a senha só é lida num lugar do módulo e nunca vai para a referência da auditoria", () => {
    const modulo = ler("supabase/functions/mcp-server/modulos/acesso.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(modulo.match(/select\('[^']*password/g)?.length).toBe(1);
    const refs = modulo.match(/resultRefHolder\.value = [^;]*;/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r).not.toMatch(/senha|password|\bcodigo\b/);
    expect(modulo).not.toMatch(/console\.(log|info|warn|error)/);
  });
});
