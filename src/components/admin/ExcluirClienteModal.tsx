import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { JanelaCentral, botao, campo, juntar, texto } from "@/components/sistema";
import { excluirCliente, inativarCliente, nomeConfere, oQueVaiSumir } from "@/lib/clientes/excluirCliente";

/**
 * Janela de excluir cliente (26/11/2026). Mostra o que some junto, oferece Inativar (guarda o histórico e o
 * Financeiro) e só exclui com o nome do cliente digitado. Usada na lista de Clientes e no cadastro.
 */
export default function ExcluirClienteModal({
  cliente,
  aoFechar,
  aoExcluir,
}: {
  cliente: { id: string; nome: string; plan_status?: string | null } | null;
  aoFechar: () => void;
  aoExcluir?: () => void;
}) {
  const queryClient = useQueryClient();
  const [digitado, setDigitado] = useState("");
  const [ocupado, setOcupado] = useState<"excluir" | "inativar" | null>(null);
  useEffect(() => setDigitado(""), [cliente?.id]);

  const resumo = useQuery({
    queryKey: ["clientes", "excluir", "resumo", cliente?.id],
    queryFn: () => oQueVaiSumir(cliente!.id),
    enabled: !!cliente,
    staleTime: 0,
  });

  if (!cliente) return null;
  const pode = nomeConfere(digitado, cliente.nome) && !ocupado;
  const jaInativo = cliente.plan_status === "inactive";
  const r = resumo.data;

  const atualizarListas = () => {
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
    void queryClient.invalidateQueries({ queryKey: ["billing"] });
  };

  const excluir = async () => {
    if (!pode) return;
    setOcupado("excluir");
    try {
      await excluirCliente(cliente.id);
      toast.success(`${cliente.nome} foi excluído.`);
      atualizarListas();
      aoExcluir?.();
      aoFechar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível excluir o cliente.");
    } finally {
      setOcupado(null);
    }
  };

  const inativar = async () => {
    setOcupado("inativar");
    try {
      await inativarCliente(cliente.id);
      toast.success(`${cliente.nome} foi para Inativos. O histórico e o Financeiro ficam guardados.`);
      atualizarListas();
      aoFechar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível inativar o cliente.");
    } finally {
      setOcupado(null);
    }
  };

  const linhas: Array<[string, number]> = r
    ? [
        ["projetos", r.projetos],
        ["arquivos", r.arquivos],
        ["posts da Agenda", r.posts],
        ["cobranças", r.cobrancas],
      ]
    : [];

  return (
    <JanelaCentral
      aberta
      onFechar={() => !ocupado && aoFechar()}
      titulo={`Excluir ${cliente.nome}`}
      descricao="Definitivo: não tem como desfazer."
      largura="sm"
      rodape={
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end [&>*]:mb-1 [&>*+*]:ml-2">
          <button type="button" onClick={aoFechar} disabled={!!ocupado} className={botao.secundario}>
            Cancelar
          </button>
          {!jaInativo && (
            <button type="button" onClick={() => void inativar()} disabled={!!ocupado} className={botao.secundario}>
              {ocupado === "inativar" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Inativar
            </button>
          )}
          <button type="button" onClick={() => void excluir()} disabled={!pode} className={juntar(botao.perigo, "disabled:opacity-50")}>
            {ocupado === "excluir" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Excluir de vez
          </button>
        </div>
      }
    >
      <div className="min-w-0 [&>*+*]:mt-4">
        <div>
          <p className={texto.corpo}>Some junto com o cliente:</p>
          {resumo.isLoading ? (
            <p className={juntar(texto.auxiliar, "mt-2")}>Contando...</p>
          ) : resumo.isError ? (
            <p className={juntar(texto.auxiliar, "mt-2")}>Não deu para contar agora. Exclua só se tiver certeza.</p>
          ) : (
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {linhas.map(([rotulo, n]) => (
                <li key={rotulo} className="rounded-md bg-muted/60 px-3 py-2">
                  <span className="block text-lg font-semibold tabular-nums text-foreground">{n}</span>
                  <span className={texto.auxiliar}>{rotulo}</span>
                </li>
              ))}
            </ul>
          )}
          {r && r.cobrancasPagas > 0 && (
            <p className={juntar(texto.auxiliar, "mt-2 text-destructive")}>
              {r.cobrancasPagas === 1 ? "1 cobrança paga sai" : `${r.cobrancasPagas} cobranças pagas saem`} do Financeiro: os recebidos dos meses passados diminuem.
            </p>
          )}
        </div>
        {!jaInativo && (
          <p className={texto.auxiliar}>
            Só quer tirar da lista? Use Inativar: o cliente vai para a aba Inativos, sai do ciclo e das cobranças novas, e o histórico fica guardado.
          </p>
        )}
        <label className="block">
          <span className={texto.corpo}>
            Para excluir, digite <strong className="font-semibold text-foreground">{cliente.nome}</strong>
          </span>
          <input
            type="text"
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void excluir();
            }}
            autoComplete="off"
            className={juntar(campo, "mt-2 w-full")}
            aria-label="Nome do cliente para confirmar a exclusão"
          />
        </label>
      </div>
    </JanelaCentral>
  );
}
