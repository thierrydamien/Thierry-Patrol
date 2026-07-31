package Game_Manager;

import Game_Audio.SoundEngine;
import Game_Boss.Boss;
import Game_Bullet.Bullet;
import Game_Bullet.EnemyBullet;
import static Game_Display.Display.frame;
import Game_Enemy.Enemy;
import Game_Level.GameLevel;
import Game_Menu.Menu;
import Game_Player.Player;
import Game_SetUp.GameSetUp;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics;
import java.util.ArrayList;
import java.util.Random;
import javax.swing.JOptionPane;
import java.sql.*;
import Game_SignIn.SignIn;
import java.util.logging.Level;
import java.util.logging.Logger;

public class GameManager {
    private Player player;
    public static ArrayList<Bullet> bullet;
    
    private ArrayList<Enemy> enemies;
    private long current;
    private int health;
    public static int score;
    private int hscore;
    private String username;

    // --- Level state ---
    private int level;
    private int killsInLevel;
    private GameLevel levelConfig;
    private long bannerUntil; // System.currentTimeMillis() timestamp; banner shows while now < this

    // --- Boss state ---
    private static final int BOSS_EVERY = 3; // a boss appears on levels 3, 6, 9...
    private Boss boss;
    private boolean bossPending; // banner is showing, boss spawns once it ends
    private ArrayList<EnemyBullet> enemyBullets;

    // --- Economy state ---
    private int sessionMoney;  // earned this run, not yet persisted to the DB
    private int walletMoney;   // persisted total, loaded at run start
    private boolean hasSpread, hasRapid, hasShield;
    private int extraLives;

    // --- Personalization state ---
    private String callsign;
    private String shipColorHex;

    // --- Combo state ---
    private int combo;
    private long comboExpiresAt; // System.currentTimeMillis() timestamp; streak breaks once passed
    private static final long COMBO_WINDOW_MS = 1300;

    public GameManager(){
        
    }
    
    public void init(){
        loadWallet();

    	player = new Player((GameSetUp.gameWidth/2)+50,(GameSetUp.gameHeight-50));
        player.setUpgrades(hasSpread, hasRapid, hasShield, extraLives);
        player.setAppearance(callsign, shipColorHex);
        player.init();
        bullet = new ArrayList <Bullet>();
        enemies = new ArrayList <Enemy>();
        enemyBullets = new ArrayList <EnemyBullet>();
        boss = null;
        bossPending = false;
	current = System.nanoTime();
        health = player.getHealth();
        score=0;
        sessionMoney = 0;
        level = 1;
        killsInLevel = 0;
        levelConfig = GameLevel.get(level);
        bannerUntil = 0;
        combo = 0;
        comboExpiresAt = 0;
    }
    public void tick(){
    	player.tick();
        for (int i = 0; i<bullet.size();i++){
            bullet.get(i).tick();
        }
        for (int i = 0; i<enemyBullets.size();i++){
            enemyBullets.get(i).tick();
        }

        if(combo > 0 && System.currentTimeMillis() > comboExpiresAt){
            combo = 0; // streak lapsed
        }

        boolean showingBanner = System.currentTimeMillis() < bannerUntil;

        if(bossPending && !showingBanner){
            int bossEncounterNumber = level / BOSS_EVERY;
            boss = new Boss(level, bossEncounterNumber);
            bossPending = false;
        }

        if(boss != null){
            boss.tick();
            if(boss.readyToShoot()){
                fireBossShot();
                boss.scheduleNextShot();
            }
        }

        if(!showingBanner && boss == null && !bossPending){
            long breaks = (System.nanoTime()-current)/1000000;
            if(breaks > levelConfig.spawnDelayMs){
                for(int i=0; i<levelConfig.enemiesPerWave; i++){
                    Random rand = new Random();
                    int randX= rand.nextInt(450);
                    int randY= -50;//rand.nextInt(450);
                    if(health > 0){
                        enemies.add(new Enemy(randX, randY, levelConfig.enemySpeed));
                    }
                }
                current = System.nanoTime();
            }
        }
        for(int i=0; i<enemies.size(); i++){
            enemies.get(i).tick();
        }
    }

    /** Fires one shot for the current boss according to its pattern; called from tick() when the boss is ready. */
    private void fireBossShot(){
        int bx = boss.getX(), by = boss.getY()+20;
        if("aimed".equals(boss.getPattern())){
            int px = player.getX()+25;
            int dx = px - bx;
            int vx = Math.max(-6, Math.min(6, dx/18));
            enemyBullets.add(new EnemyBullet(bx, by, vx, 7));
        } else {
            enemyBullets.add(new EnemyBullet(bx, by, -4, 6));
            enemyBullets.add(new EnemyBullet(bx, by, 0, 7));
            enemyBullets.add(new EnemyBullet(bx, by, 4, 6));
        }
    }
   
    public void render(Graphics g){
    	player.render(g);
        for (int i = 0; i<bullet.size();i++){
            bullet.get(i).render(g);
        }
        for (int i = 0; i<bullet.size();i++){
            if(bullet.get(i).getY() <= 1){
                    bullet.remove(i);
                    i--;
            }
        }

        for (int i = 0; i<enemyBullets.size();i++){
            enemyBullets.get(i).render(g);
        }
        for (int i = 0; i<enemyBullets.size();i++){
            if(enemyBullets.get(i).getY() >= 640){
                enemyBullets.remove(i);
                i--;
            }
        }

        for(int i=0; i<enemies.size(); i++){
            if(!(enemies.get(i).getX()<=50 || enemies.get(i).getX()>=450-45 || enemies.get(i).getY()>=456)){
                if(enemies.get(i).getY()>=-45){
                    enemies.get(i).render(g);	
                }
            }
	}

        if(boss != null){
            boss.render(g);
        }
        
        for (int i=0;i<enemies.size();i++){
            int ex = enemies.get(i).getX();
            int ey = enemies.get(i).getY();
            
            int px = player.getX();
            int py = player.getY();

            if(((px < ex + 45 && px + 50 > ex && 
                py < ey + 45 && py + 50 > ey) || (ey >= 460)) &&(ex >=50 && ex<=450-45)){
                enemies.remove(i);
                i--;
                damagePlayer();
            }
            
            for(int j=0;j<bullet.size();j++){
                int bx = bullet.get(j).getX();
                int by = bullet.get(j).getY();
                
                if(ex<bx+6 && ex+45>bx && ey<by+6 && ey+45>by){
                    enemies.remove(i);
                    i--;
                    
                    bullet.remove(j);
                    j--;

                    combo++;
                    comboExpiresAt = System.currentTimeMillis() + COMBO_WINDOW_MS;
                    double multiplier = 1.0 + Math.min(combo/3, 4) * 0.5; // caps at x3, matches web version
                    score += Math.round(5*multiplier);
                    sessionMoney += Math.round(2*multiplier);
                    killsInLevel++;
                    SoundEngine.playExplosion(false);
                    if(combo % 3 == 0){
                        SoundEngine.playCombo(combo);
                    }
                    checkLevelClear();
                }
            }
        }

        checkBossCollisions();

        drawHud(g);
    }

    /** Player bullets vs boss, enemy bullets vs player, and boss body vs player (contact damage). */
    private void checkBossCollisions(){
        int px = player.getX(), py = player.getY();

        if(boss != null){
            for(int j=0;j<bullet.size();j++){
                int bx = bullet.get(j).getX();
                int by = bullet.get(j).getY();
                if(Math.abs(bx-boss.getX())<38 && Math.abs(by-boss.getY())<28){
                    bullet.remove(j);
                    j--;
                    boss.hit();
                    SoundEngine.playExplosion(false);
                    if(boss.isDead()){
                        score += 150;
                        sessionMoney += 60;
                        SoundEngine.playBossDefeat();
                        boss = null;
                        advanceLevel(0);
                        break;
                    }
                }
            }
        }

        if(boss != null && !boss.isEntering()){
            if(boss.getX()-40 < px+50 && boss.getX()+40 > px && boss.getY()-30 < py+50 && boss.getY()+30 > py){
                damagePlayer();
            }
        }

        for(int i=0;i<enemyBullets.size();i++){
            int bx = enemyBullets.get(i).getX();
            int by = enemyBullets.get(i).getY();
            if(px < bx+8 && px+50>bx && py<by+8 && py+50>by){
                enemyBullets.remove(i);
                i--;
                damagePlayer();
            }
        }
    }

    /** Applies a hit to the player, letting an active shield absorb it first. */
    private void damagePlayer(){
        if(player.consumeShield()){
            SoundEngine.playHit();
            return;
        }
        health--;
        SoundEngine.playHit();
        if(health<=0){
            SoundEngine.playGameOver();
            enemies.removeAll(enemies);
            player.setHealth(0);
            persistWallet();
            JOptionPane.showMessageDialog(frame,"Your Score :  "+score, "Username :- "+Menu.Uname,JOptionPane.OK_OPTION);
            try {
                Class.forName("com.mysql.jdbc.Driver");
                SignIn.dbConn = DriverManager.getConnection("jdbc:mysql://localhost:3306/skyforce?", "root", "");

                ResultSet query = SignIn.dbConn.createStatement().executeQuery("SELECT `score` FROM highscore WHERE `username` = '" +Menu.Uname+ "'");

                if(query.last()){
                   hscore = query.getInt("score");
                   if (hscore < score)
                   {
                       String q = "UPDATE highscore SET score = '" +score+ "' WHERE username = '" +Menu.Uname+ "'";
                       SignIn.dbConn.prepareStatement(q).execute();
                       JOptionPane.showMessageDialog(frame,"Your New Highscore :  "+score, "Username :- "+Menu.Uname,JOptionPane.OK_OPTION);   
                   }
                }
            }
            catch (ClassNotFoundException | SQLException ex1) {
                Logger.getLogger(SignIn.class.getName()).log(Level.SEVERE, null, ex1);
            }

            frame.setVisible(false);
            new Menu().setVisible(true);
        }
    }

    /** Advances to the next level (from a normal clear or a boss defeat) and shows a brief banner. */
    private void advanceLevel(int bonus){
        sessionMoney += bonus;
        level++;
        killsInLevel = 0;
        levelConfig = GameLevel.get(level);
        enemies.removeAll(enemies);
        enemyBullets.removeAll(enemyBullets);
        if(isBossLevel(level)){
            bannerUntil = System.currentTimeMillis() + 2500;
            bossPending = true;
            SoundEngine.playBossAlert();
        } else {
            bannerUntil = System.currentTimeMillis() + 1800;
            bossPending = false;
            SoundEngine.playLevelClear();
        }
    }

    private boolean isBossLevel(int lvl){
        return lvl % BOSS_EVERY == 0;
    }

    /** Checks whether enough kills have been racked up to clear the current (non-boss) level. */
    private void checkLevelClear(){
        if(boss != null || bossPending) return; // during a boss encounter, only defeating it advances the level
        if(killsInLevel >= levelConfig.killsToClear){
            advanceLevel(levelConfig.clearBonus);
        }
    }

    /** Draws Score/Lives/Level/Money/current-highscore. Runs every frame regardless of enemy count. */
    private void drawHud(Graphics g){
        g.setColor(Color.white);
        g.setFont(new Font("arial", Font.BOLD, 30));
        g.drawString("Score : "+score, 50, 540);

        g.setColor(Color.white);
        g.setFont(new Font("arial", Font.BOLD, 30));
        g.drawString("Lives : "+health, 330, 540);

        g.setColor(new Color(255,210,60));
        g.setFont(new Font("arial", Font.BOLD, 16));
        g.drawString("Pilot " + callsign + "     Level " + level + "     Money: $" + (walletMoney + sessionMoney), 50, 565);

        if(combo >= 3){
            g.setColor(new Color(255,93,115));
            g.setFont(new Font("arial", Font.BOLD, 16));
            g.drawString("COMBO x" + combo, 50, 515);
        }

        try {
            if(SignIn.dbConn != null){
                ResultSet query1 = SignIn.dbConn.createStatement().executeQuery("SELECT username, score FROM highscore ORDER BY score DESC LIMIT 1");
                while(query1.next()){
                    username=query1.getString("username");    
                    hscore = query1.getInt("score");
                }
            }
        } catch (SQLException ex1) {
            Logger.getLogger(GameManager.class.getName()).log(Level.SEVERE, null, ex1);
        }

        g.setColor(Color.yellow);
        g.setFont(new Font("arial", Font.BOLD, 15));
        g.drawString("Current HighScore by "+username+" : "+hscore, 130, 590);

        if(System.currentTimeMillis() < bannerUntil){
            g.setColor(new Color(0,0,0,170));
            g.fillRect(60, 220, 340, 60);
            g.setColor(bossPending ? new Color(255,93,115) : Color.white);
            g.setFont(new Font("arial", Font.BOLD, 22));
            g.drawString(bossPending ? "\u26A0 BOSS INCOMING \u26A0" : "LEVEL " + level + " INCOMING", 90, 258);
        }
    }

    /** Loads (or lazily creates) this user's wallet row: money, upgrades, and personalization. */
    private void loadWallet(){
        try {
            Class.forName("com.mysql.jdbc.Driver");
            Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/skyforce?", "root", "");
            conn.createStatement().execute(
                "INSERT IGNORE INTO wallet (username, money, has_spread, has_rapid, has_shield, extra_lives) VALUES ('" + Menu.Uname + "', 0, 0, 0, 0, 0)"
            );
            ResultSet rs = conn.createStatement().executeQuery(
                "SELECT money, has_spread, has_rapid, has_shield, extra_lives, callsign, ship_color FROM wallet WHERE username = '" + Menu.Uname + "'"
            );
            if(rs.next()){
                walletMoney = rs.getInt("money");
                hasSpread = rs.getInt("has_spread") == 1;
                hasRapid = rs.getInt("has_rapid") == 1;
                hasShield = rs.getInt("has_shield") == 1;
                extraLives = rs.getInt("extra_lives");
                callsign = rs.getString("callsign");
                shipColorHex = rs.getString("ship_color");
            }
            if(callsign == null || callsign.trim().isEmpty()){
                callsign = Menu.Uname;
            }
            conn.close();
        } catch (ClassNotFoundException | SQLException ex) {
            Logger.getLogger(GameManager.class.getName()).log(Level.SEVERE, null, ex);
            callsign = Menu.Uname;
        }
    }

    /** Adds this run's earned money onto the persisted wallet total. Called once, on game over. */
    private void persistWallet(){
        try {
            Class.forName("com.mysql.jdbc.Driver");
            Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/skyforce?", "root", "");
            int total = walletMoney + sessionMoney;
            conn.createStatement().executeUpdate("UPDATE wallet SET money=" + total + " WHERE username='" + Menu.Uname + "'");
            conn.close();
            walletMoney = total;
            sessionMoney = 0;
        } catch (ClassNotFoundException | SQLException ex) {
            Logger.getLogger(GameManager.class.getName()).log(Level.SEVERE, null, ex);
        }
    }
}
