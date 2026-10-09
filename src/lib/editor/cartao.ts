import type { ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import type { AcaoDoAgente, ItemDaAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { apelidosDoProjeto, rotuloDaOperacao } from "./apelidos";
import type { Operacao } from "./operacoes";

/**
 * Proposta do editor (skill, agente, antes e depois) no formato do contrato
 * comum das ações do agente, para usar o mesmo CartaoDeAcao da casa: lista
 * exata com apelidos, Confirmar/Cancelar, e Desfazer depois. Aqui é tudo local
 * (a linha do tempo muda na tela e o salvamento automático grava).
 */

const ROTULO_CURTO: Partial<Record<Operacao["op"], string>> = {
  dividir: "Dividir",
  aparar: "Aparar",
  mover: "Mover",
  remover: "Tirar",
  recortar: "Cortar",
  recortar_varios: "Cortar",
  camera: "Câmera",
  dividir_varios: "Dividir",
  inserir: "Inserir",
  propriedades: "Ajustar",
  ondular: "Encostar",
  deslocar_trilha: "Puxar",
  reordenar: "Ordem",
  limpar_trilha: "Esvaziar",
  trilha_nova: "Trilha",
  transcricao: "Fala",
  visao: "Visão",
};

export function acaoDaProposta(id: string, agente: string, resumo: string, operacoes: Operacao[], base: ProjetoDeEdicao, avisos: string[] = []): AcaoDoAgente {
  const a = apelidosDoProjeto(base);
  const visiveis = operacoes.filter((o) => o.op !== "registrar_skill");
  const itens: ItemDaAcaoDoAgente[] = visiveis.slice(0, 400).map((o, k) => ({
    ref: `o${k + 1}`,
    alvo_id: "clipe" in o ? String((o as { clipe: string }).clipe) : `op${k + 1}`,
    titulo: rotuloDaOperacao(o, base, a),
    detalhe: null,
    operacao: o.op,
    rotulo: ROTULO_CURTO[o.op] || "Mudar",
    para: null,
  }));
  return {
    tipo: "acao_agente",
    agente,
    id,
    resumo: avisos.length ? `${resumo} ${avisos.join(" ")}` : resumo,
    itens,
    ignorados: visiveis.length > 400 ? [`${visiveis.length - 400} mudanças a mais, iguais às da lista`] : [],
    recusados: [],
    custo_estimado_usd: 0,
  };
}

export function acaoFeita(a: AcaoDoAgente, agora: string): AcaoDoAgente {
  return { ...a, executada_em: agora, resultados: a.itens.map((i) => ({ ref: i.ref, alvo_id: i.alvo_id, titulo: i.titulo, operacao: i.operacao, ok: true, desfazer: { local: true } })) };
}
