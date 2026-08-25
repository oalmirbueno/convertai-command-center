import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const migration = ler("supabase/migrations/20260824210000_notificacoes_confiaveis.sql");
const aviso = ler("supabase/migrations/20260821170000_aviso_de_post_no_ar.sql");

/**
 * O relato: "algumas notificações não chegam, algumas chegam duplicadas;
 * publicou conteúdo de cliente e não me avisou na hora — eu só vi quando
 * publicou".
 *
 * AUSENTE: a correção do aviso de post no ar existe no repositório desde
 * 21/08, mas é patch de função — não muda schema, não deixa rastro, e pode
 * nunca ter chegado ao banco. Sem ela, a função antiga silencia TODA
 * publicação sem tarefa vinculada.
 *
 * DUPLICADA: avisos nascem em muitos lugares (telas, edge functions,
 * triggers). Caçar cada par é enxugar gelo — a trava vai na FONTE.
 */

describe("a trava anti-duplicata mora na fonte", () => {
  it("é um trigger BEFORE INSERT na própria tabela", () => {
    // Na fonte pega TODOS os caminhos: tela, edge function, trigger de
    // banco. Qualquer solução por chamador deixaria os outros abertos.
    expect(migration).toContain("before insert on public.notifications");
    expect(migration).toContain("create trigger notifications_sem_duplicata");
  });

  it("idêntico de verdade: usuário, tipo, mensagem E link, em 10 minutos", () => {
    // Critério frouxo engoliria aviso legítimo (duas artes diferentes na
    // mesma hora); critério apertado demais deixaria duplicata passar.
    expect(migration).toContain("n.user_id = new.user_id");
    expect(migration).toContain("n.message = new.message");
    expect(migration).toContain("coalesce(n.link, '') = coalesce(new.link, '')");
    expect(migration).toContain("interval '10 minutes'");
  });

  it("descarta em silêncio, nunca com erro", () => {
    // Quem grava o aviso está no meio de outra operação (publicar,
    // aprovar): a trava não pode derrubar essa operação.
    expect(migration).toContain("return null;");
    expect(migration).not.toContain("raise exception 'duplic");
  });

  it("a janela tem índice para não varrer a tabela a cada aviso", () => {
    expect(migration).toContain("notifications_dedupe_idx");
    expect(migration).toContain("(user_id, created_at desc)");
  });
});

describe("o aviso de post no ar é garantido, não presumido", () => {
  it("reaplica o patch de 21/08 de forma idempotente", () => {
    // O marcador é texto que SÓ existe na versão remendada. Aplicado, o
    // patch vira no-op; ausente, aplica — e alvo divergente falha alto.
    expect(migration).toContain("IF position('no ar no' in _fonte) > 0 THEN");
    expect(migration).toContain("RETURN;");
    expect(migration).toContain("editorial_record_published_receipt");
  });

  it("carrega os mesmos quatro remendos do patch original", () => {
    for (const trecho of [
      "patch recibo (declare)",
      "patch recibo (tarefa)",
      "patch recibo (link)",
      "patch recibo (cliente)",
    ]) {
      expect(migration).toContain(trecho);
      expect(aviso).toContain(trecho);
    }
  });

  it("o marcador de idempotência existe mesmo no texto remendado", () => {
    // Se o texto do aviso mudar um dia, o marcador tem que mudar junto —
    // este teste quebra e obriga a decisão consciente.
    expect(aviso).toContain("no ar no");
    expect(migration).toContain("no ar no");
  });
});

describe("um fato, um remetente", () => {
  it("o aviso de login mora so no AuthContext, preso ao SIGNED_IN", () => {
    // Confirmado nos dados de producao: um login da cliente virou 16
    // avisos em DOIS textos ("acessou o painel" e "acessou o portal"),
    // porque dois lugares avisavam o mesmo fato - e o do AppLayout tinha
    // trava por ABA (sessionStorage), disparando a cada aba nova e a cada
    // reabertura do PWA, sem login novo nenhum.
    const layout = ler("src/components/AppLayout.tsx");
    const auth = ler("src/contexts/AuthContext.tsx");
    expect(layout).not.toContain("acessou o painel");
    expect(layout).not.toContain("notifyAdmin(");
    expect(auth).toContain("acessou o portal");
  });
});
