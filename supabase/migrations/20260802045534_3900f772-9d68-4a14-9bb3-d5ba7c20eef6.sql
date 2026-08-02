CREATE TYPE public.tracking_status AS ENUM ('measuring', 'on_track', 'underperforming', 'regressed');

CREATE TABLE public.fix_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES public.audit_findings(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  applied_at timestamptz NOT NULL DEFAULT now(),
  expected_gain_min numeric,
  expected_gain_max numeric,
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  latest jsonb,
  delta jsonb,
  status public.tracking_status NOT NULL DEFAULT 'measuring',
  alert_message text,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fix_outcomes TO authenticated;
GRANT ALL ON public.fix_outcomes TO service_role;

ALTER TABLE public.fix_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY fix_outcomes_owner_all ON public.fix_outcomes
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = fix_outcomes.store_id AND s.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = fix_outcomes.store_id AND s.owner_id = auth.uid()));

CREATE TRIGGER update_fix_outcomes_updated_at
BEFORE UPDATE ON public.fix_outcomes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX fix_outcomes_store_idx ON public.fix_outcomes(store_id, applied_at DESC);