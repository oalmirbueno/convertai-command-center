import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O laço de ordem autorizada, do lado do banco.
 *
 * Os cinco casos abaixo foram executados CONTRA O BANCO REAL numa
 * transação revertida (leitura, aprovação pendente, ordem autorizada,
 * execução idempotente, registro com `_onde_acessar`). Este arquivo trava
 * as regras que aqueles testes provaram, para elas não se perderem no
 * próximo refactor — teste que só rodou uma vez não protege nada.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const laco = ler(
  "supabase/migrations/20260901050000_ordem_autorizada_o_agente_age_no_mundo.sql");
const contas = ler(
  "supabase/migrations/20260901060000_prestacao_de_contas_do_agente.sql");
const aMao = ler(
  "supabase/migrations/20260901070000_ordem_autorizada_pecas_aplicadas_a_mao.sql");

describe("aprovação pendente NÃO é ordem", () => {
  it("a fila exige status aprovado", () => {
    // Pedir não é poder. Sem isto o agente agiria sobre o próprio pedido.
    expect(laco).toContain("a.status = 'aprovado'");
  });

  it("e exige que ainda não tenha sido cumprida", () => {
    expect(laco).toContain("a.executed_at is null");
  });
});

describe("execução idempotente", () => {
  it("a segunda vez é recusada pelo nome", () => {
    expect(laco).toContain("ja_executada");
    expect(laco).toContain("publicaria ou gastaria duas vezes");
  });

  it("ordem vencida não executa", () => {
    expect(laco).toContain("ordem_vencida");
  });

  it("ordem de outro agente não executa", () => {
    expect(laco).toContain("ordem_de_outro");
  });
});

describe("registro exige o caminho de volta", () => {
  it("recusa sem _onde_acessar", () => {
    expect(contas).toContain("sem_onde_acessar");
    expect(contas).toContain("onde_acessar text not null");
  });

  it("distingue autônoma de ordem", () => {
    expect(contas).toContain("'autonoma', (_approval_id is null)");
  });
});

describe("as peças aplicadas à mão ficam registradas no repo", () => {
  it("o arquivo diz que foram aplicadas fora do caminho normal", () => {
    // Repositório que não descreve o banco é pior que repositório
    // incompleto: o próximo a ler desenha em cima de um mapa errado.
    expect(aMao).toMatch(/aplicadas a mao/i);
    expect(aMao).toContain("o dono aplicou o SQL");
  });

  it("traz a reversão escrita", () => {
    expect(aMao).toContain("REVERSAO");
    expect(aMao).toContain("drop trigger if exists trg_avisar_ordem_executada");
    expect(aMao).toContain("drop function if exists public.operator_cancelar_tarefa");
  });

  it("diz o que a reversão NÃO desfaz", () => {
    // Desfazer em massa apagaria decisões que alguém tomou.
    expect(aMao).toContain("Reverter NAO desfaz cancelamentos ja feitos");
  });

  it("é idempotente, para reaplicar não quebrar", () => {
    expect(aMao).toContain("create or replace function public.operator_cancelar_tarefa");
    expect(aMao).toContain("drop trigger if exists");
  });

  it("o aviso só dispara na virada, e não a cada update", () => {
    // Uma correção de texto reenviaria a notificação.
    expect(aMao).toContain("if new.executed_at is null or old.executed_at is not null then");
  });

  it("cancelar preserva título, prazo e responsável", () => {
    expect(aMao).toContain("Titulo, prazo e responsavel");
    expect(aMao).not.toMatch(/update public\.tasks[\s\S]{0,400}assigned_to\s*=/);
    expect(aMao).not.toMatch(/delete\s+from\s+public\.tasks/i);
  });
});

describe("o que o agente NÃO deve usar", () => {
  it("_approval_required não abre pedido nenhum", () => {
    // A flag agora espelha a aprovação; usá-la não cria ordem.
    const fantasma = ler(
      "supabase/migrations/20260901040000_aprovacao_fantasma_que_travava_os_agentes.sql");
    expect(fantasma).toContain("agente sinalizou aprovacao sem abrir o pedido");
    expect(fantasma).toContain("operator_request_approval");
  });
});
