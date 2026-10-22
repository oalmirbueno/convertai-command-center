/**
 * Tom da campanha (22/10/2026, dono: "a campanha tem que ser algo mais comercial, unir a ideia do tema ao
 * comercial; está muito educativo; tem que ser algo já pra ação; produtos chamar de elixir etc.").
 * A regra entra na raiz: criação, conteúdos, conversa e mudança do agente (agente-calendario), texto das peças
 * (estudio-arte) e stories e selo (pela tela). Puro e curto (o _shared está perto do teto de 4 MB). Safari 11.
 */

export type TomDaCampanha = "comercial_direto" | "comercial_criativo" | "institucional";
export const TONS_DA_CAMPANHA: TomDaCampanha[] = ["comercial_direto", "comercial_criativo", "institucional"];
export const TOM_PADRAO: TomDaCampanha = "comercial_direto";
export const ROTULO_DO_TOM: Record<TomDaCampanha, string> = { comercial_direto: "Comercial direto", comercial_criativo: "Comercial criativo", institucional: "Institucional" };
export const DICA_DO_TOM: Record<TomDaCampanha, string> = {
  comercial_direto: "Oferta e ação em toda peça: problema, solução, oferta e CTA com prazo.",
  comercial_criativo: "O mesmo comercial, com mais brincadeira de conceito no tema.",
  institucional: "Marca e valor na frente; a oferta aparece, mas com CTA leve.",
};
export const OFERTA_A_DEFINIR = "[OFERTA A DEFINIR]";

export const tomDaCampanha = (v: unknown): TomDaCampanha => (TONS_DA_CAMPANHA.indexOf(v as TomDaCampanha) >= 0 ? (v as TomDaCampanha) : TOM_PADRAO);

export type NichoRegulado = "juridico" | "saude" | "financeiro";

/** Nicho que pede comercial dentro da regra (pelo segmento ou pelo texto do cliente). */
export function nichoRegulado(texto: unknown): NichoRegulado | null {
  const t = String(texto || "").toLowerCase();
  if (/advoca|advogad|juridic|jurídic|escritorio de direito|escritório de direito|\boab\b/.test(t)) return "juridico";
  if (/medic|médic|clinic|clínic|saude|saúde|odonto|dentist|psicolog|psicólog|nutricion|fisioterap|farmac|farmác|hospital/.test(t)) return "saude";
  if (/investiment|corretora|consorcio|consórcio|credito|crédito|financeira/.test(t)) return "financeiro";
  return null;
}

/** Há oferta informada pela equipe (oferta do briefing ou preço de um produto)? */
export function ofertaInformada(b: { oferta?: unknown; produtos?: Array<{ preco?: unknown; preco_promocional?: unknown }> } | null | undefined): boolean {
  if (!b) return false;
  const oferta = String(b.oferta || "").trim().toLowerCase();
  const temOferta = !!oferta && oferta.indexOf("sem oferta") < 0 && oferta.indexOf("a definir") < 0;
  return temOferta || (b.produtos || []).some((p) => !!String(p.preco_promocional || p.preco || "").trim());
}

const REGRA_DO_NICHO: Record<NichoRegulado, string> = {
  juridico: "Nicho regulado (advocacia, regras da OAB): comercial dentro da regra. Convide para a consulta ou a avaliação do caso, informe e mostre autoridade; nunca venda o serviço como produto, sem preço promocional, sem promessa de resultado nem de causa ganha.",
  saude: "Nicho regulado (saúde): sem promessa de cura, resultado garantido ou antes e depois; convide para a avaliação ou a consulta; condição comercial só a informada.",
  financeiro: "Nicho regulado (finanças): sem promessa de rendimento ou aprovação garantida; convide para a simulação ou a conversa; condições só as informadas.",
};

/** O bloco do prompt com o tom (estrategista e agente). Mais agressiva = sobe o comercial e a urgência. */
export function blocoDoTomDaCampanha(tom: TomDaCampanha, opcoes: { nicho?: NichoRegulado | null; temOferta?: boolean } = {}): string {
  const linhas = [`TOM DA CAMPANHA: ${ROTULO_DO_TOM[tom]}. ${DICA_DO_TOM[tom]}`];
  if (tom !== "institucional") {
    linhas.push(
      "- Linguagem de CAMPANHA, não de conteúdo educativo: o tema da data é o gancho criativo de uma OFERTA ou AÇÃO (ex.: \"Halloween: seu PC está assombrado? Exorcismo de vírus por R$ 89 até 31/10\").",
      "- Nome da campanha e dos produtos com conceito puxando o tema (ex.: Elixir de desempenho, Poção anti-lentidão, Kit Ressurreição).",
      "- Toda peça: problema do cliente, solução, oferta ou benefício e CTA de ação direta (chamar no WhatsApp, agendar, garantir, levar), com a urgência real da janela (prazo, vagas, enquanto durar).",
      "- Educativo só como apoio: no máximo 1 peça de prova ou dica por fase, e ela também fecha com CTA de ação.",
      "- Por fase: aquecimento = desejo e curiosidade com a oferta anunciada; lançamento = oferta clara; urgência = prazo e escassez; encerramento = última chamada.",
    );
    if (tom === "comercial_criativo") linhas.push("- Brinque mais com o conceito do tema (nomes, metáforas, trocadilhos), sem esconder a oferta nem o CTA.");
  } else {
    linhas.push("- Marca, valor e confiança na frente; a oferta aparece de forma elegante e o CTA é leve (conhecer, conversar, agendar).");
  }
  linhas.push(
    `- Sem promessa falsa: preço, desconto e prazo só os do briefing e dos produtos.${opcoes.temOferta === false ? ` A equipe ainda não informou a oferta: onde ela entraria, escreva ${OFERTA_A_DEFINIR} (nunca invente número) e diga na resposta que falta definir a oferta.` : ""}`,
    "- Nunca prometa resultado que o nicho não pode garantir.",
    "- Pedido de \"mais agressiva\" (ou parecido) sobe o tom comercial e a urgência; \"mais leve\" desce.",
  );
  if (opcoes.nicho) linhas.push(`- ${REGRA_DO_NICHO[opcoes.nicho]}`);
  return linhas.join("\n");
}

/** Uma linha do tom para o texto das peças (diretor do Estúdio, stories e selo). */
export function linhaDoTomParaAPeca(tom: TomDaCampanha, nicho: NichoRegulado | null = null): string {
  const base = tom === "institucional"
    ? "Tom institucional: marca e valor na frente, CTA leve."
    : "Tom de campanha comercial: a peça vende (problema, solução, oferta e CTA de ação direta com o prazo), o tema é o gancho criativo, nada de tom de aula.";
  return nicho ? `${base} ${REGRA_DO_NICHO[nicho]}` : base;
}
