/** Contratos mutuamente exclusivos: própria biblioteca, prévia ou teste de membro. */
export function modoArquivoValido(corpo: Record<string, unknown>): boolean {
  return (
    !(
      corpo.teste_cliente !== undefined &&
      typeof corpo.teste_cliente !== "boolean"
    ) &&
    !(corpo.bloqueado !== undefined && typeof corpo.bloqueado !== "boolean") &&
    !(corpo.bloqueado === true && corpo.teste_cliente !== true) &&
    !(corpo.teste_cliente === true && corpo.previa_usuario !== undefined)
  );
}
