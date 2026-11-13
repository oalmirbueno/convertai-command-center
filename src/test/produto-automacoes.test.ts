import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nomesDasEtapas, perfilDoNicho } from "@/lib/produto/nichos";
import {
  ACOES,
  ETAPAS_ABERTAS,
  GATILHOS,
  LIMITE_DE_AUTOMACOES,
  QUEM_AVISAR,
  RASCUNHO_VAZIO,
  RECEITAS,
  TIPOS_DE_TAREFA,
  assinaturaDaAutomacao,
  erroDoRascunho,
  fraseDaAutomacao,
  lerAutomacao,
  linhaDaReceita,
  linhaDoRascunho,
  montarCondicao,
  montarParametros,
  nomeSugerido,
  problemasDaLinha,
  rascunhoDaAutomacao,
  receitasQueFaltam,
  type LinhaDeAutomacao,
  type RascunhoDeAutomacao,
} from "@/lib/produto/automacoes";

/**
 * Automações do CRM da empresa (13/11/2026): a frase que a equipe lê, as
 * receitas prontas e o que a tela manda ao banco.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const rascunho = (parte: Partial<RascunhoDeAutomacao>): RascunhoDeAutomacao => ({ ...RASCUNHO_VAZIO, ...parte });
const padrao = nomesDasEtapas({});
const equipe = [
  { user_id: "u-ana", nome: "Ana", estado: "ativo" },
  { user_id: "u-beto", nome: "Beto", estado: "ativo" },
  { user_id: null, nome: "Convidado", estado: "convidado" },
];

describe("a tela e o banco falam a mesma língua", () => {
  const sql = ler("supabase/migrations/20261113200000_crm_cargos_campos_e_automacoes.sql");
  const naLista = (itens: readonly string[]) => `(${itens.map((i) => `'${i}'`).join(", ")})`;

  it("gatilhos, ações, tipos de tarefa e etapas de destino são os do banco", () => {
    expect(sql).toContain(`gatilho in ${naLista(GATILHOS)}`);
    expect(sql).toContain(`acao in ${naLista(ACOES)}`);
    expect(sql).toContain(`_p ->> 'tipo' in ${naLista(TIPOS_DE_TAREFA)}`);
    expect(sql).toContain(`_para in ${naLista(ETAPAS_ABERTAS)}`);
    QUEM_AVISAR.forEach((q) => expect(sql).toContain(`_quem = '${q}'`));
    expect(sql).toContain(`>= ${LIMITE_DE_AUTOMACOES} then`);
  });

  it("a gravação não manda a empresa nem os contadores", () => {
    const fonte = ler("src/lib/produto/automacoes.ts");
    const gravacao = fonte.slice(fonte.indexOf("const paraOBanco"), fonte.indexOf("export async function criarAutomacao"));
    expect(gravacao).not.toMatch(/conta_id|execucoes|ultima_em/);
    expect(fonte).not.toMatch(/conta_id\s*:/);
  });
});

describe("frase legível", () => {
  const linha = (parte: Partial<LinhaDeAutomacao>): LinhaDeAutomacao => ({ nome: "x", gatilho: "etapa_mudou", condicao: {}, acao: "atribuir_rodizio", parametros: {}, ativa: true, ...parte });

  it("o exemplo do pedido sai palavra por palavra", () => {
    const a = linha({ condicao: { etapa: "proposta" }, acao: "criar_tarefa", parametros: { titulo: "Ligar", em_dias: 2, tipo: "ligacao" } });
    expect(fraseDaAutomacao(a, padrao)).toBe("Quando um negócio entra em Proposta, criar a tarefa Ligar em 2 dias");
  });

  it("cada gatilho tem a sua abertura", () => {
    expect(fraseDaAutomacao(linha({ gatilho: "negocio_criado" }), padrao)).toBe("Quando um negócio é criado, distribuir no rodízio da equipe");
    expect(fraseDaAutomacao(linha({ gatilho: "negocio_criado", condicao: { sem_dono: true } }), padrao)).toBe("Quando um negócio sem responsável é criado, distribuir no rodízio da equipe");
    expect(fraseDaAutomacao(linha({ gatilho: "etapa_mudou" }), padrao)).toMatch(/^Quando um negócio muda de etapa, /);
    expect(fraseDaAutomacao(linha({ gatilho: "negocio_ganho" }), padrao)).toMatch(/^Quando um negócio é ganho, /);
    expect(fraseDaAutomacao(linha({ gatilho: "negocio_perdido" }), padrao)).toMatch(/^Quando um negócio é perdido, /);
    expect(fraseDaAutomacao(linha({ gatilho: "negocio_parado", condicao: { dias: 5 } }), padrao)).toMatch(/^Quando um negócio fica parado há 5 dias, /);
    expect(fraseDaAutomacao(linha({ gatilho: "negocio_parado", condicao: { dias: 1, etapa: "proposta" } }), padrao)).toMatch(/^Quando um negócio fica parado há 1 dia em Proposta, /);
  });

  it("cada ação tem o seu fim de frase", () => {
    const fim = (parte: Partial<LinhaDeAutomacao>) => fraseDaAutomacao(linha(parte), padrao, equipe).split(", ").slice(1).join(", ");
    expect(fim({ acao: "criar_tarefa", parametros: { titulo: "Ligar", em_dias: 0, tipo: "ligacao" } })).toBe("criar a tarefa Ligar no mesmo dia");
    expect(fim({ acao: "criar_tarefa", parametros: { titulo: "Ligar", em_dias: 1, tipo: "ligacao" } })).toBe("criar a tarefa Ligar em 1 dia");
    expect(fim({ acao: "atribuir_membro", parametros: { user_id: "u-beto" } })).toBe("passar para Beto");
    expect(fim({ acao: "atribuir_membro", parametros: { user_id: "saiu" } })).toBe("passar para uma pessoa da equipe");
    expect(fim({ acao: "mover_etapa", parametros: { para: "negociacao" } })).toBe("mover para Negociação");
    expect(fim({ acao: "avisar", parametros: { quem: "dono", texto: "" } })).toBe("avisar o responsável");
    expect(fim({ acao: "avisar", parametros: { quem: "gerente", texto: "Veja o negócio." } })).toBe("avisar o gerente: Veja o negócio");
    expect(fim({ acao: "avisar", parametros: { quem: "admin", texto: "" } })).toBe("avisar quem administra a empresa");
  });

  it("usa o nome que a empresa deu à etapa", () => {
    const imobiliaria = nomesDasEtapas(perfilDoNicho("imobiliaria"));
    const a = linha({ condicao: { etapa: "negociacao" }, acao: "mover_etapa", parametros: { para: "diagnostico" } });
    expect(fraseDaAutomacao(a, imobiliaria)).toBe("Quando um negócio entra em Documentação, mover para Visita");
    expect(fraseDaAutomacao(a)).toBe("Quando um negócio entra em Negociação, mover para Diagnóstico");
  });

  it("nenhuma frase tem travessão", () => {
    RECEITAS.forEach((r) => expect(fraseDaAutomacao(r, padrao)).not.toMatch(/[–—]/));
  });
});

describe("receitas prontas", () => {
  it("são pelo menos 8, com id e nome únicos", () => {
    expect(RECEITAS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(RECEITAS.map((r) => r.id)).size).toBe(RECEITAS.length);
    expect(new Set(RECEITAS.map((r) => r.nome)).size).toBe(RECEITAS.length);
    expect(new Set(RECEITAS.map(assinaturaDaAutomacao)).size).toBe(RECEITAS.length);
  });

  it("toda receita gera uma linha que o banco aceita", () => {
    RECEITAS.forEach((r) => {
      const l = linhaDaReceita(r);
      expect(problemasDaLinha(l), r.id).toEqual([]);
      expect(l.ativa).toBe(true);
      expect(Object.keys(l).sort()).toEqual(["acao", "ativa", "condicao", "gatilho", "nome", "parametros"]);
      expect(r.linha.length).toBeGreaterThan(10);
      expect(`${r.nome} ${r.linha} ${JSON.stringify(r.parametros)}`).not.toMatch(/[–—]/);
    });
  });

  it("cobrem os casos pedidos", () => {
    const tem = (teste: (l: LinhaDeAutomacao) => boolean) => RECEITAS.map(linhaDaReceita).some(teste);
    expect(tem((l) => l.gatilho === "negocio_criado" && l.condicao.sem_dono === true && l.acao === "atribuir_rodizio")).toBe(true);
    expect(tem((l) => l.gatilho === "etapa_mudou" && l.condicao.etapa === "proposta" && l.acao === "criar_tarefa" && l.parametros.em_dias === 2)).toBe(true);
    expect(tem((l) => l.gatilho === "negocio_parado" && l.condicao.dias === 5 && l.acao === "avisar" && l.parametros.quem === "gerente")).toBe(true);
    expect(tem((l) => l.gatilho === "negocio_ganho" && l.acao === "criar_tarefa")).toBe(true);
    expect(tem((l) => l.gatilho === "negocio_perdido" && l.acao === "avisar" && l.parametros.quem === "admin")).toBe(true);
    expect(tem((l) => l.gatilho === "negocio_criado" && l.acao === "criar_tarefa" && l.parametros.tipo === "ligacao")).toBe(true);
    expect(tem((l) => l.gatilho === "etapa_mudou" && l.condicao.etapa === "negociacao" && l.acao === "criar_tarefa")).toBe(true);
    expect(tem((l) => l.gatilho === "negocio_parado" && l.condicao.dias === 15 && l.acao === "criar_tarefa")).toBe(true);
  });

  it("a receita some quando a empresa já tem uma automação igual, mesmo desligada ou com outro texto", () => {
    expect(receitasQueFaltam([])).toHaveLength(RECEITAS.length);
    const rodizio = RECEITAS.filter((r) => r.id === "rodizio")[0];
    const proposta = RECEITAS.filter((r) => r.id === "retorno_da_proposta")[0];
    const existentes = [
      { ...linhaDaReceita(rodizio), ativa: false },
      { ...linhaDaReceita(proposta), nome: "Meu retorno", parametros: { ...proposta.parametros, titulo: "Mandar mensagem" } },
    ];
    const faltam = receitasQueFaltam(existentes).map((r) => r.id);
    expect(faltam).not.toContain("rodizio");
    expect(faltam).not.toContain("retorno_da_proposta");
    expect(faltam).toHaveLength(RECEITAS.length - 2);
    // Mudou o prazo: já é outra regra, a receita volta a aparecer.
    expect(receitasQueFaltam([{ ...linhaDaReceita(proposta), parametros: { ...proposta.parametros, em_dias: 4 } }]).map((r) => r.id)).toContain("retorno_da_proposta");
  });

  it("o que volta do banco (jsonb) continua batendo com a receita", () => {
    RECEITAS.forEach((r) => {
      const doBanco = lerAutomacao({ id: "1", ...JSON.parse(JSON.stringify(linhaDaReceita(r))), execucoes: 3, ultima_em: "2026-11-13T12:00:00Z", criado_em: "2026-11-13T10:00:00Z" });
      expect(assinaturaDaAutomacao(doBanco), r.id).toBe(assinaturaDaAutomacao(r));
      expect(receitasQueFaltam([doBanco]).map((x) => x.id)).not.toContain(r.id);
    });
  });
});

describe("montagem da condição e dos parâmetros", () => {
  it("a condição só leva o que vale para o gatilho", () => {
    expect(montarCondicao(rascunho({ gatilho: "etapa_mudou" }))).toEqual({});
    expect(montarCondicao(rascunho({ gatilho: "etapa_mudou", etapa: "ganho", semDono: true }))).toEqual({ etapa: "ganho", sem_dono: true });
    expect(montarCondicao(rascunho({ gatilho: "negocio_criado", etapa: "novo", dias: 9 }))).toEqual({ etapa: "novo" });
    // Ganho e perdido já dizem a etapa; negócio parado é sempre aberto.
    expect(montarCondicao(rascunho({ gatilho: "negocio_ganho", etapa: "proposta" }))).toEqual({});
    expect(montarCondicao(rascunho({ gatilho: "negocio_parado", etapa: "ganho", dias: 7 }))).toEqual({ dias: 7 });
    expect(montarCondicao(rascunho({ gatilho: "negocio_parado", etapa: "proposta", dias: 7 }))).toEqual({ etapa: "proposta", dias: 7 });
    // A rodada de negócio parado não olha "sem responsável": a tela não promete o que o banco não faz.
    expect(montarCondicao(rascunho({ gatilho: "negocio_parado", semDono: true, dias: 5 }))).toEqual({ dias: 5 });
  });

  it("os dias ficam dentro do que o motor aceita", () => {
    expect(montarCondicao(rascunho({ gatilho: "negocio_parado", dias: 0 })).dias).toBe(1);
    expect(montarCondicao(rascunho({ gatilho: "negocio_parado", dias: 999 })).dias).toBe(180);
    expect(montarCondicao(rascunho({ gatilho: "negocio_parado", dias: 2.6 })).dias).toBe(3);
    expect(montarCondicao(rascunho({ gatilho: "negocio_parado", dias: NaN })).dias).toBe(5);
  });

  it("os parâmetros são só os da ação escolhida", () => {
    const cheio = rascunho({ titulo: "  Ligar  ", emDias: 2, tipo: "ligacao", userId: "u-ana", para: "proposta", quem: "admin", texto: "  Olhe  " });
    expect(montarParametros({ ...cheio, acao: "criar_tarefa" })).toEqual({ titulo: "Ligar", em_dias: 2, tipo: "ligacao" });
    expect(montarParametros({ ...cheio, acao: "atribuir_rodizio" })).toEqual({});
    expect(montarParametros({ ...cheio, acao: "atribuir_membro" })).toEqual({ user_id: "u-ana" });
    expect(montarParametros({ ...cheio, acao: "mover_etapa" })).toEqual({ para: "proposta" });
    expect(montarParametros({ ...cheio, acao: "avisar" })).toEqual({ quem: "admin", texto: "Olhe" });
  });

  it("prazo e textos respeitam os limites do banco", () => {
    expect(montarParametros(rascunho({ acao: "criar_tarefa", titulo: "x".repeat(300), emDias: 500 }))).toEqual({ titulo: "x".repeat(160), em_dias: 90, tipo: "tarefa" });
    expect(montarParametros(rascunho({ acao: "criar_tarefa", titulo: "Ligar", emDias: -3 })).em_dias).toBe(0);
    expect(String(montarParametros(rascunho({ acao: "avisar", texto: "y".repeat(400) })).texto)).toHaveLength(280);
  });

  it("o rascunho vira uma linha válida, com nome sugerido quando fica em branco", () => {
    const r = rascunho({ gatilho: "etapa_mudou", etapa: "proposta", acao: "criar_tarefa", titulo: "Ligar", emDias: 2, tipo: "ligacao" });
    expect(erroDoRascunho(r)).toBeNull();
    const l = linhaDoRascunho(r, padrao, equipe);
    expect(l).toEqual({ nome: "Tarefa: Ligar", gatilho: "etapa_mudou", condicao: { etapa: "proposta" }, acao: "criar_tarefa", parametros: { titulo: "Ligar", em_dias: 2, tipo: "ligacao" }, ativa: true });
    expect(problemasDaLinha(l)).toEqual([]);
    expect(linhaDoRascunho({ ...r, nome: "  Retorno  " }, padrao, equipe).nome).toBe("Retorno");
    expect(linhaDoRascunho(r, padrao, equipe, false).ativa).toBe(false);
    expect(nomeSugerido(rascunho({ acao: "atribuir_membro", userId: "u-ana" }), padrao, equipe)).toBe("Negócios para Ana");
    expect(nomeSugerido(rascunho({ acao: "avisar", gatilho: "negocio_parado" }), padrao, equipe)).toBe("Negócio parado");
    expect(nomeSugerido(rascunho({ acao: "criar_tarefa", titulo: "z".repeat(200) })).length).toBeLessThanOrEqual(80);
  });

  it("toda combinação de gatilho e ação que passa na conferência é aceita pelo banco", () => {
    let validas = 0;
    GATILHOS.forEach((gatilho) => {
      ACOES.forEach((acao) => {
        ["", "proposta", "ganho"].forEach((etapa) => {
          [false, true].forEach((semDono) => {
            const r = rascunho({ gatilho, acao, etapa: etapa as RascunhoDeAutomacao["etapa"], semDono, titulo: "Ligar", userId: "u-ana", para: "contato", quem: "dono", texto: "Olhe" });
            if (erroDoRascunho(r)) return;
            validas += 1;
            expect(problemasDaLinha(linhaDoRascunho(r, padrao, equipe)), `${gatilho} ${acao} ${etapa} ${semDono}`).toEqual([]);
          });
        });
      });
    });
    expect(validas).toBeGreaterThan(40);
  });

  it("recusa o que não faria nada no banco", () => {
    expect(erroDoRascunho(rascunho({ acao: "criar_tarefa", titulo: " " }))).toMatch(/título/);
    expect(erroDoRascunho(rascunho({ acao: "atribuir_membro", userId: "" }))).toMatch(/pessoa/);
    expect(erroDoRascunho(rascunho({ gatilho: "negocio_ganho", acao: "mover_etapa" }))).toMatch(/ganho ou perdido/);
    expect(erroDoRascunho(rascunho({ gatilho: "etapa_mudou", etapa: "perdido", acao: "mover_etapa" }))).toMatch(/ganho ou perdido/);
    expect(erroDoRascunho(rascunho({ gatilho: "etapa_mudou", etapa: "contato", acao: "mover_etapa", para: "contato" }))).toMatch(/já está/);
    expect(erroDoRascunho(rascunho({ gatilho: "negocio_criado", semDono: true, acao: "avisar", quem: "dono" }))).toMatch(/Sem responsável/);
    expect(erroDoRascunho(rascunho({ acao: "atribuir_rodizio", nome: "a" }))).toMatch(/2 letras/);
    expect(erroDoRascunho(rascunho({ acao: "atribuir_rodizio" }))).toBeNull();
  });

  it("editar devolve o formulário como estava", () => {
    const r = rascunho({ nome: "Parado na proposta", gatilho: "negocio_parado", etapa: "proposta", dias: 3, acao: "avisar", quem: "dono", texto: "Proposta sem resposta" });
    const l = linhaDoRascunho(r, padrao, equipe);
    expect(rascunhoDaAutomacao(l)).toEqual(r);
    expect(linhaDoRascunho(rascunhoDaAutomacao(l), padrao, equipe)).toEqual(l);
    RECEITAS.forEach((receita) => {
      const linha = linhaDaReceita(receita);
      expect(linhaDoRascunho(rascunhoDaAutomacao(linha), padrao, equipe), receita.id).toEqual(linha);
    });
  });

  it("lê do banco sem confiar no formato", () => {
    const a = lerAutomacao({ id: 7, nome: "X", gatilho: "inventado", condicao: { etapa: "nao_existe", dias: "12", sem_dono: "true", lixo: 1 }, acao: null, parametros: { titulo: "Ligar", outro: { a: 1 } }, ativa: 1, execucoes: "4", ultima_em: null });
    expect(a).toMatchObject({ id: "7", gatilho: "etapa_mudou", acao: "avisar", condicao: { dias: 12, sem_dono: true }, parametros: { titulo: "Ligar" }, ativa: true, execucoes: 4, ultima_em: null });
    expect(lerAutomacao(null).condicao).toEqual({});
  });
});
