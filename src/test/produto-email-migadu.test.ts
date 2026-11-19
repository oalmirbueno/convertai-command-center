import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  API_DO_MIGADU,
  credencialValida,
  criarCaixaNoMigadu,
  montarNoMigadu,
  parteLocal,
  registrosDoMigadu,
} from "../../supabase/functions/produto-email/modulos/migadu";
import { avaliar } from "../../supabase/functions/produto/modulos/dns";
import { resumirZona } from "../../supabase/functions/produto-email/modulos/cloudflare";
import { registrosDoMigaduParaColar } from "@/lib/produto/email-pedidos";
import { registrosParaPublicar } from "@/components/produto/casa/EmailDaCasa";

const raiz = resolve(__dirname, "../..");
const ler = (arquivo: string) => readFileSync(resolve(raiz, arquivo), "utf8");
const CRED = { usuario: "conta@aceleriq.com", chave: "chave-de-teste-0123456789" };

const REGISTROS = {
  domain_name: "clinica.com.br",
  mx_records: [{ name: "@", priority: 10, type: "mx", value: "aspmx1.migadu.com" }, { name: "@", priority: 20, type: "mx", value: "aspmx2.migadu.com" }],
  spf: { name: "@", type: "txt", value: "v=spf1 include:spf.migadu.com -all" },
  dkim: [1, 2, 3].map((n) => ({ name: `key${n}._domainkey`, type: "cname", value: `key${n}.clinica.com.br._domainkey.migadu.com.` })),
  dmarc: { name: "_dmarc", type: "txt", value: "v=DMARC1; p=quarantine;" },
  dns_verification: { name: "@", type: "txt", value: "hosted-email-verify=abc123" },
};

/** Um Migadu falso: guarda as chamadas e responde como a API documentada. */
function migaduFalso(estado: { dominio: boolean; caixas: string[] }) {
  const chamadas: Array<{ metodo: string; url: string; corpo: Record<string, unknown> | null; auth: string }> = [];
  const buscar = async (url: string, init: RequestInit) => {
    const metodo = String(init.method || "GET");
    const corpo = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    chamadas.push({ metodo, url, corpo, auth: String((init.headers as Record<string, string>).Authorization || "") });
    const caminho = url.replace(API_DO_MIGADU, "");
    const ok = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (metodo === "GET" && caminho === "/domains/clinica.com.br") return estado.dominio ? ok({ name: "clinica.com.br", state: "inactive" }) : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    if (metodo === "POST" && caminho === "/domains") {
      estado.dominio = true;
      return ok({ name: corpo?.name, state: "inactive" });
    }
    if (metodo === "GET" && caminho.endsWith("/mailboxes")) return ok({ mailboxes: estado.caixas.map((a) => ({ address: a, name: "", is_active: true })) });
    if (metodo === "POST" && caminho.endsWith("/mailboxes")) {
      const a = `${corpo?.local_part}@clinica.com.br`;
      estado.caixas.push(a);
      return ok({ address: a, name: corpo?.name, is_active: true });
    }
    if (metodo === "POST" && caminho.endsWith("/aliases")) return ok({ address: `${corpo?.local_part}@clinica.com.br`, destinations: String(corpo?.destinations || "").split(",") });
    if (metodo === "GET" && caminho.endsWith("/records")) return ok(REGISTROS);
    return new Response("{}", { status: 404 });
  };
  return { buscar, chamadas };
}

describe("Migadu: credencial e endereços", () => {
  it("a credencial só vale inteira (e-mail da conta e chave)", () => {
    expect(credencialValida("conta@aceleriq.com", "chave-de-teste-0123456789")).toEqual(CRED);
    expect(credencialValida("", "chave-de-teste-0123456789")).toBeNull();
    expect(credencialValida("conta@aceleriq.com", "curta")).toBeNull();
  });

  it("a parte local só sai de endereço do próprio domínio", () => {
    expect(parteLocal("Joao@Clinica.com.br", "clinica.com.br")).toBe("joao");
    expect(parteLocal("joao@outro.com.br", "clinica.com.br")).toBeNull();
    expect(parteLocal("-x@clinica.com.br", "clinica.com.br")).toBeNull();
  });
});

describe("Migadu: registros de DNS", () => {
  it("lê MX, SPF, os 3 DKIM por CNAME, DMARC e a verificação com o nome completo", () => {
    const r = registrosDoMigadu(REGISTROS, "clinica.com.br");
    expect(r.filter((x) => x.papel === "mx").map((x) => [x.nome, x.prioridade, x.valor])).toEqual([["clinica.com.br", 10, "aspmx1.migadu.com"], ["clinica.com.br", 20, "aspmx2.migadu.com"]]);
    expect(r.filter((x) => x.papel === "dkim").map((x) => x.nome)).toEqual(["key1._domainkey.clinica.com.br", "key2._domainkey.clinica.com.br", "key3._domainkey.clinica.com.br"]);
    expect(r.find((x) => x.papel === "dmarc")).toMatchObject({ tipo: "TXT", nome: "_dmarc.clinica.com.br" });
    expect(r.find((x) => x.papel === "verificacao")).toMatchObject({ tipo: "TXT", nome: "clinica.com.br", valor: "hosted-email-verify=abc123" });
    expect(registrosDoMigadu({ mx_records: [{ type: "a", value: "x" }], spf: null }, "clinica.com.br")).toEqual([]);
  });

  it("os registros saem prontos para colar", () => {
    const texto = registrosDoMigaduParaColar(registrosDoMigadu(REGISTROS, "clinica.com.br"));
    expect(texto).toContain("clinica.com.br.  MX  10  aspmx1.migadu.com.");
    expect(texto).toContain('clinica.com.br.  TXT  "v=spf1 include:spf.migadu.com -all"');
    expect(texto).toContain("key1._domainkey.clinica.com.br.  CNAME  key1.clinica.com.br._domainkey.migadu.com.");
  });

  it("o modelo de registros do painel e a conferência do DNS conhecem o Migadu", () => {
    expect(registrosParaPublicar({ dominio: "clinica.com.br", provedor: "migadu", dkim_seletor: null })).toContain("aspmx1.migadu.com.");
    const c = avaliar({
      dominio: "clinica.com.br", provedor: "migadu", seletor: "key1",
      mx: ["10 aspmx1.migadu.com", "20 aspmx2.migadu.com"], txt: ["v=spf1 include:spf.migadu.com -all"],
      dkim: ["key1.clinica.com.br._domainkey.migadu.com", "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"], dmarc: ["v=DMARC1; p=quarantine;"], agora: new Date(),
    });
    expect(c.pronto).toBe(true);
    const zona = resumirZona({ id: "z", name: "clinica.com.br", status: "active" }, [
      { type: "MX", name: "clinica.com.br", content: "aspmx1.migadu.com", priority: 10 },
      { type: "MX", name: "clinica.com.br", content: "aspmx2.migadu.com", priority: 20 },
      { type: "TXT", name: "clinica.com.br", content: "v=spf1 include:spf.migadu.com -all" },
      { type: "CNAME", name: "key1._domainkey.clinica.com.br", content: "key1.clinica.com.br._domainkey.migadu.com" },
      { type: "TXT", name: "_dmarc.clinica.com.br", content: "v=DMARC1; p=quarantine;" },
    ], { dominio: "clinica.com.br", provedor: "migadu" });
    expect(zona.itens.filter((i) => i.situacao !== "ok").map((i) => i.chave)).toEqual([]);
  });
});

describe("Migadu: montar o domínio", () => {
  it("cria o domínio com DNS de fora, as caixas por convite e o apelido, com autenticação básica", async () => {
    const m = migaduFalso({ dominio: false, caixas: [] });
    const r = await montarNoMigadu(CRED, m.buscar, {
      dominio: "clinica.com.br",
      caixas: [
        { id: "a", endereco: "contato@clinica.com.br", tipo: "apelido", pessoa: null, recuperacao: null, destinos: ["joao@clinica.com.br"] },
        { id: "j", endereco: "joao@clinica.com.br", tipo: "caixa", pessoa: "João", recuperacao: "joao@gmail.com" },
      ],
    });
    expect(r.dominio_criado).toBe(true);
    expect(r.criadas).toEqual(["joao@clinica.com.br", "contato@clinica.com.br"]);
    expect(r.registros.length).toBe(8);
    const dominio = m.chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/domains"));
    expect(dominio?.corpo).toEqual({ name: "clinica.com.br", hosted_dns: false, create_default_addresses: false });
    const caixa = m.chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/mailboxes"));
    expect(caixa?.corpo).toEqual({ local_part: "joao", name: "João", password_method: "invitation", password_recovery_email: "joao@gmail.com" });
    expect(caixa?.corpo).not.toHaveProperty("password");
    expect(m.chamadas.every((c) => c.auth === `Basic ${btoa(`${CRED.usuario}:${CRED.chave}`)}`)).toBe(true);
  });

  it("rodar de novo não cria o que já existe; sem e-mail de convite a caixa fica pendente", async () => {
    const m = migaduFalso({ dominio: true, caixas: ["joao@clinica.com.br"] });
    const r = await montarNoMigadu(CRED, m.buscar, {
      dominio: "clinica.com.br",
      caixas: [
        { id: "j", endereco: "joao@clinica.com.br", tipo: "caixa", pessoa: "João", recuperacao: "joao@gmail.com" },
        { id: "m", endereco: "maria@clinica.com.br", tipo: "caixa", pessoa: "Maria", recuperacao: null },
      ],
    });
    expect(r.dominio_criado).toBe(false);
    expect(r.ja_existiam).toEqual(["joao@clinica.com.br"]);
    expect(r.pendentes.map((p) => p.endereco)).toEqual(["maria@clinica.com.br"]);
    expect(m.chamadas.some((c) => c.metodo === "POST")).toBe(false);
  });

  it("o convite não vai para um e-mail do próprio domínio (que ainda não recebe)", async () => {
    const m = migaduFalso({ dominio: true, caixas: [] });
    await expect(criarCaixaNoMigadu(CRED, m.buscar, { dominio: "clinica.com.br", endereco: "joao@clinica.com.br", nome: "João", recuperacao: "outro@clinica.com.br" })).rejects.toThrow(/de fora do domínio/);
  });
});

describe("Migadu: a chave nunca sai do servidor", () => {
  it("a função lê a credencial só dos segredos e não grava a chave", () => {
    const f = ler("supabase/functions/produto-email/index.ts");
    expect(f).toContain('credencialValida(amb("MIGADU_USUARIO"), amb("MIGADU_API_KEY"))');
    expect(f).not.toMatch(/MIGADU_API_KEY[^"]*"\s*[:=]\s*"[^"]{8,}/);
    expect(f).not.toMatch(/gravar\([^)]*chave/);
  });
});
