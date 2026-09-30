/**
 * briefing-agente, frente BRF2 (30/09/2026): "Preencher com IA" o briefing
 * interno, a partir da reunião, da conversa, do site e do Instagram do cliente,
 * com o modelo escolhido na hora. A IA devolve uma PRÉVIA; nada é gravado sem
 * a equipe aplicar (tudo ou campo a campo), e o Desfazer volta como estava.
 *
 * - estimar_preenchimento { briefing_id, modelo_id?, reuniao?, conversa?, fontes? } -> { custo_usd, modelo_id, campos }
 * - preencher_ia { briefing_id, modelo_id?, reuniao?, conversa?, fontes?, substituir?, confirmado: true }
 *   -> { valores, fontes, avisos, rotulos, custo_usd, saldo_usd, modelo_id } (sem gravar)
 * - aplicar_respostas { briefing_id, valores } -> { aplicadas, salvo_em } (pelo mesmo caminho do link)
 * - desfazer_preenchimento { briefing_id } -> { voltaram, mantidos }
 *
 * Papel "briefing" da frente BASE (ia_usos tarefa e agente). Sem travessão.
 */

import { chamarTexto, estimarComModelo, garantirSaldo, modeloDoPapel, type ModeloIa } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { contasDaMarcaDoCliente, lerContextoDaMarca, resolverMarca } from "../_shared/marca.ts";
import { contextoCompletoParaPrompt } from "../_shared/contexto-completo-da-marca.ts";
import { urlPublica } from "../_shared/referencias-do-site.ts";
import { camposDoModelo, chaveDoOutro, estadoDoLink, modeloDoLink, type Respostas } from "../_shared/briefing-modelos.ts";
import { anexosDoBriefing } from "../_shared/briefing-decupar.ts";
import {
  anterioresDe,
  camposParaIa,
  caracteresDasFontes,
  fontesDoMaterial,
  limparPreenchimento,
  MAX_INSTAGRAM,
  MAX_MATERIAL,
  MAX_SITE,
  pedidoDoPreenchimento,
  tamanhoDoPreenchimento,
} from "../_shared/briefing-preencher.ts";
import { type Chamador, dadosSabidos, ErroHttp, json, lerBriefing, type LinhaDoBriefing, registrar, salvarPeloLink, servico } from "./base.ts";

const PAPEL = "briefing" as const;
const CAMPOS_COM_PREENCHIMENTO =
  "id, token, client_id, project_id, marca_id, modelo, modelo_versao, modelo_conteudo, prefill, titulo, responses, submitted, expira_em, enviado_em, envios, reabertura_pedida_em, arquivado_em, arquivo_pdf_id, created_at, preenchido_ia";

type Fontes = { site: boolean; instagram: boolean; contexto: boolean };
const fontesDoCorpo = (v: unknown): Fontes => {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return { site: o.site === true, instagram: o.instagram === true, contexto: o.contexto !== false };
};
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

function exigirAberto(b: LinhaDoBriefing) {
  if (b.arquivado_em) throw new ErroHttp(409, "arquivado", "Este briefing está arquivado.");
  if (estadoDoLink(b) !== "aberto") throw new ErroHttp(409, "link_fechado", "Preencher com IA vale para o briefing ainda aberto (antes de o cliente enviar). Reabra ou estenda a validade antes.");
}

async function modeloEscolhido(id: unknown): Promise<ModeloIa> {
  const m = await modeloDoPapel(PAPEL, typeof id === "string" && id.trim() ? id.trim() : null);
  if (!m) throw new ErroHttp(409, "sem_modelo", "O catálogo não tem modelo de texto ativo para o briefing.");
  return m;
}

// ------------------------------------------------------------------ fontes (site e Instagram do cliente)

/** Texto visível do site (sem script e sem estilo), com prazo, teto e só endereço público. */
async function textoDoSite(url: string): Promise<{ texto: string; aviso: string | null }> {
  const comProtocolo = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const alvo = urlPublica(comProtocolo);
  if (!alvo) return { texto: "", aviso: "O endereço do site não é público; ficou de fora." };
  try {
    const r = await fetch(alvo, { headers: { "User-Agent": "AceleriqPainel/1.0 (+briefing)", Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { texto: "", aviso: `O site respondeu ${r.status}; ficou de fora.` };
    if (r.url && !urlPublica(r.url)) return { texto: "", aviso: "O site redirecionou para um endereço que não é público; ficou de fora." };
    const tipo = r.headers.get("content-type") || "";
    if (tipo && tipo.indexOf("html") < 0) return { texto: "", aviso: "O endereço do site não é uma página." };
    const bruto = (await r.text()).slice(0, 800_000);
    const limpo = bruto
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return { texto: `${alvo}\n${limpo}`.slice(0, 5_000), aviso: null };
  } catch (e) {
    registrarFalha("briefing-agente: site do cliente não abriu", e, { url: alvo });
    return { texto: "", aviso: "O site do cliente não abriu agora; ficou de fora." };
  }
}

/** Bio e legendas recentes do Instagram da marca (o que o robô de métricas já trouxe). */
async function textoDoInstagram(clientId: string, marcaId: string | null): Promise<{ texto: string; aviso: string | null }> {
  const db = servico();
  let contas: string[] | null = null;
  if (marcaId) {
    const marca = await resolverMarca(db, clientId, { marca_id: marcaId }).catch(() => null);
    if (marca) contas = await contasDaMarcaDoCliente(db, clientId, marca).catch(() => null);
  }
  let qId = db.from("social_client_identity").select("username, display_name, biography, website, external_account_id").eq("client_id", clientId).limit(3);
  let qPosts = db.from("social_post_metrics").select("caption, posted_at, external_account_id").eq("client_id", clientId).order("posted_at", { ascending: false }).limit(12);
  if (contas) {
    if (!contas.length) return { texto: "", aviso: "Esta marca não tem Instagram ligado; ficou de fora." };
    qId = qId.in("external_account_id", contas);
    qPosts = qPosts.in("external_account_id", contas);
  }
  const [id, posts] = await Promise.all([qId, qPosts]);
  if (id.error || posts.error) {
    registrarFalha("briefing-agente: Instagram do cliente não lido", id.error || posts.error, { client_id: clientId });
    return { texto: "", aviso: "O Instagram do cliente não foi lido agora; ficou de fora." };
  }
  const perfis = (id.data as Array<{ username?: string | null; display_name?: string | null; biography?: string | null; website?: string | null }> | null) ?? [];
  const legendas = ((posts.data as Array<{ caption?: string | null }> | null) ?? []).map((p) => String(p.caption || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!perfis.length && !legendas.length) return { texto: "", aviso: "O painel ainda não tem dados do Instagram deste cliente." };
  const partes = perfis.map((p) => `@${p.username || ""} ${p.display_name || ""}\nBio: ${p.biography || ""}${p.website ? `\nSite: ${p.website}` : ""}`);
  if (legendas.length) partes.push(`Legendas recentes:\n${legendas.map((l) => `- ${l.slice(0, 300)}`).join("\n")}`);
  return { texto: partes.join("\n\n"), aviso: null };
}

async function contextoDoPainel(clientId: string, marcaId: string | null): Promise<string> {
  const db = servico();
  const marca = marcaId ? await resolverMarca(db, clientId, { marca_id: marcaId }).catch(() => null) : null;
  const c = (await lerContextoDaMarca(db, clientId, marca).catch((e) => (registrarFalha("briefing-agente: contexto não lido", e), {}))) as Record<string, unknown>;
  const linhas: string[] = [];
  ["negocio", "publico", "oferta", "tom_de_voz", "diferenciais"].forEach((k) => {
    const v = c[k];
    const t = typeof v === "string" ? v : Array.isArray(v) ? v.map(String).join("; ") : "";
    if (t.trim()) linhas.push(`${k}: ${t.trim().slice(0, 900)}`);
  });
  // Frente SYNC: com o contexto vêm a estratégia aprovada (tom e tagline), o dossiê e as decisões do conselho da marca.
  const completo = await contextoCompletoParaPrompt(db, clientId, marca, { area: "geral", partes: ["estrategia", "dossie", "decisoes"], semTitulo: true, teto: 3000 })
    .then((x) => x.bloco, (e) => (registrarFalha("briefing-agente: contexto completo não lido", e), ""));
  return [linhas.join("\n"), completo].filter(Boolean).join("\n\n");
}

async function juntarMaterial(b: LinhaDoBriefing, corpo: Record<string, unknown>, fontes: Fontes) {
  const avisos: string[] = [];
  const respostas = (b.responses || {}) as Respostas;
  const prefill = (b.prefill || {}) as Record<string, unknown>;
  const clientId = b.client_id as string;
  const sabidos = fontes.site || fontes.instagram ? await dadosSabidos(clientId, b.marca_id).catch(() => ({} as Record<string, string | undefined>)) : {};
  const urlDoSite = String(respostas.site || prefill.site || (sabidos as Record<string, unknown>).site || "").trim();
  const [site, instagram, contexto] = await Promise.all([
    fontes.site ? (urlDoSite ? textoDoSite(urlDoSite) : Promise.resolve({ texto: "", aviso: "O cliente não tem site cadastrado; ficou de fora." })) : Promise.resolve({ texto: "", aviso: null }),
    fontes.instagram ? textoDoInstagram(clientId, b.marca_id) : Promise.resolve({ texto: "", aviso: null }),
    fontes.contexto ? contextoDoPainel(clientId, b.marca_id) : Promise.resolve(""),
  ]);
  if (site.aviso) avisos.push(site.aviso);
  if (instagram.aviso) avisos.push(instagram.aviso);
  const material = fontesDoMaterial({ reuniao: texto(corpo.reuniao, 60_000), conversa: texto(corpo.conversa, 60_000), site: site.texto, instagram: instagram.texto, contexto });
  return { fontes: material.fontes, avisos: avisos.concat(material.avisos) };
}

// ------------------------------------------------------------------ ações

export async function estimarPreenchimento(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id);
  exigirAberto(b);
  const m = await modeloEscolhido(corpo.modelo_id);
  const modelo = modeloDoLink(b.modelo, b.modelo_conteudo);
  const anexos = await anexosDoBriefing(servico(), b.id);
  const campos = camposParaIa(modelo, (b.responses || {}) as Respostas, anexos, corpo.substituir === true);
  // O site e o Instagram entram com o teto de cada um (a estimativa fica do lado seguro, sem ler nada agora).
  const f = fontesDoCorpo(corpo.fontes);
  // A tela manda só o tamanho do material colado (não o texto) para estimar.
  const colado = Number(corpo.caracteres) > 0 ? Math.min(2 * MAX_MATERIAL, Math.floor(Number(corpo.caracteres))) : Math.min(MAX_MATERIAL, texto(corpo.reuniao, 60_000).length) + Math.min(MAX_MATERIAL, texto(corpo.conversa, 60_000).length);
  const caracteres = colado + (f.site ? MAX_SITE : 0) + (f.instagram ? MAX_INSTAGRAM : 0) + (f.contexto ? 3_000 : 0);
  const t = tamanhoDoPreenchimento(campos, caracteres);
  return json({ custo_usd: estimarComModelo(m, { tokensEntrada: t.entrada, tokensSaida: t.saida }), modelo_id: m.id, campos: campos.length });
}

export async function preencherComIa(ch: Chamador, corpo: Record<string, unknown>) {
  if (corpo.confirmado !== true) throw new ErroHttp(400, "confirmacao_obrigatoria", "Preencher com IA tem custo: confirme o valor na tela antes.");
  const b = await lerBriefing(ch, corpo.briefing_id);
  exigirAberto(b);
  if (!b.client_id) throw new ErroHttp(409, "sem_cliente", "Ligue o briefing a um cliente antes (a IA usa a carteira dele).");
  const m = await modeloEscolhido(corpo.modelo_id);
  const modelo = modeloDoLink(b.modelo, b.modelo_conteudo);
  const respostas = (b.responses || {}) as Respostas;
  const anexos = await anexosDoBriefing(servico(), b.id);
  const substituir = corpo.substituir === true;
  const campos = camposParaIa(modelo, respostas, anexos, substituir);
  if (!campos.length) throw new ErroHttp(409, "nada_para_preencher", substituir ? "Este briefing não tem pergunta que a IA preencha." : "Todas as perguntas que a IA preenche já têm resposta. Marque Substituir para refazer.");
  const material = await juntarMaterial(b, corpo, fontesDoCorpo(corpo.fontes));
  if (caracteresDasFontes(material.fontes) < 40) throw new ErroHttp(400, "material_curto", "Cole a reunião ou a conversa, ou marque o site e o Instagram: sem material a IA não tem de onde tirar.", { avisos: material.avisos });
  const pedido = pedidoDoPreenchimento(modelo, campos, material.fontes, substituir);
  const t = tamanhoDoPreenchimento(campos, caracteresDasFontes(material.fontes));
  await garantirSaldo(b.client_id, estimarComModelo(m, { tokensEntrada: t.entrada, tokensSaida: t.saida }));
  const saida = await chamarTexto({
    clientId: b.client_id,
    tarefa: PAPEL,
    agente: PAPEL,
    modeloId: m.id,
    sistema: pedido.sistema,
    mensagens: [{ papel: "usuario", conteudo: pedido.mensagem }],
    raciocinio: ["low", "minimal", "medium"].find((r) => (m.raciocinio ?? []).includes(r)),
    esquemaJson: { nome: pedido.esquema.nome, schema: pedido.esquema.schema },
    maxTokensSaida: t.saida,
    referencia: { tipo: "briefing", id: b.id },
    criadoPor: ch.userId,
  });
  const limpo = limparPreenchimento(saida.json, modelo, campos, pedido, material.fontes, substituir);
  const rotulos: Record<string, string> = {};
  camposDoModelo(modelo).forEach((c) => {
    if (Object.prototype.hasOwnProperty.call(limpo.valores, c.key)) rotulos[c.key] = c.pergunta;
    if (Object.prototype.hasOwnProperty.call(limpo.valores, chaveDoOutro(c.key))) rotulos[chaveDoOutro(c.key)] = `${c.pergunta} (outro)`;
  });
  await registrar(ch, "briefing_preencher_ia", { briefing_id: b.id, modelo_id: m.id, campos: Object.keys(limpo.valores).length, fontes: limpo.fontes, custo_usd: saida.custoUsd }, b.id);
  return json({
    valores: limpo.valores,
    fontes: limpo.fontes,
    avisos: material.avisos.concat(limpo.avisos),
    rotulos,
    atuais: anterioresDe(respostas, limpo.valores),
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    modelo_id: saida.modeloId || m.id,
    reserva_usada: saida.reservaUsada ?? null,
  });
}

export async function aplicarRespostas(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id, CAMPOS_COM_PREENCHIMENTO);
  exigirAberto(b);
  const modelo = modeloDoLink(b.modelo, b.modelo_conteudo);
  const permitidas: string[] = [];
  camposDoModelo(modelo).forEach((c) => permitidas.push(c.key, chaveDoOutro(c.key)));
  const bruto = corpo.valores && typeof corpo.valores === "object" && !Array.isArray(corpo.valores) ? (corpo.valores as Record<string, unknown>) : {};
  const valores: Record<string, unknown> = {};
  Object.keys(bruto).slice(0, 200).forEach((k) => {
    if (permitidas.indexOf(k) >= 0 && bruto[k] !== undefined) valores[k] = bruto[k];
  });
  if (!Object.keys(valores).length) throw new ErroHttp(400, "nada_para_aplicar", "Escolha ao menos uma resposta para aplicar.");
  const anteriores = anterioresDe((b.responses || {}) as Respostas, valores);
  const r = await salvarPeloLink(b.token, valores);
  const registro = { em: r.salvo_em, por: ch.userId, anteriores, aplicados: valores, desfeito_em: null };
  const { error } = await servico().from("briefings").update({ preenchido_ia: registro }).eq("id", b.id);
  if (error) registrarFalha("briefing-agente: registro do Desfazer não gravado", error, { briefing_id: b.id });
  await registrar(ch, "briefing_aplicar_respostas", { briefing_id: b.id, chaves: Object.keys(valores) }, b.id);
  return json({ aplicadas: Object.keys(valores), salvo_em: r.salvo_em, desfazer: !error, aviso: error ? "As respostas foram gravadas, mas o Desfazer não ficou disponível." : null });
}

export async function desfazerPreenchimento(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id, CAMPOS_COM_PREENCHIMENTO);
  exigirAberto(b);
  const reg = b.preenchido_ia as { anteriores?: Record<string, unknown>; aplicados?: Record<string, unknown>; desfeito_em?: string | null } | null;
  if (!reg || !reg.aplicados || reg.desfeito_em) throw new ErroHttp(409, "nada_para_desfazer", "Não há preenchimento com IA para desfazer neste briefing.");
  const atual = (b.responses || {}) as Respostas;
  const voltar: Record<string, unknown> = {};
  const mantidos: string[] = [];
  Object.keys(reg.aplicados).forEach((k) => {
    if (JSON.stringify(atual[k] ?? null) !== JSON.stringify(reg.aplicados![k] ?? null)) {
      mantidos.push(k);
      return;
    }
    voltar[k] = reg.anteriores ? reg.anteriores[k] ?? null : null;
  });
  if (Object.keys(voltar).length) await salvarPeloLink(b.token, voltar);
  const { error } = await servico().from("briefings").update({ preenchido_ia: { ...reg, desfeito_em: new Date().toISOString(), desfeito_por: ch.userId } }).eq("id", b.id);
  if (error) registrarFalha("briefing-agente: desfazer não registrado", error, { briefing_id: b.id });
  await registrar(ch, "briefing_desfazer_preenchimento", { briefing_id: b.id, voltaram: Object.keys(voltar), mantidos }, b.id);
  return json({ voltaram: Object.keys(voltar), mantidos });
}
