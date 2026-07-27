package Game_Player;

import Game_Bullet.Bullet;
import Game_Display.Display;
import Game_Graphics.ImageTint;
import Game_Graphics.loadImage;
import Game_Manager.GameManager;
import java.awt.Graphics;
import java.awt.event.KeyEvent;
import java.awt.event.KeyListener;
import java.awt.image.BufferedImage;

public class Player implements KeyListener {

    private int x;
    private int y;
    private boolean left;
    private boolean right;
    private boolean fire;

    private long current;
    private long delay;
    private int health;

    // Shop-purchased upgrades, set via setUpgrades() before init() is called
    private boolean hasSpread;
    private boolean hasRapid;
    private boolean hasShield;
    private int bonusLives;
    private boolean shieldActive;

    // Personalization, set via setAppearance() before init() is called
    private String callsign;
    private String shipColorHex = "#3399ff";
    private BufferedImage tintedShip;

    public Player(int x, int y) {
        this.x = x;
        this.y = y;
    }

    /** Called by GameManager after loading the player's wallet, before init(). */
    public void setUpgrades(boolean hasSpread, boolean hasRapid, boolean hasShield, int bonusLives) {
        this.hasSpread = hasSpread;
        this.hasRapid = hasRapid;
        this.hasShield = hasShield;
        this.bonusLives = bonusLives;
    }

    /** Called by GameManager with the pilot's callsign and chosen ship color, before init(). */
    public void setAppearance(String callsign, String shipColorHex) {
        this.callsign = callsign;
        if (shipColorHex != null && !shipColorHex.isEmpty()) {
            this.shipColorHex = shipColorHex;
        }
    }

    public String getCallsign() {
        return callsign;
    }

    public void init() {
        Display.frame.addKeyListener(this);
        current = System.nanoTime();
        delay = hasRapid ? 50 : 100;
        health = 3 + bonusLives;
        shieldActive = hasShield;
        tintedShip = ImageTint.tint(loadImage.player, ImageTint.parseHex(shipColorHex));
    }

    public void tick() {
        if (!(health <= 0)) {
            if (left) {
                if (x >= 52) {
                    if(GameManager.score>=200){
                        x-=8;
                    }
                    else
                        x-=4;
                }
            }
            if (right) {
                if (x <= 395) {
                    if(GameManager.score>=200){
                        x += 8;
                    }
                    else
                        x+=4;
                }
            }
            if (fire) {
                long breaks = (System.nanoTime() - current) / 1000000;
                if (breaks > delay) {
                    if (hasSpread) {
                        GameManager.bullet.add(new Bullet(x + 22, y, 0));
                        GameManager.bullet.add(new Bullet(x + 22, y, -4));
                        GameManager.bullet.add(new Bullet(x + 22, y, 4));
                    } else {
                        GameManager.bullet.add(new Bullet(x + 22, y));
                    }
                    current = System.nanoTime();
                }
            }
        }
    }

    public void render(Graphics g) {
        if (!(health <= 0)) {
            g.drawImage(tintedShip, x, y, 50, 50, null);
        }
    }

    /**
     * Consumes the shield if the player has one active, absorbing one hit.
     * Returns true if a hit was absorbed (caller should skip the health loss).
     */
    public boolean consumeShield() {
        if (shieldActive) {
            shieldActive = false;
            return true;
        }
        return false;
    }

    public void keyPressed(KeyEvent e) {
        int source = e.getKeyCode();
        if (source == KeyEvent.VK_LEFT) {
            left = true;
        }
        if (source == KeyEvent.VK_RIGHT) {
            right = true;
        }
        if (source == KeyEvent.VK_SPACE) {
            fire = true;
        }
    }

    public void keyReleased(KeyEvent e) {
        int source = e.getKeyCode();
        if (source == KeyEvent.VK_LEFT) {
            left = false;
        }
        if (source == KeyEvent.VK_RIGHT) {
            right = false;
        }
        if (source == KeyEvent.VK_SPACE) {
            fire = false;
        }
    }

    public void keyTyped(KeyEvent e) {
    }

    public int getX() {
        return x;
    }

    public int getY() {
        return y;
    }

    public int getHealth() {
        return health;
    }

    public void setHealth(int health) {
        this.health = health;
    }
}
