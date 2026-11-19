import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Inbox, KeyRound, Mail, MailOpen, Paperclip, Server } from "lucide-react";
import { diaLegivel, fraseDoErro } from "@/lib/produto/api";
import { carregarCentral, carregarMinhasCaixas, correio, correioDesligado, type CaixaDoCorreio, type ClienteNaCentral, type DominioNaCentral } from "@/lib/produto/email-central";
import { estadoDaCaixaOficial, mensagensDaCaixaOficial } from "@/lib/produto/email-pedidos";
import { Card, Chip, List, ListRow, StatCard, StatGrid, type Tone } from "@/components/ds";
import { EstadoVazio, JanelaCentral, botao, foco, juntar, texto } from "@/components/sistema";
import { chaveDaCentral } from "./CentralDeEmail";
import { BotaoDeReler, ErroDaTela, EsqueletoDaTela, lidoAs } from "./pecasDaCasa";

/**
 * A caixa de e-mail oficial da Aceleriq dentro do painel.
 *
 * 19/11/2026: o estado vem da realidade, não de uma chave fixa. Antes a tela só perguntava à função
 * produto-email (o caminho do Zoho, que depende de ACELERIQ_CAIXA_LIGADA=sim) e por isso dizia
 * "desligada" mesmo depois que o correio passou a funcionar pelo Migadu (IMAP para ler, SMTP para
 * enviar, função produto-correio). Agora ela lê, e relê sozinha a cada minuto e ao voltar para a aba:
 *   1. as caixas que a pessoa logada abre no correio (produto_email_minhas_caixas);
 *   2. o domínio da Aceleriq na central de e-mail (provedor e correio ligado);
 *   3. o caminho antigo do Zoho, que continua valendo se alguém ligar por lá.
 * Ligada, mostra as mensagens da entrada; para responder, o /correio.
 */

const RELER = { refetchOnWindowFocus: true, refetchInterval: 60_000, staleTime: 15_000, retry: 1 } as const;

const ehDaAceleriq = (c: ClienteNaCentral, dominioDoZoho: string | null) =>
  /aceleriq/i.test(c.empresa) || c.dominios.some((d) => (dominioDoZoho && d.dominio === dominioDoZoho) || /(^|\.)aceleriq\./i.test(d.dominio));

type Passo = { chave: string; titulo: string; feito: boolean };

/** O que falta para a caixa abrir aqui, lido dos dados (cada passo com o seu estado real). */
export function passosDaCaixa(p: { dominio: DominioNaCentral | null; caixas: CaixaDoCorreio[]; liberado: boolean }): Passo[] {
  const ligada = p.caixas.some((c) => c.ligado);
  return [
    { chave: "dominio", titulo: "Domínio da Aceleriq no E-mail", feito: !!p.dominio || p.caixas.length > 0 },
    { chave: "provedor", titulo: "Correio no Migadu", feito: (!!p.dominio && p.dominio.correio_provedor !== "nenhum") || p.caixas.some((c) => c.provedor && c.provedor !== "nenhum") },
    { chave: "ligado", titulo: "Correio ligado no domínio", feito: (!!p.dominio && p.dominio.correio_ligado) || ligada },
    { chave: "caixa", titulo: "Caixa ligada ao seu acesso", feito: p.liberado && p.caixas.length > 0 },
    { chave: "senha", titulo: "Senha da caixa conectada", feito: ligada },
  ];
}

export default function CaixaDaAceleriq() {
  const minhas = useQuery({ queryKey: ["produto", "correio", "caixas"], queryFn: carregarMinhasCaixas, ...RELER });
  const central = useQuery({ queryKey: chaveDaCentral, queryFn: carregarCentral, ...RELER });
  const zoho = useQuery({ queryKey: ["produto", "casa", "caixa", "estado"], queryFn: estadoDaCaixaOficial, ...RELER, retry: 0 });
  const [escolhida, setEscolhida] = useState<string | null>(null);

  if (minhas.isLoading || central.isLoading) return <EsqueletoDaTela numeros={3} linhas={6} rotulo="Abrindo a caixa" />;
  if (minhas.isError && central.isError) return <ErroDaTela titulo="Não foi possível ler a caixa agora." descricao={fraseDoErro(minhas.error)} aoTentar={() => { void minhas.refetch(); void central.refetch(); }} />;

  const reler = () => {
    void minhas.refetch();
    void central.refetch();
    void zoho.refetch();
  };
  const relendo = minhas.isFetching || central.isFetching || zoho.isFetching;
  const quando = Math.max(minhas.dataUpdatedAt || 0, central.dataUpdatedAt || 0);

  const d = minhas.data;
  const caixas = d && d.liberado ? d.caixas : [];
  const dominioDoZoho = zoho.data ? zoho.data.dominio : null;
  const cliente = (central.data || []).filter((c) => ehDaAceleriq(c, dominioDoZoho))[0] || null;
  const dominio = cliente ? cliente.dominios[0] || null : null;
  const ligadas = caixas.filter((c) => c.ligado);
  const caixa = ligadas.filter((c) => c.id === escolhida)[0] || ligadas[0] || null;
  const zohoLigado = !!(zoho.data && zoho.data.estado.ligada);
  const passos = passosDaCaixa({ dominio, caixas, liberado: !!(d && d.liberado) });
  const falta = passos.filter((p) => !p.feito)[0] || null;

  const estado: { tom: Tone; rotulo: string } = caixa
    ? { tom: "success", rotulo: "Ligada" }
    : zohoLigado
      ? { tom: "success", rotulo: "Ligada pelo Zoho" }
      : caixas.length > 0
        ? { tom: "warning", rotulo: "Falta conectar" }
        : { tom: "neutral", rotulo: "Não ligada" };

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6" data-caixa-da-aceleriq={caixa || zohoLigado ? "ligada" : "desligada"}>
      <StatGrid cols={3} label="Situação da caixa da Aceleriq">
        <StatCard
          icon={<Inbox className="h-4 w-4" />}
          label="Situação"
          value={estado.rotulo}
          size="md"
          hint={relendo ? "relendo agora" : lidoAs(quando)}
        />
        <StatCard
          icon={<Mail className="h-4 w-4" />}
          label="Caixas"
          value={`${ligadas.length}/${caixas.length}`}
          size="md"
          hint={caixas.length ? "conectadas no correio" : "nenhuma ligada a você"}
          progress={caixas.length ? { value: ligadas.length, max: caixas.length } : undefined}
        />
        <StatCard
          icon={<Server className="h-4 w-4" />}
          label="Provedor"
          value={dominio ? (dominio.correio_provedor === "migadu" ? "Migadu" : dominio.correio_provedor === "zoho" ? "Zoho" : dominio.correio_provedor === "imap" ? "IMAP" : "Nenhum") : caixa ? "Migadu" : "..."}
          size="md"
          hint={dominio ? dominio.dominio : dominioDoZoho || "domínio não achado"}
        />
      </StatGrid>

      {caixa ? (
        <MensagensDaCaixa caixa={caixa} caixas={ligadas} aoEscolher={setEscolhida} aoReler={reler} relendo={relendo} />
      ) : zohoLigado ? (
        <MensagensDoZoho dominio={dominioDoZoho} />
      ) : (
        <Card
          title="Como ligar"
          subtitle={falta ? `Falta: ${falta.titulo.toLowerCase()}` : undefined}
          help="A caixa abre pelo correio do painel (Migadu: IMAP para ler, SMTP para enviar). Cada passo abaixo é lido dos dados e se atualiza sozinho. A senha da caixa vai direto para o cofre ao conectar no /correio e nunca volta para a tela."
          action={
            <span className="flex items-center [&>*+*]:ml-1">
              <BotaoDeReler aoReler={reler} relendo={relendo} />
              {caixas.length > 0 ? (
                <Link to="/correio" className={juntar(botao.primario, "h-8")} data-conectar-no-correio="">
                  <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Conectar
                </Link>
              ) : (
                <Link to="/produto/email" className={juntar(botao.secundario, "h-8")}>Abrir a central</Link>
              )}
            </span>
          }
          data-caixa-desligada=""
        >
          <ol className="min-w-0" data-passos-da-caixa="">
            {passos.map((p, i) => {
              const agora = falta && p.chave === falta.chave;
              return (
                <li key={p.chave} className={juntar("relative flex min-w-0 items-center", i < passos.length - 1 && "pb-4")} data-passo={p.feito ? "feito" : agora ? "agora" : "falta"}>
                  {i < passos.length - 1 && <span aria-hidden="true" className={juntar("absolute bottom-0 left-[13px] top-7 w-0.5", p.feito ? "bg-primary" : "bg-border")} />}
                  <span aria-hidden="true" className={juntar("relative z-[1] mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold", p.feito ? "bg-primary text-primary-foreground" : agora ? "border-2 border-primary bg-card text-primary" : "border-2 border-border bg-card text-muted-foreground")}>
                    {p.feito ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1", p.feito ? "text-muted-foreground" : agora && "font-medium")}>{p.titulo}</span>
                  {p.feito ? <Chip tone="success" className="ml-2">feito</Chip> : agora ? <Chip tone="accent" className="ml-2">agora</Chip> : null}
                </li>
              );
            })}
          </ol>
          {minhas.isError && <p className={juntar(texto.auxiliar, "mt-4 text-destructive")}>Não consegui ler as suas caixas agora: {fraseDoErro(minhas.error)}</p>}
        </Card>
      )}
    </div>
  );
}

function MensagensDaCaixa({ caixa, caixas, aoEscolher, aoReler, relendo }: { caixa: CaixaDoCorreio; caixas: CaixaDoCorreio[]; aoEscolher: (id: string) => void; aoReler: () => void; relendo: boolean }) {
  const mensagens = useQuery({ queryKey: ["produto", "casa", "caixa", "migadu", caixa.id], queryFn: () => correio.listar(caixa.id, "INBOX"), ...RELER });
  const [aberta, setAberta] = useState<string | null>(null);
  const lista_ = mensagens.data || [];
  const naoLidas = lista_.filter((m) => !m.lida).length;
  return (
    <Card
      title={caixas.length > 1 ? (
        <select value={caixa.id} onChange={(e) => aoEscolher(e.target.value)} className={juntar("max-w-full truncate rounded-md bg-transparent pr-1 text-[15px] font-semibold", foco)} aria-label="Caixa" data-caixa-escolhida="">
          {caixas.map((c) => <option key={c.id} value={c.id}>{c.endereco}</option>)}
        </select>
      ) : caixa.endereco}
      subtitle={mensagens.data ? `${lista_.length} na entrada${naoLidas ? ` · ${naoLidas} não ${naoLidas === 1 ? "lida" : "lidas"}` : ""} · ${lidoAs(mensagens.dataUpdatedAt)}` : undefined}
      help="As mensagens recentes da entrada, lidas por IMAP no Migadu. Para responder ou escrever, abra o correio."
      action={
        <span className="flex items-center [&>*+*]:ml-1">
          <BotaoDeReler aoReler={() => { aoReler(); void mensagens.refetch(); }} relendo={relendo || mensagens.isFetching} />
          <Link to="/correio" className={juntar(botao.primario, "h-8")} data-abrir-correio="">
            <ExternalLink className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Abrir o correio</span>
          </Link>
        </span>
      }
      data-mensagens-da-caixa=""
    >
      {mensagens.isLoading ? (
        <div className="min-w-0 space-y-2" aria-busy="true" aria-label="Lendo a caixa">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted" style={{ opacity: 1 - i * 0.15 }} />)}
        </div>
      ) : mensagens.isError ? (
        correioDesligado(mensagens.error) ? (
          <EstadoVazio icone={<KeyRound className="h-5 w-5" aria-hidden="true" />} titulo="A caixa pediu a senha de novo" descricao={fraseDoErro(mensagens.error)} acao={<Link to="/correio" className={juntar(botao.primario, "h-8")}>Conectar no correio</Link>} />
        ) : (
          <ErroDaTela titulo={fraseDoErro(mensagens.error, "Não foi possível ler a caixa agora.")} aoTentar={() => void mensagens.refetch()} />
        )
      ) : !lista_.length ? (
        <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Caixa vazia" descricao="Nada novo na entrada." />
      ) : (
        <List label="Mensagens da entrada">
          {lista_.map((m) => (
            <ListRow
              key={m.id}
              leading={<span aria-hidden="true" className={juntar("inline-flex h-9 w-9 items-center justify-center rounded-full", m.lida ? "bg-muted text-muted-foreground" : "bg-accent-soft text-primary")}>{m.lida ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}</span>}
              title={<span className={m.lida ? "font-normal" : "font-semibold"}>{m.assunto || "(sem assunto)"}</span>}
              subtitle={`${m.de}${m.resumo ? ` · ${m.resumo}` : ""}`}
              status={m.tem_anexo ? <Chip tone="neutral" icon={<Paperclip className="h-3 w-3" />}>anexo</Chip> : undefined}
              value={m.recebida_em ? diaLegivel(m.recebida_em, true) : undefined}
              onClick={() => setAberta(m.id)}
              dense
            />
          ))}
        </List>
      )}
      {aberta && <MensagemAberta caixaId={caixa.id} id={aberta} onFechar={() => setAberta(null)} />}
    </Card>
  );
}

function MensagemAberta({ caixaId, id, onFechar }: { caixaId: string; id: string; onFechar: () => void }) {
  const msg = useQuery({ queryKey: ["produto", "casa", "caixa", "migadu", caixaId, "ler", id], queryFn: () => correio.ler(caixaId, "INBOX", id), retry: 1 });
  const m = msg.data;
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="lg"
      titulo={m ? m.assunto || "(sem assunto)" : "Mensagem"}
      descricao={m ? `${m.de}${m.recebida_em ? ` · ${diaLegivel(m.recebida_em, true)}` : ""}` : undefined}
      rodape={<Link to="/correio" className={botao.primario}>Responder no correio</Link>}
      data-mensagem-aberta=""
    >
      {msg.isLoading ? (
        <div className="min-w-0 space-y-2" aria-busy="true" aria-label="Abrindo a mensagem">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-5 animate-pulse rounded-md bg-muted" style={{ width: `${90 - i * 12}%` }} />)}
        </div>
      ) : msg.isError || !m ? (
        <ErroDaTela titulo={fraseDoErro(msg.error, "Não foi possível abrir a mensagem.")} aoTentar={() => void msg.refetch()} />
      ) : (
        <div className="min-w-0 space-y-4">
          <p className={juntar(texto.corpo, "whitespace-pre-wrap break-words")}>{m.texto || m.resumo}</p>
          {m.anexos && m.anexos.length > 0 && (
            <div className="flex min-w-0 flex-wrap [&>*]:mb-1.5 [&>*]:mr-1.5">
              {m.anexos.map((a) => <Chip key={a.nome} tone="neutral" icon={<Paperclip className="h-3 w-3" />}>{a.nome}</Chip>)}
            </div>
          )}
        </div>
      )}
    </JanelaCentral>
  );
}

/** O caminho antigo (Zoho, ligado pela chave da função produto-email): só leitura, responder no webmail. */
function MensagensDoZoho({ dominio }: { dominio: string | null }) {
  const mensagens = useQuery({ queryKey: ["produto", "casa", "caixa", "mensagens"], queryFn: mensagensDaCaixaOficial, ...RELER });
  return (
    <Card
      title="Caixa da Aceleriq"
      subtitle={dominio || undefined}
      help="As mensagens recentes da caixa oficial, lidas do Zoho. Para responder, abra o webmail."
      action={
        <span className="flex items-center [&>*+*]:ml-1">
          <BotaoDeReler aoReler={() => void mensagens.refetch()} relendo={mensagens.isFetching} />
          <a href="https://mail.zoho.com" target="_blank" rel="noreferrer" className={botao.icone} aria-label="Abrir o webmail" title="Abrir o webmail">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </span>
      }
      data-mensagens-do-zoho=""
    >
      {mensagens.isLoading ? (
        <div className="min-w-0 space-y-2" aria-busy="true" aria-label="Lendo a caixa">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted" style={{ opacity: 1 - i * 0.15 }} />)}
        </div>
      ) : mensagens.isError ? (
        <ErroDaTela titulo={fraseDoErro(mensagens.error, "Não foi possível ler a caixa agora.")} aoTentar={() => void mensagens.refetch()} />
      ) : !(mensagens.data || []).length ? (
        <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Caixa vazia" />
      ) : (
        <List label="Mensagens da caixa">
          {(mensagens.data || []).map((m) => (
            <ListRow key={m.id} title={<span className={m.lida ? "font-normal" : "font-semibold"}>{m.assunto}</span>} subtitle={`${m.de}${m.resumo ? ` · ${m.resumo}` : ""}`} value={m.recebida_em ? diaLegivel(m.recebida_em, true) : undefined} dense />
          ))}
        </List>
      )}
    </Card>
  );
}
