type Resultado = { ok?: boolean; motivo?: string; aviso?: string };
type Recibo = {
  executada_em?: unknown; desfeita_em?: unknown;
  resultados?: Resultado[]; refeitos?: Resultado[]; mudancas?: Resultado[];
  formatos?: Resultado[]; campanhas_editadas?: Resultado[]; textos?: Resultado[];
};

/** A fala de conclusão vem da execução persistida, nunca da promessa do modelo. */
export function resumoDoRecibo(a: Recibo | null | undefined): string | null {
  if (!a?.executada_em || a.desfeita_em) return null;
  const grupos = [
    [a.resultados, "conteúdo removido", "conteúdos removidos"],
    [a.refeitos, "conteúdo separado para refazer", "conteúdos separados para refazer"],
    [a.mudancas, "data atualizada", "datas atualizadas"],
    [a.formatos, "formato atualizado", "formatos atualizados"],
    [a.campanhas_editadas, "campanha atualizada", "campanhas atualizadas"],
    [a.textos, "conteúdo reescrito", "conteúdos reescritos"],
  ] as const;
  const partes: string[] = [];
  const falhas: Resultado[] = [];
  for (const [lista, um, varios] of grupos) {
    const n = (lista || []).filter(r => r.ok === true).length;
    if (n) partes.push(`${n} ${n === 1 ? um : varios}`);
    falhas.push(...(lista || []).filter(r => r.ok !== true));
  }
  const avisos = [...new Set(grupos.flatMap(([lista]) => (lista || []).map(r => r.aviso).filter(Boolean)))];
  const feito = partes.length ? `Salvo na agenda: ${partes.join(", ")}.` : "Nenhuma alteração foi confirmada na agenda.";
  const motivos = [...new Set(falhas.map(r => r.motivo).filter(Boolean))].slice(0, 3);
  return `${feito}${falhas.length ? ` ${falhas.length} alteração(ões) não concluída(s). ${motivos.join(" ")}` : ""} ${avisos.join(" ")} Confira o resultado por item no cartão.${partes.length ? " Você pode desfazer." : ""}${a.refeitos?.some(r => r.ok) ? " A nova geração ainda precisa ser concluída no cartão." : ""}`;
}
