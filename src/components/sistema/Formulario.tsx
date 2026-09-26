import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import AjudaRecolhida from "./AjudaRecolhida";
import { juntar, texto } from "./estilos";

/**
 * Campo de formulário: rótulo EM CIMA, o controle (altura única, estilos.campo),
 * uma linha de apoio embaixo e o erro no lugar dela. Liga rótulo, apoio e erro
 * ao controle (id, aria-describedby, aria-invalid) sozinho.
 */
export function CampoDeFormulario({
  rotulo,
  apoio,
  erro,
  ajuda,
  obrigatorio = false,
  largo = false,
  className = "",
  children,
}: {
  rotulo: ReactNode;
  /** Uma linha curta embaixo do campo. */
  apoio?: ReactNode;
  /** Mensagem de erro (substitui o apoio). */
  erro?: ReactNode;
  /** Ajuda longa, recolhida no "?" ao lado do rótulo. */
  ajuda?: ReactNode;
  obrigatorio?: boolean;
  /** Ocupa a linha inteira do GrupoDeCampos. */
  largo?: boolean;
  className?: string;
  /** O controle (input, select, textarea ou componente que aceite id). */
  children: ReactNode;
}) {
  const base = useId();
  const filho = isValidElement(children) ? (children as ReactElement<any>) : null;
  const id = (filho && filho.props && filho.props.id) || `${base}-campo`;
  const idApoio = `${base}-apoio`;
  const descrito = erro || apoio ? idApoio : undefined;
  const controle = filho
    ? cloneElement(filho, {
        id,
        "aria-describedby": juntar(filho.props["aria-describedby"], descrito) || undefined,
        "aria-invalid": erro ? true : filho.props["aria-invalid"],
        "aria-required": obrigatorio || filho.props["aria-required"] || undefined,
      })
    : children;
  return (
    <div className={juntar("min-w-0", largo && "sm:col-span-full", className)}>
      <div className="mb-1.5 flex min-w-0 items-center">
        <label htmlFor={id} className={juntar(texto.rotulo, "min-w-0 truncate")}>
          {rotulo}
          {obrigatorio && (
            <span className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {ajuda && <AjudaRecolhida className="ml-1">{ajuda}</AjudaRecolhida>}
      </div>
      {controle}
      {(erro || apoio) && (
        <p id={idApoio} className={juntar("mt-1.5 text-[12px] leading-4", erro ? "text-destructive" : "text-muted-foreground")} role={erro ? "alert" : undefined}>
          {erro || apoio}
        </p>
      )}
    </div>
  );
}

/**
 * Grupo de campos: grade de 2 colunas no computador e 1 no celular (3 com
 * `colunas={3}` a partir de 1024 px). Título opcional como legenda.
 */
export function GrupoDeCampos({
  titulo,
  descricao,
  colunas = 2,
  className = "",
  children,
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  colunas?: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  const grade = colunas === 1 ? "grid-cols-1" : colunas === 3 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2";
  return (
    <fieldset className={juntar("min-w-0 border-0 p-0", className)}>
      {titulo && <legend className={juntar(texto.tituloSecao, "mb-0.5 p-0")}>{titulo}</legend>}
      {descricao && <p className={juntar(texto.auxiliar, "mb-3")}>{descricao}</p>}
      <div className={juntar("grid min-w-0 gap-x-4 gap-y-4", grade, titulo && !descricao && "mt-3")}>{children}</div>
    </fieldset>
  );
}

/**
 * Rótulo em cima de um controle que não é campo de texto (pílulas, segmentado,
 * miniaturas): o mesmo visual do CampoDeFormulario. Promovido em 26/09 (frente C) das cópias da Mesa Foto (Modelos,
 * Clones, Book).
 */
export function CampoDeEscolha({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={juntar("min-w-0", className)}>
      <p className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</p>
      {children}
    </div>
  );
}
