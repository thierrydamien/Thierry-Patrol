/*
 * Procedurally synthesizes short sound effects (square/sawtooth/triangle/sine
 * waves with a linear fade-out envelope) and plays them via javax.sound.sampled.
 * No audio files to bundle or license - same philosophy as the web version's
 * Web Audio synth. Mirrors the same effect palette (shoot, explosion, hit,
 * powerup, level-clear, boss alert/defeat, combo, achievement, game over)
 * so both versions feel like the same game.
 *
 * Each call spins up a short-lived background thread so it never blocks the
 * game loop. That's fine for a casual family game's sound volume; if this
 * ever needs to scale to heavier sound spam, switch to a small thread pool
 * or a persistent SourceDataLine instead of one-thread-per-sound.
 */
package Game_Audio;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.SourceDataLine;

public class SoundEngine {

    private static final float SAMPLE_RATE = 44100f;
    private static volatile boolean muted = false;

    public static void setMuted(boolean m) { muted = m; }
    public static boolean isMuted() { return muted; }

    /** waveType: "sine" | "square" | "sawtooth" | "triangle" */
    public static void playTone(double freqStart, double freqEnd, double durationSec, String waveType, double gain) {
        if (muted) return;
        new Thread(() -> renderAndPlay(freqStart, freqEnd, durationSec, waveType, gain)).start();
    }

    /** Plays a short sequence of tones back-to-back on one background thread (for arpeggio-style cues). */
    public static void playSequence(double[] freqs, double durationSec, String waveType, double gain) {
        if (muted) return;
        new Thread(() -> {
            for (double f : freqs) {
                renderAndPlay(f, f, durationSec, waveType, gain);
                try { Thread.sleep((long) (durationSec * 550)); } catch (InterruptedException ignored) { }
            }
        }).start();
    }

    private static void renderAndPlay(double freqStart, double freqEnd, double durationSec, String waveType, double gain) {
        try {
            int totalSamples = (int) (durationSec * SAMPLE_RATE);
            if (totalSamples <= 0) return;
            byte[] buf = new byte[totalSamples * 2]; // 16-bit mono, little-endian
            for (int i = 0; i < totalSamples; i++) {
                double t = i / SAMPLE_RATE;
                double progress = i / (double) totalSamples;
                double freq = freqStart + (freqEnd - freqStart) * progress;
                double phase = freq * t;
                double sample;
                switch (waveType) {
                    case "square":
                        sample = Math.signum(Math.sin(2 * Math.PI * phase));
                        break;
                    case "sawtooth":
                        sample = 2 * (phase - Math.floor(phase + 0.5));
                        break;
                    case "triangle":
                        sample = 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1;
                        break;
                    default:
                        sample = Math.sin(2 * Math.PI * phase);
                }
                double envelope = 1.0 - progress; // simple linear fade-out avoids clicks at the tail
                short val = (short) (sample * gain * envelope * Short.MAX_VALUE);
                buf[i * 2] = (byte) (val & 0xFF);
                buf[i * 2 + 1] = (byte) ((val >> 8) & 0xFF);
            }
            AudioFormat format = new AudioFormat(SAMPLE_RATE, 16, 1, true, false);
            SourceDataLine line = AudioSystem.getSourceDataLine(format);
            line.open(format);
            line.start();
            line.write(buf, 0, buf.length);
            line.drain();
            line.close();
        } catch (Exception e) {
            // No audio device available (or line busy) - fail silently rather than crash the game.
        }
    }

    // ---- Named effects, matching the web version's palette ----
    public static void playShoot()          { playTone(760, 420, 0.06, "square", 0.25); }
    public static void playExplosion(boolean big) { playTone(big ? 220 : 300, big ? 25 : 40, big ? 0.32 : 0.22, "sawtooth", 0.3); }
    public static void playHit()            { playTone(140, 55, 0.2, "sawtooth", 0.3); }
    public static void playPowerup()        { playSequence(new double[]{523, 659, 784}, 0.08, "square", 0.22); }
    public static void playBomb()           { playTone(90, 20, 0.4, "sawtooth", 0.35); }
    public static void playLevelClear()     { playSequence(new double[]{392, 523, 659, 784}, 0.1, "triangle", 0.25); }
    public static void playBossAlert()      { playSequence(new double[]{220, 180, 220, 180}, 0.18, "sawtooth", 0.28); }
    public static void playBossDefeat()     { playSequence(new double[]{392, 494, 587, 784, 988}, 0.16, "triangle", 0.28); }
    public static void playCombo(int comboCount) { playTone(480 + Math.min(comboCount, 15) * 30, 480 + Math.min(comboCount, 15) * 30, 0.06, "square", 0.2); }
    public static void playAchievement()    { playSequence(new double[]{660, 880, 1108}, 0.11, "sine", 0.25); }
    public static void playGameOver()       { playSequence(new double[]{392, 330, 220}, 0.3, "sawtooth", 0.28); }
}
