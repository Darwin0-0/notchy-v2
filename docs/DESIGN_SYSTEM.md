# Design system and interaction contracts

Notchy uses one black notch surface. Modules share that surface and request the space their controls need; the notch owns the outer contour, animation and native window geometry. Avoid adding a second decorative frame around a module.

The source of truth for current dimensions is `moduleLayouts` and `moduleDefinitions` in [notch.js](../notch.js). [notch.css](../notch.css) owns presentation and colour tokens. Change a module’s sizing contract together with its real content needs and regression checks.

## Notch states

| State | Content and size |
| --- | --- |
| Discreet | A 260 × 10 px strip, with a 4 px lower radius. Only activity progress is shown, even when Music, Focus or LocalSend is active. |
| Ordinary hover | 312 × 36 px, with a 12 px radius. Artwork, title, audio spectrum and Focus ring/time share one line. |
| Track-change feedback | A brief 312 × 44 px cue with artwork and track information. |
| Completion feedback | A temporary larger surface can expose a completed action and its controls. This is not the ordinary hover state. |
| Open | Size follows the current view, module contracts and available screen space. The chosen appearance format scales the presentation. |

Native shoulder geometry is outside the module content width. Do not treat screenshots measured in physical display pixels as CSS dimensions; Windows display scaling affects the result.

## Dynamic layout

Modules declare a minimum, preferred and useful maximum width, a content height and their band behaviour. Layout allocates space within those bounds and wraps modules rather than shrinking their controls below their minimum. Music, Focus, Weather and Shelf can have different widths; do not force a percentage split or identical cards.

The current view must release dimensions it no longer needs. Closing **Up next** restores the player width. Settings measure their visible form content. Do not retain the largest width or height reached earlier in the same opening, and do not use a fixed tall panel to protect the pointer.

A secondary Shelf stays accessible through **Tray**, avoiding a duplicate summary beside the primary module. File tools remain Shelf actions; LocalSend has its own transfer flow within Tray.

Tasks and Pomodoro belong to one Focus module. Its task controls, work phase, breaks and timer must fit together as one useful activity. Avoid a tiny secondary timer that loses its controls, and preserve the fading digit transitions when compacting its layout.

## Opening and dismissal

Ordinary hover and module views re-collapse after the pointer leaves, with a short delay. Real native cursor events handle cases where Windows misses a DOM leave event. Keyboard navigation, active inputs, dragging and file dialogues retain their existing guards.

Settings is an explicit interaction: it stays open if resizing puts the pointer outside the new contour, or if the window passively deactivates. Its close button, Escape and the collapse control dismiss it. An outside click received by the DOM also dismisses it. Navigating to another view restores ordinary automatic collapse. The native deactivation signal does not distinguish an outside click from passive focus loss, so it must not be described as an explicit outside-click event.

## Motion and activity feedback

The surface uses a restrained underdamped spring. Reversing a transition preserves its velocity; geometry sent to Windows remains bounded on every frame, including the rebound. Reduced-motion preferences and the animation setting snap the surface instead of running the spring.

Music’s spectrum comes from real audio levels. Artwork supplies its colour; missing artwork uses white. Silence stays silent. Capture audio only when a spectrum is visible.

Focus uses the ring in hover and the thin progress strip in discreet mode. Do not show both indicators in the same compact state. Phase changes, meaningful activity changes and completed file operations can produce a brief cue; clock ticks, startup restoration and cancelled operations should not imitate new events.

## Visual language and access

Use the existing UI colour tokens: light primary text, muted secondary text, blue actions and selections, mint Focus accents, amber warnings and red errors. Pair status colour with a label or icon; do not rely on colour alone. Keep destructive actions distinct from ordinary navigation.

Scrollbars are hidden by default, but scrolling and keyboard access must remain available when content genuinely exceeds the screen. Prefer fitting normal content rather than hiding overflow. Retain focus-visible indicators, accessible labels, hit areas and disabled states while changing icons or spacing.

Welcome and tutorial use Notchy’s own visual style. Mimo belongs only to this welcome flow: a brief greeting on arrival, with no repeating background performance. The greeting stops when motion is disabled, the page is hidden or the welcome is dismissed. Show the essential interactions and real feature choices rather than a separate decorative dashboard.

French and English are selected from the welcome screen or Settings and saved locally. Translate interface labels through [i18n.js](../i18n.js); keep user-entered tasks, file names, artist and track names intact. A language change must preserve the active session, task list and current view.

## Check a design change

Inspect the affected view at more than one display scale, with long text and sample empty/error states. Check keyboard navigation, reduced motion, interrupted transitions and the path back to a smaller view. Use before/after screenshots with sample data. Automated sizing and interaction tests are in [tests/](../tests/); they complement checks of the actual Windows contour and pointer behaviour.
