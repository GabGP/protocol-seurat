package seurat.core.shared.observe;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import seurat.core.shared.config.SeuratConstants;

/**
 * Gives every work=, file= and zip= value in a log line the same width, so the columns after it line up:
 * a longer name is cut and ends in "...", a shorter one is padded when more text follows it.
 */
final class LogNames {
    private static final String ELLIPSIS = "...";
    private static final Pattern NAME = Pattern.compile("(?<![\\w-])((?:work|file|zip)=)([^\\s:]+)");

    private LogNames() {}

    /** A log line: every name the same width. */
    static String fit(String msg) {
        return fit(msg, true);
    }

    /** The sticky bar, where width is scarce: long names are cut, short ones left as they are. */
    static String cut(String msg) {
        return fit(msg, false);
    }

    private static String fit(String msg, boolean pad) {
        if (msg == null || msg.indexOf('=') < 0) {
            return msg;
        }
        int width = SeuratConstants.LOG_NAME_WIDTH;
        Matcher m = NAME.matcher(msg);
        StringBuilder out = new StringBuilder(msg.length());
        while (m.find()) {
            String name = m.group(2);
            if (name.length() > width) {
                name = name.substring(0, width - ELLIPSIS.length()) + ELLIPSIS;
            } else if (pad && m.end() < msg.length() && msg.charAt(m.end()) == ' ') {
                name = name + " ".repeat(width - name.length());
            }
            m.appendReplacement(out, Matcher.quoteReplacement(m.group(1) + name));
        }
        return m.appendTail(out).toString();
    }
}
