# Bible Name Scramble — GUMC Teens

A fast multiplayer web game for church teens. Each round is **120 seconds**: answer as many
four-choice questions as you can, **5 points** each, nothing taken off for a wrong one.

## How it plays

1. A short animated intro video plays, then each player types their **full name**.
2. One player taps **Host a new game** and gets a 4-letter code (plus a QR code and link).
   Everyone else joins with that code. The host is just one of the players — no outside admin.
3. The host picks the **category** and whether to play as **individuals or teams**:
   - 🧔 Bible Characters, 📖 Books of the Bible, 🗺️ Bible Places — unscramble the name
   - 🕵️ Who Am I? — read a clue ("I spent three days inside a great fish") and pick the person
   - Teams: 2–4 teams (Lions, Eagles, Doves, Lambs). Players are dealt out evenly and can switch
     in the lobby. Teams are ranked by average points per player, so uneven teams stay fair.
4. When everyone is in, the host presses **START**. Everybody gets the same questions at the same time.
5. Questions 1–5 are warm-ups (level 1). From question 6 the level goes up by **one every question**.
6. After 120 seconds every player sees the scoreboard on their own screen.
7. **Play another round** keeps the same players in the room, so the host can pick a new category
   and go again without anyone re-joining.

## Data

Nothing is kept. Scores are erased as soon as every player has been shown them (or one minute
after the round, whichever comes first). Names stay only while the group is still in the room:
the room is deleted when the last player leaves, or after 20 idle minutes.
There are no accounts, cookies or analytics.

## AWS setup

Deliberately tiny, and it costs nothing when nobody is playing:

- **AWS Lambda + Function URL** — serves the page and the small JSON API over HTTPS.
- **DynamoDB (on-demand)** — holds a game's players and scores for the few minutes it is live.

Both are defined in `infra/template.yaml` (CloudFormation).

### Deploy

From AWS CloudShell, or any machine with the AWS CLI signed in:

```bash
git clone https://github.com/obengbuo/GUMC-TEENS.git && cd GUMC-TEENS
./deploy.sh            # optional: ./deploy.sh eu-west-1
```

The script prints the game URL at the end. Re-run it any time to publish changes.
To remove everything: `aws cloudformation delete-stack --stack-name bible-name-scramble`.

Alternatively add `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` as repository secrets and run the
**Deploy to AWS** workflow from the Actions tab.

## Develop

```bash
npm install
npm run dev     # http://localhost:3000 (real Lambda code, in-memory database)
npm test
npm run intro   # re-render the intro video from tools/intro/intro.html (needs Playwright + ffmpeg)
```

| Path | What it is |
| --- | --- |
| `app/index.js` | Lambda handler: static files + API |
| `app/game.js` | Categories, clues, scrambling, difficulty and scoring (shared by browser and server) |
| `app/public/` | The web app, intro video and font |
| `infra/template.yaml` | AWS resources |
