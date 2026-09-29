import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Frente MC (29/09): marcas completas. Dono: "eu mudo para CME e ele já muda
 * tudo certinho, igual quando a gente seleciona outro cliente; a cor da
 * Acerbi é uma, a do CME é outra". Prova central: com a CME aberta, nenhuma
 * leitura devolve paleta, logo, estilo, regras, tom, contexto, referência,
 * fonte, foto ou conta da Acerbi; e o contrário também.
 */

const mock = vi.hoisted(() => ({ from: vi.fn(), chamadas: [] as { tabela: string; tipo: string; campos: unknown; filtros: [string, unknown][] }[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, functions: { invoke: vi.fn() }, rpc: vi.fn() } }));

import {
  CAMPOS_DA_IDENTIDADE,
  citaMarca,
  contasDaMarcaAberta,
  contextoDaMarcaAberta,
  etiquetaDaMarca,
  etiquetasDaOrigem,
  fotoDaMarcaAberta,
  herdaDoCliente,
  linhaDaMarca,
  logosDaMarca,
  projetoDaMarcaAberta,
  valorDaMarca,
} from "../../supabase/functions/_shared/heranca-da-marca";
import { contextoComMarca, fontesDaMarca, fotoDaMarca, kitComMarca, type MarcaDoCliente as MarcaNoServidor } from "../../supabase/functions/_shared/marca";
import { candidatosDaMarca, escolhaDaLogo, perguntaDaLogo, type ArquivoLeve, type NoDoWorkspaceLeve } from "../../supabase/functions/agente-contexto/logo-da-marca";
import { alvoDoKit, kitDaMarcaAberta, type KitEfetivo } from "@/lib/mesa/kitDaMarca";
import { corpoComMarca, definirMarcaAtual, limparMarcaAtual, referenciaDaMarca, type MarcaDoCliente } from "@/lib/mesa/marcas";
import { gravarNoKit } from "@/components/mesa/kitDaMesa";

// ------------------------------------------------------------------ dados reais (ids do banco, 29/09)

const CLIENTE = "39ebda82-637c-498b-a23a-b622f645e852";
const ID_ACERBI = "1435444b-55a2-47e5-9c9f-6c5398a6f379";
const ID_CME = "d65dc686-8f4e-4906-ab5d-568ecffc9bfa";
const P_ACERBI = "1a55e3e5-c823-4cc9-8e26-1ba14396219a";
const P_CME = "a220d8f6-0259-41b5-aaa4-eb1ef5435fb1";
const P_SITE = "c08240de-9248-4d41-a17d-40a479e698d2";
const IG_ACERBI = "168cc115-efc0-401f-bd32-335cd928755c";
const IG_CME = "d1bcc512-c3d0-4d76-8667-29cbf8f94e29";
const FB_CME = "c3b31f79-c3d3-4956-b4c9-714653275ad9";
const ADS_ACERBI = "66b4113c-2d38-4a50-a14d-1b7eb9997206";

const marcaTela = (extra: Partial<MarcaDoCliente>): MarcaDoCliente => ({
  id: ID_ACERBI,
  client_id: CLIENTE,
  project_id: P_ACERBI,
  nome: "Acerbi",
  principal: true,
  ordem: 0,
  paleta: [],
  logo_path: null,
  logo_alt_path: null,
  logo_file_id: null,
  logo_alt_file_id: null,
  estilo: null,
  regras: null,
  tom: null,
  contexto_extra: null,
  contexto: {},
  logo_tom: null,
  logo_alt_tom: null,
  ...extra,
});
const ACERBI = marcaTela({});
const CME_VAZIA = marcaTela({ id: ID_CME, project_id: P_CME, nome: "CME", principal: false, ordem: 1 });
const CME_CHEIA = marcaTela({
  id: ID_CME,
  project_id: P_CME,
  nome: "CME",
  principal: false,
  ordem: 1,
  paleta: [{ nome: "Rosa CME", hex: "#E50070", papel: "principal" }],
  logo_path: `${CLIENTE}/marcas/${ID_CME}/logo-1.png`,
  estilo: "Retratos femininos em rosa",
  regras: "Fotos reais e autorizadas",
  tom: "Acolhedor e próximo",
  contexto: { negocio: "Conselho da Mulher Empresária", publico: "Mulheres empreendedoras" },
});
const MARCAS = [ACERBI, CME_VAZIA];
const noServidor = (m: MarcaDoCliente): MarcaNoServidor => ({ ...m, contexto: m.contexto as Record<string, unknown> }) as unknown as MarcaNoServidor;

/** Kit do cliente = kit da Acerbi (a principal herda). Cada valor é único para achar vazamento no JSON. */
const KIT_ACERBI: KitEfetivo = {
  client_id: CLIENTE,
  paleta: [{ nome: "Verde Acerbi", hex: "#006B38", papel: "primaria" }, { nome: "Amarelo", hex: "#F5D400", papel: "destaque" }],
  logo_file_id: "90a1da12-d117-499d-90f1-fdf9f6e2fc53",
  logo_path: `${CLIENTE}/marca/logo-acerbi.png`,
  logo_alt_path: `${CLIENTE}/marca/logo-alternativa-acerbi.png`,
  logo_alt_file_id: null,
  estilo: "ESTILO_DA_ACERBI verde e amarelo",
  regras: "REGRAS_DA_ACERBI não tratar rosa como cor institucional",
  contexto: {
    negocio: "NEGOCIO_DA_ACERBI associação comercial",
    publico: "PUBLICO_DA_ACERBI lojistas",
    oferta: "OFERTA_DA_ACERBI SPC",
    tom_de_voz: "TOM_DA_ACERBI institucional",
    diferenciais: ["DIFERENCIAL_DA_ACERBI"],
    tipografia: { titulo: "TIPO_DA_ACERBI serifada" },
    logo: { descricao: "LOGO_DA_ACERBI quadrado verde" },
  },
  contexto_atualizado_em: "2026-09-25T13:41:14.618Z",
};
const VALORES_DA_ACERBI = ["#006B38", "#F5D400", "logo-acerbi.png", "logo-alternativa-acerbi.png", "90a1da12", "ESTILO_DA_ACERBI", "REGRAS_DA_ACERBI", "NEGOCIO_DA_ACERBI", "PUBLICO_DA_ACERBI", "OFERTA_DA_ACERBI", "TOM_DA_ACERBI", "DIFERENCIAL_DA_ACERBI", "TIPO_DA_ACERBI", "LOGO_DA_ACERBI"];
const VALORES_DA_CME = ["#E50070", `marcas/${ID_CME}/logo-1.png`, "Retratos femininos", "Fotos reais e autorizadas", "Acolhedor e próximo", "Conselho da Mulher", "Mulheres empreendedoras"];

const semNenhum = (saida: unknown, proibidos: string[]) => {
  const texto = JSON.stringify(saida);
  for (const v of proibidos) expect(texto, `vazou "${v}"`).not.toContain(v);
};

// ------------------------------------------------------------------ 1. regra única

describe("regra única de herança (heranca-da-marca.ts)", () => {
  it("sem marca: o cliente; principal: a dela ou a do cliente; outra marca: só a dela, vazio fica vazio", () => {
    expect(valorDaMarca("estilo", null, "da marca", "do cliente", null)).toEqual({ valor: "do cliente", origem: "cliente" });
    expect(valorDaMarca("estilo", ACERBI, null, "do cliente", null)).toEqual({ valor: "do cliente", origem: "cliente" });
    expect(valorDaMarca("estilo", ACERBI, "da marca", "do cliente", null)).toEqual({ valor: "da marca", origem: "marca" });
    expect(valorDaMarca("estilo", CME_VAZIA, null, "do cliente", null)).toEqual({ valor: null, origem: "vazio" });
    expect(valorDaMarca("paleta", CME_VAZIA, [], [{ hex: "#006B38" }], [])).toEqual({ valor: [], origem: "vazio" });
    expect(valorDaMarca("estilo", CME_VAZIA, "da CME", "do cliente", null)).toEqual({ valor: "da CME", origem: "marca" });
  });

  it("identidade nunca é comum; só contrato, cobrança, equipe e cadastro passam do cliente para a outra marca", () => {
    for (const c of CAMPOS_DA_IDENTIDADE) expect(herdaDoCliente(c, CME_VAZIA), c).toBe(false);
    for (const c of CAMPOS_DA_IDENTIDADE) expect(herdaDoCliente(c, ACERBI), c).toBe(true);
    expect(herdaDoCliente("contrato", CME_VAZIA)).toBe(true);
    expect(valorDaMarca("contrato", CME_VAZIA, null, "contrato do cliente", null).valor).toBe("contrato do cliente");
  });

  it("logo é um par (caminho e arquivo): herdado inteiro ou não é", () => {
    const cliente = { logo_path: "c/logo.png", logo_file_id: "f1", logo_alt_path: "c/alt.png", logo_alt_file_id: null };
    expect(logosDaMarca(CME_VAZIA, {}, cliente)).toMatchObject({ logo_path: null, logo_file_id: null, logo_alt_path: null });
    expect(logosDaMarca(ACERBI, {}, cliente)).toMatchObject({ logo_path: "c/logo.png", logo_file_id: "f1", logo_alt_path: "c/alt.png" });
    expect(logosDaMarca(CME_VAZIA, { logo_path: "c/marcas/cme.png" }, cliente)).toMatchObject({ logo_path: "c/marcas/cme.png", logo_file_id: null, logo_alt_path: null });
  });

  it("linhas com marca_id, fotos e itens por projeto", () => {
    expect(linhaDaMarca(null, ACERBI)).toBe(true);
    expect(linhaDaMarca(ID_CME, ACERBI)).toBe(false);
    expect(linhaDaMarca(null, CME_VAZIA)).toBe(false);
    expect(linhaDaMarca(ID_CME, CME_VAZIA)).toBe(true);
    expect(linhaDaMarca(ID_ACERBI, null)).toBe(true);
    expect(fotoDaMarcaAberta([], CME_VAZIA)).toBe(false);
    expect(fotoDaMarcaAberta([etiquetaDaMarca(ID_CME)], CME_VAZIA)).toBe(true);
    expect(fotoDaMarcaAberta([etiquetaDaMarca(ID_CME)], ACERBI)).toBe(false);
    expect(fotoDaMarcaAberta(["produto"], ACERBI)).toBe(true);
    expect(projetoDaMarcaAberta(P_CME, CME_VAZIA, MARCAS)).toBe(true);
    expect(projetoDaMarcaAberta(P_SITE, CME_VAZIA, MARCAS)).toBe(false);
    expect(projetoDaMarcaAberta(null, CME_VAZIA, MARCAS)).toBe(false);
    expect(projetoDaMarcaAberta(P_SITE, ACERBI, MARCAS)).toBe(true);
    expect(projetoDaMarcaAberta(null, ACERBI, MARCAS)).toBe(true);
    expect(projetoDaMarcaAberta(P_CME, ACERBI, MARCAS)).toBe(false);
  });

  it("Instagram e páginas: cada marca com as contas ligadas ao projeto dela (ligações reais do banco)", () => {
    const contas = [{ id: IG_ACERBI }, { id: IG_CME }, { id: FB_CME }, { id: ADS_ACERBI }];
    const ligacoes = [
      { project_id: P_ACERBI, external_account_id: IG_ACERBI },
      { project_id: P_CME, external_account_id: IG_CME },
      { project_id: P_CME, external_account_id: FB_CME },
    ];
    expect(contasDaMarcaAberta(contas, ligacoes, CME_VAZIA, MARCAS).map((c) => c.id)).toEqual([IG_CME, FB_CME]);
    expect(contasDaMarcaAberta(contas, ligacoes, ACERBI, MARCAS).map((c) => c.id)).toEqual([IG_ACERBI, ADS_ACERBI]);
    expect(contasDaMarcaAberta(contas, [], CME_VAZIA, MARCAS)).toEqual([]);
    expect(contasDaMarcaAberta(contas, ligacoes, null, MARCAS)).toBe(contas);
  });

  it("etiqueta da foto nova pela origem: projeto ou pasta com o nome da marca", () => {
    expect(citaMarca("CME - Conselho da Mulher Empresaria / CME Logo / ChatGPT Image.png", "CME")).toBe(true);
    expect(citaMarca("Referências  Design Acerbi / arte.png", "CME")).toBe(false);
    expect(citaMarca("acmeria / foto.png", "CME")).toBe(false);
    expect(etiquetasDaOrigem({ projectId: P_CME }, MARCAS)).toEqual([etiquetaDaMarca(ID_CME)]);
    expect(etiquetasDaOrigem({ caminho: "CME - Conselho / Fotos / a.jpg" }, MARCAS)).toEqual([etiquetaDaMarca(ID_CME)]);
    expect(etiquetasDaOrigem({ projectId: P_ACERBI, caminho: "Videos / Café" }, MARCAS)).toEqual([]);
  });
});

// ------------------------------------------------------------------ 2. nada vaza

describe("nada vaza: CME aberta nunca devolve a Acerbi, e a Acerbi nunca a CME", () => {
  it("tela (kitDaMarcaAberta): CME vazia fica vazia; CME cheia só com o dela; Acerbi com o kit do cliente", () => {
    const vazia = kitDaMarcaAberta(KIT_ACERBI, CME_VAZIA, CLIENTE);
    semNenhum(vazia.kit, VALORES_DA_ACERBI);
    expect(vazia.kit!.paleta).toEqual([]);
    expect(vazia.kit!.logo_path).toBeNull();
    expect(vazia.origem).toEqual({ paleta: "vazio", logo: "vazio", estilo: "vazio", regras: "vazio", tom: "vazio", contexto: "vazio" });

    const cheia = kitDaMarcaAberta(KIT_ACERBI, CME_CHEIA, CLIENTE);
    semNenhum(cheia.kit, VALORES_DA_ACERBI);
    expect(JSON.stringify(cheia.kit)).toContain("#E50070");
    expect(cheia.kit!.contexto!.tom_de_voz).toBe("Acolhedor e próximo");

    const acerbi = kitDaMarcaAberta(KIT_ACERBI, ACERBI, CLIENTE);
    semNenhum(acerbi.kit, VALORES_DA_CME);
    expect(acerbi.kit!.paleta).toEqual(KIT_ACERBI.paleta);
    expect(acerbi.kit!.logo_path).toBe(KIT_ACERBI.logo_path);
    expect(kitDaMarcaAberta(KIT_ACERBI, null, CLIENTE).kit).toBe(KIT_ACERBI);
  });

  it("servidor (kitComMarca e contextoComMarca): a mesma regra da tela", () => {
    const base = { ...KIT_ACERBI } as unknown as Record<string, unknown>;
    semNenhum(kitComMarca(base, noServidor(CME_VAZIA)), VALORES_DA_ACERBI);
    semNenhum(kitComMarca(base, noServidor(CME_CHEIA)), VALORES_DA_ACERBI);
    semNenhum(contextoComMarca(KIT_ACERBI.contexto as never, noServidor(CME_VAZIA)), VALORES_DA_ACERBI);
    semNenhum(contextoComMarca(KIT_ACERBI.contexto as never, noServidor(CME_CHEIA)), VALORES_DA_ACERBI);
    semNenhum(kitComMarca(base, noServidor(ACERBI)), VALORES_DA_CME);
    expect((kitComMarca(base, noServidor(ACERBI)) as { paleta: unknown }).paleta).toEqual(KIT_ACERBI.paleta);
    // A tela e o servidor chegam no mesmo kit.
    const tela = kitDaMarcaAberta(KIT_ACERBI, CME_CHEIA, CLIENTE).kit!;
    const servidor = kitComMarca(base, noServidor(CME_CHEIA)) as Record<string, unknown>;
    expect(servidor.paleta).toEqual(tela.paleta);
    expect(servidor.estilo).toBe(tela.estilo);
    expect(servidor.regras).toBe(tela.regras);
    expect(servidor.logo_path).toBe(tela.logo_path);
    expect((servidor.contexto as Record<string, unknown>).tom_de_voz).toBe(tela.contexto!.tom_de_voz);
    expect(contextoDaMarcaAberta(CME_VAZIA, {}, KIT_ACERBI.contexto)).toEqual({});
  });

  it("referências, fontes, fotos e contas: cada marca só com as dela", () => {
    const refs = [{ id: "r-acerbi", marca_id: null }, { id: "r-cme", marca_id: ID_CME }];
    expect(refs.filter((r) => referenciaDaMarca(r.marca_id, CME_VAZIA)).map((r) => r.id)).toEqual(["r-cme"]);
    expect(refs.filter((r) => referenciaDaMarca(r.marca_id, ACERBI)).map((r) => r.id)).toEqual(["r-acerbi"]);
    const fontes = [{ id: "f-acerbi", marca_id: null }, { id: "f-cme", marca_id: ID_CME }];
    expect(fontesDaMarca(fontes, CME_VAZIA).map((f) => f.id)).toEqual(["f-cme"]);
    expect(fontesDaMarca(fontes, ACERBI).map((f) => f.id)).toEqual(["f-acerbi"]);
    const fotos = [{ id: "foto-acerbi", tags: ["produto"] }, { id: "foto-cme", tags: [etiquetaDaMarca(ID_CME)] }];
    expect(fotos.filter((f) => fotoDaMarca(f.tags, CME_VAZIA)).map((f) => f.id)).toEqual(["foto-cme"]);
    expect(fotos.filter((f) => fotoDaMarca(f.tags, ACERBI)).map((f) => f.id)).toEqual(["foto-acerbi"]);
  });
});

// ------------------------------------------------------------------ 3. logo achada no que já existe

describe("logo da marca achada nos arquivos (sem 'procure a logo')", () => {
  const arquivos: ArquivoLeve[] = [
    { id: "90a1da12-d117-499d-90f1-fdf9f6e2fc53", file_name: "Logo Sem fundo Acerbi.png", folder: "materiais", mime_type: "criativo", project_id: P_ACERBI },
    { id: "e5ae975f-9e43-4d7b-960d-0ebf82c0cde6", file_name: "Icone Acerbi sem fundo.png", folder: "materiais", mime_type: "criativo", project_id: P_ACERBI },
    { id: "f0082553-d8b9-4abc-916b-726d44cc5650", file_name: "Empreender é desafiador - CME.png", folder: "criativos", mime_type: "image/png", project_id: P_CME },
  ];
  const nos: NoDoWorkspaceLeve[] = [
    { id: "40d8a6d9-db3d-4225-8f26-4ee4697f48ba", parent_id: null, name: "CME - Conselho da Mulher Empresaria", kind: "folder", mime: null },
    { id: "0628d70a-f262-4bc6-8150-ab47386f93b4", parent_id: "40d8a6d9-db3d-4225-8f26-4ee4697f48ba", name: "CME Logo", kind: "folder", mime: null },
    { id: "9c5c32af-34dc-4f02-bd8f-b8644c24d09a", parent_id: "0628d70a-f262-4bc6-8150-ab47386f93b4", name: "ChatGPT Image 29 de jul. de 2026, 15_49_32.png", kind: "file", mime: "image/png" },
    { id: "9e880d23-12f6-4fa6-b821-e8e646f06472", parent_id: null, name: "Referências  Design Acerbi", kind: "folder", mime: null },
  ];
  const paraLogo = (m: MarcaDoCliente) => ({ id: m.id, principal: m.principal, project_id: m.project_id, nome: m.nome });
  const todas = MARCAS.map(paraLogo);

  it("CME: acha a logo da pasta 'CME Logo' do Workspace (nome do arquivo sem 'logo'); nunca a da Acerbi", () => {
    const c = candidatosDaMarca(arquivos, nos, paraLogo(CME_VAZIA), todas);
    expect(c.map((x) => x.id)).toEqual(["9c5c32af-34dc-4f02-bd8f-b8644c24d09a"]);
    expect(c[0].caminho).toBe("CME - Conselho da Mulher Empresaria / CME Logo / ChatGPT Image 29 de jul. de 2026, 15_49_32.png");
  });

  it("Acerbi: as logos do projeto dela; nunca a pasta da CME", () => {
    const c = candidatosDaMarca(arquivos, nos, paraLogo(ACERBI), todas);
    expect(c.map((x) => x.id)).toEqual(["90a1da12-d117-499d-90f1-fdf9f6e2fc53"]);
  });

  it("mais de uma: o Jev escolhe (Choice com 'nenhum'); confiança baixa não escolhe", () => {
    const dois = candidatosDaMarca(arquivos.concat([{ id: "x", file_name: "Logo CME rosa.png", folder: "identidade", mime_type: "image/png", project_id: P_CME }]), nos, paraLogo(CME_VAZIA), todas);
    expect(dois.length).toBe(2);
    const p = perguntaDaLogo(paraLogo(CME_VAZIA), ["Acerbi"], dois);
    expect(Object.keys(p.questions.logo.criteria)).toEqual(["c1", "c2", "nenhum"]);
    expect(JSON.stringify(p.state)).not.toContain("90a1da12");
    expect(escolhaDaLogo(dois, { choice: "c2", confidence: 0.9 })).toBe(dois[1]);
    expect(escolhaDaLogo(dois, { choice: "c2", confidence: 0.3 })).toBeNull();
    expect(escolhaDaLogo(dois, { choice: "nenhum", confidence: 0.9 })).toBeNull();
  });
});

// ------------------------------------------------------------------ 4. gravação no lugar certo

describe("edição grava no lugar certo (a mesma tela para cliente e marca)", () => {
  function consulta(tabela: string) {
    const reg = { tabela, tipo: "", campos: null as unknown, filtros: [] as [string, unknown][] };
    mock.chamadas.push(reg);
    const c: any = {
      update: (campos: unknown) => ((reg.tipo = "update"), (reg.campos = campos), c),
      upsert: (campos: unknown) => ((reg.tipo = "upsert"), (reg.campos = campos), c),
      eq: (col: string, v: unknown) => (reg.filtros.push([col, v]), c),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
    };
    return c;
  }

  it("CME aberta: grava só em cliente_marcas, presa ao cliente; Acerbi: no kit do cliente", async () => {
    mock.from.mockImplementation(consulta);
    mock.chamadas.length = 0;
    await gravarNoKit(alvoDoKit(CLIENTE, CME_VAZIA), { paleta: [{ hex: "#E50070" }] }, "u-1");
    await gravarNoKit(alvoDoKit(CLIENTE, ACERBI), { estilo: "novo" }, "u-1");
    await gravarNoKit(alvoDoKit(CLIENTE, null), { estilo: "novo" }, "u-1");
    expect(mock.chamadas.map((c) => `${c.tabela}:${c.tipo}`)).toEqual(["cliente_marcas:update", "cliente_kit_marca:upsert", "cliente_kit_marca:upsert"]);
    expect(mock.chamadas[0].filtros).toEqual([["id", ID_CME], ["client_id", CLIENTE]]);
    expect(mock.chamadas[0].campos).toMatchObject({ paleta: [{ hex: "#E50070" }], atualizado_por: "u-1" });
    // A marca de outro cliente nunca vira alvo.
    expect(alvoDoKit("22222222-2222-2222-2222-222222222222", CME_VAZIA).tabela).toBe("cliente_kit_marca");
  });

  it("marca_id vai para as funções que leem kit, contexto, Instagram, roteiros e vídeos", () => {
    const dono = {};
    definirMarcaAtual(CLIENTE, CME_VAZIA, dono);
    for (const f of ["agente-contexto", "mesa-instagram", "perfis-instagram", "mesa-roteiros", "mesa-videos", "estudio-arte", "agente-calendario", "mesa-ads", "mesa-foto", "agente-estilo", "mesa-publicidade"]) {
      expect(corpoComMarca(f, { client_id: CLIENTE }).marca_id, f).toBe(ID_CME);
    }
    limparMarcaAtual(dono);
  });
});

// ------------------------------------------------------------------ 5. contrato: todo leitor passa pela regra única

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");
function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(join(raiz, dir))) {
    const p = `${dir}/${nome}`;
    if (statSync(join(raiz, p)).isDirectory()) saida.push(...arquivos(p));
    else if (/\.(ts|tsx)$/.test(nome)) saida.push(p);
  }
  return saida;
}

describe("contrato: nenhum leitor de kit ignora a marca", () => {
  it("na tela, só o kitDaMesa lê o kit do cliente; o resto usa useKitDaMesa", () => {
    const usam = arquivos("src/components").concat(arquivos("src/pages"), arquivos("src/lib")).filter((p) => /useKitDoCliente\(/.test(ler(p)));
    expect(usam.sort()).toEqual(["src/components/mesa/contextoDoCliente.ts", "src/components/mesa/kitDaMesa.ts"]);
    for (const p of ["src/components/mesa/ContextoAutomatico.tsx", "src/components/mesa/ContextoMarca.tsx", "src/components/mesa/EstudioAvisoSemFonte.tsx", "src/components/mesa/PlanejamentoAutomatico.tsx"]) {
      expect(ler(p), p).toMatch(/useKitDaMesa\(/);
    }
  });

  it("logos: toda gravação passa pelo alvo da marca aberta (nunca direto no kit do cliente)", () => {
    const logos = ler("src/components/mesa/ContextoLogos.tsx");
    expect(logos).not.toMatch(/from\("cliente_kit_marca"\)\s*\.upsert/);
    expect(logos).toContain("gravarNoKit(alvo");
    expect(logos).toContain("marca_id: alvo.marcaId");
  });

  it("funções: dossiê, contexto, contas e fotos pela marca do pedido", () => {
    expect(ler("supabase/functions/agente-contexto/index.ts")).toContain("sugerir_kit_da_marca: sugerirKitDaMarca");
    expect(ler("supabase/functions/agente-contexto/index.ts")).toContain("if (ehOutraMarca(marcaDoMontar)) return await montarDaMarca(");
    expect(ler("supabase/functions/mesa-instagram/index.ts")).toContain("lerDossieDaMarca(servico(), clientId, marca, 1800)");
    expect(ler("supabase/functions/perfis-instagram/index.ts")).toContain("contasDaMarcaDoCliente(servico(), clientId, marca)");
    expect(ler("supabase/functions/agente-calendario/index.ts")).toContain("contasDaMarcaDoCliente(servico, clientId, marca)");
    expect(ler("supabase/functions/mesa-videos/diretor.ts")).toContain("lerDossieDaMarca(db, clientId, marca, 4000)");
    expect(ler("supabase/functions/mesa-roteiros/index.ts")).toContain("lerContextoDaMarca(servico(), clientId, marca)");
    expect(ler("supabase/functions/agente-estilo/index.ts")).toContain("fotoDaMarca(f.tags ?? null, p.marca)");
    expect(ler("supabase/functions/_shared/templates-de-design.ts")).toContain("marcaId ? t.marca_id === marcaId : t.marca_id === null");
  });

  it("migration: só amplia (sem apagar, sem mexer em RLS nem em can_access_client)", () => {
    const sql = ler("supabase/migrations/20260929020000_marcas_completas.sql");
    const codigo = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(codigo).not.toMatch(/^\s*DELETE\b|DROP TABLE|DROP POLICY|ALTER POLICY|CREATE POLICY|can_access_client|DISABLE ROW LEVEL/im);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS marca_id uuid");
    expect(sql).toContain("CREATE TRIGGER cliente_imagens_etiqueta_da_marca");
    expect(sql.indexOf("—")).toBe(-1);
  });

  it("Safari 11 e Chrome 64: nada de lookbehind, \\p{}, grupo nomeado, .at() ou Object.hasOwn nos arquivos novos da tela", () => {
    for (const p of ["src/lib/mesa/kitDaMarca.ts", "src/components/mesa/kitDaMesa.ts", "src/components/mesa/ContextoSugestaoDaMarca.tsx", "supabase/functions/_shared/heranca-da-marca.ts"]) {
      const t = ler(p);
      expect(t, p).not.toMatch(/\(\?<[=!]|\\p\{|\(\?<[a-z]|\.at\(|Object\.hasOwn/);
    }
  });
});
