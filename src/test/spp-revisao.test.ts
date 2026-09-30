import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dadosDoNo, metodoDaMensagem } from "../../supabase/functions/mesa-foto/canvas-regras";
import { aplicarRespostaDoAgente, normalizarRespostaDoAgente, type Canvas } from "@/components/mesa-foto/canvasApi";
import { AGENTES_COM_SUPERPODERES, agenteComSuperpoderes } from "../../supabase/functions/_shared/superpoderes-catalogo";

/**
 * Frente SPP, revisão de 30/09/2026: o que a revisão achou sem método (montar
 * contexto, escritor dos rituais, plano igual, campanha da Mesa Foto, refino
 * do Estúdio, bio e destaques das Redes, agente do Canvas), a Central sem
 * fechar o método, o anexo da conversa da proposta do Mês jogado fora, o Jev
 * esperando sozinho no lançador e na Central e o "Uso em 30 dias" cego para a
 * cadeia antiga.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const ANEXO = { tipo: "metodo_usado", ids: ["prova", "entender"], fonte: "declarado", caminho: "pequeno", prova: "ok", versao: "2026-09-30.1" };

describe("agentes novos no catálogo", () => {
  it("cada geração que faltava tem agente, com a prova e a escolha certa", () => {
    const esperados: Record<string, { funcao: string; escolha: "jev" | "codigo" }> = {
      "contexto.montar": { funcao: "agente-contexto", escolha: "codigo" },
      "rituais.escritor": { funcao: "ritual-writer", escolha: "codigo" },
      "perfis.plano": { funcao: "perfis-instagram", escolha: "codigo" },
      "foto.campanha": { funcao: "mesa-foto", escolha: "codigo" },
      "foto.canvas": { funcao: "mesa-foto", escolha: "jev" },
      "estudio.refino": { funcao: "estudio-arte", escolha: "codigo" },
      "instagram.geracao": { funcao: "mesa-instagram", escolha: "codigo" },
    };
    for (const [id, e] of Object.entries(esperados)) {
      const a = agenteComSuperpoderes(id);
      expect(a, id).not.toBeNull();
      expect(a!.funcao, id).toBe(e.funcao);
      expect(a!.escolha, id).toBe(e.escolha);
      expect(a!.metodos, id).toContain("prova");
    }
    // O Canvas conversa: entender, receber, causa e prova (sem laço de correção, sem plano de lote).
    expect(agenteComSuperpoderes("foto.canvas")!.metodos.slice().sort()).toEqual(["causa", "entender", "prova", "receber"]);
    expect(agenteComSuperpoderes("estudio.refino")!.metodos.slice().sort()).toEqual(["prova", "receber"]);
    expect(new Set(AGENTES_COM_SUPERPODERES.map((a) => a.id)).size).toBe(AGENTES_COM_SUPERPODERES.length);
  });
});

describe("Canvas da Mesa Foto: a linha 'Método:' fica com a resposta do agente", () => {
  it("o servidor guarda só o anexo do método conferido, e só na mensagem do agente", () => {
    const d = dadosDoNo("agente", {
      pedido: "ela segurando o produto",
      mensagens: [
        { papel: "usuario", texto: "quero UGC", metodo: ANEXO },
        { papel: "agente", texto: "Escrevi o pedido.", metodo: { ...ANEXO, ids: ["prova", "entender", "<script>"], extra: "fora" } },
        { papel: "agente", texto: "Outra.", metodo: { tipo: "outro" } },
      ],
    }) as { mensagens: Array<Record<string, unknown>> };
    expect(d.mensagens[0]).toEqual({ papel: "usuario", texto: "quero UGC" });
    expect(d.mensagens[1].metodo).toEqual({ tipo: "metodo_usado", ids: ["prova", "entender"], fonte: "declarado", caminho: "pequeno", prova: "ok", versao: "2026-09-30.1" });
    expect(d.mensagens[2]).toEqual({ papel: "agente", texto: "Outra." });
    expect(metodoDaMensagem(null)).toBeNull();
    expect(metodoDaMensagem({ tipo: "metodo_usado", ids: [], prova: "nao_se_aplica" })).toBeNull();
    expect(metodoDaMensagem({ tipo: "metodo_usado", ids: [], prova: "faltou" })!.prova).toBe("faltou");
  });

  it("a tela recebe o anexo na resposta e guarda na mensagem do agente", () => {
    const r = normalizarRespostaDoAgente({ resposta: "Certo.", pedido: "cena", metodo: ANEXO });
    expect(r.metodo).toEqual(ANEXO);
    expect(normalizarRespostaDoAgente({ resposta: "Certo.", metodo: { tipo: "x" } })).not.toHaveProperty("metodo");
    const canvas = { id: "c1", nome: "C", nos: [{ id: "a1", tipo: "agente", x: 0, y: 0, dados: { mensagens: [] } }], ligacoes: [] } as unknown as Canvas;
    const novo = aplicarRespostaDoAgente(canvas, "a1", "quero UGC", r);
    const mensagens = (novo.nos[0].dados as unknown as { mensagens: Array<Record<string, unknown>> }).mensagens;
    expect(mensagens[0]).toEqual({ papel: "usuario", texto: "quero UGC" });
    expect(mensagens[1]).toEqual({ papel: "agente", texto: "Certo.", metodo: ANEXO });
    const tela = ler("src/components/mesa-foto/canvas/Agente.tsx");
    expect(tela).toContain('import MetodoDoAgente from "@/components/agentes/MetodoDoAgente";');
    expect(tela).toContain("<MetodoDoAgente anexos={[msg.metodo]} />");
  });
});

describe("Mês: a conversa da proposta mostra o 'Método:'", () => {
  it("o anexo vai gravado com a mensagem do agente e na resposta; a tela lê e mostra", () => {
    const servidor = ler("supabase/functions/agente-calendario/index.ts");
    expect(servidor).toContain("{ papel: \"agente\", conteudo: resposta, uso_id: saida.usoId, anexos: fechado.anexo ? [fechado.anexo] : undefined },");
    expect(servidor).toContain("return json({ proposta: atualizada, resposta, metodo: fechado.anexo,");
    const tela = ler("src/components/mesa/AbaMes.tsx");
    expect(tela).toContain('.select("id, papel, conteudo, criado_em, anexos")');
    expect(tela).toContain("anexos: data?.metodo ? [data.metodo] : []");
    expect(tela).toContain('{m.papel === "agente" && <MetodoDoAgente anexos={m.anexos} />}');
  });
});

describe("Central: o método fecha a resposta e a linha 'Método:' aparece", () => {
  const central = ler("supabase/functions/agente-central/index.ts");
  it("preparar e aplicar chamam fecharComMetodo com o uso (ou null na reserva) e a ação feita de verdade", () => {
    const preparar = central.slice(central.indexOf("async function acaoPreparar("), central.indexOf("async function acaoAplicar("));
    expect(preparar).toContain("fecharComMetodo(servicoDoMetodo(), {");
    expect(preparar).toContain("usoId: r.usoId,");
    expect(preparar).toContain("acaoFeita: !!dossie && versao !== dossie.version,");
    expect(preparar).toContain("comAnexoDoMetodo(anexosDoAprendizado(null, regrasSeguidas(r.dados.regras_seguidas, regras)), fechado.anexo)");
    const aplicar = central.slice(central.indexOf("async function acaoAplicar("), central.indexOf("async function acaoReescrever("));
    expect(aplicar).toContain("fecharComMetodo(servicoDoMetodo(), {");
    expect(aplicar).toContain("acaoFeita: (!!dossie && versao !== dossie.version) || diarioGravado || cerebro.some((c) => !c.erro),");
    expect(aplicar).toContain("comAnexoDoMetodo(anexosDoAprendizado(await aprendizado, seguidas), fechado.anexo)");
  });

  it("o Jev do método corre junto com as regras (não espera sozinho antes do modelo)", () => {
    const aplicar = central.slice(central.indexOf("async function acaoAplicar("), central.indexOf("async function acaoReescrever("));
    const inicioDoJev = aplicar.indexOf("const spAplicarP = temResposta ? superpoderesPara(db,");
    const regras = aplicar.indexOf("const regras = await regrasDaCentral(db, clientId);");
    expect(inicioDoJev).toBeGreaterThan(0);
    expect(inicioDoJev).toBeLessThan(regras);
    expect(aplicar).not.toContain("const spAplicar = await superpoderesPara(");
  });
});

describe("Assistente geral: o Jev do método corre junto com o pré-contexto", () => {
  it("a promessa nasce antes do Promise.all do pré-contexto e só é esperada ao montar o sistema", () => {
    const lancador = ler("supabase/functions/voice-assistant-agent/index.ts");
    const promessa = lancador.indexOf('const spAgirP = agir ? superpoderesPara(supabase, { agente: "assistente.lancador", pedido: body.text }) : Promise.resolve(null);');
    const pre = lancador.indexOf("const [preContexto, dadosDoLancador] = await Promise.all([");
    const espera = lancador.indexOf("const spAgir = await spAgirP;");
    expect(promessa).toBeGreaterThan(0);
    expect(promessa).toBeLessThan(pre);
    expect(espera).toBeGreaterThan(pre);
    expect(lancador).not.toContain("agir ? await superpoderesPara(");
  });
});

describe("'Uso em 30 dias' enxerga a cadeia antiga e a reserva", () => {
  const sql = ler("supabase/migrations/20260930295000_superpoderes_das_mesas.sql");
  it("tabela leve só do servidor, RPC com a checagem e o resumo somando as duas fontes", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.superpoderes_usos_sem_ia (");
    expect(sql).toContain("ALTER TABLE public.superpoderes_usos_sem_ia ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.superpoderes_usos_sem_ia FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/CREATE POLICY[^;]*superpoderes_usos_sem_ia/);
    const rpc = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.superpoderes_registrar_sem_uso("), sql.indexOf("-- 5. Auditoria do método"));
    expect(rpc).toContain("SECURITY DEFINER");
    expect(rpc).toContain("SET search_path TO ''");
    expect(rpc).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");
    expect(rpc).toContain("NOT COALESCE(public.is_staff(auth.uid()), false)");
    expect(rpc).toContain("NOT public.can_access_client(_client_id)");
    expect(rpc).toContain("REVOKE ALL ON FUNCTION public.superpoderes_registrar_sem_uso(text, text[], text, text, text, uuid) FROM PUBLIC, anon;");
    const resumo = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.superpoderes_resumo("));
    expect(resumo).toContain("FROM public.ia_usos AS u");
    expect(resumo).toContain("UNION ALL");
    expect(resumo).toContain("FROM public.superpoderes_usos_sem_ia AS s");
    expect(resumo).toContain("(_admin OR (x.cliente IS NOT NULL AND public.can_access_client(x.cliente)))");
  });

  it("quem não grava em ia_usos registra o método sem uso", () => {
    expect(ler("supabase/functions/_shared/superpoderes.ts")).toContain('db.rpc("superpoderes_registrar_sem_uso", {');
    expect(ler("supabase/functions/workspace-agent/index.ts")).toContain("acaoFeita: false, clientId: safeClientId });");
    expect(ler("supabase/functions/voice-assistant-agent/index.ts")).toContain("clientId: body.clientId || null });");
    expect(ler("supabase/functions/cycle-coach/index.ts")).toContain("registrarMetodoSemUso(db, { metodo: metodoDoCoach, clientId: null });");
    expect(ler("supabase/functions/radar-ideas/index.ts")).toContain("registrarMetodoSemUso(db, { metodo: metodoDoRadar, clientId });");
    expect(ler("supabase/functions/esteira-semana/index.ts")).toContain("if (escrito && !escrito.usoId) void registrarMetodoSemUso(db, { metodo: metodoDaEsteira, clientId });");
    expect(ler("supabase/functions/ritual-writer/index.ts")).toContain("if (escrito && !escrito.uso_id) void registrarMetodoSemUso(admin, { metodo: metodoDoRitual, clientId: clientId || null });");
  });
});
