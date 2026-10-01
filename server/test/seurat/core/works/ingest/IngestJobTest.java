package seurat.core.works.ingest;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import seurat.adapters.out.decode.Decoders;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.codec.Quant;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.store.FileBrushStore;
import seurat.kit.TestKit;

/**
 * Synthetic masters end to end (spec 7.1): a PNG or JPEG carries no overview, so it goes RECIBIENDO,
 * PINTANDO from 0 %, LISTA without a sketch; a TIFF with a reduced page gets BOCETO from it first.
 */
public final class IngestJobTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("ingest-test");
        Path works = root.resolve("obras");
        Catalog catalog = new Catalog(works);
        List<int[]> states = new ArrayList<>();
        catalog.observe(m -> states.add(new int[] {m.state(), m.progress(), (int) m.edition()}));
        Path master = TestKit.masterPng(root, "tiny.png", 512, 384);
        boolean[] ready = {false};
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        java.io.PrintStream ps = new java.io.PrintStream(baos, true, StandardCharsets.UTF_8);
        seurat.core.shared.observe.Log.setOutput(ps);
        try {
            new IngestJob("tiny", "Tiny", master, works, catalog, new Decoders(), () -> ready[0] = true).run();
        } finally {
            seurat.core.shared.observe.Log.setOutput(System.out);
        }
        TestKit.check(ready[0], "onReady fires");
        String logs = baos.toString(StandardCharsets.UTF_8);
        TestKit.check(logs.matches("(?s).*work=tiny\\s+ready ed=2 took=\\d+m \\d+s \\d+ms.*"),
                "one ready line with took=");
        var work = catalog.get("tiny");
        TestKit.check(work != null && work.meta.state() == ProtoCodes.ST_LISTA
                && work.meta.edition() == 2, "LISTA ed2");
        TestKit.check(work.meta.strata() == 2, "512x384 -> top 1 -> 2 strata");
        TestKit.check(Files.exists(works.resolve("tiny/semilla.bin")), "seed written");
        TestKit.check(!Files.exists(works.resolve("tiny/ed1")), "no overview: no ed1 sketch, one read");
        lifecycle(states, false);
        FileBrushStore store = (FileBrushStore) work.store;
        byte[][] bands = store.bands(new BrushId(0, 0, 0), 0, 4);
        TestKit.check(bands.length == 4, "four bands readable");
        long total = 0;
        for (byte[] band : bands) {
            total += band.length;
        }
        TestKit.check(total > 0, "non-empty brush bytes");
        TestKit.check(store.quantTable() == Quant.TABLE, "store records the table it was encoded with");
        TestKit.check(new FileBrushStore(root.resolve("legacy"), work.meta, new int[]{1}, new int[]{1})
                .quantTable() == 1, "a store without the marker predates table 2");
        errorMarksFailed(root, works, catalog);
        jpegIngest(root, works, catalog);
        states.clear();
        pyramidIngest(root, works, catalog);
        lifecycle(states, true);
        System.out.println("IngestJobTest OK");
    }

    /** RECIBIENDO (no edition), [BOCETO ed1], PINTANDO from 0 % up, then LISTA ed2. */
    private static void lifecycle(List<int[]> states, boolean sketch) {
        List<Integer> order = new ArrayList<>();
        for (int[] m : states) {
            if (order.isEmpty() || order.get(order.size() - 1) != m[0]) order.add(m[0]);
        }
        List<Integer> want = sketch
                ? List.of(ProtoCodes.ST_RECIBIENDO, ProtoCodes.ST_BOCETO, ProtoCodes.ST_PINTANDO, ProtoCodes.ST_LISTA)
                : List.of(ProtoCodes.ST_RECIBIENDO, ProtoCodes.ST_PINTANDO, ProtoCodes.ST_LISTA);
        TestKit.check(order.equals(want), "states " + order + ", want " + want);
        int last = -1;
        for (int[] m : states) {
            if (m[0] == ProtoCodes.ST_RECIBIENDO) TestKit.check(m[2] == ProtoCodes.ED_NINGUNA, "no edition yet");
            if (m[0] != ProtoCodes.ST_PINTANDO) continue;
            TestKit.check(last >= 0 || m[1] == 0, "PINTANDO starts at 0 %");
            TestKit.check(m[1] > last && m[2] == (sketch ? 1 : ProtoCodes.ED_NINGUNA), "every percent once, edition");
            last = m[1];
        }
    }

    /** A TIFF whose second page is the master at half size: that page is its overview. */
    private static void pyramidIngest(Path root, Path works, Catalog catalog) throws Exception {
        java.awt.image.BufferedImage full = TestKit.picture(2100, 1000);
        java.awt.image.BufferedImage half = TestKit.picture(1050, 500);
        Path master = root.resolve("pyramid.tif");
        javax.imageio.ImageWriter writer = javax.imageio.ImageIO.getImageWritersByFormatName("tiff").next();
        try (var out = javax.imageio.ImageIO.createImageOutputStream(master.toFile())) {
            writer.setOutput(out);
            writer.prepareWriteSequence(null);
            writer.writeToSequence(new javax.imageio.IIOImage(full, null, null), null);
            writer.writeToSequence(new javax.imageio.IIOImage(half, null, null), null);
            writer.endWriteSequence();
        }
        writer.dispose();
        new IngestJob("pyramid", "Pyramid", master, works, catalog, new Decoders(), () -> {}).run();
        TestKit.check(catalog.get("pyramid").meta.state() == ProtoCodes.ST_LISTA, "pyramid LISTA");
        TestKit.check(Files.exists(works.resolve("pyramid/ed1/semilla.bin")), "sketch from the overview");
        var entry = seurat.core.works.store.IndexEntry.read(works.resolve("pyramid/ed1/E3.idx"), 0);
        TestKit.check(!entry.isMissing(), "sketch brushes written");
    }

    /** JPEG path: tall chunk decodes sliced into 256-row bands, no overview either. */
    private static void jpegIngest(Path root, Path works, Catalog catalog) throws Exception {
        Path master = TestKit.masterJpg(root, "tall.jpg", 512, 2500);
        boolean[] ready = {false};
        new IngestJob("tall", "Tall", master, works, catalog, new Decoders(), () -> ready[0] = true).run();
        TestKit.check(ready[0], "jpeg onReady fires");
        var work = catalog.get("tall");
        TestKit.check(work != null && work.meta.state() == ProtoCodes.ST_LISTA
                && work.meta.edition() == 2, "jpeg LISTA ed2");
        TestKit.check(!Files.exists(works.resolve("tall/ed1")), "jpeg: no ed1 sketch");
        TestKit.check(Files.exists(works.resolve("tall/semilla.bin")), "jpeg ed2 seed");
        FileBrushStore store = (FileBrushStore) work.store;
        byte[][] bands = store.bands(new BrushId(0, 0, 5), 0, 4);
        TestKit.check(bands.length == 4, "jpeg deep brush readable past the first chunk");
    }
    /** An Error (OOM from a 2^31-1 px gray row buffer) must still end in FALLIDA. */
    private static void errorMarksFailed(Path root, Path works, Catalog catalog) throws Exception {
        ByteBuffer png = ByteBuffer.allocate(33)
                .put(new byte[]{(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'})
                .putInt(13).put("IHDR".getBytes(StandardCharsets.US_ASCII))
                .putInt(Integer.MAX_VALUE).putInt(1).put(new byte[]{8, 0, 0, 0, 0}).putInt(0);
        Path master = Files.write(root.resolve("huge.png"), png.array());
        new IngestJob("huge", "Huge", master, works, catalog, new Decoders(), () -> {}).run();
        TestKit.check(catalog.get("huge").meta.state() == ProtoCodes.ST_FALLIDA, "Error -> FALLIDA");
    }
}
