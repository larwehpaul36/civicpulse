-- 023: DRAFT Twi and Hausa names for the problem types and their groups. Run after 021. Safe to run twice (it only adds or overwrites the "tw" and "ha" keys).
-- These are AI drafts and are NOT reviewed. They do no harm until the language is switched on in the app (lib/languages.js status 'live', or
-- NEXT_PUBLIC_SHOW_UNREVIEWED_LANGS=1 on Vercel Preview), because the app falls back to English for any language it is not showing.
-- To correct a word later, edit it here and run the file again. Ewe ("ee") and Ga ("gaa") are not included yet.

update categories set name = name || v.t::jsonb
from (values
  ('overflowing-bin',     '{"tw":"Fi-kora a ayɛ ma","ha":"Kwandon shara da ya cika"}'),
  ('illegal-dumping',     '{"tw":"Fi a wɔtow wɔ baabi a ɛnyɛ","ha":"Zubar da shara ba bisa ƙa’ida ba"}'),
  ('choked-gutter',       '{"tw":"Nsuo-kwan a abɔ mu","ha":"Magudanar ruwa da ta toshe"}'),
  ('pothole',             '{"tw":"Ɔkwan so amoa","ha":"Rami a hanya"}'),
  ('broken-streetlight',  '{"tw":"Abɔnten hann a abubu","ha":"Fitilar titi da ta lalace"}'),
  ('burst-pipe',          '{"tw":"Nsuo-pɛɛpɛ a apae","ha":"Bututun ruwa da ya fashe"}'),
  ('open-manhole',        '{"tw":"Amoa a wɔabue (manhole)","ha":"Murfin magudanar da aka buɗe (manhole)"}'),
  ('other',               '{"tw":"Ɔhaw foforo","ha":"Wata matsala"}')
) as v(slug, t)
where categories.slug = v.slug;

update category_groups set name = name || v.t::jsonb
from (values
  ('sanitation', '{"tw":"Ahotɔ","ha":"Tsabta"}'),
  ('drainage',   '{"tw":"Nsuo kwan ne nsuyiri","ha":"Magudanar ruwa da ambaliya"}'),
  ('roads',      '{"tw":"Akwan","ha":"Hanyoyi"}'),
  ('lighting',   '{"tw":"Hann ne ahoɔden","ha":"Haske da wutar lantarki"}'),
  ('water',      '{"tw":"Nsuo","ha":"Ruwa"}'),
  ('safety',     '{"tw":"Banbɔ","ha":"Tsaro"}'),
  ('public',     '{"tw":"Mmeae a ɔmanfoɔ de di dwuma","ha":"Wuraren jama’a"}'),
  ('other',      '{"tw":"Ɛnni ɔhaw-nhyehyɛeɛ no mu","ha":"Ba a cikin jerin ba"}')
) as v(slug, t)
where category_groups.slug = v.slug;

-- CHECK: select slug, name from categories order by slug;   -- each name should now have "en", "tw" and "ha"
