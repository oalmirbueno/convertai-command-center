/**
 * Partir de um site pronto (frente MCC, 25/10/2026): o motor põe a cópia
 * fixada do modelo (workers/motor-codigo/modelos-prontos/<id>: HTML, SCSS do
 * tema, JS e a LICENSE, sem as fotos de demonstração) em
 * referencias/modelo-pronto/ do projeto (só leitura para o agente; fora do
 * git do site) e anota a atribuição no ATRIBUICOES.md do site (a LICENSE MIT
 * pede o aviso em cópias de partes substanciais).
 *
 * O catálogo é o da tela: supabase/functions/mesa-site/modulos/modelos-prontos.ts.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { modeloPronto, type ModeloPronto } from "../../../supabase/functions/mesa-site/modulos/modelos-prontos.ts";
import { PASTA_DO_WORKER } from "./config-opencode.ts";

export const PASTA_DOS_MODELOS_PRONTOS = resolve(PASTA_DO_WORKER, "modelos-prontos");
export const DESTINO_DO_MODELO_PRONTO = join("referencias", "modelo-pronto");

/** A linha do ATRIBUICOES.md do site para o modelo. */
export const linhaDeAtribuicao = (m: ModeloPronto) => `- Estrutura e estilo partindo do modelo "${m.nome}" (${m.repositorio}, commit ${m.commit.slice(0, 7)}), licença ${m.licenca}, Copyright (c) 2013-2023 ${m.autor}.`;

/**
 * Prepara o modelo no projeto. Recusa id fora do catálogo ou sem a cópia no
 * worker. Troca de modelo apaga a cópia anterior (a pasta é do motor).
 */
export function prepararModeloPronto(pasta: string, id: string | undefined, base: string = PASTA_DOS_MODELOS_PRONTOS): { modelo: ModeloPronto; copiado: boolean; atribuicao: boolean } {
  const m = modeloPronto(id);
  if (!m) throw new Error(`o site pronto "${String(id || "")}" não está na coleção`);
  const origem = join(base, m.id);
  if (!existsSync(join(origem, "LICENSE")) || !existsSync(join(origem, "index.html"))) throw new Error(`a cópia do site pronto ${m.id} não está no worker (workers/motor-codigo/modelos-prontos/${m.id})`);
  const destino = join(pasta, DESTINO_DO_MODELO_PRONTO);
  const marca = join(destino, ".modelo");
  let copiado = false;
  const atual = existsSync(marca) ? readFileSync(marca, "utf8").trim() : "";
  if (atual !== `${m.id}@${m.commit}`) {
    rmSync(destino, { recursive: true, force: true });
    mkdirSync(destino, { recursive: true });
    cpSync(origem, destino, { recursive: true });
    writeFileSync(marca, `${m.id}@${m.commit}\n`);
    copiado = true;
  }
  // A atribuição no site (o ATRIBUICOES.md não é casca: fica no git e no zip do cliente).
  const atr = join(pasta, "ATRIBUICOES.md");
  let atribuicao = false;
  if (existsSync(atr)) {
    const texto = readFileSync(atr, "utf8");
    const linha = linhaDeAtribuicao(m);
    if (texto.indexOf(m.repositorio) < 0) {
      writeFileSync(atr, `${texto.replace(/\s*$/, "")}\n${linha}\n`);
      atribuicao = true;
    }
  }
  return { modelo: m, copiado, atribuicao };
}
