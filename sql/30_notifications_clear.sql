-- ============================================================================
-- 30. Let a user clear their own notification history
-- ----------------------------------------------------------------------------
-- "Mark all as read / Clear all" now removes the user's own notifications.
-- Adds a delete policy + grant (previously only select + update were allowed).
-- Run this in Supabase → SQL Editor.
-- ============================================================================

drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());

grant delete on public.notifications to authenticated;
