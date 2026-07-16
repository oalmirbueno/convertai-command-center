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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
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
          approval_status: string
          archived_at: string | null
          caption: string | null
          carousel_text: string | null
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
          mime_type: string | null
          page_count: number | null
          parent_file_id: string | null
          project_id: string | null
          requires_approval: boolean | null
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
          approval_status?: string
          archived_at?: string | null
          caption?: string | null
          carousel_text?: string | null
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
          mime_type?: string | null
          page_count?: number | null
          parent_file_id?: string | null
          project_id?: string | null
          requires_approval?: boolean | null
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
          approval_status?: string
          archived_at?: string | null
          caption?: string | null
          carousel_text?: string | null
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
          mime_type?: string | null
          page_count?: number | null
          parent_file_id?: string | null
          project_id?: string | null
          requires_approval?: boolean | null
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
            foreignKeyName: "files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          ai_readiness: string | null
          created_at: string | null
          differential: string | null
          goals_12m: string | null
          icp: string | null
          icp_fit_score: number | null
          id: string
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
          ai_readiness?: string | null
          created_at?: string | null
          differential?: string | null
          goals_12m?: string | null
          icp?: string | null
          icp_fit_score?: number | null
          id?: string
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
          ai_readiness?: string | null
          created_at?: string | null
          differential?: string | null
          goals_12m?: string | null
          icp?: string | null
          icp_fit_score?: number | null
          id?: string
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
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          deleted_at?: string | null
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
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          deleted_at?: string | null
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
          created_at: string
          id: string
          message: string
          project_id: string
          update_type: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          message: string
          project_id: string
          update_type: string
        }
        Update: {
          author_id?: string
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
      workspace_nodes: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          duration_sec: number | null
          id: string
          inbox_token: string | null
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
          inbox_token?: string | null
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
          inbox_token?: string | null
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
      [_ in never]: never
    }
    Functions: {
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
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_admin_user_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
