import { supabase } from "@/integrations/supabase/client";
import { type CampoDoRamo, type TipoDeCampo } from "./nichos";

/**
 * Os campos próprios do negócio (13/11/2026, rodada 2). Cada empresa define os
 * dela em Configurações, Campos: o ramo traz uma lista pronta (consórcio pede
 * administradora, grupo e cota; imobiliária pede bairro e tipo de imóvel) e o
 * gestor cria, renomeia e desliga à vontade. O valor mora em `crm_leads.campos`
 * pela chave do campo. Só admin e gerente gravam a definição (o banco confere).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

export interface CampoDaEmpresa {
  id: string;
  chave: string;
  rotulo: string;
  tipo: TipoDeCampo;
  opcoes: string[];
  grupo: string;
  no_cartao: boolean;
  obrigatorio: boolean;
  ordem: number;
  ativo: boolean;
}

export const chaveDosCampos = (contaId: string) => ["produto", "campos", contaId] as const;

const lerCampo = (c: Record<string, unknown>): CampoDaEmpresa => ({
  id: String(c.id),
  chave: String(c.chave),
  rotulo: String(c.rotulo || ""),
  tipo: (c.tipo as TipoDeCampo) || "texto",
  opcoes: Array.isArray(c.opcoes) ? (c.opcoes as unknown[]).map((o) => String(o)) : [],
  grupo: String(c.grupo || ""),
  no_cartao: c.no_cartao === true,
  obrigatorio: c.obrigatorio === true,
  ordem: Number(c.ordem) || 0,
  ativo: c.ativo !== false,
});

export async function listarCampos(): Promise<CampoDaEmpresa[]> {
  const { data, error } = await db.from("crm_campos").select("*").order("ordem", { ascending: true }).order("criado_em", { ascending: true });
  if (error) throw error;
  return ((data || []) as Array<Record<string, unknown>>).map(lerCampo);
}

/** "Valor da carta" vira "valor_da_carta": minúsculas, sem acento, só letras, números e sublinhado. */
export function chaveDoRotulo(rotulo: string): string {
  const limpa = rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 38);
  return /^[a-z]/.test(limpa) ? (limpa.length >= 2 ? limpa : `${limpa}_`) : `c_${limpa}`.slice(0, 40);
}

export function opcoesDoTexto(texto: string): string[] {
  const vistas: string[] = [];
  texto.split(/[\n,;]+/).forEach((o) => {
    const limpa = o.trim().slice(0, 40);
    if (limpa && vistas.indexOf(limpa) < 0 && vistas.length < 30) vistas.push(limpa);
  });
  return vistas;
}

export async function salvarCampo(campo: Partial<CampoDaEmpresa> & { rotulo: string; tipo: TipoDeCampo }, existentes: CampoDaEmpresa[]): Promise<void> {
  const corpo = {
    rotulo: campo.rotulo.trim().slice(0, 40),
    tipo: campo.tipo,
    opcoes: campo.tipo === "lista" ? (campo.opcoes || []).slice(0, 30) : [],
    grupo: (campo.grupo || "").trim().slice(0, 40),
    no_cartao: !!campo.no_cartao,
    obrigatorio: !!campo.obrigatorio,
    ativo: campo.ativo !== false,
  };
  if (campo.id) {
    const { error } = await db.from("crm_campos").update(corpo).eq("id", campo.id);
    if (error) throw error;
    return;
  }
  let chave = chaveDoRotulo(corpo.rotulo);
  let n = 2;
  while (existentes.some((e) => e.chave === chave)) {
    chave = `${chaveDoRotulo(corpo.rotulo).slice(0, 36)}_${n}`;
    n += 1;
  }
  const { error } = await db.from("crm_campos").insert({ ...corpo, chave, ordem: existentes.length ? Math.max(...existentes.map((e) => e.ordem)) + 1 : 0 });
  if (error) throw error;
}

export async function apagarCampo(id: string): Promise<void> {
  const { error } = await db.from("crm_campos").delete().eq("id", id);
  if (error) throw error;
}

/** Liga de uma vez os campos sugeridos do ramo que a empresa ainda não tem. Devolve quantos entraram. */
export async function ligarCamposDoRamo(sugeridos: CampoDoRamo[], existentes: CampoDaEmpresa[]): Promise<number> {
  const novos = sugeridos.filter((s) => !existentes.some((e) => e.chave === s.chave));
  if (!novos.length) return 0;
  const base = existentes.length ? Math.max(...existentes.map((e) => e.ordem)) + 1 : 0;
  const { error } = await db.from("crm_campos").insert(
    novos.map((s, i) => ({ chave: s.chave, rotulo: s.rotulo, tipo: s.tipo, opcoes: s.opcoes || [], grupo: s.grupo || "", no_cartao: !!s.no_cartao, ordem: base + i })),
  );
  if (error) throw error;
  return novos.length;
}

/** O valor de um campo do jeito que a pessoa lê (cartão do funil e resumo). */
export function valorLegivel(campo: Pick<CampoDaEmpresa, "tipo">, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  if (campo.tipo === "sim_nao") return valor === true || valor === "sim" ? "Sim" : "Não";
  if (campo.tipo === "dinheiro") return (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (campo.tipo === "porcentagem") return `${String(valor).replace(".", ",")}%`;
  if (campo.tipo === "data") {
    const p = String(valor).slice(0, 10).split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(valor);
  }
  return String(valor);
}

/** Só o que tem valor entra no banco: campo vazio some da ficha em vez de virar texto vazio. */
export function camposLimpos(valores: Record<string, unknown>, campos: CampoDaEmpresa[]): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  const conhecidas = campos.map((c) => c.chave);
  Object.keys(valores || {}).forEach((chave) => {
    const v = valores[chave];
    if (v === "" || v === null || v === undefined) return;
    // Valor de campo que a empresa apagou continua guardado: quem apagou a definição pode recriar.
    const campo = campos.filter((c) => c.chave === chave)[0];
    if (!campo) {
      if (conhecidas.length === 0 || typeof v !== "object") saida[chave] = v;
      return;
    }
    if (campo.tipo === "numero" || campo.tipo === "dinheiro" || campo.tipo === "porcentagem") {
      const n = Number(String(v).replace(",", "."));
      if (isFinite(n)) saida[chave] = n;
    } else if (campo.tipo === "sim_nao") saida[chave] = v === true || v === "sim";
    else saida[chave] = String(v).slice(0, 300);
  });
  return saida;
}
