/**
 * briefing-agente, frente BRF2 (30/09/2026): editor de modelos, perguntas
 * extras por projeto e o registro do lembrete.
 *
 * - versoes_do_modelo { slug } -> { vigente, versoes: [{ versao, titulo, nota, criado_em, ativo, conteudo }], fabrica }
 * - salvar_modelo { slug, conteudo, nota? } -> { versao, avisos } (só admin; sempre versão nova, nunca
 *   muda a anterior; os links antigos seguem com a cópia deles)
 * - perguntas_extras { briefing_id, extras[] } -> { extras, modelo } (só com o link aberto)
 * - registrar_lembrete { briefing_id } -> { lembretes, ultimo_lembrete_em } (a equipe mandou a
 *   mensagem pronta pelo WhatsApp ou pelo grupo; o painel não manda nada ao cliente)
 */

import { registrarFalha } from "../_shared/falha-registrada.ts";
import { ehSlugDeBriefing, estadoDoLink, MODELOS_DE_FABRICA, modeloDoLink, modeloVigente } from "../_shared/briefing-modelos.ts";
import { extrasDoModelo, MAX_LEMBRETES, modeloComExtras, normalizarExtras, proximaVersao, validarModeloEditado } from "./modulos/briefing-editor.ts";
import { type Chamador, ErroHttp, garantirAdmin, json, lerBriefing, limpo, linhasDeModelos, registrar, servico } from "./base.ts";

export async function versoesDoModelo(_ch: Chamador, corpo: Record<string, unknown>) {
  const slug = corpo.slug;
  if (!ehSlugDeBriefing(slug)) throw new ErroHttp(400, "modelo_invalido", "Escolha o tipo de briefing.");
  const { data, error } = await servico()
    .from("briefing_modelos")
    .select("id, slug, versao, titulo, nota, ativo, criado_em, criado_por, conteudo")
    .eq("slug", slug)
    .order("versao", { ascending: false })
    .limit(30);
  if (error) {
    registrarFalha("briefing-agente: versões do modelo não lidas", error, { slug });
    throw new ErroHttp(503, "versoes_indisponiveis", "Não foi possível ler as versões deste modelo.");
  }
  const linhas = (data as Array<{ slug: string; versao: number; conteudo: unknown; ativo: boolean }> | null) ?? [];
  return json({ vigente: modeloVigente(slug, linhas), versoes: linhas, fabrica: MODELOS_DE_FABRICA[slug] });
}

export async function salvarModelo(ch: Chamador, corpo: Record<string, unknown>) {
  await garantirAdmin(ch);
  const slug = corpo.slug;
  if (!ehSlugDeBriefing(slug)) throw new ErroHttp(400, "modelo_invalido", "Escolha o tipo de briefing.");
  let validado;
  try {
    validado = validarModeloEditado(corpo.conteudo, slug);
  } catch (e) {
    throw new ErroHttp(400, "modelo_incompleto", e instanceof Error ? e.message : "O modelo está incompleto.");
  }
  const { data: todas, error: erroLeitura } = await servico().from("briefing_modelos").select("slug, versao").eq("slug", slug);
  if (erroLeitura) throw new ErroHttp(503, "versoes_indisponiveis", "Não foi possível ler as versões deste modelo.");
  const versao = proximaVersao(slug, (todas as Array<{ slug: string; versao: number }> | null) ?? []);
  const conteudo = { ...validado.modelo, slug, versao };
  const { data, error } = await servico()
    .from("briefing_modelos")
    .insert({ slug, versao, titulo: validado.modelo.titulo, conteudo, ativo: true, nota: limpo(corpo.nota, 300) || null, criado_por: ch.userId })
    .select("id, versao")
    .single();
  if (error || !data) {
    // 23505: outra pessoa salvou a mesma versão agora.
    if (error && (error as { code?: string }).code === "23505") throw new ErroHttp(409, "versao_ocupada", "Outra pessoa salvou uma versão deste modelo agora. Abra de novo e salve outra vez.");
    registrarFalha("briefing-agente: versão do modelo não gravada", error, { slug });
    throw new ErroHttp(503, "modelo_nao_gravado", "Não foi possível salvar a versão nova agora.");
  }
  await registrar(ch, "briefing_salvar_modelo", { slug, versao, perguntas: validado.modelo.blocos.reduce((s, b) => s + b.campos.length, 0), avisos: validado.avisos.length }, (data as { id: string }).id);
  return json({ versao, avisos: validado.avisos, modelo: conteudo });
}

export async function perguntasExtras(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id);
  if (b.arquivado_em) throw new ErroHttp(409, "arquivado", "Este briefing está arquivado.");
  if (estadoDoLink(b) !== "aberto") throw new ErroHttp(409, "link_fechado", "As perguntas extras mudam só com o link aberto. Reabra ou estenda a validade antes.");
  const extras = normalizarExtras(corpo.extras);
  const modelo = modeloComExtras(modeloDoLink(b.modelo, b.modelo_conteudo), extras);
  const { error } = await servico().from("briefings").update({ modelo_conteudo: modelo }).eq("id", b.id).eq("submitted", false);
  if (error) {
    registrarFalha("briefing-agente: perguntas extras não gravadas", error, { briefing_id: b.id });
    throw new ErroHttp(503, "extras_nao_gravadas", "Não foi possível gravar as perguntas extras agora.");
  }
  await registrar(ch, "briefing_perguntas_extras", { briefing_id: b.id, extras: extras.map((c) => c.key) }, b.id);
  return json({ extras: extrasDoModelo(modelo), modelo });
}

export async function registrarLembrete(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id, "id, token, client_id, project_id, marca_id, modelo, modelo_versao, modelo_conteudo, prefill, titulo, responses, submitted, expira_em, enviado_em, envios, reabertura_pedida_em, arquivado_em, arquivo_pdf_id, created_at, lembretes");
  if (estadoDoLink(b) !== "aberto") throw new ErroHttp(409, "link_fechado", "Este link não está aberto: não precisa de lembrete.");
  const atual = Number(b.lembretes) || 0;
  const agora = new Date().toISOString();
  const { data, error } = await servico().from("briefings").update({ lembretes: atual + 1, ultimo_lembrete_em: agora }).eq("id", b.id).select("lembretes, ultimo_lembrete_em").maybeSingle();
  if (error || !data) {
    registrarFalha("briefing-agente: lembrete não registrado", error, { briefing_id: b.id });
    throw new ErroHttp(503, "lembrete_nao_registrado", "O lembrete foi mandado, mas não ficou registrado. Tente registrar de novo.");
  }
  await registrar(ch, "briefing_lembrete", { briefing_id: b.id, lembretes: atual + 1 }, b.id);
  return json({ ...(data as Record<string, unknown>), aviso: atual + 1 >= MAX_LEMBRETES ? "Este foi o último lembrete automático sugerido. Se não responder, vale uma ligação." : null });
}
