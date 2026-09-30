import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATRIBUTOS_DO_DNA,
  dnaManual,
  lerDnaDoJev,
  MAX_ATRIBUTOS,
  MIN_ATRIBUTOS,
  normalizarOpcoesDeCopy,
  perguntasDoDna,
  promptDaImagem,
  promptDaSecao,
  revisarHtml,
  type PacoteDoSite,
} from "../../supabase/functions/_shared/site-metodo";
import { apexDe, cartaoDeDns, estadoDoDominio, normalizarDominio, REGISTRADORES } from "../../supabase/functions/mesa-site/modulos/dns-do-site";
import { faltasParaPublicar, criarApiDaVercel, garantirProjeto, vercelLigada } from "../../supabase/functions/_shared/publicacao-vercel";
import { lerHtmlDeReferencia, urlPublica } from "../../supabase/functions/_shared/referencias-do-site";
import { alvosDoSite, normalizarAcoesDoSite, regrasDoSite } from "../../supabase/functions/mesa-site/acoes-do-site";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { MESAS } from "@/components/mesa-foto/TrocaDeMesas";
import { MESAS_DO_PAINEL } from "@/lib/mesa/preCarga";
import { NOME_DA_MESA } from "@/components/mesa/clientesDaMesa";
import { ROTULOS_DAS_AREAS } from "@/lib/cronometro/motor";
import { AREAS_DO_PAINEL, AGENTES_DO_PAINEL } from "../../supabase/functions/_shared/mapa-do-painel";
import { MESAS_QUE_APRENDEM } from "../../supabase/functions/_shared/aprendizado-das-mesas";

/**
 * Frente SIT (30/09): Mesa Site. DNA das referências (com Jev falso), cartão
 * de DNS por registrador, método (copy, imagem, fórmula de 6 blocos),
 * revisão como aviso, ações do diretor de site e o registro da mesa.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

describe("DNA das referências: a visão descreve, o Jev escolhe (Jev falso)", () => {
  it("as perguntas são um Noul por atributo e um Choice para movimento, nível e nicho", () => {
    const q = perguntasDoDna();
    expect(Object.keys(q).filter((k) => k.indexOf("attr_") === 0).length).toBe(ATRIBUTOS_DO_DNA.length);
    expect(q.attr_quase_preto.type).toBe("noul");
    expect(q.movimento.type).toBe("choice");
    expect(Object.keys((q.nivel as { criteria: Record<string, unknown> }).criteria)).toContain("awwwards");
  });

  it("entra o que passa do limiar, do mais provável ao menos, de 3 a 5 atributos", () => {
    const jev: Record<string, { noul?: number; choice?: string }> = {};
    ATRIBUTOS_DO_DNA.forEach((a, i) => (jev[`attr_${a.id}`] = { noul: i < 7 ? 0.9 - i * 0.02 : 0.1 }));
    jev.movimento = { choice: "rolagem_fixa" };
    jev.nivel = { choice: "apple" };
    jev.nicho = { choice: "agencia" };
    const dna = lerDnaDoJev(jev, { observacoes: "fundo escuro, verde", cores: ["#00d52b", "#111", "nada"] });
    expect(dna.atributos.length).toBe(MAX_ATRIBUTOS);
    expect(dna.atributos[0].id).toBe(ATRIBUTOS_DO_DNA[0].id);
    expect(dna).toMatchObject({ movimento: "rolagem_fixa", nivel: "apple", nicho: "agencia", fonte: "jev" });
    expect(dna.cores_das_referencias).toEqual(["#00D52B", "#111111"]);
  });

  it("com pouca certeza, completa até 3 pelos mais prováveis; escolha fora da lista cai no padrão", () => {
    const jev: Record<string, { noul?: number; choice?: string }> = { attr_vidro: { noul: 0.4 }, attr_bento: { noul: 0.3 }, attr_textura: { noul: 0.2 }, attr_cena_3d: { noul: 0.1 }, movimento: { choice: "inventado" } };
    const dna = lerDnaDoJev(jev, { observacoes: "", cores: [] });
    expect(dna.atributos.map((a) => a.id)).toEqual(["vidro", "bento", "textura"]);
    expect(dna.atributos.length).toBe(MIN_ATRIBUTOS);
    expect(dna.movimento).toBe("sutil");
  });

  it("o DNA manual só aceita ids da lista e guarda a leitura anterior", () => {
    const antes = lerDnaDoJev({ movimento: { choice: "ken_burns" } }, { observacoes: "obs", cores: ["#ffffff"] });
    const d = dnaManual({ atributos: ["minimalista", "hack", "foto_real", "minimalista"], nivel: "editorial" }, antes);
    expect(d.atributos.map((a) => a.id)).toEqual(["minimalista", "foto_real"]);
    expect(d).toMatchObject({ nivel: "editorial", movimento: "ken_burns", observacoes: "obs", fonte: "manual" });
  });
});

describe("cartão de DNS por registrador", () => {
  const config = { recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }], recommendedCNAME: [{ rank: 1, value: "cname-unico.vercel-dns-017.com." }], verification: [{ type: "TXT", domain: "_vercel.cliente.com.br", value: "vc-domain-verify=cliente.com.br,abc" }] };

  it("raiz com registro A e www com CNAME, valores da API (sem IP no código), e o TXT quando a Vercel pede", () => {
    const c = cartaoDeDns("registro_br", "cliente.com.br", config);
    expect(c.apex).toBe("cliente.com.br");
    expect(c.registros).toEqual([
      { tipo: "A", nome: "@", valor: "76.76.21.21", apoio: undefined },
      { tipo: "CNAME", nome: "www", valor: "cname-unico.vercel-dns-017.com", apoio: undefined },
      { tipo: "TXT", nome: "_vercel", valor: "vc-domain-verify=cliente.com.br,abc", apoio: "verificação da Vercel" },
    ]);
    expect(c.cuidados.join(" ")).toMatch(/não aceita CNAME no domínio raiz/);
  });

  it("cada registrador tem o seu cuidado: GoDaddy encaminhamento, Hostinger antigos, Cloudflare nuvem cinza", () => {
    expect(cartaoDeDns("godaddy", "cliente.com", config).cuidados.join(" ")).toMatch(/encaminhamento/i);
    expect(cartaoDeDns("hostinger", "cliente.com", config).cuidados.join(" ")).toMatch(/apague o A e o CNAME antigos/);
    const cf = cartaoDeDns("cloudflare", "cliente.com", config);
    expect(cf.cuidados.join(" ")).toMatch(/nuvem CINZA/);
    expect(cf.registros[0].apoio).toBe("nuvem cinza");
    expect(REGISTRADORES.map((r) => r.id)).toEqual(["registro_br", "godaddy", "hostinger", "cloudflare", "outro"]);
  });

  it("sem resposta da API o valor fica vazio; subdomínio vira um CNAME só", () => {
    const sem = cartaoDeDns("godaddy", "cliente.com", null);
    expect(sem.registros.map((r) => r.valor)).toEqual([null, null]);
    const sub = cartaoDeDns("registro_br", "loja.cliente.com.br", config);
    expect(sub.registros[0]).toMatchObject({ tipo: "CNAME", nome: "loja" });
    expect(apexDe("www.cliente.com.br")).toBe("cliente.com.br");
    expect(apexDe("cliente.com")).toBe("cliente.com");
  });

  it("domínio é normalizado; estado ao vivo pelo misconfigured", () => {
    expect(normalizarDominio("https://WWW.Cliente.com.br/contato")).toBe("www.cliente.com.br");
    expect(normalizarDominio("cliente")).toBeNull();
    expect(normalizarDominio("-x.com")).toBeNull();
    expect(estadoDoDominio(null, true)).toBe("aguardando_dns");
    expect(estadoDoDominio({ misconfigured: false }, true)).toBe("verificado");
    expect(estadoDoDominio({ misconfigured: false }, false)).toBe("sem_dominio");
  });
});

describe("publicação preparada e desligada", () => {
  it("sem a chave, a tela mostra o que falta e oferece o zip", () => {
    expect(vercelLigada("")).toBe(false);
    expect(faltasParaPublicar({ vercelLigada: false, temBuild: true, dominio: "cliente.com.br" })[0]).toMatch(/VERCEL_TOKEN/);
    expect(faltasParaPublicar({ vercelLigada: true, temBuild: true, dominio: "cliente.com.br" })).toEqual([]);
  });

  it("o projeto que já existe (409) é lido pelo nome, com o time na URL", async () => {
    const chamadas: string[] = [];
    const f = (async (url: string, init: { method: string }) => {
      chamadas.push(`${init.method} ${url}`);
      if (init.method === "POST") return new Response(JSON.stringify({ error: { code: "conflict", message: "exists" } }), { status: 409 });
      return new Response(JSON.stringify({ id: "prj_1", name: "site-x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = await garantirProjeto(criarApiDaVercel({ token: "t".repeat(24), teamId: "team_9", fetch: f }), "site-x");
    expect(p).toEqual({ id: "prj_1", nome: "site-x" });
    expect(chamadas[1]).toBe("GET https://api.vercel.com/v9/projects/site-x?teamId=team_9");
  });
});

describe("método do site", () => {
  it("copy: 3 opções no máximo, headline de até 8 palavras, SEO no tamanho, sem travessão", () => {
    const op = normalizarOpcoesDeCopy({
      opcoes: [1, 2, 3, 4].map((i) => ({
        conceito: "c", headline: "Um dois três quatro cinco seis sete oito nove dez", subtitulo: "Sub — com travessão", cta: "Fale conosco",
        secoes: [{ id: "HERO", titulo: "t", texto: "x", itens: [] }], faq: [{ pergunta: "p?", resposta: "r" }],
        seo: { titulo: "t".repeat(90), descricao: "d".repeat(300), palavras: ["a"] }, n: i,
      })),
    });
    expect(op.length).toBe(3);
    expect(op[0].headline.split(" ").length).toBe(8);
    expect(op[0].subtitulo).toBe("Sub, com travessão");
    expect(op[0].seo.titulo.length).toBe(60);
    expect(op[0].seo.descricao.length).toBe(155);
    expect(op[0].secoes[0].id).toBe("hero");
  });

  it("imagem: fórmula com espaço negativo e proporção do slot; nunca texto nem logo", () => {
    const p = promptDaImagem({ slot: "hero", sujeito: "equipe em reunião", paleta: ["#00D52B", "zzz"], dna: ["quase_preto"] });
    expect(p).toMatch(/16:9/);
    expect(p).toMatch(/espaço negativo/);
    expect(p).toMatch(/Sem texto, sem letras, sem logotipo/);
    expect(p).toMatch(/#00D52B/);
    expect(p).not.toMatch(/zzz/);
  });

  it("fórmula de 6 blocos para uma seção por vez, com as regras de movimento seguro", () => {
    const pacote = { cliente: "AcelerIQ", marca: { nome: "AcelerIQ" }, paleta: [], fontes: [], dna: lerDnaDoJev({ movimento: { choice: "tipo_cinetico" }, nivel: { choice: "apple" } }, { observacoes: "", cores: [] }), direcao: {}, copy: null, imagens: [], fotos_reais: [], logo: "/marca/logo.png", secoes: ["hero"] } as PacoteDoSite;
    const t = promptDaSecao(pacote, "faq", "mais direto");
    expect(t).toMatch(/^1\. O QUÊ/);
    expect(t).toMatch(/6\. REFERÊNCIA DE NÍVEL: página de produto da Apple/);
    expect(t).toMatch(/src\/secoes\/Faq\.tsx/);
    expect(t).toMatch(/useReducedMotion/);
    expect(t).toMatch(/PEDIDO DA EQUIPE PARA ESTA SEÇÃO: mais direto/);
  });

  it("revisão é aviso: idioma, viewport, título, description, og, um h1, alt, tamanho e pré-render", () => {
    const ruim = revisarHtml('<html><head><title></title></head><body><div id="root"></div><h1>a</h1><h1>b</h1><img src="x"></body></html>');
    const areas = ruim.map((a) => a.area);
    expect(areas).toContain("acessibilidade");
    expect(areas).toContain("celular");
    expect(areas).toContain("seo");
    expect(ruim.some((a) => /2 títulos principais/.test(a.texto))).toBe(true);
    const bom = revisarHtml('<html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aceleriq</title><meta name="description" content="Sites e marketing"><meta property="og:title" content="A"><meta property="og:image" content="/a.png"></head><body><div id="root"><main><h1>Oi</h1><img src="a.png" alt="a" width="10" height="10"></main></div></body></html>');
    expect(bom).toEqual([]);
  });

  it("referência por URL: só endereço público; o HTML vira título, descrição, títulos e og:image", () => {
    expect(urlPublica("http://127.0.0.1:5173")).toBeNull();
    expect(urlPublica("http://192.168.0.10/x")).toBeNull();
    expect(urlPublica("file:///etc/passwd")).toBeNull();
    expect(urlPublica("https://linear.app")).toBe("https://linear.app/");
    const l = lerHtmlDeReferencia('<title>Linear &amp; co</title><meta name="description" content="Plan"><meta property="og:image" content="/og.png"><h1>Build <b>fast</b></h1><h2>Two</h2><meta name="theme-color" content="#08090a">', "https://linear.app/");
    expect(l).toMatchObject({ titulo: "Linear & co", descricao: "Plan", titulos: ["Build fast", "Two"], cor_do_tema: "#08090a", imagem: "https://linear.app/og.png" });
  });
});

describe("diretor de site: ações com custo antes, motor com Parar", () => {
  const listas = {
    siteId: "11111111-1111-4111-8111-111111111111",
    secoes: [{ id: "hero", construida: true }, { id: "faq", construida: false }],
    trabalhos: [],
    opcoesDeCopy: [{ headline: "A", escolhida: true }, { headline: "B", escolhida: false }],
  };
  const custos = { ajustar: 0.1, construir: 0.2, conteudo: 0.01, imagem: 0.05 };

  it("ajustar seção construída vira item com o pedido; seção ainda não construída é recusada com motivo", () => {
    const a = normalizarAcoesDoSite({ resumo: "", itens: [{ operacao: "ajustar_secao", ref: "s1", para: "mais contraste no título" }, { operacao: "ajustar_secao", ref: "s2", para: "mudar" }] }, listas, "c", custos)!;
    expect(a.itens.map((i) => [i.operacao, i.alvo_id, i.para])).toEqual([["ajustar_secao", "hero", "mais contraste no título"]]);
    expect(a.recusados[0].motivo).toMatch(/ainda não foi construída/);
    expect(a.custo_estimado_usd).toBe(0.1);
    expect(a.agente).toBe("site");
  });

  it("escolher a copy é ordem sem custo com Desfazer (vai na hora); construir custa e pede Confirmar", () => {
    const escolher = normalizarAcoesDoSite({ resumo: "", itens: [{ operacao: "escolher_copy", ref: "c2", para: "" }] }, listas, "c", custos)!;
    expect(podeExecutarDireto(escolher, regrasDoSite(), { pedidoClaro: true }).direto).toBe(true);
    const construir = normalizarAcoesDoSite({ resumo: "", itens: [{ operacao: "construir_secao", ref: "s2", para: "" }] }, listas, "c", custos, [{ bucket: "mesa", path: "c/site/x/conversa/a.png", nome: "a.png" }])!;
    expect(construir.custo_estimado_usd).toBe(0.2);
    expect(construir.contexto).toMatchObject({ site_id: listas.siteId, anexos: [{ nome: "a.png" }] });
    expect(podeExecutarDireto(construir, regrasDoSite(), { pedidoClaro: true }).direto).toBe(false);
    expect(alvosDoSite(listas).map((x) => x.ref)).toEqual(expect.arrayContaining(["s1", "s2", "c1", "c2", "x1", "i1"]));
  });
});

describe("registro da Mesa Site nos lugares do painel", () => {
  it("rota com trava de papel, pré-carga (fora das PRIMEIRAS), troca de mesas, seletor de clientes, cronômetro, mapa e aprendizado", () => {
    const app = ler("src/App.tsx");
    expect(app).toMatch(/path="\/mesa-site"/);
    expect(app).toMatch(/\["admin", "manager", "design"\]\.includes\(profile\?\.role \|\| ""\) \? <Suspense fallback=\{<EsqueletoDaMesa \/>\}><MesaSite \/>/);
    expect(Object.keys(MESAS_DO_PAINEL)).toContain("/mesa-site");
    expect(ler("src/lib/mesa/preCarga.ts").match(/const PRIMEIRAS[\s\S]*?\];/)![0]).not.toMatch(/mesa-site/);
    expect(MESAS.some((m) => m.valor === "site" && m.caminho === "/mesa-site")).toBe(true);
    expect(NOME_DA_MESA.site).toBe("Mesa Site");
    expect(ROTULOS_DAS_AREAS["mesa-site"]).toBe("Mesa Site");
    expect(AREAS_DO_PAINEL.some((a) => a.chave === "mesa_site" && a.rota === "/mesa-site")).toBe(true);
    expect(AGENTES_DO_PAINEL.some((a) => a.chave === "site" && a.funcao === "mesa-site")).toBe(true);
    expect((MESAS_QUE_APRENDEM as readonly string[]).indexOf("site")).toBeGreaterThanOrEqual(0);
    const toml = ler("supabase/config.toml");
    expect(toml).toMatch(/\[functions\.mesa-site\]\s+verify_jwt = true/);
    expect(toml).toMatch(/\[functions\.motor-codigo\]\s+verify_jwt = true/);
    expect(ler("src/lib/mesa/api.ts")).toMatch(/"mesa-site"/);
    expect(ler("src/lib/mesa/marcas.ts")).toMatch(/"mesa-site"/);
    expect(ler("supabase/migrations/20260930090100_mesa_site.sql")).toMatch(/'site'\]\)\);/);
  });

  it("a migration do motor é só backend na escrita e lê por cliente", () => {
    const sql = ler("supabase/migrations/20260930090000_motor_de_codigo.sql");
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.motor_trabalhos, public\.motor_eventos, public\.motor_executores FROM anon, authenticated/);
    expect(sql).toMatch(/can_access_client\(client_id\)/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/rpc_trusted_backend/);
  });
});
