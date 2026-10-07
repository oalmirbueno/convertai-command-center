import { aindaVale, areaDaLinhaDeMemoria, categoriaDaLinhaDeMemoria } from "../../../supabase/functions/_shared/cerebro-do-cliente";

export interface RegistroDeConhecimento {
  id: string; client_id: string; texto: string; agente: string; tipo: string; ativa: boolean;
  area?: string | null; categoria?: string | null; fonte?: string | null; origem?: string | null;
  evidencia?: string | null; motivo?: string | null; criado_em: string; valido_ate?: string | null;
  substituida_por?: string | null; reforcos?: number; chave?: string | null;
}
export const AREA: Record<string, string> = { geral: "Cliente", calendario: "Calendário", campanha: "Campanhas", arte: "Artes", foto: "Fotos", ads: "Anúncios", copy: "Textos", conta: "Conta" };
export const CATEGORIA: Record<string, string> = { preferencia: "Preferência", evitar: "Não fazer", ajuste: "Ajuste", reprovado: "Reprovação", performou: "Resultado", aprendizado: "Conhecimento", entrega: "Entrega" };
export const areaDoRegistro = (r: RegistroDeConhecimento) => areaDaLinhaDeMemoria(r as unknown as Record<string, unknown>);
export const categoriaDoRegistro = (r: RegistroDeConhecimento) => categoriaDaLinhaDeMemoria(r as unknown as Record<string, unknown>);
export function estadoDoRegistro(r: RegistroDeConhecimento, agora = new Date()): "historico" | "revisar" | "uso" {
  if (!r.ativa || r.substituida_por) return "historico";
  const plano = r.texto.match(/^Plano do mês (\d{4}-\d{2}):/);
  const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  if (!aindaVale(r.valido_ate, agora) || (plano && plano[1] < mes)) return "revisar";
  return "uso";
}
/** Seções existentes no documento; nunca transforma uma inferência em fato. */
export function secoesDoDossie(corpo: string) {
  const saida: { titulo: string; texto: string }[] = [];
  let atual = { titulo: "Visão do cliente", texto: "" };
  for (const linha of corpo.split(/\r?\n/)) {
    const titulo = linha.match(/^#{1,4}\s+(.+?)\s*#*$/);
    if (titulo) { if (atual.texto.trim()) saida.push({ ...atual, texto: atual.texto.trim() }); atual = { titulo: titulo[1], texto: "" }; }
    else atual.texto += `${linha}\n`;
  }
  if (atual.texto.trim()) saida.push({ ...atual, texto: atual.texto.trim() });
  return saida;
}
export function filtrarConhecimento(registros: RegistroDeConhecimento[], clientId: string, filtro: string, busca: string, area: string, agora = new Date()) {
  const termo = busca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
  return registros.filter(r => r.client_id === clientId && (filtro === "todos" || estadoDoRegistro(r, agora) === filtro) && (area === "todas" || areaDoRegistro(r) === area)
    && (!termo || [r.texto, r.evidencia, r.motivo, r.fonte].filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").includes(termo)));
}
