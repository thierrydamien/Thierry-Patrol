/*
 * The boss encounter, appearing every 3rd level (see GameManager.BOSS_EVERY).
 * Mirrors the web version's design: drops in, patrols side to side, and
 * alternates between two attack patterns by encounter number so the two
 * versions feel like the same game. GameManager owns spawning EnemyBullet
 * instances when readyToShoot() is true - this class just tracks its own
 * position/health/timing, same separation of concerns as Enemy.
 */
package Game_Boss;

import java.awt.Color;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.Polygon;

public class Boss {
    private int x, y;
    private final int targetY;
    private int hp, maxHp;
    private int vx;
    private boolean entering = true;
    private final String pattern; // "aimed" | "spread"
    private int aimStep = 0;
    private long nextShotAt;

    private static final int FIELD_LEFT = 90;
    private static final int FIELD_RIGHT = 410;

    /** bossEncounterNumber: 1 for the first boss (level 3), 2 for the second (level 6), etc. */
    public Boss(int level, int bossEncounterNumber){
        this.x = 250;
        this.y = -90;
        this.targetY = 100;
        this.maxHp = 20 + level*8;
        this.hp = maxHp;
        this.vx = 2 + Math.min(level/3, 4);
        this.pattern = (bossEncounterNumber % 2 == 0) ? "aimed" : "spread";
        this.nextShotAt = System.currentTimeMillis() + 1200;
    }

    public void tick(){
        if(entering){
            y += 4;
            if(y >= targetY){ y = targetY; entering = false; }
            return;
        }
        x += vx;
        if(x < FIELD_LEFT || x > FIELD_RIGHT) vx = -vx;
    }

    public boolean readyToShoot(){
        return !entering && System.currentTimeMillis() >= nextShotAt;
    }

    /** Called by GameManager right after it creates this shot's bullet(s). */
    public void scheduleNextShot(){
        if("aimed".equals(pattern)){
            aimStep++;
            nextShotAt = System.currentTimeMillis() + (aimStep % 3 == 0 ? 900 : 220);
        } else {
            nextShotAt = System.currentTimeMillis() + 1300;
        }
    }

    public void hit(){ hp--; }
    public boolean isDead(){ return hp <= 0; }
    public boolean isEntering(){ return entering; }

    public int getX(){ return x; }
    public int getY(){ return y; }
    public String getPattern(){ return pattern; }

    public void render(Graphics g){
        Color color = "aimed".equals(pattern) ? new Color(168,85,247) : new Color(255,45,85);
        Graphics2D g2 = (Graphics2D) g;

        Polygon body = new Polygon();
        int pts = 8;
        for(int i=0;i<pts;i++){
            double a = (Math.PI*2/pts)*i;
            int rad = (i%2==0) ? 34 : 22;
            int px = (int)(x + Math.cos(a)*rad);
            int py = (int)(y + Math.sin(a)*rad*0.75);
            body.addPoint(px, py);
        }
        g2.setColor(color);
        g2.fillPolygon(body);
        g2.setColor(new Color(255,210,60));
        g2.fillOval(x-8, y-8, 16, 16);

        int barW = 140;
        int filled = (int)(barW * Math.max(0, hp/(double)maxHp));
        g2.setColor(new Color(0,0,0,140));
        g2.fillRect(x-barW/2, y-58, barW, 8);
        g2.setColor(color);
        g2.fillRect(x-barW/2, y-58, filled, 8);
    }
}
