-- Index submissions tagged with the source property action page id so the
-- dashboard can quickly list all bookings/qualifications/forms collected for
-- a given property.
CREATE INDEX IF NOT EXISTS action_page_submissions_source_property_idx
  ON public.action_page_submissions ((meta ->> 'source_property_action_page_id'))
  WHERE meta ? 'source_property_action_page_id';
