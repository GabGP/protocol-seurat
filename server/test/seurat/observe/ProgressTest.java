package seurat.observe;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import seurat.kit.TestKit;

/** Captured logs get one line per 10 % and no carriage returns; a console gets one sticky line. */
public final class ProgressTest {
    public static void main(String[] args) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Log.setOutput(new PrintStream(bytes, true, StandardCharsets.UTF_8));
        try {
            steps(bytes);
            bytes.reset();
            sticky(bytes);
        } finally {
            Progress.setLive(false);
            Progress.clear();
            Log.setOutput(System.out);
        }
        System.out.println("ProgressTest OK");
    }

    private static void steps(ByteArrayOutputStream bytes) {
        Progress.setLive(false);
        for (int pct = 0; pct <= 100; pct++) {
            Progress.update("catalog", "work=a", pct, "");
            Progress.update("catalog", "work=a", pct, ""); // repeats are ignored
        }
        String out = bytes.toString(StandardCharsets.UTF_8);
        TestKit.check(out.lines().count() == 10, "one INFO line per 10 %: " + out);
        TestKit.check(out.contains("work=a progress=[#####-----] 50%"), "step line shape: " + out);
        TestKit.check(out.replace(System.lineSeparator(), "\n").indexOf('\r') < 0,
                "no carriage return in a captured log beyond the platform line separator");
        bytes.reset();
        Progress.update("catalog", "work=b", 57, " rate=1.0 MiB/s");
        TestKit.check(bytes.toString(StandardCharsets.UTF_8).contains("work=b progress=[#####-----] 57% rate=1.0 MiB/s"),
                "a job that starts past a step reports it");
        Progress.done("work=a");
        Progress.done("work=b");
        TestKit.check(Progress.line().isEmpty(), "done drops the job");
    }

    private static void sticky(ByteArrayOutputStream bytes) {
        Progress.setLive(true);
        Progress.update("catalog", "work=a", 40, "");
        Progress.update("catalog", "work=b", 70, "");
        String bar = "work=a [####------] 40% | work=b [#######---] 70%";
        TestKit.check(Progress.line().equals(bar), "one segment per job, sorted: " + Progress.line());
        bytes.reset();
        Log.info("test", "hello");
        String out = bytes.toString(StandardCharsets.UTF_8);
        TestKit.check(out.startsWith(Progress.wipe()), "log line wipes the bar first");
        TestKit.check(out.endsWith(System.lineSeparator() + bar), "then redraws it below the line");
        TestKit.check(out.contains("hello"), "the line itself");
        Progress.done("work=a");
        Progress.done("work=b");
        bytes.reset();
        Log.info("test", "after");
        out = bytes.toString(StandardCharsets.UTF_8);
        TestKit.check(!out.startsWith("\r") && out.endsWith(System.lineSeparator()), "no bar left: plain line");
    }
}
