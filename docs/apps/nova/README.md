# Nova

Nova shows every step Nova Agent takes, live.

Nova Agent runs on the VPS: it plans quests, reads the studio's bookings, answers in Agent and opens public web pages for it. Nova shows you each of those steps as it happens, so you can watch what it does and trust it. It's in the navigation panel under **Tools**.

It used to be called **Visualizer**: same panel, new name.

## What's new

- **The old booking-site helper is gone** (24 Oct 2026). The studio's bookings are Nova Bot's own now (the /book page, Stripe deposits, the studio's Google Calendar), so Nova no longer has buttons that look at a booking website, a memory table or a picture of a browser. It shows Nova Agent's steps.
- **Visualizer is now called Nova** in the navigation panel and the Panels window.
- **/agent/nova** opens it (as **/agent/visualizer** still does).

## What it's for

1. **Seeing what Nova Agent does.** Every request, every piece of work, every time it asks Claude, shown as it happens.
2. **Trusting it.** It shows when it asked Claude for help, so nothing happens out of sight.

## The two parts

1. **Anatomy:** a small map of how Nova Agent works, top to bottom. Each part lights up and counts as it's used:
   - **Input:** a request arrives: a chat message, a tap in a panel, or news from Nova Bot.
   - **Task:** the work itself: planning quests, reading the studio's bookings, drafting, syncing.
   - **AI (Claude):** thinks and answers.
   - **Browser:** opens public web pages for Agent and reads them.
2. **Steps, live:** every step as it happens, newest first. Each step has a coloured tag for the part that did it, how long it took, and whether it worked.

## The button

1. **Clear steps:** clears this page's list only.

## Good to know

- It runs on the VPS, so it works with the laptop off.
- The steps can include clients' names and what was sent to the AI.
