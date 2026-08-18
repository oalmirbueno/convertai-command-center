import { SERVICE_LABELS } from "@/lib/cycleDefs";

/**
 * O que a Aceleriq faz para cada cliente, e o que isso significa na tela.
 *
 * O cadastro guarda serviço como chave solta em `services_config` misturada
 * com bandeiras de controle (`internal_company`, `ciclo_extra`,
 * `one_off_done`, `cobranca`, caixas do financeiro, histórico de pulso). Ler
 * o objeto inteiro traria essas bandeiras como se fossem serviço vendido —
 * então a lista de serviços de verdade é a interseção com SERVICE_LABELS, que
 * é onde os serviços estão nomeados um a um.
 *
 * Isto existe porque o cliente avulso não tem semana que se repete: ele tem
 * UMA entrega, do serviço dele. Mostrar a ele o checklist de seis etapas de
 * social media — que era o que a folha fazia — descrevia um trabalho que não
 * é o dele.
 */

/** Só o que é serviço vendido; bandeira de controle fica de fora. */
export function servicosDoCliente(client: unknown): string[] {
  const config = (client as { services_config?: Record<string, unknown> } | null)?.services_config;
  if (!config || typeof config !== "object") return [];
  return Object.keys(SERVICE_LABELS).filter((chave) => config[chave] === true);
}

/* ─────────────────── Etapas próprias de cada serviço ─────────────────────── */

/**
 * Entrega de site tem etapa de site; design tem a de design. As seis do ciclo
 * semanal descrevem rotina de contrato correndo e não servem para uma entrega
 * com começo e fim.
 */
const ETAPAS: Record<string, string[]> = {
  site: [
    "Briefing e referências fechados",
    "Estrutura e textos aprovados",
    "Layout desenhado e aprovado",
    "Site construído e revisado",
    "Domínio, e-mail e medição no ar",
    "Entregue com o cliente sabendo mexer",
  ],
  design: [
    "Briefing e referências fechados",
    "Conceito apresentado",
    "Peças desenhadas",
    "Ajustes do cliente aplicados",
    "Arquivos finais entregues (abertos e fechados)",
  ],
  seo: [
    "Diagnóstico do site e das palavras",
    "Correções técnicas aplicadas",
    "Páginas e textos otimizados",
    "Google Meu Negócio e diretórios",
    "Medição no ar e primeira leitura",
  ],
  copywriting: [
    "Briefing de voz e público",
    "Rascunho escrito",
    "Revisão com o cliente",
    "Texto final entregue",
  ],
  edicao_video: [
    "Material recebido e organizado",
    "Corte e roteiro de edição",
    "Primeira versão enviada",
    "Ajustes aplicados",
    "Vídeo final entregue nos formatos combinados",
  ],
  videos_ia: [
    "Roteiro e referências fechados",
    "Cenas geradas",
    "Narração e trilha",
    "Montagem e legendas",
    "Vídeo final entregue",
  ],
  automacao: [
    "Mapa do processo atual",
    "Fluxo desenhado e aprovado",
    "Automação construída",
    "Teste com caso real",
    "No ar, com o cliente sabendo acompanhar",
  ],
  email_marketing: [
    "Lista e ferramenta prontas",
    "Sequência escrita",
    "Peças e testes de entrega",
    "Disparo ligado",
    "Primeira leitura de resultado",
  ],
  relatorios: [
    "Fontes conectadas",
    "Leitura do período",
    "Relatório escrito em linguagem de cliente",
    "Entregue e explicado",
  ],
};

/** As etapas do serviço, ou vazio para serviço sem trilho próprio. */
export function etapasDoServico(servico: string): string[] {
  return ETAPAS[servico] ?? [];
}

/** Serviço que tem trilho próprio de entrega avulsa. */
export function temEtapasProprias(servico: string): boolean {
  return ETAPAS[servico] !== undefined;
}

/* ─────────────────────────── "O seu time é" ──────────────────────────────── */

/**
 * Cada serviço dito na língua do cliente.
 *
 * O cadastro fala "edicao_video" e "trafego" porque é chave de banco. O
 * cliente não contratou uma chave — ele contratou alguém que cuida de uma
 * parte do negócio dele, e é assim que o resumo fala.
 */
const NA_LINGUA_DO_CLIENTE: Record<string, string> = {
  social: "cuida das suas redes sociais",
  trafego: "coloca e acompanha os seus anúncios",
  design: "desenha as suas peças",
  copywriting: "escreve os seus textos",
  edicao_video: "edita os seus vídeos",
  videos_ia: "produz os seus vídeos",
  site: "constrói e mantém o seu site",
  seo: "trabalha para você aparecer no Google",
  automacao: "automatiza o que hoje é feito na mão",
  email_marketing: "cuida dos seus e-mails",
  relatorios: "traduz os números em leitura",
};

/** Junta com vírgulas e um "e" antes do último, como se escreve de verdade. */
function juntar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

/**
 * O resumo do que foi contratado, para o cliente ler.
 *
 * Sem serviço marcado o texto some em vez de virar "O seu time é ." — frase
 * quebrada em tela de cliente é pior do que ausência.
 */
export function resumoDoTime(client: unknown): string {
  const partes = servicosDoCliente(client)
    .map((servico) => NA_LINGUA_DO_CLIENTE[servico])
    .filter(Boolean);
  if (partes.length === 0) return "";
  return `O seu time é quem ${juntar(partes)}.`;
}
