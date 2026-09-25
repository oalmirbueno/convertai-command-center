/**
 * Tipos de conteúdo e frameworks na tela (Mês, conteúdo rápido e campanha).
 * Os ids são os mesmos de supabase/functions/_shared/conhecimento-conteudo.ts
 * (conferido em src/test/mesa-mes-rapido-e-velocidade.test.tsx). Aqui só o
 * que a tela mostra: nome e uma dica curta.
 */

export interface OpcaoEditorial {
  id: string;
  nome: string;
  dica: string;
}

/** Valor da escolha "o agente escolhe e mescla" (igual ao servidor). */
export const AGENTE_ESCOLHE = "auto";

export const TIPOS_DE_CONTEUDO: OpcaoEditorial[] = [
  { id: "storytelling", nome: "Storytelling contínuo", dica: "Personagem que volta; cada post é um capítulo." },
  { id: "educativo", nome: "Educativo", dica: "Responde uma dúvida real; bom de salvar." },
  { id: "conscientizacao", nome: "Conscientização", dica: "Mostra um problema que o público ainda não vê." },
  { id: "venda", nome: "Venda", dica: "Oferta, produto em foco, um caminho de compra." },
  { id: "engajamento", nome: "Engajamento", dica: "Enquete, escolha, opinião: conversa e alcance." },
  { id: "serie", nome: "Série que se complementa", dica: "Partes numeradas que se citam." },
  { id: "aviso", nome: "Aviso ou novidade", dica: "Informação importante, direta, no estático." },
  { id: "tutorial", nome: "Tutorial", dica: "Passo a passo com o resultado no fim." },
  { id: "prova_social", nome: "Prova social", dica: "Depoimento, avaliação ou resultado real." },
];

export const FRAMEWORKS: OpcaoEditorial[] = [
  { id: "aida", nome: "AIDA", dica: "Atenção, interesse, desejo, ação." },
  { id: "pas", nome: "PAS", dica: "Problema, agitação, solução." },
  { id: "bab", nome: "Antes, depois, ponte", dica: "Situação de hoje, resolvida, e o que liga." },
  { id: "4ps", nome: "4Ps", dica: "Promessa, retrato, prova, proposta." },
  { id: "fab", nome: "FAB", dica: "Característica, vantagem, benefício." },
  { id: "hook_story_offer", nome: "Gancho, história, oferta", dica: "Case ou bastidor com venda no fim." },
  { id: "lista", nome: "Lista", dica: "Dicas, erros, motivos: salvável." },
  { id: "antes_depois", nome: "Antes e depois", dica: "Resultado visível." },
  { id: "mito_verdade", nome: "Mito ou verdade", dica: "Quebra crença ou objeção." },
  { id: "passo_a_passo", nome: "Passo a passo", dica: "Processo em passos numerados." },
];

const nomeDe = (lista: OpcaoEditorial[], id?: string | null) => {
  const achado = lista.filter((o) => o.id === id)[0];
  return achado ? achado.nome : "";
};

export const nomeDoTipo = (id?: string | null) => nomeDe(TIPOS_DE_CONTEUDO, id);
export const nomeDoFramework = (id?: string | null) => nomeDe(FRAMEWORKS, id);

/** "Educativo · AIDA" (vazio quando o item não declarou). */
export function rotuloEditorial(tipo?: string | null, framework?: string | null): string {
  return [nomeDoTipo(tipo), nomeDoFramework(framework)].filter(Boolean).join(" · ");
}

/** Escolha da equipe: listas vazias = o agente escolhe e mescla. */
export interface EscolhaEditorial {
  tipos: string[];
  frameworks: string[];
}

export const escolhaLivre = (): EscolhaEditorial => ({ tipos: [], frameworks: [] });

/** Corpo da escolha para a função (só vai o que foi escolhido). */
export function corpoDaEscolha(e: EscolhaEditorial | null | undefined): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  if (e && e.tipos.length) corpo.tipos = e.tipos.slice(0, 9);
  if (e && e.frameworks.length) corpo.frameworks = e.frameworks.slice(0, 10);
  return corpo;
}

/** Resumo curto da escolha para a tela. */
export function resumoDaEscolha(e: EscolhaEditorial): string {
  if (!e.tipos.length && !e.frameworks.length) return "O agente escolhe e mescla";
  const tipos = e.tipos.map(nomeDoTipo).filter(Boolean);
  const fws = e.frameworks.map(nomeDoFramework).filter(Boolean);
  return [tipos.length ? tipos.join(", ") : "qualquer tipo", fws.length ? fws.join(", ") : "qualquer framework"].join(" · ");
}

/** Raciocínio padrão das telas do Mês (25/09): medium quando o modelo aceita. */
export function raciocinioPadraoDaTela(niveis: string[] | null | undefined, preferido = "medium"): string {
  const lista = niveis || [];
  if (lista.indexOf(preferido) >= 0) return preferido;
  const ordem = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const alvo = ordem.indexOf(preferido);
  const acima = lista.filter((n) => ordem.indexOf(n) >= alvo).sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
  return acima[0] || (lista.length ? lista[lista.length - 1] : "");
}
