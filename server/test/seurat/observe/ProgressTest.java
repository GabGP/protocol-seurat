package seurat.observe;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import seurat.kit.TestKit;

/** Captured logs get one line per 10 % of a phase and no carriage returns; a console gets one sticky line. */
public final class ProgressTest {
    public static void main(String[] args) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Log.setOutput(new PrintStream(bytes, true, StandardCharsets.UTF_8));
        try {
            steps(bytes);
            bytes.reset();
            phases(bytes);
            bytes.reset();
            sticky(bytes);
            eta();
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
            Progress.update("ingest", "work=a", "painting", pct, "");
            Progress.update("ingest", "work=a", "painting", pct, ""); // repeats are ignored
        }
        String out = bytes.toString(StandardCharsets.UTF_8);
        TestKit.check(out.lines().count() == 10, "one INFO line per 10 %: " + out);
        TestKit.check(out.contains("work=a painting progress=[#####-----] 50%"), "step line shape: " + out);
        TestKit.check(out.replace(System.lineSeparator(), "\n").indexOf('\r') < 0,
                "no carriage return in a captured log beyond the platform line separator");
        bytes.reset();
        Progress.update("ingest", "work=b", "unzipping", 57, " rate=1.0 MiB/s");
        TestKit.check(bytes.toString(StandardCharsets.UTF_8).contains(
                "work=b unzipping progress=[#####-----] 57% rate=1.0 MiB/s"), "a job that starts past a step reports it");
        Progress.done("work=a");
        Progress.done("work=b");
        TestKit.check(Progress.line().isEmpty(), "done drops the job");
    }

    private static void phases(ByteArrayOutputStream bytes) {
        Progress.update("ingest", "work=b", "unzipping", 90, "");
        bytes.reset();
        Progress.update("ingest", "work=b", "painting", 5, "");
        TestKit.check(bytes.size() == 0, "a new phase restarts its steps: 5 % is below the first");
        Progress.update("ingest", "work=b", "painting", 12, "");
        TestKit.check(bytes.toString(StandardCharsets.UTF_8).contains("work=b painting progress=[#---------] 12%"),
                "then reports its own first step: " + bytes);
        bytes.reset();
        Progress.phase("ingest", "work=b", "finishing", "");
        TestKit.check(bytes.size() == 0, "an open-ended phase is DEBUG only: " + bytes);
        Progress.done("work=b");
    }

    private static void sticky(ByteArrayOutputStream bytes) {
        Progress.setLive(true);
        Progress.queue("ingest", "work=0");
        Progress.update("ingest", "work=a", "painting", 40, "");
        Progress.update("ingest", "work=b", "unzipping", 70, "");
        Progress.queue("ingest", "work=c");
        String bar = "work=a painting [####------] 40% | work=b unzipping [#######---] 70% | queued=2";
        String line = Progress.line();
        TestKit.check(bar.startsWith(line) && line.contains("| work=b unzipping [#######---] 70%"),
                "running jobs sorted, queued ones counted last, cut to the terminal width: " + line);
        System.setProperty("seurat.log.columns", "200");
        TestKit.check(Progress.line().equals(bar), "whole line on a wide terminal: " + Progress.line());
        System.clearProperty("seurat.log.columns");
        bytes.reset();
        Log.info("test", "hello");
        String out = bytes.toString(StandardCharsets.UTF_8);
        TestKit.check(out.startsWith(Progress.wipe()), "log line wipes the bar first");
        TestKit.check(out.endsWith(System.lineSeparator() + line), "then redraws it below the line");
        TestKit.check(out.contains("hello"), "the line itself");
        Progress.done("work=a");
        Progress.done("work=b");
        Progress.done("work=c");
        TestKit.check(Progress.line().equals("queued=1"), "the count follows done: " + Progress.line());
        Progress.done("work=0");
        bytes.reset();
        Log.info("test", "after");
        out = bytes.toString(StandardCharsets.UTF_8);
        TestKit.check(!out.startsWith("\r") && out.endsWith(System.lineSeparator()), "no bar left: plain line");
    }

    private static void eta() {
        TestKit.check(Progress.eta(25, 10_000).equals(" eta=0m 30s 0ms"), "25 % in 10 s leaves 30 s");
        TestKit.check(Progress.eta(50, 500).isEmpty(), "no ETA before the phase ran long enough");
        TestKit.check(Progress.eta(96, 10_000).isEmpty(), "no ETA that rounds to 0 s (0.4 s left)");
        TestKit.check(Progress.eta(0, 10_000).isEmpty() && Progress.eta(100, 10_000).isEmpty(), "no ETA at 0 or 100 %");
    }
}
