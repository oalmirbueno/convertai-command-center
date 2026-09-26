import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AjudaRecolhida, botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import logo640 from "@/assets/logo-aceleriq-640.png";
import logo256 from "@/assets/logo-aceleriq-256.png";

/**
 * Peças das páginas públicas e de entrada (login, primeiro acesso, nova
 * senha, consentimento, descadastro, inbox e diagnóstico). Componente local
 * da frente E6-P: o mesmo esqueleto minimalista em todas (logo, título curto,
 * uma linha, o conteúdo), no padrão do docs/design/SISTEMA.md.
 */

/**
 * Os PNGs do logo são quadrados com muita borda vazia em volta da marca.
 * Aqui a marca é recortada pela caixa medida do desenho (sem a borda), num
 * espaço de tamanho fixo: nada pula quando a imagem termina de baixar.
 */
const RECORTES = {
  grande: { src: logo640, lado: 640, x: 44, y: 233, largura: 542, altura: 164 },
  pequeno: { src: logo256, lado: 256, x: 16, y: 92, largura: 220, altura: 68 },
} as const;

export function MarcaAceleriq({ altura = 28, className = "" }: { altura?: number; className?: string }) {
  const r = altura >= 32 ? RECORTES.grande : RECORTES.pequeno;
  const escala = altura / r.altura;
  const lado = Math.round(r.lado * escala);
  return (
    <span
      className={juntar("relative inline-block shrink-0 overflow-hidden align-middle", className)}
      style={{ width: Math.round(r.largura * escala), height: altura }}
    >
      <img
        src={r.src}
        alt="Aceleriq"
        width={lado}
        height={lado}
        draggable={false}
        style={{ position: "absolute", left: -Math.round(r.x * escala), top: -Math.round(r.y * escala), width: lado, height: lado, maxWidth: "none" }}
      />
    </span>
  );
}

/**
 * Campo das páginas públicas: o `campo` do sistema (36 px), com letra de
 * 16 px no celular para o iPhone não dar zoom ao tocar no campo.
 */
export const campoPublico = campo.replace("text-[13px]", "text-[16px] sm:text-[13px]");
export const campoTextoPublico = campoTexto.replace("text-[13px]", "text-[16px] sm:text-[13px]");

/**
 * Senha com o botão de mostrar/ocultar dentro do campo. Recebe id e aria-*
 * do CampoDeFormulario e repassa ao input (o rótulo continua ligado ao campo).
 */
export const CampoDeSenha = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { mostrar?: boolean; aoAlternar?: () => void }
>(function CampoDeSenha({ mostrar: mostrarDeFora, aoAlternar, className = "", ...resto }, ref) {
  const [mostrarAqui, setMostrarAqui] = useState(false);
  const controlado = typeof mostrarDeFora === "boolean";
  const mostrar = controlado ? !!mostrarDeFora : mostrarAqui;
  const alternar = () => {
    if (aoAlternar) aoAlternar();
    if (!controlado) setMostrarAqui((v) => !v);
  };
  return (
    <div className="relative min-w-0">
      <input ref={ref} {...resto} type={mostrar ? "text" : "password"} className={juntar(campoPublico, "pr-10", className)} />
      <button
        type="button"
        onClick={alternar}
        aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={mostrar}
        className={juntar(botao.icone, "absolute right-0.5 top-1/2 -translate-y-1/2")}
      >
        {mostrar ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
});

const LARGURAS = {
  estreita: "max-w-[400px]",
  media: "max-w-[600px]",
} as const;

/**
 * Esqueleto das páginas públicas: fundo escuro, uma coluna no centro, logo
 * em cima, título curto (explicação no "?"), uma linha de apoio e o conteúdo.
 * Sem caixa em volta. No celular a coluna começa no topo e a página rola
 * normal (o teclado nunca prende o botão); do tablet para cima, `centralizar`
 * põe a coluna no meio da altura.
 */
export default function CascaPublica({
  titulo,
  descricao,
  ajuda,
  aoLadoDaMarca,
  acimaDoTitulo,
  largura = "estreita",
  centralizar = true,
  children,
}: {
  titulo?: ReactNode;
  /** Uma linha, no máximo. */
  descricao?: ReactNode;
  /** Explicação longa, no "?" ao lado do título. */
  ajuda?: ReactNode;
  /** Estado curto na linha do logo (ex.: "Salvo"). */
  aoLadoDaMarca?: ReactNode;
  /** Entre o logo e o título (ex.: progresso do diagnóstico). */
  acimaDoTitulo?: ReactNode;
  largura?: keyof typeof LARGURAS;
  /** Centraliza na altura do tablet para cima (telas curtas de formulário). */
  centralizar?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="dark min-h-screen overflow-x-hidden bg-background text-foreground">
      <main
        className={juntar(
          "mx-auto flex min-h-screen w-full min-w-0 flex-col px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-16",
          centralizar && "sm:justify-center",
          LARGURAS[largura],
        )}
      >
        <div className="mb-8 flex min-w-0 items-center justify-between">
          <MarcaAceleriq altura={28} />
          {aoLadoDaMarca ? <div className="ml-3 min-w-0 truncate text-right">{aoLadoDaMarca}</div> : null}
        </div>
        {acimaDoTitulo}
        {titulo ? (
          <div className="mb-6 min-w-0">
            <div className="flex min-w-0 items-start">
              <h1 className={juntar(texto.tituloPagina, "min-w-0 [overflow-wrap:anywhere]")}>{titulo}</h1>
              {ajuda ? <AjudaRecolhida className="ml-1.5 mt-1">{ajuda}</AjudaRecolhida> : null}
            </div>
            {descricao ? <p className={juntar(texto.corpo, "mt-1 text-muted-foreground [overflow-wrap:anywhere]")}>{descricao}</p> : null}
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
