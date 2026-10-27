import { AjudaRecolhida } from "@/components/sistema";
import TituloMembros from "./TituloMembros";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import {
  carregarPessoa,
  carregarPessoas,
  liberarPessoas,
  revogarManual,
  salvarNome,
} from "@/lib/membros/aprendizado";
import {
  mensagemDoErro,
  salvarLinha,
  type DadosAdmin,
} from "@/lib/membros/api";
import type { PassoFunil } from "@/lib/membros/modelo";
const campo =
  "w-full min-h-11 rounded-lg bg-muted px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
const situacoes: Record<string, string> = {
  comprador: "Compra confirmada",
  liberado: "Acesso liberado",
  pendente: "Pagamento pendente",
  encerrado: "Prazo encerrado",
  sem_compra: "Sem compra registrada",
};
type Props = {
  dados: DadosAdmin;
  agir: (acao: () => Promise<void>) => Promise<void>;
};
export default function PessoasEFunil({ dados, agir }: Props) {
  const [busca, setBusca] = useState("");
  const q = useDeferredValue(busca);
  const [produto, setProduto] = useState("");
  const [estado, setEstado] = useState("");
  const [pagina, setPagina] = useState(0);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [produtos, setProdutos] = useState<string[]>([]);
  const [fim, setFim] = useState("");
  const [pessoa, setPessoa] = useState("");
  const lista = useQuery({
    queryKey: ["membros", "pessoas", q, produto, estado, pagina],
    queryFn: () => carregarPessoas(q, produto, estado, pagina),
    retry: false,
  });
  return (
    <section className="space-y-5">
      <TituloMembros titulo="Pessoas, compras e acessos">
        Compra confirmada e acesso manual aparecem separados. Prazo encerrado
        indica o fim do acesso registrado.
      </TituloMembros>
      {lista.data && (
        <div className="membros-resumo-pessoas">
          {(
            [
              ["", "Pessoas", lista.data.resumo.pessoas],
              ["comprador", "Compradores", lista.data.resumo.compradores],
              ["liberado", "Com acesso", lista.data.resumo.liberados],
              ["encerrado", "Prazo encerrado", lista.data.resumo.encerrados],
              ["pendente", "Pendentes", lista.data.resumo.pendentes],
            ] as const
          ).map(([id, nome, total]) => (
            <button
              key={id}
              className="membros-acao border border-border"
              aria-pressed={estado === id}
              onClick={() => {
                setEstado(id);
                setPagina(0);
              }}
            >
              <span>{nome}</span>
              <strong>{total}</strong>
            </button>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="relative">
          <Search
            size={15}
            className="absolute left-3 top-4 text-muted-foreground"
          />
          <input
            aria-label="Buscar membros"
            className={`${campo} pl-9`}
            maxLength={180}
            placeholder="Nome ou e-mail"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(0);
            }}
          />
        </label>
        <select
          aria-label="Filtrar por produto"
          className={campo}
          value={produto}
          onChange={(e) => {
            setProduto(e.target.value);
            setPagina(0);
          }}
        >
          <option value="">Todos os produtos</option>
          {dados.produtos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.titulo}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por situação"
          className={campo}
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            setPagina(0);
          }}
        >
          <option value="">Todas as situações</option>
          {Object.entries(situacoes).map(([id, nome]) => (
            <option key={id} value={id}>
              {nome}
            </option>
          ))}
        </select>
      </div>
      <details className="membros-caixa">
        <summary>
          Conceder produtos às pessoas selecionadas ({selecionados.length})
        </summary>
        <form
          className="space-y-4 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void agir(async () => {
              await liberarPessoas(
                selecionados,
                produtos,
                fim ? new Date(fim).toISOString() : undefined,
              );
              setSelecionados([]);
            });
          }}
        >
          <div className="membros-escolhas">
            {dados.produtos.map((p) => (
              <label
                key={p.id}
                className="flex gap-2 min-h-10 items-center text-[13px]"
              >
                <input
                  type="checkbox"
                  checked={produtos.includes(p.id)}
                  onChange={(e) =>
                    setProdutos((a) =>
                      e.target.checked
                        ? [...a, p.id]
                        : a.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.titulo}
              </label>
            ))}
          </div>
          <label className="block max-w-sm text-[12px] space-y-2">
            <span>Acesso até (opcional, vazio significa sem prazo)</span>
            <input
              className={campo}
              type="datetime-local"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
            />
          </label>
          <button
            disabled={!selecionados.length || !produtos.length}
            className="membros-acao bg-primary text-primary-foreground"
          >
            Liberar {produtos.length} produto(s) para {selecionados.length}{" "}
            pessoa(s)
          </button>
        </form>
      </details>
      {lista.isPending ? (
        <p role="status">Carregando pessoas…</p>
      ) : lista.isError ? (
        <p role="alert">{mensagemDoErro(lista.error)}</p>
      ) : (
        <div className="membros-tabela-rolagem">
          <table className="membros-tabela">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Selecionar esta página"
                    checked={
                      !!lista.data?.pessoas.length &&
                      lista.data.pessoas.every((p) =>
                        selecionados.includes(p.id),
                      )
                    }
                    onChange={(e) =>
                      setSelecionados((a) =>
                        e.target.checked
                          ? Array.from(
                              new Set([
                                ...a,
                                ...(lista.data?.pessoas.map((p) => p.id) || []),
                              ]),
                            )
                          : a.filter(
                              (id) =>
                                !lista.data?.pessoas.some((p) => p.id === id),
                            ),
                      )
                    }
                  />
                </th>
                <th>Pessoa</th>
                <th>Situação</th>
                <th>Compras</th>
                <th>Acessos</th>
                <th>
                  <span className="sr-only">Detalhes</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.data?.pessoas.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${p.nome}`}
                      checked={selecionados.includes(p.id)}
                      onChange={(e) =>
                        setSelecionados((a) =>
                          e.target.checked
                            ? [...a, p.id]
                            : a.filter((id) => id !== p.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <strong>{p.nome}</strong>
                    <small>{p.email}</small>
                    {!p.confirmado && <small>Conta ainda não confirmada</small>}
                  </td>
                  <td>{situacoes[p.situacao] || "Sem compra registrada"}</td>
                  <td>{p.compras}</td>
                  <td>{p.liberados}</td>
                  <td>
                    <button
                      className="membros-acao"
                      onClick={() => setPessoa(p.id)}
                    >
                      Gerenciar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!lista.data?.pessoas.length && (
            <p className="py-6 text-[13px]">Nenhuma pessoa neste filtro.</p>
          )}
        </div>
      )}
      <div className="flex justify-between items-center text-[12px] text-muted-foreground">
        <span>
          {lista.data?.total || 0} pessoas · Página {pagina + 1}
        </span>
        <div className="flex">
          <button
            className="membros-acao"
            disabled={pagina === 0}
            onClick={() => setPagina((p) => p - 1)}
            aria-label="Página anterior de pessoas"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="membros-acao"
            disabled={(pagina + 1) * 50 >= (lista.data?.total || 0)}
            onClick={() => setPagina((p) => p + 1)}
            aria-label="Próxima página de pessoas"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {pessoa && (
        <DetalhesPessoa
          key={pessoa}
          id={pessoa}
          agir={agir}
          fechar={() => setPessoa("")}
        />
      )}
    </section>
  );
}
function DetalhesPessoa({
  id,
  agir,
  fechar,
}: {
  id: string;
  agir: Props["agir"];
  fechar: () => void;
}) {
  const d = useQuery({
    queryKey: ["membros", "pessoa", id],
    queryFn: () => carregarPessoa(id),
    retry: false,
  });
  const [nome, setNome] = useState<string | null>(null);
  const [produto, setProduto] = useState("");
  const [fim, setFim] = useState("");
  if (d.isPending) return <p role="status">Abrindo pessoa…</p>;
  if (d.isError) return <p role="alert">{mensagemDoErro(d.error)}</p>;
  const dados = d.data;
  return (
    <section
      className="membros-caixa space-y-4"
      aria-label="Detalhes da pessoa"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{dados.pessoa.nome}</h3>
          <p className="text-[12px] text-muted-foreground">
            {dados.pessoa.email}
          </p>
        </div>
        <div className="flex">
          <Link
            className="membros-acao text-primary"
            to={`/membros?visao=${id}`}
          >
            Ver como esta pessoa
          </Link>
          <button className="membros-acao" onClick={fechar}>
            Fechar
          </button>
        </div>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void agir(() => salvarNome(id, nome ?? dados.pessoa.nome));
        }}
      >
        <input
          className={`${campo} max-w-sm`}
          aria-label="Nome de exibição"
          value={nome ?? dados.pessoa.nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={180}
          required
        />
        <button className="membros-acao border border-border">
          Salvar nome
        </button>
      </form>
      <form
        className="grid sm:grid-cols-3 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void agir(() =>
            liberarPessoas(
              [id],
              [produto],
              fim ? new Date(fim).toISOString() : undefined,
            ),
          );
        }}
      >
        <select
          className={campo}
          aria-label="Produto para liberar"
          value={produto}
          onChange={(e) => setProduto(e.target.value)}
          required
        >
          <option value="">Escolha um produto</option>
          {dados.produtos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.titulo}
            </option>
          ))}
        </select>
        <input
          className={campo}
          aria-label="Vencimento do acesso manual"
          type="datetime-local"
          value={fim}
          onChange={(e) => setFim(e.target.value)}
        />
        <button className="membros-acao bg-primary text-primary-foreground">
          Liberar acesso manual
        </button>
      </form>
      <div className="membros-escolhas">
        {dados.produtos.map((p) => (
          <div key={p.id} className="membros-editor-item">
            <div className="flex-1 min-w-0 text-[13px]">
              <strong>{p.titulo}</strong>
              <p className="text-[12px] text-muted-foreground">
                {p.origens.length
                  ? p.origens
                      .map(
                        (o) =>
                          ({
                            compra: "Compra confirmada",
                            manual: "Manual",
                            plano: "Plano",
                            gratuito: "Gratuito",
                          })[o] || o,
                      )
                      .join(" · ")
                  : p.em_venda
                    ? "Bloqueado, disponível para compra"
                    : "Sem acesso"}
              </p>
            </div>
            {dados.acessos.some(
              (a) =>
                a.produto_id === p.id &&
                a.origem === "manual" &&
                !a.revogado_em,
            ) && (
              <button
                className="membros-acao text-destructive"
                onClick={() => void agir(() => revogarManual(id, p.id))}
              >
                Retirar manual
              </button>
            )}
          </div>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-[13px]">
          Compras registradas ({dados.compras.length})
        </summary>
        <ul className="divide-y divide-border">
          {dados.compras.map((c) => (
            <li key={c.id} className="py-3 text-[13px]">
              {dados.produtos.find((p) => p.id === c.produto_id)?.titulo} ·{" "}
              {c.estado === "pago"
                ? "Pagamento confirmado"
                : c.estado === "reembolsado"
                  ? "Reembolsado"
                  : c.estado === "pendente"
                    ? "Aguardando pagamento"
                    : "Registro em conferência"}
              <small className="block text-muted-foreground">
                {c.confirmado_em
                  ? new Date(c.confirmado_em).toLocaleString("pt-BR")
                  : ""}
                {c.fim
                  ? ` · Acesso até ${new Date(c.fim).toLocaleDateString("pt-BR")}`
                  : ""}
              </small>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer text-[13px]">
          Histórico de acessos
        </summary>
        <ul className="divide-y divide-border">
          {dados.historico.map((h) => (
            <li key={h.id} className="py-3 text-[13px]">
              {dados.produtos.find((p) => p.id === h.produto_id)?.titulo} ·{" "}
              {h.atual.revogado_em
                ? "Acesso retirado"
                : h.anterior
                  ? "Acesso atualizado"
                  : "Acesso concedido"}
              <small className="block text-muted-foreground">
                {new Date(h.criado_em).toLocaleString("pt-BR")} ·{" "}
                {h.origem === "manual" ? "Concessão manual" : "Compra"}
              </small>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
export function EditorFunil({
  dados,
  agir,
  editarProduto,
}: Props & { editarProduto?: (id: string) => void }) {
  const [selecionado, setSelecionado] = useState("");
  const [novaEtapa, setNovaEtapa] = useState(0);
  return (
    <section className="space-y-5">
      <TituloMembros
        titulo="Recomendações"
        acoes={
          <button
            className="membros-acao"
            onClick={() => {
              setSelecionado("");
              setNovaEtapa((n) => n + 1);
            }}
          >
            <Plus size={16} />
            Nova etapa
          </button>
        }
      >
        Escolha o próximo produto que aparece para quem já tem acesso ao
        anterior. Cada etapa liga dois produtos diferentes.
      </TituloMembros>
      <div
        className={`membros-editor-curso membros-editor-funil${dados.funil?.length ? "" : " sem-etapas"}`}
      >
        {!!dados.funil?.length && (
          <nav className="membros-editor-lista" aria-label="Etapas das recomendações">
            {(dados.funil || []).map((f) => (
              <button
                key={f.id}
                className="membros-acao w-full text-left justify-start"
                aria-current={selecionado === f.id ? "page" : undefined}
                onClick={() => setSelecionado(f.id)}
              >
                <span>
                  {
                    dados.produtos.find((p) => p.id === f.produto_origem)
                      ?.titulo
                  }
                  <small className="block text-muted-foreground">
                    →{" "}
                    {
                      dados.produtos.find((p) => p.id === f.produto_destino)
                        ?.titulo
                    }{" "}
                    · {f.ativo ? "Ativa" : "Pausada"}
                  </small>
                </span>
              </button>
            ))}
          </nav>
        )}
        <FormFunil
          key={selecionado || `nova-${novaEtapa}`}
          linha={dados.funil?.find((f) => f.id === selecionado)}
          dados={dados}
          agir={agir}
          editarProduto={editarProduto}
        />
      </div>
    </section>
  );
}
function FormFunil({
  linha,
  dados,
  agir,
  editarProduto,
}: Props & { linha?: PassoFunil; editarProduto?: (id: string) => void }) {
  const [v, setV] = useState({
    id: linha?.id || crypto.randomUUID(),
    produto_origem: linha?.produto_origem || "",
    produto_destino: linha?.produto_destino || "",
    momento: linha?.momento || "concluiu",
    titulo: linha?.titulo || "Seu próximo passo",
    ordem: linha?.ordem || 0,
    ativo: linha?.ativo ?? true,
  });
  const destino = dados.produtos.find((p) => p.id === v.produto_destino);
  return (
    <form
      className="membros-funil-formulario"
      onSubmit={(e) => {
        e.preventDefault();
        void agir(() => salvarLinha("membros_funil", v));
      }}
    >
      {destino && (
        <section
          className="flex items-center gap-4 min-w-0"
          aria-label="Prévia da oferta"
        >
          <img
            alt={`Capa de ${destino.titulo}`}
            src={destino.capa_url || "/membros/capas/boas-vindas-v2.webp"}
            className="w-24 h-16 object-cover rounded-lg"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold truncate">
              {destino.titulo}
            </h3>
            <span className="text-[12px] text-muted-foreground">
              {destino.landing_url
                ? "Página de vendas pronta"
                : "Sem página de vendas"}{" "}
              · {destino.checkout_url ? "Checkout configurado" : "Sem checkout"}
            </span>
          </div>
          {editarProduto && (
            <button
              type="button"
              className="membros-acao"
              onClick={() => editarProduto(destino.id)}
            >
              Editar oferta
            </button>
          )}
        </section>
      )}
      {(["produto_origem", "produto_destino"] as const).map((k) => (
        <label key={k} className="block space-y-2 text-[12px]">
          <span>
            {k === "produto_origem"
              ? "Quem tem acesso a"
              : "Conhecerá este próximo produto"}
          </span>
          <select
            className={campo}
            aria-label={
              k === "produto_origem"
                ? "Quem tem acesso a"
                : "Conhecerá este próximo produto"
            }
            value={v[k]}
            onChange={(e) =>
              setV({
                ...v,
                [k]: e.target.value,
                ...(k === "produto_origem" &&
                e.target.value === v.produto_destino
                  ? { produto_destino: "" }
                  : {}),
              })
            }
            required
          >
            <option value="">Escolha um produto</option>
            {dados.produtos
              .filter(
                (p) => k === "produto_origem" || p.id !== v.produto_origem,
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.titulo}
                </option>
              ))}
          </select>
        </label>
      ))}
      <label className="block space-y-2 text-[12px]">
        <span>Quando aparecer</span>
        <select
          className={campo}
          value={v.momento}
          onChange={(e) =>
            setV({ ...v, momento: e.target.value as typeof v.momento })
          }
        >
          <option value="sempre">
            Assim que tiver acesso ao primeiro produto
          </option>
          <option value="concluiu">Após concluir o primeiro produto</option>
        </select>
      </label>
      <label className="block space-y-2 text-[12px]">
        <span>Título da indicação</span>
        <input
          className={campo}
          value={v.titulo}
          maxLength={180}
          required
          onChange={(e) => setV({ ...v, titulo: e.target.value })}
        />
      </label>
      <label className="block space-y-2 text-[12px]">
        <span>Ordem</span>
        <input
          className={campo}
          type="number"
          min={0}
          max={10000}
          value={v.ordem}
          onChange={(e) => setV({ ...v, ordem: Number(e.target.value) })}
        />
      </label>
      <div className="membros-formulario-acoes">
        <label className="flex gap-2 text-[13px] min-h-11 items-center">
          <input
            type="checkbox"
            checked={v.ativo}
            onChange={(e) => setV({ ...v, ativo: e.target.checked })}
          />
          Exibir esta etapa
        </label>
        <button
          className="membros-acao bg-primary text-primary-foreground"
          disabled={
            !v.produto_origem ||
            !v.produto_destino ||
            v.produto_origem === v.produto_destino
          }
        >
          Salvar recomendação
        </button>
      </div>
    </form>
  );
}
