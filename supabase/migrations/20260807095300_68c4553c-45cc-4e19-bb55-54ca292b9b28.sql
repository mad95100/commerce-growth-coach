-- === ENUMS ===
CREATE TYPE public.store_situation AS ENUM ('no_sales','few_sales','plateau','not_profitable');
CREATE TYPE public.audit_type AS ENUM ('initial','daily','weekly','monthly');
CREATE TYPE public.action_channel AS ENUM ('shopify','meta_ads','google_ads','ga4','tiktok_ads','klaviyo','manual');
CREATE TYPE public.action_status AS ENUM ('proposed','applied','failed','reverted');
CREATE TYPE public.action_actor AS ENUM ('ai','user');
CREATE TYPE public.task_status AS ENUM ('todo','done','skipped');
CREATE TYPE public.notification_kind AS ENUM ('alert','insight','digest','system');
CREATE TYPE public.plan_tier AS ENUM ('free','pro');
CREATE TYPE public.snapshot_kind AS ENUM ('shopify','meta_ads','google_ads','ga4','tiktok_ads','klaviyo','composite');
CREATE TYPE public.confidence_level AS ENUM ('low','medium','high');

-- === EXTENSIONS DE TABLES EXISTANTES ===
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS situation public.store_situation,
  ADD COLUMN IF NOT EXISTS revenue_goal numeric,
  ADD COLUMN IF NOT EXISTS avg_product_cost_ratio numeric,
  ADD COLUMN IF NOT EXISTS fixed_costs_monthly numeric;

ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS audit_type public.audit_type NOT NULL DEFAULT 'initial',
  ADD COLUMN IF NOT EXISTS category_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS potential_gain_min numeric,
  ADD COLUMN IF NOT EXISTS potential_gain_max numeric;

ALTER TABLE public.audit_findings
  ADD COLUMN IF NOT EXISTS difficulty smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS time_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS confidence public.confidence_level NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS priority_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

-- === SNAPSHOTS ===
CREATE TABLE public.data_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  kind public.snapshot_kind NOT NULL,
  period_days integer NOT NULL DEFAULT 30,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  partial boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_data_snapshots_store_kind ON public.data_snapshots (store_id, kind, fetched_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_snapshots TO authenticated;
GRANT ALL ON public.data_snapshots TO service_role;
ALTER TABLE public.data_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY snapshots_owner_all ON public.data_snapshots FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));

-- === HISTORIQUE DES ACTIONS ===
CREATE TABLE public.actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  finding_id uuid REFERENCES public.audit_findings(id) ON DELETE SET NULL,
  channel public.action_channel NOT NULL,
  actor public.action_actor NOT NULL DEFAULT 'ai',
  status public.action_status NOT NULL DEFAULT 'proposed',
  tool_name text NOT NULL,
  title text NOT NULL,
  reason text,
  target_ref text,
  target_label text,
  before_value jsonb,
  after_value jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  revertible boolean NOT NULL DEFAULT false,
  reverted_at timestamptz,
  error_message text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_actions_store ON public.actions (store_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.actions TO authenticated;
GRANT ALL ON public.actions TO service_role;
ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY actions_owner_all ON public.actions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
CREATE TRIGGER trg_actions_updated_at BEFORE UPDATE ON public.actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.action_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.actions(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  measured_at timestamptz NOT NULL DEFAULT now(),
  window_days integer NOT NULL DEFAULT 7,
  before_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_impact_eur numeric,
  confidence public.confidence_level NOT NULL DEFAULT 'low',
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_action_results_action ON public.action_results (action_id, measured_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_results TO authenticated;
GRANT ALL ON public.action_results TO service_role;
ALTER TABLE public.action_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY action_results_owner_all ON public.action_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));

-- === PLAN D'ACTION / OBJECTIFS ===
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  finding_id uuid REFERENCES public.audit_findings(id) ON DELETE SET NULL,
  week_number smallint NOT NULL DEFAULT 1,
  title text NOT NULL,
  description text,
  how_to text,
  status public.task_status NOT NULL DEFAULT 'todo',
  sort_order integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_store ON public.tasks (store_id, week_number, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_owner_all ON public.tasks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  label text NOT NULL,
  target_revenue numeric,
  target_date date,
  achieved boolean NOT NULL DEFAULT false,
  achieved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated;
GRANT ALL ON public.goals TO service_role;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY goals_owner_all ON public.goals FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
CREATE TRIGGER trg_goals_updated_at BEFORE UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- === NOTIFICATIONS ===
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  kind public.notification_kind NOT NULL DEFAULT 'alert',
  title text NOT NULL,
  body text,
  action_label text,
  action_href text,
  severity public.finding_severity NOT NULL DEFAULT 'medium',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON public.notifications (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_owner_all ON public.notifications FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- === ABONNEMENT / QUOTAS ===
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tier public.plan_tier NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_select_own ON public.subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL DEFAULT date_trunc('month', now())::date,
  audits_used integer NOT NULL DEFAULT 0,
  fixes_used integer NOT NULL DEFAULT 0,
  coach_messages_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start)
);
GRANT SELECT ON public.usage TO authenticated;
GRANT ALL ON public.usage TO service_role;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_select_own ON public.usage FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE TRIGGER trg_usage_updated_at BEFORE UPDATE ON public.usage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- === COACH IA ===
CREATE TABLE public.coach_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nouvelle discussion',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_conversations TO authenticated;
GRANT ALL ON public.coach_conversations TO service_role;
ALTER TABLE public.coach_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY coach_conv_owner_all ON public.coach_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_coach_conv_updated_at BEFORE UPDATE ON public.coach_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.coach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.coach_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coach_messages_conv ON public.coach_messages (conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_messages TO authenticated;
GRANT ALL ON public.coach_messages TO service_role;
ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY coach_msg_owner_all ON public.coach_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coach_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coach_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));