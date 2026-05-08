-- Index submissions tagged with the source sales page id so the dashboard can
-- quickly list all bookings/qualifications/forms collected for a given sales
-- page.
CREATE INDEX IF NOT EXISTS action_page_submissions_source_sales_idx
  ON public.action_page_submissions ((meta ->> 'source_sales_page_id'))
  WHERE meta ? 'source_sales_page_id';
