/**
 * laboratorio (20/10/2026): o que se faz com a imagem que o nó gerou.
 *
 * - salvar_nos_arquivos { projeto_id, no_id, indices?: number[], destino: 'cliente' | 'laboratorio' }
 *   → { salvos: [{ nome, path, pasta }] }. 'laboratorio' confirma a pasta do projeto no Laboratório (onde já fica);
 *   'cliente' copia para o Workspace do cliente do projeto, pasta Laboratório / <projeto> (can_access_client).
 *   Projeto sem cliente: 'cliente' é 400 sem_cliente. Copiar de novo não duplica (pelo caminho).
 * - no_ajustar { projeto_id, no_id, indice, pedido (≤500), confirmado? } → nova execução do nó com a imagem ajustada.
 * - no_variar { projeto_id, no_id, indice, quantidade 1..4, confirmado? } → nova execução com as variações.
 *   Nos dois: sem confirmado, 409 confirmacao_necessaria com o custo; com ele, reserva nos créditos do Laboratório
 *   (falha devolve) e roda em segundo plano (execução 'rodando'; acompanhe por execucoes_ler). Resultado e
 *   Carrossel ajustam pelo motor da casa (ajustar_card da estudio-arte); os outros, pelo motor de imagem a partir
 *   da imagem escolhida.
 */
import { type Chamador, ErroHttp, json, limpo } from "./comum.ts";
import type { ProjetoDoLab, SaidaDoNo } from "./executar.ts";
import { arred, type Chamada, limitar, type NoDoCanvas, pastasDoLaboratorio } from "./modulos/regras.ts";
import { MAX_PEDIDO_DO_AJUSTE, MAX_VARIACOES } from "./motor-da-casa.ts";

type Corpo = Record<string, unknown>;
export type ExecucaoLida = { id: string; status: string; saida: Record<string, unknown> | null };
export type ImagemDaSaida = { path: string; url?: string | null; bucket?: string; no_workspace_id?: string | null };
export type Salvo = { nome: string; path: string; pasta: string };

export interface PortaDosAjustes {
  lerProjeto(ch: Chamador, id: unknown): Promise<ProjetoDoLab>;
  garantirAcesso(ch: Chamador, clientId: string): Promise<void>;
  /** A última execução pronta do nó (a que tem as imagens). */
  ultimaPronta(p: ProjetoDoLab, noId: string): Promise<ExecucaoLida | null>;
  nomeDoCliente(clientId: string): Promise<string>;
  copiarParaOCliente(o: { clientId: string; projeto: ProjetoDoLab; imagens: ImagemDaSaida[]; userId: string }): Promise<Salvo[]>;
  preco(chamadas: Chamada[]): Promise<number>;
  /** foraDaReserva: a estudio-arte cobra os créditos do Laboratório direto (motor da casa sem cliente): só confere o saldo. */
  cobrar(o: { total: number; noId: string; projetoId: string; nota: string; userId: string; foraDaReserva?: boolean }): Promise<{ devolverTudo(motivo: string): Promise<void> }>;
  criarExecucao(o: { p: ProjetoDoLab; no: NoDoCanvas; entrada: Record<string, unknown>; userId: string }): Promise<string>;
  atualizarExecucao(id: string, campos: Record<string, unknown>): Promise<void>;
  /** Ajusta (pedido) ou varia (quantidade) a imagem do índice; a saída nova e o custo real. */
  ajustar(ch: Chamador, p: ProjetoDoLab, no: NoDoCanvas, saida: Record<string, unknown>, o: { indice: number; pedido: string | null; quantidade: number; execucaoId: string }): Promise<{ saida: SaidaDoNo; custo: number }>;
  /** Roda em segundo plano (EdgeRuntime.waitUntil); false = quem chamou espera. */
  segundoPlano(p: Promise<unknown>): boolean;
  execucao(id: string): Promise<Response>;
}

const imagensDe = (saida: Record<string, unknown> | null): ImagemDaSaida[] =>
  (Array.isArray(saida && saida.imagens) ? (saida!.imagens as unknown[]) : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => typeof x.path === "string" && x.path)
    .map((x) => ({ path: String(x.path), url: typeof x.url === "string" ? x.url : null, bucket: typeof x.bucket === "string" ? x.bucket : "workspace", no_workspace_id: typeof x.no_workspace_id === "string" ? x.no_workspace_id : null }));

function noDe(p: ProjetoDoLab, corpo: Corpo): NoDoCanvas {
  const no = p.canvas.nos.find((n) => n.id === limpo(corpo.no_id, 80));
  if (!no) throw new ErroHttp(404, "no_inexistente", "Este nó não está no canvas salvo.");
  return no;
}

async function imagensDoNo(porta: PortaDosAjustes, p: ProjetoDoLab, no: NoDoCanvas): Promise<{ ex: ExecucaoLida; imagens: ImagemDaSaida[] }> {
  const ex = await porta.ultimaPronta(p, no.id);
  const imagens = imagensDe(ex ? ex.saida : null);
  if (!ex || !imagens.length) throw new ErroHttp(409, "sem_imagem", "Este nó ainda não tem imagem pronta. Rode o nó antes.");
  return { ex, imagens };
}

// ------------------------------------------------------------------ salvar nos arquivos

export async function salvarNosArquivos(porta: PortaDosAjustes, ch: Chamador, corpo: Corpo): Promise<Response> {
  const destino = corpo.destino === "cliente" ? "cliente" : corpo.destino === "laboratorio" ? "laboratorio" : null;
  if (!destino) throw new ErroHttp(400, "destino_invalido", "Destino é 'cliente' (arquivos do cliente) ou 'laboratorio' (a pasta do Laboratório).");
  const p = await porta.lerProjeto(ch, corpo.projeto_id);
  const no = noDe(p, corpo);
  if (destino === "cliente" && !p.client_id) throw new ErroHttp(400, "sem_cliente", "Este projeto não tem cliente: escolha o cliente do projeto ou salve na pasta do Laboratório.");
  const { imagens } = await imagensDoNo(porta, p, no);
  const pedidos = Array.isArray(corpo.indices) ? corpo.indices.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < imagens.length) : [];
  const escolhidas = pedidos.length ? pedidos.filter((i, k, a) => a.indexOf(i) === k).map((i) => imagens[i]) : imagens;
  if (destino === "cliente") {
    await porta.garantirAcesso(ch, p.client_id!);
    return json({ salvos: await porta.copiarParaOCliente({ clientId: p.client_id!, projeto: p, imagens: escolhidas, userId: ch.userId }) });
  }
  const pasta = pastasDoLaboratorio(p.client_id ? await porta.nomeDoCliente(p.client_id) : null, p.nome).join(" / ");
  return json({ salvos: escolhidas.map((i) => ({ nome: i.path.split("/").pop() || "imagem", path: i.path, pasta })) });
}

// ------------------------------------------------------------------ ajustar e variar

async function ajustarOuVariar(porta: PortaDosAjustes, ch: Chamador, corpo: Corpo, modo: "ajustar" | "variar"): Promise<Response> {
  const p = await porta.lerProjeto(ch, corpo.projeto_id);
  const no = noDe(p, corpo);
  const indice = Number(corpo.indice);
  const pedido = modo === "ajustar" ? limpo(corpo.pedido, MAX_PEDIDO_DO_AJUSTE) : null;
  if (modo === "ajustar" && !pedido) throw new ErroHttp(400, "pedido_vazio", "Diga o que ajustar na imagem.");
  const quantidade = modo === "variar" ? limitar(corpo.quantidade, 1, MAX_VARIACOES, 2) : 1;
  const { ex, imagens } = await imagensDoNo(porta, p, no);
  if (!Number.isInteger(indice) || indice < 0 || indice >= imagens.length) throw new ErroHttp(400, "indice_invalido", "Escolha uma das imagens geradas por este nó.");
  const doEstudio = !!ex.saida && ex.saida.motor === "estudio_arte";
  const motor = typeof no.dados.motor === "string" && no.dados.motor ? no.dados.motor : "";
  const chamadas: Chamada[] = [
    { tipo: "imagem", modelo_id: motor || "openrouter:openai/gpt-image-2.5-sunburst", tokens_entrada: 1200, tokens_saida: 0, imagens: quantidade, qualidade: "alta", imagens_entrada: 1 },
    ...(doEstudio ? [{ tipo: "texto" as const, modelo_id: "openrouter:anthropic/claude-opus-5.5", tokens_entrada: 4000 * quantidade, tokens_saida: 800 * quantidade, imagens: 0, qualidade: null }] : []),
  ];
  const custo = arred(await porta.preco(chamadas));
  if (corpo.confirmado !== true) {
    throw new ErroHttp(409, "confirmacao_necessaria", `Isto custa cerca de US$ ${custo.toFixed(4)}. Confirme para ${modo === "ajustar" ? "ajustar" : "gerar as variações"}.`, { total_usd: custo, por_no: [{ no_id: no.id, tipo: no.tipo, custo_usd: custo, chamadas }] });
  }
  // 20/10 (cobrança dupla): sem cliente, o ajuste no motor da casa é cobrado pela estudio-arte direto nos créditos do Lab.
  const cobranca = await porta.cobrar({ foraDaReserva: doEstudio && !p.client_id, total: custo, noId: no.id, projetoId: p.id, nota: `${modo === "ajustar" ? "Ajustar" : "Variar"} ${typeof no.dados.titulo === "string" && no.dados.titulo ? no.dados.titulo : no.tipo}`.slice(0, 120), userId: ch.userId });
  let execucaoId: string;
  try {
    execucaoId = await porta.criarExecucao({ p, no, entrada: { [modo]: { indice, ...(pedido ? { pedido } : { quantidade }) }, origem_execucao_id: ex.id, estimativa_usd: custo }, userId: ch.userId });
  } catch (err) {
    await cobranca.devolverTudo("o ajuste não chegou a começar");
    throw err;
  }
  const trabalho = (async () => {
    try {
      await porta.atualizarExecucao(execucaoId, { status: "rodando" });
      const r = await porta.ajustar(ch, p, no, ex.saida || {}, { indice, pedido, quantidade, execucaoId });
      await porta.atualizarExecucao(execucaoId, { status: "pronto", saida: { ...r.saida, origem: { execucao_id: ex.id, indice, modo } }, custo_usd: arred(r.custo), finished_at: new Date().toISOString() });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : "O ajuste falhou.";
      await porta.atualizarExecucao(execucaoId, { status: "erro", erro: motivo.slice(0, 500), finished_at: new Date().toISOString() });
      await cobranca.devolverTudo(motivo);
      throw err;
    }
  })();
  if (porta.segundoPlano(trabalho.catch(() => null))) return json({ execucao_id: execucaoId, status: "rodando", estimativa_usd: custo, acompanhar: "execucoes_ler" }, 202);
  await trabalho.catch(() => null);
  return await porta.execucao(execucaoId);
}

export const noAjustar = (porta: PortaDosAjustes, ch: Chamador, corpo: Corpo) => ajustarOuVariar(porta, ch, corpo, "ajustar");
export const noVariar = (porta: PortaDosAjustes, ch: Chamador, corpo: Corpo) => ajustarOuVariar(porta, ch, corpo, "variar");
