import { rotuloDaEtapaNoEscopo } from "./escopo";

export const ESTAGIOS = [
  { id: "novo", label: "Novo", ajuda: "Chegou e ainda não foi tocado" },
  {
    id: "contato",
    label: "Em contato",
    ajuda: "Conversa aberta, sem reunião marcada",
  },
  {
    id: "diagnostico",
    label: "Diagnóstico",
    ajuda: "Entendendo o negócio e o problema",
  },
  {
    id: "proposta",
    label: "Proposta",
    ajuda: "Proposta enviada, esperando resposta",
  },
  {
    id: "negociacao",
    label: "Negociação",
    ajuda: "Ajustando valor, escopo ou prazo",
  },
  { id: "ganho", label: "Ganho", ajuda: "Fechou e virou cliente" },
  {
    id: "perdido",
    label: "Perdido",
    ajuda: "Não seguiu. O motivo fica registrado",
  },
] as const;

export type EstagioId = (typeof ESTAGIOS)[number]["id"];

export const ESTAGIOS_ABERTOS = ESTAGIOS.filter(
  (e) => e.id !== "ganho" && e.id !== "perdido",
).map((e) => e.id) as EstagioId[];

// No CRM que a empresa assina, cada ramo dá o próprio nome às etapas ("Visita",
// "Avaliação"). A casa não tem nome próprio e fica sempre no padrão.
export const rotuloDoEstagio = (id: string) =>
  rotuloDaEtapaNoEscopo(id) || ESTAGIOS.find((e) => e.id === id)?.label || id;
