# Three more local businesses, held up against their own booking pages

Run 2026-09-21 with `try.ts` (real crawl, real model), then each business's
real booking page walked by hand in a browser. Nothing was submitted.

## Rail Stop Restaurant & Bar — 96 Guest St, Brighton (OpenTable widget)
Real: party size 1–20, date, time → first and last name, phone (required),
email, special occasion, special request. A card hold is also taken.
Built: name*, phone*, email, **How many people? 1–20***, "Any allergies or a
special occasion?".
Match. First run also asked a required menu of 32 *dishes* — fixed: `table`
never gets a services menu.

## Best Handyman Boston — serves Allston/Brighton (Jotform on /request-estimate/)
Real: Your Name*, Email Address*, Cell Phone*, Where Is The Project?*, What Do
You Need Done?*, Upload Photos*, What Type of Parking…?* (dropdown), a date,
two radios, How Did You Hear About Us?, Promo Code.
Built: name*, phone*, email*, services, "Where is the job?"*, "What do you need
done?"*, **their parking dropdown with their own options***, their drone
inspection yes/no*.
Match on everything the wizard can ask. First run read a Jobber advert as the
booking page, never saw the Jotform (it is an iframe), and added State / City /
a second "What Do You Need Done?" / a text box for "Upload Photos" — all fixed.
Not asked: photo upload (no file question exists), how-did-you-hear, promo code.

## Dapper Cleaning Services — 66 Chiswick Rd, Brighton (CleanGenie form)
Real: Full Name*, Email*, Phone*, Type of Service*.
Built: name*, phone*, email*, services (their three)*, "Where is the job?"*,
"What do you need done?"*.
Their four all match (email correctly required once the form was found — the
first run missed it because "Get a Quote" was not a booking word). The address
and job questions are the home-service norm, not theirs: their form is a lead
capture followed by a phone call, while this wizard books a time, which a home
visit cannot do without an address.

## Also looked at
- Brookline Beauty Nails & Spa (12 Cypress St, Brookline): real flow is service
  tabs → "how many people coming" → add more → date → 30-minute slots; built
  form has the priced menu and "How many people coming". Only the first of
  eight service tabs is in the page until clicked, so the menu has 11 of their
  services. The contact step could not be reached (no open slots that day).
- Matt's Barber Shop and Tina's Hair Salon (both Brighton): no online booking
  at all — call or walk in — so nothing to compare; both got a priced menu
  (5 and 47 services) from their services pages.
- Skipped as not local: Circle Square Salon (Richmond, VA) and Brighton Barbers
  (Brighton, Michigan).
