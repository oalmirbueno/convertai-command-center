export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ads_account_snapshot: {
        Row: {
          account_status: number | null
          amount_spent: number | null
          balance: number | null
          business_name: string | null
          client_id: string
          coletado_em: string | null
          currency: string | null
          disable_reason: number | null
          erro: string | null
          external_account_id: string
          funding_display: string | null
          funding_type: string | null
          historico_em: string | null
          is_prepay_account: boolean | null
          raw: Json
          saldo_disponivel: number | null
          saldo_em: string | null
          spend_cap: number | null
          tentado_em: string | null
          timezone_name: string | null
        }
        Insert: {
          account_status?: number | null
          amount_spent?: number | null
          balance?: number | null
          business_name?: string | null
          client_id: string
          coletado_em?: string | null
          currency?: string | null
          disable_reason?: number | null
          erro?: string | null
          external_account_id: string
          funding_display?: string | null
          funding_type?: string | null
          historico_em?: string | null
          is_prepay_account?: boolean | null
          raw?: Json
          saldo_disponivel?: number | null
          saldo_em?: string | null
          spend_cap?: number | null
          tentado_em?: string | null
          timezone_name?: string | null
        }
        Update: {
          account_status?: number | null
          amount_spent?: number | null
          balance?: number | null
          business_name?: string | null
          client_id?: string
          coletado_em?: string | null
          currency?: string | null
          disable_reason?: number | null
          erro?: string | null
          external_account_id?: string
          funding_display?: string | null
          funding_type?: string | null
          historico_em?: string | null
          is_prepay_account?: boolean | null
          raw?: Json
          saldo_disponivel?: number | null
          saldo_em?: string | null
          spend_cap?: number | null
          tentado_em?: string | null
          timezone_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_account_snapshot_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_account_snapshot_external_account_id_fkey"
            columns: ["external_account_id"]
            isOneToOne: true
            referencedRelation: "external_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_analises: {
        Row: {
          analise: Json
          client_id: string
          criado_em: string
          criado_por: string | null
          custo_usd: number
          dados: Json
          id: string
          periodo_fim: string | null
          periodo_inicio: string | null
        }
        Insert: {
          analise?: Json
          client_id: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          dados?: Json
          id?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
        }
        Update: {
          analise?: Json
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          dados?: Json
          id?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_analises_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_aprendizados: {
        Row: {
          client_id: string
          criado_em: string
          criado_por: string | null
          criativo_id: string | null
          diagnostico: Json
          evidencia: string
          id: string
          metricas: Json
          periodo_fim: string | null
          periodo_inicio: string | null
          plano_id: string | null
          texto: string
        }
        Insert: {
          client_id: string
          criado_em?: string
          criado_por?: string | null
          criativo_id?: string | null
          diagnostico?: Json
          evidencia?: string
          id?: string
          metricas?: Json
          periodo_fim?: string | null
          periodo_inicio?: string | null
          plano_id?: string | null
          texto: string
        }
        Update: {
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          criativo_id?: string | null
          diagnostico?: Json
          evidencia?: string
          id?: string
          metricas?: Json
          periodo_fim?: string | null
          periodo_inicio?: string | null
          plano_id?: string | null
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_aprendizados_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_aprendizados_criativo_id_fkey"
            columns: ["criativo_id"]
            isOneToOne: false
            referencedRelation: "ads_criativos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_aprendizados_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "ads_planos"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_briefings: {
        Row: {
          atual: boolean
          client_id: string
          criado_em: string
          criado_por: string | null
          destino: Json
          id: string
          objecoes: Json
          objetivo: Json
          oferta: Json
          provas: Json
          publico: Json
          restricoes: string | null
          versao: number
        }
        Insert: {
          atual?: boolean
          client_id: string
          criado_em?: string
          criado_por?: string | null
          destino?: Json
          id?: string
          objecoes?: Json
          objetivo?: Json
          oferta?: Json
          provas?: Json
          publico?: Json
          restricoes?: string | null
          versao?: number
        }
        Update: {
          atual?: boolean
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          destino?: Json
          id?: string
          objecoes?: Json
          objetivo?: Json
          oferta?: Json
          provas?: Json
          publico?: Json
          restricoes?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "ads_briefings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_campaign_daily: {
        Row: {
          action_values: Json
          actions: Json
          campaign_id: string
          campaign_name: string | null
          captured_at: string
          clicks: number | null
          client_id: string
          cost_per_action: Json
          cpc: number | null
          cpm: number | null
          ctr: number | null
          day: string
          external_account_id: string
          frequency: number | null
          id: string
          impressions: number | null
          link_clicks: number | null
          objective: string | null
          reach: number | null
          spend: number | null
        }
        Insert: {
          action_values?: Json
          actions?: Json
          campaign_id: string
          campaign_name?: string | null
          captured_at?: string
          clicks?: number | null
          client_id: string
          cost_per_action?: Json
          cpc?: number | null
          cpm?: number | null
          ctr?: number | null
          day: string
          external_account_id: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          link_clicks?: number | null
          objective?: string | null
          reach?: number | null
          spend?: number | null
        }
        Update: {
          action_values?: Json
          actions?: Json
          campaign_id?: string
          campaign_name?: string | null
          captured_at?: string
          clicks?: number | null
          client_id?: string
          cost_per_action?: Json
          cpc?: number | null
          cpm?: number | null
          ctr?: number | null
          day?: string
          external_account_id?: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          link_clicks?: number | null
          objective?: string | null
          reach?: number | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_campaign_daily_external_account_id_fkey"
            columns: ["external_account_id"]
            isOneToOne: false
            referencedRelation: "external_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_campaigns: {
        Row: {
          campaign_id: string
          client_id: string
          daily_budget: number | null
          effective_status: string | null
          external_account_id: string
          id: string
          lifetime_budget: number | null
          name: string | null
          objective: string | null
          raw: Json
          start_time: string | null
          status: string | null
          stop_time: string | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          client_id: string
          daily_budget?: number | null
          effective_status?: string | null
          external_account_id: string
          id?: string
          lifetime_budget?: number | null
          name?: string | null
          objective?: string | null
          raw?: Json
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          client_id?: string
          daily_budget?: number | null
          effective_status?: string | null
          external_account_id?: string
          id?: string
          lifetime_budget?: number | null
          name?: string | null
          objective?: string | null
          raw?: Json
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_campaigns_external_account_id_fkey"
            columns: ["external_account_id"]
            isOneToOne: false
            referencedRelation: "external_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_creative_daily: {
        Row: {
          action_values: Json | null
          actions: Json | null
          ad_id: string
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          campaign_id: string | null
          campaign_name: string | null
          captured_at: string
          clicks: number | null
          client_id: string
          cost_per_action: Json | null
          cpc: number | null
          cpm: number | null
          ctr: number | null
          day: string
          external_account_id: string
          frequency: number | null
          id: string
          impressions: number | null
          link_clicks: number | null
          objective: string | null
          optimization_goal: string | null
          purchase_roas: Json | null
          reach: number | null
          spend: number | null
        }
        Insert: {
          action_values?: Json | null
          actions?: Json | null
          ad_id: string
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          captured_at?: string
          clicks?: number | null
          client_id: string
          cost_per_action?: Json | null
          cpc?: number | null
          cpm?: number | null
          ctr?: number | null
          day: string
          external_account_id: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          link_clicks?: number | null
          objective?: string | null
          optimization_goal?: string | null
          purchase_roas?: Json | null
          reach?: number | null
          spend?: number | null
        }
        Update: {
          action_values?: Json | null
          actions?: Json | null
          ad_id?: string
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          captured_at?: string
          clicks?: number | null
          client_id?: string
          cost_per_action?: Json | null
          cpc?: number | null
          cpm?: number | null
          ctr?: number | null
          day?: string
          external_account_id?: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          link_clicks?: number | null
          objective?: string | null
          optimization_goal?: string | null
          purchase_roas?: Json | null
          reach?: number | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_creative_daily_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_creative_daily_external_account_id_fkey"
            columns: ["external_account_id"]
            isOneToOne: false
            referencedRelation: "external_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_creatives: {
        Row: {
          ad_id: string
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          campaign_id: string | null
          client_id: string
          corpo: string | null
          creative_id: string | null
          cta_type: string | null
          destino: string | null
          effective_status: string | null
          external_account_id: string
          id: string
          image_url: string | null
          instagram_permalink_url: string | null
          optimization_goal: string | null
          raw: Json
          status: string | null
          thumbnail_url: string | null
          titulo: string | null
          updated_at: string
          video_id: string | null
        }
        Insert: {
          ad_id: string
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          client_id: string
          corpo?: string | null
          creative_id?: string | null
          cta_type?: string | null
          destino?: string | null
          effective_status?: string | null
          external_account_id: string
          id?: string
          image_url?: string | null
          instagram_permalink_url?: string | null
          optimization_goal?: string | null
          raw?: Json
          status?: string | null
          thumbnail_url?: string | null
          titulo?: string | null
          updated_at?: string
          video_id?: string | null
        }
        Update: {
          ad_id?: string
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          client_id?: string
          corpo?: string | null
          creative_id?: string | null
          cta_type?: string | null
          destino?: string | null
          effective_status?: string | null
          external_account_id?: string
          id?: string
          image_url?: string | null
          instagram_permalink_url?: string | null
          optimization_goal?: string | null
          raw?: Json
          status?: string | null
          thumbnail_url?: string | null
          titulo?: string | null
          updated_at?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_creatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_creatives_external_account_id_fkey"
            columns: ["external_account_id"]
            isOneToOne: false
            referencedRelation: "external_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_criativos: {
        Row: {
          ad_id: string | null
          angulo_id: string | null
          atualizado_em: string
          client_id: string
          copy: Json
          criado_em: string
          criado_por: string | null
          evidencia: string
          formato: string
          id: string
          nome: string | null
          plano_id: string | null
          roteiro_video: Json | null
          status: string
          trabalho_id: string | null
        }
        Insert: {
          ad_id?: string | null
          angulo_id?: string | null
          atualizado_em?: string
          client_id: string
          copy?: Json
          criado_em?: string
          criado_por?: string | null
          evidencia?: string
          formato?: string
          id?: string
          nome?: string | null
          plano_id?: string | null
          roteiro_video?: Json | null
          status?: string
          trabalho_id?: string | null
        }
        Update: {
          ad_id?: string | null
          angulo_id?: string | null
          atualizado_em?: string
          client_id?: string
          copy?: Json
          criado_em?: string
          criado_por?: string | null
          evidencia?: string
          formato?: string
          id?: string
          nome?: string | null
          plano_id?: string | null
          roteiro_video?: Json | null
          status?: string
          trabalho_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_criativos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_criativos_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "ads_planos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_criativos_trabalho_id_fkey"
            columns: ["trabalho_id"]
            isOneToOne: false
            referencedRelation: "estudio_trabalhos"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_gerenciador_leituras: {
        Row: {
          arvore: Json
          avisos: Json
          client_id: string
          contas: Json
          criado_em: string
          dias: number | null
          fonte: string
          forcada: boolean
          gestao: Json
          id: string
          lido_em: string
          lido_por: string | null
          periodo_fim: string | null
          periodo_inicio: string | null
          plataforma: string
          resumo: Json
          sincronizado_em: string | null
        }
        Insert: {
          arvore?: Json
          avisos?: Json
          client_id: string
          contas?: Json
          criado_em?: string
          dias?: number | null
          fonte: string
          forcada?: boolean
          gestao?: Json
          id?: string
          lido_em: string
          lido_por?: string | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          plataforma?: string
          resumo?: Json
          sincronizado_em?: string | null
        }
        Update: {
          arvore?: Json
          avisos?: Json
          client_id?: string
          contas?: Json
          criado_em?: string
          dias?: number | null
          fonte?: string
          forcada?: boolean
          gestao?: Json
          id?: string
          lido_em?: string
          lido_por?: string | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          plataforma?: string
          resumo?: Json
          sincronizado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_gerenciador_leituras_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_impressoes: {
        Row: {
          chave: string
          client_id: string
          criado_em: string
          impressao: string
        }
        Insert: {
          chave: string
          client_id: string
          criado_em?: string
          impressao: string
        }
        Update: {
          chave?: string
          client_id?: string
          criado_em?: string
          impressao?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_impressoes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_ofertas: {
        Row: {
          atualizado_em: string
          briefing_id: string | null
          client_id: string
          conversa_id: string | null
          criado_em: string
          criado_por: string | null
          id: string
          jev: Json | null
          nome: string
          oferta: Json
          status: string
        }
        Insert: {
          atualizado_em?: string
          briefing_id?: string | null
          client_id: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          jev?: Json | null
          nome?: string
          oferta?: Json
          status?: string
        }
        Update: {
          atualizado_em?: string
          briefing_id?: string | null
          client_id?: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          jev?: Json | null
          nome?: string
          oferta?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_ofertas_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "ads_briefings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_ofertas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_ofertas_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "agente_conversas"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_planos: {
        Row: {
          angulos: Json
          atualizado_em: string
          briefing_id: string | null
          client_id: string
          conversa_id: string | null
          criado_em: string
          criado_por: string | null
          custo_usd: number
          estrutura: Json
          id: string
          nome: string
          pedido: string | null
          status: string
        }
        Insert: {
          angulos?: Json
          atualizado_em?: string
          briefing_id?: string | null
          client_id: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          estrutura?: Json
          id?: string
          nome?: string
          pedido?: string | null
          status?: string
        }
        Update: {
          angulos?: Json
          atualizado_em?: string
          briefing_id?: string | null
          client_id?: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          estrutura?: Json
          id?: string
          nome?: string
          pedido?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_planos_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "ads_briefings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_planos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_referencias: {
        Row: {
          ad_id: string | null
          ativa: boolean
          atualizado_em: string
          client_id: string | null
          criado_em: string
          criado_por: string | null
          destaque: boolean
          evidencia: string
          ficha: Json
          formato: string | null
          id: string
          mecanismo: string | null
          metricas: Json
          origem: string
          plataforma: string | null
          storage_path: string | null
          tags: string[]
          titulo: string
          url: string | null
        }
        Insert: {
          ad_id?: string | null
          ativa?: boolean
          atualizado_em?: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          destaque?: boolean
          evidencia?: string
          ficha?: Json
          formato?: string | null
          id?: string
          mecanismo?: string | null
          metricas?: Json
          origem?: string
          plataforma?: string | null
          storage_path?: string | null
          tags?: string[]
          titulo: string
          url?: string | null
        }
        Update: {
          ad_id?: string | null
          ativa?: boolean
          atualizado_em?: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          destaque?: boolean
          evidencia?: string
          ficha?: Json
          formato?: string | null
          id?: string
          mecanismo?: string | null
          metricas?: Json
          origem?: string
          plataforma?: string | null
          storage_path?: string | null
          tags?: string[]
          titulo?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_referencias_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_rotina: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          client_id: string
          criado_em: string
          estado: Json
          ligada: boolean
          ligada_em: string | null
          ligada_por: string | null
          limites: Json
          max_acoes_dia: number
          max_acoes_rodada: number
          pausada_em: string | null
          pausada_por: string | null
          proxima_rodada_em: string | null
          regras: Json
          rodando_desde: string | null
          subida_max_pct: number
          teto_diario_brl: number | null
          ultima_rodada_em: string | null
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id: string
          criado_em?: string
          estado?: Json
          ligada?: boolean
          ligada_em?: string | null
          ligada_por?: string | null
          limites?: Json
          max_acoes_dia?: number
          max_acoes_rodada?: number
          pausada_em?: string | null
          pausada_por?: string | null
          proxima_rodada_em?: string | null
          regras?: Json
          rodando_desde?: string | null
          subida_max_pct?: number
          teto_diario_brl?: number | null
          ultima_rodada_em?: string | null
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string
          criado_em?: string
          estado?: Json
          ligada?: boolean
          ligada_em?: string | null
          ligada_por?: string | null
          limites?: Json
          max_acoes_dia?: number
          max_acoes_rodada?: number
          pausada_em?: string | null
          pausada_por?: string | null
          proxima_rodada_em?: string | null
          regras?: Json
          rodando_desde?: string | null
          subida_max_pct?: number
          teto_diario_brl?: number | null
          ultima_rodada_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_rotina_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_rotina_acoes: {
        Row: {
          alvo: Json | null
          client_id: string
          criado_em: string
          criado_por: string | null
          desfazer: Json | null
          desfeita_em: string | null
          desfeita_por: string | null
          estado: string
          id: string
          item_id: string | null
          mensagem_id: string | null
          origem: string
          porque: string
          prova: Json
          resultado_depois: Json | null
          resumo: string
          rodada_id: string | null
          tipo: string
        }
        Insert: {
          alvo?: Json | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          desfazer?: Json | null
          desfeita_em?: string | null
          desfeita_por?: string | null
          estado: string
          id?: string
          item_id?: string | null
          mensagem_id?: string | null
          origem: string
          porque?: string
          prova?: Json
          resultado_depois?: Json | null
          resumo: string
          rodada_id?: string | null
          tipo: string
        }
        Update: {
          alvo?: Json | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          desfazer?: Json | null
          desfeita_em?: string | null
          desfeita_por?: string | null
          estado?: string
          id?: string
          item_id?: string | null
          mensagem_id?: string | null
          origem?: string
          porque?: string
          prova?: Json
          resultado_depois?: Json | null
          resumo?: string
          rodada_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_rotina_acoes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_sales: {
        Row: {
          campaign_id: string | null
          campaign_name: string | null
          channel: string
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          platform: string
          quantity: number
          sold_at: string
          source: string
          updated_at: string
          value: number | null
        }
        Insert: {
          campaign_id?: string | null
          campaign_name?: string | null
          channel?: string
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          platform?: string
          quantity?: number
          sold_at?: string
          source?: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          campaign_id?: string | null
          campaign_name?: string | null
          channel?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          platform?: string
          quantity?: number
          sold_at?: string
          source?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: []
      }
      ads_vinculos: {
        Row: {
          ad_id: string
          client_id: string
          confianca: number | null
          criado_em: string
          criado_por: string | null
          criativo_id: string | null
          estado: string
          id: string
          origem: string
          sinais: Json
        }
        Insert: {
          ad_id: string
          client_id: string
          confianca?: number | null
          criado_em?: string
          criado_por?: string | null
          criativo_id?: string | null
          estado: string
          id?: string
          origem: string
          sinais?: Json
        }
        Update: {
          ad_id?: string
          client_id?: string
          confianca?: number | null
          criado_em?: string
          criado_por?: string | null
          criativo_id?: string | null
          estado?: string
          id?: string
          origem?: string
          sinais?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ads_vinculos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_vinculos_criativo_id_fkey"
            columns: ["criativo_id"]
            isOneToOne: false
            referencedRelation: "ads_criativos"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_wallet: {
        Row: {
          balance: number | null
          client_id: string
          created_at: string | null
          id: string
          last_recharge_date: string | null
          platform: string
        }
        Insert: {
          balance?: number | null
          client_id: string
          created_at?: string | null
          id?: string
          last_recharge_date?: string | null
          platform?: string
        }
        Update: {
          balance?: number | null
          client_id?: string
          created_at?: string | null
          id?: string
          last_recharge_date?: string | null
          platform?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_wallet_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agencia_dados: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          cidade: string | null
          cnpj: string | null
          comarca: string | null
          dados_bancarios: string | null
          email: string | null
          endereco: string | null
          id: boolean
          instagram: string | null
          logo_bucket: string
          logo_path: string | null
          nome_fantasia: string | null
          pix_chave: string | null
          razao_social: string | null
          representante_cpf: string | null
          representante_nome: string | null
          site: string | null
          telefone: string | null
          uf: string | null
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          cidade?: string | null
          cnpj?: string | null
          comarca?: string | null
          dados_bancarios?: string | null
          email?: string | null
          endereco?: string | null
          id?: boolean
          instagram?: string | null
          logo_bucket?: string
          logo_path?: string | null
          nome_fantasia?: string | null
          pix_chave?: string | null
          razao_social?: string | null
          representante_cpf?: string | null
          representante_nome?: string | null
          site?: string | null
          telefone?: string | null
          uf?: string | null
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          cidade?: string | null
          cnpj?: string | null
          comarca?: string | null
          dados_bancarios?: string | null
          email?: string | null
          endereco?: string | null
          id?: boolean
          instagram?: string | null
          logo_bucket?: string
          logo_path?: string | null
          nome_fantasia?: string | null
          pix_chave?: string | null
          razao_social?: string | null
          representante_cpf?: string | null
          representante_nome?: string | null
          site?: string | null
          telefone?: string | null
          uf?: string | null
        }
        Relationships: []
      }
      agent_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      agente_computador_tarefas: {
        Row: {
          app: string
          aprovado_em: string | null
          aprovado_por: string | null
          atualizado_em: string
          client_id: string | null
          criado_em: string
          criado_por: string | null
          estado: string
          id: string
          irreversivel: boolean
          motivo: string | null
          passos: Json
          provas: Json
          titulo: string
        }
        Insert: {
          app?: string
          aprovado_em?: string | null
          aprovado_por?: string | null
          atualizado_em?: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          estado?: string
          id?: string
          irreversivel?: boolean
          motivo?: string | null
          passos?: Json
          provas?: Json
          titulo: string
        }
        Update: {
          app?: string
          aprovado_em?: string | null
          aprovado_por?: string | null
          atualizado_em?: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          estado?: string
          id?: string
          irreversivel?: boolean
          motivo?: string | null
          passos?: Json
          provas?: Json
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "agente_computador_tarefas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_conversas: {
        Row: {
          agente: string
          client_id: string
          criado_em: string
          criado_por: string | null
          id: string
          referencia_id: string | null
          referencia_tipo: string | null
        }
        Insert: {
          agente: string
          client_id: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          referencia_id?: string | null
          referencia_tipo?: string | null
        }
        Update: {
          agente?: string
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          referencia_id?: string | null
          referencia_tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agente_conversas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_memoria: {
        Row: {
          agente: string
          area: string | null
          ativa: boolean
          categoria: string | null
          chave: string | null
          client_id: string
          criado_em: string
          criado_por: string | null
          evidencia: string | null
          fonte: string | null
          id: string
          motivo: string | null
          origem: string
          referencia_id: string | null
          reforcado_em: string | null
          reforcos: number
          substituida_por: string | null
          texto: string
          tipo: string
          valido_ate: string | null
        }
        Insert: {
          agente: string
          area?: string | null
          ativa?: boolean
          categoria?: string | null
          chave?: string | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          evidencia?: string | null
          fonte?: string | null
          id?: string
          motivo?: string | null
          origem: string
          referencia_id?: string | null
          reforcado_em?: string | null
          reforcos?: number
          substituida_por?: string | null
          texto: string
          tipo: string
          valido_ate?: string | null
        }
        Update: {
          agente?: string
          area?: string | null
          ativa?: boolean
          categoria?: string | null
          chave?: string | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          evidencia?: string | null
          fonte?: string | null
          id?: string
          motivo?: string | null
          origem?: string
          referencia_id?: string | null
          reforcado_em?: string | null
          reforcos?: number
          substituida_por?: string | null
          texto?: string
          tipo?: string
          valido_ate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agente_memoria_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_mensagens: {
        Row: {
          anexos: Json
          client_id: string
          conteudo: string
          conversa_id: string
          criado_em: string
          id: string
          papel: string
          uso_id: string | null
        }
        Insert: {
          anexos?: Json
          client_id: string
          conteudo: string
          conversa_id: string
          criado_em?: string
          id?: string
          papel: string
          uso_id?: string | null
        }
        Update: {
          anexos?: Json
          client_id?: string
          conteudo?: string
          conversa_id?: string
          criado_em?: string
          id?: string
          papel?: string
          uso_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agente_mensagens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_mensagens_conversa_fk"
            columns: ["conversa_id", "client_id"]
            isOneToOne: false
            referencedRelation: "agente_conversas"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "agente_mensagens_uso_id_fkey"
            columns: ["uso_id"]
            isOneToOne: false
            referencedRelation: "ia_usos"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_prompts: {
        Row: {
          agente: string
          ativo: boolean
          client_id: string | null
          conteudo: string
          criado_em: string
          criado_por: string | null
          id: string
          versao: number
        }
        Insert: {
          agente: string
          ativo?: boolean
          client_id?: string | null
          conteudo: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          versao: number
        }
        Update: {
          agente?: string
          ativo?: boolean
          client_id?: string | null
          conteudo?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "agente_prompts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_hourly: {
        Row: {
          request_count: number
          updated_at: string
          user_id: string
          window_start: string
          workload: string
        }
        Insert: {
          request_count?: number
          updated_at?: string
          user_id: string
          window_start: string
          workload: string
        }
        Update: {
          request_count?: number
          updated_at?: string
          user_id?: string
          window_start?: string
          workload?: string
        }
        Relationships: []
      }
      api_audit_log: {
        Row: {
          action: string
          created_at: string
          error_message: string | null
          id: string
          ip_address: string | null
          key_name: string | null
          params: Json | null
          status_code: number | null
        }
        Insert: {
          action: string
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          key_name?: string | null
          params?: Json | null
          status_code?: number | null
        }
        Update: {
          action?: string
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          key_name?: string | null
          params?: Json | null
          status_code?: number | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          audience: string | null
          client_scope_mode: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_preview: string
          last_used_at: string | null
          name: string
          origin: string | null
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          audience?: string | null
          client_scope_mode?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_preview: string
          last_used_at?: string | null
          name: string
          origin?: string | null
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          audience?: string | null
          client_scope_mode?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_preview?: string
          last_used_at?: string | null
          name?: string
          origin?: string | null
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: []
      }
      aprovacao_email_log: {
        Row: {
          created_at: string
          id: number
          mais_recente: string | null
          qtd: number
          request_id: number | null
          tipo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          mais_recente?: string | null
          qtd?: number
          request_id?: number | null
          tipo: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          mais_recente?: string | null
          qtd?: number
          request_id?: number | null
          tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      assignment_proposals: {
        Row: {
          confianca: number | null
          created_at: string
          current_assignee: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          evidencias: Json
          id: string
          impacto: string | null
          justificativa: string
          kanban_task_id: string
          operator_id: string
          prazo: string | null
          status: string
          suggested_assignee: string
        }
        Insert: {
          confianca?: number | null
          created_at?: string
          current_assignee?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          evidencias?: Json
          id?: string
          impacto?: string | null
          justificativa: string
          kanban_task_id: string
          operator_id: string
          prazo?: string | null
          status?: string
          suggested_assignee: string
        }
        Update: {
          confianca?: number | null
          created_at?: string
          current_assignee?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          evidencias?: Json
          id?: string
          impacto?: string | null
          justificativa?: string
          kanban_task_id?: string
          operator_id?: string
          prazo?: string | null
          status?: string
          suggested_assignee?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_proposals_current_assignee_fkey"
            columns: ["current_assignee"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_proposals_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "internal_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_proposals_suggested_assignee_fkey"
            columns: ["suggested_assignee"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          description: string | null
          due_date: string
          id: string
          paid_amount: number | null
          paid_date: string | null
          platform: string | null
          reminder_count: number | null
          status: string
          type: string
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string
          description?: string | null
          due_date: string
          id?: string
          paid_amount?: number | null
          paid_date?: string | null
          platform?: string | null
          reminder_count?: number | null
          status?: string
          type: string
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          paid_amount?: number | null
          paid_date?: string | null
          platform?: string | null
          reminder_count?: number | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_anexos: {
        Row: {
          arquivado_em: string | null
          arquivado_por: string | null
          briefing_id: string
          campo: string | null
          categoria: string
          client_id: string
          concluido_em: string | null
          criado_em: string
          erro: string | null
          file_id: string | null
          id: string
          mime: string | null
          nome: string
          status: string
          storage_path: string | null
          tamanho: number
        }
        Insert: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          briefing_id: string
          campo?: string | null
          categoria?: string
          client_id: string
          concluido_em?: string | null
          criado_em?: string
          erro?: string | null
          file_id?: string | null
          id?: string
          mime?: string | null
          nome: string
          status?: string
          storage_path?: string | null
          tamanho: number
        }
        Update: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          briefing_id?: string
          campo?: string | null
          categoria?: string
          client_id?: string
          concluido_em?: string | null
          criado_em?: string
          erro?: string | null
          file_id?: string | null
          id?: string
          mime?: string | null
          nome?: string
          status?: string
          storage_path?: string | null
          tamanho?: number
        }
        Relationships: [
          {
            foreignKeyName: "briefing_anexos_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_anexos_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_decupagens: {
        Row: {
          aplicada_em: string | null
          aplicada_por: string | null
          aplicadas: Json | null
          briefing_id: string
          client_id: string | null
          concluido_em: string | null
          criado_em: string
          custo_usd: number
          desfeita_em: string | null
          desfeita_por: string | null
          destino: Json | null
          envio: number
          erro: string | null
          id: string
          iniciado_em: string | null
          itens: Json
          marca_id: string | null
          status: string
          sugestoes: Json
          tentativas: number
          tom_de_voz: string | null
        }
        Insert: {
          aplicada_em?: string | null
          aplicada_por?: string | null
          aplicadas?: Json | null
          briefing_id: string
          client_id?: string | null
          concluido_em?: string | null
          criado_em?: string
          custo_usd?: number
          desfeita_em?: string | null
          desfeita_por?: string | null
          destino?: Json | null
          envio?: number
          erro?: string | null
          id?: string
          iniciado_em?: string | null
          itens?: Json
          marca_id?: string | null
          status?: string
          sugestoes?: Json
          tentativas?: number
          tom_de_voz?: string | null
        }
        Update: {
          aplicada_em?: string | null
          aplicada_por?: string | null
          aplicadas?: Json | null
          briefing_id?: string
          client_id?: string | null
          concluido_em?: string | null
          criado_em?: string
          custo_usd?: number
          desfeita_em?: string | null
          desfeita_por?: string | null
          destino?: Json | null
          envio?: number
          erro?: string | null
          id?: string
          iniciado_em?: string | null
          itens?: Json
          marca_id?: string | null
          status?: string
          sugestoes?: Json
          tentativas?: number
          tom_de_voz?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "briefing_decupagens_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefings"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_modelos: {
        Row: {
          ativo: boolean
          conteudo: Json
          criado_em: string
          criado_por: string | null
          id: string
          nota: string | null
          slug: string
          titulo: string | null
          versao: number
        }
        Insert: {
          ativo?: boolean
          conteudo: Json
          criado_em?: string
          criado_por?: string | null
          id?: string
          nota?: string | null
          slug: string
          titulo?: string | null
          versao: number
        }
        Update: {
          ativo?: boolean
          conteudo?: Json
          criado_em?: string
          criado_por?: string | null
          id?: string
          nota?: string | null
          slug?: string
          titulo?: string | null
          versao?: number
        }
        Relationships: []
      }
      briefing_transcricoes: {
        Row: {
          briefing_id: string
          campo: string | null
          caracteres: number | null
          client_id: string
          concluido_em: string | null
          criado_em: string
          custo_usd: number
          erro: string | null
          id: string
          segundos: number
          status: string
        }
        Insert: {
          briefing_id: string
          campo?: string | null
          caracteres?: number | null
          client_id: string
          concluido_em?: string | null
          criado_em?: string
          custo_usd?: number
          erro?: string | null
          id?: string
          segundos: number
          status?: string
        }
        Update: {
          briefing_id?: string
          campo?: string | null
          caracteres?: number | null
          client_id?: string
          concluido_em?: string | null
          criado_em?: string
          custo_usd?: number
          erro?: string | null
          id?: string
          segundos?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_transcricoes_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefings"
            referencedColumns: ["id"]
          },
        ]
      }
      briefings: {
        Row: {
          arquivado_em: string | null
          arquivo_pdf_id: string | null
          client_id: string | null
          created_at: string | null
          criado_por: string | null
          enviado_em: string | null
          envios: number
          expira_em: string | null
          exportado: Json | null
          id: string
          lembrete_avisado_em: string | null
          lembretes: number
          marca_id: string | null
          modelo: string | null
          modelo_conteudo: Json | null
          modelo_versao: number | null
          preenchido_ia: Json | null
          prefill: Json
          project_id: string | null
          rascunho_salvo_em: string | null
          reaberto_em: string | null
          reaberto_por: string | null
          reabertura_motivo: string | null
          reabertura_pedida_em: string | null
          required: boolean | null
          responses: Json | null
          submitted: boolean | null
          titulo: string | null
          token: string
          ultimo_lembrete_em: string | null
        }
        Insert: {
          arquivado_em?: string | null
          arquivo_pdf_id?: string | null
          client_id?: string | null
          created_at?: string | null
          criado_por?: string | null
          enviado_em?: string | null
          envios?: number
          expira_em?: string | null
          exportado?: Json | null
          id?: string
          lembrete_avisado_em?: string | null
          lembretes?: number
          marca_id?: string | null
          modelo?: string | null
          modelo_conteudo?: Json | null
          modelo_versao?: number | null
          preenchido_ia?: Json | null
          prefill?: Json
          project_id?: string | null
          rascunho_salvo_em?: string | null
          reaberto_em?: string | null
          reaberto_por?: string | null
          reabertura_motivo?: string | null
          reabertura_pedida_em?: string | null
          required?: boolean | null
          responses?: Json | null
          submitted?: boolean | null
          titulo?: string | null
          token?: string
          ultimo_lembrete_em?: string | null
        }
        Update: {
          arquivado_em?: string | null
          arquivo_pdf_id?: string | null
          client_id?: string | null
          created_at?: string | null
          criado_por?: string | null
          enviado_em?: string | null
          envios?: number
          expira_em?: string | null
          exportado?: Json | null
          id?: string
          lembrete_avisado_em?: string | null
          lembretes?: number
          marca_id?: string | null
          modelo?: string | null
          modelo_conteudo?: Json | null
          modelo_versao?: number | null
          preenchido_ia?: Json | null
          prefill?: Json
          project_id?: string | null
          rascunho_salvo_em?: string | null
          reaberto_em?: string | null
          reaberto_por?: string | null
          reabertura_motivo?: string | null
          reabertura_pedida_em?: string | null
          required?: boolean | null
          responses?: Json | null
          submitted?: boolean | null
          titulo?: string | null
          token?: string
          ultimo_lembrete_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "briefings_arquivo_pdf_fk"
            columns: ["arquivo_pdf_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefings_marca_fk"
            columns: ["marca_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "briefings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      calendario_propostas: {
        Row: {
          atualizado_em: string
          client_id: string
          conversa_id: string | null
          criado_em: string
          criado_por: string | null
          diagnostico: string | null
          gravada_em: string | null
          id: string
          itens: Json
          parametros: Json
          periodo_fim: string
          periodo_inicio: string
          project_id: string | null
          status: string
          task_ids: string[]
          temas: Json
        }
        Insert: {
          atualizado_em?: string
          client_id: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          diagnostico?: string | null
          gravada_em?: string | null
          id?: string
          itens?: Json
          parametros?: Json
          periodo_fim: string
          periodo_inicio: string
          project_id?: string | null
          status?: string
          task_ids?: string[]
          temas?: Json
        }
        Update: {
          atualizado_em?: string
          client_id?: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          diagnostico?: string | null
          gravada_em?: string | null
          id?: string
          itens?: Json
          parametros?: Json
          periodo_fim?: string
          periodo_inicio?: string
          project_id?: string | null
          status?: string
          task_ids?: string[]
          temas?: Json
        }
        Relationships: [
          {
            foreignKeyName: "calendario_propostas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendario_propostas_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "agente_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendario_propostas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      central_review_dispatches: {
        Row: {
          approval_id: string
          status: string
          updated_at: string
        }
        Insert: {
          approval_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          approval_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "central_review_dispatches_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: true
            referencedRelation: "operator_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      central_review_events: {
        Row: {
          actor_id: string | null
          approval_id: string
          comment: string | null
          created_at: string
          event: string
          id: string
          idempotency_key: string | null
          input_hash: string | null
          result: Json | null
        }
        Insert: {
          actor_id?: string | null
          approval_id: string
          comment?: string | null
          created_at?: string
          event: string
          id?: string
          idempotency_key?: string | null
          input_hash?: string | null
          result?: Json | null
        }
        Update: {
          actor_id?: string | null
          approval_id?: string
          comment?: string | null
          created_at?: string
          event?: string
          id?: string
          idempotency_key?: string | null
          input_hash?: string | null
          result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "central_review_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_review_events_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "operator_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      client_dossiers: {
        Row: {
          actor: string | null
          change_reason: string | null
          client_id: string
          content: string
          correlation_id: string | null
          created_at: string
          dossier_type: string
          effective_at: string
          id: string
          idempotency_key: string | null
          is_current: boolean
          metadata: Json
          prior_version_id: string | null
          project_id: string | null
          source: string | null
          summary: string | null
          superseded_at: string | null
          superseded_by: string | null
          tags: string[]
          updated_at: string
          version: number
        }
        Insert: {
          actor?: string | null
          change_reason?: string | null
          client_id: string
          content: string
          correlation_id?: string | null
          created_at?: string
          dossier_type?: string
          effective_at?: string
          id?: string
          idempotency_key?: string | null
          is_current?: boolean
          metadata?: Json
          prior_version_id?: string | null
          project_id?: string | null
          source?: string | null
          summary?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          actor?: string | null
          change_reason?: string | null
          client_id?: string
          content?: string
          correlation_id?: string | null
          created_at?: string
          dossier_type?: string
          effective_at?: string
          id?: string
          idempotency_key?: string | null
          is_current?: boolean
          metadata?: Json
          prior_version_id?: string | null
          project_id?: string | null
          source?: string | null
          summary?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_dossiers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_dossiers_prior_version_id_fkey"
            columns: ["prior_version_id"]
            isOneToOne: false
            referencedRelation: "client_dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_dossiers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_dossiers_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "client_dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_onboarding_items: {
        Row: {
          client_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          is_done: boolean
          is_skipped: boolean
          template_item_id: string
          updated_at: string
          value: string | null
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_done?: boolean
          is_skipped?: boolean
          template_item_id: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_done?: boolean
          is_skipped?: boolean
          template_item_id?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_onboarding_items_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "service_checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      client_requests: {
        Row: {
          ai_draft: string | null
          client_id: string
          created_at: string
          description: string
          id: string
          priority: string
          project_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_draft?: string | null
          client_id: string
          created_at?: string
          description: string
          id?: string
          priority?: string
          project_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_draft?: string | null
          client_id?: string
          created_at?: string
          description?: string
          id?: string
          priority?: string
          project_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      client_vault: {
        Row: {
          category: string
          client_id: string
          created_at: string
          created_by: string | null
          icon_url: string | null
          id: string
          item_order: number
          notes: string | null
          password: string | null
          title: string
          updated_at: string
          url: string | null
          username: string | null
        }
        Insert: {
          category?: string
          client_id: string
          created_at?: string
          created_by?: string | null
          icon_url?: string | null
          id?: string
          item_order?: number
          notes?: string | null
          password?: string | null
          title: string
          updated_at?: string
          url?: string | null
          username?: string | null
        }
        Update: {
          category?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          icon_url?: string | null
          id?: string
          item_order?: number
          notes?: string | null
          password?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          username?: string | null
        }
        Relationships: []
      }
      cliente_dados_fiscais: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          bairro: string | null
          cep: string | null
          cidade: string | null
          client_id: string
          complemento: string | null
          consultado_em: string | null
          criado_em: string
          documento: string | null
          email_cobranca: string | null
          email_contrato: string | null
          fonte: string
          logradouro: string | null
          nome_fantasia: string | null
          numero: string | null
          razao_social: string | null
          representante_cargo: string | null
          representante_cpf: string | null
          representante_nome: string | null
          situacao_cadastral: string | null
          telefone: string | null
          tipo_pessoa: string | null
          uf: string | null
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          client_id: string
          complemento?: string | null
          consultado_em?: string | null
          criado_em?: string
          documento?: string | null
          email_cobranca?: string | null
          email_contrato?: string | null
          fonte?: string
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          razao_social?: string | null
          representante_cargo?: string | null
          representante_cpf?: string | null
          representante_nome?: string | null
          situacao_cadastral?: string | null
          telefone?: string | null
          tipo_pessoa?: string | null
          uf?: string | null
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          client_id?: string
          complemento?: string | null
          consultado_em?: string | null
          criado_em?: string
          documento?: string | null
          email_cobranca?: string | null
          email_contrato?: string | null
          fonte?: string
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          razao_social?: string | null
          representante_cargo?: string | null
          representante_cpf?: string | null
          representante_nome?: string | null
          situacao_cadastral?: string | null
          telefone?: string | null
          tipo_pessoa?: string | null
          uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_dados_fiscais_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_estilos: {
        Row: {
          aprendizados: Json
          ativo: boolean
          atualizado_em: string
          atualizado_por: string | null
          client_id: string
          criado_em: string
          criado_por: string | null
          id: string
          marca_id: string | null
          testes: Json
          versao_atual: number
          versoes: Json
        }
        Insert: {
          aprendizados?: Json
          ativo?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          marca_id?: string | null
          testes?: Json
          versao_atual?: number
          versoes?: Json
        }
        Update: {
          aprendizados?: Json
          ativo?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          marca_id?: string | null
          testes?: Json
          versao_atual?: number
          versoes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cliente_estilos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_estilos_marca_fk"
            columns: ["marca_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      cliente_fontes: {
        Row: {
          amostra_path: string | null
          biblioteca_id: string | null
          client_id: string
          criado_em: string
          id: string
          marca_id: string | null
          nome: string
          origem: string
          papel: string
          storage_path: string
        }
        Insert: {
          amostra_path?: string | null
          biblioteca_id?: string | null
          client_id: string
          criado_em?: string
          id?: string
          marca_id?: string | null
          nome: string
          origem?: string
          papel: string
          storage_path: string
        }
        Update: {
          amostra_path?: string | null
          biblioteca_id?: string | null
          client_id?: string
          criado_em?: string
          id?: string
          marca_id?: string | null
          nome?: string
          origem?: string
          papel?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_fontes_biblioteca_id_fkey"
            columns: ["biblioteca_id"]
            isOneToOne: false
            referencedRelation: "fontes_biblioteca"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_fontes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_fontes_marca_fk"
            columns: ["marca_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      cliente_imagens: {
        Row: {
          altura: number | null
          aprovada: boolean
          aprovada_em: string | null
          ativa: boolean
          atualizado_em: string
          categoria: string | null
          client_id: string
          criado_em: string
          derivada_de: string | null
          descricao: string | null
          file_id: string | null
          gerada: boolean
          id: string
          kit_id: string | null
          largura: number | null
          modo: string | null
          nome: string
          origem: string
          pasta: string | null
          sha256: string | null
          storage_bucket: string
          storage_path: string
          tags: string[]
          workspace_node_id: string | null
        }
        Insert: {
          altura?: number | null
          aprovada?: boolean
          aprovada_em?: string | null
          ativa?: boolean
          atualizado_em?: string
          categoria?: string | null
          client_id: string
          criado_em?: string
          derivada_de?: string | null
          descricao?: string | null
          file_id?: string | null
          gerada?: boolean
          id?: string
          kit_id?: string | null
          largura?: number | null
          modo?: string | null
          nome: string
          origem: string
          pasta?: string | null
          sha256?: string | null
          storage_bucket: string
          storage_path: string
          tags?: string[]
          workspace_node_id?: string | null
        }
        Update: {
          altura?: number | null
          aprovada?: boolean
          aprovada_em?: string | null
          ativa?: boolean
          atualizado_em?: string
          categoria?: string | null
          client_id?: string
          criado_em?: string
          derivada_de?: string | null
          descricao?: string | null
          file_id?: string | null
          gerada?: boolean
          id?: string
          kit_id?: string | null
          largura?: number | null
          modo?: string | null
          nome?: string
          origem?: string
          pasta?: string | null
          sha256?: string | null
          storage_bucket?: string
          storage_path?: string
          tags?: string[]
          workspace_node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_imagens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_imagens_derivada_de_fk"
            columns: ["derivada_de", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_imagens"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "cliente_imagens_kit_fk"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "foto_kits"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_instagram_destaques: {
        Row: {
          arquivado_em: string | null
          arquivado_por: string | null
          caminho: string | null
          client_id: string
          conta_chave: string
          criado_em: string
          criado_por: string | null
          custo_usd: number
          estilo: Json
          icone: string | null
          id: string
          modelo_id: string | null
          nome: string
          ordem: number
        }
        Insert: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          caminho?: string | null
          client_id: string
          conta_chave?: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          estilo?: Json
          icone?: string | null
          id?: string
          modelo_id?: string | null
          nome: string
          ordem?: number
        }
        Update: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          caminho?: string | null
          client_id?: string
          conta_chave?: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          estilo?: Json
          icone?: string | null
          id?: string
          modelo_id?: string | null
          nome?: string
          ordem?: number
        }
        Relationships: [
          {
            foreignKeyName: "cliente_instagram_destaques_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_instagram_planos: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          bio_analise: Json | null
          client_id: string
          conta_chave: string
          criado_em: string
          id: string
          ordem: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          bio_analise?: Json | null
          client_id: string
          conta_chave: string
          criado_em?: string
          id?: string
          ordem?: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          bio_analise?: Json | null
          client_id?: string
          conta_chave?: string
          criado_em?: string
          id?: string
          ordem?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cliente_instagram_planos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_kit_marca: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          client_id: string
          contexto: Json
          contexto_atualizado_em: string | null
          estilo: string | null
          logo_alt_file_id: string | null
          logo_alt_path: string | null
          logo_alt_tom: string | null
          logo_file_id: string | null
          logo_path: string | null
          logo_tom: string | null
          paleta: Json
          regras: string | null
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id: string
          contexto?: Json
          contexto_atualizado_em?: string | null
          estilo?: string | null
          logo_alt_file_id?: string | null
          logo_alt_path?: string | null
          logo_alt_tom?: string | null
          logo_file_id?: string | null
          logo_path?: string | null
          logo_tom?: string | null
          paleta?: Json
          regras?: string | null
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string
          contexto?: Json
          contexto_atualizado_em?: string | null
          estilo?: string | null
          logo_alt_file_id?: string | null
          logo_alt_path?: string | null
          logo_alt_tom?: string | null
          logo_file_id?: string | null
          logo_path?: string | null
          logo_tom?: string | null
          paleta?: Json
          regras?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_kit_marca_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_kit_marca_logo_alt_file_id_fkey"
            columns: ["logo_alt_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_kit_marca_logo_file_id_fkey"
            columns: ["logo_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_marcas: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          client_id: string
          contexto: Json
          contexto_extra: string | null
          criado_em: string
          criado_por: string | null
          estilo: string | null
          id: string
          logo_alt_file_id: string | null
          logo_alt_path: string | null
          logo_alt_tom: string | null
          logo_file_id: string | null
          logo_path: string | null
          logo_tom: string | null
          nome: string
          ordem: number
          paleta: Json
          principal: boolean
          project_id: string | null
          regras: string | null
          tom: string | null
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id: string
          contexto?: Json
          contexto_extra?: string | null
          criado_em?: string
          criado_por?: string | null
          estilo?: string | null
          id?: string
          logo_alt_file_id?: string | null
          logo_alt_path?: string | null
          logo_alt_tom?: string | null
          logo_file_id?: string | null
          logo_path?: string | null
          logo_tom?: string | null
          nome: string
          ordem?: number
          paleta?: Json
          principal?: boolean
          project_id?: string | null
          regras?: string | null
          tom?: string | null
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string
          contexto?: Json
          contexto_extra?: string | null
          criado_em?: string
          criado_por?: string | null
          estilo?: string | null
          id?: string
          logo_alt_file_id?: string | null
          logo_alt_path?: string | null
          logo_alt_tom?: string | null
          logo_file_id?: string | null
          logo_path?: string | null
          logo_tom?: string | null
          nome?: string
          ordem?: number
          paleta?: Json
          principal?: boolean
          project_id?: string | null
          regras?: string | null
          tom?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_marcas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_marcas_logo_alt_file_id_fkey"
            columns: ["logo_alt_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_marcas_logo_file_id_fkey"
            columns: ["logo_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_marcas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_perfis_instagram: {
        Row: {
          arquivado_em: string | null
          arquivado_por: string | null
          atualizado_em: string
          biografia: string | null
          captura_por: string | null
          capturado_em: string | null
          client_id: string
          conversa_id: string | null
          criado_em: string
          criado_por: string | null
          foto_caminho: string | null
          handle: string
          id: string
          ig_id: string | null
          marca_id: string | null
          metricas: Json | null
          monitorar: boolean
          nome: string | null
          origem: string
          papel: string
          posts_total: number | null
          proxima_rodada_em: string | null
          resumo: Json | null
          seguidores: number | null
          ultima_rodada_em: string | null
          ultimo_erro: string | null
        }
        Insert: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          biografia?: string | null
          captura_por?: string | null
          capturado_em?: string | null
          client_id: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          foto_caminho?: string | null
          handle: string
          id?: string
          ig_id?: string | null
          marca_id?: string | null
          metricas?: Json | null
          monitorar?: boolean
          nome?: string | null
          origem?: string
          papel: string
          posts_total?: number | null
          proxima_rodada_em?: string | null
          resumo?: Json | null
          seguidores?: number | null
          ultima_rodada_em?: string | null
          ultimo_erro?: string | null
        }
        Update: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          biografia?: string | null
          captura_por?: string | null
          capturado_em?: string | null
          client_id?: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          foto_caminho?: string | null
          handle?: string
          id?: string
          ig_id?: string | null
          marca_id?: string | null
          metricas?: Json | null
          monitorar?: boolean
          nome?: string | null
          origem?: string
          papel?: string
          posts_total?: number | null
          proxima_rodada_em?: string | null
          resumo?: Json | null
          seguidores?: number | null
          ultima_rodada_em?: string | null
          ultimo_erro?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_perfis_instagram_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_perfis_instagram_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "agente_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_perfis_instagram_marca_fk"
            columns: ["marca_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      cliente_perfis_posts: {
        Row: {
          arquivado_em: string | null
          atualizado_em: string
          client_id: string
          combina: number | null
          comentarios: number | null
          criado_em: string
          curtidas: number | null
          engajamento: number | null
          fora_da_curva: boolean
          formato: string
          formato_editorial: string | null
          id: string
          ig_media_id: string
          legenda: string | null
          leitura: string | null
          lido_em: string | null
          midia_caminho: string | null
          origem: string
          perfil_id: string
          permalink: string | null
          pilar: string | null
          publicado_em: string | null
          vezes_a_mediana: number | null
        }
        Insert: {
          arquivado_em?: string | null
          atualizado_em?: string
          client_id: string
          combina?: number | null
          comentarios?: number | null
          criado_em?: string
          curtidas?: number | null
          engajamento?: number | null
          fora_da_curva?: boolean
          formato?: string
          formato_editorial?: string | null
          id?: string
          ig_media_id: string
          legenda?: string | null
          leitura?: string | null
          lido_em?: string | null
          midia_caminho?: string | null
          origem?: string
          perfil_id: string
          permalink?: string | null
          pilar?: string | null
          publicado_em?: string | null
          vezes_a_mediana?: number | null
        }
        Update: {
          arquivado_em?: string | null
          atualizado_em?: string
          client_id?: string
          combina?: number | null
          comentarios?: number | null
          criado_em?: string
          curtidas?: number | null
          engajamento?: number | null
          fora_da_curva?: boolean
          formato?: string
          formato_editorial?: string | null
          id?: string
          ig_media_id?: string
          legenda?: string | null
          leitura?: string | null
          lido_em?: string | null
          midia_caminho?: string | null
          origem?: string
          perfil_id?: string
          permalink?: string | null
          pilar?: string | null
          publicado_em?: string | null
          vezes_a_mediana?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_perfis_posts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_perfis_posts_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "cliente_perfis_instagram"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_perfis_rodadas: {
        Row: {
          client_id: string
          criado_por: string | null
          custo_usd: number
          erro: string | null
          fora_da_curva: number
          id: string
          ideias: Json
          iniciada_em: string
          lidos: number
          novos: number
          perfil_id: string | null
          resumo: string | null
          status: string
          terminada_em: string | null
          tipo: string
        }
        Insert: {
          client_id: string
          criado_por?: string | null
          custo_usd?: number
          erro?: string | null
          fora_da_curva?: number
          id?: string
          ideias?: Json
          iniciada_em?: string
          lidos?: number
          novos?: number
          perfil_id?: string | null
          resumo?: string | null
          status: string
          terminada_em?: string | null
          tipo: string
        }
        Update: {
          client_id?: string
          criado_por?: string | null
          custo_usd?: number
          erro?: string | null
          fora_da_curva?: number
          id?: string
          ideias?: Json
          iniciada_em?: string
          lidos?: number
          novos?: number
          perfil_id?: string | null
          resumo?: string | null
          status?: string
          terminada_em?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_perfis_rodadas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_perfis_rodadas_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "cliente_perfis_instagram"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_redes_sociais: {
        Row: {
          arquivado_em: string | null
          arquivado_por: string | null
          client_id: string
          criado_em: string
          criado_por: string | null
          endereco: string
          id: string
          rede: string
        }
        Insert: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          endereco: string
          id?: string
          rede: string
        }
        Update: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          endereco?: string
          id?: string
          rede?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_redes_sociais_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_referencias: {
        Row: {
          ativa: boolean
          client_id: string
          criado_em: string
          destaque: boolean
          file_id: string | null
          id: string
          leitura: string | null
          marca_id: string | null
          origem: string
          papel: string
          storage_path: string | null
          tags: string[]
          url_origem: string | null
          workspace_node_id: string | null
        }
        Insert: {
          ativa?: boolean
          client_id: string
          criado_em?: string
          destaque?: boolean
          file_id?: string | null
          id?: string
          leitura?: string | null
          marca_id?: string | null
          origem: string
          papel?: string
          storage_path?: string | null
          tags?: string[]
          url_origem?: string | null
          workspace_node_id?: string | null
        }
        Update: {
          ativa?: boolean
          client_id?: string
          criado_em?: string
          destaque?: boolean
          file_id?: string | null
          id?: string
          leitura?: string | null
          marca_id?: string | null
          origem?: string
          papel?: string
          storage_path?: string | null
          tags?: string[]
          url_origem?: string | null
          workspace_node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_referencias_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_referencias_marca_fk"
            columns: ["marca_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "cliente_referencias_workspace_node_id_fkey"
            columns: ["workspace_node_id"]
            isOneToOne: false
            referencedRelation: "workspace_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_rostos: {
        Row: {
          ativa: boolean
          autorizacao_registrada_em: string
          autorizado_por: string
          client_id: string
          criado_em: string
          id: string
          pessoa: string
          storage_path: string
        }
        Insert: {
          ativa?: boolean
          autorizacao_registrada_em: string
          autorizado_por: string
          client_id: string
          criado_em?: string
          id?: string
          pessoa: string
          storage_path: string
        }
        Update: {
          ativa?: boolean
          autorizacao_registrada_em?: string
          autorizado_por?: string
          client_id?: string
          criado_em?: string
          id?: string
          pessoa?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_rostos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_templates_design: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          client_id: string | null
          criado_em: string
          criado_por: string | null
          escopo: string
          fontes: Json
          formato: string
          gostos: Json
          id: string
          marca_id: string | null
          nome: string
          origem: string
          status: string
          testes: Json
          tipo: string
          versao_atual: number
          versoes: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          escopo?: string
          fontes?: Json
          formato?: string
          gostos?: Json
          id?: string
          marca_id?: string | null
          nome: string
          origem?: string
          status?: string
          testes?: Json
          tipo?: string
          versao_atual?: number
          versoes?: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          escopo?: string
          fontes?: Json
          formato?: string
          gostos?: Json
          id?: string
          marca_id?: string | null
          nome?: string
          origem?: string
          status?: string
          testes?: Json
          tipo?: string
          versao_atual?: number
          versoes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cliente_templates_design_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_templates_design_marca_fk"
            columns: ["marca_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      cnpj_consultas: {
        Row: {
          cnpj: string
          consultado_em: string
          resposta: Json
          status: number
        }
        Insert: {
          cnpj: string
          consultado_em?: string
          resposta?: Json
          status?: number
        }
        Update: {
          cnpj?: string
          consultado_em?: string
          resposta?: Json
          status?: number
        }
        Relationships: []
      }
      commercial_activities: {
        Row: {
          created_at: string
          created_by: string | null
          done_at: string | null
          due_at: string
          id: string
          kind: string
          lead_id: string
          notes: string | null
          owner_id: string | null
          reminded_on: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_at: string
          id?: string
          kind?: string
          lead_id: string
          notes?: string | null
          owner_id?: string | null
          reminded_on?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_at?: string
          id?: string
          kind?: string
          lead_id?: string
          notes?: string | null
          owner_id?: string | null
          reminded_on?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "commercial_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_campaigns: {
        Row: {
          archived_at: string | null
          budget: number
          channel: string
          created_at: string
          created_by: string | null
          ends_on: string | null
          goal: string | null
          id: string
          name: string
          notes: string | null
          spent: number
          starts_on: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          budget?: number
          channel?: string
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          goal?: string | null
          id?: string
          name: string
          notes?: string | null
          spent?: number
          starts_on?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          budget?: number
          channel?: string
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          goal?: string | null
          id?: string
          name?: string
          notes?: string | null
          spent?: number
          starts_on?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      commercial_contacts: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_primary: boolean
          name: string
          notes: string | null
          organization_id: string | null
          role: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          notes?: string | null
          organization_id?: string | null
          role?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          notes?: string | null
          organization_id?: string | null
          role?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "commercial_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_goals: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metric: string
          notes: string | null
          period: string
          target: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          metric: string
          notes?: string | null
          period: string
          target: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metric?: string
          notes?: string | null
          period?: string
          target?: number
          updated_at?: string
        }
        Relationships: []
      }
      commercial_lead_events: {
        Row: {
          created_at: string
          created_by: string | null
          from_stage: string | null
          id: string
          kind: string
          lead_id: string
          note: string | null
          to_stage: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_stage?: string | null
          id?: string
          kind?: string
          lead_id: string
          note?: string | null
          to_stage?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_stage?: string | null
          id?: string
          kind?: string
          lead_id?: string
          note?: string | null
          to_stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "commercial_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_leads: {
        Row: {
          archived_at: string | null
          campaign_id: string | null
          classe: string | null
          closed_at: string | null
          company: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          expected_close_date: string | null
          id: string
          lost_reason: string | null
          monthly_value: number
          name: string
          next_action: string | null
          next_action_at: string | null
          notes: string | null
          one_off_value: number
          organization_id: string | null
          origin: string
          owner_id: string | null
          qualificacao: Json
          quiz_submission_id: string | null
          stage: string
          updated_at: string
          whatsapp: string | null
          won_client_id: string | null
        }
        Insert: {
          archived_at?: string | null
          campaign_id?: string | null
          classe?: string | null
          closed_at?: string | null
          company?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          expected_close_date?: string | null
          id?: string
          lost_reason?: string | null
          monthly_value?: number
          name: string
          next_action?: string | null
          next_action_at?: string | null
          notes?: string | null
          one_off_value?: number
          organization_id?: string | null
          origin?: string
          owner_id?: string | null
          qualificacao?: Json
          quiz_submission_id?: string | null
          stage?: string
          updated_at?: string
          whatsapp?: string | null
          won_client_id?: string | null
        }
        Update: {
          archived_at?: string | null
          campaign_id?: string | null
          classe?: string | null
          closed_at?: string | null
          company?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          expected_close_date?: string | null
          id?: string
          lost_reason?: string | null
          monthly_value?: number
          name?: string
          next_action?: string | null
          next_action_at?: string | null
          notes?: string | null
          one_off_value?: number
          organization_id?: string | null
          origin?: string
          owner_id?: string | null
          qualificacao?: Json
          quiz_submission_id?: string | null
          stage?: string
          updated_at?: string
          whatsapp?: string | null
          won_client_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "commercial_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "commercial_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "commercial_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_leads_quiz_submission_id_fkey"
            columns: ["quiz_submission_id"]
            isOneToOne: false
            referencedRelation: "quiz_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_leads_won_client_id_fkey"
            columns: ["won_client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_organizations: {
        Row: {
          address: string | null
          archived_at: string | null
          city: string | null
          client_id: string | null
          cnpj: string | null
          created_at: string
          created_by: string | null
          id: string
          instagram: string | null
          name: string
          notes: string | null
          owner_id: string | null
          phone: string | null
          segment: string | null
          site: string | null
          size: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
          client_id?: string | null
          cnpj?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instagram?: string | null
          name: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          segment?: string | null
          site?: string | null
          size?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
          client_id?: string | null
          cnpj?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instagram?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          segment?: string | null
          site?: string | null
          size?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_organizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conselho_elencos: {
        Row: {
          arquivado_em: string | null
          atualizado_em: string
          client_id: string | null
          criado_em: string
          criado_por: string | null
          criterios: Json
          especialistas: Json
          id: string
          modelos: Json
          modo: string
          nome: string
          preset: string | null
          rodadas: number
        }
        Insert: {
          arquivado_em?: string | null
          atualizado_em?: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          criterios?: Json
          especialistas: Json
          id?: string
          modelos?: Json
          modo?: string
          nome: string
          preset?: string | null
          rodadas?: number
        }
        Update: {
          arquivado_em?: string | null
          atualizado_em?: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          criterios?: Json
          especialistas?: Json
          id?: string
          modelos?: Json
          modo?: string
          nome?: string
          preset?: string | null
          rodadas?: number
        }
        Relationships: [
          {
            foreignKeyName: "conselho_elencos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conselho_falas: {
        Row: {
          atualizado_em: string
          client_id: string
          concluido_em: string | null
          conteudo: Json | null
          criado_em: string
          custo_usd: number
          erro_codigo: string | null
          erro_mensagem: string | null
          especialista: string
          etapa: string
          id: string
          iniciado_em: string | null
          modelo_id: string | null
          notas: Json | null
          papel: string
          pedido: string | null
          pedido_por: string | null
          rodada: number
          sessao_id: string
          status: string
          tentativas: number
          texto: string | null
          uso_id: string | null
        }
        Insert: {
          atualizado_em?: string
          client_id: string
          concluido_em?: string | null
          conteudo?: Json | null
          criado_em?: string
          custo_usd?: number
          erro_codigo?: string | null
          erro_mensagem?: string | null
          especialista: string
          etapa: string
          id?: string
          iniciado_em?: string | null
          modelo_id?: string | null
          notas?: Json | null
          papel?: string
          pedido?: string | null
          pedido_por?: string | null
          rodada: number
          sessao_id: string
          status?: string
          tentativas?: number
          texto?: string | null
          uso_id?: string | null
        }
        Update: {
          atualizado_em?: string
          client_id?: string
          concluido_em?: string | null
          conteudo?: Json | null
          criado_em?: string
          custo_usd?: number
          erro_codigo?: string | null
          erro_mensagem?: string | null
          especialista?: string
          etapa?: string
          id?: string
          iniciado_em?: string | null
          modelo_id?: string | null
          notas?: Json | null
          papel?: string
          pedido?: string | null
          pedido_por?: string | null
          rodada?: number
          sessao_id?: string
          status?: string
          tentativas?: number
          texto?: string | null
          uso_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conselho_falas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conselho_falas_sessao_id_fkey"
            columns: ["sessao_id"]
            isOneToOne: false
            referencedRelation: "conselho_sessoes"
            referencedColumns: ["id"]
          },
        ]
      }
      conselho_sessoes: {
        Row: {
          ata: string | null
          ata_file_id: string | null
          atualizado_em: string
          aviso: string | null
          client_id: string
          concluido_em: string | null
          contexto: string | null
          contexto_cliente: string | null
          criado_em: string
          criado_por: string | null
          criterios: Json
          custo_usd: number
          decisao: Json | null
          erro_codigo: string | null
          erro_mensagem: string | null
          especialistas: Json
          estimativa_usd: number
          etapa: string
          id: string
          marca_id: string | null
          memoria_id: string | null
          modo: string
          origem: string
          passos: number
          pauta: Json
          pergunta: string
          referencia: Json
          resultado: Json | null
          rodada_atual: number
          rodadas: number
          rodadas_extras: number
          status: string
          tema: string
          tentativas: number
          teto_usd: number
          trava_ate: string | null
          trava_token: string | null
        }
        Insert: {
          ata?: string | null
          ata_file_id?: string | null
          atualizado_em?: string
          aviso?: string | null
          client_id: string
          concluido_em?: string | null
          contexto?: string | null
          contexto_cliente?: string | null
          criado_em?: string
          criado_por?: string | null
          criterios?: Json
          custo_usd?: number
          decisao?: Json | null
          erro_codigo?: string | null
          erro_mensagem?: string | null
          especialistas?: Json
          estimativa_usd?: number
          etapa?: string
          id?: string
          marca_id?: string | null
          memoria_id?: string | null
          modo?: string
          origem?: string
          passos?: number
          pauta?: Json
          pergunta: string
          referencia?: Json
          resultado?: Json | null
          rodada_atual?: number
          rodadas?: number
          rodadas_extras?: number
          status?: string
          tema: string
          tentativas?: number
          teto_usd: number
          trava_ate?: string | null
          trava_token?: string | null
        }
        Update: {
          ata?: string | null
          ata_file_id?: string | null
          atualizado_em?: string
          aviso?: string | null
          client_id?: string
          concluido_em?: string | null
          contexto?: string | null
          contexto_cliente?: string | null
          criado_em?: string
          criado_por?: string | null
          criterios?: Json
          custo_usd?: number
          decisao?: Json | null
          erro_codigo?: string | null
          erro_mensagem?: string | null
          especialistas?: Json
          estimativa_usd?: number
          etapa?: string
          id?: string
          marca_id?: string | null
          memoria_id?: string | null
          modo?: string
          origem?: string
          passos?: number
          pauta?: Json
          pergunta?: string
          referencia?: Json
          resultado?: Json | null
          rodada_atual?: number
          rodadas?: number
          rodadas_extras?: number
          status?: string
          tema?: string
          tentativas?: number
          teto_usd?: number
          trava_ate?: string | null
          trava_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conselho_sessoes_ata_file_fk"
            columns: ["ata_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conselho_sessoes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          admin_signature_email: string | null
          admin_signature_ip: string | null
          admin_signature_name: string | null
          admin_signed_at: string | null
          arquivado_em: string | null
          arquivado_por: string | null
          aviso_vencimento_em: string | null
          clausulas_alteradas: Json
          client_id: string
          client_signature_email: string | null
          client_signature_ip: string | null
          client_signature_name: string | null
          client_signature_user_agent: string | null
          client_signed_at: string | null
          congelado_em: string | null
          contrato_mae_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          documento_hash: string | null
          documento_pdf_hash: string | null
          documento_pdf_url: string | null
          documento_texto: string | null
          file_id: string | null
          id: string
          lembrete_em: string | null
          modelo_versoes: Json
          motivo_arquivo: string | null
          numero: string | null
          origem: string
          original_file_name: string
          original_file_url: string
          pdf_final_hash: string | null
          project_id: string | null
          proposta_id: string | null
          renovacao_de: string | null
          sent_at: string | null
          servicos: string[]
          sign_token: string
          status: string
          substituido_em: string | null
          substituido_por: string | null
          tipo_documento: string
          title: string
          updated_at: string
          variaveis: Json
          versao: number
          versao_de: string | null
          vigencia_fim: string | null
          vigencia_inicio: string | null
        }
        Insert: {
          admin_signature_email?: string | null
          admin_signature_ip?: string | null
          admin_signature_name?: string | null
          admin_signed_at?: string | null
          arquivado_em?: string | null
          arquivado_por?: string | null
          aviso_vencimento_em?: string | null
          clausulas_alteradas?: Json
          client_id: string
          client_signature_email?: string | null
          client_signature_ip?: string | null
          client_signature_name?: string | null
          client_signature_user_agent?: string | null
          client_signed_at?: string | null
          congelado_em?: string | null
          contrato_mae_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          documento_hash?: string | null
          documento_pdf_hash?: string | null
          documento_pdf_url?: string | null
          documento_texto?: string | null
          file_id?: string | null
          id?: string
          lembrete_em?: string | null
          modelo_versoes?: Json
          motivo_arquivo?: string | null
          numero?: string | null
          origem?: string
          original_file_name: string
          original_file_url: string
          pdf_final_hash?: string | null
          project_id?: string | null
          proposta_id?: string | null
          renovacao_de?: string | null
          sent_at?: string | null
          servicos?: string[]
          sign_token?: string
          status?: string
          substituido_em?: string | null
          substituido_por?: string | null
          tipo_documento?: string
          title: string
          updated_at?: string
          variaveis?: Json
          versao?: number
          versao_de?: string | null
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Update: {
          admin_signature_email?: string | null
          admin_signature_ip?: string | null
          admin_signature_name?: string | null
          admin_signed_at?: string | null
          arquivado_em?: string | null
          arquivado_por?: string | null
          aviso_vencimento_em?: string | null
          clausulas_alteradas?: Json
          client_id?: string
          client_signature_email?: string | null
          client_signature_ip?: string | null
          client_signature_name?: string | null
          client_signature_user_agent?: string | null
          client_signed_at?: string | null
          congelado_em?: string | null
          contrato_mae_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          documento_hash?: string | null
          documento_pdf_hash?: string | null
          documento_pdf_url?: string | null
          documento_texto?: string | null
          file_id?: string | null
          id?: string
          lembrete_em?: string | null
          modelo_versoes?: Json
          motivo_arquivo?: string | null
          numero?: string | null
          origem?: string
          original_file_name?: string
          original_file_url?: string
          pdf_final_hash?: string | null
          project_id?: string | null
          proposta_id?: string | null
          renovacao_de?: string | null
          sent_at?: string | null
          servicos?: string[]
          sign_token?: string
          status?: string
          substituido_em?: string | null
          substituido_por?: string | null
          tipo_documento?: string
          title?: string
          updated_at?: string
          variaveis?: Json
          versao?: number
          versao_de?: string | null
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_contrato_mae_fkey"
            columns: ["contrato_mae_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_renovacao_de_fkey"
            columns: ["renovacao_de"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_substituido_por_fkey"
            columns: ["substituido_por"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_versao_de_fkey"
            columns: ["versao_de"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contrato_clausulas: {
        Row: {
          chave: string
          criado_em: string
          id: string
          modelo_id: string
          ordem: number
          quando: Json | null
          texto: string
          titulo: string
        }
        Insert: {
          chave: string
          criado_em?: string
          id?: string
          modelo_id: string
          ordem: number
          quando?: Json | null
          texto: string
          titulo: string
        }
        Update: {
          chave?: string
          criado_em?: string
          id?: string
          modelo_id?: string
          ordem?: number
          quando?: Json | null
          texto?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "contrato_clausulas_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "contrato_modelos"
            referencedColumns: ["id"]
          },
        ]
      }
      contrato_eventos: {
        Row: {
          client_id: string
          contract_id: string
          criado_em: string
          criado_por: string | null
          detalhe: Json
          id: string
          ip: string | null
          resumo: string
          tipo: string
          user_agent: string | null
        }
        Insert: {
          client_id: string
          contract_id: string
          criado_em?: string
          criado_por?: string | null
          detalhe?: Json
          id?: string
          ip?: string | null
          resumo?: string
          tipo: string
          user_agent?: string | null
        }
        Update: {
          client_id?: string
          contract_id?: string
          criado_em?: string
          criado_por?: string | null
          detalhe?: Json
          id?: string
          ip?: string | null
          resumo?: string
          tipo?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contrato_eventos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_eventos_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contrato_modelos: {
        Row: {
          ativo: boolean
          chave: string
          criado_em: string
          criado_por: string | null
          id: string
          nome: string
          revisao_juridica: string
          revogado_em: string | null
          servico: string | null
          tipo: string
          variaveis: Json
          versao: number
        }
        Insert: {
          ativo?: boolean
          chave: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome: string
          revisao_juridica?: string
          revogado_em?: string | null
          servico?: string | null
          tipo: string
          variaveis?: Json
          versao: number
        }
        Update: {
          ativo?: boolean
          chave?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome?: string
          revisao_juridica?: string
          revogado_em?: string | null
          servico?: string | null
          tipo?: string
          variaveis?: Json
          versao?: number
        }
        Relationships: []
      }
      contrato_preferencias: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor?: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: []
      }
      contrato_signatarios: {
        Row: {
          assinado_em: string | null
          assinatura_email: string | null
          assinatura_ip: string | null
          assinatura_nome: string | null
          assinatura_user_agent: string | null
          client_id: string
          contract_id: string
          criado_em: string
          criado_por: string | null
          documento: string | null
          email: string
          hash_visto: string | null
          id: string
          nome: string
          obrigatorio: boolean
          ordem: number
          papel: string
          principal: boolean
          removido_em: string | null
          token: string
        }
        Insert: {
          assinado_em?: string | null
          assinatura_email?: string | null
          assinatura_ip?: string | null
          assinatura_nome?: string | null
          assinatura_user_agent?: string | null
          client_id: string
          contract_id: string
          criado_em?: string
          criado_por?: string | null
          documento?: string | null
          email: string
          hash_visto?: string | null
          id?: string
          nome: string
          obrigatorio?: boolean
          ordem?: number
          papel: string
          principal?: boolean
          removido_em?: string | null
          token?: string
        }
        Update: {
          assinado_em?: string | null
          assinatura_email?: string | null
          assinatura_ip?: string | null
          assinatura_nome?: string | null
          assinatura_user_agent?: string | null
          client_id?: string
          contract_id?: string
          criado_em?: string
          criado_por?: string | null
          documento?: string | null
          email?: string
          hash_visto?: string | null
          id?: string
          nome?: string
          obrigatorio?: boolean
          ordem?: number
          papel?: string
          principal?: boolean
          removido_em?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "contrato_signatarios_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_signatarios_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_client_prefs: {
        Row: {
          client_id: string
          hidden_areas: Json
          hidden_until: string | null
          onboarding_has: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          hidden_areas?: Json
          hidden_until?: string | null
          onboarding_has?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          hidden_areas?: Json
          hidden_until?: string | null
          onboarding_has?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      cycle_item_state: {
        Row: {
          client_id: string
          done_at: string
          done_by: string | null
          id: string
          item_key: string
          note: string | null
          status: string
          week_start: string
        }
        Insert: {
          client_id: string
          done_at?: string
          done_by?: string | null
          id?: string
          item_key: string
          note?: string | null
          status: string
          week_start: string
        }
        Update: {
          client_id?: string
          done_at?: string
          done_by?: string | null
          id?: string
          item_key?: string
          note?: string | null
          status?: string
          week_start?: string
        }
        Relationships: []
      }
      cycle_rituals: {
        Row: {
          client_id: string
          done_at: string
          done_by: string | null
          id: string
          ritual_key: string
          source: string
          week_start: string
        }
        Insert: {
          client_id: string
          done_at?: string
          done_by?: string | null
          id?: string
          ritual_key: string
          source?: string
          week_start: string
        }
        Update: {
          client_id?: string
          done_at?: string
          done_by?: string | null
          id?: string
          ritual_key?: string
          source?: string
          week_start?: string
        }
        Relationships: []
      }
      documentos_agenda: {
        Row: {
          atualizado_em: string
          client_id: string
          criado_em: string
          dia: number
          id: string
          ligada: boolean
          ligada_em: string | null
          ligada_por: string | null
          marca_id: string | null
          modelo: string
          ultima_execucao_em: string | null
          ultimo_erro: string | null
          ultimo_mes: string | null
        }
        Insert: {
          atualizado_em?: string
          client_id: string
          criado_em?: string
          dia?: number
          id?: string
          ligada?: boolean
          ligada_em?: string | null
          ligada_por?: string | null
          marca_id?: string | null
          modelo?: string
          ultima_execucao_em?: string | null
          ultimo_erro?: string | null
          ultimo_mes?: string | null
        }
        Update: {
          atualizado_em?: string
          client_id?: string
          criado_em?: string
          dia?: number
          id?: string
          ligada?: boolean
          ligada_em?: string | null
          ligada_por?: string | null
          marca_id?: string | null
          modelo?: string
          ultima_execucao_em?: string | null
          ultimo_erro?: string | null
          ultimo_mes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_agenda_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_entrega: {
        Row: {
          arquivado_em: string | null
          arquivado_por: string | null
          atualizado_em: string
          avisos: string[]
          client_id: string
          conteudo: Json
          criado_em: string
          custo_usd: number
          file_id: string | null
          gancho: Json
          gerado_em: string | null
          gerado_por: string | null
          id: string
          liberado_em: string | null
          liberado_por: string | null
          marca_id: string | null
          mensagem_envio: string | null
          modelo: string | null
          numero: number | null
          origem_rascunho: string | null
          pedido_por: string | null
          rascunho: Json | null
          rascunho_em: string | null
          rascunho_por: string | null
          referencia: string
          status: string
          tipo: string
          titulo: string | null
          versao: number
        }
        Insert: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          avisos?: string[]
          client_id: string
          conteudo?: Json
          criado_em?: string
          custo_usd?: number
          file_id?: string | null
          gancho?: Json
          gerado_em?: string | null
          gerado_por?: string | null
          id?: string
          liberado_em?: string | null
          liberado_por?: string | null
          marca_id?: string | null
          mensagem_envio?: string | null
          modelo?: string | null
          numero?: number | null
          origem_rascunho?: string | null
          pedido_por?: string | null
          rascunho?: Json | null
          rascunho_em?: string | null
          rascunho_por?: string | null
          referencia: string
          status?: string
          tipo: string
          titulo?: string | null
          versao?: number
        }
        Update: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          avisos?: string[]
          client_id?: string
          conteudo?: Json
          criado_em?: string
          custo_usd?: number
          file_id?: string | null
          gancho?: Json
          gerado_em?: string | null
          gerado_por?: string | null
          id?: string
          liberado_em?: string | null
          liberado_por?: string | null
          marca_id?: string | null
          mensagem_envio?: string | null
          modelo?: string | null
          numero?: number | null
          origem_rascunho?: string | null
          pedido_por?: string | null
          rascunho?: Json | null
          rascunho_em?: string | null
          rascunho_por?: string | null
          referencia?: string
          status?: string
          tipo?: string
          titulo?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "documentos_entrega_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_entrega_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_events: {
        Row: {
          actor_id: string | null
          client_id: string
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json
          post_id: string
          publication_id: string | null
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          client_id: string
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json
          post_id: string
          publication_id?: string | null
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          client_id?: string
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          post_id?: string
          publication_id?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "editorial_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_events_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_events_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "editorial_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_post_internal: {
        Row: {
          approval_fingerprint: string | null
          client_id: string
          created_at: string
          created_by: string
          idempotency_key: string
          internal_notes: string | null
          last_mutation_fingerprint: string | null
          last_mutation_id: string | null
          post_id: string
          request_fingerprint: string
          responsible_id: string | null
          revision_of_post_id: string | null
          task_id: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          approval_fingerprint?: string | null
          client_id: string
          created_at?: string
          created_by: string
          idempotency_key: string
          internal_notes?: string | null
          last_mutation_fingerprint?: string | null
          last_mutation_id?: string | null
          post_id: string
          request_fingerprint: string
          responsible_id?: string | null
          revision_of_post_id?: string | null
          task_id?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          approval_fingerprint?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          idempotency_key?: string
          internal_notes?: string | null
          last_mutation_fingerprint?: string | null
          last_mutation_id?: string | null
          post_id?: string
          request_fingerprint?: string
          responsible_id?: string | null
          revision_of_post_id?: string | null
          task_id?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_post_internal_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_post_internal_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_post_internal_post_fk"
            columns: ["post_id", "client_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "editorial_post_internal_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_post_internal_revision_of_post_id_fkey"
            columns: ["revision_of_post_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_post_internal_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_post_internal_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_posts: {
        Row: {
          archived_at: string | null
          client_id: string
          content_type: string
          created_at: string
          default_caption: string | null
          id: string
          objective: string | null
          primary_file_id: string | null
          production_status: string
          project_id: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          client_id: string
          content_type: string
          created_at?: string
          default_caption?: string | null
          id?: string
          objective?: string | null
          primary_file_id?: string | null
          production_status?: string
          project_id: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          client_id?: string
          content_type?: string
          created_at?: string
          default_caption?: string | null
          id?: string
          objective?: string | null
          primary_file_id?: string | null
          production_status?: string
          project_id?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "editorial_posts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_posts_primary_file_id_fkey"
            columns: ["primary_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_posts_project_fk"
            columns: ["project_id", "client_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      editorial_publication_internal: {
        Row: {
          attempt_count: number
          client_id: string
          created_at: string
          created_by: string
          failure_code: string | null
          failure_reason: string | null
          idempotency_key: string
          included_in_approval_snapshot: boolean
          last_attempt_at: string | null
          publication_id: string
          published_by: string | null
          request_fingerprint: string
          scheduled_by: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          attempt_count?: number
          client_id: string
          created_at?: string
          created_by: string
          failure_code?: string | null
          failure_reason?: string | null
          idempotency_key: string
          included_in_approval_snapshot?: boolean
          last_attempt_at?: string | null
          publication_id: string
          published_by?: string | null
          request_fingerprint: string
          scheduled_by?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          attempt_count?: number
          client_id?: string
          created_at?: string
          created_by?: string
          failure_code?: string | null
          failure_reason?: string | null
          idempotency_key?: string
          included_in_approval_snapshot?: boolean
          last_attempt_at?: string | null
          publication_id?: string
          published_by?: string | null
          request_fingerprint?: string
          scheduled_by?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_publication_internal_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_publication_internal_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_publication_internal_publication_fk"
            columns: ["publication_id", "client_id"]
            isOneToOne: false
            referencedRelation: "editorial_publications"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "editorial_publication_internal_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_publication_internal_scheduled_by_fkey"
            columns: ["scheduled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_publication_internal_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_publications: {
        Row: {
          alt_text: string | null
          caption: string | null
          client_id: string
          created_at: string
          delivery_mode: string
          external_account_id: string
          external_post_id: string | null
          file_id: string | null
          first_comment: string | null
          id: string
          permalink: string | null
          platform: string
          post_id: string
          project_id: string
          published_at: string | null
          scheduled_at: string | null
          scheduled_timezone: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          client_id: string
          created_at?: string
          delivery_mode?: string
          external_account_id: string
          external_post_id?: string | null
          file_id?: string | null
          first_comment?: string | null
          id?: string
          permalink?: string | null
          platform: string
          post_id: string
          project_id: string
          published_at?: string | null
          scheduled_at?: string | null
          scheduled_timezone?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          client_id?: string
          created_at?: string
          delivery_mode?: string
          external_account_id?: string
          external_post_id?: string | null
          file_id?: string | null
          first_comment?: string | null
          id?: string
          permalink?: string | null
          platform?: string
          post_id?: string
          project_id?: string
          published_at?: string | null
          scheduled_at?: string | null
          scheduled_timezone?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "editorial_publications_account_fk"
            columns: ["external_account_id", "client_id"]
            isOneToOne: false
            referencedRelation: "external_accounts"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "editorial_publications_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_publications_post_fk"
            columns: ["post_id", "client_id", "project_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id", "client_id", "project_id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      estudio_fila: {
        Row: {
          atualizado_em: string
          aviso: string | null
          client_id: string
          concluido_em: string | null
          corrigir_sozinho: boolean
          criado_em: string
          custo_usd: number
          erro_codigo: string | null
          erro_mensagem: string | null
          etapa: string
          id: string
          iniciado_em: string | null
          lote_id: string
          marca_id: string | null
          max_tentativas: number
          ordem: number
          paralelo: number
          passos: number
          pedido_por: string | null
          proxima_em: string
          rodadas: number
          status: string
          tentativas: number
          trabalho_id: string
          trava_ate: string | null
          trava_token: string | null
          versoes_antes: number | null
        }
        Insert: {
          atualizado_em?: string
          aviso?: string | null
          client_id: string
          concluido_em?: string | null
          corrigir_sozinho?: boolean
          criado_em?: string
          custo_usd?: number
          erro_codigo?: string | null
          erro_mensagem?: string | null
          etapa?: string
          id?: string
          iniciado_em?: string | null
          lote_id: string
          marca_id?: string | null
          max_tentativas?: number
          ordem: number
          paralelo?: number
          passos?: number
          pedido_por?: string | null
          proxima_em?: string
          rodadas?: number
          status?: string
          tentativas?: number
          trabalho_id: string
          trava_ate?: string | null
          trava_token?: string | null
          versoes_antes?: number | null
        }
        Update: {
          atualizado_em?: string
          aviso?: string | null
          client_id?: string
          concluido_em?: string | null
          corrigir_sozinho?: boolean
          criado_em?: string
          custo_usd?: number
          erro_codigo?: string | null
          erro_mensagem?: string | null
          etapa?: string
          id?: string
          iniciado_em?: string | null
          lote_id?: string
          marca_id?: string | null
          max_tentativas?: number
          ordem?: number
          paralelo?: number
          passos?: number
          pedido_por?: string | null
          proxima_em?: string
          rodadas?: number
          status?: string
          tentativas?: number
          trabalho_id?: string
          trava_ate?: string | null
          trava_token?: string | null
          versoes_antes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estudio_fila_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estudio_fila_trabalho_id_fkey"
            columns: ["trabalho_id"]
            isOneToOne: false
            referencedRelation: "estudio_trabalhos"
            referencedColumns: ["id"]
          },
        ]
      }
      estudio_trabalhos: {
        Row: {
          agenda_aviso: string | null
          agenda_historico: Json
          agenda_sincronizada_em: string | null
          agendado_para: string | null
          ajustes_do_cliente: Json
          aprovado_em: string | null
          atualizado_em: string
          cards: Json
          client_id: string
          conversa_id: string | null
          criado_em: string
          criado_por: string | null
          custo_usd: number
          direcao: Json
          entrega_aviso: string | null
          entrega_rodada: number
          entrega_status: string | null
          enviado_em: string | null
          enviado_por: string | null
          file_ids: string[]
          hashtags: string[]
          id: string
          legenda: string | null
          modelo_imagem_id: string | null
          post_id: string | null
          publicacao_dispensada_em: string | null
          publicacao_dispensada_por: string | null
          publicar_ao_aprovar: boolean
          publicar_em: string | null
          publicar_em_confirmado_em: string | null
          publicar_em_confirmado_por: string | null
          publicar_em_desfeito_em: string | null
          qualidade: string | null
          status: string
          task_id: string | null
          tipo: string
        }
        Insert: {
          agenda_aviso?: string | null
          agenda_historico?: Json
          agenda_sincronizada_em?: string | null
          agendado_para?: string | null
          ajustes_do_cliente?: Json
          aprovado_em?: string | null
          atualizado_em?: string
          cards?: Json
          client_id: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          direcao?: Json
          entrega_aviso?: string | null
          entrega_rodada?: number
          entrega_status?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          file_ids?: string[]
          hashtags?: string[]
          id?: string
          legenda?: string | null
          modelo_imagem_id?: string | null
          post_id?: string | null
          publicacao_dispensada_em?: string | null
          publicacao_dispensada_por?: string | null
          publicar_ao_aprovar?: boolean
          publicar_em?: string | null
          publicar_em_confirmado_em?: string | null
          publicar_em_confirmado_por?: string | null
          publicar_em_desfeito_em?: string | null
          qualidade?: string | null
          status?: string
          task_id?: string | null
          tipo?: string
        }
        Update: {
          agenda_aviso?: string | null
          agenda_historico?: Json
          agenda_sincronizada_em?: string | null
          agendado_para?: string | null
          ajustes_do_cliente?: Json
          aprovado_em?: string | null
          atualizado_em?: string
          cards?: Json
          client_id?: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          direcao?: Json
          entrega_aviso?: string | null
          entrega_rodada?: number
          entrega_status?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          file_ids?: string[]
          hashtags?: string[]
          id?: string
          legenda?: string | null
          modelo_imagem_id?: string | null
          post_id?: string | null
          publicacao_dispensada_em?: string | null
          publicacao_dispensada_por?: string | null
          publicar_ao_aprovar?: boolean
          publicar_em?: string | null
          publicar_em_confirmado_em?: string | null
          publicar_em_confirmado_por?: string | null
          publicar_em_desfeito_em?: string | null
          qualidade?: string | null
          status?: string
          task_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "estudio_trabalhos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estudio_trabalhos_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "agente_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estudio_trabalhos_modelo_imagem_id_fkey"
            columns: ["modelo_imagem_id"]
            isOneToOne: false
            referencedRelation: "ia_modelos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estudio_trabalhos_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      evolucao_leituras: {
        Row: {
          client_id: string
          criado_em: string
          criado_por: string | null
          custo_usd: number
          explicacao: Json | null
          id: string
          leitura: Json
          memorias_gravadas: number
          periodo_fim: string
          periodo_inicio: string
        }
        Insert: {
          client_id: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          explicacao?: Json | null
          id?: string
          leitura?: Json
          memorias_gravadas?: number
          periodo_fim: string
          periodo_inicio: string
        }
        Update: {
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          explicacao?: Json | null
          id?: string
          leitura?: Json
          memorias_gravadas?: number
          periodo_fim?: string
          periodo_inicio?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolucao_leituras_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolucao_leituras_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          attachment_url: string | null
          brand: string | null
          category: string
          created_at: string
          created_by: string | null
          description: string
          due_date: string
          id: string
          notes: string | null
          paid_date: string | null
          parent_expense_id: string | null
          payment_method: string | null
          recurrence: string
          status: string
          supplier: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          attachment_url?: string | null
          brand?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description: string
          due_date: string
          id?: string
          notes?: string | null
          paid_date?: string | null
          parent_expense_id?: string | null
          payment_method?: string | null
          recurrence?: string
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          brand?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string
          id?: string
          notes?: string | null
          paid_date?: string | null
          parent_expense_id?: string | null
          payment_method?: string | null
          recurrence?: string
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_parent_expense_id_fkey"
            columns: ["parent_expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      external_account_connections: {
        Row: {
          automation_enabled: boolean
          client_id: string
          connected_at: string | null
          connected_by: string | null
          connection_status: string
          created_at: string
          data_access_expires_at: string | null
          disconnected_at: string | null
          disconnected_by: string | null
          expires_at: string | null
          external_account_id: string
          last_error_code: string | null
          last_verified_at: string | null
          provider: string
          scopes: string[]
          updated_at: string
        }
        Insert: {
          automation_enabled?: boolean
          client_id: string
          connected_at?: string | null
          connected_by?: string | null
          connection_status?: string
          created_at?: string
          data_access_expires_at?: string | null
          disconnected_at?: string | null
          disconnected_by?: string | null
          expires_at?: string | null
          external_account_id: string
          last_error_code?: string | null
          last_verified_at?: string | null
          provider?: string
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          automation_enabled?: boolean
          client_id?: string
          connected_at?: string | null
          connected_by?: string | null
          connection_status?: string
          created_at?: string
          data_access_expires_at?: string | null
          disconnected_at?: string | null
          disconnected_by?: string | null
          expires_at?: string | null
          external_account_id?: string
          last_error_code?: string | null
          last_verified_at?: string | null
          provider?: string
          scopes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_account_connections_account_fk"
            columns: ["external_account_id", "client_id"]
            isOneToOne: false
            referencedRelation: "external_accounts"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "external_account_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_account_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_account_connections_disconnected_by_fkey"
            columns: ["disconnected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      external_accounts: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          display_name: string
          external_id: string | null
          handle: string | null
          id: string
          platform: string
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          display_name: string
          external_id?: string | null
          handle?: string | null
          id?: string
          platform: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          external_id?: string | null
          handle?: string | null
          id?: string
          platform?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string | null
          enabled: boolean
          flag_key: string
          updated_at: string
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          flag_key: string
          updated_at?: string
        }
        Update: {
          description?: string | null
          enabled?: boolean
          flag_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      file_approval_events: {
        Row: {
          actor_id: string | null
          client_id: string
          created_at: string
          event_type: string
          feedback: string | null
          file_id: string
          from_status: string | null
          id: string
          metadata: Json
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          client_id: string
          created_at?: string
          event_type: string
          feedback?: string | null
          file_id: string
          from_status?: string | null
          id?: string
          metadata?: Json
          to_status: string
        }
        Update: {
          actor_id?: string | null
          client_id?: string
          created_at?: string
          event_type?: string
          feedback?: string | null
          file_id?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_approval_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_approval_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_approval_events_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      file_content_chunks: {
        Row: {
          chunk_index: number
          client_id: string
          content_type: string
          created_at: string
          file_id: string
          id: string
          metadata: Json | null
          page_number: number | null
          project_id: string | null
          search_vector: unknown
          sheet_name: string | null
          slide_number: number | null
          text: string
        }
        Insert: {
          chunk_index: number
          client_id: string
          content_type?: string
          created_at?: string
          file_id: string
          id?: string
          metadata?: Json | null
          page_number?: number | null
          project_id?: string | null
          search_vector?: unknown
          sheet_name?: string | null
          slide_number?: number | null
          text: string
        }
        Update: {
          chunk_index?: number
          client_id?: string
          content_type?: string
          created_at?: string
          file_id?: string
          id?: string
          metadata?: Json | null
          page_number?: number | null
          project_id?: string | null
          search_vector?: unknown
          sheet_name?: string | null
          slide_number?: number | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_content_chunks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      file_processing_jobs: {
        Row: {
          attempts: number
          created_at: string
          file_id: string
          finished_at: string | null
          id: string
          job_type: string
          last_error: string | null
          payload: Json | null
          progress: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          file_id: string
          finished_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          payload?: Json | null
          progress?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          file_id?: string
          finished_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          payload?: Json | null
          progress?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_processing_jobs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          agency_approval_status: string
          agency_feedback: string | null
          agency_reviewed_at: string | null
          agency_reviewed_by: string | null
          approval_requested_at: string | null
          approval_status: string
          archived_at: string | null
          caption: string | null
          carousel_text: string | null
          client_decided_at: string | null
          client_decided_by: string | null
          client_id: string
          created_at: string
          description: string | null
          extension: string | null
          extracted_metadata: Json | null
          extraction_error: string | null
          extraction_status: string | null
          feedback: string | null
          file_name: string
          file_type: string | null
          file_url: string
          folder: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          mime_type: string | null
          page_count: number | null
          parent_file_id: string | null
          project_id: string | null
          requires_approval: boolean | null
          revision_of_file_id: string | null
          sensitivity: string | null
          sha256: string | null
          sheet_count: number | null
          size_bytes: number | null
          slide_count: number | null
          source: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string
          version: number | null
          visibility: string | null
        }
        Insert: {
          agency_approval_status?: string
          agency_feedback?: string | null
          agency_reviewed_at?: string | null
          agency_reviewed_by?: string | null
          approval_requested_at?: string | null
          approval_status?: string
          archived_at?: string | null
          caption?: string | null
          carousel_text?: string | null
          client_decided_at?: string | null
          client_decided_by?: string | null
          client_id: string
          created_at?: string
          description?: string | null
          extension?: string | null
          extracted_metadata?: Json | null
          extraction_error?: string | null
          extraction_status?: string | null
          feedback?: string | null
          file_name: string
          file_type?: string | null
          file_url: string
          folder?: string | null
          id?: string
          idempotency_key?: string | null
          locked_at?: string | null
          mime_type?: string | null
          page_count?: number | null
          parent_file_id?: string | null
          project_id?: string | null
          requires_approval?: boolean | null
          revision_of_file_id?: string | null
          sensitivity?: string | null
          sha256?: string | null
          sheet_count?: number | null
          size_bytes?: number | null
          slide_count?: number | null
          source?: string | null
          status?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          tags?: string[] | null
          updated_at?: string | null
          uploaded_by: string
          version?: number | null
          visibility?: string | null
        }
        Update: {
          agency_approval_status?: string
          agency_feedback?: string | null
          agency_reviewed_at?: string | null
          agency_reviewed_by?: string | null
          approval_requested_at?: string | null
          approval_status?: string
          archived_at?: string | null
          caption?: string | null
          carousel_text?: string | null
          client_decided_at?: string | null
          client_decided_by?: string | null
          client_id?: string
          created_at?: string
          description?: string | null
          extension?: string | null
          extracted_metadata?: Json | null
          extraction_error?: string | null
          extraction_status?: string | null
          feedback?: string | null
          file_name?: string
          file_type?: string | null
          file_url?: string
          folder?: string | null
          id?: string
          idempotency_key?: string | null
          locked_at?: string | null
          mime_type?: string | null
          page_count?: number | null
          parent_file_id?: string | null
          project_id?: string | null
          requires_approval?: boolean | null
          revision_of_file_id?: string | null
          sensitivity?: string | null
          sha256?: string | null
          sheet_count?: number | null
          size_bytes?: number | null
          slide_count?: number | null
          source?: string | null
          status?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          tags?: string[] | null
          updated_at?: string | null
          uploaded_by?: string
          version?: number | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_agency_reviewed_by_fkey"
            columns: ["agency_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_client_decided_by_fkey"
            columns: ["client_decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_parent_file_id_fkey"
            columns: ["parent_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_revision_of_file_id_fkey"
            columns: ["revision_of_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_client_terms: {
        Row: {
          amount_kind: string
          billing_period: string
          client_id: string | null
          contract_started_on: string | null
          created_at: string
          created_by: string | null
          custom_justification: string | null
          direct_cost_amount: number
          direct_cost_estimated: boolean
          due_day: number
          ends_on: string | null
          final_amount: number
          id: string
          legacy_source_id: string | null
          next_adjustment_on: string | null
          notes: string | null
          operational_amount: number
          payment_method: string | null
          plan_version_id: string | null
          pricing_mode: string
          project_id: string | null
          review_required: boolean
          source_system: string
          starts_on: string
          status: string
          tax_rate: number | null
          updated_at: string
        }
        Insert: {
          amount_kind?: string
          billing_period?: string
          client_id?: string | null
          contract_started_on?: string | null
          created_at?: string
          created_by?: string | null
          custom_justification?: string | null
          direct_cost_amount?: number
          direct_cost_estimated?: boolean
          due_day?: number
          ends_on?: string | null
          final_amount: number
          id?: string
          legacy_source_id?: string | null
          next_adjustment_on?: string | null
          notes?: string | null
          operational_amount: number
          payment_method?: string | null
          plan_version_id?: string | null
          pricing_mode?: string
          project_id?: string | null
          review_required?: boolean
          source_system?: string
          starts_on: string
          status?: string
          tax_rate?: number | null
          updated_at?: string
        }
        Update: {
          amount_kind?: string
          billing_period?: string
          client_id?: string | null
          contract_started_on?: string | null
          created_at?: string
          created_by?: string | null
          custom_justification?: string | null
          direct_cost_amount?: number
          direct_cost_estimated?: boolean
          due_day?: number
          ends_on?: string | null
          final_amount?: number
          id?: string
          legacy_source_id?: string | null
          next_adjustment_on?: string | null
          notes?: string | null
          operational_amount?: number
          payment_method?: string | null
          plan_version_id?: string | null
          pricing_mode?: string
          project_id?: string | null
          review_required?: boolean
          source_system?: string
          starts_on?: string
          status?: string
          tax_rate?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_client_terms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_client_terms_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "financial_plan_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_client_terms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_entries: {
        Row: {
          amount: number
          brand: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: string | null
          client_id: string | null
          competence: string
          competence_source: string
          created_at: string
          created_by: string | null
          description: string
          direct_cost_amount: number
          direct_cost_estimated: boolean
          direction: string
          due_date: string
          id: string
          idempotency_key: string
          kind: string
          legacy_source_id: string | null
          legacy_source_table: string | null
          operational_amount: number
          plan_version_id: string | null
          project_id: string | null
          recurring_rule_id: string | null
          source_system: string
          status: string
          tax_rate: number | null
          tax_reserve: number
          term_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          brand?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          client_id?: string | null
          competence: string
          competence_source?: string
          created_at?: string
          created_by?: string | null
          description: string
          direct_cost_amount?: number
          direct_cost_estimated?: boolean
          direction: string
          due_date: string
          id?: string
          idempotency_key: string
          kind: string
          legacy_source_id?: string | null
          legacy_source_table?: string | null
          operational_amount?: number
          plan_version_id?: string | null
          project_id?: string | null
          recurring_rule_id?: string | null
          source_system?: string
          status?: string
          tax_rate?: number | null
          tax_reserve?: number
          term_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          brand?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          client_id?: string | null
          competence?: string
          competence_source?: string
          created_at?: string
          created_by?: string | null
          description?: string
          direct_cost_amount?: number
          direct_cost_estimated?: boolean
          direction?: string
          due_date?: string
          id?: string
          idempotency_key?: string
          kind?: string
          legacy_source_id?: string | null
          legacy_source_table?: string | null
          operational_amount?: number
          plan_version_id?: string | null
          project_id?: string | null
          recurring_rule_id?: string | null
          source_system?: string
          status?: string
          tax_rate?: number | null
          tax_reserve?: number
          term_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "financial_plan_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_recurring_rule_id_fkey"
            columns: ["recurring_rule_id"]
            isOneToOne: false
            referencedRelation: "financial_recurring_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "financial_client_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_period_closures: {
        Row: {
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          competence: string
          period_status: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          updated_at: string
        }
        Insert: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          competence: string
          period_status?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          updated_at?: string
        }
        Update: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          competence?: string
          period_status?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      financial_plan_versions: {
        Row: {
          amount_kind: string
          billing_period: string
          created_at: string
          created_by: string | null
          description: string | null
          direct_cost_amount: number
          direct_cost_estimated: boolean
          final_amount: number
          id: string
          is_active: boolean
          operational_amount: number
          plan_id: string
          setup_fee: number
          tax_rate: number | null
          updated_at: string
          valid_from: string
          valid_to: string | null
          version: number
        }
        Insert: {
          amount_kind?: string
          billing_period?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          direct_cost_amount?: number
          direct_cost_estimated?: boolean
          final_amount: number
          id?: string
          is_active?: boolean
          operational_amount: number
          plan_id: string
          setup_fee?: number
          tax_rate?: number | null
          updated_at?: string
          valid_from: string
          valid_to?: string | null
          version: number
        }
        Update: {
          amount_kind?: string
          billing_period?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          direct_cost_amount?: number
          direct_cost_estimated?: boolean
          final_amount?: number
          id?: string
          is_active?: boolean
          operational_amount?: number
          plan_id?: string
          setup_fee?: number
          tax_rate?: number | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_plan_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "financial_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_plans: {
        Row: {
          archived_at: string | null
          code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          operational_scope: Json
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          operational_scope?: Json
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          operational_scope?: Json
          updated_at?: string
        }
        Relationships: []
      }
      financial_recurring_rules: {
        Row: {
          amount: number
          brand: string | null
          category: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          direct_cost_amount: number
          direct_cost_estimated: boolean
          direction: string
          due_day: number
          ends_on: string | null
          frequency: string
          id: string
          is_active: boolean
          kind: string
          name: string
          operational_amount: number
          stable_code: string | null
          starts_on: string
          tax_rate: number | null
          term_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          brand?: string | null
          category?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          direct_cost_amount?: number
          direct_cost_estimated?: boolean
          direction: string
          due_day?: number
          ends_on?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          operational_amount?: number
          stable_code?: string | null
          starts_on: string
          tax_rate?: number | null
          term_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          brand?: string | null
          category?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          direct_cost_amount?: number
          direct_cost_estimated?: boolean
          direction?: string
          due_day?: number
          ends_on?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          operational_amount?: number
          stable_code?: string | null
          starts_on?: string
          tax_rate?: number | null
          term_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_recurring_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_recurring_rules_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "financial_client_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_settings: {
        Row: {
          allocation_method: string
          created_at: string
          currency: string
          current_pro_labore: number
          default_direct_cost: number
          default_direct_cost_estimated: boolean
          default_due_day: number
          desired_minimum_margin: number | null
          forecast_months: number
          growth_retention_rate: number | null
          id: string
          include_pro_labore_in_allocation: boolean
          minimum_reserve_months: number | null
          monthly_goal: number | null
          opening_balance: number | null
          owner_name: string
          owner_profit_share: number
          reserve_target: number | null
          settings_key: string
          target_pro_labore: number
          timezone: string
          tools_systems_cost: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allocation_method?: string
          created_at?: string
          currency?: string
          current_pro_labore?: number
          default_direct_cost?: number
          default_direct_cost_estimated?: boolean
          default_due_day?: number
          desired_minimum_margin?: number | null
          forecast_months?: number
          growth_retention_rate?: number | null
          id?: string
          include_pro_labore_in_allocation?: boolean
          minimum_reserve_months?: number | null
          monthly_goal?: number | null
          opening_balance?: number | null
          owner_name?: string
          owner_profit_share?: number
          reserve_target?: number | null
          settings_key?: string
          target_pro_labore?: number
          timezone?: string
          tools_systems_cost?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allocation_method?: string
          created_at?: string
          currency?: string
          current_pro_labore?: number
          default_direct_cost?: number
          default_direct_cost_estimated?: boolean
          default_due_day?: number
          desired_minimum_margin?: number | null
          forecast_months?: number
          growth_retention_rate?: number | null
          id?: string
          include_pro_labore_in_allocation?: boolean
          minimum_reserve_months?: number | null
          monthly_goal?: number | null
          opening_balance?: number | null
          owner_name?: string
          owner_profit_share?: number
          reserve_target?: number | null
          settings_key?: string
          target_pro_labore?: number
          timezone?: string
          tools_systems_cost?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      financial_settlements: {
        Row: {
          account_name: string | null
          amount: number
          created_at: string
          created_by: string | null
          entry_id: string
          id: string
          idempotency_key: string
          kind: string
          method: string | null
          notes: string | null
          reversal_of_id: string | null
          settled_on: string
          tax_reserve_amount: number
        }
        Insert: {
          account_name?: string | null
          amount: number
          created_at?: string
          created_by?: string | null
          entry_id: string
          id?: string
          idempotency_key: string
          kind?: string
          method?: string | null
          notes?: string | null
          reversal_of_id?: string | null
          settled_on: string
          tax_reserve_amount?: number
        }
        Update: {
          account_name?: string | null
          amount?: number
          created_at?: string
          created_by?: string | null
          entry_id?: string
          id?: string
          idempotency_key?: string
          kind?: string
          method?: string | null
          notes?: string | null
          reversal_of_id?: string | null
          settled_on?: string
          tax_reserve_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_settlements_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_settlements_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries_enriched"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_settlements_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: true
            referencedRelation: "financial_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_tax_rates: {
        Row: {
          competence: string
          created_at: string
          note: string | null
          rate: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          competence: string
          created_at?: string
          note?: string | null
          rate: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          competence?: string
          created_at?: string
          note?: string | null
          rate?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_tax_rates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fontes_biblioteca: {
        Row: {
          amostra_path: string | null
          arquivos: Json
          ativa: boolean
          categoria: string | null
          criado_em: string
          familia: string
          id: string
          licenca: string | null
          nichos: string[]
          pareamentos: Json
          personalidade: string[]
          slug: string
          suporta_portugues: boolean
          usos: string[]
        }
        Insert: {
          amostra_path?: string | null
          arquivos?: Json
          ativa?: boolean
          categoria?: string | null
          criado_em?: string
          familia: string
          id?: string
          licenca?: string | null
          nichos?: string[]
          pareamentos?: Json
          personalidade?: string[]
          slug: string
          suporta_portugues?: boolean
          usos?: string[]
        }
        Update: {
          amostra_path?: string | null
          arquivos?: Json
          ativa?: boolean
          categoria?: string | null
          criado_em?: string
          familia?: string
          id?: string
          licenca?: string | null
          nichos?: string[]
          pareamentos?: Json
          personalidade?: string[]
          slug?: string
          suporta_portugues?: boolean
          usos?: string[]
        }
        Relationships: []
      }
      foto_biblioteca: {
        Row: {
          atualizado_em: string
          autor: string | null
          autor_url: string | null
          categoria: string
          client_id: string | null
          criado_em: string
          criado_por: string | null
          destaque: boolean
          exemplo: Json | null
          fonte_nome: string | null
          fonte_url: string | null
          id: string
          imagem_url: string | null
          licenca: string | null
          miniatura_url: string | null
          negativo: string | null
          prompt_en: string | null
          prompt_pt: string | null
          storage_path: string | null
          tags: string[]
          tipo: string
          titulo: string
          uso: string | null
        }
        Insert: {
          atualizado_em?: string
          autor?: string | null
          autor_url?: string | null
          categoria: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          destaque?: boolean
          exemplo?: Json | null
          fonte_nome?: string | null
          fonte_url?: string | null
          id?: string
          imagem_url?: string | null
          licenca?: string | null
          miniatura_url?: string | null
          negativo?: string | null
          prompt_en?: string | null
          prompt_pt?: string | null
          storage_path?: string | null
          tags?: string[]
          tipo: string
          titulo: string
          uso?: string | null
        }
        Update: {
          atualizado_em?: string
          autor?: string | null
          autor_url?: string | null
          categoria?: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          destaque?: boolean
          exemplo?: Json | null
          fonte_nome?: string | null
          fonte_url?: string | null
          id?: string
          imagem_url?: string | null
          licenca?: string | null
          miniatura_url?: string | null
          negativo?: string | null
          prompt_en?: string | null
          prompt_pt?: string | null
          storage_path?: string | null
          tags?: string[]
          tipo?: string
          titulo?: string
          uso?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "foto_biblioteca_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      foto_books: {
        Row: {
          assunto: Json
          atualizado_em: string
          client_id: string
          conversa: Json
          criado_em: string
          criado_por: string | null
          custo_usd: number
          id: string
          nome: string
          pedidos: Json
          referencias: Json
          selecao: Json
          status: string
        }
        Insert: {
          assunto: Json
          atualizado_em?: string
          client_id: string
          conversa?: Json
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          id?: string
          nome: string
          pedidos?: Json
          referencias?: Json
          selecao?: Json
          status?: string
        }
        Update: {
          assunto?: Json
          atualizado_em?: string
          client_id?: string
          conversa?: Json
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          id?: string
          nome?: string
          pedidos?: Json
          referencias?: Json
          selecao?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "foto_books_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      foto_canvas: {
        Row: {
          atualizado_em: string
          client_id: string
          criado_em: string
          criado_por: string | null
          historia: Json | null
          id: string
          ligacoes: Json
          nome: string
          nos: Json
          status: string
          versao: number
          viewport: Json
        }
        Insert: {
          atualizado_em?: string
          client_id: string
          criado_em?: string
          criado_por?: string | null
          historia?: Json | null
          id?: string
          ligacoes?: Json
          nome: string
          nos?: Json
          status?: string
          versao?: number
          viewport?: Json
        }
        Update: {
          atualizado_em?: string
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          historia?: Json | null
          id?: string
          ligacoes?: Json
          nome?: string
          nos?: Json
          status?: string
          versao?: number
          viewport?: Json
        }
        Relationships: [
          {
            foreignKeyName: "foto_canvas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      foto_canvas_geracoes: {
        Row: {
          atualizado_em: string
          canvas_id: string
          client_id: string
          conferencia: Json | null
          criado_em: string
          criado_por: string | null
          custo_usd: number
          formato: string | null
          id: string
          imagem_id: string | null
          montado: Json
          motor_id: string
          no_saida_id: string
          qualidade: string | null
          resolucao: string | null
          status: string
          ultimo_erro: string | null
          uso_id: string | null
        }
        Insert: {
          atualizado_em?: string
          canvas_id: string
          client_id: string
          conferencia?: Json | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          formato?: string | null
          id?: string
          imagem_id?: string | null
          montado?: Json
          motor_id: string
          no_saida_id: string
          qualidade?: string | null
          resolucao?: string | null
          status?: string
          ultimo_erro?: string | null
          uso_id?: string | null
        }
        Update: {
          atualizado_em?: string
          canvas_id?: string
          client_id?: string
          conferencia?: Json | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          formato?: string | null
          id?: string
          imagem_id?: string | null
          montado?: Json
          motor_id?: string
          no_saida_id?: string
          qualidade?: string | null
          resolucao?: string | null
          status?: string
          ultimo_erro?: string | null
          uso_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "foto_canvas_geracoes_canvas_fk"
            columns: ["canvas_id", "client_id"]
            isOneToOne: false
            referencedRelation: "foto_canvas"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "foto_canvas_geracoes_canvas_fk"
            columns: ["canvas_id", "client_id"]
            isOneToOne: false
            referencedRelation: "foto_cenas_da_historia"
            referencedColumns: ["canvas_id", "client_id"]
          },
          {
            foreignKeyName: "foto_canvas_geracoes_imagem_fk"
            columns: ["imagem_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_imagens"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      foto_ensaios: {
        Row: {
          atualizado_em: string
          client_id: string
          criado_em: string
          criado_por: string | null
          custo_usd: number
          direcao: Json
          finalidade: string | null
          formatos: string[]
          id: string
          kit_id: string
          pedido: string | null
          receita_id: string
          receita_versao: string
          status: string
          tomadas: Json
        }
        Insert: {
          atualizado_em?: string
          client_id: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          direcao?: Json
          finalidade?: string | null
          formatos?: string[]
          id?: string
          kit_id: string
          pedido?: string | null
          receita_id: string
          receita_versao: string
          status?: string
          tomadas?: Json
        }
        Update: {
          atualizado_em?: string
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          direcao?: Json
          finalidade?: string | null
          formatos?: string[]
          id?: string
          kit_id?: string
          pedido?: string | null
          receita_id?: string
          receita_versao?: string
          status?: string
          tomadas?: Json
        }
        Relationships: [
          {
            foreignKeyName: "foto_ensaios_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "foto_ensaios_kit_fk"
            columns: ["kit_id", "client_id"]
            isOneToOne: false
            referencedRelation: "foto_kits"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      foto_kit_refs: {
        Row: {
          client_id: string
          criado_em: string
          id: string
          imagem_id: string
          kit_id: string
          papel: string
          prioridade: number
          vista: string | null
        }
        Insert: {
          client_id: string
          criado_em?: string
          id?: string
          imagem_id: string
          kit_id: string
          papel: string
          prioridade?: number
          vista?: string | null
        }
        Update: {
          client_id?: string
          criado_em?: string
          id?: string
          imagem_id?: string
          kit_id?: string
          papel?: string
          prioridade?: number
          vista?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "foto_kit_refs_imagem_fk"
            columns: ["imagem_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_imagens"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "foto_kit_refs_kit_fk"
            columns: ["kit_id", "client_id"]
            isOneToOne: false
            referencedRelation: "foto_kits"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      foto_kits: {
        Row: {
          atributos: Json
          atualizado_em: string
          autorizacao: Json | null
          client_id: string
          criado_em: string
          criado_por: string | null
          frente_imagem_id: string | null
          id: string
          invariantes: string[]
          lacunas: string[]
          nome: string
          status: string
          tipo: string
          variante: string | null
        }
        Insert: {
          atributos?: Json
          atualizado_em?: string
          autorizacao?: Json | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          frente_imagem_id?: string | null
          id?: string
          invariantes?: string[]
          lacunas?: string[]
          nome: string
          status?: string
          tipo: string
          variante?: string | null
        }
        Update: {
          atributos?: Json
          atualizado_em?: string
          autorizacao?: Json | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          frente_imagem_id?: string | null
          id?: string
          invariantes?: string[]
          lacunas?: string[]
          nome?: string
          status?: string
          tipo?: string
          variante?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "foto_kits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "foto_kits_frente_fk"
            columns: ["frente_imagem_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_imagens"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      foto_modelo_imagens: {
        Row: {
          altura: number | null
          alvo: string | null
          aprovada: boolean | null
          arquivada_em: string | null
          avisos: string[]
          conferencia: Json | null
          criado_em: string
          criado_por: string | null
          custo_usd: number
          derivada_de: string | null
          fontes: Json
          gerada: boolean
          id: string
          largura: number | null
          mime: string | null
          modelo_id: string
          motivo: string | null
          motor_id: string | null
          papel: string
          prompt: string | null
          qualidade: string | null
          reserva_usada: string | null
          resolucao: string | null
          rodada_id: string | null
          seed: number | null
          sha256: string | null
          storage_bucket: string
          storage_path: string
          uso_id: string | null
          versao_modelo: number
          vista: string | null
        }
        Insert: {
          altura?: number | null
          alvo?: string | null
          aprovada?: boolean | null
          arquivada_em?: string | null
          avisos?: string[]
          conferencia?: Json | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          derivada_de?: string | null
          fontes?: Json
          gerada?: boolean
          id?: string
          largura?: number | null
          mime?: string | null
          modelo_id: string
          motivo?: string | null
          motor_id?: string | null
          papel: string
          prompt?: string | null
          qualidade?: string | null
          reserva_usada?: string | null
          resolucao?: string | null
          rodada_id?: string | null
          seed?: number | null
          sha256?: string | null
          storage_bucket?: string
          storage_path: string
          uso_id?: string | null
          versao_modelo?: number
          vista?: string | null
        }
        Update: {
          altura?: number | null
          alvo?: string | null
          aprovada?: boolean | null
          arquivada_em?: string | null
          avisos?: string[]
          conferencia?: Json | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          derivada_de?: string | null
          fontes?: Json
          gerada?: boolean
          id?: string
          largura?: number | null
          mime?: string | null
          modelo_id?: string
          motivo?: string | null
          motor_id?: string | null
          papel?: string
          prompt?: string | null
          qualidade?: string | null
          reserva_usada?: string | null
          resolucao?: string | null
          rodada_id?: string | null
          seed?: number | null
          sha256?: string | null
          storage_bucket?: string
          storage_path?: string
          uso_id?: string | null
          versao_modelo?: number
          vista?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "foto_modelo_imagens_derivada_de_fkey"
            columns: ["derivada_de"]
            isOneToOne: false
            referencedRelation: "foto_modelo_imagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "foto_modelo_imagens_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "foto_modelos"
            referencedColumns: ["id"]
          },
        ]
      }
      foto_modelos: {
        Row: {
          ancora_imagem_id: string | null
          arquivado_em: string | null
          arquivado_por: string | null
          atualizado_em: string
          autorizacao: Json | null
          client_id: string | null
          client_origem_id: string | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          etica: Json
          ficha: Json
          id: string
          identidade_real: Json
          invariantes: string[]
          motor_preferido_id: string | null
          nome: string
          origem: string
          referencias: Json
          status: string
          versao: number
        }
        Insert: {
          ancora_imagem_id?: string | null
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          autorizacao?: Json | null
          client_id?: string | null
          client_origem_id?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          etica: Json
          ficha: Json
          id?: string
          identidade_real?: Json
          invariantes?: string[]
          motor_preferido_id?: string | null
          nome: string
          origem?: string
          referencias?: Json
          status?: string
          versao?: number
        }
        Update: {
          ancora_imagem_id?: string | null
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          autorizacao?: Json | null
          client_id?: string | null
          client_origem_id?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          etica?: Json
          ficha?: Json
          id?: string
          identidade_real?: Json
          invariantes?: string[]
          motor_preferido_id?: string | null
          nome?: string
          origem?: string
          referencias?: Json
          status?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "foto_modelos_ancora_fk"
            columns: ["ancora_imagem_id"]
            isOneToOne: false
            referencedRelation: "foto_modelo_imagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "foto_modelos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "foto_modelos_client_origem_id_fkey"
            columns: ["client_origem_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_carteira_movimentos: {
        Row: {
          client_id: string
          criado_em: string
          criado_por: string | null
          id: string
          observacao: string | null
          tipo: string
          uso_id: string | null
          valor_usd: number
        }
        Insert: {
          client_id: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          observacao?: string | null
          tipo: string
          uso_id?: string | null
          valor_usd: number
        }
        Update: {
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          observacao?: string | null
          tipo?: string
          uso_id?: string | null
          valor_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "ia_carteira_movimentos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ia_carteira_movimentos_uso_id_fkey"
            columns: ["uso_id"]
            isOneToOne: false
            referencedRelation: "ia_usos"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_carteiras: {
        Row: {
          atualizado_em: string
          client_id: string
          saldo_usd: number
        }
        Insert: {
          atualizado_em?: string
          client_id: string
          saldo_usd?: number
        }
        Update: {
          atualizado_em?: string
          client_id?: string
          saldo_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "ia_carteiras_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_chaves_cliente: {
        Row: {
          ativa: boolean
          atualizado_em: string
          client_id: string
          cota_mensal_usd: number | null
          criado_em: string
          criado_por: string | null
          final_chave: string
          id: string
          provedor: string
          rotulo: string | null
          vault_secret_id: string
        }
        Insert: {
          ativa?: boolean
          atualizado_em?: string
          client_id: string
          cota_mensal_usd?: number | null
          criado_em?: string
          criado_por?: string | null
          final_chave: string
          id?: string
          provedor: string
          rotulo?: string | null
          vault_secret_id: string
        }
        Update: {
          ativa?: boolean
          atualizado_em?: string
          client_id?: string
          cota_mensal_usd?: number | null
          criado_em?: string
          criado_por?: string | null
          final_chave?: string
          id?: string
          provedor?: string
          rotulo?: string | null
          vault_secret_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_chaves_cliente_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_clientes_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          client_id: string
          observacao: string | null
          usar_chave_agencia: boolean
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id: string
          observacao?: string | null
          usar_chave_agencia?: boolean
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string
          observacao?: string | null
          usar_chave_agencia?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ia_clientes_config_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_modelos: {
        Row: {
          ativo: boolean
          capacidades: Json | null
          conferido_em: string | null
          contexto_tokens: number | null
          criado_em: string
          disponivel: boolean
          fonte_preco: string | null
          id: string
          modalidades: Json | null
          modelo_api: string
          novo: boolean
          padrao_para: string[]
          preco_cache_1m: number | null
          preco_entrada_1m: number | null
          preco_imagem: Json | null
          preco_saida_1m: number | null
          provedor: string
          raciocinio: string[]
          rotulo: string
          sincronizado_em: string | null
          tipo: string
        }
        Insert: {
          ativo?: boolean
          capacidades?: Json | null
          conferido_em?: string | null
          contexto_tokens?: number | null
          criado_em?: string
          disponivel?: boolean
          fonte_preco?: string | null
          id: string
          modalidades?: Json | null
          modelo_api: string
          novo?: boolean
          padrao_para?: string[]
          preco_cache_1m?: number | null
          preco_entrada_1m?: number | null
          preco_imagem?: Json | null
          preco_saida_1m?: number | null
          provedor: string
          raciocinio?: string[]
          rotulo: string
          sincronizado_em?: string | null
          tipo: string
        }
        Update: {
          ativo?: boolean
          capacidades?: Json | null
          conferido_em?: string | null
          contexto_tokens?: number | null
          criado_em?: string
          disponivel?: boolean
          fonte_preco?: string | null
          id?: string
          modalidades?: Json | null
          modelo_api?: string
          novo?: boolean
          padrao_para?: string[]
          preco_cache_1m?: number | null
          preco_entrada_1m?: number | null
          preco_imagem?: Json | null
          preco_saida_1m?: number | null
          provedor?: string
          raciocinio?: string[]
          rotulo?: string
          sincronizado_em?: string | null
          tipo?: string
        }
        Relationships: []
      }
      ia_usos: {
        Row: {
          agente: string
          chave_id: string | null
          chave_origem: string | null
          client_id: string
          criado_em: string
          criado_por: string | null
          custo_fonte: string
          custo_usd: number
          id: string
          imagens: number
          modelo_id: string
          provedor: string
          qualidade: string | null
          referencia_id: string | null
          referencia_tipo: string | null
          tarefa: string
          tokens_cache: number
          tokens_entrada: number
          tokens_saida: number
        }
        Insert: {
          agente: string
          chave_id?: string | null
          chave_origem?: string | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          custo_fonte?: string
          custo_usd?: number
          id?: string
          imagens?: number
          modelo_id: string
          provedor: string
          qualidade?: string | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          tarefa: string
          tokens_cache?: number
          tokens_entrada?: number
          tokens_saida?: number
        }
        Update: {
          agente?: string
          chave_id?: string | null
          chave_origem?: string | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          custo_fonte?: string
          custo_usd?: number
          id?: string
          imagens?: number
          modelo_id?: string
          provedor?: string
          qualidade?: string | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          tarefa?: string
          tokens_cache?: number
          tokens_entrada?: number
          tokens_saida?: number
        }
        Relationships: [
          {
            foreignKeyName: "ia_usos_chave_id_fkey"
            columns: ["chave_id"]
            isOneToOne: false
            referencedRelation: "ia_chaves_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ia_usos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      idv_brandbooks: {
        Row: {
          arquivo_pdf_id: string | null
          atualizado_em: string
          client_id: string
          criado_em: string
          criado_por: string | null
          dados: Json
          id: string
          marca_id: string | null
          modelo: string
          nota: string | null
          projeto_id: string
          publicado: Json | null
          publicado_em: string | null
          publicado_por: string | null
          revogado_em: string | null
          status: string
          token_publico: string | null
          versao: number
        }
        Insert: {
          arquivo_pdf_id?: string | null
          atualizado_em?: string
          client_id: string
          criado_em?: string
          criado_por?: string | null
          dados: Json
          id?: string
          marca_id?: string | null
          modelo: string
          nota?: string | null
          projeto_id: string
          publicado?: Json | null
          publicado_em?: string | null
          publicado_por?: string | null
          revogado_em?: string | null
          status?: string
          token_publico?: string | null
          versao: number
        }
        Update: {
          arquivo_pdf_id?: string | null
          atualizado_em?: string
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          dados?: Json
          id?: string
          marca_id?: string | null
          modelo?: string
          nota?: string | null
          projeto_id?: string
          publicado?: Json | null
          publicado_em?: string | null
          publicado_por?: string | null
          revogado_em?: string | null
          status?: string
          token_publico?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "idv_brandbooks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idv_brandbooks_marca_fk"
            columns: ["marca_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "idv_brandbooks_projeto_fk"
            columns: ["projeto_id", "client_id"]
            isOneToOne: false
            referencedRelation: "idv_projetos"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      idv_eventos: {
        Row: {
          client_id: string
          criado_em: string
          criado_por: string | null
          id: string
          marca_id: string | null
          projeto_id: string | null
          provas: Json
          resumo: string
          tipo: string
        }
        Insert: {
          client_id: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          marca_id?: string | null
          projeto_id?: string | null
          provas?: Json
          resumo: string
          tipo: string
        }
        Update: {
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          marca_id?: string | null
          projeto_id?: string | null
          provas?: Json
          resumo?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "idv_eventos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      idv_naming_rodadas: {
        Row: {
          alvo: string
          arquivo_pdf_id: string | null
          atualizado_em: string
          aviso_jev: string | null
          campanha_id: string | null
          candidatos: Json
          client_id: string
          criado_em: string
          criado_por: string | null
          criterios: Json
          custo_usd: number
          enviado_grupo_em: string | null
          enviado_grupo_por: string | null
          escolhido: string | null
          id: string
          marca_id: string | null
          mensagem_grupo: string | null
          pedido: string | null
          projeto_id: string | null
          status: string
          tecnicas: string[]
          votacao_aberta_em: string | null
          votacao_fechada_em: string | null
          votacao_retrato: Json | null
          votacao_token: string | null
        }
        Insert: {
          alvo?: string
          arquivo_pdf_id?: string | null
          atualizado_em?: string
          aviso_jev?: string | null
          campanha_id?: string | null
          candidatos?: Json
          client_id: string
          criado_em?: string
          criado_por?: string | null
          criterios?: Json
          custo_usd?: number
          enviado_grupo_em?: string | null
          enviado_grupo_por?: string | null
          escolhido?: string | null
          id?: string
          marca_id?: string | null
          mensagem_grupo?: string | null
          pedido?: string | null
          projeto_id?: string | null
          status?: string
          tecnicas?: string[]
          votacao_aberta_em?: string | null
          votacao_fechada_em?: string | null
          votacao_retrato?: Json | null
          votacao_token?: string | null
        }
        Update: {
          alvo?: string
          arquivo_pdf_id?: string | null
          atualizado_em?: string
          aviso_jev?: string | null
          campanha_id?: string | null
          candidatos?: Json
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          criterios?: Json
          custo_usd?: number
          enviado_grupo_em?: string | null
          enviado_grupo_por?: string | null
          escolhido?: string | null
          id?: string
          marca_id?: string | null
          mensagem_grupo?: string | null
          pedido?: string | null
          projeto_id?: string | null
          status?: string
          tecnicas?: string[]
          votacao_aberta_em?: string | null
          votacao_fechada_em?: string | null
          votacao_retrato?: Json | null
          votacao_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idv_naming_rodadas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idv_naming_rodadas_marca_fk"
            columns: ["marca_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "idv_naming_rodadas_projeto_fk"
            columns: ["projeto_id", "client_id"]
            isOneToOne: false
            referencedRelation: "idv_projetos"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      idv_naming_votos: {
        Row: {
          atualizado_em: string
          candidato_id: string
          client_id: string
          comentario: string | null
          criado_em: string
          id: string
          nota: number
          origem: string
          rodada_id: string
          user_id: string | null
          votante: string
          votante_chave: string
        }
        Insert: {
          atualizado_em?: string
          candidato_id: string
          client_id: string
          comentario?: string | null
          criado_em?: string
          id?: string
          nota: number
          origem: string
          rodada_id: string
          user_id?: string | null
          votante: string
          votante_chave: string
        }
        Update: {
          atualizado_em?: string
          candidato_id?: string
          client_id?: string
          comentario?: string | null
          criado_em?: string
          id?: string
          nota?: number
          origem?: string
          rodada_id?: string
          user_id?: string | null
          votante?: string
          votante_chave?: string
        }
        Relationships: [
          {
            foreignKeyName: "idv_naming_votos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idv_naming_votos_rodada_id_fkey"
            columns: ["rodada_id"]
            isOneToOne: false
            referencedRelation: "idv_naming_rodadas"
            referencedColumns: ["id"]
          },
        ]
      }
      idv_projetos: {
        Row: {
          arquivado_em: string | null
          arquivado_por: string | null
          atualizado_em: string
          client_id: string
          com_naming: boolean
          concluidas: string[]
          criado_em: string
          criado_por: string | null
          custo_usd: number
          dados: Json
          estado: string
          etapa: string
          id: string
          marca_id: string | null
          modo: string
          titulo: string
          versao: number
        }
        Insert: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          client_id: string
          com_naming?: boolean
          concluidas?: string[]
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          dados?: Json
          estado?: string
          etapa?: string
          id?: string
          marca_id?: string | null
          modo: string
          titulo: string
          versao?: number
        }
        Update: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          client_id?: string
          com_naming?: boolean
          concluidas?: string[]
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          dados?: Json
          estado?: string
          etapa?: string
          id?: string
          marca_id?: string | null
          modo?: string
          titulo?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "idv_projetos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idv_projetos_marca_fk"
            columns: ["marca_id", "client_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      integration_configs: {
        Row: {
          auth_header: string
          auth_type: string
          auth_value_preview: string
          base_url: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          auth_header?: string
          auth_type?: string
          auth_value_preview?: string
          base_url?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          auth_header?: string
          auth_type?: string
          auth_value_preview?: string
          base_url?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      internal_operators: {
        Row: {
          area: string | null
          created_at: string
          display_name: string
          display_order: number
          hermes_profile_ref: string
          id: string
          is_coordinator: boolean
          last_run_at: string | null
          parent_slug: string | null
          permissions: Json
          role: string
          scope: string
          slug: string
          status: string
        }
        Insert: {
          area?: string | null
          created_at?: string
          display_name: string
          display_order?: number
          hermes_profile_ref: string
          id?: string
          is_coordinator?: boolean
          last_run_at?: string | null
          parent_slug?: string | null
          permissions?: Json
          role: string
          scope: string
          slug: string
          status?: string
        }
        Update: {
          area?: string | null
          created_at?: string
          display_name?: string
          display_order?: number
          hermes_profile_ref?: string
          id?: string
          is_coordinator?: boolean
          last_run_at?: string | null
          parent_slug?: string | null
          permissions?: Json
          role?: string
          scope?: string
          slug?: string
          status?: string
        }
        Relationships: []
      }
      mcp_audit_log: {
        Row: {
          correlation_id: string
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          id: string
          key_id: string | null
          origin: string | null
          sanitized_input: Json | null
          scopes: string[] | null
          status_code: number | null
          success: boolean
          tool_name: string
        }
        Insert: {
          correlation_id?: string
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          key_id?: string | null
          origin?: string | null
          sanitized_input?: Json | null
          scopes?: string[] | null
          status_code?: number | null
          success?: boolean
          tool_name: string
        }
        Update: {
          correlation_id?: string
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          key_id?: string | null
          origin?: string | null
          sanitized_input?: Json | null
          scopes?: string[] | null
          status_code?: number | null
          success?: boolean
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_audit_log_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_connection_profiles: {
        Row: {
          agent_type: string
          allow_operational_write: boolean
          auth_mode: string
          connection_count: number
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          last_connected_at: string | null
          last_used_at: string | null
          metadata: Json
          name: string
          origin: string
          public_id: string
          revoked_at: string | null
          scopes: string[]
          status: string
          updated_at: string
        }
        Insert: {
          agent_type: string
          allow_operational_write?: boolean
          auth_mode?: string
          connection_count?: number
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          last_connected_at?: string | null
          last_used_at?: string | null
          metadata?: Json
          name: string
          origin: string
          public_id: string
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          agent_type?: string
          allow_operational_write?: boolean
          auth_mode?: string
          connection_count?: number
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          last_connected_at?: string | null
          last_used_at?: string | null
          metadata?: Json
          name?: string
          origin?: string
          public_id?: string
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      mcp_oauth_allowed_redirect_origins: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          origin: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          origin: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          origin?: string
        }
        Relationships: []
      }
      mesa_agendamento_fila: {
        Row: {
          client_id: string
          criado_em: string
          erro: string | null
          file_id: string
          processado_em: string | null
          tentativas: number
          trabalho_id: string
        }
        Insert: {
          client_id: string
          criado_em?: string
          erro?: string | null
          file_id: string
          processado_em?: string | null
          tentativas?: number
          trabalho_id: string
        }
        Update: {
          client_id?: string
          criado_em?: string
          erro?: string | null
          file_id?: string
          processado_em?: string | null
          tentativas?: number
          trabalho_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mesa_agendamento_fila_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mesa_agendamento_fila_trabalho_id_fkey"
            columns: ["trabalho_id"]
            isOneToOne: true
            referencedRelation: "estudio_trabalhos"
            referencedColumns: ["id"]
          },
        ]
      }
      mesa_avisos_da_peca: {
        Row: {
          chave: string
          criado_em: string
          tipo: string
          trabalho_id: string | null
        }
        Insert: {
          chave: string
          criado_em?: string
          tipo: string
          trabalho_id?: string | null
        }
        Update: {
          chave?: string
          criado_em?: string
          tipo?: string
          trabalho_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mesa_avisos_da_peca_trabalho_id_fkey"
            columns: ["trabalho_id"]
            isOneToOne: false
            referencedRelation: "estudio_trabalhos"
            referencedColumns: ["id"]
          },
        ]
      }
      mesa_campanha_selos: {
        Row: {
          anterior_id: string | null
          arquivado_em: string | null
          caminho: string
          campanha_id: string
          client_id: string
          conferencia: Json | null
          criado_em: string
          criado_por: string | null
          custo_usd: number
          escolhido_em: string | null
          estilo: string | null
          fonte: Json | null
          id: string
          lote_id: string | null
          modelo_id: string | null
          origem: string
          pedido: string | null
          texto: string | null
        }
        Insert: {
          anterior_id?: string | null
          arquivado_em?: string | null
          caminho: string
          campanha_id: string
          client_id: string
          conferencia?: Json | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          escolhido_em?: string | null
          estilo?: string | null
          fonte?: Json | null
          id?: string
          lote_id?: string | null
          modelo_id?: string | null
          origem: string
          pedido?: string | null
          texto?: string | null
        }
        Update: {
          anterior_id?: string | null
          arquivado_em?: string | null
          caminho?: string
          campanha_id?: string
          client_id?: string
          conferencia?: Json | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          escolhido_em?: string | null
          estilo?: string | null
          fonte?: Json | null
          id?: string
          lote_id?: string | null
          modelo_id?: string | null
          origem?: string
          pedido?: string | null
          texto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mesa_campanha_selos_anterior_id_fkey"
            columns: ["anterior_id"]
            isOneToOne: false
            referencedRelation: "mesa_campanha_selos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mesa_campanha_selos_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "mesa_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mesa_campanha_selos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mesa_campanhas: {
        Row: {
          atualizado_em: string
          briefing: Json
          client_id: string
          conceito: string | null
          criado_em: string
          criado_por: string | null
          custo_usd: number
          id: string
          identidade: Json
          imagens: Json
          nome: string
          objetivo: string | null
          pedido: string | null
          periodo_fim: string | null
          periodo_inicio: string | null
          plano_imagens: Json | null
          proposta_id: string | null
          referencias_ids: string[]
          selo_id: string | null
          selo_path: string | null
          selo_referencias: Json
          status: string
        }
        Insert: {
          atualizado_em?: string
          briefing?: Json
          client_id: string
          conceito?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          id?: string
          identidade?: Json
          imagens?: Json
          nome: string
          objetivo?: string | null
          pedido?: string | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          plano_imagens?: Json | null
          proposta_id?: string | null
          referencias_ids?: string[]
          selo_id?: string | null
          selo_path?: string | null
          selo_referencias?: Json
          status?: string
        }
        Update: {
          atualizado_em?: string
          briefing?: Json
          client_id?: string
          conceito?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          id?: string
          identidade?: Json
          imagens?: Json
          nome?: string
          objetivo?: string | null
          pedido?: string | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          plano_imagens?: Json | null
          proposta_id?: string | null
          referencias_ids?: string[]
          selo_id?: string | null
          selo_path?: string | null
          selo_referencias?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mesa_campanhas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mesa_campanhas_proposta_id_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "calendario_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mesa_campanhas_selo_id_fkey"
            columns: ["selo_id"]
            isOneToOne: false
            referencedRelation: "mesa_campanha_selos"
            referencedColumns: ["id"]
          },
        ]
      }
      mesa_cliente_config: {
        Row: {
          agendar_ao_aprovar: boolean
          atualizado_em: string
          atualizado_por: string | null
          client_id: string
          formato_do_perfil: string | null
          fuso: string
          hora_publicacao: string
          horario_automatico: boolean
          laminas_por_post: number | null
          posts_por_mes: number | null
        }
        Insert: {
          agendar_ao_aprovar?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          client_id: string
          formato_do_perfil?: string | null
          fuso?: string
          hora_publicacao?: string
          horario_automatico?: boolean
          laminas_por_post?: number | null
          posts_por_mes?: number | null
        }
        Update: {
          agendar_ao_aprovar?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string
          formato_do_perfil?: string | null
          fuso?: string
          hora_publicacao?: string
          horario_automatico?: boolean
          laminas_por_post?: number | null
          posts_por_mes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mesa_cliente_config_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mesa_cliente_escolhas: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          client_id: string
          mesa: string
          modo: string
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id: string
          mesa: string
          modo: string
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string
          mesa?: string
          modo?: string
        }
        Relationships: []
      }
      mesa_fila_feitos: {
        Row: {
          arquivado_em: string | null
          arquivado_por: string | null
          client_id: string
          id: string
          marcado_em: string
          marcado_por: string
          periodo: string
          quantidade: number
          referencia: string | null
          tipo: string
        }
        Insert: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          client_id: string
          id?: string
          marcado_em?: string
          marcado_por: string
          periodo: string
          quantidade?: number
          referencia?: string | null
          tipo: string
        }
        Update: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          client_id?: string
          id?: string
          marcado_em?: string
          marcado_por?: string
          periodo?: string
          quantidade?: number
          referencia?: string | null
          tipo?: string
        }
        Relationships: []
      }
      mesa_hypes: {
        Row: {
          client_id: string
          criado_em: string
          criado_por: string | null
          custo_usd: number
          id: string
          itens: Json
          resumo: string | null
          semana: string
        }
        Insert: {
          client_id: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          id?: string
          itens?: Json
          resumo?: string | null
          semana: string
        }
        Update: {
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          id?: string
          itens?: Json
          resumo?: string | null
          semana?: string
        }
        Relationships: [
          {
            foreignKeyName: "mesa_hypes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mesa_mcp_itens: {
        Row: {
          ativo: boolean
          atualizado_em: string
          atualizado_por: string | null
          client_id: string
          fonte: string
          item_id: string
        }
        Insert: {
          ativo: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          client_id: string
          fonte: string
          item_id: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          client_id?: string
          fonte?: string
          item_id?: string
        }
        Relationships: []
      }
      mig_vault_map: {
        Row: {
          name: string | null
          new_id: string
          old_id: string
        }
        Insert: {
          name?: string | null
          new_id: string
          old_id: string
        }
        Update: {
          name?: string | null
          new_id?: string
          old_id?: string
        }
        Relationships: []
      }
      milestones: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          milestone_order: number | null
          ops_milestone_id: string | null
          project_id: string
          status: string
          sync_error: string | null
          sync_origin: string | null
          sync_status: string
          target_date: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          milestone_order?: number | null
          ops_milestone_id?: string | null
          project_id: string
          status?: string
          sync_error?: string | null
          sync_origin?: string | null
          sync_status?: string
          target_date: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          milestone_order?: number | null
          ops_milestone_id?: string | null
          project_id?: string
          status?: string
          sync_error?: string | null
          sync_origin?: string | null
          sync_status?: string
          target_date?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mockup_aplicacoes: {
        Row: {
          arquivado_em: string | null
          atualizado_em: string
          cena_caminho: string | null
          client_id: string
          config: Json
          criado_em: string
          criado_por: string | null
          entrega: Json | null
          file_id: string | null
          id: string
          marca_id: string | null
          mockup_id: string | null
          no_brandbook: boolean
          origem: string
          status: string
        }
        Insert: {
          arquivado_em?: string | null
          atualizado_em?: string
          cena_caminho?: string | null
          client_id: string
          config?: Json
          criado_em?: string
          criado_por?: string | null
          entrega?: Json | null
          file_id?: string | null
          id?: string
          marca_id?: string | null
          mockup_id?: string | null
          no_brandbook?: boolean
          origem?: string
          status?: string
        }
        Update: {
          arquivado_em?: string | null
          atualizado_em?: string
          cena_caminho?: string | null
          client_id?: string
          config?: Json
          criado_em?: string
          criado_por?: string | null
          entrega?: Json | null
          file_id?: string | null
          id?: string
          marca_id?: string | null
          mockup_id?: string | null
          no_brandbook?: boolean
          origem?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mockup_aplicacoes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mockup_aplicacoes_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mockup_aplicacoes_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mockup_aplicacoes_mockup_id_fkey"
            columns: ["mockup_id"]
            isOneToOne: false
            referencedRelation: "mockup_catalogo"
            referencedColumns: ["id"]
          },
        ]
      }
      mockup_catalogo: {
        Row: {
          altura: number
          altura_trabalho: number
          ativo: boolean
          atualizado_em: string
          bytes: number
          caminhos: Json
          categoria: string
          criado_em: string
          id: string
          largura: number
          largura_trabalho: number
          luminancia_media: number | null
          nome: string
          origem: string | null
          qualidade: Json
          slots: Json
          tags: string[]
          versao_pipeline: number
        }
        Insert: {
          altura: number
          altura_trabalho: number
          ativo?: boolean
          atualizado_em?: string
          bytes?: number
          caminhos: Json
          categoria: string
          criado_em?: string
          id: string
          largura: number
          largura_trabalho: number
          luminancia_media?: number | null
          nome: string
          origem?: string | null
          qualidade?: Json
          slots?: Json
          tags?: string[]
          versao_pipeline?: number
        }
        Update: {
          altura?: number
          altura_trabalho?: number
          ativo?: boolean
          atualizado_em?: string
          bytes?: number
          caminhos?: Json
          categoria?: string
          criado_em?: string
          id?: string
          largura?: number
          largura_trabalho?: number
          luminancia_media?: number | null
          nome?: string
          origem?: string | null
          qualidade?: Json
          slots?: Json
          tags?: string[]
          versao_pipeline?: number
        }
        Relationships: []
      }
      motion_filmes: {
        Row: {
          arquivado_em: string | null
          arquivado_por: string | null
          atualizado_em: string
          brand: Json
          cenas: Json
          client_id: string
          criado_em: string
          criado_por: string | null
          critica: Json
          custo_usd: number
          entrega: Json
          entrevista: Json
          etapa: string
          formatos: string[]
          id: string
          insumos: Json
          marca_id: string | null
          modelo: string | null
          montagem: Json
          nome: string
          renders: Json
          som: Json
          storyboard_escolhido: number | null
          storyboards: Json
          tipo: string
        }
        Insert: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          brand?: Json
          cenas?: Json
          client_id: string
          criado_em?: string
          criado_por?: string | null
          critica?: Json
          custo_usd?: number
          entrega?: Json
          entrevista?: Json
          etapa?: string
          formatos?: string[]
          id?: string
          insumos?: Json
          marca_id?: string | null
          modelo?: string | null
          montagem?: Json
          nome: string
          renders?: Json
          som?: Json
          storyboard_escolhido?: number | null
          storyboards?: Json
          tipo?: string
        }
        Update: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          brand?: Json
          cenas?: Json
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          critica?: Json
          custo_usd?: number
          entrega?: Json
          entrevista?: Json
          etapa?: string
          formatos?: string[]
          id?: string
          insumos?: Json
          marca_id?: string | null
          modelo?: string | null
          montagem?: Json
          nome?: string
          renders?: Json
          som?: Json
          storyboard_escolhido?: number | null
          storyboards?: Json
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "motion_filmes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      motor_eventos: {
        Row: {
          client_id: string
          dados: Json
          em: string
          id: number
          resumo: string
          tipo: string
          trabalho_id: string
        }
        Insert: {
          client_id: string
          dados?: Json
          em?: string
          id?: number
          resumo: string
          tipo: string
          trabalho_id: string
        }
        Update: {
          client_id?: string
          dados?: Json
          em?: string
          id?: number
          resumo?: string
          tipo?: string
          trabalho_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "motor_eventos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motor_eventos_trabalho_id_fkey"
            columns: ["trabalho_id"]
            isOneToOne: false
            referencedRelation: "motor_trabalhos"
            referencedColumns: ["id"]
          },
        ]
      }
      motor_executores: {
        Row: {
          capacidades: Json
          nome: string
          trabalho_id: string | null
          versao: string | null
          visto_em: string
        }
        Insert: {
          capacidades?: Json
          nome: string
          trabalho_id?: string | null
          versao?: string | null
          visto_em?: string
        }
        Update: {
          capacidades?: Json
          nome?: string
          trabalho_id?: string | null
          versao?: string | null
          visto_em?: string
        }
        Relationships: []
      }
      motor_trabalhos: {
        Row: {
          atualizado_em: string
          client_id: string
          commit: string | null
          commit_anterior: string | null
          criado_em: string
          criado_por: string | null
          custo_fonte: string | null
          custo_usd: number
          erro: string | null
          estado: string
          estimativa_usd: number | null
          executor: string | null
          id: string
          instrucao: string
          marca_id: string | null
          mesa: string
          modelo: string | null
          parar_pedido_em: string | null
          parar_pedido_por: string | null
          pedido: Json
          pego_em: string | null
          preview_expira_em: string | null
          preview_url: string | null
          projeto: string
          referencia_id: string | null
          referencia_tipo: string | null
          resultado: Json
          terminado_em: string | null
          teto_usd: number
          tipo: string
          uso_id: string | null
          zip_path: string | null
        }
        Insert: {
          atualizado_em?: string
          client_id: string
          commit?: string | null
          commit_anterior?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_fonte?: string | null
          custo_usd?: number
          erro?: string | null
          estado?: string
          estimativa_usd?: number | null
          executor?: string | null
          id?: string
          instrucao?: string
          marca_id?: string | null
          mesa?: string
          modelo?: string | null
          parar_pedido_em?: string | null
          parar_pedido_por?: string | null
          pedido?: Json
          pego_em?: string | null
          preview_expira_em?: string | null
          preview_url?: string | null
          projeto: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          resultado?: Json
          terminado_em?: string | null
          teto_usd?: number
          tipo: string
          uso_id?: string | null
          zip_path?: string | null
        }
        Update: {
          atualizado_em?: string
          client_id?: string
          commit?: string | null
          commit_anterior?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_fonte?: string | null
          custo_usd?: number
          erro?: string | null
          estado?: string
          estimativa_usd?: number | null
          executor?: string | null
          id?: string
          instrucao?: string
          marca_id?: string | null
          mesa?: string
          modelo?: string | null
          parar_pedido_em?: string | null
          parar_pedido_por?: string | null
          pedido?: Json
          pego_em?: string | null
          preview_expira_em?: string | null
          preview_url?: string | null
          projeto?: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          resultado?: Json
          terminado_em?: string | null
          teto_usd?: number
          tipo?: string
          uso_id?: string | null
          zip_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "motor_trabalhos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatch_hourly: {
        Row: {
          request_count: number
          updated_at: string
          user_id: string
          window_start: string
        }
        Insert: {
          request_count?: number
          updated_at?: string
          user_id: string
          window_start: string
        }
        Update: {
          request_count?: number
          updated_at?: string
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      notification_email_log: {
        Row: {
          created_at: string
          notification_id: string
          request_id: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          notification_id: string
          request_id?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          notification_id?: string
          request_id?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_email_log_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          agrupados: number
          created_at: string
          id: string
          link: string | null
          message: string
          notification_type: string
          read: boolean
          user_id: string
        }
        Insert: {
          agrupados?: number
          created_at?: string
          id?: string
          link?: string | null
          message: string
          notification_type: string
          read?: boolean
          user_id: string
        }
        Update: {
          agrupados?: number
          created_at?: string
          id?: string
          link?: string | null
          message?: string
          notification_type?: string
          read?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_approvals: {
        Row: {
          action_kind: string
          client_id: string | null
          created_at: string
          custo_previsto: number | null
          dados_usados: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          destino: string | null
          evidencia: string | null
          executed_at: string | null
          execution_evidence: string | null
          execution_run_key: string | null
          id: string
          impacto: string | null
          invalidated_at: string | null
          invalidation_reason: string | null
          kanban_task_id: string | null
          o_que: string
          operator_id: string | null
          origin: string
          payload: Json
          payload_hash: string | null
          payload_version: number
          por_que: string
          prazo: string | null
          report_id: string | null
          request_key: string | null
          reversivel: boolean
          review_group_key: string | null
          risco: string | null
          status: string
          task_link_id: string | null
          valid_until: string | null
        }
        Insert: {
          action_kind: string
          client_id?: string | null
          created_at?: string
          custo_previsto?: number | null
          dados_usados?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          destino?: string | null
          evidencia?: string | null
          executed_at?: string | null
          execution_evidence?: string | null
          execution_run_key?: string | null
          id?: string
          impacto?: string | null
          invalidated_at?: string | null
          invalidation_reason?: string | null
          kanban_task_id?: string | null
          o_que: string
          operator_id?: string | null
          origin?: string
          payload?: Json
          payload_hash?: string | null
          payload_version?: number
          por_que: string
          prazo?: string | null
          report_id?: string | null
          request_key?: string | null
          reversivel?: boolean
          review_group_key?: string | null
          risco?: string | null
          status?: string
          task_link_id?: string | null
          valid_until?: string | null
        }
        Update: {
          action_kind?: string
          client_id?: string | null
          created_at?: string
          custo_previsto?: number | null
          dados_usados?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          destino?: string | null
          evidencia?: string | null
          executed_at?: string | null
          execution_evidence?: string | null
          execution_run_key?: string | null
          id?: string
          impacto?: string | null
          invalidated_at?: string | null
          invalidation_reason?: string | null
          kanban_task_id?: string | null
          o_que?: string
          operator_id?: string | null
          origin?: string
          payload?: Json
          payload_hash?: string | null
          payload_version?: number
          por_que?: string
          prazo?: string | null
          report_id?: string | null
          request_key?: string | null
          reversivel?: boolean
          review_group_key?: string | null
          risco?: string | null
          status?: string
          task_link_id?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_approvals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_approvals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_approvals_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "internal_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_approvals_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_approvals_task_link_id_fkey"
            columns: ["task_link_id"]
            isOneToOne: false
            referencedRelation: "operator_task_links"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_audit_log: {
        Row: {
          action: string
          actor: string
          approval_required: boolean
          evidence: string | null
          from_cron: boolean
          id: string
          kanban_task_id: string | null
          new_status: string | null
          occurred_at: string
          old_status: string | null
          operator_id: string | null
          run_key: string | null
          task_link_id: string | null
        }
        Insert: {
          action: string
          actor: string
          approval_required?: boolean
          evidence?: string | null
          from_cron?: boolean
          id?: string
          kanban_task_id?: string | null
          new_status?: string | null
          occurred_at?: string
          old_status?: string | null
          operator_id?: string | null
          run_key?: string | null
          task_link_id?: string | null
        }
        Update: {
          action?: string
          actor?: string
          approval_required?: boolean
          evidence?: string | null
          from_cron?: boolean
          id?: string
          kanban_task_id?: string | null
          new_status?: string | null
          occurred_at?: string
          old_status?: string | null
          operator_id?: string | null
          run_key?: string | null
          task_link_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_audit_log_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "internal_operators"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_deliveries: {
        Row: {
          approval_id: string | null
          client_id: string | null
          como: string
          id: string
          kanban_task_id: string | null
          o_que: string
          occurred_at: string
          onde_acessar: string
          onde_documentado: string | null
          operator_id: string
          run_key: string | null
          task_link_id: string | null
        }
        Insert: {
          approval_id?: string | null
          client_id?: string | null
          como: string
          id?: string
          kanban_task_id?: string | null
          o_que: string
          occurred_at?: string
          onde_acessar: string
          onde_documentado?: string | null
          operator_id: string
          run_key?: string | null
          task_link_id?: string | null
        }
        Update: {
          approval_id?: string | null
          client_id?: string | null
          como?: string
          id?: string
          kanban_task_id?: string | null
          o_que?: string
          occurred_at?: string
          onde_acessar?: string
          onde_documentado?: string | null
          operator_id?: string
          run_key?: string | null
          task_link_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_deliveries_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "operator_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_deliveries_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "internal_operators"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_participations: {
        Row: {
          attachments: Json
          author_id: string | null
          author_kind: string
          body: string
          created_at: string
          entry_type: string
          id: string
          kanban_task_id: string | null
          operator_id: string | null
          task_link_id: string | null
          title: string | null
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          author_kind: string
          body: string
          created_at?: string
          entry_type: string
          id?: string
          kanban_task_id?: string | null
          operator_id?: string | null
          task_link_id?: string | null
          title?: string | null
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          author_kind?: string
          body?: string
          created_at?: string
          entry_type?: string
          id?: string
          kanban_task_id?: string | null
          operator_id?: string | null
          task_link_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_participations_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_participations_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "internal_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_participations_task_link_id_fkey"
            columns: ["task_link_id"]
            isOneToOne: false
            referencedRelation: "operator_task_links"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_runs: {
        Row: {
          attempt: number
          detail: Json
          error: string | null
          finished_at: string | null
          heartbeat_at: string
          id: string
          operator_id: string
          run_key: string
          started_at: string
          status: string
          task_link_id: string | null
          timeout_seconds: number
        }
        Insert: {
          attempt?: number
          detail?: Json
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string
          id?: string
          operator_id: string
          run_key: string
          started_at?: string
          status?: string
          task_link_id?: string | null
          timeout_seconds?: number
        }
        Update: {
          attempt?: number
          detail?: Json
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string
          id?: string
          operator_id?: string
          run_key?: string
          started_at?: string
          status?: string
          task_link_id?: string | null
          timeout_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "operator_runs_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "internal_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_runs_task_link_id_fkey"
            columns: ["task_link_id"]
            isOneToOne: false
            referencedRelation: "operator_task_links"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_task_links: {
        Row: {
          agent_run_id: string | null
          approval_required: boolean
          block_reason: string | null
          created_at: string
          execution_source: string
          id: string
          kanban_task_id: string | null
          last_action: string | null
          last_evidence: string | null
          next_step: string | null
          operator_id: string
          painel_task_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          approval_required?: boolean
          block_reason?: string | null
          created_at?: string
          execution_source?: string
          id?: string
          kanban_task_id?: string | null
          last_action?: string | null
          last_evidence?: string | null
          next_step?: string | null
          operator_id: string
          painel_task_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          approval_required?: boolean
          block_reason?: string | null
          created_at?: string
          execution_source?: string
          id?: string
          kanban_task_id?: string | null
          last_action?: string | null
          last_evidence?: string | null
          next_step?: string | null
          operator_id?: string
          painel_task_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_task_links_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "internal_operators"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_audit_log: {
        Row: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          new_amount: number | null
          new_status: string | null
          notes: string | null
          old_amount: number | null
          old_status: string | null
          performed_by: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          new_amount?: number | null
          new_status?: string | null
          notes?: string | null
          old_amount?: number | null
          old_status?: string | null
          performed_by?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_amount?: number | null
          new_status?: string | null
          notes?: string | null
          old_amount?: number | null
          old_status?: string | null
          performed_by?: string | null
        }
        Relationships: []
      }
      payment_installments: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          due_date: string
          id: string
          installment_number: number
          paid_amount: number | null
          paid_date: string | null
          payment_id: string
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          due_date: string
          id?: string
          installment_number: number
          paid_amount?: number | null
          paid_date?: string | null
          payment_id: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          installment_number?: number
          paid_amount?: number | null
          paid_date?: string | null
          payment_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_installments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "project_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_itens: {
        Row: {
          arquivado_em: string | null
          arquivos: Json
          autorizacao: Json
          client_id: string
          criado_em: string
          criado_por: string | null
          descricao: string | null
          id: string
          miniatura_path: string | null
          origem: string
          origem_id: string
          titulo: string
        }
        Insert: {
          arquivado_em?: string | null
          arquivos?: Json
          autorizacao: Json
          client_id: string
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          miniatura_path?: string | null
          origem: string
          origem_id: string
          titulo: string
        }
        Update: {
          arquivado_em?: string | null
          arquivos?: Json
          autorizacao?: Json
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          miniatura_path?: string | null
          origem?: string
          origem_id?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_itens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          brand: Database["public"]["Enums"]["brand_type"] | null
          client_type: Database["public"]["Enums"]["client_type"]
          company_name: string | null
          created_at: string
          deleted_at: string | null
          email: string
          first_access_attempts: number
          first_access_expires_at: string | null
          first_access_last_attempt_at: string | null
          first_access_token: string | null
          first_access_used_at: string | null
          full_name: string
          id: string
          onboarding_done: boolean
          ops_client_id: string | null
          overdue_since: string | null
          phone: string | null
          plan_name: string | null
          plan_renewal_date: string | null
          plan_status: string
          plan_value: number | null
          portal_password: string | null
          services_config: Json | null
          sync_error: string | null
          sync_status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          brand?: Database["public"]["Enums"]["brand_type"] | null
          client_type?: Database["public"]["Enums"]["client_type"]
          company_name?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          first_access_attempts?: number
          first_access_expires_at?: string | null
          first_access_last_attempt_at?: string | null
          first_access_token?: string | null
          first_access_used_at?: string | null
          full_name: string
          id: string
          onboarding_done?: boolean
          ops_client_id?: string | null
          overdue_since?: string | null
          phone?: string | null
          plan_name?: string | null
          plan_renewal_date?: string | null
          plan_status?: string
          plan_value?: number | null
          portal_password?: string | null
          services_config?: Json | null
          sync_error?: string | null
          sync_status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          brand?: Database["public"]["Enums"]["brand_type"] | null
          client_type?: Database["public"]["Enums"]["client_type"]
          company_name?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          first_access_attempts?: number
          first_access_expires_at?: string | null
          first_access_last_attempt_at?: string | null
          first_access_token?: string | null
          first_access_used_at?: string | null
          full_name?: string
          id?: string
          onboarding_done?: boolean
          ops_client_id?: string | null
          overdue_since?: string | null
          phone?: string | null
          plan_name?: string | null
          plan_renewal_date?: string | null
          plan_status?: string
          plan_value?: number | null
          portal_password?: string | null
          services_config?: Json | null
          sync_error?: string | null
          sync_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_external_accounts: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          external_account_id: string
          id: string
          project_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          external_account_id: string
          id?: string
          project_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          external_account_id?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_external_accounts_account_fk"
            columns: ["external_account_id", "client_id"]
            isOneToOne: false
            referencedRelation: "external_accounts"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "project_external_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_external_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_external_accounts_project_fk"
            columns: ["project_id", "client_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      project_memory: {
        Row: {
          client_id: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          metadata: Json
          project_id: string | null
          source: string
          tags: string[]
          title: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          metadata?: Json
          project_id?: string | null
          source?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          metadata?: Json
          project_id?: string | null
          source?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_payments: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          entry_amount: number
          entry_percentage: number
          id: string
          installments_count: number
          notes: string | null
          project_id: string
          total_value: number
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          entry_amount: number
          entry_percentage?: number
          id?: string
          installments_count?: number
          notes?: string | null
          project_id: string
          total_value: number
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          entry_amount?: number
          entry_percentage?: number
          id?: string
          installments_count?: number
          notes?: string | null
          project_id?: string
          total_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          billing_mode: Database["public"]["Enums"]["project_billing_mode"]
          brand: Database["public"]["Enums"]["brand_type"] | null
          client_id: string
          created_at: string
          created_by: string | null
          deadline: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          objectives: string | null
          ops_workspace_id: string | null
          pipeline: Json | null
          progress: number
          project_type: string
          scope: string | null
          start_date: string
          status: string
          sync_error: string | null
          sync_status: string
          total_value: number | null
          updated_at: string
        }
        Insert: {
          billing_mode?: Database["public"]["Enums"]["project_billing_mode"]
          brand?: Database["public"]["Enums"]["brand_type"] | null
          client_id: string
          created_at?: string
          created_by?: string | null
          deadline: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          objectives?: string | null
          ops_workspace_id?: string | null
          pipeline?: Json | null
          progress?: number
          project_type: string
          scope?: string | null
          start_date: string
          status?: string
          sync_error?: string | null
          sync_status?: string
          total_value?: number | null
          updated_at?: string
        }
        Update: {
          billing_mode?: Database["public"]["Enums"]["project_billing_mode"]
          brand?: Database["public"]["Enums"]["brand_type"] | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          deadline?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          objectives?: string | null
          ops_workspace_id?: string | null
          pipeline?: Json | null
          progress?: number
          project_type?: string
          scope?: string | null
          start_date?: string
          status?: string
          sync_error?: string | null
          sync_status?: string
          total_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      proposta_calculadora: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          custos_fixos_mes: number
          horas_produtivas_mes: number
          id: number
          impostos_pct: number
          margem_pct: number
          pro_labore_mes: number
          usar_financeiro: boolean
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          custos_fixos_mes?: number
          horas_produtivas_mes?: number
          id?: number
          impostos_pct?: number
          margem_pct?: number
          pro_labore_mes?: number
          usar_financeiro?: boolean
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          custos_fixos_mes?: number
          horas_produtivas_mes?: number
          id?: number
          impostos_pct?: number
          margem_pct?: number
          pro_labore_mes?: number
          usar_financeiro?: boolean
        }
        Relationships: []
      }
      proposta_eventos: {
        Row: {
          client_id: string
          criado_em: string
          criado_por: string | null
          dados: Json
          id: string
          ip: string | null
          proposta_id: string
          segundos: number | null
          sessao: string | null
          tipo: string
          user_agent: string | null
        }
        Insert: {
          client_id: string
          criado_em?: string
          criado_por?: string | null
          dados?: Json
          id?: string
          ip?: string | null
          proposta_id: string
          segundos?: number | null
          sessao?: string | null
          tipo: string
          user_agent?: string | null
        }
        Update: {
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          dados?: Json
          id?: string
          ip?: string | null
          proposta_id?: string
          segundos?: number | null
          sessao?: string | null
          tipo?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposta_eventos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposta_eventos_proposta_id_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id"]
          },
        ]
      }
      proposta_modelos: {
        Row: {
          arquivado_em: string | null
          atualizado_em: string
          blocos: Json
          condicoes: string | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          id: string
          nome: string
          padrao: boolean
          validade_dias: number
        }
        Insert: {
          arquivado_em?: string | null
          atualizado_em?: string
          blocos?: Json
          condicoes?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          nome: string
          padrao?: boolean
          validade_dias?: number
        }
        Update: {
          arquivado_em?: string | null
          atualizado_em?: string
          blocos?: Json
          condicoes?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          padrao?: boolean
          validade_dias?: number
        }
        Relationships: []
      }
      proposta_provas: {
        Row: {
          arquivado_em: string | null
          atualizado_em: string
          autorizacao: string | null
          autorizado: boolean
          autorizado_em: string | null
          autorizado_por: string | null
          cargo: string | null
          client_id: string | null
          criado_em: string
          criado_por: string | null
          empresa: string | null
          id: string
          link: string | null
          nicho: string | null
          nome: string | null
          texto: string | null
          tipo: string
          titulo: string | null
        }
        Insert: {
          arquivado_em?: string | null
          atualizado_em?: string
          autorizacao?: string | null
          autorizado?: boolean
          autorizado_em?: string | null
          autorizado_por?: string | null
          cargo?: string | null
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          empresa?: string | null
          id?: string
          link?: string | null
          nicho?: string | null
          nome?: string | null
          texto?: string | null
          tipo: string
          titulo?: string | null
        }
        Update: {
          arquivado_em?: string | null
          atualizado_em?: string
          autorizacao?: string | null
          autorizado?: boolean
          autorizado_em?: string | null
          autorizado_por?: string | null
          cargo?: string | null
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          empresa?: string | null
          id?: string
          link?: string | null
          nicho?: string | null
          nome?: string | null
          texto?: string | null
          tipo?: string
          titulo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposta_provas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      proposta_servicos: {
        Row: {
          arquivado_em: string | null
          atualizado_em: string
          categoria: string | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          entregaveis: Json
          horas: number | null
          id: string
          nome: string
          ordem: number
          preco: number
          recorrencia: string
          unidade: string
        }
        Insert: {
          arquivado_em?: string | null
          atualizado_em?: string
          categoria?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          entregaveis?: Json
          horas?: number | null
          id?: string
          nome: string
          ordem?: number
          preco: number
          recorrencia?: string
          unidade?: string
        }
        Update: {
          arquivado_em?: string | null
          atualizado_em?: string
          categoria?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          entregaveis?: Json
          horas?: number | null
          id?: string
          nome?: string
          ordem?: number
          preco?: number
          recorrencia?: string
          unidade?: string
        }
        Relationships: []
      }
      proposta_versoes: {
        Row: {
          client_id: string
          conteudo: Json
          criado_em: string
          criado_por: string | null
          id: string
          itens: Json
          nota: string | null
          origem: string
          pacotes: Json
          pagamento: Json
          proposta_id: string
          titulo: string | null
          validade_ate: string | null
          versao: number
        }
        Insert: {
          client_id: string
          conteudo: Json
          criado_em?: string
          criado_por?: string | null
          id?: string
          itens?: Json
          nota?: string | null
          origem?: string
          pacotes?: Json
          pagamento?: Json
          proposta_id: string
          titulo?: string | null
          validade_ate?: string | null
          versao: number
        }
        Update: {
          client_id?: string
          conteudo?: Json
          criado_em?: string
          criado_por?: string | null
          id?: string
          itens?: Json
          nota?: string | null
          origem?: string
          pacotes?: Json
          pagamento?: Json
          proposta_id?: string
          titulo?: string | null
          validade_ate?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposta_versoes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposta_versoes_proposta_id_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id"]
          },
        ]
      }
      propostas: {
        Row: {
          aceita_em: string | null
          aceite: Json | null
          anexos: Json
          arquivada_em: string | null
          atualizado_em: string
          client_id: string
          condicoes_pagamento: string | null
          conteudo: Json
          contexto: Json
          criado_em: string
          criado_por: string | null
          custo_usd: number
          duplicada_de: string | null
          enviada_em: string | null
          enviada_por: string | null
          expirada_em: string | null
          hash_enviado: string | null
          id: string
          itens: Json
          lead_id: string | null
          logo_cliente_path: string | null
          marca_id: string | null
          modelo_id: string | null
          motivo_recusa: string | null
          numero: string
          pacote_aceito: string | null
          pacotes: Json
          pagamento: Json
          pagamento_aceito: string | null
          pendencias: Json
          recusada_em: string | null
          status: string
          tipo: string | null
          titulo: string
          token: string | null
          total_mensal: number
          total_unico: number
          ultimo_followup_em: string | null
          validade_ate: string | null
          valor_mensal: number | null
          valor_total: number | null
          versao: number
          vista_em: string | null
          visual: Json
        }
        Insert: {
          aceita_em?: string | null
          aceite?: Json | null
          anexos?: Json
          arquivada_em?: string | null
          atualizado_em?: string
          client_id: string
          condicoes_pagamento?: string | null
          conteudo?: Json
          contexto?: Json
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          duplicada_de?: string | null
          enviada_em?: string | null
          enviada_por?: string | null
          expirada_em?: string | null
          hash_enviado?: string | null
          id?: string
          itens?: Json
          lead_id?: string | null
          logo_cliente_path?: string | null
          marca_id?: string | null
          modelo_id?: string | null
          motivo_recusa?: string | null
          numero: string
          pacote_aceito?: string | null
          pacotes?: Json
          pagamento?: Json
          pagamento_aceito?: string | null
          pendencias?: Json
          recusada_em?: string | null
          status?: string
          tipo?: string | null
          titulo?: string
          token?: string | null
          total_mensal?: number
          total_unico?: number
          ultimo_followup_em?: string | null
          validade_ate?: string | null
          valor_mensal?: number | null
          valor_total?: number | null
          versao?: number
          vista_em?: string | null
          visual?: Json
        }
        Update: {
          aceita_em?: string | null
          aceite?: Json | null
          anexos?: Json
          arquivada_em?: string | null
          atualizado_em?: string
          client_id?: string
          condicoes_pagamento?: string | null
          conteudo?: Json
          contexto?: Json
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          duplicada_de?: string | null
          enviada_em?: string | null
          enviada_por?: string | null
          expirada_em?: string | null
          hash_enviado?: string | null
          id?: string
          itens?: Json
          lead_id?: string | null
          logo_cliente_path?: string | null
          marca_id?: string | null
          modelo_id?: string | null
          motivo_recusa?: string | null
          numero?: string
          pacote_aceito?: string | null
          pacotes?: Json
          pagamento?: Json
          pagamento_aceito?: string | null
          pendencias?: Json
          recusada_em?: string | null
          status?: string
          tipo?: string | null
          titulo?: string
          token?: string | null
          total_mensal?: number
          total_unico?: number
          ultimo_followup_em?: string | null
          validade_ate?: string | null
          valor_mensal?: number | null
          valor_total?: number | null
          versao?: number
          vista_em?: string | null
          visual?: Json
        }
        Relationships: [
          {
            foreignKeyName: "propostas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propostas_duplicada_de_fkey"
            columns: ["duplicada_de"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propostas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "commercial_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propostas_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "cliente_marcas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propostas_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "proposta_modelos"
            referencedColumns: ["id"]
          },
        ]
      }
      publicidade_briefings: {
        Row: {
          briefing: Json
          campanha_id: string
          client_id: string
          criado_em: string
          criado_por: string | null
          id: string
          versao: number
        }
        Insert: {
          briefing: Json
          campanha_id: string
          client_id: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          versao: number
        }
        Update: {
          briefing?: Json
          campanha_id?: string
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "publicidade_briefings_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "publicidade_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_briefings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      publicidade_campanhas: {
        Row: {
          arquivada: boolean
          atualizado_em: string
          briefing: Json
          briefing_versao: number
          categoria: string | null
          client_id: string
          criado_em: string
          criado_por: string | null
          ensaio_id: string | null
          id: string
          kit_id: string | null
          kit_nome: string
          kit_tipo: string
          marca_id: string | null
          nome: string
          produto_fontes: string[]
          status: string
          territorio_id: string | null
        }
        Insert: {
          arquivada?: boolean
          atualizado_em?: string
          briefing?: Json
          briefing_versao?: number
          categoria?: string | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          ensaio_id?: string | null
          id?: string
          kit_id?: string | null
          kit_nome?: string
          kit_tipo?: string
          marca_id?: string | null
          nome?: string
          produto_fontes?: string[]
          status?: string
          territorio_id?: string | null
        }
        Update: {
          arquivada?: boolean
          atualizado_em?: string
          briefing?: Json
          briefing_versao?: number
          categoria?: string | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          ensaio_id?: string | null
          id?: string
          kit_id?: string | null
          kit_nome?: string
          kit_tipo?: string
          marca_id?: string | null
          nome?: string
          produto_fontes?: string[]
          status?: string
          territorio_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publicidade_campanhas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_campanhas_ensaio_id_fkey"
            columns: ["ensaio_id"]
            isOneToOne: false
            referencedRelation: "foto_ensaios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_campanhas_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "foto_kits"
            referencedColumns: ["id"]
          },
        ]
      }
      publicidade_encaminhamentos: {
        Row: {
          anuncio_aprovado: boolean
          campanha_id: string
          client_id: string
          criado_em: string
          criado_por: string | null
          destino: string
          id: string
          imagem_id: string
          linhagem: Json
          revisao_id: string | null
          verba_aprovada: boolean
        }
        Insert: {
          anuncio_aprovado?: boolean
          campanha_id: string
          client_id: string
          criado_em?: string
          criado_por?: string | null
          destino: string
          id?: string
          imagem_id: string
          linhagem?: Json
          revisao_id?: string | null
          verba_aprovada?: boolean
        }
        Update: {
          anuncio_aprovado?: boolean
          campanha_id?: string
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          destino?: string
          id?: string
          imagem_id?: string
          linhagem?: Json
          revisao_id?: string | null
          verba_aprovada?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "publicidade_encaminhamentos_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "publicidade_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_encaminhamentos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_encaminhamentos_revisao_id_fkey"
            columns: ["revisao_id"]
            isOneToOne: false
            referencedRelation: "publicidade_revisoes"
            referencedColumns: ["id"]
          },
        ]
      }
      publicidade_revisoes: {
        Row: {
          atualizado_em: string
          avaliacao: Json
          aviso_jev: Json | null
          campanha_id: string
          client_id: string
          criado_em: string
          decidido_em: string | null
          decidido_por: string | null
          decisao: string | null
          ensaio_id: string | null
          foto_tomada_id: string
          id: string
          imagem_id: string | null
          motivo: string | null
          storage_path: string | null
          tomada_id: string | null
          versao: number
        }
        Insert: {
          atualizado_em?: string
          avaliacao?: Json
          aviso_jev?: Json | null
          campanha_id: string
          client_id: string
          criado_em?: string
          decidido_em?: string | null
          decidido_por?: string | null
          decisao?: string | null
          ensaio_id?: string | null
          foto_tomada_id: string
          id?: string
          imagem_id?: string | null
          motivo?: string | null
          storage_path?: string | null
          tomada_id?: string | null
          versao: number
        }
        Update: {
          atualizado_em?: string
          avaliacao?: Json
          aviso_jev?: Json | null
          campanha_id?: string
          client_id?: string
          criado_em?: string
          decidido_em?: string | null
          decidido_por?: string | null
          decisao?: string | null
          ensaio_id?: string | null
          foto_tomada_id?: string
          id?: string
          imagem_id?: string | null
          motivo?: string | null
          storage_path?: string | null
          tomada_id?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "publicidade_revisoes_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "publicidade_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_revisoes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_revisoes_ensaio_id_fkey"
            columns: ["ensaio_id"]
            isOneToOne: false
            referencedRelation: "foto_ensaios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_revisoes_tomada_id_fkey"
            columns: ["tomada_id"]
            isOneToOne: false
            referencedRelation: "publicidade_tomadas"
            referencedColumns: ["id"]
          },
        ]
      }
      publicidade_territorios: {
        Row: {
          briefing_versao: number
          campanha_id: string
          client_id: string
          criado_em: string
          criado_por: string | null
          custo_usd: number
          dados: Json
          decidido_em: string | null
          decidido_por: string | null
          id: string
          ordem: number
          status: string
        }
        Insert: {
          briefing_versao?: number
          campanha_id: string
          client_id: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          dados: Json
          decidido_em?: string | null
          decidido_por?: string | null
          id?: string
          ordem?: number
          status?: string
        }
        Update: {
          briefing_versao?: number
          campanha_id?: string
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          dados?: Json
          decidido_em?: string | null
          decidido_por?: string | null
          id?: string
          ordem?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "publicidade_territorios_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "publicidade_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_territorios_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      publicidade_tomadas: {
        Row: {
          atualizado_em: string
          campanha_id: string
          client_id: string
          criado_em: string
          dados: Json
          ensaio_id: string | null
          foto_tomada_id: string | null
          funcao: string
          id: string
          ordem: number
          status: string
          territorio_id: string | null
        }
        Insert: {
          atualizado_em?: string
          campanha_id: string
          client_id: string
          criado_em?: string
          dados?: Json
          ensaio_id?: string | null
          foto_tomada_id?: string | null
          funcao: string
          id?: string
          ordem: number
          status?: string
          territorio_id?: string | null
        }
        Update: {
          atualizado_em?: string
          campanha_id?: string
          client_id?: string
          criado_em?: string
          dados?: Json
          ensaio_id?: string | null
          foto_tomada_id?: string | null
          funcao?: string
          id?: string
          ordem?: number
          status?: string
          territorio_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publicidade_tomadas_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "publicidade_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_tomadas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_tomadas_ensaio_id_fkey"
            columns: ["ensaio_id"]
            isOneToOne: false
            referencedRelation: "foto_ensaios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicidade_tomadas_territorio_id_fkey"
            columns: ["territorio_id"]
            isOneToOne: false
            referencedRelation: "publicidade_territorios"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      quiz_submissions: {
        Row: {
          action_count: number
          ai_readiness: string | null
          created_at: string | null
          differential: string | null
          goals_12m: string | null
          icp: string | null
          icp_fit_score: number | null
          id: string
          invitation_expires_at: string | null
          last_action_at: string | null
          lead_company: string | null
          lead_email: string | null
          lead_name: string | null
          lead_whatsapp: string | null
          main_pains: string | null
          maturity_digital: string | null
          origin: string | null
          positioning: string | null
          recommended_plan: string | null
          revenue_range: string | null
          status: string | null
          submitted_at: string | null
          success_metric: string | null
          team_size: string | null
          token: string
          updated_at: string | null
        }
        Insert: {
          action_count?: number
          ai_readiness?: string | null
          created_at?: string | null
          differential?: string | null
          goals_12m?: string | null
          icp?: string | null
          icp_fit_score?: number | null
          id?: string
          invitation_expires_at?: string | null
          last_action_at?: string | null
          lead_company?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_whatsapp?: string | null
          main_pains?: string | null
          maturity_digital?: string | null
          origin?: string | null
          positioning?: string | null
          recommended_plan?: string | null
          revenue_range?: string | null
          status?: string | null
          submitted_at?: string | null
          success_metric?: string | null
          team_size?: string | null
          token: string
          updated_at?: string | null
        }
        Update: {
          action_count?: number
          ai_readiness?: string | null
          created_at?: string | null
          differential?: string | null
          goals_12m?: string | null
          icp?: string | null
          icp_fit_score?: number | null
          id?: string
          invitation_expires_at?: string | null
          last_action_at?: string | null
          lead_company?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_whatsapp?: string | null
          main_pains?: string | null
          maturity_digital?: string | null
          origin?: string | null
          positioning?: string | null
          recommended_plan?: string | null
          revenue_range?: string | null
          status?: string | null
          submitted_at?: string | null
          success_metric?: string | null
          team_size?: string | null
          token?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      recharge_requests: {
        Row: {
          amount: number
          approved_by: string | null
          client_id: string
          created_at: string | null
          id: string
          platform: string
          reason: string | null
          requested_by: string | null
          status: string | null
        }
        Insert: {
          amount: number
          approved_by?: string | null
          client_id: string
          created_at?: string | null
          id?: string
          platform?: string
          reason?: string | null
          requested_by?: string | null
          status?: string | null
        }
        Update: {
          amount?: number
          approved_by?: string | null
          client_id?: string
          created_at?: string | null
          id?: string
          platform?: string
          reason?: string | null
          requested_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recharge_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recharge_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recharge_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referencias_globais: {
        Row: {
          ativa: boolean
          criado_em: string
          id: string
          leitura: string | null
          origem: string
          storage_path: string | null
          tags: string[]
          titulo: string | null
          url_origem: string | null
        }
        Insert: {
          ativa?: boolean
          criado_em?: string
          id?: string
          leitura?: string | null
          origem: string
          storage_path?: string | null
          tags?: string[]
          titulo?: string | null
          url_origem?: string | null
        }
        Update: {
          ativa?: boolean
          criado_em?: string
          id?: string
          leitura?: string | null
          origem?: string
          storage_path?: string | null
          tags?: string[]
          titulo?: string | null
          url_origem?: string | null
        }
        Relationships: []
      }
      render_pedidos: {
        Row: {
          arquivo_id: string | null
          atualizado_em: string
          client_id: string
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          custo_usd: number
          entrada: Json
          erro_codigo: string | null
          erro_mensagem: string | null
          estado: string
          etapa: string | null
          id: string
          iniciado_em: string | null
          max_tentativas: number
          motion_id: string | null
          progresso: number
          projeto: Json | null
          resultado: Json | null
          revisao: number | null
          saida_path: string | null
          tentativas: number
          tipo: string
          trava_ate: string | null
          trava_token: string | null
          uid: string
          versao_id: string | null
          worker: string | null
        }
        Insert: {
          arquivo_id?: string | null
          atualizado_em?: string
          client_id: string
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          entrada?: Json
          erro_codigo?: string | null
          erro_mensagem?: string | null
          estado?: string
          etapa?: string | null
          id?: string
          iniciado_em?: string | null
          max_tentativas?: number
          motion_id?: string | null
          progresso?: number
          projeto?: Json | null
          resultado?: Json | null
          revisao?: number | null
          saida_path?: string | null
          tentativas?: number
          tipo?: string
          trava_ate?: string | null
          trava_token?: string | null
          uid: string
          versao_id?: string | null
          worker?: string | null
        }
        Update: {
          arquivo_id?: string | null
          atualizado_em?: string
          client_id?: string
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          entrada?: Json
          erro_codigo?: string | null
          erro_mensagem?: string | null
          estado?: string
          etapa?: string | null
          id?: string
          iniciado_em?: string | null
          max_tentativas?: number
          motion_id?: string | null
          progresso?: number
          projeto?: Json | null
          resultado?: Json | null
          revisao?: number | null
          saida_path?: string | null
          tentativas?: number
          tipo?: string
          trava_ate?: string | null
          trava_token?: string | null
          uid?: string
          versao_id?: string | null
          worker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "render_pedidos_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "video_arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_pedidos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_pedidos_motion_id_fkey"
            columns: ["motion_id"]
            isOneToOne: false
            referencedRelation: "motion_filmes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_pedidos_versao_id_fkey"
            columns: ["versao_id"]
            isOneToOne: false
            referencedRelation: "video_versoes"
            referencedColumns: ["id"]
          },
        ]
      }
      render_workers: {
        Row: {
          nome: string
          versao: string | null
          visto_em: string
        }
        Insert: {
          nome: string
          versao?: string | null
          visto_em?: string
        }
        Update: {
          nome?: string
          versao?: string | null
          visto_em?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          chart_data: Json | null
          chart_type: string | null
          client_id: string
          created_at: string | null
          created_by: string | null
          file_url: string | null
          highlights: string | null
          id: string
          images: Json | null
          internal_notes: string | null
          metrics: Json | null
          next_steps: string | null
          period_end: string | null
          period_start: string | null
          project_id: string
          review_version: number
          status: string | null
          summary: string | null
          title: string
        }
        Insert: {
          chart_data?: Json | null
          chart_type?: string | null
          client_id: string
          created_at?: string | null
          created_by?: string | null
          file_url?: string | null
          highlights?: string | null
          id?: string
          images?: Json | null
          internal_notes?: string | null
          metrics?: Json | null
          next_steps?: string | null
          period_end?: string | null
          period_start?: string | null
          project_id: string
          review_version?: number
          status?: string | null
          summary?: string | null
          title: string
        }
        Update: {
          chart_data?: Json | null
          chart_type?: string | null
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          file_url?: string | null
          highlights?: string | null
          id?: string
          images?: Json | null
          internal_notes?: string | null
          metrics?: Json | null
          next_steps?: string | null
          period_end?: string | null
          period_start?: string | null
          project_id?: string
          review_version?: number
          status?: string | null
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      roteiro_modelos: {
        Row: {
          client_id: string | null
          criado_em: string
          criado_por: string | null
          escopo: string
          estrutura: Json
          id: string
          nome: string
          origem_roteiro_id: string | null
          origem_versao: number | null
          revogado_em: string | null
          tipo: string
        }
        Insert: {
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          escopo: string
          estrutura?: Json
          id?: string
          nome: string
          origem_roteiro_id?: string | null
          origem_versao?: number | null
          revogado_em?: string | null
          tipo?: string
        }
        Update: {
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          escopo?: string
          estrutura?: Json
          id?: string
          nome?: string
          origem_roteiro_id?: string | null
          origem_versao?: number | null
          revogado_em?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "roteiro_modelos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roteiro_modelos_origem_roteiro_id_fkey"
            columns: ["origem_roteiro_id"]
            isOneToOne: false
            referencedRelation: "roteiros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roteiro_modelos_origem_roteiro_id_fkey"
            columns: ["origem_roteiro_id"]
            isOneToOne: false
            referencedRelation: "roteiros_aprovados_para_video"
            referencedColumns: ["id"]
          },
        ]
      }
      roteiros: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          arquivado_em: string | null
          arquivado_por: string | null
          arquivo_pdf_id: string | null
          atualizado_em: string
          campanha_id: string | null
          client_id: string
          comentarios: Json
          criado_em: string
          criado_por: string | null
          custo_usd: number
          gravado_em: string | null
          id: string
          proposta_id: string | null
          status: string
          task_id: string | null
          tipo: string
          titulo: string
          versao_aprovada: number | null
          versao_atual: number
          versoes: Json
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          arquivado_em?: string | null
          arquivado_por?: string | null
          arquivo_pdf_id?: string | null
          atualizado_em?: string
          campanha_id?: string | null
          client_id: string
          comentarios?: Json
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          gravado_em?: string | null
          id?: string
          proposta_id?: string | null
          status?: string
          task_id?: string | null
          tipo?: string
          titulo?: string
          versao_aprovada?: number | null
          versao_atual?: number
          versoes?: Json
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          arquivado_em?: string | null
          arquivado_por?: string | null
          arquivo_pdf_id?: string | null
          atualizado_em?: string
          campanha_id?: string | null
          client_id?: string
          comentarios?: Json
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          gravado_em?: string | null
          id?: string
          proposta_id?: string | null
          status?: string
          task_id?: string | null
          tipo?: string
          titulo?: string
          versao_aprovada?: number | null
          versao_atual?: number
          versoes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "roteiros_arquivo_pdf_id_fkey"
            columns: ["arquivo_pdf_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roteiros_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "mesa_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roteiros_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roteiros_proposta_id_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "calendario_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roteiros_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      service_checklist_items: {
        Row: {
          checklist_id: string
          created_at: string
          hint: string | null
          id: string
          is_required: boolean
          label: string
          order_index: number
        }
        Insert: {
          checklist_id: string
          created_at?: string
          hint?: string | null
          id?: string
          is_required?: boolean
          label: string
          order_index?: number
        }
        Update: {
          checklist_id?: string
          created_at?: string
          hint?: string | null
          id?: string
          is_required?: boolean
          label?: string
          order_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "service_checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      service_checklists: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_required: boolean
          order_index: number
          phase: string
          service_type: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          order_index?: number
          phase: string
          service_type: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          order_index?: number
          phase?: string
          service_type?: string
          title?: string
        }
        Relationships: []
      }
      site_formulario_envios: {
        Row: {
          client_id: string
          criado_em: string
          id: number
          ip_hash: string
          lead_id: string | null
          motivo: string | null
          pagina: string | null
          resultado: string
          site_id: string
        }
        Insert: {
          client_id: string
          criado_em?: string
          id?: number
          ip_hash: string
          lead_id?: string | null
          motivo?: string | null
          pagina?: string | null
          resultado: string
          site_id: string
        }
        Update: {
          client_id?: string
          criado_em?: string
          id?: number
          ip_hash?: string
          lead_id?: string | null
          motivo?: string | null
          pagina?: string | null
          resultado?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_formulario_envios_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_formulario_envios_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "commercial_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_formulario_envios_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_versoes: {
        Row: {
          assinatura: string
          client_id: string
          criado_em: string
          criado_por: string | null
          dados: Json
          id: string
          motivo: string
          site_id: string
        }
        Insert: {
          assinatura: string
          client_id: string
          criado_em?: string
          criado_por?: string | null
          dados: Json
          id?: string
          motivo: string
          site_id: string
        }
        Update: {
          assinatura?: string
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          dados?: Json
          id?: string
          motivo?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_versoes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_versoes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          arquivado_em: string | null
          arquivado_por: string | null
          atualizado_em: string
          briefing: Json
          client_id: string
          conteudo: Json
          criado_em: string
          criado_por: string | null
          custo_usd: number
          direcao: Json
          dna: Json
          estilo: Json
          etapa: string
          id: string
          imagens: Json
          integracoes: Json
          mapa: Json
          marca_id: string | null
          modelo: string | null
          nome: string
          pacote_mudou_em: string | null
          projeto: string
          publicacao: Json
          referencias: Json
          revisao: Json
          seo: Json
          tipo: string | null
        }
        Insert: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          briefing?: Json
          client_id: string
          conteudo?: Json
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          direcao?: Json
          dna?: Json
          estilo?: Json
          etapa?: string
          id?: string
          imagens?: Json
          integracoes?: Json
          mapa?: Json
          marca_id?: string | null
          modelo?: string | null
          nome: string
          pacote_mudou_em?: string | null
          projeto: string
          publicacao?: Json
          referencias?: Json
          revisao?: Json
          seo?: Json
          tipo?: string | null
        }
        Update: {
          arquivado_em?: string | null
          arquivado_por?: string | null
          atualizado_em?: string
          briefing?: Json
          client_id?: string
          conteudo?: Json
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number
          direcao?: Json
          dna?: Json
          estilo?: Json
          etapa?: string
          id?: string
          imagens?: Json
          integracoes?: Json
          mapa?: Json
          marca_id?: string | null
          modelo?: string | null
          nome?: string
          pacote_mudou_em?: string | null
          projeto?: string
          publicacao?: Json
          referencias?: Json
          revisao?: Json
          seo?: Json
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_account_events: {
        Row: {
          actor_id: string | null
          actor_kind: string
          client_id: string
          created_at: string
          event_type: string
          external_account_id: string | null
          id: string
          metadata: Json
          operation_id: string
          project_id: string | null
          provider: string
          reason: string | null
          source: string
        }
        Insert: {
          actor_id?: string | null
          actor_kind?: string
          client_id: string
          created_at?: string
          event_type: string
          external_account_id?: string | null
          id?: string
          metadata?: Json
          operation_id?: string
          project_id?: string | null
          provider?: string
          reason?: string | null
          source: string
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          client_id?: string
          created_at?: string
          event_type?: string
          external_account_id?: string | null
          id?: string
          metadata?: Json
          operation_id?: string
          project_id?: string | null
          provider?: string
          reason?: string | null
          source?: string
        }
        Relationships: []
      }
      social_client_identity: {
        Row: {
          biography: string | null
          captured_at: string
          client_id: string
          display_name: string | null
          external_account_id: string
          id: string
          profile_picture_url: string | null
          username: string | null
          website: string | null
        }
        Insert: {
          biography?: string | null
          captured_at?: string
          client_id: string
          display_name?: string | null
          external_account_id: string
          id?: string
          profile_picture_url?: string | null
          username?: string | null
          website?: string | null
        }
        Update: {
          biography?: string | null
          captured_at?: string
          client_id?: string
          display_name?: string | null
          external_account_id?: string
          id?: string
          profile_picture_url?: string | null
          username?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_client_identity_external_account_id_fkey"
            columns: ["external_account_id"]
            isOneToOne: true
            referencedRelation: "external_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_metas_seguidores: {
        Row: {
          arquivada_em: string | null
          arquivada_por: string | null
          client_id: string
          criado_em: string
          criado_por: string | null
          id: string
          meta: number
          nota: string | null
          prazo: string | null
        }
        Insert: {
          arquivada_em?: string | null
          arquivada_por?: string | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          meta: number
          nota?: string | null
          prazo?: string | null
        }
        Update: {
          arquivada_em?: string | null
          arquivada_por?: string | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          meta?: number
          nota?: string | null
          prazo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_metas_seguidores_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_metrics_weekly: {
        Row: {
          accounts_engaged: number | null
          captured_at: string
          client_id: string
          external_account_id: string
          followers: number | null
          id: string
          media_count: number | null
          platform: string
          profile_views: number | null
          raw: Json
          reach: number | null
          total_interactions: number | null
          week_end: string
          week_start: string
        }
        Insert: {
          accounts_engaged?: number | null
          captured_at?: string
          client_id: string
          external_account_id: string
          followers?: number | null
          id?: string
          media_count?: number | null
          platform?: string
          profile_views?: number | null
          raw?: Json
          reach?: number | null
          total_interactions?: number | null
          week_end: string
          week_start: string
        }
        Update: {
          accounts_engaged?: number | null
          captured_at?: string
          client_id?: string
          external_account_id?: string
          followers?: number | null
          id?: string
          media_count?: number | null
          platform?: string
          profile_views?: number | null
          raw?: Json
          reach?: number | null
          total_interactions?: number | null
          week_end?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_metrics_weekly_external_account_id_fkey"
            columns: ["external_account_id"]
            isOneToOne: false
            referencedRelation: "external_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_metrics: {
        Row: {
          caption: string | null
          captured_at: string
          client_id: string
          comments_count: number | null
          external_account_id: string
          id: string
          insights_captured_at: string | null
          like_count: number | null
          media_id: string
          media_type: string | null
          media_url: string | null
          permalink: string | null
          posted_at: string | null
          reach: number | null
          saved: number | null
          shares: number | null
          thumbnail_url: string | null
          total_interactions: number | null
        }
        Insert: {
          caption?: string | null
          captured_at?: string
          client_id: string
          comments_count?: number | null
          external_account_id: string
          id?: string
          insights_captured_at?: string | null
          like_count?: number | null
          media_id: string
          media_type?: string | null
          media_url?: string | null
          permalink?: string | null
          posted_at?: string | null
          reach?: number | null
          saved?: number | null
          shares?: number | null
          thumbnail_url?: string | null
          total_interactions?: number | null
        }
        Update: {
          caption?: string | null
          captured_at?: string
          client_id?: string
          comments_count?: number | null
          external_account_id?: string
          id?: string
          insights_captured_at?: string | null
          like_count?: number | null
          media_id?: string
          media_type?: string | null
          media_url?: string | null
          permalink?: string | null
          posted_at?: string | null
          reach?: number | null
          saved?: number | null
          shares?: number | null
          thumbnail_url?: string | null
          total_interactions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "social_post_metrics_external_account_id_fkey"
            columns: ["external_account_id"]
            isOneToOne: false
            referencedRelation: "external_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_docs: {
        Row: {
          created_at: string
          doc_blocks: Json
          notes: string
          project_id: string
          published: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          doc_blocks?: Json
          notes?: string
          project_id: string
          published?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          doc_blocks?: Json
          notes?: string
          project_id?: string
          published?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "studio_docs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      task_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          task_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          task_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          task_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist_items: {
        Row: {
          checked: boolean
          created_at: string
          created_by: string
          id: string
          item_order: number
          task_id: string
          title: string
        }
        Insert: {
          checked?: boolean
          created_at?: string
          created_by: string
          id?: string
          item_order?: number
          task_id: string
          title: string
        }
        Update: {
          checked?: boolean
          created_at?: string
          created_by?: string
          id?: string
          item_order?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist_template_items: {
        Row: {
          created_at: string
          id: string
          is_required: boolean
          label: string
          order_index: number
          template_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_required?: boolean
          label: string
          order_index?: number
          template_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_required?: boolean
          label?: string
          order_index?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "task_checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist_templates: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          service_type: string | null
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          service_type?: string | null
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          service_type?: string | null
          title?: string
        }
        Relationships: []
      }
      task_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          deleted_at: string | null
          delivery_type: string
          description: string | null
          due_date: string | null
          id: string
          kanban_status: string | null
          milestone_id: string | null
          node_type: string | null
          ops_node_id: string | null
          ops_updated_at: string | null
          priority: string
          progress: number | null
          project_id: string
          sort_order: number | null
          source: string | null
          status: string
          sync_error: string | null
          sync_status: string
          task_order: number | null
          title: string
          updated_at: string
          workstream: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          deleted_at?: string | null
          delivery_type?: string
          description?: string | null
          due_date?: string | null
          id?: string
          kanban_status?: string | null
          milestone_id?: string | null
          node_type?: string | null
          ops_node_id?: string | null
          ops_updated_at?: string | null
          priority?: string
          progress?: number | null
          project_id: string
          sort_order?: number | null
          source?: string | null
          status?: string
          sync_error?: string | null
          sync_status?: string
          task_order?: number | null
          title: string
          updated_at?: string
          workstream?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          deleted_at?: string | null
          delivery_type?: string
          description?: string | null
          due_date?: string | null
          id?: string
          kanban_status?: string | null
          milestone_id?: string | null
          node_type?: string | null
          ops_node_id?: string | null
          ops_updated_at?: string | null
          priority?: string
          progress?: number | null
          project_id?: string
          sort_order?: number | null
          source?: string | null
          status?: string
          sync_error?: string | null
          sync_status?: string
          task_order?: number | null
          title?: string
          updated_at?: string
          workstream?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      team_client_assignments: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      tempo_de_trabalho: {
        Row: {
          atualizado_em: string
          client_id: string
          criado_em: string
          fim: string
          id: string
          inicio: string
          rota: string
          segundos: number
          user_id: string
          versao: number
        }
        Insert: {
          atualizado_em?: string
          client_id: string
          criado_em?: string
          fim: string
          id: string
          inicio: string
          rota: string
          segundos: number
          user_id: string
          versao?: number
        }
        Update: {
          atualizado_em?: string
          client_id?: string
          criado_em?: string
          fim?: string
          id?: string
          inicio?: string
          rota?: string
          segundos?: number
          user_id?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "tempo_de_trabalho_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tempo_de_trabalho_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      textura_catalogo: {
        Row: {
          altura: number
          ativo: boolean
          bytes: number
          caminho: string
          caminho_mini: string
          categoria: string
          cobertura: number | null
          criado_em: string
          id: string
          largura: number
          nome: string
          origem: string | null
        }
        Insert: {
          altura: number
          ativo?: boolean
          bytes?: number
          caminho: string
          caminho_mini: string
          categoria: string
          cobertura?: number | null
          criado_em?: string
          id: string
          largura: number
          nome: string
          origem?: string | null
        }
        Update: {
          altura?: number
          ativo?: boolean
          bytes?: number
          caminho?: string
          caminho_mini?: string
          categoria?: string
          cobertura?: number | null
          criado_em?: string
          id?: string
          largura?: number
          nome?: string
          origem?: string | null
        }
        Relationships: []
      }
      updates: {
        Row: {
          author_id: string
          client_visible: boolean
          created_at: string
          id: string
          message: string
          project_id: string
          update_type: string
        }
        Insert: {
          author_id: string
          client_visible?: boolean
          created_at?: string
          id?: string
          message: string
          project_id: string
          update_type: string
        }
        Update: {
          author_id?: string
          client_visible?: boolean
          created_at?: string
          id?: string
          message?: string
          project_id?: string
          update_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_purges: {
        Row: {
          actor_id: string
          id: string
          purged_at: string
          summary: Json
          target_email: string | null
          target_id: string
          target_name: string | null
        }
        Insert: {
          actor_id: string
          id?: string
          purged_at?: string
          summary?: Json
          target_email?: string | null
          target_id: string
          target_name?: string | null
        }
        Update: {
          actor_id?: string
          id?: string
          purged_at?: string
          summary?: Json
          target_email?: string | null
          target_id?: string
          target_name?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_acoes: {
        Row: {
          anexos: Json
          client_id: string
          conversa_id: string | null
          criado_em: string
          criado_por: string | null
          id: string
        }
        Insert: {
          anexos?: Json
          client_id: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
        }
        Update: {
          anexos?: Json
          client_id?: string
          conversa_id?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_acoes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_arquivos: {
        Row: {
          altura: number | null
          atualizado_em: string
          bytes: number | null
          cena_ref: string | null
          client_id: string
          criado_em: string
          criado_por: string | null
          duracao_s: number | null
          edicao_desde: string | null
          estado: string
          gravado_em: string | null
          grupo: string | null
          id: string
          largura: number | null
          melhor: boolean
          mime: string | null
          nome: string
          nome_original: string
          nota: string | null
          origem: Json | null
          pedido_id: string | null
          roteiro_id: string | null
          sha256: string | null
          storage_bucket: string
          storage_path: string
          tipo: string
        }
        Insert: {
          altura?: number | null
          atualizado_em?: string
          bytes?: number | null
          cena_ref?: string | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          duracao_s?: number | null
          edicao_desde?: string | null
          estado?: string
          gravado_em?: string | null
          grupo?: string | null
          id?: string
          largura?: number | null
          melhor?: boolean
          mime?: string | null
          nome: string
          nome_original: string
          nota?: string | null
          origem?: Json | null
          pedido_id?: string | null
          roteiro_id?: string | null
          sha256?: string | null
          storage_bucket?: string
          storage_path: string
          tipo?: string
        }
        Update: {
          altura?: number | null
          atualizado_em?: string
          bytes?: number | null
          cena_ref?: string | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          duracao_s?: number | null
          edicao_desde?: string | null
          estado?: string
          gravado_em?: string | null
          grupo?: string | null
          id?: string
          largura?: number | null
          melhor?: boolean
          mime?: string | null
          nome?: string
          nome_original?: string
          nota?: string | null
          origem?: Json | null
          pedido_id?: string | null
          roteiro_id?: string | null
          sha256?: string | null
          storage_bucket?: string
          storage_path?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_arquivos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_diretor_projetos: {
        Row: {
          atualizado_em: string
          biblia: Json
          briefing: Json
          client_id: string
          conversa: Json
          criado_em: string
          criado_por: string | null
          estado: string
          fase: string
          id: string
          kit_id: string | null
          roteiro: Json
          template_id: string | null
          titulo: string
          versao: number
        }
        Insert: {
          atualizado_em?: string
          biblia?: Json
          briefing?: Json
          client_id: string
          conversa?: Json
          criado_em?: string
          criado_por?: string | null
          estado?: string
          fase?: string
          id?: string
          kit_id?: string | null
          roteiro?: Json
          template_id?: string | null
          titulo: string
          versao?: number
        }
        Update: {
          atualizado_em?: string
          biblia?: Json
          briefing?: Json
          client_id?: string
          conversa?: Json
          criado_em?: string
          criado_por?: string | null
          estado?: string
          fase?: string
          id?: string
          kit_id?: string | null
          roteiro?: Json
          template_id?: string | null
          titulo?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "video_diretor_projetos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_motores: {
        Row: {
          ativo: boolean
          conferido_em: string | null
          criado_em: string
          disponivel: boolean
          endpoints: Json
          fonte_preco: string | null
          id: string
          linha: string
          novo: boolean
          preco: Json | null
          rotulo: string
          sincronizado_em: string | null
          versao: string
        }
        Insert: {
          ativo?: boolean
          conferido_em?: string | null
          criado_em?: string
          disponivel?: boolean
          endpoints?: Json
          fonte_preco?: string | null
          id: string
          linha: string
          novo?: boolean
          preco?: Json | null
          rotulo: string
          sincronizado_em?: string | null
          versao: string
        }
        Update: {
          ativo?: boolean
          conferido_em?: string | null
          criado_em?: string
          disponivel?: boolean
          endpoints?: Json
          fonte_preco?: string | null
          id?: string
          linha?: string
          novo?: boolean
          preco?: Json | null
          rotulo?: string
          sincronizado_em?: string | null
          versao?: string
        }
        Relationships: []
      }
      video_pedidos: {
        Row: {
          alvo: Json
          atualizado_em: string
          chave: string
          client_id: string
          consultado_em: string | null
          criado_em: string
          criado_por: string | null
          custo_estimado: Json
          estado: string
          executor: string
          id: string
          parametros: Json
          prazo_em: string | null
          projeto_id: string | null
          resultado: Json | null
          tipo: string
        }
        Insert: {
          alvo?: Json
          atualizado_em?: string
          chave: string
          client_id: string
          consultado_em?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_estimado?: Json
          estado?: string
          executor?: string
          id?: string
          parametros?: Json
          prazo_em?: string | null
          projeto_id?: string | null
          resultado?: Json | null
          tipo: string
        }
        Update: {
          alvo?: Json
          atualizado_em?: string
          chave?: string
          client_id?: string
          consultado_em?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_estimado?: Json
          estado?: string
          executor?: string
          id?: string
          parametros?: Json
          prazo_em?: string | null
          projeto_id?: string | null
          resultado?: Json | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_pedidos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_receitas: {
        Row: {
          arquivada_em: string | null
          client_id: string | null
          criado_em: string
          criado_por: string | null
          id: string
          nome: string
          origem: Json
          receita: Json
        }
        Insert: {
          arquivada_em?: string | null
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome: string
          origem?: Json
          receita: Json
        }
        Update: {
          arquivada_em?: string | null
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome?: string
          origem?: Json
          receita?: Json
        }
        Relationships: [
          {
            foreignKeyName: "video_receitas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_templates: {
        Row: {
          atualizado_em: string
          client_id: string | null
          criado_em: string
          criado_por: string | null
          estado: string
          estrutura: Json
          id: string
          kit_id: string | null
          nome: string
        }
        Insert: {
          atualizado_em?: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          estado?: string
          estrutura: Json
          id?: string
          kit_id?: string | null
          nome: string
        }
        Update: {
          atualizado_em?: string
          client_id?: string | null
          criado_em?: string
          criado_por?: string | null
          estado?: string
          estrutura?: Json
          id?: string
          kit_id?: string | null
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_versoes: {
        Row: {
          arquivo_id: string | null
          client_id: string
          criado_em: string
          criado_por: string | null
          custo_usd: number | null
          decidido_em: string | null
          decidido_por: string | null
          estado: string
          feedback: Json
          id: string
          motivo: string | null
          nota: string | null
          numero: number
          pai_id: string | null
          projeto: Json | null
          roteiro_id: string | null
          titulo: string
          video_id: string
        }
        Insert: {
          arquivo_id?: string | null
          client_id: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number | null
          decidido_em?: string | null
          decidido_por?: string | null
          estado?: string
          feedback?: Json
          id?: string
          motivo?: string | null
          nota?: string | null
          numero: number
          pai_id?: string | null
          projeto?: Json | null
          roteiro_id?: string | null
          titulo: string
          video_id: string
        }
        Update: {
          arquivo_id?: string | null
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          custo_usd?: number | null
          decidido_em?: string | null
          decidido_por?: string | null
          estado?: string
          feedback?: Json
          id?: string
          motivo?: string | null
          nota?: string | null
          numero?: number
          pai_id?: string | null
          projeto?: Json | null
          roteiro_id?: string | null
          titulo?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_versoes_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "video_arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_versoes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_versoes_pai_id_fkey"
            columns: ["pai_id"]
            isOneToOne: false
            referencedRelation: "video_versoes"
            referencedColumns: ["id"]
          },
        ]
      }
      video_vinculos: {
        Row: {
          canvas_id: string
          cena_ref: string
          client_id: string
          criado_em: string
          criado_por: string | null
          estado: string
          id: string
          no_id: string
          roteiro_id: string
        }
        Insert: {
          canvas_id: string
          cena_ref: string
          client_id: string
          criado_em?: string
          criado_por?: string | null
          estado?: string
          id?: string
          no_id: string
          roteiro_id: string
        }
        Update: {
          canvas_id?: string
          cena_ref?: string
          client_id?: string
          criado_em?: string
          criado_por?: string | null
          estado?: string
          id?: string
          no_id?: string
          roteiro_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_vinculos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_command_log: {
        Row: {
          clarifications: Json | null
          created_at: string
          id: string
          intent: Json | null
          preview: Json | null
          result: string | null
          status: string
          transcript: string
          user_id: string
        }
        Insert: {
          clarifications?: Json | null
          created_at?: string
          id?: string
          intent?: Json | null
          preview?: Json | null
          result?: string | null
          status?: string
          transcript: string
          user_id: string
        }
        Update: {
          clarifications?: Json | null
          created_at?: string
          id?: string
          intent?: Json | null
          preview?: Json | null
          result?: string | null
          status?: string
          transcript?: string
          user_id?: string
        }
        Relationships: []
      }
      weekly_cycle_progress: {
        Row: {
          area: string
          auto: boolean
          client_id: string
          done_at: string
          done_by: string | null
          id: string
          proof: string | null
          step: number
          week_start: string
        }
        Insert: {
          area: string
          auto?: boolean
          client_id: string
          done_at?: string
          done_by?: string | null
          id?: string
          proof?: string | null
          step: number
          week_start: string
        }
        Update: {
          area?: string
          auto?: boolean
          client_id?: string
          done_at?: string
          done_by?: string | null
          id?: string
          proof?: string | null
          step?: number
          week_start?: string
        }
        Relationships: []
      }
      workspace_agent_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          meta: Json | null
          role: string
          thread_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          meta?: Json | null
          role: string
          thread_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          meta?: Json | null
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_agent_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "workspace_agent_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_agent_personas: {
        Row: {
          client_id: string | null
          folder_path: string | null
          gpt_description: string | null
          gpt_name: string | null
          gpt_url: string | null
          id: string
          last_used_at: string | null
          persona_prompt: string | null
          updated_at: string
          usage_count: number
          user_id: string
        }
        Insert: {
          client_id?: string | null
          folder_path?: string | null
          gpt_description?: string | null
          gpt_name?: string | null
          gpt_url?: string | null
          id?: string
          last_used_at?: string | null
          persona_prompt?: string | null
          updated_at?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          client_id?: string | null
          folder_path?: string | null
          gpt_description?: string | null
          gpt_name?: string | null
          gpt_url?: string | null
          id?: string
          last_used_at?: string | null
          persona_prompt?: string | null
          updated_at?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_agent_personas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_agent_threads: {
        Row: {
          client_id: string | null
          created_at: string
          folder_path: string | null
          id: string
          parent_node_id: string | null
          scope: string
          system_prompt: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          folder_path?: string | null
          id?: string
          parent_node_id?: string | null
          scope?: string
          system_prompt?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          folder_path?: string | null
          id?: string
          parent_node_id?: string | null
          scope?: string
          system_prompt?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_agent_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_agent_threads_parent_node_id_fkey"
            columns: ["parent_node_id"]
            isOneToOne: false
            referencedRelation: "workspace_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_inbox_scan_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          method: string
          next_status: string
          node_id: string
          previous_status: string | null
          reference: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          method: string
          next_status: string
          node_id: string
          previous_status?: string | null
          reference?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          method?: string
          next_status?: string
          node_id?: string
          previous_status?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_inbox_scan_events_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "workspace_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_inbox_upload_reservations: {
        Row: {
          completed_at: string | null
          created_at: string
          failure_code: string | null
          folder_id: string
          id: string
          node_id: string | null
          request_id: string
          size_bytes: number
          status: string
          storage_path: string
          token_generation: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          folder_id: string
          id?: string
          node_id?: string | null
          request_id: string
          size_bytes: number
          status?: string
          storage_path: string
          token_generation: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          folder_id?: string
          id?: string
          node_id?: string | null
          request_id?: string
          size_bytes?: number
          status?: string
          storage_path?: string
          token_generation?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_inbox_upload_reservations_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "workspace_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_inbox_upload_reservations_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "workspace_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_nodes: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          duration_sec: number | null
          id: string
          inbox_scan_status: string | null
          inbox_token: string | null
          inbox_token_created_at: string | null
          inbox_token_expires_at: string | null
          inbox_token_generation: string | null
          kind: Database["public"]["Enums"]["workspace_kind"]
          mime: string | null
          name: string
          parent_id: string | null
          scope: Database["public"]["Enums"]["workspace_scope"]
          sent_for_approval_file_id: string | null
          size_bytes: number | null
          sort_index: number
          storage_path: string | null
          thumb_path: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_sec?: number | null
          id?: string
          inbox_scan_status?: string | null
          inbox_token?: string | null
          inbox_token_created_at?: string | null
          inbox_token_expires_at?: string | null
          inbox_token_generation?: string | null
          kind: Database["public"]["Enums"]["workspace_kind"]
          mime?: string | null
          name: string
          parent_id?: string | null
          scope: Database["public"]["Enums"]["workspace_scope"]
          sent_for_approval_file_id?: string | null
          size_bytes?: number | null
          sort_index?: number
          storage_path?: string | null
          thumb_path?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_sec?: number | null
          id?: string
          inbox_scan_status?: string | null
          inbox_token?: string | null
          inbox_token_created_at?: string | null
          inbox_token_expires_at?: string | null
          inbox_token_generation?: string | null
          kind?: Database["public"]["Enums"]["workspace_kind"]
          mime?: string | null
          name?: string
          parent_id?: string | null
          scope?: Database["public"]["Enums"]["workspace_scope"]
          sent_for_approval_file_id?: string | null
          size_bytes?: number | null
          sort_index?: number
          storage_path?: string | null
          thumb_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "workspace_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_nodes_sent_for_approval_file_id_fkey"
            columns: ["sent_for_approval_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ads_gerenciador_atual: {
        Row: {
          arvore: Json | null
          avisos: Json | null
          client_id: string | null
          contas: Json | null
          dias: number | null
          fonte: string | null
          gestao: Json | null
          id: string | null
          lido_em: string | null
          periodo_fim: string | null
          periodo_inicio: string | null
          plataforma: string | null
          resumo: Json | null
          sincronizado_em: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_gerenciador_leituras_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      autopublish_status_secure: {
        Row: {
          attempts: number | null
          client_id: string | null
          created_at: string | null
          last_error: string | null
          permalink: string | null
          publication_id: string | null
          stage: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          client_id?: string | null
          created_at?: string | null
          last_error?: string | null
          permalink?: string | null
          publication_id?: string | null
          stage?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          client_id?: string | null
          created_at?: string | null
          last_error?: string | null
          permalink?: string | null
          publication_id?: string | null
          stage?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      financial_entries_enriched: {
        Row: {
          amount: number | null
          brand: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: string | null
          client_id: string | null
          company_name: string | null
          competence: string | null
          competence_source: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          direct_cost_amount: number | null
          direct_cost_estimated: boolean | null
          direction: string | null
          due_date: string | null
          full_name: string | null
          id: string | null
          idempotency_key: string | null
          kind: string | null
          legacy_source_id: string | null
          legacy_source_table: string | null
          operational_amount: number | null
          outstanding_amount: number | null
          plan_version_id: string | null
          project_id: string | null
          recurring_rule_id: string | null
          settled_amount: number | null
          settled_at: string | null
          settlement_status: string | null
          source_system: string | null
          status: string | null
          tax_rate: number | null
          tax_reserve: number | null
          term_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "financial_plan_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_recurring_rule_id_fkey"
            columns: ["recurring_rule_id"]
            isOneToOne: false
            referencedRelation: "financial_recurring_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "financial_client_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      foto_cenas_da_historia: {
        Row: {
          acao: string | null
          animacao: Json | null
          atualizado_em: string | null
          canvas_id: string | null
          canvas_nome: string | null
          cenario: string | null
          client_id: string | null
          enquadramento: string | null
          historia: Json | null
          imagem_id: string | null
          narrativa: string | null
          no_id: string | null
          numero: number | null
          resultados: Json | null
          titulo: string | null
        }
        Relationships: [
          {
            foreignKeyName: "foto_canvas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roteiros_aprovados_para_video: {
        Row: {
          aprovado_em: string | null
          cenas: Json | null
          client_id: string | null
          id: string | null
          titulo: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roteiros_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_files_secure: {
        Row: {
          agency_approval_status: string | null
          agency_feedback: string | null
          agency_reviewed_at: string | null
          agency_reviewed_by: string | null
          approval_requested_at: string | null
          approval_status: string | null
          archived_at: string | null
          caption: string | null
          carousel_text: string | null
          client: Json | null
          client_decided_at: string | null
          client_decided_by: string | null
          client_id: string | null
          created_at: string | null
          description: string | null
          extension: string | null
          extracted_metadata: Json | null
          extraction_error: string | null
          extraction_status: string | null
          feedback: string | null
          file_name: string | null
          file_type: string | null
          file_url: string | null
          folder: string | null
          id: string | null
          idempotency_key: string | null
          locked_at: string | null
          mime_type: string | null
          page_count: number | null
          parent_file_id: string | null
          project: Json | null
          project_id: string | null
          requires_approval: boolean | null
          revision_of_file_id: string | null
          sensitivity: string | null
          sha256: string | null
          sheet_count: number | null
          size_bytes: number | null
          slide_count: number | null
          source: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string | null
          uploader: Json | null
          version: number | null
          visibility: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_delete_readiness: {
        Args: never
        Returns: {
          coluna: string
          obrigatoria: boolean
          tabela: string
          tratamento: string
        }[]
      }
      admin_purge_user: {
        Args: { _actor: string; _target: string }
        Returns: Json
      }
      admin_release_file_now: {
        Args: { p_file_id: string; p_mode: string }
        Returns: undefined
      }
      admin_user_storage_objects: { Args: { _target: string }; Returns: Json }
      ads_contas_conhecidas: { Args: never; Returns: Json }
      ads_creatives_tick: { Args: never; Returns: Json }
      ads_metrics_tick: { Args: never; Returns: Json }
      ads_oauth_consume_session: { Args: { _state: string }; Returns: Json }
      ads_oauth_create_session: { Args: never; Returns: Json }
      ads_token_de_gestao: {
        Args: { _client_id: string }
        Returns: {
          conferido_em: string
          escopos: string[]
          token: string
          token_id: string
        }[]
      }
      ads_token_para_biblioteca: {
        Args: { _client_id: string }
        Returns: string
      }
      ads_token_registrar_escopos: {
        Args: { _escopos: string[]; _token_id: string }
        Returns: undefined
      }
      agencia_dados_sugestoes: { Args: never; Returns: Json }
      aprovacao_email_tick: { Args: never; Returns: Json }
      aprovar_pelo_cliente: {
        Args: { p_file_id: string; p_nota?: string }
        Returns: Json
      }
      archive_editorial_post: {
        Args: { p_expected_version: number; p_post_id: string }
        Returns: Json
      }
      archive_editorial_post_unlocked: {
        Args: { p_expected_version: number; p_post_id: string }
        Returns: Json
      }
      assignment_proposal_decidir: {
        Args: { _decisao: string; _nota?: string; _proposal_id: string }
        Returns: Json
      }
      assignment_proposal_decidir_lote: {
        Args: { _decisao: string; _nota?: string; _proposal_ids: string[] }
        Returns: Json
      }
      audit_dossies_duplicados: {
        Args: never
        Returns: {
          id: string
        }[]
      }
      audit_referencias_orfas: {
        Args: never
        Returns: {
          client_id_orfao: string
          criado_em: string
          id: string
          tabela: string
        }[]
      }
      avisar_equipe: {
        Args: { _link: string; _message: string; _type: string }
        Returns: number
      }
      avisar_equipe_do_cliente: {
        Args: {
          _client_id: string
          _link: string
          _message: string
          _type: string
        }
        Returns: number
      }
      briefing_anexo_reservar: {
        Args: {
          _campo: string
          _categoria: string
          _mime: string
          _nome: string
          _tamanho: number
          _token: string
        }
        Returns: Json
      }
      briefing_juntar_respostas: {
        Args: { _base: Json; _mudancas: Json }
        Returns: Json
      }
      briefing_lembretes_do_dia: { Args: never; Returns: number }
      briefing_nome_do_modelo: {
        Args: { _conteudo: Json; _modelo: string }
        Returns: string
      }
      briefing_public_get: { Args: { _token: string }; Returns: Json }
      briefing_public_pedir_reabertura: {
        Args: { _motivo: string; _token: string }
        Returns: boolean
      }
      briefing_public_save: {
        Args: { _mudancas: Json; _token: string }
        Returns: Json
      }
      briefing_public_submit: {
        Args: { _responses: Json; _token: string }
        Returns: boolean
      }
      briefing_transcricao_reservar: {
        Args: { _campo: string; _segundos: number; _token: string }
        Returns: Json
      }
      can_access_client: { Args: { _client_id: string }; Returns: boolean }
      can_client_read_file: { Args: { _file_id: string }; Returns: boolean }
      can_delete_file: { Args: { _file_id: string }; Returns: boolean }
      can_manage_client: { Args: { _client_id: string }; Returns: boolean }
      can_read_file: { Args: { _file_id: string }; Returns: boolean }
      can_staff_access_project: {
        Args: { _project_id: string }
        Returns: boolean
      }
      can_staff_access_workspace_path: {
        Args: { _name: string }
        Returns: boolean
      }
      can_write_file: { Args: { _file_id: string }; Returns: boolean }
      cancel_workspace_inbox_upload: {
        Args: {
          p_failure_code?: string
          p_reservation_id: string
          p_storage_orphaned?: boolean
        }
        Returns: undefined
      }
      central_review_decide: {
        Args: {
          _approval_id: string
          _comment: string
          _decision: string
          _expected_client_id: string
          _expected_payload_hash: string
          _expected_version: number
          _idempotency_key: string
        }
        Returns: Json
      }
      central_review_decidir_por_agente: {
        Args: {
          _approval_id: string
          _comment: string
          _decision: string
          _evidence: string
          _idempotency_key: string
          _operator_slug: string
        }
        Returns: Json
      }
      central_review_fila_para_agente: {
        Args: { _operator_slug: string }
        Returns: Json
      }
      central_review_marcar_enviado: {
        Args: {
          _approval_id: string
          _evidence: string
          _idempotency_key: string
        }
        Returns: Json
      }
      central_review_marcar_enviado_por_agente: {
        Args: {
          _approval_id: string
          _evidence: string
          _idempotency_key: string
          _operator_slug: string
        }
        Returns: Json
      }
      central_review_preparar_por_agente: {
        Args: {
          _destination: Json
          _idempotency_key: string
          _next_steps?: string
          _operator_slug: string
          _report_id: string
          _summary?: string
        }
        Returns: Json
      }
      central_review_prepare: {
        Args: {
          _destination: Json
          _expected_version: number
          _idempotency_key: string
          _report_id: string
        }
        Returns: Json
      }
      central_review_source: { Args: { _client_id: string }; Returns: Json }
      cerebro_desligar_vencidos: { Args: never; Returns: number }
      claim_ai_usage: { Args: { _workload: string }; Returns: boolean }
      claim_first_access_token: {
        Args: { p_token_hash_hex: string }
        Returns: {
          claim_id: string
          email: string
          profile_id: string
        }[]
      }
      claim_notification_dispatch: { Args: never; Returns: boolean }
      collect_ads_metrics_now: { Args: never; Returns: Json }
      collect_ads_now: { Args: never; Returns: Json }
      collect_social_metrics_now: { Args: never; Returns: Json }
      commercial_activity_reminders: { Args: never; Returns: number }
      complete_contract_signature: {
        Args: {
          p_signature_ip: string
          p_signature_name: string
          p_token: string
        }
        Returns: string
      }
      complete_workspace_inbox_upload: {
        Args: {
          p_mime: string
          p_name: string
          p_request_id: string
          p_reservation_id: string
          p_token: string
        }
        Returns: string
      }
      configure_api_gateway_key_scope: {
        Args: {
          p_client_ids?: string[]
          p_key_id: string
          p_scope_mode: string
        }
        Returns: undefined
      }
      conselho_pegar_passo: {
        Args: { _sessao: string; _token: string; _trava_segundos?: number }
        Returns: {
          ata: string | null
          ata_file_id: string | null
          atualizado_em: string
          aviso: string | null
          client_id: string
          concluido_em: string | null
          contexto: string | null
          contexto_cliente: string | null
          criado_em: string
          criado_por: string | null
          criterios: Json
          custo_usd: number
          decisao: Json | null
          erro_codigo: string | null
          erro_mensagem: string | null
          especialistas: Json
          estimativa_usd: number
          etapa: string
          id: string
          marca_id: string | null
          memoria_id: string | null
          modo: string
          origem: string
          passos: number
          pauta: Json
          pergunta: string
          referencia: Json
          resultado: Json | null
          rodada_atual: number
          rodadas: number
          rodadas_extras: number
          status: string
          tema: string
          tentativas: number
          teto_usd: number
          trava_ate: string | null
          trava_token: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "conselho_sessoes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      consume_api_gateway_rate_limit: {
        Args: { _key_fingerprint: string }
        Returns: {
          is_allowed: boolean
          remaining: number
          retry_after_seconds: number
        }[]
      }
      consume_first_access_claim: {
        Args: { p_claim_id: string }
        Returns: boolean
      }
      contrato_arquivar: {
        Args: { p_ator: string; p_contract: string; p_motivo: string }
        Returns: Json
      }
      contrato_assinar_signatario: {
        Args: {
          p_assinado_em: string
          p_email: string
          p_hash_visto: string
          p_ip: string
          p_nome: string
          p_token: string
          p_user_agent: string
        }
        Returns: Json
      }
      contrato_concluir_assinatura: {
        Args: {
          p_assinado_em: string
          p_email: string
          p_hash_visto: string
          p_ip: string
          p_nome: string
          p_pdf_hash: string
          p_pdf_nome: string
          p_pdf_path: string
          p_token: string
          p_user_agent: string
        }
        Returns: string
      }
      contrato_concluir_com_signatarios: {
        Args: {
          p_contract: string
          p_pdf_hash: string
          p_pdf_nome: string
          p_pdf_path: string
        }
        Returns: string
      }
      contrato_modelo_publicar: {
        Args: {
          p_ator: string
          p_chave: string
          p_clausulas: Json
          p_nome: string
          p_revisao: string
          p_variaveis: Json
        }
        Returns: Json
      }
      contrato_substituir: {
        Args: { p_antigo: string; p_ator: string; p_novo: string }
        Returns: Json
      }
      create_and_link_editorial_account: {
        Args: {
          p_client_id: string
          p_display_name: string
          p_handle?: string
          p_platform: string
          p_project_id: string
        }
        Returns: string
      }
      create_file_record: {
        Args: { p_file: Json }
        Returns: {
          agency_approval_status: string
          agency_feedback: string | null
          agency_reviewed_at: string | null
          agency_reviewed_by: string | null
          approval_requested_at: string | null
          approval_status: string
          archived_at: string | null
          caption: string | null
          carousel_text: string | null
          client_decided_at: string | null
          client_decided_by: string | null
          client_id: string
          created_at: string
          description: string | null
          extension: string | null
          extracted_metadata: Json | null
          extraction_error: string | null
          extraction_status: string | null
          feedback: string | null
          file_name: string
          file_type: string | null
          file_url: string
          folder: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          mime_type: string | null
          page_count: number | null
          parent_file_id: string | null
          project_id: string | null
          requires_approval: boolean | null
          revision_of_file_id: string | null
          sensitivity: string | null
          sha256: string | null
          sheet_count: number | null
          size_bytes: number | null
          slide_count: number | null
          source: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string
          version: number | null
          visibility: string | null
        }
        SetofOptions: {
          from: "*"
          to: "files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_file_approval: {
        Args: {
          p_decision: string
          p_expected_version: number
          p_feedback?: string
          p_file_id: string
        }
        Returns: string
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      dossie_avancos_texto: {
        Args: { _client_id: string; _dias?: number }
        Returns: string
      }
      dossie_enfileirar: {
        Args: { _client_id: string; _motivo?: string }
        Returns: undefined
      }
      dossie_processar_fila: {
        Args: { _max?: number; _quieto?: string }
        Returns: number
      }
      dossie_registrar_avancos: {
        Args: { _client_id: string }
        Returns: boolean
      }
      dossie_registrar_avancos_interno: {
        Args: { _client_id: string }
        Returns: boolean
      }
      dossie_registrar_avancos_todos: { Args: never; Returns: number }
      editorial_alerta_agendamento_atrasado: { Args: never; Returns: Json }
      editorial_autopublish_tick: { Args: never; Returns: Json }
      editorial_can_publish_client: {
        Args: { _client_id: string }
        Returns: boolean
      }
      editorial_ciclo_publicacao: { Args: never; Returns: Json }
      editorial_client_can_read_post: {
        Args: { _post_id: string }
        Returns: boolean
      }
      editorial_client_can_read_publication: {
        Args: { _publication_id: string }
        Returns: boolean
      }
      editorial_compute_approval_fingerprint: {
        Args: { _post_id: string }
        Returns: string
      }
      editorial_conferir_agendamentos: { Args: never; Returns: Json }
      editorial_content_type_for_delivery_type: {
        Args: { _delivery_type: string }
        Returns: string
      }
      editorial_current_post_id_for_task: {
        Args: { _task_id: string }
        Returns: string
      }
      editorial_delivery_type_for_content_type: {
        Args: { _content_type: string }
        Returns: string
      }
      editorial_delivery_type_is_publishable: {
        Args: { _delivery_type: string }
        Returns: boolean
      }
      editorial_file_is_publishable: {
        Args: { _client_id: string; _file_id: string; _project_id: string }
        Returns: boolean
      }
      editorial_file_is_publishable_media: {
        Args: { _client_id: string; _file_id: string; _project_id: string }
        Returns: boolean
      }
      editorial_limpar_alertas_resolvidos: { Args: never; Returns: number }
      editorial_lock_task_sync: { Args: never; Returns: undefined }
      editorial_production_status_for_task: {
        Args: { _task_status: string }
        Returns: string
      }
      editorial_promover_planejados: {
        Args: { _janela_de_atraso?: string }
        Returns: Json
      }
      editorial_reconcile_task_delivery_types: { Args: never; Returns: number }
      editorial_reconciliar_publicados: { Args: never; Returns: Json }
      editorial_staff_can_access_client: {
        Args: { _client_id: string }
        Returns: boolean
      }
      editorial_sync_task_for_post: {
        Args: { _post_id: string }
        Returns: undefined
      }
      editorial_task_status_for_post: {
        Args: { _post_id: string }
        Returns: string
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      estudio_fila_pegar: {
        Args: {
          _global?: number
          _pedido_por: string
          _token: string
          _trava_segundos?: number
        }
        Returns: {
          atualizado_em: string
          aviso: string | null
          client_id: string
          concluido_em: string | null
          corrigir_sozinho: boolean
          criado_em: string
          custo_usd: number
          erro_codigo: string | null
          erro_mensagem: string | null
          etapa: string
          id: string
          iniciado_em: string | null
          lote_id: string
          marca_id: string | null
          max_tentativas: number
          ordem: number
          paralelo: number
          passos: number
          pedido_por: string | null
          proxima_em: string
          rodadas: number
          status: string
          tentativas: number
          trabalho_id: string
          trava_ate: string | null
          trava_token: string | null
          versoes_antes: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "estudio_fila"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      expense_estornar: { Args: { _pagamento_id: string }; Returns: Json }
      expense_pagar: {
        Args: {
          _expense_id: string
          _pago_em?: string
          _proximo_vencimento?: string
          _valor?: number
        }
        Returns: Json
      }
      file_guard_state: {
        Args: { p_file_id: string }
        Returns: {
          agency_approval_status: string
          approval_status: string
          client_id: string
          locked_at: string
          parent_file_id: string
          version: number
          visibility: string
        }[]
      }
      file_is_editable: { Args: { _file_id: string }; Returns: boolean }
      file_is_locked: { Args: { _file_id: string }; Returns: boolean }
      file_root_id: { Args: { _file_id: string }; Returns: string }
      file_root_state: {
        Args: { p_root_id: string }
        Returns: {
          root_agency_status: string
          root_approval_status: string
          root_locked_at: string
          root_visibility: string
        }[]
      }
      file_storage_matches_client: {
        Args: { _bucket: string; _client_id: string; _path: string }
        Returns: boolean
      }
      file_storage_reference_is_canonical: {
        Args: { _bucket: string; _path: string; _url: string }
        Returns: boolean
      }
      files_reference_matches: {
        Args: { _path: string; _url: string }
        Returns: boolean
      }
      files_reference_path: { Args: { _url: string }; Returns: string }
      financial_archive_plan: { Args: { p_plan_id: string }; Returns: Json }
      financial_archive_recurring_rule: {
        Args: { p_rule_id: string }
        Returns: Json
      }
      financial_assign_client_plan: {
        Args: {
          p_client_id: string
          p_direct_cost?: number
          p_due_day?: number
          p_effective_from: string
          p_justification?: string
          p_operational_amount?: number
          p_payment_method?: string
          p_plan_version_id: string
          p_pricing_mode?: string
          p_tax_rate?: number
        }
        Returns: Json
      }
      financial_cancel_entry: {
        Args: { p_entry_id: string; p_reason: string }
        Returns: Json
      }
      financial_cash_flow_v2: {
        Args: { p_competence: string; p_mode: string }
        Returns: Json
      }
      financial_client_summaries_v2: {
        Args: never
        Returns: {
          billing_period: string
          billing_status: string
          client_id: string
          client_name: string
          contribution_margin_percent: number
          direct_cost: number
          direct_cost_estimated: boolean
          due_day: number
          final_amount: number
          final_plan_amount: number
          next_due_date: string
          open_amount: number
          operational_amount: number
          overdue_amount: number
          plan_amount: number
          plan_name: string
          pricing_mode: string
          review_required: boolean
          settled_amount: number
          status: string
          tax_rate: number
          tax_reserve: number
          upcoming_final_amount: number
          upcoming_operational_amount: number
          upcoming_plan_name: string
          upcoming_starts_on: string
        }[]
      }
      financial_close_period: {
        Args: { p_competence: string; p_reason: string }
        Returns: Json
      }
      financial_create_plan_version: {
        Args: {
          p_amount: number
          p_billing_period?: string
          p_description?: string
          p_direct_cost?: number
          p_direct_cost_estimated?: boolean
          p_effective_from: string
          p_plan_id: string
          p_setup_fee?: number
          p_tax_rate?: number
        }
        Returns: Json
      }
      financial_generate_competence: {
        Args: { p_competence: string }
        Returns: Json
      }
      financial_gross_up: {
        Args: { p_operational_amount: number; p_tax_rate: number }
        Returns: number
      }
      financial_overview_v2: {
        Args: { p_competence: string; p_mode: string }
        Returns: Json
      }
      financial_record_settlement: {
        Args: {
          p_amount: number
          p_entry_id: string
          p_idempotency_key?: string
          p_method?: string
          p_notes?: string
          p_settled_on: string
        }
        Returns: Json
      }
      financial_reopen_period: {
        Args: { p_competence: string; p_reason: string }
        Returns: Json
      }
      financial_reverse_settlement: {
        Args: { p_reason: string; p_settlement_id: string }
        Returns: Json
      }
      financial_update_settings: {
        Args: {
          p_allocation_method?: string
          p_currency: string
          p_current_pro_labore?: number
          p_default_direct_cost?: number
          p_default_due_day: number
          p_desired_minimum_margin?: number
          p_forecast_months: number
          p_growth_retention_rate?: number
          p_include_pro_labore_in_allocation?: boolean
          p_minimum_reserve_months?: number
          p_monthly_goal?: number
          p_opening_balance: number
          p_reserve_target: number
          p_target_pro_labore?: number
          p_tools_systems_cost?: number
        }
        Returns: Json
      }
      financial_upsert_plan: {
        Args: {
          p_code?: string
          p_description?: string
          p_is_active?: boolean
          p_name: string
          p_plan_id: string
        }
        Returns: Json
      }
      financial_upsert_recurring_rule: {
        Args: {
          p_amount?: number
          p_brand?: string
          p_category?: string
          p_description?: string
          p_direction?: string
          p_due_day?: number
          p_ends_on?: string
          p_frequency?: string
          p_is_active?: boolean
          p_name: string
          p_rule_id: string
          p_starts_on?: string
        }
        Returns: Json
      }
      first_access_resend_lookup_service: {
        Args: { p_email: string }
        Returns: {
          company_name: string
          expires_at: string
          full_name: string
          profile_id: string
          recently_sent: boolean
          token: string
          token_status: string
          used_at: string
        }[]
      }
      first_access_state_service: {
        Args: { p_profile_id: string }
        Returns: {
          expires_at: string
          last_validated_at: string
          status: string
          used_at: string
        }[]
      }
      get_admin_user_id: { Args: never; Returns: string }
      get_editorial_approval_preview: {
        Args: { p_file_id: string }
        Returns: {
          content_type: string
          default_caption: string
          objective: string
          plans: Json
          post_id: string
          title: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      horas_resumo: {
        Args: { _mes?: string; _meses?: number; _pessoa?: string }
        Returns: Json
      }
      ia_carteira_recarregar: {
        Args: { _client_id: string; _observacao?: string; _valor_usd: number }
        Returns: number
      }
      ia_chave_cota: {
        Args: { _chave_id: string; _cota_mensal_usd: number }
        Returns: Json
      }
      ia_chave_desativar: { Args: { _chave_id: string }; Returns: Json }
      ia_chave_resolver: {
        Args: { _client_id: string; _provedor: string }
        Returns: Json
      }
      ia_chave_salvar: {
        Args: {
          _chave: string
          _client_id: string
          _cota_mensal_usd?: number
          _provedor: string
          _rotulo?: string
        }
        Returns: Json
      }
      ia_chaves_listar: { Args: { _client_id: string }; Returns: Json }
      ia_cliente_config_salvar: {
        Args: {
          _client_id: string
          _observacao?: string
          _usar_chave_agencia: boolean
        }
        Returns: Json
      }
      ia_consumo_cliente: {
        Args: { _client_id: string; _mes?: string }
        Returns: Json
      }
      ia_modelos_sincronizar: {
        Args: { _completo?: boolean; _modelos: Json; _provedor: string }
        Returns: Json
      }
      ia_registrar_uso: {
        Args: {
          _agente: string
          _chave_id?: string
          _chave_origem?: string
          _client_id: string
          _criado_por?: string
          _custo_fonte?: string
          _custo_usd?: number
          _imagens?: number
          _modelo_id: string
          _provedor: string
          _qualidade?: string
          _referencia_id?: string
          _referencia_tipo?: string
          _tarefa: string
          _tokens_cache?: number
          _tokens_entrada?: number
          _tokens_saida?: number
        }
        Returns: Json
      }
      ia_saldo: { Args: { _client_id: string }; Returns: number }
      idv_brandbook_publico: { Args: { _token: string }; Returns: Json }
      idv_naming_votacao_publica: { Args: { _token: string }; Returns: Json }
      idv_naming_votar_publico: {
        Args: {
          _comentario?: string
          _token: string
          _votante: string
          _votos: Json
        }
        Returns: Json
      }
      inspect_workspace_inbox: { Args: { p_token: string }; Returns: Json }
      is_allowed_mcp_oauth_client: {
        Args: { _client_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      issue_first_access_token: {
        Args: { p_profile_id: string }
        Returns: {
          expires_at: string
          token: string
        }[]
      }
      issue_first_access_token_service: {
        Args: { p_profile_id: string }
        Returns: {
          expires_at: string
          token: string
        }[]
      }
      issue_quiz_invitation: { Args: never; Returns: string }
      issue_quiz_invitation_v2: {
        Args: never
        Returns: {
          expires_at: string
          submission_id: string
          token: string
        }[]
      }
      load_quiz_invitation: {
        Args: { p_token_hash_hex: string }
        Returns: Json
      }
      manage_workspace_inbox_token: {
        Args: { p_action?: string; p_folder_id: string }
        Returns: Json
      }
      mark_workspace_inbox_scan_clean: {
        Args: { p_node_id: string; p_reference?: string }
        Returns: Json
      }
      mesa_agendar_aprovados: { Args: never; Returns: Json }
      mesa_avisar_peca: {
        Args: {
          _chave: string
          _link: string
          _mensagem: string
          _tipo: string
          _trabalho_id: string
        }
        Returns: number
      }
      mesa_config_formato_do_perfil: {
        Args: { _client_id: string; _formato: string }
        Returns: Json
      }
      mesa_config_horario_automatico: {
        Args: { _client_id: string; _ligado: boolean }
        Returns: Json
      }
      mesa_config_salvar: {
        Args: {
          _agendar_ao_aprovar: boolean
          _client_id: string
          _fuso: string
          _hora_publicacao: string
          _laminas_por_post: number
          _posts_por_mes: number
        }
        Returns: Json
      }
      mesa_custos_producao: {
        Args: { _fim?: string; _inicio?: string }
        Returns: Json
      }
      mesa_enviar_para_aprovacao: {
        Args: { _trabalho_ids: string[] }
        Returns: Json
      }
      mesa_escolher_cliente: {
        Args: { _client_id: string; _mesa: string; _modo: string }
        Returns: undefined
      }
      mesa_facebook_token: {
        Args: { _client_id: string }
        Returns: {
          access_token: string
          external_account_id: string
          page_id: string
        }[]
      }
      mesa_fila_desfazer_feito: { Args: { _id: string }; Returns: undefined }
      mesa_fila_marcar_feito: {
        Args: {
          _client_id: string
          _periodo: string
          _quantidade?: number
          _referencia?: string
          _tipo: string
        }
        Returns: Json
      }
      mesa_fila_prioridades: { Args: never; Returns: Json }
      mesa_lamina_citada: { Args: { _texto: string }; Returns: number }
      mesa_melhor_hora: {
        Args: { _client_id: string; _tipo: string }
        Returns: string
      }
      mesa_melhores_horarios: { Args: { _client_id: string }; Returns: Json }
      mesa_previsao_cliente: { Args: { _client_id: string }; Returns: Json }
      mesa_proximo_horario_util: {
        Args: { _agora?: string; _dia: string; _fuso: string; _hora: string }
        Returns: string
      }
      mesa_publicacao_segurada: {
        Args: { _file_id: string; _post_id: string; _scheduled_at: string }
        Returns: boolean
      }
      mesa_storage_acesso: { Args: { _name: string }; Returns: boolean }
      mesa_uuid_estavel: { Args: { _semente: string }; Returns: string }
      meta_ads_connection_status: { Args: never; Returns: Json }
      mig_delete_missing: {
        Args: { _keep: Json; _pkcol: string; _schema: string; _table: string }
        Returns: Json
      }
      mig_digest: {
        Args: { _orderby: string; _schema: string; _table: string }
        Returns: string
      }
      mig_exec: { Args: { _sql: string }; Returns: Json }
      mig_insert_raw: {
        Args: { _rows: Json; _schema: string; _table: string }
        Returns: Json
      }
      mig_query: { Args: { _sql: string }; Returns: Json }
      mig_truncate: { Args: { _schema: string; _table: string }; Returns: Json }
      mig_upsert:
        | {
            Args: {
              _conflict_cols?: string
              _rows: Json
              _schema: string
              _table: string
            }
            Returns: Json
          }
        | {
            Args: {
              _conflict_cols?: string
              _mode?: string
              _rows: Json
              _schema: string
              _table: string
            }
            Returns: Json
          }
      mig_vault_bulk: { Args: { _rows: Json }; Returns: Json }
      mig_vault_create_bulk: { Args: { _rows: Json }; Returns: Json }
      mockup_aplicacao_arquivar: {
        Args: { _arquivar?: boolean; _id: string }
        Returns: {
          arquivado_em: string | null
          atualizado_em: string
          cena_caminho: string | null
          client_id: string
          config: Json
          criado_em: string
          criado_por: string | null
          entrega: Json | null
          file_id: string | null
          id: string
          marca_id: string | null
          mockup_id: string | null
          no_brandbook: boolean
          origem: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "mockup_aplicacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mockup_aplicacao_salvar: {
        Args: {
          _cena_caminho: string
          _client_id: string
          _config: Json
          _file_id?: string
          _id?: string
          _marca_id: string
          _mockup_id: string
          _no_brandbook?: boolean
          _origem: string
        }
        Returns: {
          arquivado_em: string | null
          atualizado_em: string
          cena_caminho: string | null
          client_id: string
          config: Json
          criado_em: string
          criado_por: string | null
          entrega: Json | null
          file_id: string | null
          id: string
          marca_id: string | null
          mockup_id: string | null
          no_brandbook: boolean
          origem: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "mockup_aplicacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      motor_pegar_trabalho: {
        Args: { _executor: string; _mesas?: string[] }
        Returns: {
          atualizado_em: string
          client_id: string
          commit: string | null
          commit_anterior: string | null
          criado_em: string
          criado_por: string | null
          custo_fonte: string | null
          custo_usd: number
          erro: string | null
          estado: string
          estimativa_usd: number | null
          executor: string | null
          id: string
          instrucao: string
          marca_id: string | null
          mesa: string
          modelo: string | null
          parar_pedido_em: string | null
          parar_pedido_por: string | null
          pedido: Json
          pego_em: string | null
          preview_expira_em: string | null
          preview_url: string | null
          projeto: string
          referencia_id: string | null
          referencia_tipo: string | null
          resultado: Json
          terminado_em: string | null
          teto_usd: number
          tipo: string
          uso_id: string | null
          zip_path: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "motor_trabalhos"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      motor_reservado_usd: { Args: { _client_id: string }; Returns: number }
      move_file: {
        Args: { _file_id: string; _folder?: string; _project_id?: string }
        Returns: {
          agency_approval_status: string
          agency_feedback: string | null
          agency_reviewed_at: string | null
          agency_reviewed_by: string | null
          approval_requested_at: string | null
          approval_status: string
          archived_at: string | null
          caption: string | null
          carousel_text: string | null
          client_decided_at: string | null
          client_decided_by: string | null
          client_id: string
          created_at: string
          description: string | null
          extension: string | null
          extracted_metadata: Json | null
          extraction_error: string | null
          extraction_status: string | null
          feedback: string | null
          file_name: string
          file_type: string | null
          file_url: string
          folder: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          mime_type: string | null
          page_count: number | null
          parent_file_id: string | null
          project_id: string | null
          requires_approval: boolean | null
          revision_of_file_id: string | null
          sensitivity: string | null
          sha256: string | null
          sheet_count: number | null
          size_bytes: number | null
          slide_count: number | null
          source: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string
          version: number | null
          visibility: string | null
        }
        SetofOptions: {
          from: "*"
          to: "files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      movimentos_do_cliente: {
        Args: {
          _ate?: string
          _client_id: string
          _desde?: string
          _somente_visiveis?: boolean
        }
        Returns: {
          detalhe: string
          link: string
          origem: string
          quando: string
          ref_id: string
          tipo: string
          titulo: string
          titulo_cliente: string
          visivel_ao_cliente: boolean
        }[]
      }
      nome_do_material: { Args: { _file_name: string }; Returns: string }
      notificacao_merece_email: { Args: { _tipo: string }; Returns: boolean }
      notificacoes_teste_disparar: { Args: never; Returns: Json }
      notificacoes_teste_resultado: {
        Args: { _notification_id: string }
        Returns: Json
      }
      operator_approval_decidir: {
        Args: { _approval_id: string; _decisao: string; _nota?: string }
        Returns: Json
      }
      operator_assign_task: {
        Args: {
          _actor: string
          _kanban_task_id: string
          _note?: string
          _operator_slug: string
        }
        Returns: Json
      }
      operator_cancelar_tarefa: {
        Args: {
          _approval_id: string
          _motivo: string
          _operator_slug: string
          _task_id: string
        }
        Returns: Json
      }
      operator_expire_stale_runs: { Args: never; Returns: number }
      operator_fechar_orfaos: { Args: never; Returns: Json }
      operator_human_action: {
        Args: {
          _link_id: string
          _new_status?: string
          _note?: string
          _resolve_approval?: boolean
        }
        Returns: {
          agent_run_id: string | null
          approval_required: boolean
          block_reason: string | null
          created_at: string
          execution_source: string
          id: string
          kanban_task_id: string | null
          last_action: string | null
          last_evidence: string | null
          next_step: string | null
          operator_id: string
          painel_task_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operator_task_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      operator_maintenance_tick: { Args: never; Returns: Json }
      operator_ordem_executada: {
        Args: {
          _approval_id: string
          _evidence: string
          _operator_slug: string
          _run_key?: string
        }
        Returns: Json
      }
      operator_ordens_abertas: {
        Args: { _operator_slug: string }
        Returns: {
          action_kind: string
          approval_id: string
          aprovada_em: string
          custo_previsto: number
          destino: string
          kanban_task_id: string
          nota_de_quem_aprovou: string
          o_que: string
          payload: Json
          por_que: string
          prazo: string
          reversivel: boolean
          task_link_id: string
          titulo_da_tarefa: string
        }[]
      }
      operator_participar: {
        Args: {
          _attachments?: Json
          _body: string
          _entry_type: string
          _link_id: string
          _operator_slug: string
          _title?: string
        }
        Returns: Json
      }
      operator_pausar: {
        Args: { _motivo?: string; _pausar: boolean; _slug: string }
        Returns: Json
      }
      operator_propor_responsavel: {
        Args: {
          _confianca?: number
          _evidencias?: Json
          _impacto?: string
          _justificativa: string
          _kanban_task_id: string
          _operator_slug: string
          _prazo?: string
          _suggested_assignee: string
        }
        Returns: Json
      }
      operator_reconciliar_vinculos_gemeos: { Args: never; Returns: Json }
      operator_registrar_feito: {
        Args: {
          _approval_id?: string
          _como: string
          _kanban_task_id?: string
          _o_que: string
          _onde_acessar: string
          _onde_documentado?: string
          _operator_slug: string
          _run_key?: string
        }
        Returns: Json
      }
      operator_report_event: {
        Args: {
          _action?: string
          _actor: string
          _approval_required?: boolean
          _attempt?: number
          _block_reason?: string
          _detail?: Json
          _error?: string
          _event: string
          _evidence?: string
          _from_cron?: boolean
          _kanban_task_id?: string
          _next_step?: string
          _operator_slug: string
          _painel_task_id?: string
          _run_key: string
          _timeout_seconds?: number
        }
        Returns: Json
      }
      operator_request_approval: {
        Args: {
          _action_kind: string
          _custo_previsto?: number
          _dados_usados?: string
          _destino?: string
          _evidencia?: string
          _impacto?: string
          _link_id: string
          _o_que: string
          _operator_slug: string
          _payload: Json
          _por_que: string
          _prazo?: string
          _reversivel?: boolean
          _risco?: string
          _valid_until?: string
        }
        Returns: Json
      }
      operator_status_do_card: {
        Args: { _event: string; _status_atual: string; _tem_evidencia: boolean }
        Returns: string
      }
      operator_status_do_run: { Args: { _event: string }; Returns: string }
      operator_update: {
        Args: {
          _actor: string
          _area?: string
          _display_name?: string
          _display_order?: number
          _is_coordinator?: boolean
          _parent_slug?: string
          _role?: string
          _scope?: string
          _slug: string
          _status?: string
        }
        Returns: Json
      }
      perfis_instagram_token: {
        Args: { _client_id: string }
        Returns: {
          access_token: string
          ig_user_id: string
          origem: string
        }[]
      }
      proposta_publica_aceitar: {
        Args: {
          p_email: string
          p_ip: string
          p_nome: string
          p_token: string
          p_user_agent: string
        }
        Returns: Json
      }
      proposta_publica_aceitar_v2: {
        Args: {
          p_email: string
          p_ip: string
          p_nome: string
          p_pacote: string
          p_pagamento: string
          p_token: string
          p_user_agent: string
        }
        Returns: Json
      }
      proposta_publica_evento: {
        Args: {
          p_ip: string
          p_segundos: number
          p_sessao: string
          p_tipo: string
          p_token: string
          p_user_agent: string
        }
        Returns: Json
      }
      proposta_publica_ler: { Args: { p_token: string }; Returns: Json }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_offline_client_approval: {
        Args: {
          p_channel: string
          p_expected_version: number
          p_file_id: string
          p_note?: string
        }
        Returns: string
      }
      release_file_to_client: {
        Args: { p_file_id: string; p_mode: string }
        Returns: {
          agency_approval_status: string
          agency_feedback: string | null
          agency_reviewed_at: string | null
          agency_reviewed_by: string | null
          approval_requested_at: string | null
          approval_status: string
          archived_at: string | null
          caption: string | null
          carousel_text: string | null
          client_decided_at: string | null
          client_decided_by: string | null
          client_id: string
          created_at: string
          description: string | null
          extension: string | null
          extracted_metadata: Json | null
          extraction_error: string | null
          extraction_status: string | null
          feedback: string | null
          file_name: string
          file_type: string | null
          file_url: string
          folder: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          mime_type: string | null
          page_count: number | null
          parent_file_id: string | null
          project_id: string | null
          requires_approval: boolean | null
          revision_of_file_id: string | null
          sensitivity: string | null
          sha256: string | null
          sheet_count: number | null
          size_bytes: number | null
          slide_count: number | null
          source: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string
          version: number | null
          visibility: string | null
        }
        SetofOptions: {
          from: "*"
          to: "files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_first_access_claim: {
        Args: { p_claim_id: string }
        Returns: boolean
      }
      rename_file: {
        Args: { _file_id: string; _new_name: string }
        Returns: {
          agency_approval_status: string
          agency_feedback: string | null
          agency_reviewed_at: string | null
          agency_reviewed_by: string | null
          approval_requested_at: string | null
          approval_status: string
          archived_at: string | null
          caption: string | null
          carousel_text: string | null
          client_decided_at: string | null
          client_decided_by: string | null
          client_id: string
          created_at: string
          description: string | null
          extension: string | null
          extracted_metadata: Json | null
          extraction_error: string | null
          extraction_status: string | null
          feedback: string | null
          file_name: string
          file_type: string | null
          file_url: string
          folder: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          mime_type: string | null
          page_count: number | null
          parent_file_id: string | null
          project_id: string | null
          requires_approval: boolean | null
          revision_of_file_id: string | null
          sensitivity: string | null
          sha256: string | null
          sheet_count: number | null
          size_bytes: number | null
          slide_count: number | null
          source: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string
          version: number | null
          visibility: string | null
        }
        SetofOptions: {
          from: "*"
          to: "files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      render_pedidos_concluir: {
        Args: {
          _arquivo_id: string
          _id: string
          _resultado: Json
          _saida_path: string
          _token: string
        }
        Returns: boolean
      }
      render_pedidos_falhar: {
        Args: {
          _codigo: string
          _id: string
          _mensagem: string
          _token: string
        }
        Returns: boolean
      }
      render_pedidos_pegar: {
        Args: {
          _token: string
          _trava_segundos?: number
          _versao?: string
          _worker: string
        }
        Returns: {
          arquivo_id: string | null
          atualizado_em: string
          client_id: string
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          custo_usd: number
          entrada: Json
          erro_codigo: string | null
          erro_mensagem: string | null
          estado: string
          etapa: string | null
          id: string
          iniciado_em: string | null
          max_tentativas: number
          motion_id: string | null
          progresso: number
          projeto: Json | null
          resultado: Json | null
          revisao: number | null
          saida_path: string | null
          tentativas: number
          tipo: string
          trava_ate: string | null
          trava_token: string | null
          uid: string
          versao_id: string | null
          worker: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "render_pedidos"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      render_pedidos_progresso: {
        Args: {
          _etapa: string
          _id: string
          _progresso: number
          _token: string
          _trava_segundos?: number
        }
        Returns: boolean
      }
      replace_managed_user_role: {
        Args: {
          _actor_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      request_file_agency_review: {
        Args: { p_file_id: string }
        Returns: {
          agency_approval_status: string
          agency_feedback: string | null
          agency_reviewed_at: string | null
          agency_reviewed_by: string | null
          approval_requested_at: string | null
          approval_status: string
          archived_at: string | null
          caption: string | null
          carousel_text: string | null
          client_decided_at: string | null
          client_decided_by: string | null
          client_id: string
          created_at: string
          description: string | null
          extension: string | null
          extracted_metadata: Json | null
          extraction_error: string | null
          extraction_status: string | null
          feedback: string | null
          file_name: string
          file_type: string | null
          file_url: string
          folder: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          mime_type: string | null
          page_count: number | null
          parent_file_id: string | null
          project_id: string | null
          requires_approval: boolean | null
          revision_of_file_id: string | null
          sensitivity: string | null
          sha256: string | null
          sheet_count: number | null
          size_bytes: number | null
          slide_count: number | null
          source: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string
          version: number | null
          visibility: string | null
        }
        SetofOptions: {
          from: "*"
          to: "files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_workspace_inbox_upload: {
        Args: {
          p_extension: string
          p_request_id: string
          p_size_bytes: number
          p_token: string
        }
        Returns: Json
      }
      retry_autopublish: { Args: { p_publication_id: string }; Returns: Json }
      review_file_agency: {
        Args: { p_decision: string; p_feedback?: string; p_file_id: string }
        Returns: {
          agency_approval_status: string
          agency_feedback: string | null
          agency_reviewed_at: string | null
          agency_reviewed_by: string | null
          approval_requested_at: string | null
          approval_status: string
          archived_at: string | null
          caption: string | null
          carousel_text: string | null
          client_decided_at: string | null
          client_decided_by: string | null
          client_id: string
          created_at: string
          description: string | null
          extension: string | null
          extracted_metadata: Json | null
          extraction_error: string | null
          extraction_status: string | null
          feedback: string | null
          file_name: string
          file_type: string | null
          file_url: string
          folder: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          mime_type: string | null
          page_count: number | null
          parent_file_id: string | null
          project_id: string | null
          requires_approval: boolean | null
          revision_of_file_id: string | null
          sensitivity: string | null
          sha256: string | null
          sheet_count: number | null
          size_bytes: number | null
          slide_count: number | null
          source: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string
          version: number | null
          visibility: string | null
        }
        SetofOptions: {
          from: "*"
          to: "files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rotulo_do_material: {
        Args: { _content_type?: string; _file_type: string; _folder?: string }
        Returns: string
      }
      save_approved_editorial_post_unlocked: {
        Args: { p_expected_version?: number; p_payload: Json }
        Returns: Json
      }
      save_editorial_post: {
        Args: { p_expected_version?: number; p_payload: Json }
        Returns: Json
      }
      save_editorial_post_unlocked: {
        Args: { p_expected_version?: number; p_payload: Json }
        Returns: Json
      }
      save_meta_ads_token: {
        Args: { _external_account_id?: string; _label?: string; _token: string }
        Returns: Json
      }
      save_meta_ads_token_from_login:
        | { Args: { _label?: string; _token: string }; Returns: Json }
        | {
            Args: {
              _contas: string[]
              _label: string
              _meta_user_id: string
              _token: string
            }
            Returns: Json
          }
      save_quiz_invitation: {
        Args: { p_responses: Json; p_token_hash_hex: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      site_registrar_lead: {
        Args: {
          _chave: string
          _email: string
          _empresa: string
          _ip_hash: string
          _mensagem: string
          _nome: string
          _pagina: string
          _spam_motivo?: string
          _whatsapp: string
        }
        Returns: Json
      }
      social_meta_connect_resource: {
        Args: {
          _candidate_id: string
          _client_id: string
          _oauth_session_id: string
          _project_id: string
        }
        Returns: Json
      }
      social_meta_disconnect_account: {
        Args: { _external_account_id: string }
        Returns: Json
      }
      social_meta_oauth_consume_session: {
        Args: { _state: string }
        Returns: Json
      }
      social_meta_oauth_create_session: {
        Args: { _client_id: string; _project_id: string; _redirect_uri: string }
        Returns: Json
      }
      social_meta_oauth_finish_session: {
        Args: {
          _client_id: string
          _oauth_session_id: string
          _project_id: string
        }
        Returns: Json
      }
      social_meta_oauth_register_redirect_uri: {
        Args: { _redirect_uri: string }
        Returns: undefined
      }
      social_meta_oauth_store_resources: {
        Args: {
          _actor_id: string
          _data_access_expires_at: string
          _declined_scopes: string[]
          _granted_scopes: string[]
          _graph_version: string
          _meta_user_id: string
          _oauth_session_id: string
          _resources: Json
          _user_access_token: string
          _user_access_token_expires_at: string
        }
        Returns: Json
      }
      social_metrics_ciclo: { Args: never; Returns: Json }
      social_metrics_tick: { Args: never; Returns: Json }
      social_retrato_da_semana_corrente: { Args: never; Returns: Json }
      storage_client_from_path: { Args: { _name: string }; Returns: string }
      storage_object_read_allowed: {
        Args: { _bucket: string; _name: string }
        Returns: boolean
      }
      storage_object_write_allowed: {
        Args: { _bucket: string; _name: string }
        Returns: boolean
      }
      submit_quiz_invitation: {
        Args: {
          p_plan: string
          p_responses: Json
          p_score: number
          p_token_hash_hex: string
        }
        Returns: Json
      }
      tempo_de_trabalho_registrar: {
        Args: {
          _client_id: string
          _fim: string
          _id: string
          _inicio: string
          _rota: string
          _segundos: number
          _versao: number
        }
        Returns: Json
      }
      tempo_de_trabalho_total: {
        Args: { _client_id: string; _desde?: string; _excluir?: string }
        Returns: number
      }
      transition_editorial_publication: {
        Args: {
          p_action: string
          p_expected_version: number
          p_external_post_id?: string
          p_failure_code?: string
          p_failure_reason?: string
          p_permalink?: string
          p_publication_id: string
          p_published_at?: string
          p_scheduled_at?: string
          p_timezone?: string
        }
        Returns: Json
      }
      transition_editorial_publication_unlocked: {
        Args: {
          p_action: string
          p_expected_version: number
          p_external_post_id?: string
          p_failure_code?: string
          p_failure_reason?: string
          p_permalink?: string
          p_publication_id: string
          p_published_at?: string
          p_scheduled_at?: string
          p_timezone?: string
        }
        Returns: Json
      }
      try_uuid: { Args: { _value: string }; Returns: string }
      upsert_current_dossier: {
        Args: {
          _actor?: string
          _change_reason?: string
          _client_id: string
          _content: string
          _correlation_id?: string
          _dossier_type?: string
          _expected_version?: number
          _idempotency_key?: string
          _metadata?: Json
          _project_id?: string
          _source?: string
          _summary?: string
          _tags?: string[]
        }
        Returns: {
          actor: string | null
          change_reason: string | null
          client_id: string
          content: string
          correlation_id: string | null
          created_at: string
          dossier_type: string
          effective_at: string
          id: string
          idempotency_key: string | null
          is_current: boolean
          metadata: Json
          prior_version_id: string | null
          project_id: string | null
          source: string | null
          summary: string | null
          superseded_at: string | null
          superseded_by: string | null
          tags: string[]
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "client_dossiers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_owns_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      user_owns_task: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      validate_api_key: {
        Args: { _key_hash: string }
        Returns: {
          id: string
          name: string
          origin: string
          scopes: string[]
        }[]
      }
      validate_api_key_for_audience: {
        Args: { _audience: string; _key_hash: string }
        Returns: {
          audience: string
          client_ids: string[]
          client_scope_mode: string
          created_by: string
          id: string
          name: string
          origin: string
          owner_is_admin: boolean
          scopes: string[]
        }[]
      }
      validate_first_access_token: {
        Args: { p_token_hash_hex: string }
        Returns: {
          email: string
          expires_at: string
          profile_id: string
          status: string
        }[]
      }
      workspace_storage_object_is_releasable: {
        Args: { _name: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "client" | "design" | "traffic" | "manager"
      brand_type: "aceleriq" | "sitebolt"
      client_type: "recurring" | "one_off" | "hybrid"
      project_billing_mode: "included" | "one_off"
      workspace_kind: "folder" | "file"
      workspace_scope: "global" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "client", "design", "traffic", "manager"],
      brand_type: ["aceleriq", "sitebolt"],
      client_type: ["recurring", "one_off", "hybrid"],
      project_billing_mode: ["included", "one_off"],
      workspace_kind: ["folder", "file"],
      workspace_scope: ["global", "client"],
    },
  },
} as const
