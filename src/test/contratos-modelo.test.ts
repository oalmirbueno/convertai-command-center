// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agenciaDoRegistro,
  dataPorExtenso,
  diffDeDocumentos,
  diffDeTexto,
  extensoEmReais,
  extensoInteiro,
  faltandoNaAgencia,
  formatarValor,
  hashDoTexto,
  lerDocumento,
  lerMoeda,
  mensagensProntas,
  montarContrato,
  nomeDoArquivoDoContrato,
  podeCongelar,
  valoresComPadrao,
  valoresDoCliente,
  valoresLembrados,
  variaveisDoContrato,
  type DadosDaAgencia,
  type ServicoDoContrato,
  type Valores,
} from "../../supabase/functions/_shared/contrato-modelo";
import { MODELOS_V1, REVISAO_JURIDICA_V1 } from "../../supabase/functions/contratos/modulos/contrato-modelo-v1";
import { gerarPdfDoContrato, paginasDoPdf, textosDoPdf } from "../../supabase/functions/_shared/pdf-contrato";
import { estadoDaAutentique, pedidoDeDocumentoAutentique } from "../../supabase/functions/contratos/modulos/assinatura-autentique";

/**
 * Frente CON (30/09): modelo-base em 3 camadas (quadro-resumo, condições
 * gerais, blocos por serviço), variáveis que faltam bloqueiam, hash do texto
 * congelado, dados da agência obrigatórios e o conteúdo que o dono exigiu
 * (LGPD, foro, escada de disputas, rescisão, reajuste, multa proporcional,
 * isenção de resultado, banco de imagens e fontes; nada de lei revogada).
 */

const AGENCIA: DadosDaAgencia = {
  razao_social: "Aceleriq Marketing Ltda",
  nome_fantasia: "Aceleriq",
  cnpj: "12.345.678/0001-90",
  endereco: "Rua das Flores, 100, Centro",
  cidade: "Londrina",
  uf: "PR",
  representante: "Almir Bueno",
  representante_cpf: "",
  email: "contato@aceleriq.com.br",
  foro: "Londrina/PR",
};

const CLIENTE: Valores = valoresDoCliente({ nome: "Padaria Pão Bom Ltda", documento: "11.222.333/0001-44", endereco: "Av. Brasil, 500, Curitiba/PR", email: "dono@paobom.com.br", representante: "Maria Silva" });

function valoresCompletos(servicos: ServicoDoContrato[], extra: Valores = {}): Valores {
  const vars = variaveisDoContrato(MODELOS_V1, servicos);
  const base: Valores = {
    ...CLIENTE,
    inicio: "2026-10-01",
    valor_hora_extra: "180",
    valor_total: "8460",
    valor_mensal: "3500",
    vencimento_dia: "10",
    vigencia_meses: "12",
    social_perfis: "@paobom no Instagram",
    social_pecas_mes: "8 carrosséis, 4 reels e 12 stories",
    site_tipo: "site institucional com 5 páginas",
    site_plataforma: "Next.js",
    site_prazo_layout_dias: "20",
    site_prazo_dev_dias: "20",
    marca_prazo_conceitos_dias: "10",
    marca_prazo_final_dias: "15",
    naming_prazo_dias: "10",
    trafego_plataformas: "Meta Ads",
    video_quantidade: "4 vídeos",
    video_duracao: "até 60 segundos cada",
    video_prazo_dias: "15",
    design_pecas: "1 folder A4",
    design_finalidade: "divulgação da loja",
    design_prazo_dias: "5",
    mensal_pacote: "até 20 peças por mês",
    mensal_vigencia_minima_meses: "3",
    ...extra,
  };
  return valoresComPadrao(vars, base);
}

const montar = (servicos: ServicoDoContrato[], valores: Valores, agencia: DadosDaAgencia = AGENCIA) =>
  montarContrato({ modelos: MODELOS_V1, servicos, valores, agencia, numero: "CT-2026-0007", versao: 1, data: "2026-09-30" });

describe("contratos: montagem por serviço", () => {
  it("social monta o quadro, as condições gerais e só o anexo de social", () => {
    const m = montar(["social"], valoresCompletos(["social"]));
    expect(m.texto).toContain("# Contrato de prestação de serviços");
    expect(m.texto).toContain("## Quadro-resumo");
    expect(m.texto).toContain("## Condições gerais");
    expect(m.texto).toContain("## Anexo A. Social e Instagram");
    expect(m.texto).not.toContain("Sites e landing pages");
    expect(m.texto).toContain("para os perfis @paobom no Instagram");
    expect(m.texto).toContain("R$ 3.500,00 (três mil e quinhentos reais) por mês");
    expect(m.clausulas.some((c) => c.chave === "bloco_social:comunidade_nao")).toBe(true);
    expect(m.faltando).toEqual([]);
  });

  it("site e marca entram como anexos A e B, na ordem oficial, com a regra de direitos de cada um", () => {
    const m = montar(["marca", "site"], valoresCompletos(["site", "marca"]));
    const a = m.texto.indexOf("## Anexo A. Sites e landing pages");
    const b = m.texto.indexOf("## Anexo B. Marca e identidade visual");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(m.texto).toContain("Sites e landing pages: licença de uso; Marca e identidade visual: cessão dos direitos patrimoniais após o pagamento");
    expect(m.texto).toContain("### A.1 Entregas");
    expect(m.texto).toContain("R$ 8.460,00 (oito mil, quatrocentos e sessenta reais)");
  });

  it("os oito blocos montam sem nada faltando quando preenchidos", () => {
    const todos: ServicoDoContrato[] = ["social", "site", "marca", "naming", "trafego", "video", "design", "mensalista"];
    const m = montar(todos, valoresCompletos(todos));
    expect(m.faltando).toEqual([]);
    for (const letra of ["A", "B", "C", "D", "E", "F", "G", "H"]) expect(m.texto).toContain(`## Anexo ${letra}.`);
  });

  it("variantes: silêncio pausa por padrão; aprovação tácita troca a cláusula; portfólio e IA seguem a escolha", () => {
    const padrao = montar(["design"], valoresCompletos(["design"]));
    expect(padrao.texto).toContain("o cronograma fica suspenso");
    expect(padrao.texto).toContain("curadoria, a edição e a aprovação final de cada entrega são feitas por pessoas");
    const outro = montar(["design"], valoresCompletos(["design"], { silencio_efeito: "aprovacao_tacita", portfolio: "nao", uso_ia: "nao" }));
    expect(outro.texto).toContain("a entrega é considerada aprovada");
    expect(outro.texto).not.toContain("o cronograma fica suspenso e volta");
    expect(outro.texto).toContain("não usa as entregas em portfólio");
    expect(outro.texto).toContain("não usa ferramentas de inteligência artificial generativa");
  });

  it("revisões: 2 rodadas por padrão, com o valor da hora extra", () => {
    const m = montar(["design"], valoresCompletos(["design"]));
    expect(m.texto).toContain("Cada entrega inclui 2 (duas) rodadas de revisão");
    expect(m.texto).toContain("R$ 180,00 (cento e oitenta reais) por hora");
  });
});

describe("contratos: o que falta bloqueia", () => {
  it("variável obrigatória vazia aparece em faltando e não congela", () => {
    const vars = variaveisDoContrato(MODELOS_V1, ["site"]);
    const valores = valoresComPadrao(vars, { ...CLIENTE });
    const m = montar(["site"], valores);
    const nomes = m.faltando.map((f) => f.nome);
    expect(nomes).toEqual(expect.arrayContaining(["inicio", "valor_hora_extra", "valor_total", "site_tipo", "site_plataforma"]));
    expect(m.texto).toContain("[falta:");
    const pode = podeCongelar(m);
    expect(pode.pode).toBe(false);
    expect(pode.motivo).toContain("Falta preencher");
  });

  it("valor inválido também bloqueia, com o motivo", () => {
    const m = montar(["design"], valoresCompletos(["design"], { valor_total: "oito mil" }));
    const f = m.faltando.find((x) => x.nome === "valor_total");
    expect(f && f.motivo).toBe("invalida");
    expect(podeCongelar(m).pode).toBe(false);
  });

  it("sem os dados da agência o contrato não é gerado", () => {
    expect(faltandoNaAgencia(null)).toEqual(["razão social", "CNPJ", "endereço da sede", "cidade da sede", "UF da sede", "representante legal", "comarca do foro"]);
    const semForo = { ...AGENCIA, foro: "" };
    expect(faltandoNaAgencia(semForo)).toEqual(["comarca do foro"]);
    const m = montar(["design"], valoresCompletos(["design"]), semForo);
    expect(podeCongelar(m).pode).toBe(false);
    expect(m.faltando.some((f) => f.onde === "dados da agência")).toBe(true);
  });

  it("usa a ficha da frente BASE (comarca, representante, endereço em linhas) e a qualificação pronta", () => {
    const a = agenciaDoRegistro({ razao_social: "Aceleriq Ltda", cnpj: "12.345.678/0001-90", endereco: "Rua A, 10\nCentro", cidade: "Londrina", uf: "PR", comarca: "Londrina/PR", representante_nome: "Almir", email: "a@b.com" });
    expect(a.endereco).toBe("Rua A, 10, Centro");
    expect(a.foro).toBe("Londrina/PR");
    expect(a.representante).toBe("Almir");
    const m = montarContrato({ modelos: MODELOS_V1, servicos: ["design"], valores: valoresCompletos(["design"]), agencia: a, numero: "CT-1", versao: 1, data: "2026-09-30", qualificacao: "ACELERIQ LTDA, pessoa jurídica de direito privado" });
    expect(m.texto).toContain("| Contratada | ACELERIQ LTDA, pessoa jurídica de direito privado.");
  });

  it("lê a ficha da agência com nomes de coluna diferentes", () => {
    const a = agenciaDoRegistro({ nome_empresarial: "X Ltda", cnpj: "1", logradouro: "Rua A", numero: "10", bairro: "Centro", cep: "86000-000", municipio: "Londrina", estado: "pr", representante_legal: "Almir", comarca: "Londrina/PR" });
    expect(a.razao_social).toBe("X Ltda");
    expect(a.endereco).toBe("Rua A, 10, Centro, CEP 86000-000");
    expect(a.uf).toBe("PR");
    expect(faltandoNaAgencia(a)).toEqual([]);
  });
});

describe("contratos: hash e congelamento", () => {
  it("SHA-256 do texto em UTF-8 (o mesmo que o banco confere)", async () => {
    expect(await hashDoTexto("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const h1 = await hashDoTexto("contrato ção");
    const h2 = await hashDoTexto("contrato cão");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
  });

  it("a mesma entrada dá o mesmo texto e o mesmo hash; qualquer mudança muda o código", async () => {
    const v = valoresCompletos(["social"]);
    const a = montar(["social"], v);
    const b = montar(["social"], { ...v });
    expect(a.texto).toBe(b.texto);
    expect(await hashDoTexto(a.texto)).toBe(await hashDoTexto(b.texto));
    const c = montar(["social"], { ...v, valor_mensal: "3600" });
    expect(await hashDoTexto(c.texto)).not.toBe(await hashDoTexto(a.texto));
  });

  it("cláusula alterada entra no lugar do texto do modelo e muda o hash", async () => {
    const v = valoresCompletos(["design"]);
    const base = montar(["design"], v);
    const alterado = montarContrato({
      modelos: MODELOS_V1, servicos: ["design"], valores: v, agencia: AGENCIA, numero: "CT-2026-0007", versao: 1, data: "2026-09-30",
      alteradas: [{ chave: "bloco_design:producao", texto: "A impressão fica por conta do CONTRATANTE, com acompanhamento da CONTRATADA sem custo.", texto_original: "" }],
    });
    expect(alterado.texto).toContain("com acompanhamento da CONTRATADA sem custo");
    expect(alterado.clausulas.find((c) => c.chave === "bloco_design:producao")!.alterada).toBe(true);
    expect(await hashDoTexto(alterado.texto)).not.toBe(await hashDoTexto(base.texto));
  });
});

describe("contratos: conteúdo obrigatório e texto limpo", () => {
  const todos: ServicoDoContrato[] = ["social", "site", "marca", "naming", "trafego", "video", "design", "mensalista"];
  const texto = montar(todos, valoresCompletos(todos)).texto;
  const modeloInteiro = MODELOS_V1.map((m) => m.clausulas.map((c) => c.texto).join("\n")).join("\n");

  it("LGPD, foro da agência, escada de disputas, rescisão, reajuste, multa proporcional, resultado, bancos e fontes", () => {
    expect(texto).toContain("Lei 13.709/2018 (LGPD)");
    expect(texto).toContain("fica eleito o foro da comarca de Londrina/PR");
    expect(texto).toContain("primeiro por negociação direta");
    expect(texto).toContain("podem buscar mediação");
    expect(texto).toContain("foro do seu domicílio");
    expect(texto).toContain("Vigência, renovação e rescisão");
    expect(texto).toContain("reajustados a cada 12 meses pela variação acumulada do IPCA");
    expect(texto).toContain("multa de 20% (vinte por cento) sobre o saldo ainda não executado");
    expect(texto).toContain("artigo 413 do Código Civil");
    expect(texto).toContain("obrigação de meio");
    expect(texto).toContain("Bancos de imagem, fontes, músicas");
    expect(texto).toContain("Lei 9.610/1998");
  });

  it("nada de lei revogada, arbitragem, senha do cliente, travessão ou marca de revisão jurídica no texto do cliente", () => {
    for (const t of [texto, modeloInteiro]) {
      expect(t).not.toContain("5.988");
      expect(t.toLowerCase()).not.toContain("arbitragem");
      expect(t).not.toMatch(/[—–]/);
    }
    expect(texto.toLowerCase()).not.toContain("revisão jurídica");
    expect(texto).toContain("Nenhuma senha pessoal do CONTRATANTE é pedida");
    expect(MODELOS_V1.every((m) => m.revisao_juridica === REVISAO_JURIDICA_V1)).toBe(true);
  });

  it("todo {{campo}} das cláusulas existe como variável do modelo ou dado da agência", () => {
    const nomes = new Set<string>();
    MODELOS_V1.forEach((m) => m.variaveis.forEach((v) => nomes.add(v.nome)));
    const citados = modeloInteiro.match(/\{\{\s*([a-z0-9_]+)\s*\}\}/g) || [];
    for (const c of citados) {
      const nome = c.replace(/[{}\s]/g, "");
      if (nome.indexOf("agencia_") === 0) continue;
      expect(nomes.has(nome), nome).toBe(true);
    }
  });

  it("o seed da migration tem o mesmo texto do arquivo (fonte única)", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260930030200_contratos_modelo_v1.sql"), "utf8");
    for (const m of MODELOS_V1) {
      expect(sql).toContain(`'${m.chave}'`);
      for (const c of m.clausulas) expect(sql, `${m.chave}:${c.chave}`).toContain(`'${c.texto.replace(/'/g, "''")}'`);
    }
    expect((sql.match(/ON CONFLICT \(chave, versao\) DO NOTHING/g) || []).length).toBe(MODELOS_V1.length);
  });
});

describe("contratos: números, datas e textos prontos (código, nunca o modelo)", () => {
  it("extenso", () => {
    expect(extensoEmReais(8000)).toBe("oito mil reais");
    expect(extensoEmReais(1500.5)).toBe("mil e quinhentos reais e cinquenta centavos");
    expect(extensoEmReais(1)).toBe("um real");
    expect(extensoEmReais(1_000_000)).toBe("um milhão de reais");
    expect(extensoEmReais(2_345_678.9)).toBe("dois milhões, trezentos e quarenta e cinco mil, seiscentos e setenta e oito reais e noventa centavos");
    expect(extensoInteiro(100)).toBe("cem");
    expect(extensoInteiro(1100)).toBe("mil e cem");
    expect(extensoInteiro(21)).toBe("vinte e um");
  });

  it("moeda, data e percentual", () => {
    expect(lerMoeda("R$ 8.000,50")).toBe(8000.5);
    expect(lerMoeda("8.000")).toBe(8000);
    expect(lerMoeda("oito")).toBeNull();
    expect(dataPorExtenso("2026-10-01")).toBe("1º de outubro de 2026");
    expect(dataPorExtenso("15/03/2027")).toBe("15 de março de 2027");
    expect(formatarValor({ nome: "x", rotulo: "x", tipo: "percentual" }, "20")).toBe("20% (vinte por cento)");
  });

  it("mensagens prontas para WhatsApp e e-mail levam o link e o código; nada é enviado", () => {
    const m = mensagensProntas({ cliente: "Maria", titulo: "Contrato de Social", link: "https://painel/contrato/abc", hash: "a".repeat(64), agencia: "Aceleriq" });
    expect(m.whatsapp).toContain("https://painel/contrato/abc");
    expect(m.whatsapp).toContain("aaaaaaaaaaaa");
    expect(m.email).toContain("SHA-256");
    expect(m.wa_me).toContain("https://wa.me/?text=");
  });

  it("nome do arquivo sem acento", () => {
    expect(nomeDoArquivoDoContrato("CT-2026-0007", "Padaria Pão Bom", 2, true)).toBe("contrato-ct-2026-0007-padaria-pao-bom-v2-assinado.pdf");
  });

  it("aprende os valores que a agência usou por último", () => {
    const l = valoresLembrados(MODELOS_V1, [{ valor_hora_extra: "200", valor_total: "9000" }, { valor_hora_extra: "150", prazo_resposta_dias: "3" }]);
    expect(l).toEqual({ valor_hora_extra: "200", prazo_resposta_dias: "3" });
    const vars = variaveisDoContrato(MODELOS_V1, ["design"]);
    expect(valoresComPadrao(vars, {}, l).valor_hora_extra).toBe("200");
  });
});

describe("contratos: leitura, diferença e PDF", () => {
  it("lê o texto canônico em blocos", () => {
    const b = lerDocumento("# T\n@ meta\n## S\n| Rótulo | valor | com barra\n### 1. C\n- item\nparágrafo");
    expect(b.map((x) => x.tipo)).toEqual(["titulo", "meta", "secao", "quadro", "clausula", "item", "paragrafo"]);
    expect(b[3]).toEqual({ tipo: "quadro", rotulo: "Rótulo", texto: "valor | com barra" });
  });

  it("diferença palavra a palavra e linha a linha", () => {
    const d = diffDeTexto("Cada entrega inclui 2 rodadas.", "Cada entrega inclui 3 rodadas.");
    expect(d.filter((p) => p.tipo === "saiu").map((p) => p.texto.trim())).toEqual(["2"]);
    expect(d.filter((p) => p.tipo === "entrou").map((p) => p.texto.trim())).toEqual(["3"]);
    const linhas = diffDeDocumentos("a\nb\nc", "a\nB\nc\nd");
    expect(linhas.map((l) => l.tipo)).toEqual(["igual", "mudou", "igual", "entrou"]);
  });

  it("PDF: prévia marcada; congelado com o código; carimbo com assinaturas e trilha", () => {
    const m = montar(["social"], valoresCompletos(["social"]));
    const previa = gerarPdfDoContrato({ texto: m.texto, numero: "CT-2026-0007", versao: 1 });
    expect(String.fromCharCode.apply(null, Array.from(previa.slice(0, 8)))).toBe("%PDF-1.4");
    expect(textosDoPdf(previa).join(" ")).toContain("PRÉVIA");
    const hash = "b".repeat(64);
    const final = gerarPdfDoContrato({
      texto: m.texto, numero: "CT-2026-0007", versao: 1, hash,
      carimbo: {
        assinaturas: [
          { papel: "Pela contratada", nome: "Almir Bueno", email: "almir@aceleriq.com.br", quando: "2026-09-30T13:00:00Z", ip: "1.2.3.4" },
          { papel: "Pelo contratante", nome: "Maria Silva", email: "dono@paobom.com.br", quando: "2026-09-30T15:00:00Z", ip: "5.6.7.8", navegador: "Safari" },
        ],
        eventos: [{ quando: "2026-09-30T13:00:00Z", texto: "Texto congelado." }],
      },
    });
    const t = textosDoPdf(final).join(" ");
    expect(t).toContain("PÁGINA DE CARIMBO");
    expect(t).toContain("Maria Silva");
    expect(t).toContain("30/09/2026 12:00:00 (Brasília)");
    expect(t).toContain(`SHA-256 ${hash}`);
    expect(t).toContain("QUADRO-RESUMO");
    expect(paginasDoPdf(final)).toBeGreaterThan(paginasDoPdf(previa));
  });

  it("Autentique fica desligada e não chama nada", () => {
    const e = estadoDaAutentique({ get: () => "chave-de-teste" });
    expect(e.ligada).toBe(false);
    expect(e.pronta).toBe(true);
    expect(estadoDaAutentique(null).pronta).toBe(false);
    expect(pedidoDeDocumentoAutentique({ nome: "C", signatarios: [{ email: " A@B.COM " }] }).variables.signers[0].email).toBe("a@b.com");
    const fonte = readFileSync(resolve(process.cwd(), "supabase/functions/contratos/modulos/assinatura-autentique.ts"), "utf8");
    expect(fonte).not.toMatch(/\bfetch\s*\(/);
  });
});
