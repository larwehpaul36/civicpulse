\set ON_ERROR_STOP off
\pset pager off
\echo '--- seed counts (expect 16 regions + cities, 7 categories)'
select (select count(*) from regions where level='region') regions, (select count(*) from categories) categories, (select count(*) from categories where enabled) enabled;

insert into auth.users(id,email,is_anonymous) values
 ('00000000-0000-0000-0000-000000000001','a@x',true),('00000000-0000-0000-0000-000000000002','b@x',true),
 ('00000000-0000-0000-0000-000000000003','c@x',true),('00000000-0000-0000-0000-000000000004','d@x',true),
 ('00000000-0000-0000-0000-000000000099','mod@x',false);
insert into responsible_parties(name,type,region_id,verified) select 'Greater Accra Assembly','government',id,true from regions where name='Greater Accra';
insert into category_responsibilities(category_id,region_id,party_id)
 select c.id,r.id,p.id from categories c, regions r, responsible_parties p where c.slug='choked-gutter' and r.name='Greater Accra' and p.name='Greater Accra Assembly';

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
\echo '--- 1. reporter inserts an issue under city Accra (party mapped only at Greater Accra)'
insert into issues(id,reporter_id,category_id,region_id,severity,description,location)
 select '11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000001',c.id,r.id,'medium','Choked gutter','SRID=4326;POINT(-0.187 5.6037)'
 from categories c, regions r where c.slug='choked-gutter' and r.name='Accra' and r.level='city';
insert into issues(id,reporter_id,category_id,region_id,severity,description,location)
 select '22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000001',c.id,r.id,'hazard','Big pothole','SRID=4326;POINT(-0.2 5.61)'
 from categories c, regions r where c.slug='pothole' and r.name='Accra' and r.level='city';
\echo '--- 2. party auto-assigned via region tree? (issue 1 yes, issue 2 no)'
select left(id::text,2) id, party_id is not null has_party, status from issues order by id;
\echo '--- 3. exact location must be unreadable (expect permission denied)'
select location from issues;
\echo '--- 4. public view gives rounded lat/lng (expect 5.604 / -0.187)'
select lat, lng from public_issues where id='11111111-1111-1111-1111-111111111111';
\echo '--- 5. users cannot change status (expect permission denied)'
update issues set status='resolved' where id='11111111-1111-1111-1111-111111111111';
\echo '--- 6. duplicate check finds issue 1 within 50 m, no location leaked'
select left(id::text,2) id, description, days_open from find_nearby_duplicates(5.60372,-0.18701,(select id from categories where slug='choked-gutter'));
\echo '--- 7. cannot confirm own report (expect RLS violation)'
insert into confirmations(issue_id,user_id) values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000001');
\echo '--- 8. three others confirm -> verified'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
insert into confirmations(issue_id,user_id) values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000002');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
insert into confirmations(issue_id,user_id) values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000003');
insert into confirmations(issue_id,user_id) values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000003');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
insert into confirmations(issue_id,user_id) values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000004');
select status, confirmation_count from issues where id='11111111-1111-1111-1111-111111111111';
\echo '--- 9. non-moderator calls admin function (expect not_moderator)'
select * from admin_list_issues();
\echo '--- 10. anonymous role calls admin function (expect permission denied)'
set role anon;
select * from admin_list_issues();

reset role;
insert into moderators(user_id) values ('00000000-0000-0000-0000-000000000099');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000099';
set role authenticated;
\echo '--- 11. moderator sees exact location + flag counts'
select left(id::text,2) id, status, party_name, round(lat::numeric,5) lat, flag_count from admin_list_issues() order by id;
\echo '--- 12. sent without party (issue 2) -> party_required'
select admin_set_status('22222222-2222-2222-2222-222222222222','sent');
\echo '--- 13. resolved without after photo (issue 1) -> after_photo_required'
select admin_set_status('11111111-1111-1111-1111-111111111111','sent');
select admin_set_status('11111111-1111-1111-1111-111111111111','resolved');
\echo '--- 14. add after photo, then resolve'
select admin_add_after_photo('11111111-1111-1111-1111-111111111111','after/test.jpg');
select admin_set_status('11111111-1111-1111-1111-111111111111','resolved');
select admin_log_contact('11111111-1111-1111-1111-111111111111','whatsapp','Case sent',false);
reset role;
\echo '--- 15. history, timestamps, and tracker view'
select to_status, actor is not null as has_actor from status_log where issue_id='11111111-1111-1111-1111-111111111111' order by id;
select sent_at is not null sent, resolved_at is not null resolved from issues where id='11111111-1111-1111-1111-111111111111';
select name, resolved, open_cases, avg_days_to_resolve from party_performance;
