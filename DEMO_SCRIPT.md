# Demo script — recording for the Wispr Flow task (hhgoa-2026)

Read the lines in quotes aloud with Wispr Flow. Keep the screen recording running the whole time, with the Wispr Flow overlay visible.
Part 1 is the part the task judges: building with your voice. Part 2 is a bonus that shows voice used to play.

## Before you hit record
- Account created through https://ref.wisprflow.ai/hhg.
- Wispr Flow running, and its hotkey tested in the Claude Code prompt box.
- `npm install` done. Then run `npm run dev` and open http://localhost:5173 in a second window.
- Use a normal browser window, not fullscreen. Ctrl+W closes a tab in a browser, so don't press it.

## Part 1 — Build with your voice (about 2–3 min)
Dictate each request into the Claude Code prompt box. Let Claude finish, then show the result in the game.
1. "Add a mission timer to the HUD that shows elapsed time in the top right corner."
2. "Add a spoken command called time check that reads out the mission time."
3. "Update the README with a short summary of what we just added."
Say out loud what you want and why. The video should show your voice producing the prompts and the code changing.

## Part 2 — Fly by voice (about 2 min)
Click the game, press Enter, then dictate each line into the command field. Dictation that arrives all at once is sent automatically; otherwise press Enter.
1. "New campaign." Then "select specter one." Then "launch the mission."
2. "Start engines."
3. "Taxi to the runway."
4. "Take off." The autopilot climbs on runway heading.
5. "Gear up and throttle eighty percent."
6. "Heading two seven zero, climb to five thousand feet."
7. "Cockpit view." Then "next camera angle."
8. "Bogey dope." Then "status report."
9. "Cover me." The wingman covers you.
10. "Land the aircraft." Autoland costs 300 score points, and the game says so.

## Be honest in the recording
- Say that Wispr Flow types into the game's command line, and that the game parses the text itself.
- If a command isn't understood, show the red "not understood" message and rephrase. Don't cut it out.
- Don't claim the whole game was written by voice unless it was.
