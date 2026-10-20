# Keep your place

Nook is the saved home arrangement. A detailed activity is a temporary view: opening Music, Tasks or Focus does not move that module into the main slot. Use the activity's buttons or clickable title; the background does not open another view. Change module placement in Settings → Modules.

## Settings

Settings uses a fixed sidebar and an independently scrolling content area. General, Appearance, Notch, Modules, Health and About open on click; Up/Down, Home and End navigate the sidebar with the keyboard. The close button restores the originating route. Appearance and About are sections of Settings, so navigating them never changes the saved Nook arrangement. Leaving the module editor cancels its unconfirmed placement draft.

Controls retain their existing persistence and native confirmation: Windows startup reflects the real registration, language applies immediately, and appearance changes reuse the validated format, radius and motion preferences. Reset Appearance changes only those visual preferences; it does not remove tasks, appointments or files. Unsupported desktop controls are explained in the web preview rather than simulated. The About page keeps Notchy’s own robot and version.

The compact sidebar, inset separators and grouped rows follow the visual and behavioral reference in [Bloom](https://github.com/SehajveerSingh2005/bloom) (reviewed at `c0969563eac7a232a5afd242097a61f63f7eebca`). Settings retains Notchy’s black island, dark cards, Manrope typography and mint activity accent. Bloom’s source is GPL-3.0-only; no Bloom source files or assets are included in Notchy. The existing Notchy spring is retained, while settings content uses an interruptible 220 ms reveal. Reduced motion and the app’s animation switch suppress that reveal and control transitions.

## Market

Market opens inside Notchy, with category navigation, search, module details and two previews. Built-in modules show their actual Installed/Install state; Remove requires confirmation and preserves their saved data. Community modules keep their validated JSON import, installation and removal flow. My modules follows the same current state as the catalog. A failed save leaves the installed state unchanged and offers a retry. Returning from a built-in module restores Market; closing Market restores the original route, Nook page and focused control.

## Tasks and Focus

**Tasks & Focus** is one module (`focus`). Its list, adaptive timer and detailed Pomodoro use the same persisted tasks and session. Legacy `tasks` placements migrate to the first enabled visible Tasks/Focus position, releasing the duplicate without shifting other modules. A running or progressed session reopens its timer; otherwise the module starts with the list.

With two modules, the scene uses a 65/35 split and full-height companion cards. An empty task card keeps its centered message and bottom action at the placement's real size; compact rail cards retain their smaller layout. Task completion still checks, strikes through, then reorders the row with staggered motion.

| From | Action | Result | Return |
| --- | --- | --- | --- |
| Nook | Open Tasks | Read and scroll the shared task list | Back to Nook |
| Tasks | Add task | Enter a title, confirm it, set hours and minutes, then review the interval plan | Back or Escape cancels the unsaved task |
| Task duration | Confirm duration | Merge the hour/minute fields and show the plan; no task is saved yet | Choose Add task to save |
| Task plan | Add task | Save the task only after storage accepts it | Return to the initiating task or timer view |
| Task row | Play | Start or resume that task's existing plan, then display the adaptive timer after the save succeeds | Click the task title or press Escape to restore the list, row focus and scroll; the session continues |
| Task title | Open details | Show its Pomodoro timer without restarting it | Tasks or Back to Nook |
| Task context menu | Edit | Reuse the title/duration form for this task | Cancel or Escape preserves the original task |
| Edited task | Save | A title change preserves progress; a changed duration requires an explicit restart if already started, then pauses the new plan | Return to the initiating list or timer |
| Task context menu | Delete, then Undo | Restore the task identity, saved order and progress, paused; another running task keeps playing | Undo remains available in the Tasks/Focus views until used or another task is deleted |
| Timer | Settings | Edit focus, short break, long break and long-break interval for new task plans | Back or Escape cancels unsaved settings |
| Pomodoro settings | Save | Store the defaults for future tasks; existing task plans and progress stay unchanged | Return to the initiating view |
| Paused timer | Resume | Continue from the remaining time | The home arrangement stays the same |

A task's estimate is its **total time budget, including breaks**. With the default 25/5/15 settings, 1 hour 30 minutes becomes three repetitions of 25 minutes of focus followed by a 5-minute break. It does not become three 90-minute work sessions. The preview shows the actual plan before saving. The phase clock shows minutes and seconds; the overall remaining budget uses hours and minutes.

Invalid hours, minutes or settings stay in the form with a readable explanation. Confirming the duration does not create a task, and changing a field does not save a draft. A failed save keeps the draft available for retry. Changing Pomodoro defaults does not pause, restart or re-plan an existing task, earn a completed interval, or emit a completion notification. Pause and resume remain explicit timer actions.

Focus uses four automatic formats based on its saved slot and the space available: a compact clock with ring control, a wide timer with session information, a timer above the upcoming tasks, or a timer beside the task list. Narrow slots keep the compact format even when they are tall. Controls retain the reference proportions; lists align near the top of the neighboring artwork and use their slot's available width and height. Task text has a readable minimum scale on narrow screens. Forms keep their reference canvas. There are no arrows to rotate through sizes and no separate timer for the Tasks view. Opening settings, a task form or a detailed timer temporarily uses the detail route; Back returns to the same Nook arrangement.

Completing a task saves its state, checks the circle, draws a line through its title with a small nudge, then moves it below the pending tasks while the next pending row takes its place. You can reopen or remove a task during that sequence; keyboard focus, scroll position and stored task order are preserved, and reduced motion applies the result immediately. The larger timer list labels the selected task as In progress or Paused; the intermediate format lists the other tasks without repeating the selected one.

The check leads a progressive strike and a visible 10 px movement of the circle, title and progress bar together. A short hold makes the completed state readable before the following rows fill the gap in a cascade and the completed row settles below them. Duration fields keep their DOM nodes while splitting and merging, so reversing the interaction continues from its current position. Changes between one, two and three home modules use a damped spring with the main surface leading its two secondary surfaces. Clock and metadata updates do not restart that movement; both the app's animation setting and the operating system's reduced-motion preference settle it immediately.

## Music

Open the player's detail controls and return to Nook without exchanging the Music and Focus positions. Up next remains a sliding drawer beside the current player, with its own close action. It uses the optional Spotify connection; ordinary Windows playback controls remain separate.

Track metadata and artwork update immediately. New-track announcements stay quiet while you use the player, queue, search or another Notchy control. Suppressed announcements are discarded, so leaving the panel does not replay the tracks you just browsed.

## Weather and your local calendar

The weather card shows the day, date, city, Celsius and Fahrenheit readings, and current conditions. Hovering the date or city highlights the action; it never opens a view. Click the date to open your local calendar. Click the city to see detailed forecasts; choosing another city is a separate action there.

In a two-module Music/Weather composition, detailed forecasts replace only the right-hand weather card. Music stays in its original position. Close or Escape restores the narrative weather card; the agenda and city picker return to the same detailed card.

The calendar icon is gray for a confirmed empty day and accented when you have appointments today. While the calendar is loading or unavailable, Notchy does not claim the day is empty. Appointments belong to this Notchy profile and stay on this computer; they do not connect to an external calendar.

Choose a day, add a title and a start and end time, and save. Click an appointment's title/time to edit it using the same form. A successful save is required before an appointment is added or changed. Delete offers Undo, restoring the same appointment and date after persistence succeeds. Return or Escape first cancels an open form, then closes the calendar and restores the date control in the same home arrangement. A failed write preserves the draft or Undo action for retry. Keyboard arrows move between dates, and Page Up or Page Down changes the month.

The calendar uses a large weekday heading, a strip of seven dates and appointment cards, following the interaction reference. Selecting an empty day contracts the same surface; appointments expand it and move the week strip down. The selection glides between days, the heading follows with a short letter stagger, and cards enter or leave with coordinated motion. Fast changes redirect the selection from its current position and velocity; no transition blocks a click or keyboard action. An agenda opened by click stays open until Back, Escape or explicit navigation, including when contraction leaves the pointer outside its new bounds. Unchanged storage notifications do not replay the animation. Closing the calendar, hiding the app, or enabling reduced motion stops ongoing movement immediately. The app's animation setting applies to the calendar too.

## Files and local sharing

Tray contains the Shelf and nearby devices. LocalSend starts with every normal Notchy process, so opening Tray is not a prerequisite for receiving. Stop affects the current process; the next launch starts it again. A failed listener is shown as an error rather than readiness. Incoming files still require acceptance.

Selecting files exposes their actions. Saving a copy to Downloads keeps the Shelf original. Sending asks for a device; receiving asks for acceptance; success, refusal, cancellation and failure are distinct outcomes. See [the LocalSend demonstrations](LOCALSEND_SCENARIOS.md).

## Navigation and verification

Nook, Tray and Market share the main navigation, with Settings available beside them. Detailed views return to their origin, page and keyboard control when it still exists. The current panel follows the saved module arrangement. Starting, pausing, linking a task or opening a detail never rewrites that placement. Legacy scenario preferences remain readable for compatibility but do not automatically rearrange the current panel.

Back restores the previous open view; Close explicitly collapses the island. Escape dismisses the innermost menu, form, picker or drawer before leaving its detail route. Settings subsections return to General, then to the initiating view. Closing Settings restores its initiating view underneath the collapsed island. LocalSend's Done returns to the originating panel; its Close button collapses the island, and returning from an ongoing transfer does not cancel it.

Check complete paths rather than isolated buttons: open → act → adjust → return, with an idle, running and paused cycle; one, two and three home modules; and a task list long enough to scroll. Use fixture data for screenshots, and keep real-device transfer checks separate from demonstration recordings.
