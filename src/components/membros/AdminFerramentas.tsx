import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench, Eye, ShieldCheck } from "lucide-react";
import { AjudaRecolhida } from "@/components/sistema";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import {
  carregarAdminFerramentas,
  configurarFerramenta,
  licenciarTeste,
  revogarLicenca,
  atenderExclusaoCrm,
  prepararUpgradeMensal,
  type AdminFerramentas as DadosFerramentas,
  type FerramentaMembro,
} from "@/lib/membros/ferramentas";
import { mensagemDoErro, type DadosAdmin } from "@/lib/membros/api";
import { QuadroCrm } from "./CrmDoMembro";
export default function AdminFerramentas({ dados }: { dados: DadosAdmin }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [produto, setProduto] = useState("");
  const [usuario, setUsuario] = useState("");
  const [motor, setMotor] = useState<FerramentaMembro["motor"]>("crm");
  const [ativo, setAtivo] = useState(false);
  const [mensal, setMensal] = useState({ nome: "", recursos: "" });
  const [ver, setVer] = useState<{ usuario: string; produto: string } | null>(
    null,
  );
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [exclusao, setExclusao] = useState<
    DadosFerramentas["exclusoes"][number] | null
  >(null);
  const admin = useQuery({
    queryKey: [
      "membros",
      "ferramentas-admin",
      user?.id,
      ver?.usuario,
      ver?.produto,
    ],
    queryFn: () => carregarAdminFerramentas(ver?.usuario, ver?.produto),
    retry: false,
  });
  async function agir(f: () => Promise<unknown>) {
    setOcupado(true);
    setAviso("");
    try {
      await f();
      await qc.invalidateQueries({ queryKey: ["membros"] });
      setAviso("Alteração salva.");
    } catch (e) {
      setAviso(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }
  const pessoaVer = dados.pessoas.find((p) => p.id === ver?.usuario);
  return (
    <section className="space-y-6 min-w-0">
      <header className="flex items-center gap-2">
        <Wrench size={18} />
        <h2 className="font-semibold text-[15px]">Ferramentas e licenças</h2>
        <AjudaRecolhida rotulo="Sobre licenças das ferramentas">
          Licença individual por 12 meses. Pagamentos continuam desligados.
          Liberar para teste não cobra e não altera acessos antigos. O CRM fica
          guardado após vencer até o titular pedir exclusão. Acompanhamento
          administrativo é somente leitura.
        </AjudaRecolhida>
      </header>
      {admin.isError ? (
        <div role="alert">
          <p>
            Não foi possível carregar a configuração. A migração desta etapa
            precisa estar disponível no ambiente de teste.
          </p>
          <button className="membros-acao" onClick={() => void admin.refetch()}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <details className="membros-bloco" open>
            <summary className="membros-acao">
              Vincular ferramenta ao produto
            </summary>
            <form
              className="grid sm:grid-cols-2 gap-4 pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void agir(() => configurarFerramenta(produto, motor, ativo));
              }}
            >
              <label className="space-y-2 text-[12px]">
                Produto
                <select
                  className="membros-campo"
                  required
                  value={produto}
                  onChange={(e) => {
                    const id = e.target.value;
                    setProduto(id);
                    const f = admin.data?.ferramentas.find(
                      (f) => f.produto_id === id,
                    );
                    setMotor(f?.motor || "crm");
                    setAtivo(f?.ativo || false);
                    setMensal({
                      nome: f?.upgrade_mensal?.nome || "",
                      recursos: (f?.upgrade_mensal?.recursos || []).join("\n"),
                    });
                  }}
                >
                  <option value="">Escolha o produto cadastrado</option>
                  {dados.produtos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.titulo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-[12px]">
                Ferramenta
                <select
                  className="membros-campo"
                  value={motor}
                  onChange={(e) => setMotor(e.target.value as typeof motor)}
                >
                  <option value="crm">CRM do cliente</option>
                  <option value="proxima_resposta">Próxima Resposta</option>
                </select>
              </label>
              <label className="text-[13px] flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={ativo}
                  onChange={(e) => setAtivo(e.target.checked)}
                />
                Disponível na área de ferramentas
              </label>
              <button
                disabled={ocupado || !produto}
                className="membros-acao bg-primary text-primary-foreground justify-self-start"
              >
                Salvar vínculo
              </button>
            </form>
          </details>
          <details className="membros-bloco">
            <summary className="membros-acao">Upgrade mensal</summary>
            <form
              className="space-y-3 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void agir(() =>
                  prepararUpgradeMensal(
                    produto,
                    mensal.nome,
                    mensal.recursos
                      .split("\n")
                      .map((r) => r.trim())
                      .filter(Boolean),
                  ),
                );
              }}
            >
              <label className="block text-[12px] space-y-2">
                <span className="inline-flex items-center gap-2">
                  Nome do plano
                  <AjudaRecolhida rotulo="Preparar o plano mensal">
                    Rascunho por produto, separado da licença anual e do
                    contrato de marketing. Preço, escopo e pagamentos precisam
                    ser validados antes da ativação. Salvar não cobra, não
                    renova e não muda a licença anual.
                  </AjudaRecolhida>
                </span>
                <input
                  className="membros-campo"
                  required
                  maxLength={80}
                  value={mensal.nome}
                  onChange={(e) =>
                    setMensal({ ...mensal, nome: e.target.value })
                  }
                />
              </label>
              <label className="block text-[12px] space-y-2">
                Recursos propostos, um por linha
                <textarea
                  className="membros-campo"
                  maxLength={4000}
                  value={mensal.recursos}
                  onChange={(e) =>
                    setMensal({ ...mensal, recursos: e.target.value })
                  }
                />
              </label>
              <button disabled={ocupado || !produto} className="membros-acao">
                Salvar rascunho mensal
              </button>
            </form>
          </details>
          <details className="membros-bloco">
            <summary className="membros-acao">
              <ShieldCheck size={16} />
              Liberação manual de teste
            </summary>
            <div className="pt-4 space-y-3">
              <label className="space-y-2 text-[12px] block max-w-lg">
                Titular
                <select
                  className="membros-campo"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                >
                  <option value="">Escolha uma pessoa</option>
                  {dados.pessoas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="membros-acao"
                disabled={ocupado || !produto || !usuario}
                onClick={() =>
                  void agir(() => licenciarTeste(produto, usuario))
                }
              >
                Liberar 12 meses para teste
              </button>
              <AjudaRecolhida rotulo="Sobre a liberação de teste">
                Usa o produto selecionado acima. Repetir a ação não renova nem
                duplica a licença. O prazo começa no servidor e não depende do
                primeiro uso. A conta da pessoa precisa estar confirmada.
              </AjudaRecolhida>
            </div>
          </details>
          <section className="space-y-3">
            <h3 className="font-semibold text-[15px]">Titulares e prazos</h3>
            <div className="membros-tabela-rolagem">
              <table className="membros-tabela">
                <thead>
                  <tr>
                    <th>Pessoa e produto</th>
                    <th>Validade</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {(admin.data?.licencas || []).map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.titular || l.email}
                        <small>
                          {dados.produtos.find((p) => p.id === l.produto_id)
                            ?.titulo || "Produto indisponível"}
                          {l.origem === "validacao_manual"
                            ? " · Teste manual"
                            : " · Pagamento confirmado"}
                        </small>
                      </td>
                      <td>
                        {l.revogado_em
                          ? "Revogado"
                          : new Date(l.fim) > new Date()
                            ? "Liberado"
                            : "Vencido"}
                        <small>
                          {new Date(l.fim).toLocaleDateString("pt-BR")}
                        </small>
                      </td>
                      <td>
                        <button
                          className="membros-acao"
                          onClick={() =>
                            setVer({
                              usuario: l.user_id,
                              produto: l.produto_id,
                            })
                          }
                        >
                          <Eye size={15} />
                          Acompanhar
                        </button>
                        {!l.revogado_em && (
                          <button
                            className="membros-acao"
                            disabled={ocupado}
                            onClick={() =>
                              void agir(() => revogarLicenca(l.id))
                            }
                          >
                            Revogar licença
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {!!admin.data?.exclusoes.length && (
            <section className="space-y-2">
              <h3 className="font-semibold text-[15px]">Pedidos de exclusão</h3>
              {admin.data.exclusoes.map((e) => (
                <div
                  key={`${e.user_id}:${e.produto_id}`}
                  className="text-[13px] flex flex-wrap gap-3 items-center"
                >
                  {dados.pessoas.find((p) => p.id === e.user_id)?.full_name ||
                    "Titular"}{" "}
                  ·{" "}
                  {dados.produtos.find((p) => p.id === e.produto_id)?.titulo ||
                    "Ferramenta"}{" "}
                  · {new Date(e.solicitado_em).toLocaleDateString("pt-BR")}
                  <button
                    className="membros-acao"
                    onClick={() => setExclusao(e)}
                  >
                    Conferir pedido
                  </button>
                </div>
              ))}
            </section>
          )}
          {ver && admin.data && (
            <section className="space-y-3">
              <div className="flex gap-3 items-center">
                <h3 className="text-[15px] font-semibold">
                  CRM de {pessoaVer?.full_name || pessoaVer?.email || "titular"}{" "}
                  · {dados.produtos.find((p) => p.id === ver.produto)?.titulo}
                </h3>
                <button
                  className="membros-acao ml-auto"
                  onClick={() => setVer(null)}
                >
                  Fechar
                </button>
              </div>
              <QuadroCrm dados={admin.data} />
            </section>
          )}
        </>
      )}
      {aviso && (
        <p role="status" className="text-[13px]">
          {aviso}
        </p>
      )}
      {exclusao && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v && !ocupado) setExclusao(null);
          }}
        >
          <DialogContent>
            <DialogTitle>Excluir os dados solicitados?</DialogTitle>
            <DialogDescription>
              {dados.pessoas.find((p) => p.id === exclusao.user_id)
                ?.full_name || "Titular"}{" "}
              ·{" "}
              {dados.produtos.find((p) => p.id === exclusao.produto_id)?.titulo}
              . Pedido de{" "}
              {new Date(exclusao.solicitado_em).toLocaleString("pt-BR")}. Serão
              excluídos {exclusao.contatos_total} contatos e{" "}
              {exclusao.negocios_total} negócios deste CRM. Licenças e outras
              compras são preservadas.
            </DialogDescription>
            <div className="flex gap-2">
              <button
                className="membros-acao"
                disabled={ocupado}
                onClick={() => setExclusao(null)}
              >
                Voltar
              </button>
              <button
                className="membros-acao bg-destructive text-destructive-foreground"
                disabled={ocupado}
                onClick={() =>
                  void agir(async () => {
                    await atenderExclusaoCrm(
                      exclusao.user_id,
                      exclusao.produto_id,
                      exclusao.solicitado_em,
                    );
                    setExclusao(null);
                  })
                }
              >
                Atender pedido de exclusão
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
