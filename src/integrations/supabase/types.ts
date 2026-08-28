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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      ads_campaign_daily: {
        Row: {
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
      briefings: {
        Row: {
          client_id: string | null
          created_at: string | null
          id: string
          project_id: string | null
          required: boolean | null
          responses: Json | null
          submitted: boolean | null
          token: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          project_id?: string | null
          required?: boolean | null
          responses?: Json | null
          submitted?: boolean | null
          token?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          project_id?: string | null
          required?: boolean | null
          responses?: Json | null
          submitted?: boolean | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
          archived_at: string | null
          city: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string | null
          segment: string | null
          site: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          city?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          owner_id?: string | null
          segment?: string | null
          site?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          city?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string | null
          segment?: string | null
          site?: string | null
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
      contracts: {
        Row: {
          admin_signature_ip: string | null
          admin_signature_name: string | null
          admin_signed_at: string | null
          client_id: string
          client_signature_ip: string | null
          client_signature_name: string | null
          client_signed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          file_id: string | null
          id: string
          original_file_name: string
          original_file_url: string
          project_id: string | null
          sent_at: string | null
          sign_token: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          admin_signature_ip?: string | null
          admin_signature_name?: string | null
          admin_signed_at?: string | null
          client_id: string
          client_signature_ip?: string | null
          client_signature_name?: string | null
          client_signed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_id?: string | null
          id?: string
          original_file_name: string
          original_file_url: string
          project_id?: string | null
          sent_at?: string | null
          sign_token?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          admin_signature_ip?: string | null
          admin_signature_name?: string | null
          admin_signed_at?: string | null
          client_id?: string
          client_signature_ip?: string | null
          client_signature_name?: string | null
          client_signed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_id?: string | null
          id?: string
          original_file_name?: string
          original_file_url?: string
          project_id?: string | null
          sent_at?: string | null
          sign_token?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
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
          payment_method?: string | null
          recurrence?: string
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Relationships: []
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
      notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          message: string
          notification_type: string
          read: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          message: string
          notification_type: string
          read?: boolean
          user_id: string
        }
        Update: {
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
          client_id: string
          done_at: string
          done_by: string | null
          id: string
          step: number
          week_start: string
        }
        Insert: {
          area: string
          client_id: string
          done_at?: string
          done_by?: string | null
          id?: string
          step: number
          week_start: string
        }
        Update: {
          area?: string
          client_id?: string
          done_at?: string
          done_by?: string | null
          id?: string
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
      admin_release_file_now: {
        Args: { p_file_id: string; p_mode: string }
        Returns: undefined
      }
      ads_metrics_tick: { Args: never; Returns: Json }
      archive_editorial_post: {
        Args: { p_expected_version: number; p_post_id: string }
        Returns: Json
      }
      archive_editorial_post_unlocked: {
        Args: { p_expected_version: number; p_post_id: string }
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
      briefing_public_get: {
        Args: { _token: string }
        Returns: {
          id: string
          responses: Json
          submitted: boolean
        }[]
      }
      briefing_public_submit: {
        Args: { _responses: Json; _token: string }
        Returns: boolean
      }
      can_access_client: { Args: { _client_id: string }; Returns: boolean }
      can_client_read_file: { Args: { _file_id: string }; Returns: boolean }
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
      editorial_autopublish_tick: { Args: never; Returns: Json }
      editorial_can_publish_client: {
        Args: { _client_id: string }
        Returns: boolean
      }
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
      editorial_lock_task_sync: { Args: never; Returns: undefined }
      editorial_production_status_for_task: {
        Args: { _task_status: string }
        Returns: string
      }
      editorial_reconcile_task_delivery_types: { Args: never; Returns: number }
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
      meta_ads_connection_status: { Args: never; Returns: Json }
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
      operator_expire_stale_runs: { Args: never; Returns: number }
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
      save_quiz_invitation: {
        Args: { p_responses: Json; p_token_hash_hex: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
      social_metrics_tick: { Args: never; Returns: Json }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
