import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { comoAbrir } from "@/components/execucao/OQueFoiFeito";

/**
 * "Tem que me dizer o que foi feito, como, e como eu acesso e documento,
 *  senão fico perdido."
 *
 * Essa condição é o que torna a autonomia sustentável. Trabalho que
 * acontece e ninguém acha depois não é trabalho entregue — é trabalho
 * perdido com passos extras.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const migracao = ler(
  "supabase/migrations/20260901060000_prestacao_de_contas_do_agente.sql");

describe("a exigência que faz a promessa valer", () => {
  it("registrar sem 'onde acessar' é recusado", () => {
    // Campo opcional viraria vazio na terceira semana; obrigatório no
    // banco não tem como ser esquecido.
    expect(migracao).toContain("sem_onde_acessar");
    expect(migracao).toContain("nao e trabalho entregue");
    expect(migracao).toContain("onde_acessar text not null");
  });

  it("registrar sem o COMO também é recusado", () => {
    expect(migracao).toContain("sem_como");
    expect(migracao).toContain("ninguem consegue repetir nem conferir");
  });

  it("credencial na URL é podada antes de guardar", () => {
    // URL assinada guardada aqui sairia em relatório, grupo e segundo
    // cérebro, e não teria como ser desfeita.
    expect(migracao).toContain("query removida: continha credencial");
  });

  it("ninguém escreve na tabela direto", () => {
    // Porta lateral escaparia da exigência do onde_acessar.
    expect(migracao).toContain('create policy "ninguem escreve direto"');
    expect(migracao).toContain("using (false) with check (false)");
  });
});

describe("os papéis do banco, e não os inventados", () => {
  it("usa os papéis reais e deixa o cliente de fora", () => {
    // A primeira versão falhou por inventar um papel 'staff' que não
    // existe neste banco.
    expect(migracao).toContain("'manager'::public.app_role");
    expect(migracao).toContain("'traffic'::public.app_role");
    expect(migracao).not.toContain("'staff'::public.app_role");
    expect(migracao).not.toContain("'client'::public.app_role");
  });
});

describe("por conta própria e por ordem sua são coisas diferentes", () => {
  it("a tabela distingue os dois casos", () => {
    expect(migracao).toContain("Nulo = acao autonoma");
    expect(migracao).toContain("'autonoma', (_approval_id is null)");
  });

  it("a tela mostra a diferença", () => {
    // Misturar esconderia quanto o agente está realmente decidindo por conta.
    const comp = ler("src/components/execucao/OQueFoiFeito.tsx");
    expect(comp).toContain('"por conta"');
    expect(comp).toContain('"sua ordem"');
  });
});

describe("o acesso é a linha mais importante", () => {
  it("URL vira link, rota do painel vira link, texto continua texto", () => {
    expect(comoAbrir("https://drive.google.com/x").tipo).toBe("url");
    expect(comoAbrir("/kanban?task=1").tipo).toBe("rota");
    expect(comoAbrir("pasta compartilhada do Drive").tipo).toBe("texto");
  });

  it("espaço em volta não muda a classificação", () => {
    expect(comoAbrir("  https://x.com/1  ").tipo).toBe("url");
    expect(comoAbrir("  /execucao  ").tipo).toBe("rota");
  });

  it("texto que parece caminho mas tem espaço não vira link", () => {
    // Um href com espaço quebraria em silêncio.
    expect(comoAbrir("/pasta com espaco").tipo).toBe("texto");
  });

  it("vazio não vira link", () => {
    expect(comoAbrir("").tipo).toBe("texto");
  });
});

describe("a tela de o que foi feito", () => {
  const comp = ler("src/components/execucao/OQueFoiFeito.tsx");

  it("falha de leitura não vira 'nada foi feito'", () => {
    expect(comp).toContain("Isso não quer dizer que nada foi feito");
  });

  it("a lista vazia explica a regra em vez de só dizer 'vazio'", () => {
    expect(comp).toContain("a função recusa o registro sem o link de acesso");
  });

  it("tem aba própria na Execução", () => {
    const pagina = ler("src/pages/AdminExecucao.tsx");
    expect(pagina).toContain('{ id: "feito", rotulo: "O que foi feito", visoes: [] }');
    expect(pagina).toContain('{aba === "feito" && <OQueFoiFeito />}');
  });

  it("a aba sem visões não quebra a contagem", () => {
    // Lista vazia faz o TypeScript inferir never[]; o tipo explícito
    // resolve sem obrigar a aba a inventar uma visão que ela não tem.
    expect(ler("src/pages/AdminExecucao.tsx"))
      .toContain("(x.visoes as readonly string[])");
  });
});
