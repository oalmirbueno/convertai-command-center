/**
 * O que a tela do editor faz e a ferramenta do agente que faz o mesmo (02/10,
 * dono: "o agente é limitado, tudo o que eu faço no Editar ele tem que
 * conseguir"). O teste de cobertura confere: toda capacidade aponta para uma
 * ferramenta que existe, todo painel do editor aparece aqui e todo painel que
 * o agente abre existe. O que é pago (gerar, trocar cenário, rastrear rosto,
 * Timestamp, ler a referência) o agente prepara e o dono vê o custo antes.
 */

export interface CapacidadeDoEditor {
  capacidade: string;
  /** Aba do editor onde a pessoa faz à mão (mesmos ids de EditorDeVideo e PAINEIS_DO_EDITOR); "linha" = linha do tempo e Ajustes. */
  painel: string;
  ferramenta: string;
}

export const CAPACIDADES_DO_EDITOR: CapacidadeDoEditor[] = [
  { capacidade: "Edição inteira (EDIT IA PRO, plano da casa e julgamentos)", painel: "ia", ferramenta: "edicao_completa" },
  { capacidade: "Buscar e filtrar a Mídia", painel: "midia", ferramenta: "buscar" },
  { capacidade: "Pôr mídia na linha do tempo", painel: "midia", ferramenta: "inserir_midia" },
  { capacidade: "Cortar silêncios", painel: "corte", ferramenta: "aplicar_skill" },
  { capacidade: "Cortar pela onda medida", painel: "corte", ferramenta: "cortar_pela_onda" },
  { capacidade: "Medir a onda", painel: "corte", ferramenta: "medir_onda" },
  { capacidade: "Ficar com a melhor tomada", painel: "corte", ferramenta: "ficar_com_melhor_tomada" },
  { capacidade: "Conferir o corte", painel: "corte", ferramenta: "conferir_corte" },
  { capacidade: "Tirar takes repetidos", painel: "corte", ferramenta: "remover_duplicados" },
  { capacidade: "Fechar buracos", painel: "corte", ferramenta: "fechar_buracos" },
  { capacidade: "Ritmo do Brabo (batidas e zoom alternado)", painel: "corte", ferramenta: "aplicar_skill" },
  { capacidade: "Legenda no estilo da marca", painel: "textos", ferramenta: "legendar" },
  { capacidade: "Texto na tela (título, gancho, chamada, nome)", painel: "textos", ferramenta: "inserir_texto" },
  { capacidade: "Editar texto ou legenda", painel: "textos", ferramenta: "editar_clipe" },
  { capacidade: "Peça de motion na palavra dita", painel: "motion", ferramenta: "animar" },
  { capacidade: "Editar os parâmetros da peça", painel: "motion", ferramenta: "editar_clipe" },
  { capacidade: "Sugerir animações pela fala", painel: "motion", ferramenta: "sugerir_animacoes" },
  { capacidade: "Logo do cliente", painel: "motion", ferramenta: "logo" },
  { capacidade: "Cartão final", painel: "motion", ferramenta: "cartao_final" },
  { capacidade: "Efeito no trecho (zoom, tremor, flash, desfoque)", painel: "zoom", ferramenta: "efeito" },
  { capacidade: "Zoom nos momentos fortes", painel: "zoom", ferramenta: "zoom_momentos" },
  { capacidade: "Transição na troca de plano", painel: "zoom", ferramenta: "transicao" },
  { capacidade: "Look e ajustes de cor", painel: "cor", ferramenta: "cor" },
  { capacidade: "LUT .cube do cliente", painel: "cor", ferramenta: "abrir_painel" },
  { capacidade: "Formato seguindo o rosto", painel: "formato", ferramenta: "formato" },
  { capacidade: "Rastrear o rosto (pago)", painel: "formato", ferramenta: "abrir_painel" },
  { capacidade: "Música com ducking", painel: "som", ferramenta: "musica" },
  { capacidade: "Mixagem e LUFS", painel: "som", ferramenta: "mixagem" },
  { capacidade: "Efeitos sonoros nas animações", painel: "som", ferramenta: "sons" },
  { capacidade: "Capítulos", painel: "capitulos", ferramenta: "capitulos" },
  { capacidade: "Corte viral 9:16", painel: "capitulos", ferramenta: "abrir_painel" },
  { capacidade: "Render do vídeo inteiro", painel: "exportar", ferramenta: "exportar" },
  { capacidade: "Amostra de 8 a 15 s", painel: "exportar", ferramenta: "amostra" },
  { capacidade: "B-roll gerado (pago)", painel: "gerar", ferramenta: "gerar_broll" },
  { capacidade: "Elemento gerado (pago)", painel: "gerar", ferramenta: "gerar_elemento" },
  { capacidade: "Trocar câmera, continuar, transição gerada (pago)", painel: "gerar", ferramenta: "abrir_painel" },
  { capacidade: "Trocar cenário (pago)", painel: "cenario", ferramenta: "trocar_cenario" },
  { capacidade: "Timestamp (pago)", painel: "timestamp", ferramenta: "abrir_painel" },
  { capacidade: "Copiar a edição de uma referência", painel: "referencias", ferramenta: "aplicar_referencia" },
  { capacidade: "Medir e ler a referência", painel: "referencias", ferramenta: "abrir_painel" },
  { capacidade: "Qualquer skill", painel: "skills", ferramenta: "aplicar_skill" },
  { capacidade: "Dividir", painel: "linha", ferramenta: "dividir" },
  { capacidade: "Aparar", painel: "linha", ferramenta: "aparar" },
  { capacidade: "Mover (inclusive para outra trilha)", painel: "linha", ferramenta: "mover" },
  { capacidade: "Tirar um ou vários clipes", painel: "linha", ferramenta: "remover" },
  { capacidade: "Cortar um trecho da fonte", painel: "linha", ferramenta: "recortar" },
  { capacidade: "Reordenar", painel: "linha", ferramenta: "reordenar" },
  { capacidade: "Velocidade, volume, zoom e nota do clipe", painel: "ajustes", ferramenta: "ajustar" },
  { capacidade: "Som e visibilidade da trilha", painel: "linha", ferramenta: "trilha" },
  { capacidade: "Começar do zero (cena com fundo, título e peça)", painel: "linha", ferramenta: "cena" },
  { capacidade: "Entender o vídeo (seções, ênfases, dados)", painel: "linha", ferramenta: "entender_video" },
  { capacidade: "Pesquisar na web com fontes", painel: "linha", ferramenta: "pesquisar" },
];
