/**
 * Mesa Site igual ao Gravyx (19/10/2026), os três que faltavam:
 *
 * site_importar { client_id, marca_id?, nome, origem: zip|pasta|html, path, manifesto, framework? }
 *   -> { site, trabalho }: o zip (montado e conferido na tela) já subiu para
 *   mesa/<client_id>/site/importacao/; a função confere o manifesto (nome de
 *   segredo, limites, caminho), cria o site e põe o trabalho do motor (tipo
 *   "textos", sem IA e sem custo) que baixa, confere de novo com o conteúdo,
 *   monta o projeto no RASCUNHO (origem "importação"), compila e confere.
 * codigo_ler { site_id } -> { zip: { url, commit, em } | null, rascunho }:
 *   o código mais novo que o motor guardou (o editor abre o zip na tela).
 * codigo_salvar { site_id, arquivos: [{ caminho, conteudo, sha_antes }], de? }
 *   -> { trabalho }: a edição vai para o rascunho pelo motor (sem IA), que
 *   recompila e confere. Recusa com o motor mexendo no site.
 * site_do_modelo { client_id, marca_id?, modelo, nome? } -> { site }: site
 *   novo a partir de um modelo da galeria, com a marca aberta; abre no Briefing.
 *
 * Só equipe (a função mesa-site já confere). Sem travessão.
 */
import { auditLog } from "../_shared/mcp-audit.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { trabalhosDoProjeto } from "../_shared/motor-fila.ts";
import type { LinhaDoSite } from "../_shared/pacote-do-site.ts";
import type { ChamadorDaEstrutura } from "./estrutura.ts";
import type { ContextoDaPrevia } from "./previa.ts";
import { estadoDoRascunho } from "./modulos/obra-do-site.ts";
import { conferirManifesto, LIMITES_DA_IMPORTACAO, type OrigemDaImportacao, ROTULO_DA_ORIGEM_DA_IMPORTACAO } from "./modulos/importacao-do-site.ts";
import { instrucaoDaEdicao, validarEdicaoDeCodigo } from "./modulos/editor-de-codigo.ts";
import { camposDoModelo, modeloDePagina } from "./modulos/modelos-de-pagina.ts";

export type ContextoDoCodigo = ContextoDaPrevia & {
  garantirAcesso: (ch: ChamadorDaEstrutura, clientId: string) => Promise<void>;
  /** Cria o site como o "Novo site" (marca, mapa do tipo, base de design da marca). */
  criarSite: (ch: ChamadorDaEstrutura, c: Record<string, unknown>) => Promise<LinhaDoSite>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ORIGENS: OrigemDaImportacao[] = ["zip", "pasta", "html"];
/** Prazo da URL assinada do zip do código (a tela baixa na hora). */
const PRAZO_DA_URL_S = 600;

function idDe(ctx: ContextoDoCodigo, v: unknown, nome: string) {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw ctx.erro(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
}

/** O caminho do zip da importação: sempre na pasta do cliente, nome gerado pela tela. */
export const caminhoDaImportacaoValido = (clientId: string, path: string) => path.indexOf(`${clientId}/site/importacao/`) === 0 && /^[0-9a-f-]{36}\/site\/importacao\/[a-z0-9-]{8,64}\.zip$/.test(path);

async function siteImportar(ctx: ContextoDoCodigo, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const clientId = idDe(ctx, c.client_id, "client_id");
  await ctx.garantirAcesso(ch, clientId);
  const origem = ORIGENS.indexOf(c.origem as OrigemDaImportacao) >= 0 ? (c.origem as OrigemDaImportacao) : null;
  if (!origem) throw ctx.erro(400, "origem_invalida", "A importação vem de um zip, de uma pasta ou de um HTML.");
  const path = limpo(c.path, 300);
  if (!caminhoDaImportacaoValido(clientId, path)) throw ctx.erro(400, "caminho_invalido", "O pacote precisa estar na pasta de importação do cliente.");
  const man = conferirManifesto(c.manifesto);
  if (!man.ok) throw ctx.erro(400, man.codigo || "importacao_recusada", man.motivo || "A importação foi recusada.");
  // O zip existe e cabe (a tela já conferiu; aqui é a palavra do Storage).
  const pasta = path.slice(0, path.lastIndexOf("/"));
  const nomeDoZip = path.slice(path.lastIndexOf("/") + 1);
  const { data: achados, error: erroDaLista } = await ctx.servico().storage.from("mesa").list(pasta, { search: nomeDoZip, limit: 2 });
  if (erroDaLista) throw ctx.erro(503, "storage_indisponivel", "Não foi possível conferir o pacote no Storage agora.");
  const zip = ((achados as Array<{ name: string; metadata?: { size?: number } | null }> | null) ?? []).find((x) => x.name === nomeDoZip);
  if (!zip) throw ctx.erro(404, "pacote_inexistente", "O pacote não subiu. Tente importar de novo.");
  const tamanho = Number(zip.metadata && zip.metadata.size) || 0;
  if (tamanho > LIMITES_DA_IMPORTACAO.zipBytes) throw ctx.erro(413, "zip_grande", "O pacote passa do limite de 50 MB.");

  const rotulo = limpo(c.framework, 80);
  const nome = limpo(c.nome, 120) || "Site importado";
  const site = await ctx.criarSite(ch, { client_id: clientId, nome, marca_id: c.marca_id });
  try {
    const comImportacao = await ctx.atualizarSite(site.id, {
      etapa: "construcao",
      direcao: { ...obj(site.direcao), importacao: { origem, framework: rotulo || null, arquivos: man.arquivos, bytes: man.bytes, em: new Date().toISOString() } },
    });
    const trabalho = await ctx.pedirTrabalho(
      ch,
      comImportacao,
      { tipo: "textos", instrucao: `Importar o site (${rotulo || ROTULO_DA_ORIGEM_DA_IMPORTACAO[origem]}, ${man.arquivos} arquivos)` },
      { importacao: { bucket: "mesa", path, origem, nome: limpo(c.nome_original, 160) || null } },
    );
    await auditLog({ correlationId: crypto.randomUUID(), toolName: "site_importar", origin: "mesa:mesa-site", keyId: `mesa:mesa-site:${ch.userId}`, scopes: ["mesa:write"], input: { client_id: clientId, site_id: site.id, origem, arquivos: man.arquivos, bytes: man.bytes }, success: true, statusCode: 200, durationMs: 0, resultRef: trabalho.id }).catch((e: unknown) => registrarFalha("mesa-site: auditoria da importação", e));
    return ctx.json({ site: comImportacao, trabalho, custo_usd: 0 });
  } catch (e) {
    // Sem o trabalho, o site novo não serve para nada: vai para os arquivados (nada é apagado).
    await ctx.atualizarSite(site.id, { arquivado_em: new Date().toISOString(), arquivado_por: ch.userId }).catch((x: unknown) => registrarFalha("mesa-site: site da importação não arquivado", x, { site_id: site.id }));
    throw e;
  }
}

async function codigoLer(ctx: ContextoDoCodigo, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const trabalhos = await trabalhosDoProjeto(ctx.servico(), s.client_id, s.id, 30);
  const r = estadoDoRascunho(trabalhos);
  const rascunho = { aberto: r.aberto, em_andamento: r.emAndamento };
  const { data, error } = await ctx.servico().from("motor_trabalhos").select("id, zip_path, commit, terminado_em").eq("client_id", s.client_id).eq("referencia_id", s.id).not("zip_path", "is", null).order("terminado_em", { ascending: false }).limit(1);
  if (error) throw ctx.erro(503, "fila_indisponivel", "Não foi possível ler o código guardado agora.");
  const z = ((data as Array<{ id: string; zip_path: string; commit: string | null; terminado_em: string | null }> | null) ?? [])[0];
  if (!z) return ctx.json({ zip: null, rascunho, motivo: "O código ainda não foi guardado: construa ou importe o site primeiro.", custo_usd: 0 });
  const { data: assinada, error: erroDaUrl } = await ctx.servico().storage.from("mesa").createSignedUrl(z.zip_path, PRAZO_DA_URL_S);
  if (erroDaUrl || !assinada) throw ctx.erro(503, "storage_indisponivel", "Não foi possível abrir o código guardado agora.");
  return ctx.json({ zip: { url: assinada.signedUrl, path: z.zip_path, commit: z.commit, trabalho_id: z.id, em: z.terminado_em }, rascunho, custo_usd: 0 });
}

async function codigoSalvar(ctx: ContextoDoCodigo, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const v = validarEdicaoDeCodigo({ arquivos: c.arquivos, de: c.de });
  if (!v.ok) throw ctx.erro(400, String(v.codigo), String(v.motivo));
  const r = estadoDoRascunho(await trabalhosDoProjeto(ctx.servico(), s.client_id, s.id, 30));
  if (r.emAndamento) throw ctx.erro(409, "motor_mexendo", "O motor ainda está mexendo no site. Salve quando ele terminar: a sua edição continua aberta aqui.");
  const trabalho = await ctx.pedirTrabalho(ch, s, { tipo: "textos", instrucao: instrucaoDaEdicao(v.edicao) }, { edicao_de_codigo: v.edicao });
  await auditLog({ correlationId: crypto.randomUUID(), toolName: "site_codigo_salvar", origin: "mesa:mesa-site", keyId: `mesa:mesa-site:${ch.userId}`, scopes: ["mesa:write"], input: { client_id: s.client_id, site_id: s.id, arquivos: v.edicao.arquivos.map((a) => a.caminho) }, success: true, statusCode: 200, durationMs: 0, resultRef: trabalho.id }).catch((e: unknown) => registrarFalha("mesa-site: auditoria do editor", e));
  return ctx.json({ trabalho, custo_usd: 0 });
}

async function siteDoModelo(ctx: ContextoDoCodigo, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const m = modeloDePagina(c.modelo);
  if (!m) throw ctx.erro(400, "modelo_inexistente", "Esse modelo não está na galeria.");
  const clientId = idDe(ctx, c.client_id, "client_id");
  await ctx.garantirAcesso(ch, clientId);
  const site = await ctx.criarSite(ch, { client_id: clientId, nome: limpo(c.nome, 120) || m.nome, marca_id: c.marca_id, tipo: m.tipo });
  const campos = camposDoModelo(m, { direcao: obj(site.direcao), briefing: obj(site.briefing), estilo: obj((site as unknown as { estilo?: unknown }).estilo) });
  const pronto = await ctx.atualizarSite(site.id, { ...campos, etapa: "briefing" });
  return ctx.json({ site: pronto, custo_usd: 0 });
}

export function rotasDoCodigoEModelos(ctx: ContextoDoCodigo): Record<string, (ch: ChamadorDaEstrutura, c: Record<string, unknown>) => Promise<Response>> {
  return {
    site_importar: (ch, c) => siteImportar(ctx, ch, c),
    codigo_ler: (ch, c) => codigoLer(ctx, ch, c),
    codigo_salvar: (ch, c) => codigoSalvar(ctx, ch, c),
    site_do_modelo: (ch, c) => siteDoModelo(ctx, ch, c),
  };
}
