import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";
import TituloMembros from "./TituloMembros";
import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  LockKeyhole,
  Laptop,
  Send,
  Copy,
  Wrench,
} from "lucide-react";
import { AjudaRecolhida } from "@/components/sistema";
import { useAuth } from "@/contexts/AuthContext";
import { mensagemDoErro } from "@/lib/membros/api";
import {
  listarFerramentas,
  abrirSessaoFerramenta,
  obterProvaCompartilhada,
  proximaResposta,
  pedirExclusaoCrm,
  type FerramentaMembro,
  type SessaoFerramenta,
  type RespostaDeApoio,
} from "@/lib/membros/ferramentas";
import CrmDoMembro from "./CrmDoMembro";

export default function FerramentasDoMembro({
  somenteLeitura = false,
  conhecer,
}: {
  somenteLeitura?: boolean;
  conhecer: (produto: string) => void;
}) {
  const { user } = useAuth();
  const [selecionada, setSelecionada] = useState<FerramentaMembro | null>(null);
  const [aviso, setAviso] = useState("");
  const dados = useQuery({
    queryKey: ["membros", "ferramentas", user?.id],
    queryFn: listarFerramentas,
    enabled: !somenteLeitura,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  if (somenteLeitura)
    return (
      <section className="space-y-5">
        <TituloMembros
          titulo="Ferramentas"
          principal
          icone={<Wrench size={19} className="text-primary" />}
        >
          Para testar uma licença, entre com a conta do titular.
        </TituloMembros>
        <p>Ferramentas disponíveis na conta do próprio titular.</p>
      </section>
    );
  if (selecionada && user)
    return (
      <SessaoDaFerramenta
        key={`${user.id}:${selecionada.produto_id}`}
        ferramenta={selecionada}
        usuario={user.id}
        voltar={() => setSelecionada(null)}
      />
    );
  return (
    <section className="space-y-5">
      <TituloMembros
        titulo="Ferramentas"
        principal
        icone={<Wrench size={19} className="text-primary" />}
      >
        A licença de cada ferramenta é individual e tem validade própria.
        Compras e aulas continuam independentes. Ao vencer, o CRM fica guardado
        até você solicitar exclusão.
      </TituloMembros>
      {dados.isPending ? (
        <p role="status">Carregando ferramentas…</p>
      ) : dados.isError ? (
        <div role="alert" className="space-y-3">
          <p>
            Não foi possível carregar as ferramentas. A biblioteca continua
            disponível.
          </p>
          <button className="membros-acao" onClick={() => void dados.refetch()}>
            Tentar novamente
          </button>
        </div>
      ) : !dados.data?.length ? (
        <p className="text-[13px] text-muted-foreground">
          Nenhuma ferramenta disponível no catálogo.
        </p>
      ) : (
        <div className="membros-ferramentas-grade">
          {dados.data.map((f) => (
            <article key={f.produto_id} className="membros-ferramenta">
              <Wrench size={23} className="text-primary" />
              <h2 className="font-semibold">{f.titulo}</h2>
              <p className="text-[12px] text-muted-foreground">
                {f.fim
                  ? `Acesso até ${new Date(f.fim).toLocaleDateString("pt-BR")}`
                  : "Acesso não liberado ou vencido"}
              </p>
              {f.disponivel === false ? (
                <span className="text-[12px]">Ferramenta indisponível</span>
              ) : (
                <button
                  className="membros-acao bg-primary text-primary-foreground"
                  onClick={() =>
                    f.fim ? setSelecionada(f) : conhecer(f.produto_id)
                  }
                >
                  {f.fim ? (
                    "Abrir ferramenta"
                  ) : (
                    <>
                      <LockKeyhole size={15} />
                      Ver produto
                    </>
                  )}
                </button>
              )}
              {f.motor === "crm" && (
                <details className="text-[12px]">
                  <summary className="cursor-pointer py-2">Meus dados</summary>
                  <p>Os registros ficam privados até você pedir exclusão.</p>
                  <button
                    className="membros-acao"
                    onClick={async () => {
                      try {
                        await pedirExclusaoCrm(f.produto_id);
                        setAviso(
                          "Pedido de exclusão registrado para a administração.",
                        );
                      } catch (e) {
                        setAviso(mensagemDoErro(e));
                      }
                    }}
                  >
                    Solicitar exclusão dos meus dados
                  </button>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
      {aviso && (
        <p role="status" className="text-[13px]">
          {aviso}
        </p>
      )}
    </section>
  );
}
function SessaoDaFerramenta({
  ferramenta,
  usuario,
  voltar,
}: {
  ferramenta: FerramentaMembro;
  usuario: string;
  voltar: () => void;
}) {
  const qc = useQueryClient();
  const [prova, setProva] = useState("");
  const tentativa = useRef(0);
  const [sessao, setSessao] = useState<SessaoFerramenta | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const abrir = useCallback(
    async (substituir = false) => {
      const sequencia = ++tentativa.current;
      setOcupado(true);
      setErro("");
      try {
        const compartilhada = await obterProvaCompartilhada(
          usuario,
          ferramenta.produto_id,
        );
        if (!compartilhada)
          throw Error(
            "Permita o armazenamento deste navegador para abrir a ferramenta.",
          );
        const s = await abrirSessaoFerramenta(
          ferramenta.produto_id,
          compartilhada,
          substituir,
        );
        if (sequencia !== tentativa.current) return;
        setProva(compartilhada);
        setSessao(s);
        if (s.conflito)
          qc.removeQueries({
            queryKey: ["membros", "crm", usuario, ferramenta.produto_id],
          });
      } catch (e) {
        if (sequencia !== tentativa.current) return;
        setSessao(null);
        setErro(mensagemDoErro(e));
        qc.removeQueries({
          queryKey: ["membros", "crm", usuario, ferramenta.produto_id],
        });
      } finally {
        if (sequencia === tentativa.current) setOcupado(false);
      }
    },
    [usuario, ferramenta.produto_id, qc],
  );
  useEffect(() => {
    void abrir();
    const t = window.setInterval(() => void abrir(), 60000);
    const foco = () => void abrir();
    window.addEventListener("focus", foco);
    return () => {
      tentativa.current++;
      clearInterval(t);
      window.removeEventListener("focus", foco);
      qc.removeQueries({
        queryKey: ["membros", "crm", usuario, ferramenta.produto_id],
      });
    };
  }, [abrir, qc, usuario, ferramenta.produto_id]);
  return (
    <section className="space-y-4 min-w-0">
      <header className="flex items-center gap-2">
        <button
          className="membros-acao"
          aria-label="Voltar às ferramentas"
          onClick={voltar}
        >
          <ArrowLeft size={17} />
        </button>
        <CabecalhoDePagina titulo={<> {ferramenta.titulo} </>} />
        <AjudaRecolhida rotulo="Sobre a licença e o dispositivo">
          Uma sessão da ferramenta por titular e produto. Abas deste navegador
          compartilham a sessão. Trocar o dispositivo não encerra aulas nem sua
          conta. Acesso até{" "}
          {sessao?.licenca_fim
            ? new Date(sessao.licenca_fim).toLocaleDateString("pt-BR")
            : "a data da licença"}
          .
        </AjudaRecolhida>
      </header>
      {erro ? (
        <div role="alert">
          <p>{erro}</p>
          <button
            className="membros-acao"
            disabled={ocupado}
            onClick={() => void abrir()}
          >
            Abrir novamente
          </button>
        </div>
      ) : !sessao ? (
        <p role="status">Conferindo seu acesso…</p>
      ) : sessao.conflito ? (
        <div className="space-y-4 max-w-lg">
          <Laptop size={24} />
          <p>{sessao.mensagem}</p>
          <button
            className="membros-acao bg-primary text-primary-foreground"
            disabled={ocupado}
            onClick={() => void abrir(true)}
          >
            Continuar neste dispositivo
          </button>
        </div>
      ) : ferramenta.motor === "crm" ? (
        <CrmDoMembro produto={ferramenta.produto_id} prova={prova} />
      ) : (
        <ProximaResposta produto={ferramenta.produto_id} prova={prova} />
      )}
    </section>
  );
}
function ProximaResposta({
  produto,
  prova,
}: {
  produto: string;
  prova: string;
}) {
  const [v, setV] = useState({
    oferta: "",
    situacao: "sem_resposta",
    combinado: "",
    tentativas: 0,
  });
  const [resultado, setResultado] = useState<RespostaDeApoio | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <section className="space-y-5 max-w-4xl">
      <form
        className="grid sm:grid-cols-2 gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setOcupado(true);
          setErro("");
          setResultado(null);
          setMensagem("");
          try {
            const r = await proximaResposta(
              produto,
              prova,
              v.situacao,
              v.oferta,
              v.combinado,
              v.tentativas,
            );
            setResultado(r);
            setMensagem(r.mensagem);
          } catch (erro) {
            setErro(mensagemDoErro(erro));
          } finally {
            setOcupado(false);
          }
        }}
      >
        <label className="text-[12px] space-y-2">
          O que foi oferecido?
          <input
            className="membros-campo"
            required
            maxLength={200}
            value={v.oferta}
            onChange={(e) => setV({ ...v, oferta: e.target.value })}
            placeholder="Ex.: serviço de manutenção, sem dados pessoais"
          />
        </label>
        <label className="text-[12px] space-y-2">
          Situação
          <select
            className="membros-campo"
            value={v.situacao}
            onChange={(e) => setV({ ...v, situacao: e.target.value })}
          >
            <option value="sem_resposta">Orçamento sem resposta</option>
            <option value="duvida">Dúvida sobre a proposta</option>
            <option value="preco">Dúvida sobre o valor</option>
            <option value="recusa">Recusou ou pediu para parar</option>
          </select>
        </label>
        <label className="text-[12px] space-y-2">
          Data combinada para retornar
          <input
            type="date"
            className="membros-campo"
            value={v.combinado}
            onChange={(e) => setV({ ...v, combinado: e.target.value })}
          />
        </label>
        <label className="text-[12px] space-y-2">
          Tentativas desde o orçamento
          <input
            type="number"
            min={0}
            max={20}
            className="membros-campo"
            value={v.tentativas}
            onChange={(e) => setV({ ...v, tentativas: Number(e.target.value) })}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            disabled={ocupado}
            className="membros-acao bg-primary text-primary-foreground"
          >
            <Send size={16} />
            {ocupado ? "Preparando…" : "Preparar próximo passo"}
          </button>
          <AjudaRecolhida rotulo="Como funciona a Próxima Resposta">
            Apoio por regras e modelos de texto, sem chamada paga de IA. Não
            cole dados pessoais nem conversas. A ferramenta não guarda essas
            entradas e nunca envia mensagens. Você revisa o texto antes de usar.
          </AjudaRecolhida>
        </div>
      </form>
      {erro && <p role="alert">{erro}</p>}
      {resultado && (
        <section className="space-y-4" aria-live="polite">
          <h2 className="font-semibold text-[15px]">Próximo passo</h2>
          <p className="text-[13px]">{resultado.orientacao}</p>
          {resultado.mensagem && (
            <>
              <label className="block text-[12px] space-y-2">
                Mensagem para revisar
                <textarea
                  className="membros-campo min-h-32"
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                />
              </label>
              <button
                className="membros-acao"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(mensagem);
                  } catch {
                    setErro(
                      "Não foi possível copiar. Selecione o texto para copiar.",
                    );
                  }
                }}
              >
                <Copy size={15} />
                Copiar mensagem
              </button>
            </>
          )}
          <p className="text-[13px]">{resultado.proximo}</p>
        </section>
      )}
    </section>
  );
}
