-- =========================================================================
-- Auto Follow-Up: Multi-Image — expand step.
--
-- Add image_media_asset_ids (array) to every touchpoint in
-- chatbot_configs.followup_settings while LEAVING image_media_asset_id
-- (singular) in place. This makes the migration rollback-safe: pre-deploy
-- code keeps reading the singular field, post-deploy code reads the array.
-- A follow-up migration (≥7 days later) will strip the singular key.
--
-- This migration is idempotent: re-running it leaves data identical.
-- =========================================================================

update public.chatbot_configs
set followup_settings = jsonb_set(
  followup_settings,
  '{touchpoints}',
  (
    select jsonb_agg(
      t || jsonb_build_object(
        'image_media_asset_ids',
        case
          when t ? 'image_media_asset_ids' then t->'image_media_asset_ids'
          when t->>'image_media_asset_id' is null then '[]'::jsonb
          else jsonb_build_array(t->>'image_media_asset_id')
        end
      )
    )
    from jsonb_array_elements(followup_settings->'touchpoints') t
  )
)
where followup_settings is not null
  and followup_settings ? 'touchpoints';
