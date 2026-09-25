/**
 * Mesa Foto, área "Canvas": quadro de cartões ligados que vira UM pedido ao
 * gerador (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 6.4 a 6.6 e 8.3). As
 * regras puras (validação, ordem e orçamento das referências, prompt) ficam
 * em canvas-regras.ts; aqui ficam banco, armazenamento e IA.
 *
 * Ações (POST { acao, ... } na função mesa-foto):
 * - canvas_listar { client_id, incluir_arquivados? } -> { canvases }
 * - canvas_ler { canvas_id } -> { canvas, geracoes }
 * - canvas_salvar { client_id, canvas: { id?, nome, nos, ligacoes, viewport }, versao_esperada?, arquivar? }
 *     -> { canvas } ou 409 { error: 'canvas_mudou', versao_atual, canvas }
 * - canvas_montar { canvas_id, no_saida_id?, modelo_imagem_id?, qualidade?, resolucao? }
 *     -> { referencias, cortadas, prompt, avisos, estimativa_usd, ... } (sem IA: o que vai ao gerador)
 * - canvas_gerar { canvas_id, no_saida_id?, modelo_imagem_id?, qualidade?, resolucao?, seed?,
 *     base_imagem_id?, angulo?, quadro?, quadros?, grupo? }
 *     -> { geracao, imagem, url, montado, custo_usd, saldo_usd, reserva_usada, avisos, grupo, quadro } (UMA imagem por chamada)
 *     v3: "Variações desta" e o carrossel são N chamadas desta ação (a tela
 *     mostra o custo de todas antes): base_imagem_id é a foto base (vai como
 *     Imagem 1, identidade da cena), angulo o índice do ângulo obrigatório,
 *     quadro/quadros a posição no carrossel (3 a 6) e grupo junta a série.
 * - canvas_conferir { geracao_id } -> { geracao_id, conferencia, custo_usd, saldo_usd } (visão + Jev só como aviso)
 * - canvas_agente { canvas_id, mensagem?, tarefa? ('conversar' | 'ambiente' | 'montar'), no_saida_id?, historico? }
 *     -> { resposta, pedido, acao, pose, ambiente, formato, modelo_pronto, kit_id, modelo_id, custo_usd, saldo_usd }
 *     O agente (bolinha do quadro) lê o contexto do cliente, o que está ligado
 *     no resultado e a última foto dele, e escreve o pedido. Não grava no
 *     canvas: a tela põe a resposta no cartão e salva com a versão esperada.
 *
 * Produto de outro cliente (esteira do topo): vale quando a equipe tem acesso
 * ao cliente do kit (can_access_client, pela leitura do kit); a cobrança é
 * sempre do cliente do canvas, e a foto gerada não aponta kit_id nem
 * derivada_de de outro cliente (só a etiqueta kit:<id>).
 *
 * Apelidos aceitos (a tela escreveu em paralelo): cartão "texto" = "prompt",
 * "gerar" = "saida"; no_gerar_id = no_saida_id; motor_id = modelo_imagem_id.
 * O canvas é gravado sempre com os nomes da função (canvas-regras.ts); o
 * formato, a qualidade e a resolução vêm do cartão de resultado salvo.
 *
 * A imagem gerada entra no acervo (cliente_imagens: gerada, modo 'canvas',
 * kit_id do produto, tags persona:<id>) e serve às três mesas; aprovar é a
 * ação acervo_decidir que já existe.
 */

import {
  capacidadesDoModelo,
  carregarModelo,
  chamarImagem,
  chamarTexto,
  cobrarJev,
  estimarComModelo,
  type ImagemEntrada,
  lerResolucao,
  limiteDeReferencias,
  type ModeloIa,
  type Qualidade,
  type Resolucao,
  type SaidaImagem,
} from "../_shared/ia-motor.ts";
import { resolucaoParaModelo } from "../_shared/capacidades-imagem.ts";
import { lerMarcaParaDirecaoDaMarca, marcaDoPedido } from "../_shared/marca.ts";
import { JevErro, jevPerguntar, notaScore, probabilidadeNoul } from "../_shared/jev.ts";
import { arred6, dimensoesDaImagem, ErroDeRegra, extensaoDe, limpo, mimeDe, normalizarConferencia, sha256Hex, UUID } from "./calculos.ts";
import {
  ACOES_DO_RESULTADO,
  ambienteDoContexto,
  ANGULOS_DE_VARIACAO,
  type CanvasNormalizado,
  canvasGravado,
  CHAVES_DOS_MODELOS_PRONTOS,
  entradasDaSaida,
  escolherSaida,
  garantirQueDaParaGerar,
  historicoDoAgente,
  idsDoCanvas,
  LIMITE_REFERENCIAS_DO_CANVAS,
  lerAngulo,
  lerPedidoDoCanvas,
  lerQuadro,
  type NoCanvas,
  normalizarCanvas,
  ordenarComBase,
  type PessoaDoPedido,
  type PessoaRealDoPedido,
  POSES_DO_RESULTADO,
  type ProdutoDoPedido,
  promptDoCanvas,
  QUADROS_DO_CARROSSEL,
  type ReferenciaCandidata,
  type ReferenciaMontada,
  respostaDoAgente,
  resultadosDaSaida,
  textosDasEntradas,
} from "./canvas-regras.ts";
import type { Chamador, FerramentasDaMesa, ItemDaBibliotecaLido } from "./ferramentas.ts";
import type { LinhaImagemPersona, LinhaPersona } from "./modelos.ts";
import { garantirPermitido, identidadesDaVista, NIVEIS_PELE, personaUsavel } from "./personas.ts";
import { FORMATOS, type Formato, TAMANHO_DO_FORMATO } from "./receitas.ts";

export const REF_CANVAS = "foto_canvas";
/** Padrão do Canvas (pesquisa, seção 4.3): GPT Image 2.5 Sunburst em qualidade alta. */
export const MOTOR_PADRAO_DO_CANVAS = "openrouter:openai/gpt-image-2.5-sunburst";
const LADO_REFERENCIA = 1024;
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];

type LinhaCanvas = {
  id: string;
  client_id: string;
  nome: string;
  nos: NoCanvas[];
  ligacoes: CanvasNormalizado["ligacoes"];
  viewport: CanvasNormalizado["viewport"];
  versao: number;
  status: string;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

type LinhaGeracao = {
  id: string;
  canvas_id: string;
  client_id: string;
  no_saida_id: string;
  motor_id: string;
  qualidade: string;
  resolucao: string | null;
  formato: string;
  montado: { referencias: ReferenciaMontada[]; prompt: string; avisos: string[] };
  status: string;
  ultimo_erro: string | null;
  imagem_id: string | null;
  conferencia: Record<string, unknown> | null;
  custo_usd: number | string;
  uso_id: string | null;
  criado_por: string | null;
  criado_em: string;
};

/** Onde baixar cada referência (acervo, persona ou biblioteca). */
type Fonte =
  | { tipo: "acervo"; bucket: string; caminho: string; nome: string }
  | { tipo: "persona"; bucket: string; caminho: string; nome: string }
  | { tipo: "biblioteca"; item: ItemDaBibliotecaLido };

const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroDeRegra(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};

const PAPEIS_DE_PRODUTO = ["identidade", "detalhe", "rotulo", "verso", "embalagem"];

export function acoesDoCanvas(f: FerramentasDaMesa) {
  const db = () => f.servico();

  async function lerCanvas(id: string): Promise<LinhaCanvas> {
    const { data, error } = await db().from("foto_canvas").select("*").eq("id", id).maybeSingle();
    if (error) throw new ErroDeRegra(503, "canvas_indisponivel", "Não foi possível ler o canvas (a migration 03 foi aplicada?).");
    if (!data) throw new ErroDeRegra(404, "canvas_inexistente", "Canvas não encontrado.");
    const c = data as LinhaCanvas;
    // Forma da função mesmo para canvas gravado com os nomes da tela (texto, gerar).
    const grafo = canvasGravado(c);
    c.nos = grafo.nos;
    c.ligacoes = grafo.ligacoes;
    return c;
  }

  async function canvasComAcesso(ch: Chamador, id: string): Promise<LinhaCanvas> {
    const c = await lerCanvas(id);
    await f.garantirAcesso(ch, c.client_id);
    return c;
  }

  /**
   * Todo id citado no canvas existe e é do cliente (regra da casa: validar id
   * contra o banco em toda escrita). Kit de outro cliente (esteira) volta em
   * clientesDosKits para quem chamou conferir o acesso a esse cliente.
   */
  async function conferirIds(clientId: string, c: CanvasNormalizado): Promise<{ clientesDosKits: string[] }> {
    const ids = idsDoCanvas(c);
    const fora: Record<string, string[]> = {};
    const clientesDosKits = new Set<string>();
    if (ids.kits.length) {
      const { data } = await db().from("foto_kits").select("id, client_id").in("id", ids.kits);
      const achados = (data as { id: string; client_id: string }[] | null) ?? [];
      achados.forEach((k) => {
        if (k.client_id !== clientId) clientesDosKits.add(k.client_id);
      });
      const ok = new Set(achados.map((k) => k.id));
      const faltam = ids.kits.filter((k) => !ok.has(k));
      if (faltam.length) fora.kits = faltam;
    }
    if (ids.modelos.length) {
      const { data } = await db().from("foto_modelos").select("id, client_id").in("id", ids.modelos);
      const ok = new Set(((data as { id: string; client_id: string | null }[] | null) ?? []).filter((m) => m.client_id == null || m.client_id === clientId).map((m) => m.id));
      const faltam = ids.modelos.filter((m) => !ok.has(m));
      if (faltam.length) fora.modelos = faltam;
    }
    if (ids.imagens.length) {
      const achadas = await f.lerImagens(clientId, ids.imagens);
      const faltam = ids.imagens.filter((i) => !achadas.some((a) => a.id === i));
      if (faltam.length) fora.imagens = faltam;
    }
    if (ids.biblioteca.length) {
      const itens = await f.lerItensDaBiblioteca(clientId, ids.biblioteca);
      const faltam = ids.biblioteca.filter((i) => !itens.some((x) => x.id === i));
      if (faltam.length) fora.biblioteca = faltam;
    }
    if (Object.keys(fora).length) {
      throw new ErroDeRegra(409, "id_fora_do_cliente", "O canvas cita kit, persona, imagem ou item da biblioteca que não existe ou é de outro cliente.", { fora });
    }
    return { clientesDosKits: [...clientesDosKits] };
  }

  // ---------------------------------------------------------------- montagem

  type Montagem = {
    canvas: LinhaCanvas;
    saida: NoCanvas;
    m: ModeloIa;
    qualidade: Qualidade;
    resolucao: Resolucao | null;
    formato: Formato;
    referencias: ReferenciaMontada[];
    cortadas: ReferenciaCandidata[];
    fontes: Map<string, Fonte>;
    prompt: string;
    avisos: string[];
    kitIds: string[];
    /** Kits deste cliente (os de outro cliente só entram como etiqueta). */
    kitIdsDoCliente: string[];
    personaIds: string[];
    primeiraDoProduto: string | null;
    estimativa_usd: number;
    limite: number;
    /** Série (v3): foto base, ângulo e posição no carrossel. */
    base_imagem_id: string | null;
    angulo: number | null;
    quadro: { atual: number; total: number } | null;
    grupo: string | null;
  };

  async function montar(ch: Chamador, canvas: LinhaCanvas, corpo: Record<string, unknown>): Promise<Montagem> {
    // no_saida_id e modelo_imagem_id (a tela também manda no_gerar_id e motor_id: mesmos campos).
    const pedido = lerPedidoDoCanvas(corpo);
    const saida = escolherSaida(canvas, pedido.no_saida_id);
    const entradas = entradasDaSaida(canvas, saida.id);
    garantirQueDaParaGerar(entradas);
    const motores = Array.isArray(saida.dados.motores) ? (saida.dados.motores as string[]) : [];
    const motorId = pedido.modelo_imagem_id || motores[0] || MOTOR_PADRAO_DO_CANVAS;
    const m = await carregarModelo(motorId, "imagem");
    const qualidade = (QUALIDADES.includes(corpo.qualidade as Qualidade) ? corpo.qualidade : QUALIDADES.includes(saida.dados.qualidade as Qualidade) ? saida.dados.qualidade : "alta") as Qualidade;
    const resolucao = lerResolucao(corpo.resolucao) ?? lerResolucao(saida.dados.resolucao);
    const formato = (String(saida.dados.formato ?? "4:5") in TAMANHO_DO_FORMATO ? String(saida.dados.formato ?? "4:5") : "4:5") as Formato;
    const avisos: string[] = [];
    const fontes = new Map<string, Fonte>();
    const candidatas: ReferenciaCandidata[] = [];
    const produtos: ProdutoDoPedido[] = [];
    const pessoas: PessoaDoPedido[] = [];
    const pessoasReais: PessoaRealDoPedido[] = [];
    const kitIds: string[] = [];
    const kitIdsDoCliente: string[] = [];
    const personaIds: string[] = [];
    let primeiraDoProduto: string | null = null;

    // Produto do kit: identidade invariante (a vista escolhida no cartão ou a ordem de prioridade do kit).
    for (const no of entradas.produto) {
      // lerKitComRefs confere o acesso ao cliente do kit (can_access_client): produto de outro cliente vale para a equipe com acesso.
      const { kit, refs } = await f.lerKitComRefs(ch, String(no.dados.kit_id));
      if (kit.status === "arquivado") throw new ErroDeRegra(409, "kit_arquivado", `O kit ${kit.nome} está arquivado.`, { no_id: no.id });
      if (kit.tipo === "pessoa") throw new ErroDeRegra(409, "kit_de_pessoa", "Pessoa real não entra no cartão de produto. Use o cartão de pessoa.", { no_id: no.id });
      kitIds.push(kit.id);
      if (kit.client_id === canvas.client_id) kitIdsDoCliente.push(kit.id);
      else avisos.push(`O produto ${kit.nome} é de outro cliente: a cobrança fica no cliente deste canvas.`);
      const utilizaveis = refs.filter((r) => PAPEIS_DE_PRODUTO.includes(r.papel) && !(r.imagem.gerada && !r.imagem.aprovada));
      const escolhidas = Array.isArray(no.dados.imagem_ids) && (no.dados.imagem_ids as string[]).length
        ? (no.dados.imagem_ids as string[]).map((id) => utilizaveis.find((r) => r.imagem_id === id)).filter((r): r is typeof utilizaveis[number] => !!r)
        : [...utilizaveis].sort((a, b) => {
          const grupo = (p: string) => (p === "identidade" ? 0 : p === "embalagem" ? 2 : 1);
          return grupo(a.papel) - grupo(b.papel) || (a.vista === "frente" ? -1 : 0) - (b.vista === "frente" ? -1 : 0) || a.prioridade - b.prioridade;
        });
      const temIdentidade = escolhidas.some((r) => r.papel !== "embalagem");
      const lista = temIdentidade ? escolhidas.filter((r) => r.papel !== "embalagem") : escolhidas;
      if (!lista.length) avisos.push(`O kit ${kit.nome} não tem foto utilizável: o produto vai só pelo texto.`);
      if (!temIdentidade && lista.length) avisos.push(`O kit ${kit.nome} só tem a embalagem: o produto aparece como a caixa.`);
      for (const r of lista) {
        candidatas.push({ papel: "produto", origem: { tipo: "kit", id: kit.id, no_id: no.id }, imagem_id: r.imagem_id, titulo: kit.nome, legenda: `${r.papel}${r.vista ? `, vista ${r.vista}` : ""}` });
        fontes.set(`acervo:${r.imagem_id}`, { tipo: "acervo", bucket: r.imagem.storage_bucket, caminho: r.imagem.storage_path, nome: r.imagem.nome });
        if (kit.client_id === canvas.client_id) primeiraDoProduto = primeiraDoProduto ?? r.imagem_id;
      }
      produtos.push({ no_id: no.id, nome: kit.nome, variante: kit.variante, invariantes: kit.invariantes ?? [], lacunas: kit.lacunas ?? [] });
    }

    // Pessoa real (foto do acervo deste cliente, com autorização marcada no cartão).
    const reais = entradas.modelo.filter((n) => !n.dados.modelo_id && n.dados.imagem_id);
    const fotosReais = reais.length ? await f.lerImagens(canvas.client_id, reais.map((n) => String(n.dados.imagem_id))) : [];
    for (const no of reais) {
      const img = fotosReais.find((x) => x.id === String(no.dados.imagem_id));
      if (!img) throw new ErroDeRegra(409, "id_fora_do_cliente", "A foto da pessoa não está no acervo deste cliente.", { no_id: no.id });
      candidatas.push({ papel: "pessoa", origem: { tipo: "acervo", id: img.id, no_id: no.id }, imagem_id: img.id, titulo: img.nome, legenda: "pessoa real" });
      fontes.set(`acervo:${img.id}`, { tipo: "acervo", bucket: img.storage_bucket, caminho: img.storage_path, nome: img.nome });
      pessoasReais.push({ no_id: no.id, nome: limpo(no.dados.titulo, 60) });
    }

    // Persona: identidade da pessoa (âncora e vistas aprovadas).
    for (const no of entradas.modelo.filter((n) => !!n.dados.modelo_id)) {
      const { data } = await db().from("foto_modelos").select("*").eq("id", String(no.dados.modelo_id)).maybeSingle();
      const p = data as LinhaPersona | null;
      if (!p || (p.client_id && p.client_id !== canvas.client_id)) throw new ErroDeRegra(409, "persona_fora_do_cliente", "Esta persona não existe ou é de outro cliente.", { no_id: no.id });
      const uso = personaUsavel(p.status);
      if (!uso.ok) throw new ErroDeRegra(409, "persona_sem_ancora", `A persona ${p.nome} ainda não tem âncora escolhida.`, { no_id: no.id, status: p.status });
      if (uso.aviso) avisos.push(`${p.nome}: ${uso.aviso}`);
      personaIds.push(p.id);
      const { data: imgs } = await db().from("foto_modelo_imagens").select("*").eq("modelo_id", p.id).limit(500);
      const todas = (imgs as LinhaImagemPersona[] | null) ?? [];
      const ancora = todas.find((i) => i.id === p.ancora_imagem_id);
      if (ancora) {
        for (const i of identidadesDaVista(ancora, todas, "frente", 5)) {
          candidatas.push({ papel: "pessoa", origem: { tipo: "persona", id: p.id, no_id: no.id }, imagem_id: i.id, titulo: p.nome, legenda: i.id === ancora.id ? "âncora" : `vista ${i.vista ?? ""}`.trim() });
          fontes.set(`persona:${i.id}`, { tipo: "persona", bucket: i.storage_bucket, caminho: i.storage_path, nome: `persona-${p.nome}` });
        }
      }
      pessoas.push({ no_id: no.id, nome: p.nome, ficha: p.ficha, invariantes: p.invariantes ?? [] });
    }

    // Ambiente e estilo (foto do acervo ou referência da biblioteca); ambiente "contexto" sai da marca do cliente.
    const ambientes: { texto: string | null; no_id: string; modo: string; uso: string; comFoto: boolean }[] = [];
    const estilos: { guia: string | null }[] = [];
    const idsBiblioteca = [
      ...entradas.ambiente.map((n) => n.dados.biblioteca_id).filter(Boolean),
      ...entradas.estilo.flatMap((n) => (n.dados.biblioteca_ids as string[] | undefined) ?? []),
    ].map(String);
    const idsAcervo = [
      ...entradas.ambiente.map((n) => n.dados.imagem_id).filter(Boolean),
      ...entradas.estilo.flatMap((n) => (n.dados.imagem_ids as string[] | undefined) ?? []),
    ].map(String);
    const itens = idsBiblioteca.length ? await f.lerItensDaBiblioteca(canvas.client_id, idsBiblioteca) : [];
    const doAcervo = idsAcervo.length ? await f.lerImagens(canvas.client_id, idsAcervo) : [];
    const doAcervoOuBiblioteca = (no: NoCanvas, papel: "ambiente" | "estilo", id: string, deBiblioteca: boolean) => {
      if (deBiblioteca) {
        const item = itens.find((x) => x.id === id);
        if (!item) throw new ErroDeRegra(409, "id_fora_do_cliente", "Item da biblioteca não encontrado para este cliente.", { no_id: no.id });
        if (item.tipo === "prompt") return item;
        candidatas.push({ papel, origem: { tipo: "biblioteca", id: item.id, no_id: no.id }, imagem_id: item.id, titulo: item.titulo, legenda: papel });
        fontes.set(`biblioteca:${item.id}`, { tipo: "biblioteca", item });
        return null;
      }
      const img = doAcervo.find((x) => x.id === id);
      if (!img) throw new ErroDeRegra(409, "id_fora_do_cliente", "Imagem do acervo não encontrada para este cliente.", { no_id: no.id });
      candidatas.push({ papel, origem: { tipo: "acervo", id: img.id, no_id: no.id }, imagem_id: img.id, titulo: img.nome, legenda: papel });
      fontes.set(`acervo:${img.id}`, { tipo: "acervo", bucket: img.storage_bucket, caminho: img.storage_path, nome: img.nome });
      return null;
    };
    const precisaDoContexto = entradas.ambiente.some((n) => n.dados.modo === "contexto" && !n.dados.texto);
    const contexto = precisaDoContexto && f.contextoDoCliente ? await f.contextoDoCliente(canvas.client_id, undefined, corpo.marca_id).catch(() => null) : null;
    for (const no of entradas.ambiente) {
      const textos: string[] = [];
      const modo = String(no.dados.modo || "descrever");
      if (no.dados.imagem_id) doAcervoOuBiblioteca(no, "ambiente", String(no.dados.imagem_id), false);
      if (no.dados.biblioteca_id) {
        const prompt = doAcervoOuBiblioteca(no, "ambiente", String(no.dados.biblioteca_id), true);
        if (prompt) textos.push(limpo(prompt.prompt_pt || prompt.prompt_en, 800));
      }
      if (no.dados.texto) textos.push(String(no.dados.texto));
      else if (modo === "contexto") textos.push(ambienteDoContexto(contexto ? lerContextoDoAmbiente(contexto) : null));
      ambientes.push({ texto: textos.filter(Boolean).join(" ") || null, no_id: no.id, modo, uso: String(no.dados.uso || "complementar"), comFoto: !!(no.dados.imagem_id || no.dados.biblioteca_id) });
    }
    for (const no of entradas.estilo) {
      const guias: string[] = [];
      for (const id of (no.dados.imagem_ids as string[] | undefined) ?? []) doAcervoOuBiblioteca(no, "estilo", id, false);
      for (const id of (no.dados.biblioteca_ids as string[] | undefined) ?? []) {
        const prompt = doAcervoOuBiblioteca(no, "estilo", id, true);
        if (prompt) guias.push([limpo(prompt.prompt_pt || prompt.prompt_en, 800), prompt.negativo ? `Evite: ${limpo(prompt.negativo, 300)}.` : ""].filter(Boolean).join(" "));
      }
      if (no.dados.guia) guias.push(String(no.dados.guia));
      estilos.push({ guia: guias.filter(Boolean).join(" ") || null });
    }

    // Série (v3): foto base (identidade da cena), ângulo obrigatório e posição no carrossel.
    let base: ReferenciaCandidata | null = null;
    const baseId = corpo.base_imagem_id != null && corpo.base_imagem_id !== "" ? idDe(corpo.base_imagem_id, "base_imagem_id") : null;
    if (baseId) {
      const [img] = await f.lerImagens(canvas.client_id, [baseId]);
      if (!img) throw new ErroDeRegra(409, "id_fora_do_cliente", "A foto base não está no acervo deste cliente.", { base_imagem_id: baseId });
      base = { papel: "base", origem: { tipo: "acervo", id: img.id, no_id: saida.id }, imagem_id: img.id, titulo: img.nome, legenda: "foto base" };
      fontes.set(`acervo:${img.id}`, { tipo: "acervo", bucket: img.storage_bucket, caminho: img.storage_path, nome: img.nome });
    }
    const angulo = lerAngulo(corpo.angulo);
    const quadro = lerQuadro(corpo.quadro, corpo.quadros);
    const grupo = /^[A-Za-z0-9_-]{1,64}$/.test(String(corpo.grupo ?? "")) ? String(corpo.grupo) : null;

    const limite = Math.max(1, Math.min(limiteDeReferencias(m), LIMITE_REFERENCIAS_DO_CANVAS));
    const ordem = ordenarComBase(base, candidatas, limite);
    avisos.push(...ordem.avisos);
    const ajuste = resolucaoParaModelo(capacidadesDoModelo(m), resolucao);
    if (ajuste.aviso) avisos.push(ajuste.aviso);
    // Cores da marca escolhida no topo (Acerbi ou CME); sem marca, as do cliente.
    const marca = await (corpo.marca_id === undefined ? Promise.resolve(null) : marcaDoPedido(db(), canvas.client_id, corpo))
      .then((m) => lerMarcaParaDirecaoDaMarca(db(), canvas.client_id, m)).catch(() => null);
    const paleta = (marca?.paleta ?? [])
      .map((p) => (typeof p?.hex === "string" && /^#[0-9a-f]{3,8}$/i.test(p.hex) ? p.hex.toUpperCase() : null))
      .filter((x): x is string => !!x).slice(0, 5);
    const prompt = promptDoCanvas({
      referencias: ordem.referencias,
      produtos,
      pessoas,
      pessoasReais,
      ambientes,
      estilos,
      textos: textosDasEntradas(entradas),
      formato,
      marca: marca ? { nome: marca.nomeCliente, paleta } : null,
      acao: String(saida.dados.acao || "livre"),
      pose: String(saida.dados.pose || "nenhuma"),
      angulo,
      quadro,
    });
    const tamanho = TAMANHO_DO_FORMATO[formato];
    const estimativa = estimarComModelo(m, {
      imagens: 1,
      qualidade,
      tokensEntrada: Math.ceil(prompt.length / 3.5) + ordem.referencias.length * 1_600,
      resolucao: ajuste.resolucao,
      imagensEntrada: ordem.referencias.length,
      tamanho,
    });
    return {
      canvas, saida, m, qualidade, resolucao, formato,
      referencias: ordem.referencias,
      cortadas: ordem.cortadas,
      fontes,
      prompt,
      avisos: Array.from(new Set(avisos)),
      kitIds,
      kitIdsDoCliente,
      personaIds,
      primeiraDoProduto,
      estimativa_usd: estimativa,
      limite,
      base_imagem_id: base ? base.imagem_id : null,
      angulo,
      quadro,
      grupo,
    };
  }

  const chaveDaFonte = (r: ReferenciaCandidata) =>
    r.origem.tipo === "persona" ? `persona:${r.imagem_id}` : r.origem.tipo === "biblioteca" ? `biblioteca:${r.imagem_id}` : `acervo:${r.imagem_id}`;

  async function urlDaFonte(fonte: Fonte | undefined): Promise<string | null> {
    if (!fonte) return null;
    if (fonte.tipo === "biblioteca") {
      if (fonte.item.storage_path) return await f.urlAssinada("mesa", fonte.item.storage_path);
      return fonte.item.imagem_url;
    }
    return await f.urlAssinada(fonte.bucket, fonte.caminho);
  }

  async function baixarFonte(clientId: string, fonte: Fonte | undefined): Promise<ImagemEntrada> {
    if (!fonte) throw new ErroDeRegra(500, "referencia_sumiu", "Uma referência do canvas sumiu durante a montagem.");
    if (fonte.tipo === "biblioteca") return await f.imagemDoItemDaBiblioteca(clientId, fonte.item, LADO_REFERENCIA);
    return await f.baixarReduzida(fonte.bucket, fonte.caminho, LADO_REFERENCIA, fonte.nome);
  }

  const semBytes = (mt: Montagem) => ({
    canvas_id: mt.canvas.id,
    no_saida_id: mt.saida.id,
    modelo_imagem_id: mt.m.id,
    qualidade: mt.qualidade,
    resolucao: resolucaoParaModelo(capacidadesDoModelo(mt.m), mt.resolucao).resolucao,
    formato: mt.formato,
    limite_referencias: mt.limite,
    prompt: mt.prompt,
    avisos: mt.avisos,
    estimativa_usd: mt.estimativa_usd,
    base_imagem_id: mt.base_imagem_id,
    angulo: mt.angulo,
    angulo_texto: mt.angulo === null ? null : ANGULOS_DE_VARIACAO[mt.angulo],
    quadro: mt.quadro,
    grupo: mt.grupo,
  });

  // ---------------------------------------------------------------- ações

  async function canvasListar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    let q = db().from("foto_canvas").select("id, client_id, nome, versao, status, nos, criado_em, atualizado_em").eq("client_id", clientId).order("atualizado_em", { ascending: false }).limit(200);
    if (corpo.incluir_arquivados !== true) q = q.neq("status", "arquivado");
    const { data, error } = await q;
    if (error) throw new ErroDeRegra(503, "canvas_indisponivel", "Não foi possível ler os canvases (a migration 03 foi aplicada?).");
    const canvases = ((data as (LinhaCanvas & { nos: unknown[] })[] | null) ?? []).map(({ nos, ...c }) => ({ ...c, cartoes: Array.isArray(nos) ? nos.length : 0 }));
    return f.json({ canvases, custo_usd: 0 });
  }

  async function canvasLer(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await canvasComAcesso(ch, idDe(corpo.canvas_id, "canvas_id"));
    const { data } = await db().from("foto_canvas_geracoes").select("*").eq("canvas_id", c.id).order("criado_em", { ascending: false }).limit(100);
    const geracoes = (data as LinhaGeracao[] | null) ?? [];
    const imagens = await f.lerImagens(c.client_id, geracoes.map((g) => g.imagem_id).filter((x): x is string => !!x));
    const comUrl = await f.emParalelo(geracoes, 6, async (g) => {
      const img = imagens.find((i) => i.id === g.imagem_id);
      return { ...g, url: img ? await f.urlAssinada(img.storage_bucket, img.storage_path) : null, aprovada: img?.aprovada ?? null };
    });
    return f.json({ canvas: c, geracoes: comUrl, custo_usd_total: arred6(geracoes.reduce((s, g) => s + Number(g.custo_usd || 0), 0)), custo_usd: 0 });
  }

  async function canvasSalvar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    const bruto = (corpo.canvas && typeof corpo.canvas === "object" ? corpo.canvas : {}) as Record<string, unknown>;
    const c = normalizarCanvas(bruto);
    const conferidos = await conferirIds(clientId, c);
    // Produto de outro cliente (esteira): a equipe precisa ter acesso ao cliente do kit.
    for (const outro of conferidos.clientesDosKits) await f.garantirAcesso(ch, outro);
    const campos = { nome: c.nome, nos: c.nos, ligacoes: c.ligacoes, viewport: c.viewport };
    const id = String(bruto.id ?? "").trim();
    if (!id) {
      const { data, error } = await db().from("foto_canvas").insert({ ...campos, client_id: clientId, versao: 1, status: "ativo", criado_por: ch.userId }).select("*").single();
      if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível criar o canvas (a migration 03 foi aplicada?).");
      return f.json({ canvas: data, custo_usd: 0 });
    }
    if (!UUID.test(id)) throw new ErroDeRegra(400, "canvas_id_invalido", "canvas.id precisa ser um UUID.");
    const atual = await lerCanvas(id);
    if (atual.client_id !== clientId) throw new ErroDeRegra(409, "canvas_de_outro_cliente", "Este canvas é de outro cliente.");
    const esperada = Number(corpo.versao_esperada);
    if (!Number.isInteger(esperada)) throw new ErroDeRegra(400, "versao_esperada_obrigatoria", "Mande a versão que a tela tinha (versao_esperada) para não apagar mudança de outra aba.");
    if (esperada !== atual.versao) {
      throw new ErroDeRegra(409, "canvas_mudou", "O canvas mudou em outra aba. Recarregue antes de salvar.", { versao_atual: atual.versao, canvas: atual });
    }
    const patch: Record<string, unknown> = { ...campos, versao: atual.versao + 1 };
    if (corpo.arquivar === true) patch.status = "arquivado";
    if (corpo.arquivar === false) patch.status = "ativo";
    const { data, error } = await db().from("foto_canvas").update(patch).eq("id", id).eq("versao", atual.versao).select("*").maybeSingle();
    if (error) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível gravar o canvas.");
    if (!data) {
      const agora = await lerCanvas(id);
      throw new ErroDeRegra(409, "canvas_mudou", "O canvas mudou em outra aba. Recarregue antes de salvar.", { versao_atual: agora.versao, canvas: agora });
    }
    return f.json({ canvas: data, custo_usd: 0 });
  }

  async function canvasMontar(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await canvasComAcesso(ch, idDe(corpo.canvas_id, "canvas_id"));
    const mt = await montar(ch, c, corpo);
    const referencias = await f.emParalelo(mt.referencias, 6, async (r) => ({ ...r, url: await urlDaFonte(mt.fontes.get(chaveDaFonte(r))) }));
    return f.json({ ...semBytes(mt), referencias, cortadas: mt.cortadas, custo_usd: 0 });
  }

  async function canvasGerar(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await canvasComAcesso(ch, idDe(corpo.canvas_id, "canvas_id"));
    if (c.status === "arquivado") throw new ErroDeRegra(409, "canvas_arquivado", "O canvas está arquivado.");
    const mt = await montar(ch, c, corpo);
    const imagens = await f.emParalelo(mt.referencias, 4, (r) => baixarFonte(c.client_id, mt.fontes.get(chaveDaFonte(r))));
    const montado = { referencias: mt.referencias, prompt: mt.prompt, avisos: mt.avisos, base_imagem_id: mt.base_imagem_id, angulo: mt.angulo, quadro: mt.quadro, grupo: mt.grupo };
    const { data: criada, error: e0 } = await db().from("foto_canvas_geracoes").insert({
      canvas_id: c.id,
      client_id: c.client_id,
      no_saida_id: mt.saida.id,
      motor_id: mt.m.id,
      qualidade: mt.qualidade,
      resolucao: mt.resolucao,
      formato: mt.formato,
      montado,
      status: "gerando",
      criado_por: ch.userId,
    }).select("*").single();
    if (e0 || !criada) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível registrar a geração (a migration 03 foi aplicada?).");
    const geracao = criada as LinhaGeracao;
    let saida: SaidaImagem;
    try {
      saida = await chamarImagem({
        clientId: c.client_id,
        modeloId: mt.m.id,
        prompt: mt.prompt,
        referencias: imagens,
        qualidade: mt.qualidade,
        tamanho: TAMANHO_DO_FORMATO[mt.formato],
        resolucao: mt.resolucao,
        seed: Number.isFinite(Number(corpo.seed)) && corpo.seed != null && corpo.seed !== "" ? Math.max(0, Math.floor(Number(corpo.seed))) : null,
        referencia: { tipo: REF_CANVAS, id: c.id },
        criadoPor: ch.userId,
        tarefa: "estudio",
        agente: "gerador_imagem",
      });
    } catch (e) {
      // Falha fica escrita na geração; tentar de novo é pedido da equipe (sem laço aqui).
      await db().from("foto_canvas_geracoes").update({ status: "falhou", ultimo_erro: e instanceof Error ? e.message.slice(0, 300) : "Falha do gerador." }).eq("id", geracao.id);
      throw e;
    }
    const mime = mimeDe(saida.png) ?? (saida.mime || "image/png");
    const dim = dimensoesDaImagem(saida.png);
    const sha = await sha256Hex(saida.png);
    const caminho = `${c.client_id}/foto/canvas/${c.id}/${geracao.id}.${extensaoDe(mime)}`;
    try {
      await f.salvarNoMesa(caminho, saida.png, mime);
    } catch (e) {
      await db().from("foto_canvas_geracoes").update({ status: "falhou", ultimo_erro: "A imagem foi gerada e cobrada, mas não foi guardada.", custo_usd: arred6(saida.custoUsd), uso_id: saida.usoId || null }).eq("id", geracao.id);
      throw e;
    }
    const comPessoa = mt.personaIds.length > 0;
    const { data: img, error: e1 } = await db().from("cliente_imagens").insert({
      client_id: c.client_id,
      origem: "mesa_foto",
      storage_bucket: "mesa",
      storage_path: caminho,
      nome: `${c.nome}, ${limpo(mt.saida.dados.titulo, 60) || "resultado"} (${saida.modeloId.split("/").pop()})`.slice(0, 160),
      pasta: "Mesa Foto / Canvas",
      categoria: comPessoa ? "pessoa" : "produto",
      tags: Array.from(new Set([
        "mesa_foto", "canvas", "gerada", `canvas:${c.id}`,
        ...mt.kitIds.map((k) => `kit:${k}`),
        ...mt.personaIds.map((p) => `persona:${p}`),
        ...(comPessoa ? ["pessoa_sintetica"] : []),
        ...(mt.grupo ? [`serie:${mt.grupo}`] : []),
        ...(mt.quadro ? ["carrossel"] : mt.base_imagem_id ? ["variacao"] : []),
      ])).slice(0, 30),
      descricao: `Imagem gerada por IA no Canvas "${c.nome}" (motor ${saida.modeloId}).${comPessoa ? " Pessoa sintética: ao publicar, ligue o rótulo de IA." : ""}`.slice(0, 1000),
      // Variação: nasce da foto base; senão, da primeira foto do produto deste cliente (nunca de outro cliente).
      derivada_de: mt.base_imagem_id ?? mt.primeiraDoProduto,
      gerada: true,
      modo: "canvas",
      kit_id: mt.kitIdsDoCliente[0] ?? null,
      sha256: sha,
      largura: dim?.largura ?? null,
      altura: dim?.altura ?? null,
      aprovada: false,
    }).select(f.camposImagem).single();
    if (e1 || !img) {
      await db().from("foto_canvas_geracoes").update({ status: "falhou", ultimo_erro: "A imagem foi gerada, mas não entrou no acervo.", custo_usd: arred6(saida.custoUsd), uso_id: saida.usoId || null }).eq("id", geracao.id);
      throw new ErroDeRegra(503, "gravacao_falhou", "A imagem foi gerada e cobrada, mas não entrou no acervo (a migration 03 aceita o modo canvas?).", { uso_id: saida.usoId, custo_usd: saida.custoUsd, caminho });
    }
    const imagem = img as unknown as { id: string };
    const { data: final } = await db().from("foto_canvas_geracoes").update({
      status: "gerada",
      imagem_id: imagem.id,
      custo_usd: arred6(saida.custoUsd),
      uso_id: saida.usoId || null,
      resolucao: saida.resolucao ?? mt.resolucao,
      montado: { ...montado, avisos: Array.from(new Set([...montado.avisos, ...(saida.avisos ?? [])])) },
    }).eq("id", geracao.id).select("*").single();
    const url = await f.urlAssinada("mesa", caminho);
    return f.json({
      geracao: final ?? geracao,
      imagem: { ...(img as unknown as Record<string, unknown>), url },
      url,
      montado: { ...semBytes(mt), referencias: mt.referencias },
      aviso: comPessoa ? "Pessoa sintética. Ao publicar, ligue o rótulo de IA." : null,
      custo_usd: saida.custoUsd,
      saldo_usd: saida.saldoUsd,
      reserva_usada: saida.reservaUsada ?? null,
      avisos: Array.from(new Set([...mt.avisos, ...(saida.avisos ?? [])])),
      grupo: mt.grupo,
      quadro: mt.quadro ? mt.quadro.atual : null,
    });
  }

  const SISTEMA_CONFERENCIA_CANVAS = `Você é o conferente de fotografia publicitária do estúdio da agência Aceleriq. A PRIMEIRA imagem é a foto gerada no Canvas. Depois vêm as fontes: fotos reais do produto (a verdade sobre o produto) e, quando houver, a âncora da persona sintética (a verdade sobre o rosto).
Compare critério por critério: ok true quando está fiel, false quando diverge, null quando não dá para avaliar. nota: o que você viu, curto e concreto.
alertas: só divergências críticas (produto trocado ou deformado, texto do rótulo diferente ou espelhado, peças a mais ou a menos, rosto de outra pessoa, aparência de menor de idade, mão deformada, sexualização).
pele: descreva a pele da pessoa (poros, textura, se parece plástico ou filtro); "sem pessoa" se não houver.
lembra_alguem: se o rosto lembra fortemente alguma pessoa pública conhecida; senão "não".
Não julgue beleza nem gosto. Português do Brasil, sem travessão. Responda só com o JSON pedido.`;

  async function canvasConferir(ch: Chamador, corpo: Record<string, unknown>) {
    const geracaoId = idDe(corpo.geracao_id, "geracao_id");
    const { data, error } = await db().from("foto_canvas_geracoes").select("*").eq("id", geracaoId).maybeSingle();
    if (error) throw new ErroDeRegra(503, "canvas_indisponivel", "Não foi possível ler a geração.");
    if (!data) throw new ErroDeRegra(404, "geracao_inexistente", "Geração não encontrada.");
    const g = data as LinhaGeracao;
    await f.garantirAcesso(ch, g.client_id);
    if (!g.imagem_id) throw new ErroDeRegra(409, "geracao_sem_imagem", "Esta geração não tem imagem para conferir.");
    const [imagem] = await f.lerImagens(g.client_id, [g.imagem_id]);
    if (!imagem) throw new ErroDeRegra(404, "imagem_inexistente", "A imagem desta geração saiu do acervo.");
    const refs = Array.isArray(g.montado?.referencias) ? g.montado.referencias : [];
    const doProduto = refs.filter((r) => r.papel === "produto").slice(0, 3);
    const daPessoa = refs.filter((r) => r.papel === "pessoa").slice(0, 1);
    const acervo = await f.lerImagens(g.client_id, doProduto.map((r) => r.imagem_id));
    const { data: pimgs } = daPessoa.length ? await db().from("foto_modelo_imagens").select("*").in("id", daPessoa.map((r) => r.imagem_id)) : { data: [] };
    const personaImgs = (pimgs as LinhaImagemPersona[] | null) ?? [];
    const temPessoa = refs.some((r) => r.papel === "pessoa") || (imagem.tags ?? []).includes("pessoa_sintetica");
    const [gerada, ...fontes] = await Promise.all([
      f.baixarReduzida(imagem.storage_bucket, imagem.storage_path, 1280, "gerada"),
      ...acervo.map((a) => f.baixarReduzida(a.storage_bucket, a.storage_path, 1024, `produto-${a.nome}`)),
      ...personaImgs.map((p) => f.baixarReduzida(p.storage_bucket, p.storage_path, 1024, "persona-ancora")),
    ]);
    const criterios = [
      ...(acervo.length ? ["formato e silhueta do produto", "cor e acabamento do produto", "logotipo e texto do produto", "proporção e escala do produto"] : []),
      ...(temPessoa ? ["rosto igual ao da persona", "cabelo e tom de pele da persona", "idade adulta", "mãos e anatomia"] : []),
      "luz coerente entre assunto e cenário",
      "sem texto ou marca inventados",
    ];
    const esquema = {
      nome: "conferencia_do_canvas",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["pontos", "alertas", "resumo", "pele", "lembra_alguem"],
        properties: {
          pontos: { type: "array", items: { type: "object", additionalProperties: false, required: ["criterio", "ok", "nota"], properties: { criterio: { type: "string", enum: criterios }, ok: { type: ["boolean", "null"] }, nota: { type: "string" } } } },
          alertas: { type: "array", items: { type: "string" } },
          resumo: { type: "string" },
          pele: { type: "string" },
          lembra_alguem: { type: "string" },
        },
      },
    };
    const legenda = [
      "Imagem 1 = foto gerada.",
      ...acervo.map((_, i) => `Imagem ${i + 2} = foto real do produto.`),
      ...personaImgs.map((_, i) => `Imagem ${acervo.length + i + 2} = âncora da persona sintética.`),
      `Critérios: ${criterios.join("; ")}.`,
    ].join("\n");
    const leitor = await f.modeloDeTexto("leitura", corpo.modelo_id);
    const lido = await chamarTexto({
      clientId: g.client_id,
      tarefa: "verificacao",
      agente: "leitor",
      modeloId: leitor.id,
      sistema: SISTEMA_CONFERENCIA_CANVAS,
      mensagens: [{ papel: "usuario", conteudo: legenda, imagens: [gerada, ...fontes] }],
      esquemaJson: esquema,
      maxTokensSaida: 4_000,
      timeoutMs: f.timeoutTextoMs,
      referencia: { tipo: REF_CANVAS, id: g.canvas_id },
      criadoPor: ch.userId,
    });
    const base = normalizarConferencia(lido.json, criterios);
    const bruto = (lido.json ?? {}) as Record<string, unknown>;
    const pele = limpo(bruto.pele, 400);
    const lembra = limpo(bruto.lembra_alguem, 300);
    let custo = lido.custoUsd;
    let jev: Record<string, unknown> = {};
    try {
      const perguntas: Parameters<typeof jevPerguntar>[0]["questions"] = {
        divergencia: {
          type: "noul",
          instructions: "A conferência em `conferencia` mostra divergência crítica entre a foto gerada e as fontes (produto trocado ou deformado, texto do rótulo alterado, rosto de outra pessoa, aparência de menor de idade, anatomia errada)?",
          criteria: { true: "Há divergência crítica: a foto não pode ser usada sem revisão.", false: "Não há divergência crítica nas evidências da conferência." },
        },
      };
      if (temPessoa) {
        perguntas.lembra_pessoa_publica = {
          type: "noul",
          instructions: "A descrição em `lembra_alguem` diz que o rosto lembra fortemente uma pessoa pública real e conhecida?",
          criteria: { true: "Sim: semelhança forte com alguém conhecido.", false: "Não: nenhuma semelhança forte apontada." },
        };
        perguntas.realismo_pele = { type: "score", instructions: "Pela descrição em `pele`, quão fotográfica e natural é a pele da pessoa?", criteria: NIVEIS_PELE };
      }
      const res = await jevPerguntar({ state: { conferencia: { pontos: base.pontos, alertas: base.alertas, resumo: base.resumo }, pele, lembra_alguem: lembra }, questions: perguntas });
      const cobrado = await cobrarJev(res, { clientId: g.client_id, tarefa: "verificacao", referencia: { tipo: REF_CANVAS, id: g.canvas_id }, criadoPor: ch.userId });
      if (cobrado) custo += cobrado.custoUsd;
      const div = probabilidadeNoul(res.answers.divergencia);
      const lp = temPessoa ? probabilidadeNoul(res.answers.lembra_pessoa_publica) : null;
      const rp = temPessoa ? notaScore(res.answers.realismo_pele) : null;
      jev = { divergencia_critica: div, lembra_pessoa_publica: lp, realismo_pele: rp, aviso: (div != null && div >= 0.5) || (lp != null && lp >= 0.5) || (rp != null && rp < 1.5) };
    } catch (e) {
      jev = { erro: e instanceof JevErro ? e.codigo : "jev_indisponivel" };
    }
    const alertas = [...base.alertas];
    if (jev.lembra_pessoa_publica != null && Number(jev.lembra_pessoa_publica) >= 0.5) alertas.push("Pode lembrar uma pessoa pública conhecida: confira antes de usar.");
    if (jev.realismo_pele != null && Number(jev.realismo_pele) < 1.5) alertas.push("Pele com cara de plástico ou retoque pesado.");
    const conferencia = {
      ...base,
      alertas: Array.from(new Set(alertas)),
      pele,
      lembra_alguem: lembra,
      jev,
      modelo_id: lido.modeloId,
      conferida_em: new Date().toISOString(),
      custo_usd: arred6(custo),
      aviso: "Só aviso: a equipe decide (aprovar pela ação acervo_decidir).",
    };
    await db().from("foto_canvas_geracoes").update({ conferencia }).eq("id", g.id);
    return f.json({ geracao_id: g.id, imagem_id: g.imagem_id, conferencia, custo_usd: arred6(custo), saldo_usd: lido.saldoUsd });
  }

  const SISTEMA_AGENTE_CANVAS = `Você é o diretor de fotografia do Canvas da agência Aceleriq, conversando com a equipe dentro do quadro de uma foto.
Você recebe o contexto real do cliente (marca, público, campanha), o que está ligado no resultado (produto, pessoa, ambiente, estilo, pedido, ação e pose) e, quando houver, a última foto gerada (a imagem anexada).
Seu trabalho: responder curto e prático, e escrever o PEDIDO do resultado, uma descrição de cena concreta em português (quem, o que faz com o produto, onde, luz, enquadramento, clima), pronta para o gerador. O produto do kit nunca muda (forma, cor, texto e logo).
Realismo acima de tudo: pele real, luz com fonte, escala certa do produto; quando pedirem UGC, pegada de celular, selfie ou review.
Sugira ação (acao) e pose (pose) só das listas; formato só da lista; modelo_pronto só da lista; kit_id e modelo_id só dos ids do contexto. Sem sugestão, use null.
tarefa "ambiente": descreva no campo ambiente um lugar realista para a marca (e no pedido, a cena).
tarefa "montar": escolha o modelo_pronto que mais combina com o cliente e o pedido, e preencha pedido, ambiente, acao, pose e os ids.
Nunca peça pessoa parecida com alguém real, nunca menor de idade, nunca sexualização. Português do Brasil, sem travessão. Responda só com o JSON pedido.`;

  /** Conversa com o agente do Canvas (bolinha do quadro): escreve o pedido pelo contexto. Não grava o canvas. */
  async function canvasAgente(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await canvasComAcesso(ch, idDe(corpo.canvas_id, "canvas_id"));
    const tarefa = corpo.tarefa === "ambiente" || corpo.tarefa === "montar" ? String(corpo.tarefa) : "conversar";
    const mensagem = limpo(corpo.mensagem, 4000);
    if (!mensagem && tarefa === "conversar") throw new ErroDeRegra(400, "mensagem_vazia", "Escreva a mensagem para o agente.");
    if (mensagem) garantirPermitido(mensagem);
    let saida: NoCanvas | null = null;
    try {
      saida = escolherSaida(c, lerPedidoDoCanvas(corpo).no_saida_id);
    } catch {
      saida = null;
    }
    const entradas = saida ? entradasDaSaida(c, saida.id) : null;
    const [kitsQ, personasQ, contexto, modelo] = await Promise.all([
      db().from("foto_kits").select("id, client_id, nome, variante, tipo, invariantes, status").eq("client_id", c.client_id).neq("status", "arquivado").limit(30),
      db().from("foto_modelos").select("*").or(`client_id.is.null,client_id.eq.${c.client_id}`).neq("status", "arquivada").limit(30),
      f.contextoDoCliente ? f.contextoDoCliente(c.client_id, undefined, corpo.marca_id).catch(() => null) : Promise.resolve(null),
      f.modeloDeTexto("diretor_arte", corpo.modelo_id),
    ]);
    const kits = ((kitsQ.data as { id: string; nome: string; variante: string | null; tipo: string; invariantes: string[] | null }[] | null) ?? []).filter((k) => k.tipo !== "pessoa");
    // Clone de pessoa real (migration 04) não se mistura com persona sintética: fica fora da lista do agente.
    const personas = ((personasQ.data as { id: string; nome: string; status: string; origem?: string | null }[] | null) ?? [])
      .filter((p) => p.origem !== "clone_de_foto_real" && personaUsavel(p.status).ok);
    const nomeDoNo = (n: NoCanvas) => {
      if (n.tipo === "produto") return kits.find((k) => k.id === n.dados.kit_id)?.nome || limpo(n.dados.titulo, 80) || "produto";
      if (n.tipo === "modelo") return personas.find((p) => p.id === n.dados.modelo_id)?.nome ?? (limpo(n.dados.titulo, 80) || "pessoa real");
      return limpo(n.dados.titulo, 80);
    };
    const quadro = entradas && saida
      ? {
        produtos: entradas.produto.map((n) => nomeDoNo(n)),
        pessoas: entradas.modelo.map((n) => ({ nome: nomeDoNo(n), real: !n.dados.modelo_id })),
        ambientes: entradas.ambiente.map((n) => ({ texto: limpo(n.dados.texto, 400) || null, modo: n.dados.modo ?? null, com_foto: !!n.dados.imagem_id })),
        estilos: entradas.estilo.map((n) => limpo(n.dados.guia, 300)).filter(Boolean),
        pedidos: textosDasEntradas(entradas).map((t) => `${t.papel}: ${t.texto}`),
        acao: saida.dados.acao ?? "livre",
        pose: saida.dados.pose ?? "nenhuma",
        formato: saida.dados.formato ?? "4:5",
        carrossel: saida.dados.carrossel ?? 0,
      }
      : null;
    // A última foto do resultado vai junto (o agente "vê" o que saiu).
    const ultima = saida ? resultadosDaSaida(saida.dados.resultados).filter((r) => r.imagem_id && r.status === "gerada").pop() : null;
    const [img] = ultima ? await f.lerImagens(c.client_id, [String(ultima.imagem_id)]) : [];
    const foto = img ? await f.baixarReduzida(img.storage_bucket, img.storage_path, 1024, "ultima-foto").catch(() => null) : null;
    const formatos = FORMATOS as readonly string[] as string[];
    const dados = {
      tarefa,
      cliente: contexto ? contexto.dados : { cliente: c.nome },
      quadro,
      kits_do_cliente: kits.map((k) => ({ id: k.id, nome: k.nome, variante: k.variante, tipo: k.tipo, invariantes: (k.invariantes ?? []).slice(0, 6) })),
      pessoas_prontas: personas.map((p) => ({ id: p.id, nome: p.nome })),
      acoes: Object.keys(ACOES_DO_RESULTADO),
      poses: Object.keys(POSES_DO_RESULTADO),
      angulos: ANGULOS_DE_VARIACAO,
      quadros_do_carrossel: QUADROS_DO_CARROSSEL,
      modelos_prontos: CHAVES_DOS_MODELOS_PRONTOS,
      formatos,
      ultima_foto_anexada: !!foto,
    };
    const nulo = (tipo: string) => ({ type: [tipo, "null"] });
    const esquema = {
      nome: "agente_do_canvas",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["resposta", "pedido", "acao", "pose", "ambiente", "formato", "modelo_pronto", "kit_id", "modelo_id"],
        properties: {
          resposta: { type: "string" },
          pedido: { type: "string" },
          acao: nulo("string"),
          pose: nulo("string"),
          ambiente: nulo("string"),
          formato: nulo("string"),
          modelo_pronto: nulo("string"),
          kit_id: nulo("string"),
          modelo_id: nulo("string"),
        },
      },
    };
    const pedidoPadrao = tarefa === "ambiente"
      ? "Descreva um ambiente realista para este cliente e esta foto."
      : tarefa === "montar"
      ? "Monte o quadro pelo contexto do cliente: escolha o modelo pronto, o produto, a pessoa, o ambiente e escreva o pedido."
      : mensagem;
    const lido = await chamarTexto({
      clientId: c.client_id,
      tarefa: "estudio",
      agente: "diretor_arte",
      modeloId: modelo.id,
      sistema: `${SISTEMA_AGENTE_CANVAS}\n\nDADOS REAIS:\n${JSON.stringify(dados)}`,
      mensagens: [...historicoDoAgente(corpo.historico), { papel: "usuario", conteudo: mensagem || pedidoPadrao, imagens: foto ? [foto] : undefined }],
      esquemaJson: esquema,
      maxTokensSaida: 4_000,
      timeoutMs: 300_000,
      referencia: { tipo: REF_CANVAS, id: c.id },
      criadoPor: ch.userId,
    });
    const r = respostaDoAgente(lido.json, { kits: kits.map((k) => k.id), modelos: personas.map((p) => p.id), modelosProntos: CHAVES_DOS_MODELOS_PRONTOS, formatos });
    return f.json({ ...r, tarefa, no_saida_id: saida ? saida.id : null, custo_usd: arred6(lido.custoUsd), saldo_usd: lido.saldoUsd });
  }

  /** estimar { acao_alvo: 'canvas_gerar', canvas_id, no_saida_id?, modelo_imagem_id?, qualidade?, resolucao?, motores? } */
  async function estimarCanvas(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
    const c = await canvasComAcesso(ch, idDe(corpo.canvas_id, "canvas_id"));
    const pedido = lerPedidoDoCanvas(corpo);
    const saida = escolherSaida(c, pedido.no_saida_id);
    const pedidos = Array.isArray(corpo.motores) ? (corpo.motores as unknown[]).map((x) => limpo(x, 160)).filter(Boolean)
      : pedido.modelo_imagem_id ? [pedido.modelo_imagem_id]
      : (Array.isArray(saida.dados.motores) && (saida.dados.motores as string[]).length ? (saida.dados.motores as string[]) : [MOTOR_PADRAO_DO_CANVAS]);
    const por_motor = [];
    for (const id of pedidos.slice(0, 8)) {
      const mt = await montar(ch, c, { ...corpo, no_saida_id: saida.id, modelo_imagem_id: id });
      por_motor.push({ modelo_imagem_id: mt.m.id, estimativa_usd: mt.estimativa_usd, referencias: mt.referencias.length, avisos: mt.avisos });
    }
    return f.json({ estimativa_usd: arred6(por_motor.reduce((s, x) => s + x.estimativa_usd, 0)), por_motor, custo_usd: 0 });
  }

  return {
    acoes: {
      canvas_listar: canvasListar,
      canvas_ler: canvasLer,
      canvas_salvar: canvasSalvar,
      canvas_montar: canvasMontar,
      canvas_gerar: canvasGerar,
      canvas_conferir: canvasConferir,
      canvas_agente: canvasAgente,
    } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
    estimar: estimarCanvas,
  };
}

/** Contexto do cliente reduzido ao que o ambiente "pelo contexto" usa (sem IA). */
function lerContextoDoAmbiente(ctx: { cliente: string; dados: Record<string, unknown> }) {
  const d = ctx.dados || {};
  const marca = (d.marca && typeof d.marca === "object" ? d.marca : {}) as Record<string, unknown>;
  const textoDe = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? JSON.stringify(v) : "");
  const campanha = [d.campanha_escolhida, d.campanha_do_mes]
    .map((x) => (x && typeof x === "object" ? String((x as Record<string, unknown>).nome ?? "") : ""))
    .find(Boolean) || null;
  return {
    cliente: ctx.cliente,
    estilo: limpo(textoDe(marca.estilo), 240) || null,
    nicho: typeof d.nicho === "string" ? d.nicho : null,
    campanha,
  };
}

/** Ações do Canvas que chamam IA ou baixam imagens (respondem com fôlego). */
export const ACOES_LONGAS_DO_CANVAS = ["canvas_montar", "canvas_gerar", "canvas_conferir", "canvas_ler", "canvas_salvar", "canvas_agente"];

/** Alvos que a ação estimar repassa para o Canvas. */
export const ALVOS_DE_ESTIMATIVA_DO_CANVAS = ["canvas_gerar"];
