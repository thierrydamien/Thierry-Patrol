/*
 * Defines per-level difficulty and reward tuning.
 * Named GameLevel (not "Level") to avoid clashing with java.util.logging.Level,
 * which several classes in this project already import.
 */
package Game_Level;

public class GameLevel {

    public final int number;
    public final int enemySpeed;      // pixels added to enemy.y per tick
    public final int enemiesPerWave;  // enemies spawned each spawn cycle
    public final long spawnDelayMs;   // ms between spawn cycles
    public final int killsToClear;    // enemies to kill before advancing
    public final int clearBonus;      // money awarded on level clear

    private GameLevel(int number, int enemySpeed, int enemiesPerWave, long spawnDelayMs, int killsToClear, int clearBonus) {
        this.number = number;
        this.enemySpeed = enemySpeed;
        this.enemiesPerWave = enemiesPerWave;
        this.spawnDelayMs = spawnDelayMs;
        this.killsToClear = killsToClear;
        this.clearBonus = clearBonus;
    }

    // Hand-tuned levels 1-5. Feel free to adjust these numbers directly.
    private static final GameLevel[] LEVELS = new GameLevel[] {
        new GameLevel(1, 2,  2, 2000, 15, 50),
        new GameLevel(2, 4,  3, 1700, 20, 75),
        new GameLevel(3, 6,  3, 1400, 25, 100),
        new GameLevel(4, 9,  4, 1200, 30, 150),
        new GameLevel(5, 12, 4, 1000, 40, 250),
    };

    public static int maxDesignedLevel() {
        return LEVELS.length;
    }

    /**
     * Returns the tuning for the given level number (1-indexed).
     * Beyond the hand-designed levels, difficulty keeps scaling endlessly
     * off the last designed level so the game doesn't just stop.
     */
    public static GameLevel get(int levelNumber) {
        if (levelNumber <= LEVELS.length) {
            return LEVELS[levelNumber - 1];
        }
        GameLevel base = LEVELS[LEVELS.length - 1];
        int extra = levelNumber - LEVELS.length;
        return new GameLevel(
            levelNumber,
            base.enemySpeed + extra * 2,
            Math.min(base.enemiesPerWave + extra / 2, 8),
            Math.max(base.spawnDelayMs - extra * 40, 400),
            base.killsToClear + extra * 10,
            base.clearBonus + extra * 50
        );
    }
}
