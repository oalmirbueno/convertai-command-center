import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle,
  Pin,
  EyeOff,
  Pencil,
  Send,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  carregarComunidade,
  salvarConversa,
  type Conversa,
} from "@/lib/membros/aprendizado";
import { mensagemDoErro } from "@/lib/membros/api";
import type { TesteCliente } from "@/lib/membros/modelo";
export default function ComunidadeDoCurso({
  produto,
  teste,
  previa,
}: {
  produto: string;
  teste?: TesteCliente;
  previa?: string;
}) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [editando, setEditando] = useState<Conversa | null>(null);
  const [resposta, setResposta] = useState<Conversa | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const leitura = !!teste || !!previa;
  const admin = profile?.role === "admin" && !leitura;
  const chave = [
    "membros",
    "comunidade",
    user?.id,
    produto,
    teste?.teste,
    teste?.bloqueado,
    previa,
  ];
  const dados = useQuery({
    queryKey: chave,
    queryFn: () => carregarComunidade(produto, teste, previa),
    retry: false,
    refetchInterval: 30000,
  });
  async function agir(
    t: string,
    id?: string,
    r?: string,
    oculto = false,
    fixado = false,
  ) {
    if (leitura) return;
    setOcupado(true);
    setErro("");
    try {
      await salvarConversa(produto, t, id, r, oculto, fixado);
      setTexto("");
      setResposta(null);
      setEditando(null);
      await qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }
  const conversas = dados.data || [];
  const raiz = conversas.filter(
    (c) => !c.resposta_a || !conversas.some((p) => p.id === c.resposta_a),
  );
  function cartao(c: Conversa, filha = false) {
    return (
      <article
        key={c.id}
        className={`membros-conversa ${filha ? "membros-resposta" : ""} ${c.oculto ? "opacity-60" : ""}`}
      >
        <div className="flex items-center justify-between gap-2">
          <strong className="text-[13px]">{c.autor_nome}</strong>
          <time
            className="text-[11px] text-muted-foreground"
            dateTime={c.criado_em}
          >
            {new Date(c.criado_em).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        {c.fixado && (
          <span className="text-[11px] text-primary inline-flex items-center gap-1 mt-1">
            <Pin size={12} />
            Recado fixado
          </span>
        )}
        {c.oculto && (
          <span className="text-[11px] ml-2">Oculto para membros</span>
        )}
        <p className="text-[13px] leading-6 whitespace-pre-wrap break-words mt-3">
          {c.texto}
        </p>
        {!leitura && (
          <div className="flex flex-wrap gap-1 mt-2">
            {!filha && (
              <button
                className="membros-acao text-muted-foreground"
                onClick={() => {
                  setResposta(c);
                  setEditando(null);
                  setTexto("");
                }}
              >
                Responder
              </button>
            )}
            {c.autor_id === user?.id && (
              <button
                className="membros-acao text-muted-foreground"
                onClick={() => {
                  setEditando(c);
                  setResposta(null);
                  setTexto(c.texto);
                }}
              >
                <Pencil size={13} />
                Editar
              </button>
            )}
            {admin && (
              <>
                <button
                  className="membros-acao text-muted-foreground"
                  disabled={ocupado}
                  onClick={() =>
                    void agir(c.texto, c.id, undefined, c.oculto, !c.fixado)
                  }
                >
                  <Pin size={13} />
                  {c.fixado ? "Desafixar" : "Fixar"}
                </button>
                <button
                  className="membros-acao text-muted-foreground"
                  disabled={ocupado}
                  onClick={() =>
                    void agir(c.texto, c.id, undefined, !c.oculto, c.fixado)
                  }
                >
                  <EyeOff size={13} />
                  {c.oculto ? "Mostrar" : "Ocultar"}
                </button>
              </>
            )}
          </div>
        )}
      </article>
    );
  }
  return (
    <section className="membros-comunidade" aria-label="Comunidade do curso">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-semibold flex items-center gap-2">
            <MessageCircle size={19} className="text-primary" />
            Comunidade
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            Converse com quem estuda este produto.
          </p>
        </div>
        <button
          className="membros-acao"
          aria-label="Atualizar comunidade"
          onClick={() => void dados.refetch()}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      {leitura ? (
        <p className="text-[12px] rounded-lg bg-muted p-3">
          Nesta visualização você acompanha a comunidade sem publicar mensagens.
        </p>
      ) : (
        <form
          className="membros-conversa"
          onSubmit={(e) => {
            e.preventDefault();
            void agir(
              texto,
              editando?.id,
              resposta?.id,
              editando?.oculto,
              editando?.fixado,
            );
          }}
        >
          {(editando || resposta) && (
            <div className="flex items-center justify-between gap-2 text-[12px] mb-2">
              <span>
                {editando
                  ? "Editar sua mensagem"
                  : `Responder a ${resposta?.autor_nome}`}
              </span>
              <button
                type="button"
                className="membros-acao"
                onClick={() => {
                  setEditando(null);
                  setResposta(null);
                  setTexto("");
                }}
              >
                Cancelar
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor={`mensagem-${produto}`}>
            Sua mensagem para a comunidade
          </label>
          <textarea
            id={`mensagem-${produto}`}
            maxLength={5000}
            required
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Compartilhe uma dúvida ou um aprendizado"
            className="membros-campo min-h-24"
          />
          <div className="flex justify-end mt-2">
            <button
              className="membros-acao bg-primary text-primary-foreground"
              disabled={ocupado || !texto.trim()}
            >
              <Send size={15} />
              {ocupado
                ? "Salvando…"
                : editando
                  ? "Salvar mensagem"
                  : "Publicar"}
            </button>
          </div>
        </form>
      )}
      {erro && (
        <p role="alert" className="text-[13px] text-destructive">
          {erro}
        </p>
      )}
      {dados.isPending ? (
        <p role="status" className="text-[13px]">
          Carregando conversas…
        </p>
      ) : dados.isError ? (
        <div role="alert" className="text-[13px]">
          {mensagemDoErro(dados.error)}
        </div>
      ) : !raiz.length ? (
        <p className="text-[13px] py-6 text-muted-foreground">
          As primeiras conversas deste curso aparecerão aqui.
        </p>
      ) : (
        raiz.map((c) => (
          <div key={c.id}>
            {cartao(c)}
            {conversas
              .filter((r) => r.resposta_a === c.id)
              .reverse()
              .map((r) => cartao(r, true))}
          </div>
        ))
      )}
    </section>
  );
}
