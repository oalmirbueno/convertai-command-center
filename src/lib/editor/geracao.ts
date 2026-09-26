/**
 * Gerações a partir do editor (frente V-B): troca de câmera (angulo_gerar),
 * clipe a partir de quadro (cena_gerar), continuar a partir do último quadro
 * (continuar_video) e transição entre dois quadros (transicao_gerar). Quem
 * implementa é a função mesa-videos (frente V-A); o contrato é o de
 * docs/video/CONTRATOS.md:
 *
 * 1. estimar (sem gasto): a chamada SEM `custo_confirmado_usd` (e com
 *    `so_estimar: true` no ângulo) devolve o custo, ou `409 confirmar_custo`
 *    com `custo_estimado` (também sem gasto). A tela mostra.
 * 2. gerar: o mesmo corpo com `custo_confirmado_usd` = o valor mostrado e um
 *    `uid` do clique (idempotência). Se o servidor calcular mais: `custo_mudou`
 *    e a tela pergunta de novo. `sem_cotacao`: não gera.
 * Ação que o servidor ainda não tem (acao_desconhecida, função não
 * publicada) vira "em preparação" na tela, sem quebrar.
 */

export type AcaoDeGeracao = "angulo_gerar" | "gerar_cena" | "continuar_video" | "transicao_gerar";

export const ROTULO_DA_GERACAO: Record<AcaoDeGeracao, string> = {
  angulo_gerar: "Trocar câmera",
  gerar_cena: "Virar clipe",
  continuar_video: "Continuar a partir daqui",
  transicao_gerar: "Criar transição",
};

export type Distancia = "perto" | "medio" | "longe";
export type Manter = "personagem" | "cenario" | "ambos";

export interface Angulo {
  azimute: number;
  elevacao: number;
  distancia: Distancia;
}

export const POSES_DE_CAMERA = [
  { id: "frente", rotulo: "Frente", azimute: 0, elevacao: 0 },
  { id: "tres_quartos_esq", rotulo: "3/4 esquerda", azimute: -45, elevacao: 0 },
  { id: "tres_quartos_dir", rotulo: "3/4 direita", azimute: 45, elevacao: 0 },
  { id: "perfil_esq", rotulo: "Perfil esquerdo", azimute: -90, elevacao: 0 },
  { id: "perfil_dir", rotulo: "Perfil direito", azimute: 90, elevacao: 0 },
  { id: "costas", rotulo: "Costas", azimute: 180, elevacao: 0 },
  { id: "de_cima", rotulo: "De cima", azimute: 0, elevacao: 45 },
  { id: "de_baixo", rotulo: "De baixo", azimute: 0, elevacao: -25 },
] as const;

export type IdDaPose = (typeof POSES_DE_CAMERA)[number]["id"];

export const DISTANCIAS: { valor: Distancia; rotulo: string }[] = [
  { valor: "perto", rotulo: "Perto" },
  { valor: "medio", rotulo: "Médio" },
  { valor: "longe", rotulo: "Longe" },
];

const limitar = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/** Ângulo do contrato: azimute -180..180, elevação -30..60 (graus inteiros). */
export function anguloDaPose(pose: IdDaPose, distancia: Distancia, ajuste?: { azimute?: number; elevacao?: number }): Angulo {
  const p = POSES_DE_CAMERA.find((x) => x.id === pose) || POSES_DE_CAMERA[0];
  let az = Math.round(p.azimute + (ajuste && ajuste.azimute ? ajuste.azimute : 0));
  while (az > 180) az -= 360;
  while (az < -180) az += 360;
  return { azimute: az, elevacao: limitar(Math.round(p.elevacao + (ajuste && ajuste.elevacao ? ajuste.elevacao : 0)), -30, 60), distancia };
}

export type ResultadoDaGeracao =
  | { estado: "preparado"; pedido_id: string | null; custo_usd: number | null; detalhe: string | null }
  | { estado: "confirmado"; pedido_id: string; custo_usd: number | null }
  | { estado: "em_preparacao"; mensagem: string }
  | { estado: "custo_mudou"; custo_usd: number | null; mensagem: string }
  | { estado: "erro"; mensagem: string };

export type Chamar = (corpo: Record<string, unknown>) => Promise<any>;

/** Nome da ação no servidor (a V-A chama "gerar cena" de cena_gerar). */
export const ACAO_NO_SERVIDOR: Record<AcaoDeGeracao, string> = {
  angulo_gerar: "angulo_gerar",
  gerar_cena: "cena_gerar",
  continuar_video: "continuar_video",
  transicao_gerar: "transicao_gerar",
};

const CODIGOS_EM_PREPARACAO = ["acao_desconhecida", "funcao_indisponivel", "servico_indisponivel", "em_preparacao", "motor_a_integrar", "banco_sem_gerador"];

const codigoDoErro = (e: unknown) => (e && typeof e === "object" && typeof (e as { codigo?: unknown }).codigo === "string" ? String((e as { codigo: string }).codigo) : "");
const mensagemDoErro = (e: unknown) => (e instanceof Error && e.message ? e.message : "Não foi possível concluir. Tente de novo.");
const detalhesDoErro = (e: unknown): Record<string, unknown> => (e && typeof e === "object" && (e as { detalhes?: unknown }).detalhes && typeof (e as { detalhes: unknown }).detalhes === "object" ? ((e as { detalhes: Record<string, unknown> }).detalhes) : {});

/** Custo em US$ do que o servidor devolveu (custo_estimado número ou { usd }). */
export function custoDe(r: unknown): number | null {
  const c = r && typeof r === "object" ? (r as Record<string, unknown>).custo_estimado : null;
  if (typeof c === "number" && isFinite(c)) return c;
  if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    const t = Number(o.usd !== undefined ? o.usd : o.total_usd);
    if (isFinite(t)) return t;
  }
  return null;
}

/** Fase 1: estima (sem gasto) e traz o custo para mostrar. */
export async function prepararGeracao(chamar: Chamar, acao: AcaoDeGeracao, corpo: Record<string, unknown>): Promise<ResultadoDaGeracao> {
  const pedido: Record<string, unknown> = { ...corpo, acao: ACAO_NO_SERVIDOR[acao] };
  delete pedido.custo_confirmado_usd;
  if (acao === "angulo_gerar") pedido.so_estimar = true;
  try {
    const r = await chamar(pedido);
    const c = custoDe(r);
    if (c === null && !(r && r.pedido_id)) return { estado: "em_preparacao", mensagem: "O servidor ainda não devolve o custo desta geração." };
    const det = r && r.custo_estimado && typeof r.custo_estimado === "object" && r.custo_estimado.detalhe ? String(r.custo_estimado.detalhe) : null;
    return { estado: "preparado", pedido_id: r && r.pedido_id ? String(r.pedido_id) : null, custo_usd: c, detalhe: det };
  } catch (e) {
    const codigo = codigoDoErro(e);
    if (codigo === "confirmar_custo") {
      const d = detalhesDoErro(e);
      const det = d.custo_estimado && typeof d.custo_estimado === "object" && (d.custo_estimado as Record<string, unknown>).detalhe ? String((d.custo_estimado as Record<string, unknown>).detalhe) : null;
      return { estado: "preparado", pedido_id: null, custo_usd: custoDe(d), detalhe: det };
    }
    if (CODIGOS_EM_PREPARACAO.indexOf(codigo) >= 0) return { estado: "em_preparacao", mensagem: `${ROTULO_DA_GERACAO[acao]} está em preparação no servidor.` };
    if (codigo === "sem_cotacao") return { estado: "erro", mensagem: "Este motor ainda não tem preço conferido: não gera." };
    return { estado: "erro", mensagem: mensagemDoErro(e) };
  }
}

/** Fase 2: o dono confirmou o custo mostrado. `uid` do clique evita gerar duas vezes. */
export async function confirmarGeracao(chamar: Chamar, acao: AcaoDeGeracao, custoMostrado: number | null, corpo: Record<string, unknown>, uid: string): Promise<ResultadoDaGeracao> {
  if (custoMostrado === null) return { estado: "erro", mensagem: "Sem custo conhecido não dá para gerar." };
  const pedido: Record<string, unknown> = { ...corpo, acao: ACAO_NO_SERVIDOR[acao], custo_confirmado_usd: custoMostrado, uid };
  delete pedido.so_estimar;
  try {
    const r = await chamar(pedido);
    return { estado: "confirmado", pedido_id: String((r && (r.pedido_id || (r.pedido && r.pedido.id))) || ""), custo_usd: custoDe(r) };
  } catch (e) {
    const codigo = codigoDoErro(e);
    if (codigo === "custo_mudou" || codigo === "confirmar_custo") return { estado: "custo_mudou", custo_usd: custoDe(detalhesDoErro(e)), mensagem: mensagemDoErro(e) };
    if (CODIGOS_EM_PREPARACAO.indexOf(codigo) >= 0) return { estado: "em_preparacao", mensagem: `${ROTULO_DA_GERACAO[acao]} está em preparação no servidor.` };
    return { estado: "erro", mensagem: mensagemDoErro(e) };
  }
}

export interface PedidoDeAngulo {
  client_id: string;
  imagem_path: string;
  angulo: Angulo;
  variacoes: number;
  modelo?: string | null;
  manter: Manter;
  continuidade?: { personagem: string | null; cenario: string | null } | null;
}

/** Continuidade (personagem e cenário) vira texto do prompt: o contrato não tem campo próprio. */
export function textoDeContinuidade(c?: { personagem: string | null; cenario: string | null } | null): string {
  if (!c) return "";
  const partes: string[] = [];
  if (c.personagem) partes.push(`Manter o personagem: ${c.personagem}.`);
  if (c.cenario) partes.push(`Manter o cenário: ${c.cenario}.`);
  return partes.join(" ");
}

/** Corpo do angulo_gerar exatamente como o contrato (docs/video/CONTRATOS.md). */
export function corpoDoAngulo(p: PedidoDeAngulo): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    client_id: p.client_id,
    imagem_path: p.imagem_path,
    angulo: { azimute: limitar(Math.round(p.angulo.azimute), -180, 180), elevacao: limitar(Math.round(p.angulo.elevacao), -30, 60), distancia: p.angulo.distancia },
    variacoes: limitar(Math.round(p.variacoes || 1), 1, 4),
    manter: p.manter,
  };
  if (p.modelo) corpo.modelo = p.modelo;
  const manter = textoDeContinuidade(p.continuidade);
  if (manter) corpo.prompt = manter;
  return corpo;
}
