import { modoArquivoValido } from "./modo.ts";
const conferir = (v: boolean) => {
  if (!v) throw new Error("Contrato de acesso incorreto");
};
Deno.test("não mistura teste próprio com identidade da prévia", () => {
  conferir(
    !modoArquivoValido({ teste_cliente: true, previa_usuario: "outra-pessoa" }),
  );
  conferir(modoArquivoValido({ previa_usuario: "outra-pessoa" }));
});
Deno.test(
  "não aceita coerção de texto ou número nos controles de acesso",
  () => {
    for (const v of ["true", "false", 1, 0, null, {}, []]) {
      conferir(!modoArquivoValido({ teste_cliente: v }));
      conferir(!modoArquivoValido({ teste_cliente: true, bloqueado: v }));
    }
  },
);
Deno.test("bloqueio só pode acompanhar o modo de teste", () => {
  conferir(!modoArquivoValido({ bloqueado: true }));
  conferir(!modoArquivoValido({ teste_cliente: false, bloqueado: true }));
  conferir(modoArquivoValido({ teste_cliente: true, bloqueado: true }));
  conferir(modoArquivoValido({ teste_cliente: true, bloqueado: false }));
  conferir(modoArquivoValido({}));
});
