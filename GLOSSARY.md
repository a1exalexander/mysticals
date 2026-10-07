# Mysticals

Desktop calendar that merges events from several accounts and reminds the user before they start.

## Language

### Reminders

**Reminder**:
The alert raised a set number of minutes (the **Lead time**) before a timed event starts. A reminder is shown once per event start; it is delivered either as a Banner or as a Full-screen reminder.
_Avoid_: Notification (for the alert itself), alarm

**Lead time**:
How many minutes before an event its Reminder appears; one setting for both delivery styles. Off means no Reminders at all.
_Avoid_: Reminder time, offset

**Banner**:
A Reminder delivered as an operating-system notification. Used for events without a Call link, and for every event when Full-screen reminders are off.
_Avoid_: Toast, popup

**Full-screen reminder**:
A Reminder delivered as an opaque screen covering the display, listing every due meeting that has a Call link. Off by default; when on, it replaces the Banner for those meetings.
_Avoid_: Takeover, overlay, meeting screen

**Call link**:
The video-call URL found on an event (Meet, Zoom, Teams or another call provider). A map or any other plain link in the location is not a Call link.
_Avoid_: Meeting link, join URL
