/**
 * Autocorreção do Estúdio (docs/mesa-ads/v2/CONTRATO-V2.md, seção "Estúdio:
 * autocorreção antes de mostrar"). Pedido do dono: a conferência vem ANTES
 * de entregar; se estiver errado, o agente já corrige, para não gastar
 * crédito entregando erro.
 *
 * Função pura: recebe a verificação gravada por conferir_card e diz se a
 * lâmina precisa de correção, por quê (motivos curtos, para a tela) e qual a
 * instrução de edição (para o mesmo caminho do ajuste). Sem banco, sem IA:
 * roda igual no Deno e nos testes.
 *
 * Regras:
 * - leitura com erro ou conferência pendente: não corrige (sem leitura não dá
 *   para saber o que está errado);
 * - texto diferente do combinado (ortografia_ok === false): reescrever
 *   EXATAMENTE o texto_exato, citando as palavras que faltam e as que sobram;
 * - logo (logo_ok === false): coloca a logo que falta ou tira a que sobra;
 * - identidade abaixo da metade da escala;
 * - só no anúncio: risco de política alto (nível "Risco alto" ou "Viola" de
 *   NIVEIS_RISCO_POLITICA) e clareza da oferta abaixo da metade da escala.
 *
 * A instrução preserva o resto da arte e nunca escurece a foto: destaque vem
 * de contraste, cor, escala e composição.
 */

import { NIVEIS_CLAREZA, NIVEIS_RISCO_POLITICA } from "../_shared/conhecimento-ads.ts";

export type NotaDaConferencia =
  | { nota: number | null; escala_max: number; nivel?: string | null; confianca?: number | null }
  | { erro: string }
  | null
  | undefined;

/** O que a decisão lê da verificação (o tipo completo mora no index.ts). */
export type VerificacaoParaDecidir = {
  pendente?: boolean;
  texto_lido?: string | null;
  ortografia_ok?: boolean | null;
  faltando?: string[];
  sobrando?: string[];
  logo_presente?: boolean | null;
  logo_ok?: boolean | null;
  identidade?: NotaDaConferencia;
  politica?: NotaDaConferencia;
  clareza?: NotaDaConferencia;
  erro?: string;
};

export type DecisaoDeAutocorrecao = {
  precisa: boolean;
  motivos: string[];
  instrucao: string | null;
};

/** Rodadas automáticas seguidas por lâmina; a terceira o servidor recusa. */
/**
 * Uma rodada automática só (24/09/2026): duas rodadas triplicavam o custo da
 * lâmina, demoravam e a edição da imagem inteira inventava defeitos (cabeça
 * virada, mão errada, borda). A correção agora mexe só na área do texto e da
 * logo; o resto da imagem volta pixel a pixel do original.
 */
export const LIMITE_DE_AUTOCORRECAO = 1;

/**
 * Nível de NIVEIS_RISCO_POLITICA a partir do qual corrige: 0 "Viola" e 1
 * "Risco alto de reprovação". Moderado (2) fica para a equipe decidir.
 */
export const NIVEL_POLITICA_QUE_CORRIGE = NIVEIS_RISCO_POLITICA.findIndex((n) => /risco alto/i.test(n));

const PRESERVAR =
  "Todo o resto fica igual: composição, foto, pessoas, objetos, fundo, cores, tipografia e posição dos elementos. Nunca escureça a foto nem ponha véu, sombra ou caixa escura atrás do texto; o destaque vem de contraste, cor, escala e composição. Sem travessão.";

const lista = (p: string[]) => p.map((x) => `"${x}"`).join(", ");

/** Nota válida da conferência (o Jev pode ter falhado: { erro }). */
function notaValida(n: NotaDaConferencia): { nota: number; escala: number; nivel: string | null } | null {
  if (!n || typeof n !== "object" || "erro" in n) return null;
  const nota = typeof n.nota === "number" && Number.isFinite(n.nota) ? n.nota : null;
  const escala = typeof n.escala_max === "number" && n.escala_max > 0 ? n.escala_max : null;
  if (nota == null || escala == null) return null;
  return { nota, escala, nivel: typeof n.nivel === "string" && n.nivel ? n.nivel : null };
}

const abaixoDaMetade = (n: { nota: number; escala: number }) => n.nota < n.escala / 2;

/** Nível da política pela nota; a escala da nota manda (padrão: NIVEIS_RISCO_POLITICA). */
function nivelDaPolitica(n: { nota: number; escala: number }): number {
  const niveis = NIVEIS_RISCO_POLITICA.length - 1;
  // Nota numa escala diferente (defensivo): traz para a escala dos níveis.
  const nota = n.escala === niveis ? n.nota : (n.nota / n.escala) * niveis;
  return Math.max(0, Math.min(niveis, Math.round(nota)));
}

export function decidirAutocorrecao(
  verificacao: VerificacaoParaDecidir | null | undefined,
  opcoes: { ads: boolean; textoExato: string },
): DecisaoDeAutocorrecao {
  const v = verificacao;
  if (!v || v.pendente) {
    return { precisa: false, motivos: ["Conferência ainda não feita: confira antes de corrigir."], instrucao: null };
  }
  if (v.erro) {
    return {
      precisa: false,
      motivos: [`A leitura da arte falhou (${v.erro}); sem leitura não dá para corrigir com segurança. Confira de novo.`],
      instrucao: null,
    };
  }

  const motivos: string[] = [];
  const passos: string[] = [];
  const textoExato = (opcoes.textoExato || "").trim();

  // 1) Texto: reescreve exatamente o combinado.
  if (v.ortografia_ok === false) {
    const faltando = (v.faltando ?? []).filter(Boolean);
    const sobrando = (v.sobrando ?? []).filter(Boolean);
    const detalhes = [
      faltando.length ? `faltou ${lista(faltando)}` : "",
      sobrando.length ? `sobrou ${lista(sobrando)}` : "",
    ].filter(Boolean).join("; ");
    motivos.push(`Texto errado na arte${detalhes ? `: ${detalhes}` : ""}`);
    if (textoExato) {
      passos.push(
        [
          `Reescreva o texto da arte EXATAMENTE assim, com a mesma grafia, os mesmos acentos e as mesmas quebras de linha, e nenhum outro texto: "${textoExato}".`,
          faltando.length ? `Na arte atual faltam ou estão escritas errado estas palavras: ${lista(faltando)}.` : "",
          sobrando.length ? `Estas palavras aparecem a mais ou com grafia errada e devem sair ou ser corrigidas: ${lista(sobrando)}.` : "",
          "Mantenha a mesma fonte, cor, tamanho e posição do texto; só as letras mudam.",
        ].filter(Boolean).join(" "),
      );
    } else {
      passos.push(
        `Esta lâmina não leva texto: apague ${sobrando.length ? `as palavras ${lista(sobrando)}` : "todo o texto"} e preencha o lugar com a continuação do fundo.`,
      );
    }
  }

  // 2) Logo.
  if (v.logo_ok === false) {
    if (v.logo_presente === false) {
      motivos.push("Logo da marca faltando");
      passos.push(
        "Coloque a logo oficial anexada, exatamente como é (sem redesenhar, sem mudar cor nem proporção), num canto com respiro, sem cobrir o texto nem o assunto principal.",
      );
    } else {
      motivos.push("Logo onde não devia");
      passos.push("Tire a logo desta lâmina e preencha o lugar com a continuação do fundo.");
    }
  }

  // Até aqui, erro objetivo (texto e logo): é o que corrige sozinho.
  const objetivos = passos.length;

  // 3) Identidade da marca.
  const identidade = notaValida(v.identidade);
  if (identidade && abaixoDaMetade(identidade)) {
    motivos.push(`Identidade da marca baixa (nota ${arred1(identidade.nota)} de ${identidade.escala})`);
    passos.push(
      [
        "Traga a arte para a identidade da marca: cores da paleta do kit (hex da marca), a tipografia e o estilo da marca e as regras do kit.",
        identidade.nivel ? `Hoje está assim: ${identidade.nivel}` : "",
        "Mude cores, tipografia e acabamento gráfico; não troque a foto, o assunto nem o texto.",
      ].filter(Boolean).join(" "),
    );
  }

  if (opcoes.ads) {
    // 4) Política da Meta.
    const politica = notaValida(v.politica);
    if (politica && NIVEL_POLITICA_QUE_CORRIGE >= 0 && nivelDaPolitica(politica) <= NIVEL_POLITICA_QUE_CORRIGE) {
      motivos.push(`Risco de política alto: ${NIVEIS_RISCO_POLITICA[nivelDaPolitica(politica)]}`);
      passos.push(
        "Tire da IMAGEM o que pode reprovar o anúncio na Meta, sem mudar o texto combinado: nada de antes e depois, corpo ou pessoa exposta para apontar defeito, elemento que imita botão, notificação ou interface do Instagram, símbolo de dinheiro ou resultado garantido, e nada sensacionalista. Troque por uma cena neutra e real do produto ou serviço.",
      );
    }
    // 5) Clareza da oferta.
    const clareza = notaValida(v.clareza);
    if (clareza && abaixoDaMetade(clareza)) {
      const nivel = clareza.nivel || NIVEIS_CLAREZA[Math.max(0, Math.min(NIVEIS_CLAREZA.length - 1, Math.round(clareza.nota)))];
      motivos.push(`Oferta pouco clara (nota ${arred1(clareza.nota)} de ${clareza.escala})`);
      passos.push(
        [
          "Deixe a oferta legível em 1 segundo no celular: a frase da oferta maior e com mais contraste de cor, hierarquia clara entre oferta, apoio e chamada, e o que compete com a oferta menor ou mais afastado.",
          nivel ? `Hoje está assim: ${nivel}` : "",
          "O texto continua o mesmo.",
        ].filter(Boolean).join(" "),
      );
    }
  }

  // Só texto e logo (os dois primeiros blocos) são erro objetivo e corrigem
  // sozinhos, dentro das áreas de texto e logo. Identidade, política e clareza
  // são julgamento: ficam como aviso para a equipe decidir (Mirante, 24/09: a
  // edição da imagem inteira por "identidade baixa" inventou cabeça virada,
  // mão errada e borda, e triplicou o custo).
  if (!objetivos) return { precisa: false, motivos, instrucao: null };
  const instrucao = [
    "Corrija esta lâmina, só o que está listado:",
    ...passos.slice(0, objetivos).map((p, i) => `${i + 1}. ${p}`),
    PRESERVAR,
  ].join("\n");
  return { precisa: true, motivos, instrucao };
}

const arred1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Quantas rodadas automáticas seguidas a lâmina já teve: conta, da versão mais
 * nova para trás, as que vieram da autocorreção. Uma versão gerada, ajustada
 * pela equipe ou corrigida a pedido da equipe ("Corrigir de novo") fecha a
 * sequência.
 */
export function rodadasSeguidas(
  versoes: { versao: number; autocorrecao?: { rodada?: number; pedido_da_equipe?: boolean } | null }[],
): number {
  const ordenadas = versoes.slice().sort((a, b) => b.versao - a.versao);
  let n = 0;
  for (const v of ordenadas) {
    if (!v.autocorrecao || v.autocorrecao.pedido_da_equipe) break;
    n++;
  }
  return n;
}
