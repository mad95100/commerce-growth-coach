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
      audit_findings: {
        Row: {
          action_steps: Json
          applied_at: string | null
          applied_result: Json | null
          audit_id: string
          auto_correction: Json | null
          category: Database["public"]["Enums"]["finding_category"]
          created_at: string
          estimated_gain_max: number | null
          estimated_gain_min: number | null
          id: string
          impact_description: string | null
          root_cause: string | null
          severity: Database["public"]["Enums"]["finding_severity"]
          sort_order: number
          status: Database["public"]["Enums"]["finding_status"]
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
          category: Database["public"]["Enums"]["finding_category"]
          created_at?: string
          estimated_gain_max?: number | null
          estimated_gain_min?: number | null
          id?: string
          impact_description?: string | null
          root_cause?: string | null
          severity: Database["public"]["Enums"]["finding_severity"]
          sort_order?: number
          status?: Database["public"]["Enums"]["finding_status"]
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
          category?: Database["public"]["Enums"]["finding_category"]
          created_at?: string
          estimated_gain_max?: number | null
          estimated_gain_min?: number | null
          id?: string
          impact_description?: string | null
          root_cause?: string | null
          severity?: Database["public"]["Enums"]["finding_severity"]
          sort_order?: number
          status?: Database["public"]["Enums"]["finding_status"]
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
          completed_at: string | null
          created_at: string
          created_by: string
          error_message: string | null
          id: string
          input_snapshot: Json | null
          score: number | null
          status: Database["public"]["Enums"]["audit_status"]
          store_id: string
          summary: string | null
          updated_at: string
          verdict: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          error_message?: string | null
          id?: string
          input_snapshot?: Json | null
          score?: number | null
          status?: Database["public"]["Enums"]["audit_status"]
          store_id: string
          summary?: string | null
          updated_at?: string
          verdict?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          input_snapshot?: Json | null
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
      fix_outcomes: {
        Row: {
          alert_message: string | null
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
          created_at: string
          currency: string
          goal: string | null
          id: string
          monthly_ad_budget: number | null
          monthly_revenue: number | null
          name: string
          niche: string | null
          owner_id: string
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          goal?: string | null
          id?: string
          monthly_ad_budget?: number | null
          monthly_revenue?: number | null
          name: string
          niche?: string | null
          owner_id: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          goal?: string | null
          id?: string
          monthly_ad_budget?: number | null
          monthly_revenue?: number | null
          name?: string
          niche?: string | null
          owner_id?: string
          updated_at?: string
          url?: string | null
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
      audit_status: "running" | "completed" | "failed"
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
      audit_status: ["running", "completed", "failed"],
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
      tracking_status: [
        "measuring",
        "on_track",
        "underperforming",
        "regressed",
      ],
    },
  },
} as const
