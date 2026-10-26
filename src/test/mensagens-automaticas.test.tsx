import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  brl, etapaDaCobranca, janelaAberta, normalizarPainel, pecaEntraNoLembrete, preencherModelo, textoDaCobranca, textoDoLembrete,
} from "@/lib/mensagensAutomaticas";

/**
 * Lembrete de aprovação no grupo do cliente e régua de cobrança com um clique
 * (27/10/2026). Nada vai ao cliente sem o dono: o lembrete só nasce com o
 * modelo aprovado; a cobrança nasce pendente (ou aprovada pela régua que o
 * dono aprovou). O Hermes só lê o que foi aprovado, só na janela, e registra.
 */

const raiz = resolve(__dirname, "../..");
const SQL = readFileSync(resolve(raiz, "supabase/migrations/20261027100000_lembrete_de_aprovacao_e_regua_de_cobranca.sql"), "utf8");

/** O corpo de uma função da migration (do CREATE até o fim do $$). */
function funcao(nome: string): string {
  const i = SQL.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  expect(i, `função ${nome}`).toBeGreaterThanOrEqual(0);
  const abre = SQL.indexOf("$$", i);
  const fecha = SQL.indexOf("$$;", abre + 2);
  return SQL.slice(i, fecha + 3);
}

// Segunda 27/10/2026, horário de São Paulo = UTC-3.
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe("as contas do lembrete e da cobrança", () => {
  it("janela: só dia útil, das 9h às 18h em São Paulo", () => {
    expect(janelaAberta(sp("2026-10-26T09:00:00"))).toBe(true); // segunda 9h
    expect(janelaAberta(sp("2026-10-26T08:59:00"))).toBe(false);
    expect(janelaAberta(sp("2026-10-26T17:59:00"))).toBe(true);
    expect(janelaAberta(sp("2026-10-26T18:00:00"))).toBe(false);
    expect(janelaAberta(sp("2026-10-30T12:00:00"))).toBe(true); // sexta
    expect(janelaAberta(sp("2026-10-31T12:00:00"))).toBe(false); // sábado
    expect(janelaAberta(sp("2026-11-01T12:00:00"))).toBe(false); // domingo
  });

  it("48 h: a peça entra no lembrete depois de 48 h esperando (e no máximo 30 dias)", () => {
    const agora = sp("2026-10-27T10:00:00");
    expect(pecaEntraNoLembrete(sp("2026-10-25T10:30:00"), agora)).toBe(false); // 47,5 h
    expect(pecaEntraNoLembrete(sp("2026-10-25T10:00:00"), agora)).toBe(true); // 48 h
    expect(pecaEntraNoLembrete(sp("2026-09-30T10:00:00"), agora)).toBe(true); // 27 dias (Stop)
    expect(pecaEntraNoLembrete(sp("2026-09-26T10:00:00"), agora)).toBe(false); // 31 dias
  });

  it("régua: D+1, D+5 e D+10 (a maior já alcançada); antes do vencimento, nada", () => {
    expect([0, 1, 4, 5, 9, 10, 22, 35].map(etapaDaCobranca)).toEqual([null, 1, 1, 5, 5, 10, 10, 10]);
  });

  it("texto do lembrete: até 5 peças, o resto contado, link com https", () => {
    const itens = Array.from({ length: 6 }, (_, i) => ({ fileId: `f${i}`, titulo: `Post ${i + 1}`, dias: i === 0 ? 1 : 3 }));
    const t = textoDoLembrete("Oi, pessoal! Tem {pecas} esperando:\n{lista}\nAprove aqui: {link}", "Stop", itens);
    expect(t).toContain("Tem 6 peças esperando");
    expect(t).toContain("• Post 1 (há 1 dia)");
    expect(t).toContain("• Post 5 (há 3 dias)");
    expect(t).not.toContain("Post 6");
    expect(t).toContain("• e mais 1");
    expect(t).toContain("https://aceleriq.online/aprovacoes");
  });

  it("texto da cobrança: valor, vencimento, Pix e link; variável sem valor nunca vai para o cliente", () => {
    const t = textoDaCobranca("Oi! Em aberto:\n{itens}\nTotal {total}. Pix: {pix}\n{link} {desconhecida}", "Softy", [
      { billingId: "b2", descricao: "Projeto · Parcela 2/2", valor: 300, vencimento: "2026-10-21", dias: 6, etapa: 5, marco: true },
      { billingId: "b1", descricao: "Projeto · Entrada", valor: 300, vencimento: "2026-09-21", dias: 36, etapa: 10, marco: true },
    ], "pix@aceleriq.com");
    expect(t.indexOf("venceu em 21/09")).toBeLessThan(t.indexOf("venceu em 21/10"));
    expect(t).toContain("• Projeto · Entrada: R$ 300,00, venceu em 21/09");
    expect(t).toContain("Total R$ 600,00");
    expect(t).toContain("Pix: pix@aceleriq.com");
    expect(t).toContain("https://aceleriq.online/financeiro");
    expect(t).not.toMatch(/\{[a-z_]+\}/);
    expect(brl(1647)).toBe("R$ 1.647,00");
    expect(preencherModelo("a {x} b", {})).toBe("a  b");
  });
});

describe("migration: lembrete de aprovação", () => {
  const tick = funcao("public.mensagens_automaticas_tick");
  const candidatos = funcao("app_private.lembrete_candidatos");

  it("nada sai sem o modelo aprovado: o modelo nasce sem aprovação e o tick só prepara lembrete com aprovado_texto", () => {
    expect(SQL).toMatch(/INSERT INTO public\.mensagem_modelo \(tipo, texto\) VALUES/);
    expect(SQL).not.toMatch(/INSERT INTO public\.mensagem_modelo \(tipo, texto, aprovado_texto/);
    const i = tick.indexOf("_modelo.aprovado_texto IS NOT NULL");
    expect(i).toBeGreaterThan(0);
    expect(tick.indexOf("app_private.lembrete_candidatos()")).toBeGreaterThan(i);
    expect(tick).toContain("app_private.lembrete_texto(_modelo.aprovado_texto");
  });

  it("48 h e 30 dias, contados de quando a peça foi pedida ao cliente; só pendente com o cliente", () => {
    expect(candidatos).toContain("<= now() - interval '48 hours'");
    expect(candidatos).toContain("> now() - interval '30 days'");
    expect(candidatos).toContain("COALESCE(f.approval_requested_at, f.created_at)");
    expect(candidatos).toContain("f.approval_status = 'pending'");
    expect(candidatos).toContain("NOT COALESCE(public.is_staff(p.id), false)");
  });

  it("1 por cliente por dia, só na janela e válido só até as 18h do dia", () => {
    expect(tick).toContain("_chave := 'lembrete:' || _c.client_id::text || ':' || _hoje::text;");
    expect(SQL).toMatch(/chave text NOT NULL UNIQUE/);
    expect(tick).toMatch(/IF NOT app_private\.mensagens_janela_aberta\(now\(\)\) THEN\s+RETURN/);
    expect(funcao("app_private.mensagens_janela_aberta")).toMatch(/BETWEEN 1 AND 5[\s\S]*time '09:00'[\s\S]*< time '18:00'/);
    expect(tick).toContain("app_private.mensagens_fim_da_janela(_hoje))");
    expect(tick).toMatch(/'aprovado', 'modelo'/);
    expect(tick).toContain("IF _c.grupo IS NULL THEN _sem_grupo := _sem_grupo + 1; CONTINUE; END IF;");
  });

  it("para quando o cliente decide: cancela o que não saiu e registra se foi aprovado por fora", () => {
    const parar = funcao("app_private.mensagem_automatica_motivo_para_parar");
    expect(parar).toContain("f.approval_status = 'pending'");
    expect(parar).toContain("e.event_type = 'client_approved_offline'");
    expect(parar).toContain("RETURN 'aprovado_por_fora';");
    expect(parar).toContain("RETURN 'cliente_decidiu';");
    const conferir = funcao("app_private.mensagens_automaticas_conferir");
    expect(conferir).toMatch(/WHERE executed_at IS NULL AND status IN \('pendente', 'aprovado'\)/);
    expect(conferir).toContain("SET status = 'cancelado', cancelado_motivo = _motivo");
    expect(conferir).toContain("SET status = 'expirado'");
  });

  it("pausar o modelo cancela o que estava na fila sem sair", () => {
    const pausar = funcao("public.mensagem_modelo_pausar");
    expect(pausar).toContain("aprovado_texto = NULL");
    expect(pausar).toContain("cancelado_motivo = 'modelo_pausado'");
  });
});

describe("migration: régua de cobrança", () => {
  const tick = funcao("public.mensagens_automaticas_tick");
  const candidatos = funcao("app_private.cobranca_candidatos");

  it("D+1, D+5, D+10: uma mensagem por etapa, nunca repete (salvo a cancelada por pagamento parcial)", () => {
    expect(funcao("app_private.cobranca_etapa")).toContain("WHEN _dias >= 10 THEN 10 WHEN _dias >= 5 THEN 5 WHEN _dias >= 1 THEN 1");
    expect(candidatos).toContain("b.status = 'pending'");
    expect(candidatos).toContain("b.due_date < _hoje");
    expect(candidatos).toContain("m.status <> 'cancelado'");
    expect(candidatos).toContain("'marco', true");
    expect(candidatos).toContain("HAVING bool_or(m.novo)");
    expect(tick).toContain("WHERE mm.tipo = ('cobranca_d' || _c.etapa::text);");
  });

  it("nada sai sem aprovação: nasce pendente; só a régua aprovada pelo dono a faz nascer aprovada", () => {
    expect(tick).toContain("_status := CASE WHEN _regua THEN 'aprovado' ELSE 'pendente' END;");
    expect(tick).toMatch(/_regua := _c\.grupo IS NOT NULL AND NOT EXISTS[\s\S]*r\.revogada_em IS NULL/);
    const regua = funcao("public.cobranca_regua_aprovar");
    expect(regua).toContain("PERFORM app_private.central_review_admin();");
    expect(regua).toContain("b.status = 'pending'");
  });

  it("pagou, para: a não enviada é cancelada; decidir confere de novo antes de aprovar", () => {
    const parar = funcao("app_private.mensagem_automatica_motivo_para_parar");
    expect(parar).toContain("b.status = 'pending'");
    expect(parar).toContain("CASE WHEN _n = 0 THEN 'pagou' ELSE 'pagou_parte' END");
    const decidir = funcao("public.mensagem_automatica_decidir");
    expect(decidir).toContain("PERFORM app_private.central_review_admin();");
    expect(decidir).toContain("_m.payload_hash IS DISTINCT FROM _hash");
    expect(decidir.indexOf("motivo_para_parar")).toBeLessThan(decidir.indexOf("mensagem_automatica_aprovar("));
  });
});

describe("migration: o Hermes só envia o que o dono aprovou, na janela", () => {
  const fila = funcao("public.mensagens_automaticas_fila_para_agente");

  it("a fila confere antes, traz só aprovado e só com a janela aberta", () => {
    expect(fila).toContain("PERFORM app_private.agente_assume_admin(_operator_slug);");
    expect(fila.indexOf("mensagens_automaticas_conferir()")).toBeLessThan(fila.indexOf("aprovados_para_enviar"));
    expect(fila).toContain("WHERE m.status = 'aprovado' AND m.executed_at IS NULL AND m.valid_until > now()");
    expect(fila).toContain("'aprovados_para_enviar', CASE WHEN _aberta THEN _aprovados ELSE '[]'::jsonb END");
  });

  it("registrar o envio só para mensagem aprovada; as portas do agente e o tick só para o serviço", () => {
    expect(funcao("public.mensagem_automatica_marcar_enviado")).toContain("MENSAGEM_NAO_APROVADA");
    expect(SQL).toContain("CONSTRAINT mensagem_automatica_envio_so_aprovado CHECK (executed_at IS NULL OR status IN ('aprovado', 'cancelado'))");
    for (const f of ["public.mensagens_automaticas_tick()", "public.mensagens_automaticas_fila_para_agente(text)", "public.mensagem_automatica_marcar_enviado_por_agente(text, uuid, text, text)"]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${f} FROM PUBLIC, anon, authenticated;`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION ${f} TO service_role;`);
    }
    expect(SQL).toContain("cron.schedule('mensagens-automaticas', '7,37 * * * *', $job$SELECT public.mensagens_automaticas_tick();$job$)");
  });
});

describe("migration: em atraso desde", () => {
  it("recalcula pela cobrança pendente mais antiga já vencida; sem nenhuma, limpa; por padrão só simula", () => {
    const f = funcao("public.recalcular_em_atraso_desde");
    expect(f).toContain("_aplicar boolean DEFAULT false");
    expect(f).toContain("min(b.due_date) FROM public.billing b WHERE b.client_id = p.id AND b.status = 'pending' AND b.due_date < _hoje");
    expect(f).toMatch(/IF _aplicar THEN\s+UPDATE public\.profiles/);
    expect(f).toContain("só admin");
  });

  it("a migration não aplica a correção (nenhum UPDATE em profiles fora da função)", () => {
    const fora = SQL.replace(funcao("public.recalcular_em_atraso_desde"), "");
    expect(fora).not.toMatch(/UPDATE public\.profiles/);
  });
});

// ─── A tela ──────────────────────────────────────────────────────────────

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, profile: { role: "admin" } }) }));

import MensagensAutomaticas from "@/components/central/MensagensAutomaticas";

function painel(extra: Record<string, unknown> = {}) {
  return {
    janela_aberta: true,
    tem_pix: true,
    modelos: [
      { tipo: "cobranca_d1", texto: "Oi! {itens}", aprovado_texto: null },
      { tipo: "cobranca_d10", texto: "Oi! Ainda não identificamos:\n{itens}", aprovado_texto: null },
      { tipo: "cobranca_d5", texto: "Oi! {itens}", aprovado_texto: null },
      { tipo: "lembrete_aprovacao", texto: "Oi, pessoal! Tem {pecas}:\n{lista}\n{link}", aprovado_texto: null },
    ],
    mensagens: [{
      id: "m-tf", tipo: "cobranca", client_id: "c-tf", cliente: "Terra Flor", dia: "2026-10-27", etapa: 10,
      itens: [{ billing_id: "b-1", descricao: "Mensalidade · Terra & Flor", valor: 697, vencimento: "2026-10-04", dias: 23, etapa: 10, marco: true }],
      mensagem: "Oi, pessoal! A gente ainda não identificou este pagamento:\n• Mensalidade · Terra & Flor: R$ 697,00, venceu em 04/10",
      destino: { channel: "whatsapp", recipient: "Terra Flor - MKT - Aceleriq" }, payload_hash: "hash-tf", status: "pendente",
      valid_until: "2026-10-30T21:00:00Z", created_at: "2026-10-27T12:07:00Z", grupo_conhecido: "Terra Flor - MKT - Aceleriq",
    }, {
      id: "m-sf", tipo: "cobranca", client_id: "c-sf", cliente: "Softy Móveis", dia: "2026-10-27", etapa: 10,
      itens: [{ billing_id: "b-2", descricao: "Projeto · Entrada", valor: 300, vencimento: "2026-09-21", dias: 36, etapa: 10, marco: true }],
      mensagem: "Oi, pessoal! Softy", destino: { channel: "whatsapp", recipient: null }, payload_hash: "hash-sf", status: "pendente",
      valid_until: "2026-10-30T21:00:00Z", created_at: "2026-10-27T12:07:00Z", grupo_conhecido: null,
    }],
    esperando_cliente: [{ client_id: "c-stop", cliente: "Stop Informatica", grupo: "Stop - MKT - Aceleriq", itens: [{ file_id: "f1", titulo: "Programe sua visita", dias: 17 }] }],
    reguas: [],
    ...extra,
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MensagensAutomaticas))));
}

const chamadas = (nome: string) => rpc.mock.calls.filter((c) => c[0] === nome).map((c) => c[1] as Record<string, unknown>);

beforeEach(() => {
  rpc.mockReset().mockImplementation(async (nome: string) => {
    if (nome === "mensagens_automaticas_painel") return { data: painel(), error: null };
    if (nome === "mensagem_automatica_decidir") return { data: { status: "aprovado" }, error: null };
    if (nome === "cobranca_regua_aprovar") return { data: { aprovadas_agora: 1, sem_grupo: false }, error: null };
    return { data: {}, error: null };
  });
});
afterEach(() => cleanup());

describe("tela: Cobranças e Lembrete de aprovação (em Mensagens da semana)", () => {
  it("cobrança pendente em cartão com a prévia, o D+ e o grupo; aprovar manda a decisão com o hash", async () => {
    montar();
    await waitFor(() => expect(document.querySelectorAll("[data-cobranca]").length).toBe(2));
    const cartao = document.querySelector('[data-cobranca="m-tf"]') as HTMLElement;
    expect(cartao.textContent).toContain("D+10");
    expect(cartao.textContent).toContain("R$ 697,00 em aberto desde 04/10");
    expect(cartao.querySelector('[data-balao="whatsapp"]')!.textContent).toContain("venceu em 04/10");
    fireEvent.click(screen.getByRole("button", { name: "Aprovar e enviar a cobrança de Terra Flor" }));
    await waitFor(() => expect(chamadas("mensagem_automatica_decidir").length).toBe(1));
    expect(chamadas("mensagem_automatica_decidir")[0]).toMatchObject({ _id: "m-tf", _hash: "hash-tf", _decisao: "aprovado", _mensagem: null, _recipient: null });
  });

  it("régua inteira de um cliente num toque", async () => {
    montar();
    await waitFor(() => expect(document.querySelectorAll("[data-cobranca]").length).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Aprovar a régua inteira de Terra Flor" }));
    await waitFor(() => expect(chamadas("cobranca_regua_aprovar").length).toBe(1));
    expect(chamadas("cobranca_regua_aprovar")[0]).toMatchObject({ _client_id: "c-tf" });
  });

  it("sem grupo conhecido, pede o nome do grupo antes de aprovar e manda junto", async () => {
    montar();
    await waitFor(() => expect(document.querySelectorAll("[data-cobranca]").length).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Aprovar e enviar a cobrança de Softy Móveis" }));
    expect(chamadas("mensagem_automatica_decidir").length).toBe(0);
    fireEvent.change(screen.getByRole("textbox", { name: "Grupo de Softy Móveis no WhatsApp" }), { target: { value: "Softy - MKT - Aceleriq" } });
    fireEvent.click(screen.getByRole("button", { name: "Aprovar e enviar a cobrança de Softy Móveis" }));
    await waitFor(() => expect(chamadas("mensagem_automatica_decidir").length).toBe(1));
    expect(chamadas("mensagem_automatica_decidir")[0]).toMatchObject({ _id: "m-sf", _recipient: "Softy - MKT - Aceleriq" });
  });

  it("modelo do lembrete sem aprovação: diz que nada sai, mostra a prévia com o cliente real e aprova com um toque", async () => {
    montar();
    await waitFor(() => expect(document.querySelector('[data-modelo-lembrete="sem-aprovacao"]')).toBeTruthy());
    const modelo = document.querySelector("[data-modelo-lembrete]") as HTMLElement;
    expect(modelo.textContent).toContain("nenhum lembrete sai");
    expect(modelo.querySelector('[data-balao="whatsapp"]')!.textContent).toContain("• Programe sua visita (há 17 dias)");
    expect(modelo.querySelector('[data-balao="whatsapp"]')!.textContent).toContain("https://aceleriq.online/aprovacoes");
    expect(document.querySelector('[data-esperando="c-stop"]')!.textContent).toContain("1 peça");
    fireEvent.click(screen.getByRole("button", { name: /Aprovar o modelo/ }));
    await waitFor(() => expect(chamadas("mensagem_modelo_aprovar").length).toBe(1));
    expect(chamadas("mensagem_modelo_aprovar")[0]).toMatchObject({ _tipo: "lembrete_aprovacao" });
  });

  it("banco ainda sem a migration: a tela não quebra (some)", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: "Could not find the function public.mensagens_automaticas_painel", code: "PGRST202" } }));
    montar();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("mensagens_automaticas_painel", {}));
    expect(document.querySelector("[data-mensagens-automaticas]")).toBeNull();
  });

  it("normaliza o painel de forma tolerante", () => {
    const p = normalizarPainel(painel());
    expect(p.mensagens[0]).toMatchObject({ tipo: "cobranca", etapa: 10, grupo: "Terra Flor - MKT - Aceleriq", hash: "hash-tf" });
    expect(p.mensagens[1].grupo).toBeNull();
    expect(normalizarPainel(null)).toMatchObject({ modelos: [], mensagens: [], esperandoCliente: [] });
  });
});
