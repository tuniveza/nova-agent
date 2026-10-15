# Invoicer

Invoices to artists at each of their four stages, as the studio's own branded page to print or save as a PDF, with a short email to go with it. It has its own place at the left end of the navigation panel, on its own, in no group.

## What's new

- **A new look**, in the style of novacane.co.uk:
  - a slim near-black band with the website's white ring logo and NOVACANE STUDIOS in spaced capitals, in Jost (the free font closest to the website's Futura);
  - then a calm white page that's easy to read.
- **Stages, quietly:** each stage is one quiet coloured line under the band and one word in the amount box, not a loud banner. The amount to pay and when are at the top right.
- **A Notes box** on every invoice: the invoice's own note, or words you type in **Notes** (right, above the email) for the copy you print or save. With nothing typed, it says thank you.
- **Eight looks**, a shade apart: Night, Violet, Plum, Ink, Ember, Rose, Dusk and Paper (a light band, with the colour logo).
- **☀ Bright or ☾ Dark:**
  - Bright is a white page.
  - Dark is the website's near-black page with light words. It prints and saves to PDF dark too.
- Pick a look and Bright or Dark under **On the invoice** to see them. This browser remembers your choice.
- An admin can press **Use for every invoice**. The ★ marks the studio's look.
- **Also on the page now:**
  - the artist's email under their name;
  - the payment reference (the invoice number);
  - a thank-you line;
  - the studio's address, phone, email and website at the foot.
- Everything fits on one A4 page.

- **Invoicer** is new. It lists every invoice. Each one can be seen as:
  - **Deposit due**
  - **Balance due**
  - **Overdue**
  - **Paid receipt**
- Each stage shows the studio's branded page, and the email for that stage is ready to copy or send.
- **+ New invoice** makes one from the price list.

## How it works

- **Invoices** (left):
  - Every invoice, newest first, with its total and where it is: Deposit due, Balance due, Overdue, Paid receipt, or To approve (not sent yet).
  - Search by the artist's name or the invoice number (NS-0001…).
  - The buttons under the search show one kind at a time.
- **The invoice** (middle):
  - The four stage buttons. The one marked **NOW** is where the invoice really is, worked out from its payments and its due date:
    - nothing paid yet: Deposit due;
    - some paid: Balance due;
    - past the due date with money still owed: Overdue;
    - all paid: Paid receipt.
  - Press another stage to see the invoice as it would be at that stage.
  - The page is the studio's own (the look above). Each stage has its own words and colour:
    - **Deposit due:** violet, "Action required: 50% deposit due to secure your booking". The total, the deposit due now and the balance due later.
    - **Balance due:** charcoal, "Balance payment notice". The total, each payment with its date, and the balance left.
    - **Overdue:** crimson, "Urgent notice: this invoice is past due". An Overdue notice badge, and the due date in red with how many days late it is.
    - **Paid receipt:** green, "Thank you for recording with us!". It becomes a RECEIPT with a large PAID stamp, and "£0.00 (paid in full)".
  - **Print / Save PDF** prints it, or saves it as an A4 PDF with the colours kept. **Open** shows it in its own tab.
- **Email** (right):
  - The subject and message for the stage shown. You can change the words.
  - **Copy email** copies both, to paste into Gmail.
  - **Send…** does what's possible for that invoice. Every email waits for an admin's Approve:
    - **Not sent yet:** an admin can press **Approve and email it** (press twice: the second press says who it goes to). It emails the invoice with a link to its page, where the artist can pay.
    - **Sent, not fully paid:** **Send for approval** queues this message as a reminder, with a button to the invoice's page. An admin approves it here or in Portal → Money.
    - **Paid:** receipts aren't emailed from here yet. Copy the email, save the receipt as a PDF and send them from Gmail.
- **+ New invoice:**
  - The artist (names from the client list fill in their email) and the services from the studio's price list. The sessions come from the booking rules, so a price changed there changes here too.
  - Mixing, mastering and production are on the list too. Mastering is £30 a song for 3 to 10 songs and £50 otherwise; it switches by itself. Custom production is "from £250": type the price agreed.
  - Something else adds a line of your own.
  - Also: the issue date, the day the balance is due (the session day), and a note for the invoice.
  - The total and the 50% deposit show as you go.
  - The new invoice waits for an admin's Approve before anything is emailed.

## Good to know

- Every sum is worked out by Nova Bot in whole pence (src/invoicer.js there), never by an AI.
- The deposit is always 50%, the booking rules' DEPOSIT_PERCENT.
- The studio's details on the page come from Portal → Money's settings. Where they're empty, it uses:
  - 10 Clyde Terrace, London, England, SE23 3BA;
  - +44 20 8291 3028;
  - info@novacane.co.uk;
  - www.novacane.co.uk.
- Bank details show only when they're filled in, in Money's settings.
- There's no VAT line unless VAT is set in Money's settings.
- The invoices are Money's own: the same ones as Portal → Money, with the same numbers, payments and approvals.
