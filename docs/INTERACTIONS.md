# Keep your place

Nook is the saved home arrangement. A detailed activity is a temporary view: opening Music, Tasks or Focus does not move that module into the main slot. Change module placement in Settings → Modules.

## Tasks and Focus

| From | Action | Result | Return |
| --- | --- | --- | --- |
| Nook | Open Tasks | Read and scroll the shared task list | Back to Nook |
| Tasks, no cycle running | Prepare Focus | Select the task and set session durations | Back or Escape cancels unsaved settings |
| Focus preparation | Start | Begin the configured cycle with the selected task | Back to tasks |
| Tasks, cycle already active | View timer | Show the existing cycle without restarting it | Back to tasks |
| Running timer | Settings | Read durations and choose Pause to edit | Back or Escape cancels unsaved settings |
| Paused timer settings | Save and return | Keep elapsed time, phase, session and earned task cycles; remain paused | Return to the initiating view |
| Paused timer | Resume | Continue from the remaining time | The home arrangement stays the same |

A duration cannot end before the time already spent, and the session count cannot be lower than the current session. An invalid edit stays in the form with a readable explanation; it does not change the cycle. Changing settings does not earn a task cycle or emit a completion notification. A draft is not saved merely by changing a field. Pausing is an explicit timer action and remains effective even when the draft is cancelled; resuming and stopping remain separate actions.

The small Focus card exposes its settings action too. A session does not need to become the primary home module to be configured.

## Music

Open the player's detail controls and return to Nook without exchanging the Music and Focus positions. Up next remains a sliding drawer beside the current player, with its own close action. It uses the optional Spotify connection; ordinary Windows playback controls remain separate.

## Files and local sharing

Tray contains the Shelf and nearby devices. LocalSend starts with every normal Notchy process, so opening Tray is not a prerequisite for receiving. Stop affects the current process; the next launch starts it again. A failed listener is shown as an error rather than readiness. Incoming files still require acceptance.

Selecting files exposes their actions. Saving a copy to Downloads keeps the Shelf original. Sending asks for a device; receiving asks for acceptance; success, refusal, cancellation and failure are distinct outcomes. See [the LocalSend demonstrations](LOCALSEND_SCENARIOS.md).

## Navigation and verification

Nook, Tray and Settings remain the primary places. Detailed views return to their origin, page and keyboard control when it still exists. Automatic scenarios remain optional. Explicit interaction with Tasks, Focus or an activity detail defers automatic scenario changes while that view is open; manual placement is not rewritten by starting, pausing, linking a task or opening a detail.

Check complete paths rather than isolated buttons: open → act → adjust → return, with an idle, running and paused cycle; one, two and three home modules; and a task list long enough to scroll. Use fixture data for screenshots, and keep real-device transfer checks separate from demonstration recordings.
