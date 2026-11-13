import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CircleDashed, RefreshCw } from "lucide-react";
import { conferirDns, diaLegivel, fraseDoErro, type ChecagemDoDominio as Checagem, type DominioDeEmail } from "@/lib/produto/api";
import { AjudaRecolhida, Secao, botao, juntar, lista, texto } from "@/components/sistema";

const ICONE = {
  certo: <CheckCircle2 className="h-4 w-4 text-primary" aria-label="Certo" />,
  atencao: <AlertTriangle className="h-4 w-4 text-warning" aria-label="Atenção" />,
  falta: <CircleDashed className="h-4 w-4 text-destructive" aria-label="Falta" />,
} as const;

/**
 * A saúde do domínio de e-mail: recebimento, envio autorizado, assinatura e
 * política contra falsificação, lidos do DNS público na hora. Serve para o
 * cliente ver que está tudo certo e para a casa conferir a virada.
 */
export default function ChecagemDoDominio({ dominio, aoConferir, detalhado = false }: { dominio: DominioDeEmail; aoConferir: (c: Checagem) => void; detalhado?: boolean }) {
  const [conferindo, setConferindo] = useState(false);
  const c = dominio.checagem;
  const conferir = async () => {
    setConferindo(true);
    try {
      aoConferir(await conferirDns(dominio.id));
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível conferir agora."));
    } finally {
      setConferindo(false);
    }
  };
  return (
    <Secao
      titulo="Saúde do domínio"
      descricao={c ? `${c.pronto ? "Tudo certo" : "Precisa de atenção"} · conferido em ${diaLegivel(c.conferido_em)}` : "Ainda não conferido"}
      ajuda="Quatro registros de DNS decidem se o e-mail chega e se o que a empresa envia não cai no spam. A conferência só lê o DNS público; não muda nada."
      acao={
        <button type="button" className={botao.icone} onClick={() => void conferir()} disabled={conferindo} aria-label="Conferir agora" title="Conferir agora" data-conferir-dns="">
          <RefreshCw className={juntar("h-4 w-4", conferindo && "animate-spin")} aria-hidden="true" />
        </button>
      }
    >
      {c ? (
        <ul className={juntar(lista.aberta, lista.divisoria)} data-checagem-do-dominio="">
          {c.itens.map((i) => (
            <li key={i.chave} className={juntar(lista.linha, "items-start")} data-item-da-checagem={i.chave} data-estado={i.estado}>
              <span className="mr-3 mt-0.5 shrink-0">{ICONE[i.estado]}</span>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block font-medium")}>{i.titulo}</span>
                <span className={juntar(texto.auxiliar, "block leading-5")}>{i.explicacao}</span>
                {detalhado && (
                  <span className={juntar(texto.auxiliar, "mt-1 block break-all font-mono leading-5")}>
                    {i.achado.length ? i.achado.join(" | ") : "nada publicado"}
                    {i.estado !== "certo" ? <span className="block text-foreground">Esperado: {i.esperado}</span> : null}
                  </span>
                )}
              </span>
              {!detalhado && i.estado !== "certo" && (
                <AjudaRecolhida rotulo={`O que falta em ${i.titulo}`} className="ml-2">
                  Esperado: {i.esperado}
                </AjudaRecolhida>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <button type="button" className={botao.secundario} onClick={() => void conferir()} disabled={conferindo}>
          {conferindo ? "Conferindo..." : "Conferir o domínio"}
        </button>
      )}
    </Secao>
  );
}
