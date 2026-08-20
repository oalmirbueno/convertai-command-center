import { CYCLES, type CycleArea } from "@/lib/cycleDefs";

/**
 * As etapas do ciclo ditas para o cliente.
 *
 * O checklist é escrito para QUEM EXECUTA: "subir no painel", "conectar e
 * conferir a conta", "registro no painel para o cliente ver". São ordens de
 * serviço no imperativo. Passadas cruas para a mensagem, o cliente lia
 * "já saíram conteúdo da semana criado e subir no painel" — bastidor da
 * agência entregue como se fosse notícia dele.
 *
 * Aqui cada etapa vira o que ela SIGNIFICA para quem contratou. Etapa sem
 * tradução simplesmente não entra na mensagem: melhor a semana parecer menor
 * do que foi do que mandar jargão interno para o cliente.
 */
const NA_LINGUA_DO_CLIENTE: Record<string, string> = {
  // Social Media
  "Conteúdo da semana criado (artes e legendas)": "o conteúdo da semana ficou pronto",
  "Subir no painel (Arquivos, pasta certa)": "o material já está no painel para você ver",
  "Conectar e conferir a conta no painel": "",
  "Painel atualizado (agenda, métricas, diário)": "o painel foi atualizado com agenda e números",
  "Aprovação no grupo + ritual enviado": "",
  "Posts agendados (publicação automática armada)": "os posts já estão agendados para publicar sozinhos",
  // Tráfego Pago
  "Campanhas ativas revisadas": "as campanhas foram revisadas uma a uma",
  "Criativos da semana prontos": "os criativos da semana ficaram prontos",
  "Anúncios subidos ou atualizados": "os anúncios entraram no ar atualizados",
  "Verba e orçamento conferidos": "a verba foi conferida",
  "Métricas lidas e leitura anotada": "os números foram lidos e interpretados",
  "Registro no painel para o cliente ver": "",
};

/**
 * O que contar ao cliente sobre a rotina desta semana.
 *
 * Devolve só as etapas que têm tradução e que já foram concluídas, sem
 * repetir — duas frentes podem ter etapas com sentido parecido.
 */
export function rotinaEmLinguagemDeCliente(
  feitas: ReadonlyArray<{ area: CycleArea; step: number }>,
): string[] {
  const ditas = new Set<string>();
  for (const { area, step } of feitas) {
    const etapas = CYCLES[area]?.steps || [];
    const rotulo = etapas[step - 1];
    if (!rotulo) continue;
    const traduzida = NA_LINGUA_DO_CLIENTE[rotulo];
    // Etapa sem tradução é bastidor puro: não vira frase.
    if (!traduzida) continue;
    ditas.add(traduzida);
  }
  return [...ditas];
}

/** Existe tradução para esta etapa? Usado pelos testes de cobertura. */
export function temTraducao(rotulo: string): boolean {
  return Object.prototype.hasOwnProperty.call(NA_LINGUA_DO_CLIENTE, rotulo);
}
