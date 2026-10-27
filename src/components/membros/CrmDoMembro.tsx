import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  RefreshCw,
  Users,
  Columns3,
  Archive,
  Save,
  X,
} from "lucide-react";
import { AjudaRecolhida } from "@/components/sistema";
import { ESTAGIOS } from "@/lib/comercial/estagios";
import {
  operarCrm,
  type DadosCrmMembro,
  type ContatoMembro,
  type NegocioMembro,
} from "@/lib/membros/ferramentas";
import { mensagemDoErro } from "@/lib/membros/api";
import { useAuth } from "@/contexts/AuthContext";

type Edicao =
  | { tipo: "contato"; linha: Partial<ContatoMembro> }
  | { tipo: "negocio"; linha: Partial<NegocioMembro> };
export function QuadroCrm({
  dados,
  editar,
  busca = "",
  arquivados = false,
}: {
  dados: DadosCrmMembro;
  editar?: (e: Edicao) => void;
  busca?: string;
  arquivados?: boolean;
}) {
  const [etapaMobile, setEtapaMobile] = useState("abertos");
  const filtrados = dados.negocios.filter(
    (n) =>
      n.arquivado === arquivados &&
      `${n.titulo} ${dados.contatos.find((c) => c.id === n.contato_id)?.nome || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(busca.toLocaleLowerCase("pt-BR")),
  );
  const mobile = filtrados.filter(
    (n) =>
      etapaMobile === "todos" ||
      (etapaMobile === "abertos"
        ? !["ganho", "perdido"].includes(n.estagio)
        : n.estagio === etapaMobile),
  );
  return (
    <>
      <div className="membros-crm-mobile space-y-3">
        <select
          className="membros-campo"
          aria-label="Etapa do funil"
          value={etapaMobile}
          onChange={(e) => setEtapaMobile(e.target.value)}
        >
          <option value="abertos">Em andamento</option>
          <option value="todos">Todas as etapas</option>
          {ESTAGIOS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label} ({filtrados.filter((n) => n.estagio === e.id).length})
            </option>
          ))}
        </select>
        <div className="membros-contatos-lista space-y-3">
          {mobile.map((n) => (
            <button
              key={n.id}
              disabled={!editar}
              className="membros-crm-negocio w-full"
              onClick={() => editar?.({ tipo: "negocio", linha: n })}
            >
              <span className="text-primary">
                {ESTAGIOS.find((e) => e.id === n.estagio)?.label}
              </span>
              <strong>{n.titulo}</strong>
              {n.contato_id && (
                <span>
                  {dados.contatos.find((c) => c.id === n.contato_id)?.nome}
                </span>
              )}
              <span>
                {Number(n.valor).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
              {n.proxima_acao && <span>{n.proxima_acao}</span>}
              {n.proxima_data && (
                <time dateTime={n.proxima_data}>
                  {n.proxima_data.split("-").reverse().join("/")}
                </time>
              )}
            </button>
          ))}
          {!mobile.length && (
            <p className="text-[13px] py-6 text-muted-foreground">
              Nenhum negócio neste filtro.
            </p>
          )}
        </div>
      </div>
      <div className="membros-crm-quadro" aria-label="Funil comercial">
        {ESTAGIOS.map((etapa) => {
          const linhas = dados.negocios.filter(
            (n) =>
              n.estagio === etapa.id &&
              n.arquivado === arquivados &&
              `${n.titulo} ${dados.contatos.find((c) => c.id === n.contato_id)?.nome || ""}`
                .toLocaleLowerCase("pt-BR")
                .includes(busca.toLocaleLowerCase("pt-BR")),
          );
          return (
            <section key={etapa.id} className="membros-crm-coluna">
              <header className="flex items-center gap-2 text-[13px]">
                <h3 className="font-semibold">{etapa.label}</h3>
                <span className="text-muted-foreground">{linhas.length}</span>
                <AjudaRecolhida rotulo={`Sobre ${etapa.label}`}>
                  {etapa.ajuda}
                </AjudaRecolhida>
              </header>
              <div className="membros-crm-coluna-rolagem">
                {linhas.map((n) => (
                  <button
                    key={n.id}
                    disabled={!editar}
                    className="membros-crm-negocio"
                    onClick={() => editar?.({ tipo: "negocio", linha: n })}
                  >
                    <strong>{n.titulo}</strong>
                    {n.contato_id && (
                      <span>
                        {dados.contatos.find((c) => c.id === n.contato_id)
                          ?.nome || "Contato arquivado"}
                      </span>
                    )}
                    <span className="text-primary">
                      {Number(n.valor).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </span>
                    {n.proxima_acao && <span>{n.proxima_acao}</span>}
                    {n.proxima_data && (
                      <time dateTime={n.proxima_data}>
                        {n.proxima_data.split("-").reverse().join("/")}
                      </time>
                    )}
                  </button>
                ))}
                {!linhas.length && (
                  <p className="text-[12px] text-muted-foreground py-6">
                    Nenhum negócio
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
export default function CrmDoMembro({
  produto,
  prova,
}: {
  produto: string;
  prova: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const chave = ["membros", "crm", user?.id, produto, prova];
  const dados = useQuery({
    queryKey: chave,
    queryFn: () => operarCrm(produto, prova),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const [aba, setAba] = useState("funil");
  const [busca, setBusca] = useState("");
  const [arquivados, setArquivados] = useState(false);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  async function salvar() {
    if (!edicao) return;
    setOcupado(true);
    setErro("");
    try {
      await operarCrm(
        produto,
        prova,
        edicao.tipo === "contato" ? "salvar_contato" : "salvar_negocio",
        edicao.linha,
      );
      await qc.invalidateQueries({ queryKey: chave });
      setEdicao(null);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }
  const crm = dados.data || { contatos: [], negocios: [] };
  const contatoEmEdicao =
    edicao?.tipo === "negocio" ? edicao.linha.contato_id : null;
  return (
    <section className="membros-crm min-w-0 space-y-4" aria-label="Seu CRM">
      <div className="membros-crm-barra flex flex-wrap gap-2 items-center">
        <button
          className="membros-acao"
          aria-pressed={aba === "funil"}
          onClick={() => setAba("funil")}
        >
          <Columns3 size={16} />
          Funil
        </button>
        <button
          className="membros-acao"
          aria-pressed={aba === "contatos"}
          onClick={() => setAba("contatos")}
        >
          <Users size={16} />
          Contatos
        </button>
        <AjudaRecolhida rotulo="Sobre seu CRM">
          Seus contatos e negócios ficam separados dos outros clientes e do CRM
          interno da agência. A administração pode acompanhar para ajudar. Ao
          vencer, o acesso é bloqueado e os dados são guardados até você pedir
          exclusão.
        </AjudaRecolhida>
        <button
          className="membros-acao ml-auto"
          aria-label="Atualizar CRM"
          onClick={() => void dados.refetch()}
        >
          <RefreshCw size={16} />
        </button>
        <button
          className="membros-acao bg-primary text-primary-foreground"
          disabled={dados.isError}
          onClick={() =>
            setEdicao(
              aba === "contatos"
                ? {
                    tipo: "contato",
                    linha: {
                      nome: "",
                      empresa: "",
                      email: "",
                      telefone: "",
                      notas: "",
                      arquivado: false,
                    },
                  }
                : {
                    tipo: "negocio",
                    linha: {
                      titulo: "",
                      contato_id: null,
                      estagio: "novo",
                      valor: 0,
                      proxima_acao: "",
                      proxima_data: null,
                      notas: "",
                      arquivado: false,
                    },
                  },
            )
          }
        >
          <Plus size={16} />
          {aba === "contatos" ? "Novo contato" : "Novo negócio"}
        </button>
      </div>
      <div className="membros-crm-filtros flex gap-3 items-center">
        <label className="membros-crm-busca flex flex-1 items-center gap-2">
          <Search size={16} />
          <input
            className="membros-campo"
            placeholder="Buscar no CRM"
            aria-label="Buscar no CRM"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <button
          className="membros-acao"
          aria-pressed={arquivados}
          onClick={() => setArquivados((v) => !v)}
          title="Mostrar arquivados"
        >
          <Archive size={16} />
          <span className="hidden sm:inline">Arquivados</span>
        </button>
      </div>
      {dados.isPending ? (
        <p role="status">Abrindo seu CRM…</p>
      ) : dados.isError ? (
        <p role="alert">{mensagemDoErro(dados.error)}</p>
      ) : aba === "funil" ? (
        <QuadroCrm
          dados={crm}
          editar={setEdicao}
          busca={busca}
          arquivados={arquivados}
        />
      ) : (
        <div className="membros-contatos-lista">
          {crm.contatos
            .filter(
              (c) =>
                c.arquivado === arquivados &&
                `${c.nome} ${c.empresa}`
                  .toLocaleLowerCase("pt-BR")
                  .includes(busca.toLocaleLowerCase("pt-BR")),
            )
            .map((c) => (
              <button
                key={c.id}
                className="membros-contato"
                onClick={() => setEdicao({ tipo: "contato", linha: c })}
              >
                <Users size={17} />
                <span className="flex-1 min-w-0">
                  <strong className="block truncate">{c.nome}</strong>
                  <span className="text-[12px] text-muted-foreground">
                    {c.empresa || c.email || c.telefone}
                  </span>
                </span>
              </button>
            ))}
        </div>
      )}
      {edicao && (
        <section
          className="membros-crm-edicao"
          aria-label={
            edicao.tipo === "contato" ? "Editar contato" : "Editar negócio"
          }
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[15px]">
              {edicao.tipo === "contato" ? "Contato" : "Negócio"}
            </h3>
            <button
              className="membros-acao"
              aria-label="Fechar edição"
              onClick={() => setEdicao(null)}
            >
              <X size={16} />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void salvar();
            }}
            className="grid sm:grid-cols-2 gap-4"
          >
            {edicao.tipo === "contato" ? (
              <>
                {(["nome", "empresa", "email", "telefone"] as const).map(
                  (k) => (
                    <label key={k} className="text-[12px] space-y-2">
                      {
                        {
                          nome: "Nome",
                          empresa: "Empresa",
                          email: "E-mail",
                          telefone: "Telefone",
                        }[k]
                      }
                      <input
                        className="membros-campo"
                        type={k === "email" ? "email" : "text"}
                        required={k === "nome"}
                        maxLength={
                          k === "nome"
                            ? 120
                            : k === "email"
                              ? 254
                              : k === "telefone"
                                ? 40
                                : 180
                        }
                        value={edicao.linha[k] || ""}
                        onChange={(e) =>
                          setEdicao({
                            ...edicao,
                            linha: { ...edicao.linha, [k]: e.target.value },
                          })
                        }
                      />
                    </label>
                  ),
                )}
              </>
            ) : (
              <>
                <label className="text-[12px] space-y-2">
                  Negócio
                  <input
                    className="membros-campo"
                    required
                    maxLength={180}
                    value={edicao.linha.titulo || ""}
                    onChange={(e) =>
                      setEdicao({
                        ...edicao,
                        linha: { ...edicao.linha, titulo: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="text-[12px] space-y-2">
                  Contato
                  <select
                    className="membros-campo"
                    value={edicao.linha.contato_id || ""}
                    onChange={(e) =>
                      setEdicao({
                        ...edicao,
                        linha: {
                          ...edicao.linha,
                          contato_id: e.target.value || null,
                        },
                      })
                    }
                  >
                    <option value="">Sem contato vinculado</option>
                    {crm.contatos
                      .filter((c) => !c.arquivado || c.id === contatoEmEdicao)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-[12px] space-y-2">
                  Etapa
                  <select
                    className="membros-campo"
                    value={edicao.linha.estagio}
                    onChange={(e) =>
                      setEdicao({
                        ...edicao,
                        linha: { ...edicao.linha, estagio: e.target.value },
                      })
                    }
                  >
                    {ESTAGIOS.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12px] space-y-2">
                  Valor (R$)
                  <input
                    type="number"
                    min={0}
                    max={999999999999}
                    step="0.01"
                    className="membros-campo"
                    value={edicao.linha.valor || 0}
                    onChange={(e) =>
                      setEdicao({
                        ...edicao,
                        linha: {
                          ...edicao.linha,
                          valor: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="text-[12px] space-y-2">
                  Próxima ação
                  <input
                    maxLength={1000}
                    className="membros-campo"
                    value={edicao.linha.proxima_acao || ""}
                    onChange={(e) =>
                      setEdicao({
                        ...edicao,
                        linha: {
                          ...edicao.linha,
                          proxima_acao: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label className="text-[12px] space-y-2">
                  Data combinada
                  <input
                    type="date"
                    className="membros-campo"
                    value={edicao.linha.proxima_data || ""}
                    onChange={(e) =>
                      setEdicao({
                        ...edicao,
                        linha: {
                          ...edicao.linha,
                          proxima_data: e.target.value || null,
                        },
                      })
                    }
                  />
                </label>
              </>
            )}
            <label className="sm:col-span-2 text-[12px] space-y-2">
              Anotações
              <textarea
                className="membros-campo"
                maxLength={4000}
                value={edicao.linha.notas || ""}
                onChange={(e) =>
                  setEdicao({
                    ...edicao,
                    linha: { ...edicao.linha, notas: e.target.value },
                  })
                }
              />
            </label>
            <label className="text-[13px] flex gap-2 items-center">
              <input
                type="checkbox"
                checked={!!edicao.linha.arquivado}
                onChange={(e) =>
                  setEdicao({
                    ...edicao,
                    linha: { ...edicao.linha, arquivado: e.target.checked },
                  })
                }
              />
              Arquivar
            </label>
            <button
              disabled={ocupado}
              className="membros-acao bg-primary text-primary-foreground justify-self-start"
            >
              <Save size={16} />
              {ocupado ? "Salvando…" : "Salvar"}
            </button>
            {erro && (
              <p role="alert" className="sm:col-span-2">
                {erro}
              </p>
            )}
          </form>
        </section>
      )}
    </section>
  );
}
