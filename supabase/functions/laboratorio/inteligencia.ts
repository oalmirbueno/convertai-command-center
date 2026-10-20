/**
 * laboratorio (20/10/2026, pedido do dono: "os nós estão soltos e crus"): os nós puxam do cliente, geram
 * com IA e leem documentos, como no Gravyx e no ClickMax.
 *
 * - fontes_do_cliente { client_id | null } → { cliente, dossie, marca, midias (60), documentos (40) }. Não gasta.
 * - no_preencher { projeto_id, no_id, pedido?, campos?, confirmado? } → { dados, explicacao, custo_usd }.
 *   Sem confirmado: 409 confirmacao_necessaria com o custo. Não salva o canvas (a tela aplica, com Desfazer).
 * - ler_documento { projeto_id, arquivo: { id, path?, url?, nome? }, resumir?, confirmado? }
 *   → { texto (≤16.000), resumo (≤600), lido }. Ler não gasta; o resumo pede confirmação do custo.
 *
 * Tudo que toca banco, storage e IA passa pela porta (o teste usa uma falsa). Regras puras em
 * modulos/inteligencia.ts.
 */
import { chamarTexto, modeloPadrao } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { clienteInternoDaAgencia } from "../_shared/nucleo-das-mesas.ts";
import { lerContextoConsolidado, lerDossie, lerMarcaParaDirecao } from "../_shared/contexto-cliente.ts";
import { type Chamador, carteiraDe, ErroHttp, garantirAcesso, idOuNulo, json, limpo, nomeDoCliente, servico, TAREFA } from "./comum.ts";
import { cobrarConfirmacao } from "./creditos.ts";
import { lerUmDocumento } from "./documentos.ts";
import { type Contexto, entradasMontadas, precificador, type ProjetoDoLab } from "./executar.ts";
import { BUCKET } from "./workspace.ts";
import { arred, type Chamada, MODELO_TEXTO_PADRAO, type NoDoCanvas } from "./modulos/regras.ts";
import {
  camposPreenchiveis,
  type DocumentoDoCliente,
  esquemaDoPreenchimento,
  type FontesDoCliente,
  juntarMidias,
  limparPreenchimento,
  marcaParaATela,
  MAX_DOCUMENTOS_DAS_FONTES,
  MAX_MIDIAS_DAS_FONTES,
  type MidiaDoCliente,
  montarDossie,
  SISTEMA_DO_PREENCHER,
  tamanhoDoPreenchimento,
  tipoDaMidia,
} from "./modulos/inteligencia.ts";
import { TETO_DO_TEXTO } from "./modulos/leitor.ts";
import { marcaIdDoCanvas } from "./modulos/motor.ts";
import { lerMarcaCompleta, marcasDoCliente } from "../_shared/marca.ts";

type Corpo = Record<string, unknown>;

/** O que as ações usam de fora (banco, storage, IA, créditos). */
export interface PortaDaInteligencia {
  garantirAcesso(ch: Chamador, clientId: string): Promise<void>;
  lerProjeto(ch: Chamador, id: unknown): Promise<ProjetoDoLab>;
  lerFontes(clientId: string | null, marcaId?: string | null): Promise<FontesDoCliente>;
  /** Os textos que entram no nó (saídas já rodadas, dados das entradas e documentos do próprio nó). */
  entradasDoNo(ch: Chamador, p: ProjetoDoLab, no: NoDoCanvas): Promise<string[]>;
  modeloRapido(): Promise<string>;
  preco(ch: Chamada): Promise<number>;
  cobrar(o: { total: number; noId: string; projetoId: string; nota: string; userId: string }): Promise<{ devolverTudo(motivo: string): Promise<void> }>;
  texto(o: { clientId: string | null; modeloId: string; sistema: string; mensagem: string; esquema?: unknown; maxSaida: number; projetoId: string; userId: string }): Promise<{ texto: string; json?: unknown; custoUsd: number }>;
  lerDocumento(ch: Chamador, p: ProjetoDoLab, arquivo: Record<string, unknown>): Promise<{ texto: string; lido: boolean; nome: string; motivo?: string }>;
}

const conf = (corpo: Corpo) => corpo.confirmado === true;

function pedirConfirmacao(total: number, porNo: unknown): never {
  throw new ErroHttp(409, "confirmacao_necessaria", `Isto custa cerca de US$ ${total.toFixed(4)}. Confirme para gerar.`, { total_usd: total, por_no: porNo });
}

// ------------------------------------------------------------------ fontes_do_cliente

/** fontes_do_cliente { client_id | null }: equipe com acesso ao cliente; nulo = marca da Aceleriq e mídias do Laboratório. */
export async function fontesDoCliente(porta: PortaDaInteligencia, ch: Chamador, corpo: Corpo): Promise<Response> {
  const clientId = idOuNulo(corpo.client_id, "client_id");
  const marcaId = clientId ? idOuNulo(corpo.marca_id, "marca_id") : null;
  if (clientId) await porta.garantirAcesso(ch, clientId);
  return json(await porta.lerFontes(clientId, marcaId));
}

// ------------------------------------------------------------------ no_preencher

/** O texto das fontes do nó (o que o modelo lê e contra o que o número é conferido). */
export function fontesEmTexto(o: { entradas: string[]; fontes: FontesDoCliente | null; dados: Record<string, unknown>; pedido: string }): string {
  const f = o.fontes;
  const partes = [
    o.pedido ? `PEDIDO DO DONO:\n${o.pedido}` : "",
    f && f.cliente ? `CLIENTE: ${f.cliente.nome}${f.cliente.nicho ? ` (${f.cliente.nicho})` : ""}` : "",
    f && f.dossie ? `DOSSIÊ DO CLIENTE:\n${f.dossie.resumo}${f.dossie.pontos.length ? `\n- ${f.dossie.pontos.join("\n- ")}` : ""}` : "",
    f && f.marca ? `MARCA: cores ${f.marca.cores.join(", ") || "-"}; fontes ${f.marca.fontes.join(", ") || "-"}; tom ${f.marca.tom || "-"}${f.marca.nunca.length ? `; nunca: ${f.marca.nunca.join("; ")}` : ""}` : "",
    o.entradas.length ? `ENTRADAS LIGADAS AO NÓ:\n${o.entradas.join("\n\n")}` : "",
    Object.keys(o.dados).length ? `O QUE O NÓ JÁ TEM: ${JSON.stringify(o.dados).slice(0, 2000)}` : "",
  ];
  return partes.filter(Boolean).join("\n\n").slice(0, 40_000);
}

export async function noPreencher(porta: PortaDaInteligencia, ch: Chamador, corpo: Corpo): Promise<Response> {
  const p = await porta.lerProjeto(ch, corpo.projeto_id);
  const noId = limpo(corpo.no_id, 80);
  const no = p.canvas.nos.find((n) => n.id === noId);
  if (!no) throw new ErroHttp(404, "no_inexistente", "Este nó não está no canvas salvo. Salve o projeto e tente de novo.");
  const campos = camposPreenchiveis(no.tipo, corpo.campos);
  if (!campos.length) throw new ErroHttp(400, "sem_campos", "Este nó não tem campo que a IA preencha (só anexo, link ou escolha técnica).");
  const pedido = limpo(corpo.pedido, 1000);
  const [entradas, fontes] = await Promise.all([porta.entradasDoNo(ch, p, no), porta.lerFontes(p.client_id, marcaIdDoCanvas(p.canvas, no.id)).catch(() => null)]);
  const dadosAtuais: Record<string, unknown> = {};
  for (const c of campos) if (no.dados[c] !== undefined && no.dados[c] !== "") dadosAtuais[c] = no.dados[c];
  const texto = fontesEmTexto({ entradas, fontes, dados: dadosAtuais, pedido });
  const modeloId = await porta.modeloRapido();
  const t = tamanhoDoPreenchimento(texto, campos.length);
  const chamada: Chamada = { tipo: "texto", modelo_id: modeloId, tokens_entrada: t.entrada, tokens_saida: t.saida, imagens: 0, qualidade: null };
  const custo = arred(await porta.preco(chamada));
  const porNo = [{ no_id: no.id, tipo: no.tipo, custo_usd: custo, chamadas: [chamada] }];
  if (!conf(corpo)) pedirConfirmacao(custo, porNo);
  const cobranca = await porta.cobrar({ total: custo, noId: no.id, projetoId: p.id, nota: `Preencher ${typeof no.dados.titulo === "string" && no.dados.titulo ? no.dados.titulo : no.tipo}`.slice(0, 120), userId: ch.userId });
  let r: { texto: string; json?: unknown; custoUsd: number };
  try {
    r = await porta.texto({
      clientId: p.client_id,
      modeloId,
      sistema: SISTEMA_DO_PREENCHER,
      mensagem: [`NÓ: ${no.tipo}. CAMPOS PARA PREENCHER: ${campos.join(", ")}.`, texto || "(sem fonte ligada: preencha só o que o tipo do nó permite sem inventar fato)"].join("\n\n"),
      esquema: esquemaDoPreenchimento(no.tipo, campos),
      maxSaida: t.saida + 500,
      projetoId: p.id,
      userId: ch.userId,
    });
  } catch (err) {
    await cobranca.devolverTudo("o preenchimento não saiu");
    throw err;
  }
  const limpo2 = limparPreenchimento(no.tipo, campos, r.json, `${texto}\n${pedido}`);
  return json({ dados: limpo2.dados, explicacao: limpo2.explicacao, custo_usd: arred(r.custoUsd), campos, modelo_id: modeloId });
}

// ------------------------------------------------------------------ ler_documento

export const MAX_RESUMO_DO_DOCUMENTO = 600;

export async function lerDocumento(porta: PortaDaInteligencia, ch: Chamador, corpo: Corpo): Promise<Response> {
  const p = await porta.lerProjeto(ch, corpo.projeto_id);
  const a = corpo.arquivo && typeof corpo.arquivo === "object" && !Array.isArray(corpo.arquivo) ? (corpo.arquivo as Record<string, unknown>) : null;
  if (!a || !(limpo(a.id, 80) || limpo(a.path, 500))) throw new ErroHttp(400, "arquivo_obrigatorio", "Mande o arquivo ({ id, path?, url? }).");
  const r = await porta.lerDocumento(ch, p, a);
  const texto = r.texto.slice(0, TETO_DO_TEXTO);
  if (corpo.resumir !== true || !texto) return json({ texto, resumo: "", lido: r.lido && !!texto, ...(r.motivo ? { motivo: r.motivo } : {}) });
  const modeloId = await porta.modeloRapido();
  const chamada: Chamada = { tipo: "texto", modelo_id: modeloId, tokens_entrada: 400 + Math.ceil(texto.length / 3.5), tokens_saida: 300, imagens: 0, qualidade: null };
  const custo = arred(await porta.preco(chamada));
  if (!conf(corpo)) pedirConfirmacao(custo, [{ no_id: null, tipo: "ler_documento", custo_usd: custo, chamadas: [chamada] }]);
  const cobranca = await porta.cobrar({ total: custo, noId: "ler_documento", projetoId: p.id, nota: `Resumo de ${r.nome}`.slice(0, 120), userId: ch.userId });
  let resumo = "";
  try {
    const s = await porta.texto({
      clientId: p.client_id,
      modeloId,
      sistema: "Resuma o documento em português do Brasil, em até 4 frases (até 600 caracteres), só com o que está nele: o que é, para quem, os números e nomes que aparecem. Não invente.",
      mensagem: `[Documento: ${r.nome}]\n${texto}`,
      maxSaida: 400,
      projetoId: p.id,
      userId: ch.userId,
    });
    resumo = s.texto.trim().slice(0, MAX_RESUMO_DO_DOCUMENTO);
  } catch (err) {
    await cobranca.devolverTudo("o resumo não saiu");
    throw err;
  }
  return json({ texto, resumo, lido: r.lido, custo_usd: custo });
}

// ------------------------------------------------------------------ a porta de verdade

const umaPalavra = (t: string | undefined | null, max: number) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : s;
};

async function assinarVarios(bucket: string, caminhos: string[]): Promise<Record<string, string>> {
  const saida: Record<string, string> = {};
  const unicos = caminhos.filter((c, i, a) => c && a.indexOf(c) === i);
  if (!unicos.length) return saida;
  const { data } = await servico().storage.from(bucket).createSignedUrls(unicos, 7 * 24 * 3600);
  for (const d of (data || []) as Array<{ path: string | null; signedUrl: string | null }>) if (d.path && d.signedUrl) saida[d.path] = d.signedUrl;
  return saida;
}

async function seguro<T>(rotulo: string, fn: () => Promise<T>, reserva: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    registrarFalha(`laboratorio: fontes do cliente sem ${rotulo}`, e);
    return reserva;
  }
}

/** As fontes de verdade: dossiê, marca (kit), movimentos visíveis, acervo e Workspace. */
export async function lerFontesDoBanco(clientId: string | null, marcaId: string | null = null): Promise<FontesDoCliente> {
  const db = servico();
  const alvo = clientId || (await clienteInternoDaAgencia(db));
  type Linha = Record<string, unknown>;
  const [contexto, dossie, marcaBruta, kit, movimentos] = alvo
    ? await Promise.all([
      seguro("contexto", () => lerContextoConsolidado(db, alvo), {}),
      seguro("dossiê", () => lerDossie(db, alvo, 4000), null),
      seguro("marca", () => lerMarcaParaDirecao(db, alvo), null),
      seguro("kit", async () => ((await db.from("cliente_kit_marca").select("logo_path").eq("client_id", alvo).maybeSingle()).data as Linha | null), null),
      seguro("movimentos", async () => {
        const ha60 = new Date(Date.now() - 60 * 86_400_000).toISOString();
        const { data } = await db.rpc("movimentos_do_cliente", { _client_id: alvo, _desde: ha60, _ate: new Date().toISOString(), _somente_visiveis: true });
        return ((data || []) as Array<{ quando?: string; titulo?: string }>).sort((a, b) => String(b.quando || "").localeCompare(String(a.quando || "")));
      }, [] as Array<{ quando?: string; titulo?: string }>),
    ])
    : [{}, null, null, null, []];
  // 20/10: marcas do cliente; com marca_id (do cliente), a marca é SÓ a dela (outra marca nunca herda cor, logo nem contexto).
  const marcas = clientId ? (await seguro("marcas", () => marcasDoCliente(db, clientId), [])).map((m) => ({ id: m.id, nome: m.nome })) : [];
  const escolhida = clientId && marcaId && marcas.some((m) => m.id === marcaId) ? await seguro("marca escolhida", () => lerMarcaCompleta(db, clientId, marcaId), null) : null;
  const ctxDaMarca = escolhida && escolhida.contexto && typeof escolhida.contexto === "object" ? escolhida.contexto as Record<string, unknown> : null;
  const logoPath = escolhida ? escolhida.logo_path : kit && typeof kit.logo_path === "string" ? kit.logo_path : null;
  const logoUrl = logoPath ? (await assinarVarios("mesa", [logoPath]))[logoPath] || null : null;
  const nichoDaMarca = ctxDaMarca && typeof ctxDaMarca.negocio === "string" ? ctxDaMarca.negocio : null;
  const cliente = alvo ? { id: alvo, nome: await seguro("nome", () => nomeDoCliente(alvo), "Cliente"), nicho: umaPalavra(escolhida ? nichoDaMarca : contexto.negocio, 120) } : null;

  // Mídias: do acervo (cliente_imagens) e vídeos do Workspace do cliente; sem cliente, o Workspace global do Laboratório.
  const midias: MidiaDoCliente[][] = [];
  const documentos: DocumentoDoCliente[] = [];
  type No = { id: string; name: string; mime: string | null; storage_path: string | null; thumb_path: string | null; created_at: string };
  let nos: No[] = [];
  if (clientId) {
    const acervo = await seguro("acervo", async () => ((await db.from("cliente_imagens").select("id, storage_bucket, storage_path, nome, categoria, criado_em").eq("client_id", clientId).eq("ativa", true).order("criado_em", { ascending: false }).limit(MAX_MIDIAS_DAS_FONTES)).data || []) as Linha[], [] as Linha[]);
    const porBucket: Record<string, string[]> = {};
    for (const a of acervo) (porBucket[String(a.storage_bucket)] = porBucket[String(a.storage_bucket)] || []).push(String(a.storage_path));
    const links: Record<string, Record<string, string>> = {};
    for (const b of Object.keys(porBucket)) links[b] = await seguro("links do acervo", () => assinarVarios(b, porBucket[b]), {});
    midias.push(acervo.map((a) => {
      const url = (links[String(a.storage_bucket)] || {})[String(a.storage_path)] || "";
      return { id: String(a.id), tipo: "imagem" as const, url, miniatura_url: url || null, nome: String(a.nome || "imagem"), origem: `acervo${a.categoria ? `: ${a.categoria}` : ""}`, criado_em: String(a.criado_em || "") };
    }));
    nos = await seguro("workspace", async () => ((await db.from("workspace_nodes").select("id, name, mime, storage_path, thumb_path, created_at").eq("client_id", clientId).eq("kind", "file").order("created_at", { ascending: false }).limit(200)).data || []) as No[], [] as No[]);
  } else {
    nos = await seguro("workspace global", async () => ((await db.from("workspace_nodes").select("id, name, mime, storage_path, thumb_path, created_at").is("client_id", null).eq("kind", "file").like("storage_path", "global/laboratorio/%").order("created_at", { ascending: false }).limit(200)).data || []) as No[], [] as No[]);
  }
  const caminhos = nos.flatMap((n) => [n.storage_path || "", n.thumb_path || ""]).filter(Boolean);
  const links = await seguro("links do workspace", () => assinarVarios(BUCKET, caminhos), {});
  const doWorkspace: MidiaDoCliente[] = [];
  for (const n of nos) {
    const tipo = tipoDaMidia(n.mime, n.name);
    const url = n.storage_path ? links[n.storage_path] || "" : "";
    if (!url) continue;
    // Do cliente, o acervo já traz as imagens: do Workspace entram os vídeos (e, no global, tudo).
    if (tipo === "video" || (tipo === "imagem" && !clientId)) doWorkspace.push({ id: n.id, tipo, url, miniatura_url: (n.thumb_path && links[n.thumb_path]) || (tipo === "imagem" ? url : null), nome: n.name, origem: clientId ? "workspace" : "laboratório", criado_em: n.created_at });
    else if (!tipo && documentos.length < MAX_DOCUMENTOS_DAS_FONTES) documentos.push({ id: n.id, nome: n.name, tipo: n.mime || "", url });
  }
  midias.push(doWorkspace);
  return {
    cliente,
    dossie: montarDossie({ dossie, diferenciais: contexto.diferenciais, movimentos }),
    marca: escolhida
      ? marcaParaATela({ paleta: Array.isArray(escolhida.paleta) ? escolhida.paleta as Array<{ hex?: string }> : [], fontes: [], tomDeVoz: escolhida.tom || (ctxDaMarca && typeof ctxDaMarca.tom_de_voz === "string" ? ctxDaMarca.tom_de_voz : null), estilo: escolhida.estilo, regras: escolhida.regras }, logoUrl)
      : marcaBruta ? marcaParaATela(marcaBruta, logoUrl) : null,
    midias: juntarMidias(midias).map(({ criado_em: _c, ...m }) => m as MidiaDoCliente),
    documentos,
    marcas,
  };
}

/** Modelo de texto barato e rápido: o padrão "estrategista_rapido", senão o de "leitura", senão o do Lab. */
async function modeloRapidoDoCatalogo(): Promise<string> {
  for (const papel of ["estrategista_rapido", "leitura"]) {
    const m = await modeloPadrao(papel).catch(() => null);
    if (m && m.tipo === "texto" && m.ativo) return m.id;
  }
  return MODELO_TEXTO_PADRAO;
}

/** A porta de verdade; lerProjeto e o contexto vêm de acoes.ts (sem import circular). */
export function portaDaInteligencia(o: { lerProjeto: PortaDaInteligencia["lerProjeto"]; contexto: (ch: Chamador, p: ProjetoDoLab) => Promise<Contexto> }): PortaDaInteligencia {
  return {
    garantirAcesso,
    lerProjeto: o.lerProjeto,
    lerFontes: lerFontesDoBanco,
    async entradasDoNo(ch, p, no) {
      const ctx = await o.contexto(ch, p);
      return (await entradasMontadas(ctx, no)).textos;
    },
    modeloRapido: modeloRapidoDoCatalogo,
    async preco(ch) {
      return (await precificador([ch]))(ch);
    },
    async cobrar(c) {
      return await cobrarConfirmacao({ porNo: [{ no_id: c.noId, custo_usd: c.total }], total: c.total, projetoId: c.projetoId, nota: c.nota, userId: c.userId });
    },
    async texto(t) {
      const carteira = await carteiraDe(t.clientId);
      const r = await chamarTexto({
        clientId: carteira.clientId,
        tarefa: TAREFA,
        agente: "estrategista",
        modeloId: t.modeloId,
        sistema: t.sistema,
        mensagens: [{ papel: "usuario", conteudo: t.mensagem.slice(0, 60_000) }],
        esquemaJson: t.esquema as never,
        maxTokensSaida: t.maxSaida,
        referencia: { tipo: "lab_projeto", id: t.projetoId },
        criadoPor: t.userId,
      });
      return { texto: r.texto, json: r.json, custoUsd: r.custoUsd };
    },
    async lerDocumento(ch, p, arquivo) {
      const lido = await lerUmDocumento({ projeto: p, token: ch.token }, arquivo);
      if (!lido) throw new ErroHttp(400, "arquivo_invalido", "Arquivo sem id, caminho nem nome.");
      return { texto: lido.texto || "", lido: !!lido.texto, nome: lido.nome, ...(lido.motivo ? { motivo: lido.motivo } : {}) };
    },
  };
}
