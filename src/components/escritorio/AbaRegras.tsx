import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Inbox, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { tabela } from "@/components/finance/pecasDoFinanceiro";
import { Chip } from "@/components/ds";
import { CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, JanelaCentral, Painel, Secao, botao, campo, campoTexto, espaco, juntar, texto } from "@/components/sistema";
import { Switch } from "@/components/ui/switch";
import { haQuanto } from "@/lib/gruposAoVivo";
import { mensagemDoErroDoEscritorio } from "@/lib/escritorio/acessos";
import { CAMPOS_DA_REGRA, fraseDeUsos, modelosDaRegra, podeLigar, quemUsaARegra, usosNestaSemana, validarLimites } from "@/lib/escritorio/regras";
import type { AgenteDoEscritorio, FilaDasRegras, RegraPermanente, UsoDeRegra } from "@/lib/escritorio/tipos";
import { CHAVES, ajustarRegra, limparFilaDasRegras, useRegras } from "./escritorioApi";

/**
 * Regras do Escritório: o que cada agente pode fazer sozinho, até onde, e o
 * que sempre sobe para o dono. O dono liga e desliga a regra, ajusta os
 * limites e tira da caixa os pedidos antigos que já cabem nas regras de hoje.
 * O resto da equipe só vê.
 */

const SEMPRE_SOBE = [
  "Gasto acima do teto ou recarga",
  "Cliente novo",
  "Preço e negociação",
  "Reclamação",
  "Peça rejeitada mais de uma vez",
  "Mudança de rumo",
  "Financeiro, permissões e exclusão de dados",
];

const DICA_DOS_COLCHETES = "O agente só pode trocar o que está entre colchetes, como [nome do cliente].";

const reais = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const emPalavras = (codigo: string | null) => (codigo ? codigo.replace(/_/g, " ") : "sem ação");

/** Os limites do jeito que o formulário guarda: número vira texto, para a pessoa poder apagar e digitar. */
function paraRascunho(regra: RegraPermanente): Record<string, unknown> {
  const rascunho: Record<string, unknown> = { ...(regra.limites ?? {}) };
  for (const c of CAMPOS_DA_REGRA[regra.chave] ?? []) rascunho[c.chave] = rascunho[c.chave] === null || rascunho[c.chave] === undefined ? "" : String(rascunho[c.chave]);
  return rascunho;
}

function CartaoDaRegra({
  regra,
  usadaNaSemana,
  ultimos,
  nomeDoAgente,
  agora,
  admin,
  ocupado,
  aoAlternar,
  aoSalvar,
}: {
  regra: RegraPermanente;
  usadaNaSemana: number;
  ultimos: UsoDeRegra[];
  nomeDoAgente: (slug: string) => string;
  agora: number;
  admin: boolean;
  ocupado: boolean;
  aoAlternar: (regra: RegraPermanente, ligar: boolean) => void;
  aoSalvar: (regra: RegraPermanente, limites: Record<string, unknown>) => Promise<boolean>;
}) {
  const campos = CAMPOS_DA_REGRA[regra.chave] ?? [];
  const original = useMemo(() => paraRascunho(regra), [regra]);
  const assinatura = JSON.stringify(original);
  const [rascunho, setRascunho] = useState<Record<string, unknown>>(original);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [usosAbertos, setUsosAbertos] = useState(false);
  // Limites novos do banco (outro salvou, ou este salvar voltou): o formulário acompanha.
  useEffect(() => { setRascunho(JSON.parse(assinatura)); setErros({}); }, [assinatura]);

  const modelos = modelosDaRegra(rascunho);
  const temLimites = campos.length > 0 || modelos.length > 0;
  const mudou = JSON.stringify(rascunho) !== assinatura;
  const ligar = podeLigar(regra);
  const quem = quemUsaARegra(regra.operadores, nomeDoAgente);

  const mudarModelo = (chave: string, textoNovo: string) => {
    const atuais = (rascunho.modelos ?? {}) as Record<string, { nome?: string; texto?: string }>;
    setRascunho({ ...rascunho, modelos: { ...atuais, [chave]: { ...atuais[chave], texto: textoNovo } } });
  };
  const salvar = () => {
    const r = validarLimites(regra.chave, rascunho, { ligada: regra.ligada });
    if (!r.ok) { setErros(r.erros); return; }
    setErros({});
    void aoSalvar(regra, r.limites);
  };

  return (
    <Painel
      as="section"
      aria-label={regra.nome}
      titulo={regra.nome}
      descricao={[regra.area, fraseDeUsos(usadaNaSemana)].filter(Boolean).join(" · ")}
      ajuda={regra.descricao || undefined}
      recolher={false}
      data-regra={regra.chave}
      acao={admin ? (
        <label className="flex min-w-0 items-center text-[13px] text-foreground">
          <Switch
            className="mr-2"
            checked={regra.ligada}
            disabled={ocupado || (!regra.ligada && !ligar.pode)}
            aria-label={`Regra ${regra.nome}`}
            onCheckedChange={(v) => aoAlternar(regra, v)}
          />
          {regra.ligada ? "Ligada" : "Desligada"}
        </label>
      ) : (
        <Chip tone={regra.ligada ? "success" : "neutral"} dot>{regra.ligada ? "Ligada" : "Desligada"}</Chip>
      )}
    >
      {!regra.ligada && !ligar.pode && <p className={juntar(texto.corpo, "mb-2 text-warning")} data-falta="">{ligar.motivo}</p>}
      <p className={texto.auxiliar} data-quem="">Quem usa: {quem}</p>

      {temLimites && (
        <div className="mt-4 border-t border-border pt-4" data-limites="">
          {admin ? (
            <>
              <GrupoDeCampos colunas={2}>
                {campos.map((c) => (
                  <CampoDeFormulario key={c.chave} rotulo={c.rotulo} apoio={`De ${c.min} a ${c.max}`} erro={erros[c.chave]}>
                    <input
                      className={campo}
                      inputMode={c.inteiro ? "numeric" : "decimal"}
                      value={String(rascunho[c.chave] ?? "")}
                      disabled={ocupado}
                      onChange={(e) => setRascunho({ ...rascunho, [c.chave]: e.target.value })}
                    />
                  </CampoDeFormulario>
                ))}
                {modelos.map((m) => (
                  <CampoDeFormulario key={m.chave} rotulo={`Texto: ${m.nome}`} apoio={DICA_DOS_COLCHETES} erro={erros[`modelo:${m.chave}`]} largo>
                    <textarea className={campoTexto} value={m.texto} disabled={ocupado} onChange={(e) => mudarModelo(m.chave, e.target.value)} />
                  </CampoDeFormulario>
                ))}
              </GrupoDeCampos>
              <div className="mt-3 flex min-w-0 justify-end">
                <button type="button" className={botao.secundario} disabled={ocupado || !mudou} aria-label={`Salvar limites de ${regra.nome}`} onClick={salvar}>Salvar limites</button>
              </div>
            </>
          ) : (
            <dl className="min-w-0 space-y-2">
              {campos.map((c) => (
                <div key={c.chave} className="flex min-w-0 items-baseline">
                  <dt className={juntar(texto.rotulo, "mr-2")}>{c.rotulo}</dt>
                  <dd className={juntar(texto.corpo, "tabular-nums")}>{String(rascunho[c.chave] ?? "") || "sem valor"}</dd>
                </div>
              ))}
              {modelos.map((m) => (
                <div key={m.chave} className="min-w-0">
                  <dt className={texto.rotulo}>Texto: {m.nome}</dt>
                  <dd className={juntar(texto.corpo, "whitespace-pre-wrap", !m.texto.trim() && "text-muted-foreground")}>{m.texto.trim() || "Sem texto ainda"}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3" data-usos="">
        {ultimos.length === 0 ? (
          <p className={texto.auxiliar}>Nenhum uso registrado ainda.</p>
        ) : (
          <>
            <button type="button" className={juntar(botao.discreto, "-ml-2 h-8")} aria-expanded={usosAbertos} onClick={() => setUsosAbertos(!usosAbertos)}>
              <ChevronDown className={juntar("mr-1.5 h-4 w-4 transition-transform", !usosAbertos && "-rotate-90")} aria-hidden="true" />
              {ultimos.length === 1 ? "Último uso" : `Últimos ${ultimos.length} usos`}
            </button>
            {usosAbertos && (
              <ul className="mt-1 min-w-0 divide-y divide-border/50" aria-label={`Últimos usos de ${regra.nome}`}>
                {ultimos.map((u) => (
                  <li key={u.id} className="flex min-w-0 flex-wrap items-baseline py-2">
                    <span className={juntar(texto.corpo, "mr-2 font-medium")}>{u.operator_slug ? nomeDoAgente(u.operator_slug) : "Agente não informado"}</span>
                    <span className={juntar(texto.corpo, "mr-2 min-w-0 flex-1 text-muted-foreground")}>{emPalavras(u.action_kind)}</span>
                    {u.valor !== null && u.valor !== undefined && <span className={juntar(texto.corpo, "mr-2 tabular-nums")}>{reais(Number(u.valor))}</span>}
                    <span className={juntar(texto.auxiliar, "whitespace-nowrap tabular-nums")}>{haQuanto(u.usado_em, agora)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Painel>
  );
}

function JanelaDeConfirmar({ aberta, titulo, confirmar, desistir, ocupado, aoFechar, aoConfirmar, children }: { aberta: boolean; titulo: string; confirmar: string; desistir: string; ocupado: boolean; aoFechar: () => void; aoConfirmar: () => void; children: ReactNode }) {
  if (!aberta) return null;
  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      titulo={titulo}
      icone={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
      largura="sm"
      rodape={
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end">
          <button type="button" className={botao.secundario} disabled={ocupado} onClick={aoFechar}>{desistir}</button>
          <button type="button" className={juntar(botao.primario, "ml-2")} disabled={ocupado} onClick={aoConfirmar}>{confirmar}</button>
        </div>
      }
    >
      {children}
    </JanelaCentral>
  );
}

export default function AbaRegras({ agentes, admin, agora }: { agentes: AgenteDoEscritorio[]; admin: boolean; agora: number }) {
  const qc = useQueryClient();
  const q = useRegras();
  const [ocupado, setOcupado] = useState(false);
  const [ligando, setLigando] = useState<RegraPermanente | null>(null);
  const [previa, setPrevia] = useState<FilaDasRegras | null>(null);
  const [tirando, setTirando] = useState(false);

  const nomeDoAgente = (slug: string) => agentes.find((a) => a.slug === slug)?.display_name ?? slug;

  /** Faz, avisa e relê. Devolve se deu certo (a janela só fecha quando deu). */
  const rodar = async (acao: () => Promise<string | null>): Promise<boolean> => {
    if (ocupado) return false;
    setOcupado(true);
    try {
      const feito = await acao();
      if (feito) toast.success(feito);
      await qc.invalidateQueries({ queryKey: CHAVES.regras });
      return true;
    } catch (e) {
      toast.error(mensagemDoErroDoEscritorio(e, "Não foi possível salvar."));
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const alternar = (regra: RegraPermanente, ligar: boolean) => {
    if (ligar) { setLigando(regra); return; }
    void rodar(async () => { await ajustarRegra(regra.chave, false, null); return `${regra.nome}: desligada.`; });
  };
  const salvar = (regra: RegraPermanente, limites: Record<string, unknown>) =>
    rodar(async () => { await ajustarRegra(regra.chave, null, limites); return `Limites de ${regra.nome} salvos.`; });
  const verFila = () => void rodar(async () => { setPrevia(await limparFilaDasRegras(false)); return null; });

  if (q.isLoading) return <Carregando rotulo="Lendo as regras" forma="grade" />;
  if (q.error) return <EstadoDeErro titulo="Não foi possível ler as regras." descricao={(q.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />;
  const regras = q.data?.regras ?? [];
  const daSemana = q.data?.daSemana ?? [];
  const nomeDaRegra = (chave: string) => regras.find((r) => r.chave === chave)?.nome ?? chave;
  const itens = previa?.itens ?? [];
  const total = Number(previa?.total ?? itens.length);
  const quantos = total === 1 ? "este 1" : `estes ${total}`;

  return (
    <div className={espaco.pagina} data-regras-do-escritorio="">
      {regras.length === 0 ? (
        <EstadoVazio icone={<ShieldCheck className="h-5 w-5" />} titulo="Nenhuma regra cadastrada ainda." />
      ) : (
        <div className={juntar(espaco.grade, "items-start lg:grid-cols-2")}>
          {regras.map((regra) => (
            <CartaoDaRegra
              key={regra.chave}
              regra={regra}
              usadaNaSemana={usosNestaSemana(daSemana, regra.chave, agora)}
              ultimos={q.data?.ultimos[regra.chave] ?? []}
              nomeDoAgente={nomeDoAgente}
              agora={agora}
              admin={admin}
              ocupado={ocupado}
              aoAlternar={alternar}
              aoSalvar={salvar}
            />
          ))}
        </div>
      )}

      <Secao titulo="Sempre sobe para você" ajuda="Dentro da regra, o agente faz sozinho e fica registrado. Fora dela, sobe para você." recolher={false} divisoria data-sempre-sobe="">
        <ul className="flex min-w-0 flex-wrap [&>li]:mb-2 [&>li]:mr-2" aria-label="Sempre sobe para você">
          {SEMPRE_SOBE.map((item) => <li key={item}><Chip size="md" tone="warning">{item}</Chip></li>)}
        </ul>
      </Secao>

      <Secao
        titulo="Limpar a fila"
        recolher={false}
        divisoria
        ajuda="Pedidos antigos que estão na caixa e que hoje o agente já faria sozinho, dentro das regras ligadas. Primeiro você vê a lista. Só saem da caixa quando você confirmar."
        data-limpar-a-fila=""
        acao={admin ? <button type="button" className={botao.secundario} disabled={ocupado} onClick={verFila}>Ver o que sairia da caixa</button> : undefined}
      >
        {!admin ? (
          <p className={texto.auxiliar}>Só o dono limpa a fila.</p>
        ) : !previa ? null : total === 0 ? (
          <EstadoVazio compacto icone={<Inbox className="h-5 w-5" />} titulo="Nenhum pedido antigo cabe nas regras de hoje." />
        ) : (
          <>
            <div className={tabela.moldura}>
              <table className={juntar(tabela.tabela, "min-w-[760px]")} aria-label="Pedidos que sairiam da caixa">
                <thead className={tabela.cabeca}>
                  <tr>
                    <th>Regra</th>
                    <th>Agente</th>
                    <th>Ação</th>
                    <th>O que</th>
                    <th>Quando</th>
                  </tr>
                </thead>
                <tbody className={tabela.corpo}>
                  {itens.map((i) => (
                    <tr key={i.approval_id} data-pedido={i.approval_id}>
                      <td className="align-top">{nomeDaRegra(i.regra)}</td>
                      <td className="align-top">{i.operador ? nomeDoAgente(i.operador) : "Não informado"}</td>
                      <td className="align-top">{emPalavras(i.acao)}</td>
                      <td className="max-w-[320px] align-top text-muted-foreground">{i.o_que || "Sem descrição"}</td>
                      <td className="whitespace-nowrap align-top tabular-nums">{haQuanto(i.criado_em, agora)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex min-w-0 justify-end">
              <button type="button" className={botao.primario} disabled={ocupado} onClick={() => setTirando(true)}>Tirar {quantos} da caixa</button>
            </div>
          </>
        )}
      </Secao>

      {admin && (
        <JanelaDeConfirmar
          aberta={Boolean(ligando)}
          titulo={`Ligar ${ligando?.nome ?? ""}?`}
          confirmar="Sim, ligar"
          desistir="Não ligar"
          ocupado={ocupado}
          aoFechar={() => setLigando(null)}
          aoConfirmar={() => {
            const alvo = ligando;
            if (!alvo) return;
            void rodar(async () => { await ajustarRegra(alvo.chave, true, null); return `${alvo.nome}: ligada.`; }).then((deuCerto) => { if (deuCerto) setLigando(null); });
          }}
        >
          <p className={texto.corpo}>Com a regra ligada, {ligando ? quemUsaARegra(ligando.operadores, nomeDoAgente) : ""} passa a fazer isto sem pedir:</p>
          <p className={juntar(texto.corpo, "mt-2 font-medium")}>{ligando?.descricao || ligando?.nome}</p>
          <p className={juntar(texto.auxiliar, "mt-3")}>Cada uso fica registrado aqui. O que passar dos limites continua subindo para você.</p>
        </JanelaDeConfirmar>
      )}
      {admin && (
        <JanelaDeConfirmar
          aberta={tirando}
          titulo={`Tirar ${quantos} da caixa?`}
          confirmar="Sim, tirar"
          desistir="Não tirar"
          ocupado={ocupado}
          aoFechar={() => setTirando(false)}
          aoConfirmar={() => {
            void rodar(async () => {
              const r = await limparFilaDasRegras(true);
              const saiu = Number(r?.total ?? 0);
              setPrevia(null);
              return saiu === 1 ? "1 pedido saiu da caixa." : `${saiu} pedidos saíram da caixa.`;
            }).then((deuCerto) => { if (deuCerto) setTirando(false); });
          }}
        >
          <p className={texto.corpo}>Os pedidos da lista saem da caixa. Os outros continuam esperando você.</p>
        </JanelaDeConfirmar>
      )}
    </div>
  );
}
