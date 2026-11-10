/**
 * A ordem dos agentes na hierarquia (10/11/2026): as contas do arrastar, sem tela.
 *
 * Um "grupo" é o que aparece junto: os coordenadores, ou os agentes de uma área. Mover é sempre dentro
 * de um grupo ou de um grupo para outro; quem muda de área leva a área nova junto. A ordem gravada é
 * 10, 20, 30... dentro do grupo: sobra espaço para o Hermes encaixar um agente novo pelo MCP sem
 * renumerar tudo.
 */

export type ItemDeOrdem = { id: string; display_order: number; area?: string | null };

export const SEM_AREA = "Sem área definida";

/** O grupo com o agente movido colocado antes do alvo (ou no fim, sem alvo). */
export function colocarNoGrupo<T extends { id: string }>(grupo: T[], movido: T, antesDeId: string | null): T[] {
  const lista = grupo.filter((n) => n.id !== movido.id);
  const i = antesDeId ? lista.findIndex((n) => n.id === antesDeId) : -1;
  if (i < 0) lista.push(movido);
  else lista.splice(i, 0, movido);
  return lista;
}

/** Um passo para cima (-1) ou para baixo (1). Devolve null quando já está na ponta. */
export function passoNoGrupo<T extends { id: string }>(grupo: T[], id: string, sentido: -1 | 1): T[] | null {
  const i = grupo.findIndex((n) => n.id === id);
  const j = i + sentido;
  if (i < 0 || j < 0 || j >= grupo.length) return null;
  const lista = [...grupo];
  [lista[i], lista[j]] = [lista[j], lista[i]];
  return lista;
}

/**
 * O que gravar: a ordem nova de todo o grupo e, só para quem mudou de área, a área.
 * `area` indefinida = o movido ficou na mesma área (ou é coordenador): a área não é tocada.
 */
export function ordemParaGravar(lista: { id: string }[], movidoId: string, area?: string | null): ItemDeOrdem[] {
  return lista.map((n, k) => ({
    id: n.id,
    display_order: (k + 1) * 10,
    ...(n.id === movidoId && area !== undefined ? { area: area === SEM_AREA ? null : area } : {}),
  }));
}

/** Onde o agente roda. A ordem é a da legenda da hierarquia. */
export const ORIGENS: { valor: string; rotulo: string; classe: string }[] = [
  { valor: "hermes", rotulo: "Hermes", classe: "bg-info/15 text-info" },
  { valor: "grok", rotulo: "Grok", classe: "bg-primary/15 text-primary" },
  { valor: "paperclip", rotulo: "Paperclip", classe: "bg-warning/15 text-warning" },
  { valor: "n8n", rotulo: "n8n", classe: "bg-destructive/15 text-destructive" },
  { valor: "claude_code", rotulo: "Claude Code", classe: "bg-success/15 text-success" },
  { valor: "codex", rotulo: "Codex", classe: "bg-secondary text-foreground" },
  { valor: "chatgpt", rotulo: "ChatGPT", classe: "bg-secondary text-foreground" },
];
export const nomeDaOrigem = (o?: string | null) => ORIGENS.find((x) => x.valor === o)?.rotulo ?? (o || "Hermes");
export const classeDaOrigem = (o?: string | null) => ORIGENS.find((x) => x.valor === o)?.classe ?? "bg-secondary text-muted-foreground";

/** O identificador do agente novo, a partir do nome: sem acento, minúsculo, com hífen, e único. */
export function slugDoNome(nome: string, usados: string[]): string {
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "agente";
  let slug = base;
  for (let n = 2; usados.includes(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

/** O formulário vazio do agente novo (sem id: é assim que a janela sabe que é cadastro). */
export const AGENTE_NOVO = { id: "", slug: "", display_name: "", role: "", scope: "", status: "active", area: null as string | null, parent_slug: null as string | null, origem: "hermes" as string | null, is_coordinator: false };
