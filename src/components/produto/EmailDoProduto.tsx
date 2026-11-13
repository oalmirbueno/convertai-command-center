import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, Mail, Plus } from "lucide-react";
import {
  carregarEmailDaEmpresa,
  fraseDoErro,
  lerPrecos,
  pedirCaixa,
  pedirEmail,
  reais,
  ROTULO_DO_ESTADO_DO_DOMINIO,
  ROTULO_DO_PROVEDOR,
  WEBMAIL_DO_PROVEDOR,
  type CaixaDeEmail,
  type DominioDeEmail,
  type EstadoDoProduto,
  type EtapaDaMigracao,
} from "@/lib/produto/api";
import {
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  JanelaCentral,
  Painel,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  lista,
  texto,
} from "@/components/sistema";
import ChecagemDoDominio from "./ChecagemDoDominio";
import SemAcesso from "./SemAcesso";

const ROTULO_DA_CAIXA: Record<CaixaDeEmail["estado"], string> = { pedida: "Pedida", criada: "Criada", copiando: "Copiando o histórico", ativa: "Ativa", removida: "Removida" };
const COR_DA_CAIXA: Record<CaixaDeEmail["estado"], string> = {
  pedida: "bg-warning/10 text-warning",
  criada: "bg-muted text-muted-foreground",
  copiando: "bg-muted text-muted-foreground",
  ativa: "bg-primary/10 text-primary",
  removida: "bg-muted text-muted-foreground",
};

const VANTAGENS = [
  "Endereço com o nome da empresa: voce@suaempresa.com.br",
  "A Aceleriq faz a migração: caixas, histórico e DNS",
  "Mensagens que chegam e não caem no spam (SPF, DKIM e DMARC)",
  "Webmail, celular e computador, com as contas no nome da empresa",
];

/**
 * E-mail profissional da empresa. Quem ainda não contratou vê a oferta e pede;
 * quem contratou vê o domínio, as caixas, a saúde do DNS e o andamento da migração.
 * É uma ferramenta à parte do CRM, na mesma conta.
 */
export default function EmailDoProduto({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  if (!conta.email_ativo) return <OfertaDeEmail estado={estado} />;
  if (!estado.email) return <SemAcesso estado={estado} produto="email" />;
  return <EmailContratado estado={estado} />;
}

function OfertaDeEmail({ estado }: { estado: EstadoDoProduto }) {
  const admin = !!estado.eu && estado.eu.papel === "admin";
  const config = useQuery({ queryKey: ["produto", "precos"], queryFn: lerPrecos, staleTime: 300_000 });
  const [dominio, setDominio] = useState("");
  const [caixas, setCaixas] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pedido, setPedido] = useState(false);
  const c = config.data;
  const inclusoNoPlano = !!estado.plano && estado.plano.email_caixas_incluidas > 0;

  const pedir = async () => {
    setEnviando(true);
    try {
      await pedirEmail({ dominio: dominio.trim(), caixas: Math.floor(Number(caixas) || 0), observacao: observacao.trim() });
      setPedido(true);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível enviar o pedido."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="produto-entra-em-ordem mx-auto w-full min-w-0 max-w-[1080px] space-y-6" data-oferta-de-email="">
      <CabecalhoDePagina
        titulo="E-mail profissional"
        descricao={inclusoNoPlano ? "Mensalidade incluída no seu plano" : c ? `A partir de ${reais(c.email_mensal)} por mês` : undefined}
        ajuda="O e-mail fica no domínio da empresa, em contas que pertencem a ela. A Aceleriq cuida da migração e do DNS, e a caixa de entrada continua sendo usada no webmail, no celular e no computador."
      />
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <ul className="space-y-2.5">
            {VANTAGENS.map((v) => (
              <li key={v} className="flex min-w-0 items-start">
                <Check className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className={juntar(texto.corpo, "min-w-0")}>{v}</span>
              </li>
            ))}
          </ul>
          {c && (
            <ul className={juntar(lista.aberta, lista.divisoria)} data-precos-do-email="">
              <li className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Migração, uma vez</span>
                <span className={juntar(texto.corpo, "ml-3 shrink-0 font-medium tabular-nums")}>{reais(c.email_migracao)}</span>
              </li>
              <li className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>
                  Mensalidade <span className="text-muted-foreground">· até {inclusoNoPlano && estado.plano ? estado.plano.email_caixas_incluidas : c.email_caixas_no_mensal} caixas</span>
                </span>
                <span className={juntar(texto.corpo, "ml-3 shrink-0 font-medium tabular-nums")}>{inclusoNoPlano ? "No plano" : reais(c.email_mensal)}</span>
              </li>
              {c.email_caixa_extra > 0 && (
                <li className={lista.linha}>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Caixa adicional, por mês</span>
                  <span className={juntar(texto.corpo, "ml-3 shrink-0 font-medium tabular-nums")}>{reais(c.email_caixa_extra)}</span>
                </li>
              )}
            </ul>
          )}
        </div>

        <Painel titulo={pedido ? "Pedido recebido" : "Quero o e-mail profissional"}>
          {pedido ? (
            <p className={texto.corpo}>A Aceleriq vai falar com você para combinar a migração.</p>
          ) : admin ? (
            <>
              <GrupoDeCampos colunas={1}>
                <CampoDeFormulario rotulo="Domínio da empresa" apoio="Se já tem, como suaempresa.com.br">
                  <input value={dominio} onChange={(e) => setDominio(e.target.value)} className={campo} placeholder="suaempresa.com.br" maxLength={120} autoCapitalize="none" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Quantas caixas">
                  <input value={caixas} onChange={(e) => setCaixas(e.target.value)} className={campo} inputMode="numeric" maxLength={3} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Onde o e-mail está hoje">
                  <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} className={campoTexto} maxLength={600} placeholder="Provedor atual e o que mais ajudar" />
                </CampoDeFormulario>
              </GrupoDeCampos>
              <div className="mt-4 flex justify-end">
                <button type="button" className={botao.primario} onClick={() => void pedir()} disabled={enviando} data-pedir-email="">
                  {enviando ? "Enviando..." : "Pedir"}
                </button>
              </div>
            </>
          ) : (
            <p className={texto.corpo}>Quem administra a empresa pode pedir por aqui.</p>
          )}
        </Painel>
      </div>
    </div>
  );
}

function EmailContratado({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const admin = !!estado.eu && estado.eu.papel === "admin";
  const qc = useQueryClient();
  const chave = ["produto", "email", conta.id];
  const email = useQuery({ queryKey: chave, queryFn: carregarEmailDaEmpresa });
  const [escolhido, setEscolhido] = useState<string | null>(null);

  if (email.isLoading) return <Carregando forma="aba" rotulo="Abrindo o e-mail" />;
  if (email.isError || !email.data) {
    return <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void email.refetch()}>Tentar de novo</button>} />;
  }
  const { dominios, caixas, etapas } = email.data;
  if (!dominios.length) {
    return (
      <div className="min-w-0 space-y-5">
        <CabecalhoDePagina titulo="E-mail profissional" />
        <EstadoVazio icone={<Mail className="h-5 w-5" aria-hidden="true" />} titulo="A migração está sendo preparada" descricao="Assim que a Aceleriq cadastrar o domínio, ele aparece aqui com as caixas e o andamento." />
      </div>
    );
  }
  const dominio = dominios.filter((d) => d.id === escolhido)[0] || dominios[0];
  return (
    <div className="produto-entra-em-ordem mx-auto w-full min-w-0 max-w-[1320px] space-y-6" data-email-contratado="">
      <CabecalhoDePagina
        titulo="E-mail profissional"
        descricao={`${dominio.dominio} · ${ROTULO_DO_ESTADO_DO_DOMINIO[dominio.estado]}`}
        acoes={
          <>
            {dominios.length > 1 && (
              <SeletorCompacto rotulo="Domínio" modo="lista" opcoes={dominios.map((d) => ({ valor: d.id, rotulo: d.dominio }))} valor={dominio.id} onEscolher={setEscolhido} />
            )}
            <AbrirWebmail dominio={dominio} />
          </>
        }
      />
      {/* Do notebook para cima: as caixas à esquerda; a saúde do domínio e a migração ao lado. */}
      <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
      <Caixas dominio={dominio} caixas={caixas.filter((c) => c.dominio_id === dominio.id)} admin={admin} limite={conta.email_caixas_contratadas} aoMudar={() => void qc.invalidateQueries({ queryKey: chave })} />
      <div className="min-w-0 space-y-6">
      <ChecagemDoDominio
        dominio={dominio}
        aoConferir={(c) =>
          qc.setQueryData(chave, (antes: typeof email.data | undefined) =>
            antes ? { ...antes, dominios: antes.dominios.map((d) => (d.id === dominio.id ? { ...d, checagem: c, checado_em: c.conferido_em } : d)) } : antes,
          )
        }
      />
      {dominio.estado !== "concluido" && <Andamento etapas={etapas.filter((e) => e.dominio_id === dominio.id)} />}
      </div>
      </div>
    </div>
  );
}

function AbrirWebmail({ dominio }: { dominio: DominioDeEmail }) {
  const link = dominio.webmail_url || WEBMAIL_DO_PROVEDOR[dominio.provedor];
  if (!link) return null;
  return (
    <a href={link} target="_blank" rel="noreferrer" className={botao.primario} data-abrir-webmail="">
      <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
      Abrir o e-mail
    </a>
  );
}

function Caixas({ dominio, caixas, admin, limite, aoMudar }: { dominio: DominioDeEmail; caixas: CaixaDeEmail[]; admin: boolean; limite: number; aoMudar: () => void }) {
  const [pedindo, setPedindo] = useState(false);
  const [usuario, setUsuario] = useState("");
  const [pessoa, setPessoa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const pedir = async () => {
    const nome = usuario.trim().toLowerCase().replace(/@.*$/, "");
    if (!/^[a-z0-9._-]{1,60}$/.test(nome)) return void toast.error("Use letras, números, ponto ou traço no endereço.");
    setEnviando(true);
    try {
      await pedirCaixa(`${nome}@${dominio.dominio}`, pessoa.trim());
      aoMudar();
      setPedindo(false);
      setUsuario("");
      setPessoa("");
      toast.success("Caixa pedida. A Aceleriq cria e avisa.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível pedir a caixa."));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Secao
      titulo="Caixas"
      descricao={`${caixas.length}${limite ? ` de ${limite}` : ""} · ${ROTULO_DO_PROVEDOR[dominio.provedor]}`}
      ajuda="Cada caixa é um endereço da empresa. Para entrar, use o botão Abrir o e-mail com o endereço e a senha da caixa, ou o aplicativo do provedor no celular."
      acao={
        admin ? (
          <button type="button" className={botao.icone} onClick={() => setPedindo(true)} aria-label="Pedir uma caixa" title="Pedir uma caixa" data-pedir-caixa="">
            <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
          </button>
        ) : undefined
      }
    >
      {caixas.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhuma caixa cadastrada ainda." />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} data-caixas-de-email="">
          {caixas.map((c) => (
            <li key={c.id} className={lista.linha}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.endereco}</span>
                {c.pessoa && <span className={juntar(texto.auxiliar, "block truncate")}>{c.pessoa}</span>}
              </span>
              {c.tipo !== "caixa" && <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>{c.tipo === "apelido" ? "Apelido" : "Grupo"}</span>}
              <span className={juntar(etiqueta, "ml-2", COR_DA_CAIXA[c.estado])}>{ROTULO_DA_CAIXA[c.estado]}</span>
            </li>
          ))}
        </ul>
      )}
      <JanelaCentral
        aberta={pedindo}
        onFechar={() => setPedindo(false)}
        largura="sm"
        titulo="Pedir uma caixa"
        ajuda="A Aceleriq cria a caixa no provedor e entrega a senha para a pessoa. Caixa além do que está contratado entra na mensalidade."
        rodape={<button type="button" className={botao.primario} onClick={() => void pedir()} disabled={enviando || !usuario.trim()}>{enviando ? "Enviando..." : "Pedir"}</button>}
      >
        <GrupoDeCampos colunas={1}>
          <CampoDeFormulario rotulo="Endereço" apoio={`@${dominio.dominio}`}>
            <input value={usuario} onChange={(e) => setUsuario(e.target.value)} className={campo} placeholder="nome" maxLength={60} autoCapitalize="none" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Quem vai usar">
            <input value={pessoa} onChange={(e) => setPessoa(e.target.value)} className={campo} maxLength={120} />
          </CampoDeFormulario>
        </GrupoDeCampos>
      </JanelaCentral>
    </Secao>
  );
}

function Andamento({ etapas }: { etapas: EtapaDaMigracao[] }) {
  if (!etapas.length) return null;
  const feitas = etapas.filter((e) => e.feito_em).length;
  return (
    <Secao titulo="Andamento da migração" descricao={`${feitas} de ${etapas.length} etapas`} recolher="produto:email:andamento">
      <ol className={juntar(lista.aberta, lista.divisoria)} data-andamento-da-migracao="">
        {etapas.map((e) => (
          <li key={e.id} className={lista.linha}>
            <span className={juntar("mr-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", e.feito_em ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
              {e.feito_em && <Check className="h-3 w-3" aria-hidden="true" />}
            </span>
            <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", e.feito_em && "text-muted-foreground")}>{e.titulo}</span>
          </li>
        ))}
      </ol>
    </Secao>
  );
}
