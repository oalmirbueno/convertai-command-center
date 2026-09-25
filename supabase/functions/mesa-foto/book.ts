/**
 * Mesa Foto, área "Book" (pedido do dono, 26/09): o estúdio fotográfico do
 * produto ou da pessoa. As regras puras ficam em book-regras.ts; aqui ficam
 * banco, armazenamento e IA. O Book reaproveita o que já existe: kit e
 * referências do ensaio (fontesDaTomada, motivoDoBloqueio), identidade da
 * persona sintética (âncora e folha aprovada), a variação do clone (a MESMA
 * função da aba Clones, com a mesma autorização) e a biblioteca de prompts.
 *
 * Ações (POST { acao, ... } na função mesa-foto); tabela foto_books da
 * migration 05 (docs/mesa-foto/migrations/05_book.sql):
 * - books_listar { client_id } -> { books }
 * - book_criar { client_id, assunto: { tipo: produto|persona|clone|foto, id }, nome? } -> { book, assunto }
 * - book_ler { book_id } -> { book, assunto, resultados (fotos com url), referencias (com url) }
 * - book_salvar { book_id, nome?, referencias?, pedidos?, selecao?, status? } -> { book }
 * - book_diretor { book_id, mensagem, prompt_ids?, quantidade?, campanha_id?, marca_id? } -> { resposta, pedidos, conversa, custo_usd }
 * - book_gerar { book_id, pedido: { titulo?, prompt, formato?, referencias?[] }, modelo_imagem_id?, qualidade? }
 *     -> { imagem (acervo, tag book:<id>), url, pedido, custo_usd, saldo_usd, avisos } (UMA foto por chamada)
 * - estimar aceita acao_alvo book_gerar e book_diretor.
 *
 * Regras: custo à vista antes (estimar); sem laço de correção (gera uma
 * vez, a equipe escolhe); pessoa real só pelo clone autorizado; referência
 * só como estilo; toda foto marcada como gerada; nunca escurecer a foto.
 */

import {
  carregarModelo,
  chamarImagem,
  chamarTexto,
  estimarComModelo,
  type ImagemEntrada,
  limiteDeReferencias,
  type ModeloIa,
  type Qualidade,
} from "../_shared/ia-motor.ts";
import { arred6, dimensoesDaImagem, ErroDeRegra, extensaoDe, fontesDaTomada, limpo, mimeDe, motivoDoBloqueio, nomeSeguro, sha256Hex, UUID } from "./calculos.ts";
import type { Chamador, FerramentasDaMesa, ImagemDoAcervoLida } from "./ferramentas.ts";
import { estimativaDeUmaImagem, type LinhaImagemPersona, type LinhaPersona } from "./modelos.ts";
import { fichaEmTexto, identidadesDaVista, personaUsavel } from "./personas.ts";
import {
  type AssuntoDoBook,
  type AssuntoNoPrompt,
  categoriasDoAssunto,
  FORMATOS_DO_BOOK,
  type IdentidadeNoPrompt,
  lerAssunto,
  lerPedidoDoBook,
  lerPedidosDoBook,
  lerReferenciasDoBook,
  lerSelecaoDoBook,
  MAX_CONVERSA_DO_BOOK,
  MAX_ESTILO_POR_FOTO,
  normalizarRespostaDoDiretorDoBook,
  promptDoBook,
  type ReferenciaDoBook,
  STATUS_DO_BOOK,
} from "./book-regras.ts";
import type { LinhaClone } from "./clones.ts";

const REF_BOOK = "foto_book";
const MIGRATION = "a migration 05 (docs/mesa-foto/migrations/05_book.sql) foi aplicada?";
const LADO_IDENTIDADE = 1280;
const LADO_ESTILO = 1024;
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];

type LinhaBook = {
  id: string;
  client_id: string;
  nome: string;
  assunto: { tipo: AssuntoDoBook; id: string; nome?: string };
  referencias: ReferenciaDoBook[];
  pedidos: unknown[];
  selecao: string[];
  conversa: { papel: "equipe" | "diretor"; texto: string; em: string }[];
  status: string;
  custo_usd: number | string;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

/** O que o Book usa de Modelos e Clones (sem import circular: o index monta). */
export type DependenciasDoBook = {
  lerPersona: (id: string) => Promise<LinhaPersona>;
  imagensDaPersona: (id: string) => Promise<LinhaImagemPersona[]>;
  cloneComAcesso: (ch: Chamador, id: string) => Promise<LinhaClone>;
  gerarVariacao: (
    ch: Chamador,
    c: LinhaClone,
    corpo: Record<string, unknown>,
    extras?: { estilo?: { imagens: ImagemEntrada[]; legendas: string[] } | null; tags?: string[]; pasta?: string; nome?: string; referencia?: { tipo: string; id: string } },
  ) => Promise<{ imagem: Record<string, unknown>; url: string | null; saida: { custoUsd: number; saldoUsd: number | null; reservaUsada?: string | null; avisos?: string[] }; avisos: string[] }>;
  /** Modelo de imagem pedido ou o padrão do catálogo. */
  modeloDeImagem: (pedido?: unknown) => Promise<ModeloIa>;
  /** Regras da casa e padrão publicitário do diretor (o mesmo texto do diretor da Mesa Foto). */
  diretrizes: string;
};

const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroDeRegra(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};
const lerQualidade = (v: unknown, padrao: Qualidade): Qualidade => (QUALIDADES.includes(v as Qualidade) ? (v as Qualidade) : padrao);
const camera = { azimute: 0, elevacao: 10, enquadramento: "medio" as const, preset_id: null };

export function acoesDoBook(f: FerramentasDaMesa, d: DependenciasDoBook) {
  const db = () => f.servico();

  // ---------------------------------------------------------------- leituras

  async function lerBook(id: string): Promise<LinhaBook> {
    const { data, error } = await db().from("foto_books").select("*").eq("id", id).maybeSingle();
    if (error) throw new ErroDeRegra(503, "book_indisponivel", `Não foi possível ler o book (${MIGRATION}).`);
    if (!data) throw new ErroDeRegra(404, "book_inexistente", "Book não encontrado.");
    const b = data as LinhaBook;
    b.referencias = lerReferenciasDoBook(b.referencias);
    b.pedidos = Array.isArray(b.pedidos) ? b.pedidos : [];
    b.selecao = lerSelecaoDoBook(b.selecao);
    b.conversa = Array.isArray(b.conversa) ? b.conversa : [];
    return b;
  }

  async function bookComAcesso(ch: Chamador, id: string): Promise<LinhaBook> {
    const b = await lerBook(id);
    await f.garantirAcesso(ch, b.client_id);
    return b;
  }

  type Resumo = { tipo: AssuntoDoBook; id: string; nome: string; capa: { bucket: string; caminho: string } | null; detalhe: string; categorias: string[]; aviso: string | null };

  /** O assunto conferido (do cliente do book, usável) e um resumo para a tela. */
  async function resumoDoAssunto(ch: Chamador, clientId: string, tipo: AssuntoDoBook, id: string): Promise<Resumo> {
    if (tipo === "produto") {
      const { kit, refs } = await f.lerKitComRefs(ch, id);
      if (kit.client_id !== clientId) throw new ErroDeRegra(409, "kit_de_outro_cliente", "Este produto é de outro cliente.");
      if (kit.tipo === "pessoa") throw new ErroDeRegra(409, "kit_de_pessoa", "Pessoa real entra no Book pelo Clone (com a autorização registrada), não pelo kit.");
      const frente = refs.find((r) => r.imagem_id === kit.frente_imagem_id) ?? refs.find((r) => r.papel === "identidade") ?? refs[0] ?? null;
      return {
        tipo, id, nome: kit.nome,
        capa: frente ? { bucket: frente.imagem.storage_bucket, caminho: frente.imagem.storage_path } : null,
        detalhe: [kit.variante, `${refs.length} ${refs.length === 1 ? "foto" : "fotos"} no kit`].filter(Boolean).join(" · "),
        categorias: categoriasDoAssunto(tipo, kit.tipo),
        aviso: motivoDoBloqueio(kit, refs),
      };
    }
    if (tipo === "persona") {
      const p = await d.lerPersona(id);
      if (p.origem === "clone_de_foto_real") throw new ErroDeRegra(409, "e_um_clone", "Esta é uma pessoa real: escolha o assunto Clone.");
      if (p.client_id && p.client_id !== clientId) throw new ErroDeRegra(409, "persona_de_outro_cliente", "Esta persona é de outro cliente.");
      if (p.client_id) await f.garantirAcesso(ch, p.client_id);
      const imagens = await d.imagensDaPersona(p.id);
      const ancora = imagens.find((i) => i.id === p.ancora_imagem_id) ?? null;
      const uso = personaUsavel(p.status);
      return {
        tipo, id, nome: p.nome,
        capa: ancora ? { bucket: ancora.storage_bucket, caminho: ancora.storage_path } : null,
        detalhe: `Persona sintética${p.client_id ? "" : " da agência"} · ${p.status}`,
        categorias: categoriasDoAssunto(tipo),
        aviso: !uso.ok ? "A persona ainda não tem âncora: escolha a âncora em Modelos antes do book." : uso.aviso,
      };
    }
    if (tipo === "clone") {
      const c = await d.cloneComAcesso(ch, id);
      if (c.client_id !== clientId) throw new ErroDeRegra(409, "clone_de_outro_cliente", "Este clone é de outro cliente.");
      const principal = c.identidade_real.find((r) => r.principal) ?? c.identidade_real[0] ?? null;
      const [real] = principal ? await f.lerImagens(clientId, [principal.imagem_id]) : [];
      return {
        tipo, id, nome: c.nome,
        capa: real ? { bucket: real.storage_bucket, caminho: real.storage_path } : null,
        detalhe: "Pessoa real com autorização (clone)",
        categorias: categoriasDoAssunto(tipo),
        aviso: c.status === "arquivada" ? "O clone está arquivado." : null,
      };
    }
    const [foto] = await f.lerImagens(clientId, [id]);
    if (!foto) throw new ErroDeRegra(404, "imagem_inexistente", "Esta foto não está no acervo do cliente.");
    if (ehFotoDePessoaReal(foto)) throw new ErroDeRegra(409, "foto_de_pessoa", "Foto de pessoa real entra no Book pelo Clone (com a autorização registrada).");
    return {
      tipo, id, nome: foto.nome,
      capa: { bucket: foto.storage_bucket, caminho: foto.storage_path },
      detalhe: foto.gerada ? "Foto gerada do acervo" : "Foto do acervo",
      categorias: categoriasDoAssunto(tipo),
      aviso: null,
    };
  }

  const ehFotoDePessoaReal = (i: ImagemDoAcervoLida) => !i.gerada && ((i.tags ?? []).includes("tipo:pessoa") || i.categoria === "pessoa");

  const resumoComUrl = async (r: Resumo) => ({ ...r, capa_url: r.capa ? await f.urlAssinada(r.capa.bucket, r.capa.caminho) : null });

  async function resultadosDoBook(b: LinhaBook): Promise<ImagemDoAcervoLida[]> {
    const { data } = await db().from("cliente_imagens").select(f.camposImagem).eq("client_id", b.client_id).contains("tags", [`book:${b.id}`])
      .order("criado_em", { ascending: false }).limit(300);
    return ((data as unknown as ImagemDoAcervoLida[] | null) ?? []).filter((i) => i.ativa !== false);
  }

  async function referenciasComUrl(b: LinhaBook) {
    const doAcervo = b.referencias.filter((r) => r.tipo === "acervo").map((r) => r.id);
    const daBiblioteca = b.referencias.filter((r) => r.tipo === "biblioteca").map((r) => r.id);
    const [imagens, itens] = await Promise.all([f.lerImagens(b.client_id, doAcervo), f.lerItensDaBiblioteca(b.client_id, daBiblioteca)]);
    return await f.emParalelo(b.referencias, 6, async (r) => {
      if (r.tipo === "acervo") {
        const i = imagens.find((x) => x.id === r.id);
        return i ? { tipo: r.tipo, id: r.id, titulo: i.nome, storage_path: i.storage_path, url: await f.urlAssinada(i.storage_bucket, i.storage_path) } : { tipo: r.tipo, id: r.id, titulo: "Foto fora do acervo", storage_path: null, url: null };
      }
      const it = itens.find((x) => x.id === r.id);
      return it
        ? { tipo: r.tipo, id: r.id, titulo: it.titulo, storage_path: it.storage_path, url: it.storage_path ? await f.urlAssinada("mesa", it.storage_path) : it.imagem_url }
        : { tipo: r.tipo, id: r.id, titulo: "Item fora da biblioteca", storage_path: null, url: null };
    });
  }

  // ---------------------------------------------------------------- ações

  async function booksListar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    let q = db().from("foto_books").select("id, client_id, nome, assunto, status, selecao, custo_usd, atualizado_em, criado_em").eq("client_id", clientId).order("atualizado_em", { ascending: false }).limit(100);
    if (corpo.incluir_arquivados !== true) q = q.neq("status", "arquivado");
    const { data, error } = await q;
    if (error) throw new ErroDeRegra(503, "book_indisponivel", `Não foi possível ler os books (${MIGRATION}).`);
    return f.json({ books: data ?? [], custo_usd: 0 });
  }

  async function bookCriar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    const assunto = lerAssunto(corpo.assunto);
    const resumo = await resumoDoAssunto(ch, clientId, assunto.tipo, assunto.id);
    const nome = limpo(corpo.nome, 120) || `Book de ${resumo.nome}`.slice(0, 120);
    const { data, error } = await db().from("foto_books").insert({
      client_id: clientId,
      nome,
      assunto: { tipo: assunto.tipo, id: assunto.id, nome: resumo.nome },
      referencias: lerReferenciasDoBook(corpo.referencias),
      pedidos: [],
      selecao: [],
      conversa: [],
      status: "aberto",
      criado_por: ch.userId,
    }).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "book_indisponivel", `Não foi possível criar o book (${MIGRATION}).`);
    return f.json({ book: data, assunto: await resumoComUrl(resumo), custo_usd: 0 });
  }

  async function bookLer(ch: Chamador, corpo: Record<string, unknown>) {
    const b = await bookComAcesso(ch, idDe(corpo.book_id, "book_id"));
    const [resumo, resultados, referencias] = await Promise.all([
      resumoDoAssunto(ch, b.client_id, b.assunto.tipo, b.assunto.id).then(resumoComUrl).catch((e) => ({
        tipo: b.assunto.tipo, id: b.assunto.id, nome: b.assunto.nome ?? "Assunto", capa: null, capa_url: null, detalhe: "", categorias: categoriasDoAssunto(b.assunto.tipo),
        aviso: e instanceof ErroDeRegra ? e.message : "O assunto deste book não está mais disponível.",
      })),
      resultadosDoBook(b),
      referenciasComUrl(b),
    ]);
    return f.json({
      book: b,
      assunto: resumo,
      resultados: await f.emParalelo(resultados, 6, async (i) => ({ ...i, url: await f.urlAssinada(i.storage_bucket, i.storage_path) })),
      referencias,
      formatos: Object.keys(FORMATOS_DO_BOOK),
      custo_usd: 0,
    });
  }

  async function bookSalvar(ch: Chamador, corpo: Record<string, unknown>) {
    const b = await bookComAcesso(ch, idDe(corpo.book_id, "book_id"));
    const patch: Record<string, unknown> = {};
    if (corpo.nome !== undefined) {
      const nome = limpo(corpo.nome, 120);
      if (!nome) throw new ErroDeRegra(400, "nome_obrigatorio", "O nome do book não pode ficar vazio.");
      patch.nome = nome;
    }
    if (corpo.referencias !== undefined) {
      const refs = lerReferenciasDoBook(corpo.referencias);
      // Só referências que existem no acervo do cliente ou na biblioteca (da agência ou dele).
      const [imagens, itens] = await Promise.all([
        f.lerImagens(b.client_id, refs.filter((r) => r.tipo === "acervo").map((r) => r.id)),
        f.lerItensDaBiblioteca(b.client_id, refs.filter((r) => r.tipo === "biblioteca").map((r) => r.id)),
      ]);
      patch.referencias = refs.filter((r) => (r.tipo === "acervo" ? imagens.some((i) => i.id === r.id) : itens.some((i) => i.id === r.id)));
    }
    if (corpo.pedidos !== undefined) patch.pedidos = lerPedidosDoBook(corpo.pedidos);
    if (corpo.selecao !== undefined) {
      const ids = lerSelecaoDoBook(corpo.selecao);
      const achadas = await f.lerImagens(b.client_id, ids);
      patch.selecao = ids.filter((id) => achadas.some((a) => a.id === id));
    }
    if (corpo.status !== undefined) {
      const st = String(corpo.status);
      if (!(STATUS_DO_BOOK as readonly string[]).includes(st)) throw new ErroDeRegra(400, "status_invalido", `status: ${STATUS_DO_BOOK.join(", ")}.`);
      patch.status = st;
    }
    if (!Object.keys(patch).length) return f.json({ book: b, custo_usd: 0 });
    const { data, error } = await db().from("foto_books").update(patch).eq("id", b.id).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível gravar o book.");
    return f.json({ book: data, custo_usd: 0 });
  }

  // ---------------------------------------------------------------- diretor do book

  const ESQUEMA_DIRETOR = {
    nome: "pedidos_do_book",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["resposta", "pedidos"],
      properties: {
        resposta: { type: "string" },
        pedidos: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["titulo", "prompt", "formato"],
            properties: { titulo: { type: "string" }, prompt: { type: "string" }, formato: { type: "string", enum: Object.keys(FORMATOS_DO_BOOK) } },
          },
        },
      },
    },
  };

  const sistemaDoDiretor = () => `Você é o diretor de fotografia do BOOK da agência Aceleriq: monta um book fotográfico completo e profissional de UM assunto (produto, persona sintética, pessoa real autorizada ou uma foto do acervo).
A equipe conversa com você, escolhe prompts da biblioteca e manda referências. Sua tarefa é transformar isso em PEDIDOS de foto prontos para o gerador: cada pedido é UMA foto.
- resposta: 2 a 4 frases, o que você montou e por quê (sequência do book: abertura, detalhes, uso, ambiente, fechamento).
- pedidos: titulo curto (2 a 5 palavras), prompt em português descrevendo a FOTO (cenário, superfície, luz com fonte e direção, câmera e lente, enquadramento, props com função, paleta, clima) e formato (4:5, 1:1, 9:16, 16:9 ou 3:4).
- O prompt nunca redescreve o assunto (a identidade vem das imagens do kit, da persona ou do clone): diga só como a foto deve ser.
- Prompt da biblioteca escolhido: adapte ao assunto e à marca, sem copiar marca ou pessoa de ninguém.
- Variações diferentes de verdade entre si; nada repetido.
- Pessoa real: só roupa, cenário, pose, expressão e luz; nunca mude rosto, idade ou corpo.
${d.diretrizes}
Responda só com o JSON pedido.`;

  async function bookDiretor(ch: Chamador, corpo: Record<string, unknown>) {
    const b = await bookComAcesso(ch, idDe(corpo.book_id, "book_id"));
    const mensagem = limpo(corpo.mensagem, 2000);
    const promptIds = Array.isArray(corpo.prompt_ids) ? corpo.prompt_ids.map(String).filter((x) => UUID.test(x)).slice(0, 8) : [];
    if (!mensagem && !promptIds.length) throw new ErroDeRegra(400, "mensagem_vazia", "Diga ao diretor o que você quer (ou escolha prompts da biblioteca).");
    if (!f.contextoDoCliente) throw new ErroDeRegra(503, "contexto_indisponivel", "O contexto do cliente não está disponível nesta função.");
    const quantidade = Math.max(1, Math.min(8, Math.floor(Number(corpo.quantidade) || 4)));
    const [contexto, diretor, itens, resumo] = await Promise.all([
      f.contextoDoCliente(b.client_id, corpo.campanha_id, corpo.marca_id),
      f.modeloDeTexto("diretor_arte", corpo.modelo_id),
      f.lerItensDaBiblioteca(b.client_id, promptIds),
      resumoDoAssunto(ch, b.client_id, b.assunto.tipo, b.assunto.id),
    ]);
    const referencias = await referenciasComUrl(b);
    const saida = await chamarTexto({
      clientId: b.client_id,
      tarefa: "estudio",
      agente: "diretor_arte",
      modeloId: diretor.id,
      sistema: sistemaDoDiretor(),
      mensagens: [
        ...b.conversa.slice(-8).map((m) => ({ papel: m.papel === "diretor" ? "agente" as const : "usuario" as const, conteudo: m.texto })),
        {
          papel: "usuario" as const,
          conteudo: `Monte até ${quantidade} pedidos de foto para este book.
${JSON.stringify({
  book: b.nome,
  assunto: { tipo: resumo.tipo, nome: resumo.nome, detalhe: resumo.detalhe },
  pedido_da_equipe: mensagem || null,
  prompts_escolhidos: itens.map((i) => ({ titulo: i.titulo, categoria: i.categoria, prompt: i.prompt_pt || i.prompt_en, negativo: i.negativo })),
  referencias_de_estilo: referencias.map((r) => r.titulo),
  pedidos_que_ja_existem: (b.pedidos as { titulo?: string }[]).map((p) => p?.titulo).filter(Boolean).slice(0, 20),
  cliente: contexto.dados,
})}`,
        },
      ],
      esquemaJson: ESQUEMA_DIRETOR,
      maxTokensSaida: 4_000,
      timeoutMs: 300_000,
      referencia: { tipo: REF_BOOK, id: b.id },
      criadoPor: ch.userId,
    });
    const r = normalizarRespostaDoDiretorDoBook(saida.json ?? {}, quantidade);
    const agora = new Date().toISOString();
    const conversa = [
      ...b.conversa,
      { papel: "equipe" as const, texto: mensagem || `Prompts da biblioteca: ${itens.map((i) => i.titulo).join(", ")}`, em: agora },
      { papel: "diretor" as const, texto: r.resposta || `${r.pedidos.length} pedidos montados.`, em: agora },
    ].slice(-MAX_CONVERSA_DO_BOOK);
    await db().from("foto_books").update({ conversa, custo_usd: arred6(Number(b.custo_usd || 0) + saida.custoUsd) }).eq("id", b.id);
    return f.json({
      resposta: r.resposta,
      pedidos: r.pedidos.map((p) => ({ ...p, origem: { tipo: "diretor", id: null } })),
      conversa,
      avisos: r.descartados ? [`${r.descartados} ${r.descartados === 1 ? "pedido saiu" : "pedidos saíram"} por fugir das regras (pessoa conhecida, menor ou sexualização).`] : [],
      custo_usd: saida.custoUsd,
      saldo_usd: saida.saldoUsd,
      reserva_usada: saida.reservaUsada ?? null,
    });
  }

  // ---------------------------------------------------------------- gerar

  /** Referências de estilo da foto: as do pedido (dentro do book) ou as primeiras do book. */
  async function estiloDaFoto(b: LinhaBook, pedidoRefs: string[], vagas: number): Promise<{ imagens: ImagemEntrada[]; legendas: string[]; ids: string[] }> {
    const max = Math.max(0, Math.min(MAX_ESTILO_POR_FOTO, vagas));
    if (!max) return { imagens: [], legendas: [], ids: [] };
    const escolhidas = (pedidoRefs.length ? b.referencias.filter((r) => pedidoRefs.indexOf(r.id) >= 0) : b.referencias).slice(0, max);
    const doAcervo = escolhidas.filter((r) => r.tipo === "acervo").map((r) => r.id);
    const daBiblioteca = escolhidas.filter((r) => r.tipo === "biblioteca").map((r) => r.id);
    const [imagens, itens] = await Promise.all([f.lerImagens(b.client_id, doAcervo), f.lerItensDaBiblioteca(b.client_id, daBiblioteca)]);
    const saida: { imagens: ImagemEntrada[]; legendas: string[]; ids: string[] } = { imagens: [], legendas: [], ids: [] };
    for (const r of escolhidas) {
      try {
        if (r.tipo === "acervo") {
          const i = imagens.find((x) => x.id === r.id);
          if (!i) continue;
          saida.imagens.push(await f.baixarReduzida(i.storage_bucket, i.storage_path, LADO_ESTILO, `estilo-${i.nome}`));
          saida.legendas.push(i.nome);
        } else {
          const it = itens.find((x) => x.id === r.id);
          if (!it) continue;
          saida.imagens.push(await f.imagemDoItemDaBiblioteca(b.client_id, it, LADO_ESTILO));
          saida.legendas.push(it.titulo);
        }
        saida.ids.push(r.id);
      } catch {
        // Referência que não abre não trava a foto: vai sem ela (a resposta avisa).
      }
    }
    return saida;
  }

  async function bookGerar(ch: Chamador, corpo: Record<string, unknown>) {
    const b = await bookComAcesso(ch, idDe(corpo.book_id, "book_id"));
    if (b.status === "arquivado") throw new ErroDeRegra(409, "book_arquivado", "O book está arquivado.");
    const pedido = lerPedidoDoBook(corpo.pedido ?? corpo);
    const avisos: string[] = [];
    const tagsDoBook = [`book:${b.id}`];
    const nome = `${b.nome}: ${pedido.titulo}`.slice(0, 160);

    // Clone: a MESMA variação da aba Clones (autorização, identidade com a folha aprovada, traços), com o estilo do book.
    if (b.assunto.tipo === "clone") {
      const c = await d.cloneComAcesso(ch, b.assunto.id);
      if (c.client_id !== b.client_id) throw new ErroDeRegra(409, "clone_de_outro_cliente", "Este clone é de outro cliente.");
      const estilo = await estiloDaFoto(b, pedido.referencias, MAX_ESTILO_POR_FOTO);
      if (estilo.ids.length < Math.min(MAX_ESTILO_POR_FOTO, pedido.referencias.length || b.referencias.length)) avisos.push("Alguma referência de estilo não abriu e ficou de fora.");
      const r = await d.gerarVariacao(ch, c, {
        pedido: { livre: pedido.prompt },
        formato: pedido.formato,
        qualidade: corpo.qualidade,
        modelo_imagem_id: corpo.modelo_imagem_id,
        marca_id: corpo.marca_id,
      }, { estilo, tags: tagsDoBook, pasta: "Mesa Foto / Book", nome, referencia: { tipo: REF_BOOK, id: b.id } });
      await somarCusto(b, r.saida.custoUsd);
      return f.json({ imagem: r.imagem, url: r.url, pedido, custo_usd: r.saida.custoUsd, saldo_usd: r.saida.saldoUsd, reserva_usada: r.saida.reservaUsada ?? null, avisos: [...avisos, ...r.avisos, ...(r.saida.avisos ?? [])] });
    }

    // Produto, persona sintética ou foto do acervo: identidade primeiro, estilo depois.
    let m: ModeloIa;
    let assunto: AssuntoNoPrompt;
    let identidades: { imagem: ImagemEntrada; legenda: IdentidadeNoPrompt }[] = [];
    let extrasDaLinha: Record<string, unknown> = {};
    const tags = [...tagsDoBook];
    if (b.assunto.tipo === "persona") {
      const p = await d.lerPersona(b.assunto.id);
      if (p.origem === "clone_de_foto_real") throw new ErroDeRegra(409, "e_um_clone", "Esta é uma pessoa real: use o assunto Clone.");
      if (p.client_id && p.client_id !== b.client_id) throw new ErroDeRegra(409, "persona_de_outro_cliente", "Esta persona é de outro cliente.");
      if (p.status === "arquivada") throw new ErroDeRegra(409, "modelo_arquivado", "A persona está arquivada.");
      const uso = personaUsavel(p.status);
      if (!uso.ok) throw new ErroDeRegra(409, "sem_ancora", "A persona ainda não tem âncora: escolha a âncora em Modelos antes do book.");
      if (uso.aviso) avisos.push(uso.aviso);
      // O gerador da âncora (a folha e as fotos seguintes ficam presas a ele), senão o pedido.
      m = await carregarModelo(p.motor_preferido_id || limpo(corpo.modelo_imagem_id, 160) || (await d.modeloDeImagem()).id, "imagem");
      const imagens = await d.imagensDaPersona(p.id);
      const ancora = imagens.find((i) => i.id === p.ancora_imagem_id);
      if (!ancora) throw new ErroDeRegra(409, "sem_ancora", "A âncora da persona saiu: escolha outra em Modelos.");
      const lista = identidadesDaVista(ancora, imagens, "meio_corpo", Math.min(4, Math.max(1, limiteDeReferencias(m) - MAX_ESTILO_POR_FOTO)));
      identidades = await f.emParalelo(lista, 3, async (i, k) => ({
        imagem: await f.baixarReduzida(i.storage_bucket, i.storage_path, LADO_IDENTIDADE, `identidade-${i.vista ?? "ancora"}`),
        legenda: { papel: k === 0 ? "ancora" : "vista", vista: i.vista },
      }));
      assunto = { tipo: "persona", nome: p.nome, invariantes: p.invariantes ?? [], ficha: fichaEmTexto(p.ficha) };
      tags.push(`persona:${p.id}`, "pessoa_sintetica");
    } else if (b.assunto.tipo === "produto") {
      const { kit, refs } = await f.lerKitComRefs(ch, b.assunto.id);
      if (kit.client_id !== b.client_id) throw new ErroDeRegra(409, "kit_de_outro_cliente", "Este produto é de outro cliente.");
      if (kit.tipo === "pessoa") throw new ErroDeRegra(409, "kit_de_pessoa", "Pessoa real entra no Book pelo Clone (com a autorização registrada).");
      const bloqueio = motivoDoBloqueio(kit, refs);
      if (bloqueio) throw new ErroDeRegra(409, "kit_sem_evidencia", bloqueio);
      m = await d.modeloDeImagem(corpo.modelo_imagem_id);
      const fontes = fontesDaTomada(refs, { camera, exige: null, foco: null }, Math.max(1, Math.min(6, limiteDeReferencias(m) - MAX_ESTILO_POR_FOTO)));
      identidades = await f.emParalelo(fontes, 3, async (r) => {
        const ref = refs.find((x) => x.imagem_id === r.imagem_id)!;
        return {
          imagem: await f.baixarReduzida(ref.imagem.storage_bucket, ref.imagem.storage_path, LADO_IDENTIDADE, `${r.papel}-${ref.imagem.nome}`),
          legenda: { papel: r.papel, nome: ref.imagem.nome, vista: r.vista },
        };
      });
      assunto = { tipo: "produto", nome: kit.nome, invariantes: kit.invariantes ?? [], observado: kit.atributos?.observado ?? [], lacunas: kit.lacunas ?? [] };
      extrasDaLinha = { kit_id: kit.id };
    } else {
      const [foto] = await f.lerImagens(b.client_id, [b.assunto.id]);
      if (!foto) throw new ErroDeRegra(404, "imagem_inexistente", "A foto do book saiu do acervo.");
      if (ehFotoDePessoaReal(foto)) throw new ErroDeRegra(409, "foto_de_pessoa", "Foto de pessoa real entra no Book pelo Clone (com a autorização registrada).");
      m = await d.modeloDeImagem(corpo.modelo_imagem_id);
      identidades = [{ imagem: await f.baixarReduzida(foto.storage_bucket, foto.storage_path, LADO_IDENTIDADE, foto.nome), legenda: { papel: "foto", nome: foto.nome } }];
      assunto = { tipo: "foto", nome: foto.nome, invariantes: [], observado: foto.descricao ? [limpo(foto.descricao, 400)] : [] };
      extrasDaLinha = { derivada_de: foto.id, kit_id: foto.kit_id };
    }
    const estilo = await estiloDaFoto(b, pedido.referencias, limiteDeReferencias(m) - identidades.length);
    const pedidas = pedido.referencias.length ? pedido.referencias.length : Math.min(MAX_ESTILO_POR_FOTO, b.referencias.length);
    if (estilo.ids.length < pedidas) avisos.push("Alguma referência de estilo não coube ou não abriu e ficou de fora.");
    const prompt = promptDoBook({ assunto, identidades: identidades.map((i) => i.legenda), estilo: estilo.legendas, pedido: pedido.prompt, formato: pedido.formato });
    const qualidade = lerQualidade(corpo.qualidade, "alta");
    const saida = await chamarImagem({
      clientId: b.client_id,
      modeloId: m.id,
      prompt,
      referencias: [...identidades.map((i) => i.imagem), ...estilo.imagens],
      qualidade,
      tamanho: FORMATOS_DO_BOOK[pedido.formato],
      referencia: { tipo: REF_BOOK, id: b.id },
      criadoPor: ch.userId,
      tarefa: "estudio",
      agente: "gerador_imagem",
    });
    const mime = mimeDe(saida.png) ?? (saida.mime || "image/png");
    const dim = dimensoesDaImagem(saida.png);
    const caminho = `${b.client_id}/foto/book/${b.id}/${nomeSeguro(pedido.titulo).slice(0, 40) || "foto"}-${crypto.randomUUID().slice(0, 8)}.${extensaoDe(mime)}`;
    await f.salvarNoMesa(caminho, saida.png, mime);
    const { data, error } = await db().from("cliente_imagens").insert({
      client_id: b.client_id,
      origem: "mesa_foto",
      storage_bucket: "mesa",
      storage_path: caminho,
      nome,
      pasta: "Mesa Foto / Book",
      categoria: b.assunto.tipo === "persona" ? "pessoa" : null,
      tags: Array.from(new Set(["mesa_foto", "gerada", "book", ...tags])).slice(0, 30),
      descricao: `Book "${b.nome}": ${pedido.titulo}. Gerada por IA a partir de ${assunto.tipo === "produto" ? "as fotos do kit" : assunto.tipo === "persona" ? "a âncora e a folha da persona sintética" : "a foto do acervo"}${estilo.legendas.length ? ` com estilo de ${estilo.legendas.join(", ")}` : ""}. Motor ${saida.modeloId}.`.slice(0, 1000),
      derivada_de: null,
      gerada: true,
      modo: "ensaio",
      kit_id: null,
      sha256: await sha256Hex(saida.png),
      largura: dim?.largura ?? null,
      altura: dim?.altura ?? null,
      aprovada: false,
      ...extrasDaLinha,
    }).select(f.camposImagem).single();
    if (error || !data) {
      await db().storage.from("mesa").remove([caminho]).catch(() => {});
      throw new ErroDeRegra(503, "gravacao_falhou", "A foto foi gerada e cobrada, mas não entrou no acervo. Avise o admin.", { uso_id: saida.usoId, custo_usd: saida.custoUsd });
    }
    await somarCusto(b, saida.custoUsd);
    const nova = data as unknown as ImagemDoAcervoLida;
    const url = await f.urlAssinada("mesa", caminho);
    return f.json({ imagem: { ...nova, url }, url, pedido, custo_usd: saida.custoUsd, saldo_usd: saida.saldoUsd, reserva_usada: saida.reservaUsada ?? null, avisos: [...avisos, ...(saida.avisos ?? [])] });
  }

  /** Custo do book (só registro; o que vale é ia_usos). Leitura e escrita juntas: concorrência só erra o total. */
  async function somarCusto(b: LinhaBook, custo: number) {
    const { data } = await db().from("foto_books").select("custo_usd").eq("id", b.id).maybeSingle();
    const atual = Number((data as { custo_usd?: number | string } | null)?.custo_usd ?? b.custo_usd ?? 0);
    await db().from("foto_books").update({ custo_usd: arred6(atual + (Number(custo) || 0)) }).eq("id", b.id);
  }

  // ---------------------------------------------------------------- estimativa

  async function estimarBook(ch: Chamador, corpo: Record<string, unknown>, alvo: string): Promise<Response> {
    const quantidade = Math.max(1, Math.min(40, Math.floor(Number(corpo.quantidade) || 1)));
    if (alvo === "book_diretor") {
      const diretor = await f.modeloDeTexto("diretor_arte");
      const uma = estimarComModelo(diretor, { tokensEntrada: 12_000, tokensSaida: 2_500 });
      return f.json({ estimativa_usd: arred6(uma), por_imagem_usd: uma, quantidade: 1, custo_usd: 0 });
    }
    if (alvo === "book_gerar") {
      let m: ModeloIa;
      let refs = 4;
      if (UUID.test(String(corpo.book_id ?? ""))) {
        const b = await bookComAcesso(ch, String(corpo.book_id));
        if (b.assunto.tipo === "clone") {
          const c = await d.cloneComAcesso(ch, b.assunto.id);
          m = await carregarModelo(c.motor_preferido_id || limpo(corpo.modelo_imagem_id, 160) || "openrouter:google/gemini-3-pro-image", "imagem");
          refs = 8;
        } else if (b.assunto.tipo === "persona") {
          const p = await d.lerPersona(b.assunto.id);
          m = await carregarModelo(p.motor_preferido_id || limpo(corpo.modelo_imagem_id, 160) || (await d.modeloDeImagem()).id, "imagem");
          refs = 4 + Math.min(MAX_ESTILO_POR_FOTO, b.referencias.length);
        } else {
          m = await d.modeloDeImagem(corpo.modelo_imagem_id);
          refs = (b.assunto.tipo === "produto" ? 4 : 1) + Math.min(MAX_ESTILO_POR_FOTO, b.referencias.length);
        }
      } else {
        m = await d.modeloDeImagem(corpo.modelo_imagem_id);
      }
      const uma = estimativaDeUmaImagem(m, lerQualidade(corpo.qualidade, "alta"), null, refs);
      return f.json({ estimativa_usd: arred6(uma * quantidade), por_imagem_usd: uma, quantidade, modelo_imagem_id: m.id, custo_usd: 0 });
    }
    throw new ErroDeRegra(400, "alvo_invalido", "acao_alvo desconhecida para o Book.");
  }

  return {
    acoes: {
      books_listar: booksListar,
      book_criar: bookCriar,
      book_ler: bookLer,
      book_salvar: bookSalvar,
      book_diretor: bookDiretor,
      book_gerar: bookGerar,
    } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
    estimar: estimarBook,
  };
}

/** Ações do Book que chamam IA ou baixam imagens (respondem com fôlego). */
export const ACOES_LONGAS_DO_BOOK = ["book_gerar", "book_diretor", "book_ler", "book_criar"];

/** Alvos que a ação estimar repassa para o Book. */
export const ALVOS_DE_ESTIMATIVA_DO_BOOK = ["book_gerar", "book_diretor"];
