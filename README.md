[README.md](https://github.com/user-attachments/files/29276613/README.2.md)
# Pachinko — Physics & Reward Simulator

> **Disclaimer: This is an educational physics simulation, not a real pachinko machine or gambling tool. Its simplified results are for testing board ideas only and do not guarantee real-world payouts, profit, or outcomes.**

A browser-based pachinko physics simulator where you place pegs, launch balls, and watch gravity and bounces decide where they land. Change the board and launch settings, then compare the estimated reward with the results from real simulated shots.

<img width="1346" height="759" alt="Screenshot 2026-06-23 at 11 57 50 PM" src="https://github.com/user-attachments/assets/7e46edda-16ce-4d89-8f4c-f9f86cf36772" />

## What you can do

- Build and edit a peg board by dragging pegs, using free placement or a guided grid.
- Set hole widths and rewards at the bottom of the board.
- Change launch force, force range, and direction through a full 360°.
- Adjust gravity and bounce strength.
- Preview one shot or run a session with single, auto, or hold-to-fire modes.
- See the expected reward and each hole’s estimated chance, then compare them with actual session results.
- Save layouts in the browser or import and export them as JSON files.

## Run it

No install or package manager is needed.

1. Download or clone this project.
2. Unzip 
3. Open `index.html` in a modern desktop browser.

You can also run a small local server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## How to use

1. Start with the default Pascal-style peg board or move pegs to make your own layout.
2. Set the minimum and maximum launch force, then choose a launch direction.
3. Press **Preview** to watch one ball, or press **Start** and use **Shoot** / `Space` to run a session.
4. Check **Expected Reward** for the calculated estimate and compare it with the session average after several shots.
5. Use **Save**, **Load**, **Export JSON**, or **Import JSON** under **Advanced** to keep your setup.

## Physics and reward model

The ball simulation uses gravity, wall bounces, and peg collisions. Each simulated ball follows the same physics settings, but its force can be randomly picked from the selected range. The expected reward is estimated by testing many forces across that range and averaging the rewards they produce.


## License

MIT — see [LICENSE](LICENSE).
