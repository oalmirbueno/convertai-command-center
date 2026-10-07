import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { categoriaDoAviso, rotuloDoLink } from "@/lib/avisos/rotulos";
import { etapasDoTeste, testeTerminou, type DisparoDoTeste } from "@/lib/avisos/testeDeAvisos";
import { estadoDosAvisos, mostrarAvisoNoNavegador, pedirPermissaoDeAvisos } from "@/lib/avisosDoNavegador";
import {
  avisaAntes,
  avisaVencido,
  linkDoCliente,
  textoAntes,
  textoPausa,
  textoVencido,
} from "../../supabase/functions/check-renewals/marcos";
import { cabecalhosDoEmailInterno } from "../../supabase/functions/check-renewals/modulos/email-interno";

/**
 * Frente N (27/09): "todas as notificações funcionando corretamente".
 * Medido no banco: decisão de cliente em dobro (sino e e-mail), robô do N8N
 * acumulando não lidas, rajada de "Nova entrega" no portal, contagem de não
 * lidas presa às 30 carregadas, lembrete de cobrança ao cliente com 401 e o
 * admin sorteado recebendo sozinho os vencimentos, todo dia.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

describe("rótulos do sino", () => {
  it("cada rota atual tem o texto certo; post no ar diz para onde vai", () => {
    expect(rotuloDoLink("https://www.instagram.com/p/abc/")).toBe("Ver publicação no Instagram");
    expect(rotuloDoLink("/ciclo/revisao?client=1&review=2")).toBe("Abrir a revisão");
    expect(rotuloDoLink("/calendario?client=1&content=2&publicacao=3")).toBe("Abrir na Agenda");
    expect(rotuloDoLink("/mesa?client=1&aba=entrega")).toBe("Abrir na Mesa");
    expect(rotuloDoLink("/execucao?vinculo=1")).toBe("Abrir na Execução");
    expect(rotuloDoLink("/clientes?client=1")).toBe("Ver cliente");
    expect(rotuloDoLink("/aprovacoes")).toBe("Ver Arquivo");
    expect(rotuloDoLink("/documentos")).toBe("Ver entregas");
    expect(rotuloDoLink("/relatorios/abc")).toBe("Ver Relatório");
  });

  it("rota parecida não engana e link perigoso vira só Abrir", () => {
    expect(rotuloDoLink("/mesa-ads?client=1")).toBe("Abrir");
    expect(rotuloDoLink("//evil.example/aprovacoes")).toBe("Abrir");
    expect(rotuloDoLink("https://evil.example/p/1")).toBe("Abrir");
    expect(rotuloDoLink(null)).toBe("Abrir");
  });

  it("tipo novo ou desconhecido cai no sino genérico, nunca some", () => {
    expect(categoriaDoAviso("approval")).toBe("decisao");
    expect(categoriaDoAviso("agendamento_atrasado")).toBe("alerta");
    expect(categoriaDoAviso("delivery")).toBe("entrega");
    expect(categoriaDoAviso("operator_pronto")).toBe("agente");
    expect(categoriaDoAviso("tipo_que_nao_existe")).toBe("geral");
    expect(categoriaDoAviso(undefined)).toBe("geral");
  });
});

describe("teste de avisos do admin", () => {
  const disparo: DisparoDoTeste = {
    notification_id: "n1", criado: true, email_pedido: true, request_id: 7, email_destino: "ac***@gmail.com",
  };

  it("mostra cada canal e só termina quando nada está esperando", () => {
    const esperando = etapasDoTeste(disparo, null, { chegouNoSino: false, navegador: "ligado" });
    expect(esperando.map((e) => e.estado)).toEqual(["esperando", "esperando", "esperando"]);
    expect(testeTerminou(esperando)).toBe(false);

    const pronto = etapasDoTeste(
      disparo,
      { sino: { criado: true }, email: { pedido: true, http_status: 200, envio_status: "sent" } },
      { chegouNoSino: true, navegador: "ligado" },
    );
    expect(pronto.map((e) => e.estado)).toEqual(["ok", "ok", "ok"]);
    expect(pronto[1].texto).toContain("ac***@gmail.com");
    expect(testeTerminou(pronto)).toBe(true);
  });

  it("explica a falha: 401 do portão, descadastro, motivo do banco", () => {
    const portao = etapasDoTeste(disparo, { email: { pedido: true, http_status: 401 } }, { chegouNoSino: true, navegador: "pedir" });
    expect(portao[1].estado).toBe("falhou");
    expect(portao[1].texto).toContain("401");
    expect(portao[2].estado).toBe("desligado");

    const descadastro = etapasDoTeste(disparo, { email: { pedido: true, envio_status: "suppressed" } }, { chegouNoSino: true, navegador: "indisponivel" });
    expect(descadastro[1].texto).toContain("descadastrado");

    const semEmail = etapasDoTeste(
      { notification_id: "n2", criado: true, email_pedido: false, motivo_sem_email: "freio de 20 e-mails por hora atingido; tente mais tarde" },
      null,
      { chegouNoSino: true, navegador: "bloqueado" },
    );
    expect(semEmail[1].texto).toContain("freio");
    expect(testeTerminou(semEmail)).toBe(true);
  });
});

describe("aviso do navegador", () => {
  const original = (globalThis as any).Notification;
  const uaOriginal = navigator.userAgent;
  afterEach(() => {
    (globalThis as any).Notification = original;
    Object.defineProperty(navigator, "userAgent", { value: uaOriginal, configurable: true });
  });

  it("Safari antigo responde só pelo callback: o botão sai de 'pedir' para 'ligado'", async () => {
    const Falso: any = function () { /* sem uso */ };
    Falso.permission = "default";
    Falso.requestPermission = (cb: (v: string) => void) => { Falso.permission = "granted"; cb("granted"); return undefined; };
    (globalThis as any).Notification = Falso;
    expect(await pedirPermissaoDeAvisos()).toBe("ligado");
  });

  it("no Android (sem service worker) o aviso do navegador não é oferecido", () => {
    const Falso: any = function () { /* sem uso */ };
    Falso.permission = "default";
    (globalThis as any).Notification = Falso;
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 14) Chrome/140", configurable: true });
    expect(estadoDosAvisos()).toBe("indisponivel");
  });

  it("cada aviso tem etiqueta própria (a fixa fazia o segundo sumir em silêncio)", () => {
    const etiquetas: string[] = [];
    const Falso: any = vi.fn(function (this: any, _t: string, op: { tag: string }) { etiquetas.push(op.tag); this.close = () => undefined; });
    Falso.permission = "granted";
    (globalThis as any).Notification = Falso;
    expect(mostrarAvisoNoNavegador({ titulo: "A", corpo: "1", link: null, marca: "2026-09-27T10:00:00Z" }, () => undefined)).toBe(true);
    expect(mostrarAvisoNoNavegador({ titulo: "A", corpo: "2", link: null, marca: "2026-09-27T10:01:00Z" }, () => undefined)).toBe(true);
    expect(new Set(etiquetas).size).toBe(2);
  });
});

describe("vencimento de plano: só nos marcos, sem emoji nem travessão", () => {
  it("antes: 7, 3, 1 dia e no dia; vencido: 1, 3, 7, 15, 30 e depois a cada 30", () => {
    expect([8, 7, 6, 5, 4, 3, 2, 1, 0].filter(avisaAntes)).toEqual([7, 3, 1, 0]);
    expect(Array.from({ length: 95 }, (_, i) => i + 1).filter(avisaVencido)).toEqual([1, 3, 7, 15, 30, 60, 90]);
  });

  it("texto curto, com link para a ficha do cliente", () => {
    const textos = [
      textoAntes("Acerbi", 7, "04/10/2026", 850),
      textoAntes("Mirante", 0, "28/09/2026", null),
      textoVencido("Verzelo", 1, 550),
      textoPausa("Verzelo", 30),
    ];
    for (const t of textos) {
      expect(t).not.toMatch(/[—\u{1F300}-\u{1FAFF}⚠]/u);
    }
    expect(textos[0]).toBe('Plano de "Acerbi" vence em 7 dias (04/10/2026) · R$ 850,00');
    expect(textos[1]).toBe('Plano de "Mirante" vence hoje');
    expect(textos[2]).toContain("vencido há 1 dia ·");
    expect(linkDoCliente("abc")).toBe("/clientes?client=abc");
  });
});

describe("e-mail de servidor para servidor", () => {
  it("leva o segredo interno (sem ele, 401) e não inventa cabeçalho sem segredo", () => {
    expect(cabecalhosDoEmailInterno(() => " s3gr3do ")).toEqual({ "x-cron-secret": "s3gr3do" });
    expect(cabecalhosDoEmailInterno(() => undefined)).toEqual({});
  });

  it("o lembrete de cobrança usa o segredo e avisa todo admin, não um sorteado", () => {
    const fonte = ler("supabase/functions/check-renewals/index.ts");
    expect(fonte).toContain("headers: cabecalhosDoEmailInterno()");
    expect(fonte).not.toContain('rpc("get_admin_user_id")');
    expect(fonte).toContain("avisarAdmins(");
  });

  it("o empurrão da fila deixa de levar 403", () => {
    expect(ler("supabase/functions/send-transactional-email/index.ts")).toContain("'x-cron-secret': cronSecret");
    expect(ler("supabase/functions/process-email-queue/index.ts")).toContain("if (!internalCron && claims?.role !== 'service_role')");
  });
});

describe("o sino: contagem certa, tempo real, marcar tudo de uma vez", () => {
  it("a contagem vem do banco e o layout escuta o canal em tempo real", () => {
    const layout = ler("src/components/AppLayout.tsx");
    expect(layout).toContain("useAvisosEmTempoReal();");
    expect(layout).toContain("useContagemDeNaoLidas()");
    const avisos = ler("src/hooks/useAvisos.ts");
    expect(avisos).toContain('{ count: "exact", head: true }');
    expect(avisos).toContain("filter: `user_id=eq.${userId}`");
  });

  it("marcar todas é uma chamada só, e o botão do navegador é só da equipe", () => {
    const painel = ler("src/components/NotificationsPanel.tsx");
    expect(painel).toContain("await marcarAreaComoLida(user.id, area)");
    expect(painel).not.toContain("for (const n of unread)");
    expect(painel).toContain('eEquipe && avisosDoNavegador === "pedir"');
    expect(painel).toContain("eAdmin && <TesteDeAvisos");
  });

  it("a lista do sino filtra pela pessoa", () => {
    const dados = ler("src/hooks/useSupabaseData.ts");
    const trecho = dados.slice(dados.indexOf("export function useNotifications"), dados.indexOf("export function useUpdates"));
    expect(trecho).toContain('.eq("user_id", user!.id)');
  });
});
