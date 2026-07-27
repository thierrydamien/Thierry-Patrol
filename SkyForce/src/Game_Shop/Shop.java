/*
 * The Armory / shop screen. Built entirely in code (no NetBeans .form file)
 * so it's safe to hand-edit and won't be clobbered by reopening a designer
 * file that doesn't know about it. If you want to move it into the visual
 * GUI Builder later, you'll need to recreate it there from scratch.
 */
package Game_Shop;

import Game_Menu.Menu;
import java.awt.Color;
import java.awt.Font;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.logging.Level;
import java.util.logging.Logger;
import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JTextField;

public class Shop extends JFrame {

    private static final int SPREAD_COST = 150;
    private static final int RAPID_COST = 120;
    private static final int SHIELD_COST = 100;
    private static final int LIFE_COST = 80;
    private static final int MAX_EXTRA_LIVES = 3;

    private static final String[] SHIP_COLORS = {
        "#3399ff", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12", "#ff66b3"
    };

    private int money;
    private boolean hasSpread;
    private boolean hasRapid;
    private boolean hasShield;
    private int extraLives;
    private String callsign;
    private String shipColor;

    private JLabel moneyLabel;
    private JButton spreadBtn, rapidBtn, shieldBtn, lifeBtn;
    private JTextField callsignField;
    private JButton[] colorSwatches;

    public Shop() {
        setTitle("Armory - " + Menu.Uname);
        setSize(400, 560);
        setLocation(500, 120);
        setResizable(false);
        setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        getContentPane().setLayout(null);
        getContentPane().setBackground(new Color(12, 12, 16));

        loadWallet();
        buildUi();
    }

    private void buildUi() {
        JLabel title = new JLabel("ARMORY");
        title.setForeground(Color.white);
        title.setFont(new Font("Arial", Font.BOLD, 26));
        title.setBounds(120, 12, 200, 30);
        getContentPane().add(title);

        moneyLabel = new JLabel();
        moneyLabel.setForeground(new Color(255, 210, 60));
        moneyLabel.setFont(new Font("Arial", Font.BOLD, 16));
        moneyLabel.setBounds(120, 46, 250, 22);
        getContentPane().add(moneyLabel);

        JLabel callsignLabel = new JLabel("CALLSIGN");
        callsignLabel.setForeground(Color.lightGray);
        callsignLabel.setFont(new Font("Arial", Font.PLAIN, 11));
        callsignLabel.setBounds(70, 76, 200, 16);
        getContentPane().add(callsignLabel);

        callsignField = new JTextField(callsign);
        callsignField.setBounds(70, 94, 170, 28);
        getContentPane().add(callsignField);

        JButton saveCallsignBtn = new JButton("SAVE");
        saveCallsignBtn.setBounds(250, 94, 80, 28);
        saveCallsignBtn.setBackground(new Color(60, 60, 60));
        saveCallsignBtn.setForeground(Color.white);
        saveCallsignBtn.addActionListener(e -> saveCallsign());
        getContentPane().add(saveCallsignBtn);

        JLabel gearLabel = new JLabel("WEAPONS & GEAR");
        gearLabel.setForeground(Color.lightGray);
        gearLabel.setFont(new Font("Arial", Font.PLAIN, 11));
        gearLabel.setBounds(70, 132, 200, 16);
        getContentPane().add(gearLabel);

        spreadBtn = makeItemButton(150);
        spreadBtn.addActionListener(e -> buy("spread"));
        getContentPane().add(spreadBtn);

        rapidBtn = makeItemButton(198);
        rapidBtn.addActionListener(e -> buy("rapid"));
        getContentPane().add(rapidBtn);

        shieldBtn = makeItemButton(246);
        shieldBtn.addActionListener(e -> buy("shield"));
        getContentPane().add(shieldBtn);

        lifeBtn = makeItemButton(294);
        lifeBtn.addActionListener(e -> buy("life"));
        getContentPane().add(lifeBtn);

        JLabel colorLabel = new JLabel("SHIP COLOR");
        colorLabel.setForeground(Color.lightGray);
        colorLabel.setFont(new Font("Arial", Font.PLAIN, 11));
        colorLabel.setBounds(70, 344, 200, 16);
        getContentPane().add(colorLabel);

        colorSwatches = new JButton[SHIP_COLORS.length];
        int swX = 70;
        for (int i = 0; i < SHIP_COLORS.length; i++) {
            final String hex = SHIP_COLORS[i];
            JButton swatch = new JButton();
            swatch.setBounds(swX, 364, 36, 36);
            swatch.setBackground(Color.decode(hex));
            swatch.addActionListener(e -> {
                shipColor = hex;
                saveWallet();
                refreshLabels();
            });
            colorSwatches[i] = swatch;
            getContentPane().add(swatch);
            swX += 44;
        }

        JButton back = new JButton("BACK TO MENU");
        back.setBounds(100, 424, 200, 40);
        back.setBackground(new Color(60, 60, 60));
        back.setForeground(Color.white);
        back.addActionListener(e -> {
            this.dispose();
            new Menu(Menu.Uname).setVisible(true);
        });
        getContentPane().add(back);

        refreshLabels();
    }

    private JButton makeItemButton(int y) {
        JButton b = new JButton();
        b.setBounds(70, y, 260, 42);
        b.setBackground(new Color(121, 28, 21));
        b.setForeground(Color.white);
        return b;
    }

    private void refreshLabels() {
        moneyLabel.setText("MONEY: $" + money);

        spreadBtn.setText(hasSpread ? "Spread Shot - OWNED" : "Spread Shot - $" + SPREAD_COST);
        spreadBtn.setEnabled(!hasSpread);

        rapidBtn.setText(hasRapid ? "Rapid Fire - OWNED" : "Rapid Fire - $" + RAPID_COST);
        rapidBtn.setEnabled(!hasRapid);

        shieldBtn.setText(hasShield ? "Energy Shield - OWNED" : "Energy Shield - $" + SHIELD_COST);
        shieldBtn.setEnabled(!hasShield);

        boolean maxedLives = extraLives >= MAX_EXTRA_LIVES;
        lifeBtn.setText(maxedLives
            ? "Extra Life - MAXED (" + extraLives + "/" + MAX_EXTRA_LIVES + ")"
            : "Extra Life - $" + LIFE_COST + " (" + extraLives + "/" + MAX_EXTRA_LIVES + ")");
        lifeBtn.setEnabled(!maxedLives);

        for (int i = 0; i < SHIP_COLORS.length; i++) {
            boolean selected = SHIP_COLORS[i].equalsIgnoreCase(shipColor);
            colorSwatches[i].setBorder(selected
                ? BorderFactory.createLineBorder(Color.white, 3)
                : BorderFactory.createLineBorder(Color.darkGray, 1));
        }
    }

    private void loadWallet() {
        try {
            Class.forName("com.mysql.jdbc.Driver");
            Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/skyforce?", "root", "");
            conn.createStatement().execute(
                "INSERT IGNORE INTO wallet (username, money, has_spread, has_rapid, has_shield, extra_lives) VALUES ('" + Menu.Uname + "', 0, 0, 0, 0, 0)"
            );
            ResultSet rs = conn.createStatement().executeQuery(
                "SELECT money, has_spread, has_rapid, has_shield, extra_lives, callsign, ship_color FROM wallet WHERE username = '" + Menu.Uname + "'"
            );
            if (rs.next()) {
                money = rs.getInt("money");
                hasSpread = rs.getInt("has_spread") == 1;
                hasRapid = rs.getInt("has_rapid") == 1;
                hasShield = rs.getInt("has_shield") == 1;
                extraLives = rs.getInt("extra_lives");
                callsign = rs.getString("callsign");
                shipColor = rs.getString("ship_color");
            }
            if (callsign == null || callsign.trim().isEmpty()) {
                callsign = Menu.Uname;
            }
            if (shipColor == null || shipColor.trim().isEmpty()) {
                shipColor = SHIP_COLORS[0];
            }
            conn.close();
        } catch (ClassNotFoundException | SQLException ex) {
            Logger.getLogger(Shop.class.getName()).log(Level.SEVERE, null, ex);
            callsign = Menu.Uname;
            shipColor = SHIP_COLORS[0];
        }
    }

    private void buy(String item) {
        int cost;
        switch (item) {
            case "spread": cost = SPREAD_COST; break;
            case "rapid":  cost = RAPID_COST; break;
            case "shield": cost = SHIELD_COST; break;
            case "life":   cost = LIFE_COST; break;
            default: return;
        }
        if (money < cost) {
            JOptionPane.showMessageDialog(this, "Not enough money.", "Armory", JOptionPane.WARNING_MESSAGE);
            return;
        }
        money -= cost;
        switch (item) {
            case "spread": hasSpread = true; break;
            case "rapid":  hasRapid = true; break;
            case "shield": hasShield = true; break;
            case "life":   extraLives = Math.min(extraLives + 1, MAX_EXTRA_LIVES); break;
        }
        saveWallet();
        refreshLabels();
    }

    private void saveCallsign() {
        String newName = callsignField.getText().trim();
        if (newName.isEmpty()) {
            JOptionPane.showMessageDialog(this, "Callsign can't be empty.", "Armory", JOptionPane.WARNING_MESSAGE);
            callsignField.setText(callsign);
            return;
        }
        callsign = newName;
        saveWallet();
        JOptionPane.showMessageDialog(this, "Callsign saved!", "Armory", JOptionPane.INFORMATION_MESSAGE);
    }

    private void saveWallet() {
        try {
            Class.forName("com.mysql.jdbc.Driver");
            Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/skyforce?", "root", "");
            String q = "UPDATE wallet SET money=" + money
                    + ", has_spread=" + (hasSpread ? 1 : 0)
                    + ", has_rapid=" + (hasRapid ? 1 : 0)
                    + ", has_shield=" + (hasShield ? 1 : 0)
                    + ", extra_lives=" + extraLives
                    + ", callsign=" + quote(callsign)
                    + ", ship_color=" + quote(shipColor)
                    + " WHERE username='" + Menu.Uname + "'";
            conn.createStatement().executeUpdate(q);
            conn.close();
        } catch (ClassNotFoundException | SQLException ex) {
            Logger.getLogger(Shop.class.getName()).log(Level.SEVERE, null, ex);
        }
    }

    /** Minimal single-quote escaping for the plain string-concatenated SQL used throughout this project. */
    private String quote(String s) {
        if (s == null) {
            return "NULL";
        }
        return "'" + s.replace("'", "''") + "'";
    }
}
