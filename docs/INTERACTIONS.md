# Keep your place

Nook is the saved home arrangement. A detailed activity is a temporary view: opening Music, Tasks or Focus does not move that module into the main slot. Use the activity's buttons or clickable title; the background does not open another view. Change module placement in Settings → Modules.

## Tasks and Focus

| From | Action | Result | Return |
| --- | --- | --- | --- |
| Nook | Open Tasks | Read and scroll the shared task list | Back to Nook |
| Tasks | Add task | Enter a title, confirm it, set hours and minutes, then review the interval plan | Back or Escape cancels the unsaved task |
| Task duration | Confirm duration | Merge the hour/minute fields and show the plan; no task is saved yet | Choose Add task to save |
| Task plan | Add task | Save the task only after storage accepts it | Return to the initiating task or timer view |
| Task row | Play | Start or resume that task's existing plan | The home arrangement stays the same |
| Task title | Open details | Show its Pomodoro timer without restarting it | Tasks or Back to Nook |
| Timer | Settings | Edit focus, short break, long break and long-break interval for new task plans | Back or Escape cancels unsaved settings |
| Pomodoro settings | Save | Store the defaults for future tasks; existing task plans and progress stay unchanged | Return to the initiating view |
| Paused timer | Resume | Continue from the remaining time | The home arrangement stays the same |

A task's estimate is its **total time budget, including breaks**. With the default 25/5/15 settings, 1 hour 30 minutes becomes three repetitions of 25 minutes of focus followed by a 5-minute break. It does not become three 90-minute work sessions. The preview shows the actual plan before saving. The phase clock shows minutes and seconds; the overall remaining budget uses hours and minutes.

Invalid hours, minutes or settings stay in the form with a readable explanation. Confirming the duration does not create a task, and changing a field does not save a draft. A failed save keeps the draft available for retry. Changing Pomodoro defaults does not pause, restart or re-plan an existing task, earn a completed interval, or emit a completion notification. Pause and resume remain explicit timer actions.

Focus uses four automatic formats based on its saved slot and the space available: a compact clock with ring control, a wide timer with session information, a timer above the upcoming tasks, or a timer beside the task list. Narrow slots keep the compact format even when they are tall. There are no arrows to rotate through sizes, no scaled text, and no separate timer for the Tasks view. Opening settings, a task form or a detailed timer temporarily uses the detail route; Back returns to the same Nook arrangement.

Completing a task saves its state, checks the circle, draws a line through its title with a small nudge, then moves it below the pending tasks while the next pending row takes its place. You can reopen or remove a task during that sequence; keyboard focus, scroll position and stored task order are preserved, and reduced motion applies the result immediately. The larger timer list labels the selected task as In progress or Paused; the intermediate format lists the other tasks without repeating the selected one.

## Music

Open the player's detail controls and return to Nook without exchanging the Music and Focus positions. Up next remains a sliding drawer beside the current player, with its own close action. It uses the optional Spotify connection; ordinary Windows playback controls remain separate.

Track metadata and artwork update immediately. New-track announcements stay quiet while you use the player, queue, search or another Notchy control. Suppressed announcements are discarded, so leaving the panel does not replay the tracks you just browsed.

## Weather and your local calendar

The weather card shows the day, date, city, Celsius and Fahrenheit readings, and current conditions. Hovering the date or city highlights the action; it never opens a view. Click the date to open your local calendar. Click the city to see detailed forecasts; choosing another city is a separate action there.

The calendar icon is gray for a confirmed empty day and accented when you have appointments today. While the calendar is loading or unavailable, Notchy does not claim the day is empty. Appointments belong to this Notchy profile and stay on this computer; they do not connect to an external calendar.

Choose a day, add a title and a start and end time, and save. A successful save is required before an appointment appears. Delete removes that appointment. Return or Escape closes the calendar and restores the date control in the same home arrangement. Escape inside the add form first cancels that draft. Keyboard arrows move between dates, and Page Up or Page Down changes the month.

## Files and local sharing

Tray contains the Shelf and nearby devices. LocalSend starts with every normal Notchy process, so opening Tray is not a prerequisite for receiving. Stop affects the current process; the next launch starts it again. A failed listener is shown as an error rather than readiness. Incoming files still require acceptance.

Selecting files exposes their actions. Saving a copy to Downloads keeps the Shelf original. Sending asks for a device; receiving asks for acceptance; success, refusal, cancellation and failure are distinct outcomes. See [the LocalSend demonstrations](LOCALSEND_SCENARIOS.md).

## Navigation and verification

Nook, Tray and Settings remain the primary places. Detailed views return to their origin, page and keyboard control when it still exists. Automatic scenarios remain optional. Explicit interaction with Tasks, Focus or an activity detail defers automatic scenario changes while that view is open; manual placement is not rewritten by starting, pausing, linking a task or opening a detail.

Check complete paths rather than isolated buttons: open → act → adjust → return, with an idle, running and paused cycle; one, two and three home modules; and a task list long enough to scroll. Use fixture data for screenshots, and keep real-device transfer checks separate from demonstration recordings.
