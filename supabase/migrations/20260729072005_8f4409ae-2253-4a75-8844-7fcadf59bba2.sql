CREATE TYPE public.data_provider AS ENUM ('shopify', 'meta_ads', 'google_ads', 'ga4');
CREATE TYPE public.data_connection_status AS ENUM ('pending', 'active', 'expired', 'revoked', 'error');

CREATE TABLE public.data_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  provider public.data_provider NOT NULL,
  status public.data_connection_status NOT NULL DEFAULT 'pending',
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  expires_at timestamptz,
  account_id text,
  account_label text,
  scope text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_connections TO authenticated;
GRANT ALL ON public.data_connections TO service_role;

ALTER TABLE public.data_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "data_connections_owner_all" ON public.data_connections
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = data_connections.store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = data_connections.store_id AND s.owner_id = auth.uid()));

CREATE TRIGGER data_connections_updated_at
  BEFORE UPDATE ON public.data_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();