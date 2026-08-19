import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  dossieMaisRecente, idadeEmPalavras, trechoDoContexto,
} from "@/lib/contextoDoCliente";

const raiz = resolve(__dirname, "../..");
const central = readFileSync(resolve(raiz, "src/pages/AdminExperience.tsx"), "utf8");
const painel = readFileSync(resolve(raiz, "src/components/admin/DossieDoCliente.tsx"), "utf8");

/**
 * O dossiê do cliente é gravado com milhares de caracteres pela rotina do GPT.
 * A Central mostrava o TÍTULO — "Dossiê de contexto - 18/08/2026" — que é
 * rótulo com data e sai praticamente igual em toda versão. Atualizar o dossiê
 * e puxar na tela não mudava nada visível, com o dado certo no banco.
 */

// Espelha o registro real do Vifut: título-rótulo, corpo com a substância.
const dossieReal = {
  kind: "summary",
  source: "gpt-contexto-semanal",
  title: "Dossiê de contexto - 18/08/2026 - atualização",
  content:
    "ONDE ESTAMOS\n\nEm 18/08/2026, o cadastro de Reinaldo Zequinão Filho segue como " +
    "Vifut.com.br, cliente recorrente, com plano Vid Pro ativo de R$797 e renovação " +
    "prevista para 06/09/2026.",
  created_at: "2026-08-18T21:01:20Z",
};

describe("o trecho mostrado vem do corpo, não do rótulo", () => {
  it("um dossiê é representado pelo que ele diz", () => {
    const trecho = trechoDoContexto(dossieReal);
    expect(trecho).toContain("Reinaldo Zequinão Filho");
    // O rótulo com data era tudo o que aparecia antes.
    expect(trecho).not.toContain("Dossiê de contexto");
  });

  it("o cabeçalho de seção não ocupa o trecho sozinho", () => {
    // "ONDE ESTAMOS" é etiqueta de seção: sem o parágrafo, não informa nada.
    const trecho = trechoDoContexto(dossieReal);
    expect(trecho.startsWith("ONDE ESTAMOS")).toBe(false);
    expect(trecho.length).toBeGreaterThan(40);
  });

  it("nota curta continua sendo representada pelo próprio título", () => {
    // Nem toda entrada é dossiê: numa nota, o título É a informação.
    const nota = { kind: "nota", title: "Cliente pediu para pausar os anúncios", content: "" };
    expect(trechoDoContexto(nota)).toBe("Cliente pediu para pausar os anúncios");
  });

  it("respeita o limite sem cortar no meio sem avisar", () => {
    const longo = { kind: "summary", title: "Dossiê", content: "a".repeat(500) };
    const trecho = trechoDoContexto(longo, 100);
    expect(trecho.length).toBeLessThanOrEqual(101);
    expect(trecho.endsWith("…")).toBe(true);
  });

  it("entrada vazia devolve vazio em vez de quebrar", () => {
    expect(trechoDoContexto({})).toBe("");
    expect(trechoDoContexto({ title: "", content: "" })).toBe("");
  });
});

describe("escolher o dossiê mais recente", () => {
  const antigo = { ...dossieReal, title: "Dossiê de contexto - 18/08/2026", created_at: "2026-08-18T19:56:38Z" };
  const novo = dossieReal;

  it("pega o mais novo mesmo quando o título é igual", () => {
    // Os três registros do Vifut nasceram no mesmo dia com títulos quase
    // idênticos: só a data de criação separa um do outro.
    expect(dossieMaisRecente([antigo, novo])?.created_at).toBe(novo.created_at);
    expect(dossieMaisRecente([novo, antigo])?.created_at).toBe(novo.created_at);
  });

  it("ignora registro sem corpo, que não tem o que mostrar", () => {
    const vazio = { kind: "summary", title: "Dossiê", content: "", created_at: "2026-08-19T10:00:00Z" };
    expect(dossieMaisRecente([novo, vazio])?.created_at).toBe(novo.created_at);
  });

  it("não esconde dossiê antigo por idade", () => {
    // Um dossiê de meses atrás continua sendo o que se sabe do cliente;
    // escondê-lo deixaria a tela vazia justamente quando ele é mais útil.
    const velho = { ...dossieReal, created_at: "2026-01-05T10:00:00Z" };
    expect(dossieMaisRecente([velho])).not.toBeNull();
  });

  it("sem contexto nenhum devolve nulo", () => {
    expect(dossieMaisRecente([])).toBeNull();
    expect(dossieMaisRecente([{ kind: "avulso", content: "x" }])).toBeNull();
  });
});

describe("a idade é dita como quem fala", () => {
  const agora = new Date("2026-08-18T21:00:00Z");
  it("traduz o intervalo em palavra", () => {
    expect(idadeEmPalavras("2026-08-18T09:00:00Z", agora)).toBe("hoje");
    expect(idadeEmPalavras("2026-08-17T09:00:00Z", agora)).toBe("ontem");
    expect(idadeEmPalavras("2026-08-13T09:00:00Z", agora)).toBe("há 5 dias");
    expect(idadeEmPalavras("2026-06-18T09:00:00Z", agora)).toBe("há 2 meses");
  });
  it("data ausente ou inválida não vira Invalid Date na tela", () => {
    expect(idadeEmPalavras(null, agora)).toBe("");
    expect(idadeEmPalavras("nao-e-data", agora)).toBe("");
  });
});

describe("a Central passou a mostrar o dossiê", () => {
  it("o painel consulta o cliente direto, sem depender da janela geral", () => {
    // A lista da Central busca as N linhas mais recentes de TODOS os clientes
    // e filtra depois: bastava a carteira crescer para o cliente aberto não
    // vir na janela, e a tela diria "sem contexto" com o dado no banco.
    expect(painel).toContain('.eq("client_id", clientId)');
    expect(painel).toContain('queryKey: chave');
  });

  it("mostra o corpo do dossiê, não só o título", () => {
    expect(painel).toContain("dossie.content");
    expect(painel).toContain("Ler o dossiê inteiro");
  });

  it("o botão de atualizar da Central alcança o dossiê", () => {
    // Sem esta chave o botão dizia "atualizado" e a caixa seguia na versão
    // anterior — a impressão exata de que nada mudou.
    expect(central).toContain('"dossie-cliente"');
  });

  it("a mensagem do grupo parou de usar o rótulo como contexto", () => {
    expect(central).toContain("trechoDoContexto(contextoEntrada)");
    expect(central).not.toContain("contextoEntrada.title || contextoEntrada.content");
  });
});
