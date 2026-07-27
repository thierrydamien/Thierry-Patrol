/*
 * Recolors a sprite to a target color while preserving its original shading.
 * Only the hue is replaced; saturation and brightness come from the source
 * pixel, so highlights/shadows on the ship art still look right in any color.
 */
package Game_Graphics;

import java.awt.Color;
import java.awt.image.BufferedImage;

public class ImageTint {

    public static BufferedImage tint(BufferedImage src, Color targetColor) {
        int w = src.getWidth(), h = src.getHeight();
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        float[] targetHsb = Color.RGBtoHSB(targetColor.getRed(), targetColor.getGreen(), targetColor.getBlue(), null);

        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int argb = src.getRGB(x, y);
                int alpha = (argb >>> 24) & 0xFF;
                if (alpha == 0) {
                    out.setRGB(x, y, argb);
                    continue;
                }
                int r = (argb >> 16) & 0xFF, g = (argb >> 8) & 0xFF, b = argb & 0xFF;
                float[] hsb = Color.RGBtoHSB(r, g, b, null);
                int rgb = Color.HSBtoRGB(targetHsb[0], hsb[1], hsb[2]);
                out.setRGB(x, y, (alpha << 24) | (rgb & 0x00FFFFFF));
            }
        }
        return out;
    }

    /** Parses "#rrggbb" safely, falling back to a default blue if malformed. */
    public static Color parseHex(String hex) {
        try {
            return Color.decode(hex);
        } catch (Exception e) {
            return new Color(0x33, 0x99, 0xff);
        }
    }
}
