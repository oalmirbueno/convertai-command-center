import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Contato,
  type Empresa,
  type Lead,
  fichaDaEmpresa,
} from "@/lib/comercial";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const migration = ler("supabase/migrations/20260822010000_crm_empresas_e_contatos.sql");
const empresasTela = ler("src/components/comercial/EmpresasCRM.tsx");
const marketing = ler("src/components/comercial/MarketingDaCasa.tsx");
const lib = ler("src/lib/comercial.ts");

const empresa = (parcial: Partial<Empresa>): Empresa => ({
  id: parcial.id || "e1",
  name: "Padaria do Zé",
  segment: null,
  site: null,
  city: null,
  notes: null,
  client_id: null,
  owner_id: null,
  ...parcial,
});

const contato = (parcial: Partial<Contato>): Contato => ({
  id: parcial.id || "c1",
  organization_id: "e1",
  name: "Ana",
  role: null,
  email: null,
  whatsapp: null,
  is_primary: false,
  notes: null,
  ...parcial,
});

const lead = (parcial: Partial<Lead>): Lead => ({
  id: parcial.id || "l1",
  name: "Negócio",
  company: null,
  email: null,
  whatsapp: null,
  origin: "manual",
  campaign_id: null,
  quiz_submission_id: null,
  stage: "proposta",
  monthly_value: 0,
  one_off_value: 0,
  owner_id: null,
  next_action: null,
  next_action_at: null,
  notes: null,
  lost_reason: null,
  won_client_id: null,
  closed_at: null,
  created_at: "2026-08-10T12:00:00Z",
  expected_close_date: null,
  organization_id: "e1",
  contact_id: null,
  ...parcial,
});

/**
 * O relato foi que o CRM estava genérico. Estava: o funil guardava nome,
 * empresa, e-mail e telefone DENTRO da linha do negócio. É a diferença entre
 * um CRM e uma planilha, e aparece na segunda conversa com a mesma empresa,
 * quando tudo tem que ser recadastrado e o histórico fica órfão no negócio
 * antigo.
 */

describe("empresa e contato são fichas próprias", () => {
  it("as duas tabelas existem, com a empresa dona dos contatos", () => {
    expect(migration).toContain("create table if not exists public.commercial_organizations");
    expect(migration).toContain("create table if not exists public.commercial_contacts");
    expect(migration).toContain(
      "organization_id uuid references public.commercial_organizations(id)",
    );
  });

  it("o negócio aponta para as duas, sem perder o texto antigo", () => {
    // Apagar dado por causa de refatoração é o tipo de perda que não volta.
    expect(migration).toContain("add column if not exists organization_id uuid");
    expect(migration).toContain("add column if not exists contact_id uuid");
    expect(migration).not.toContain("drop column company");
  });

  it("a empresa liga no cliente do painel quando fecha", () => {
    // É o elo que deixa perguntar quanto aquela empresa já rendeu, juntando
    // funil e financeiro.
    expect(migration).toContain("client_id uuid references public.profiles(id)");
  });

  it("um contato é marcado como quem atende primeiro", () => {
    // Empresa com quatro contatos e nenhum principal não diz por onde
    // começar, e cada pessoa da casa liga para um.
    expect(migration).toContain("is_primary boolean not null default false");
  });

  it("os leads que já existiam ganham ficha, sem duplicar empresa", () => {
    // Nascer com duas realidades (antigos em texto, novos em ficha) faria
    // toda tela ter que mentir sobre uma das duas.
    expect(migration).toContain("WHERE organization_id IS NULL");
    expect(migration).toContain("lower(org.name) = lower(btrim(_lead.company))");
  });

  it("as duas tabelas ficam com admin e manager, e fora do alcance de anon", () => {
    for (const tabela of ["commercial_organizations", "commercial_contacts"]) {
      expect(migration).toContain(`alter table public.${tabela} enable row level security`);
      expect(migration).toContain(`revoke all on public.${tabela} from anon`);
    }
  });
});

describe("a ficha da empresa junta o que estava espalhado", () => {
  it("mostra negócios ganhos, perdidos e abertos da mesma empresa", () => {
    const ficha = fichaDaEmpresa(
      empresa({}),
      [contato({ id: "c1" }), contato({ id: "c2", organization_id: "outra" })],
      [
        lead({ id: "a", stage: "ganho", monthly_value: 1500 }),
        lead({ id: "b", stage: "perdido" }),
        lead({ id: "c", stage: "proposta" }),
        lead({ id: "d", organization_id: "outra", stage: "ganho", monthly_value: 9000 }),
      ],
    );
    expect(ficha.negocios).toHaveLength(3);
    expect(ficha.ganhos).toBe(1);
    expect(ficha.perdidos).toBe(1);
    expect(ficha.abertos).toBe(1);
    // Só o que é dela: o negócio da outra empresa não entra na conta.
    expect(ficha.mrrGanho).toBe(1500);
    expect(ficha.contatos).toHaveLength(1);
  });

  it("quem atende primeiro aparece no topo da lista de pessoas", () => {
    const ficha = fichaDaEmpresa(
      empresa({}),
      [
        contato({ id: "c1", name: "Segundo" }),
        contato({ id: "c2", name: "Primeiro", is_primary: true }),
      ],
      [],
    );
    expect(ficha.contatos[0].name).toBe("Primeiro");
  });

  it("empresa sem negócio nenhum não quebra a conta", () => {
    const ficha = fichaDaEmpresa(empresa({}), [], []);
    expect(ficha.negocios).toHaveLength(0);
    expect(ficha.mrrGanho).toBe(0);
  });
});

describe("a tela de empresas põe na frente quem está em conversa", () => {
  it("ordena por negócio aberto antes de ordem alfabética", () => {
    // Ordem alfabética pura enterraria a conversa de agora no meio da lista.
    expect(empresasTela).toContain("if (a.abertos !== b.abertos) return b.abertos - a.abertos;");
  });

  it("o negócio abre a partir da ficha", () => {
    expect(empresasTela).toContain("onAbrirLead(negocio)");
  });

  it("mostra o motivo da perda no histórico", () => {
    // É o que ensina a próxima conversa com a mesma empresa.
    expect(empresasTela).toContain("negocio.lost_reason");
  });
});

describe("Marketing fala da casa, sem duplicar o painel", () => {
  it("não cria um segundo calendário de conteúdo", () => {
    // A Aceleriq já é cliente dentro do painel e o conteúdo dela já vive na
    // Agenda editorial; um segundo lugar divergiria no primeiro conserto.
    expect(marketing).toContain('to="/calendario"');
    expect(marketing).toContain("isInternalClient");
  });

  it("a origem do lead liga marketing e CRM", () => {
    // Sai do próprio funil: foi anotada quando o lead entrou, não é palpite.
    expect(marketing).toContain("De onde as pessoas chegaram");
    expect(marketing).toContain("lead.origin");
  });

  it("a lib expõe empresa e contato para quem precisar", () => {
    expect(lib).toContain("export async function listarEmpresas");
    expect(lib).toContain("export async function listarContatos");
    expect(lib).toContain("export function fichaDaEmpresa");
  });
});
