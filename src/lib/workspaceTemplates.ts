export type TplNode = { name: string; hint?: string; children?: TplNode[] };
export type WorkspaceTemplate = {
  id: string;
  name: string;
  description: string;
  scope: "global" | "client" | "any";
  icon: "Building2" | "Palette" | "TrendingUp" | "Clapperboard" | "Users" | "Wallet" | "Handshake";
  tree: TplNode[];
};

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: "agency-full",
    name: "Agência Completo",
    description: "Estrutura padrão com todos os departamentos.",
    scope: "global", icon: "Building2",
    tree: [
      { name: "01. Comercial", children: [{ name: "Propostas" }, { name: "Contratos" }, { name: "Prospecção" }] },
      { name: "02. Design", children: [{ name: "Templates" }, { name: "Identidade Visual" }, { name: "Mockups" }] },
      { name: "03. Tráfego", children: [{ name: "Criativos" }, { name: "Relatórios" }, { name: "Copies" }] },
      { name: "04. Audiovisual", children: [{ name: "Brutos" }, { name: "Edits" }, { name: "Trilhas e SFX" }, { name: "Entregas" }] },
      { name: "05. Financeiro", children: [{ name: "Notas Fiscais" }, { name: "Comprovantes" }] },
      { name: "06. Marca e Assets", children: [{ name: "Logos" }, { name: "Fontes" }, { name: "Fotos" }] },
    ],
  },
  {
    id: "agency-design",
    name: "Design",
    description: "Templates, identidade e mockups.",
    scope: "global", icon: "Palette",
    tree: [
      { name: "Templates" }, { name: "Identidade Visual" },
      { name: "Mockups" }, { name: "Ícones e UI" },
    ],
  },
  {
    id: "agency-traffic",
    name: "Tráfego Pago",
    description: "Gestão de campanhas e criativos.",
    scope: "global", icon: "TrendingUp",
    tree: [
      { name: "Criativos", children: [{ name: "Estáticos" }, { name: "Carrosséis" }, { name: "Vídeos" }] },
      { name: "Copies" }, { name: "Relatórios" }, { name: "Públicos e Pixels" },
    ],
  },
  {
    id: "agency-commercial",
    name: "Comercial",
    description: "Prospecção, propostas e contratos.",
    scope: "global", icon: "Handshake",
    tree: [
      { name: "Prospecção" }, { name: "Propostas" },
      { name: "Contratos assinados" }, { name: "Pitch decks" },
    ],
  },
  {
    id: "agency-finance",
    name: "Financeiro",
    description: "Documentos fiscais e comprovantes.",
    scope: "global", icon: "Wallet",
    tree: [
      { name: "Notas Fiscais" }, { name: "Comprovantes" },
      { name: "Recibos" }, { name: "Impostos" },
    ],
  },
  {
    id: "audiovisual-quick",
    name: "Audiovisual Projeto",
    description: "Template rápido para um projeto de vídeo. Aplique por peça.",
    scope: "any", icon: "Clapperboard",
    tree: [
      { name: "01. Briefing e Roteiro" },
      { name: "02. Referências" },
      { name: "03. Brutos" },
      { name: "04. Trilhas e SFX" },
      { name: "05. Edits", children: [{ name: "v1" }, { name: "v2" }] },
      { name: "06. Final" },
    ],
  },
  {
    id: "video-pipeline",
    name: "Pipeline Vídeo e Áudio",
    description: "Fluxo enxuto de produção com dicas do que subir em cada etapa.",
    scope: "any", icon: "Clapperboard",
    tree: [
      {
        name: "1. Brutos",
        hint: "Cartões da câmera, áudio limpo do gravador, screen recordings e captações originais. Nunca renomear os arquivos originais.",
        children: [
          { name: "Câmera", hint: "Clipes .MP4/.MOV direto do cartão, organizados por dia ou take." },
          { name: "Áudio", hint: "WAV do gravador, lapelas e ambiências. Sincronizar depois no edit." },
          { name: "Screencasts", hint: "Gravações de tela, demos de produto, capturas de referência." },
        ],
      },
      {
        name: "2. Trilhas e SFX",
        hint: "Trilhas licenciadas, foley, efeitos sonoros e voz off. Deixar já cortado no BPM aproximado.",
        children: [
          { name: "Trilhas" },
          { name: "SFX" },
          { name: "Voz off" },
        ],
      },
      {
        name: "3. Edição",
        hint: "Projetos abertos, versões em revisão e exports intermediários para aprovação interna.",
        children: [
          { name: "Projeto (Premiere/DaVinci)", hint: "Arquivos .prproj / .drp e caches locais. Não subir renders finais aqui." },
          { name: "V1 revisão interna" },
          { name: "V2 cliente" },
          { name: "Legendas e artes", hint: "SRT, lower thirds, títulos animados e overlays." },
        ],
      },
      {
        name: "4. Final",
        hint: "Somente masters aprovados. Nomear como Cliente_Peca_Formato_vFinal.mp4.",
        children: [
          { name: "Master 16:9" },
          { name: "Corte 9:16" },
          { name: "Corte 1:1" },
          { name: "Thumbnails e capa" },
        ],
      },
    ],
  },
  {
    id: "client-standard",
    name: "Cliente Padrão",
    description: "Aplique dentro da pasta de um cliente.",
    scope: "any", icon: "Users",
    tree: [
      { name: "Briefing" }, { name: "Identidade Visual" },
      { name: "Criativos", children: [{ name: "Estáticos" }, { name: "Carrosséis" }, { name: "Vídeos" }] },
      { name: "Materiais do Cliente" }, { name: "Relatórios" }, { name: "Entregas" },
    ],
  },
];
