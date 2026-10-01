package seurat.adapters.in.inbox;

import java.util.Locale;
import seurat.core.works.catalog.MasterNames;

/** Zip names and sizes the inbox recognises: a zip of masters is unpacked, never ingested itself. */
final class ZipNames {
    /** Smallest valid zip: the end-of-central-directory record alone. */
    static final int EOCD_BYTES = 22;
    static final String EXTENSION = ".zip";

    private ZipNames() {}

    /** True for a zip name, in any letter case. */
    static boolean isZip(String name) {
        return name.toLowerCase(Locale.ROOT).endsWith(EXTENSION);
    }

    /** A name the inbox takes: a master or a zip of masters, in any letter case. */
    static boolean isAdmitted(String name) {
        return MasterNames.isMaster(name) || isZip(name);
    }
}
