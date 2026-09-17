import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPOS_DA_EMPRESA, CAMPOS_DE_QUALIFICACAO } from "@/lib/comercial";

/**
 * CRM (2026-09-17, segunda rodada).
 *
 * Dez prospects foram cadastrados com "Empresa" preenchida e a aba Empresas
 * ficou vazia: 12 leads com empresa em texto, 0 fichas. O contexto rico que o
 * agente levantou foi parar em "Notas" (e se perdeu). Regras pinadas aqui:
 * a ficha nasce no BANCO a partir do lead, o contexto tem campo próprio, dá
 * para apagar um lead de verdade, e o funil tem dinâmica própria no celular.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const migracao = ler("supabase/migrations/20260917200000_crm_empresa_automatica_e_ficha_rica.sql");
const lib = ler("src/lib/comercial.ts");
const pagina = ler("src/pages/AdminComercial.tsx");
const empresas = ler("src/components/comercial/EmpresasCRM.tsx");
const kanban = ler("src/components/comercial/FunilKanban.tsx");
const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const servico = ler("supabase/functions/_shared/aceleriq-commercial-services.ts");

describe("a empresa do lead vira ficha sozinha, no banco", () => {
  it("o gatilho roda antes de inserir e de editar, acha pelo nome e só cria se não existir", () => {
    expect(migracao).toContain("BEFORE INSERT OR UPDATE OF company, organization_id, name, email, whatsapp ON public.commercial_leads");
    expect(migracao).toContain("WHERE lower(btrim(o.name)) = lower(_empresa) AND o.archived_at IS NULL");
    expect(migracao).toContain("NEW.organization_id := _org;");
  });

  it("só vira contato quem é pessoa de verdade e tem meio de contato", () => {
    expect(migracao).toContain("AND lower(_pessoa) IS DISTINCT FROM lower(COALESCE(_empresa, ''))");
    expect(migracao).toContain("NEW.contact_id := _contato;");
  });

  it("os leads que já existiam ganham ficha na própria migration", () => {
    expect(migracao).toContain("UPDATE public.commercial_leads\n   SET company = company\n WHERE organization_id IS NULL");
  });
});

describe("a ficha é rica e o contexto tem campo próprio", () => {
  it("a empresa ganhou instagram, telefone, endereço, CNPJ e porte", () => {
    for (const coluna of ["instagram", "phone", "address", "cnpj", "size"]) {
      expect(migracao).toContain(`ADD COLUMN IF NOT EXISTS ${coluna} text`);
    }
    expect(CAMPOS_DA_EMPRESA.map((c) => c.id)).toEqual(["segment", "city", "site", "instagram", "phone", "size", "cnpj", "address"]);
    expect(lib).toContain("instagram, phone, address, cnpj, size");
  });

  it("a qualificação cobre o que antes ia para Notas", () => {
    const ids = CAMPOS_DE_QUALIFICACAO.map((c) => c.id);
    for (const id of ["presenca_digital", "oferta", "abordagem", "concorrencia"]) expect(ids).toContain(id);
  });

  it("o lead edita os dados da empresa sem sair dele, e só o campo que mudou vai para a ficha", () => {
    expect(pagina).toContain("Dados da empresa ·");
    expect(pagina).toContain("salvarDadosDaEmpresaDoLead(id, mudouNaEmpresa)");
    const fn = lib.slice(lib.indexOf("export async function salvarEmpresa("), lib.indexOf("export async function salvarDadosDaEmpresaDoLead("));
    expect(fn).toContain(".update(parcial as never)");
    expect(fn).toContain("Já existe uma ficha com este nome.");
  });

  it("a aba Empresas mostra os dados da ficha e diz o motivo quando não salva", () => {
    expect(empresas).toContain("CAMPOS_DA_EMPRESA.map((campo) => (");
    expect(empresas).toContain("ultimoErroDoComercial()");
    expect(empresas).toContain("Ficha ainda sem dados.");
  });
});

describe("apagar um lead", () => {
  it("a tela pede dois toques e apaga de verdade, acusando recusa silenciosa", () => {
    expect(pagina).toContain("if (!apagando) { setApagando(true); return; }");
    expect(pagina).toContain('{apagando ? "Confirmar apagar" : "Apagar"}');
    const fn = lib.slice(lib.indexOf("export async function apagarLead("));
    expect(fn).toContain('.delete().eq("id", id).select("id")');
    expect(fn).toContain("Sua conta não tem permissão para apagar este lead.");
  });

  it("o MCP apaga só com confirmação explícita e motivo, e se anuncia destrutivo", () => {
    expect(tools).toContain("'aceleriq_delete_opportunity'");
    expect(tools).toContain("aceleriq_delete_opportunity: 'commercial:write'");
    expect(tools).toContain("confirm: z.literal(true), reason: z.string().min(5).max(500)");
    expect(tools).toContain("deleteOpportunity, true,");
    expect(servico).toContain("if (input.confirm !== true) throw new Error(");
  });

  it("editar pelo MCP soma a qualificação em vez de substituir", () => {
    expect(servico).toContain("corpo.qualificacao = { ...(antes.qualificacao as Record<string, unknown>), ...(corpo.qualificacao as Record<string, unknown>) };");
  });
});

describe("o funil no celular", () => {
  it("mostra uma etapa por vez, escolhida por chip com a contagem", () => {
    expect(kanban).toContain("const [etapaNoCelular, setEtapaNoCelular] = useState<EstagioId>(ESTAGIOS_ABERTOS[0]);");
    expect(kanban).toContain('role="tablist" aria-label="Etapas do funil"');
    expect(kanban).toContain('${visivelNoCelular ? "flex" : "hidden"}');
    expect(kanban).toContain("sm:flex sm:max-h-[calc(100dvh-15rem)] sm:w-[270px]");
  });

  it("formulários de empresa e contato usam uma coluna no celular", () => {
    expect(empresas).not.toContain('className="grid grid-cols-2 gap-2"');
    expect(empresas).toContain('className="grid gap-2.5 sm:grid-cols-2"');
  });
});
