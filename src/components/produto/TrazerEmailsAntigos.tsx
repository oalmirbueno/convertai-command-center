import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, CloudDownload, ExternalLink, Pause, Play } from "lucide-react";
import { fraseDoErro, type CaixaDeEmail } from "@/lib/produto/api";
import { migracaoDoCliente, porcentagem, type MigracaoDoCliente, type ProvedorDaMigracao } from "@/lib/produto/migracao-cliente";
import { JanelaCentral, Secao, botao, campo, etiqueta, foco, juntar, texto } from "@/components/sistema";

const chaveDaMigracao = (caixaId: string) => ["produto", "email", "migracao", caixaId];

/**
 * "Trazer seus e-mails antigos" (19/11/2026): o próprio cliente traz o histórico do e-mail de hoje para
 * a caixa nova, em três passos e sem termo técnico. A cópia roda no servidor, um pouco por vez: pode
 * fechar a tela. O e-mail antigo é só lido, nada é apagado lá.
 */
export default function TrazerEmailsAntigos({ caixas }: { caixas: CaixaDeEmail[] }) {
  const reais = caixas.filter((c) => c.tipo === "caixa" && c.estado !== "removida");
  const [abrindo, setAbrindo] = useState<CaixaDeEmail | null>(null);
  if (!reais.length) return null;
  return (
    <Secao titulo="Trazer seus e-mails antigos" ajuda="Copia tudo o que está no e-mail de hoje (Gmail, Outlook, UOL, Locaweb e outros) para a caixa nova. O e-mail antigo continua igual: nada é apagado lá." recolher="produto:email:trazer">
      <ul className="space-y-2" data-trazer-emails="">
        {reais.map((c) => (
          <LinhaDaCaixa key={c.id} caixa={c} aoComecar={() => setAbrindo(c)} />
        ))}
      </ul>
      {abrindo && <Assistente caixa={abrindo} onFechar={() => setAbrindo(null)} />}
    </Secao>
  );
}

function LinhaDaCaixa({ caixa, aoComecar }: { caixa: CaixaDeEmail; aoComecar: () => void }) {
  const qc = useQueryClient();
  const m = useQuery({
    queryKey: chaveDaMigracao(caixa.id),
    queryFn: () => migracaoDoCliente.estado(caixa.id),
    refetchInterval: (q) => (q.state.data && q.state.data.estado === "copiando" ? 8000 : false),
    retry: 1,
  });
  const atual = m.data || null;
  const mudar = async (fazer: () => Promise<MigracaoDoCliente>) => {
    try {
      qc.setQueryData(chaveDaMigracao(caixa.id), await fazer());
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível agora."));
    }
  };
  return (
    <li className="rounded-2xl border border-border p-4" data-trazer-caixa={caixa.endereco}>
      <div className="flex min-w-0 items-center">
        <span className="min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-semibold")}>{caixa.endereco}</span>
          <span className={juntar(texto.auxiliar, "block truncate")}>
            {!atual || atual.estado === "cancelada" ? "Nada trazido ainda." : atual.estado === "concluida" ? `Pronto: ${atual.copiadas} mensagens trazidas de ${atual.origem_usuario}.` : `De ${atual.origem_usuario}`}
          </span>
        </span>
        {(!atual || atual.estado === "cancelada" || atual.estado === "erro") && (
          <button type="button" className={juntar(botao.primario, "ml-3 shrink-0")} onClick={aoComecar} data-comecar-migracao="">
            <CloudDownload className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {atual && atual.estado === "erro" ? "Tentar de novo" : "Trazer"}
          </button>
        )}
        {atual && atual.estado === "concluida" && <span className={juntar(etiqueta, "ml-3 bg-accent-soft text-primary")}><Check className="mr-1 h-3 w-3" aria-hidden="true" />Pronto</span>}
      </div>
      {atual && (atual.estado === "copiando" || atual.estado === "pausada" || atual.estado === "erro") && <Andamento m={atual} aoPausar={() => void mudar(() => migracaoDoCliente.pausar(atual.id))} aoContinuar={() => void mudar(() => migracaoDoCliente.continuar(atual.id))} />}
    </li>
  );
}

function Andamento({ m, aoPausar, aoContinuar }: { m: MigracaoDoCliente; aoPausar: () => void; aoContinuar: () => void }) {
  const pct = porcentagem(m);
  return (
    <div className="mt-3" data-andamento-da-copia={m.estado}>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Andamento da cópia">
        <div className={juntar("h-full rounded-full transition-[width] duration-700", m.estado === "erro" ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.max(pct, m.estado === "copiando" ? 3 : 0)}%` }} />
      </div>
      <div className="mt-2 flex min-w-0 items-center">
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1")}>
          {m.estado === "erro" ? m.mensagem : `${pct}% · ${m.copiadas} de ${m.total || "?"} mensagens. ${m.mensagem || ""}`}
        </span>
        {m.estado === "copiando" && (
          <button type="button" className={juntar(botao.discreto, "ml-2 h-8 shrink-0")} onClick={aoPausar}>
            <Pause className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Pausar
          </button>
        )}
        {m.estado === "pausada" && (
          <button type="button" className={juntar(botao.secundario, "ml-2 h-8 shrink-0")} onClick={aoContinuar}>
            <Play className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Continuar
          </button>
        )}
      </div>
    </div>
  );
}

function Assistente({ caixa, onFechar }: { caixa: CaixaDeEmail; onFechar: () => void }) {
  const qc = useQueryClient();
  const provedores = useQuery({ queryKey: ["produto", "email", "migracao", "provedores"], queryFn: migracaoDoCliente.provedores, staleTime: 3_600_000 });
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [prov, setProv] = useState<ProvedorDaMigracao | null>(null);
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [host, setHost] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const comecar = async () => {
    if (!prov) return;
    setErro("");
    setEnviando(true);
    try {
      const m = await migracaoDoCliente.iniciar({ caixa_id: caixa.id, provedor: prov.id, usuario: usuario.trim(), senha, ...(prov.id === "outro" ? { host: host.trim() } : {}), ...(senhaNova ? { senha_destino: senhaNova } : {}) });
      qc.setQueryData(chaveDaMigracao(caixa.id), m);
      setSenha("");
      setSenhaNova("");
      toast.success("Começou. Pode fechar: a cópia continua sozinha.");
      onFechar();
    } catch (e) {
      setErro(fraseDoErro(e, "Não foi possível começar agora."));
      // Senha da caixa nova recusada ou faltando: volta para o passo dela.
      if (/caixa nova/i.test(String((e as Error).message || ""))) setPasso(3);
      else if (/e-mail antigo|servidor/i.test(String((e as Error).message || ""))) setPasso(2);
    } finally {
      setEnviando(false);
    }
  };

  const titulos = { 1: "Onde está o seu e-mail hoje?", 2: prov ? `Seu e-mail no ${prov.nome}` : "Seu e-mail de hoje", 3: `A senha de ${caixa.endereco}` } as const;
  const podeAvancar = passo === 1 ? !!prov : passo === 2 ? usuario.trim().length > 3 && senha.length > 0 && (prov?.id !== "outro" || host.trim().length > 3) : true;

  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="md"
      titulo={titulos[passo]}
      ajuda={`Passo ${passo} de 3. Nada é apagado no e-mail antigo.`}
      rodape={
        <div className="flex w-full items-center">
          {passo > 1 ? (
            <button type="button" className={botao.discreto} onClick={() => { setErro(""); setPasso((p) => (p - 1) as 1 | 2 | 3); }}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />Voltar
            </button>
          ) : <span />}
          <span className="flex-1" />
          {passo < 3 ? (
            <button type="button" className={botao.primario} disabled={!podeAvancar} onClick={() => { setErro(""); setPasso((p) => (p + 1) as 1 | 2 | 3); }} data-avancar-migracao="">
              Continuar<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className={botao.primario} disabled={enviando} onClick={() => void comecar()} data-iniciar-migracao="">
              {enviando ? "Conferindo as senhas..." : "Começar a trazer"}
            </button>
          )}
        </div>
      }
    >
      {passo === 1 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-provedores-da-migracao="">
          {(provedores.data || []).map((p) => (
            <button key={p.id} type="button" onClick={() => setProv(p)} aria-pressed={prov?.id === p.id} className={juntar("flex min-w-0 items-center rounded-2xl border p-3.5 text-left text-[14px] font-medium", foco, prov?.id === p.id ? "border-primary bg-accent-soft" : "border-border hover:bg-muted")} data-provedor={p.id}>
              <span className={juntar("mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold", prov?.id === p.id ? "bg-primary text-primary-foreground" : "bg-muted")} aria-hidden="true">{p.nome.slice(0, 1)}</span>
              <span className="min-w-0 truncate">{p.nome}</span>
            </button>
          ))}
          {provedores.isLoading && <p className={texto.auxiliar}>Carregando...</p>}
        </div>
      )}

      {passo === 2 && prov && (
        <div className="space-y-4">
          {prov.senha_de_app && (
            <div className="rounded-2xl bg-accent-soft p-4" data-ajuda-senha-de-app="">
              <p className={juntar(texto.corpo, "font-semibold")}>O {prov.nome} pede uma senha de app</p>
              <p className={juntar(texto.auxiliar, "mt-1")}>É uma senha só para isto, diferente da sua senha normal. Leva um minuto:</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-5">
                {prov.senha_de_app.passos.map((x) => <li key={x}>{x}</li>)}
              </ol>
              <a href={prov.senha_de_app.onde} target="_blank" rel="noreferrer" className={juntar(botao.secundario, "mt-3")}>
                <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />Abrir a página da senha de app
              </a>
            </div>
          )}
          <label className="block">
            <span className={juntar(texto.auxiliar, "mb-1.5 block font-medium")}>Seu e-mail de hoje</span>
            <input value={usuario} onChange={(e) => setUsuario(e.target.value)} className={campo} type="email" inputMode="email" autoCapitalize="none" autoComplete="off" placeholder="voce@seuprovedor.com.br" data-campo="email-antigo" />
          </label>
          <label className="block">
            <span className={juntar(texto.auxiliar, "mb-1.5 block font-medium")}>{prov.senha_de_app ? "A senha de app (16 letras)" : "A senha desse e-mail"}</span>
            <span className="flex items-center">
              <input value={senha} onChange={(e) => setSenha(e.target.value)} className={juntar(campo, "min-w-0 flex-1")} type={ver ? "text" : "password"} autoComplete="off" data-campo="senha-antiga" />
              <button type="button" className={juntar(botao.discreto, "ml-2 h-9")} onClick={() => setVer((v) => !v)} aria-pressed={ver}>{ver ? "Ocultar" : "Mostrar"}</button>
            </span>
            <span className={juntar(texto.auxiliar, "mt-1 block")}>Ela vai direto para o cofre e é apagada quando a cópia termina.</span>
          </label>
          {prov.id === "outro" && (
            <label className="block">
              <span className={juntar(texto.auxiliar, "mb-1.5 block font-medium")}>Servidor de entrada (IMAP)</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} className={campo} autoCapitalize="none" placeholder="imap.seuprovedor.com.br" data-campo="host-antigo" />
              <span className={juntar(texto.auxiliar, "mt-1 block")}>Está nas configurações do e-mail no celular ou no site do provedor.</span>
            </label>
          )}
        </div>
      )}

      {passo === 3 && (
        <div className="space-y-4">
          <p className={texto.corpo}>Para colocar as mensagens na caixa nova, digite a senha de <b>{caixa.endereco}</b>, a que você criou no convite. Se a caixa já está conectada ao correio do painel, pode deixar em branco.</p>
          <label className="block">
            <span className={juntar(texto.auxiliar, "mb-1.5 block font-medium")}>Senha da caixa nova</span>
            <input value={senhaNova} onChange={(e) => setSenhaNova(e.target.value)} className={campo} type="password" autoComplete="off" data-campo="senha-nova" />
          </label>
          <ul className="space-y-1.5 text-[13px] leading-5 text-muted-foreground">
            <li className="flex"><Check className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Entrada, enviados e as suas pastas vêm juntos.</li>
            <li className="flex"><Check className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Pode fechar a tela: a cópia continua sozinha.</li>
            <li className="flex"><Check className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Nada é apagado no e-mail antigo.</li>
          </ul>
        </div>
      )}
      {erro && <p className={juntar(texto.corpo, "mt-4 font-medium text-destructive")} role="alert" data-erro-da-migracao="">{erro}</p>}
    </JanelaCentral>
  );
}
