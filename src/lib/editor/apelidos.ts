import { duracaoDoClipe, ROTULO_DA_TRILHA, type ClipeDoProjeto, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, fimDoClipe, type Operacao } from "./operacoes";
import { tempoFino } from "./tempo";
import { rotuloDoAjuste } from "./efeitos";

/**
 * Apelidos para o agente (frente V-B; padrão agêntico: nunca id cru). Os
 * clipes viram c1, c2, c3... na ordem das trilhas e, dentro da trilha, do
 * tempo. O agente fala "dividir c3 em 0:04" e o código troca o apelido pelo
 * id antes de aplicar; apelido que não existe é recusado com a lista certa.
 */

export interface ClipeApelidado {
  apelido: string;
  id: string;
  trilha: string;
  tipo: string;
  rotulo: string;
  inicio_s: number;
  fim_s: number;
}

export interface Apelidos {
  lista: ClipeApelidado[];
  porApelido: Record<string, string>;
  porId: Record<string, string>;
  /** Apelidos que saíram do projeto durante o pedido (só nos apelidos estáveis). */
  saidos?: string[];
}

export function rotuloDoClipe(p: ProjetoDeEdicao, c: ClipeDoProjeto): string {
  const f = c.fonte ? p.fontes[c.fonte] : null;
  if (f) return f.nome;
  if (c.texto) return c.texto.length > 40 ? `${c.texto.slice(0, 39)}…` : c.texto;
  const ajuste = rotuloDoAjuste(c);
  if (ajuste) return ajuste;
  const peca = c.estilo && typeof (c.estilo as Record<string, unknown>).peca === "string" ? String((c.estilo as Record<string, unknown>).peca) : null;
  if (peca) return `Animação: ${peca.replace("_", " ")}`;
  return "Clipe";
}

export function apelidosDoProjeto(p: ProjetoDeEdicao): Apelidos {
  const lista: ClipeApelidado[] = [];
  const porApelido: Record<string, string> = {};
  const porId: Record<string, string> = {};
  p.trilhas.forEach((t) =>
    emOrdem(t).forEach((c) => {
      const apelido = `c${lista.length + 1}`;
      lista.push({ apelido, id: c.id, trilha: t.id, tipo: t.tipo, rotulo: rotuloDoClipe(p, c), inicio_s: c.inicio_s, fim_s: fimDoClipe(c) });
      porApelido[apelido] = c.id;
      porId[c.id] = apelido;
    }),
  );
  return { lista, porApelido, porId };
}

/**
 * Apelidos ESTÁVEIS durante um pedido ao agente (02/10, dono: "pedi para tirar
 * os takes duplicados e ele não mexeu em nada"). Antes, cada ferramenta
 * renumerava c1, c2... depois de mudar o projeto: "remover c3" e "remover c5"
 * no mesmo passo tirava o c3 e depois o clipe que ERA o c6 (ou falhava com
 * "Não existe c5"), e a falha mandava tudo para o Confirmar. Agora quem já tinha
 * apelido fica com ele até o fim do pedido; clipe novo (divisão, inserção)
 * ganha o próximo número livre; o que saiu do projeto some da lista.
 */
export function apelidosEstaveis(p: ProjetoDeEdicao, anterior: Apelidos | null | undefined): Apelidos {
  if (!anterior) return apelidosDoProjeto(p);
  let maior = 0;
  anterior.lista.forEach((x) => {
    const n = Number(x.apelido.slice(1));
    if (isFinite(n) && n > maior) maior = n;
  });
  Object.keys(anterior.porApelido).forEach((ap) => {
    const n = Number(ap.slice(1));
    if (isFinite(n) && n > maior) maior = n;
  });
  const lista: ClipeApelidado[] = [];
  const porApelido: Record<string, string> = {};
  const porId: Record<string, string> = {};
  p.trilhas.forEach((t) =>
    emOrdem(t).forEach((c) => {
      const apelido = anterior.porId[c.id] || `c${++maior}`;
      lista.push({ apelido, id: c.id, trilha: t.id, tipo: t.tipo, rotulo: rotuloDoClipe(p, c), inicio_s: c.inicio_s, fim_s: fimDoClipe(c) });
      porApelido[apelido] = c.id;
      porId[c.id] = apelido;
    }),
  );
  const saidos = (anterior.saidos || []).concat(anterior.lista.filter((x) => !porId[x.id]).map((x) => x.apelido));
  return { lista, porApelido, porId, saidos };
}

/** O que o agente lê do projeto: uma linha por clipe, com apelido e tempos exatos. */
export function resumoParaOAgente(p: ProjetoDeEdicao, apelidos?: Apelidos | null): string {
  const a = apelidos || apelidosDoProjeto(p);
  const linhas = [`Projeto "${p.titulo}", ${p.formato}, ${p.fps} fps, ${tempoFino(p.duracao_s)} no total.`];
  p.trilhas.forEach((t) => {
    linhas.push(`Trilha ${t.id} (${ROTULO_DA_TRILHA[t.tipo]}${t.muda ? ", muda" : ""}${t.oculta ? ", oculta" : ""}):`);
    emOrdem(t).forEach((c) => {
      const f = c.fonte ? p.fontes[c.fonte] : null;
      linhas.push(
        `- ${a.porId[c.id]}: ${rotuloDoClipe(p, c)}, ${tempoFino(c.inicio_s)} a ${tempoFino(c.inicio_s + duracaoDoClipe(c))}` +
          (f ? ` (fonte ${tempoFino(c.entrada_s)} a ${tempoFino(c.saida_s)})` : "") +
          (c.velocidade !== 1 ? `, ${c.velocidade}x` : "") +
          (c.zoom ? `, zoom ${c.zoom.de} a ${c.zoom.para}` : ""),
      );
    });
  });
  return linhas.join("\n");
}

export class ErroDeApelido extends Error {}

const CAMPOS_DE_CLIPE = ["clipe"] as const;

/**
 * Operações do agente (com apelidos) viram operações do código (com ids).
 * Recusa id cru e apelido desconhecido: o agente só mexe no que viu.
 */
export function resolverApelidos(p: ProjetoDeEdicao, ops: Operacao[], apelidos?: Apelidos | null): Operacao[] {
  const a = apelidos || apelidosDoProjeto(p);
  return ops.map((o) => {
    const copia = { ...(o as Record<string, unknown>) };
    CAMPOS_DE_CLIPE.forEach((k) => {
      if (copia[k] === undefined) return;
      const v = String(copia[k]);
      if (!/^c\d+$/.test(v)) throw new ErroDeApelido(`Use o apelido do clipe (c1, c2...), não "${v}".`);
      const id = a.porApelido[v];
      if (!id && a.saidos && a.saidos.indexOf(v) >= 0) throw new ErroDeApelido(`O ${v} já saiu do projeto neste pedido.`);
      if (!id) throw new ErroDeApelido(`Não existe ${v}. Clipes: ${a.lista.map((x) => x.apelido).join(", ") || "nenhum"}.`);
      copia[k] = id;
    });
    if (copia.op === "reordenar" && Array.isArray(copia.ordem)) {
      copia.ordem = (copia.ordem as unknown[]).map((v) => {
        const id = a.porApelido[String(v)];
        if (!id) throw new ErroDeApelido(`Não existe ${String(v)}. Clipes: ${a.lista.map((x) => x.apelido).join(", ") || "nenhum"}.`);
        return id;
      });
    }
    return copia as unknown as Operacao;
  });
}

const ROTULO_DA_OPERACAO: Record<Operacao["op"], string> = {
  dividir: "Dividir",
  aparar: "Aparar",
  mover: "Mover",
  remover: "Tirar",
  recortar: "Cortar trecho de",
  inserir: "Inserir",
  propriedades: "Ajustar",
  ondular: "Fechar buracos na",
  reordenar: "Reordenar",
  limpar_trilha: "Esvaziar",
  trilha_nova: "Nova trilha de",
  trilha: "Ajustar trilha",
  fonte: "Adicionar mídia",
  transcricao: "Guardar fala de",
  visao: "Guardar o que viu em",
  referencias: "Referências",
  continuidade: "Continuidade",
  marcador: "Marcador",
  onda: "Guardar a onda de",
  mixagem: "Ajustar a mixagem",
  registrar_skill: "Registrar",
  marcadores: "Marcar",
  remover_marcador: "Tirar marcador",
  formato: "Trocar o formato para",
  cor: "Ajustar a cor",
  rosto: "Guardar o rosto de",
  enquadramento: "Ajustar o enquadramento",
  identidade: "Guardar a identidade da marca",
};

/** Texto de uma operação para a prévia ("Dividir c3 em 0:04,20"). */
export function rotuloDaOperacao(o: Operacao, p: ProjetoDeEdicao, a: Apelidos = apelidosDoProjeto(p)): string {
  const nome = (id: string) => a.porId[id] || "clipe novo";
  const trilha = (id: string) => {
    const t = p.trilhas.find((x) => x.id === id);
    return t ? t.nome.toLowerCase() : id;
  };
  switch (o.op) {
    case "dividir":
      return `Dividir ${nome(o.clipe)} em ${tempoFino(o.em_s)}`;
    case "aparar":
      return `Aparar ${o.lado === "inicio" ? "o início" : "o fim"} de ${nome(o.clipe)} para ${tempoFino(o.tempo_s)}`;
    case "mover":
      return `Mover ${nome(o.clipe)} para ${tempoFino(o.inicio_s)}`;
    case "remover":
      return `Tirar ${nome(o.clipe)}${o.ondular ? " e puxar o resto" : ""}`;
    case "recortar":
      return `Cortar ${tempoFino(o.de_s)} a ${tempoFino(o.ate_s)} da fonte de ${nome(o.clipe)}`;
    case "marcadores":
      return `Marcar ${o.lista.length} ${o.tipo === "capitulo" ? (o.lista.length === 1 ? "capítulo" : "capítulos") : o.tipo === "viral" ? (o.lista.length === 1 ? "momento viral" : "momentos virais") : "marcadores"}`;
    case "formato":
      return `Trocar o formato para ${o.formato}`;
    case "cor":
      return `Ajustar a cor${o.campos.look ? `: look ${o.campos.look}` : ""}${o.campos.lut ? `, LUT ${o.campos.lut.nome}` : ""}`;
    case "inserir":
      if (o.clipe.estilo && (o.clipe.estilo as Record<string, unknown>).efeito) return `Inserir ${rotuloDoAjuste(o.clipe as ClipeDoProjeto) || "efeito"} em ${tempoFino(o.clipe.inicio_s)} (${trilha(o.trilha)})`;
      return `Inserir ${o.clipe.texto ? `"${String(o.clipe.texto).slice(0, 30)}"` : o.clipe.fonte ? p.fontes[o.clipe.fonte]?.nome || "mídia" : "clipe"} em ${tempoFino(o.clipe.inicio_s)} (${trilha(o.trilha)})`;
    case "propriedades": {
      const k = Object.keys(o.campos || {});
      const partes = k.map((x) =>
        x === "zoom" && o.campos.zoom ? `zoom ${o.campos.zoom.de} a ${o.campos.zoom.para}` : x === "comparar" && o.campos.comparar ? "antes e depois" : x.replace("_", " "),
      );
      return `Ajustar ${nome(o.clipe)}: ${partes.join(", ")}`;
    }
    case "ondular":
      return `Fechar buracos na ${trilha(o.trilha)}`;
    case "reordenar":
      return `Reordenar ${trilha(o.trilha)}: ${o.ordem.map(nome).join(", ")}`;
    case "limpar_trilha":
      return `Esvaziar ${trilha(o.trilha)}`;
    default:
      return ROTULO_DA_OPERACAO[o.op] || o.op;
  }
}
