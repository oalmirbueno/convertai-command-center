import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { isInternalClient } from "@/lib/clientFlags";
import { inicioDoMes, lerPrevisao } from "@/lib/mesa/api";
import { MesaProvider, useCatalogo, type MesaValor } from "@/components/mesa/MesaContexto";
import { useMarcaNaCasca } from "@/components/mesa/SeletorDeMarca";
import EstudioArteRapida from "@/components/mesa/EstudioArteRapida";
import { DetalheDoItem } from "@/components/mesa/AbaEstudio";
import { emColunas, useFaixa } from "@/components/mesa/EstudioAltura";
import { temJanelaAberta } from "@/components/mesa/TelaCheiaDaMesa";
import { useAlturaQueCabe } from "@/components/sistema/AreaDeTrabalho";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { NOVA_ARTE_RAPIDA } from "../../../../supabase/functions/estudio-arte/modulos/arte-rapida";
import GuardarNoLaboratorio from "./GuardarNoLaboratorio";

/**
 * Estúdio livre do Laboratório (19/10/2026). Pedido do dono: "um estúdio com a mesma funcionalidade do
 * estúdio de artes, pegada de arte rápida, carrossel, com a inteligência do estúdio, mas livre: às vezes
 * não é cliente nem projeto, é um trabalho avulso; posso escolher o cliente, mas não quero que entre na
 * mesa do cliente; vai para o arquivo livre organizado".
 *
 * É a arte rápida da Mesa (pedido, arte única ou carrossel, lâminas, conferência, ajustes, diretor,
 * legenda) dentro de um MesaProvider próprio, com a origem 'laboratorio':
 * - sem cliente ("Livre"): o cliente interno da Aceleriq (carteira e marca da agência; sem marca, prompt livre);
 * - com cliente: a marca, o contexto e a carteira dele;
 * - o trabalho nasce com estudio_trabalhos.origem = 'laboratorio' (a Mesa do cliente não lista) e a
 *   Entrega vira "Guardar no arquivo livre" (Workspace global, Laboratório / Livres ou o cliente).
 */

const LIVRE = "";

interface ClienteDaLista {
  id: string;
  nome: string;
  interno: boolean;
}

export default function EstudioLivre({ clientId: clienteDoPai }: { clientId?: string | null }) {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();
  const [escolhido, setEscolhido] = useState<string>(LIVRE);
  const [alvo, setAlvo] = useState<string>(NOVA_ARTE_RAPIDA);
  const [foco, setFoco] = useState(false);
  const [versaoCarteira] = useState(0);

  const role = profile?.role || "";
  const isAdmin = role === "admin";
  const podeRecarregar = role === "admin" || role === "manager";

  const clientes = useMemo<ClienteDaLista[]>(
    () =>
      ((clientesQuery.data || []) as any[])
        .map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente"), interno: isInternalClient(c) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clientesQuery.data],
  );
  // 19/10 (dono: "carteira separada só para o Estúdio livre, sem precisar criar cliente"): a arte livre fica
  // guardada sob o cliente interno da agência (só os arquivos), sem marca, e é cobrada da carteira própria
  // do Estúdio livre (estudio_livre_saldo / estudio_livre_recarregar), nunca da carteira da Aceleriq.
  const internos = clientes.filter((c) => c.interno);
  const interno = internos.filter((c) => /aceleriq/i.test(c.nome))[0] || internos[0] || null;
  // O pai decide o cliente quando passa a prop (null = Livre); senão, o seletor no topo.
  const comSeletor = clienteDoPai === undefined;
  const pedido = comSeletor ? escolhido : clienteDoPai || LIVRE;
  const escolhidoNaLista = pedido ? clientes.filter((c) => c.id === pedido)[0] || null : null;
  const livre = !pedido || (!!escolhidoNaLista && escolhidoNaLista.interno);
  const clientId = livre ? (interno ? interno.id : "") : pedido;
  const clientName = livre ? "Livre" : escolhidoNaLista ? escolhidoNaLista.nome : "";

  // Trocar de cliente começa uma arte nova (o histórico é por cliente).
  useEffect(() => {
    setAlvo(NOVA_ARTE_RAPIDA);
  }, [clientId]);

  // 19/10 (dono: "no Estúdio começa livre, sem logo nem identidade de cliente"): Livre não carrega marca nenhuma.
  const daCasca = useMarcaNaCasca(livre ? "" : clientId, null);
  const marcas = livre ? [] : daCasca.marcas;
  const marca = livre ? null : daCasca.marca;

  const mesAtual = inicioDoMes();
  // Mesmas chaves da Mesa: o saldo da carteira é o mesmo nas telas.
  const carteiraDoLivre = useQuery({
    queryKey: ["estudio-livre", "carteira"],
    enabled: livre,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("estudio_livre_saldo");
      if (error) throw error;
      return (data || {}) as { saldo_usd?: number | string | null; gasto_mes_usd?: number | string | null };
    },
  });
  const consumo = useQuery({
    queryKey: ["mesa", "consumo", clientId, mesAtual],
    enabled: !!clientId && !livre,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("ia_consumo_cliente", { _client_id: clientId, _mes: mesAtual });
      if (error) throw error;
      return (data || {}) as { saldo_usd?: number | string | null };
    },
  });
  const previsao = useQuery({ queryKey: ["mesa", "previsao", clientId], enabled: !!clientId && !livre, queryFn: () => lerPrevisao(clientId) });
  const numero = (v: unknown) => (v === undefined || v === null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const saldoUsd = livre
    ? numero(carteiraDoLivre.data ? carteiraDoLivre.data.saldo_usd : null)
    : numero(consumo.data ? consumo.data.saldo_usd : null) ?? numero(previsao.data ? (previsao.data as { saldo_usd?: unknown }).saldo_usd : null);

  // Recarga da carteira do Estúdio livre, aqui mesmo (só admin; é crédito interno, como na Mesa).
  const recarregarLivre = async () => {
    const resposta = typeof window !== "undefined" ? window.prompt("Quanto colocar na carteira do Estúdio livre? (em dólar, ex.: 5)", "5") : null;
    if (!resposta) return;
    const valor = Number(String(resposta).replace(",", "."));
    if (!isFinite(valor) || valor <= 0) { toast.error("Valor inválido."); return; }
    const { error } = await (supabase as any).rpc("estudio_livre_recarregar", { _valor_usd: valor, _observacao: "Recarga pelo Estúdio livre" });
    if (error) { toast.error(error.message || "Não foi possível recarregar."); return; }
    toast.success(`Carteira do Estúdio livre recarregada com US$ ${valor.toFixed(2)}.`);
    void queryClient.invalidateQueries({ queryKey: ["estudio-livre", "carteira"] });
  };

  const faixa = useFaixa();
  const colunas = emColunas(faixa);
  const focoLigado = foco && colunas;
  const cabe = useAlturaQueCabe(colunas && !focoLigado);
  const medirDeNovo = cabe.medir;
  useEffect(() => {
    medirDeNovo();
  }, [medirDeNovo, alvo, clientId]);
  const [alturaDaJanela, setAlturaDaJanela] = useState<number>(() => (typeof window !== "undefined" ? window.innerHeight || 800 : 800));
  useEffect(() => {
    if (!focoLigado) return;
    const medir = () => setAlturaDaJanela(window.innerHeight || 800);
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      if (e.defaultPrevented || temJanelaAberta()) return;
      setFoco(false);
    };
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("keydown", tecla);
    };
  }, [focoLigado]);

  const valor: MesaValor | null = clientId
    ? {
        clientId,
        clientName,
        userId: user?.id || null,
        isAdmin,
        podeRecarregar,
        saldoUsd,
        catalogo: catalogo.data || [],
        catalogoCarregando: catalogo.isLoading,
        atualizarCusto: () => {
          void queryClient.invalidateQueries({ queryKey: ["mesa", "consumo", clientId] });
          void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
          void queryClient.invalidateQueries({ queryKey: ["estudio-livre", "carteira"] });
        },
        abrirRecarga: livre
          ? () => void recarregarLivre()
          : () => toast.info("Recarregue a carteira pela Mesa do cliente.", { description: `O Estúdio livre usa a carteira de ${clientName}.` }),
        abrirChaves: () => toast.info("As chaves ficam na Mesa do cliente."),
        abrirModelos: () => toast.info("Os modelos ficam na Mesa do cliente."),
        versaoCarteira,
        marcas,
        marca,
      }
    : null;

  const seletor = comSeletor ? (
    <label className="flex min-w-0 items-center" title="Cliente do trabalho (Livre: sem marca, na carteira própria do Estúdio livre, sem cliente)">
      <span className="sr-only">Cliente do trabalho</span>
      <select
        value={livre ? LIVRE : pedido}
        onChange={(e) => setEscolhido(e.target.value)}
        aria-label="Cliente do trabalho"
        className="h-8 w-full min-w-0 rounded-md border border-border bg-background px-2 text-[13px]"
        data-cliente-do-estudio-livre={livre ? "livre" : pedido}
      >
        <option value={LIVRE}>Livre</option>
        {clientes
          .filter((c) => !c.interno)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
      </select>
    </label>
  ) : null;

  if (!valor) {
    if (clientesQuery.isLoading || (livre && !clientesQuery.isSuccess)) return <Carregando forma="aba" rotulo="Abrindo o Estúdio livre" />;
    return (
      <div className="min-w-0 space-y-3" data-estudio-livre="sem-cliente">
        {seletor}
        <EstadoVazio
          icone={<Palette className="h-5 w-5" />}
          titulo={livre ? "Estúdio livre indisponível" : "Cliente indisponível"}
          descricao={livre ? "O Estúdio livre não abriu agora. Atualize a página ou escolha um cliente." : "Escolha outro cliente ou Livre."}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0" data-estudio-livre={livre ? "livre" : clientId}>
      <MesaProvider valor={valor}>
        <EstudioArteRapida
          key={clientId}
          origem="laboratorio"
          semMarca={livre}
          alvo={alvo}
          onAlvo={(novo) => setAlvo(novo)}
          colunas={colunas}
          altura={cabe.altura}
          refDaAltura={cabe.ref}
          foco={focoLigado}
          alturaDaJanela={alturaDaJanela}
          topo={seletor}
          onAbrirItem={() => undefined}
          entregaDaPeca={(t) => <GuardarNoLaboratorio key={t.id} trabalho={t} />}
          renderPeca={(peca) => (
            <DetalheDoItem
              key={peca.item.id}
              item={peca.item}
              trabalho={peca.trabalho}
              arte={null}
              roteiro={null}
              temRoteiro={false}
              publicacaoDe={() => null}
              modo={colunas ? "colunas" : "pilha"}
              foco={focoLigado}
              onFoco={setFoco}
              rapida={peca.rapida}
            />
          )}
        />
      </MesaProvider>
    </div>
  );
}
