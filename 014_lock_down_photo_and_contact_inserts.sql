-- 014: stop visitors writing to other people's reports. Run after 013. Safe to run twice.
-- Before this, any signed-in visitor (including an anonymous one) could:
--   * attach a photo, even an "after" photo, to ANY report (it then shows publicly and satisfies the
--     "resolved needs an after photo" rule for moderators), and
--   * add rows to the public contact log of ANY report (for example "response received: yes").
-- The app only ever needs: a reporter adding the "before" photo to their own report.
-- Moderators keep working through admin_add_after_photo() and admin_log_contact(), which run with owner rights.

-- 1. Photos: only the reporter, only the "before" kind, only a file inside their own folder.
drop policy if exists "add photos" on issue_photos;
drop policy if exists "add own before photo" on issue_photos;
create policy "add own before photo" on issue_photos for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and kind = 'before'
    and (string_to_array(storage_path, '/'))[1] = auth.uid()::text
    and storage_path !~ '\.\.'
    and exists (select 1 from issues i where i.id = issue_id and i.reporter_id = auth.uid())
  );

-- 2. Contact log: no direct writes at all. Moderators use admin_log_contact().
drop policy if exists "log contact" on contact_attempts;

-- 3. Optional: one "before" photo per report. Check for existing duplicates first:
--    select issue_id, count(*) from issue_photos where kind = 'before' group by 1 having count(*) > 1;
--    If that returns no rows, run:
--    create unique index if not exists issue_photos_one_before on issue_photos (issue_id) where kind = 'before';

-- CHECKS (run each as a normal signed-in user in the app, or see the author's test script):
select polname from pg_policy where polrelid in ('issue_photos'::regclass, 'contact_attempts'::regclass) order by 1;
-- expect: add own before photo, contacts readable, photos readable (and NOT: add photos, log contact)
