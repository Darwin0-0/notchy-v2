# LocalSend, from discovery to done

Four short demonstrations recorded from Notchy's own interface. Files, devices and transfer progress are controlled sample data; these recordings are not evidence of a physical phone transfer.

LocalSend starts with Notchy on a normal launch. Sharing needs a reachable local network, with incoming transfers still requiring explicit acceptance. **Stop** keeps sharing off for the current process; restarting Notchy enables it again.

## Find a nearby device

Discovery leads to a device you can choose. If multicast is unavailable, the existing private-IP entry remains available.

![LocalSend discovery using a sample nearby device](../assets/previews/localsend-scenarios/discovery.gif)

## Send files

Select files, choose a device, wait for acceptance and follow progress to completion. Closing a presentation does not silently delete the Shelf files.

![LocalSend sending sample files and showing completion](../assets/previews/localsend-scenarios/send.gif)

## Receive files

Review the request before accepting it. Completed files appear in the Shelf; refusing the request leaves them unreceived.

![LocalSend reception from consent through completion with sample files](../assets/previews/localsend-scenarios/receive.gif)

## Retry after an interruption

An interruption has a readable outcome and a retry action. Retrying starts a new transfer attempt rather than pretending that the missing part arrived.

![LocalSend interrupted sample transfer and explicit retry](../assets/previews/localsend-scenarios/retry.gif)

For real-device verification, use disposable files and test both directions, consent, refusal, cancellation and the manual-address fallback on the actual local network. See [the project backlog](ROADMAP.md) for the remaining release checks.
