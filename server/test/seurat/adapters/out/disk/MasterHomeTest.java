package seurat.adapters.out.disk;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.catalog.WorkRecord;
import seurat.core.works.ingest.IngestJob;
import seurat.core.works.store.WorkMeta;
import seurat.kit.IngestKit;
import seurat.kit.TestKit;

/**
 * Spec 1.2 and 7.2: the master moves from the inbox to obras/<id>/master/, meta.json records
 * keepMaster, false deletes the master once the work is LISTA, and a pass cut short is found
 * again from the master it left.
 */
public final class MasterHomeTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("master-home");
        Path inbox = Files.createDirectories(root.resolve("inbox"));
        Path works = root.resolve("obras");

        Path home = MasterHome.adopt(works, "kept", TestKit.masterPng(inbox, "kept.png", 512, 384));
        TestKit.check(home.equals(works.resolve("kept").resolve("master").resolve("kept.png")), "moved home: " + home);
        TestKit.check(!Files.exists(inbox.resolve("kept.png")), "gone from the inbox");
        TestKit.check(MasterHome.adopt(works, "kept", home).equals(home) && Files.exists(home), "already home: stays");
        Path again = MasterHome.adopt(works, "kept", TestKit.masterPng(inbox, "kept.jpg", 512, 384));
        TestKit.check(Files.exists(again) && !Files.exists(home), "a new master replaces the old one");

        Catalog catalog = new Catalog(new DiskArchive(works));
        new IngestJob("kept", "Kept", again, catalog, IngestKit.ports(works), () -> {}, true).run();
        TestKit.check(Files.exists(again), "keepMaster=true: the master stays");
        TestKit.check(meta(works, "kept").contains("\"keepMaster\":true"), "meta.json says keepMaster true");

        Path gone = MasterHome.adopt(works, "gone", TestKit.masterPng(inbox, "gone.png", 512, 384));
        new IngestJob("gone", "Gone", gone, catalog, IngestKit.ports(works), () -> {}, false).run();
        TestKit.check(catalog.get("gone").meta.state() == ProtoCodes.ST_LISTA, "LISTA");
        TestKit.check(!Files.exists(gone.getParent()), "keepMaster=false: master/ deleted after the pass");
        TestKit.check(meta(works, "gone").contains("\"keepMaster\":false"), "meta.json says keepMaster false");

        Path cut = MasterHome.adopt(works, "cut", TestKit.masterPng(inbox, "cut.png", 512, 384));
        WorkRecord painting = new WorkRecord(new WorkMeta("cut", "cut", 512, 384, 256, 2,
                ProtoCodes.ST_PINTANDO, ProtoCodes.ED_NINGUNA));
        painting.keepMaster = false;
        catalog.register(painting);
        var unfinished = new DiskMasters(works).unfinished(catalog);
        TestKit.check(unfinished.keySet().equals(java.util.Set.of("cut")) && unfinished.get("cut").equals(cut),
                "only the pass cut short is ingested again: " + unfinished);

        Catalog restarted = new Catalog(new DiskArchive(works));
        restarted.load();
        TestKit.check(!restarted.get("cut").keepMaster && restarted.get("kept").keepMaster, "keepMaster survives a restart");
        System.out.println("MasterHomeTest OK");
    }

    private static String meta(Path works, String id) throws Exception {
        return Files.readString(works.resolve(id).resolve("meta.json"));
    }
}
