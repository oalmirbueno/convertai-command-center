import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { useCatalogo } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoDeErro, Carregando } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataEHora, modeloDoPapel, textoDoErro, usd } from "@/lib/mesa/api";
import {
  convocarConselho,
  estimarConselho,
  lerCatalogoDoConselho,
  NOME_DO_NIVEL,
  NOME_DO_STATUS,
  type SessaoDoConselho,
  useSessoesDoConselho,
} from "@/lib/conselho/api";

/**
 * Convocar o conselho (frente CNS, 30/09): tema e pergunta (o tema vem da
 * mesa de onde a Sala abriu), quem entra, o modelo de cada um, o número FIXO
 * de rodadas e o teto de custo. O custo estimado aparece antes, sem IA; o
 * teto sugerido é a estimativa com folga, e a pessoa pode mudar.
 */
export default function ConvocarConselho({
  clientId,
  origem,
  temaInicial,
  contextoInicial,
  referencia,
  onAbrir,
}: {
  clientId: string;
  origem: string;
  temaInicial: string;
  contextoInicial?: string;
  referencia?: Record<string, unknown> | null;
  onAbrir: (sessaoId: string) => void;
}) {
  const catalogoDoConselho = useQuery({
    queryKey: ["conselho", "catalogo", origem],
    queryFn: () => lerCatalogoDoConselho(origem),
    staleTime: 10 * 60_000,
  });
  const catalogoDeModelos = useCatalogo();
  const sessoes = useSessoesDoConselho(clientId);

  const chave = `conselho:${origem}:${clientId}`;
  // Tema e contexto vêm da tela de onde a Sala abriu (sempre os de agora); a pergunta é rascunho e fica guardada.
  const [tema, setTema] = useState(temaInicial);
  const [pergunta, setPergunta] = useEstadoDaTela<string>(`${chave}:pergunta`, "");
  const [contexto, setContexto] = useState(contextoInicial || "");
  const [escolhidos, setEscolhidos] = useState<string[] | null>(null);
  const [modelos, setModelos] = useState<Record<string, string>>({});
  const [rodadas, setRodadas] = useState("4");
  const [teto, setTeto] = useState<string>("");
  const [tetoMexido, setTetoMexido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cat = catalogoDoConselho.data;
  // O elenco sugerido pela origem até a pessoa mexer.
  const ids = useMemo(() => escolhidos || (cat ? cat.padrao : []), [escolhidos, cat]);
  // Papel "conselho" do catálogo (frente BASE); o servidor manda o mesmo padrão.
  const padraoNaTela = modeloDoPapel(catalogoDeModelos.data || [], "conselho");
  const padraoDoModelo = (cat && cat.modelo_padrao) || (padraoNaTela ? padraoNaTela.id : "");
  const modelosEfetivos = useMemo(() => {
    const r: Record<string, string> = {};
    ids.forEach((id) => {
      const escolhido = modelos[id] ? modeloDoPapel(catalogoDeModelos.data || [], "conselho", modelos[id]) : null;
      r[id] = (escolhido && escolhido.id === modelos[id] ? modelos[id] : "") || padraoDoModelo;
    });
    return r;
  }, [ids, modelos, padraoDoModelo, catalogoDeModelos.data]);

  const min = cat ? cat.limites.min_especialistas : 2;
  const max = cat ? cat.limites.max_especialistas : 6;
  const podeEstimar = !!cat && ids.length >= min && ids.length <= max && ids.every((id) => !!modelosEfetivos[id]);
  const estimativa = useQuery({
    queryKey: ["conselho", "estimar", clientId, origem, ids.join(","), JSON.stringify(modelosEfetivos), rodadas],
    enabled: podeEstimar,
    queryFn: () => estimarConselho({ clientId, origem, especialistas: ids, modelos: modelosEfetivos, rodadas: Number(rodadas) }),
    staleTime: 60_000,
  });
  const total = estimativa.data ? estimativa.data.estimativa.total_usd : null;

  // Teto sugerido acompanha a estimativa até a pessoa digitar o dela.
  useEffect(() => {
    if (!tetoMexido && estimativa.data) setTeto(String(estimativa.data.teto_sugerido_usd));
  }, [estimativa.data, tetoMexido]);

  const alternar = (id: string) => {
    const atual = ids.slice();
    const i = atual.indexOf(id);
    if (i >= 0) atual.splice(i, 1);
    else if (atual.length < max) atual.push(id);
    setEscolhidos(atual);
  };

  const tetoNumero = Number(String(teto).replace(",", "."));
  const tetoBaixo = total !== null && isFinite(tetoNumero) && tetoNumero < total;
  const pronto = podeEstimar && tema.trim().length >= 3 && pergunta.trim().length >= 3 && total !== null && isFinite(tetoNumero) && tetoNumero > 0 && !tetoBaixo;

  const convocar = async () => {
    if (!pronto || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await convocarConselho({
        clientId,
        origem,
        referencia: referencia || null,
        tema: tema.trim(),
        pergunta: pergunta.trim(),
        contexto: contexto.trim(),
        especialistas: ids,
        modelos: modelosEfetivos,
        rodadas: Number(rodadas),
        teto_usd: tetoNumero,
      });
      setPergunta("");
      void sessoes.refetch();
      onAbrir(r.sessao.id);
    } catch (e) {
      // O pedido fica no campo: nada se perde.
      setErro(textoDoErro(e));
    } finally {
      setEnviando(false);
    }
  };

  if (catalogoDoConselho.isLoading) return <Carregando forma="aba" rotulo="Abrindo o conselho" />;
  if (catalogoDoConselho.isError || !cat) {
    return <EstadoDeErro titulo="O conselho não abriu." descricao={textoDoErro(catalogoDoConselho.error)} acao={<button type="button" className={botao.secundario} onClick={() => void catalogoDoConselho.refetch()}>Tentar de novo</button>} />;
  }

  const anteriores = (sessoes.data || []) as SessaoDoConselho[];

  return (
    <div className="min-w-0 space-y-6" data-convocar-conselho="">
      <Secao
        titulo="Convocar"
        recolher={false}
        ajuda="Cada especialista responde sozinho, depois critica os outros com nota de 1 a 10, revisa e o Jev mede o consenso. O número de rodadas é fixo e o custo nunca passa do teto."
      >
        <div className="min-w-0 space-y-4">
          <GrupoDeCampos colunas={1}>
            <CampoDeFormulario rotulo="Tema">
              <input className={campo} value={tema} maxLength={300} onChange={(e) => setTema(e.target.value)} aria-label="Tema" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Pergunta">
              <textarea
                className={campoTexto}
                value={pergunta}
                maxLength={4000}
                rows={3}
                placeholder="O que o conselho precisa decidir?"
                onChange={(e) => setPergunta(e.target.value)}
                aria-label="Pergunta"
              />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Contexto da mesa" ajuda="O que a mesa já mostrou. O retrato do cliente (cérebro, dossiê e decisões anteriores) entra sozinho.">
              <textarea className={campoTexto} value={contexto} maxLength={8000} rows={2} onChange={(e) => setContexto(e.target.value)} aria-label="Contexto da mesa" />
            </CampoDeFormulario>
          </GrupoDeCampos>

          <div className="min-w-0">
            <div className="flex items-center justify-between">
              <span className={texto.rotulo}>Especialistas</span>
              <span className={texto.auxiliar}>{ids.length} de {max}</span>
            </div>
            <div className="mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Quem entra no conselho">
              {cat.especialistas.map((e) => {
                const dentro = ids.indexOf(e.id) >= 0;
                return (
                  <button
                    key={e.id}
                    type="button"
                    aria-pressed={dentro}
                    title={`${e.visao}. Critério: ${e.criterio}.`}
                    onClick={() => alternar(e.id)}
                    disabled={!dentro && ids.length >= max}
                    className={juntar(
                      "toque-compacto min-w-0 rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-50",
                      dentro ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                    )}
                    data-especialista={e.id}
                  >
                    <span className="block truncate text-[13px] font-medium text-foreground">{e.nome}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{e.area}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {ids.length > 0 && (
            <GrupoDeCampos colunas={3}>
              {ids.map((id) => {
                const e = cat.especialistas.find((x) => x.id === id);
                return (
                  <SeletorDeModelo
                    key={id}
                    catalogo={catalogoDeModelos.data || []}
                    tipo="texto"
                    rotulo={e ? e.nome : id}
                    valor={modelosEfetivos[id] || ""}
                    onChange={(m) => setModelos((x) => ({ ...x, [id]: m }))}
                  />
                );
              })}
            </GrupoDeCampos>
          )}

          <div className="grid min-w-0 grid-cols-1 items-end gap-4 sm:grid-cols-2">
            <CampoDeFormulario rotulo="Rodadas" ajuda="2: propostas e consolidação. 3: com crítica cruzada. 4: com crítica e revisão.">
              <SeletorCompacto
                rotulo="Rodadas"
                valor={rodadas}
                onEscolher={setRodadas}
                opcoes={[
                  { valor: "2", rotulo: "2" },
                  { valor: "3", rotulo: "3" },
                  { valor: "4", rotulo: "4" },
                ]}
              />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Teto (US$)" erro={tetoBaixo ? `Abaixo do custo estimado (${usd(total)}).` : undefined}>
              <input
                className={campo}
                inputMode="decimal"
                value={teto}
                onChange={(e) => {
                  setTetoMexido(true);
                  setTeto(e.target.value);
                }}
                aria-label="Teto de custo da sessão em dólares"
              />
            </CampoDeFormulario>
          </div>

          {erro && <p className="text-[13px] text-destructive" role="alert">{erro}</p>}

          <div className="flex min-w-0 flex-wrap items-center justify-end">
            <span className={juntar(texto.auxiliar, "mr-3")} data-estimativa-do-conselho="">
              {estimativa.isFetching ? "Calculando o custo..." : total !== null ? `Custo estimado ${usd(total)}` : estimativa.isError ? textoDoErro(estimativa.error) : ""}
            </span>
            <button type="button" className={botao.primario} disabled={!pronto || enviando} onClick={() => void convocar()}>
              {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Users className="mr-2 h-4 w-4" aria-hidden="true" />}
              Convocar o conselho
            </button>
          </div>
        </div>
      </Secao>

      {anteriores.length > 0 && (
        <Secao titulo="Sessões" descricao={`${anteriores.length} deste cliente`} recolher={`conselho:sessoes:${clientId}`}>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {anteriores.map((s) => (
              <li key={s.id}>
                <button type="button" className={juntar(lista.linha, "w-full text-left")} onClick={() => onAbrir(s.id)} data-sessao-anterior={s.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">{s.tema}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {dataEHora(s.criado_em)} · {NOME_DO_STATUS[s.status]}
                      {s.resultado ? ` · ${NOME_DO_NIVEL[s.resultado.nivel]}` : ""}
                      {s.decisao && !s.decisao.desfeita_em ? " · decidida" : ""}
                    </span>
                  </span>
                  <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{usd(s.custo_usd)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  );
}
