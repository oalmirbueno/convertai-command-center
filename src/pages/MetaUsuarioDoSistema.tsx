import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RotateCcw, ShieldCheck } from "lucide-react";
import {
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Secao,
  botao,
  campo,
  espaco,
  etiqueta,
  juntar,
  larguraDaMesa,
  superficie,
  texto,
} from "@/components/sistema";
import {
  ROTULO_DO_MOTIVO,
  aplicarContas,
  casarContas,
  conferirToken,
  desfazerLote,
  guardarToken,
  lerEstado,
  textoDoPrazo,
  type ConferenciaPublica,
  type ItemDaPrevia,
  type PaginaVista,
  type ResultadoPorConta,
} from "@/lib/config/metaUsuarioDoSistema";

/*
 * Meta pelo usuário do sistema (27/10/2026). Só o admin (rota e função de
 * borda). O token do usuário do sistema da BM Aceleriq é colado aqui uma vez,
 * conferido pela Meta (debug_token) e vai direto para o cofre; esta tela
 * nunca recebe o token de volta. Depois: conferir as páginas que ele enxerga,
 * ver a prévia do casamento com as contas dos clientes e trocar as conexões
 * de login (que vencem a cada 90 dias) pelas do usuário do sistema, com
 * desfazer por lote.
 */

const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

function Conferencia({ c }: { c: ConferenciaPublica }) {
  return (
    <div className={juntar(superficie.poco, "space-y-2 p-3")} data-conferencia="">
      <p className={juntar(texto.corpo, "flex items-center font-medium")}>
        {c.aprovado ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" aria-hidden="true" /> : <AlertTriangle className="mr-2 h-4 w-4 text-amber-500" aria-hidden="true" />}
        {c.aprovado ? "Token aprovado" : "Token com problema"}
      </p>
      <p className={texto.auxiliar}>
        Tipo {c.tipo || "—"} · app {c.app_confere ? "do painel" : "diferente"} · {c.nunca_vence ? "não vence" : `vence ${dataHora(c.expira_em || c.acesso_aos_dados_expira_em)}`} · usuário {c.meta_user_id || "—"}
      </p>
      {c.problemas.length > 0 && (
        <ul className={juntar(texto.corpo, "list-disc pl-5")}>
          {c.problemas.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {c.recomendados_faltando.length > 0 && (
        <p className={texto.auxiliar}>Recomendadas que faltam: {c.recomendados_faltando.join(", ")}.</p>
      )}
      <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>Permissões: {c.escopos.join(", ") || "nenhuma"}</p>
    </div>
  );
}

function ListaDePaginas({ paginas }: { paginas: PaginaVista[] }) {
  if (!paginas.length) return <EstadoVazio titulo="O token não enxerga nenhuma página." />;
  return (
    <ul className="min-w-0 divide-y divide-border border-y border-border" data-paginas="">
      {paginas.map((p) => (
        <li key={p.page_id} className="flex min-w-0 flex-wrap items-center py-2">
          <span className={juntar(texto.corpo, "mr-3 min-w-0 truncate font-medium")}>{p.nome}</span>
          <span className={juntar(texto.auxiliar, "mr-3")}>{p.instagram ? `@${p.instagram.username || p.instagram.id}` : "sem Instagram"}</span>
          <span className={juntar(etiqueta, p.tem_token_de_pagina ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600")}>
            {p.tem_token_de_pagina ? "token de página" : "sem token de página"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LinhaDaPrevia({ item, marcado, onMarcar }: { item: ItemDaPrevia; marcado: boolean; onMarcar: (v: boolean) => void }) {
  const atual = item.concessao_atual;
  const origem = atual.origem === "usuario_do_sistema" ? "usuário do sistema" : atual.origem === "oauth_usuario" ? "login" : "sem conexão";
  return (
    <li className="flex min-w-0 flex-wrap items-center py-2" data-item-previa={item.external_account_id}>
      <input
        type="checkbox"
        className="mr-3 h-4 w-4 shrink-0"
        checked={marcado}
        disabled={!item.pode_aplicar}
        onChange={(e) => onMarcar(e.target.checked)}
        aria-label={`Trocar ${item.perfil}`}
      />
      <span className={juntar(texto.corpo, "mr-3 min-w-0 truncate font-medium")}>{item.cliente || "—"}</span>
      <span className={juntar(texto.corpo, "mr-3 min-w-0 truncate")}>{item.plataforma === "instagram" ? "Instagram" : "Facebook"} {item.perfil}</span>
      <span className={juntar(texto.auxiliar, "mr-3")}>{origem}, {textoDoPrazo(atual.vence_em)}</span>
      <span className={juntar(etiqueta, item.pode_aplicar ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
        {item.encontrada ? ROTULO_DO_MOTIVO[item.motivo] || item.motivo : ROTULO_DO_MOTIVO.nao_encontrada}
      </span>
    </li>
  );
}

function ResultadoDoLote({ contas, nomes }: { contas: ResultadoPorConta[]; nomes: Map<string, string> }) {
  const problemas = contas.filter((c) => c.aplicado === false || c.desfeito === false);
  if (!problemas.length) return null;
  return (
    <ul className={juntar(texto.auxiliar, "list-disc pl-5")}>
      {problemas.map((c, i) => (
        <li key={`${c.external_account_id || "x"}-${i}`}>
          {(c.external_account_id && nomes.get(c.external_account_id)) || c.external_account_id || "conta"}: {ROTULO_DO_MOTIVO[c.motivo || ""] || c.motivo}
        </li>
      ))}
    </ul>
  );
}

export default function MetaUsuarioDoSistema() {
  const fila = useQueryClient();
  const estado = useQuery({ queryKey: ["meta-usuario-do-sistema", "estado"], queryFn: lerEstado, staleTime: 30_000 });
  const [token, setToken] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conferencia, setConferencia] = useState<ConferenciaPublica | null>(null);
  const [paginas, setPaginas] = useState<PaginaVista[] | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [previa, setPrevia] = useState<ItemDaPrevia[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoPorConta[]>([]);
  const [confirmando, setConfirmando] = useState(false);

  const nomes = useMemo(
    () => new Map((previa || []).map((i) => [i.external_account_id, `${i.cliente || "—"} ${i.perfil}`])),
    [previa],
  );

  async function rodar(rotulo: string, fn: () => Promise<void>) {
    setOcupado(rotulo);
    setErro(null);
    setAviso(null);
    try {
      await fn();
    } catch (e) {
      const c = (e as { conferencia?: ConferenciaPublica }).conferencia;
      if (c) setConferencia(c);
      setErro(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setOcupado(null);
    }
  }

  const guardar = () =>
    rodar("guardar", async () => {
      const valor = token.trim();
      setToken("");
      const r = await guardarToken(valor);
      setConferencia(r.conferencia);
      setAviso("Token conferido e guardado no cofre.");
      await fila.invalidateQueries({ queryKey: ["meta-usuario-do-sistema", "estado"] });
    });

  const conferir = () =>
    rodar("conferir", async () => {
      const r = await conferirToken();
      setConferencia(r.conferencia);
      setPaginas(r.paginas);
      setAvisos(r.avisos || []);
    });

  const verPrevia = () =>
    rodar("casar", async () => {
      const r = await casarContas();
      setConferencia(r.conferencia);
      setPrevia(r.itens);
      setAvisos(r.avisos || []);
      setMarcadas(new Set(r.itens.filter((i) => i.pode_aplicar).map((i) => i.external_account_id)));
      setConfirmando(false);
    });

  const aplicar = () =>
    rodar("aplicar", async () => {
      const r = await aplicarContas([...marcadas]);
      setUltimoResultado(r.resultado.contas || []);
      setAviso(`${r.resultado.aplicadas} ${r.resultado.aplicadas === 1 ? "conta trocada" : "contas trocadas"} para o usuário do sistema.`);
      setConfirmando(false);
      await fila.invalidateQueries({ queryKey: ["meta-usuario-do-sistema", "estado"] });
      const nova = await casarContas();
      setPrevia(nova.itens);
      setMarcadas(new Set(nova.itens.filter((i) => i.pode_aplicar).map((i) => i.external_account_id)));
    });

  const desfazer = (loteId: string) =>
    rodar(`desfazer-${loteId}`, async () => {
      const r = await desfazerLote(loteId);
      setUltimoResultado(r.resultado.contas || []);
      setAviso(`${r.resultado.desfeitas} ${r.resultado.desfeitas === 1 ? "conta voltou" : "contas voltaram"} para a conexão anterior.`);
      await fila.invalidateQueries({ queryKey: ["meta-usuario-do-sistema", "estado"] });
      setPrevia(null);
    });

  const e = estado.data?.estado;

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina)} data-meta-usuario-do-sistema="">
      <CabecalhoDePagina titulo="Meta pelo usuário do sistema" />

      {erro && <p role="alert" className={juntar(texto.corpo, "text-destructive")}>{erro}</p>}
      {aviso && <p role="status" className={juntar(texto.corpo, "text-emerald-600")}>{aviso}</p>}

      <Secao
        titulo="Token"
        descricao={e?.guardado ? `Guardado em ${dataHora(e.guardado_em)}, conferido em ${dataHora(e.conferido_em)}` : "Nenhum token guardado"}
        ajuda="Gere na BM Aceleriq (Configurações do negócio, Usuários do sistema, Aceleriq Trafego, Gerar token) escolhendo o app do painel e validade Nunca. O token vai direto para o cofre e não aparece de novo aqui."
      >
        {estado.isLoading ? (
          <Carregando rotulo="Lendo o estado" linhas={2} />
        ) : estado.isError ? (
          <EstadoDeErro titulo="Não consegui ler o estado." descricao={estado.error instanceof Error ? estado.error.message : undefined} />
        ) : (
          <div className="min-w-0 space-y-3">
            {e?.guardado && (
              <p className={texto.auxiliar}>Usuário {e.meta_user_id} · app {e.app_id} · BM {e.business_id || "—"}</p>
            )}
            <form
              className="flex min-w-0 flex-wrap items-center"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (token.trim()) void guardar();
              }}
            >
              <label htmlFor="token-usuario-do-sistema" className="sr-only">Token do usuário do sistema</label>
              <input
                id="token-usuario-do-sistema"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={juntar(campo, "mb-2 mr-2 max-w-xl flex-1")}
                placeholder={e?.guardado ? "Colar um token novo para trocar" : "Colar o token do usuário do sistema"}
                value={token}
                onChange={(ev) => setToken(ev.target.value)}
              />
              <button type="submit" className={juntar(botao.primario, "mb-2")} disabled={!token.trim() || !!ocupado}>
                <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {ocupado === "guardar" ? "Conferindo..." : "Conferir e guardar"}
              </button>
            </form>
            {conferencia && <Conferencia c={conferencia} />}
          </div>
        )}
      </Secao>

      <Secao
        titulo="Páginas que o token enxerga"
        descricao={paginas ? `${paginas.length} ${paginas.length === 1 ? "página" : "páginas"}` : undefined}
        acao={<button type="button" className={botao.secundario} onClick={() => void conferir()} disabled={!e?.guardado || !!ocupado}>{ocupado === "conferir" ? "Conferindo..." : "Conferir"}</button>}
        divisoria
      >
        {avisos.length > 0 && <ul className={juntar(texto.auxiliar, "mb-2 list-disc pl-5")}>{avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
        {paginas && <ListaDePaginas paginas={paginas} />}
      </Secao>

      <Secao
        titulo="Prévia da troca"
        descricao={previa ? `${previa.filter((i) => i.pode_aplicar).length} prontas de ${previa.length} contas` : undefined}
        acao={<button type="button" className={botao.secundario} onClick={() => void verPrevia()} disabled={!e?.guardado || !!ocupado}>{ocupado === "casar" ? "Cruzando..." : "Ver prévia"}</button>}
        ajuda="Cada perfil do Instagram e página do Facebook dos clientes, cruzado pelo id com o que o token enxerga. Só as prontas podem ser trocadas; a conexão antiga fica guardada para desfazer."
        divisoria
      >
        {previa && (
          <div className="min-w-0 space-y-3">
            {previa.length === 0 ? (
              <EstadoVazio titulo="Nenhuma conta de Instagram ou Facebook no painel." />
            ) : (
              <ul className="min-w-0 divide-y divide-border border-y border-border">
                {previa.map((item) => (
                  <LinhaDaPrevia
                    key={item.external_account_id}
                    item={item}
                    marcado={marcadas.has(item.external_account_id)}
                    onMarcar={(v) =>
                      setMarcadas((atual) => {
                        const nova = new Set(atual);
                        if (v) nova.add(item.external_account_id);
                        else nova.delete(item.external_account_id);
                        return nova;
                      })
                    }
                  />
                ))}
              </ul>
            )}
            {marcadas.size > 0 && (
              <div className="flex min-w-0 flex-wrap items-center">
                {!confirmando ? (
                  <button type="button" className={botao.primario} onClick={() => setConfirmando(true)} disabled={!!ocupado}>
                    Trocar {marcadas.size} {marcadas.size === 1 ? "conta" : "contas"}
                  </button>
                ) : (
                  <>
                    <span className={juntar(texto.corpo, "mb-2 mr-3")}>Trocar {marcadas.size} {marcadas.size === 1 ? "conta" : "contas"} para o usuário do sistema?</span>
                    <button type="button" className={juntar(botao.primario, "mb-2 mr-2")} onClick={() => void aplicar()} disabled={!!ocupado}>
                      {ocupado === "aplicar" ? "Trocando..." : "Confirmar"}
                    </button>
                    <button type="button" className={juntar(botao.discreto, "mb-2")} onClick={() => setConfirmando(false)} disabled={!!ocupado}>Cancelar</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <ResultadoDoLote contas={ultimoResultado} nomes={nomes} />
      </Secao>

      <Secao titulo="Trocas feitas" descricao={e?.lotes?.length ? `${e.lotes.length} ${e.lotes.length === 1 ? "lote" : "lotes"}` : "Nenhuma"} divisoria>
        {e?.lotes?.length ? (
          <ul className="min-w-0 divide-y divide-border border-y border-border" data-lotes="">
            {e.lotes.map((l) => (
              <li key={l.lote_id} className="flex min-w-0 flex-wrap items-center py-2">
                <span className={juntar(texto.corpo, "mr-3")}>{dataHora(l.aplicado_em)}</span>
                <span className={juntar(texto.auxiliar, "mr-3 min-w-0 flex-1")}>
                  {l.contas} {l.contas === 1 ? "conta" : "contas"} · {l.ativas} no usuário do sistema · {l.desfeitas} desfeitas
                </span>
                {l.ativas > 0 && (
                  <button type="button" className={botao.discreto} onClick={() => void desfazer(l.lote_id)} disabled={!!ocupado}>
                    <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {ocupado === `desfazer-${l.lote_id}` ? "Desfazendo..." : "Desfazer"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Secao>
    </div>
  );
}
