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
      action_results: {
        Row: {
          action_id: string
          after_metrics: Json
          before_metrics: Json
          confidence: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          delta: Json
          estimated_impact_eur: number | null
          id: string
          measured_at: string
          store_id: string
          summary: string | null
          window_days: number
        }
        Insert: {
          action_id: string
          after_metrics?: Json
          before_metrics?: Json
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          delta?: Json
          estimated_impact_eur?: number | null
          id?: string
          measured_at?: string
          store_id: string
          summary?: string | null
          window_days?: number
        }
        Update: {
          action_id?: string
          after_metrics?: Json
          before_metrics?: Json
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          delta?: Json
          estimated_impact_eur?: number | null
          id?: string
          measured_at?: string
          store_id?: string
          summary?: string | null
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "action_results_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_results_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      actions: {
        Row: {
          actor: Database["public"]["Enums"]["action_actor"]
          after_value: Json | null
          applied_at: string | null
          before_value: Json | null
          channel: Database["public"]["Enums"]["action_channel"]
          created_at: string
          error_message: string | null
          finding_id: string | null
          id: string
          payload: Json
          reason: string | null
          reverted_at: string | null
          revertible: boolean
          status: Database["public"]["Enums"]["action_status"]
          store_id: string
          target_label: string | null
          target_ref: string | null
          title: string
          tool_name: string
          updated_at: string
        }
        Insert: {
          actor?: Database["public"]["Enums"]["action_actor"]
          after_value?: Json | null
          applied_at?: string | null
          before_value?: Json | null
          channel: Database["public"]["Enums"]["action_channel"]
          created_at?: string
          error_message?: string | null
          finding_id?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          reverted_at?: string | null
          revertible?: boolean
          status?: Database["public"]["Enums"]["action_status"]
          store_id: string
          target_label?: string | null
          target_ref?: string | null
          title: string
          tool_name: string
          updated_at?: string
        }
        Update: {
          actor?: Database["public"]["Enums"]["action_actor"]
          after_value?: Json | null
          applied_at?: string | null
          before_value?: Json | null
          channel?: Database["public"]["Enums"]["action_channel"]
          created_at?: string
          error_message?: string | null
          finding_id?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          reverted_at?: string | null
          revertible?: boolean
          status?: Database["public"]["Enums"]["action_status"]
          store_id?: string
          target_label?: string | null
          target_ref?: string | null
          title?: string
          tool_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "actions_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "audit_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_findings: {
        Row: {
          action_steps: Json
          applied_at: string | null
          applied_result: Json | null
          audit_id: string
          auto_correction: Json | null
          blocks_count: number
          caused_by: Json
          chain_depth: number
          epistemic_level: string | null
          finding_key: string | null
          priority_band: string | null
          priority_reason: string | null
          category: Database["public"]["Enums"]["finding_category"]
          confidence: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          difficulty: number
          estimated_gain_max: number | null
          estimated_gain_min: number | null
          evidence: Json
          history_action: string | null
          history_note: string | null
          id: string
          impact_description: string | null
          priority_score: number
          root_cause: string | null
          severity: Database["public"]["Enums"]["finding_severity"]
          sort_order: number
          status: Database["public"]["Enums"]["finding_status"]
          time_minutes: number
          timeframe: Database["public"]["Enums"]["finding_timeframe"]
          title: string
          updated_at: string
        }
        Insert: {
          action_steps?: Json
          applied_at?: string | null
          applied_result?: Json | null
          audit_id: string
          auto_correction?: Json | null
          blocks_count?: number
          caused_by?: Json
          chain_depth?: number
          epistemic_level?: string | null
          finding_key?: string | null
          priority_band?: string | null
          priority_reason?: string | null
          category: Database["public"]["Enums"]["finding_category"]
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          difficulty?: number
          estimated_gain_max?: number | null
          estimated_gain_min?: number | null
          evidence?: Json
          history_action?: string | null
          history_note?: string | null
          id?: string
          impact_description?: string | null
          priority_score?: number
          root_cause?: string | null
          severity: Database["public"]["Enums"]["finding_severity"]
          sort_order?: number
          status?: Database["public"]["Enums"]["finding_status"]
          time_minutes?: number
          timeframe?: Database["public"]["Enums"]["finding_timeframe"]
          title: string
          updated_at?: string
        }
        Update: {
          action_steps?: Json
          applied_at?: string | null
          applied_result?: Json | null
          audit_id?: string
          auto_correction?: Json | null
          blocks_count?: number
          caused_by?: Json
          chain_depth?: number
          epistemic_level?: string | null
          finding_key?: string | null
          priority_band?: string | null
          priority_reason?: string | null
          category?: Database["public"]["Enums"]["finding_category"]
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          difficulty?: number
          estimated_gain_max?: number | null
          estimated_gain_min?: number | null
          evidence?: Json
          history_action?: string | null
          history_note?: string | null
          id?: string
          impact_description?: string | null
          priority_score?: number
          root_cause?: string | null
          severity?: Database["public"]["Enums"]["finding_severity"]
          sort_order?: number
          status?: Database["public"]["Enums"]["finding_status"]
          time_minutes?: number
          timeframe?: Database["public"]["Enums"]["finding_timeframe"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_findings_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
        ]
      }
      audits: {
        Row: {
          audit_type: Database["public"]["Enums"]["audit_type"]
          category_scores: Json
          completed_at: string | null
          cross_signals: Json | null
          data_gaps: Json | null
          funnel: Json | null
          created_at: string
          created_by: string
          error_message: string | null
          id: string
          input_snapshot: Json | null
          potential_gain_max: number | null
          potential_gain_min: number | null
          score: number | null
          status: Database["public"]["Enums"]["audit_status"]
          store_id: string
          summary: string | null
          updated_at: string
          verdict: string | null
        }
        Insert: {
          audit_type?: Database["public"]["Enums"]["audit_type"]
          category_scores?: Json
          completed_at?: string | null
          cross_signals?: Json | null
          data_gaps?: Json | null
          funnel?: Json | null
          created_at?: string
          created_by: string
          error_message?: string | null
          id?: string
          input_snapshot?: Json | null
          potential_gain_max?: number | null
          potential_gain_min?: number | null
          score?: number | null
          status?: Database["public"]["Enums"]["audit_status"]
          store_id: string
          summary?: string | null
          updated_at?: string
          verdict?: string | null
        }
        Update: {
          audit_type?: Database["public"]["Enums"]["audit_type"]
          category_scores?: Json
          completed_at?: string | null
          cross_signals?: Json | null
          data_gaps?: Json | null
          funnel?: Json | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          input_snapshot?: Json | null
          potential_gain_max?: number | null
          potential_gain_min?: number | null
          score?: number | null
          status?: Database["public"]["Enums"]["audit_status"]
          store_id?: string
          summary?: string | null
          updated_at?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audits_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_conversations: {
        Row: {
          created_at: string
          id: string
          store_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          store_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          store_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_conversations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "coach_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_connections: {
        Row: {
          access_token_ciphertext: string | null
          account_id: string | null
          account_label: string | null
          connected_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          last_error: string | null
          metadata: Json
          provider: Database["public"]["Enums"]["data_provider"]
          refresh_token_ciphertext: string | null
          scope: string | null
          status: Database["public"]["Enums"]["data_connection_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          access_token_ciphertext?: string | null
          account_id?: string | null
          account_label?: string | null
          connected_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_error?: string | null
          metadata?: Json
          provider: Database["public"]["Enums"]["data_provider"]
          refresh_token_ciphertext?: string | null
          scope?: string | null
          status?: Database["public"]["Enums"]["data_connection_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          access_token_ciphertext?: string | null
          account_id?: string | null
          account_label?: string | null
          connected_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_error?: string | null
          metadata?: Json
          provider?: Database["public"]["Enums"]["data_provider"]
          refresh_token_ciphertext?: string | null
          scope?: string | null
          status?: Database["public"]["Enums"]["data_connection_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_connections_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      data_snapshots: {
        Row: {
          created_at: string
          error_message: string | null
          fetched_at: string
          id: string
          kind: Database["public"]["Enums"]["snapshot_kind"]
          partial: boolean
          payload: Json
          period_days: number
          store_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          fetched_at?: string
          id?: string
          kind: Database["public"]["Enums"]["snapshot_kind"]
          partial?: boolean
          payload?: Json
          period_days?: number
          store_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          fetched_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["snapshot_kind"]
          partial?: boolean
          payload?: Json
          period_days?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_snapshots_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      fix_attempts: {
        Row: {
          applied_at: string
          category: string | null
          created_at: string
          finding_id: string | null
          finding_key: string | null
          headline: string | null
          id: string
          measured_at: string | null
          rollback_possible: boolean
          rollback_recommended: boolean
          settled_at: string | null
          signature: string
          store_id: string
          title: string
          tool_name: string | null
          updated_at: string
          verdict: string | null
        }
        Insert: {
          applied_at?: string
          category?: string | null
          created_at?: string
          finding_id?: string | null
          finding_key?: string | null
          headline?: string | null
          id?: string
          measured_at?: string | null
          rollback_possible?: boolean
          rollback_recommended?: boolean
          settled_at?: string | null
          signature: string
          store_id: string
          title: string
          tool_name?: string | null
          updated_at?: string
          verdict?: string | null
        }
        Update: {
          applied_at?: string
          category?: string | null
          created_at?: string
          finding_id?: string | null
          finding_key?: string | null
          headline?: string | null
          id?: string
          measured_at?: string | null
          rollback_possible?: boolean
          rollback_recommended?: boolean
          settled_at?: string | null
          signature?: string
          store_id?: string
          title?: string
          tool_name?: string | null
          updated_at?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fix_attempts_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "audit_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fix_attempts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      fix_outcomes: {
        Row: {
          alert_message: string | null
          action_id: string | null
          coverage: number | null
          drivers: Json
          explanation: string | null
          guards: Json
          headline: string | null
          measured_days: number | null
          rollback_possible: boolean
          rollback_reason: string | null
          rollback_recommended: boolean
          tool_name: string | null
          verdict: string | null
          applied_at: string
          baseline: Json
          checked_at: string | null
          created_at: string
          delta: Json | null
          expected_gain_max: number | null
          expected_gain_min: number | null
          finding_id: string
          id: string
          latest: Json | null
          status: Database["public"]["Enums"]["tracking_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          alert_message?: string | null
          action_id?: string | null
          coverage?: number | null
          drivers?: Json
          explanation?: string | null
          guards?: Json
          headline?: string | null
          measured_days?: number | null
          rollback_possible?: boolean
          rollback_reason?: string | null
          rollback_recommended?: boolean
          tool_name?: string | null
          verdict?: string | null
          applied_at?: string
          baseline?: Json
          checked_at?: string | null
          created_at?: string
          delta?: Json | null
          expected_gain_max?: number | null
          expected_gain_min?: number | null
          finding_id: string
          id?: string
          latest?: Json | null
          status?: Database["public"]["Enums"]["tracking_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          alert_message?: string | null
          action_id?: string | null
          coverage?: number | null
          drivers?: Json
          explanation?: string | null
          guards?: Json
          headline?: string | null
          measured_days?: number | null
          rollback_possible?: boolean
          rollback_reason?: string | null
          rollback_recommended?: boolean
          tool_name?: string | null
          verdict?: string | null
          applied_at?: string
          baseline?: Json
          checked_at?: string | null
          created_at?: string
          delta?: Json | null
          expected_gain_max?: number | null
          expected_gain_min?: number | null
          finding_id?: string
          id?: string
          latest?: Json | null
          status?: Database["public"]["Enums"]["tracking_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fix_outcomes_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: true
            referencedRelation: "audit_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fix_outcomes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          achieved: boolean
          achieved_at: string | null
          created_at: string
          id: string
          label: string
          store_id: string
          target_date: string | null
          target_revenue: number | null
          updated_at: string
        }
        Insert: {
          achieved?: boolean
          achieved_at?: string | null
          created_at?: string
          id?: string
          label: string
          store_id: string
          target_date?: string | null
          target_revenue?: number | null
          updated_at?: string
        }
        Update: {
          achieved?: boolean
          achieved_at?: string | null
          created_at?: string
          id?: string
          label?: string
          store_id?: string
          target_date?: string | null
          target_revenue?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_href: string | null
          action_label: string | null
          body: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          read_at: string | null
          severity: Database["public"]["Enums"]["finding_severity"]
          store_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          action_href?: string | null
          action_label?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          read_at?: string | null
          severity?: Database["public"]["Enums"]["finding_severity"]
          store_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          action_href?: string | null
          action_label?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          read_at?: string | null
          severity?: Database["public"]["Enums"]["finding_severity"]
          store_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          experience_level: Database["public"]["Enums"]["experience_level"]
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          experience_level?: Database["public"]["Enums"]["experience_level"]
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          experience_level?: Database["public"]["Enums"]["experience_level"]
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stores: {
        Row: {
          avg_product_cost_ratio: number | null
          created_at: string
          currency: string
          fixed_costs_monthly: number | null
          goal: string | null
          id: string
          monthly_ad_budget: number | null
          monthly_revenue: number | null
          name: string
          niche: string | null
          owner_id: string
          revenue_goal: number | null
          situation: Database["public"]["Enums"]["store_situation"] | null
          reaudit_checked_at: string | null
          reaudit_launched_at: string | null
          reaudit_prompted_at: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          avg_product_cost_ratio?: number | null
          created_at?: string
          currency?: string
          fixed_costs_monthly?: number | null
          goal?: string | null
          id?: string
          monthly_ad_budget?: number | null
          monthly_revenue?: number | null
          name: string
          niche?: string | null
          owner_id: string
          revenue_goal?: number | null
          situation?: Database["public"]["Enums"]["store_situation"] | null
          reaudit_checked_at?: string | null
          reaudit_launched_at?: string | null
          reaudit_prompted_at?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          avg_product_cost_ratio?: number | null
          created_at?: string
          currency?: string
          fixed_costs_monthly?: number | null
          goal?: string | null
          id?: string
          monthly_ad_budget?: number | null
          monthly_revenue?: number | null
          name?: string
          niche?: string | null
          owner_id?: string
          revenue_goal?: number | null
          situation?: Database["public"]["Enums"]["store_situation"] | null
          reaudit_checked_at?: string | null
          reaudit_launched_at?: string | null
          reaudit_prompted_at?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          provider: string | null
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          tier: Database["public"]["Enums"]["plan_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          tier?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          tier?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          finding_id: string | null
          how_to: string | null
          id: string
          sort_order: number
          status: Database["public"]["Enums"]["task_status"]
          store_id: string
          title: string
          updated_at: string
          week_number: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          finding_id?: string | null
          how_to?: string | null
          id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["task_status"]
          store_id: string
          title: string
          updated_at?: string
          week_number?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          finding_id?: string | null
          how_to?: string | null
          id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["task_status"]
          store_id?: string
          title?: string
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "tasks_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "audit_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      usage: {
        Row: {
          audits_used: number
          coach_messages_used: number
          created_at: string
          fixes_used: number
          id: string
          period_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audits_used?: number
          coach_messages_used?: number
          created_at?: string
          fixes_used?: number
          id?: string
          period_start?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audits_used?: number
          coach_messages_used?: number
          created_at?: string
          fixes_used?: number
          id?: string
          period_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      action_actor: "ai" | "user"
      action_channel:
        | "shopify"
        | "meta_ads"
        | "google_ads"
        | "ga4"
        | "tiktok_ads"
        | "klaviyo"
        | "manual"
      action_status: "proposed" | "applied" | "failed" | "reverted"
      audit_status: "running" | "completed" | "failed"
      audit_type: "initial" | "daily" | "weekly" | "monthly"
      confidence_level: "low" | "medium" | "high"
      data_connection_status:
        | "pending"
        | "active"
        | "expired"
        | "revoked"
        | "error"
      data_provider: "shopify" | "meta_ads" | "google_ads" | "ga4"
      experience_level: "debutant" | "intermediaire" | "avance"
      finding_category:
        | "offre"
        | "produit"
        | "boutique"
        | "conversion"
        | "acquisition"
        | "retention"
        | "rentabilite"
        | "operations"
      finding_severity: "critical" | "high" | "medium" | "low"
      finding_status: "todo" | "in_progress" | "done"
      finding_timeframe: "today" | "this_week" | "this_month"
      notification_kind: "alert" | "insight" | "digest" | "system"
      plan_tier: "free" | "pro"
      snapshot_kind:
        | "shopify"
        | "meta_ads"
        | "google_ads"
        | "ga4"
        | "tiktok_ads"
        | "klaviyo"
        | "composite"
      store_situation: "no_sales" | "few_sales" | "plateau" | "not_profitable"
      task_status: "todo" | "done" | "skipped"
      tracking_status:
        | "measuring"
        | "on_track"
        | "underperforming"
        | "regressed"
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
      action_actor: ["ai", "user"],
      action_channel: [
        "shopify",
        "meta_ads",
        "google_ads",
        "ga4",
        "tiktok_ads",
        "klaviyo",
        "manual",
      ],
      action_status: ["proposed", "applied", "failed", "reverted"],
      audit_status: ["running", "completed", "failed"],
      audit_type: ["initial", "daily", "weekly", "monthly"],
      confidence_level: ["low", "medium", "high"],
      data_connection_status: [
        "pending",
        "active",
        "expired",
        "revoked",
        "error",
      ],
      data_provider: ["shopify", "meta_ads", "google_ads", "ga4"],
      experience_level: ["debutant", "intermediaire", "avance"],
      finding_category: [
        "offre",
        "produit",
        "boutique",
        "conversion",
        "acquisition",
        "retention",
        "rentabilite",
        "operations",
      ],
      finding_severity: ["critical", "high", "medium", "low"],
      finding_status: ["todo", "in_progress", "done"],
      finding_timeframe: ["today", "this_week", "this_month"],
      notification_kind: ["alert", "insight", "digest", "system"],
      plan_tier: ["free", "pro"],
      snapshot_kind: [
        "shopify",
        "meta_ads",
        "google_ads",
        "ga4",
        "tiktok_ads",
        "klaviyo",
        "composite",
      ],
      store_situation: ["no_sales", "few_sales", "plateau", "not_profitable"],
      task_status: ["todo", "done", "skipped"],
      tracking_status: [
        "measuring",
        "on_track",
        "underperforming",
        "regressed",
      ],
    },
  },
} as const
