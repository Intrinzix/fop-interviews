# FOP Subcommittee Interviews

Booking page for FOP subcommittee recruitment interviews. Applicants enter the email they applied with and book one slot for each of their 1st and 2nd choice portfolios. Slots that clash with their other interview (including a 10-minute buffer) are hidden.

Live page: https://intrinzix.github.io/fop-interviews/

## How it fits together

- `index.html` is the whole site (GitHub Pages). The `API_URL` constant at the top of the second script points at the Apps Script web app.
- `Code.gs` is the backend. It lives in Apps Script, bound to a Google Sheet with `applicants`, `slots` and `bookings` tabs. Every booking runs inside a script lock and is re-checked for clashes and capacity before it is saved.

## Committee use

Click **Committee view** at the bottom of the page and enter the passcode (Script properties > `ADMIN_PASS`).

1. Import applicants: paste the sign-up responses from Excel (email, name, 1st choice, 2nd choice).
2. Add slots per portfolio by time range.
3. Share the link. Use the Applicants tab to chase people who haven't booked.

Confirmation emails go out on booking (`SEND_EMAILS` script property). Run `installReminders()` once in Apps Script for an evening-before reminder.

## Updating the backend

After editing `Code.gs` in Apps Script, use Deploy > Manage deployments > edit > New version, so the `/exec` URL stays the same.
