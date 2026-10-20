import { AjudaRecolhida } from "@/components/sistema";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
const banco = supabase as unknown as SupabaseClient;
const campo =
  "w-full min-h-11 rounded-lg bg-muted px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
const erros: Record<string, string> = {
  credenciais_invalidas: "Confira os três campos da conexão.",
  credenciais_recusadas: "A Kiwify não aceitou estas credenciais.",
  permissoes_insuficientes:
    "Ative as permissões de leitura de vendas e estatísticas na credencial Kiwify.",
  conta_nao_confirmada: "O identificador da conta não corresponde à conexão.",
  venda_nao_confirmada:
    "Não foi possível confirmar esta venda na conta configurada.",
  pedido_invalido: "Confira o identificador da venda.",
  configuracao_pendente: "Cadastre a conexão primeiro.",
  configuracao_nao_salva:
    "Não foi possível guardar a configuração. Tente novamente.",
};
export default function ConfiguracaoKiwify() {
  const qc = useQueryClient();
  const [v, setV] = useState({
    client_id: "",
    client_secret: "",
    account_id: "",
  });
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [pedido, setPedido] = useState("");
  const estado = useQuery({
    queryKey: ["membros", "kiwify-configuracao"],
    queryFn: async () => {
      const r = await banco.rpc("membros_kiwify_estado");
      if (r.error) throw r.error;
      return r.data as {
        configurada: boolean;
        nome?: string;
        verificado_em?: string;
        automatico: false;
      };
    },
    retry: false,
  });
  async function agir(acao: "salvar" | "conferir") {
    setOcupado(true);
    setAviso("");
    setErro("");
    try {
      const r = await supabase.functions.invoke("area-membros-kiwify", {
        body: {
          acao,
          ...(acao === "salvar" ? v : { pedido: pedido || undefined }),
        },
      });
      let d = r.data;
      if (r.error) {
        try {
          d = await r.error.context?.json();
        } catch {
          /* A interface usa uma mensagem própria se a resposta não for JSON. */
        }
        throw Error(d?.erro || "conexao_indisponivel");
      }
      if (!d?.ok) throw Error(d?.erro || "conexao_indisponivel");
      setV({ client_id: "", client_secret: "", account_id: "" });
      await qc.invalidateQueries({ queryKey: ["membros"] });
      setAviso(
        d.pedido
          ? `Venda conferida: ${d.estado === "paid" ? "pagamento confirmado" : d.estado === "refunded" ? "reembolsada" : "em conferência"}. Produto Kiwify: ${d.produto}. Nenhum acesso foi liberado.`
          : "Conexão conferida. A liberação automática continua desligada.",
      );
    } catch (e) {
      setErro(
        erros[e instanceof Error ? e.message : ""] ||
          "A conexão não respondeu. Tente novamente.",
      );
    } finally {
      setOcupado(false);
    }
  }
  return (
    <details className="membros-caixa mb-5">
      <summary>
        Conexão Kiwify ·{" "}
        {estado.data?.configurada
          ? "Configurada, liberação desligada"
          : "Preparada para configurar"}
      </summary>
      <div className="space-y-4 pt-4">
        <AjudaRecolhida rotulo="Mais informações">
          Quando quiser configurar, crie uma credencial na Kiwify com leitura de
          vendas e estatísticas. Os dados ficam no cofre do servidor. Salvar a
          conexão não ativa pagamentos.
        </AjudaRecolhida>
        <a
          href="https://ajuda.kiwify.com.br/pt-br/article/como-funciona-a-api-da-kiwify-1iosjhu/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] text-primary underline"
        >
          Como criar a credencial na Kiwify
        </a>
        {estado.isError && (
          <p role="alert" className="text-[12px]">
            Não foi possível conferir a configuração.
          </p>
        )}
        <form
          className="grid sm:grid-cols-3 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void agir("salvar");
          }}
        >
          {(
            [
              { k: "client_id", nome: "Identificador da API (Client ID)" },
              { k: "client_secret", nome: "Segredo da API (Client secret)" },
              { k: "account_id", nome: "Identificador da conta (Account ID)" },
            ] as const
          ).map((c) => (
            <label key={c.k} className="block text-[12px] space-y-2">
              <span>{c.nome}</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                maxLength={1024}
                className={campo}
                value={v[c.k]}
                onChange={(e) => setV({ ...v, [c.k]: e.target.value })}
              />
            </label>
          ))}
          <button
            className="membros-acao bg-primary text-primary-foreground justify-self-start sm:col-span-3"
            disabled={ocupado}
          >
            {ocupado ? "Conferindo…" : "Testar e guardar conexão"}
          </button>
        </form>
        {estado.data?.configurada && (
          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-[12px]">
              Conta: {estado.data.nome} · Conferida em{" "}
              {estado.data.verificado_em
                ? new Date(estado.data.verificado_em).toLocaleString("pt-BR")
                : ""}
            </p>
            <label className="block max-w-md text-[12px] space-y-2">
              Conferir uma venda (opcional)
              <input
                className={campo}
                value={pedido}
                maxLength={100}
                onChange={(e) => setPedido(e.target.value)}
                placeholder="Identificador da venda Kiwify"
              />
            </label>
            <button
              className="membros-acao border border-border"
              disabled={ocupado}
              onClick={() => void agir("conferir")}
            >
              Conferir conexão{pedido ? " e venda" : ""}
            </button>
          </div>
        )}
        {erro && (
          <p role="alert" className="text-[13px] text-destructive">
            {erro}
          </p>
        )}
        {aviso && (
          <p role="status" className="text-[13px] text-primary">
            {aviso}
          </p>
        )}
      </div>
    </details>
  );
}
