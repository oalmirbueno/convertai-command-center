/**
 * Editor de modelos e preferências do dono (frente CON2, 30/09/2026).
 *
 * - modelos_listar {} -> { modelos: [{ chave, tipo, servico, nome, versoes: [...], ativo }], preferencias }
 * - modelo_conferir { chave, rascunho } -> { erros, avisos, resumo, diffs } (nada grava)
 * - modelo_publicar { chave, rascunho, confirmar: true } -> { versao } (só admin; RPC que desliga a anterior)
 * - preferencias_ler {} / preferencias_salvar { extras?, avisos? } (salvar só admin)
 *
 * Versão publicada nunca muda; os contratos guardam a versão que usaram.
 * Sem travessão.
 */
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { diffDeTexto, type ModeloDeContrato } from "../_shared/contrato-modelo.ts";
import { CHAVES_DAS_EXTRAS, type ChaveDaExtra } from "./modulos/contrato-modelo-extras-v1.ts";
import { conferirRascunhoDoModelo, lerRascunhoDoModelo, resumoDaMudanca, revisaoDaVersaoNova } from "../_shared/contrato-editor.ts";
import { type Chamador, ErroHttp, garantirAdmin, json, limpo, type ModeloComEstado, type Nucleo, semTabela, servico } from "./base.ts";

export type EstadoDaExtra = "padrao_sim" | "padrao_nao" | "desligada";
export type Preferencias = {
  extras: Record<ChaveDaExtra, EstadoDaExtra>;
  avisos: { aviso_vencimento_dias: number; lembrete_assinatura_dias: number };
};

export function preferenciasPadrao(): Preferencias {
  const extras = {} as Record<ChaveDaExtra, EstadoDaExtra>;
  CHAVES_DAS_EXTRAS.forEach((k) => (extras[k] = "padrao_nao"));
  return { extras, avisos: { aviso_vencimento_dias: 30, lembrete_assinatura_dias: 3 } };
}

const inteiroEntre = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Math.floor(Number(v));
  return isFinite(n) && n >= min && n <= max ? n : padrao;
};

export function lerPreferenciasBrutas(linhas: Array<{ chave: string; valor: unknown }>): Preferencias {
  const p = preferenciasPadrao();
  for (const l of linhas) {
    const v = l.valor && typeof l.valor === "object" ? (l.valor as Record<string, unknown>) : {};
    if (l.chave === "extras") CHAVES_DAS_EXTRAS.forEach((k) => {
      if (v[k] === "padrao_sim" || v[k] === "padrao_nao" || v[k] === "desligada") p.extras[k] = v[k] as EstadoDaExtra;
    });
    if (l.chave === "avisos") {
      p.avisos.aviso_vencimento_dias = inteiroEntre(v.aviso_vencimento_dias, 5, 120, 30);
      p.avisos.lembrete_assinatura_dias = inteiroEntre(v.lembrete_assinatura_dias, 1, 30, 3);
    }
  }
  return p;
}

export async function lerPreferencias(): Promise<Preferencias> {
  const { data, error } = await servico().from("contrato_preferencias").select("chave, valor");
  if (error) {
    if (!semTabela(error)) registrarFalha("contratos: preferências não lidas", error);
    return preferenciasPadrao();
  }
  return lerPreferenciasBrutas((data as Array<{ chave: string; valor: unknown }> | null) ?? []);
}

/** Valores das chaves extra para um rascunho novo: o que o dono deixou ligado por padrão. */
export function valoresDasExtras(p: Preferencias): Record<string, string> {
  const v: Record<string, string> = {};
  CHAVES_DAS_EXTRAS.forEach((k) => (v[k] = p.extras[k] === "padrao_sim" ? "sim" : "nao"));
  return v;
}

/** As chaves de cláusula extra que o dono tirou da biblioteca (a tela esconde; o servidor não liga). */
export function extrasForaDaBiblioteca(p: Preferencias): string[] {
  return CHAVES_DAS_EXTRAS.filter((k) => p.extras[k] === "desligada");
}

function resumoDosModelos(todos: ModeloComEstado[]) {
  const chaves: string[] = [];
  todos.forEach((m) => chaves.indexOf(m.chave) < 0 && chaves.push(m.chave));
  return chaves.map((chave) => {
    const versoes = todos.filter((m) => m.chave === chave).sort((a, b) => b.versao - a.versao);
    const ativo = versoes.find((m) => m.ativo) || versoes[0];
    return {
      chave,
      tipo: ativo.tipo,
      servico: ativo.servico,
      nome: ativo.nome,
      ativo: { versao: ativo.versao, revisao_juridica: ativo.revisao_juridica, variaveis: ativo.variaveis, clausulas: ativo.clausulas },
      versoes: versoes.map((m) => ({ versao: m.versao, ativo: m.ativo, revisao_juridica: m.revisao_juridica, clausulas: m.clausulas.length })),
    };
  });
}

function base(todos: ModeloComEstado[], chave: string): { base: ModeloDeContrato; geral: ModeloDeContrato | null } {
  const b = todos.find((m) => m.chave === chave && m.ativo);
  if (!b) throw new ErroHttp(404, "modelo_inexistente", "Modelo sem versão ativa.");
  return { base: b, geral: todos.find((m) => m.tipo === "condicoes_gerais" && m.ativo) || null };
}

function conferir(todos: ModeloComEstado[], corpo: Record<string, unknown>) {
  const chave = limpo(corpo.chave, 60);
  const { base: b, geral } = base(todos, chave);
  const r = lerRascunhoDoModelo(corpo.rascunho, b);
  const c = conferirRascunhoDoModelo(r, b, geral);
  const resumo = resumoDaMudanca(b, r);
  const antes: Record<string, string> = {};
  b.clausulas.forEach((x) => (antes[x.chave] = x.texto));
  const diffs = r.clausulas.filter((x) => resumo.alteradas.indexOf(x.chave) >= 0 || resumo.novas.indexOf(x.chave) >= 0).map((x) => ({ chave: x.chave, titulo: x.titulo, partes: diffDeTexto(antes[x.chave] || "", x.texto) }));
  return { b, r, c, resumo, diffs };
}

export function acoesDosModelos(n: Nucleo & { esquecerModelos: () => void }) {
  return {
    modelos_listar: async (_ch: Chamador) => {
      const [todos, preferencias] = await Promise.all([n.lerModelos(), lerPreferencias()]);
      return json({ modelos: resumoDosModelos(todos), preferencias, custo_usd: 0 });
    },
    modelo_conferir: async (_ch: Chamador, corpo: Record<string, unknown>) => {
      const x = conferir(await n.lerModelos(), corpo);
      return json({ erros: x.c.erros, avisos: x.c.avisos, resumo: x.resumo, diffs: x.diffs, versao_nova: x.b.versao + 1, custo_usd: 0 });
    },
    modelo_publicar: async (ch: Chamador, corpo: Record<string, unknown>) => {
      await garantirAdmin(ch);
      if (corpo.confirmar !== true) throw new ErroHttp(400, "sem_confirmacao", "Confira a diferença e confirme para publicar a versão nova.");
      const x = conferir(await n.lerModelos(), corpo);
      if (x.c.erros.length) throw new ErroHttp(422, "modelo_com_erro", x.c.erros[0], { erros: x.c.erros });
      const textoMudou = !!(x.resumo.alteradas.length || x.resumo.novas.length || x.resumo.removidas.length);
      const todasVersoes = (await n.lerModelos()).filter((m) => m.chave === x.b.chave).map((m) => m.versao);
      const proxima = Math.max.apply(null, todasVersoes.concat([x.b.versao])) + 1;
      const { data, error } = await servico().rpc("contrato_modelo_publicar", {
        p_chave: x.b.chave,
        p_nome: x.r.nome,
        p_variaveis: x.r.variaveis,
        p_clausulas: x.r.clausulas.map((c) => ({ chave: c.chave, titulo: c.titulo, texto: c.texto, quando: c.quando || null })),
        p_revisao: revisaoDaVersaoNova(proxima, textoMudou, limpo(corpo.revisao_juridica, 120)),
        p_ator: ch.userId,
      });
      if (error) throw semTabela(error) ? new ErroHttp(503, "banco_sem_editor", "O banco ainda não tem o editor de modelos (migration 20260930195100 pendente).") : new ErroHttp(409, "modelo_nao_publicado", error.message);
      n.esquecerModelos();
      await auditLog({
        correlationId: crypto.randomUUID(), toolName: "contrato_modelo_publicar", origin: "contratos", keyId: `contratos:${ch.userId}`, scopes: ["contracts:write"],
        input: { chave: x.b.chave, resumo: x.resumo }, success: true, statusCode: 200, durationMs: 0, resultRef: String((data as Record<string, unknown> | null)?.id || ""),
      });
      return json({ publicado: data, resumo: x.resumo, custo_usd: 0 });
    },
    preferencias_ler: async (_ch: Chamador) => json({ preferencias: await lerPreferencias(), custo_usd: 0 }),
    preferencias_salvar: async (ch: Chamador, corpo: Record<string, unknown>) => {
      await garantirAdmin(ch);
      const atual = await lerPreferencias();
      const nova = lerPreferenciasBrutas([
        { chave: "extras", valor: { ...atual.extras, ...(corpo.extras && typeof corpo.extras === "object" ? (corpo.extras as Record<string, unknown>) : {}) } },
        { chave: "avisos", valor: { ...atual.avisos, ...(corpo.avisos && typeof corpo.avisos === "object" ? (corpo.avisos as Record<string, unknown>) : {}) } },
      ]);
      const agora = new Date().toISOString();
      const { error } = await servico().from("contrato_preferencias").upsert([
        { chave: "extras", valor: nova.extras, atualizado_por: ch.userId, atualizado_em: agora },
        { chave: "avisos", valor: nova.avisos, atualizado_por: ch.userId, atualizado_em: agora },
      ], { onConflict: "chave" });
      if (error) throw semTabela(error) ? new ErroHttp(503, "banco_sem_preferencias", "O banco ainda não tem as preferências dos contratos (migration 20260930195100 pendente).") : new ErroHttp(409, "preferencias_nao_gravadas", error.message);
      return json({ preferencias: nova, anterior: atual, custo_usd: 0 });
    },
  };
}
