import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckSquare, Plus } from "lucide-react";
import {
  carregarAdmin,
  enviarMaterial,
  mensagemDoErro,
  reprocessarEvento,
  salvarLinha,
  type DadosAdmin,
  type ProdutoEditavel,
} from "@/lib/membros/api";
import ChecklistLancamento from "@/components/membros/ChecklistLancamento";
import { texto } from "@/components/sistema";
import "@/components/membros/membros.css";

const campo =
  "w-full min-h-11 rounded-lg bg-muted px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
function Campo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-2 text-[12px]">
      <span>{titulo}</span>
      {children}
    </label>
  );
}
function Bloco({
  titulo,
  children,
  aberto = false,
}: {
  titulo: string;
  children: ReactNode;
  aberto?: boolean;
}) {
  return (
    <details open={aberto} className="border-t border-border py-4">
      <summary className="cursor-pointer min-h-11 flex items-center text-[15px] font-semibold">
        {titulo}
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
export default function AdminMembros() {
  const qc = useQueryClient();
  const [check, setCheck] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pessoa, setPessoa] = useState("");
  const dados = useQuery({
    queryKey: ["membros", "admin"],
    queryFn: carregarAdmin,
    retry: false,
  });
  const agir = async (acao: () => Promise<void>) => {
    setOcupado(true);
    setErro("");
    setSucesso("");
    try {
      await acao();
      await qc.invalidateQueries({ queryKey: ["membros"] });
      setSucesso("Alteração salva e conferida.");
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <main className="membros-conteudo space-y-6">
      <header className="flex flex-wrap justify-between gap-4 items-center">
        <div className="flex items-center gap-3">
          <BookOpen size={22} className="text-primary" />
          <h1 className={texto.tituloPagina}>Biblioteca de membros</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/membros" className="membros-acao">
            Ver biblioteca
          </Link>
          <button
            className="membros-acao bg-primary text-primary-foreground"
            disabled={!dados.data}
            onClick={() => setCheck(true)}
          >
            <CheckSquare size={17} />
            Preparar lançamento
          </button>
        </div>
      </header>
      {erro && (
        <p role="alert" className="text-[13px] text-destructive">
          {erro}
        </p>
      )}
      {sucesso && (
        <p role="status" className="text-[13px] text-primary">
          {sucesso}
        </p>
      )}
      {dados.isPending ? (
        <p role="status">Carregando administração…</p>
      ) : dados.isError ? (
        <section role="alert" className="space-y-3">
          <p>{mensagemDoErro(dados.error)}</p>
          <button
            className="membros-acao border border-border"
            onClick={() => void dados.refetch()}
          >
            Tentar novamente
          </button>
        </section>
      ) : dados.data ? (
        <fieldset disabled={ocupado} className="min-w-0">
          <section
            className="rounded-xl border border-border p-4 mb-6 space-y-3"
            aria-label="Ver como cliente"
          >
            <h2 className={texto.tituloSecao}>Ver como cliente</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 max-w-md">
                <Campo titulo="Cliente ou membro">
                  <select
                    className={campo}
                    value={pessoa}
                    onChange={(e) => setPessoa(e.target.value)}
                  >
                    <option value="">Escolher pessoa</option>
                    {dados.data.pessoas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
              {pessoa && (
                <Link
                  className="membros-acao bg-primary text-primary-foreground"
                  to={`/membros?visao=${encodeURIComponent(pessoa)}`}
                >
                  Abrir visão do cliente
                </Link>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground">
              Veja a mesma tela, com os produtos liberados e bloqueados para
              essa pessoa, sem alterar seu progresso.
            </p>
          </section>
          <p className="rounded-lg bg-muted p-3 text-[13px] mb-4" role="status">
            Liberação automática por Kiwify e Asaas desativada até a validação
            dos pagamentos. Para testar, conceda um acesso manual abaixo.
          </p>
          <Produtos dados={dados.data} agir={agir} />
          <Materiais dados={dados.data} agir={agir} />
          <Direitos dados={dados.data} agir={agir} />
          <Pagamentos dados={dados.data} agir={agir} />
        </fieldset>
      ) : null}
      {check && dados.data && (
        <ChecklistLancamento
          fechar={() => setCheck(false)}
          itens={dados.data.checklist}
          historico={dados.data.historico}
          pessoas={dados.data.pessoas}
        />
      )}
    </main>
  );
}
type Props = {
  dados: DadosAdmin;
  agir: (acao: () => Promise<void>) => Promise<void>;
};
function Produtos({ dados, agir }: Props) {
  const [selecionado, setSelecionado] = useState("");
  const produto = dados.produtos.find((p) => p.id === selecionado);
  return (
    <Bloco titulo={`Produtos · ${dados.produtos.length}`} aberto>
      <div className="grid md:grid-cols-[260px_minmax(0,1fr)] gap-6">
        <nav
          aria-label="Produtos cadastrados"
          className="max-h-96 overflow-auto space-y-1"
        >
          <button
            className="membros-acao w-full justify-start"
            onClick={() => setSelecionado("")}
          >
            <Plus size={16} />
            Novo produto
          </button>
          {dados.produtos.map((p) => (
            <button
              key={p.id}
              className={`membros-acao w-full text-left justify-between gap-2 ${p.id === selecionado ? "bg-muted" : ""}`}
              onClick={() => setSelecionado(p.id)}
            >
              <span className="min-w-0 break-words">{p.titulo}</span>
              <span className="text-[11px] text-muted-foreground">
                {p.estado}
              </span>
            </button>
          ))}
        </nav>
        <FormProduto
          key={produto?.id || "novo"}
          produto={produto}
          salvar={(p) => agir(() => salvarLinha("membros_produtos", p))}
        />
      </div>
    </Bloco>
  );
}
function FormProduto({
  produto,
  salvar,
}: {
  produto?: ProdutoEditavel;
  salvar: (p: Record<string, unknown>) => Promise<void>;
}) {
  const [v, setV] = useState({
    id: produto?.id || crypto.randomUUID(),
    titulo: produto?.titulo || "",
    descricao: produto?.descricao || "",
    categoria: produto?.categoria || "",
    formato: produto?.formato || "Material digital",
    capa_url: produto?.capa_url || "",
    checkout_url: produto?.checkout_url || "",
    estado: produto?.estado || "rascunho",
    gratuito: produto?.gratuito || false,
    destaque: produto?.destaque || false,
    condicoes: produto?.condicoes || "",
    ordem: produto?.ordem || 0,
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    void salvar({
      ...v,
      capa_url: v.capa_url || null,
      checkout_url: v.checkout_url || null,
    });
  };
  return (
    <form onSubmit={enviar} className="grid sm:grid-cols-2 gap-4 min-w-0">
      <Campo titulo="Título">
        <input
          className={campo}
          required
          maxLength={180}
          value={v.titulo}
          onChange={(e) => setV({ ...v, titulo: e.target.value })}
        />
      </Campo>
      <Campo titulo="Formato">
        <input
          className={campo}
          required
          maxLength={80}
          value={v.formato}
          onChange={(e) => setV({ ...v, formato: e.target.value })}
        />
      </Campo>
      <Campo titulo="Categoria">
        <input
          className={campo}
          maxLength={80}
          value={v.categoria}
          onChange={(e) => setV({ ...v, categoria: e.target.value })}
        />
      </Campo>
      <Campo titulo="Estado">
        <select
          className={campo}
          value={v.estado}
          onChange={(e) =>
            setV({ ...v, estado: e.target.value as typeof v.estado })
          }
        >
          <option value="rascunho">Rascunho</option>
          <option value="publicado">Publicado no catálogo</option>
          <option value="arquivado">Indisponível</option>
        </select>
      </Campo>
      <div className="sm:col-span-2">
        <Campo titulo="Descrição">
          <textarea
            className={`${campo} min-h-24`}
            maxLength={12000}
            value={v.descricao}
            onChange={(e) => setV({ ...v, descricao: e.target.value })}
          />
        </Campo>
      </div>
      <Campo titulo="Endereço HTTPS da capa real">
        <input
          className={campo}
          type="url"
          pattern="https://.*"
          value={v.capa_url}
          onChange={(e) => setV({ ...v, capa_url: e.target.value })}
        />
      </Campo>
      <Campo titulo="Checkout confirmado (opcional)">
        <input
          className={campo}
          type="url"
          pattern="https://.*"
          value={v.checkout_url}
          onChange={(e) => setV({ ...v, checkout_url: e.target.value })}
        />
      </Campo>
      <div className="sm:col-span-2">
        <Campo titulo="Condições de acesso">
          <textarea
            className={`${campo} min-h-20`}
            maxLength={4000}
            value={v.condicoes}
            onChange={(e) => setV({ ...v, condicoes: e.target.value })}
          />
        </Campo>
      </div>
      <label className="text-[13px] min-h-11 flex items-center gap-2">
        <input
          type="checkbox"
          checked={v.gratuito}
          onChange={(e) => setV({ ...v, gratuito: e.target.checked })}
        />
        Produto gratuito
      </label>
      <label className="text-[13px] min-h-11 flex items-center gap-2">
        <input
          type="checkbox"
          checked={v.destaque}
          onChange={(e) => setV({ ...v, destaque: e.target.checked })}
        />
        Destacar na biblioteca
      </label>
      <button
        className="membros-acao bg-primary text-primary-foreground justify-self-start"
        type="submit"
      >
        Salvar produto
      </button>
    </form>
  );
}
function SeletorProduto({
  dados,
  value,
  onChange,
}: {
  dados: DadosAdmin;
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <select
      className={campo}
      value={value}
      required
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Selecione um produto</option>
      {dados.produtos.map((p) => (
        <option key={p.id} value={p.id}>
          {p.titulo}
        </option>
      ))}
    </select>
  );
}
function Materiais({ dados, agir }: Props) {
  const [produto, setProduto] = useState("");
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("texto");
  const [conteudo, setConteudo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [download, setDownload] = useState(false);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    void agir(async () => {
      const id = crypto.randomUUID();
      if (tipo !== "texto" && !arquivo) throw new Error("Selecione o arquivo");
      const caminho =
        tipo !== "texto" && arquivo
          ? await enviarMaterial(produto, id, arquivo)
          : null;
      await salvarLinha("membros_materiais", {
        id,
        produto_id: produto,
        titulo,
        tipo,
        texto: tipo === "texto" ? conteudo : "",
        arquivo: caminho,
        permite_download: download,
        ordem: dados.materiais.filter((m) => m.produto_id === produto).length,
      });
      setTitulo("");
      setConteudo("");
      setArquivo(null);
    });
  };
  return (
    <Bloco titulo="Materiais">
      <form onSubmit={enviar} className="grid sm:grid-cols-2 gap-4 max-w-4xl">
        <Campo titulo="Produto">
          <SeletorProduto dados={dados} value={produto} onChange={setProduto} />
        </Campo>
        <Campo titulo="Título do material">
          <input
            className={campo}
            required
            maxLength={180}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
        </Campo>
        <Campo titulo="Tipo">
          <select
            className={campo}
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            <option value="texto">Texto ou guia</option>
            <option value="video">Vídeo</option>
            <option value="audio">Áudio</option>
            <option value="pdf">PDF</option>
            <option value="arquivo">Arquivo, kit ou template</option>
          </select>
        </Campo>
        <label className="min-h-11 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={download}
            onChange={(e) => setDownload(e.target.checked)}
          />
          Permitir download
        </label>
        <div className="sm:col-span-2">
          {tipo === "texto" ? (
            <Campo titulo="Conteúdo (Markdown)">
              <textarea
                className={`${campo} min-h-40`}
                required
                maxLength={200000}
                value={conteudo}
                onChange={(e) => setConteudo(e.target.value)}
              />
            </Campo>
          ) : (
            <Campo titulo="Arquivo privado (até 500 MB)">
              <input
                key={`${produto}:${tipo}`}
                className={campo}
                required
                type="file"
                accept={
                  tipo === "video"
                    ? "video/mp4,video/webm"
                    : tipo === "audio"
                      ? "audio/mpeg,audio/mp4,audio/ogg"
                      : tipo === "pdf"
                        ? "application/pdf"
                        : undefined
                }
                onChange={(e) => setArquivo(e.target.files?.[0] || null)}
              />
            </Campo>
          )}
        </div>
        <button
          className="membros-acao bg-primary text-primary-foreground justify-self-start"
          type="submit"
        >
          Adicionar material
        </button>
      </form>
      <ul className="mt-6 divide-y divide-border">
        {dados.materiais
          .filter((m) => !produto || m.produto_id === produto)
          .map((m) => (
            <li
              key={m.id}
              className="py-3 flex flex-wrap gap-2 justify-between text-[13px]"
            >
              <span>
                {dados.produtos.find((p) => p.id === m.produto_id)?.titulo} ·{" "}
                {m.titulo}
              </span>
              <button
                className="membros-acao text-muted-foreground"
                onClick={() =>
                  void agir(() =>
                    salvarLinha("membros_materiais", {
                      ...m,
                      permite_download: !m.permite_download,
                    }),
                  )
                }
              >
                {m.permite_download
                  ? "Desativar download"
                  : "Permitir download"}
              </button>
            </li>
          ))}
      </ul>
    </Bloco>
  );
}
function Direitos({ dados, agir }: Props) {
  const [produto, setProduto] = useState("");
  const [pessoa, setPessoa] = useState("");
  const [fim, setFim] = useState("");
  const [semPrazo, setSemPrazo] = useState(false);
  const [plano, setPlano] = useState("");
  const [beneficio, setBeneficio] = useState("");
  return (
    <Bloco titulo="Acessos e benefícios">
      <div className="grid lg:grid-cols-2 gap-8">
        <section>
          <h2 className={`${texto.tituloSecao} mb-4`}>
            Conceder acesso manual
          </h2>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void agir(() =>
                salvarLinha("membros_acessos", {
                  id: crypto.randomUUID(),
                  user_id: pessoa,
                  produto_id: produto,
                  origem: "manual",
                  referencia: crypto.randomUUID(),
                  fim: semPrazo ? null : new Date(fim).toISOString(),
                }),
              );
            }}
          >
            <Campo titulo="Pessoa cadastrada">
              <select
                required
                className={campo}
                value={pessoa}
                onChange={(e) => setPessoa(e.target.value)}
              >
                <option value="">Selecione a identidade</option>
                {dados.pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} · {p.email}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo titulo="Produto">
              <SeletorProduto
                dados={dados}
                value={produto}
                onChange={setProduto}
              />
            </Campo>
            <Campo titulo="Acesso até">
              <input
                className={campo}
                required={!semPrazo}
                disabled={semPrazo}
                type="datetime-local"
                value={fim}
                onChange={(e) => setFim(e.target.value)}
              />
            </Campo>
            <label className="text-[13px] flex items-center gap-2 min-h-11">
              <input
                type="checkbox"
                checked={semPrazo}
                onChange={(e) => setSemPrazo(e.target.checked)}
              />
              Conceder explicitamente sem prazo
            </label>
            <button className="membros-acao bg-primary text-primary-foreground">
              Conceder acesso
            </button>
          </form>
        </section>
        <section>
          <h2 className={`${texto.tituloSecao} mb-4`}>
            Vincular benefício a plano existente
          </h2>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void agir(() =>
                salvarLinha(
                  "membros_beneficios_plano",
                  { plano_id: plano, produto_id: beneficio, ativo: true },
                  "plano_id,produto_id",
                ),
              );
            }}
          >
            <Campo titulo="Plano financeiro">
              <select
                required
                className={campo}
                value={plano}
                onChange={(e) => setPlano(e.target.value)}
              >
                <option value="">Selecione o plano</option>
                {dados.planos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo titulo="Produto incluído">
              <SeletorProduto
                dados={dados}
                value={beneficio}
                onChange={setBeneficio}
              />
            </Campo>
            <p className={texto.auxiliar}>
              Disponível somente durante contrato ativo e vigente desse plano.
            </p>
            <button className="membros-acao bg-primary text-primary-foreground">
              Salvar benefício
            </button>
          </form>
          <ul className="mt-4 divide-y divide-border">
            {dados.beneficios.map((b) => (
              <li key={b.id} className="py-3 text-[13px]">
                {dados.planos.find((p) => p.id === b.plano_id)?.name ||
                  "Plano arquivado"}{" "}
                · {dados.produtos.find((p) => p.id === b.produto_id)?.titulo}
                <button
                  className="membros-acao text-muted-foreground"
                  onClick={() =>
                    void agir(() =>
                      salvarLinha("membros_beneficios_plano", {
                        ...b,
                        ativo: !b.ativo,
                      }),
                    )
                  }
                >
                  {b.ativo ? "Retirar benefício" : "Reativar benefício"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <h2 className={`${texto.tituloSecao} mt-6`}>Direitos registrados</h2>
      <ul className="divide-y divide-border">
        {dados.acessos.map((a) => (
          <li
            key={a.id}
            className="py-3 flex flex-wrap items-center justify-between gap-2 text-[13px]"
          >
            <span>
              {dados.pessoas.find((p) => p.id === a.user_id)?.full_name ||
                "Pessoa cadastrada"}{" "}
              · {dados.produtos.find((p) => p.id === a.produto_id)?.titulo} ·{" "}
              {a.origem === "compra" ? "Compra confirmada" : "Concessão manual"}
              {a.revogado_em
                ? " · revogado"
                : a.fim
                  ? ` · até ${new Date(a.fim).toLocaleDateString("pt-BR")}`
                  : " · sem prazo"}
            </span>
            {a.origem === "manual" && !a.revogado_em && (
              <button
                className="membros-acao text-muted-foreground"
                onClick={() =>
                  void agir(() =>
                    salvarLinha("membros_acessos", {
                      ...a,
                      revogado_em: new Date().toISOString(),
                    }),
                  )
                }
              >
                Revogar esta concessão
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className={`${texto.auxiliar} mt-3`}>
        Exibindo até 200 direitos recentes. Benefícios de plano são calculados
        pela vigência do contrato.
      </p>
    </Bloco>
  );
}
function Pagamentos({ dados, agir }: Props) {
  const [integracao, setIntegracao] = useState("");
  const [externo, setExterno] = useState("");
  const [produto, setProduto] = useState("");
  const [dias, setDias] = useState("365");
  const [regra, setRegra] = useState("dias");
  const [revogarReembolso, setRevogarReembolso] = useState(false);
  return (
    <Bloco titulo="Pagamentos e diagnóstico">
      <p className={`${texto.corpo} mb-4`}>
        Kiwify: ativação pendente de validação oficial e teste seguro. Asaas:
        conferência por leitura no servidor, sem emissão de cobrança. Só
        integramos produtos da própria Aceleriq.
      </p>
      <form
        className="grid sm:grid-cols-2 gap-4 max-w-4xl"
        onSubmit={(e) => {
          e.preventDefault();
          void agir(() =>
            salvarLinha(
              "membros_vinculos_venda",
              {
                integracao_id: integracao,
                produto_externo_id: externo,
                produto_id: produto,
                regra,
                dias: regra === "dias" ? Number(dias) : null,
                revogar_reembolso: revogarReembolso,
                ativo: true,
              },
              "integracao_id,produto_externo_id",
            ),
          );
        }}
      >
        <Campo titulo="Integração existente da agência">
          <select
            className={campo}
            required
            value={integracao}
            onChange={(e) => setIntegracao(e.target.value)}
          >
            <option value="">Selecione a integração</option>
            {dados.integracoes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.gateway === "asaas" ? "Asaas" : "Kiwify · ativação pendente"}
              </option>
            ))}
          </select>
        </Campo>
        <Campo titulo="Identificador do produto no provedor">
          <input
            className={campo}
            required
            maxLength={120}
            value={externo}
            onChange={(e) => setExterno(e.target.value)}
          />
        </Campo>
        <Campo titulo="Produto da biblioteca">
          <SeletorProduto dados={dados} value={produto} onChange={setProduto} />
        </Campo>
        <Campo titulo="Condição de acesso">
          <select
            className={campo}
            value={regra}
            onChange={(e) => setRegra(e.target.value)}
          >
            <option value="dias">Prazo em dias após confirmação</option>
            <option value="sem_prazo">Sem prazo · decisão explícita</option>
          </select>
        </Campo>
        {regra === "dias" && (
          <Campo titulo="Dias de acesso">
            <input
              className={campo}
              type="number"
              required
              min={1}
              max={36500}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
            />
          </Campo>
        )}
        <button
          type="submit"
          className="membros-acao bg-primary text-primary-foreground justify-self-start self-end"
        >
          Salvar vínculo
        </button>
        <label className="sm:col-span-2 text-[13px] min-h-11 flex items-start gap-2">
          <input
            type="checkbox"
            checked={revogarReembolso}
            onChange={(e) => setRevogarReembolso(e.target.checked)}
          />
          Reembolso integral ou contestação revoga somente o direito desta
          compra. Sem marcar, fica para decisão administrativa.
        </label>
      </form>
      <ul className="mt-4 divide-y divide-border">
        {dados.vinculos.map((v) => (
          <li
            key={v.id}
            className="text-[13px] py-3 flex flex-wrap justify-between items-center gap-2"
          >
            <span>
              {dados.integracoes.find((i) => i.id === v.integracao_id)?.gateway}{" "}
              · {dados.produtos.find((p) => p.id === v.produto_id)?.titulo} ·{" "}
              {v.regra === "dias" ? `${v.dias} dias` : "Sem prazo"}
            </span>
            <button
              className="membros-acao text-muted-foreground"
              onClick={() =>
                void agir(() =>
                  salvarLinha("membros_vinculos_venda", {
                    ...v,
                    ativo: !v.ativo,
                  }),
                )
              }
            >
              {v.ativo ? "Desativar vínculo" : "Ativar vínculo"}
            </button>
          </li>
        ))}
      </ul>
      <h2 className={`${texto.tituloSecao} mt-6`}>Conferências de pagamento</h2>
      {!dados.processamentos.length ? (
        <p className={`${texto.auxiliar} mt-3`}>
          Nenhum evento de produto vinculado recebido. Não há venda de teste
          criada no sistema.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {dados.processamentos.map((p) => (
            <li
              key={p.evento_id}
              className="py-3 flex flex-wrap justify-between items-center gap-3 text-[13px]"
            >
              <div>
                <p>
                  {(
                    {
                      aguardando_verificacao:
                        "Aguardando conferência no servidor",
                      kiwify_pendente: "Kiwify pendente de validação",
                      sem_configuracao: "Configuração incompleta",
                      confirmado: "Conferência realizada",
                      ignorado: "Sem alteração de acesso",
                      erro: "Conferência não concluída",
                    } as Record<string, string>
                  )[p.estado] || "Aguardando revisão"}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {p.mensagem} ·{" "}
                  {new Date(p.atualizado_em).toLocaleString("pt-BR")}
                </p>
              </div>
              <button
                className="membros-acao border border-border"
                onClick={() => void agir(() => reprocessarEvento(p.evento_id))}
              >
                Conferir novamente
              </button>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}
