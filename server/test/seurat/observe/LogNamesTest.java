package seurat.observe;

import seurat.config.SeuratConstants;
import seurat.kit.TestKit;

public final class LogNamesTest {
    private static final int W = SeuratConstants.LOG_NAME_WIDTH;

    public static void main(String[] args) {
        testLongNameIsCutWithEllipsis();
        testShortNameIsPaddedWhenTextFollows();
        testEveryFollowingColumnAligns();
        testNoPaddingAtEndOrBeforeColon();
        testBarCutsButNeverPads();
        testOtherValuesUntouched();
        System.out.println("LogNamesTest OK");
    }

    private static void testLongNameIsCutWithEllipsis() {
        String out = LogNames.fit("work=" + "x".repeat(W + 40) + " ready");
        TestKit.check(out.equals("work=" + "x".repeat(W - 3) + "... ready"), out);
    }

    private static void testShortNameIsPaddedWhenTextFollows() {
        String out = LogNames.fit("file=a.png ready");
        TestKit.check(out.equals("file=a.png" + " ".repeat(W - 5) + " ready"), out);
        TestKit.check(LogNames.fit("zip=" + "y".repeat(W) + " up").equals("zip=" + "y".repeat(W) + " up"),
                "a name exactly W wide stays as it is");
    }

    private static void testEveryFollowingColumnAligns() {
        String a = LogNames.fit("work=000-000-033-103 ready");
        String b = LogNames.fit("work=Declaration_of_victory_after_the_Battle_of_Leipzig,_by_Johann_Peter_Krafft ready");
        TestKit.check(a.indexOf("ready") == b.indexOf("ready"), a + " / " + b);
    }

    private static void testNoPaddingAtEndOrBeforeColon() {
        TestKit.check(LogNames.fit("progress work=abc").equals("progress work=abc"), "end of line");
        TestKit.check(LogNames.fit("entry skipped work=abc: already ready").equals("entry skipped work=abc: already ready"),
                "before a colon");
    }

    private static void testBarCutsButNeverPads() {
        TestKit.check(LogNames.cut("work=a painting").equals("work=a painting"), "short names stay short in the bar");
        TestKit.check(LogNames.cut("work=" + "x".repeat(W + 5) + " painting").equals("work=" + "x".repeat(W - 3) + "... painting"),
                "long names are cut in the bar");
    }

    private static void testOtherValuesUntouched() {
        String msg = "path=C:\\very\\" + "long\\".repeat(20) + "file.png remote=/1.2.3.4:5678 size=1x1 overwork=z";
        TestKit.check(LogNames.fit(msg).equals(msg), LogNames.fit(msg));
        TestKit.check(LogNames.fit(null) == null, "null passes through");
    }
}
