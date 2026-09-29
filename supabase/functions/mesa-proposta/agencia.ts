/**
 * Dados da agência na proposta (quem somos e contatos), em cima da fonte
 * única da frente BASE: _shared/dados-da-agencia.ts (tabela agencia_dados,
 * preenchida em Configurações, Dados da agência). Nada é inventado: o que não
 * está cadastrado não aparece.
 *
 * Provas (cases e depoimentos) não moram lá ainda: o bloco fica vazio e some
 * da página até existir cadastro real com autorização. O agente nunca escreve
 * prova.
 *
 * Sem import de Deno: o Vitest lê este arquivo.
 */
import { type DadosDaAgencia, nomeDaAgencia } from "../_shared/dados-da-agencia.ts";

/** Linha de contatos para o quem somos e o rodapé do link (só o que existe). */
export function contatosDaAgencia(d: DadosDaAgencia): string {
  const cidade = [d.cidade, d.uf].filter(Boolean).join("/");
  const insta = d.instagram ? `@${String(d.instagram).replace(/^@/, "")}` : "";
  return [d.site, d.email, d.telefone, insta, cidade].filter(Boolean).join(" · ");
}

/** Blocos que vêm da agência: quem somos (nome e contatos) e provas (vazio até haver cadastro real). */
export function blocosDaAgencia(d: DadosDaAgencia): { provas: Record<string, unknown>; quem_somos: Record<string, unknown> } {
  const nome = nomeDaAgencia(d);
  const contatos = contatosDaAgencia(d);
  return {
    provas: { cases: [], depoimentos: [] },
    quem_somos: { texto: [nome ? `${nome}.` : "", contatos].filter(Boolean).join("\n\n") },
  };
}

/** O que a página pública mostra da agência (sem CNPJ, banco nem Pix). */
export function agenciaPublica(d: DadosDaAgencia): { nome: string; site: string; email: string; whatsapp: string; instagram: string } {
  return { nome: nomeDaAgencia(d) || "Aceleriq", site: d.site || "", email: d.email || "", whatsapp: d.telefone || "", instagram: d.instagram || "" };
}

// ------------------------------------------------------------------ conselho de agentes (gancho CNS)

/**
 * GANCHO CNS: a revisão da proposta inteira pelo conselho de agentes
 * (_shared/conselho.ts e a função conselho, frente CNS) abre pela tela, com o
 * BotaoDoConselho (origem "mesa-proposta", referência { tipo: "proposta", id }),
 * quando ele estiver no main. Até lá, a Revisão usa a conferência do Jev
 * (clareza, promessa de resultado e voz do cliente), só como aviso.
 */
export const CONSELHO_DISPONIVEL = false;
