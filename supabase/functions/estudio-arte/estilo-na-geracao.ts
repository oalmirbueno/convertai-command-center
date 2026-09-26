/**
 * Estilo do cliente na geração da lâmina (frente S2, 26/09/2026).
 *
 * ADITIVO e opcional: só com o interruptor do trabalho ligado
 * (direcao.usar_estilo_do_cliente === true) e o estilo do cliente ativo e com
 * guia. Fora disso devolve null SEM ler o banco, e gerarCard monta o prompt de
 * sempre, byte a byte (teste: src/test/estilo-do-cliente.test.ts).
 *
 * Ligado: gerarCard acrescenta as imagens de referência do estilo DEPOIS das da
 * lâmina (guia de acabamento) e o bloco curto "ESTILO DO CLIENTE" no fim do
 * texto, antes das regras de render; a ordem e o conteúdo do promptDaLamina e
 * do promptDoReplicar não mudam. Qualquer falha na leitura do estilo vira null:
 * o estilo é complemento e nunca derruba a geração.
 *
 * Frente T (26/09): templates de design e referências de carrossel entram por
 * templateNaLamina (mais abaixo), também aditivos e só quando escolhidos.
 */

import type { ImagemEntrada } from "../_shared/ia-motor.ts";
import {
  type BancoDoEstilo,
  blocoDoEstiloParaOGerador,
  chaveDaMarca,
  type GuiaDoEstilo,
  guiaAtual,
  guiaTemConteudo,
  lerEstilo,
  MAX_REFERENCIAS_NO_GERADOR,
  ROTULO_DA_REFERENCIA_DO_ESTILO,
  usarEstiloNoTrabalho,
} from "../_shared/estilo-do-cliente.ts";
import { type KitDaTrava, neutralizarMarcaDaReferencia } from "../_shared/trava-da-marca.ts";
import { capacidadesDoModelo } from "../_shared/capacidades-imagem.ts";
import { estrategiaDaContinuidade, faixaDaBorda, linhasDaContinuidade, type Retangulo } from "../_shared/continuidade-do-carrossel.ts";
import {
  blocoDaReferenciaDeCarrossel,
  fidelidadeDaReferenciaDeCarrossel,
  mapaDasLaminas,
  ROTULO_DA_LAMINA_DE_REFERENCIA,
} from "../_shared/referencia-de-carrossel.ts";
import {
  ancorasParaALamina,
  type BancoDoTemplate,
  blocoDoTemplateParaOGerador,
  corpoAtual,
  corpoTemConteudo,
  lerTemplate,
  MAX_ANCORAS_NO_GERADOR,
  ROTULO_DA_ANCORA_DO_TEMPLATE,
  ROTULO_DA_FAIXA_DA_BORDA,
  templateEscolhidoNoTrabalho,
} from "../_shared/templates-de-design.ts";

export { blocoDoEstiloParaOGerador, ROTULO_DA_REFERENCIA_DO_ESTILO };
export { ROTULO_DA_ANCORA_DO_TEMPLATE, ROTULO_DA_FAIXA_DA_BORDA, ROTULO_DA_LAMINA_DE_REFERENCIA };

/** Teto de anexos somando os da lâmina e os do estilo (as do estilo são as primeiras a ficar de fora). */
export const TETO_DE_ANEXOS_COM_ESTILO = 8;

export type EstiloNaGeracao = { guia: GuiaDoEstilo; versao: number; imagens: ImagemEntrada[] };

export async function estiloNaGeracao(
  t: { client_id: string; direcao: unknown },
  deps: {
    db: BancoDoEstilo;
    marca: () => Promise<{ id: string; principal?: boolean } | null>;
    baixar: (bucket: string, caminho: string, nome: string) => Promise<ImagemEntrada>;
    /** Anexos que a lâmina já leva (imagem editada incluída). */
    anexosDaLamina: number;
  },
): Promise<EstiloNaGeracao | null> {
  if (!usarEstiloNoTrabalho(t.direcao)) return null;
  try {
    const marca = await deps.marca();
    const e = await lerEstilo(deps.db, t.client_id, chaveDaMarca(marca));
    const g = guiaAtual(e);
    if (!e.ativo || !g || !guiaTemConteudo(g)) return null;
    const vagas = Math.max(0, Math.min(MAX_REFERENCIAS_NO_GERADOR, TETO_DE_ANEXOS_COM_ESTILO - deps.anexosDaLamina));
    const imagens: ImagemEntrada[] = [];
    for (const r of g.referencias.slice(0, vagas)) {
      try {
        imagens.push(await deps.baixar(r.bucket, r.caminho, `estilo-${r.id.slice(0, 8)}`));
      } catch {
        // Referência do estilo sumida: segue sem ela.
      }
    }
    // Trava da marca (frente T): fonte e hex escritos no estilo saem; a letra e a cor são as do kit.
    return { guia: guiaComMarcaTravada(g), versao: e.versao_atual, imagens };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ trava da marca no estilo (frente T, 26/09)

/**
 * Regra dura do dono: a letra, as cores e o logo são sempre os do cliente. O
 * estilo é do próprio cliente, então só fonte pelo nome e hex saem (viram
 * "fonte do kit" e "cor do kit"); os nomes de cor ficam (são as cores dele,
 * ditas pela função). Guia sem fonte nem hex sai igual.
 */
export function guiaComMarcaTravada(g: GuiaDoEstilo): GuiaDoEstilo {
  const n = (s: string) => neutralizarMarcaDaReferencia(s, null, { nomesDeCor: false });
  const regras = { ...g.regras };
  for (const c of Object.keys(regras) as Array<keyof GuiaDoEstilo["regras"]>) regras[c] = regras[c].map(n);
  return { ...g, resumo: n(g.resumo), regras };
}

// ------------------------------------------------------------------ template de design e referência de carrossel (frente T, 26/09)

/**
 * Template de design ou referência de carrossel na geração (frente T). ADITIVO
 * e opcional: só quando a equipe escolheu um no trabalho
 * (direcao.template_de_design.id). "Nenhum" (o padrão, direção sem o campo):
 * devolve "" SEM ler o banco e sem tocar nas listas de imagens e rótulos; o
 * prompt e as entradas ficam byte a byte os de hoje (teste:
 * src/test/templates-de-design.test.ts).
 *
 * Escolhido, acrescenta às listas da lâmina, DEPOIS das imagens da lâmina e das
 * do estilo, sem passar do limite de imagens do modelo, nesta ordem:
 *   1. referência de carrossel: a lâmina da referência que esta lâmina segue
 *      (mapaDasLaminas: 1 com 1, papel com papel quando o número difere);
 *   2. continuidade que cruza a borda (fora do carrossel contínuo): a faixa da
 *      borda direita da versão atual da lâmina anterior;
 *   3. template: até 2 âncoras (as do papel da lâmina primeiro).
 * Devolve o bloco curto (TEMPLATE ou REFERÊNCIA DE CARROSSEL) com a trava da
 * marca, para entrar depois do bloco do estilo. Qualquer falha devolve "" e as
 * listas como estavam: nunca derruba a geração.
 *
 * Gancho no gerarCard (estudio-arte/index.ts), logo depois de `const blocoDoEstilo = ...`:
 *   const blocoDoTemplate = await templateNaLamina(t, { ordem, total, imagens, rotulos, deslocamento }, { db: servico() as never, baixar: baixarImagem, modelo: modeloImagem, panorama, marca });
 * e `blocoDoTemplate,` logo depois de cada `blocoDoEstilo,` (prompt normal e prompt do replicar).
 */

type ModeloComLimite = { provedor: string; modelo_api: string; capacidades?: unknown };

/** Limite de imagens de entrada: o teto do Estúdio com estilo e o do modelo (o menor). */
export function limiteDeAnexosDoTemplate(modelo: ModeloComLimite | null | undefined): number {
  if (!modelo) return TETO_DE_ANEXOS_COM_ESTILO;
  try {
    const n = Math.floor(Number(capacidadesDoModelo(modelo as never).refs_max));
    return n >= 0 ? Math.min(TETO_DE_ANEXOS_COM_ESTILO, n) : TETO_DE_ANEXOS_COM_ESTILO;
  } catch {
    return TETO_DE_ANEXOS_COM_ESTILO;
  }
}

/** Recorte da faixa (imagem-local, só quando precisa: o vitest injeta o seu). */
async function recortarComImagemLocal(bytes: Uint8Array, faixa: (l: number, a: number) => Retangulo | null): Promise<Uint8Array | null> {
  const { decodificar } = await import("../_shared/imagem-local.ts");
  const img = await decodificar(bytes);
  const r = faixa(img.width, img.height);
  if (!r) return null;
  return await img.crop(r.x, r.y, r.largura, r.altura).encode(1);
}

export async function templateNaLamina(
  t: { client_id: string; direcao: unknown; cards?: Array<{ ordem: number; versao: number; storage_path: string }> | null },
  lamina: { ordem: number; total: number; imagens: ImagemEntrada[]; rotulos: string[]; deslocamento: number },
  deps: {
    db: BancoDoTemplate;
    baixar: (bucket: string, caminho: string, nome: string) => Promise<ImagemEntrada>;
    /** O gerador da lâmina (limite de imagens de entrada). */
    modelo?: ModeloComLimite | null;
    /** A lâmina já é a fatia do carrossel contínuo (o panorama resolve a continuidade). */
    panorama?: boolean;
    /** Kit do cliente (fontes e paleta) para a trava da marca. */
    marca?: KitDaTrava;
    /** Só para teste: recorta a faixa sem imagem-local. */
    recortar?: (bytes: Uint8Array, faixa: (l: number, a: number) => Retangulo | null) => Promise<Uint8Array | null>;
  },
): Promise<string> {
  const escolhido = templateEscolhidoNoTrabalho(t.direcao);
  if (!escolhido) return "";
  const { ordem, total, imagens, rotulos, deslocamento } = lamina;
  const antes = { imagens: imagens.length, rotulos: rotulos.length };
  try {
    const tpl = await lerTemplate(deps.db, t.client_id, escolhido.id);
    const corpo = tpl && tpl.status === "ativo" ? corpoAtual(tpl) : null;
    if (!tpl || !corpo || !corpoTemConteudo(corpo)) return "";
    const kit = deps.marca || null;
    let vagas = Math.max(0, limiteDeAnexosDoTemplate(deps.modelo) - (imagens.length + deslocamento));
    const anexar = (img: ImagemEntrada, rotulo: string) => {
      imagens.push(img);
      rotulos.push(rotulo);
      vagas--;
      return imagens.length + deslocamento;
    };
    // 1) Referência de carrossel: a lâmina que esta segue.
    const ehReferencia = tpl.tipo === "referencia_carrossel" && corpo.laminas_referencia.length > 0;
    let indiceDaReferencia: number | null = null;
    if (ehReferencia && vagas > 0) {
      const k = mapaDasLaminas(corpo.laminas_referencia.length, total)[ordem - 1];
      const ref = k ? corpo.laminas_referencia[k - 1] : null;
      if (ref) {
        try {
          indiceDaReferencia = anexar(await deps.baixar(ref.bucket, ref.caminho, `referencia-${k}`), ROTULO_DA_LAMINA_DE_REFERENCIA);
        } catch {
          // Lâmina da referência sumida: segue só com o texto das partes.
        }
      }
    }
    // 2) Continuidade: a faixa da borda direita da versão atual da lâmina anterior.
    const estrategia = estrategiaDaContinuidade(corpo.continuidade, { ordem, total, panoramaLigado: !!deps.panorama });
    let indiceDaFaixa: number | null = null;
    if (estrategia === "faixa_da_borda" && vagas > 0) {
      const anteriores = (t.cards || []).filter((c) => c.ordem === ordem - 1 && !!c.storage_path);
      const anterior = anteriores.length ? anteriores.reduce((a, b) => (b.versao > a.versao ? b : a)) : null;
      if (anterior) {
        try {
          const img = await deps.baixar("mesa", anterior.storage_path, `borda-${ordem - 1}`);
          const bytes = await (deps.recortar || recortarComImagemLocal)(img.bytes, (l, a) => faixaDaBorda(l, a));
          if (bytes) indiceDaFaixa = anexar({ bytes, mime: "image/png", nome: `borda-${ordem - 1}.png` }, ROTULO_DA_FAIXA_DA_BORDA);
        } catch {
          // Sem a lâmina anterior (ainda não gerada ou sumida): segue sem a faixa.
        }
      }
    }
    const continuidade = linhasDaContinuidade(corpo.continuidade, { ordem, total, estrategia, indiceDaFaixa });
    if (ehReferencia) {
      const escolha = (t.direcao as { template_de_design?: { fidelidade?: unknown } }).template_de_design;
      const fidelidade = fidelidadeDaReferenciaDeCarrossel(escolha ? escolha.fidelidade : null, t.direcao);
      return blocoDaReferenciaDeCarrossel(tpl.nome, corpo.laminas_referencia, { ordem, total, fidelidade, indice: indiceDaReferencia, kit, continuidade });
    }
    // 3) Âncoras do template (as do papel da lâmina primeiro).
    const indices: number[] = [];
    for (const a of ancorasParaALamina(corpo, ordem, total)) {
      if (indices.length >= MAX_ANCORAS_NO_GERADOR || vagas <= 0) break;
      try {
        indices.push(anexar(await deps.baixar(a.bucket, a.caminho, `template-${a.id.slice(0, 8)}`), ROTULO_DA_ANCORA_DO_TEMPLATE));
      } catch {
        // Âncora sumida: segue sem ela.
      }
    }
    return blocoDoTemplateParaOGerador(tpl.nome, corpo, { ordem, total, indicesDasAncoras: indices, continuidade, kit });
  } catch {
    // Falhou no meio: devolve as listas como estavam.
    imagens.length = antes.imagens;
    rotulos.length = antes.rotulos;
    return "";
  }
}
