-- Improve performance dashboard query speed on api_logs

CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON public.api_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_logs_route_created_at
  ON public.api_logs (route, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_logs_method_route_created_at
  ON public.api_logs (method, route, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_logs_status_created_at
  ON public.api_logs (status, created_at DESC);
