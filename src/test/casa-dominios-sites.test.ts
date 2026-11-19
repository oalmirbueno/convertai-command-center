// Central de domínios e sites (19/11/2026): regra da tela, leitura lá fora e contrato do banco.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  avisosDoDominio,
  avisosDoSite,
  dominioNoFiltro,
  faltasNoDns,
  foraDoAr,
  lerCentral,
  ondeEstaODns,
  porMes,
  resumoDaCentralDeDominios,
  saudeDosAvisos,
  siteNoFiltro,
  temEmail,
  type DominioDaCasa,
  type SiteDaCasa,
} from "@/lib/produto/dominios-sites";
import { conferirSite, emLotes, enderecoPrincipal, hostDaRota, lerConta, lerRdap, montarLeitura, urlDoRdap } from "../../supabase/functions/casa-dominios/modulos/leitura";
import { abaDaRota, enderecoNovo } from "@/pages/AdminProduto";

const HOJE = "2026-11-19";

const dominio = (p: Partial<DominioDaCasa> = {}): DominioDaCasa => ({
  id: "d1", dominio: "empresa.com.br", origem: "manual", cliente: "c:1", cliente_nome: "Empresa", registrador: "Registro.br", titular: null,
  nameservers: ["ada.ns.cloudflare.com"], cloudflare_zona_id: "z", cloudflare_status: "active", na_cloudflare_da_casa: true,
  vence_em: "2027-06-01", vencimento_fonte: "rdap", rdap_lido_em: "2026-11-19T10:00:00Z", rdap_erro: null,
  dns_email: null, dns_conferido_em: null, email: null, custo_valor: 40, custo_periodo: "anual", preco_valor: 9.9, preco_periodo: "mensal",
  observacao: null, arquivado: false, ...p,
});
const site = (p: Partial<SiteDaCasa> = {}): SiteDaCasa => ({
  id: "s1", nome: "site", endereco: "www.empresa.com.br", origem: "cloudflare", cf_tipo: "worker", cf_nome: "site", hospedagem: "Cloudflare Workers",
  dominios_personalizados: [], cliente: "c:1", cliente_nome: "Empresa", cliente_herdado: false, dominio_id: "d1", dominio: "empresa.com.br",
  ultima_publicacao: null, http_status: 200, ssl_ok: true, resposta_ms: 300, erro: null, conferido_em: "2026-11-19T10:00:00Z",
  custo_valor: 0, custo_periodo: "mensal", preco_valor: 89.9, preco_periodo: "mensal", observacao: null, arquivado: false, ...p,
});

describe("dinheiro e DNS", () => {
  it("anual vira mensal e vazio é zero", () => {
    expect(porMes(120, "anual")).toBe(10);
    expect(porMes(39.9, "mensal")).toBe(39.9);
    expect(porMes(null, "mensal")).toBe(0);
  });
  it("sabe onde está o DNS pelos nameservers", () => {
    expect(ondeEstaODns(["ada.ns.cloudflare.com"])).toBe("Cloudflare");
    expect(ondeEstaODns(["ns1.dns-parking.com"])).toBe("Hostinger");
    expect(ondeEstaODns(["a.dns.br", "b.dns.br"])).toBe("Registro.br");
    expect(ondeEstaODns(["ns1.exemplo.net"])).toBe("Outro");
    expect(ondeEstaODns([])).toBeNull();
  });
  it("e-mail conta pelo produto ou pelo MX publicado; falta conta nos dois formatos", () => {
    expect(temEmail(dominio())).toBe(false);
    expect(temEmail(dominio({ dns_email: { itens: [{ chave: "mx", estado: "certo", achado: ["10 mx.zoho.com"] }] } }))).toBe(true);
    expect(temEmail(dominio({ email: { dominio_id: "e", provedor: "zoho", estado: "concluido" } }))).toBe(true);
    expect(faltasNoDns(dominio())).toBeNull();
    expect(faltasNoDns(dominio({ dns_email: { itens: [{ chave: "dkim", estado: "falta" }, { chave: "mx", situacao: "falta" }, { chave: "spf", estado: "certo" }] } }))).toBe(2);
  });
});

describe("saúde do domínio", () => {
  it("vencimento: crítico até 7 dias e vencido, atenção até 30", () => {
    expect(saudeDosAvisos(avisosDoDominio(dominio({ vence_em: "2026-11-15" }), HOJE))).toBe("critico");
    expect(avisosDoDominio(dominio({ vence_em: "2026-11-15" }), HOJE)[0].texto).toBe("Venceu há 4 dias.");
    expect(saudeDosAvisos(avisosDoDominio(dominio({ vence_em: "2026-11-25" }), HOJE))).toBe("critico");
    expect(saudeDosAvisos(avisosDoDominio(dominio({ vence_em: "2026-12-10" }), HOJE))).toBe("atencao");
    expect(saudeDosAvisos(avisosDoDominio(dominio(), HOJE))).toBe("ok");
  });
  it("DNS do e-mail com falta é crítico só quando o domínio tem e-mail", () => {
    const semEmail = dominio({ dns_email: { itens: [{ chave: "mx", estado: "falta", achado: [] }] } });
    expect(saudeDosAvisos(avisosDoDominio(semEmail, HOJE))).toBe("ok");
    const comEmail = dominio({ email: { dominio_id: "e", provedor: "zoho", estado: "concluido" }, dns_email: { itens: [{ chave: "dkim", estado: "falta" }] } });
    expect(avisosDoDominio(comEmail, HOJE)[0]).toEqual({ gravidade: "critico", texto: "DNS do e-mail com 1 item faltando." });
    expect(dominioNoFiltro(comEmail, "dns", HOJE)).toBe(true);
    expect(dominioNoFiltro(semEmail, "dns", HOJE)).toBe(false);
  });
  it("zona pendente, sem cliente e sem preço avisam", () => {
    expect(avisosDoDominio(dominio({ cloudflare_status: "pending" }), HOJE).some((a) => /nameservers/.test(a.texto))).toBe(true);
    const sem = avisosDoDominio(dominio({ cliente: null, preco_valor: null }), HOJE);
    expect(sem.some((a) => a.texto === "Sem cliente ligado.")).toBe(true);
    expect(saudeDosAvisos(sem)).toBe("ok");
    expect(avisosDoDominio(dominio({ vence_em: null, rdap_erro: "O RDAP não achou o domínio." }), HOJE)[0].texto).toMatch(/não achou/);
  });
  it("filtro de 30 dias", () => {
    expect(dominioNoFiltro(dominio({ vence_em: "2026-12-15" }), "vence30", HOJE)).toBe(true);
    expect(dominioNoFiltro(dominio({ vence_em: "2027-01-15" }), "vence30", HOJE)).toBe(false);
    expect(dominioNoFiltro(dominio({ vence_em: null }), "vence30", HOJE)).toBe(false);
  });
});

describe("saúde do site", () => {
  it("fora do ar, 4xx, SSL e lento", () => {
    expect(foraDoAr(site({ http_status: null, erro: "Não respondeu em 8 segundos." }))).toBe(true);
    expect(foraDoAr(site({ http_status: 503 }))).toBe(true);
    expect(foraDoAr(site({ conferido_em: null, http_status: null }))).toBe(false);
    expect(saudeDosAvisos(avisosDoSite(site({ http_status: 404 })))).toBe("atencao");
    expect(saudeDosAvisos(avisosDoSite(site({ ssl_ok: false })))).toBe("critico");
    expect(avisosDoSite(site({ resposta_ms: 4200 }))[0].texto).toBe("Lento: 4,2 s para responder.");
    expect(saudeDosAvisos(avisosDoSite(site()))).toBe("ok");
    expect(siteNoFiltro(site({ ssl_ok: false }), "fora")).toBe(true);
  });
});

describe("números do topo", () => {
  it("receita, custo e margem por mês sem os arquivados", () => {
    const c = lerCentral({
      dominios: [dominio(), dominio({ id: "d2", dominio: "b.com", arquivado: true, preco_valor: 1000 })],
      sites: [site(), { ...site({ id: "s2", http_status: null, erro: "x", custo_periodo: "anual" }), preco_valor: "50", custo_valor: "120" }],
      clientes: [],
    });
    const r = resumoDaCentralDeDominios(c, HOJE);
    expect(r.dominios).toBe(1);
    expect(r.sites).toBe(2);
    expect(r.foraDoAr).toBe(1);
    expect(r.receita).toBe(Math.round((9.9 + 89.9 + 50) * 100) / 100);
    expect(r.custo).toBe(Math.round((40 / 12 + 10) * 100) / 100);
    expect(r.margem).toBe(Math.round((r.receita - r.custo) * 100) / 100);
    expect(r.precisam).toBe(1);
  });
});

describe("leitura lá fora", () => {
  it("RDAP: .br no Registro.br, o resto no rdap.org", () => {
    expect(urlDoRdap("Empresa.com.br.")).toBe("https://rdap.registro.br/domain/empresa.com.br");
    expect(urlDoRdap("loja.com")).toBe("https://rdap.org/domain/loja.com");
  });
  it("RDAP: vencimento, registrador, titular e nameservers", () => {
    const br = lerRdap({ events: [{ eventAction: "registration", eventDate: "2019-03-01T00:00:00Z" }, { eventAction: "expiration", eventDate: "2027-03-01T00:00:00Z" }], entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Empresa Ltda"]]] }], nameservers: [{ ldhName: "ADA.NS.CLOUDFLARE.COM" }] }, "empresa.com.br");
    expect(br).toEqual({ vence_em: "2027-03-01", registrador: "Registro.br", titular: "Empresa Ltda", nameservers: ["ada.ns.cloudflare.com"] });
    const com = lerRdap({ events: [{ eventAction: "expiration", eventDate: "2026-12-31T23:59:59Z" }], entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Hostinger operations, UAB"]]] }] }, "loja.com");
    expect(com.registrador).toBe("Hostinger operations, UAB");
    expect(lerRdap({}, "x.com")).toEqual({ vence_em: null, registrador: null, titular: null, nameservers: [] });
  });
  it("rotas e endereço principal", () => {
    expect(hostDaRota("*.empresa.com.br/*")).toBe("empresa.com.br");
    expect(hostDaRota("www.loja.com/*")).toBe("www.loja.com");
    expect(hostDaRota("lixo")).toBeNull();
    expect(enderecoPrincipal(["www.empresa.com.br", "empresa.com.br"], "x.workers.dev")).toBe("empresa.com.br");
    expect(enderecoPrincipal([], "x.pages.dev")).toBe("x.pages.dev");
  });
  it("monta zonas e sites da conta (Workers com domínio e rota, Pages)", () => {
    const r = montarLeitura({
      zonas: [{ id: "z1", name: "Empresa.com.br", status: "active", name_servers: ["ada.ns.cloudflare.com"], original_registrar: "registro.br (id: 1)" }],
      scripts: [{ id: "site-empresa", modified_on: "2026-11-10T00:00:00Z" }, { id: "api-interna" }],
      dominiosDosWorkers: [{ hostname: "www.empresa.com.br", service: "site-empresa" }],
      rotas: [{ pattern: "empresa.com.br/*", script: "site-empresa" }],
      subdominioWorkers: "aceleriq",
      projetos: [{ name: "loja", subdomain: "loja.pages.dev", domains: ["loja.pages.dev", "loja.com"], latest_deployment: { created_on: "2026-11-01T00:00:00Z" } }],
      avisos: [],
    });
    expect(r.dominios[0]).toMatchObject({ dominio: "empresa.com.br", cloudflare_zona_id: "z1", na_cloudflare_da_casa: true, registrador: "registro.br" });
    const worker = r.sites.filter((s) => s.cf_nome === "site-empresa")[0];
    expect(worker).toMatchObject({ cf_tipo: "worker", endereco: "empresa.com.br", dominios_personalizados: ["www.empresa.com.br", "empresa.com.br"], ultima_publicacao: "2026-11-10T00:00:00Z" });
    expect(r.sites.filter((s) => s.cf_nome === "api-interna")[0].endereco).toBe("api-interna.aceleriq.workers.dev");
    expect(r.sites.filter((s) => s.cf_tipo === "pages")[0]).toMatchObject({ endereco: "loja.com", dominios_personalizados: ["loja.com"] });
  });
  it("lê a conta só por GET, página a página, e uma parte sem permissão vira aviso", async () => {
    const pedidos: Array<{ url: string; metodo: string }> = [];
    const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
    const busca = async (url: string, init?: RequestInit) => {
      pedidos.push({ url, metodo: String((init && init.method) || "GET") });
      if (url.indexOf("/zones?") >= 0) {
        const pagina = Number(/page=(\d+)/.exec(url)![1]);
        return resposta({ success: true, result: [{ id: `z${pagina}`, name: `d${pagina}.com`, status: "active" }], result_info: { page: pagina, total_pages: 2 } });
      }
      if (/\/pages\/projects/.test(url)) return resposta({ success: false, errors: [{ message: "Authentication error" }] }, 403);
      if (/\/workers\/subdomain/.test(url)) return resposta({ success: true, result: { subdomain: "aceleriq" } });
      return resposta({ success: true, result: [], result_info: { total_pages: 1 } });
    };
    const lido = await lerConta("t", busca, "conta1");
    expect(lido.zonas.map((z) => z.id)).toEqual(["z1", "z2"]);
    expect(lido.subdominioWorkers).toBe("aceleriq");
    expect(lido.avisos.some((a) => /Pages/.test(a))).toBe(true);
    expect(pedidos.every((p) => p.metodo === "GET")).toBe(true);
    expect(pedidos.some((p) => /\/zones\/z1\/workers\/routes/.test(p.url))).toBe(true);
  });
  it("site: código e tempo; certificado recusado e sem resposta viram texto", async () => {
    let t = 1000;
    const ok = await conferirSite(async () => { t += 250; return new Response("oi", { status: 200 }); }, "www.empresa.com.br", 8000, () => t);
    expect(ok).toEqual({ http_status: 200, ssl_ok: true, resposta_ms: 250, erro: null });
    const tls = await conferirSite(async () => { throw new TypeError("error sending request: invalid peer certificate: Expired"); }, "x.com");
    expect(tls).toMatchObject({ http_status: null, ssl_ok: false, erro: "Certificado SSL recusado." });
    const parado = await conferirSite((_u, init) => new Promise((_r, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))), "y.com", 20);
    expect(parado.erro).toBe("Não respondeu em 0 segundos.");
  });
  it("em lotes mantém a ordem e o limite", async () => {
    let aoMesmoTempo = 0;
    let pico = 0;
    const r = await emLotes([1, 2, 3, 4, 5], 2, async (n) => { aoMesmoTempo++; pico = Math.max(pico, aoMesmoTempo); await new Promise((ok) => setTimeout(ok, 5)); aoMesmoTempo--; return n * 2; });
    expect(r).toEqual([2, 4, 6, 8, 10]);
    expect(pico).toBe(2);
  });
});

describe("rota e menu", () => {
  it("/produto/dominios fica onde está, com Domínios e Sites", () => {
    expect(enderecoNovo("dominios", null)).toBeNull();
    expect(abaDaRota("dominios", "sites")).toBe("sites");
    expect(abaDaRota("dominios", "precos")).toBe("inicio");
    const layout = readFileSync("src/components/AppLayout.tsx", "utf8");
    expect(layout).toContain('label: "Domínios e sites"');
    expect(layout).toContain('{ title: "Sites", url: "/produto/dominios/sites"');
  });
});

describe("contrato do banco e da função", () => {
  const sql = readFileSync("supabase/migrations/20261119120000_casa_dominios_e_sites.sql", "utf8");
  const funcao = readFileSync("supabase/functions/casa-dominios/index.ts", "utf8") + readFileSync("supabase/functions/casa-dominios/modulos/leitura.ts", "utf8");
  it("RLS ligado, leitura só da casa, sem escrita direta", () => {
    expect(sql).toMatch(/alter table public\.casa_dominios enable row level security/);
    expect(sql).toMatch(/alter table public\.casa_sites enable row level security/);
    expect(sql).toMatch(/revoke all on public\.casa_dominios from anon, authenticated/);
    expect(sql).not.toMatch(/grant (insert|update|delete|all) on public\.casa_(dominios|sites) to authenticated/);
  });
  it("toda função é security definer com search_path vazio e a gravação é só do serviço", () => {
    const definer = sql.match(/security definer/g) || [];
    const caminho = sql.match(/set search_path = ''/g) || [];
    expect(definer.length).toBeGreaterThanOrEqual(6);
    expect(caminho.length).toBeGreaterThanOrEqual(definer.length);
    expect(sql).toMatch(/revoke all on function public\.casa_dominios_sites_gravar_leitura\(jsonb\) from public, anon, authenticated/);
  });
  it("token nunca vai para o banco e a Cloudflare só recebe GET", () => {
    expect(sql).not.toMatch(/token\s+(text|jsonb|bytea)/i);
    expect(funcao).toContain('amb("CLOUDFLARE_API_TOKEN")');
    expect(funcao).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
  });
  it("a função está registrada com JWT", () => {
    expect(readFileSync("supabase/config.toml", "utf8")).toMatch(/\[functions\.casa-dominios\]\s+verify_jwt = true/);
  });
});
