/**
 * O Salvar do editor de código (Gravyx, 19/10/2026) no worker: trabalho
 * "textos" com `pacote.edicao_de_codigo`. Confere tudo ANTES do rascunho
 * abrir (as regras da tela e da função de novo, agora com a casca da casa de
 * verdade) e a trava de concorrência: o sha256 de cada arquivo no disco tem
 * de ser o de quando a pessoa abriu. Um arquivo que não bate recusa o Salvar
 * inteiro e nada é escrito (nem rascunho vazio fica aberto). Depois, já no
 * rascunho, escreve.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { conflitoDoArquivo, type EdicaoDeCodigo, validarEdicaoDeCodigo } from "../../../supabase/functions/mesa-site/modulos/editor-de-codigo.ts";

export const sha256 = (bytes: Uint8Array | Buffer) => createHash("sha256").update(bytes).digest("hex");

export type ConferenciaDaEdicao = { ok: true; edicao: EdicaoDeCodigo; codigo?: undefined; motivo?: undefined } | { ok: false; codigo: string; motivo: string; edicao?: undefined };

/** As regras e a trava de concorrência contra o disco, sem escrever nada. */
export function conferirEdicaoNoProjeto(pasta: string, bruto: unknown, casca: string[]): ConferenciaDaEdicao {
  const v = validarEdicaoDeCodigo(bruto, casca);
  if (!v.ok) return { ok: false, codigo: String(v.codigo), motivo: String(v.motivo) };
  const raiz = resolve(pasta);
  for (const a of v.edicao.arquivos) {
    const alvo = resolve(join(pasta, a.caminho));
    if (alvo.indexOf(raiz) !== 0) return { ok: false, codigo: "caminho_invalido", motivo: `${a.caminho}: fora do projeto.` };
    const agora = existsSync(alvo) ? sha256(readFileSync(alvo)) : null;
    const conflito = conflitoDoArquivo(a, agora);
    if (conflito) return { ok: false, codigo: "conflito", motivo: conflito };
  }
  return { ok: true, edicao: v.edicao };
}

/** Escreve a edição já conferida. Devolve os arquivos que mudaram de verdade. */
export function escreverEdicaoNoProjeto(pasta: string, edicao: EdicaoDeCodigo): string[] {
  const feitas: string[] = [];
  for (const a of edicao.arquivos) {
    const alvo = join(pasta, a.caminho);
    const novo = Buffer.from(a.conteudo, "utf8");
    if (existsSync(alvo) && readFileSync(alvo).equals(novo)) continue;
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, novo);
    feitas.push(a.caminho);
  }
  return feitas;
}
