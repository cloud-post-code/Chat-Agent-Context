-- The booking form becomes the business's own: every question carries a
-- `role` (which answer is the customer's name/email/phone) and a `screen`
-- (which questions are asked together), and the locked "Your details" step
-- becomes ordinary rows at the front of the form. Every existing tenant's
-- card asks exactly what it asked before this migration, in the same order:
-- the details screen, then each question on its own screen.

ALTER TABLE "AppointmentField"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "screen" INTEGER NOT NULL DEFAULT 0;

-- 1. The three questions the first enable used to seed count as onboarding's
--    (the "untouched form" rule is now "every question generated").
UPDATE "AppointmentField" SET "config" = '{"generated":true}'
 WHERE "config" = '{}' AND (
   ("key" = 'name'   AND "label" = 'Your name'  AND "type" = 'short_text' AND "required" = true) OR
   ("key" = 'email'  AND "label" = 'Your email' AND "type" = 'email'      AND "required" = true) OR
   ("key" = 'reason' AND "label" = 'What would you like to talk about?' AND "type" = 'long_text' AND "required" = false));

-- 2. The tenants whose form is in use: any question row, or any booking
--    settings row. (A tenant with neither has no card today and keeps none.)
CREATE TEMP TABLE form_tenants AS
  SELECT DISTINCT "userId" FROM "AppointmentField"
  UNION
  SELECT "userId" FROM "BookingSettings";

-- 3. The legacy contact questions (keys name / email / phone) were hidden from
--    the card by the details step, which asked its own first name, last name,
--    email and phone instead. Their one effect — a required phone question made
--    the details step's phone required — is kept; the rows go.
CREATE TEMP TABLE legacy_phone_required AS
  SELECT "userId", bool_or("required") AS req
    FROM "AppointmentField"
   WHERE "key" = 'phone'
   GROUP BY "userId";

DELETE FROM "AppointmentField"
 WHERE "key" IN ('name', 'email', 'phone')
   AND "userId" IN (SELECT "userId" FROM form_tenants);

-- 4. A question keyed `notes` (a comments box) is the customer's notes.
UPDATE "AppointmentField" SET "role" = 'notes' WHERE "key" = 'notes' AND "type" = 'long_text';

-- 5. Existing questions keep their order, each on its own screen after the
--    details screen (1). Orders may be sparse; compaction below fixes both.
UPDATE "AppointmentField" SET "screen" = "order" + 2;

-- 6. The details step, as rows on screen 1: the enabled customer fields from
--    the tenant's settings JSON, or the five core defaults. The core five were
--    always asked; first name and email were always required; last name and
--    phone were required unless the owner turned that off.
WITH defs("k", "idx", "key", "label", "type", "role", "core", "config") AS (VALUES
  ('firstName',        1,  'first_name',        'First name',                   'short_text', 'first_name', true,  '{"generated":true}'),
  ('lastName',         2,  'last_name',         'Last name',                    'short_text', 'last_name',  true,  '{"generated":true}'),
  ('email',            3,  'email',             'Email',                        'email',      'email',      true,  '{"generated":true}'),
  ('phone',            4,  'phone',             'Phone',                        'phone',      'phone',      true,  '{"generated":true}'),
  ('smsConsent',       5,  'sms_consent',       'Text me appointment reminders','yes_no',     'none',       true,  '{"generated":true}'),
  ('address',          6,  'address',           'Address',                      'address',    'none',       false, '{"generated":true}'),
  ('company',          7,  'company',           'Company',                      'short_text', 'none',       false, '{"generated":true}'),
  ('birthday',         8,  'birthday',          'Birthday',                     'date',       'none',       false, '{"generated":true}'),
  ('preferredContact', 9,  'preferred_contact', 'Preferred contact method',     'select',     'none',       false, '{"generated":true,"options":[{"label":"Email"},{"label":"Phone"},{"label":"Text"}]}'),
  ('customerStatus',   10, 'customer_status',   'Have you visited us before?',  'select',     'none',       false, '{"generated":true,"options":[{"label":"New customer"},{"label":"Returning"}]}'),
  ('referralSource',   11, 'referral_source',   'How did you hear about us?',   'short_text', 'none',       false, '{"generated":true}'),
  ('notes',            12, 'notes',             'Anything else we should know?','long_text',  'notes',      false, '{"generated":true}')
),
settings AS (
  SELECT "userId",
         CASE WHEN "config" ~ '^\s*\{' THEN "config"::jsonb ELSE '{}'::jsonb END AS cfg
    FROM "BookingSettings"
),
stored AS (
  SELECT s."userId",
         e ->> 'key' AS k,
         CASE WHEN jsonb_typeof(e -> 'enabled')  = 'boolean' THEN (e ->> 'enabled')::boolean  END AS enabled,
         CASE WHEN jsonb_typeof(e -> 'required') = 'boolean' THEN (e ->> 'required')::boolean END AS required,
         CASE WHEN jsonb_typeof(e -> 'label')    = 'string'  THEN e ->> 'label' END AS label
    FROM settings s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.cfg -> 'customerFields') = 'array' THEN s.cfg -> 'customerFields' ELSE '[]'::jsonb END
    ) e
   WHERE jsonb_typeof(e) = 'object'
)
INSERT INTO "AppointmentField" ("id", "userId", "key", "label", "type", "required", "order", "screen", "role", "config")
SELECT md5(t."userId" || ':' || d."key" || ':' || random()::text),
       t."userId",
       d."key",
       COALESCE(NULLIF(left(st.label, 120), ''), d."label"),
       d."type",
       CASE
         WHEN d."k" IN ('firstName', 'email') THEN true
         WHEN d."k" = 'smsConsent' THEN false
         WHEN d."k" = 'lastName' THEN COALESCE(st.required, true)
         WHEN d."k" = 'phone' THEN COALESCE(st.required, true) OR COALESCE(lp.req, false)
         ELSE COALESCE(st.required, false)
       END,
       d."idx" - 13,
       1,
       d."role",
       d."config"
  FROM form_tenants t
  CROSS JOIN defs d
  LEFT JOIN stored st ON st."userId" = t."userId" AND st.k = d."k"
  LEFT JOIN legacy_phone_required lp ON lp."userId" = t."userId"
 WHERE d."core" OR COALESCE(st.enabled, false)
ON CONFLICT ("userId", "key") DO NOTHING;

-- 7. Compact: orders 0..n and screens 1..m per tenant, in the order above.
UPDATE "AppointmentField" a
   SET "order" = r.ord, "screen" = r.scr
  FROM (
    SELECT "id",
           row_number() OVER (PARTITION BY "userId" ORDER BY "order", "id") - 1 AS ord,
           dense_rank()  OVER (PARTITION BY "userId" ORDER BY "screen") AS scr
      FROM "AppointmentField"
  ) r
 WHERE r."id" = a."id";

DROP TABLE legacy_phone_required;
DROP TABLE form_tenants;
