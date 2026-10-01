import { FileText, Plus } from "lucide-react";
import Etapas from "@/components/sistema/Etapas";
import SeletorCompacto, { type OpcaoCompacta } from "@/components/sistema/SeletorCompacto";
import { hojeEmSaoPaulo, ROTULO_DO_STATUS, textoDoTotal } from "../../../supabase/functions/_shared/proposta-modelo";
import { followupDaProposta } from "../../../supabase/functions/_shared/proposta-comercial";
import { usePropostas } from "./propostaApi";
import { etapasFeitas, type EtapaDaProposta } from "./caminhoDaProposta";

/**
 * O que a casca da Mesa Proposta mostra da proposta aberta (frente UXS, 30/09).
 * Os dois leem a lista de propostas do cache (a mesma chave do corpo da mesa,
 * sem busca nova) e só eles redesenham quando a lista muda.
 *
 * - SeletorDaProposta: "Nº 2026-014 · Enviada ▾" em todas as etapas; lista as
 *   vivas (título e total na linha de apoio) e termina com "Nova proposta".
 *   As arquivadas ficam em "Todas as propostas", no "..." da proposta ("Ver arquivadas"); a aberta arquivada
 *   aparece no fim, com a linha "Arquivada". `compacto`: só o número (celular).
 * - EtapasDaMesaProposta: Revisar com o número de pendências que bloqueiam o
 *   envio e Acompanhar em destaque quando há follow-up pronto. Frente PRS
 *   (30/09): o check pequeno em cada etapa feita (conversa com material e
 *   itens, rascunho escrito, nada bloqueando, enviada, aceita), para a pessoa
 *   ver onde está no caminho. No celular, a Mesa usa MenuDaPropostaNoCelular
 *   (um controle só para trocar, criar e as ações).
 */

const NOVA = "__nova";

export function SeletorDaProposta({
  clientId,
  propostaId,
  onAbrir,
  onNova,
  compacto = false,
  className = "",
}: {
  clientId: string;
  propostaId: string | null;
  onAbrir: (id: string) => void;
  onNova: () => void;
  compacto?: boolean;
  className?: string;
}) {
  const propostas = usePropostas(clientId);
  const lista = propostas.data ? propostas.data.lista : [];
  const vivas = lista.filter((p) => !p.arquivada_em);
  const aberta = propostaId ? lista.find((p) => p.id === propostaId) || null : null;
  if (!vivas.length && !aberta) return null;
  const status = (s: string) => ROTULO_DO_STATUS[s as keyof typeof ROTULO_DO_STATUS] || s;
  const opcao = (p: (typeof lista)[number], arquivada: boolean): OpcaoCompacta => ({
    valor: p.id,
    rotulo: compacto ? `Nº ${p.numero}` : `Nº ${p.numero} · ${status(p.status_efetivo)}`,
    descricao: arquivada ? "Arquivada" : `${compacto ? `${status(p.status_efetivo)} · ` : ""}${p.titulo} · ${textoDoTotal(p.totais)}`,
  });
  const opcoes = vivas.map((p) => opcao(p, false));
  if (aberta && aberta.arquivada_em) opcoes.push(opcao(aberta, true));
  opcoes.push({ valor: NOVA, rotulo: "Nova proposta", icone: <Plus className="h-3.5 w-3.5" /> });
  return (
    <SeletorCompacto
      modo="lista"
      rotulo="Proposta"
      icone={<FileText className="h-3.5 w-3.5" />}
      opcoes={opcoes}
      valor={propostaId || ""}
      onEscolher={(v) => (v === NOVA ? onNova() : onAbrir(v))}
      className={className}
    />
  );
}

export function EtapasDaMesaProposta({
  clientId,
  propostaId,
  itens,
  valor,
  onEscolher,
}: {
  clientId: string;
  propostaId: string | null;
  itens: ReadonlyArray<{ valor: string; rotulo: string }>;
  valor: string;
  onEscolher: (v: string) => void;
}) {
  const propostas = usePropostas(clientId);
  const p = propostaId && propostas.data ? propostas.data.lista.find((x) => x.id === propostaId) || null : null;
  // Só conta onde dá para agir: aberta, não aceita e não arquivada.
  const vale = !!p && p.status !== "aceita" && !p.arquivada_em;
  const bloqueios = vale && p ? p.pendencias.filter((x) => x.bloqueia).length : 0;
  const followup = p && !p.arquivada_em ? followupDaProposta(p, hojeEmSaoPaulo()) : null;
  const feitas = etapasFeitas(p);
  return (
    <Etapas
      rotulo="Etapas da Mesa Proposta"
      numerar
      itens={itens.map((e) => ({
        valor: e.valor,
        rotulo: e.rotulo,
        contador: e.valor === "revisao" && bloqueios ? bloqueios : null,
        destaque: e.valor === "acompanhar" && !!followup,
        feita: !!p && feitas[e.valor as EtapaDaProposta] === true && e.valor !== valor,
        dica: e.valor === "revisao" && bloqueios ? `${bloqueios} pendência(s) bloqueiam o envio` : e.valor === "acompanhar" && followup ? "Follow-up pronto no Acompanhar" : undefined,
      }))}
      valor={valor}
      onEscolher={onEscolher}
    />
  );
}
