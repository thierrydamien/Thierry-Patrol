-- Run this against the existing `skyforce` database (the same one the
-- login/highscore screens already use) before playing the updated game.
--
--   mysql -u root -p skyforce < schema_updates.sql
--
-- It only adds a new table / columns; nothing existing is touched.

USE skyforce;

CREATE TABLE IF NOT EXISTS wallet (
    username     VARCHAR(50) PRIMARY KEY,
    money        INT NOT NULL DEFAULT 0,
    has_spread   TINYINT NOT NULL DEFAULT 0,
    has_rapid    TINYINT NOT NULL DEFAULT 0,
    has_shield   TINYINT NOT NULL DEFAULT 0,
    extra_lives  INT NOT NULL DEFAULT 0,
    callsign     VARCHAR(50) DEFAULT NULL,
    ship_color   VARCHAR(7) NOT NULL DEFAULT '#3399ff',
    FOREIGN KEY (username) REFERENCES user(username)
);

-- If you already ran an earlier version of this file and the wallet table
-- already exists without these two columns, run these two lines instead
-- (they'll error harmlessly if the columns are already there):
-- ALTER TABLE wallet ADD COLUMN callsign VARCHAR(50) DEFAULT NULL;
-- ALTER TABLE wallet ADD COLUMN ship_color VARCHAR(7) NOT NULL DEFAULT '#3399ff';

