import { describe, expect, it } from "vitest";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { conteudoDoModelo, MODELO_PADRAO_ACELERIQ, normalizarItens, type DadoDeMercado } from "../../supabase/functions/_shared/proposta-modelo";
import {
  alvosDaProposta,
  blocoDasAcoesDaProposta,
  caminhoDaProposta,
  lerAlvoDoBloco,
  lerAlvoDoItem,
  lerItemPedido,
  normalizarAcoesDaProposta,
  regrasDaProposta,
  respostaPromete,
  valorCitadoNoPedido,
  type PropostaParaAcao,
} from "../../supabase/functions/mesa-proposta/acoes-da-proposta";
import { avisosDaRevisao, lerConferencia, perguntasDaConferencia } from "../../supabase/functions/mesa-proposta/conferencia";
import { agenciaPublica, blocosDaAgencia, contatosDaAgencia } from "../../supabase/functions/mesa-proposta/agencia";
import { faltasNosDados, normalizarDadosDaAgencia } from "../../supabase/functions/_shared/dados-da-agencia";

const ID = "11111111-1111-4111-8111-111111111111";
const CLIENTE = "22222222-2222-4222-8222-222222222222";

function proposta(extra: Partial<PropostaParaAcao> = {}): PropostaParaAcao {
  return {
    id: ID,
    titulo: "Identidade visual",
    numero: "2026-001",
    status: "rascunho",
    validade_ate: "2026-10-15",
    blocos: conteudoDoModelo(MODELO_PADRAO_ACELERIQ).blocos,
    itens: normalizarItens([{ id: "x1", nome: "Logo", valor_unitario: 3000 }]),
    ...extra,
  };
}

describe("ações do estrategista comercial", () => {
  it("apelidos: p1 é a proposta, b1..b12 os blocos (b1 a capa), i1 os itens; nunca o id no prompt", () => {
    const alvos = alvosDaProposta(proposta());
    expect(alvos.map((a) => a.ref).slice(0, 3)).toEqual(["p1", "b1", "b2"]);
    expect(alvos.find((a) => a.ref === "b1")!.dados!.tipo).toBe("capa");
    expect(alvos.find((a) => a.ref === "i1")!.titulo).toBe("Logo");
    const bloco = blocoDasAcoesDaProposta(proposta());
    expect(bloco).not.toContain(ID);
    expect(lerAlvoDoBloco(`${ID}:capa`)).toEqual({ propostaId: ID, tipo: "capa" });
    expect(lerAlvoDoItem(`${ID}:item:x1`)).toEqual({ propostaId: ID, itemId: "x1" });
  });

  it("preço só com o valor dito no pedido: item inventado vai para recusados", () => {
    const bruto = { resumo: "Adicionar itens", itens: [{ operacao: "adicionar_item", ref: "p1", para: "Site | 4.500 | unico | 1" }, { operacao: "adicionar_item", ref: "p1", para: "Gestão | 1800 | mensal | 1" }] };
    const a = normalizarAcoesDaProposta(bruto, proposta(), "adicione o site por 4.500", 0.05, 0.02)!;
    expect(a.itens).toHaveLength(1);
    expect(a.itens[0].para_rotulo).toContain("R$ 4.500,00");
    expect(a.recusados).toHaveLength(1);
    expect(a.recusados[0].motivo).toMatch(/valor não está no seu pedido/);
    expect(valorCitadoNoPedido("4500", "o site sai por 4,5 mil")).toBe(true);
    expect(valorCitadoNoPedido("4800", "o site sai por 4,5 mil")).toBe(false);
    expect(lerItemPedido("Gestão mensal | 1.800,00 | mensal | 2")).toMatchObject({ nome: "Gestão mensal", valor: 1800, recorrencia: "mensal", quantidade: 2 });
  });

  it("headline só na capa; provas e quem somos não se reescrevem; proposta aceita trava tudo", () => {
    const bruto = {
      resumo: "x",
      itens: [
        { operacao: "trocar_headline", ref: "b2", para: "Nova headline de benefício" },
        { operacao: "reescrever_bloco", ref: "b10", para: "mais forte" },
      ],
    };
    const a = normalizarAcoesDaProposta(bruto, proposta(), "troque", 0.05, 0.02)!;
    expect(a.itens).toHaveLength(0);
    expect(a.recusados.map((r) => r.motivo).join(" ")).toMatch(/capa/);
    expect(a.recusados.map((r) => r.motivo).join(" ")).toMatch(/dados da agência/);
    const aceita = normalizarAcoesDaProposta({ resumo: "x", itens: [{ operacao: "ocultar_bloco", ref: "b3", para: "" }] }, proposta({ status: "aceita" }), "oculte", 0.05, 0.02)!;
    expect(aceita.recusados[0].motivo).toMatch(/aceita não muda/);
  });

  it("sem custo e com Desfazer vai direto; IA pede Confirmar com o custo antes", () => {
    const direta = normalizarAcoesDaProposta({ resumo: "x", itens: [{ operacao: "trocar_headline", ref: "b1", para: "Mais clientes no bairro" }] }, proposta(), "troque a headline", 0.05, 0.02)!;
    expect(direta.custo_estimado_usd).toBe(0);
    expect(podeExecutarDireto(direta, regrasDaProposta(), { pedidoClaro: true }).direto).toBe(true);
    const ia = normalizarAcoesDaProposta({ resumo: "x", itens: [{ operacao: "gerar_proposta", ref: "p1", para: "" }] }, proposta(), "escreva a proposta", 0.05, 0.02)!;
    expect(ia.custo_estimado_usd).toBeCloseTo(0.07, 6);
    expect(podeExecutarDireto(ia, regrasDaProposta(), { pedidoClaro: true }).direto).toBe(false);
  });

  it("o Ir para leva ao Rascunho (texto) ou ao Contexto (preço e validade)", () => {
    const c1 = caminhoDaProposta(CLIENTE, ID, { itens: [{ operacao: "trocar_headline" }] as never });
    expect(c1!.destino).toContain("/mesa-proposta?client=");
    expect(c1!.destino).toContain("etapa=rascunho");
    expect(c1!.destino).toContain(`proposta=${ID}`);
    const c2 = caminhoDaProposta(CLIENTE, ID, { itens: [{ operacao: "adicionar_item" }] as never });
    expect(c2!.destino).toContain("etapa=contexto");
  });

  it("resposta que promete sem lista é pega", () => {
    expect(respostaPromete("Vou escrever a proposta agora.")).toBe(true);
    expect(respostaPromete("Qual o preço do site?")).toBe(false);
  });
});

describe("conferência do Jev (respostas falsas, só aviso)", () => {
  const fonte = { titulo: "Pesquisa", url: "https://exemplo.org/p", data: "2026-08" };
  const dados: DadoDeMercado[] = [
    { rotulo: "Compram online", valor: "64%", fonte, trecho: "64% dos consumidores compram online" },
    { rotulo: "Crescimento", valor: "18%", fonte, trecho: "o setor cresceu 12% em 2025" },
    { rotulo: "Ticket", valor: "R$ 90", fonte, trecho: "" },
    { rotulo: "Lojas", valor: "300", fonte, trecho: "há muitas lojas" },
  ];

  it("só pergunta o que tem trecho, no formato do citation check", () => {
    const p = perguntasDaConferencia(dados)!;
    expect(Object.keys(p.questions)).toEqual(["r0", "r1", "r3"]);
    expect(Object.keys(p.questions.r0.criteria)).toEqual(["supports", "contradicts", "says_nothing"]);
    expect(p.state.dado_1).toEqual({ claim: "Crescimento: 18%", section: "o setor cresceu 12% em 2025" });
    expect(perguntasDaConferencia([dados[2]])).toBeNull();
  });

  it("lê os vereditos; 'confere' só com confiança alta; Jev fora do ar vira 'não conferido'", () => {
    const r = lerConferencia(dados, { r0: { choice: "supports", confidence: 0.93 }, r1: { choice: "contradicts", confidence: 0.9 }, r3: { choice: "supports", confidence: 0.55 } });
    expect(r.map((x) => x.veredito)).toEqual(["confere", "contradiz", "sem_trecho", "sem_conferencia"]);
    expect(lerConferencia(dados, null).map((x) => x.veredito)).toEqual(["sem_conferencia", "sem_conferencia", "sem_trecho", "sem_conferencia"]);
  });

  it("avisos da revisão pelos limiares, sem refazer nada", () => {
    expect(avisosDaRevisao({ clareza: 1.2, promessa: 0.8, voz: 0.2 })).toHaveLength(3);
    expect(avisosDaRevisao({ clareza: 2.6, promessa: 0.1, voz: 0.9 })).toEqual([]);
    expect(avisosDaRevisao({ clareza: null, promessa: null, voz: null })).toEqual([]);
  });
});

describe("dados da agência (fonte da frente BASE, sem inventar prova)", () => {
  it("quem somos leva só o que está cadastrado; provas ficam vazias até existir case real", () => {
    const d = normalizarDadosDaAgencia({ nome_fantasia: "Aceleriq", email: "contato@aceleriq.com", telefone: "(43) 99999-0000", site: "aceleriq.com", instagram: "@aceleriq", cidade: "Londrina", uf: "PR", cnpj: "00.000.000/0001-00", pix_chave: "chave" });
    const b = blocosDaAgencia(d);
    expect(b.provas).toEqual({ cases: [], depoimentos: [] });
    expect(String(b.quem_somos.texto)).toContain("Aceleriq.");
    expect(contatosDaAgencia(d)).toBe("aceleriq.com · contato@aceleriq.com · (43) 99999-0000 · @aceleriq · Londrina/PR");
    // O link público não mostra CNPJ nem Pix.
    expect(JSON.stringify(agenciaPublica(d))).not.toMatch(/0001|chave/);
  });

  it("vazio: sem contato inventado e com as faltas da proposta (nome, e-mail, telefone e logo)", () => {
    const d = normalizarDadosDaAgencia(null);
    expect(blocosDaAgencia(d).quem_somos.texto).toBe("");
    expect(faltasNosDados(d, "proposta").map((f) => f.campo).sort()).toEqual(["email", "logo_path", "nome_fantasia", "telefone"]);
    expect(agenciaPublica(d).nome).toBe("Aceleriq");
  });
});
