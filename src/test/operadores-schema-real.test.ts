import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Coluna que não existe só aparece na hora de executar.
 *
 * Escrevi `updated_at = now()` dentro de operator_update sem conferir a
 * tabela. `internal_operators` nunca teve essa coluna — tem `created_at` e
 * `last_run_at`. O plpgsql não reclama ao criar a função: o erro só saiu
 * quando o Hermes chamou, e saiu como
 *
 *   operator_update: column "updated_at" of relation
 *   "internal_operators" does not exist
 *
 * É a mesma família do `public.clients` que já me pegou antes. Este teste
 * lê as migrations e confere cada coluna atribuída num UPDATE contra o que
 * a tabela realmente declara, para o erro aparecer aqui e não no uso.
 */

const raiz = resolve(__dirname, "../..");
const dir = resolve(raiz, "supabase/migrations");

const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

/** O texto da migration sem comentários de linha. */
function semComentario(texto: string) {
  return texto
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

/** As colunas que um CREATE TABLE declara, mais as que ALTER TABLE soma. */
function colunasDeclaradas(tabela: string): Set<string> {
  const colunas = new Set<string>();
  for (const arquivo of arquivos) {
    const sql = semComentario(readFileSync(resolve(dir, arquivo), "utf8"));

    const criar = new RegExp(
      `create table (?:if not exists )?public\\.${tabela}\\s*\\(([\\s\\S]*?)\\n\\)`,
      "i",
    ).exec(sql);
    if (criar) {
      for (const linha of criar[1].split("\n")) {
        const m = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(linha);
        // "unique (...)", "constraint ...", "primary key ..." não são colunas.
        if (m && !/^(unique|constraint|primary|foreign|check)$/i.test(m[1])) {
          colunas.add(m[1].toLowerCase());
        }
      }
    }

    const alterar = new RegExp(
      `alter table public\\.${tabela}([\\s\\S]*?);`,
      "gi",
    );
    let a: RegExpExecArray | null;
    while ((a = alterar.exec(sql)) !== null) {
      for (const m of a[1].matchAll(
        /add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi,
      )) {
        colunas.add(m[1].toLowerCase());
      }
    }
  }
  return colunas;
}

/**
 * A ULTIMA definicao de cada funcao, que e a que vale no banco.
 *
 * Cobrar a regra da migration ANTIGA faria o teste exigir que se
 * reescrevesse historico ja aplicado, o que e pior que o problema: a
 * versao velha nao roda mais, foi substituida por CREATE OR REPLACE.
 */
function definicoesVigentes(): Map<string, { arquivo: string; corpo: string }> {
  const porFuncao = new Map<string, { arquivo: string; corpo: string }>();
  for (const arquivo of arquivos) {
    const sql = semComentario(readFileSync(resolve(dir, arquivo), "utf8"));
    const partes = sql.split(/create or replace function /i);
    for (let k = 1; k < partes.length; k += 1) {
      const nome = /^(public\.\w+)/.exec(partes[k])?.[1];
      if (nome) porFuncao.set(nome, { arquivo, corpo: partes[k] });
    }
  }
  return porFuncao;
}

/** As colunas que algum UPDATE vigente tenta escrever nessa tabela. */
function colunasEscritas(tabela: string): Array<{ arquivo: string; onde: string; coluna: string }> {
  const achados: Array<{ arquivo: string; onde: string; coluna: string }> = [];
  // As barras vão DOBRADAS: isto é uma template string antes de virar
  // expressão. Escritas simples, o JavaScript come cada uma delas na
  // string e a busca deixa de casar — o teste ficaria verde sem ter olhado
  // nada, que é pior do que o defeito que ele procura.
  //
  // Dois formatos de escrita, e os dois contam:
  //   UPDATE public.X SET ...            (o `set` pode cair na linha seguinte)
  //   INSERT ... ON CONFLICT DO UPDATE SET ...   (é como operator_runs é escrita)
  //
  // `[^;]` em vez de `[\s\S]`: uma instrução termina no ponto e vírgula, e
  // sem esse limite a busca do INSERT atravessava até o bloco da tabela
  // SEGUINTE e acusava coluna que era de outra tabela.
  const formatos = [
    new RegExp(
      `update public\\.${tabela}\\s+set([^;]*?)(?:\\n\\s*where|\\n\\s*returning|;)`,
      "gi",
    ),
    new RegExp(
      `insert into public\\.${tabela}\\b[^;]*?on conflict[^;]*?do update set([^;]*?)(?:\\n\\s*returning|;)`,
      "gi",
    ),
  ];

  const trechos: Array<{ arquivo: string; onde: string; sql: string }> = [];
  for (const [nome, { arquivo, corpo }] of definicoesVigentes()) {
    trechos.push({ arquivo, onde: nome, sql: corpo });
  }
  // Blocos DO fora de funcao tambem escrevem, e valem sempre.
  for (const arquivo of arquivos) {
    const sql = semComentario(readFileSync(resolve(dir, arquivo), "utf8"));
    for (const bloco of sql.split(/create or replace function /i).slice(0, 1)) {
      trechos.push({ arquivo, onde: "(fora de funcao)", sql: bloco });
    }
  }

  for (const t of trechos) {
    for (const re of formatos) {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(t.sql)) !== null) {
        for (const atrib of m[1].split(",")) {
          const c = /^\s*([a-z_][a-z0-9_]*)\s*=/i.exec(atrib);
          if (c) achados.push({ arquivo: t.arquivo, onde: t.onde, coluna: c[1].toLowerCase() });
        }
      }
    }
  }
  return achados;
}

describe("nenhum UPDATE escreve em coluna que a tabela não tem", () => {
  for (const tabela of [
    "internal_operators",
    "operator_task_links",
    "operator_runs",
  ]) {
    it(`${tabela}`, () => {
      const declaradas = colunasDeclaradas(tabela);
      const escritas = colunasEscritas(tabela);

      // As DUAS extrações precisam ter achado algo. Sem esta guarda, uma
      // expressão de busca quebrada devolveria lista vazia e o teste
      // passaria sem ter olhado nada — foi exatamente o que aconteceu na
      // primeira versão deste arquivo.
      expect(declaradas.size, `não achei as colunas de ${tabela}`).toBeGreaterThan(3);
      expect(escritas.length, `não achei nenhum UPDATE em ${tabela}`).toBeGreaterThan(0);

      for (const { arquivo, onde, coluna } of escritas) {
        expect(
          declaradas.has(coluna),
          `${onde} (em ${arquivo}) escreve ${tabela}.${coluna}, que a tabela não declara`,
        ).toBe(true);
      }
    });
  }
});

describe("o conserto do updated_at", () => {
  const conserto = readFileSync(
    resolve(dir, "20260828140000_operadores_hierarquia_e_vinculo_unico.sql"),
    "utf8",
  );
  const codigo = semComentario(conserto);

  it("operator_update parou de escrever updated_at", () => {
    const fn = codigo.slice(
      codigo.indexOf("create or replace function public.operator_update"),
      codigo.indexOf("revoke execute on function public.operator_update"),
    );
    expect(fn).not.toMatch(/updated_at\s*=/);
    // E o resto do que a função faz continua lá.
    expect(fn).toContain("is_coordinator = coalesce(_is_coordinator, is_coordinator)");
    expect(fn).toContain("operator_audit_log");
  });

  it("a coluna NÃO foi criada só para calar o erro", () => {
    // A trilha imutável já guarda quem mexeu e quando, com mais precisão.
    // Coluna nova seria mais uma peça para manter dizendo a mesma coisa.
    expect(codigo).not.toMatch(
      /alter table public\.internal_operators[\s\S]*?add column[\s\S]*?updated_at/i,
    );
  });
});
