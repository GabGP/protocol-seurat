package seurat.observe;

import seurat.config.SeuratConstants;
import seurat.config.Units;

/** Text pieces of the progress line: the bar, the ETA, the terminal width and the wipe. */
final class ProgressRender {
    private ProgressRender() {}

    static String bar(int pct) {
        int cells = SeuratConstants.PROGRESS_BAR_CELLS;
        int full = pct * cells / Units.PERCENT;
        return "[" + "#".repeat(full) + "-".repeat(cells - full) + "]";
    }

    /** " eta=…" to the whole second once the phase has run long enough to extrapolate; "" when under a second. */
    static String eta(int pct, long elapsedMs) {
        if (pct <= 0 || pct >= Units.PERCENT || elapsedMs < SeuratConstants.PROGRESS_ETA_MIN_MS) {
            return "";
        }
        long seconds = Math.round(elapsedMs * (Units.PERCENT - pct) / pct / (double) Units.MS_PER_S);
        return seconds > 0 ? " eta=" + LogUnits.duration(seconds * Units.MS_PER_S) : "";
    }

    /** Carriage return, blanks over the widest line can be, carriage return: no escape codes needed. */
    static String wipe() {
        return "\r" + " ".repeat(columns() - 1) + "\r";
    }

    static int columns() {
        try {
            String cols = System.getProperty("seurat.log.columns", System.getenv("COLUMNS"));
            return Math.max(2, Integer.parseInt(cols));
        } catch (NumberFormatException ex) {
            return SeuratConstants.PROGRESS_COLUMNS;
        }
    }
}
