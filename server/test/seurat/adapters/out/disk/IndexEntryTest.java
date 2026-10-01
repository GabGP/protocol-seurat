package seurat.adapters.out.disk;

import seurat.kit.TestKit;

/** 40B index records: absent vs empty vs committed. */
public final class IndexEntryTest {
    public static void main(String[] args) {
        sizes();
        absentEmpty();
        roundTrip();
        System.out.println("IndexEntryTest OK");
    }

    private static void sizes() {
        IndexEntry entry = new IndexEntry(0, new long[4], new long[4]);
        TestKit.check(entry.encode().length == IndexEntry.BYTES, "40B");
        TestKit.check(IndexEntry.missing().encode().length == IndexEntry.BYTES, "missing encodes");
    }

    private static void absentEmpty() {
        TestKit.check(IndexEntry.missing().isMissing(), "missing flag");
        TestKit.check(!IndexEntry.missing().isEmpty(), "missing is not empty");
        IndexEntry empty = new IndexEntry(1234, new long[4], new long[4]);
        TestKit.check(!empty.isMissing() && empty.isEmpty(), "all-ends-zero is empty");
        IndexEntry full = new IndexEntry(0, new long[]{10, 20, 30, 40},
                new long[]{1, 2, 3, 4});
        TestKit.check(!full.isMissing() && !full.isEmpty(), "committed");
    }

    private static void roundTrip() {
        IndexEntry e = new IndexEntry(0x123456789AL, new long[]{100, 200, 300, 400},
                new long[]{0xAABBCCDDL, 1, 2, 3});
        IndexEntry back = IndexEntry.decode(java.nio.ByteBuffer.wrap(e.encode()));
        TestKit.check(back.offset() == 0x123456789AL, "offset");
        TestKit.check(back.ends()[3] == 400 && back.crcs()[0] == 0xAABBCCDDL, "ends/crc");
    }
}
