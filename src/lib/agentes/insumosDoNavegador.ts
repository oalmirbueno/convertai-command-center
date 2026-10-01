/**
 * O que a coleta do navegador do agente vira na mesa de origem, com um clique (frente CUS, 01/10/2026).
 * Puro: a mesa chama estas funções no "Usar" do cartão e grava pelo caminho de sempre (com Desfazer ou
 * versão), nunca por fora. Nada é inventado: só entra o que veio com fonte da tarefa.
 *
 * - Proposta › Mercado: um concorrente com a fonte (nome, o que faz bem e a página lida).
 * - Mesa Site › Direção: as notas de estilo vão para a observação da direção e o print vira referência.
 * - Mesa Identidade › Pesquisa: cada concorrente visual vira uma referência "concorrente" com cores e tipografia.
 * - Mesa Ads › Referências: o perfil público vira uma referência da biblioteca, com o print.
 */

import type { CartaoDaTarefa } from "./navegadorApi";

const texto = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const lista = (v: unknown) => (Array.isArray(v) ? v : []);

/** Domínio sem www ("https://www.x.com.br/a" -> "x.com.br"). */
export function dominioDaUrl(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url || "");
  return m ? m[1].replace(/^www\./i, "").replace(/:\d+$/, "") : "";
}

/** "2026-10-01" no horário de Brasília (a fonte da proposta pede a data). */
export function dataDeHoje(agora = Date.now()): string {
  return new Date(agora - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** A página que a tarefa leu (a primeira fonte ou a URL inicial). */
export const fonteDoCartao = (c: CartaoDaTarefa): string => {
  const f = lista(c.resultado.fontes).map((x) => String(x)).filter((x) => /^https?:\/\//.test(x));
  return f[0] || c.tarefa.url_inicial;
};

/** Proposta › Mercado: o concorrente com a fonte (o bloco aceita até 5 e só com fonte). */
export function concorrenteParaProposta(c: CartaoDaTarefa, agora = Date.now()) {
  const url = fonteDoCartao(c);
  const r = c.resultado;
  const nome = texto(r.titulo, 80) || dominioDaUrl(url) || "Concorrente";
  const dados = lista(r.dados)
    .map((d) => d as Record<string, unknown>)
    .filter((d) => texto(d.item, 80) && texto(d.valor, 200))
    .slice(0, 4)
    .map((d) => `${texto(d.item, 60)}: ${texto(d.valor, 120)}`);
  const fazBem = texto(r.resumo, 300) || texto(dados.join("; "), 300);
  return { nome, faz_bem: fazBem, oportunidade: dados.length && r.resumo ? texto(dados.join("; "), 300) : "", fonte: { titulo: nome, url, data: dataDeHoje(agora) } };
}

/** Mesa Site › Direção: o parágrafo que entra na observação (curto, com a fonte no começo). */
export function notasParaDirecao(c: CartaoDaTarefa): string {
  const r = c.resultado;
  const notas = lista(r.notas)
    .map((n) => n as Record<string, unknown>)
    .map((n) => `${texto(n.aspecto, 30)}: ${texto(n.nota, 160)}`)
    .filter((n) => n.length > 3)
    .slice(0, 6);
  const levar = lista(r.levar).map((x) => texto(x, 100)).filter(Boolean).slice(0, 4);
  const evitar = lista(r.evitar).map((x) => texto(x, 100)).filter(Boolean).slice(0, 4);
  const estilo = (r.estilo || {}) as { cores?: Array<{ hex?: string }>; fontes?: Array<{ familia?: string }> };
  const cores = lista(estilo.cores).map((x) => texto((x as { hex?: string }).hex, 9)).filter(Boolean).slice(0, 5);
  const fontes = lista(estilo.fontes).map((x) => texto((x as { familia?: string }).familia, 40)).filter(Boolean).slice(0, 3);
  const partes = [`Referência ${dominioDaUrl(fonteDoCartao(c))}: ${texto(r.resumo, 200)}`.trim()];
  if (notas.length) partes.push(notas.join("; "));
  if (cores.length || fontes.length) partes.push(`Lido do código: ${[cores.length ? `cores ${cores.join(", ")}` : "", fontes.length ? `fontes ${fontes.join(", ")}` : ""].filter(Boolean).join("; ")}`);
  if (levar.length) partes.push(`Levar: ${levar.join("; ")}`);
  if (evitar.length) partes.push(`Evitar: ${evitar.join("; ")}`);
  return partes.join(". ").replace(/\.\./g, ".").slice(0, 900);
}

/** Junta a nota nova à observação que já existe (sem repetir a mesma referência), até o teto do campo. */
export function observacaoComNotas(atual: string, nota: string, maximo = 1500): string {
  const a = String(atual || "").trim();
  if (!nota) return a;
  if (a.indexOf(nota.slice(0, 60)) >= 0) return a;
  return (a ? `${a}\n\n${nota}` : nota).slice(0, maximo);
}

/** O print da página inteira no computador (ou o primeiro print) para virar referência da mesa. */
export function printPrincipal(c: CartaoDaTarefa): string | null {
  const inteira = c.imagens.find((i) => /inteira no computador|topo/i.test(i.rotulo)) || c.imagens[0];
  return inteira ? inteira.storage_path : null;
}

export type ReferenciaDaIdentidade = { titulo: string; link: string; nota: string; tipo: "concorrente" | "referencia" };

/** Mesa Identidade › Pesquisa: uma referência "concorrente" por site lido, com o que comunica, cores e tipografia. */
export function concorrentesParaIdentidade(c: CartaoDaTarefa): ReferenciaDaIdentidade[] {
  return lista(c.resultado.concorrentes)
    .map((x) => x as Record<string, unknown>)
    .map((x) => {
      const cores = lista(x.cores).length ? lista(x.cores) : lista(x.cores_do_codigo);
      const tipografia = texto(x.tipografia, 60) || lista(x.fontes_do_codigo).map((f) => texto(f, 30)).filter(Boolean).slice(0, 2).join(", ");
      const nota = [texto(x.comunica, 140), texto(x.logo, 60) && `logo: ${texto(x.logo, 60)}`, cores.length && `cores: ${cores.map((h) => texto(h, 9)).slice(0, 4).join(", ")}`, tipografia && `tipografia: ${tipografia}`]
        .filter(Boolean)
        .join(" · ");
      return { titulo: texto(x.nome, 120) || texto(x.dominio, 120), link: texto(x.site, 400), nota: nota.slice(0, 300), tipo: "concorrente" as const };
    })
    .filter((r) => r.titulo && /^https?:\/\//.test(r.link));
}

/** Mesa Ads › Referências: o perfil público como referência da biblioteca (com o print, quando tem). */
export function referenciaDeAds(c: CartaoDaTarefa): { titulo: string; url: string; origem: "instagram" | "tiktok" | "url"; storage_path: string | null } {
  const url = fonteDoCartao(c);
  const r = c.resultado;
  const og = (r.og || {}) as { titulo?: string };
  const host = dominioDaUrl(url);
  const origem = /instagram\.com$/.test(host) ? "instagram" : /tiktok\.com$/.test(host) ? "tiktok" : "url";
  const nome = texto(og.titulo, 80) || texto(r.titulo, 80) || host;
  return { titulo: `Perfil de concorrente: ${nome}`.slice(0, 120), url, origem, storage_path: printPrincipal(c) };
}
