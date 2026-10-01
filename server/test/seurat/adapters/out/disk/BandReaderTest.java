package seurat.adapters.out.disk;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.observe.AuditLog;
import seurat.kit.TestKit;

/** Spec 8 on disk: a band is re-read once, a band bad twice is alerted once and the valid prefix is served. */
public final class BandReaderTest {
    private static final BrushId P = new BrushId(0, 0, 0);

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("band-reader-test");
        flippedByteAlertsOnceAndServesPrefix(root.resolve("a"));
        badOnceThenGoodIsServedWhole(root.resolve("b"));
        noValidBand(root.resolve("c"));
        System.out.println("BandReaderTest OK");
    }

    private static seurat.core.shared.codec.BrushEncoder.BrushBands write(Path dir, int seed) throws Exception {
        FileBrushStore store = FileBrushStoreTest.open(dir);
        var bb = FileBrushStoreTest.bands(seed);
        store.append(0, 0, 0, bb.bands(), bb.crcs());
        store.close();
        return bb;
    }

    private static long alerts() {
        return java.util.Arrays.stream(AuditLog.dump()).filter((l) -> l.contains("brush=" + P + " ")).count();
    }

    private static void flippedByteAlertsOnceAndServesPrefix(Path dir) throws Exception {
        var bb = write(dir, 1);
        Path pinc = dir.resolve("E0.pinc");
        byte[] disk = Files.readAllBytes(pinc);
        disk[bb.bands()[0].length + bb.bands()[1].length + 5]++; // inside band 2
        Files.write(pinc, disk);
        BandReader reader = new BandReader(dir, new int[]{2});
        long before = alerts();
        TestKit.check(reader.validBands(P) == Integer.MAX_VALUE, "nothing known bad yet");
        TestKit.check(reader.read(P, 0, 4).length == 2, "the prefix b0..b1 before the bad band is served");
        TestKit.check(alerts() == before + 1, "one alert for the bad band");
        TestKit.check(reader.validBands(P) == 2, "the first bad band is remembered");
        TestKit.check(reader.read(P, 0, 4).length == 2, "a second read serves the same prefix");
        TestKit.check(reader.read(P, 2, 4).length == 0, "a retouch past the bad band serves nothing");
        TestKit.check(alerts() == before + 1, "and raises no new alert");
    }

    private static void badOnceThenGoodIsServedWhole(Path dir) throws Exception {
        var bb = write(dir, 2);
        BandReader.Tap torn = (p, band, attempt, raw) -> {
            if (band == 1 && attempt == 0) {
                byte[] bad = raw.clone();
                bad[0]++;
                return bad;
            }
            return raw;
        };
        BandReader reader = new BandReader(dir, new int[]{2}, torn);
        long before = alerts();
        byte[][] out = reader.read(P, 0, 4);
        TestKit.check(out.length == 4 && java.util.Arrays.equals(out[1], bb.bands()[1]), "the re-read serves all 4 bands");
        TestKit.check(alerts() == before && reader.validBands(P) == Integer.MAX_VALUE, "nothing is remembered or alerted");
    }

    private static void noValidBand(Path dir) throws Exception {
        write(dir, 3);
        BandReader always = new BandReader(dir, new int[]{2}, (p, band, attempt, raw) -> band == 0 ? new byte[raw.length] : raw);
        TestKit.check(always.read(P, 0, 4).length == 0, "no valid band serves nothing, without an exception");
        TestKit.check(always.validBands(P) == 0, "validBands is 0");
    }
}
