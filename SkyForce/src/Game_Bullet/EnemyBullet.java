/*
 * A projectile fired by the boss (regular enemies stay contact-only, same
 * as before). Moves in pixels-per-tick like the rest of this codebase's
 * entities (Bullet, Enemy), not delta-time - kept consistent on purpose.
 */
package Game_Bullet;

import java.awt.Color;
import java.awt.Graphics;

public class EnemyBullet {
    private int x;
    private int y;
    private final int vx;
    private final int vy;

    public EnemyBullet(int x, int y, int vx, int vy){
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
    }

    public void tick(){
        x += vx;
        y += vy;
    }

    public int getX(){ return x; }
    public int getY(){ return y; }

    public void render(Graphics g){
        g.setColor(new Color(255, 93, 115));
        g.fillOval(x-4, y-4, 8, 8);
    }
}
