package seurat.proto;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.kit.TestKit;

/** §3.4.3 scrape + §3.4.4 renew/resume goldens. */
public final class ScrapeGoldensTest {
    public static void main(String[] args) {
        concessionE3();
        planCancelled();
        scrape();
        scraped();
        renew();
        resume();
        System.out.println("ScrapeGoldensTest OK");
    }

    private static void concessionE3() {
        var concessionMsg = new MsgGaze.ConcessionMessage(1, 3, 1, 4, 2, 768, 36864, 120);
        byte[] frame = new Frame(FrameType.CONCESION, concessionMsg.encode()).encode();
        byte[] expect = TestKit.unhex("210d01030104024300800090004078");
        TestKit.check(Arrays.equals(frame, expect), "CONCESION e3:\n" + TestKit.hex(frame));
    }

    private static void planCancelled() {
        var ranges = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("41210004")));
        var plan = MsgGaze.Plan.cancelled(1, 12, ranges);
        byte[] frame = new Frame(FrameType.PLAN, plan.encode()).encode();
        byte[] expect = TestKit.unhex("2307010c0241210004");
        TestKit.check(Arrays.equals(frame, expect), "PLAN CANCELADAS:\n" + TestKit.hex(frame));
        TestKit.check(ranges.contains(285) && ranges.contains(289)
                && !ranges.contains(284), "[285,289]");
    }

    private static void scrape() {
        var scrapeMsg = MsgLoans.Scrape.lowStratum(1, 3, 3, 289, 1);
        byte[] frame = new Frame(FrameType.RASPAR, scrapeMsg.encode()).encode();
        byte[] expect = TestKit.unhex("240701030341210101");
        TestKit.check(Arrays.equals(frame, expect), "RASPAR:\n" + TestKit.hex(frame));
    }

    private static void scraped() {
        var kept = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("41000040ff")));
        var scrapedMsg = new MsgLoans.Scraped(1, 3, 3, 289, 28, 216, kept);
        byte[] frame = new Frame(FrameType.RASPADO, scrapedMsg.encode()).encode();
        byte[] expect = TestKit.unhex("250d01030341211c40d841000040ff");
        TestKit.check(Arrays.equals(frame, expect), "RASPADO:\n" + TestKit.hex(frame));
        var back = MsgLoans.Scraped.parse(
                Frame.decode(ByteBuffer.wrap(frame)).payload());
        TestKit.check(back.scrapedCount() == 28 && back.freedKib() == 216
                && back.kept().size() == 256, "RASPADO fields");
    }

    private static void renew() {
        var ranges = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("4150012e2040ff")));
        var renewMsg = new MsgAudit.Renew(1, 12, 120, ranges);
        byte[] frame = new Frame(FrameType.RENOVAR, renewMsg.encode()).encode();
        byte[] expect = TestKit.unhex("280b010c40784150012e2040ff");
        TestKit.check(Arrays.equals(frame, expect), "RENOVAR:\n" + TestKit.hex(frame));
    }

    private static void resume() {
        byte[] token = new byte[32];
        Arrays.fill(token, (byte) 0xD5);
        byte[] ticket = new byte[32];
        Arrays.fill(ticket, (byte) 0x7A);
        var claim = new MsgHello.Claim(1,
                Ranges.decode(ByteBuffer.wrap(TestKit.unhex("4150012e2040ff"))));
        var resumeReq = new MsgHello.ResumeRequest(0x3A915E0C77D214B8L, ticket,
                java.util.List.of(claim));
        var hello = new MsgHello.Hello(1, 1, 3, 256, token, resumeReq);
        byte[] payload = hello.encode();
        TestKit.check(payload.length == 89, "REANUDAR payload 89, got " + payload.length);
        byte[] frame = new Frame(FrameType.SALUDO, payload).encode();
        TestKit.check(frame[0] == 0x01 && frame[1] == 0x40 && frame[2] == 0x59,
                "SALUDO head 01 4059");
        int at = 1 + 1 + 1 + 2 + 1 + 32;
        TestKit.check(payload[at] == 0x01 && payload[at + 1] == 0x31, "REANUDAR TLV 01 31");
        var back = MsgHello.Hello.parse(payload);
        TestKit.check(back.resume() != null && back.resume().claims().size() == 1
                && Arrays.equals(back.resume().ticket(), ticket), "REANUDAR fields");
    }
}
