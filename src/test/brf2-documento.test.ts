// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  candidatosAProva,
  type EventoReal,
  gerarPdfDoRegistro,
  montarRegistro,
  type NumeroReal,
} from "../../supabase/functions/documentos/modulos/registro-de-entrega";
import {
  DEFINICOES_DE_DOCUMENTO,
  juntarCandidatos,
  mensagemDoDocumento,
  mesAnterior,
  mesParaGerar,
  MODELOS_DE_DOCUMENTO,
  modeloDoTipo,
  normalizarRascunho,
  numerosDoRascunho,
  provasDoRascunho,
  rascunhoInicial,
  rotuloDoMesDeReferencia,
  secoesDoRascunho,
} from "../../supabase/functions/_shared/documento-modelos";
import { imagemParaPdf, imagensDoPdf, textosDoPdf, type ImagemDoPdf } from "../../supabase/functions/_shared/pdf-base";
import { JPEG_RGB } from "./fixtures/imagens-pdf";

/**
 * Frente BRF2: o documento de entrega mais completo. Modelos por tipo de
 * trabalho, rascunho editável (texto por seção, provas escolhidas e na ordem,
 * números com fonte), texto da equipe que a conferência não corta (só avisa),
 * capa com a identidade do cliente, mensagem pronta do envio e a agenda dos
 * documentos mensais.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const img = (c: string) => ({ bucket: "mesa", caminho: c });

const eventos: EventoReal[] = [
  { id: "editorial_publications:p1", fonte: "publicacao", quando: "2026-09-05T12:00:00Z", titulo: "Carrossel do pernil", detalhe: "Publicado no feed", imagem: img("a.jpg"), forte: true, link: "https://instagram.com/p/1" },
  { id: "editorial_publications:p2", fonte: "publicacao", quando: "2026-09-12T12:00:00Z", titulo: "Reels da ceia", detalhe: "Publicado em Reels", imagem: img("b.jpg"), forte: true },
  { id: "estudio_trabalhos:t1", fonte: "arte_entregue", quando: "2026-09-20T12:00:00Z", titulo: "Arte do Dia dos Pais", imagem: img("c.jpg") },
  { id: "tasks:x", fonte: "tarefa", quando: "2026-09-21T12:00:00Z", titulo: "Aprovar calendário" },
];
const numeros: NumeroReal[] = [{ rotulo: "Curtidas", valor: 1500, fonte: "Instagram, leitura de 28 de setembro de 2026" }];
const entrada = { numero: 7, versao: 1, tipo: "mes_de_pautas" as const, referencia: "2026-09", titulo: "Entrega de setembro", cliente: "Acerbi Pernil", data: "2026-09-30T12:00:00Z", periodo: null };

describe("modelos do documento", () => {
  it("5 modelos, cada um com seções e o tipo de entrega padrão", () => {
    expect(MODELOS_DE_DOCUMENTO).toEqual(["mensal", "projeto", "campanha", "site", "identidade"]);
    MODELOS_DE_DOCUMENTO.forEach((m) => {
      const d = DEFINICOES_DE_DOCUMENTO[m];
      expect(d.secoes.length).toBeGreaterThan(0);
      expect(JSON.stringify(d)).not.toMatch(/[—–]/);
    });
    expect(modeloDoTipo("mes_de_pautas")).toBe("mensal");
    expect(modeloDoTipo("projeto")).toBe("projeto");
    expect(modeloDoTipo("periodo")).toBe("campanha");
  });
});

describe("rascunho: escolhas só sobre o que aconteceu", () => {
  const candidatos = candidatosAProva(eventos);

  it("o rascunho inicial sai por código: resumo pelas contagens, provas na ordem padrão, números reais", () => {
    const r = rascunhoInicial("mensal", { titulo: "Entrega de setembro", eventos, numeros, candidatos });
    expect(r.resumo).toContain("2 publicações feitas");
    expect(r.secoes.map((s) => s.id)).toEqual(DEFINICOES_DE_DOCUMENTO.mensal.secoes.map((s) => s.id));
    expect(r.provas.map((p) => p.evento_id)).toEqual(candidatos.map((c) => c.id));
    expect(r.numeros[0]).toMatchObject({ rotulo: "Curtidas", incluir: true });
    expect(r.capa.identidade_do_cliente).toBe(true);
  });

  it("normalizar: tira o que não é evento, completa as seções do modelo e mantém a ordem da equipe", () => {
    const r = normalizarRascunho({
      modelo: "site",
      resumo: "Publicamos o site — com 5 páginas.",
      secoes: [{ id: "estrutura", titulo: "Páginas", texto: "Início e Contato" }],
      provas: [{ evento_id: "estudio_trabalhos:t1", incluir: true, legenda: "A arte" }, { evento_id: "<script>", incluir: true }, { evento_id: "editorial_publications:p1", incluir: false }],
      numeros: [{ rotulo: "Visitas", valor: "30", fonte: "", manual: true }],
    });
    expect(r.modelo).toBe("site");
    expect(r.resumo).not.toMatch(/[—–]/);
    expect(r.secoes.map((s) => s.id)).toEqual(["estrutura", "publicacao", "cuidados"]);
    expect(r.provas.map((p) => p.evento_id)).toEqual(["estudio_trabalhos:t1", "editorial_publications:p1"]);
    expect(normalizarRascunho(null).modelo).toBe("mensal");
  });

  it("provas do PDF: só as marcadas, na ordem da equipe, com a legenda dela; evento que sumiu não entra", () => {
    const r = normalizarRascunho({ provas: [{ evento_id: "estudio_trabalhos:t1", incluir: true, legenda: "Arte aprovada pelo cliente" }, { evento_id: "editorial_publications:p2", incluir: false }, { evento_id: "editorial_publications:p1", incluir: true }, { evento_id: "files:apagado", incluir: true }] });
    const provas = provasDoRascunho(candidatos, r);
    expect(provas.map((p) => p.evento_id)).toEqual(["estudio_trabalhos:t1", "editorial_publications:p1"]);
    expect(provas[0].legenda).toBe("Arte aprovada pelo cliente");
    // Candidato novo entra no fim, desmarcado.
    const junto = juntarCandidatos(normalizarRascunho({ provas: [{ evento_id: "estudio_trabalhos:t1", incluir: true }] }), candidatos);
    expect(junto.provas[0]).toMatchObject({ evento_id: "estudio_trabalhos:t1", incluir: true });
    expect(junto.provas.slice(1).every((p) => !p.incluir)).toBe(true);
  });

  it("números: o real desmarcado sai; o manual só entra com a fonte escrita", () => {
    const r = normalizarRascunho({
      numeros: [
        { rotulo: "Curtidas", valor: 1500, fonte: "Instagram, leitura de 28 de setembro de 2026", incluir: false },
        { rotulo: "Leads", valor: 42, fonte: "Gerenciador de anúncios, 30/09", incluir: true, manual: true },
        { rotulo: "Vendas", valor: 9, fonte: "", incluir: true, manual: true },
      ],
    });
    const n = numerosDoRascunho(numeros, r);
    expect(n.numeros.map((x) => x.rotulo)).toEqual(["Leads"]);
    expect(n.numeros[0].fonte).toContain("informado pela equipe");
    expect(n.avisos.join(" ")).toContain("Vendas");
  });
});

describe("texto da equipe e PDF com seções e a identidade do cliente", () => {
  it("o texto da equipe fica como ela escreveu; a conferência vira aviso", () => {
    const provas = provasDoRascunho(candidatosAProva(eventos), normalizarRascunho({ provas: [{ evento_id: "editorial_publications:p1", incluir: true }] }));
    const textos = { resumo: "Em setembro alcançamos 40% a mais de pessoas.", itens: [], proximos: ["Aprovar o calendário de outubro."] };
    const daEquipe = montarRegistro(entrada, eventos, numeros, textos, provas, [], { textoDaEquipe: true });
    expect(daEquipe.resumo).toBe("Em setembro alcançamos 40% a mais de pessoas.");
    expect(daEquipe.avisos.join(" ")).toMatch(/Texto da equipe, confira: .*40/);
    // Do agente, a mesma frase sai (regra de antes, intacta).
    const doAgente = montarRegistro(entrada, eventos, numeros, textos, provas);
    expect(doAgente.resumo).not.toContain("40%");
  });

  it("o PDF mostra as seções escritas, o rótulo do modelo e a logo real do cliente na capa", () => {
    const r = normalizarRascunho({ modelo: "mensal", secoes: [{ id: "destaques", titulo: "Destaques do mês", texto: "O carrossel do pernil foi a peça que mais apareceu." }, { id: "aprendizados", titulo: "O que aprendemos", texto: "" }] });
    const provas = provasDoRascunho(candidatosAProva(eventos), r);
    const reg = montarRegistro(entrada, eventos, numeros, { resumo: "Setembro teve publicações e artes.", itens: [], proximos: [] }, provas, [], { textoDaEquipe: true });
    reg.secoes = secoesDoRascunho(r);
    reg.rotulo_da_capa = DEFINICOES_DE_DOCUMENTO.mensal.capa;
    expect(reg.secoes).toEqual([{ titulo: "Destaques do mês", texto: "O carrossel do pernil foi a peça que mais apareceu." }]);
    const logo = imagemParaPdf(JPEG_RGB) as ImagemDoPdf;
    const bytes = gerarPdfDoRegistro(reg, {}, { logoDoCliente: logo, corDoCliente: "#c2185b" });
    const tudo = textosDoPdf(bytes).join(" ");
    expect(tudo).toContain("RELATÓRIO DO MÊS");
    expect(tudo).toContain("DESTAQUES DO MÊS");
    expect(tudo).toContain("O carrossel do pernil foi a peça que mais apareceu.");
    expect(tudo).toContain("Nossa leitura da entrega");
    // A logo do cliente entra pelo código (a imagem real), não pelo gerador.
    expect(imagensDoPdf(bytes)).toEqual([{ largura: 24, altura: 16, filtro: "DCTDecode" }]);
    // Sem identidade: nenhuma imagem e o PDF sai igual ao de antes.
    expect(imagensDoPdf(gerarPdfDoRegistro(reg, {}))).toEqual([]);
  });
});

describe("envio e agenda mensal", () => {
  it("mensagem pronta: com número, sem travessão e sem exclamação", () => {
    const m = mensagemDoDocumento({ cliente: "Acerbi", titulo: "Entrega de setembro", numero: 7, itens: 12, provas: 3, url: "https://app/documentos", aprovar: true });
    expect(m).toContain("Olá, Acerbi.");
    expect(m).toContain("(nº 0007)");
    expect(m).toContain("12 itens feitos e 3 provas com imagem");
    expect(m).toContain("aprove");
    expect(m).not.toMatch(/[—–!]/);
    expect(mensagemDoDocumento({ titulo: "X", itens: 0, provas: 0, url: "u", grupo: true })).toContain("Olá, pessoal.");
  });

  it("o mês a preparar: o anterior, a partir do dia marcado, uma vez só (horário de São Paulo)", () => {
    const dia2 = new Date("2026-10-02T12:00:00Z");
    expect(mesAnterior(dia2)).toBe("2026-09");
    expect(mesAnterior(new Date("2027-01-10T12:00:00Z"))).toBe("2026-12");
    expect(mesParaGerar(dia2, 3, null)).toBeNull();
    expect(mesParaGerar(new Date("2026-10-03T12:00:00Z"), 3, null)).toBe("2026-09");
    expect(mesParaGerar(new Date("2026-10-20T12:00:00Z"), 3, "2026-09")).toBeNull();
    // 1º de outubro às 01h em UTC ainda é 30 de setembro em São Paulo.
    expect(mesParaGerar(new Date("2026-10-01T01:00:00Z"), 1, null)).toBe("2026-08");
    expect(rotuloDoMesDeReferencia("2026-09")).toBe("setembro de 2026");
  });
});

describe("ligações da função documentos", () => {
  it("index abaixo de 700 linhas, Confirmar nos dois lugares, rascunho sem IA e cron só com o segredo", () => {
    const f = ler("supabase/functions/documentos/index.ts");
    expect(f.split("\n").length).toBeLessThan(700);
    expect(f.match(/confirmacao_obrigatoria/g)!.length).toBe(2);
    expect(f).toContain("usar_rascunho");
    expect(f).toContain("{ textoDaEquipe: daEquipe }");
    expect(f).toContain("identidadeDaCapa(");
    expect(f).toContain("respostaDoCron(req, json)");
    expect(f).not.toMatch(/[–—]/);
    const agenda = ler("supabase/functions/documentos/agenda.ts");
    expect(agenda).toContain('Deno.env.get("CRON_SECRET")');
    expect(agenda).not.toMatch(/chamarTexto|jevPerguntar/);
    expect(agenda).toContain('"avisar_equipe_do_cliente"');
    const rasc = ler("supabase/functions/documentos/rascunho.ts");
    expect(rasc).not.toMatch(/chamarTexto|chamarImagem/);
    // Marca que não é a principal só usa o que é dela na capa.
    expect(rasc).toContain("marca && !marca.principal");
  });

  it("migração: só amplia, RLS por cliente, escrita só pela função e o cron da agenda", () => {
    const sql = ler("supabase/migrations/20260930196100_documentos_evolucao.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).toContain("REVOKE ALL ON public.documentos_agenda FROM PUBLIC, anon, authenticated");
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM/i);
    expect(sql).toContain("'documentos-agenda-mensal'");
    expect(sql).toContain("x-cron-secret");
  });
});
