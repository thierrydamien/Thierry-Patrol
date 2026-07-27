package Game_Enemy;

import Game_Graphics.loadImage;
import java.awt.Graphics;

public class Enemy {
    private int x;
    private int y;
    private final int speed;

    public Enemy(int x, int y, int speed){
        this.x=x;
        this.y=y;
        this.speed=speed;
    }
    public void tick(){     //speed now comes from the current level's tuning (see GameLevel)
        y += speed;
    }
    public void render(Graphics g){
        g.drawImage(loadImage.enemy, x, y, 45, 45, null);
    }
    public int getX(){
        return x;
    }
    public int getY(){
        return y;
    }
}
