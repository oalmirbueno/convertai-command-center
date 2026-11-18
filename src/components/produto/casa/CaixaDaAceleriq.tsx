import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Inbox, Lock, RefreshCw } from "lucide-react";
import { diaLegivel, fraseDoErro } from "@/lib/produto/api";
import { estadoDaCaixaOficial, mensagensDaCaixaOficial } from "@/lib/produto/email-pedidos";
import { Carregando, EstadoDeErro, EstadoVazio, Secao, botao, juntar, lista, texto } from "@/components/sistema";

/**
 * A caixa de e-mail oficial da Aceleriq dentro do painel, com o Zoho por trás. Nasce DESLIGADA:
 * no Zoho gratuito não há IMAP nem POP, e a documentação não garante a API de mensagens no gratuito.
 * Ligar é decisão do dono (plano pago do Zoho na conta da Aceleriq); a tela já mostra o custo e o que
 * falta. Ligada, lista as mensagens recentes; responder continua no webmail do Zoho.
 */
export default function CaixaDaAceleriq() {
  const estado = useQuery({ queryKey: ["produto", "casa", "caixa", "estado"], queryFn: estadoDaCaixaOficial, retry: 0, staleTime: 60_000 });
  const ligada = !!(estado.data && estado.data.estado.ligada);
  const mensagens = useQuery({ queryKey: ["produto", "casa", "caixa", "mensagens"], queryFn: mensagensDaCaixaOficial, enabled: ligada, retry: 0, staleTime: 30_000 });

  if (estado.isLoading) return <Carregando linhas={4} rotulo="Abrindo a caixa" />;
  if (estado.isError || !estado.data) {
    return (
      <EstadoVazio
        icone={<Lock className="h-5 w-5" aria-hidden="true" />}
        titulo="A caixa da Aceleriq está desligada"
        descricao={`${fraseDoErro(estado.error, "A função produto-email ainda não foi publicada.")} Ligar pede o Zoho Mail Lite (pago, só anual) na conta da Aceleriq.`}
      />
    );
  }
  const e = estado.data.estado;
  if (!e.ligada) {
    return (
      <div className="min-w-0 space-y-6" data-caixa-desligada="">
        <EstadoVazio icone={<Lock className="h-5 w-5" aria-hidden="true" />} titulo="A caixa da Aceleriq está desligada" descricao={e.motivo || undefined} />
        <Secao titulo="Para ligar" ajuda="A tela já está pronta. Ligar é decisão do dono e não muda nada nos clientes: cada cliente continua no Zoho gratuito dele.">
          <ul className={juntar(lista.aberta, lista.divisoria)} data-custo-da-caixa="">
            <li className={lista.linha}>
              <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Plano necessário</span>
              <span className={juntar(texto.corpo, "ml-3 text-right")}>{e.plano_necessario}</span>
            </li>
            <li className={lista.linha}>
              <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Custo</span>
              <span className={juntar(texto.corpo, "ml-3 text-right font-medium")}>{e.custo.por_usuario_mes}</span>
            </li>
            <li className={lista.linha}>
              <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Cobrança</span>
              <span className={juntar(texto.corpo, "ml-3 text-right")}>{e.custo.cobranca}</span>
            </li>
            <li className={lista.linha}>
              <span className={juntar(texto.auxiliar, "min-w-0 flex-1")}>Fonte</span>
              <span className={juntar(texto.auxiliar, "ml-3 text-right")}>{e.custo.fonte}</span>
            </li>
          </ul>
          <ol className={juntar(texto.corpo, "mt-4 list-decimal space-y-1.5 pl-5")}>
            <li>Contratar o Mail Lite na conta Zoho da Aceleriq (só a caixa que vai aparecer aqui).</li>
            <li>Em E-mail, no domínio da Aceleriq, guardar o token do Zoho com o escopo de leitura de mensagens.</li>
            <li>Nos segredos da função produto-email: ACELERIQ_CAIXA_DOMINIO_ID com o id do domínio e ACELERIQ_CAIXA_LIGADA=sim.</li>
          </ol>
        </Secao>
      </div>
    );
  }
  return (
    <Secao
      titulo="Caixa da Aceleriq"
      descricao={estado.data.dominio || undefined}
      ajuda="As mensagens recentes da caixa oficial, lidas do Zoho. Para responder, abra o webmail."
      acao={
        <span className="flex items-center">
          <button type="button" className={botao.icone} onClick={() => void mensagens.refetch()} aria-label="Atualizar" title="Atualizar">
            <RefreshCw className={juntar("h-4 w-4", mensagens.isFetching && "animate-spin")} aria-hidden="true" />
          </button>
          <a href="https://mail.zoho.com" target="_blank" rel="noreferrer" className={botao.icone} aria-label="Abrir o webmail" title="Abrir o webmail">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </span>
      }
    >
      {mensagens.isLoading ? (
        <Carregando linhas={6} rotulo="Lendo a caixa" />
      ) : mensagens.isError ? (
        <EstadoDeErro titulo={fraseDoErro(mensagens.error, "Não foi possível ler a caixa agora.")} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void mensagens.refetch()}>Tentar de novo</button>} />
      ) : !(mensagens.data || []).length ? (
        <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Caixa vazia." />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} data-mensagens-da-caixa="">
          {(mensagens.data || []).map((m) => (
            <li key={m.id} className={juntar(lista.linha, "items-start")}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate", !m.lida && "font-medium")}>{m.assunto}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{m.de}{m.resumo ? ` · ${m.resumo}` : ""}</span>
              </span>
              {m.recebida_em && <span className={juntar(texto.auxiliar, "ml-3 shrink-0")}>{diaLegivel(m.recebida_em, true)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}
