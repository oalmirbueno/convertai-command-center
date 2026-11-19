/**
 * Ateliê de Cor: o mapa de nichos da casa (19/11/2026).
 *
 * Observação de prática de design no Brasil, escrita pela Aceleriq; não é
 * pesquisa de mercado nem ciência (a evidência sobre psicologia da cor é
 * fraca; o que pesa é coerência com a categoria e contraste no botão, ver
 * docs/cores/PESQUISA.md). Cada nicho traz o que costuma aparecer (para seguir
 * o código da categoria e passar confiança) e onde há espaço para se
 * diferenciar. Os nichos da carteira da Aceleriq entram aqui também.
 */

export type Nicho = {
  id: string;
  nome: string;
  contexto: string;
  /** Matizes OKLCH que o motor tenta como cor da marca quando o cliente não tem uma. */
  matizes: number[];
  comum: string[];
  diferenciar: string[];
  leituraComum: string;
  leituraDiferenciar: string;
  subnichos: string[];
};

export const NICHOS: Nicho[] = [
  { id: "advocacia", nome: "Advocacia", contexto: "Quem contrata quer segurança e sigilo. A marca precisa parecer firme sem ficar fria.", matizes: [262, 20, 200], comum: ["#1C2B4A", "#5C1F2B", "#B08D57", "#1F3A2E"], diferenciar: ["#16474F", "#5E6B3A", "#A65A3F", "#3C2C4A"], leituraComum: "Marinho, vinho e dourado: o código tradicional da categoria.", leituraDiferenciar: "Petróleo, oliva e terrosos sóbrios mantêm a seriedade e saem do padrão.", subnichos: ["Empresarial", "Família e previdência", "Trabalhista", "Boutique", "Digital"] },
  { id: "saude", nome: "Clínicas e saúde", contexto: "O paciente escolhe por confiança e calma. Informação clara pesa tanto quanto autoridade.", matizes: [235, 195, 165], comum: ["#1E5AA8", "#2BB3B1", "#FFFFFF", "#7FC8A9"], diferenciar: ["#264653", "#E07A5F", "#8AB0AB", "#F2CC8F"], leituraComum: "Azul, verde-água e branco: limpeza e confiança.", leituraDiferenciar: "Petróleo com coral suave aquece sem perder a calma.", subnichos: ["Clínica geral", "Fisioterapia", "Psicologia", "Nutrição", "Exames"] },
  { id: "odontologia", nome: "Odontologia", contexto: "Dentista lembra desconforto; a marca tem a chance de mostrar cuidado, leveza e resultado.", matizes: [215, 180, 300], comum: ["#2E86C1", "#48C9B0", "#FFFFFF", "#AED6F1"], diferenciar: ["#1D3557", "#F4A261", "#E9D8FD", "#2A9D8F"], leituraComum: "Azul-claro e turquesa: limpeza clínica.", leituraDiferenciar: "Marinho com pêssego ou lilás soa estético e humano.", subnichos: ["Estética do sorriso", "Ortodontia", "Implantes", "Infantil"] },
  { id: "estetica", nome: "Estética e beleza", contexto: "O cliente compra autoestima e confiança no resultado. Cuidado, técnica e desejo juntos.", matizes: [20, 350, 60], comum: ["#E8B4B8", "#C9A27E", "#FFFFFF", "#D4AF37"], diferenciar: ["#3E2A35", "#B5838D", "#DDE5B6", "#6D597A"], leituraComum: "Rosé, nude e dourado: o padrão do setor.", leituraDiferenciar: "Ameixa profunda com verde-pálido sai do rosé sem perder delicadeza.", subnichos: ["Clínica de estética", "Salão", "Sobrancelha e cílios", "Spa"] },
  { id: "confeitaria", nome: "Confeitaria", contexto: "Vende desejo e ocasião. A cor precisa abrir o apetite e combinar com a foto do produto.", matizes: [40, 350, 70], comum: ["#F4C2C2", "#6F4E37", "#FFF5E1", "#E75480"], diferenciar: ["#1F3260", "#F3E3D3", "#6B0F1A", "#9BC1BC"], leituraComum: "Rosa, chocolate e pastel: reconhecimento imediato.", leituraDiferenciar: "Marinho com creme e vinho fica sofisticado e foge do rosa.", subnichos: ["Eventos e casamentos", "Doceria de vitrine", "Bolos de festa", "Saudável"] },
  { id: "restaurante", nome: "Restaurantes", contexto: "Vende experiência e apetite. A cor vive no cardápio, no salão, no delivery e nas fotos.", matizes: [30, 60, 140], comum: ["#C0392B", "#F39C12", "#F7DC6F", "#27AE60"], diferenciar: ["#2D3A2E", "#E9C46A", "#F1FAEE", "#D1495B"], leituraComum: "Vermelho, laranja e amarelo: fome e calor.", leituraDiferenciar: "Verde-escuro com mostarda soa de cozinha autoral.", subnichos: ["Delivery", "Hamburgueria", "Pizzaria", "Alta gastronomia", "Cafeteria"] },
  { id: "academia", nome: "Academias e pilates", contexto: "Vende energia, disciplina e comunidade. A marca vive na fachada, no uniforme, no app e nas redes.", matizes: [130, 30, 270], comum: ["#000000", "#E63946", "#F77F00", "#C6F432"], diferenciar: ["#1F2A44", "#7A8B6F", "#F2E8DC", "#FF6B35"], leituraComum: "Preto com vermelho, laranja ou limão: alta energia.", leituraDiferenciar: "Pilates e bem-estar ganham com sálvia, areia e um destaque quente.", subnichos: ["Alta performance", "Bem-estar e pilates", "Low cost", "Boutique", "Lutas"] },
  { id: "moda", nome: "Moda", contexto: "A identidade sustenta coleções que mudam. A paleta é moldura; o produto é o protagonista.", matizes: [0, 60, 300], comum: ["#000000", "#FFFFFF", "#D9C5B2", "#B76E79"], diferenciar: ["#2E1A47", "#E2C9A6", "#C8F03C", "#FFFFFF"], leituraComum: "Preto, branco e nude: neutro que deixa a peça aparecer.", leituraDiferenciar: "Roxo profundo com bege e um limão de estação chama atenção.", subnichos: ["Feminina", "Masculina", "Infantil", "Streetwear", "Praia"] },
  { id: "imobiliaria", nome: "Imobiliárias", contexto: "O cliente compara segurança, localização e acabamento. A marca precisa transmitir patrimônio.", matizes: [250, 45, 150], comum: ["#0B3C5D", "#328CC1", "#D9B310", "#FFFFFF"], diferenciar: ["#2F3E46", "#CAD2C5", "#C1666B", "#84A98C"], leituraComum: "Azul e dourado: solidez e valor.", leituraDiferenciar: "Grafite esverdeado com terracota soa de morar bem.", subnichos: ["Alto padrão", "Locação", "Lançamentos", "Rural"] },
  { id: "construcao", nome: "Construção e engenharia", contexto: "Vende prazo, precisão e capacidade técnica. A identidade precisa transmitir rigor.", matizes: [60, 250, 30], comum: ["#F2A900", "#333333", "#1F4E79", "#FFFFFF"], diferenciar: ["#1D2D35", "#E76F51", "#E9EDC9", "#2A9D8F"], leituraComum: "Amarelo de obra, grafite e azul técnico.", leituraDiferenciar: "Petróleo com laranja-tijolo fica moderno e confiável.", subnichos: ["Construtora", "Reformas", "Projetos", "Materiais"] },
  { id: "arquitetura", nome: "Arquitetura e móveis", contexto: "O projeto é o produto. A marca recua para a obra aparecer, mas precisa de assinatura.", matizes: [60, 150, 30], comum: ["#000000", "#FFFFFF", "#BFB6A8", "#8B5E3C"], diferenciar: ["#2B3A35", "#E3D5C1", "#B5523B", "#F7F4EE"], leituraComum: "Preto, branco e madeira: o minimalismo esperado.", leituraDiferenciar: "Verde-musgo com linho e um tijolo dá calor autoral.", subnichos: ["Escritório de arquitetura", "Móveis planejados", "Interiores", "Paisagismo"] },
  { id: "tecnologia", nome: "Tecnologia e SaaS", contexto: "Produto digital é julgado pela interface. A paleta precisa funcionar em estado, gráfico, modo escuro e acessibilidade.", matizes: [265, 290, 195], comum: ["#2D5BFF", "#6C2BD9", "#0F172A", "#22D3EE"], diferenciar: ["#0B2E7A", "#F7F7F2", "#FF6A3D", "#0B0B0F"], leituraComum: "Azul, violeta e escuro com ciano: o padrão SaaS.", leituraDiferenciar: "Azul profundo com laranja vivo no botão: contraste que vende.", subnichos: ["SaaS B2B", "App de consumo", "IA", "Fintech"] },
  { id: "informatica", nome: "Informática e assistência", contexto: "O cliente chega com um problema e desconfiado. Organização e competência precisam aparecer.", matizes: [250, 20, 140], comum: ["#0057B8", "#E30613", "#FFFFFF", "#333333"], diferenciar: ["#111827", "#00E5A0", "#F3F4F6", "#7C3AED"], leituraComum: "Azul e vermelho de varejo técnico.", leituraDiferenciar: "Grafite com verde elétrico soa laboratório moderno.", subnichos: ["Assistência técnica", "Loja", "Gamer", "Empresas"] },
  { id: "servicos", nome: "Serviços para casa", contexto: "Ar-condicionado, limpeza, jardim: o cliente quer pontualidade e alguém de confiança dentro de casa.", matizes: [230, 150, 60], comum: ["#0077C8", "#00A859", "#FFFFFF", "#FFC20E"], diferenciar: ["#0D3B66", "#F4D35E", "#FAF0CA", "#EE964B"], leituraComum: "Azul e verde de limpeza e frescor.", leituraDiferenciar: "Marinho com amarelo-manteiga é simpático e firme.", subnichos: ["Ar-condicionado", "Limpeza", "Jardinagem", "Manutenção"] },
  { id: "educacao", nome: "Educação", contexto: "Vende futuro e confiança dos pais ou do aluno. Energia sem bagunça.", matizes: [255, 70, 150], comum: ["#1E40AF", "#F59E0B", "#10B981", "#FFFFFF"], diferenciar: ["#3D348B", "#F7B801", "#F18701", "#F4F1DE"], leituraComum: "Azul com amarelo ou laranja.", leituraDiferenciar: "Índigo com amarelo-sol fica marcante e acolhedor.", subnichos: ["Escola", "Cursos livres", "Idiomas", "Infantil", "Online"] },
  { id: "financeiro", nome: "Financeiro e contabilidade", contexto: "Dinheiro pede segurança. Os digitais mostraram que dá para ser sério e moderno.", matizes: [255, 155, 300], comum: ["#003A70", "#00843D", "#FFFFFF", "#8A05BE"], diferenciar: ["#14213D", "#FCA311", "#E5E5E5", "#2EC4B6"], leituraComum: "Azul e verde da confiança; roxo e laranja dos digitais.", leituraDiferenciar: "Marinho com âmbar soa sólido e próximo.", subnichos: ["Contabilidade", "Crédito", "Investimentos", "Seguros"] },
  { id: "agencia", nome: "Marketing e agências", contexto: "A própria marca é a primeira prova do que a agência entrega.", matizes: [140, 300, 30], comum: ["#000000", "#FFFFFF", "#FF3366", "#3A86FF"], diferenciar: ["#0B0B0F", "#F5F5F0", "#C6FF00", "#7B61FF"], leituraComum: "Preto e branco com um vivo.", leituraDiferenciar: "Preto com limão elétrico e um violeta: ousado e técnico.", subnichos: ["Performance", "Social media", "Branding", "Produtora"] },
  { id: "varejo", nome: "Lojas e e-commerce", contexto: "A paleta convive com a foto do produto e precisa destacar preço, botão de compra e confiança no checkout.", matizes: [20, 60, 260], comum: ["#E53935", "#FFB300", "#1E88E5", "#FFFFFF"], diferenciar: ["#22223B", "#F2E9E4", "#FF7F51", "#4A4E69"], leituraComum: "Vermelho de oferta, amarelo e azul de confiança.", leituraDiferenciar: "Ameixa escuro com coral destaca o preço com elegância.", subnichos: ["Moda", "Eletrônicos", "Casa", "Alimentos", "Games e keys"] },
  { id: "pet", nome: "Pet", contexto: "Dono de pet compra carinho e cuidado. Alegria sem parecer infantil.", matizes: [60, 190, 30], comum: ["#FF8C00", "#00A3E0", "#FFFFFF", "#8BC34A"], diferenciar: ["#264653", "#F4A261", "#E9F5DB", "#E76F51"], leituraComum: "Laranja e azul alegres.", leituraDiferenciar: "Petróleo com damasco é carinhoso e adulto.", subnichos: ["Pet shop", "Veterinária", "Banho e tosa", "Hotel"] },
  { id: "eventos", nome: "Eventos e festas", contexto: "Vende memória e celebração. A cor precisa de brilho sem parecer barata.", matizes: [300, 80, 20], comum: ["#D4AF37", "#000000", "#FFFFFF", "#C2185B"], diferenciar: ["#1B1B3A", "#F2C14E", "#F78154", "#EDE7E3"], leituraComum: "Dourado, preto e pink de festa.", leituraDiferenciar: "Azul-noite com ouro quente e salmão: festa elegante.", subnichos: ["Casamento", "Corporativo", "Infantil", "Formatura"] },
  { id: "floricultura", nome: "Floricultura e natureza", contexto: "Vende presente e emoção. A foto da flor já tem cor; a marca organiza.", matizes: [140, 350, 100], comum: ["#2E7D32", "#F48FB1", "#FFFFFF", "#FFF59D"], diferenciar: ["#3F4A1F", "#B9A3D0", "#F2A7A0", "#F6F1E7"], leituraComum: "Verde-folha e rosa.", leituraDiferenciar: "Musgo com lilás e rosa-chá: botânico e autoral.", subnichos: ["Floricultura", "Paisagismo", "Produtos naturais"] },
];

export function nichoPorId(id: string | null | undefined): Nicho | null {
  if (!id) return null;
  const alvo = id.toLowerCase();
  return NICHOS.find((n) => n.id === alvo || n.nome.toLowerCase() === alvo) ?? null;
}

/** Acha o nicho pelo texto livre (ex.: "studio de pilates" cai em academia). */
export function nichoPorTexto(texto: string | null | undefined): Nicho | null {
  const t = String(texto ?? "").toLowerCase();
  if (!t) return null;
  const direto = nichoPorId(t);
  if (direto) return direto;
  const PISTAS: Array<[string, string[]]> = [
    ["advocacia", ["advoga", "advoc", "jurid", "direito"]],
    ["saude", ["clinic", "saúde", "saude", "médic", "medic", "fisio", "psico", "nutri"]],
    ["odontologia", ["dent", "odonto", "sorriso"]],
    ["estetica", ["estétic", "estetic", "beleza", "salão", "salao", "cílio", "sobrancel", "spa"]],
    ["confeitaria", ["confeit", "doce", "bolo", "padar"]],
    ["restaurante", ["restaur", "lanch", "pizza", "hamburg", "café", "cafe", "comida", "gastr"]],
    ["academia", ["academ", "pilates", "fitness", "crossfit", "treino", "luta", "yoga"]],
    ["moda", ["moda", "roupa", "vestu", "boutique"]],
    ["imobiliaria", ["imobili", "imóve", "imove", "corret"]],
    ["construcao", ["constru", "engenh", "obra", "reforma"]],
    ["arquitetura", ["arquit", "móve", "move", "interior", "planejad"]],
    ["tecnologia", ["saas", "software", "tecnolog", "app", "startup", " ia"]],
    ["informatica", ["informát", "informat", "computa", "celular", "assistência", "assistencia"]],
    ["servicos", ["ar-cond", "ar cond", "climatiz", "limpeza", "jardin", "manuten", "dedetiz"]],
    ["educacao", ["escola", "curso", "educa", "ensino", "idioma"]],
    ["financeiro", ["financ", "contab", "crédito", "credito", "seguro", "invest"]],
    ["agencia", ["agência", "agencia", "marketing", "social media", "produtora"]],
    ["varejo", ["loja", "e-commerce", "ecommerce", "varejo", "mercado", "keys"]],
    ["pet", ["pet", "veterin", "tosa"]],
    ["eventos", ["evento", "festa", "casament", "buffet"]],
    ["floricultura", ["flor", "planta", "natural", "eco"]],
  ];
  for (const [id, pistas] of PISTAS) if (pistas.some((p) => t.includes(p))) return nichoPorId(id);
  return null;
}
