/**
 * Ações dos agentes sobre o acervo de fotos do cliente (cliente_imagens), no
 * contrato comum de acoes-do-agente.ts. O acervo é um só para as três mesas:
 * o agente de contexto e o diretor da Mesa Foto usam as mesmas regras.
 *
 * Operações (apelidos i1..iN):
 * - arquivar_foto: tira do acervo (ativa = false). Nenhum arquivo é apagado;
 *   Desfazer devolve.
 * - mover_foto (para = nome da pasta): organiza em pastas.
 * - marcar_foto / tirar_marca (para = etiqueta): organiza por etiquetas. As
 *   etiquetas de sistema (mesa_foto, gerada, ensaio:..., referencia_web...)
 *   não saem por aqui.
 * - aprovar_foto (só na Mesa Foto): a foto aprovada passa a valer nas mesas
 *   (Estúdio, campanhas). Referência da internet nunca é aprovada.
 * - mandar_para_campanha (para = apelido c1..cN da campanha): entra nas
 *   imagens da campanha (até 12). Referência da internet e foto gerada ainda
 *   não aprovada ficam de fora.
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import type { Alvo, AlvoComApelido, ItemDaAcaoDoAgente, RegraDaOperacao, ResultadoDoItem } from "./acoes-do-agente.ts";

export type FotoDoAcervo = {
  id: string;
  nome: string | null;
  pasta: string | null;
  tags: string[] | null;
  ativa: boolean;
  aprovada?: boolean | null;
  origem?: string | null;
  gerada?: boolean | null;
};

export type AlvoDaFoto = Alvo & { dados: { pasta: string; tags: string[]; aprovada: boolean; origem: string; gerada: boolean; ativa: boolean } };

export type CampanhaParaFotos = { id: string; nome: string; ref: string };

export const MAX_IMAGENS_NA_CAMPANHA = 12;

/** Etiquetas que a casa usa para achar a foto (ensaio, book, geração): não saem por pedido. */
export const ETIQUETAS_DE_SISTEMA = ["mesa_foto", "gerada", "ensaio", "referencia_web", "nao_publicar", "personagem"];
const ehDeSistema = (tag: string) => ETIQUETAS_DE_SISTEMA.indexOf(tag) >= 0 || /^(ensaio|book|tomada|kit|clone):/.test(tag);

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export const ehReferenciaDaInternet = (d: { tags: string[]; origem: string }) =>
  d.tags.indexOf("referencia_web") >= 0 || d.tags.indexOf("nao_publicar") >= 0 || d.origem === "referencia_web";

/** Fotos com apelido i1..iN (as ativas primeiro). */
export function alvosDoAcervo(fotos: FotoDoAcervo[], max = 80): Array<AlvoComApelido<AlvoDaFoto>> {
  return fotos
    .slice()
    .sort((a, b) => Number(!a.ativa) - Number(!b.ativa))
    .slice(0, max)
    .map((f, i) => {
      const tags = Array.isArray(f.tags) ? f.tags.map(String) : [];
      const dados = { pasta: String(f.pasta || ""), tags, aprovada: !!f.aprovada, origem: String(f.origem || ""), gerada: !!f.gerada, ativa: f.ativa !== false };
      const partes = [
        dados.pasta ? `pasta: ${umaLinha(dados.pasta, 60)}` : "sem pasta",
        tags.length ? `etiquetas: ${tags.slice(0, 6).join(", ")}` : "",
        f.aprovada === undefined || f.aprovada === null ? "" : dados.aprovada ? "aprovada" : "não aprovada",
        dados.ativa ? "" : "arquivada",
      ].filter(Boolean);
      return { ref: `i${i + 1}`, id: f.id, titulo: umaLinha(f.nome || "foto sem nome", 100), detalhe: partes.join(" · "), dados };
    });
}

/** Nome de pasta limpo: sem barra solta nas pontas, até 80 caracteres. */
export function pastaPedida(v: unknown): string | null {
  const s = umaLinha(v, 120).replace(/\s*\/\s*/g, " / ").replace(/^[\s/]+|[\s/]+$/g, "").slice(0, 80);
  return s || null;
}

/** Etiqueta limpa: minúscula, sem acento, com _ no lugar de espaço, até 40. */
export function etiquetaPedida(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return s || null;
}

/**
 * Regras do acervo. `aprovar` liga aprovar_foto (Mesa Foto); `campanhas` liga
 * mandar_para_campanha com os apelidos c1..cN.
 */
export function regrasDoAcervo(opcoes: { aprovar?: boolean; campanhas?: CampanhaParaFotos[] } = {}): Record<string, RegraDaOperacao<AlvoDaFoto>> {
  const regras: Record<string, RegraDaOperacao<AlvoDaFoto>> = {
    arquivar_foto: {
      rotulo: "arquivar",
      alvos: ["i"],
      trava: (a) => (a.dados.ativa ? null : "Esta foto já está arquivada."),
    },
    mover_foto: {
      rotulo: "mover para a pasta",
      alvos: ["i"],
      combina: true,
      para: (bruto, a) => {
        const p = pastaPedida(bruto);
        return p && p !== a.dados.pasta ? p : null;
      },
    },
    marcar_foto: {
      rotulo: "etiquetar",
      alvos: ["i"],
      combina: true,
      para: (bruto, a) => {
        const t = etiquetaPedida(bruto);
        return t && a.dados.tags.indexOf(t) < 0 ? t : null;
      },
    },
    tirar_marca: {
      rotulo: "tirar etiqueta",
      alvos: ["i"],
      combina: true,
      para: (bruto, a) => {
        const t = etiquetaPedida(bruto);
        return t && a.dados.tags.indexOf(t) >= 0 ? t : null;
      },
      trava: (_a, para) => (ehDeSistema(String(para)) ? "Esta etiqueta é da casa (organiza ensaios e gerações) e não sai por aqui." : null),
    },
  };
  if (opcoes.aprovar) {
    regras.aprovar_foto = {
      rotulo: "aprovar",
      alvos: ["i"],
      combina: true,
      trava: (a) => (ehReferenciaDaInternet(a.dados) ? "Referência da internet não vira foto do cliente." : a.dados.aprovada ? "Esta foto já está aprovada." : null),
    };
  }
  const campanhas = opcoes.campanhas || [];
  if (campanhas.length) {
    const porRef = new Map(campanhas.map((c) => [c.ref.toLowerCase(), c]));
    regras.mandar_para_campanha = {
      rotulo: "mandar para a campanha",
      alvos: ["i"],
      combina: true,
      para: (bruto) => {
        const c = porRef.get(String(bruto ?? "").trim().toLowerCase());
        return c ? c.id : null;
      },
      trava: (a) =>
        ehReferenciaDaInternet(a.dados)
          ? "Referência da internet não entra em campanha."
          : a.dados.gerada && !a.dados.aprovada && !(opcoes.aprovar)
            ? "Foto gerada ainda não aprovada: aprove antes de mandar para a campanha."
            : null,
    };
  }
  return regras;
}

/** Nome da campanha para mostrar no cartão. */
export const rotuloDaCampanha = (campanhas: CampanhaParaFotos[]) => (op: string, para: unknown) =>
  op === "mandar_para_campanha" ? (campanhas.find((c) => c.id === para)?.nome ?? null) : null;

export const DESCRICOES_DO_ACERVO: Record<string, string> = {
  arquivar_foto: "ref i#; tira a foto do acervo (fica guardada, dá para desfazer). para vazio.",
  mover_foto: 'ref i#; para com o nome da pasta ("Produtos / Outono").',
  marcar_foto: 'ref i#; para com a etiqueta ("fachada", "equipe").',
  tirar_marca: "ref i#; para com a etiqueta que sai.",
  aprovar_foto: "ref i#; aprova a foto para as mesas. para vazio.",
  mandar_para_campanha: "ref i#; para com o apelido da campanha (c1, c2...).",
};

// ------------------------------------------------------------------ execução

// deno-lint-ignore no-explicit-any
type ServicoMinimo = { from: (tabela: string) => any };

async function lerFoto(servico: ServicoMinimo, clientId: string, id: string) {
  const { data, error } = await servico.from("cliente_imagens").select("id, client_id, pasta, tags, ativa, aprovada").eq("id", id).maybeSingle();
  if (error) throw new Error("Não foi possível ler a foto. Tente de novo.");
  const f = data as { id: string; client_id: string; pasta: string | null; tags: string[] | null; ativa: boolean; aprovada?: boolean | null } | null;
  if (!f || f.client_id !== clientId) throw new Error("Esta foto não está mais no acervo deste cliente.");
  return { ...f, tags: Array.isArray(f.tags) ? f.tags : [] };
}

async function atualizarFoto(servico: ServicoMinimo, clientId: string, id: string, campos: Record<string, unknown>) {
  const { error } = await servico.from("cliente_imagens").update(campos).eq("id", id).eq("client_id", clientId);
  if (error) throw new Error("Não foi possível gravar a foto. Tente de novo.");
}

/** Uma operação no acervo, já confirmada. Devolve o que o Desfazer precisa. */
export async function executarNoAcervo(servico: ServicoMinimo, clientId: string, item: ItemDaAcaoDoAgente): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string }> {
  const f = await lerFoto(servico, clientId, item.alvo_id);
  switch (item.operacao) {
    case "arquivar_foto":
      if (!f.ativa) return { aviso: "já estava arquivada" };
      await atualizarFoto(servico, clientId, f.id, { ativa: false });
      return { desfazer: { ativa: true } };
    case "mover_foto":
      await atualizarFoto(servico, clientId, f.id, { pasta: String(item.para) });
      return { desfazer: { pasta: f.pasta } };
    case "marcar_foto": {
      const tag = String(item.para);
      if (f.tags.indexOf(tag) >= 0) return { aviso: "já tinha esta etiqueta" };
      await atualizarFoto(servico, clientId, f.id, { tags: f.tags.concat([tag]) });
      return { desfazer: { tirar: tag } };
    }
    case "tirar_marca": {
      const tag = String(item.para);
      if (ehDeSistema(tag)) throw new Error("Esta etiqueta é da casa e não sai por aqui.");
      if (f.tags.indexOf(tag) < 0) return { aviso: "já estava sem esta etiqueta" };
      await atualizarFoto(servico, clientId, f.id, { tags: f.tags.filter((t) => t !== tag) });
      return { desfazer: { por: tag } };
    }
    case "aprovar_foto":
      if (f.tags.indexOf("referencia_web") >= 0 || f.tags.indexOf("nao_publicar") >= 0) throw new Error("Referência da internet não vira foto do cliente.");
      if (f.aprovada) return { aviso: "já estava aprovada" };
      await atualizarFoto(servico, clientId, f.id, { aprovada: true });
      return { desfazer: { aprovada: false } };
    case "mandar_para_campanha": {
      if (f.tags.indexOf("referencia_web") >= 0 || f.tags.indexOf("nao_publicar") >= 0) throw new Error("Referência da internet não entra em campanha.");
      if (!f.ativa) throw new Error("Esta foto está arquivada.");
      const campanhaId = String(item.para);
      const { data, error } = await servico.from("mesa_campanhas").select("id, client_id, imagens").eq("id", campanhaId).maybeSingle();
      if (error) throw new Error("Não foi possível ler a campanha (o banco pode estar sem os campos de imagens da campanha).");
      const c = data as { id: string; client_id: string; imagens: unknown } | null;
      if (!c || c.client_id !== clientId) throw new Error("Esta campanha não é deste cliente.");
      const imagens = Array.isArray(c.imagens) ? (c.imagens as Array<{ imagem_id: string; papel?: string; nota?: string }>) : [];
      if (imagens.some((i) => i && i.imagem_id === f.id)) return { aviso: "já estava na campanha" };
      if (imagens.length >= MAX_IMAGENS_NA_CAMPANHA) throw new Error(`A campanha já tem ${MAX_IMAGENS_NA_CAMPANHA} imagens.`);
      const { error: e2 } = await servico.from("mesa_campanhas").update({ imagens: imagens.concat([{ imagem_id: f.id, papel: "apoio", nota: "" }]) }).eq("id", c.id).eq("client_id", clientId);
      if (e2) throw new Error("Não foi possível colocar a foto na campanha. Tente de novo.");
      return { desfazer: { campanha_id: c.id } };
    }
    default:
      throw new Error("Operação desconhecida.");
  }
}

/** Desfaz uma operação no acervo com o que ela guardou. */
export async function reverterNoAcervo(servico: ServicoMinimo, clientId: string, r: ResultadoDoItem): Promise<void> {
  const d = (r.desfazer ?? {}) as Record<string, unknown>;
  if (r.operacao === "mandar_para_campanha") {
    const { data } = await servico.from("mesa_campanhas").select("id, client_id, imagens").eq("id", String(d.campanha_id)).maybeSingle();
    const c = data as { id: string; client_id: string; imagens: unknown } | null;
    if (!c || c.client_id !== clientId) throw new Error("A campanha não está mais disponível.");
    const imagens = (Array.isArray(c.imagens) ? (c.imagens as Array<{ imagem_id: string }>) : []).filter((i) => i && i.imagem_id !== r.alvo_id);
    const { error } = await servico.from("mesa_campanhas").update({ imagens }).eq("id", c.id).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível tirar a foto da campanha.");
    return;
  }
  const f = await lerFoto(servico, clientId, r.alvo_id);
  if (r.operacao === "arquivar_foto") return atualizarFoto(servico, clientId, f.id, { ativa: true });
  if (r.operacao === "mover_foto") return atualizarFoto(servico, clientId, f.id, { pasta: d.pasta ?? null });
  if (r.operacao === "marcar_foto") return atualizarFoto(servico, clientId, f.id, { tags: f.tags.filter((t) => t !== d.tirar) });
  if (r.operacao === "tirar_marca") return f.tags.indexOf(String(d.por)) >= 0 ? undefined : atualizarFoto(servico, clientId, f.id, { tags: f.tags.concat([String(d.por)]) });
  if (r.operacao === "aprovar_foto") return atualizarFoto(servico, clientId, f.id, { aprovada: false });
}
