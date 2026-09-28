package seurat.observe;

import seurat.kit.TestKit;

/** Colours only add escape codes: stripped, a styled line is the plain one. */
public final class LogStyleTest {
    private static final String ESC = "\u001B[";

    public static void main(String[] args) {
        String info = LogStyle.message(LogLevel.INFO, "work=venus ESTADO state=PINTANDO progress=40% file=OLD_V.tif");
        TestKit.check(plain(info).equals("work=venus ESTADO state=PINTANDO progress=40% file=OLD_V.tif"), "same text");
        TestKit.check(info.startsWith(ESC + "94mwork=venus" + ESC + "39m"), "subject coloured: " + info);
        TestKit.check(info.contains(ESC + "1mESTADO" + ESC + "22m"), "protocol name bold");
        TestKit.check(info.contains("=" + ESC + "1mPINTANDO" + ESC + "22m"), "protocol value bold");
        TestKit.check(info.contains(ESC + "2mprogress" + ESC + "22m=40%"), "key dimmed, value plain");
        TestKit.check(info.contains("=OLD_V.tif"), "no bold inside a file name");

        String canvas = LogStyle.message(LogLevel.DEBUG, "s7/c3 opened size=4x4");
        TestKit.check(canvas.startsWith(ESC + "94ms7/c3" + ESC + "39m opened "), "session subject: " + canvas);
        String server = LogStyle.message(LogLevel.INFO, "listening port=8180");
        TestKit.check(server.startsWith("listening "), "a server-wide line has no subject: " + server);

        String warn = LogStyle.message(LogLevel.WARN, "s7 closed reason=ERR_PROTOCOLO");
        TestKit.check(warn.startsWith(ESC + "33m" + ESC + "1ms7" + ESC + "22m"), "WARN tints, subject bold: " + warn);
        TestKit.check(!warn.contains(ESC + "0m") && !warn.contains(ESC + "39m"), "no reset drops the tint");
        TestKit.check(LogStyle.message(LogLevel.ERROR, "boom").startsWith(ESC + "31m"), "ERROR tints red");

        String line = LogStyle.line(LogLevel.INFO, "ts", "INFO ", "tag       ", "x");
        TestKit.check(plain(line).equals("ts INFO  [tag       ] x") && line.endsWith(ESC + "0m"), "frame: " + line);
        System.out.println("LogStyleTest OK");
    }

    private static String plain(String styled) {
        return styled.replaceAll("\u001B\\[[0-9;]*m", "");
    }
}
