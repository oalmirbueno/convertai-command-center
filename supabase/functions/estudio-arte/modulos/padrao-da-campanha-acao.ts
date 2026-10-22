/**
 * campanha_padrao { campanha_id, referencias_ids (1 a 3) } -> { campanha, padrao, custo_usd }
 *
 * 22/10/2026: a referência da campanha vira o PADRÃO VISUAL dela (supabase/functions/_shared/padrao-da-campanha.ts).
 * Lê as imagens das referências pelo mesmo caminho do Estúdio (referenciasPorId + imagemDaReferencia), faz UMA
 * leitura por visão (modelo de leitura do catálogo) e grava na campanha: briefing.padrao e as referências na
 * frente de referencias_ids (toda peça da campanha herda as referências e o padrão, ver prepararItem e
 * blocoDaCampanha). Sem referências (lista vazia): tira o padrão, sem custo.
 */
import { chamarTexto, modeloPadrao, type ImagemEntrada } from "../../_shared/ia-motor.ts";
import { ESQUEMA_DO_PADRAO, idsDoPadrao, normalizarPadrao, SISTEMA_DO_PADRAO } from "../../_shared/padrao-da-campanha.ts";

type Banco = { from: (tabela: string) => any };
type RefDoPadrao = { id: string; storage_path: string | null; leitura: string | null };

export interface DepsDoPadrao {
  servico: () => Banco;
  garantirAcesso: (ch: { userId: string }, clientId: string) => Promise<unknown>;
  lerCampanhaPorId: (id: string) => Promise<{ id: string; client_id: string; nome: string; referencias_ids: string[] | null; briefing?: Record<string, unknown> | null } | null>;
  referenciasPorId: (clientId: string, ids: string[]) => Promise<RefDoPadrao[]>;
  imagemDaReferencia: (r: RefDoPadrao) => Promise<ImagemEntrada>;
  json: (corpo: unknown) => Response;
  erro: (status: number, codigo: string, mensagem: string) => Error;
}

/** A leitura por visão do padrão (uma chamada; as referências vão anexadas). */
async function lerPadraoDaCampanha(a: { clientId: string; campanhaId: string; nome: string; imagens: ImagemEntrada[]; leituras: string[]; userId: string }) {
  const leitor = (await modeloPadrao("leitura")) ?? (await modeloPadrao("estrategista"));
  if (!leitor) throw new Error("sem_modelo_de_leitura");
  const r = await chamarTexto({
    clientId: a.clientId,
    tarefa: "estudio",
    agente: "leitor",
    modeloId: leitor.id,
    sistema: SISTEMA_DO_PADRAO,
    mensagens: [{
      papel: "usuario",
      conteudo: `Campanha "${a.nome}". Leia as ${a.imagens.length} referências anexadas e devolva o padrão visual que a campanha inteira vai seguir.${a.leituras.length ? `\nLeituras já guardadas das referências: ${a.leituras.join(" | ").slice(0, 1500)}` : ""}`,
      imagens: a.imagens,
    }],
    esquemaJson: ESQUEMA_DO_PADRAO,
    maxTokensSaida: 1600,
    referencia: { tipo: "mesa_campanha", id: a.campanhaId },
    criadoPor: a.userId,
  });
  return { json: (r.json ?? {}) as Record<string, unknown>, custo: r.custoUsd, modelo: leitor.id };
}

export function acoesDoPadraoDaCampanha(d: DepsDoPadrao) {
  async function campanhaPadrao(ch: { userId: string }, corpo: Record<string, unknown>): Promise<Response> {
    const c = await d.lerCampanhaPorId(String(corpo.campanha_id || ""));
    if (!c) throw d.erro(404, "campanha_inexistente", "Campanha não encontrada.");
    await d.garantirAcesso(ch, c.client_id);
    const ids = idsDoPadrao(corpo.referencias_ids);
    const briefing = { ...((c.briefing && typeof c.briefing === "object" ? c.briefing : {}) as Record<string, unknown>) };
    const anteriores = (c.referencias_ids || []).filter((x) => ids.indexOf(x) < 0);
    if (!ids.length) {
      delete briefing.padrao;
      const { data, error } = await d.servico().from("mesa_campanhas").update({ briefing }).eq("id", c.id).eq("client_id", c.client_id).select("*").single();
      if (error || !data) throw d.erro(503, "campanha_nao_salva", "Não foi possível tirar o padrão. Tente de novo.");
      return d.json({ campanha: data, padrao: null, custo_usd: 0 });
    }
    const refs = await d.referenciasPorId(c.client_id, ids);
    if (!refs.length) throw d.erro(404, "referencia_inexistente", "As referências escolhidas não foram encontradas.");
    const imagens: ImagemEntrada[] = [];
    const caminhos: string[] = [];
    for (const r of refs) {
      try {
        const img = await d.imagemDaReferencia(r);
        imagens.push({ ...img, nome: `referencia-${imagens.length + 1}.${img.mime.split("/")[1] || "png"}` });
        if (r.storage_path && r.storage_path.indexOf(`${c.client_id}/`) === 0) caminhos.push(r.storage_path);
      } catch {
        /* a que não abre fica de fora; sem nenhuma, erro abaixo */
      }
    }
    if (!imagens.length) throw d.erro(422, "referencia_sem_imagem", "Nenhuma das referências abriu. Troque as imagens.");
    const lido = await lerPadraoDaCampanha({
      clientId: c.client_id,
      campanhaId: c.id,
      nome: c.nome,
      imagens,
      leituras: refs.map((r) => r.leitura || "").filter(Boolean),
      userId: ch.userId,
    });
    const padrao = normalizarPadrao({ ...lido.json, referencias_ids: refs.map((r) => r.id), caminhos, lido_em: new Date().toISOString(), modelo: lido.modelo });
    if (!padrao) throw d.erro(502, "padrao_vazio", "A leitura não devolveu o padrão. Tente de novo.");
    briefing.padrao = padrao;
    // As referências do padrão vão na frente: as peças herdam as primeiras (prepararItem).
    const referencias_ids = padrao.referencias_ids.concat(anteriores).slice(0, 8);
    const { data, error } = await d.servico().from("mesa_campanhas").update({ briefing, referencias_ids }).eq("id", c.id).eq("client_id", c.client_id).select("*").single();
    if (error || !data) throw d.erro(503, "campanha_nao_salva", "O padrão foi lido, mas não foi guardado. Tente de novo.");
    return d.json({ campanha: data, padrao, custo_usd: Math.round(lido.custo * 1e6) / 1e6 });
  }
  return { acoes: { campanha_padrao: campanhaPadrao } };
}
