/**
 * mesa-identidade: brandbook (Guideline e Entrega) e o kit da marca.
 *
 * - brandbook_montar: o primeiro rascunho sai do projeto (brandbook.ts) e vira
 *   a versão 1 (ou a próxima). Sem IA.
 * - brandbook_salvar: cada salvar é uma versão nova (JSON versionado).
 * - brandbook_compartilhar: o PDF do modelo escolhido, montado aqui com as
 *   prévias reais das logos (PNG com transparência), vai para Arquivos com a
 *   revisão da agência pedida (aprovação no painel).
 * - brandbook_publicar / brandbook_revogar: a página pública por link
 *   (retrato sem caminho de arquivo; imagens como data URL).
 * - kit_sugerir: o que foi aprovado vira SUGESTÃO para o kit da marca, num
 *   cartão com Confirmar (a gravação é do executor do agente, com Desfazer).
 */

import { paraBase64 } from "../_shared/ia-motor.ts";
import { lerMarcaCompleta } from "../_shared/marca.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { lerDadosDaAgencia, nomeDaAgencia } from "../_shared/dados-da-agencia.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { type AcaoDoAgente, TIPO_DA_ACAO } from "../_shared/acoes-do-agente.ts";
import { brandbookDoProjeto, brandbookPublico, coresDoBrandbook, type DadosDoBrandbook, ehModelo, imagensDoBrandbook, lacunasDoBrandbook, type ModeloDoBrandbook, normalizarBrandbook, tokenPublico } from "../_shared/brandbook.ts";
import { gerarPdfDoBrandbook, nomeDoArquivoDoBrandbook, prepararImagens } from "../_shared/pdf-identidade.ts";
// Frente SYNC: a estratégia aprovada e a tagline também viram sugestão para o contexto da marca (Confirmar e Desfazer campo a campo).
import { aplicarNoContexto, contextoDaEstrategia, estrategiaAprovada, mudancasNoContexto, reverterNoContexto } from "../_shared/contexto-completo-regras.ts";
import { esquecerContextoCompleto } from "../_shared/contexto-completo-da-marca.ts";
import {
  baixarDoBucket,
  type Chamador,
  dadosComParte,
  erroDoBanco,
  ErroHttp,
  gravarProjeto,
  idDe,
  json,
  type LinhaDoProjeto,
  lerProjeto,
  limpo,
  nomeDaMarca,
  pdfParaAprovacao,
  registrarEvento,
  servico,
} from "./comum.ts";

export type LinhaDoBrandbook = {
  id: string;
  client_id: string;
  marca_id: string | null;
  projeto_id: string;
  modelo: ModeloDoBrandbook;
  versao: number;
  dados: DadosDoBrandbook;
  nota: string | null;
  status: string;
  arquivo_pdf_id: string | null;
  token_publico: string | null;
  publicado_em: string | null;
  revogado_em: string | null;
  criado_em: string;
};

const CAMPOS_DO_BRANDBOOK = "id, client_id, marca_id, projeto_id, modelo, versao, dados, nota, status, arquivo_pdf_id, token_publico, publicado_em, revogado_em, criado_em";

function normalizarLinha(v: unknown): LinhaDoBrandbook | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.client_id !== "string" || typeof o.projeto_id !== "string") return null;
  return {
    id: o.id,
    client_id: o.client_id,
    marca_id: typeof o.marca_id === "string" ? o.marca_id : null,
    projeto_id: o.projeto_id,
    modelo: ehModelo(o.modelo) ? o.modelo : "paginado",
    versao: Number(o.versao) || 1,
    dados: normalizarBrandbook(o.dados, o.client_id),
    nota: typeof o.nota === "string" ? o.nota : null,
    status: String(o.status || "rascunho"),
    arquivo_pdf_id: typeof o.arquivo_pdf_id === "string" ? o.arquivo_pdf_id : null,
    token_publico: typeof o.token_publico === "string" ? o.token_publico : null,
    publicado_em: typeof o.publicado_em === "string" ? o.publicado_em : null,
    revogado_em: typeof o.revogado_em === "string" ? o.revogado_em : null,
    criado_em: String(o.criado_em || ""),
  };
}

export async function lerBrandbook(ch: Chamador, id: unknown): Promise<{ linha: LinhaDoBrandbook; projeto: LinhaDoProjeto }> {
  const bid = idDe(id, "brandbook_id");
  const { data, error } = await servico().from("idv_brandbooks").select(CAMPOS_DO_BRANDBOOK).eq("id", bid).maybeSingle();
  if (error) throw erroDoBanco(error, "brandbook_indisponivel", "Não foi possível ler o brandbook.");
  const linha = normalizarLinha(data);
  if (!linha) throw new ErroHttp(404, "brandbook_inexistente", "Brandbook não encontrado.");
  const projeto = await lerProjeto(ch, linha.projeto_id);
  return { linha, projeto };
}

async function proximaVersao(projetoId: string): Promise<number> {
  const { data, error } = await servico().from("idv_brandbooks").select("versao").eq("projeto_id", projetoId).order("versao", { ascending: false }).limit(1);
  if (error) throw erroDoBanco(error, "brandbook_indisponivel", "Não foi possível ler as versões do brandbook.");
  const ultima = ((data as Array<{ versao: number }> | null) ?? [])[0];
  return ultima ? Number(ultima.versao) + 1 : 1;
}

async function inserirVersao(ch: Chamador, p: LinhaDoProjeto, modelo: ModeloDoBrandbook, dados: DadosDoBrandbook, nota: string | null): Promise<LinhaDoBrandbook> {
  // Duas pessoas salvando juntas: a segunda tenta a versão seguinte (a única trava é a versão única por projeto).
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const versao = await proximaVersao(p.id);
    const { data, error } = await servico()
      .from("idv_brandbooks")
      .insert({ client_id: p.client_id, marca_id: p.marca_id, projeto_id: p.id, modelo, versao, dados, nota, criado_por: ch.userId })
      .select(CAMPOS_DO_BRANDBOOK)
      .single();
    if (!error) return normalizarLinha(data) as LinhaDoBrandbook;
    if (error.code !== "23505") throw erroDoBanco(error, "brandbook_nao_gravado", "Não foi possível gravar o brandbook.");
  }
  throw new ErroHttp(409, "versao_mudou", "Outra pessoa salvou o brandbook agora. Atualize e salve de novo.");
}

/** Versão nova montada do projeto; guarda o id em dados.guideline. */
export async function montarBrandbook(ch: Chamador, p: LinhaDoProjeto, modelo: ModeloDoBrandbook): Promise<{ linha: LinhaDoBrandbook; projeto: LinhaDoProjeto; guidelineAntes: Record<string, unknown> }> {
  const nome = await nomeDaMarca(p.client_id, p.marca_id);
  const kit = p.marca_id
    ? await lerMarcaCompleta(servico(), p.client_id, p.marca_id).then((m) => (m ? { paleta: m.paleta } : null))
    : await servico().from("cliente_kit_marca").select("paleta").eq("client_id", p.client_id).maybeSingle().then((r) => (r.data as { paleta: unknown } | null) || null);
  const mockups = Array.isArray(p.dados.mockups) ? (p.dados.mockups as Array<{ titulo: string; imagem: string }>) : [];
  const dados = brandbookDoProjeto({ nomeDaMarca: nome, dados: p.dados, clientId: p.client_id, kit, mockups });
  // Créditos pelos Dados da agência (frente BASE); vazios, fica "Aceleriq" sem contato (nada inventado).
  const agencia = await lerDadosDaAgencia(servico()).catch((e) => (registrarFalha("mesa-identidade: dados da agência não lidos", e), null));
  if (agencia) {
    dados.creditos = {
      feito_por: nomeDaAgencia(agencia) || "Aceleriq",
      contato: [agencia.site, agencia.instagram, agencia.email].filter((x): x is string => !!x).join("  /  ").slice(0, 160),
    };
  }
  const linha = await inserirVersao(ch, p, modelo, dados, "Montado do projeto");
  const guidelineAntes = (p.dados.guideline as Record<string, unknown>) || {};
  const projeto = await gravarProjeto(p, { dados: dadosComParte(p.dados, "guideline", { brandbook_id: linha.id, modelo }) });
  return { linha, projeto, guidelineAntes };
}

export async function brandbookMontar(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const modelo = ehModelo(corpo.modelo) ? corpo.modelo : "paginado";
  const r = await montarBrandbook(ch, p, modelo);
  return json({ brandbook: r.linha, projeto: r.projeto, lacunas: lacunasDoBrandbook(modelo, r.linha.dados), custo_usd: 0 });
}

export async function brandbookListar(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const { data, error } = await servico().from("idv_brandbooks").select(CAMPOS_DO_BRANDBOOK).eq("projeto_id", p.id).order("versao", { ascending: false }).limit(30);
  if (error) throw erroDoBanco(error, "brandbook_indisponivel", "Não foi possível ler as versões do brandbook.");
  return json({ versoes: ((data as unknown[]) || []).map(normalizarLinha).filter(Boolean), custo_usd: 0 });
}

/** Cada salvar é uma versão nova (a de antes fica no histórico). */
export async function brandbookSalvar(ch: Chamador, corpo: Record<string, unknown>) {
  const { linha, projeto } = await lerBrandbook(ch, corpo.brandbook_id);
  if (JSON.stringify(corpo.dados || {}).length > 200_000) throw new ErroHttp(413, "brandbook_grande_demais", "O brandbook ficou grande demais para salvar.");
  const dados = normalizarBrandbook(corpo.dados, projeto.client_id);
  const modelo = ehModelo(corpo.modelo) ? corpo.modelo : linha.modelo;
  const nova = await inserirVersao(ch, projeto, modelo, dados, limpo(corpo.nota, 400) || null);
  const novoProjeto = await gravarProjeto(projeto, { dados: dadosComParte(projeto.dados, "guideline", { brandbook_id: nova.id, modelo }) });
  return json({ brandbook: nova, projeto: novoProjeto, lacunas: lacunasDoBrandbook(modelo, dados), custo_usd: 0 });
}

/** As imagens que o PDF usa (prévias das logos, grafismos, mockups), já prontas. */
async function imagensDoPdf(d: DadosDoBrandbook, clientId: string) {
  const arquivos: Record<string, Uint8Array> = {};
  for (const c of imagensDoBrandbook(d)) {
    if (/\.svg$/i.test(c)) continue;
    const b = await baixarDoBucket(clientId, c, 4_000_000);
    if (b) arquivos[c] = b;
  }
  return await prepararImagens(arquivos);
}

export async function compartilharBrandbook(ch: Chamador, linha: LinhaDoBrandbook, projeto: LinhaDoProjeto) {
  const lacunas = lacunasDoBrandbook(linha.modelo, linha.dados);
  if (!linha.dados.logos.principal) throw new ErroHttp(409, "brandbook_sem_logo", "O brandbook precisa da logo principal (arquivo real) antes de ir para aprovação.");
  const imagens = await imagensDoPdf(linha.dados, projeto.client_id);
  const bytes = gerarPdfDoBrandbook({ modelo: linha.modelo, dados: linha.dados, versao: linha.versao, imagens });
  const nome = nomeDoArquivoDoBrandbook(linha.dados.marca.nome || projeto.titulo, linha.modelo, linha.versao);
  const envio = await pdfParaAprovacao(ch, {
    clientId: projeto.client_id,
    bytes,
    nome,
    chave: `mesa-identidade:brandbook:${linha.id}`,
    descricao: `Brandbook (${linha.modelo === "prancha" ? "prancha-resumo" : "24 páginas"}), versão ${linha.versao}, da Mesa Identidade.${lacunas.length ? ` Ainda falta: ${lacunas.join(", ")}.` : ""}`,
    tags: ["mesa_identidade", "brandbook"],
  });
  const { error } = await servico().from("idv_brandbooks").update({ arquivo_pdf_id: envio.file_id, status: linha.status === "aprovado" ? "aprovado" : "em_aprovacao", atualizado_em: new Date().toISOString() }).eq("id", linha.id).eq("client_id", linha.client_id);
  if (error) registrarFalha("mesa-identidade: PDF não ligado ao brandbook", error, { file_id: envio.file_id });
  const novoProjeto = await gravarProjeto(projeto, { dados: dadosComParte(projeto.dados, "entrega", { enviado_em: new Date().toISOString(), brandbook_id: linha.id, file_id: envio.file_id }) }).catch((e) => (registrarFalha("mesa-identidade: entrega não marcada no projeto", e), projeto));
  await registrarEvento({ clientId: projeto.client_id, marcaId: projeto.marca_id, projetoId: projeto.id, tipo: "brandbook_enviado", resumo: `Brandbook versão ${linha.versao} enviado para aprovação no painel.`, provas: { brandbook_id: linha.id, file_id: envio.file_id, versao: linha.versao, lacunas }, userId: ch.userId });
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "idv_brandbook_compartilhar", origin: "mesa:mesa-identidade", keyId: `mesa:mesa-identidade:${ch.userId}`, scopes: ["files:write"],
    input: { client_id: projeto.client_id, brandbook_id: linha.id, file_id: envio.file_id }, success: true, statusCode: 200, durationMs: 0, resultRef: envio.file_id,
  });
  return { ...envio, projeto: novoProjeto, lacunas, imagens_no_pdf: Object.keys(imagens).length };
}

export async function brandbookCompartilhar(ch: Chamador, corpo: Record<string, unknown>) {
  const { linha, projeto } = await lerBrandbook(ch, corpo.brandbook_id);
  return json({ ...(await compartilharBrandbook(ch, linha, projeto)), custo_usd: 0 });
}

/** Limite do retrato público (as imagens vão dentro, como data URL). */
const TETO_DO_PUBLICO = 4_000_000;

export async function brandbookPublicar(ch: Chamador, corpo: Record<string, unknown>) {
  const { linha, projeto } = await lerBrandbook(ch, corpo.brandbook_id);
  const imagens: Record<string, string> = {};
  let total = 0;
  const fora: string[] = [];
  for (const c of imagensDoBrandbook(linha.dados)) {
    const b = await baixarDoBucket(projeto.client_id, c, 1_500_000);
    if (!b) {
      fora.push(c.split("/").pop() || c);
      continue;
    }
    const mime = /\.svg$/i.test(c) ? "image/svg+xml" : /\.jpe?g$/i.test(c) ? "image/jpeg" : /\.webp$/i.test(c) ? "image/webp" : "image/png";
    const url = `data:${mime};base64,${paraBase64(b)}`;
    if (total + url.length > TETO_DO_PUBLICO) {
      fora.push(c.split("/").pop() || c);
      continue;
    }
    total += url.length;
    imagens[c] = url;
  }
  const publicado = brandbookPublico(linha.dados, imagens);
  const token = linha.token_publico && !linha.revogado_em ? linha.token_publico : tokenPublico(crypto.getRandomValues(new Uint8Array(32)));
  const agora = new Date().toISOString();
  const { data, error } = await servico()
    .from("idv_brandbooks")
    .update({ publicado, token_publico: token, publicado_em: agora, publicado_por: ch.userId, revogado_em: null, atualizado_em: agora })
    .eq("id", linha.id)
    .eq("client_id", linha.client_id)
    .select(CAMPOS_DO_BRANDBOOK)
    .single();
  if (error) throw erroDoBanco(error, "brandbook_nao_publicado", "Não foi possível publicar a página do brandbook.");
  await registrarEvento({ clientId: projeto.client_id, marcaId: projeto.marca_id, projetoId: projeto.id, tipo: "brandbook_publicado", resumo: `Página do brandbook (versão ${linha.versao}) publicada por link.`, provas: { brandbook_id: linha.id, caminho: `/marca/${token}` }, userId: ch.userId });
  return json({ brandbook: normalizarLinha(data), caminho: `/marca/${token}`, imagens_fora: fora, custo_usd: 0 });
}

export async function brandbookRevogar(ch: Chamador, corpo: Record<string, unknown>) {
  const { linha, projeto } = await lerBrandbook(ch, corpo.brandbook_id);
  const agora = new Date().toISOString();
  const { data, error } = await servico().from("idv_brandbooks").update({ revogado_em: agora, atualizado_em: agora }).eq("id", linha.id).eq("client_id", linha.client_id).select(CAMPOS_DO_BRANDBOOK).single();
  if (error) throw erroDoBanco(error, "brandbook_nao_revogado", "Não foi possível tirar a página do ar.");
  await registrarEvento({ clientId: projeto.client_id, marcaId: projeto.marca_id, projetoId: projeto.id, tipo: "brandbook_revogado", resumo: `Página do brandbook (versão ${linha.versao}) tirada do ar.`, provas: { brandbook_id: linha.id }, userId: ch.userId });
  return json({ brandbook: normalizarLinha(data), custo_usd: 0 });
}

// ------------------------------------------------------------------ kit da marca

export const OPERACOES_DO_KIT = ["kit_paleta", "kit_tipografia", "kit_logo", "kit_contexto"] as const;

type AlvoDoKit = { tabela: "cliente_kit_marca" } | { tabela: "cliente_marcas"; marcaId: string };

/** Onde o kit desta marca mora: a marca que não é a principal nunca grava no kit do cliente (regra da herança). */
export async function alvoDoKitDaMarca(clientId: string, marcaId: string | null): Promise<AlvoDoKit> {
  if (!marcaId) return { tabela: "cliente_kit_marca" };
  const m = await lerMarcaCompleta(servico(), clientId, marcaId);
  if (!m) throw new Error("A marca deste projeto não existe mais.");
  return m.principal ? { tabela: "cliente_kit_marca" } : { tabela: "cliente_marcas", marcaId: m.id };
}

async function lerKit(clientId: string, alvo: AlvoDoKit): Promise<{ paleta: unknown; logo_path: string | null; logo_alt_path: string | null; contexto: Record<string, unknown> | null }> {
  const q = alvo.tabela === "cliente_marcas"
    ? servico().from("cliente_marcas").select("paleta, logo_path, logo_alt_path, contexto").eq("id", alvo.marcaId).eq("client_id", clientId).maybeSingle()
    : servico().from("cliente_kit_marca").select("paleta, logo_path, logo_alt_path, contexto").eq("client_id", clientId).maybeSingle();
  const { data, error } = await q;
  if (error) throw new Error("Não foi possível ler o kit da marca.");
  const d = (data || {}) as Record<string, unknown>;
  return { paleta: d.paleta ?? null, logo_path: (d.logo_path as string) ?? null, logo_alt_path: (d.logo_alt_path as string) ?? null, contexto: (d.contexto as Record<string, unknown>) ?? null };
}

async function gravarKit(clientId: string, alvo: AlvoDoKit, campos: Record<string, unknown>, userId: string) {
  const agora = new Date().toISOString();
  const { error } = alvo.tabela === "cliente_marcas"
    ? await servico().from("cliente_marcas").update({ ...campos, atualizado_por: userId }).eq("id", alvo.marcaId).eq("client_id", clientId)
    : await servico().from("cliente_kit_marca").upsert({ client_id: clientId, ...campos, atualizado_em: agora, atualizado_por: userId }, { onConflict: "client_id" });
  if (error) throw new Error("Não foi possível gravar no kit da marca.");
}

/** Um item do kit, já confirmado. Devolve o que o Desfazer precisa (o valor de antes). */
export async function aplicarNoKit(clientId: string, marcaId: string | null, operacao: string, carga: Record<string, unknown>, userId: string): Promise<Record<string, unknown>> {
  const alvo = await alvoDoKitDaMarca(clientId, marcaId);
  const kit = await lerKit(clientId, alvo);
  if (operacao === "kit_paleta") {
    const paleta = Array.isArray(carga.paleta) ? carga.paleta.slice(0, 8) : [];
    if (paleta.length < 2) throw new Error("A paleta precisa de ao menos 2 cores.");
    await gravarKit(clientId, alvo, { paleta }, userId);
    return { campo: "paleta", antes: kit.paleta };
  }
  if (operacao === "kit_tipografia") {
    const contexto = { ...(kit.contexto || {}) };
    const antes = Object.prototype.hasOwnProperty.call(contexto, "tipografia") ? contexto.tipografia : null;
    contexto.tipografia = carga.tipografia;
    await gravarKit(clientId, alvo, { contexto }, userId);
    return { campo: "contexto.tipografia", antes };
  }
  if (operacao === "kit_logo") {
    const caminho = String(carga.caminho || "");
    if (caminho.indexOf(`${clientId}/marca/identidade/`) !== 0 || caminho.indexOf("..") >= 0 || !/\.(png|jpe?g|webp)$/i.test(caminho)) throw new Error("A logo do kit precisa ser a prévia PNG enviada na Mesa Identidade deste cliente.");
    const alternativa = carga.alternativa === true;
    const coluna = alternativa ? "logo_alt_path" : "logo_path";
    await gravarKit(clientId, alvo, { [coluna]: caminho, [alternativa ? "logo_alt_file_id" : "logo_file_id"]: null }, userId);
    return { campo: coluna, antes: alternativa ? kit.logo_alt_path : kit.logo_path };
  }
  if (operacao === "kit_contexto") {
    // Frente SYNC: só os campos que mudam; o "antes" de cada um fica para o Desfazer.
    const campos = carga.campos && typeof carga.campos === "object" ? (carga.campos as Record<string, unknown>) : {};
    const mudam = mudancasNoContexto(kit.contexto, campos);
    if (!Object.keys(mudam).length) return { campo: "contexto.campos", antes: {} };
    const r = aplicarNoContexto(kit.contexto, mudam);
    await gravarKit(clientId, alvo, { contexto: r.contexto }, userId);
    esquecerContextoCompleto(clientId);
    return { campo: "contexto.campos", antes: r.antes };
  }
  throw new Error("Operação do kit desconhecida.");
}

export async function reverterNoKit(clientId: string, marcaId: string | null, desfazer: Record<string, unknown>, userId: string) {
  const alvo = await alvoDoKitDaMarca(clientId, marcaId);
  const campo = String(desfazer.campo || "");
  if (campo === "paleta" || campo === "logo_path" || campo === "logo_alt_path") {
    await gravarKit(clientId, alvo, { [campo]: desfazer.antes ?? null }, userId);
    return;
  }
  if (campo === "contexto.tipografia") {
    const kit = await lerKit(clientId, alvo);
    const contexto = { ...(kit.contexto || {}) };
    if (desfazer.antes == null) delete contexto.tipografia;
    else contexto.tipografia = desfazer.antes;
    await gravarKit(clientId, alvo, { contexto }, userId);
    return;
  }
  if (campo === "contexto.campos") {
    const antes = desfazer.antes && typeof desfazer.antes === "object" ? (desfazer.antes as Record<string, unknown>) : {};
    if (!Object.keys(antes).length) return;
    const kit = await lerKit(clientId, alvo);
    await gravarKit(clientId, alvo, { contexto: reverterNoContexto(kit.contexto, antes) }, userId);
    esquecerContextoCompleto(clientId);
    return;
  }
  throw new Error("Sem o que desfazer no kit.");
}

/** A proposta do kit (Confirmar) a partir do último brandbook do projeto (ou do sistema, sem brandbook). */
export function propostaDoKit(projeto: LinhaDoProjeto, dados: DadosDoBrandbook, origem: string): AcaoDoAgente | null {
  const itens: AcaoDoAgente["itens"] = [];
  const cargas: Record<string, Record<string, unknown>> = {};
  const cores = coresDoBrandbook(dados);
  if (cores.length >= 2) {
    itens.push({ ref: "k1", alvo_id: projeto.id, titulo: "Paleta", detalhe: cores.map((c) => `${c.nome} ${c.hex}`).join(", ").slice(0, 160), operacao: "kit_paleta", rotulo: "levar ao kit", para: null });
    cargas["kit_paleta:k1"] = { paleta: cores.map((c) => ({ nome: c.nome, hex: c.hex, papel: c.papel === "neutra" ? "secundaria" : c.papel })) };
  }
  const titulo = dados.tipografia.filter((t) => t.uso === "titulo")[0] || dados.tipografia[0];
  const texto = dados.tipografia.filter((t) => t.uso === "texto")[0] || null;
  if (titulo) {
    itens.push({ ref: "k2", alvo_id: projeto.id, titulo: "Tipografia", detalhe: `Título: ${titulo.familia}${texto ? `; texto: ${texto.familia}` : ""}`, operacao: "kit_tipografia", rotulo: "levar ao kit", para: null });
    cargas["kit_tipografia:k2"] = { tipografia: { titulo: titulo.familia, texto: texto ? texto.familia : titulo.familia, observacao: `Da Mesa Identidade (${origem}).` } };
  }
  const principal = dados.logos.principal;
  if (principal && principal.previa_png) {
    itens.push({ ref: "k3", alvo_id: projeto.id, titulo: "Logo principal", detalhe: "Prévia PNG da logo enviada pela equipe", operacao: "kit_logo", rotulo: "levar ao kit", para: null });
    cargas["kit_logo:k3"] = { caminho: principal.previa_png, alternativa: false };
  }
  const secundaria = dados.logos.secundario;
  if (secundaria && secundaria.previa_png) {
    itens.push({ ref: "k4", alvo_id: projeto.id, titulo: "Logo alternativa", detalhe: "Prévia PNG do logotipo secundário", operacao: "kit_logo", rotulo: "levar ao kit", para: null });
    cargas["kit_logo:k4"] = { caminho: secundaria.previa_png, alternativa: true };
  }
  // Frente SYNC: estratégia (público, oferta, diferenciais, tom, posicionamento) e tagline viram contexto da marca.
  const dadosDoProjeto = (projeto.dados || {}) as Record<string, unknown>;
  const naming = dadosDoProjeto.naming && typeof dadosDoProjeto.naming === "object" ? (dadosDoProjeto.naming as Record<string, unknown>) : {};
  const doContexto = contextoDaEstrategia(dadosDoProjeto.estrategia, { nomeDaMarca: projeto.titulo });
  if (Object.keys(doContexto).length) {
    const rotulos: Record<string, string> = { negocio: "negócio", publico: "público", oferta: "oferta", diferenciais: "diferenciais", tom_de_voz: "tom de voz", posicionamento: "posicionamento" };
    const aprovada = estrategiaAprovada(projeto.concluidas);
    itens.push({ ref: "k5", alvo_id: projeto.id, titulo: `Contexto da marca (estratégia${aprovada ? " aprovada" : " em construção"})`, detalhe: Object.keys(doContexto).map((k) => rotulos[k] || k).join(", "), operacao: "kit_contexto", rotulo: "levar ao contexto", para: null });
    cargas["kit_contexto:k5"] = { campos: doContexto };
  }
  const tagline = typeof naming.slogan === "string" ? naming.slogan.trim() : "";
  if (tagline) {
    itens.push({ ref: "k6", alvo_id: projeto.id, titulo: "Tagline", detalhe: tagline.slice(0, 140), operacao: "kit_contexto", rotulo: "levar ao contexto", para: null });
    cargas["kit_contexto:k6"] = { campos: { tagline: tagline.slice(0, 140) } };
  }
  if (!itens.length) return null;
  return {
    tipo: TIPO_DA_ACAO,
    agente: "identidade",
    id: `identidade-kit-${Date.now().toString(36)}`,
    resumo: `Levar ao kit da marca o que foi aprovado (${origem}): ${itens.map((i) => i.titulo.toLowerCase()).join(", ")}. O valor de antes fica guardado para o Desfazer.`,
    itens,
    ignorados: [],
    recusados: [],
    contexto: { projeto_id: projeto.id, dados: cargas },
    custo_estimado_usd: 0,
  };
}

/** kit_sugerir { projeto_id }: grava a sugestão como mensagem do diretor de marca (cartão com Confirmar). */
export async function kitSugerir(ch: Chamador, corpo: Record<string, unknown>, conversaDoAgente: (ch: Chamador, clientId: string) => Promise<string>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const guideline = (p.dados.guideline as Record<string, unknown>) || {};
  let dados: DadosDoBrandbook;
  let origem = "sistema do projeto";
  if (typeof guideline.brandbook_id === "string") {
    const { linha } = await lerBrandbook(ch, guideline.brandbook_id);
    dados = linha.dados;
    origem = `brandbook versão ${linha.versao}${linha.status === "aprovado" ? ", aprovado" : ""}`;
  } else {
    dados = brandbookDoProjeto({ nomeDaMarca: p.titulo, dados: p.dados, clientId: p.client_id });
  }
  const acao = propostaDoKit(p, dados, origem);
  if (!acao) throw new ErroHttp(409, "nada_para_o_kit", "Ainda não há paleta, tipografia ou logo (prévia PNG) para levar ao kit.");
  const conversaId = await conversaDoAgente(ch, p.client_id);
  const { data, error } = await servico()
    .from("agente_mensagens")
    .insert({ conversa_id: conversaId, client_id: p.client_id, papel: "agente", conteudo: `Sugestão para o kit da marca: ${acao.resumo}`, anexos: [acao] })
    .select("id")
    .single();
  if (error || !data) {
    registrarFalha("mesa-identidade: sugestão do kit não gravada", error);
    throw new ErroHttp(503, "sugestao_nao_gravada", "Não foi possível guardar a sugestão do kit. Tente de novo.");
  }
  return json({ conversa_id: conversaId, mensagem_id: (data as { id: string }).id, anexo: acao, custo_usd: 0 });
}

