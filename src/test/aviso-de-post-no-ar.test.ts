import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { safePublicPostUrl } from "@/lib/internalNavigation";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const migration = ler("supabase/migrations/20260821170000_aviso_de_post_no_ar.sql");
const painel = ler("src/components/NotificationsPanel.tsx");

/**
 * A máquina publica sozinha no horário marcado — e ninguém ficava sabendo.
 * O recibo de publicação existia, mas avisava só a equipe, apontando para o
 * kanban: uma tela interna, que o cliente nem abre. O post público já
 * existia (permalink é condição para o recibo ser aceito) e não levava a
 * lugar nenhum.
 */

describe("o recibo avisa os dois lados", () => {
  it("o cliente entra na lista de avisados", () => {
    expect(migration).toContain("_cliente := _publication.client_id");
    // Só quem é cliente de verdade: o client_id é um id de usuário, e um
    // id sem login não pode virar notificação órfã.
    expect(migration).toContain("role_row.role = ''client''::public.app_role");
  });

  it("a mensagem do cliente fala do negócio, não do processo", () => {
    expect(migration).toContain("Seu conteúdo já está no ar no %s: %s");
  });

  it("o aviso da equipe continua existindo", () => {
    expect(migration).toContain("Conteúdo publicado no %s: %s");
  });
});

describe("o link leva ao post, não a uma tela interna", () => {
  it("o link do aviso passa a ser o permalink público", () => {
    expect(migration).toContain("_link := btrim(_publication.permalink)");
    expect(migration).toContain("    ''publication'',\\n'\n        || E'      _link\\n'");
  });

  it("o kanban deixa de ser o destino", () => {
    // A substituição é contada: se o texto em produção tiver mudado, a
    // migration falha alto em vez de sobrescrever versão diferente.
    expect(migration).toContain("''/kanban?task='' || _task_id::text");
    expect(migration).toContain("patch recibo (link): alvo nao encontrado exatamente 1 vez");
  });
});

describe("publicar deixa de depender de uma tarefa vinculada", () => {
  it("sem tarefa o aviso sai do mesmo jeito", () => {
    // Era 'IF _task_id IS NULL THEN RETURN NEW' — o aviso inteiro morria
    // por falta de um vínculo interno que nada tem a ver com o post no ar.
    expect(migration).toContain("IF _task_id IS NOT NULL THEN");
    expect(migration).toContain("patch recibo (tarefa): alvo nao encontrado exatamente 1 vez");
  });

  it("tarefa VIVA em outro projeto continua barrando", () => {
    // O desencontro real de escopo é esse — e segue levantando exceção.
    expect(migration).toContain("_task_project IS DISTINCT FROM _post.project_id");
    expect(migration).toContain("published receipt task scope mismatch");
  });

  it("tarefa apagada não impede a baixa de um post já publicado", () => {
    expect(migration).toContain("_task_assignee := NULL");
  });
});

describe("o título chega limpo a quem lê", () => {
  it("a extensão do arquivo sai da mensagem", () => {
    // O título do conteúdo É o nome do arquivo: mandar "peca.png" para o
    // cliente é deixar vazar a mecânica de dentro de casa.
    expect(migration).toContain("(png|jpe?g|jpe|webp|gif|heic|heif|mp4|mov|m4v|webm)$");
  });

  it("a lista de extensões é fechada — título com número decimal sobrevive", () => {
    // Um regex ganancioso comeria o final de "Oferta 10.50".
    expect(migration).not.toContain("[.][a-z0-9]{2,5}$");
    expect(migration).toContain("_titulo := COALESCE(_titulo, _post.title");
  });
});

describe("safePublicPostUrl: a única porta para fora do painel", () => {
  it.each([
    ["https://www.instagram.com/p/DcRZNVkoDK4/", true],
    ["https://instagram.com/p/ABC/", true],
    ["https://www.instagram.com/stories/", true],
    ["https://www.facebook.com/algo/posts/1", true],
    // Sem https não passa: o link viaja para o navegador do cliente.
    ["http://www.instagram.com/p/ABC/", false],
    // Host de fora é redirecionamento aberto com a cara do painel.
    ["https://evil.example/p/ABC", false],
    ["https://www.instagram.com.evil.example/p/ABC", false],
    ["javascript:alert(1)", false],
    ["data:text/html,<script>alert(1)</script>", false],
    // Usuário e senha no endereço são o truque clássico de disfarce.
    ["https://www.instagram.com@evil.example/", false],
    ["https://usuario:senha@www.instagram.com/", false],
    ["", false],
    ["/dashboard", false],
  ])("%s", (entrada, aceito) => {
    const resultado = safePublicPostUrl(entrada);
    expect(resultado === null).toBe(!aceito);
  });

  it("recusa o que não é texto", () => {
    expect(safePublicPostUrl(null)).toBe(null);
    expect(safePublicPostUrl(undefined)).toBe(null);
    expect(safePublicPostUrl({ toString: () => "https://www.instagram.com/" })).toBe(null);
  });
});

describe("o sininho sabe abrir o post", () => {
  it("link externo abre em outra aba, sem dar referência da janela", () => {
    expect(painel).toContain('window.open(publicPost, "_blank", "noopener,noreferrer")');
  });

  it("o caminho interno continua sendo navegação interna", () => {
    // A porta de fora não pode virar bypass do guarda interno: primeiro
    // tenta safeInternalPath, e só então o link público.
    expect(painel.indexOf("safeInternalPath(n.link)")).toBeLessThan(
      painel.indexOf("safePublicPostUrl(n.link)"),
    );
  });

  it("o aviso diz para onde leva antes do clique", () => {
    expect(painel).toContain("Ver publicação no Instagram");
  });

  it("publicação tem ícone próprio na lista", () => {
    expect(painel).toContain('case "publication":');
  });
});
