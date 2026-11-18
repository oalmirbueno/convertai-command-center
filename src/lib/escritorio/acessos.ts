import type { Bloqueio, ChaveMcp, VinculoDeCredencial } from "./tipos";

/** Uma credencial ligada a um agente, do jeito que a tela mostra (nunca o segredo). */
export interface CredencialDoAgente {
  principal: string;
  /** "chave" = credencial criada no painel; "conector" = login de um aplicativo (OAuth). */
  tipo: "chave" | "conector";
  /** Nome da chave, quando a tela consegue ler; senão o rótulo do vínculo ou o começo do identificador. */
  nome: string;
  /** O começo da chave (key_preview). */
  previa: string | null;
  padrao: boolean;
  /** A chave existe e foi desligada. */
  desligada: boolean;
}

/** As credenciais de cada agente: o vínculo juntado à chave (nome e prévia) quando o principal é "key:<uuid>". */
export function credenciaisPorAgente(vinculos: readonly VinculoDeCredencial[], chaves: readonly ChaveMcp[]): Map<string, CredencialDoAgente[]> {
  const porId = new Map(chaves.map((k) => [k.id, k]));
  const mapa = new Map<string, CredencialDoAgente[]>();
  for (const v of vinculos) {
    const corte = v.principal.indexOf(":");
    const prefixo = corte < 0 ? "" : v.principal.slice(0, corte);
    const id = corte < 0 ? v.principal : v.principal.slice(corte + 1);
    const chave = prefixo === "key" ? porId.get(id) : undefined;
    const tipo = prefixo === "key" ? ("chave" as const) : ("conector" as const);
    const credencial: CredencialDoAgente = {
      principal: v.principal,
      tipo,
      nome: chave?.name || v.rotulo?.trim() || `${tipo === "chave" ? "Chave" : "Conector"} ${id.slice(0, 8)}`,
      previa: chave?.key_preview || null,
      padrao: v.padrao,
      desligada: chave ? !chave.is_active : false,
    };
    const lista = mapa.get(v.operator_slug);
    if (lista) lista.push(credencial);
    else mapa.set(v.operator_slug, [credencial]);
  }
  return mapa;
}

/** O bloqueio aberto (ainda não desfeito) de cada agente; com mais de um, vale o mais recente. */
export function bloqueiosAbertos(bloqueios: readonly Bloqueio[]): Map<string, Bloqueio> {
  const mapa = new Map<string, Bloqueio>();
  for (const b of bloqueios) {
    if (b.desfeito_em) continue;
    const atual = mapa.get(b.operator_slug);
    if (!atual || String(b.bloqueado_em) > String(atual.bloqueado_em)) mapa.set(b.operator_slug, b);
  }
  return mapa;
}

/** O erro do banco em palavras de gente (os RPCs do Escritório respondem com um código curto). */
export function mensagemDoErroDoEscritorio(e: unknown, padrao = "Não foi possível concluir."): string {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message || "") : String(e || "");
  if (m.includes("so_o_dono")) return "Só o dono faz isso.";
  if (m.includes("agente_nao_encontrado")) return "Agente não encontrado.";
  if (m.includes("sala_nao_encontrada")) return "Sala não encontrada ou desligada.";
  if (m.includes("conversa_nao_encontrada")) return "Conversa não encontrada.";
  if (m.includes("texto_invalido")) return "Escreva a mensagem (até 4.000 letras).";
  if (m.includes("credencial_nao_encontrada")) return "Credencial não encontrada ou desligada.";
  if (m.includes("sem_bloqueio_aberto")) return "Este agente não está bloqueado.";
  if (m.includes("internal_operators_grau_check")) return "Grau inválido.";
  return m || padrao;
}
