import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { funcoesRepetidas, normalizarFuncao } from "@/lib/escritorio/funcaoRepetida";
import { comQuem, idsLidosPor, linhasDasConversas, naoLidasPorConversa, ordenarConversas, totalDeNaoLidas, trecho } from "@/lib/escritorio/conversas";
import { JANELA_DA_PRESENCA_MS, fazendoAgora, presenteAgora, ultimaAtividade } from "@/lib/escritorio/presenca";
import { filtrarAutomacoes } from "@/lib/escritorio/automacoes";
import { bloqueiosAbertos, credenciaisPorAgente, mensagemDoErroDoEscritorio } from "@/lib/escritorio/acessos";
import { GRAUS, nomeDoGrau, type Conversa, type Leitura, type Mensagem } from "@/lib/escritorio/tipos";
import { ORIGENS, classeDaOrigem, nomeDaOrigem } from "@/lib/hierarquiaDosAgentes";
import { areaDaRota, ROTULOS_DAS_AREAS } from "@/lib/cronometro/motor";
import { rotuloDoLugar } from "@/lib/navegacao/lugares";
import { rotuloDoLink } from "@/lib/avisos/rotulos";

/**
 * 18/11/2026: Escritório dos agentes (tela /escritorio). As contas sem tela:
 * função repetida, não lidas do dono, presença, última atividade, filtro das
 * automações e credenciais por agente. E os pontos onde a área nova se registra.
 */

const AGORA = Date.parse("2026-11-18T18:00:00Z");
const haMin = (min: number) => new Date(AGORA - min * 60_000).toISOString();
const agente = (slug: string, role: string, area: string | null, status = "active") => ({ slug, display_name: slug.charAt(0).toUpperCase() + slug.slice(1), role, area, status });

describe("função repetida", () => {
  it("normaliza: minúsculo, sem acento, sem espaço sobrando", () => {
    expect(normalizarFuncao("  Social   MÉDIA ")).toBe("social media");
    expect(normalizarFuncao("Tráfego  Pago")).toBe("trafego pago");
    expect(normalizarFuncao(null)).toBe("");
  });

  it("junta os ativos da mesma área com a mesma função, mesmo escrita de outro jeito", () => {
    const grupos = funcoesRepetidas([
      agente("lia", "Social Media", "Conteúdo"),
      agente("orion", "  social   média", "conteudo "),
      agente("trafe", "Tráfego pago", "Tráfego"),
      agente("vigia", "Vigia de anúncios", "Tráfego"),
      agente("nina", "SOCIAL MEDIA", "Conteúdo"),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].area).toBe("Conteúdo");
    expect(grupos[0].funcao).toBe("Social Media");
    expect(grupos[0].agentes.map((a) => a.slug)).toEqual(["lia", "orion", "nina"]);
  });

  it("pausado, aposentado e excluído não contam; mesma função em área diferente não é repetição", () => {
    expect(funcoesRepetidas([
      agente("a", "Revisor", "Vídeo"),
      agente("b", "Revisor", "Vídeo", "paused"),
      agente("c", "Revisor", "Vídeo", "retired"),
      agente("d", "Revisor", "Vídeo", "inactive"),
      agente("e", "Revisor", "Conteúdo"),
    ])).toEqual([]);
  });

  it("sem área também compara entre si; função vazia nunca é repetição", () => {
    const grupos = funcoesRepetidas([agente("a", "Suporte", null), agente("b", "suporte", ""), agente("c", "", null), agente("d", " ", null)]);
    expect(grupos.map((g) => [g.area, g.agentes.map((x) => x.slug)])).toEqual([[null, ["a", "b"]]]);
  });
});

const msg = (id: string, conversa_id: string, de_slug: string, min: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  id, conversa_id, de_slug, de_tipo: de_slug === "dono" ? "humano" : "operador", para_slug: null, grupo_id: null, corpo: `recado ${id}`, responde_a: null, created_at: haMin(min), ...extra,
});

describe("não lidas do dono", () => {
  const mensagens = [
    msg("m1", "c1", "jori", 50, { para_slug: "dono" }),
    msg("m2", "c1", "dono", 40, { para_slug: "jori" }),
    msg("m3", "c1", "jori", 30, { para_slug: "dono" }),
    msg("m4", "c2", "lia", 20, { grupo_id: "g1" }),
    msg("m5", "c2", "orion", 10, { grupo_id: "g1" }),
    msg("m6", "c3", "dono", 5, { para_slug: "trafe" }),
  ];
  const leituras: Leitura[] = [
    { mensagem_id: "m1", leitor_slug: "dono" },
    { mensagem_id: "m3", leitor_slug: "jori" },
    { mensagem_id: "m4", leitor_slug: "orion" },
    { mensagem_id: "m5", leitor_slug: "dono" },
  ];

  it("conta o que não é do dono e não tem a leitura do dono; leitura de outro agente não vale", () => {
    expect(idsLidosPor(leituras)).toEqual(new Set(["m1", "m5"]));
    const porConversa = naoLidasPorConversa(mensagens, leituras);
    expect(porConversa.get("c1")).toBe(1);
    expect(porConversa.get("c2")).toBe(1);
    expect(porConversa.has("c3")).toBe(false);
    expect(totalDeNaoLidas(mensagens, leituras)).toBe(2);
    expect(totalDeNaoLidas(mensagens, [])).toBe(4);
    expect(totalDeNaoLidas([], leituras)).toBe(0);
  });

  it("a lista vem da mais recente para a mais antiga, com quem é, o último recado e as não lidas", () => {
    const conversas: Conversa[] = [
      { id: "c1", tipo: "direta", grupo_id: null, assunto: "Prioridade do dia", criada_por: "jori", created_at: haMin(50), ultima_em: haMin(30) },
      { id: "c2", tipo: "grupo", grupo_id: "g1", assunto: null, criada_por: "lia", created_at: haMin(20), ultima_em: haMin(10) },
      { id: "c3", tipo: "direta", grupo_id: null, assunto: " ", criada_por: "dono", created_at: haMin(5), ultima_em: haMin(5) },
      { id: "c4", tipo: "direta", grupo_id: null, assunto: null, criada_por: "atlas", created_at: haMin(90), ultima_em: haMin(90) },
    ];
    const nomes: Record<string, string> = { dono: "Você", jori: "Jori", lia: "Lia", orion: "Orion", trafe: "Trafe", atlas: "Atlas" };
    const linhas = linhasDasConversas(conversas, mensagens, leituras, (s) => nomes[s] ?? s, [{ id: "g1", nome: "Conteúdo" }]);
    expect(linhas.map((l) => l.id)).toEqual(["c3", "c2", "c1", "c4"]);
    expect(linhas.map((l) => l.titulo)).toEqual(["Trafe", "Conteúdo", "Jori", "Atlas"]);
    expect(linhas.map((l) => l.naoLidas)).toEqual([0, 1, 1, 0]);
    expect(linhas[1].ultimo).toBe("Orion: recado m5");
    expect(linhas[2].assunto).toBe("Prioridade do dia");
    expect(linhas[0].assunto).toBeNull();
    expect(linhas[3].ultimo).toBe("");
    expect(ordenarConversas(conversas)[0].id).toBe("c3");
  });

  it("conversa entre dois agentes mostra os dois; o recado longo é cortado numa linha", () => {
    const entreAgentes = [msg("x1", "c9", "lia", 3, { para_slug: "orion" }), msg("x2", "c9", "orion", 2, { para_slug: "lia" })];
    expect(comQuem({ tipo: "direta", grupo_id: null, criada_por: "lia" }, entreAgentes, (s) => s.toUpperCase(), [])).toBe("LIA e ORION");
    expect(comQuem({ tipo: "grupo", grupo_id: "sumiu", criada_por: "lia" }, [], (s) => s, [])).toBe("Sala");
    expect(trecho("linha um\n\n  linha   dois")).toBe("linha um linha dois");
    const longo = trecho("a".repeat(200), 20);
    expect(longo).toHaveLength(20);
    expect(longo.endsWith("…")).toBe(true);
  });
});

describe("presença e última atividade", () => {
  it("está aqui agora com batimento de menos de 10 minutos", () => {
    expect(JANELA_DA_PRESENCA_MS).toBe(600_000);
    expect(presenteAgora(haMin(0), AGORA)).toBe(true);
    expect(presenteAgora(haMin(9.9), AGORA)).toBe(true);
    expect(presenteAgora(haMin(10), AGORA)).toBe(false);
    expect(presenteAgora(haMin(300), AGORA)).toBe(false);
    expect(presenteAgora(null, AGORA)).toBe(false);
    expect(presenteAgora("não é data", AGORA)).toBe(false);
  });

  it("o que está fazendo só vale com o batimento fresco", () => {
    const p = { operator_slug: "lia", batimento_em: haMin(2), fazendo: "  Montando o calendário da Acerbi ", plataforma: "hermes" };
    expect(fazendoAgora(p, AGORA)).toBe("Montando o calendário da Acerbi");
    expect(fazendoAgora({ ...p, batimento_em: haMin(11) }, AGORA)).toBeNull();
    expect(fazendoAgora({ ...p, fazendo: null }, AGORA)).toBeNull();
    expect(fazendoAgora(undefined, AGORA)).toBeNull();
  });

  it("a última atividade é o mais recente entre a última execução e o batimento", () => {
    expect(ultimaAtividade(haMin(120), haMin(3))).toBe(haMin(3));
    expect(ultimaAtividade(haMin(1), haMin(30))).toBe(haMin(1));
    expect(ultimaAtividade(null, haMin(30))).toBe(haMin(30));
    expect(ultimaAtividade(haMin(45), undefined)).toBe(haMin(45));
    expect(ultimaAtividade(null, null)).toBeNull();
    expect(ultimaAtividade("torto", haMin(7))).toBe(haMin(7));
  });
});

describe("automações e acessos", () => {
  it("filtro: só com erro e nunca rodou", () => {
    const lista = [
      { id: "a", ultimo_status: "ok" as const, ultima_execucao_em: haMin(5) },
      { id: "b", ultimo_status: "erro" as const, ultima_execucao_em: haMin(9) },
      { id: "c", ultimo_status: null, ultima_execucao_em: null },
    ];
    expect(filtrarAutomacoes(lista, "todas").map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(filtrarAutomacoes(lista, "erro").map((a) => a.id)).toEqual(["b"]);
    expect(filtrarAutomacoes(lista, "nunca").map((a) => a.id)).toEqual(["c"]);
  });

  it("credenciais por agente: a chave vem com nome e prévia; conector e chave que a tela não lê ficam pelo vínculo", () => {
    const k1 = "27901254-b463-4f6c-8c39-92bd1884a250";
    const mapa = credenciaisPorAgente(
      [
        { principal: `key:${k1}`, operator_slug: "jori", padrao: true, rotulo: "ligada no Escritório" },
        { principal: "oauth:e1428bc0-2223-413a-8df1-f595f3cf3acd", operator_slug: "jori", padrao: false, rotulo: "ChatGPT do Almir" },
        { principal: "key:99999999-0000-0000-0000-000000000000", operator_slug: "lia", padrao: false, rotulo: null },
      ],
      [{ id: k1, name: "Jori no Grok", key_preview: "ak_1a2b", audience: "mcp", is_active: false }],
    );
    expect(mapa.get("jori")).toEqual([
      { principal: `key:${k1}`, tipo: "chave", nome: "Jori no Grok", previa: "ak_1a2b", padrao: true, desligada: true },
      { principal: "oauth:e1428bc0-2223-413a-8df1-f595f3cf3acd", tipo: "conector", nome: "ChatGPT do Almir", previa: null, padrao: false, desligada: false },
    ]);
    expect(mapa.get("lia")?.[0]).toMatchObject({ tipo: "chave", nome: "Chave 99999999", previa: null });
    expect(mapa.has("orion")).toBe(false);
  });

  it("bloqueio aberto é o que ainda não foi desfeito; erro do banco vira frase", () => {
    const abertos = bloqueiosAbertos([
      { operator_slug: "lia", motivo: "antigo", bloqueado_em: haMin(500), desfeito_em: haMin(400) },
      { operator_slug: "lia", motivo: "respondeu cliente sem aprovação", bloqueado_em: haMin(30), desfeito_em: null },
      { operator_slug: "orion", motivo: null, bloqueado_em: haMin(90), desfeito_em: haMin(80) },
    ]);
    expect([...abertos.keys()]).toEqual(["lia"]);
    expect(abertos.get("lia")?.motivo).toBe("respondeu cliente sem aprovação");
    expect(mensagemDoErroDoEscritorio({ message: "so_o_dono" })).toBe("Só o dono faz isso.");
    expect(mensagemDoErroDoEscritorio({ message: "sem_bloqueio_aberto" })).toBe("Este agente não está bloqueado.");
    expect(mensagemDoErroDoEscritorio(null, "Não foi possível enviar.")).toBe("Não foi possível enviar.");
  });

  it("os quatro graus do banco têm nome; grau desconhecido cai em executor", () => {
    expect(GRAUS.map((g) => g.valor)).toEqual(["orquestrador", "coordenador", "executor", "leitor"]);
    expect(nomeDoGrau("leitor")).toBe("Leitor");
    expect(nomeDoGrau(null)).toBe("Executor");
  });
});

describe("a área nova está registrada onde uma área precisa estar", () => {
  const ler = (caminho: string) => readFileSync(resolve(__dirname, "..", caminho), "utf8");

  it("OpenBot entrou na lista de origens (rótulo, filtro e cor saem dela)", () => {
    expect(ORIGENS.map((o) => o.valor)).toEqual(["hermes", "grok", "paperclip", "n8n", "claude_code", "codex", "chatgpt", "openbot"]);
    expect(nomeDaOrigem("openbot")).toBe("OpenBot");
    expect(classeDaOrigem("openbot")).toBe(ORIGENS[ORIGENS.length - 1].classe);
  });

  it("rota da equipe, item no menu ao lado da Execução, pré-carga, cronômetro, lugar e rótulo do aviso", () => {
    const app = ler("App.tsx");
    expect(app).toContain('const AdminEscritorio = rotas.lazy(() => import("@/pages/AdminEscritorio"));');
    expect(app).toContain('<Route path="/escritorio" element={<StaffRoute><AdminEscritorio /></StaffRoute>} />');
    const menu = ler("components/AppLayout.tsx");
    const agentes = menu.slice(menu.indexOf('label: "Agentes"'), menu.indexOf('label: "Operação da semana"'));
    expect(agentes).toContain('{ title: "Escritório", url: "/escritorio", icon: Building2 }');
    expect(agentes.indexOf('url: "/execucao"')).toBeLessThan(agentes.indexOf('url: "/escritorio"'));
    expect(agentes.indexOf('url: "/escritorio"')).toBeLessThan(agentes.indexOf('url: "/skills"'));
    expect(ler("lib/preCargaDoBoot.ts")).toContain('"/escritorio": { equipe: () => import("@/pages/AdminEscritorio") }');
    expect(areaDaRota("/escritorio")).toBe("escritorio");
    expect(ROTULOS_DAS_AREAS.escritorio).toBe("Escritório");
    expect(rotuloDoLugar("/escritorio", "")).toBe("Escritório");
    expect(rotuloDoLink("/escritorio")).toBe("Abrir no Escritório");
    expect(rotuloDoLink("/execucao?vinculo=1")).toBe("Abrir na Execução");
  });

  it("nenhum texto da área usa travessão", () => {
    const arquivos = [
      "pages/AdminEscritorio.tsx", "components/escritorio/AbaOrganograma.tsx", "components/escritorio/AbaConversas.tsx", "components/escritorio/AbaSalas.tsx",
      "components/escritorio/AbaAutomacoes.tsx", "components/escritorio/AbaAcessos.tsx", "components/escritorio/LinhaDoAgente.tsx", "components/escritorio/escritorioApi.ts",
      "lib/escritorio/tipos.ts", "lib/escritorio/acessos.ts", "lib/escritorio/conversas.ts",
      "components/escritorio/AbaRegras.tsx", "lib/escritorio/regras.ts",
    ];
    for (const arquivo of arquivos) expect(/[\u2013\u2014]/.test(ler(arquivo)), arquivo).toBe(false);
  });
});
