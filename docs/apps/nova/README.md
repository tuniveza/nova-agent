# Nova

Nova is a window into Nova's browser helper while it works.

The helper is a real web browser that Nova Agent drives on the VPS. It does jobs on websites that have no proper way in for a program, such as Acuity Scheduling, the studio's old booking site. Nova shows you every step it takes, live, so you can watch what it does and trust it. It's in the navigation panel under **Tools**.

It used to be called **Visualizer**: same panel, new name.

## What's new

- **Visualizer is now called Nova** in the navigation panel and the Panels window. Everything in it is the same.
- **/agent/nova** opens it (as **/agent/visualizer** still does).

## What it's for

1. **Seeing what the helper does.** Every click, every page it opens, everything it looks for, and whether it worked, shown as it happens.
2. **Checking it's healthy.** One press checks it can still sign in and still find everything it needs on the page.
3. **Trusting it.** It shows when it asked Claude for help and what it remembered, so nothing happens out of sight.

## The four parts

1. **Anatomy:** a small map of how the helper works, top to bottom. Each part lights up and counts as it's used:
   - **Input:** a request arrives, from the buttons here or from Nova Bot.
   - **Task:** the plain steps it follows, like "open the calendar, find the 3pm booking". It says *what* it wants, never *how* to find it.
   - **Finder:** turns "the 3pm booking" into one real thing on the page.
   - **Memory:** where things were last time. Instant and free, so it's tried first.
   - **AI (Claude):** only when memory fails. It reads the page and points at the right thing. Its answer is checked, then remembered.
   - **Browser:** a real Chromium that opens pages, clicks and types at a human pace, and takes the pictures.
   - **The website:** the real site, signed in with the saved session.
2. **Steps, live:** every step as it happens, newest first. Each step has a coloured tag for the part that did it, how long it took, and whether it worked.
3. **What the browser sees:** the latest picture of the page, with what it found outlined.
4. **Memory:** where it last found each thing on the page, and how often. A table you can read.

## The buttons

For admins. All of them only look: none of them books, cancels or changes anything.

1. **Check login:** is it still signed in to the website?
2. **Next 7 days:** lists the bookings for the coming week.
3. **Last 30 days:** lists the bookings for the past month.
4. **Read-only tour:** opens the calendar pages and finds every element later jobs will need, outlined in the pictures. It never clicks.
5. **Health check:** the same check that runs by itself every morning at 6am (UK time).
6. **Wipe memory:** empties the memory, so you can watch the AI find everything again.
7. **Clear steps:** clears this page's list only.

## Good to know

- One job at a time. Each job waits its turn and gets a fresh browser.
- Jobs that would change a booking stop before the final click unless they're switched on for real. They're off by default.
- It runs on the VPS, so it works with the laptop off.
- Only admins can press its buttons to start a job.
- The steps can include clients' names and what was sent to the AI.
