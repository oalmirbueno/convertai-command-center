/**
 * Organizador de takes da Mesa Vídeos (aba Edição; Frente V2, 25/09/2026).
 *
 * Inspirado no Project Sorter (Higgsfield) citado no kit audiovisual: pastas
 * por roteiro e cena, nomes previsíveis e nada apagado. Aqui é regra fixa, sem
 * IA: lê cena e take do nome do arquivo quando o nome traz ("cena 2 take 3",
 * "c02_t03", "sc2 tk1"), agrupa por roteiro e cena e propõe nomes no padrão
 * <roteiro>_c02_t03.mp4. A proposta passa pelo contrato comum das ações
 * (acoes-do-agente.ts): apelido t1, t2..., cartão Confirmar/Cancelar, item a
 * item e Desfazer. O arquivo original nunca muda: renomear muda só o nome de
 * exibição (o caminho no Storage fica igual) e apagar é sempre arquivar.
 *
 * Puro: sem Deno, sem banco. A tela e os testes leem o mesmo arquivo.
 */

import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  comApelido,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  type ValorPara,
} from "./acoes-do-agente.ts";

export const TIPOS_DE_ARQUIVO = ["bruto", "take", "gerado", "audio", "entrega"] as const;
export type TipoDeArquivo = (typeof TIPOS_DE_ARQUIVO)[number];

export interface TakeParaOrganizar {
  id: string;
  nome: string;
  nome_original: string;
  tipo: TipoDeArquivo | string;
  grupo: string | null;
  roteiro_id: string | null;
  cena_ref: string | null;
  melhor: boolean;
  estado: string;
  gravado_em: string | null;
  criado_em: string;
  /** Em versão aprovada: não sai do acervo. */
  em_versao_aprovada?: boolean;
}

export interface CenaDoRoteiro {
  ref: string;
  ordem: number;
  titulo: string;
}

export interface RoteiroParaOrganizar {
  id: string;
  titulo: string;
  cenas: CenaDoRoteiro[];
}

export const MAX_NOME = 120;
export const MAX_GRUPO = 80;
export const MAX_CENA_REF = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------ nomes

export const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** "Café da Manhã!" -> "cafe-da-manha" (no máximo `max` letras, sem hífen sobrando). */
export function slugDoNome(t: string, max = 24): string {
  const s = semAcento(t)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, max).replace(/-+$/g, "");
}

/** Extensão em minúsculas, sem ponto ("MOV" de "IMG_1.MOV" vira "mov"); vazio quando não há. */
export function extensaoDoNome(nome: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(nome || "").trim());
  return m ? m[1].toLowerCase() : "";
}

const numero = (v: string | undefined) => {
  const n = Number(v);
  return isFinite(n) && n > 0 && n < 1000 ? Math.floor(n) : null;
};

/**
 * Cena e take que o nome do arquivo já traz. Aceita "cena 2 take 3",
 * "Cena02_Take03", "c2t3", "s02_t03", "sc2-tk1", "take 4" e "tk04". Nome de
 * câmera (C0012.MP4, IMG_1234.MOV, DJI_0001) não vira cena: a letra sozinha só
 * conta quando vem colada a um take.
 */
export function lerNomeDoTake(nome: string): { cena: number | null; take: number | null } {
  const n = semAcento(String(nome || "")).toLowerCase();
  const junto = /(?:^|[^a-z0-9])(?:cena|scene|sc|c|s)[\s._-]*0*(\d{1,3})[\s._-]*(?:take|tk|t)[\s._-]*0*(\d{1,3})(?![0-9])/.exec(n);
  if (junto) return { cena: numero(junto[1]), take: numero(junto[2]) };
  const cena = /(?:^|[^a-z])(?:cena|scene)[\s._-]*0*(\d{1,3})(?![0-9])/.exec(n);
  const take = /(?:^|[^a-z])(?:take|tk)[\s._-]*0*(\d{1,3})(?![0-9])/.exec(n);
  return { cena: cena ? numero(cena[1]) : null, take: take ? numero(take[1]) : null };
}

const doisDigitos = (n: number) => (n < 10 ? `0${n}` : String(n));

/** roteiro_c02_t03.mp4 (sem cena: roteiro_t03.mp4). */
export function nomeNormalizado(p: { base: string; cena: number | null; take: number; ext?: string }): string {
  const base = slugDoNome(p.base, 32) || "take";
  const cena = p.cena ? `_c${doisDigitos(p.cena)}` : "";
  const ext = p.ext ? `.${p.ext}` : "";
  return `${base}${cena}_t${doisDigitos(p.take)}${ext}`.slice(0, MAX_NOME);
}

/** Nome digitado pela equipe ou pedido pelo agente: uma linha, sem barra, até 120 letras. */
export function limparNome(v: unknown): string {
  return String(v ?? "")
    .replace(/[\\/\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NOME);
}

/** Grupo aceita a barra ("Roteiro / Cena 2"); fora isso, a mesma limpeza do nome. */
export function limparGrupo(v: unknown): string {
  return String(v ?? "")
    .replace(/[\\\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_GRUPO);
}

// ------------------------------------------------------------------ proposta

export type OperacaoDoOrganizador = "renomear" | "agrupar" | "ligar_roteiro" | "ligar_cena" | "arquivar";

export interface ItemProposto {
  arquivo_id: string;
  operacao: OperacaoDoOrganizador;
  para: string;
}

const organizaveis = (t: TakeParaOrganizar) => t.estado !== "arquivado" && t.tipo !== "entrega";

function numeroDaCena(t: TakeParaOrganizar, roteiro: RoteiroParaOrganizar | null): number | null {
  if (t.cena_ref && roteiro) {
    const c = roteiro.cenas.find((x) => x.ref === t.cena_ref);
    if (c) return c.ordem;
  }
  if (t.cena_ref) {
    const n = /(\d{1,3})$/.exec(t.cena_ref);
    if (n) return numero(n[1]);
  }
  return lerNomeDoTake(t.nome_original || t.nome).cena;
}

export function rotuloDoGrupo(roteiro: RoteiroParaOrganizar | null, cena: number | null, grupoAtual: string | null): string {
  const cabeca = roteiro ? roteiro.titulo.trim() || "Roteiro" : grupoAtual && grupoAtual.split(" / ")[0].trim() ? grupoAtual.split(" / ")[0].trim() : "Sem roteiro";
  return limparGrupo(cena ? `${cabeca} / Cena ${cena}` : cabeca);
}

const comparar = (a: string | null | undefined, b: string | null | undefined) => {
  const x = a || "";
  const y = b || "";
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Proposta de organização: agrupa por roteiro e cena e numera os takes de
 * cada grupo. O número que o nome já traz fica quando não se repete no grupo;
 * os demais recebem o próximo livre, na ordem de gravação (depois de envio e
 * nome original). Só entra o que muda. Nada é arquivado aqui.
 */
export function proporOrganizacao(takes: TakeParaOrganizar[], roteiros: RoteiroParaOrganizar[] = []): ItemProposto[] {
  const porRoteiro: Record<string, RoteiroParaOrganizar> = {};
  roteiros.forEach((r) => {
    porRoteiro[r.id] = r;
  });
  const grupos: Record<string, { roteiro: RoteiroParaOrganizar | null; cena: number | null; takes: TakeParaOrganizar[] }> = {};
  const ordem: string[] = [];
  takes.filter(organizaveis).forEach((t) => {
    const roteiro = t.roteiro_id && porRoteiro[t.roteiro_id] ? porRoteiro[t.roteiro_id] : null;
    const cena = numeroDaCena(t, roteiro);
    const rotulo = rotuloDoGrupo(roteiro, cena, t.grupo);
    const chave = `${roteiro ? roteiro.id : rotulo.split(" / ")[0]}|${cena || 0}`;
    if (!grupos[chave]) {
      grupos[chave] = { roteiro, cena, takes: [] };
      ordem.push(chave);
    }
    grupos[chave].takes.push(t);
  });

  const saida: ItemProposto[] = [];
  ordem.forEach((chave) => {
    const g = grupos[chave];
    const lista = g.takes.slice().sort(
      (a, b) =>
        (lerNomeDoTake(a.nome_original || a.nome).take || 999) - (lerNomeDoTake(b.nome_original || b.nome).take || 999) ||
        comparar(a.gravado_em, b.gravado_em) ||
        comparar(a.criado_em, b.criado_em) ||
        comparar(a.nome_original, b.nome_original) ||
        comparar(a.id, b.id),
    );
    const usados: number[] = [];
    const numeroDe: Record<string, number> = {};
    lista.forEach((t) => {
      const n = lerNomeDoTake(t.nome_original || t.nome).take;
      if (n && usados.indexOf(n) < 0) {
        usados.push(n);
        numeroDe[t.id] = n;
      }
    });
    let proximo = 1;
    lista.forEach((t) => {
      if (numeroDe[t.id]) return;
      while (usados.indexOf(proximo) >= 0) proximo++;
      usados.push(proximo);
      numeroDe[t.id] = proximo;
    });
    const primeiro = lista[0];
    const base = g.roteiro ? g.roteiro.titulo : rotuloDoGrupo(null, null, primeiro ? primeiro.grupo : null);
    lista.forEach((t) => {
      const rotulo = rotuloDoGrupo(g.roteiro, g.cena, t.grupo);
      if ((t.grupo || "") !== rotulo) saida.push({ arquivo_id: t.id, operacao: "agrupar", para: rotulo });
      const nome = nomeNormalizado({ base: base === "Sem roteiro" ? "take" : base, cena: g.cena, take: numeroDe[t.id], ext: extensaoDoNome(t.nome_original || t.nome) });
      if (t.nome !== nome) saida.push({ arquivo_id: t.id, operacao: "renomear", para: nome });
    });
  });
  return saida;
}

// ------------------------------------------------------------------ contrato comum

export const ROTULOS_DO_ORGANIZADOR: Record<OperacaoDoOrganizador, string> = {
  renomear: "Renomear",
  agrupar: "Agrupar",
  ligar_roteiro: "Ligar ao roteiro",
  ligar_cena: "Ligar à cena",
  arquivar: "Arquivar",
};

export type AlvoDoTake = Alvo & { dados: { take: TakeParaOrganizar } };

export function alvosDosTakes(takes: TakeParaOrganizar[]): Array<AlvoComApelido<AlvoDoTake>> {
  return comApelido(
    takes.map((t): AlvoDoTake => ({ id: t.id, titulo: t.nome || t.nome_original || "take", detalhe: t.grupo || null, dados: { take: t } })),
    "t",
  );
}

export function regrasDoOrganizador(roteiros: RoteiroParaOrganizar[] = []): Record<OperacaoDoOrganizador, RegraDaOperacao<AlvoDoTake>> {
  const ids = roteiros.map((r) => r.id);
  return {
    renomear: { rotulo: ROTULOS_DO_ORGANIZADOR.renomear, combina: true, para: (v) => limparNome(v) || null },
    agrupar: { rotulo: ROTULOS_DO_ORGANIZADOR.agrupar, combina: true, para: (v) => limparGrupo(v) || null },
    ligar_roteiro: {
      rotulo: ROTULOS_DO_ORGANIZADOR.ligar_roteiro,
      combina: true,
      para: (v) => {
        const s = String(v ?? "").trim();
        return UUID.test(s) && ids.indexOf(s) >= 0 ? s : null;
      },
    },
    ligar_cena: { rotulo: ROTULOS_DO_ORGANIZADOR.ligar_cena, combina: true, para: (v) => String(v ?? "").trim().slice(0, MAX_CENA_REF) || null },
    arquivar: {
      rotulo: ROTULOS_DO_ORGANIZADOR.arquivar,
      trava: (alvo) =>
        alvo.dados.take.em_versao_aprovada
          ? "Está numa versão aprovada: fica no acervo."
          : alvo.dados.take.melhor
            ? "Marcado como melhor take: desmarque antes de arquivar."
            : alvo.dados.take.estado === "arquivado"
              ? "Já está arquivado."
              : null,
    },
  };
}

/**
 * Transforma a proposta em ação do contrato comum (apelidos, validação e
 * travas passam por normalizarAcaoDoAgente). Null quando não há o que mudar.
 */
export function acaoDaOrganizacao(
  takes: TakeParaOrganizar[],
  itens: ItemProposto[],
  roteiros: RoteiroParaOrganizar[] = [],
  opcoes: { id?: string; resumo?: string } = {},
): AcaoDoAgente | null {
  const alvos = alvosDosTakes(takes);
  const refDe: Record<string, string> = {};
  alvos.forEach((a) => {
    refDe[a.id] = a.ref;
  });
  const titulos: Record<string, string> = {};
  roteiros.forEach((r) => {
    titulos[r.id] = r.titulo;
  });
  const bruto = {
    resumo: opcoes.resumo || "",
    itens: itens.filter((i) => refDe[i.arquivo_id]).map((i) => ({ operacao: i.operacao, ref: refDe[i.arquivo_id], para: i.para })),
  };
  return normalizarAcaoDoAgente(bruto, alvos, regrasDoOrganizador(roteiros), {
    agente: "organizador_de_takes",
    id: opcoes.id,
    rotuloDoPara: (operacao, para) => (operacao === "ligar_roteiro" && para ? titulos[String(para)] || null : null),
  });
}

// ------------------------------------------------------------------ executar e desfazer

export type CamposDoTake = Partial<Pick<TakeParaOrganizar, "nome" | "grupo" | "roteiro_id" | "cena_ref" | "estado" | "melhor">>;

/** O que a operação grava na linha do take. */
export function camposDaOperacao(operacao: string, para: ValorPara): CamposDoTake {
  switch (operacao) {
    case "renomear":
      return { nome: limparNome(para) };
    case "agrupar":
      return { grupo: limparGrupo(para) || null };
    case "ligar_roteiro":
      return { roteiro_id: para ? String(para) : null };
    case "ligar_cena":
      return { cena_ref: para ? String(para).slice(0, MAX_CENA_REF) : null };
    case "arquivar":
      return { estado: "arquivado" };
    case "marcar_melhor":
      return { melhor: true };
    case "desmarcar_melhor":
      return { melhor: false };
    default:
      throw new Error("Operação desconhecida.");
  }
}

/** O valor de antes dos mesmos campos (vai em desfazer). */
const CAMPOS_DA_OPERACAO: Record<string, Array<keyof CamposDoTake>> = {
  renomear: ["nome"],
  agrupar: ["grupo"],
  ligar_roteiro: ["roteiro_id"],
  ligar_cena: ["cena_ref"],
  arquivar: ["estado"],
  marcar_melhor: ["melhor"],
  desmarcar_melhor: ["melhor"],
};

export function desfazerDaOperacao(take: TakeParaOrganizar, operacao: string): { campos: CamposDoTake } {
  const campos = CAMPOS_DA_OPERACAO[operacao];
  if (!campos) throw new Error("Operação desconhecida.");
  const antes: Record<string, unknown> = {};
  campos.forEach((k) => {
    const v = (take as unknown as Record<string, unknown>)[k];
    antes[k] = v === undefined ? null : v;
  });
  return { campos: antes as CamposDoTake };
}

/** Campos a gravar para voltar como estava (lê o `desfazer` guardado). */
export function camposDoDesfazer(desfazer: Record<string, unknown> | null | undefined): CamposDoTake {
  const c = desfazer && typeof desfazer === "object" ? (desfazer as { campos?: unknown }).campos : null;
  if (!c || typeof c !== "object") return {};
  const saida: CamposDoTake = {};
  const o = c as Record<string, unknown>;
  if ("nome" in o) saida.nome = limparNome(o.nome);
  if ("grupo" in o) saida.grupo = o.grupo === null ? null : limparGrupo(o.grupo);
  if ("roteiro_id" in o) saida.roteiro_id = o.roteiro_id && UUID.test(String(o.roteiro_id)) ? String(o.roteiro_id) : null;
  if ("cena_ref" in o) saida.cena_ref = o.cena_ref ? String(o.cena_ref).slice(0, MAX_CENA_REF) : null;
  if ("estado" in o) saida.estado = o.estado === "arquivado" ? "arquivado" : "ativo";
  if ("melhor" in o) saida.melhor = o.melhor === true;
  return saida;
}

/** Aplica os campos num take (para a tela e os testes). */
export function aplicarCampos<T extends TakeParaOrganizar>(t: T, campos: CamposDoTake): T {
  return { ...t, ...campos };
}
