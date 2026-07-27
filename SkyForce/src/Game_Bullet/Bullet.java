package Game_Bullet;

import Game_Graphics.loadImage;
import java.awt.Color;
import java.awt.Graphics;

public class Bullet {
    private int x;
    private int y;
    private int speed;
    private final int vx; // horizontal drift per tick, used by the spread-shot weapon

    public Bullet(int x, int y){
        this(x, y, 0);
    }

    public Bullet(int x, int y, int vx){
        this.x = x;
        this.y = y;
        this.vx = vx;
        speed = 10;
    }

    public void tick(){
        y -= speed;
        x += vx;
    }
    public int getY(){
	return y;
    }
    public int getX(){
	return x;
    }

    public void render(Graphics g){
        g.drawImage(loadImage.bullet, x, y, 6, 10, null);
    }
}
