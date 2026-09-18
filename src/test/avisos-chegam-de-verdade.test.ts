import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { avisoParaMostrar } from "@/lib/avisosDoNavegador";

/**
 * Caso Verzelo (2026-09-16 18:07): a cliente aprovou uma arte, o painel gravou
 * o aviso no sino dos administradores e ninguém viu. Auditoria dos 30 dias
 * anteriores: toda decisão de cliente gerou aviso no sino; nenhuma saiu do
 * painel. E o pedido de cliente avisava um administrador sorteado (LIMIT 1).
 *
 * Regras pinadas: o aviso da equipe nasce no banco (não no navegador do
 * cliente), vai para todo administrador e gestor humano, vira e-mail quando
 * é decisão ou pedido, e aparece no navegador de quem ligou os avisos.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const migracao = ler("supabase/migrations/20260918120000_avisos_chegam_de_verdade.sql");
const registro = ler("supabase/functions/_shared/transactional-email-templates/registry.ts");
const template = ler("supabase/functions/_shared/transactional-email-templates/aviso-do-painel.tsx");
const layout = ler("src/components/AppLayout.tsx");
const painel = ler("src/components/NotificationsPanel.tsx");

describe("o aviso da equipe nasce no banco", () => {
  it("decisão do cliente e pedido do cliente têm gatilho próprio", () => {
    expect(migracao).toContain("AFTER INSERT ON public.file_approval_events");
    expect(migracao).toContain("AFTER INSERT ON public.client_requests");
    expect(migracao).toContain("IF NEW.actor_id IS DISTINCT FROM NEW.client_id THEN RETURN NEW; END IF;");
  });

  it("vai para todo administrador e gestor humano, nunca para o robô", () => {
    expect(migracao).toContain("WHERE ur.role IN ('admin', 'manager')");
    expect(migracao).toContain("NOT ILIKE 'n8n@%'");
    expect(migracao).not.toContain("LIMIT 1\n$$");
  });

  it("o texto é idêntico ao da tela, para a deduplicação descartar a cópia", () => {
    const tela = ler("src/pages/ClientApprovals.tsx");
    expect(tela).toContain('`Aprovação recebida: ${profile?.company_name || profile?.full_name || "Cliente"} aprovou "${file.file_name}". Pronto para agendar na Agenda.`');
    expect(migracao).toContain(`'Aprovação recebida: ' || _cliente || ' aprovou "' || COALESCE(_arquivo, 'material') || '". Pronto para agendar na Agenda.'`);
    expect(migracao).toContain(`'Ajustes solicitados: ' || _cliente || ' pediu mudanças em "' || COALESCE(_arquivo, 'material') || '".'`);
  });
});

describe("aviso importante vira e-mail", () => {
  it("só os tipos que merecem sair do painel, com freio de 20 por hora e falha que nunca segura o aviso", () => {
    expect(migracao).toContain("SELECT _tipo IN ('approval', 'request', 'aprovacao_necessaria', 'central_review_pendente', 'central_review_decidida', 'central_review_enviada', 'responsavel_designado');");
    expect(migracao).toContain("IF _na_hora >= 20 THEN RETURN NEW; END IF;");
    expect(migracao).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(migracao).toContain("AFTER INSERT ON public.notifications");
  });

  it("usa o mesmo caminho do lembrete de cobrança: função de e-mail com o segredo do cofre", () => {
    expect(migracao).toContain("FROM vault.decrypted_secrets WHERE name = 'cron_secret'");
    expect(migracao).toContain("'/functions/v1/send-transactional-email'");
    expect(migracao).toContain("'templateName', 'aviso-do-painel'");
    expect(migracao).toContain("'idempotencyKey', 'notificacao-' || NEW.id::text");
  });

  it("o template existe, está registrado e leva o botão para o lugar certo do painel", () => {
    expect(registro).toContain("'aviso-do-painel': avisoDoPainel,");
    expect(template).toContain("Abrir no painel");
    expect(template).toContain("approval: 'Decisão de cliente'");
    expect(template).toContain("request: 'Pedido de cliente'");
  });
});

describe("o acesso do cliente ao portal também sai por e-mail", () => {
  it("a segunda migration liga o aviso 'Cliente acessou o portal' ao e-mail, com rótulo próprio", () => {
    const acesso = ler("supabase/migrations/20260918130000_acesso_do_cliente_avisa_por_email.sql");
    expect(acesso).toContain("NEW.notification_type = 'system' AND NEW.message LIKE 'Cliente acessou o portal:%'");
    expect(acesso).toContain("CASE WHEN NEW.notification_type = 'system' THEN 'acesso' ELSE NEW.notification_type END");
    expect(template).toContain("acesso: 'Cliente entrou no portal'");
    // O aviso de acesso continua nascendo no AuthContext, com o texto fixo que o gatilho reconhece.
    expect(ler("src/contexts/AuthContext.tsx")).toContain("acessou o portal: ${who}");
  });
});

describe("aviso no navegador", () => {
  it("mostra só o que chegou depois da marca d'água e agrupa quando são vários", () => {
    const base = { read: false, link: "/calendario" };
    const lista = [
      { id: "a", message: "Um", created_at: "2026-09-18T10:00:00Z", ...base },
      { id: "b", message: "Dois", created_at: "2026-09-18T10:05:00Z", ...base },
      { id: "c", message: "Lido", created_at: "2026-09-18T10:06:00Z", read: true, link: null },
    ];
    expect(avisoParaMostrar(lista, "2026-09-18T10:05:00Z")).toBeNull();
    const um = avisoParaMostrar(lista, "2026-09-18T10:00:00Z");
    expect(um?.corpo).toBe("Dois");
    expect(um?.link).toBe("/calendario");
    expect(um?.marca).toBe("2026-09-18T10:05:00Z");
    const varios = avisoParaMostrar(lista, null);
    expect(varios?.titulo).toContain("2 avisos novos");
    expect(varios?.link).toBeNull();
  });

  it("o painel oferece ligar os avisos e o layout dispara para a equipe", () => {
    expect(painel).toContain("Ativar avisos no navegador");
    expect(layout).toContain("mostrarAvisoNoNavegador(aviso, (link) =>");
    expect(layout).toContain("if (!isAdminOrTeam || !notifData) return;");
  });
});
