import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agruparFluxos,
  caminhoPorNo,
  desenharFluxo,
  nomeCurto,
  normalizarPainel,
  numerosDoPainel,
  ORDEM_DOS_GRUPOS,
  fluxosDoCliente,
  pastasDaAceleriq,
  pastasDeClientes,
} from "@/lib/centralDeAutomacoes";

/**
 * Central de Automações (19/11/2026): lista por grupo, números do topo, desenho do fluxo e o caminho de uma
 * execução. Também confere o contrato do banco (RLS, só leitura pela RPC, poda) e o registro no manifesto.
 */
const raiz = resolve(__dirname, "../..");
const sql = readFileSync(resolve(raiz, "supabase/migrations/20261119180000_central_de_automacoes.sql"), "utf8");

const BRUTO = {
  coleta: { coletado_em: "2026-11-19T13:05:00Z", recebido_em: "2026-11-19T13:05:02Z", atrasada: false },
  pode_ligar: true,
  fluxos: [
    { id: "AcqF00Ferramenta", nome: "Apoio: ponte com o painel", grupo: "Apoio", ativo: true, total_24h: 8634, erros_24h: 0, gatilhos: [{ tipo: "subfluxo", descricao: "chamado por outro fluxo" }], efeito_no_cliente: false },
    { id: "Acq11MensagemSem", nome: "Clientes: mensagem da semana no grupo (seg, qua, sex)", grupo: "Clientes", ativo: true, total_24h: 2, erros_24h: 1, proxima_execucao: "2026-11-20T20:20:00Z", gatilhos: [], efeito_no_cliente: true },
    { id: "Acq08ComercialRp", nome: "Comercial: repasse no WhatsApp da Aceleriq", grupo: "Comercial", ativo: false, total_24h: 0, erros_24h: 0, gatilhos: [], efeito_no_cliente: true },
    { id: "TmpRecebeExport01", nome: "TMP: receber export (apagar depois)", grupo: "Temporários", ativo: false, total_24h: 0, erros_24h: 0, gatilhos: [], efeito_no_cliente: false },
  ],
  saude: [
    { chave: "n8n", nome: "n8n no ar", estado: "ok", detalhe: "respondeu em 45 ms", info: {} },
    { chave: "disco", nome: "Disco do servidor", estado: "atencao", detalhe: "91% usado", info: {} },
  ],
  acoes: [],
};

describe("central de automações: leitura", () => {
  it("normaliza, agrupa na ordem combinada e conta o topo", () => {
    const p = normalizarPainel(BRUTO);
    const grupos = agruparFluxos(p.fluxos);
    expect(grupos.map((g) => g.grupo)).toEqual(["Clientes", "Comercial", "Apoio", "Temporários"]);
    expect(ORDEM_DOS_GRUPOS.indexOf("Clientes")).toBeLessThan(ORDEM_DOS_GRUPOS.indexOf("Apoio"));
    const n = numerosDoPainel(p);
    expect(n).toMatchObject({ ligados: 2, total: 4, rodadas24h: 8636, erros24h: 1, saudeOk: 1, saudeTotal: 2 });
  });

  it("filtra por estado e por busca sem perder o grupo", () => {
    const p = normalizarPainel(BRUTO);
    expect(agruparFluxos(p.fluxos, { filtro: "desligados" }).flatMap((g) => g.fluxos.map((f) => f.id))).toEqual(["Acq08ComercialRp", "TmpRecebeExport01"]);
    expect(agruparFluxos(p.fluxos, { filtro: "com_erro" }).flatMap((g) => g.fluxos.map((f) => f.id))).toEqual(["Acq11MensagemSem"]);
    expect(agruparFluxos(p.fluxos, { busca: "semana" }).flatMap((g) => g.fluxos.map((f) => f.id))).toEqual(["Acq11MensagemSem"]);
  });

  it("tira o prefixo do grupo do nome", () => {
    expect(nomeCurto({ nome: "Clientes: aviso de post no ar no grupo", grupo: "Clientes" })).toBe("Aviso de post no ar no grupo");
    expect(nomeCurto({ nome: "Grupos DK · 03 Agendador 24x7", grupo: "Grupos DK" })).toBe("03 Agendador 24x7");
    expect(nomeCurto({ nome: "Envio das mensagens aprovadas", grupo: "Outros" })).toBe("Envio das mensagens aprovadas");
  });

  it("resposta vazia ou estranha não quebra a tela", () => {
    const p = normalizarPainel(null);
    expect(p.fluxos).toEqual([]);
    expect(p.disponivel).toBe(false);
  });
});

describe("central de automações: desenho e caminho", () => {
  const desenho = {
    nos: [
      { nome: "A cada 5 minutos", tipo: "scheduleTrigger", x: 0, y: 0, desligado: false },
      { nome: "Ler pendentes", tipo: "postgres", x: 220, y: 0, desligado: false },
      { nome: "Responder", tipo: "httpRequest", x: 440, y: 120, desligado: true },
    ],
    ligacoes: [
      { de: "A cada 5 minutos", para: "Ler pendentes", saida: 0, tipo: "main" },
      { de: "Ler pendentes", para: "Responder", saida: 0, tipo: "main" },
      { de: "Ler pendentes", para: "Nó que não existe", saida: 1, tipo: "main" },
    ],
  };

  it("cabe numa caixa a partir de zero e ignora ligação para nó que não existe", () => {
    const d = desenharFluxo(desenho);
    expect(d.nos).toHaveLength(3);
    expect(Math.min(...d.nos.map((n) => n.x))).toBeGreaterThanOrEqual(0);
    expect(d.ligacoes).toHaveLength(2);
    expect(d.largura).toBeGreaterThan(440);
    expect(d.altura).toBeGreaterThan(120);
  });

  it("marca os nós pelo caminho da execução: feito, erro, não passou", () => {
    const passos = caminhoPorNo([
      { no: "A cada 5 minutos", estado: "success", vezes: 1 },
      { no: "Ler pendentes", estado: "error", vezes: 2 },
    ]);
    expect(passos.get("A cada 5 minutos")).toMatchObject({ estado: "success", ordem: 1 });
    expect(passos.get("Ler pendentes")).toMatchObject({ estado: "error", ordem: 2, vezes: 2 });
    expect(passos.has("Responder")).toBe(false);
  });
});

describe("central de automações: contrato do banco", () => {
  it("tabelas com RLS e sem acesso direto do navegador", () => {
    for (const t of ["automacao_fluxos", "automacao_execucoes", "automacao_saude", "automacao_coletas", "automacao_acoes"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
    }
    expect(sql).not.toMatch(/CREATE POLICY/);
  });

  it("leitura só da equipe; botão só para admin; poda só do servidor", () => {
    expect(sql).toContain("public.is_staff(_uid)");
    expect(sql).toContain("public.has_role(_uid, 'admin'::public.app_role)");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.automacoes_podar(integer) TO service_role;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.automacoes_podar(integer) FROM PUBLIC, anon, authenticated;");
  });

  it("não guarda segredo nem corpo de execução", () => {
    expect(sql).not.toMatch(/api_key|apikey|senha|token\s+text/i);
    expect(sql).toContain("caminho jsonb");
  });

  it("migration no manifesto e na baseline de produção", () => {
    const manifesto = readFileSync(resolve(raiz, "supabase/migration-manifest.sha256"), "utf8");
    const baseline = readFileSync(resolve(raiz, "supabase/production-migration-baseline.json"), "utf8");
    expect(manifesto).toContain("20261119180000_central_de_automacoes.sql");
    expect(baseline).toContain("20261119180000");
  });
});

describe("central de automações: pastas da Aceleriq e de clientes", () => {
  const p = normalizarPainel({
    ...BRUTO,
    fluxos: [
      ...BRUTO.fluxos,
      { id: "dk1", nome: "Grupos DK · 02 Motor de disparo", grupo: "Grupos DK", ativo: true, total_24h: 27, erros_24h: 0, gatilhos: [], efeito_no_cliente: true, client_id: "c-dk", cliente: "Vip DK", ultima_execucao: { id: 3, status: "success", inicio: "2026-11-19T12:00:00Z" } },
      { id: "dk2", nome: "Grupos DK · 01 Captura (reserva)", grupo: "Grupos DK", ativo: false, total_24h: 0, erros_24h: 0, gatilhos: [], efeito_no_cliente: true, client_id: "c-dk", cliente: "Vip DK" },
      { id: "st1", nome: "Stop: cupom", grupo: "Outros", ativo: true, total_24h: 1, erros_24h: 1, gatilhos: [], efeito_no_cliente: true, client_id: "c-stop", cliente: "Stop Informatica" },
    ],
  });

  it("fluxo com cliente sai das pastas da Aceleriq e entra na pasta do cliente", () => {
    const aceleriq = pastasDaAceleriq(p.fluxos);
    expect(aceleriq.flatMap((x) => x.fluxos.map((f) => f.id))).not.toContain("dk1");
    expect(aceleriq.map((x) => x.titulo)).toEqual(["Clientes", "Comercial (Rafael)", "Apoio (não desligar)", "Temporários"]);
    const clientes = pastasDeClientes(p.fluxos);
    expect(clientes.map((x) => x.titulo)).toEqual(["Stop Informatica", "Vip DK"]);
    expect(clientes[1]).toMatchObject({ ligados: 1, rodadas24h: 27, ultimaEm: "2026-11-19T12:00:00Z" });
    expect(clientes[0].erros24h).toBe(1);
  });

  it("a ficha do cliente vê só os fluxos dele, ligados primeiro", () => {
    expect(fluxosDoCliente(p.fluxos, "c-dk").map((f) => f.id)).toEqual(["dk1", "dk2"]);
    expect(fluxosDoCliente(p.fluxos, "c-nada")).toEqual([]);
  });
});
