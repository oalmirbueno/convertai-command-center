import { useEffect, useRef } from "react";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { botao, juntar } from "./estilos";

/**
 * "Nova conversa" com volta (frente UXS, 30/09). O botão vira ícone (o título
 * do agente volta a caber na lateral de 320 px) e o clique não perde nada: a
 * conversa de antes fica guardada e o aviso "Conversa nova" traz "Voltar à
 * anterior", sem pedir confirmação.
 *
 * A cópia guardada vale só para o mesmo contexto (cliente, site, filme,
 * contrato ou campanha, a `chave`) e só enquanto nada novo foi enviado: um
 * envio que começa, ou a troca de contexto, apaga a cópia. Voltar devolve as
 * mensagens E o id da conversa (o próximo envio continua a de antes).
 */

export interface ConversaGuardada<T> {
  mensagens: T[];
  conversaId: string | null;
}

/** Mensagem que volta da cópia não é "recém-chegada": o "faz e me leva" não abre sozinho de novo. */
function semMarcaDeNova<T>(m: T): T {
  if (m && typeof m === "object" && "nova" in (m as Record<string, unknown>)) return { ...(m as Record<string, unknown>), nova: false } as T;
  return m;
}

export function useNovaConversa<T>({
  chave,
  enviando,
  mensagens,
  conversaId,
  limpar,
  restaurar,
}: {
  /** O contexto da conversa (ex.: `${clientId}:${site.id}`). */
  chave: string;
  enviando: boolean;
  mensagens: T[];
  conversaId: string | null;
  /** Zera a tela e marca a próxima mensagem como conversa nova. */
  limpar: () => void;
  /** Devolve a conversa de antes e desmarca a conversa nova. */
  restaurar: (c: ConversaGuardada<T>) => void;
}): () => void {
  const copia = useRef<{ chave: string; conversa: ConversaGuardada<T> } | null>(null);
  const chaveAtual = useRef(chave);
  chaveAtual.current = chave;
  const acoes = useRef({ limpar, restaurar });
  acoes.current = { limpar, restaurar };

  // Outro contexto: a conversa guardada não é daqui.
  useEffect(() => {
    if (copia.current && copia.current.chave !== chave) copia.current = null;
  }, [chave]);
  // Um envio começou: a conversa nova já tem pedido; voltar perderia o que foi mandado.
  useEffect(() => {
    if (enviando) copia.current = null;
  }, [enviando]);

  return () => {
    if (enviando) return;
    const guardada = { chave, conversa: { mensagens: mensagens.map(semMarcaDeNova), conversaId } };
    copia.current = guardada;
    acoes.current.limpar();
    toast.info("Conversa nova", {
      action: {
        label: "Voltar à anterior",
        onClick: () => {
          const c = copia.current;
          if (!c || c !== guardada || c.chave !== chaveAtual.current) return;
          copia.current = null;
          acoes.current.restaurar(c.conversa);
        },
      },
    });
  };
}

/** O ícone de "Nova conversa" no cabeçalho do agente (desligado enquanto uma mensagem vai). */
export function BotaoNovaConversa({ onClick, desativado = false }: { onClick: () => void; desativado?: boolean }) {
  return (
    <button type="button" className={juntar(botao.icone, "disabled:pointer-events-none disabled:opacity-50")} onClick={onClick} disabled={desativado} aria-label="Nova conversa" title="Nova conversa" data-nova-conversa="">
      <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
