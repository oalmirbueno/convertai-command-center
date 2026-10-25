/**
 * O que a função põe no trabalho da construção para o motor de código
 * (frente MCC, 25/10/2026): o modelo leve do Claude Code quando a jornada
 * não escolheu outro, e o motor de copy viral da casa no pacote.
 *
 * Copy: a copy de cada seção continua vindo da Mesa Site (pacote.copy,
 * escolhida pela equipe); o agente de código recebe também o guia da casa
 * (gancho, clareza, viralização, humanizer e verdade) e até 8 ganchos
 * vencedores do nicho (ganchos_vencedores), só como inspiração de fórmula
 * para o microtexto que ele escreve sozinho (botão, rótulo, aviso, título de
 * bloco sem copy) e para a skill copy-de-site do Claude Code.
 *
 * Nunca lança: sem banco ou sem a tabela, sai só o guia.
 */
import { blocoDoGuia, escolherGanchos, type Gancho, nichosDoTexto, VERSAO_DA_COPY_VIRAL } from "../../estudio-arte/modulos/copy-viral.ts";
import { registrarFalha } from "../../_shared/falha-registrada.ts";
import { MODELO_PADRAO_DO_CLAUDE_CODE } from "./partida-no-motor.ts";

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any };

export type CopyDaCasaNoMotor = {
  versao: string;
  guia: string;
  nichos: string[];
  ganchos: Array<{ formula: string; exemplo: string; por_que_funciona: string; gatilho: string }>;
};

/** O texto do negócio (marca do pacote) vira os nichos do banco de ganchos. */
export function nichosDoPacote(pacote: Record<string, unknown>): string[] {
  const marca = (pacote && typeof pacote.marca === "object" && pacote.marca ? pacote.marca : {}) as Record<string, unknown>;
  return nichosDoTexto(marca.negocio, marca.oferta, marca.publico, pacote.cliente, pacote.tipo);
}

export async function copyDaCasaParaOMotor(db: Banco, pacote: Record<string, unknown>, semente: string): Promise<CopyDaCasaNoMotor> {
  const nichos = nichosDoPacote(pacote);
  let ganchos: Gancho[] = [];
  try {
    const { data, error } = await db
      .from("ganchos_vencedores")
      .select("id, formula, exemplo, por_que_funciona, gatilho, formato, nichos")
      .eq("ativo", true)
      .overlaps("nichos", nichos.indexOf("geral") >= 0 ? nichos : nichos.concat(["geral"]))
      .limit(200);
    if (error) throw error;
    ganchos = escolherGanchos((data ?? []) as Gancho[], { nichos, formato: "anuncio", n: 8, semente });
  } catch (e) {
    registrarFalha("mesa-site: ganchos do motor não lidos (segue só com o guia)", e, { nichos: nichos.join(",") });
  }
  return {
    versao: VERSAO_DA_COPY_VIRAL,
    guia: blocoDoGuia(),
    nichos,
    ganchos: ganchos.slice(0, 8).map((g) => ({ formula: g.formula, exemplo: g.exemplo, por_que_funciona: g.por_que_funciona, gatilho: String(g.gatilho || "") })),
  };
}

/**
 * O modelo do trabalho da construção. Escolhido na tela vence; com a jornada
 * (contrato) no Claude Code (o padrão) e sem escolha, vai o modelo leve
 * (MODELO_PADRAO_DO_CLAUDE_CODE) se ele estiver ativo no catálogo; senão o
 * modelo do site (e, sem ele, o padrão do papel "site").
 */
export async function modeloIdDaConstrucao(db: Banco, p: { escolhido: unknown; doSite: string | null; contrato: { motor?: string } | null }): Promise<string | null> {
  if (typeof p.escolhido === "string" && p.escolhido.trim()) return p.escolhido.trim();
  if (p.contrato && p.contrato.motor !== "opencode") {
    try {
      const { data } = await db.from("ia_modelos").select("id, ativo").eq("id", MODELO_PADRAO_DO_CLAUDE_CODE).maybeSingle();
      if (data && (data as { ativo?: boolean }).ativo) return MODELO_PADRAO_DO_CLAUDE_CODE;
    } catch (e) {
      registrarFalha("mesa-site: modelo leve do Claude Code não lido", e);
    }
  }
  return p.doSite || null;
}
