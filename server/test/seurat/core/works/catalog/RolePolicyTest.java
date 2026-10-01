package seurat.core.works.catalog;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.works.store.WorkMeta;
import seurat.kit.TestKit;

/** Ceilings per role (spec 2.3, 9.1): ranges, nested masks, and meta.json persistence (spec 8). */
public final class RolePolicyTest {
    public static void main(String[] args) throws Exception {
        merges();
        survivesRestart();
        System.out.println("RolePolicyTest OK");
    }

    private static void merges() {
        Map<String, long[]> base = new WorkRecord(meta("w")).ceilings;
        var next = RolePolicy.merge(base, Map.of(WorkRecord.ANONYMOUS, new long[]{0, 2}));
        TestKit.check(next != null && next.get(WorkRecord.ANONYMOUS)[0] == 0
                && next.get(WorkRecord.PRIVILEGED)[1] == 4, "anonymous up to the authenticated ceiling");
        TestKit.check(base.get(WorkRecord.ANONYMOUS)[0] == 1, "merge never mutates the current ceilings");
        TestKit.check(RolePolicy.merge(base, Map.of(WorkRecord.ANONYMOUS, new long[]{0, 4})) == null,
                "anonymous above authenticated breaks the nesting");
        TestKit.check(RolePolicy.merge(base, Map.of(WorkRecord.PRIVILEGED, new long[]{1, 4})) == null,
                "privileged below authenticated breaks the nesting");
        TestKit.check(RolePolicy.merge(base, Map.of(WorkRecord.AUTHENTICATED, new long[]{1, 4})) != null,
                "spec example: authenticated down to stratum 1 with 4 bands still covers anonymous");
        TestKit.check(RolePolicy.merge(base, Map.of(WorkRecord.AUTHENTICATED, new long[]{1, 1})) == null,
                "authenticated s1 with 1 band would fall below anonymous s1 with 2");
        TestKit.check(RolePolicy.merge(base, Map.of(WorkRecord.ANONYMOUS, new long[]{11, 4})) == null
                && RolePolicy.merge(base, Map.of(WorkRecord.ANONYMOUS, new long[]{1, 0})) == null
                && RolePolicy.merge(base, Map.of("root", new long[]{0, 4})) == null
                && RolePolicy.merge(base, Map.of(WorkRecord.ANONYMOUS, new long[0])) == null, "out of range");
    }

    private static void survivesRestart() throws Exception {
        Path root = Files.createTempDirectory("policy-test");
        Catalog catalog = new Catalog(root);
        WorkRecord work = new WorkRecord(meta("w"));
        catalog.register(work);
        catalog.policy(work, RolePolicy.merge(work.ceilings, Map.of(
                WorkRecord.ANONYMOUS, new long[]{0, 1}, WorkRecord.AUTHENTICATED, new long[]{0, 3})));
        Catalog loaded = new Catalog(root);
        loaded.load();
        WorkRecord back = loaded.get("w");
        TestKit.check(back.ceiling(WorkRecord.ANONYMOUS)[0] == 0 && back.ceiling(WorkRecord.ANONYMOUS)[1] == 1
                && back.ceiling(WorkRecord.AUTHENTICATED)[1] == 3, "ceilings read back from meta.json");
        catalog.register(new WorkRecord(meta("w")));
        TestKit.check(catalog.get("w").ceiling(WorkRecord.AUTHENTICATED)[1] == 3, "a new master keeps the policy");
        Files.writeString(root.resolve("w/meta.json"), Files.readString(root.resolve("w/meta.json"))
                .replace("\"techo.privilegiado\":\"0/4\"", "\"techo.privilegiado\":\"3/4\""));
        Catalog broken = new Catalog(root);
        broken.load();
        TestKit.check(broken.get("w").ceiling(WorkRecord.ANONYMOUS)[0] == 1, "a broken policy falls back to defaults");
    }

    private static WorkMeta meta(String id) {
        return new WorkMeta(id, id, 512, 512, 256, 2, ProtoCodes.ST_LISTA, 2, 0, 2);
    }
}
