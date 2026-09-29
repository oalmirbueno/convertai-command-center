/**
 * Frente BRF: decupagem de ponta a ponta com banco e Jev falsos (deno test).
 * Confere: uma decupagem por envio (o Jev não roda duas vezes), a marca que
 * não é a principal recebe as sugestões só no contexto dela, Confirmar grava
 * e Desfazer volta, e Jev fora do ar deixa só a regra do modelo com o aviso.
 *
 *   npx --yes deno test -A supabase/functions/briefing-agente/decupar_test.ts
 */

import { aplicarDecupagem, decuparBriefing, desfazerDecupagem } from "../_shared/briefing-decupar.ts";
import { MODELOS_DE_FABRICA } from "../_shared/briefing-modelos.ts";

function igual(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n  esperado: ${y}\n  veio:     ${x}`);
}
function certo(v: unknown, msg: string) {
  if (!v) throw new Error(msg);
}

type Linha = Record<string, unknown>;

/** Banco falso: o suficiente do PostgREST que o executor usa. */
function bancoFalso(tabelas: Record<string, Linha[]>) {
  let seq = 0;
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let dados: Linha | Linha[] | null = null;
    let conflito = "";
    let umSo: "nao" | "talvez" | "sim" = "nao";
    let ordem: { col: string; asc: boolean } | null = null;
    let limite = 0;
    const b: Record<string, unknown> = {};
    const rodar = () => {
      const linhas = (tabelas[tabela] ||= []);
      if (op === "insert" && Array.isArray(dados)) {
        const novas = (dados as Linha[]).map((d) => ({ id: `id-${++seq}`, ...d }));
        linhas.push(...novas);
        return { data: novas, error: null };
      }
      if (op === "insert") {
        const nova: Linha = { id: `id-${++seq}`, criado_em: new Date().toISOString(), tentativas: 0, ...(dados as Linha) };
        if (tabela === "briefing_decupagens" && linhas.some((l) => l.briefing_id === nova.briefing_id && l.envio === nova.envio)) {
          return { data: null, error: { code: "23505", message: "duplicada" } };
        }
        linhas.push(nova);
        return { data: nova, error: null };
      }
      if (op === "upsert") {
        const d = dados as Linha;
        const alvo = linhas.find((l) => l[conflito] === d[conflito]);
        if (alvo) Object.assign(alvo, d);
        else linhas.push({ ...d });
        return { data: null, error: null };
      }
      let achadas = linhas.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        achadas.forEach((l) => Object.assign(l, dados as Linha));
        return { data: achadas.map((l) => ({ id: l.id })), error: null };
      }
      if (ordem) {
        const { col, asc } = ordem;
        achadas = achadas.slice().sort((p, q) => (Number(p[col]) - Number(q[col])) * (asc ? 1 : -1));
      }
      if (limite) achadas = achadas.slice(0, limite);
      if (umSo !== "nao") return { data: achadas[0] ? { ...achadas[0] } : null, error: null };
      return { data: achadas.map((l) => ({ ...l })), error: null };
    };
    Object.assign(b, {
      select: () => b,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), b),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), b),
      order: (col: string, o: { ascending?: boolean } = {}) => ((ordem = { col, asc: o.ascending !== false }), b),
      limit: (n: number) => ((limite = n), b),
      maybeSingle: () => ((umSo = "talvez"), b),
      single: () => ((umSo = "sim"), b),
      insert: (d: Linha | Linha[]) => ((op = "insert"), (dados = d), b),
      update: (d: Linha) => ((op = "update"), (dados = d), b),
      upsert: (d: Linha, o: { onConflict: string }) => ((op = "upsert"), (dados = d), (conflito = o.onConflict), b),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve().then(rodar).then(ok, erro),
    });
    return b;
  };
  return { from } as unknown as Parameters<typeof decuparBriefing>[0];
}

const respostas = {
  empresa: "Clube Farol",
  historia: "Somos um clube de corrida de rua. Queremos crescer para outras cidades no próximo ano.",
  produtos: "Treinos em grupo e assessoria de corrida.",
  perfilDoCliente: "Adultos de 25 a 45 anos que querem começar a correr.",
  dorDoCliente: "Medo de se machucar correndo sozinho.",
  naoQuer: "Nada que pareça academia de musculação.",
  referencias: [{ link: "https://exemplo.com.br", nota: "energia" }],
  eixoSerio: 5,
};

function cenario() {
  return {
    briefings: [{
      id: "b1", client_id: "c1", marca_id: "m2", modelo: "identidade", modelo_conteudo: MODELOS_DE_FABRICA.identidade, responses: respostas,
      submitted: true, envios: 1, enviado_em: "2026-09-30T12:00:00Z", criado_por: "u1",
    }],
    briefing_decupagens: [{ id: "d1", briefing_id: "b1", client_id: "c1", marca_id: "m2", envio: 1, status: "pendente", tentativas: 0, criado_em: "2026-09-30T12:00:01Z" }],
    briefing_anexos: [],
    cliente_marcas: [
      { id: "m1", client_id: "c1", nome: "Clube", principal: true, contexto: { publico: "do cliente" } },
      { id: "m2", client_id: "c1", nome: "Farol Kids", principal: false, contexto: { negocio: "Corrida infantil" } },
    ],
    cliente_kit_marca: [{ client_id: "c1", contexto: { publico: "Público do kit do cliente" } }],
  } as Record<string, Linha[]>;
}

const jevFalso = (contador: { n: number }) => async ({ questions }: { questions: Record<string, unknown> }) => {
  contador.n += 1;
  const answers: Record<string, unknown> = {};
  Object.keys(questions).forEach((id) => {
    if (id.startsWith("t")) answers[id] = { choice: "objetivo", confidence: 0.9, probabilities: { objetivo: 0.9 } };
    if (id.startsWith("k")) answers[id] = { noul: 0.2 };
  });
  answers.tom = { choice: "inspirador", confidence: 0.8 };
  return { answers, usage: { input_tokens: 100, output_tokens: 10 }, modelo: "jev-teste" } as never;
};

Deno.test("decupa uma vez por envio, com o Jev falso, e manda a sugestão para a marca certa", async () => {
  const t = cenario();
  const db = bancoFalso(t);
  const cont = { n: 0 };
  const r = await decuparBriefing(db, "b1", { perguntar: jevFalso(cont) });
  igual(r.decupagem?.status, "pronta", "status");
  igual(cont.n, 1, "Jev chamado uma vez");
  const d = r.decupagem!;
  igual(d.destino, { tipo: "marca", marca_id: "m2", marca_nome: "Farol Kids" }, "destino é a marca que não é a principal");
  igual(d.tom_de_voz, "Inspirador e enérgico", "tom do Jev");
  const itens = d.itens as Array<{ categoria: string; texto: string }>;
  certo(itens.some((i) => i.categoria === "objetivo" && /crescer para outras cidades/.test(i.texto)), "trecho do Jev entrou como objetivo");
  certo(itens.some((i) => i.categoria === "restricao" && /academia/.test(i.texto)), "restrição pela regra do modelo");
  const publico = d.sugestoes.find((s) => s.campo === "publico")!;
  igual(publico.modo, "preencher", "a marca não herda o público do cliente");
  const negocio = d.sugestoes.find((s) => s.campo === "negocio")!;
  igual(negocio.antes, "Corrida infantil", "antes vem do contexto da marca");

  // A troca do agente do briefing ficou na conversa do briefing.
  igual(t.agente_conversas?.[0]?.agente, "briefing", "conversa do agente do briefing");
  certo(t.agente_mensagens?.some((m) => m.papel === "agente" && /Separei/.test(String(m.conteudo))), "resposta do agente gravada");

  // Segunda chamada: devolve a pronta, sem rodar o Jev de novo.
  const r2 = await decuparBriefing(db, "b1", { perguntar: jevFalso(cont) });
  igual(r2.decupagem?.id, d.id, "mesma decupagem");
  igual(cont.n, 1, "Jev não roda duas vezes");
});

Deno.test("Confirmar grava só no contexto da marca; Desfazer volta", async () => {
  const t = cenario();
  const db = bancoFalso(t);
  const r = await decuparBriefing(db, "b1", { perguntar: jevFalso({ n: 0 }) });
  const d = r.decupagem!;
  await aplicarDecupagem(db, d.id, ["publico", "negocio"], "u9");
  const marca = t.cliente_marcas.find((m) => m.id === "m2")!;
  igual((marca.contexto as Linha).publico, "Adultos de 25 a 45 anos que querem começar a correr.", "público gravado na marca");
  igual((t.cliente_kit_marca[0].contexto as Linha).publico, "Público do kit do cliente", "kit do cliente intacto");
  igual(t.briefing_decupagens[0].status, "aplicada", "status aplicada");
  // Confirmar de novo é recusado (uma confirmação só).
  let recusou = false;
  try {
    await aplicarDecupagem(db, d.id, ["publico"], "u9");
  } catch {
    recusou = true;
  }
  certo(recusou, "segundo Confirmar recusado");
  const volta = await desfazerDecupagem(db, d.id, "u9");
  igual(volta.voltaram.sort(), ["negocio", "publico"], "os dois voltaram");
  igual((marca.contexto as Linha).negocio, "Corrida infantil", "negócio voltou");
  certo(!("publico" in (marca.contexto as Linha)), "público que não existia saiu");
  igual(t.briefing_decupagens[0].status, "desfeita", "status desfeita");
});

Deno.test("Jev fora do ar: fica só a regra do modelo, com aviso, e o briefing não enviado não decupa", async () => {
  const t = cenario();
  const db = bancoFalso(t);
  const r = await decuparBriefing(db, "b1", { perguntar: () => Promise.reject(new Error("fora do ar")) });
  igual(r.decupagem?.status, "pronta", "status");
  certo(typeof r.decupagem?.erro === "string" && /Jev não respondeu/.test(r.decupagem!.erro!), "aviso do Jev");
  certo((r.decupagem!.itens as Array<{ fonte: string }>).every((i) => i.fonte === "regra"), "só regra");

  const t2 = cenario();
  (t2.briefings[0] as Linha).submitted = false;
  const r2 = await decuparBriefing(bancoFalso(t2), "b1", { perguntar: jevFalso({ n: 0 }) });
  igual(r2.motivo, "nao_enviado", "não decupa antes do envio");
});
