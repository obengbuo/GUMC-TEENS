# Bible Name Scramble — GUMC Teens

A fast multiplayer web game for church teens: unscramble Bible characters' names,
pick the right one out of four, and score as many as you can in **120 seconds**.

## How it plays

1. A short animated intro video plays, then each player types their **full name**.
2. One player taps **Host a new game** and gets a 4-letter code (plus a QR code and link).
   Everyone else joins with that code. The host is just one of the players — no outside admin.
3. When everyone is in, the host presses **START**. Everybody gets the same questions at the same time.
4. Questions 1–5 are warm-ups (level 1). From question 6 the level goes up by **one every question**:
   names get longer and rarer, and the wrong answers start to look more like the right one.
5. **5 points** per correct answer, nothing taken off for a wrong one.
6. After 120 seconds every player sees the full scoreboard on their own screen.

## Data

Nothing is kept. A game only exists while it is being played: as soon as every player has been
shown the scores (or 2 minutes after the round, whichever comes first) the names and scores are deleted.
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
| `app/game.js` | Name list, scrambling, difficulty and scoring (shared by browser and server) |
| `app/public/` | The web app, intro video and font |
| `infra/template.yaml` | AWS resources |
