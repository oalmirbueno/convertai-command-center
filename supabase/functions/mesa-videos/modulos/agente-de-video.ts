/**
 * Agentes da Mesa Vídeos e da Mesa Edição (frente E2, 26/09/2026).
 *
 * O agente fica fixo ao lado da mesa. Não gera texto: entende o pedido
 * (Jev Choice entre intenções fixas, com as palavras como reserva quando o Jev
 * não responde) e o código faz o resto: abre a etapa certa, resume o que falta
 * ou PROPÕE a mudança pelo contrato comum (apelidos, Confirmar/Cancelar,
 * Desfazer). Nada gasta além do Jev (fração de centavo, registrada na carteira).
 *
 * Puro: sem Deno, sem banco. A tela, a função mesa-videos e os testes usam o mesmo.
 */

import { type AcaoDoAgente, type Alvo, type CaminhoDoAgente, comApelido, normalizarAcaoDoAgente, type RegraDaOperacao } from "../../_shared/acoes-do-agente.ts";
import { caminhoNaArea } from "../../_shared/mapa-do-painel.ts";

export type MesaDoAgente = "videos" | "edicao";

export interface IntencaoDoAgente {
  valor: string;
  /** Rótulo do atalho. */
  rotulo: string;
  /** O que significa (vai para o Jev). */
  descricao: string;
  /** Palavras que bastam para reconhecer sem o Jev (sem acento, minúsculas). */
  palavras: string[];
}

export const INTENCOES: Record<MesaDoAgente, IntencaoDoAgente[]> = {
  videos: [
    { valor: "gerar", rotulo: "Gerar a próxima cena", descricao: "Gerar, animar ou criar um vídeo ou uma cena com modelo de IA (escolher cena, roteiro, modelo, duração, câmera).", palavras: ["gerar", "gera", "animar", "anima", "criar video", "criar cena", "fazer video", "modelo"] },
    { valor: "enviar_para_edicao", rotulo: "Mandar para a Edição", descricao: "Aprovar vídeos gerados e mandar para a Mesa Edição.", palavras: ["mandar para a edicao", "enviar para a edicao", "manda pra edicao", "aprovar", "aprova", "edicao"] },
    { valor: "resultados", rotulo: "Ver resultados", descricao: "Ver os vídeos que já foram gerados e os pedidos na fila.", palavras: ["resultado", "gerados", "fila", "pedidos"] },
    { valor: "base", rotulo: "Abrir a base", descricao: "Ver a base: personagens, produtos, cenas da história e roteiros aprovados.", palavras: ["base", "personagem", "personagens", "produto", "produtos", "roteiro", "roteiros", "historia", "cenas"] },
    { valor: "situacao", rotulo: "O que falta", descricao: "Resumo do que já existe e do que falta para gerar e entregar os vídeos.", palavras: ["o que falta", "falta", "resumo", "situacao", "status", "como esta"] },
    // Frente V-A (26/09): diretor (bíblia, roteiro, kits e templates) e troca de ângulo.
    { valor: "diretor", rotulo: "Planejar com o diretor", descricao: "Planejar um filme ou anúncio com o diretor: kit, pesquisa da região, bíblia (personagens, cenários, luz), roteiro plano a plano e template.", palavras: ["diretor", "biblia", "kit", "filme", "template", "shot list", "planejar", "pesquisa a regiao", "montar o filme"] },
    { valor: "angulo", rotulo: "Trocar o ângulo", descricao: "Gerar a mesma pessoa ou o mesmo cenário visto de outro ângulo de câmera (de lado, de costas, de cima).", palavras: ["angulo", "de lado", "de perfil", "de costas", "outro angulo", "trocar a camera"] },
    // Frente AG2 (29/09): o agente age nos resultados (sem custo, com Desfazer).
    { valor: "organizar", rotulo: "Organizar os takes", descricao: "Organizar os vídeos: separar por roteiro, cena e tomada, renomear no padrão e marcar os melhores takes.", palavras: ["organizar", "organiza", "organize", "renomear", "renomeia", "agrupar", "separar por cena", "separa por cena"] },
    { valor: "arquivar", rotulo: "Arquivar resultados", descricao: "Arquivar (tirar da lista, sem apagar) um ou mais vídeos gerados que não servem.", palavras: ["arquivar", "arquive", "arquiva o", "arquiva a", "arquiva os", "arquiva as", "arquiva esse", "arquiva essa", "tira da lista", "tirar da lista"] },
    { valor: "vincular", rotulo: "Ligar à cena", descricao: "Ligar um vídeo gerado a uma cena de um roteiro aprovado (vincular à cena 2, ligar ao roteiro).", palavras: ["vincular", "vincula", "vincule", "liga a cena", "liga na cena", "ligar a cena", "ligar na cena", "liga ao roteiro", "ligar ao roteiro"] },
  ],
  edicao: [
    { valor: "organizar", rotulo: "Organizar tudo", descricao: "Organizar os vídeos: separar por roteiro, cena e tomada, renomear no padrão e marcar os melhores takes.", palavras: ["organizar", "organiza", "separar", "separa", "renomear", "renomeia", "melhores", "melhor take", "agrupar"] },
    { valor: "subir", rotulo: "Subir vídeos", descricao: "Subir ou enviar vídeos de fora para a mesa.", palavras: ["subir", "sobe", "enviar video", "upload", "importar", "arrastar"] },
    { valor: "transcrever", rotulo: "Transcrever", descricao: "Transcrever a fala ou preparar a legenda dos vídeos.", palavras: ["transcrever", "transcreve", "transcricao", "legenda", "legendar"] },
    { valor: "pacote", rotulo: "Montar o pacote", descricao: "Editar: montar o pacote para o editor ou para o Remotion com a direção de edição dinâmica.", palavras: ["pacote", "editar", "edita", "remotion", "montar", "edicao dinamica", "direcao"] },
    { valor: "versoes", rotulo: "Versões", descricao: "Ver versões do vídeo, comentar no tempo e aprovar ou rejeitar.", palavras: ["versao", "versoes", "comentar", "comentario", "aprovar versao", "rejeitar"] },
    { valor: "situacao", rotulo: "O que falta", descricao: "Resumo do que já existe e do que falta para editar e entregar.", palavras: ["o que falta", "falta", "resumo", "situacao", "status", "como esta"] },
  ],
};

export const NENHUMA = "nenhuma";

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Reserva sem IA: a intenção cuja palavra aparece primeiro no texto (frase mais longa ganha empate). */
export function intencaoPorPalavras(mesa: MesaDoAgente, texto: string): string {
  const t = ` ${semAcento(texto)} `;
  let melhor: { valor: string; pos: number; tam: number } | null = null;
  for (const i of INTENCOES[mesa]) {
    for (const p of i.palavras) {
      const pos = t.indexOf(p);
      if (pos < 0) continue;
      if (!melhor || p.length > melhor.tam || (p.length === melhor.tam && pos < melhor.pos)) melhor = { valor: i.valor, pos, tam: p.length };
    }
  }
  return melhor ? melhor.valor : NENHUMA;
}

/** Pergunta Choice do Jev (formato de _shared/jev.ts), com "nenhuma" para pedido fora da lista. */
export function perguntaDaIntencao(mesa: MesaDoAgente, texto: string) {
  const criteria: Record<string, string> = {};
  INTENCOES[mesa].forEach((i) => {
    criteria[i.valor] = i.descricao;
  });
  criteria[NENHUMA] = "O pedido não é nenhuma das opções acima (conversa solta, outra mesa ou algo que esta mesa não faz).";
  return {
    state: {
      mesa: mesa === "videos" ? "Mesa Vídeos: gerar cenas e vídeos com modelos de IA" : "Mesa Edição: subir vídeos de fora, organizar e editar",
      pedido: String(texto || "").slice(0, 600),
    },
    questions: {
      intencao: {
        type: "choice" as const,
        instructions: "Qual destas ações a pessoa está pedindo em `pedido`, dentro da mesa descrita em `mesa`?",
        criteria,
      },
    },
  };
}

/** Confiança mínima para agir pela escolha do Jev; abaixo disso vale a reserva por palavras. */
export const CONFIANCA_MINIMA = 0.45;

export function intencaoValida(mesa: MesaDoAgente, v: unknown): string {
  const s = String(v || "");
  return INTENCOES[mesa].some((i) => i.valor === s) ? s : NENHUMA;
}

// ------------------------------------------------------------------ mandar para a Edição

export interface ResultadoGerado {
  id: string;
  nome: string;
  tipo: string;
  estado: string;
  edicao_desde: string | null;
  grupo?: string | null;
  /** AG2 (29/09): para as travas de arquivar e ligar à cena. */
  melhor?: boolean;
  em_versao_aprovada?: boolean;
  roteiro_id?: string | null;
  cena_ref?: string | null;
}

type AlvoDoResultado = Alvo & { dados: { r: ResultadoGerado } };

export const AGENTE_DO_ENVIO = "envio_para_edicao";

// AG2 (29/09): `direta` (regra 6 do contrato): sem custo e com Desfazer, a ordem clara vai na hora.
export const REGRAS_DO_ENVIO: Record<string, RegraDaOperacao<AlvoDoResultado>> = {
  enviar_para_edicao: {
    rotulo: "Mandar para a Edição",
    direta: true,
    trava: (a) => (a.dados.r.edicao_desde ? "Já está na Edição." : a.dados.r.estado === "arquivado" ? "Está arquivado." : null),
  },
};

/** Vídeos gerados que ainda não foram para a Edição. */
export const geradosForaDaEdicao = (lista: ResultadoGerado[]) => lista.filter((r) => r.tipo === "gerado" && r.estado !== "arquivado" && !r.edicao_desde);

/** Proposta do contrato comum: cada vídeo gerado (r1, r2...) vai para a Entrada da Edição. Null quando não há. */
export function acaoDoEnvioParaEdicao(lista: ResultadoGerado[], opcoes: { id?: string } = {}): AcaoDoAgente | null {
  const pendentes = geradosForaDaEdicao(lista);
  if (!pendentes.length) return null;
  const alvos = comApelido(
    pendentes.map((r): AlvoDoResultado => ({ id: r.id, titulo: r.nome || "vídeo", detalhe: r.grupo || null, dados: { r } })),
    "r",
  );
  return normalizarAcaoDoAgente(
    {
      resumo: `Mandar ${alvos.length} ${alvos.length === 1 ? "vídeo gerado" : "vídeos gerados"} para a Entrada da Mesa Edição. O arquivo não muda.`,
      itens: alvos.map((a) => ({ operacao: "enviar_para_edicao", ref: a.ref })),
    },
    alvos,
    REGRAS_DO_ENVIO,
    { agente: AGENTE_DO_ENVIO, id: opcoes.id },
  );
}

/** Campo gravado por operação do envio (e o desfazer volta ao valor de antes). */
export function camposDoEnvio(operacao: string, agora: string): { edicao_desde: string | null } {
  if (operacao === "enviar_para_edicao") return { edicao_desde: agora };
  if (operacao === "tirar_da_edicao") return { edicao_desde: null };
  throw new Error("Operação desconhecida.");
}

// ------------------------------------------------------------------ arquivar e ligar à cena (AG2, 29/09)

/** Ações do agente da mesa nos resultados (arquivar, ligar à cena): sem custo, com Desfazer. */
export const AGENTE_DOS_RESULTADOS = "resultados_da_mesa";

/** Cena de roteiro aprovado que o agente pode ligar a um vídeo (id do roteiro nunca vai para o modelo nem para o Jev). */
export interface CenaParaLigar {
  roteiro_id: string;
  roteiro: string;
  cena_ref: string;
  ordem: number;
  titulo: string;
}

/** O valor da ligação guardado no item (roteiro|cena); a tela mostra o rótulo, nunca o id. */
export const paraDaCena = (c: Pick<CenaParaLigar, "roteiro_id" | "cena_ref">) => `${c.roteiro_id}|${c.cena_ref}`;
export function lerParaDaCena(v: unknown): { roteiro_id: string; cena_ref: string } | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|(.{1,40})$/i.exec(String(v || ""));
  return m ? { roteiro_id: m[1], cena_ref: m[2] } : null;
}
export const rotuloDaCena = (c: Pick<CenaParaLigar, "roteiro" | "ordem" | "titulo">) => `${c.roteiro || "Roteiro"}, cena ${c.ordem}${c.titulo ? ` (${c.titulo})` : ""}`;

export const REGRAS_DOS_RESULTADOS: Record<string, RegraDaOperacao<AlvoDoResultado>> = {
  arquivar: {
    rotulo: "Arquivar",
    direta: true,
    trava: (a) =>
      a.dados.r.estado === "arquivado"
        ? "Já está arquivado."
        : a.dados.r.em_versao_aprovada
          ? "Está numa versão aprovada: fica no acervo."
          : a.dados.r.melhor
            ? "Marcado como melhor take: desmarque antes de arquivar."
            : null,
  },
  vincular_cena: {
    rotulo: "Ligar à cena",
    direta: true,
    para: (v) => (lerParaDaCena(v) ? String(v) : null),
    trava: (a, para) => {
      const c = lerParaDaCena(para);
      if (a.dados.r.estado === "arquivado") return "Está arquivado.";
      return c && a.dados.r.roteiro_id === c.roteiro_id && a.dados.r.cena_ref === c.cena_ref ? "Já está ligado a esta cena." : null;
    },
  },
};

/** Os itens da etapa como o Jev e o cartão veem: r1..rN na ordem da tela (sem id). */
export function itensReferiveis(lista: ResultadoGerado[]): Array<{ ref: string; titulo: string; detalhe: string | null }> {
  return lista.map((r, i) => ({ ref: `r${i + 1}`, titulo: r.nome || "vídeo", detalhe: [r.edicao_desde ? "na Edição" : "", r.melhor ? "melhor take" : "", r.grupo || ""].filter(Boolean).join(", ") || null }));
}

/** Proposta de arquivar os vídeos escolhidos (null quando não há nenhum). */
export function acaoDeArquivarResultados(escolhidos: ResultadoGerado[], opcoes: { id?: string } = {}): AcaoDoAgente | null {
  if (!escolhidos.length) return null;
  const alvos = comApelido(escolhidos.map((r): AlvoDoResultado => ({ id: r.id, titulo: r.nome || "vídeo", detalhe: r.grupo || null, dados: { r } })), "r");
  const acao = normalizarAcaoDoAgente(
    { resumo: `Arquivar ${alvos.length} ${alvos.length === 1 ? "vídeo" : "vídeos"} (sai da lista, não apaga). Dá para desfazer.`, itens: alvos.map((a) => ({ operacao: "arquivar", ref: a.ref })) },
    alvos,
    REGRAS_DOS_RESULTADOS,
    { agente: AGENTE_DOS_RESULTADOS, id: opcoes.id },
  );
  if (acao) acao.custo_estimado_usd = 0;
  return acao;
}

/** Proposta de ligar os vídeos escolhidos a UMA cena de roteiro aprovado. */
export function acaoDeLigarACena(escolhidos: ResultadoGerado[], cena: CenaParaLigar, opcoes: { id?: string } = {}): AcaoDoAgente | null {
  if (!escolhidos.length) return null;
  const alvos = comApelido(escolhidos.map((r): AlvoDoResultado => ({ id: r.id, titulo: r.nome || "vídeo", detalhe: r.grupo || null, dados: { r } })), "r");
  const rotulo = rotuloDaCena(cena);
  const acao = normalizarAcaoDoAgente(
    { resumo: `Ligar ${alvos.length} ${alvos.length === 1 ? "vídeo" : "vídeos"} a ${rotulo}. Dá para desfazer.`, itens: alvos.map((a) => ({ operacao: "vincular_cena", ref: a.ref, para: paraDaCena(cena) })) },
    alvos,
    REGRAS_DOS_RESULTADOS,
    { agente: AGENTE_DOS_RESULTADOS, id: opcoes.id, rotuloDoPara: () => rotulo },
  );
  if (acao) acao.custo_estimado_usd = 0;
  return acao;
}

/** Pergunta Choice do Jev: qual cena o pedido indica (c1..cN, na ordem dos roteiros). */
export function perguntaDaCena(texto: string, cenas: CenaParaLigar[]) {
  const criteria: Record<string, string> = {};
  cenas.slice(0, 24).forEach((c, i) => {
    criteria[`c${i + 1}`] = rotuloDaCena(c);
  });
  criteria[NENHUMA] = "o pedido não diz a cena, ou diz uma cena que não está na lista";
  return {
    state: { pedido: String(texto || "").slice(0, 600) },
    questions: { cena: { type: "choice" as const, instructions: "A equipe quer ligar um vídeo a uma cena de roteiro. Qual destas cenas o `pedido` indica?", criteria } },
  };
}

/** Agentes cujas propostas a função mesa-videos executa (o diretor entrou na frente V-A). */
export const AGENTES_DA_MESA_DE_VIDEO = ["organizador_de_takes", AGENTE_DO_ENVIO, "diretor_de_video", AGENTE_DOS_RESULTADOS] as const;

/**
 * O "Ir para" das ações das mesas de vídeo (frente AG, 27/09: "quando termina
 * ele dá o caminho pra mim apertar e ir"):
 * - vídeos mandados para a Edição: a Entrada da Mesa Edição (parte vídeos);
 * - takes organizados: a etapa Organizar da Mesa Edição;
 * - planos gerados pelo diretor: os Resultados da Mesa Vídeos (fila e prontos).
 * Nada deu certo: sem caminho.
 */
export function caminhoDaMesaDeVideo(clientId: string, acao: Pick<AcaoDoAgente, "agente" | "resultados">, opcoes: { abrirSozinho?: boolean } = {}): CaminhoDoAgente | null {
  if (acao.resultados && acao.resultados.length && !acao.resultados.some((r) => r.ok)) return null;
  const base = { clientId, abrirSozinho: opcoes.abrirSozinho };
  if (acao.agente === AGENTE_DO_ENVIO) return caminhoNaArea("mesa_edicao", { ...base, etapa: "entrada", estado: { parte: "videos" }, rotulo: "Abrir na Mesa Edição" });
  if (acao.agente === "organizador_de_takes") return caminhoNaArea("mesa_edicao", { ...base, etapa: "organizar", rotulo: "Ver os takes organizados" });
  if (acao.agente === "diretor_de_video") {
    // Mandar ao editor: a versão fica na Mesa Edição (etapa Editar, versões).
    if (acao.resultados && acao.resultados.some((r) => r.ok && r.operacao === "mandar_ao_editor")) return caminhoNaArea("mesa_edicao", { ...base, etapa: "editar", estado: { parte: "versoes" }, rotulo: "Abrir no editor" });
    return caminhoNaArea("mesa_videos", { ...base, etapa: "resultados", rotulo: "Ver em Resultados" });
  }
  if (acao.agente === AGENTE_DOS_RESULTADOS) return caminhoNaArea("mesa_videos", { ...base, etapa: "resultados", rotulo: "Ver em Resultados" });
  return null;
}
