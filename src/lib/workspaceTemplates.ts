export type TplNode = { name: string; children?: TplNode[] };
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
    name: "Agência — Completo",
    description: "Estrutura padrão com todos os departamentos.",
    scope: "global", icon: "Building2",
    tree: [
      { name: "01. Comercial", children: [{ name: "Propostas" }, { name: "Contratos" }, { name: "Prospecção" }] },
      { name: "02. Design", children: [{ name: "Templates" }, { name: "Identidade Visual" }, { name: "Mockups" }] },
      { name: "03. Tráfego", children: [{ name: "Criativos" }, { name: "Relatórios" }, { name: "Copies" }] },
      { name: "04. Audiovisual", children: [{ name: "Brutos" }, { name: "Edits" }, { name: "Trilhas & SFX" }, { name: "Entregas" }] },
      { name: "05. Financeiro", children: [{ name: "Notas Fiscais" }, { name: "Comprovantes" }] },
      { name: "06. Marca & Assets", children: [{ name: "Logos" }, { name: "Fontes" }, { name: "Fotos" }] },
    ],
  },
  {
    id: "agency-design",
    name: "Design",
    description: "Templates, identidade e mockups.",
    scope: "global", icon: "Palette",
    tree: [
      { name: "Templates" }, { name: "Identidade Visual" },
      { name: "Mockups" }, { name: "Ícones & UI" },
    ],
  },
  {
    id: "agency-traffic",
    name: "Tráfego Pago",
    description: "Gestão de campanhas e criativos.",
    scope: "global", icon: "TrendingUp",
    tree: [
      { name: "Criativos", children: [{ name: "Estáticos" }, { name: "Carrosséis" }, { name: "Vídeos" }] },
      { name: "Copies" }, { name: "Relatórios" }, { name: "Públicos & Pixels" },
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
    name: "Audiovisual — Projeto",
    description: "Template rápido para um projeto de vídeo. Aplique por peça.",
    scope: "any", icon: "Clapperboard",
    tree: [
      { name: "01. Briefing & Roteiro" },
      { name: "02. Referências" },
      { name: "03. Brutos" },
      { name: "04. Trilhas & SFX" },
      { name: "05. Edits", children: [{ name: "v1" }, { name: "v2" }] },
      { name: "06. Final" },
    ],
  },
  {
    id: "client-standard",
    name: "Cliente — Padrão",
    description: "Aplique dentro da pasta de um cliente.",
    scope: "any", icon: "Users",
    tree: [
      { name: "Briefing" }, { name: "Identidade Visual" },
      { name: "Criativos", children: [{ name: "Estáticos" }, { name: "Carrosséis" }, { name: "Vídeos" }] },
      { name: "Materiais do Cliente" }, { name: "Relatórios" }, { name: "Entregas" },
    ],
  },
];
