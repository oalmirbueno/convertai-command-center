import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Carregando, EstadoDeErro, botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import { CANAIS_DA_CONVERSA, listarMensagens, registrarMensagem, type MensagemDoLead } from "@/lib/comercial";

/**
 * A conversa do lead (25/10/2026): o que o Mercúrio e a equipe trocaram com ele, em balões. Entrada à
 * esquerda, saída à direita, com quem escreveu e a hora. A equipe registra à mão o que conversou por fora.
 */

const ROTULO_DO_CANAL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", email: "E-mail", telefone: "Telefone", site: "Site", outro: "Outro" };

const hora = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export function quemEscreveu(m: MensagemDoLead, nomeDoLead: string): string {
  if (m.direcao === "entrada") return nomeDoLead || "Lead";
  if (m.operador_slug) return m.operador_slug === "mercurio" ? "Mercúrio" : m.operador_slug.charAt(0).toUpperCase() + m.operador_slug.slice(1);
  return "Equipe";
}

export default function ConversaDoLead({ leadId, nomeDoLead }: { leadId: string; nomeDoLead: string }) {
  const qc = useQueryClient();
  const chave = ["comercial-conversa", leadId];
  const conversa = useQuery({ queryKey: chave, queryFn: () => listarMensagens(leadId), refetchOnWindowFocus: true });
  const [textoNovo, setTextoNovo] = useState("");
  const [direcao, setDirecao] = useState<"saida" | "entrada">("saida");
  const [canal, setCanal] = useState("whatsapp");
  const [gravando, setGravando] = useState(false);
  const mensagens = conversa.data || [];

  const registrar = async () => {
    setGravando(true);
    try {
      await registrarMensagem({ leadId, direcao, canal, texto: textoNovo });
      setTextoNovo("");
      await qc.invalidateQueries({ queryKey: chave });
      toast.success("Mensagem registrada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar.");
    } finally {
      setGravando(false);
    }
  };

  return (
    <section className="min-w-0 space-y-3" aria-label="Conversa com o lead">
      {conversa.isLoading ? (
        <Carregando linhas={2} />
      ) : conversa.isError ? (
        <EstadoDeErro titulo="Não foi possível ler a conversa." acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void conversa.refetch()}>Tentar de novo</button>} />
      ) : mensagens.length === 0 ? (
        <p className={texto.auxiliar}>Nenhuma mensagem registrada ainda.</p>
      ) : (
        <ol className="min-w-0 space-y-2" aria-label="Mensagens">
          {mensagens.map((m) => (
            <li key={m.id} className={juntar("flex min-w-0", m.direcao === "saida" ? "justify-end" : "justify-start")} data-direcao={m.direcao}>
              <div className={juntar("max-w-[85%] rounded-md px-3 py-2", m.direcao === "saida" ? "bg-primary/10" : "bg-muted")}>
                <p className="whitespace-pre-line break-words text-[13px] leading-5 text-foreground">{m.texto}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {quemEscreveu(m, nomeDoLead)} · {ROTULO_DO_CANAL[m.canal] || m.canal} · {hora(m.enviada_em)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form
        className="min-w-0 space-y-2 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (textoNovo.trim()) void registrar();
        }}
      >
        <div className="flex min-w-0 flex-wrap gap-2">
          <select value={direcao} onChange={(e) => setDirecao(e.target.value as "saida" | "entrada")} className={juntar(campo, "w-auto")} aria-label="Quem mandou">
            <option value="saida">Nós mandamos</option>
            <option value="entrada">O lead mandou</option>
          </select>
          <select value={canal} onChange={(e) => setCanal(e.target.value)} className={juntar(campo, "w-auto")} aria-label="Canal da mensagem">
            {CANAIS_DA_CONVERSA.map((c) => (
              <option key={c} value={c}>
                {ROTULO_DO_CANAL[c]}
              </option>
            ))}
          </select>
        </div>
        <textarea value={textoNovo} onChange={(e) => setTextoNovo(e.target.value)} rows={2} placeholder="Registrar uma mensagem que aconteceu fora do painel" className={juntar(campoTexto, "resize-y")} aria-label="Texto da mensagem" />
        <div className="flex justify-end">
          <button type="submit" disabled={gravando || !textoNovo.trim()} className={botao.secundario}>
            {gravando ? "Registrando…" : "Registrar mensagem"}
          </button>
        </div>
      </form>
    </section>
  );
}
