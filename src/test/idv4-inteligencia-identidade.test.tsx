import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement as h, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * 19/10/2026, pedido do dono: "melhore a inteligência da área de identidade".
 * 1. Logo de verdade: o Sistema gera variações pelo Laboratório (logo_gerar)
 *    com o núcleo da marca, mostra a escolha do Jev e grava a escolhida.
 * 2. Núcleo da marca: um contexto só (estratégia, nome, conceito, paleta,
 *    fontes, tom, referências e o site e o Instagram) em toda geração.
 * 3. Escolha com motivo: o Jev aponta as 1 ou 2 melhores e diz por quê.
 */

vi.mock("@/integrations/supabase/client", () => {
  const resposta = { data: [], error: null };
  const q: any = new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok) : () => q),
    apply: () => q,
  });
  const bucket = { createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: null }), download: async () => ({ data: null, error: new Error("sem arquivo") }), upload: async () => ({ data: null, error: null }) };
  return { supabase: { from: () => q, rpc: () => q, storage: { from: () => bucket }, auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) } } };
});

const chamadas: Array<{ f: string; corpo: Record<string, unknown> }> = [];
let respostas: Record<string, unknown> = {};
vi.mock("@/lib/mesa/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/mesa/api")>("@/lib/mesa/api");
  return {
    ...real,
    chamarFuncao: async (f: string, corpo: Record<string, unknown>) => {
      chamadas.push({ f, corpo });
      const r = respostas[`${f}:${String(corpo.acao)}`];
      return typeof r === "function" ? (r as (c: Record<string, unknown>) => unknown)(corpo) : r ?? {};
    },
  };
});

const logoEnviada = { caminho: "c/marca/identidade/p/logos/principal-1.png", mime: "image/png", rotulo: "Logo gerada", previa_png: "c/marca/identidade/p/logos/principal-1-previa.png", largura: 800, altura: 800 };
const enviarLogo = vi.fn(async () => logoEnviada);
vi.mock("@/components/mesa-identidade/arquivosDaMarca", async () => {
  const real = await vi.importActual<typeof import("@/components/mesa-identidade/arquivosDaMarca")>("@/components/mesa-identidade/arquivosDaMarca");
  return { ...real, enviarLogo: (...a: unknown[]) => (enviarLogo as any)(...a) };
});

import { comNucleo, normalizarRespostaDaLogo, nucleoDaMarca, nucleoParaPrompt, pedidoDaLogo } from "../../supabase/functions/mesa-identidade/modulos/nucleo-da-marca";
import { apontarComJev, linhaDoDestaque, marcarDestaques, melhoresPelaNota, perguntasDoMotivo } from "../../supabase/functions/mesa-identidade/modulos/escolha-do-jev";
import { escolherFinalistas, ranquearComJev, type CandidatoDeNome } from "../../supabase/functions/mesa-identidade/modulos/naming";
import { hostBloqueado, lerHtml, normalizarInstagram, normalizarSite } from "../../supabase/functions/mesa-identidade/modulos/leitura-web";
import { brandbookDoProjeto } from "../../supabase/functions/mesa-identidade/modulos/brandbook";
import { MesaProvider } from "@/components/mesa/MesaContexto";
import { ProjetoProvider, type ProjetoDaMesa } from "@/components/mesa-identidade/Comuns";
import GeradorDeLogo from "@/components/mesa-identidade/GeradorDeLogo";
import SlogansDaMarca from "@/components/mesa-identidade/SlogansDaMarca";
import FioDaMarca from "@/components/mesa-identidade/FioDaMarca";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const C = "11111111-1111-4111-8111-111111111111";

function dadosDaMarca(extra: Record<string, unknown> = {}) {
  return {
    briefing: { segmento: "cafeteria de bairro", gosta: ["Aesop", "Fazenda Futuro"], evita: ["marrom café clichê"], personalidade: "calorosa, honesta" },
    estrategia: {
      arquetipo: { principal: "cuidador", secundario: "", justificativa: "acolhe" },
      posicionamento: { declaracao: "Para quem trabalha no bairro, a Brasa é o café que guarda o seu lugar.", diferencial: "guarda o seu lugar" },
      tom: { atributos: ["acolhedor", "direto"] },
      personalidade: { tracos: ["calorosa"] },
      valores: [{ nome: "Cuidado", descricao: "" }],
    },
    naming: { nome: "Brasa", slogan: "Seu lugar no bairro" },
    conceito: { caminhos: [{ id: "c1", nome: "Brasa acesa", ideia: "O calor que fica depois do café.", palavras: ["calor", "pausa"], paleta: [{ hex: "#C2410C", nome: "Brasa", papel: "primaria" }] }], escolhido: "c1" },
    sistema: {
      cores: [
        { nome: "Brasa", papel: "primaria", hex: "#C2410C" },
        { nome: "Areia", papel: "neutra", hex: "#F5EFE6" },
      ],
      tipografia: [
        { familia: "Fraunces", uso: "titulo" },
        { familia: "Inter", uso: "texto" },
      ],
    },
    nucleo: { web: { site: { url: "https://brasa.com.br/", titulo: "Brasa Café", descricao: "Café de especialidade no Juvevê", cor_do_tema: null, titulos: [], texto: "" }, instagram: null, bio: "café, pão e conversa", lido_em: "2026-10-19T10:00:00Z", avisos: [] } },
    ...extra,
  };
}

function projetoBase(dados: Record<string, unknown>) {
  return { id: "22222222-2222-4222-8222-222222222222", client_id: C, marca_id: null, modo: "zero", com_naming: true, titulo: "Brasa", etapa: "sistema", concluidas: ["inicio", "briefing", "pesquisa", "estrategia", "naming", "conceito"], dados, versao: 3, estado: "ativo", custo_usd: 0, criado_em: "2026-10-19T10:00:00Z", atualizado_em: "2026-10-19T11:00:00Z" } as any;
}

function montar(projeto: any, filho: ReactNode, extra: Partial<ProjetoDaMesa> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const valor: ProjetoDaMesa = { projeto, salvarParte: vi.fn(async () => projeto), concluir: vi.fn(), reabrir: vi.fn(), irPara: vi.fn(), guardar: vi.fn(), ...extra };
  const r = render(
    h(MemoryRouter, null,
      h(QueryClientProvider, { client: qc },
        h(MesaProvider as any, { valor: { clientId: C, clientName: "Brasa Café", userId: null, isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: () => undefined, abrirRecarga: () => undefined, abrirChaves: () => undefined, abrirModelos: () => undefined } },
          h(ProjetoProvider as any, { valor }, filho)))),
  );
  return { ...r, valor };
}

afterEach(() => {
  chamadas.length = 0;
  respostas = {};
  enviarLogo.mockClear();
});

// ------------------------------------------------------------------ 2. núcleo da marca

describe("núcleo da marca", () => {
  it("monta sozinho do que o projeto decidiu e do que a marca diz de si", () => {
    const n = nucleoDaMarca(dadosDaMarca(), "Brasa Café");
    expect(n.nome).toBe("Brasa");
    expect(n.arquetipo).toBe("Cuidador");
    expect(n.tom).toEqual(["acolhedor", "direto"]);
    expect(n.conceito && n.conceito.nome).toBe("Brasa acesa");
    expect(n.paleta.map((c) => c.hex)).toEqual(["#C2410C", "#F5EFE6"]);
    expect(n.fontes.map((t) => t.familia)).toEqual(["Fraunces", "Inter"]);
    expect(n.gosta).toEqual(["Aesop", "Fazenda Futuro"]);
    expect(n.web && n.web.site).toMatch(/Brasa Café\. Café de especialidade/);
    expect(n.faltam).toEqual([]);
    const prompt = nucleoParaPrompt(n);
    expect(Object.keys(prompt)).toEqual(expect.arrayContaining(["nome", "arquetipo", "posicionamento", "tom", "conceito_escolhido", "paleta", "fontes", "cliente_gosta", "evitar", "o_que_a_marca_diz_de_si"]));
    expect(prompt).not.toHaveProperty("ainda_nao_decidido");
  });

  it("projeto no começo: o nome do cliente segura o lugar e o que falta vai junto", () => {
    const n = nucleoDaMarca({}, "Brasa Café");
    expect(n.nome).toBe("Brasa Café");
    expect(n.faltam).toEqual(["estratégia", "nome", "conceito", "paleta", "fontes", "tom"]);
    expect(nucleoParaPrompt(n).ainda_nao_decidido).toEqual(n.faltam);
    expect(comNucleo({ a: 1 }, {})).toEqual({ a: 1 });
    expect(comNucleo({ a: 1 }, { nome: "X" })).toEqual({ a: 1, nucleo_da_marca: { nome: "X" } });
  });

  it("vai junto em toda geração do servidor (naming, slogans, conceito, paletas, fontes, estratégia e brandbook)", () => {
    const e = ler("supabase/functions/mesa-identidade/estrategia-acoes.ts");
    expect(e).toContain("nucleo_da_marca: nucleoParaPrompt(nucleo),");
    // paletas, fontes e slogans: o DADOS passa pelo comNucleo; a estratégia leva ...base.dados (com o núcleo).
    expect(e.match(/JSON\.stringify\(comNucleo\(\{/g) || []).toHaveLength(3);
    expect(e).toContain("JSON.stringify({ ...base.dados,");
    expect(e.match(/\$\{REGRA_DO_NUCLEO\}/g) || []).toHaveLength(4);
    // A regra antiga continua (fio da marca nos pedidos).
    expect(e).toContain("direcao_da_marca: direcao,");
    const n = ler("supabase/functions/mesa-identidade/naming-acoes.ts");
    expect(n).toContain("nucleo_da_marca: projeto ? nucleoParaPrompt(nucleoDaMarca(projeto.dados, nome)) : null,");
    expect(n).toContain("${REGRA_DO_NUCLEO}");
    const p = ler("supabase/functions/mesa-identidade/projeto-acoes.ts");
    expect(p).toContain("JSON.stringify(comNucleo({ quantidade: quantos, marca: naming.nome || nome");
    const b = ler("supabase/functions/mesa-identidade/brandbook-acoes.ts");
    expect(b).toContain("nucleo: nucleoDaMarca(p.dados, nome) });");
    const i = ler("supabase/functions/mesa-identidade/index.ts");
    expect(i).toContain("marca_ler_links: marcaLerLinks,");
    expect(i).toMatch(/"coerencia_conferir", "marca_ler_links"/);
  });

  it("o brandbook completa com o núcleo o que o projeto ainda não tem (nunca troca o decidido)", () => {
    const dados = dadosDaMarca({ sistema: {}, naming: { nome: "Brasa" } });
    const n = nucleoDaMarca(dados, "Brasa Café");
    const sem = brandbookDoProjeto({ nomeDaMarca: "Brasa Café", dados, clientId: C });
    const com = brandbookDoProjeto({ nomeDaMarca: "Brasa Café", dados, clientId: C, nucleo: n });
    expect(sem.cores.length).toBe(0);
    expect(com.cores.map((c: any) => c.hex)).toEqual(["#C2410C"]);
    const decidido = brandbookDoProjeto({ nomeDaMarca: "Brasa Café", dados: dadosDaMarca(), clientId: C, nucleo: nucleoDaMarca(dadosDaMarca()) });
    expect(decidido.cores.map((c: any) => c.hex)).toEqual(["#C2410C", "#F5EFE6"]);
    expect(decidido.marca.slogan).toBe("Seu lugar no bairro");
  });

  it("lê o site e o Instagram públicos: link seguro, nada interno, título e descrição do HTML", () => {
    expect(normalizarSite("brasa.com.br")).toBe("https://brasa.com.br/");
    expect(normalizarSite("http://localhost:3000")).toBeNull();
    expect(normalizarSite("https://192.168.0.10/")).toBeNull();
    expect(normalizarSite("ftp://brasa.com.br")).toBeNull();
    expect(hostBloqueado("169.254.169.254")).toBe(true);
    expect(hostBloqueado("brasa.com.br")).toBe(false);
    expect(normalizarInstagram("@brasa.cafe")).toBe("https://www.instagram.com/brasa.cafe/");
    expect(normalizarInstagram("https://www.instagram.com/brasa.cafe/?hl=pt")).toBe("https://www.instagram.com/brasa.cafe/");
    expect(normalizarInstagram("https://www.instagram.com/p/ABC123/")).toBeNull();
    const l = lerHtml('<html><head><title>Brasa</title><meta content="Café &amp; pão no Juvevê" property="og:description"><meta name="theme-color" content="#c2410c"><script>var x="<h1>não</h1>"</script></head><body><h1>Seu lugar no bairro</h1><p>Aberto todo dia</p></body></html>', "https://brasa.com.br/");
    expect(l.titulo).toBe("Brasa");
    expect(l.descricao).toBe("Café & pão no Juvevê");
    expect(l.cor_do_tema).toBe("#C2410C");
    expect(l.titulos).toEqual(["Seu lugar no bairro"]);
    expect(l.texto).toMatch(/Aberto todo dia/);
  });

  it("a tela: o fio da marca abre o núcleo e lê o site e o Instagram sem custo", async () => {
    const p = projetoBase(dadosDaMarca());
    respostas["mesa-identidade:marca_ler_links"] = { projeto: p, leitura: { site: p.dados.nucleo.web.site, instagram: null, bio: null, lido_em: "x", avisos: [] }, avisos: [], custo_usd: 0 };
    const { container, valor } = montar(p, h(FioDaMarca));
    fireEvent.click(container.querySelector("[data-abrir-nucleo]") as HTMLElement);
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Núcleo da marca")).toBeTruthy();
    expect(janela.querySelector('[data-peca-do-nucleo="conceito"]')!.textContent).toMatch(/Brasa acesa/);
    expect(janela.querySelector('[data-peca-do-nucleo="web"]')!.textContent).toMatch(/Café de especialidade/);
    fireEvent.change(within(janela).getByLabelText("Instagram do cliente"), { target: { value: "@brasa.cafe" } });
    fireEvent.click(janela.querySelector("[data-ler-site-instagram]") as HTMLElement);
    await waitFor(() => expect(valor.guardar).toHaveBeenCalled());
    expect(chamadas.filter((c) => c.corpo.acao === "marca_ler_links")[0].corpo).toEqual({ acao: "marca_ler_links", projeto_id: p.id, instagram: "@brasa.cafe" });
  });
});

// ------------------------------------------------------------------ 3. escolha com motivo

describe("escolha com motivo do Jev", () => {
  const candidato = (id: string, nome: string): CandidatoDeNome => ({ id, nome, tecnica: "evocativo" as any, justificativa: `${nome} soa quente`, pronuncia: null, slug: null, filtros: { com_br: "nao_conferido", com: "nao_conferido" } as any, nota_jev: null, nota: null, finalista: false });

  it("naming: o Jev ranqueia, aponta a melhor e diz por quê (mock); a segunda só quando está perto", async () => {
    const lista = [candidato("n1", "Fagulha"), candidato("n2", "Brasa"), candidato("n3", "Tição")];
    const legenda = { "0": "", "1": "", "2": "", "3": "", "4": "" };
    const r = await ranquearComJev(lista, { alvo: "marca", criterios: [], briefing: {} }, async () => ({ answers: { n1: { score: 2, legend: legenda }, n2: { score: 4, legend: legenda }, n3: { score: 1, legend: legenda } } }));
    const finais = escolherFinalistas(r.ranqueados, 3);
    expect(finais[0].nome).toBe("Brasa");
    const perguntas: any[] = [];
    const a = await apontarComJev(finais, { id: (c) => c.id, nota: (c) => c.nota, descrever: (c) => `O nome "${c.nome}"`, peca: "nome", marca: { alvo: "Marca" } }, async (e) => {
      perguntas.push(e);
      return { answers: { m0: { choice: "personalidade", confidence: 0.8 } } };
    });
    // Só a Brasa (nota 1); a Fagulha (0,5) está longe demais para ser a segunda.
    expect(Object.keys(perguntas[0].questions)).toEqual(["m0"]);
    expect(perguntas[0].questions.m0.type).toBe("choice");
    expect(perguntas[0].questions.m0.instructions).toContain('O nome "Brasa"');
    expect(a.destaques).toEqual({ n2: "Escolha do Jev: soa como a personalidade da marca" });
    const marcados = marcarDestaques(finais, (c) => c.id, a.destaques);
    expect(marcados.filter((c) => c.destaque_jev).map((c) => c.nome)).toEqual(["Brasa"]);
  });

  it("duas perto uma da outra: as duas, com a segunda marcada; sem nota (Jev fora): nenhuma e nenhuma chamada", async () => {
    const itens = [{ id: "a", n: 0.9 }, { id: "b", n: 0.82 }, { id: "c", n: 0.3 }];
    expect(melhoresPelaNota(itens, (x) => x.n).map((x) => x.id)).toEqual(["a", "b"]);
    expect(melhoresPelaNota([{ id: "a", n: null }], (x) => x.n)).toEqual([]);
    expect(melhoresPelaNota([{ id: "a", n: 0.4 }], (x) => x.n)).toEqual([]);
    const perguntar = vi.fn(async () => ({ answers: {} }));
    const vazio = await apontarComJev([{ id: "a", n: null }], { id: (x) => x.id, nota: (x) => x.n, descrever: () => "", peca: "paleta", marca: {} }, perguntar);
    expect(vazio.destaques).toEqual({});
    expect(perguntar).not.toHaveBeenCalled();
    const falha = await apontarComJev(itens, { id: (x) => x.id, nota: (x) => x.n, descrever: () => "", peca: "fonte", marca: {} }, async () => {
      throw new Error("fora do ar");
    });
    expect(falha).toEqual({ destaques: {}, falhou: true });
    expect(linhaDoDestaque(1, "lê bem")).toBe("2ª do Jev: lê bem");
    expect(Object.keys(perguntasDoMotivo(["x", "y"], "slogan"))).toEqual(["m0", "m1"]);
  });

  it("o servidor aponta as melhores em nomes, slogans, paletas e fontes", () => {
    expect(ler("supabase/functions/mesa-identidade/naming-acoes.ts")).toContain('peca: "nome",');
    expect(ler("supabase/functions/mesa-identidade/estrategia-acoes.ts")).toContain('peca: "slogan",');
    expect(ler("supabase/functions/mesa-identidade/coerencia-acoes.ts")).toContain('peca: peca === "A paleta" ? "paleta" : "fonte",');
    for (const f of ["EstudioDeNomes.tsx", "PaletaDaMarca.tsx", "TipoEGrafismos.tsx", "SlogansDaMarca.tsx"]) expect(ler(`src/components/mesa-identidade/${f}`)).toMatch(/<EscolhaDoJev linha=\{[a-z]\.destaque_jev\} \/>/);
  });

  it("a tela: a frase destacada mostra a linha do Jev; as outras não", () => {
    const p = projetoBase({ ...dadosDaMarca(), naming: { nome: "Brasa", slogans: [{ id: "s1", texto: "Seu lugar no bairro", tipo: "tagline", por_que: "pertencimento", nota: 0.9, destaque_jev: "Escolha do Jev: diz o posicionamento com clareza" }, { id: "s2", texto: "Café e conversa", tipo: "tagline", por_que: "", nota: 0.4 }] } });
    const { container } = montar(p, h(SlogansDaMarca));
    const linhas = container.querySelectorAll("[data-escolha-do-jev]");
    expect(linhas).toHaveLength(1);
    expect(container.querySelector('[data-slogan="s1"]')!.textContent).toMatch(/Escolha do Jev: diz o posicionamento com clareza/);
  });
});

// ------------------------------------------------------------------ 1. logo de verdade

describe("logo de verdade (Laboratório)", () => {
  it("o pedido sai do núcleo: nome, conceito, paleta, estilo, n e o núcleo inteiro", () => {
    const n = nucleoDaMarca(dadosDaMarca());
    const ped = pedidoDaLogo(n, { clientId: C, estilo: "organico", quantas: 20, arquetipoId: "cuidador" });
    expect(ped.client_id).toBe(C);
    expect(ped.nome).toBe("Brasa");
    expect(ped.paleta).toEqual(["#C2410C", "#F5EFE6"]);
    expect(ped.n).toBe(8);
    expect(ped.conceito).toMatch(/Conceito: Brasa acesa\. O calor que fica depois do café\./);
    expect(ped.conceito).toMatch(/Arquétipo: Cuidador/);
    expect(ped.estilo).toMatch(/símbolo \+ logotipo, fundo liso/);
    expect(ped.estilo).toMatch(/orgânico/);
    expect(ped.estilo).toMatch(/Fraunces/);
    expect(ped.nucleo.nome).toBe("Brasa");
  });

  it("a resposta do Laboratório vira a grade com a escolha do Jev (índice ou id)", () => {
    const r = normalizarRespostaDaLogo({ imagens: [{ url: "https://x/1.png", path: "a/1.png" }, "https://x/2.png", { url: "javascript:alert(1)" }], escolha: { indice: 1, motivo: "símbolo simples que lê pequeno" }, custo_usd: 0.32 }, "2026-10-19T12:00:00Z");
    expect(r.imagens.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(r.jev).toEqual({ id: "v2", motivo: "símbolo simples que lê pequeno" });
    expect(r.custo_usd).toBe(0.32);
    const porId = normalizarRespostaDaLogo({ logos: [{ id: "L1", url: "https://x/a.png" }, { id: "L2", url: "https://x/b.png" }], escolhida: { id: "L1", porque: "mais forte" } });
    expect(porId.jev).toEqual({ id: "L1", motivo: "mais forte" });
    expect(normalizarRespostaDaLogo({}).jev).toEqual({ id: null, motivo: null });
  });

  it("a tela: pede o custo ao Laboratório, gera com confirmado, mostra a escolha do Jev, varia a partir de uma e grava a escolhida", async () => {
    const p = projetoBase(dadosDaMarca());
    const { ErroDaMesa } = await import("@/lib/mesa/api");
    // Formato real da função laboratorio (acoes.ts › logoGerar): sem confirmado, 409 confirmacao_necessaria com o custo.
    respostas["laboratorio:logo_gerar"] = (corpo: Record<string, unknown>) => {
      if (corpo.confirmado !== true) throw new ErroDaMesa("confirmacao_necessaria", "Isto custa cerca de US$ 0.2800. Confirme para rodar.", { total_usd: 0.28, por_no: [{ no_id: null, tipo: "logo", custo_usd: 0.28 }], status_http: 409 });
      return {
        execucao_id: "e9",
        projeto_id: "33333333-3333-4333-8333-333333333333",
        imagens: [1, 2, 3, 4].map((i) => ({ url: `https://lab.supabase.co/storage/v1/object/sign/workspace/global/laboratorio/p/e9-0${i}.png?token=t`, path: `global/laboratorio/p/e9-0${i}.png`, bucket: "workspace", ordem: i, caminho: "geometrico", titulo: "Símbolo geométrico" })),
        escolha: { indice: 2, caminho: "figurativo", motivo: "o símbolo de brasa lê bem pequeno e conversa com o Cuidador", confianca: 0.6 },
        aviso_jev: null,
        custo_usd: 0.28,
      };
    };
    const salvarParte = vi.fn(async () => p);
    const onUsar = vi.fn(async () => undefined);
    const { container } = montar(p, h(GeradorDeLogo, { onUsar }), { salvarParte });
    expect(container.querySelector("[data-nucleo-da-logo]")!.textContent).toMatch(/nome Brasa · conceito Brasa acesa · Cuidador · 2 cores · Fraunces \+ Inter/);

    const gerar = () => screen.getByRole("button", { name: /Gerar logo|Gerar de novo|Gerar variações/i });
    await act(async () => {
      fireEvent.click(gerar());
    });
    // 1º pedido sem confirmado: a função devolve só o custo; nada gerado ainda.
    const faixa = await waitFor(() => {
      const el = container.querySelector("[data-custo-da-logo]");
      if (!el) throw new Error("sem custo");
      return el as HTMLElement;
    });
    expect(faixa.textContent).toMatch(/US\$ 0,28/);
    expect(container.querySelectorAll("[data-variacao-de-logo]")).toHaveLength(0);
    await act(async () => {
      fireEvent.click(container.querySelector("[data-confirmar-logo]") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelectorAll("[data-variacao-de-logo]")).toHaveLength(4));
    const pedidos = chamadas.filter((c) => c.f === "laboratorio");
    expect(pedidos.map((c) => c.corpo.confirmado)).toEqual([undefined, true]);
    const pedido = pedidos[0];
    expect(pedido.corpo.acao).toBe("logo_gerar");
    // Os campos que logo_gerar lê: paleta em texto, fontes no conceito, sem núcleo solto.
    expect(pedido.corpo).toMatchObject({ client_id: C, nome: "Brasa", paleta: "#C2410C, #F5EFE6", n: 4 });
    expect(String(pedido.corpo.conceito)).toMatch(/Brasa acesa/);
    expect(String(pedido.corpo.conceito)).toMatch(/Fontes da marca: Fraunces/);
    expect(pedido.corpo).not.toHaveProperty("nucleo");
    expect(pedido.corpo).not.toHaveProperty("referencias");
    // A escolha do Jev em destaque, com o porquê.
    const doJev = container.querySelector('[data-do-jev="sim"]') as HTMLElement;
    expect(doJev.getAttribute("data-variacao-de-logo")).toBe("v3");
    expect(container.textContent).toMatch(/Escolha do Jev \(opção 3\): o símbolo de brasa lê bem pequeno/);
    // A rodada fica no projeto (sistema.logo_gerada).
    await waitFor(() => expect(salvarParte).toHaveBeenCalled());
    const primeira = (salvarParte.mock.calls[0] as any[]);
    expect(primeira[0]).toBe("sistema");
    expect(primeira[1].logo_gerada.rodadas[0].jev.id).toBe("v3");

    // Variar a partir de uma: a próxima rodada leva a referência (o caminho no workspace, que a função lê).
    fireEvent.click(container.querySelector('[data-variar-logo="v1"]') as HTMLElement);
    expect(container.querySelector('[data-variar-de="v1"]')).toBeTruthy();
    await act(async () => {
      fireEvent.click(gerar());
    });
    await waitFor(() => expect(chamadas.filter((c) => c.f === "laboratorio")).toHaveLength(3));
    expect(chamadas.filter((c) => c.f === "laboratorio")[2].corpo.referencias).toEqual(["global/laboratorio/p/e9-01.png"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    // Usar a do Jev: baixa a imagem, guarda na pasta do projeto e vira a principal.
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(new Blob(["png"], { type: "image/png" }), { status: 200 })) as any;
    try {
      await act(async () => {
        fireEvent.click(container.querySelector('[data-usar-logo="v3"]') as HTMLElement);
      });
      await waitFor(() => expect(onUsar).toHaveBeenCalledWith(logoEnviada));
    } finally {
      globalThis.fetch = fetchOriginal;
    }
    expect(enviarLogo).toHaveBeenCalledWith(C, p.id, expect.any(File), "principal", "Logo gerada");
    const ultima = salvarParte.mock.calls[salvarParte.mock.calls.length - 1] as any[];
    expect(ultima[1].logo_gerada.escolhida).toMatchObject({ variacao_id: "v3", caminho: logoEnviada.caminho, jev: true, motivo_jev: "o símbolo de brasa lê bem pequeno e conversa com o Cuidador" });
  });

  it("o Sistema abre o gerador e a escolhida entra como principal com Desfazer", () => {
    const s = ler("src/components/mesa-identidade/EtapaSistema.tsx");
    expect(s).toContain('const GeradorDeLogo = lazy(() => import("./GeradorDeLogo"));');
    expect(s).toContain("<GeradorDeLogo onUsar={usarGerada} />");
    expect(s).toContain("await pLogos.trocarESalvar({ ...logos, principal: nova });");
    const g = ler("src/components/mesa-identidade/GeradorDeLogo.tsx");
    expect(g).toContain('chamarLaboratorio("logo_gerar", corpo)');
    expect(g).toContain('chamarLaboratorio("logo_gerar", { ...confirmar.corpo, confirmado: true })');
    // Sem lookbehind, \p{} ou grupo nomeado nos arquivos novos (Safari 11).
    for (const f of ["src/components/mesa-identidade/GeradorDeLogo.tsx", "src/components/mesa-identidade/NucleoDaMarca.tsx", "supabase/functions/mesa-identidade/modulos/nucleo-da-marca.ts", "supabase/functions/mesa-identidade/modulos/escolha-do-jev.ts", "supabase/functions/mesa-identidade/modulos/leitura-web.ts"]) {
      const t = ler(f);
      expect(t).not.toMatch(/\(\?<[=!]/);
      expect(t).not.toMatch(/\\p\{/);
      expect(t).not.toMatch(/\(\?<[A-Za-z]/);
    }
  });
});
